import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { ErrorBox, Field, Modal, PageHeader } from '../components/ui';
import { api, get, patch, post } from '../lib/api';
import { useApp } from '../lib/app-context';
import { formatDateTime } from '../lib/format';

const BUILTIN = [
  { value: 'admin', label: 'Administrator', about: 'Everything, including staff accounts and settings. Cannot be locked out.' },
  { value: 'manager', label: 'Manager', about: 'Runs the floor and the money: refunds, discounts, tabs, reports, pricing. No staff or settings.' },
  { value: 'cashier', label: 'Cashier', about: 'Starts and ends sessions, registers customers, tops up wallets, handles bookings.' },
];

export function StaffPage() {
  const [tab, setTab] = useState<'people' | 'types'>('people');
  return (
    <>
      <PageHeader title="Users & roles" subtitle="Who can sign in, and what each type of user is allowed to do. Customers have their own portal at /portal." />
      <div className="tabs">
        <button className={tab === 'people' ? 'on' : ''} onClick={() => setTab('people')}>
          Staff accounts
        </button>
        <button className={tab === 'types' ? 'on' : ''} onClick={() => setTab('types')}>
          User types
        </button>
      </div>
      {tab === 'people' ? <People /> : <UserTypes />}
    </>
  );
}

function People() {
  const q = useQuery({ queryKey: ['staff'], queryFn: () => get('/api/staff') });
  const [edit, setEdit] = useState<any>(null);
  return (
    <>
      <div className="toolbar">
        <span className="muted">{(q.data ?? []).length} accounts</span>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => setEdit('new')}>
          <Plus size={16} /> Add user
        </button>
      </div>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Username</th>
              <th>User type</th>
              <th>Status</th>
              <th>PIN</th>
              <th>Last sign-in</th>
            </tr>
          </thead>
          <tbody>
            {(q.data ?? []).map((s: any) => (
              <tr key={s.id} className="clickable" onClick={() => setEdit(s)}>
                <td style={{ fontWeight: 600 }}>{s.fullName}</td>
                <td className="mono">{s.username}</td>
                <td>
                  <span className={`badge ${s.role === 'admin' && !s.roleId ? 'badge-primary' : s.roleId ? 'badge-info' : ''}`}>{s.roleName}</span>
                </td>
                <td>{s.active ? <span className="badge badge-success">Active</span> : <span className="badge badge-danger">Disabled</span>}</td>
                <td>{s.hasPin ? <span className="badge badge-success">Set</span> : <span className="badge badge-warning">Not set</span>}</td>
                <td>{formatDateTime(s.lastLoginAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <StaffForm staff={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function StaffForm({ staff, onClose }: { staff: any; onClose(): void }) {
  const { toast } = useApp();
  const qc = useQueryClient();
  const perms = useQuery({ queryKey: ['permissions'], queryFn: () => get('/api/permissions') });
  const types = useQuery({ queryKey: ['staff-roles'], queryFn: () => get('/api/staff-roles') });
  const [f, setF] = useState({
    username: staff?.username ?? '',
    fullName: staff?.fullName ?? '',
    type: staff?.roleId ? `custom:${staff.roleId}` : (staff?.role ?? 'cashier'),
    password: '',
    active: staff?.active ?? true,
    grant: (staff?.permissions?.grant ?? []) as string[],
    revoke: (staff?.permissions?.revoke ?? []) as string[],
  });
  const customId = f.type.startsWith('custom:') ? f.type.slice(7) : null;
  const custom = (types.data ?? []).find((t: any) => t.id === customId);
  const defaults: string[] = customId ? (custom?.permissions ?? []) : (perms.data?.roleDefaults?.[f.type] ?? []);
  const effective = (p: string) => (defaults.includes(p) ? !f.revoke.includes(p) : f.grant.includes(p));
  const toggle = (p: string) => {
    const on = effective(p);
    if (defaults.includes(p)) setF({ ...f, revoke: on ? [...f.revoke, p] : f.revoke.filter((x) => x !== p) });
    else setF({ ...f, grant: on ? f.grant.filter((x) => x !== p) : [...f.grant, p] });
  };
  const save = useMutation({
    mutationFn: () => {
      const permissions = { grant: f.grant.filter((p) => !defaults.includes(p)), revoke: f.revoke.filter((p) => defaults.includes(p)) };
      const role = customId ? 'cashier' : f.type;
      const body = { fullName: f.fullName, role, roleId: customId, permissions };
      return staff
        ? patch(`/api/staff/${staff.id}`, { ...body, active: f.active })
        : post('/api/staff', { ...body, username: f.username, password: f.password });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['staff'] });
      qc.invalidateQueries({ queryKey: ['staff-roles'] });
      toast('success', 'User saved');
      onClose();
    },
  });
  const [newPin, setNewPin] = useState('');
  const pinM = useMutation({
    mutationFn: (pin: string | null) => post(`/api/staff/${staff.id}/pin`, { pin }),
    onSuccess: (_r, pin) => {
      qc.invalidateQueries({ queryKey: ['staff'] });
      toast('success', pin ? 'PIN set — tell them privately' : 'PIN removed');
      setNewPin('');
    },
  });
  const [newPw, setNewPw] = useState('');
  const reset = useMutation({
    mutationFn: () => post(`/api/staff/${staff.id}/reset-password`, { password: newPw }),
    onSuccess: () => {
      toast('success', 'Password reset — they will need to sign in again');
      setNewPw('');
    },
  });
  const about = customId ? custom?.description : BUILTIN.find((b) => b.value === f.type)?.about;
  return (
    <Modal
      wide
      title={staff ? `Edit ${staff.fullName}` : 'Add user'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={save.isPending || !f.fullName || (!staff && (!f.username || f.password.length < 8))} onClick={() => save.mutate()}>
            Save
          </button>
        </>
      }
    >
      <ErrorBox error={save.error || reset.error} />
      <div className="form-grid">
        <Field label="Full name">
          <input className="input" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} />
        </Field>
        <Field label="Username" hint={staff ? undefined : 'Used to sign in — letters, digits, . _ -'}>
          <input className="input" value={f.username} disabled={!!staff} onChange={(e) => setF({ ...f, username: e.target.value })} />
        </Field>
        <Field label="User type" hint={about}>
          <select className="select" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, grant: [], revoke: [] })}>
            <optgroup label="Built-in">
              {BUILTIN.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </optgroup>
            {(types.data ?? []).length > 0 && (
              <optgroup label="Your user types">
                {(types.data ?? []).map((t: any) => (
                  <option key={t.id} value={`custom:${t.id}`}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Field>
        {staff ? (
          <Field label="Account">
            <label className="check">
              <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active (can sign in)
            </label>
          </Field>
        ) : (
          <Field label="Password" hint="At least 8 characters">
            <input className="input" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} />
          </Field>
        )}
      </div>
      <h3>Permissions</h3>
      <div className="hint">Ticked boxes come from the user type. Change any of them for this person only — extras are marked.</div>
      <div className="check-grid">
        {(perms.data?.permissions ?? []).map((p: any) => (
          <label key={p.key} className="check">
            <input type="checkbox" checked={effective(p.key)} onChange={() => toggle(p.key)} />
            <span>
              {p.label}
              {!defaults.includes(p.key) && effective(p.key) && <span className="badge badge-primary" style={{ marginLeft: 6 }}>extra</span>}
              {defaults.includes(p.key) && !effective(p.key) && <span className="badge badge-danger" style={{ marginLeft: 6 }}>removed</span>}
            </span>
          </label>
        ))}
      </div>
      {staff && (
        <>
          <h3>Staff PIN</h3>
          <div className="dim" style={{ fontSize: 13 }}>
            {staff.hasPin ? 'This person has a PIN. ' : 'No PIN yet. '}Used to approve actions at the counter and to unlock station screens / the console page. They can also set it
            themselves under "My PIN".
          </div>
          <ErrorBox error={pinM.error} />
          <div className="toolbar">
            <input
              className="input mono"
              style={{ maxWidth: 200 }}
              inputMode="numeric"
              type="password"
              placeholder="New PIN (4–8 digits)"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/[^0-9]/g, '').slice(0, 8))}
            />
            <button className="btn" disabled={newPin.length < 4 || pinM.isPending} onClick={() => pinM.mutate(newPin)}>
              Set PIN
            </button>
            {staff.hasPin && (
              <button className="btn btn-ghost" disabled={pinM.isPending} onClick={() => pinM.mutate(null)}>
                Remove PIN
              </button>
            )}
          </div>
          <h3>Reset password</h3>
          <div className="toolbar">
            <input className="input" style={{ maxWidth: 260 }} type="password" placeholder="New password (8+ chars)" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
            <button className="btn" disabled={newPw.length < 8 || reset.isPending} onClick={() => reset.mutate()}>
              Reset
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

function UserTypes() {
  const perms = useQuery({ queryKey: ['permissions'], queryFn: () => get('/api/permissions') });
  const types = useQuery({ queryKey: ['staff-roles'], queryFn: () => get('/api/staff-roles') });
  const [edit, setEdit] = useState<any>(null);
  const labels: Record<string, string> = Object.fromEntries((perms.data?.permissions ?? []).map((p: any) => [p.key, p.label]));
  const all: string[] = (perms.data?.permissions ?? []).map((p: any) => p.key);
  return (
    <>
      <div className="toolbar">
        <span className="muted">Create your own types — e.g. Supervisor, Attendant, Accountant — each with exactly the permissions it needs.</span>
        <div className="spacer" />
        <button className="btn btn-primary" onClick={() => setEdit('new')}>
          <Plus size={16} /> New user type
        </button>
      </div>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {BUILTIN.map((b) => {
          const list: string[] = perms.data?.roleDefaults?.[b.value] ?? [];
          return (
            <div key={b.value} className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="toolbar">
                <ShieldCheck size={16} className="dim" />
                <strong>{b.label}</strong>
                <span className="badge">Built-in</span>
              </div>
              <div className="muted" style={{ fontSize: 13 }}>{b.about}</div>
              <div className="dim" style={{ fontSize: 12 }}>
                {list.length === all.length ? 'All permissions' : `${list.length} of ${all.length} permissions`}
              </div>
            </div>
          );
        })}
        {(types.data ?? []).map((t: any) => (
          <button
            key={t.id}
            type="button"
            className="card card-pad"
            style={{ display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left', cursor: 'pointer', color: 'var(--text)' }}
            onClick={() => setEdit(t)}
          >
            <div className="toolbar">
              <ShieldCheck size={16} style={{ color: 'var(--info)' }} />
              <strong>{t.name}</strong>
              <span className="badge badge-info">
                {t.members} {t.members === 1 ? 'person' : 'people'}
              </span>
            </div>
            {t.description && <div className="muted" style={{ fontSize: 13 }}>{t.description}</div>}
            <div className="dim" style={{ fontSize: 12 }}>
              {t.permissions.length ? t.permissions.map((p: string) => labels[p] ?? p).join(' · ') : 'No permissions yet'}
            </div>
          </button>
        ))}
      </div>
      {edit && <UserTypeForm type={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function UserTypeForm({ type, onClose }: { type: any; onClose(): void }) {
  const { toast } = useApp();
  const qc = useQueryClient();
  const perms = useQuery({ queryKey: ['permissions'], queryFn: () => get('/api/permissions') });
  const [name, setName] = useState(type?.name ?? '');
  const [description, setDescription] = useState(type?.description ?? '');
  const [chosen, setChosen] = useState<string[]>(type?.permissions ?? ['stations.view', 'sessions.operate']);
  const [copyFrom, setCopyFrom] = useState('');
  const done = (msg: string) => {
    qc.invalidateQueries({ queryKey: ['staff-roles'] });
    qc.invalidateQueries({ queryKey: ['staff'] });
    toast('success', msg);
    onClose();
  };
  const save = useMutation({
    mutationFn: () => {
      const body = { name, description: description || null, permissions: chosen };
      return type ? patch(`/api/staff-roles/${type.id}`, body) : post('/api/staff-roles', body);
    },
    onSuccess: () => done('User type saved'),
  });
  const del = useMutation({ mutationFn: () => api('DELETE', `/api/staff-roles/${type.id}`), onSuccess: () => done('User type deleted') });
  return (
    <Modal
      wide
      title={type ? `Edit user type — ${type.name}` : 'New user type'}
      onClose={onClose}
      footer={
        <>
          {type && (
            <button className="btn btn-ghost" style={{ marginRight: 'auto', color: 'var(--danger)' }} disabled={del.isPending} onClick={() => window.confirm(`Delete "${type.name}"?`) && del.mutate()}>
              <Trash2 size={14} /> Delete
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={save.isPending || name.trim().length < 2} onClick={() => save.mutate()}>
            Save
          </button>
        </>
      }
    >
      <ErrorBox error={save.error || del.error} />
      <div className="form-grid">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Supervisor" />
        </Field>
        <Field label="Start from">
          <select
            className="select"
            value={copyFrom}
            onChange={(e) => {
              setCopyFrom(e.target.value);
              if (e.target.value) setChosen(perms.data?.roleDefaults?.[e.target.value] ?? []);
            }}
          >
            <option value="">— keep current ticks —</option>
            {BUILTIN.map((b) => (
              <option key={b.value} value={b.value}>
                Copy {b.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Description" full>
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this person does" />
        </Field>
      </div>
      <h3>Permissions</h3>
      <div className="check-grid">
        {(perms.data?.permissions ?? []).map((p: any) => (
          <label key={p.key} className="check">
            <input type="checkbox" checked={chosen.includes(p.key)} onChange={() => setChosen(chosen.includes(p.key) ? chosen.filter((x) => x !== p.key) : [...chosen, p.key])} />
            <span>{p.label}</span>
          </label>
        ))}
      </div>
    </Modal>
  );
}
