import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Check, LogIn, UserX, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorBox, Field, Modal, PageHeader, Segmented, StatusBadge } from '../components/ui';
import { get, post } from '../lib/api';
import { useApp } from '../lib/app-context';
import { formatMinutes, formatTime } from '../lib/format';
import { CustomerPicker } from './Stations';

const pad = (n: number) => String(n).padStart(2, '0');
export const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const DURATIONS = [30, 60, 90, 120, 180, 240, 300, 360];

export function BookingsPage() {
  const { can, settings } = useApp();
  const [day, setDay] = useState(localDay());
  const [view, setView] = useState<'live' | 'all'>('live');
  const [creating, setCreating] = useState(false);
  const from = new Date(`${day}T00:00:00`);
  const to = new Date(from.getTime() + 86_400_000);
  const q = useQuery({
    queryKey: ['bookings', day],
    queryFn: () => get(`/api/bookings?from=${from.toISOString()}&to=${to.toISOString()}`),
    refetchInterval: 60_000,
  });
  const rows = (q.data ?? []).filter((b: any) => view === 'all' || ['pending', 'confirmed', 'checked_in'].includes(b.status));
  const waiting = (q.data ?? []).filter((b: any) => b.status === 'pending').length;

  return (
    <>
      <PageHeader
        title="Bookings"
        subtitle={
          <>
            Reservations from the customer portal and the desk · open {settings.openingTime}–{settings.closingTime}
            {waiting > 0 && <span className="badge badge-warning" style={{ marginLeft: 8 }}>{waiting} awaiting confirmation</span>}
          </>
        }
        actions={
          <>
            <Segmented
              value={view}
              onChange={setView}
              options={[
                { value: 'live', label: 'Upcoming' },
                { value: 'all', label: 'All' },
              ]}
            />
            <input className="input" type="date" style={{ width: 170 }} value={day} onChange={(e) => setDay(e.target.value)} />
            {can('bookings.manage') && (
              <button className="btn btn-primary" onClick={() => setCreating(true)}>
                <CalendarPlus size={16} /> New booking
              </button>
            )}
          </>
        }
      />
      <ErrorBox error={q.error} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Station</th>
              <th>Customer</th>
              <th>Length</th>
              <th>From</th>
              <th>Status</th>
              <th className="right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  {q.isLoading ? 'Loading…' : 'No bookings for this day'}
                </td>
              </tr>
            )}
            {rows.map((b: any) => (
              <BookingRow key={b.id} b={b} />
            ))}
          </tbody>
        </table>
      </div>
      {creating && <BookingForm defaultDay={day} onClose={() => setCreating(false)} />}
    </>
  );
}

function BookingRow({ b }: { b: any }) {
  const { can, toast } = useApp();
  const qc = useQueryClient();
  const nav = useNavigate();
  const act = useMutation({
    mutationFn: ({ action, reason }: { action: string; reason?: string }) => post(`/api/bookings/${b.id}/${action}`, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bookings'] }),
    onError: (e: Error) => toast('error', e.message),
  });
  const live = b.status === 'pending' || b.status === 'confirmed';
  return (
    <tr>
      <td className="mono">
        {formatTime(b.startAt)}–{formatTime(b.endAt)}
      </td>
      <td>{b.stationName}</td>
      <td>
        <div style={{ fontWeight: 600 }}>{b.name}</div>
        <div className="dim" style={{ fontSize: 12 }}>
          {[b.customerCode, b.phone].filter(Boolean).join(' · ')}
          {b.note ? ` · “${b.note}”` : ''}
        </div>
      </td>
      <td>{formatMinutes(b.minutes)}</td>
      <td>
        <span className="badge">{b.source === 'portal' ? 'Online' : 'Desk'}</span>
      </td>
      <td>
        <StatusBadge status={b.status} />
      </td>
      <td className="right">
        {live && can('bookings.manage') && (
          <div className="toolbar" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
            {b.status === 'pending' && (
              <button className="btn btn-sm" disabled={act.isPending} onClick={() => act.mutate({ action: 'confirm' })}>
                <Check size={14} /> Confirm
              </button>
            )}
            {can('sessions.operate') && (
              <button
                className="btn btn-sm btn-primary"
                onClick={() => nav(`/stations?start=${b.stationId}&booking=${b.id}${b.customerId ? `&customer=${b.customerId}` : ''}`)}
                title="Start the session for this booking"
              >
                <LogIn size={14} /> Check in
              </button>
            )}
            <button className="btn btn-sm btn-ghost" disabled={act.isPending} onClick={() => act.mutate({ action: 'no_show' })} title="Mark as no-show">
              <UserX size={14} />
            </button>
            <button
              className="btn btn-sm btn-ghost"
              disabled={act.isPending}
              title="Cancel booking"
              onClick={() => {
                const reason = window.prompt('Reason for cancelling (optional)') ?? undefined;
                act.mutate({ action: 'cancel', reason });
              }}
            >
              <X size={14} />
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

function BookingForm({ defaultDay, onClose }: { defaultDay: string; onClose(): void }) {
  const { toast } = useApp();
  const qc = useQueryClient();
  const stations = useQuery({ queryKey: ['stations'], queryFn: async () => (await get('/api/stations')).stations });
  const [customer, setCustomer] = useState<any>(null);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [stationId, setStationId] = useState('');
  const now = new Date();
  const [start, setStart] = useState(`${defaultDay}T${pad(Math.min(23, now.getHours() + 1))}:00`);
  const [minutes, setMinutes] = useState(60);
  const [note, setNote] = useState('');
  const m = useMutation({
    mutationFn: () =>
      post('/api/bookings', {
        stationId,
        startAt: new Date(start).toISOString(),
        minutes,
        customerId: customer?.id ?? null,
        contactName: customer ? null : contactName || null,
        contactPhone: customer ? null : contactPhone || null,
        note: note || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] });
      toast('success', 'Booking saved');
      onClose();
    },
  });
  const list = (stations.data ?? []).filter((s: any) => s.status !== 'archived' && s.status !== 'offline');
  return (
    <Modal
      title="New booking"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={m.isPending || !stationId || !start || (!customer && !contactName.trim())} onClick={() => m.mutate()}>
            Book
          </button>
        </>
      }
    >
      <ErrorBox error={m.error} />
      <Field label="Customer">
        <CustomerPicker value={customer} onChange={setCustomer} />
      </Field>
      {!customer && (
        <div className="form-grid">
          <Field label="Or contact name">
            <input className="input" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="e.g. Kwesi (phone booking)" />
          </Field>
          <Field label="Contact phone">
            <input className="input" inputMode="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
          </Field>
        </div>
      )}
      <div className="form-grid">
        <Field label="Station">
          <select className="select" value={stationId} onChange={(e) => setStationId(e.target.value)}>
            <option value="">Choose…</option>
            {list.map((s: any) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.code})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Length">
          <select className="select" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {formatMinutes(d)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Starts" full>
          <input className="input" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Note" full>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — e.g. birthday, 4 controllers" />
        </Field>
      </div>
    </Modal>
  );
}
