/**
 * v0.9.6 customer app: play from the app (start a paid booking or saved time, pause, continue, stop),
 * saved time per station type and changing it, paying a booking ahead, finding people to chat with,
 * and phone notifications.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, Clock, Minus, Pause, Play, Repeat, Search, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Avatar } from '../competitions/ui';
import { ErrorBox, Field, Modal } from '../components/ui';
import { formatMinutes } from '../lib/format';
import { pget, ppost } from './portal-api';
import { MomoTopup } from './PortalExtras';

const fmtClock = (secs: number) => {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${h > 0 ? `${h}:` : ''}${String(m).padStart(h > 0 ? 2 : 1, '0')}:${String(ss).padStart(2, '0')}`;
};

function useTick(on: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => set((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [on]);
}

/** Money with a real minus sign for negative amounts: −GH₵20.00. */
export const signedMoney = (money: (n: number) => string, v: number) => (v < 0 ? `−${money(-v)}` : money(v));

/**
 * Main balance = wallet − what they owe. Shown in red with "You owe" when it is below zero.
 * `light` = on the purple balance card.
 */
export function MainBalance({ me, money, light }: { me: any; money(n: number): string; light?: boolean }) {
  const owed = me.outstanding ?? 0;
  const main = me.balance - owed;
  return (
    <>
      <span className={`big ${main < 0 ? 'neg-balance' : ''} ${light ? 'on-hero' : ''}`}>{signedMoney(money, main)}</span>
      {owed > 0 && (
        <span className="owed-line">
          Wallet {money(me.balance)} · <b>You owe {money(owed)}</b>
        </span>
      )}
    </>
  );
}

