/**
 * Counter PC alarm: beeps and reads alerts aloud ("PS5 One, time up", "PS5 One, 5 minutes remaining") on the PC
 * where ZENAA is open. Choices are saved per computer (browser), so only the counter PC needs to switch it on.
 * Voices come from Windows itself (Settings → Time & language → Speech), so no internet is needed.
 */
import { Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Field, Modal } from '../components/ui';

export type AnnouncerPrefs = { sound: boolean; voice: boolean; volume: number; voiceName: string; repeat: number };
const KEY = 'zenaa.announcer';
const DEFAULTS: AnnouncerPrefs = { sound: false, voice: true, volume: 0.9, voiceName: '', repeat: 2 };

export function loadPrefs(): AnnouncerPrefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}
function savePrefs(p: AnnouncerPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private window: works until the page closes */
  }
}

let audio: AudioContext | null = null;
function ctx() {
  if (!audio) {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    audio = new AC();
  }
  if (audio.state === 'suspended') audio.resume().catch(() => {});
  return audio;
}
// Browsers only allow sound after the page has been clicked once; unlock on the first click/key.
if (typeof window !== 'undefined') {
  const unlock = () => {
    ctx();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

function tone(ac: AudioContext, freq: number, start: number, dur: number, vol: number) {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = 'square';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(Math.max(0.001, vol * 0.35), start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(ac.destination);
  o.start(start);
  o.stop(start + dur + 0.02);
}

/** warning: two soft beeps; timeup: an alarm of 3 × 3 fast beeps. Returns how long it plays (ms). */
export function beep(kind: 'warning' | 'timeup', volume: number) {
  const ac = ctx();
  if (!ac) return 0;
  const t = ac.currentTime + 0.05;
  if (kind === 'warning') {
    tone(ac, 880, t, 0.18, volume);
    tone(ac, 880, t + 0.3, 0.18, volume);
    return 600;
  }
  for (let r = 0; r < 3; r++) for (let i = 0; i < 3; i++) tone(ac, i === 2 ? 1320 : 1040, t + r * 0.8 + i * 0.16, 0.12, volume);
  return 2500;
}

export function voices() {
  return typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)) : [];
}

export function speak(text: string, p: AnnouncerPrefs, times = 1) {
  if (typeof speechSynthesis === 'undefined' || !text) return;
  for (let i = 0; i < times; i++) {
    const u = new SpeechSynthesisUtterance(text);
    u.volume = p.volume;
    u.rate = 0.95;
    const v = voices().find((x) => x.name === p.voiceName);
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  }
}

/** Called for every server alert that carries sound/speak hints. */
export function announce(e: { sound?: 'warning' | 'timeup'; speak?: string }) {
  const p = loadPrefs();
  if (!p.sound || !e.sound) return;
  const ms = beep(e.sound, p.volume);
  if (p.voice && e.speak) setTimeout(() => speak(e.speak!, p, e.sound === 'timeup' ? p.repeat : 1), ms);
}

/** Top-bar speaker button: on/off + settings for this PC. */
export function AnnouncerToggle() {
  const [p, setP] = useState(loadPrefs);
  const [open, setOpen] = useState(false);
  const [, setVoicesReady] = useState(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    savePrefs(p);
  }, [p]);
  useEffect(() => {
    if (typeof speechSynthesis === 'undefined') return;
    const h = () => setVoicesReady((n) => n + 1);
    speechSynthesis.addEventListener?.('voiceschanged', h);
    return () => speechSynthesis.removeEventListener?.('voiceschanged', h);
  }, []);
  return (
    <>
      <button
        className="btn btn-ghost btn-icon"
        onClick={() => setOpen(true)}
        title={p.sound ? 'Alarm & voice on this PC: on' : 'Alarm & voice on this PC: off'}
        aria-label="Alarm and voice settings"
        style={p.sound ? { color: 'var(--success)' } : undefined}
      >
        {p.sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
      </button>
      {open && (
        <Modal title="Alarm & voice on this PC" onClose={() => setOpen(false)}>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            Turn this on at the <b>counter PC</b> (connect a speaker). It beeps and says, for example, <i>"PS5 One, 5 minutes remaining"</i> and{' '}
            <i>"PS5 One, time up"</i>. The setting is saved on this computer only. Keep ZENAA open in a browser tab, and click the page once after opening it
            (browsers only allow sound after a click).
          </p>
          <label className="check">
            <input type="checkbox" checked={p.sound} onChange={(e) => setP({ ...p, sound: e.target.checked })} /> Beep on this PC for time warnings and time up
          </label>
          <label className="check">
            <input type="checkbox" checked={p.voice} disabled={!p.sound} onChange={(e) => setP({ ...p, voice: e.target.checked })} /> Also say it out loud
          </label>
          <div className="form-grid" style={{ marginTop: 8 }}>
            <Field label="Volume">
              <input type="range" min={0.1} max={1} step={0.1} value={p.volume} onChange={(e) => setP({ ...p, volume: Number(e.target.value) })} />
            </Field>
            <Field label='Say "time up" how many times'>
              <select className="select" value={p.repeat} onChange={(e) => setP({ ...p, repeat: Number(e.target.value) })}>
                {[1, 2, 3].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </Field>
            <Field label="Voice">
              <select className="select" value={p.voiceName} onChange={(e) => setP({ ...p, voiceName: e.target.value })}>
                <option value="">Windows default</option>
                {voices().map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button
              className="btn btn-sm"
              onClick={() => {
                const ms = beep('warning', p.volume);
                setTimeout(() => speak('PS5 One, 5 minutes remaining', p), ms);
              }}
            >
              Test: 5 minutes
            </button>
            <button
              className="btn btn-sm"
              onClick={() => {
                const ms = beep('timeup', p.volume);
                setTimeout(() => speak('PS5 One, time up', p, p.repeat), ms);
              }}
            >
              Test: time up
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
