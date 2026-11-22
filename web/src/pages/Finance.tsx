import { useQuery } from '@tanstack/react-query';
import { Download, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ErrorBox, PageHeader, Segmented, StatCard } from '../components/ui';
import { ApiError, get, getToken } from '../lib/api';
import { useApp } from '../lib/app-context';
import { formatDateTime, METHOD_LABEL } from '../lib/format';

type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'last_month' | 'custom';

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function rangeFor(p: Preset, custom: { from: string; to: string }) {
  const today = startOfDay(new Date());
  switch (p) {
    case 'today':
      return { from: today, to: addDays(today, 1) };
    case 'yesterday':
      return { from: addDays(today, -1), to: today };
    case 'week':
      return { from: addDays(today, -((today.getDay() + 6) % 7)), to: addDays(today, 1) };
    case 'month':
      return { from: new Date(today.getFullYear(), today.getMonth(), 1), to: addDays(today, 1) };
    case 'last_month':
      return { from: new Date(today.getFullYear(), today.getMonth() - 1, 1), to: new Date(today.getFullYear(), today.getMonth(), 1) };
    default:
      return { from: new Date(`${custom.from}T00:00`), to: addDays(new Date(`${custom.to}T00:00`), 1) };
  }
}

const EXPENSE_LABEL: Record<string, string> = {
  safe_drop: 'Safe drops',
  bank_deposit: 'Bank / MoMo deposits',
  owner_withdrawal: 'Owner withdrawals',
  supplies: 'Supplies & drinks',
  electricity: 'Electricity',
  internet: 'Internet / data',
  fuel: 'Generator fuel',
  repairs: 'Repairs & controllers',
  salary: 'Wages',
  rent: 'Rent',
  transport: 'Transport',
  other: 'Other',
  float: 'Change float',
  owner: 'Owner put in',
};

