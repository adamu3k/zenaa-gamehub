import { Eye, EyeOff, X } from 'lucide-react';
import { type InputHTMLAttributes, useEffect, useState, type ReactNode } from 'react';

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, full }: { label: string; hint?: ReactNode; children: ReactNode; full?: boolean }) {
  return (
    <div className={`field ${full ? 'full' : ''}`}>
      <label>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function StatCard({ label, value, sub, icon }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="card stat">
      <span className="stat-label">
        {icon}
        {label}
      </span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="error-box">{error instanceof Error ? error.message : String(error)}</div>;
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button type="button" key={o.value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const STATUS: Record<string, [string, string]> = {
  available: ['Available', 'badge-success'],
  in_use: ['In use', 'badge-primary'],
  paused: ['Paused', 'badge-warning'],
  maintenance: ['Maintenance', 'badge-info'],
  offline: ['Offline', 'badge-danger'],
  archived: ['Archived', ''],
  active: ['Active', 'badge-success'],
  suspended: ['Suspended', 'badge-danger'],
  running: ['Running', 'badge-primary'],
  ended: ['Ended', ''],
  pending: ['Awaiting confirmation', 'badge-warning'],
  confirmed: ['Confirmed', 'badge-primary'],
  checked_in: ['Checked in', 'badge-success'],
  completed: ['Completed', ''],
  cancelled: ['Cancelled', 'badge-danger'],
  no_show: ['No-show', 'badge-danger'],
  success: ['Paid', 'badge-success'],
  failed: ['Failed', 'badge-danger'],
  expired: ['Expired', ''],
  staff_use: ['Staff use · free', 'badge-info'],
};
export function StatusBadge({ status }: { status: string }) {
  const [label, cls] = STATUS[status] ?? [status, ''];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="toolbar">
      <div>
        <h1>{title}</h1>
        {subtitle && <div className="muted">{subtitle}</div>}
      </div>
      <div className="spacer" />
      {actions}
    </div>
  );
}

/** Password box with an eye button to show or hide what was typed. */
export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [show, setShow] = useState(false);
  const { className, style, ...rest } = props;
  return (
    <span className="pw-wrap" style={style}>
      <input {...rest} className={className ?? 'input'} type={show ? 'text' : 'password'} />
      <button
        type="button"
        className="pw-eye"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? 'Hide password' : 'Show password'}
        title={show ? 'Hide' : 'Show'}
        tabIndex={-1}
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </span>
  );
}
