import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { KIND_LABEL, METHODS, MoneyInput, openReceipt, SettleModal } from '../components/money';
import { ErrorBox, Field, Modal, PageHeader, Segmented, StatCard } from '../components/ui';
import { get, post } from '../lib/api';
import { useApp } from '../lib/app-context';
import { formatDateTime, formatTime, METHOD_LABEL, parseMoney, toMajorString } from '../lib/format';

export function PaymentsPage() {
  const { can } = useApp();
  const views = [
    ...(can('reports.view') ? [{ value: 'transactions' as const, label: 'Transactions' }] : []),
    ...(can('customers.view') ? [{ value: 'tabs' as const, label: 'Tabs (pay later)' }] : []),
  ];
  const [view, setView] = useState<'transactions' | 'tabs'>(views[0]?.value ?? 'tabs');
  return (
    <>
      <PageHeader title="Payments" subtitle="Every money movement, refunds, and customers who owe" actions={views.length > 1 && <Segmented value={view} onChange={setView} options={views} />} />
      {view === 'transactions' ? <Transactions /> : <Tabs />}
    </>
  );
}

function Transactions() {
  const { money, can } = useApp();
  const today = new Date().toISOString().slice(0, 10);
  const [day, setDay] = useState(today);
  const [kind, setKind] = useState('');
  const [refunding, setRefunding] = useState<any>(null);
  const from = new Date(`${day}T00:00:00`);
  const to = new Date(from.getTime() + 86_400_000);
  const q = useQuery({
    queryKey: ['payments', day, kind],
    queryFn: () => get(`/api/payments?limit=1000&from=${from.toISOString()}&to=${to.toISOString()}${kind ? `&kind=${kind}` : ''}`),
  });
  const rows: any[] = q.data ?? [];
  const sum = (f: (p: any) => boolean) => rows.filter(f).reduce((a, p) => a + p.amount, 0);
  const revenue = sum((p) => ['session', 'extension', 'sale', 'refund'].includes(p.kind));
  const refunds = -sum((p) => p.kind === 'refund');
  const deposits = sum((p) => p.kind === 'deposit' || p.kind === 'withdrawal');

  return (
    <>
      <div className="grid stats">
        <StatCard label="Net revenue" value={money(revenue)} sub="sales minus refunds" />
        <StatCard label="Refunds" value={money(refunds)} />
        <StatCard label="Wallet top-ups (net)" value={money(deposits)} sub="not revenue — customer credit" />
        <StatCard label="Transactions" value={rows.length} />
      </div>
      <div className="card">
        <div className="card-head">
          <div className="toolbar">
            <input className="input" type="date" style={{ width: 170 }} value={day} max={today} onChange={(e) => setDay(e.target.value)} />
            <select className="select" style={{ width: 190 }} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">All types</option>
              <option value="session,extension,sale">Sales</option>
              <option value="refund">Refunds</option>
              <option value="deposit,withdrawal">Wallet top-ups / withdrawals</option>
              <option value="cash_in,cash_out">Cash in / out</option>
            </select>
          </div>
        </div>
        <ErrorBox error={q.error} />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Time</th>
                <th>Type</th>
                <th>Method</th>
                <th>Customer</th>
                <th>Staff</th>
                <th>Reference / note</th>
                <th className="right">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="muted">
                    No transactions
                  </td>
                </tr>
              )}
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="mono dim">{p.number}</td>
                  <td>{formatTime(p.createdAt)}</td>
                  <td>{KIND_LABEL[p.kind] ?? p.kind}</td>
                  <td>{METHOD_LABEL[p.method]}</td>
                  <td>{p.customerName ?? <span className="dim">Walk-in</span>}</td>
                  <td>{p.staffName}</td>
                  <td className="dim" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[p.reference, p.note].filter(Boolean).join(' · ')}
                  </td>
                  <td className="right num" style={{ color: p.amount < 0 ? 'var(--danger)' : undefined }}>
                    {money(p.amount)}
                    {p.refundable > 0 && p.refundable < p.amount && <div className="dim" style={{ fontSize: 11 }}>{money(p.amount - p.refundable)} refunded</div>}
                  </td>
                  <td className="right" style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn btn-ghost btn-icon btn-sm" title="Receipt" onClick={() => (p.sessionId ? openReceipt('session', p.sessionId) : openReceipt('payment', p.id))}>
                      <Printer size={14} />
                    </button>
                    {can('payments.refund') && p.refundable > 0 && (
                      <button className="btn btn-ghost btn-icon btn-sm" title="Refund" onClick={() => setRefunding(p)}>
                        <Undo2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {refunding && <PaymentRefundModal payment={refunding} onClose={() => setRefunding(null)} />}
    </>
  );
}

