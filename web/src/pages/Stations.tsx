import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, MessageSquare, Minus, Monitor, MonitorPlay, Pause, Pencil, Play, Plus, Power, Sparkles, Square, Trash2 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { MoneyInput, ReceiptButton, RefundModal, useTender } from '../components/money';
import { timeForAmount, TimeCalculatorButton } from '../components/TimeCalculator';
import { ErrorBox, Field, Modal, PageHeader, Segmented, StatusBadge, PasswordInput } from '../components/ui';
import { ApiError, del, get, getToken, patch, post } from '../lib/api';
import { DEVICES, DRIVER_HINT, DRIVER_LABEL, type DriverKey } from '../lib/devices';
import { useApp, useTick } from '../lib/app-context';
import { formatDuration, formatMinutes, formatTime, parseMoney, PLATFORM_LABEL, toMajorString } from '../lib/format';

type Station = any;

function liveSeconds(session: any, offsetMs: number) {
  let active = session.accumulatedSeconds;
  if (session.status === 'running' && session.lastResumedAt) {
    active += Math.max(0, Math.floor((Date.now() + offsetMs - Date.parse(session.lastResumedAt)) / 1000));
  }
  if (session.allottedSeconds != null) active = Math.min(active, session.allottedSeconds);
  return active;
}

export function StationsPage() {
  const { can, setServerTime } = useApp();
  const q = useQuery({
    queryKey: ['stations'],
    queryFn: async () => {
      const r = await get('/api/stations');
      setServerTime(r.serverTime);
      return r.stations as Station[];
    },
    refetchInterval: 30_000,
  });
  const [filter, setFilter] = useState<'all' | 'available' | 'busy' | 'down'>('all');
  const [room, setRoom] = useState<string>(() => {
    try {
      return localStorage.getItem('zenaa.stations.room') ?? '';
    } catch {
      return '';
    }
  });
  const pickRoom = (r: string) => {
    setRoom(r);
    try {
      localStorage.setItem('zenaa.stations.room', r);
    } catch {
      /* ignore */
    }
  };
  const rooms = useMemo(() => [...new Set((q.data ?? []).map((s) => s.room).filter(Boolean))].sort() as string[], [q.data]);
  const [startFor, setStartFor] = useState<Station | null>(null);
  const [endFor, setEndFor] = useState<Station | null>(null);
  const [extendFor, setExtendFor] = useState<{
    station: Station;
    dir: 'add' | 'remove';
  } | null>(null);
  const [editing, setEditing] = useState<Station | 'new' | null>(null);
  const [checkIn, setCheckIn] = useState<{
    bookingId: string;
    customerId?: string;
  } | null>(null);
  const [params, setParams] = useSearchParams();

  // Arriving from Bookings → "Check in": open the start dialog for that station with the booking attached.
  useEffect(() => {
    const st = params.get('start');
    if (!st || !q.data) return;
    const station = q.data.find((s) => s.id === st);
    if (station && station.liveStatus === 'available') {
      setCheckIn({
        bookingId: params.get('booking') ?? '',
        customerId: params.get('customer') ?? undefined,
      });
      setStartFor(station);
    }
    setParams({}, { replace: true });
  }, [params, q.data, setParams]);

  const roomOk = (s: Station) => !room || !rooms.includes(room) || (s.room ?? '') === room;
  const list = (q.data ?? [])
    .filter(roomOk)
    .filter((s) =>
      filter === 'all'
        ? true
        : filter === 'available'
          ? s.liveStatus === 'available'
          : filter === 'busy'
            ? s.liveStatus === 'in_use' || s.liveStatus === 'paused'
            : s.liveStatus === 'maintenance' || s.liveStatus === 'offline',
    );

  return (
    <>
      <PageHeader
        title="Stations"
        subtitle="Start, pause, extend and end sessions. Timers update live on every device."
        actions={
          <>
            {rooms.length > 0 && (
              <Segmented value={rooms.includes(room) ? room : ''} onChange={pickRoom} options={[{ value: '', label: 'All rooms' }, ...rooms.map((r) => ({ value: r, label: r }))]} />
            )}
            <Segmented
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'available', label: 'Available' },
                { value: 'busy', label: 'In use' },
                { value: 'down', label: 'Down' },
              ]}
            />
            <TimeCalculatorButton />
            {can('stations.manage') && (
              <button className="btn btn-primary" onClick={() => setEditing('new')}>
                <Plus size={16} /> Add station
              </button>
            )}
          </>
        }
      />
      {q.error && <ErrorBox error={q.error} />}
      {q.data && q.data.length === 0 && (
        <div className="card empty">
          <h2>No stations yet</h2>
          <p>Add your PS5 stations, then create a pricing plan under Pricing &amp; tiers.</p>
          {can('stations.manage') && (
            <button className="btn btn-primary" onClick={() => setEditing('new')}>
              <Plus size={16} /> Add first station
            </button>
          )}
        </div>
      )}
      {groupByRoom(list, rooms.length > 0 && !rooms.includes(room)).map(([title, items]) => (
        <section key={title || '-'} style={{ marginBottom: 18 }}>
          {title !== null && (
            <h2 className="room-title">
              {title || 'No room set'}{' '}
              <span className="dim" style={{ fontSize: 13, fontWeight: 500 }}>
                · {items.length}
              </span>
            </h2>
          )}
          <div className="station-grid">
            {items.map((s) => (
              <StationCard
                key={s.id}
                station={s}
                onStart={() => {
                  setCheckIn(null);
                  setStartFor(s);
                }}
                onCheckIn={() => {
                  setCheckIn({
                    bookingId: s.nextBooking.id,
                    customerId: s.nextBooking.customerId ?? undefined,
                  });
                  setStartFor(s);
                }}
                onEnd={() => setEndFor(s)}
                onExtend={() => setExtendFor({ station: s, dir: 'add' })}
                onReduce={() => setExtendFor({ station: s, dir: 'remove' })}
                onEdit={can('stations.manage') ? () => setEditing(s) : undefined}
              />
            ))}
          </div>
        </section>
      ))}
      {startFor && (
        <StartModal
          station={startFor}
          bookingId={checkIn?.bookingId || undefined}
          initialCustomerId={checkIn?.customerId}
          onClose={() => {
            setStartFor(null);
            setCheckIn(null);
          }}
        />
      )}
      {endFor && <EndModal station={endFor} onClose={() => setEndFor(null)} />}
      {extendFor && <ExtendModal station={extendFor.station} startDir={extendFor.dir} onClose={() => setExtendFor(null)} />}
      {editing && <StationForm station={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function PowerChip({ s }: { s: Station }) {
  const { can, toast } = useApp();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (on: boolean) => post(`/api/stations/${s.id}/power`, { on }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['stations'] });
      toast(r.note ? 'warning' : 'success', r.note ?? `Power switched ${r.state}`);
    },
    onError: (e: Error) => toast('error', e.message),
  });
  if (s.powerDriver === 'none') return null;
  const state = s.powerError ? 'error' : s.powerState;
  const cls = state === 'on' ? 'badge-success' : state === 'error' ? 'badge-danger' : state === 'off' ? '' : 'badge-warning';
  const label = state === 'on' ? 'Power on' : state === 'off' ? 'Power off' : state === 'error' ? 'Plug offline' : 'Power ?';
  const canToggle = can('stations.power');
  return (
    <button
      type="button"
      className={`badge power-btn ${cls}`}
      title={s.powerError ? s.powerError : canToggle ? 'Switch power on/off by hand' : 'Smart plug state'}
      disabled={!canToggle || m.isPending}
      onClick={() => {
        const on = s.powerState !== 'on';
        if (window.confirm(`Switch ${s.name} ${on ? 'ON' : 'OFF'} now?`)) m.mutate(on);
      }}
    >
      <Power size={11} /> {label}
    </button>
  );
}

/** Station screen app (PC / Android TV) status; click to send a message to the screen. */
function ScreenChip({ s }: { s: Station }) {
  const { can, toast } = useApp();
  const m = useMutation({
    mutationFn: (text: string) => post(`/api/stations/${s.id}/agent-message`, { text }),
    onSuccess: () => toast('success', 'Message sent to the screen'),
    onError: (e: Error) => toast('error', e.message),
  });
  if (!s.agentInfo) return null;
  return (
    <button
      type="button"
      className={`badge power-btn ${s.agentOnline ? 'badge-success' : 'badge-danger'}`}
      title={s.agentOnline ? 'Screen app online — click to send a message' : 'Screen app not responding'}
      disabled={!can('sessions.operate') || !s.agentOnline || m.isPending}
      onClick={() => {
        const text = window.prompt(`Message for the ${s.name} screen`, 'Your time is almost up — top up at the counter');
        if (text?.trim()) m.mutate(text.trim());
      }}
    >
      {s.agentOnline ? <MessageSquare size={11} /> : <Monitor size={11} />} {s.agentOnline ? 'Screen' : 'Screen offline'}
    </button>
  );
}

/** Sections per room (title null = no headings: one room picked, or no rooms used). */
function groupByRoom(list: Station[], split: boolean): [string | null, Station[]][] {
  if (!split) return [[null, list]];
  const m = new Map<string, Station[]>();
  for (const s of list) {
    const k = s.room ?? '';
    m.set(k, [...(m.get(k) ?? []), s]);
  }
  return [...m.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b))).map(([k, v]) => [k, v]);
}

const PAUSE_LABEL: Record<string, string> = {
  off: 'screen locked, power off',
  screen: 'screen locked, TV on',
  open: 'clock stopped only',
};