/** "You owe" card with Pay from wallet and Pay with MoMo. */
export function PayOwedCard({ me, info, money }: { me: any; info: any; money(n: number): string }) {
  const qc = useQueryClient();
  const [momo, setMomo] = useState(false);
  const owed = me.outstanding ?? 0;
  const fromWallet = useMutation({
    mutationFn: () => ppost('/api/portal/account/pay-from-wallet'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal'] }),
  });
  if (owed <= 0) return null;
  const canWallet = me.balance > 0;
  return (
    <div className="card card-pad owed-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span className="stat-label">You owe</span>
      <span className="stat-value neg-balance">−{money(owed)}</span>
      <span className="dim" style={{ fontSize: 13 }}>
        Games played on your account and not paid yet.{info.autoPayOwed ? ' Money you put in your wallet pays this first.' : ''}
      </span>
      <ErrorBox error={fromWallet.error} />
      {fromWallet.data && <div className="hint">Paid {money(fromWallet.data.paid)} from your wallet.</div>}
      <div className="toolbar">
        {canWallet && (
          <button className="btn" disabled={fromWallet.isPending} onClick={() => fromWallet.mutate()}>
            Pay {money(Math.min(owed, me.balance))} from my wallet
          </button>
        )}
        {info.momoTopupEnabled && (
          <button className={`btn ${momo ? '' : 'btn-primary'}`} onClick={() => setMomo((m) => !m)}>
            {momo ? 'Close MoMo' : 'Pay with MoMo'}
          </button>
        )}
        {!info.momoTopupEnabled && !canWallet && <span className="dim">Pay at the counter with cash or MoMo.</span>}
      </div>
      {momo && (
        <MomoTopup
          money={money}
          currencyCode={info.currencyCode}
          minorUnits={info.currencyMinorUnits}
          preset={owed}
          title="Pay what you owe with MoMo"
          intro={
            info.autoPayOwed
              ? 'Get your code, send the MoMo with the code as the reference, and what you owe is paid as soon as we receive it.'
              : 'Get your code and send the MoMo with the code as the reference. The money goes into your wallet — then press "Pay from my wallet".'
          }
        />
      )}
    </div>
  );
}

/** Home page card: the session running now (with Pause / Continue / Stop), or "Play now" with saved time. */
export function MyPlayCard({ me, selfStart }: { me: any; selfStart: boolean }) {
  const qc = useQueryClient();
  const s = me.activeSession;
  const [loadedAt, setLoadedAt] = useState(Date.now());
  useEffect(() => setLoadedAt(Date.now()), [s?.id, s?.status, s?.remainingSeconds, s?.activeSeconds]);
  useTick(!!s && s.status === 'running');
  const [playNow, setPlayNow] = useState(false);
  const [less, setLess] = useState(false);
  const act = useMutation({
    mutationFn: (what: 'pause' | 'resume' | 'stop') => ppost(`/api/portal/play/${s.id}/${what}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal'] }),
  });
  if (!s) {
    if (!selfStart || me.savedSeconds < 60) return null;
    return (
      <div className="card card-pad play-card idle">
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong>Play now with your saved time</strong>
          <div className="dim" style={{ fontSize: 13 }}>
            At the centre? Pick a free station and start — no need to queue at the counter.
          </div>
        </div>
        <button className="btn btn-primary" onClick={() => setPlayNow(true)}>
          <Play size={16} /> Play now
        </button>
        {playNow && <PlayNowModal me={me} onClose={() => setPlayNow(false)} />}
      </div>
    );
  }
  const running = s.status === 'running';
  const passed = running ? (Date.now() - loadedAt) / 1000 : 0;
  const left = s.remainingSeconds != null ? s.remainingSeconds - passed : null;
  const played = s.activeSeconds + passed;
  const low = left != null && left < 5 * 60;
  return (
    <div className={`card card-pad play-card ${running ? 'running' : 'paused'} ${low ? 'low' : ''}`}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span className="stat-label">
          {running ? '🎮 Playing now' : '⏸ Paused'} · {s.stationName}
        </span>
        <span className="play-clock mono">{left != null ? fmtClock(left) : fmtClock(played)}</span>
        <span className="dim" style={{ fontSize: 13 }}>
          {left != null ? `left · ${formatMinutes(Math.floor(played / 60))} played` : 'played (pay at the counter)'}
          {!running ? ' · the clock is stopped' : ''}
        </span>
      </div>
      {selfStart && (
        <div className="toolbar" style={{ gap: 8 }}>
          <ErrorBox error={act.error} />
          {running ? (
            <button className="btn" disabled={act.isPending} onClick={() => act.mutate('pause')}>
              <Pause size={16} /> Pause
            </button>
          ) : (
            <button className="btn btn-primary" disabled={act.isPending} onClick={() => act.mutate('resume')}>
              <Play size={16} /> Continue
            </button>
          )}
          {s.canStop && left != null && left >= 120 && (
            <button className="btn" disabled={act.isPending} onClick={() => setLess(true)} title="Take time off — it goes back on your saved time">
              <Minus size={16} /> Time
            </button>
          )}
          {s.canStop && (
            <button
              className="btn btn-ghost"
              style={{ color: 'var(--danger)' }}
              disabled={act.isPending}
              onClick={() => window.confirm(`Stop now? The ${left != null ? formatMinutes(Math.floor(left / 60)) : ''} left goes back on your saved time.`) && act.mutate('stop')}
            >
              <Square size={16} /> Stop
            </button>
          )}
        </div>
      )}
      {less && left != null && <LessTimeModal id={s.id} left={left} onClose={() => setLess(false)} />}
    </div>
  );
}

/** "− Time": take minutes off the session running now; they go back on the customer's saved time. */
function LessTimeModal({ id, left, onClose }: { id: string; left: number; onClose(): void }) {
  const qc = useQueryClient();
  const most = Math.max(0, Math.floor((left - 60) / 60));
  const [minutes, setMinutes] = useState(String(Math.min(15, most)));
  const n = Number(minutes);
  const go = useMutation({
    mutationFn: () => ppost(`/api/portal/play/${id}/reduce`, { minutes: n }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal'] });
      onClose();
    },
  });
  const ok = Number.isInteger(n) && n >= 1 && n <= most;
  return (
    <Modal
      title="Take time off"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!ok || go.isPending} onClick={() => go.mutate()}>
            <Minus size={16} /> Take off {ok ? formatMinutes(n) : ''}
          </button>
        </>
      }
    >
      <ErrorBox error={go.error} />
      <div className="hint">
        You have {formatMinutes(Math.floor(left / 60))} left. The minutes you take off go back on your <b>saved time</b> — play them another day.
      </div>
      <div className="toolbar">
        {[5, 15, 30, 60]
          .filter((x) => x <= most)
          .map((x) => (
            <button type="button" key={x} className={`btn btn-sm ${n === x ? 'btn-primary' : ''}`} onClick={() => setMinutes(String(x))}>
              −{formatMinutes(x)}
            </button>
          ))}
      </div>
      <Field label="Minutes to take off" hint={`Up to ${formatMinutes(most)} (1 minute must stay — to finish now, press Stop).`}>
        <input className="input" type="number" min={1} max={most} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
      </Field>
    </Modal>
  );
}

function PlayNowModal({ me, onClose }: { me: any; onClose(): void }) {
  const qc = useQueryClient();
  const stations = useQuery({
    queryKey: ['portal', 'stations'],
    queryFn: () => pget('/api/portal/stations'),
  });
  const [stationId, setStationId] = useState('');
  const [minutes, setMinutes] = useState('');
  const go = useMutation({
    mutationFn: () =>
      ppost('/api/portal/play/start', {
        stationId,
        minutes: Number(minutes) > 0 ? Number(minutes) : undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal'] });
      onClose();
    },
  });
  const free = (stations.data ?? []).filter((s: any) => s.state === 'available');
  return (
    <Modal
      title="Play now"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!stationId || go.isPending} onClick={() => go.mutate()}>
            <Play size={16} /> Start
          </button>
        </>
      }
    >
      <ErrorBox error={go.error} />
      <SavedTimeList me={me} />
      <Field label="Free stations">
        <div className="slot-grid">
          {free.length === 0 && <span className="dim">No station is free right now.</span>}
          {free.map((s: any) => (
            <button key={s.id} type="button" className={`slot ${stationId === s.id ? 'on' : ''}`} onClick={() => setStationId(s.id)}>
              <strong>{s.name}</strong>
              <span className="dim" style={{ fontSize: 12 }}>
                {s.categoryName ?? ''}
              </span>
            </button>
          ))}
        </div>
      </Field>
      <Field label="How long (minutes)" hint="Leave empty to play all the saved time you have for that station. Stop any time — the rest is kept.">
        <input className="input" type="number" min={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="All" />
      </Field>
      <div className="hint">Start only when you are at the station — the clock starts straight away. You can pause it in the app.</div>
    </Modal>
  );
}

function SavedTimeList({ me }: { me: any }) {
  const list = (me.savedTime ?? []) as any[];
  if (!list.length) return null;
  return (
    <div className="list">
      {list.map((t) => (
        <div key={t.categoryId ?? 'any'} className="list-item">
          <span>
            <Clock size={14} style={{ verticalAlign: -2 }} /> {t.name}
          </span>
          <strong>{formatMinutes(Math.floor(t.seconds / 60))}</strong>
        </div>
      ))}
    </div>
  );
}

/** Saved time card: how much per station type, history, and "Change" (convert between types). */
export function SavedTimeCard({ me }: { me: any }) {
  const [convert, setConvert] = useState(false);
  const tied = (me.savedTime ?? []).filter((t: any) => t.categoryId);
  if (me.savedSeconds < 60 && !me.timeLog?.length) return null;
  return (
    <div className="card stat">
      <span className="stat-label">⏱ Your saved time</span>
      <span className="stat-value" style={{ color: me.savedSeconds >= 60 ? 'var(--success)' : undefined }}>
        {formatMinutes(Math.floor(me.savedSeconds / 60))}
      </span>
      {(me.savedTime ?? []).length > 1 || tied.length ? <SavedTimeList me={me} /> : null}
      <span className="stat-sub">{me.savedSeconds >= 60 ? 'Play it from the app (Play now) or at the counter' : 'All used — buy time at the counter or pay a booking from your wallet'}</span>
      {tied.length > 0 && (
        <button className="btn btn-sm" style={{ alignSelf: 'flex-start', marginTop: 6 }} onClick={() => setConvert(true)}>
          <Repeat size={14} /> Change to another station type
        </button>
      )}
      {me.timeLog?.length > 0 && (
        <details style={{ marginTop: 6, fontSize: 12 }}>
          <summary className="dim">History</summary>
          {me.timeLog.slice(0, 10).map((t: any) => (
            <div key={t.id} className="dim">
              {new Date(t.createdAt).toLocaleString(undefined, {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}{' '}
              ·{' '}
              {{
                bought: 'Bought',
                saved: 'Saved',
                used: 'Played',
                adjust: 'Changed',
                convert: 'Changed type',
              }[t.kind as string] ?? t.kind}{' '}
              {t.seconds < 0 ? '−' : '+'}
              {formatMinutes(Math.floor(Math.abs(t.seconds) / 60))}
              {t.planName ? ` · ${t.planName}` : ''}
            </div>
          ))}
        </details>
      )}
      {convert && <ConvertModal me={me} onClose={() => setConvert(false)} />}
    </div>
  );
}

function ConvertModal({ me, onClose }: { me: any; onClose(): void }) {
  const qc = useQueryClient();
  const stations = useQuery({
    queryKey: ['portal', 'stations'],
    queryFn: () => pget('/api/portal/stations'),
  });
  const from = (me.savedTime ?? []).filter((t: any) => t.categoryId) as any[];
  const [fromId, setFromId] = useState<string>(from[0]?.categoryId ?? '');
  const types = new Map<string, string>();
  for (const s of stations.data ?? []) if (s.categoryId && s.categoryName) types.set(s.categoryId, s.categoryName);
  const [toId, setToId] = useState('');
  const have = Math.floor((from.find((f) => f.categoryId === fromId)?.seconds ?? 0) / 60);
  const [minutes, setMinutes] = useState(String(have));
  useEffect(() => setMinutes(String(have)), [fromId, have]);
  const n = Math.min(Number(minutes) || 0, have);
  const preview = useQuery({
    queryKey: ['portal', 'convert', fromId, toId, n],
    queryFn: () =>
      ppost('/api/portal/time/convert', {
        fromCategoryId: fromId,
        toCategoryId: toId,
        minutes: n,
        preview: true,
      }),
    enabled: !!fromId && !!toId && n > 0,
    retry: false,
  });
  const go = useMutation({
    mutationFn: () =>
      ppost('/api/portal/time/convert', {
        fromCategoryId: fromId,
        toCategoryId: toId,
        minutes: n,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal'] });
      onClose();
    },
  });
  return (
    <Modal
      title="Change saved time to another station type"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!preview.data || go.isPending} onClick={() => go.mutate()}>
            Change it
          </button>
        </>
      }
    >
      <ErrorBox error={go.error || preview.error} />
      <div className="hint">Stations have different prices, so the time is changed at the same money value. Example: 2 h on a GH₵10/h station = 1 h on a GH₵20/h station.</div>
      <div className="form-grid">
        <Field label="From">
          <select className="select" value={fromId} onChange={(e) => setFromId(e.target.value)}>
            {from.map((f) => (
              <option key={f.categoryId} value={f.categoryId}>
                {f.name} ({formatMinutes(Math.floor(f.seconds / 60))})
              </option>
            ))}
          </select>
        </Field>
        <Field label="To">
          <select className="select" value={toId} onChange={(e) => setToId(e.target.value)}>
            <option value="">Choose…</option>
            {[...types]
              .filter(([id]) => id !== fromId)
              .map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Minutes to change">
          <input className="input" type="number" min={1} max={have} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </Field>
      </div>
      {preview.data && (
        <div className="total-row">
          <span>
            {formatMinutes(preview.data.fromMinutes)} {preview.data.from} becomes
          </span>
          <span>
            {formatMinutes(preview.data.toMinutes)} {preview.data.to}
          </span>
        </div>
      )}
    </Modal>
  );
}

/** Booking page: how to pay (wallet now / saved time / at the counter) with the price. */
export function BookingPayChoice({
  stationId,
  minutes,
  value,
  onChange,
  money,
  planId,
  onPlan,
}: {
  stationId: string;
  minutes: number;
  value: string;
  onChange(v: string): void;
  money(n: number): string;
  /** Chosen price / game package ('' = the usual price). */
  planId?: string;
  /** A package was picked: its id and length, so the booking can match it. */
  onPlan?(id: string, minutes: number | null): void;
}) {
  const q = useQuery({
    queryKey: ['portal', 'booking-quote', stationId, minutes, planId ?? ''],
    queryFn: () => pget(`/api/portal/booking-quote?stationId=${stationId}&minutes=${minutes}${planId ? `&planId=${planId}` : ''}`),
    enabled: !!stationId,
  });
  const d = q.data;
  const options: any[] = d?.options ?? [];
  const savedOk = d && d.savedSeconds >= minutes * 60;
  const walletOk = d && d.price != null && d.balance >= d.price;
  useEffect(() => {
    if (!d) return;
    if (value === 'saved' && !savedOk) onChange('counter');
    if (value === 'wallet' && !walletOk) onChange('counter');
  }, [d, value, savedOk, walletOk, onChange]);
  if (!stationId || !d) return null;
  const opt = (v: string, title: string, sub: string, ok: boolean) => (
    <button type="button" className={`slot ${value === v ? 'on' : ''}`} disabled={!ok} onClick={() => onChange(v)}>
      <strong>{title}</strong>
      <span className="dim" style={{ fontSize: 12 }}>
        {sub}
      </span>
    </button>
  );
  return (
    <>
      {onPlan && options.length > 1 && (
        <Field label="Price / game package" hint="A package gives you its full time — book its length, or any extra time goes on your saved time.">
          <div className="slot-grid">
            {options.map((o) => (
              <button key={o.id} type="button" className={`slot ${d.planId === o.id ? 'on' : ''}`} onClick={() => onPlan(o.id, o.kind === 'package' ? o.packageMinutes : null)}>
                <strong>{o.name}</strong>
                <span className="dim" style={{ fontSize: 12 }}>
                  {o.kind === 'package' ? `${formatMinutes(o.packageMinutes)} package` : `${money(o.ratePerHour)} / hour`}
                </span>
                <span className="badge" style={{ alignSelf: 'flex-start' }}>
                  {money(o.price)}
                  {o.minutes !== minutes ? ` · ${formatMinutes(o.minutes)}` : ''}
                </span>
              </button>
            ))}
          </div>
        </Field>
      )}
      <Field label="How will you pay?">
        <div className="slot-grid">
          {opt(
            'wallet',
            d.price != null ? `Pay ${money(d.price)} now${d.planName && options.length > 1 ? ` · ${d.planName}` : ''}` : 'Pay now',
            walletOk ? `From your wallet (${money(d.balance)}). Start it from the app when you arrive.` : `Wallet: ${money(d.balance)} — top up first`,
            !!walletOk,
          )}
          {opt(
            'saved',
            'Use my saved time',
            savedOk ? `You have ${formatMinutes(Math.floor(d.savedSeconds / 60))} for this station` : `Not enough saved time for this station (${formatMinutes(Math.floor(d.savedSeconds / 60))})`,
            !!savedOk,
          )}
          {opt('counter', 'Pay at the counter', 'Cash or MoMo when you arrive', true)}
        </div>
      </Field>
    </>
  );
}

/** Buttons on one of my bookings: Start (when paid and it is time) or Pay now. */
export function BookingActions({ b, selfStart, playing, money }: { b: any; selfStart: boolean; playing: boolean; money(n: number): string }) {
  const qc = useQueryClient();
  const [pay, setPay] = useState(false);
  const live = b.status === 'pending' || b.status === 'confirmed';
  const now = Date.now();
  const startable = live && b.payment !== 'counter' && now >= Date.parse(b.startAt) - 15 * 60_000 && now < Date.parse(b.endAt);
  const start = useMutation({
    mutationFn: () => ppost('/api/portal/play/start', { bookingId: b.id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal'] }),
  });
  if (!live) return null;
  return (
    <>
      {b.payment === 'counter' ? (
        <button className="btn btn-sm" onClick={() => setPay(true)}>
          Pay now
        </button>
      ) : (
        <span className="badge badge-success">{b.payment === 'wallet' ? 'Paid' : 'Saved time'}</span>
      )}
      {selfStart && startable && !playing && (
        <button className="btn btn-sm btn-primary" disabled={start.isPending} onClick={() => window.confirm('Start your time now? Only start when you are at the station.') && start.mutate()}>
          <Play size={14} /> Start
        </button>
      )}
      {start.error && <span className="error-text">{(start.error as Error).message}</span>}
      {pay && <PayBookingModal b={b} money={money} onClose={() => setPay(false)} />}
    </>
  );
}

function PayBookingModal({ b, money, onClose }: { b: any; money(n: number): string; onClose(): void }) {
  const qc = useQueryClient();
  const [value, setValue] = useState('wallet');
  const m = useMutation({
    mutationFn: () => ppost(`/api/portal/bookings/${b.id}/pay`, { pay: value }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal'] });
      onClose();
    },
  });
  return (
    <Modal
      title={`Pay booking #${b.number}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={value === 'counter' || m.isPending} onClick={() => m.mutate()}>
            Pay
          </button>
        </>
      }
    >
      <ErrorBox error={m.error} />
      <BookingPayChoice stationId={b.stationId} minutes={b.minutes} value={value} onChange={setValue} money={money} />
    </Modal>
  );
}

// ───────────────────────── Chat: find people ─────────────────────────

/** Search any player, or browse who is online / playing now, and open a private chat. */
export function PeopleFinder({ onOpen }: { onOpen(id: string, name: string): void }) {
  const [q, setQ] = useState('');
  const [show, setShow] = useState(false);
  const people = useQuery({
    queryKey: ['portal', 'chat', 'people', q.trim()],
    queryFn: () => pget(`/api/portal/chat/people${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`),
    enabled: show || q.trim().length > 0,
    refetchInterval: 30_000,
  });
  const list = (people.data ?? []) as any[];
  const shown = q.trim() ? list : list.filter((p) => p.online || p.playing).slice(0, 12);
  return (
    <div className="pc-people">
      <div className="pc-search">
        <Search size={15} />
        <input className="input" value={q} placeholder="Find a player to message…" onFocus={() => setShow(true)} onChange={(e) => setQ(e.target.value)} />
      </div>
      {(show || q.trim()) && (
        <>
          <div className="dim pc-sub">{q.trim() ? 'Players' : 'Online now'}</div>
          {shown.length === 0 && <div className="dim pc-empty">{q.trim() ? 'Nobody found' : 'Nobody else is online right now — search by name above.'}</div>}
          <div className="pc-people-row">
            {shown.map((p) => (
              <button key={p.id} className="pc-person" onClick={() => onOpen(p.id, p.name)} title={`Message ${p.name}`}>
                <span className="pc-person-pic">
                  <Avatar name={p.name} src={p.avatarUrl} size={40} />
                  {(p.online || p.playing) && <span className={`pc-online ${p.playing ? 'playing' : ''}`} />}
                </span>
                <span className="pc-person-name">{p.name}</span>
                {p.playing && (
                  <span className="dim" style={{ fontSize: 10 }}>
                    playing
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ───────────────────────── Phone notifications ─────────────────────────

const b64ToBytes = (b64: string) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function currentSub() {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Profile: turn phone notifications on/off (Web Push). Explains why it can't work when it can't. */
export function NotificationsCard() {
  const [state, setState] = useState<'checking' | 'on' | 'off' | 'blocked' | 'unsupported' | 'insecure' | 'ios-install'>('checking');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    if (!window.isSecureContext) return setState('insecure');
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return setState(ios && !standalone ? 'ios-install' : 'unsupported');
    if (Notification.permission === 'denied') return setState('blocked');
    setState((await currentSub()) ? 'on' : 'off');
  };
  useEffect(() => {
    void check();
  }, []);
  const turnOn = async () => {
    setBusy(true);
    setErr(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setState(perm === 'denied' ? 'blocked' : 'off');
        return;
      }
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
      await navigator.serviceWorker.ready;
      const { publicKey } = await pget<{ publicKey: string }>('/api/portal/push/key');
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64ToBytes(publicKey),
      });
      await ppost('/api/portal/push/subscribe', sub.toJSON());
      setState('on');
      await ppost('/api/portal/push/test').catch((e: Error) => setErr(e.message));
    } catch (e) {
      setErr((e as Error).message || 'Could not turn notifications on');
    } finally {
      setBusy(false);
    }
  };
  const turnOff = async () => {
    setBusy(true);
    try {
      const sub = await currentSub();
      if (sub) {
        await ppost('/api/portal/push/unsubscribe', {
          endpoint: sub.endpoint,
        }).catch(() => undefined);
        await sub.unsubscribe();
      }
      setState('off');
    } finally {
      setBusy(false);
    }
  };
  const msg: Record<string, string> = {
    insecure: 'Notifications need the secure (https://) address of the app. Ask staff for the https link, or use the app on the centre Wi-Fi when it is set up.',
    unsupported: 'This browser cannot show notifications. Try Chrome on Android.',
    'ios-install': 'On iPhone: tap Share → "Add to Home Screen", open the app from your home screen, then turn notifications on here.',
    blocked: 'Notifications are blocked for this site. Allow them in your browser settings (tap the lock next to the address), then come back.',
  };
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="toolbar">
        <h2 style={{ flex: 1 }}>
          <Bell size={18} style={{ verticalAlign: -3 }} /> Notifications
        </h2>
        {state === 'on' && <span className="badge badge-success">On</span>}
      </div>
      <span className="dim" style={{ fontSize: 13 }}>
        Get a message on your phone — even when the app is closed — for private chats, match challenges, booking changes and when your time is nearly up.
      </span>
      {msg[state] && <div className="hint">{msg[state]}</div>}
      {err && <div className="error-text">{err}</div>}
      <div className="toolbar">
        {state === 'off' && (
          <button className="btn btn-primary" disabled={busy} onClick={turnOn}>
            <Bell size={16} /> Turn on notifications
          </button>
        )}
        {state === 'on' && (
          <>
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                ppost('/api/portal/push/test').then(
                  () => setErr(null),
                  (e: Error) => setErr(e.message),
                )
              }
            >
              Send a test
            </button>
            <button className="btn btn-ghost" disabled={busy} onClick={turnOff}>
              <BellOff size={16} /> Turn off
            </button>
          </>
        )}
      </div>
    </div>
  );
}