function PaymentRefundModal({ payment, onClose }: { payment: any; onClose(): void }) {
  const { settings, money, toast } = useApp();
  const qc = useQueryClient();
  const mu = settings.currencyMinorUnits;
  const [amount, setAmount] = useState(toMajorString(payment.refundable, mu));
  const [method, setMethod] = useState(payment.method === 'paystack' ? 'mobile_money' : payment.method);
  const [reason, setReason] = useState('');
  const parsed = parseMoney(amount, mu);
  const m = useMutation({
    mutationFn: () => post(`/api/payments/${payment.id}/refund`, { amount: parsed, method, reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['shift'] });
      toast('success', `Refunded ${money(parsed)}`);
      onClose();
    },
  });
  return (
    <Modal
      title={`Refund payment #${payment.number}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-danger" disabled={!parsed || parsed <= 0 || parsed > payment.refundable || reason.trim().length < 3 || m.isPending} onClick={() => m.mutate()}>
            Refund {parsed ? money(parsed) : ''}
          </button>
        </>
      }
    >
      <ErrorBox error={m.error} />
      <div className="muted">
        {KIND_LABEL[payment.kind]} · {METHOD_LABEL[payment.method]} · {money(payment.amount)} · refundable {money(payment.refundable)}
      </div>
      <Field label={`Amount (${settings.currencyCode})`}>
        <MoneyInput value={amount} onChange={setAmount} autoFocus />
      </Field>
      <Field label="Give back by" hint={payment.method === 'wallet' ? 'Paid from the wallet — goes back to the wallet.' : undefined}>
        <select className="select" value={method} disabled={payment.method === 'wallet'} onChange={(e) => setMethod(e.target.value)}>
          {METHODS.filter((x) => x !== 'wallet' || payment.customerId).map((x) => (
            <option key={x} value={x}>
              {METHOD_LABEL[x]}
              {x === 'wallet' && payment.method !== 'wallet' ? ' (store credit)' : ''}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Reason (required)">
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  );
}

function Tabs() {
  const { money, can } = useApp();
  const q = useQuery({ queryKey: ['tabs'], queryFn: () => get('/api/tabs') });
  const [settling, setSettling] = useState<any>(null);
  const d = q.data;
  return (
    <>
      <div className="grid stats">
        <StatCard label="Owed to the centre" value={money(d?.total ?? 0)} sub={`${d?.customers.length ?? 0} customers`} />
      </div>
      <ErrorBox error={q.error} />
      {d?.customers.length === 0 && <div className="card card-pad muted">No open tabs — everyone has paid.</div>}
      {d?.customers.map((c: any) => (
        <div className="card" key={c.customerId ?? 'walk-in'}>
          <div className="card-head">
            <div>
              <h2>
                {c.customerName} {c.customerCode && <span className="dim mono">{c.customerCode}</span>}
              </h2>
              <div className="dim" style={{ fontSize: 12 }}>
                {c.phone ?? 'No phone'} · credit limit {money(c.creditLimit)}
              </div>
            </div>
            <span className="badge badge-warning">Owes {money(c.owed)}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Station</th>
                  <th>Ended</th>
                  <th className="right">Bill</th>
                  <th className="right">Paid</th>
                  <th className="right">Owed</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {c.sessions.map((s: any) => (
                  <tr key={s.id}>
                    <td className="mono dim">#{s.number}</td>
                    <td>{s.stationName}</td>
                    <td>{formatDateTime(s.endedAt)}</td>
                    <td className="right num">{money(s.netAmount)}</td>
                    <td className="right num">{money(s.paidAmount)}</td>
                    <td className="right num" style={{ fontWeight: 700 }}>
                      {money(s.netAmount - s.paidAmount)}
                    </td>
                    <td className="right">
                      {can('sessions.operate') && (
                        <button className="btn btn-primary btn-sm" onClick={() => setSettling(s)}>
                          Receive payment
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      {settling && <SettleModal session={settling} onClose={() => setSettling(null)} />}
    </>
  );
}
