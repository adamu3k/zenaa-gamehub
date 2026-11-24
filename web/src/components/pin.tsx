import { Delete, KeyRound, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { post, setPinPrompt } from '../lib/api';
import { useApp } from '../lib/app-context';
import { ErrorBox, Field, Modal, PasswordInput } from './ui';

/** Big-button PIN pad. */
export function PinPad({ value, onChange, onEnter }: { value: string; onChange(v: string): void; onEnter?(): void }) {
  const press = (d: string) => value.length < 8 && onChange(value + d);
  return (
    <div className="pin-pad">
      <div className="pin-dots" aria-label="PIN">
        {value.length ? '●'.repeat(value.length) : <span className="dim">Type the PIN</span>}
      </div>
      <div className="pin-keys">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" className="btn pin-key" onClick={() => press(d)}>
            {d}
          </button>
        ))}
        <button type="button" className="btn btn-ghost pin-key" onClick={() => onChange('')} aria-label="Clear">
          C
        </button>
        <button type="button" className="btn pin-key" onClick={() => press('0')}>
          0
        </button>
        <button type="button" className="btn btn-ghost pin-key" onClick={() => onChange(value.slice(0, -1))} aria-label="Delete">
          <Delete size={18} />
        </button>
      </div>
      {onEnter && <input className="sr-only" aria-hidden tabIndex={-1} />}
    </div>
  );
}

/**
 * Mounted once: answers the API client's "PIN needed" requests with a PIN pad.
 * Works for every money action (cash out, refunds, discounts, withdrawals, staff unlock…).
 */
export function PinPromptHost() {
  const [req, setReq] = useState<{ message: string; error?: string; resolve(v: string | null): void } | null>(null);
  const [pin, setPin] = useState('');
  const resolver = useRef<((v: string | null) => void) | null>(null);
  useEffect(() => {
    setPinPrompt(
      (message, error) =>
        new Promise((resolve) => {
          resolver.current = resolve;
          setPin('');
          setReq({ message, error, resolve });
        }),
    );
    return () => {
      setPinPrompt(null);
    };
  }, []);
  useEffect(() => {
    if (!req) return;
    const h = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) setPin((p) => (p.length < 8 ? p + e.key : p));
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
      else if (e.key === 'Enter') done(pinRef.current);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });
  const pinRef = useRef(pin);
  pinRef.current = pin;
  const done = (v: string | null) => {
    if (v !== null && v.length < 4) return;
    resolver.current?.(v);
    resolver.current = null;
    setReq(null);
  };
  if (!req) return null;
  return (
    <Modal
      title={
        <>
          <ShieldCheck size={18} style={{ verticalAlign: -3 }} /> Staff PIN
        </>
      }
      onClose={() => done(null)}
      footer={
        <>
          <button className="btn btn-ghost" onClick={() => done(null)}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={pin.length < 4} onClick={() => done(pin)}>
            Approve
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>{req.message}</p>
      {req.error && <div className="alert alert-danger">{req.error}</div>}
      <PinPad value={pin} onChange={setPin} onEnter={() => done(pin)} />
    </Modal>
  );
}

/** "My PIN": set or change your own PIN (needs your password). */
export function MyPinModal({ onClose }: { onClose(): void }) {
  const { toast, refreshMe } = useApp();
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (pin !== pin2) return setError(new Error('The two PINs are different'));
    setBusy(true);
    try {
      await post('/api/auth/pin', { password, pin });
      toast('success', 'PIN saved — use it to approve actions and unlock station screens');
      refreshMe();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={
        <>
          <KeyRound size={18} style={{ verticalAlign: -3 }} /> My staff PIN
        </>
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy || pin.length < 4 || !password} onClick={save}>
            Save PIN
          </button>
        </>
      }
    >
      <p className="dim" style={{ marginTop: 0 }}>
        4–8 digits. Your PIN approves cash in/out, refunds and discounts at the counter, and unlocks the station screens (PC / TV apps, console page). Keep it secret — it
        is recorded as you.
      </p>
      <div className="form-grid">
        <Field label="Your password" full>
          <PasswordInput className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </Field>
        <Field label="New PIN">
          <PasswordInput className="input mono" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} />
        </Field>
        <Field label="Type it again">
          <PasswordInput className="input mono" inputMode="numeric" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, '').slice(0, 8))} />
        </Field>
      </div>
      <ErrorBox error={error} />
    </Modal>
  );
}
