import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/ui';
import { get } from '../lib/api';
import { formatDateTime } from '../lib/format';

export function AuditPage() {
  const q = useQuery({ queryKey: ['audit'], queryFn: () => get('/api/audit?limit=300') });
  return (
    <>
      <PageHeader title="Audit trail" subtitle="Every change, who made it and when (latest 300)" />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>Details</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((a: any) => (
              <tr key={a.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(a.createdAt)}</td>
                <td>{a.staffName}</td>
                <td className="mono">{a.action}</td>
                <td className="dim mono" style={{ fontSize: 12, maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.details ? JSON.stringify(a.details) : ''}>
                  {a.details ? JSON.stringify(a.details) : ''}
                </td>
                <td className="dim">{a.ip ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