export function FinancePage() {
  const { money } = useApp();
  const [preset, setPreset] = useState<Preset>('today');
  const [custom, setCustom] = useState({ from: ymd(addDays(new Date(), -6)), to: ymd(new Date()) });
  const r = useMemo(() => rangeFor(preset, custom), [preset, custom]);
  const qs = `from=${encodeURIComponent(r.from.toISOString())}&to=${encodeURIComponent(r.to.toISOString())}`;
  const q = useQuery({ queryKey: ['payments', 'finance', qs], queryFn: () => get<any>(`/api/finance/summary?${qs}`) });
  const [csvError, setCsvError] = useState<unknown>(null);
  const d = q.data;

  const downloadCsv = async () => {
    setCsvError(null);
    try {
      const res = await fetch(`/api/finance/export.csv?${qs}`, { headers: { authorization: `Bearer ${getToken() ?? ''}` } });
      if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => null))?.message ?? `Download failed (${res.status})`);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await res.blob());
      a.download = `zenaa-payments-${ymd(r.from)}-to-${ymd(addDays(r.to, -1))}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) {
      setCsvError(e);
    }
  };

  const maxDay = Math.max(1, ...(d?.byDay ?? []).map((x: any) => Math.abs(x.revenue)));
  const expenses = Object.entries((d?.expenses ?? {}) as Record<string, number>).sort((a, b) => b[1] - a[1]);

  return (
    <>
      <PageHeader
        title="Finance"
        subtitle="Money in and out, expenses, what customers hold in wallets, and whether every shift's cash and MoMo balanced."
        actions={
          <div className="toolbar no-print">
            <button className="btn btn-sm" onClick={downloadCsv}>
              <Download size={14} /> Export CSV (Excel)
            </button>
            <button className="btn btn-sm" onClick={() => window.print()}>
              <Printer size={14} /> Print
            </button>
          </div>
        }
      />
      <div className="toolbar no-print" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
        <Segmented
          value={preset}
          options={[
            { value: 'today', label: 'Today' },
            { value: 'yesterday', label: 'Yesterday' },
            { value: 'week', label: 'This week' },
            { value: 'month', label: 'This month' },
            { value: 'last_month', label: 'Last month' },
            { value: 'custom', label: 'Dates…' },
          ]}
          onChange={setPreset}
        />
        {preset === 'custom' && (
          <>
            <input type="date" className="input" style={{ width: 160 }} value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            <span className="dim">to</span>
            <input type="date" className="input" style={{ width: 160 }} value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
          </>
        )}
      </div>
      <ErrorBox error={q.error || csvError} />
      {!d ? (
        <div className="muted">Loading…</div>
      ) : (
        <>
          <div className="kpi-grid" style={{ marginBottom: 14 }}>
            <StatCard label="Revenue (games)" value={money(d.revenue.net)} sub={d.revenue.refunds ? `${money(d.revenue.gross)} − refunds ${money(d.revenue.refunds)}` : `${d.sessions.count} sessions`} />
            <StatCard label="Money in" value={money(d.totalIn)} sub="Cash, MoMo, card, transfer (not wallet)" />
            <StatCard label="Expenses & payouts" value={money(d.totalOut)} sub={`Expenses ${money(d.totalExpenses)}`} />
            <StatCard label="Net cash flow" value={money(d.netCashFlow)} sub="Money in − money out" />
            <StatCard label="Wallets: customers hold" value={money(d.wallet.owedToCustomers)} sub={`Top-ups ${money(d.wallet.deposits)} · spent ${money(d.wallet.spent)}`} />
            <StatCard label="Tabs: customers owe you" value={money(d.tabsOwedToVenue)} sub="Pay-later balances (all time)" />
            <StatCard
              label="MoMo top-ups (portal)"
              value={money(d.momo.confirmed?.amount ?? 0)}
              sub={`${d.momo.confirmed?.count ?? 0} confirmed · ${d.momo.pending?.count ?? 0} waiting · ${d.momo.rejected?.count ?? 0} rejected`}
            />
            <StatCard label="Staff unlocks (no charge)" value={d.staffUnlocks} sub="Turned on without a session" />
          </div>

          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
            <div className="card">
              <div className="card-head">
                <h2>By payment method</h2>
              </div>
              <div className="list">
                {Object.keys({ ...d.moneyIn, ...d.moneyOut }).length === 0 && <div className="list-item dim">No money moved in this period.</div>}
                {Object.keys({ ...d.moneyIn, ...d.moneyOut }).map((k) => (
                  <div className="list-item" key={k}>
                    <span>{METHOD_LABEL[k] ?? k}</span>
                    <span className="num">
                      {money(d.moneyIn[k] ?? 0)}
                      {d.moneyOut[k] ? <span className="dim"> − {money(d.moneyOut[k])}</span> : null}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h2>Expenses & cash out</h2>
                <span className="num">{money(d.totalExpenses)}</span>
              </div>
              <div className="list">
                {expenses.length === 0 && <div className="list-item dim">No cash taken out of the drawer.</div>}
                {expenses.map(([k, v]) => (
                  <div className="list-item" key={k}>
                    <span>{EXPENSE_LABEL[k] ?? k}</span>
                    <span className="num">{money(v)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="card-head">
                <h2>By staff member</h2>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Staff</th>
                      <th className="right">Revenue</th>
                      <th className="right">Cash</th>
                      <th className="right">MoMo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.byStaff.map((s: any) => (
                      <tr key={s.staffId ?? 'system'}>
                        <td>{s.name}</td>
                        <td className="right num">{money(s.revenue)}</td>
                        <td className="right num">{money(s.cash)}</td>
                        <td className="right num">{money(s.momo)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-head">
              <h2>Day by day</h2>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Day</th>
                    <th style={{ width: '30%' }}></th>
                    <th className="right">Revenue</th>
                    <th className="right">Cash in</th>
                    <th className="right">MoMo in</th>
                    <th className="right">Card / other</th>
                    <th className="right">Expenses</th>
                  </tr>
                </thead>
                <tbody>
                  {d.byDay.map((x: any) => (
                    <tr key={x.date}>
                      <td>{new Date(`${x.date}T12:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                      <td>
                        <div className="bar">
                          <span style={{ width: `${Math.max(0, (x.revenue / maxDay) * 100)}%` }} />
                        </div>
                      </td>
                      <td className="right num">{money(x.revenue)}</td>
                      <td className="right num">{money(x.cash)}</td>
                      <td className="right num">{money(x.momo)}</td>
                      <td className="right num">{money(x.other)}</td>
                      <td className="right num">{x.expenses ? money(x.expenses) : '—'}</td>
                    </tr>
                  ))}
                  {d.byDay.length === 0 && (
                    <tr>
                      <td colSpan={7} className="dim">
                        Nothing recorded.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-head">
              <h2>Shifts — did the drawer and MoMo balance?</h2>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Staff</th>
                    <th>Opened</th>
                    <th>Closed</th>
                    <th className="right">Cash expected</th>
                    <th className="right">Counted</th>
                    <th className="right">Cash diff.</th>
                    <th className="right">MoMo diff.</th>
                  </tr>
                </thead>
                <tbody>
                  {d.shifts.map((s: any) => (
                    <tr key={s.id}>
                      <td>{s.staffName}</td>
                      <td>{formatDateTime(s.openedAt)}</td>
                      <td>{s.closedAt ? formatDateTime(s.closedAt) : <span className="badge badge-success">Open</span>}</td>
                      <td className="right num">{s.expectedCash != null ? money(s.expectedCash) : '—'}</td>
                      <td className="right num">{s.countedCash != null ? money(s.countedCash) : '—'}</td>
                      <td className="right num" style={{ color: s.variance ? 'var(--danger)' : undefined }}>
                        {s.variance == null ? '—' : s.variance === 0 ? '✓' : money(s.variance)}
                      </td>
                      <td className="right num" style={{ color: s.momoVariance ? 'var(--danger)' : undefined }}>
                        {s.momoVariance == null ? '—' : s.momoVariance === 0 ? '✓' : money(s.momoVariance)}
                      </td>
                    </tr>
                  ))}
                  {d.shifts.length === 0 && (
                    <tr>
                      <td colSpan={7} className="dim">
                        No shifts in this period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