function StationCard({
  station: s,
  onStart,
  onEnd,
  onExtend,
  onReduce,
  onEdit,
  onCheckIn,
}: {
  station: Station;
  onStart(): void;
  onEnd(): void;
  onExtend(): void;
  onReduce(): void;
  onEdit?: () => void;
  onCheckIn(): void;
}) {
  const { can, money, serverOffsetMs, toast } = useApp();
  const qc = useQueryClient();
  useTick();
  const sess = s.session;
  const active = sess ? liveSeconds(sess, serverOffsetMs) : 0;
  const remaining = sess?.allottedSeconds != null ? sess.allottedSeconds - active : null;
  const low = remaining != null && remaining <= 300;
  const [pauseMenu, setPauseMenu] = useState(false);
  const op = useMutation({
    mutationFn: ({ action, mode }: { action: 'pause' | 'resume'; mode?: 'off' | 'screen' | 'open' }) => post(`/api/sessions/${sess.id}/${action}`, mode ? { mode } : {}),
    onSuccess: () => {
      setPauseMenu(false);
      qc.invalidateQueries({ queryKey: ['stations'] });
    },
    onError: (e: Error) => toast('error', e.message),
  });

  return (
    <div className="card station" data-status={s.liveStatus} data-low={low ? 'true' : 'false'}>
      <div className="station-head">
        <div>
          <h3>{s.name}</h3>
          <div className="dim" style={{ fontSize: 12 }}>
            {s.code} · {PLATFORM_LABEL[s.platform]}
            {s.room ? ` · ${s.room}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <StatusBadge status={s.liveStatus} />
          {can('stations.remote') && (s.vncConfig?.host || (s.agentInfo?.kind === 'pc' && s.agentInfo?.ip)) && (
            <Link to={`/remote/${s.id}`} target="_blank" className="btn btn-ghost btn-icon btn-sm" aria-label="Remote view" title="See this station's screen (VNC)">
              <MonitorPlay size={14} />
            </Link>
          )}
          {onEdit && (
            <button className="btn btn-ghost btn-icon btn-sm" onClick={onEdit} aria-label="Edit station">
              <Pencil size={14} />
            </button>
          )}
        </div>
      </div>

      {(s.nextBooking || s.powerDriver !== 'none' || s.agentInfo) && (
        <div className="station-chips">
          <PowerChip s={s} />
          <ScreenChip s={s} />
          {s.nextBooking && (
            <span className={`badge ${Date.parse(s.nextBooking.startAt) <= Date.now() ? 'badge-warning' : 'badge-info'}`} title="Next booking">
              <CalendarClock size={11} /> {formatTime(s.nextBooking.startAt)} · {s.nextBooking.name}
            </span>
          )}
        </div>
      )}
      {sess ? (
        <>
          <div>
            <div className="timer">{formatDuration(remaining != null ? remaining : active)}</div>
            <div className="dim" style={{ fontSize: 12 }}>
              {remaining != null ? 'remaining' : 'elapsed'} · {sess.rate.planName} · {sess.billingType}
            </div>
            {sess.status === 'paused' && (
              <div className="badge badge-warning" style={{ marginTop: 4 }}>
                <Pause size={11} /> Paused · {PAUSE_LABEL[sess.pauseMode ?? 'off'] ?? 'paused'}
              </div>
            )}
          </div>
          {remaining != null && (
            <div className="progress">
              <div
                style={{
                  width: `${Math.max(0, Math.min(100, (remaining / sess.allottedSeconds) * 100))}%`,
                }}
              />
            </div>
          )}
          <div className="station-meta">
            <span>{sess.customerName ?? 'Walk-in'}</span>
            <span className="num">{sess.billingType === 'postpaid' ? `≈ ${money(sess.liveNetAmount)}` : `Paid ${money(sess.paidAmount)}`}</span>
          </div>
          {can('sessions.operate') && (
            <div className="station-actions">
              {sess.status === 'running' ? (
                <button className="btn btn-sm" disabled={op.isPending} onClick={() => setPauseMenu((o) => !o)} aria-expanded={pauseMenu}>
                  <Pause size={14} /> Pause…
                </button>
              ) : (
                <button className="btn btn-sm" disabled={op.isPending} onClick={() => op.mutate({ action: 'resume' })}>
                  <Play size={14} /> Resume
                </button>
              )}
              {sess.billingType === 'prepaid' && (
                <>
                  <button className="btn btn-sm" onClick={onExtend} title="Add time">
                    <Plus size={14} /> Time
                  </button>
                  <button className="btn btn-sm" onClick={onReduce} title="Take time off" aria-label="Take time off">
                    <Minus size={14} /> Time
                  </button>
                </>
              )}
              <button className="btn btn-sm btn-danger" onClick={onEnd}>
                <Square size={14} /> End
              </button>
            </div>
          )}
          {pauseMenu && sess.status === 'running' && (
            <div className="pause-menu">
              <div className="dim" style={{ fontSize: 12 }}>
                Pause how? The clock stops in every case.
              </div>
              <button className="btn btn-sm" disabled={op.isPending} onClick={() => op.mutate({ action: 'pause', mode: 'off' })}>
                <Power size={14} /> Lock screen &amp; switch off
              </button>
              <button className="btn btn-sm" disabled={op.isPending} onClick={() => op.mutate({ action: 'pause', mode: 'screen' })}>
                <Monitor size={14} /> Lock screen, keep TV on
              </button>
              <button className="btn btn-sm" disabled={op.isPending} onClick={() => op.mutate({ action: 'pause', mode: 'open' })}>
                <Pause size={14} /> Stop the clock only
              </button>
            </div>
          )}
        </>
      ) : (s as any).liveStatus === 'staff_use' ? (
        <StaffUseBlock s={s} onStart={onStart} />
      ) : (
        <>
          <div className="timer dim">--:--:--</div>
          <div className="station-meta">
            <span>{s.hourlyRateOverride != null ? `${money(s.hourlyRateOverride)}/h override` : 'Plan rate'}</span>
            <span />
          </div>
          {can('sessions.operate') && (
            <div className="station-actions">
              <button className="btn btn-primary btn-sm" disabled={s.liveStatus !== 'available'} onClick={onStart}>
                <Play size={14} /> Start session
              </button>
              {s.nextBooking && Date.parse(s.nextBooking.startAt) - Date.now() < 60 * 60_000 && (
                <button className="btn btn-sm" disabled={s.liveStatus !== 'available'} onClick={onCheckIn} title="Start the session for the booked customer">
                  <CalendarClock size={14} /> Check in
                </button>
              )}
              {s.liveStatus === 'available' && <TurnOnButton s={s} />}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function CustomerPicker({ value, onChange }: { value: any; onChange(c: any): void }) {
  const { money } = useApp();
  const [term, setTerm] = useState('');
  const q = useQuery({
    queryKey: ['customers', 'search', term],
    queryFn: () => get(`/api/customers?limit=8&q=${encodeURIComponent(term)}`),
    enabled: term.trim().length >= 2,
  });
  if (value)
    return (
      <div className="toolbar card card-pad" style={{ padding: 10 }}>
        <div>
          <strong>{value.fullName}</strong> <span className="dim mono">{value.code}</span>
          <div className="dim" style={{ fontSize: 12 }}>
            Wallet {money(value.balance)} {value.tierName ? `· ${value.tierName}` : ''}
          </div>
        </div>
        <div className="spacer" />
        <button type="button" className="btn btn-sm" onClick={() => onChange(null)}>
          Change
        </button>
      </div>
    );
  return (
    <div>
      <input className="input" placeholder="Search name, phone or ZG-ID (optional — leave blank for walk-in)" value={term} onChange={(e) => setTerm(e.target.value)} />
      {q.data && q.data.length > 0 && (
        <div className="card list" style={{ marginTop: 6 }}>
          {q.data.map((c: any) => (
            <button
              type="button"
              key={c.id}
              className="list-item"
              style={{
                background: 'none',
                border: 0,
                borderBottom: '1px solid var(--border)',
                cursor: 'pointer',
                textAlign: 'left',
              }}
              onClick={() => onChange(c)}
              disabled={c.status !== 'active'}
            >
              <span>
                {c.fullName} <span className="dim mono">{c.code}</span>
              </span>
              <span className="dim">{c.status !== 'active' ? 'Suspended' : money(c.balance)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function priceForMinutes(min: number, ratePerHour: number) {
  return Math.floor((2 * min * ratePerHour + 60) / 120);
}
/** Same half-up percentage rounding as the server's billing engine. */
function percentOff(amount: number, pct: number) {
  return pct > 0 ? Math.floor((2 * amount * Math.min(pct, 100) + 100) / 200) : 0;
}

/** Promo code entry with a live server-side check. Returns the applied code and its discount on `subtotal`. */
function usePromo(subtotal: number | null) {
  const { money } = useApp();
  const [text, setText] = useState('');
  const [code, setCode] = useState('');
  const check = useQuery({
    queryKey: ['promo-check', code, subtotal],
    queryFn: () => get(`/api/promo-codes/check?code=${encodeURIComponent(code)}&subtotal=${subtotal}`),
    enabled: !!code && subtotal != null,
    retry: false,
  });
  const discount = code && check.data ? check.data.discount : 0;
  const ui = (
    <Field
      label="Promo code"
      hint={
        !code ? undefined : check.isLoading ? (
          'Checking…'
        ) : check.error ? (
          <span style={{ color: 'var(--danger)' }}>{(check.error as Error).message}</span>
        ) : (
          `${check.data?.code}: −${money(discount)}${check.data?.description ? ` · ${check.data.description}` : ''}`
        )
      }
    >
      <div className="toolbar" style={{ flexWrap: 'nowrap' }}>
        <input className="input" value={text} placeholder="Optional" onChange={(e) => setText(e.target.value.toUpperCase())} />
        {code ? (
          <button type="button" className="btn btn-sm" onClick={() => (setCode(''), setText(''))}>
            Remove
          </button>
        ) : (
          <button type="button" className="btn btn-sm" disabled={!text.trim()} onClick={() => setCode(text.trim())}>
            Apply
          </button>
        )}
      </div>
    </Field>
  );
  return {
    ui,
    code: code && check.data ? code : undefined,
    discount,
    pending: !!code && (check.isLoading || !!check.error),
  };
}

function StartModal({ station, onClose, bookingId, initialCustomerId }: { station: Station; onClose(): void; bookingId?: string; initialCustomerId?: string }) {
  const { money, toast, can, settings } = useApp();
  const [paidText, setPaidText] = useState('');
  const qc = useQueryClient();
  const plansQ = useQuery({
    queryKey: ['plans'],
    queryFn: () => get('/api/pricing-plans'),
  });
  const happyQ = useQuery({
    queryKey: ['happy-now', station.id],
    queryFn: () => get(`/api/happy-hours/current?stationId=${station.id}`),
  });
  const plans = useMemo(() => (plansQ.data ?? []).filter((p: any) => p.active && (!p.categoryId || p.categoryId === station.categoryId)), [plansQ.data, station]);
  const [planId, setPlanId] = useState('');
  const plan = plans.find((p: any) => p.id === planId);
  const [billingType, setBillingType] = useState<'prepaid' | 'postpaid'>('prepaid');
  const [minutes, setMinutes] = useState(60);
  const [customer, setCustomer] = useState<any>(null);
  const preset = useQuery({
    queryKey: ['customer', initialCustomerId],
    queryFn: () => get(`/api/customers/${initialCustomerId}`),
    enabled: !!initialCustomerId,
  });
  useEffect(() => {
    if (preset.data) setCustomer(preset.data);
  }, [preset.data]);

  useEffect(() => {
    if (!planId && plans.length) setPlanId(plans[0].id);
  }, [plans, planId]);
  useEffect(() => {
    if (plan?.kind === 'package') setBillingType('prepaid');
    if (plan && plan.kind === 'time_rate') setMinutes((m) => Math.max(plan.billingUnitMinutes, Math.ceil(m / plan.billingUnitMinutes) * plan.billingUnitMinutes));
  }, [plan]);

  const happy = happyQ.data?.happyHour;
  const tierPct = customer?.tierDiscount ?? 0;
  const pct = Math.max(tierPct, happy?.discountPercent ?? 0);
  const pctSource = pct === 0 ? null : happy && happy.discountPercent > tierPct ? `Happy hour: ${happy.name}` : `${customer?.tierName} member`;

  const rate = plan ? (plan.kind === 'time_rate' && station.hourlyRateOverride != null ? station.hourlyRateOverride : plan.ratePerHour) : 0;
  const gross = !plan || billingType === 'postpaid' ? null : plan.kind === 'package' ? plan.packagePrice : priceForMinutes(minutes, rate);
  const afterPct = gross != null ? gross - percentOff(gross, pct) : null;
  const promo = usePromo(billingType === 'prepaid' ? afterPct : null);
  const net = afterPct != null ? afterPct - promo.discount : null;
  const tender = useTender(net ?? 0, { customer });
  const detail = useQuery({
    queryKey: ['customer', customer?.id],
    queryFn: () => get(`/api/customers/${customer.id}`),
    enabled: !!customer?.id,
  });
  const savedHere = (detail.data?.savedTime ?? []).filter((t: any) => !t.categoryId || t.categoryId === station.categoryId).reduce((a: number, t: any) => a + t.seconds, 0);
  const savedElsewhere = Math.floor(((detail.data?.savedSeconds ?? 0) - savedHere) / 60);
  const savedMin = Math.floor((detail.data ? savedHere : 0) / 60);
  const [onAccount, setOnAccount] = useState(false);
  const canAccount = !!customer && can('payments.tab') && billingType === 'prepaid';
  const [useSaved, setUseSaved] = useState(false);
  const [savedUse, setSavedUse] = useState('');
  useEffect(() => {
    setUseSaved(savedMin > 0);
    setSavedUse('');
  }, [customer?.id, savedMin]);
  const fromSaved = useSaved && savedMin > 0;

  const m = useMutation({
    mutationFn: () =>
      fromSaved
        ? post('/api/sessions', {
            stationId: station.id,
            planId,
            billingType: 'prepaid',
            customerId: customer.id,
            useSavedTime: true,
            minutes: Number(savedUse) > 0 ? Math.min(Number(savedUse), savedMin) : undefined,
            bookingId: bookingId ?? null,
          })
        : post('/api/sessions', {
            stationId: station.id,
            planId,
            billingType,
            customerId: customer?.id ?? null,
            minutes: plan?.kind === 'time_rate' && billingType === 'prepaid' ? minutes : undefined,
            promoCode: billingType === 'prepaid' ? promo.code : undefined,
            bookingId: bookingId ?? null,
            ...(billingType === 'prepaid' && !(canAccount && onAccount) ? tender.payload : {}),
            ...(canAccount && onAccount ? { payLater: true } : {}),
          }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stations'] });
      toast('success', `Session started on ${station.name}`);
      onClose();
    },
  });

  return (
    <Modal
      title={bookingId ? `Check in booking — ${station.name}` : `Start session — ${station.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={!plan || m.isPending || (!fromSaved && billingType === 'prepaid' && ((!tender.valid && !(canAccount && onAccount)) || promo.pending))}
            onClick={() => m.mutate()}
          >
            <Play size={16} />{' '}
            {fromSaved
              ? `Continue ${formatMinutes(Number(savedUse) > 0 ? Math.min(Number(savedUse), savedMin) : savedMin)} of saved time`
              : billingType === 'prepaid' && net != null
                ? canAccount && onAccount
                  ? `Start · ${money(net)} on account`
                  : `Collect ${money(net)} & start`
                : 'Start timer'}
          </button>
        </>
      }
    >
      <ErrorBox error={m.error} />
      {happy && (
        <div className="toolbar">
          <span className="badge badge-success">
            <Sparkles size={12} /> {happy.name}: {happy.discountPercent}% off
          </span>
          <span className="dim" style={{ fontSize: 12 }}>
            Applies to sessions started now (not combined with member discounts — the better one wins)
          </span>
        </div>
      )}
      {plansQ.data && plans.length === 0 && <div className="error-box">No active pricing plans apply to this station. Create one under Pricing &amp; tiers.</div>}
      <Field label="Pricing plan">
        <select className="select" value={planId} onChange={(e) => setPlanId(e.target.value)}>
          {plans.map((p: any) => (
            <option key={p.id} value={p.id}>
              {p.name} —{' '}
              {p.kind === 'package'
                ? `${formatMinutes(p.packageMinutes)} for ${money(p.packagePrice)}`
                : `${money(p.kind === 'time_rate' && station.hourlyRateOverride != null ? station.hourlyRateOverride : p.ratePerHour)}/h`}
            </option>
          ))}
        </select>
      </Field>
      {!fromSaved && plan?.kind === 'time_rate' && (
        <Field label="Billing">
          <Segmented
            value={billingType}
            onChange={setBillingType}
            options={[
              { value: 'prepaid', label: 'Prepaid (fixed time)' },
              { value: 'postpaid', label: 'Postpaid (open timer)' },
            ]}
          />
        </Field>
      )}
      {!fromSaved && plan?.kind === 'time_rate' && billingType === 'prepaid' && (
        <Field label="Time" hint={plan.billingUnitMinutes > 1 ? `Multiples of ${plan.billingUnitMinutes} minutes` : undefined}>
          <div className="toolbar">
            {[30, 60, 90, 120, 180]
              .filter((x) => x % plan.billingUnitMinutes === 0)
              .map((x) => (
                <button type="button" key={x} className={`btn btn-sm ${minutes === x ? 'btn-primary' : ''}`} onClick={() => setMinutes(x)}>
                  {formatMinutes(x)}
                </button>
              ))}
            <input
              className="input"
              style={{ width: 100 }}
              type="number"
              min={plan.billingUnitMinutes}
              step={plan.billingUnitMinutes}
              value={minutes}
              onChange={(e) => {
                setMinutes(Number(e.target.value));
                setPaidText('');
              }}
            />
            <span className="muted">min</span>
          </div>
        </Field>
      )}
      {!fromSaved && plan?.kind === 'time_rate' && billingType === 'prepaid' && can('sessions.calculator') && (
        <Field label="…or the amount the customer pays" hint="Fills in the time this amount buys (before discounts).">
          <div className="toolbar">
            <div style={{ width: 140 }}>
              <MoneyInput
                value={paidText}
                placeholder="e.g. 25"
                onChange={(v) => {
                  setPaidText(v);
                  const r = timeForAmount(parseMoney(v, settings.currencyMinorUnits) ?? 0, plan, rate);
                  if (r && r.minutes > 0) setMinutes(r.minutes);
                }}
              />
            </div>
            {paidText &&
              (() => {
                const r = timeForAmount(parseMoney(paidText, settings.currencyMinorUnits) ?? 0, plan, rate);
                return <span className="muted">{r && r.minutes > 0 ? `= ${formatMinutes(r.minutes)}${r.change > 0 ? ` (${money(r.change)} change)` : ''}` : 'Not enough for any time'}</span>;
              })()}
          </div>
        </Field>
      )}
      <Field label="Customer">
        <CustomerPicker value={customer} onChange={setCustomer} />
      </Field>
      {savedMin > 0 && (
        <div className="saved-time-box">
          <label className="check">
            <input type="checkbox" checked={useSaved} onChange={(e) => setUseSaved(e.target.checked)} /> Continue from {customer.fullName}'s saved time — <b>{formatMinutes(savedMin)} left</b>
          </label>
          {fromSaved && (
            <div className="toolbar">
              <span className="muted">Use</span>
              <input className="input" style={{ width: 100 }} type="number" min={1} max={savedMin} placeholder="all" value={savedUse} onChange={(e) => setSavedUse(e.target.value)} />
              <span className="muted">min (blank = all {formatMinutes(savedMin)}). No payment — it was paid before.</span>
            </div>
          )}
        </div>
      )}
      {!fromSaved && billingType === 'prepaid' && promo.ui}
      {!fromSaved && gross != null && (
        <dl className="kv">
          <dt>Price</dt>
          <dd>{money(gross)}</dd>
          {pct > 0 && (
            <>
              <dt>
                {pctSource} ({pct}%)
              </dt>
              <dd>−{money(gross - afterPct!)}</dd>
            </>
          )}
          {promo.discount > 0 && (
            <>
              <dt>Promo {promo.code}</dt>
              <dd>−{money(promo.discount)}</dd>
            </>
          )}
        </dl>
      )}
      {!fromSaved && net != null && (
        <div className="total-row">
          <span>To collect</span>
          <span>{money(net)}</span>
        </div>
      )}
      {!fromSaved && canAccount && net != null && net > 0 && <AccountChoice customer={detail.data ?? customer} value={onAccount} onChange={setOnAccount} amount={net} />}
      {!fromSaved && billingType === 'prepaid' && !(canAccount && onAccount) && tender.ui}
      {customer && savedMin === 0 && savedElsewhere > 0 && (
        <div className="hint">
          {customer.fullName} has {formatMinutes(savedElsewhere)} saved for another station type. To play it here, change it on their customer page (Saved time → Change type).
        </div>
      )}
      {!fromSaved && billingType === 'postpaid' && (
        <div className="hint">
          The customer pays when the session ends, based on the time used
          {pct > 0 ? ` (${pct}% off — ${pctSource})` : ''}. Promo codes are entered at checkout.
        </div>
      )}
    </Modal>
  );
}

function ExtendModal({ station, startDir = 'add', onClose }: { station: Station; startDir?: 'add' | 'remove'; onClose(): void }) {
  const [dir, setDir] = useState<'add' | 'remove'>(startDir);
  return dir === 'remove' ? <ReduceModal station={station} onAdd={() => setDir('add')} onClose={onClose} /> : <AddTimeModal station={station} onRemove={() => setDir('remove')} onClose={onClose} />;
}

const DirSwitch = ({ value, onChange }: { value: 'add' | 'remove'; onChange(v: 'add' | 'remove'): void }) => (
  <Segmented
    value={value}
    onChange={onChange}
    options={[
      { value: 'add', label: '+ Add time' },
      { value: 'remove', label: '− Take time off' },
    ]}
  />
);

function AddTimeModal({ station, onRemove, onClose }: { station: Station; onRemove(): void; onClose(): void }) {
  const { money, toast, can } = useApp();
  const qc = useQueryClient();
  const sess = station.session;
  const [minutes, setMinutes] = useState(30);
  const [other, setOther] = useState<any>(null);
  const [pickOther, setPickOther] = useState(false);
  const accountId: string | null = other?.id ?? sess.customerId ?? null;
  const account = useQuery({
    queryKey: ['customer', accountId],
    queryFn: () => get(`/api/customers/${accountId}`),
    enabled: !!accountId,
  });
  const acc = account.data;
  const accName = other?.fullName ?? sess.customerName ?? 'the customer';
  const [source, setSource] = useState<'pay' | 'saved' | 'tab'>('pay');
  const savedHere = Math.floor((acc?.savedTime ?? []).filter((t: any) => !t.categoryId || t.categoryId === station.categoryId).reduce((a: number, t: any) => a + t.seconds, 0) / 60);
  const gross = priceForMinutes(Math.max(0, minutes || 0), sess.rate.ratePerHour);
  const net = source === 'saved' ? 0 : gross - percentOff(gross, sess.discountPercent);
  const tender = useTender(net, {
    customer: accountId ? { id: accountId, balance: acc?.balance } : null,
  });
  useEffect(() => {
    if (!accountId && source !== 'pay') setSource('pay');
  }, [accountId, source]);
  const m = useMutation({
    mutationFn: () =>
      post(`/api/sessions/${sess.id}/extend`, {
        minutes,
        source,
        accountId: accountId ?? undefined,
        ...(source === 'pay' ? tender.payload : {}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stations'] });
      if (accountId) qc.invalidateQueries({ queryKey: ['customer', accountId] });
      toast(
        'success',
        `Added ${formatMinutes(minutes)} to ${station.name}${source === 'saved' ? ` from ${accName}'s saved time` : source === 'tab' ? ` · ${money(net)} on ${accName}'s account` : ''}`,
      );
      onClose();
    },
  });
  const ready = minutes > 0 && (source === 'pay' ? tender.valid : source === 'saved' ? savedHere >= minutes : true);
  return (
    <Modal
      title={`Add time — ${station.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={m.isPending || !ready} onClick={() => m.mutate()}>
            {source === 'pay' ? `Collect ${money(net)} & add time` : source === 'saved' ? `Add ${formatMinutes(minutes)} from saved time` : `Add · ${money(net)} on account`}
          </button>
        </>
      }
    >
      <DirSwitch value="add" onChange={(v) => v === 'remove' && onRemove()} />
      <ErrorBox error={m.error} />
      <Field label="Add time">
        <div className="toolbar">
          {[15, 30, 60].map((x) => (
            <button type="button" key={x} className={`btn btn-sm ${minutes === x ? 'btn-primary' : ''}`} onClick={() => setMinutes(x)}>
              +{formatMinutes(x)}
            </button>
          ))}
          <input className="input" style={{ width: 100 }} type="number" min={1} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
        </div>
      </Field>
      <Field label="Take it from" hint={!sess.customerId && !other ? 'Walk-in session: choose a customer to use their wallet, saved time or account.' : undefined}>
        {pickOther ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <CustomerPicker value={other} onChange={setOther} />
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => {
                setOther(null);
                setPickOther(false);
              }}
            >
              {sess.customerId ? `Back to ${sess.customerName}` : 'No customer (cash / MoMo only)'}
            </button>
          </div>
        ) : (
          <div className="toolbar">
            <span>
              {sess.customerId ? (
                <>
                  <b>{sess.customerName}</b>'s account
                </>
              ) : (
                'Walk-in (no account)'
              )}
            </span>
            <button type="button" className="btn btn-sm" onClick={() => setPickOther(true)}>
              {sess.customerId ? 'Use another customer' : 'Choose a customer'}
            </button>
          </div>
        )}
      </Field>
      {accountId && (
        <Segmented
          value={source}
          onChange={setSource}
          options={[
            { value: 'pay', label: 'Pay now' },
            {
              value: 'saved',
              label: `Saved time (${formatMinutes(savedHere)})`,
            },
            ...(can('payments.tab') ? [{ value: 'tab' as const, label: 'Put on account' }] : []),
          ]}
        />
      )}
      {source === 'saved' && savedHere < minutes && (
        <div className="error-text">
          {accName} has only {formatMinutes(savedHere)} of saved time for this station.
        </div>
      )}
      {source === 'tab' && acc && <AccountInfo customer={acc} amount={net} />}
      {source !== 'saved' && (
        <div className="total-row">
          <span>
            {source === 'tab' ? 'Goes on the account' : 'To collect'}
            {sess.discountPercent > 0 ? ` (${sess.discountPercent}% off)` : ''}
          </span>
          <span>{money(net)}</span>
        </div>
      )}
      {source === 'pay' && tender.ui}
    </Modal>
  );
}

/** Takes minutes off a running fixed-time session: back to saved time, money back, or just shorter. */
function ReduceModal({ station, onAdd, onClose }: { station: Station; onAdd(): void; onClose(): void }) {
  const { money, toast, can, serverOffsetMs } = useApp();
  const qc = useQueryClient();
  useTick();
  const sess = station.session;
  const live = useQuery({
    queryKey: ['session', sess.id],
    queryFn: () => get(`/api/sessions/${sess.id}`),
    refetchInterval: 10_000,
  });
  const d = live.data ?? sess;
  const active = liveSeconds(d, serverOffsetMs);
  const left = d.allottedSeconds != null ? d.allottedSeconds - active : 0;
  const most = Math.max(0, Math.floor((left - 60) / 60));
  const [minutes, setMinutes] = useState(15);
  const [back, setBack] = useState<'saved' | 'refund' | 'keep'>(sess.customerId ? 'saved' : can('payments.refund') ? 'refund' : 'keep');
  const [method, setMethod] = useState<'' | 'cash' | 'mobile_money'>('');
  const [reason, setReason] = useState('');
  // Same sum as the server: saved time goes back as time; bought time is worth its share of the price.
  const secs = Math.max(0, minutes || 0) * 60;
  const fromSaved = Math.min(secs, d.fromSavedSeconds ?? 0);
  const boughtTotal = (d.allottedSeconds ?? 0) - (d.fromSavedSeconds ?? 0);
  const cut = boughtTotal > 0 ? Math.round((d.netAmount * (secs - fromSaved)) / boughtTotal) : 0;
  const newNet = d.netAmount - cut;
  const giveBack = Math.max(0, d.paidAmount - (d.refundedAmount ?? 0) - newNet);
  const owedLess = Math.max(0, d.netAmount - d.paidAmount) - Math.max(0, newNet - d.paidAmount);
  const m = useMutation({
    mutationFn: () =>
      post(`/api/sessions/${sess.id}/reduce`, {
        minutes,
        back,
        method: back === 'refund' && method ? method : undefined,
        reason: reason || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stations'] });
      qc.invalidateQueries({ queryKey: ['session', sess.id] });
      if (sess.customerId) qc.invalidateQueries({ queryKey: ['customer', sess.customerId] });
      toast(
        'success',
        `Took ${formatMinutes(minutes)} off ${station.name}${
          back === 'saved'
            ? ` · back on ${sess.customerName}'s saved time`
            : back === 'refund' && giveBack > 0
              ? ` · give back ${money(giveBack)}`
              : back === 'refund' && owedLess > 0
                ? ` · ${money(owedLess)} less to pay`
                : ''
        }`,
      );
      onClose();
    },
  });
  const ready = minutes > 0 && minutes <= most && (back !== 'saved' || !!sess.customerId) && (back !== 'refund' || giveBack === 0 || can('payments.refund'));
  return (
    <Modal
      title={`Take time off — ${station.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={m.isPending || !ready} onClick={() => m.mutate()}>
            {back === 'refund' && giveBack > 0 ? `Take off ${formatMinutes(minutes || 0)} & give back ${money(giveBack)}` : `Take off ${formatMinutes(minutes || 0)}`}
          </button>
        </>
      }
    >
      <DirSwitch value="remove" onChange={(v) => v === 'add' && onAdd()} />
      <ErrorBox error={m.error} />
      <div className="hint">
        {formatDuration(Math.max(0, left))} left. You can take off up to <b>{formatMinutes(most)}</b> (1 minute must stay — to stop now, use End).
      </div>
      <Field label="Take off">
        <div className="toolbar">
          {[5, 15, 30, 60]
            .filter((x) => x <= most)
            .map((x) => (
              <button type="button" key={x} className={`btn btn-sm ${minutes === x ? 'btn-primary' : ''}`} onClick={() => setMinutes(x)}>
                −{formatMinutes(x)}
              </button>
            ))}
          <input className="input" style={{ width: 100 }} type="number" min={1} max={most} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
        </div>
      </Field>
      {minutes > most && <div className="error-text">Only {formatMinutes(most)} can be taken off.</div>}
      <Field label="What happens to that time">
        <Segmented
          value={back}
          onChange={setBack}
          options={[
            ...(sess.customerId ? [{ value: 'saved' as const, label: 'Back on saved time' }] : []),
            {
              value: 'refund' as const,
              label: d.paidAmount < d.netAmount ? 'Lower the bill' : 'Give money back',
            },
            { value: 'keep' as const, label: 'Just shorten' },
          ]}
        />
      </Field>
      {back === 'saved' && (
        <div className="hint">
          {formatMinutes(minutes || 0)} goes on <b>{sess.customerName}</b>'s saved time to play another day. No money changes hands.
        </div>
      )}
      {back === 'refund' && (
        <>
          {fromSaved > 0 && <div className="hint">{formatMinutes(Math.floor(fromSaved / 60))} came from saved time and goes back on it.</div>}
          {owedLess > 0 && (
            <div className="total-row">
              <span>Less to pay later</span>
              <span>{money(owedLess)}</span>
            </div>
          )}
          <div className="total-row">
            <span>Give back</span>
            <span>{money(giveBack)}</span>
          </div>
          {giveBack > 0 && (
            <>
              {!can('payments.refund') && <div className="error-text">You need the refund permission to give money back — ask a manager.</div>}
              <Field label="Give it back as" hint="Money paid from the wallet always goes back to the wallet.">
                <Segmented
                  value={method}
                  onChange={setMethod}
                  options={[
                    { value: '', label: 'As they paid' },
                    { value: 'cash', label: 'Cash' },
                    { value: 'mobile_money', label: 'MoMo' },
                  ]}
                />
              </Field>
            </>
          )}
        </>
      )}
      {back === 'keep' && <div className="hint">The session ends earlier. The price stays the same and nothing is given back.</div>}
      <Field label="Reason (optional)">
        <input className="input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. customer has to leave early" />
      </Field>
    </Modal>
  );
}

function EndModal({ station, onClose }: { station: Station; onClose(): void }) {
  const { money, toast, can, settings } = useApp();
  const qc = useQueryClient();
  const sess = station.session;
  const quote = useQuery({
    queryKey: ['session', sess.id],
    queryFn: () => get(`/api/sessions/${sess.id}`),
    refetchInterval: 5000,
  });
  const d = quote.data;
  const [done, setDone] = useState<any>(null);
  const postpaid = d?.billingType === 'postpaid';
  const promo = usePromo(postpaid && !done ? d.liveNetAmount : null);
  const [manualText, setManualText] = useState('');
  const [reason, setReason] = useState('');
  const [payLater, setPayLater] = useState(false);
  const [endAccount, setEndAccount] = useState<any>(null);
  const tabCustomerId: string | null = d?.customerId ?? endAccount?.id ?? null;
  const tabCustomer = useQuery({
    queryKey: ['customer', tabCustomerId],
    queryFn: () => get(`/api/customers/${tabCustomerId}`),
    enabled: !!tabCustomerId && payLater,
  });
  const canSave = d?.billingType === 'prepaid' && !!d?.customerId && d.remainingSeconds >= 60;
  const [saveRemaining, setSaveRemaining] = useState(true);
  const manual = manualText.trim() ? parseMoney(manualText, settings.currencyMinorUnits) : 0;
  const owed = d ? Math.max(0, d.liveNetAmount - promo.discount - (manual ?? 0) - d.paidAmount) : 0;
  const tender = useTender(owed, {
    customer: d?.customerId ? { id: d.customerId } : null,
    allowPartial: payLater,
  });
  const usePartial = payLater && tender.total > 0 && (tender.payload.payments?.length ?? 0) > 0;
  const manualInvalid = manual == null || manual < 0 || (manual > 0 && !reason.trim());

  const m = useMutation({
    mutationFn: () =>
      post(`/api/sessions/${sess.id}/end`, {
        ...(owed > 0 && (!payLater || usePartial) ? tender.payload : {}),
        promoCode: postpaid ? promo.code : undefined,
        manualDiscount: manual && manual > 0 ? manual : undefined,
        discountReason: manual && manual > 0 ? reason : undefined,
        payLater: payLater || undefined,
        accountId: payLater && !d?.customerId && endAccount ? endAccount.id : undefined,
        saveRemaining: canSave && saveRemaining ? true : undefined,
      }),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['stations'] });
      qc.invalidateQueries({ queryKey: ['session', sess.id] });
      toast(
        'success',
        `${station.name} ended · ${money(r.netAmount)}${r.onTab ? ` · ${money(r.balanceDue)} on tab` : ''}${r.savedSeconds ? ` · ${formatMinutes(Math.floor(r.savedSeconds / 60))} saved to the account` : ''}`,
      );
      if (r.customerId) qc.invalidateQueries({ queryKey: ['customer', r.customerId] });
      setDone(r);
    },
  });

  if (done) return <EndDone station={station} session={done} onClose={onClose} />;
  return (
    <Modal
      title={`End session — ${station.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-danger"
            disabled={!d || m.isPending || promo.pending || manualInvalid || (!payLater && !tender.valid) || (payLater && usePartial && !tender.valid) || (payLater && !tabCustomerId)}
            onClick={() => m.mutate()}
          >
            <Square size={16} />{' '}
            {owed <= 0 ? 'End session' : payLater ? (usePartial ? `Collect ${money(tender.total)}, rest on account` : `End · ${money(owed)} on account`) : `Collect ${money(owed)} & end`}
          </button>
        </>
      }
    >
      <ErrorBox error={m.error || quote.error} />
      {d && (
        <dl className="kv">
          <dt>Customer</dt>
          <dd>{sess.customerName ?? 'Walk-in'}</dd>
          <dt>Plan</dt>
          <dd>
            {d.rate.planName} ({d.billingType})
          </dd>
          <dt>Time played</dt>
          <dd className="mono">{formatDuration(d.activeSeconds)}</dd>
          {d.remainingSeconds != null && (
            <>
              <dt>Unused time</dt>
              <dd className="mono">{formatDuration(d.remainingSeconds)}</dd>
            </>
          )}
          <dt>Charge</dt>
          <dd>{money(d.liveGrossAmount)}</dd>
          {d.discountPercent > 0 && (
            <>
              <dt>
                {d.happyHourId ? 'Happy hour' : 'Member discount'} ({d.discountPercent}%)
              </dt>
              <dd>−{money(d.billingType === 'postpaid' ? d.liveGrossAmount - d.liveNetAmount : d.discountAmount - d.promoDiscount)}</dd>
            </>
          )}
          {d.billingType === 'prepaid' && d.promoDiscount > 0 && (
            <>
              <dt>Promo code</dt>
              <dd>−{money(d.promoDiscount)}</dd>
            </>
          )}
          {promo.discount > 0 && (
            <>
              <dt>Promo {promo.code}</dt>
              <dd>−{money(promo.discount)}</dd>
            </>
          )}
          {manual != null && manual > 0 && (
            <>
              <dt>Manual discount</dt>
              <dd>−{money(manual)}</dd>
            </>
          )}
          <dt>Already paid</dt>
          <dd>{money(d.paidAmount)}</dd>
        </dl>
      )}
      {postpaid && promo.ui}
      {postpaid && can('payments.discount') && (
        <div className="form-grid">
          <Field label={`Manual discount (${settings.currencyCode})`}>
            <MoneyInput value={manualText} onChange={setManualText} placeholder="0" />
          </Field>
          <Field label="Discount reason">
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={manual ? 'Required' : 'Only if discounting'} />
          </Field>
        </div>
      )}
      {d && (
        <div className="total-row">
          <span>Balance due</span>
          <span>{money(owed)}</span>
        </div>
      )}
      {owed > 0 && can('payments.tab') && (
        <Field label="Did they pay?">
          <Segmented
            value={payLater ? 'later' : 'now'}
            onChange={(v) => setPayLater(v === 'later')}
            options={[
              { value: 'now', label: 'Paying now' },
              {
                value: 'later',
                label: `Put on ${sess.customerName ? `${sess.customerName.split(' ')[0]}'s` : 'an'} account`,
              },
            ]}
          />
        </Field>
      )}
      {owed > 0 && payLater && !d?.customerId && (
        <Field label="Whose account?" hint="Walk-in session: choose the customer who will pay later.">
          <CustomerPicker value={endAccount} onChange={setEndAccount} />
        </Field>
      )}
      {owed > 0 && payLater && tabCustomer.data && <AccountInfo customer={tabCustomer.data} amount={owed} />}
      {owed > 0 && payLater && <div className="hint">Optionally take part of it now below; leave the amount blank to put everything on the account.</div>}
      {owed > 0 && tender.ui}
      {canSave && (
        <label className="check saved-time-box">
          <input type="checkbox" checked={saveRemaining} onChange={(e) => setSaveRemaining(e.target.checked)} /> Save the <b>{formatMinutes(Math.floor(d.remainingSeconds / 60))}</b> left to{' '}
          {sess.customerName ?? 'the customer'}'s account, to continue next visit
        </label>
      )}
      {d?.billingType === 'prepaid' && d.remainingSeconds > 0 && !(canSave && saveRemaining) && <div className="hint">You can refund unused time after ending.</div>}
    </Modal>
  );
}

/** Shown after a session ends: receipt, and a refund shortcut for unused prepaid time. */
function EndDone({ station, session, onClose }: { station: Station; session: any; onClose(): void }) {
  const { money, can } = useApp();
  const [refunding, setRefunding] = useState(false);
  const detail = useQuery({
    queryKey: ['session', session.id],
    queryFn: () => get(`/api/sessions/${session.id}`),
  });
  const s = detail.data ?? session;
  return (
    <Modal
      title={`${station.name} — session ended`}
      onClose={onClose}
      footer={
        <>
          <ReceiptButton type="session" id={session.id} label="Print receipt" />
          {can('payments.refund') && s.unused?.amount > 0 && s.refundable > 0 && detail.data && (
            <button className="btn" onClick={() => setRefunding(true)}>
              Refund unused time
            </button>
          )}
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <dl className="kv">
        <dt>Time played</dt>
        <dd className="mono">{formatDuration(s.activeSeconds)}</dd>
        <dt>Total bill</dt>
        <dd>{money(s.netAmount)}</dd>
        <dt>Paid</dt>
        <dd>{money(s.paidAmount)}</dd>
        {s.onTab && (
          <>
            <dt>On tab</dt>
            <dd style={{ color: 'var(--warning)' }}>{money(s.netAmount - s.paidAmount)}</dd>
          </>
        )}
        {s.unused?.unusedMinutes > 0 && (
          <>
            <dt>Unused time</dt>
            <dd>
              {formatMinutes(s.unused.unusedMinutes)} · worth {money(s.unused.amount)}
            </dd>
          </>
        )}
      </dl>
      {refunding && <RefundModal session={s} onClose={() => setRefunding(false)} />}
    </Modal>
  );
}

interface FoundPlug {
  ip: string;
  driver: 'tasmota' | 'shelly_gen1' | 'shelly_gen2';
  name: string;
  model: string | null;
  mac: string | null;
  needsPassword?: boolean;
  usedBy: string | null;
}

/** Scans the venue network for Tasmota / Shelly plugs so nobody has to look up IP addresses. */
function PlugFinder({ onPick, onClose }: { onPick(p: FoundPlug): void; onClose(): void }) {
  const [subnet, setSubnet] = useState('');
  const scan = useMutation({
    mutationFn: (sn: string) => get(`/api/power/discover${sn ? `?subnet=${encodeURIComponent(sn)}` : ''}`) as Promise<{ subnet: string | null; plugs: FoundPlug[] }>,
    onSuccess: (r) => r.subnet && setSubnet(r.subnet),
  });
  useEffect(() => {
    scan.mutate('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const label = {
    tasmota: 'Tasmota',
    shelly_gen1: 'Shelly Gen 1',
    shelly_gen2: 'Shelly Plus / Gen 2–3',
  } as const;
  return (
    <div className="full card" style={{ padding: 12 }}>
      <div className="toolbar" style={{ marginBottom: 8 }}>
        <strong style={{ fontSize: 14 }}>Plugs found on the network</strong>
        <input className="input" style={{ width: 150 }} value={subnet} onChange={(e) => setSubnet(e.target.value)} placeholder="192.168.1" />
        <button type="button" className="btn btn-sm" disabled={scan.isPending} onClick={() => scan.mutate(subnet.trim())}>
          {scan.isPending ? 'Scanning…' : 'Scan again'}
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
      {scan.isPending && <div style={{ fontSize: 13 }}>Scanning {subnet || 'your network'} — takes up to 10 seconds…</div>}
      {scan.error && <ErrorBox error={scan.error} />}
      {scan.data && !scan.data.subnet && <div style={{ fontSize: 13 }}>Type your network's first three numbers (e.g. 192.168.100) and press Scan again.</div>}
      {scan.data?.subnet && !scan.isPending && scan.data.plugs.length === 0 && (
        <div style={{ fontSize: 13 }}>No Tasmota or Shelly plugs found on {scan.data.subnet}.x. Check the plug finished its Wi-Fi setup and is on the same network as this PC.</div>
      )}
      {!scan.isPending &&
        scan.data?.plugs.map((p) => (
          <div
            key={p.ip}
            className="toolbar"
            style={{
              justifyContent: 'space-between',
              borderTop: '1px solid var(--border)',
              padding: '6px 0',
            }}
          >
            <span style={{ fontSize: 13 }}>
              <strong>{p.name}</strong> · <span className="mono">{p.ip}</span> · {label[p.driver]}
              {p.model ? ` · ${p.model}` : ''}
              {p.needsPassword ? ' · password needed' : ''}
              {p.usedBy ? ` · used by ${p.usedBy}` : ''}
            </span>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => onPick(p)}>
              Use this
            </button>
          </div>
        ))}
    </div>
  );
}

const SECRET_LABEL = {
  password: 'hasPassword',
  deviceKey: 'hasDeviceKey',
  token: 'hasToken',
  authHeader: 'hasAuthHeader',
} as const;

/** Pair a PC / Android TV screen app with this station, see its status, or unpair it. */
function ScreenPairing({ station }: { station: Station }) {
  const qc = useQueryClient();
  const { toast } = useApp();
  const code = useMutation({
    mutationFn: () => post(`/api/stations/${station.id}/agent-code`),
  });
  const unpair = useMutation({
    mutationFn: () => del(`/api/stations/${station.id}/agent`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stations'] });
      toast('success', 'Screen unpaired');
    },
  });
  const info = station.agentInfo;
  return (
    <div className="full card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="toolbar">
        {info ? (
          <span style={{ fontSize: 13 }}>
            <span className={`badge ${station.agentOnline ? 'badge-success' : 'badge-danger'}`}>{station.agentOnline ? 'Online' : 'Offline'}</span>{' '}
            {info.kind === 'android_tv' ? 'Android TV' : info.kind === 'pc' ? 'Windows PC' : info.kind === 'ps5' ? 'PS5 payload' : info.kind === 'ps4' ? 'PS4 payload' : 'App'}
            {info.name ? ` · ${info.name}` : ''}
            {info.version ? ` · v${info.version}` : ''}
            {info.ip ? ` · ${info.ip}` : ''}
          </span>
        ) : (
          <span className="dim" style={{ fontSize: 13 }}>
            No screen app paired. Install ZENAA Station (Windows) or ZENAA TV (Android TV) from Integrations → Station screen apps, or send the timer to a jailbroken PS4/PS5 below.
          </span>
        )}
        <div className="spacer" />
        <button type="button" className="btn btn-sm btn-primary" disabled={code.isPending} onClick={() => code.mutate()}>
          {info ? 'Pair another screen' : 'Pair a screen'}
        </button>
        {info && (
          <button type="button" className="btn btn-sm btn-ghost" disabled={unpair.isPending} onClick={() => window.confirm('Unpair every screen of this station?') && unpair.mutate()}>
            Unpair
          </button>
        )}
      </div>
      <ErrorBox error={code.error || unpair.error} />
      {code.data && (
        <div style={{ textAlign: 'center' }}>
          <div className="dim" style={{ fontSize: 12 }}>
            On the PC or TV app, enter this server address and code (valid 10 minutes, one use):
          </div>
          <div className="mono" style={{ fontSize: 13 }}>
            {window.location.origin}
          </div>
          <div className="mono" style={{ fontSize: 40, fontWeight: 800, letterSpacing: '0.2em' }}>
            {code.data.code}
          </div>
        </div>
      )}
      <ConsoleSender station={station} />
    </div>
  );
}

/** Jailbroken PS4/PS5: send the ZENAA timer payload to the console's ELF loader, or download it. */
function ConsoleSender({ station }: { station: Station }) {
  const qc = useQueryClient();
  const { toast } = useApp();
  const key = `zenaa.console.${station.id}`;
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? '{}');
    } catch {
      return {};
    }
  })();
  const origin = window.location.origin;
  const isLocal = /\/\/(localhost|127\.|\[::1\])/.test(origin) || origin.startsWith('https:');
  const [open, setOpen] = useState(!!saved.host);
  const [f, setF] = useState({
    platform: (saved.platform ?? (station.platform === 'ps4' ? 'ps4' : 'ps5')) as 'ps4' | 'ps5',
    host: saved.host ?? '',
    port: String(saved.port ?? 9021),
    serverUrl: saved.serverUrl ?? (isLocal ? '' : origin),
  });
  const remember = () => {
    try {
      localStorage.setItem(key, JSON.stringify(f));
    } catch {
      /* ignore */
    }
  };
  const push = useMutation({
    mutationFn: () =>
      post(`/api/stations/${station.id}/console-push`, {
        platform: f.platform,
        host: f.host.trim(),
        port: Number(f.port) || 9021,
        serverUrl: f.serverUrl.trim(),
      }),
    onSuccess: () => {
      remember();
      qc.invalidateQueries({ queryKey: ['stations'] });
      toast('success', `Timer sent to the ${f.platform.toUpperCase()} — a "ZENAA timer started" notification should appear on the TV`);
    },
  });
  const download = useMutation({
    mutationFn: async () => {
      const q = new URLSearchParams({
        platform: f.platform,
        serverUrl: f.serverUrl.trim(),
      });
      const res = await fetch(`/api/stations/${station.id}/console-payload?${q}`, { headers: { authorization: `Bearer ${getToken() ?? ''}` } });
      if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => null))?.message ?? `Download failed (${res.status})`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `zenaa-${station.code.toLowerCase()}-${f.platform}.elf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      remember();
      qc.invalidateQueries({ queryKey: ['stations'] });
    },
  });
  if (!open)
    return (
      <button type="button" className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>
        🎮 Jailbroken PS4 / PS5? Send the timer to the console…
      </button>
    );
  return (
    <div
      style={{
        borderTop: '1px solid var(--border)',
        paddingTop: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <strong style={{ fontSize: 13 }}>Console timer (jailbroken PS4 / PS5)</strong>
      <div className="dim" style={{ fontSize: 12 }}>
        Shows "Game on", time-left reminders, staff messages and "Time is up" as PlayStation notifications over the game. The console must be jailbroken with an ELF loader running (PS5: etaHEN /
        elfldr, PS4: GoldHEN + elfldr). Retail consoles cannot run it — use ZENAA TV or a smart plug instead. Guide: Help → 16.
      </div>
      <div className="alert alert-info" style={{ fontSize: 13 }}>
        Easiest: on the console's own web browser open <b className="mono">{(isLocal ? 'http://<server-ip>:8080' : origin) + '/ps'}</b>, pick this station once, type your staff PIN and press Send. It
        detects the console and remembers everything — after a restart it is just PIN → Send. No internet needed.
      </div>
      <div className="form-grid">
        <Field label="Console">
          <Segmented
            value={f.platform}
            options={[
              { value: 'ps5', label: 'PS5' },
              { value: 'ps4', label: 'PS4' },
            ]}
            onChange={(v) => setF({ ...f, platform: v as 'ps4' | 'ps5' })}
          />
        </Field>
        <Field label="Console IP" hint="PS Settings → Network → View connection status">
          <input className="input mono" placeholder="192.168.1.50" value={f.host} onChange={(e) => setF({ ...f, host: e.target.value })} />
        </Field>
        <Field label="ELF loader port" hint="9021 for elfldr / etaHEN (default)">
          <input className="input mono" inputMode="numeric" value={f.port} onChange={(e) => setF({ ...f, port: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field
          label="ZENAA address the console uses"
          hint={isLocal ? 'You opened ZENAA as localhost/https: type the server PC network address, e.g. http://192.168.1.10:8080' : 'This server, as seen on the network'}
        >
          <input className="input mono" placeholder="http://192.168.1.10:8080" value={f.serverUrl} onChange={(e) => setF({ ...f, serverUrl: e.target.value })} />
        </Field>
      </div>
      <ErrorBox error={push.error || download.error} />
      <div className="toolbar">
        <button type="button" className="btn btn-sm btn-primary" disabled={push.isPending || !f.host || !f.serverUrl} onClick={() => push.mutate()}>
          {push.isPending ? 'Sending…' : `Send to ${f.platform.toUpperCase()}`}
        </button>
        <button type="button" className="btn btn-sm btn-ghost" disabled={download.isPending || !f.serverUrl} onClick={() => download.mutate()}>
          Download .elf
        </button>
        <span className="dim" style={{ fontSize: 12 }}>
          Send again after every console restart (or set the .elf to autoload).
        </span>
      </div>
    </div>
  );
}

function StationForm({ station, onClose }: { station: Station | null; onClose(): void }) {
  const { settings, toast, can } = useApp();
  const qc = useQueryClient();
  const cats = useQuery({
    queryKey: ['categories'],
    queryFn: () => get('/api/station-categories'),
  });
  const ewelink = useQuery({
    queryKey: ['ewelink'],
    queryFn: () => get('/api/integrations/ewelink'),
    staleTime: 60_000,
  });
  const pc = station?.powerConfig ?? {};
  const [f, setF] = useState({
    code: station?.code ?? '',
    name: station?.name ?? '',
    platform: station?.platform ?? 'ps5',
    categoryId: station?.categoryId ?? '',
    status: station?.status ?? 'active',
    override: toMajorString(station?.hourlyRateOverride, settings.currencyMinorUnits),
    notes: station?.notes ?? '',
    sortOrder: station?.sortOrder ?? 0,
    powerDriver: (station?.powerDriver ?? 'none') as DriverKey | 'none',
    host: pc.host ?? '',
    deviceId: pc.deviceId ?? '',
    deviceKey: '',
    channel: pc.channel != null ? String(pc.channel) : '',
    username: pc.username ?? '',
    password: '',
    entityId: pc.entityId ?? '',
    token: '',
    onUrl: pc.onUrl ?? '',
    offUrl: pc.offUrl ?? '',
    statusUrl: pc.statusUrl ?? '',
    method: pc.method ?? 'GET',
    onBody: pc.onBody ?? '',
    offBody: pc.offBody ?? '',
    contentType: pc.contentType ?? '',
    authHeader: '',
    statusOnMatch: pc.statusOnMatch ?? '',
    room: station?.room ?? '',
    vncHost: station?.vncConfig?.host ?? '',
    vncPort: String(station?.vncConfig?.port ?? 5900),
    vncPassword: '',
  });
  const [model, setModel] = useState('');
  const d = f.powerDriver;
  const powerConfig = () => {
    const v = (x: string) => x.trim() || undefined;
    const base: Record<string, unknown> = {
      host: v(f.host),
      channel: f.channel.trim() ? Number(f.channel) : undefined,
    };
    if (d === 'sonoff_lan' || d === 'sonoff_diy' || d === 'ewelink_cloud')
      Object.assign(base, {
        deviceId: v(f.deviceId),
        deviceKey: d === 'sonoff_lan' ? v(f.deviceKey) : undefined,
      });
    if (d === 'tasmota' || d === 'shelly_gen1' || d === 'esphome')
      Object.assign(base, {
        username: v(f.username),
        password: f.password || undefined,
      });
    if (d === 'esphome' || d === 'home_assistant') base.entityId = v(f.entityId);
    if (d === 'home_assistant') base.token = v(f.token);
    if (d === 'ewelink_cloud') base.host = undefined;
    if (d === 'generic_http') {
      Object.assign(base, {
        host: undefined,
        onUrl: v(f.onUrl),
        offUrl: v(f.offUrl),
        statusUrl: v(f.statusUrl),
        method: f.method,
        onBody: f.onBody || undefined,
        offBody: f.offBody || undefined,
        contentType: v(f.contentType),
        authHeader: f.authHeader || undefined,
        statusOnMatch: f.statusOnMatch || undefined,
      });
    }
    return base;
  };
  const [testResult, setTestResult] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const test = useMutation({
    mutationFn: (action: 'status' | 'on' | 'off') =>
      post('/api/power/test', {
        driver: d,
        config: powerConfig(),
        action,
        stationId: station?.id,
      }),
    onSuccess: (r: any) => setTestResult(r.ok ? (r.note ? `✓ ${r.note}` : `✓ Connected — the plug is ${r.state.toUpperCase()}`) : `✗ ${r.error}`),
    onError: (e: Error) => setTestResult(`✗ ${e.message}`),
  });
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const m = useMutation({
    mutationFn: () => {
      const override = f.override.trim() ? parseMoney(f.override, settings.currencyMinorUnits) : null;
      if (f.override.trim() && override == null) throw new Error('Rate override is not a valid amount');
      const body = {
        code: f.code,
        name: f.name,
        platform: f.platform,
        categoryId: f.categoryId || null,
        status: f.status,
        hourlyRateOverride: override,
        notes: f.notes || null,
        sortOrder: Number(f.sortOrder) || 0,
        powerDriver: d,
        powerConfig: d === 'none' ? null : powerConfig(),
        room: f.room.trim() || null,
        vncConfig: {
          host: f.vncHost.trim(),
          port: Number(f.vncPort) || 5900,
          password: f.vncPassword || undefined,
        },
      };
      return station ? patch(`/api/stations/${station.id}`, body) : post('/api/stations', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stations'] });
      toast('success', station ? 'Station updated' : 'Station added');
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => del(`/api/stations/${station!.id}`),
    onSuccess: (r: any) => {
      qc.invalidateQueries({ queryKey: ['stations'] });
      toast('success', r.removed === 'deleted' ? `${station!.name} deleted` : `${station!.name} deleted — its past sessions stay in the reports`);
      onClose();
    },
  });
  const needsHost = !['none', 'generic_http', 'ewelink_cloud'].includes(d);
  const ready = d === 'none' || (d === 'generic_http' ? f.onUrl.trim() && f.offUrl.trim() : d === 'ewelink_cloud' ? f.deviceId.trim() : f.host.trim());
  const saved = (k: keyof typeof SECRET_LABEL) => (pc[SECRET_LABEL[k]] ? 'Saved — leave blank to keep it' : undefined);
  const imported: any[] = (ewelink.data as any)?.devices ?? [];
  const pickModel = (key: string) => {
    setModel(key);
    const dev = DEVICES.find((x) => x.brand + ' ' + x.model === key);
    if (dev) {
      setF({ ...f, powerDriver: dev.best });
      setTestResult(null);
    }
  };
  const dev = DEVICES.find((x) => x.brand + ' ' + x.model === model);
  return (
    <Modal
      wide
      title={station ? `Edit ${station.name}` : 'Add station'}
      onClose={onClose}
      footer={
        <>
          {station && can('stations.manage') && (
            <button
              className="btn btn-ghost"
              style={{ color: 'var(--danger)', marginRight: 'auto' }}
              disabled={remove.isPending}
              onClick={() =>
                window.confirm(
                  `Delete ${station.name} (${station.code})?\n\nA station that was never used is removed completely. One with past sessions is hidden, and its history stays in reports.`,
                ) && remove.mutate()
              }
            >
              <Trash2 size={15} /> Delete station
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={m.isPending || !f.code || !f.name || !ready} onClick={() => m.mutate()}>
            Save
          </button>
        </>
      }
    >
      <ErrorBox error={m.error || remove.error} />
      <div className="form-grid">
        <Field label="Code">
          <input className="input" value={f.code} onChange={set('code')} placeholder="PS-01" />
        </Field>
        <Field label="Name">
          <input className="input" value={f.name} onChange={set('name')} placeholder="PS5 Station 1" />
        </Field>
        <Field label="Platform">
          <select className="select" value={f.platform} onChange={set('platform')}>
            {Object.entries(PLATFORM_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Category">
          <select className="select" value={f.categoryId} onChange={set('categoryId')}>
            <option value="">— None —</option>
            {(cats.data ?? []).map((c: any) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status" hint="Cannot change while a session is active">
          <select className="select" value={f.status} onChange={set('status')}>
            <option value="active">Active</option>
            <option value="maintenance">Maintenance</option>
            <option value="offline">Offline</option>
            {station && <option value="archived">Archived (hide)</option>}
          </select>
        </Field>
        <Field label={`Hourly rate override (${settings.currencyCode})`} hint="Leave blank to use the plan rate">
          <input className="input" inputMode="decimal" value={f.override} onChange={set('override')} />
        </Field>
        <Field label="Display order">
          <input className="input" type="number" value={f.sortOrder} onChange={set('sortOrder')} />
        </Field>
        <Field label="Room" hint="e.g. Downstairs, Upstairs, VIP room — stations are grouped by room">
          <input className="input" list="zenaa-rooms" value={f.room} onChange={set('room')} placeholder="Downstairs" maxLength={40} />
          <datalist id="zenaa-rooms">
            {[...new Set((qc.getQueryData<Station[]>(['stations']) ?? []).map((x: Station) => x.room).filter(Boolean))].map((r) => (
              <option key={r as string} value={r as string} />
            ))}
          </datalist>
        </Field>
        <Field label="Notes" full>
          <textarea className="textarea" value={f.notes} onChange={set('notes')} />
        </Field>
      </div>
      <h3 className="section-title">
        <MonitorPlay size={16} /> Remote view (VNC)
      </h3>
      <p className="dim" style={{ fontSize: 13, marginTop: 0 }}>
        See and control this station's screen from ZENAA. Install a VNC server on the station computer (TightVNC or UltraVNC; Android TV: droidVNC-NG) and set a password there. Help → 22.
      </p>
      <div className="form-grid">
        <Field
          label="Computer address"
          hint={station?.agentInfo?.ip ? `Blank = the address its ZENAA screen app reports (${String(station.agentInfo.ip).replace('::ffff:', '')})` : 'e.g. 192.168.1.21 — reserve it in your router'}
        >
          <input className="input mono" value={f.vncHost} onChange={set('vncHost')} placeholder={station?.agentInfo?.ip ? String(station.agentInfo.ip).replace('::ffff:', '') : '192.168.1.21'} />
        </Field>
        <Field label="Port">
          <input className="input" type="number" min={1} max={65535} value={f.vncPort} onChange={set('vncPort')} />
        </Field>
        <Field label="VNC password" hint={station?.vncConfig?.hasPassword ? 'Saved — leave blank to keep it' : 'The password set in the VNC server'}>
          <PasswordInput className="input" autoComplete="new-password" value={f.vncPassword} onChange={set('vncPassword')} />
        </Field>
      </div>
      <h3 className="section-title">
        <Power size={16} /> Smart plug (automatic power)
      </h3>
      <div className="form-grid">
        <Field label="Help me choose — my device is…" hint={dev ? dev.note : 'Optional: pick your model and the right plug type is selected'}>
          <select className="select" value={model} onChange={(e) => pickModel(e.target.value)}>
            <option value="">— Choose a model —</option>
            {[...new Set(DEVICES.map((x) => x.brand))].map((b) => (
              <optgroup key={b} label={b}>
                {DEVICES.filter((x) => x.brand === b).map((x) => (
                  <option key={x.model} value={x.brand + ' ' + x.model}>
                    {x.model}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label="Plug type" hint={DRIVER_HINT[d]}>
          <select className="select" value={d} onChange={(e) => (setF({ ...f, powerDriver: e.target.value as DriverKey }), setTestResult(null))}>
            {(Object.keys(DRIVER_LABEL) as (DriverKey | 'none')[]).map((k) => (
              <option key={k} value={k}>
                {DRIVER_LABEL[k]}
              </option>
            ))}
          </select>
        </Field>
        {needsHost && (
          <Field
            label={d === 'home_assistant' ? 'Home Assistant address' : 'Device IP address'}
            hint={d === 'home_assistant' ? 'e.g. http://192.168.1.20:8123' : 'Reserve this address in your router (DHCP reservation)'}
          >
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="input" value={f.host} onChange={set('host')} placeholder={d === 'home_assistant' ? 'http://192.168.1.20:8123' : '192.168.1.50'} />
              {(d === 'tasmota' || d.startsWith('shelly')) && (
                <button type="button" className="btn btn-sm" onClick={() => setFinding(true)}>
                  Find
                </button>
              )}
            </div>
          </Field>
        )}
        {finding && (
          <PlugFinder
            onClose={() => setFinding(false)}
            onPick={(p) => {
              setF({ ...f, host: p.ip, powerDriver: p.driver });
              setFinding(false);
              setTestResult(null);
            }}
          />
        )}
        {(d === 'sonoff_lan' || d === 'sonoff_diy' || d === 'ewelink_cloud') && (
          <>
            {imported.length > 0 && (
              <Field label="From your eWeLink account" hint="Fills in the device ID (and the IP, if found)">
                <select
                  className="select"
                  value=""
                  onChange={(e) => {
                    const x = imported.find((i) => i.deviceid === e.target.value);
                    if (x)
                      setF({
                        ...f,
                        deviceId: x.deviceid,
                        host: x.ip ?? f.host,
                      });
                  }}
                >
                  <option value="">— Pick a device —</option>
                  {imported.map((x) => (
                    <option key={x.deviceid} value={x.deviceid}>
                      {x.name} · {x.deviceid}
                      {x.usedBy ? ` (used by ${x.usedBy})` : ''}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field label="Device ID" hint="10 characters, e.g. 1000a1b2c3 — eWeLink app → device → ⋯ → Device info">
              <input className="input mono" value={f.deviceId} onChange={set('deviceId')} placeholder="1000abcdef" />
            </Field>
            {d === 'sonoff_lan' && (
              <Field
                label="Device key"
                hint={
                  saved('deviceKey') ??
                  (imported.some((x) => x.deviceid === f.deviceId.trim() && x.hasKey)
                    ? 'Leave blank — ZENAA has this key from your eWeLink import'
                    : 'Import your eWeLink account (Integrations) and leave this blank')
                }
              >
                <PasswordInput className="input mono" autoComplete="off" value={f.deviceKey} onChange={set('deviceKey')} placeholder="leave blank if imported" />
              </Field>
            )}
          </>
        )}
        {(d === 'esphome' || d === 'home_assistant') && (
          <Field
            label={d === 'esphome' ? 'Switch ID' : 'Entity ID'}
            hint={d === 'esphome' ? 'The id: of the switch in your ESPHome YAML, e.g. relay' : 'Settings → Entities, e.g. switch.ps5_tv_plug or media_player.tv'}
          >
            <input className="input mono" value={f.entityId} onChange={set('entityId')} placeholder={d === 'esphome' ? 'relay' : 'switch.ps5_tv_plug'} />
          </Field>
        )}
        {d === 'home_assistant' && (
          <Field label="Long-lived access token" hint={saved('token') ?? 'Home Assistant → your profile → Security → Long-lived access tokens'}>
            <PasswordInput className="input mono" autoComplete="off" value={f.token} onChange={set('token')} />
          </Field>
        )}
        {d === 'generic_http' && (
          <>
            <Field label="ON address" full>
              <input className="input mono" value={f.onUrl} onChange={set('onUrl')} placeholder="http://192.168.1.60/relay/on" />
            </Field>
            <Field label="OFF address" full>
              <input className="input mono" value={f.offUrl} onChange={set('offUrl')} placeholder="http://192.168.1.60/relay/off" />
            </Field>
            <Field label="Status address (optional)">
              <input className="input mono" value={f.statusUrl} onChange={set('statusUrl')} placeholder="http://192.168.1.60/relay/status" />
            </Field>
            <Field label="ON looks like" hint='Text in the status answer when on, e.g. relay=1 or "state":"ON" — or /regex/'>
              <input className="input mono" value={f.statusOnMatch} onChange={set('statusOnMatch')} placeholder="relay=1" />
            </Field>
            <Field label="Method">
              <select className="select" value={f.method} onChange={set('method')}>
                <option>GET</option>
                <option>POST</option>
                <option>PUT</option>
              </select>
            </Field>
            <Field label="Authorization header (optional)" hint={saved('authHeader') ?? 'e.g. Bearer abc123 — kept secret'}>
              <PasswordInput className="input mono" autoComplete="off" value={f.authHeader} onChange={set('authHeader')} />
            </Field>
            {f.method !== 'GET' && (
              <>
                <Field label="ON body">
                  <textarea className="textarea mono" value={f.onBody} onChange={set('onBody')} placeholder='{"on": true}' />
                </Field>
                <Field label="OFF body">
                  <textarea className="textarea mono" value={f.offBody} onChange={set('offBody')} placeholder='{"on": false}' />
                </Field>
              </>
            )}
          </>
        )}
        {d !== 'none' && d !== 'generic_http' && d !== 'home_assistant' && d !== 'esphome' && (
          <Field label="Channel / outlet" hint="Only for multi-channel devices (DUALR3, 4CH, Shelly 2PM) — Tasmota 1–4, eWeLink 0–3, Shelly 0–3">
            <input className="input" inputMode="numeric" value={f.channel} onChange={set('channel')} placeholder="leave blank" />
          </Field>
        )}
        {(d === 'tasmota' || d === 'shelly_gen1' || d === 'esphome') && (
          <>
            <Field label="Device username">
              <input className="input" value={f.username} onChange={set('username')} placeholder="optional" />
            </Field>
            <Field label="Device password" hint={saved('password')}>
              <PasswordInput className="input" value={f.password} onChange={set('password')} placeholder="optional" />
            </Field>
          </>
        )}
        {d !== 'none' && (
          <div className="full toolbar">
            <button type="button" className="btn btn-sm" disabled={!ready || test.isPending} onClick={() => test.mutate('status')}>
              Test connection
            </button>
            <button type="button" className="btn btn-sm" disabled={!ready || test.isPending} onClick={() => test.mutate('on')}>
              Test ON
            </button>
            <button type="button" className="btn btn-sm" disabled={!ready || test.isPending} onClick={() => test.mutate('off')}>
              Test OFF
            </button>
            {testResult && (
              <span
                style={{
                  fontSize: 13,
                  color: testResult.startsWith('✓') ? 'var(--success)' : 'var(--danger)',
                }}
              >
                {testResult}
              </span>
            )}
          </div>
        )}
      </div>
      {station && (
        <>
          <h3 className="section-title">
            <Monitor size={16} /> Station screen (timer on the TV / PC)
          </h3>
          <div className="form-grid">
            <ScreenPairing station={station} />
          </div>
        </>
      )}
    </Modal>
  );
}

/** "Turn on — no charge": staff unlock without a session (game updates, testing, events). Needs stations.bypass or a manager PIN. */
function TurnOnButton({ s }: { s: Station }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn btn-sm btn-ghost" onClick={() => setOpen(true)} title="Switch on and unlock the screen without charging (staff use)">
        <Power size={14} /> Turn on (no charge)
      </button>
      {open && <TurnOnModal s={s} onClose={() => setOpen(false)} />}
    </>
  );
}

function TurnOnModal({ s, onClose }: { s: Station; onClose(): void }) {
  const { toast } = useApp();
  const qc = useQueryClient();
  const [minutes, setMinutes] = useState(30);
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => post(`/api/stations/${s.id}/bypass`, { minutes, reason: reason || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stations'] });
      toast('success', `${s.name} is on — no charge${minutes ? ` for ${minutes} min` : ''}`);
      onClose();
    },
  });
  return (
    <Modal
      title={`Turn on ${s.name} — no charge`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={m.isPending} onClick={() => m.mutate()}>
            <Power size={16} /> Turn on
          </button>
        </>
      }
    >
      <p className="dim" style={{ marginTop: 0 }}>
        Switches the plug on and unlocks the screen apps without a session — nothing is charged or added to revenue. Use it for game updates, testing controllers, staff play or events. It is recorded
        in the audit trail with your name.
      </p>
      <Field label="For how long">
        <Segmented
          value={String(minutes)}
          onChange={(v) => setMinutes(Number(v))}
          options={[
            { value: '15', label: '15 min' },
            { value: '30', label: '30 min' },
            { value: '60', label: '1 h' },
            { value: '120', label: '2 h' },
            { value: '0', label: 'Until I turn it off' },
          ]}
        />
      </Field>
      <Field label="Reason (optional)">
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. FC 26 update, controller test" />
      </Field>
      <ErrorBox error={m.error} />
    </Modal>
  );
}

function StaffUseBlock({ s, onStart }: { s: Station; onStart(): void }) {
  const { can, toast } = useApp();
  const qc = useQueryClient();
  const x = s as any;
  const left = x.bypassUntil ? Math.max(0, Math.round((Date.parse(x.bypassUntil) - Date.now()) / 1000)) : 0;
  const off = useMutation({
    mutationFn: () => del(`/api/stations/${s.id}/bypass`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stations'] }),
    onError: (e: Error) => toast('error', e.message),
  });
  return (
    <>
      <div>
        <div className="timer">{left > 11 * 3600 ? 'ON' : formatDuration(left)}</div>
        <div className="dim" style={{ fontSize: 12 }}>
          Staff use, no charge{x.bypassByName ? ` · by ${x.bypassByName}` : ''}
        </div>
      </div>
      {can('sessions.operate') && (
        <div className="station-actions">
          <button className="btn btn-primary btn-sm" onClick={onStart}>
            <Play size={14} /> Start paid session
          </button>
          <button className="btn btn-sm btn-danger" disabled={off.isPending} onClick={() => off.mutate()}>
            <Square size={14} /> Turn off
          </button>
        </div>
      )}
    </>
  );
}

/** How much a customer already owes and their limit (credit), shown before putting more on their account. */
function AccountInfo({ customer, amount }: { customer: any; amount: number }) {
  const { money, settings } = useApp();
  const limit = customer.creditLimit > 0 ? customer.creditLimit : (settings.defaultCreditLimit ?? 0);
  const after = (customer.outstanding ?? 0) + amount;
  return (
    <div className={`hint ${limit <= 0 || after > limit ? 'error-text' : ''}`}>
      {customer.fullName} owes {money(customer.outstanding ?? 0)} now
      {limit > 0 ? ` · limit ${money(limit)}${customer.creditLimit > 0 ? '' : ' (default)'} · after this ${money(after)}` : ' · no credit limit set'}
      {limit <= 0 && ' — set one on their customer page, or a default in Settings → Operations.'}
      {limit > 0 && after > limit && ' — this is over the limit.'}
    </div>
  );
}

/** Start session: "Collect now" or "Put it on the account (pay later)". */
function AccountChoice({ customer, value, onChange, amount }: { customer: any; value: boolean; onChange(v: boolean): void; amount: number }) {
  return (
    <>
      <Field label="Payment">
        <Segmented
          value={value ? 'later' : 'now'}
          onChange={(v) => onChange(v === 'later')}
          options={[
            { value: 'now', label: 'Paying now' },
            { value: 'later', label: 'Put on account (pay later)' },
          ]}
        />
      </Field>
      {value && <AccountInfo customer={customer} amount={amount} />}
    </>
  );
}
