import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowUpFromLine, LockKeyhole, Printer, Unlock } from 'lucide-react';
import { useState } from 'react';
import { KIND_LABEL, MoneyInput } from '../components/money';
import { ErrorBox, Field, Modal, PageHeader, StatCard } from '../components/ui';
import { get, post } from '../lib/api';
import { useApp } from '../lib/app-context';
import { formatDateTime, formatTime, METHOD_LABEL, parseMoney } from '../lib/format';

export function useCurrentShift() {
  return useQuery({ queryKey: ['shift', 'current'], queryFn: () => get('/api/shifts/current').then((r) => r.shift), refetchInterval: 60_000 });
}

export function ShiftsPage() {
  const { can } = useApp();
  const cur = useCurrentShift();
  const [viewing, setViewing] = useState<string | null>(null);
  return (
    <>
      <PageHeader title="Shifts & cash drawer" subtitle="Open a shift with your float, take payments, then count the drawer to close." />
      {cur.isLoading ? <div className="muted">Loading…</div> : cur.data ? <OpenShiftCard shift={cur.data} onView={() => setViewing(cur.data.id)} /> : <OpenShiftForm />}
      {can('shifts.manage') && <ShiftList onView={setViewing} />}
      {viewing && <ShiftDetail id={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

function OpenShiftForm() {
  const { settings, toast } = useApp();
  const qc = useQueryClient();
  const [float, setFloat] = useState('');
  const parsed = float.trim() ? parseMoney(float, settings.currencyMinorUnits) : 0;
  const m = useMutation({
    mutationFn: () => post('/api/shifts/open', { openingFloat: parsed }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shift'] });
      qc.invalidateQueries({ queryKey: ['shifts'] });
      toast('success', 'Shift opened');
    },
  });
  return (
    <div className="card card-pad" style={{ maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <h2>
        <Unlock size={18} style={{ verticalAlign: -3 }} /> Open my shift
      </h2>
      <div className="muted">Count the cash in the drawer before you start. Every payment you take is attached to your shift.</div>
      <ErrorBox error={m.error} />
      <Field label={`Opening float (${settings.currencyCode})`} hint="Cash in the drawer right now">
        <MoneyInput value={float} onChange={setFloat} placeholder="0" autoFocus />
      </Field>
      <div>
        <button className="btn btn-primary" disabled={parsed == null || parsed < 0 || m.isPending} onClick={() => m.mutate()}>
          Open shift
        </button>
      </div>
    </div>
  );
}

function OpenShiftCard({ shift, onView }: { shift: any; onView(): void }) {
  const { money, can } = useApp();
  const [closing, setClosing] = useState(false);
  const [movement, setMovement] = useState<'in' | 'out' | null>(null);
  const s = shift.summary;
  return (
    <>
      <div className="grid stats">
        <StatCard label="Expected cash in drawer" value={money(shift.expectedCash)} sub={`Float ${money(shift.openingFloat)} + cash ${money(s.byMethod.cash)}`} />
        <StatCard label="Sales this shift" value={money(s.sales)} sub={`${s.transactions} transactions`} />
        <StatCard label="Refunds" value={money(s.refunds)} sub={`Net ${money(s.netRevenue)}`} />
        <StatCard label="Opened" value={formatTime(shift.openedAt)} sub={formatDateTime(shift.openedAt)} />
      </div>
      <div className="card">
        <div className="card-head">
          <h2>By payment method</h2>
          <div className="toolbar">
            {(
              <>
                <button className="btn btn-sm" onClick={() => setMovement('in')}>
                  <ArrowDownToLine size={14} /> Cash in
                </button>
                <button className="btn btn-sm" onClick={() => setMovement('out')}>
                  <ArrowUpFromLine size={14} /> Cash out
                </button>
              </>
            )}
            <button className="btn btn-sm" onClick={onView}>
              Transactions
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => setClosing(true)}>
              <LockKeyhole size={14} /> Count & close
            </button>
          </div>
        </div>
        <MethodTable summary={s} />
      </div>
      {closing && <CloseShiftModal shift={shift} onClose={() => setClosing(false)} />}
      {movement && <CashMovementModal direction={movement} onClose={() => setMovement(null)} />}
    </>
  );
}

function MethodTable({ summary }: { summary: any }) {
  const { money } = useApp();
  return (
    <div className="list">
      {Object.entries(summary.byMethod as Record<string, number>).map(([k, v]) => (
        <div className="list-item" key={k}>
          <span>{METHOD_LABEL[k] ?? k}</span>
          <span className="num">{money(v)}</span>
        </div>
      ))}
    </div>
  );
}

/** Notes and coins per currency, for counting the drawer. */
export const DENOMINATIONS: Record<string, number[]> = {
  GHS: [200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1],
  NGN: [1000, 500, 200, 100, 50, 20, 10, 5],
  KES: [1000, 500, 200, 100, 50, 40, 20, 10, 5, 1],
  UGX: [50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100],
  TZS: [10000, 5000, 2000, 1000, 500, 200, 100],
  ZAR: [200, 100, 50, 20, 10, 5, 2, 1, 0.5],
  XOF: [10000, 5000, 2000, 1000, 500, 200, 100, 50, 25],
  XAF: [10000, 5000, 2000, 1000, 500, 100, 50, 25],
  USD: [100, 50, 20, 10, 5, 2, 1, 0.25, 0.1, 0.05, 0.01],
};

const digits = (v: string) => v.replace(/[^0-9]/g, '');

function CloseShiftModal({ shift, onClose }: { shift: any; onClose(): void }) {
  const { settings, money, toast } = useApp();
  const qc = useQueryClient();
  const denoms = DENOMINATIONS[settings.currencyCode] ?? [];
  const [mode, setMode] = useState<'count' | 'total'>(denoms.length ? 'count' : 'total');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [counted, setCounted] = useState('');
  const [momo, setMomo] = useState('');
  const [notes, setNotes] = useState('');
  const mu = settings.currencyMinorUnits;
  const fromCounts = denoms.reduce((a, d) => a + Math.round(d * 10 ** mu) * (parseInt(counts[String(d)] || '0', 10) || 0), 0);
  const parsed = mode === 'count' ? fromCounts : parseMoney(counted, mu);
  const momoParsed = momo.trim() ? parseMoney(momo, mu) : null;
  const blind = settings.blindShiftClose;
  const variance = parsed != null ? parsed - shift.expectedCash : null;
  const expectedMomo = shift.summary?.expectedMomo ?? shift.summary?.byMethod?.mobile_money ?? 0;
  const momoVariance = momoParsed != null ? momoParsed - expectedMomo : null;
  const [done, setDone] = useState<any>(null);
  const m = useMutation({
    mutationFn: () =>
      post(`/api/shifts/${shift.id}/close`, {
        countedCash: parsed,
        countedBreakdown:
          mode === 'count'
            ? Object.fromEntries(
                Object.entries(counts)
                  .filter(([, v]) => parseInt(v, 10) > 0)
                  .map(([k, v]) => [k, parseInt(v, 10)]),
              )
            : null,
        countedMomo: momoParsed,
        notes: notes || null,
      }),
    onSuccess: (r: any) => {
      toast(r.variance === 0 ? 'success' : 'warning', r.variance === 0 ? 'Shift closed — drawer balances' : `Shift closed — ${r.variance > 0 ? 'over' : 'short'} by ${money(Math.abs(r.variance))}`);
      setDone(r);
    },
  });
  const finish = () => {
    qc.invalidateQueries({ queryKey: ['shift'] });
    qc.invalidateQueries({ queryKey: ['shifts'] });
    onClose();
  };
  const diff = (v: number | null) => (v == null ? '—' : v === 0 ? 'Balanced' : `${v > 0 ? 'Over' : 'Short'} ${money(Math.abs(v))}`);
  if (done)
    return (
      <Modal
        title="Shift closed"
        onClose={finish}
        footer={
          <>
            <button className="btn" onClick={() => window.open(`/receipt/shift/${shift.id}`, '_blank', 'width=420,height=720')}>
              <Printer size={16} /> Print Z-report
            </button>
            <button className="btn btn-primary" onClick={finish}>
              Done
            </button>
          </>
        }
      >
        <dl className="kv">
          <dt>Cash expected</dt>
          <dd>{money(done.expectedCash)}</dd>
          <dt>Cash counted</dt>
          <dd>{money(done.countedCash)}</dd>
          <dt>Cash difference</dt>
          <dd style={{ color: done.variance ? 'var(--danger)' : 'var(--success)', fontWeight: 700 }}>{diff(done.variance)}</dd>
          {done.countedMomo != null && (
            <>
              <dt>MoMo expected</dt>
              <dd>{money(expectedMomo)}</dd>
              <dt>MoMo received</dt>
              <dd>{money(done.countedMomo)}</dd>
              <dt>MoMo difference</dt>
              <dd style={{ color: done.momoVariance ? 'var(--danger)' : 'var(--success)', fontWeight: 700 }}>{diff(done.momoVariance)}</dd>
            </>
          )}
        </dl>
      </Modal>
    );
  return (
    <Modal
      title="Count the drawer & close shift"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={parsed == null || parsed < 0 || m.isPending || (!blind && variance !== 0 && !notes.trim())} onClick={() => m.mutate()}>
            <LockKeyhole size={16} /> Close shift
          </button>
        </>
      }
    >
      <ErrorBox error={m.error} />
      {denoms.length > 0 && (
        <div className="toolbar" style={{ marginBottom: 10 }}>
          <button className={`btn btn-sm ${mode === 'count' ? 'btn-primary' : ''}`} onClick={() => setMode('count')}>
            Count notes & coins
          </button>
          <button className={`btn btn-sm ${mode === 'total' ? 'btn-primary' : ''}`} onClick={() => setMode('total')}>
            Type the total
          </button>
        </div>
      )}
      {mode === 'count' ? (
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
          {denoms.map((d) => (
            <Field key={d} label={`${settings.currencyCode} ${d} ×`}>
              <input className="input mono" inputMode="numeric" placeholder="0" value={counts[String(d)] ?? ''} onChange={(e) => setCounts({ ...counts, [String(d)]: digits(e.target.value) })} />
            </Field>
          ))}
        </div>
      ) : (
        <Field label={`Cash counted (${settings.currencyCode})`}>
          <MoneyInput value={counted} onChange={setCounted} autoFocus />
        </Field>
      )}
      <Field label={`MoMo received this shift (${settings.currencyCode}) — optional`} hint="From the venue MoMo phone or statement. Leave empty to skip the MoMo check.">
        <MoneyInput value={momo} onChange={setMomo} />
      </Field>
      <dl className="kv">
        <dt>Cash counted</dt>
        <dd>{parsed != null ? money(parsed) : '—'}</dd>
        {blind ? (
          <>
            <dt>Expected</dt>
            <dd className="dim">Shown after you close (blind count)</dd>
          </>
        ) : (
          <>
            <dt>Cash expected</dt>
            <dd>{money(shift.expectedCash)}</dd>
            <dt>Cash difference</dt>
            <dd style={{ color: variance == null || variance === 0 ? undefined : 'var(--danger)', fontWeight: 700 }}>{diff(variance)}</dd>
            {momoParsed != null && (
              <>
                <dt>MoMo expected</dt>
                <dd>{money(expectedMomo)}</dd>
                <dt>MoMo difference</dt>
                <dd style={{ color: momoVariance ? 'var(--danger)' : undefined, fontWeight: 700 }}>{diff(momoVariance)}</dd>
              </>
            )}
          </>
        )}
      </dl>
      <Field label="Notes / handover" hint={!blind && variance ? 'Required when the drawer does not balance' : 'e.g. who takes over, anything the next person should know'}>
        <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
    </Modal>
  );
}

function CashMovementModal({ direction, onClose }: { direction: 'in' | 'out'; onClose(): void }) {
  const { settings, money, toast } = useApp();
  const qc = useQueryClient();
  const cats = useQuery({ queryKey: ['finance', 'categories'], queryFn: () => get<any>('/api/finance/categories'), staleTime: Infinity });
  const options = Object.entries((cats.data?.[direction] ?? {}) as Record<string, string>);
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState(direction === 'out' ? 'supplies' : 'float');
  const [reason, setReason] = useState('');
  const parsed = parseMoney(amount, settings.currencyMinorUnits);
  const m = useMutation({
    mutationFn: () => post('/api/shifts/cash-movement', { direction, amount: parsed, category, reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shift'] });
      toast('success', `Cash ${direction} recorded: ${money(parsed)}`);
      onClose();
    },
  });
  return (
    <Modal
      title={direction === 'in' ? 'Cash into drawer' : 'Cash out of drawer (expense / payout)'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!parsed || parsed <= 0 || reason.trim().length < 3 || m.isPending} onClick={() => m.mutate()}>
            Record
          </button>
        </>
      }
    >
      <ErrorBox error={m.error} />
      <Field label={`Amount (${settings.currencyCode})`}>
        <MoneyInput value={amount} onChange={setAmount} autoFocus />
      </Field>
      <Field label="What for">
        <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
          {options.map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Details" hint="A manager may need to approve with their PIN">
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={direction === 'in' ? 'e.g. Extra change from the bank' : 'e.g. 2 crates of water'} />
      </Field>
    </Modal>
  );
}

function ShiftList({ onView }: { onView(id: string): void }) {
  const { money } = useApp();
  const q = useQuery({ queryKey: ['shifts'], queryFn: () => get('/api/shifts?limit=100') });
  return (
    <div className="card">
      <div className="card-head">
        <h2>All shifts</h2>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Staff</th>
              <th>Opened</th>
              <th>Closed</th>
              <th className="right">Sales</th>
              <th className="right">Expected cash</th>
              <th className="right">Counted</th>
              <th className="right">Difference</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No shifts yet
                </td>
              </tr>
            )}
            {(q.data ?? []).map((s: any) => (
              <tr key={s.id} className="clickable" onClick={() => onView(s.id)}>
                <td>{s.staffName}</td>
                <td>{formatDateTime(s.openedAt)}</td>
                <td>{s.closedAt ? formatDateTime(s.closedAt) : <span className="badge badge-success">Open</span>}</td>
                <td className="right num">{money(s.summary?.sales ?? 0)}</td>
                <td className="right num">{money(s.expectedCash)}</td>
                <td className="right num">{s.countedCash != null ? money(s.countedCash) : '—'}</td>
                <td className="right num" style={{ color: s.variance ? 'var(--danger)' : undefined }}>
                  {s.variance == null ? '—' : s.variance === 0 ? '✓' : money(s.variance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ShiftDetail({ id, onClose }: { id: string; onClose(): void }) {
  const { money } = useApp();
  const q = useQuery({ queryKey: ['shifts', id], queryFn: () => get(`/api/shifts/${id}`) });
  const s = q.data;
  return (
    <Modal
      wide
      title={s ? `Shift — ${s.staffName}` : 'Shift'}
      onClose={onClose}
      footer={
        s?.closedAt && (
          <button className="btn" onClick={() => window.open(`/receipt/shift/${id}`, '_blank', 'width=420,height=720')}>
            <Printer size={16} /> Print Z-report
          </button>
        )
      }
    >
      <ErrorBox error={q.error} />
      {s && (
        <>
          <dl className="kv">
            <dt>Opened</dt>
            <dd>{formatDateTime(s.openedAt)}</dd>
            <dt>Closed</dt>
            <dd>{s.closedAt ? `${formatDateTime(s.closedAt)} by ${s.closedByName}` : 'Still open'}</dd>
            <dt>Opening float</dt>
            <dd>{money(s.openingFloat)}</dd>
            <dt>Expected cash</dt>
            <dd>{money(s.expectedCash)}</dd>
            {s.countedCash != null && (
              <>
                <dt>Counted</dt>
                <dd>{money(s.countedCash)}</dd>
                <dt>Difference</dt>
                <dd style={{ color: s.variance ? 'var(--danger)' : undefined }}>{money(s.variance)}</dd>
              </>
            )}
            {s.notes && (
              <>
                <dt>Notes</dt>
                <dd style={{ whiteSpace: 'pre-wrap' }}>{s.notes}</dd>
              </>
            )}
          </dl>
          {s.summary && <MethodTable summary={s.summary} />}
          <h3>Transactions</h3>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Time</th>
                  <th>Type</th>
                  <th>Method</th>
                  <th>Customer / note</th>
                  <th className="right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {s.payments.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      No transactions
                    </td>
                  </tr>
                )}
                {s.payments.map((p: any) => (
                  <tr key={p.id}>
                    <td className="mono dim">{p.number}</td>
                    <td>{formatTime(p.createdAt)}</td>
                    <td>{KIND_LABEL[p.kind] ?? p.kind}</td>
                    <td>{METHOD_LABEL[p.method]}</td>
                    <td className="dim">{p.customerName ?? p.note ?? ''}</td>
                    <td className="right num" style={{ color: p.amount < 0 ? 'var(--danger)' : undefined }}>
                      {money(p.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}
