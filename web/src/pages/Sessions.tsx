import { useQuery } from '@tanstack/react-query';
import { Undo2 } from 'lucide-react';
import { useState } from 'react';
import { KIND_LABEL, ReceiptButton, RefundModal, SettleModal } from '../components/money';
import { TimeCalculatorButton } from '../components/TimeCalculator';
import { Modal, PageHeader, StatusBadge } from '../components/ui';
import { get } from '../lib/api';
import { useApp } from '../lib/app-context';
import { formatDateTime, formatDuration, formatTime, METHOD_LABEL } from '../lib/format';

const EVENT_LABEL: Record<string, string> = {
  start: 'Started',
  pause: 'Paused',
  resume: 'Resumed',
  extend: 'Extended',
  end: 'Ended',
  warning: 'Low-time warning',
  system_pause: 'Paused by system (server outage)',
  payment: 'Payment received (tab)',
  refund: 'Refunded',
  reduce: 'Time taken off',
};

export function SessionsPage() {
  const { money } = useApp();
  const today = new Date().toISOString().slice(0, 10);
  const [day, setDay] = useState(today);
  const [open, setOpen] = useState<string | null>(null);
  const from = new Date(`${day}T00:00:00`);
  const to = new Date(from.getTime() + 86_400_000);
  const q = useQuery({
    queryKey: ['sessions', day],
    queryFn: () => get(`/api/sessions?limit=500&from=${from.toISOString()}&to=${to.toISOString()}`),
  });
  const rows = q.data ?? [];
  const total = rows.reduce((a: number, s: any) => a + s.paidAmount - s.refundedAmount, 0);

  return (
    <>
      <PageHeader
        title="Session history"
        subtitle={`${rows.length} sessions · ${money(total)} collected`}
        actions={
          <>
            <TimeCalculatorButton />
            <input className="input" type="date" style={{ width: 170 }} value={day} max={today} onChange={(e) => setDay(e.target.value)} />
          </>
        }
      />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Station</th>
              <th>Customer</th>
              <th>Plan</th>
              <th>Start</th>
              <th>End</th>
              <th>Played</th>
              <th>Status</th>
              <th className="right">Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="muted">
                  No sessions on this day
                </td>
              </tr>
            )}
            {rows.map((s: any) => (
              <tr key={s.id} className="clickable" onClick={() => setOpen(s.id)}>
                <td className="mono dim">{s.number}</td>
                <td>{s.stationName}</td>
                <td>{s.customerName ?? <span className="dim">Walk-in</span>}</td>
                <td>
                  {s.rate.planName} <span className="dim">({s.billingType})</span>
                </td>
                <td>{formatTime(s.startedAt)}</td>
                <td>{formatTime(s.endedAt)}</td>
                <td className="mono">{formatDuration(s.activeSeconds)}</td>
                <td>
                  <StatusBadge status={s.status} />
                  {s.onTab && <span className="badge badge-warning" style={{ marginLeft: 4 }}>Tab</span>}
                  {s.refundedAmount > 0 && <span className="badge badge-danger" style={{ marginLeft: 4 }}>Refunded</span>}
                </td>
                <td className="right num">{money(s.status === 'ended' ? s.netAmount : s.liveNetAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && <SessionDetail id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function SessionDetail({ id, onClose }: { id: string; onClose(): void }) {
  const { money, can } = useApp();
  const q = useQuery({ queryKey: ['session', id], queryFn: () => get(`/api/sessions/${id}`) });
  const s = q.data;
  const [refunding, setRefunding] = useState(false);
  const [settling, setSettling] = useState(false);
  const owed = s && s.status === 'ended' ? s.netAmount - s.paidAmount : 0;
  return (
    <Modal
      wide
      title={s ? `Session #${s.number}` : 'Session'}
      onClose={onClose}
      footer={
        s && (
          <>
            <ReceiptButton type="session" id={s.id} />
            {owed > 0 && can('sessions.operate') && (
              <button className="btn btn-primary" onClick={() => setSettling(true)}>
                Receive {money(owed)}
              </button>
            )}
            {s.status === 'ended' && s.refundable > 0 && can('payments.refund') && (
              <button className="btn btn-danger" onClick={() => setRefunding(true)}>
                <Undo2 size={16} /> Refund / void
              </button>
            )}
          </>
        )
      }
    >
      {s && (
        <>
          <dl className="kv">
            <dt>Plan</dt>
            <dd>
              {s.rate.planName} · {money(s.rate.ratePerHour)}/h
            </dd>
            <dt>Billing</dt>
            <dd>{s.billingType}</dd>
            <dt>Played</dt>
            <dd className="mono">{formatDuration(s.activeSeconds)}</dd>
            <dt>Billed minutes</dt>
            <dd>{s.billedMinutes}</dd>
            <dt>Gross</dt>
            <dd>{money(s.status === 'ended' ? s.grossAmount : s.liveGrossAmount)}</dd>
            {s.discountAmount - s.promoDiscount - s.manualDiscount > 0 && (
              <>
                <dt>
                  {s.happyHourId ? 'Happy hour' : 'Member discount'} ({s.discountPercent}%)
                </dt>
                <dd>−{money(s.discountAmount - s.promoDiscount - s.manualDiscount)}</dd>
              </>
            )}
            {s.promoDiscount > 0 && (
              <>
                <dt>Promo code</dt>
                <dd>−{money(s.promoDiscount)}</dd>
              </>
            )}
            {s.manualDiscount > 0 && (
              <>
                <dt>Manual discount</dt>
                <dd>−{money(s.manualDiscount)}</dd>
              </>
            )}
            <dt>Net</dt>
            <dd style={{ fontWeight: 700 }}>{money(s.status === 'ended' ? s.netAmount : s.liveNetAmount)}</dd>
            <dt>Paid</dt>
            <dd>{money(s.paidAmount)}</dd>
            {s.refundedAmount > 0 && (
              <>
                <dt>Refunded</dt>
                <dd style={{ color: 'var(--danger)' }}>−{money(s.refundedAmount)}</dd>
              </>
            )}
            {owed > 0 && (
              <>
                <dt>Owed (tab)</dt>
                <dd style={{ color: 'var(--warning)', fontWeight: 700 }}>{money(owed)}</dd>
              </>
            )}
            {s.unused?.unusedMinutes > 0 && (
              <>
                <dt>Unused prepaid time</dt>
                <dd>
                  {s.unused.unusedMinutes} min · {money(s.unused.amount)}
                </dd>
              </>
            )}
            <dt>End reason</dt>
            <dd>{s.endReason?.replace(/_/g, ' ') ?? '—'}</dd>
          </dl>
          <h3>Payments</h3>
          <div className="card list">
            {s.payments.length === 0 && <div className="list-item muted">No payments</div>}
            {s.payments.map((p: any) => (
              <div className="list-item" key={p.id}>
                <span>
                  {KIND_LABEL[p.kind] ?? p.kind} · {METHOD_LABEL[p.method]}
                  {p.reference ? <span className="dim"> · {p.reference}</span> : ''}
                  {p.kind === 'refund' && p.note ? <span className="dim"> · {p.note}</span> : ''}
                </span>
                <span className="dim">
                  <span className="num" style={{ color: p.amount < 0 ? 'var(--danger)' : 'var(--text)' }}>
                    {money(p.amount)}
                  </span>{' '}
                  · {formatTime(p.createdAt)} · {p.staffName}
                </span>
              </div>
            ))}
          </div>
          <h3>Timeline</h3>
          <div className="card list">
            {s.events.map((e: any) => (
              <div className="list-item" key={e.id}>
                <span>
                  {EVENT_LABEL[e.type] ?? e.type}
                  {e.secondsAdded ? ` · +${Math.round(e.secondsAdded / 60)} min` : ''}
                  {e.amount ? ` · ${money(e.amount)}` : ''}
                </span>
                <span className="dim">
                  {formatDateTime(e.at)} · {e.staffName ?? 'System'}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      {refunding && s && <RefundModal session={s} onClose={() => setRefunding(false)} />}
      {settling && s && <SettleModal session={s} onClose={() => setSettling(false)} />}
    </Modal>
  );
}
