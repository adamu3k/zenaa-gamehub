import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, Banknote, Gamepad2, Gauge, Receipt, Timer } from 'lucide-react';
import { KIND_LABEL } from '../components/money';
import { Link } from 'react-router-dom';
import { PageHeader, StatCard } from '../components/ui';
import { get } from '../lib/api';
import { useApp } from '../lib/app-context';
import { METHOD_LABEL, formatTime } from '../lib/format';

const ACTION_LABEL: Record<string, string> = {
  'session.start': 'started a session',
  'session.end': 'ended a session',
  'session.pause': 'paused a session',
  'session.resume': 'resumed a session',
  'session.extend': 'extended a session',
  'session.system_pause': 'paused a session after an outage',
  'wallet.deposit': 'made a wallet deposit',
  'wallet.withdrawal': 'made a wallet withdrawal',
  'wallet.adjustment': 'adjusted a wallet',
  'customer.create': 'registered a customer',
  'session.settle': 'received a tab payment',
  'session.refund': 'refunded a session',
  'session.void': 'voided a session',
  'payment.refund': 'refunded a payment',
  'shift.open': 'opened a shift',
  'shift.close': 'closed a shift',
  'shift.cash_in': 'put cash in the drawer',
  'shift.cash_out': 'took cash out of the drawer',
  'promo_code.create': 'created a promo code',
  'happy_hour.create': 'added a happy hour',
  'auth.login': 'signed in',
  'auth.login_failed': 'failed sign-in',
};

export function DashboardPage() {
  const { money, settings } = useApp();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => get('/api/dashboard'), refetchInterval: 30_000 });
  const d = q.data;
  if (!d) return <div className="muted">{q.error ? (q.error as Error).message : 'Loading dashboard…'}</div>;
  const maxDay = Math.max(1, ...d.revenueByDay.map((x: any) => x.amount));

  return (
    <>
      <PageHeader title="Dashboard" subtitle={`${settings.centerName} · live overview`} actions={<Link className="btn btn-primary" to="/stations"><Gamepad2 size={16} /> Open stations</Link>} />

      <div className="grid stats">
        <StatCard icon={<Gamepad2 size={14} />} label="Stations" value={d.stations.total} sub={`${d.stations.available} available · ${d.stations.maintenance + d.stations.offline} down`} />
        <StatCard icon={<Timer size={14} />} label="Active sessions" value={d.activeSessions} sub={`${d.stations.in_use} running · ${d.stations.paused} paused`} />
        <StatCard icon={<Gauge size={14} />} label="Utilisation today" value={`${d.utilisationToday}%`} sub="of operational station time" />
        {d.revenue && <StatCard icon={<Banknote size={14} />} label="Revenue today" value={money(d.revenue.today)} sub={`Week ${money(d.revenue.week)} · Month ${money(d.revenue.month)}`} />}
        {d.openTabs && d.openTabs.owed > 0 && (
          <Link to="/payments" style={{ textDecoration: 'none', color: 'inherit' }}>
            <StatCard icon={<Receipt size={14} />} label="Owed on tabs" value={money(d.openTabs.owed)} sub={`${d.openTabs.sessions} unpaid session(s) — collect under Payments`} />
          </Link>
        )}
      </div>

      <div className="grid two-col">
        {d.revenue ? (
          <div className="card">
            <div className="card-head">
              <h2>Revenue — last 7 days</h2>
            </div>
            <div className="bars">
              {d.revenueByDay.map((x: any) => (
                <div className="bar-col" key={x.day} title={money(x.amount)}>
                  <div className="bar" style={{ height: `${(x.amount / maxDay) * 100}%` }} />
                  <span className="bar-label">{new Date(x.day).toLocaleDateString(undefined, { weekday: 'short' })}</span>
                </div>
              ))}
            </div>
            <div style={{ height: 14 }} />
          </div>
        ) : (
          <div className="card card-pad muted">Revenue figures are visible to managers and administrators.</div>
        )}

        <div className="card">
          <div className="card-head">
            <h2>
              <AlertTriangle size={16} style={{ verticalAlign: -2 }} /> Alerts
            </h2>
            <span className="badge">{d.alerts.length}</span>
          </div>
          <div className="list">
            {d.alerts.length === 0 && <div className="list-item muted">All clear</div>}
            {d.alerts.map((a: any, i: number) => (
              <div className="list-item" key={i}>
                <span>{a.message}</span>
                <span className={`badge ${a.level === 'warning' ? 'badge-warning' : a.level === 'critical' ? 'badge-danger' : 'badge-info'}`}>{a.level}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid two-col">
        {d.revenue && (
          <div className="card">
            <div className="card-head">
              <h2>Recent transactions</h2>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Time</th>
                    <th>Type</th>
                    <th>Customer</th>
                    <th>Method</th>
                    <th>Staff</th>
                    <th className="right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {d.recentTransactions.length === 0 && (
                    <tr>
                      <td colSpan={7} className="muted">No transactions yet</td>
                    </tr>
                  )}
                  {d.recentTransactions.map((t: any) => (
                    <tr key={t.id}>
                      <td className="mono dim">{t.number}</td>
                      <td>{formatTime(t.createdAt)}</td>
                      <td>{KIND_LABEL[t.kind] ?? t.kind}</td>
                      <td>{t.customerName ?? <span className="dim">Walk-in</span>}</td>
                      <td>{METHOD_LABEL[t.method]}</td>
                      <td>{t.staffName ?? 'System'}</td>
                      <td className="right num" style={{ color: t.amount < 0 ? 'var(--danger)' : undefined }}>{money(t.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <div className="card">
          <div className="card-head">
            <h2>
              <Activity size={16} style={{ verticalAlign: -2 }} /> Staff activity
            </h2>
          </div>
          <div className="list">
            {d.activity.map((a: any) => (
              <div className="list-item" key={a.id}>
                <span>
                  <strong>{a.staffName}</strong> <span className="muted">{ACTION_LABEL[a.action] ?? a.action}</span>
                </span>
                <span className="dim">{formatTime(a.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
