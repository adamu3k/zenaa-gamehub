import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DeleteButton } from '../components/DeleteButton';
import { ErrorBox, PageHeader } from '../components/ui';
import { get } from '../lib/api';
import { useApp } from '../lib/app-context';
import { formatDateTime } from '../lib/format';

export function AuditPage() {
  const { can } = useApp();
  const [who, setWho] = useState('');
  const [find, setFind] = useState('');
  const staff = useQuery({ queryKey: ['staff'], queryFn: () => get<any[]>('/api/staff'), enabled: can('staff.manage') });
  const q = useQuery({ queryKey: ['audit', who], queryFn: () => get<any[]>(`/api/audit?limit=500${who ? `&staffId=${who}` : ''}`) });
  const admin = can('settings.manage');
  const f = find.trim().toLowerCase();
  const rows = (q.data ?? []).filter((a) => !f || `${a.action} ${a.staffName} ${a.details ? JSON.stringify(a.details) : ''}`.toLowerCase().includes(f));
  return (
    <>
      <PageHeader
        title="Audit trail"
        subtitle={
          <>
            Every change, who made it and when (latest 500).
            {admin && (
              <>
                {' '}
                Admins can delete single lines here, or clear old lines in <Link to="/system#cleanup">System → Clean up</Link>. Clearing is itself recorded.
              </>
            )}
          </>
        }
        actions={
          <button className="btn btn-sm" onClick={() => q.refetch()} disabled={q.isFetching}>
            <RefreshCw size={14} className={q.isFetching ? 'spin' : ''} /> Refresh
          </button>
        }
      />
      <div className="toolbar" style={{ gap: 8, marginBottom: 12 }}>
        <input className="input" style={{ maxWidth: 260 }} placeholder="Search action or details…" value={find} onChange={(e) => setFind(e.target.value)} />
        {staff.data && (
          <select className="select" style={{ maxWidth: 220 }} value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Everyone</option>
            {staff.data.map((s) => (
              <option key={s.id} value={s.id}>
                {s.fullName}
              </option>
            ))}
          </select>
        )}
      </div>
      <ErrorBox error={q.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>Details</th>
              <th>IP</th>
              {admin && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((a: any) => (
              <tr key={a.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(a.createdAt)}</td>
                <td>{a.staffName}</td>
                <td className="mono">{a.action}</td>
                <td className="dim mono" style={{ fontSize: 12, maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.details ? JSON.stringify(a.details) : ''}>
                  {a.details ? JSON.stringify(a.details) : ''}
                </td>
                <td className="dim">{a.ip ?? ''}</td>
                {admin && (
                  <td className="right">
                    <DeleteButton icon url={`/api/audit/${a.id}`} what="this audit line" refresh={[['audit']]} />
                  </td>
                )}
              </tr>
            ))}
            {!rows.length && !q.isLoading && (
              <tr>
                <td colSpan={6} className="muted">
                  Nothing found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
