import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, Pencil, Plus, Volume2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MoneyInput } from '../components/money';
import { DeleteButton } from '../components/DeleteButton';
import { ErrorBox, Field, Modal, PageHeader, Segmented } from '../components/ui';
import { get, patch, post } from '../lib/api';
import { useApp } from '../lib/app-context';
import { previewAnnouncement } from '../lib/announcer';
import { formatDateTime, parseMoney, toMajorString } from '../lib/format';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const fromHHMM = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + (m || 0);
};
/** Date → value for <input type="datetime-local"> in local time. */
const toLocalInput = (d: string | null) => {
  if (!d) return '';
  const x = new Date(d);
  return new Date(x.getTime() - x.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
function daysLabel(days: number[]) {
  const k = [...days].sort().join(',');
  if (k === '0,1,2,3,4,5,6') return 'Every day';
  if (k === '1,2,3,4,5') return 'Weekdays';
  if (k === '0,6') return 'Weekends';
  return days.map((d) => DAYS[d]).join(', ');
}

export function PromotionsPage() {
  return (
    <>
      <PageHeader
        title="Promotions"
        subtitle={
          <>
            Happy-hour discounts apply automatically when a session starts; promo codes are entered at payment. Bonuses for following your pages and bonus codes
            are under <Link to="/rewards">Rewards</Link>.
          </>
        }
      />
      <PlayPackages />
      <HappyHours />
      <PromoCodes />
    </>
  );
}

function HappyHours() {
  const q = useQuery({ queryKey: ['happy-hours'], queryFn: () => get('/api/happy-hours') });
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => get('/api/station-categories') });
  const [editing, setEditing] = useState<any | 'new' | null>(null);
  const catName = (id: string | null) => (id ? (cats.data ?? []).find((c: any) => c.id === id)?.name ?? '—' : 'All stations');
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Happy hours</h2>
          <div className="dim" style={{ fontSize: 12 }}>
            The better of the happy-hour and member-tier discount is used — they do not stack.
          </div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
          <Plus size={14} /> Add happy hour
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Days</th>
              <th>Time</th>
              <th>Stations</th>
              <th className="right">Discount</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {q.data?.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No happy hours yet
                </td>
              </tr>
            )}
            {(q.data ?? []).map((h: any) => (
              <tr key={h.id} style={{ opacity: h.active ? 1 : 0.55 }}>
                <td style={{ fontWeight: 600 }}>{h.name}</td>
                <td>{daysLabel(h.days)}</td>
                <td className="mono">
                  {h.startMinute === h.endMinute ? 'All day' : `${toHHMM(h.startMinute)}–${toHHMM(h.endMinute)}`}
                  {h.endMinute < h.startMinute && <span className="dim"> (overnight)</span>}
                </td>
                <td>{catName(h.categoryId)}</td>
                <td className="right num">{h.discountPercent}%</td>
                <td>{h.active ? <span className="badge badge-success">Active</span> : <span className="badge">Off</span>}</td>
                <td className="right">
                  <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setEditing(h)} aria-label="Edit">
                    <Pencil size={14} />
                  </button>
                  <DeleteButton icon url={`/api/happy-hours/${h.id}`} what={`happy hour "${h.name}"`} refresh={[['happy-hours'], ['happyHours']]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <HappyHourForm rule={editing === 'new' ? null : editing} categories={cats.data ?? []} onClose={() => setEditing(null)} />}
    </div>
  );
}

function HappyHourForm({ rule, categories, onClose }: { rule: any | null; categories: any[]; onClose(): void }) {
  const { toast } = useApp();
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: rule?.name ?? '',
    days: (rule?.days ?? [1, 2, 3, 4, 5]) as number[],
    start: toHHMM(rule?.startMinute ?? 12 * 60),
    end: toHHMM(rule?.endMinute ?? 16 * 60),
    discountPercent: rule?.discountPercent ?? 20,
    categoryId: rule?.categoryId ?? '',
    active: rule?.active ?? true,
  });
  const toggleDay = (d: number) => setF({ ...f, days: f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d] });
  const m = useMutation({
    mutationFn: () => {
      const body = {
        name: f.name,
        days: f.days,
        startMinute: fromHHMM(f.start),
        endMinute: fromHHMM(f.end),
        discountPercent: Number(f.discountPercent),
        categoryId: f.categoryId || null,
        active: f.active,
      };
      return rule ? patch(`/api/happy-hours/${rule.id}`, body) : post('/api/happy-hours', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['happy-hours'] });
      qc.invalidateQueries({ queryKey: ['happy-now'] });
      toast('success', rule ? 'Happy hour updated' : 'Happy hour added');
      onClose();
    },
  });
  return (
    <Modal
      title={rule ? `Edit ${rule.name}` : 'Add happy hour'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!f.name || !f.days.length || m.isPending} onClick={() => m.mutate()}>
            Save
          </button>
        </>
      }
    >
      <ErrorBox error={m.error} />
      <div className="form-grid">
        <Field label="Name" full>
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Weekday afternoons" autoFocus />
        </Field>
        <Field label="Days" full>
          <div className="toolbar">
            {DAYS.map((d, i) => (
              <button type="button" key={d} className={`btn btn-sm ${f.days.includes(i) ? 'btn-primary' : ''}`} onClick={() => toggleDay(i)}>
                {d}
              </button>
            ))}
          </div>
        </Field>
        <Field label="From">
          <input className="input" type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />
        </Field>
        <Field label="Until" hint="Earlier than “From” = runs past midnight. Same time = all day.">
          <input className="input" type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} />
        </Field>
        <Field label="Discount %">
          <input className="input" type="number" min={1} max={100} value={f.discountPercent} onChange={(e) => setF({ ...f, discountPercent: Number(e.target.value) })} />
        </Field>
        <Field label="Stations">
          <select className="select" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
            <option value="">All stations</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                Category: {c.name}
              </option>
            ))}
          </select>
        </Field>
        <label className="check">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active
        </label>
      </div>
    </Modal>
  );
}

function PromoCodes() {
  const { money } = useApp();
  const q = useQuery({ queryKey: ['promo-codes'], queryFn: () => get('/api/promo-codes') });
  const [editing, setEditing] = useState<any | 'new' | null>(null);
  return (
    <div className="card">
      <div className="card-head">
        <h2>Promo codes</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
          <Plus size={14} /> Add promo code
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Offer</th>
              <th>Valid</th>
              <th className="right">Used</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {q.data?.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No promo codes yet
                </td>
              </tr>
            )}
            {(q.data ?? []).map((p: any) => {
              const expired = p.validTo && new Date(p.validTo) < new Date();
              const usedUp = p.maxUses != null && p.usesCount >= p.maxUses;
              return (
                <tr key={p.id} style={{ opacity: p.active && !expired && !usedUp ? 1 : 0.55 }}>
                  <td className="mono" style={{ fontWeight: 700 }}>
                    {p.code}
                    {p.showInPortal && <span className="badge badge-info" style={{ marginLeft: 6, fontFamily: 'inherit' }}>in app</span>}
                    {p.description && <div className="dim" style={{ fontWeight: 400, fontFamily: 'inherit', fontSize: 12 }}>{p.description}</div>}
                  </td>
                  <td>
                    {p.percentOff != null ? `${p.percentOff}% off` : `${money(p.amountOff)} off`}
                    {p.minSpend > 0 && <span className="dim"> · min {money(p.minSpend)}</span>}
                  </td>
                  <td className="dim">
                    {p.validFrom ? formatDateTime(p.validFrom) : 'Now'} → {p.validTo ? formatDateTime(p.validTo) : 'no end'}
                  </td>
                  <td className="right num">
                    {p.usesCount}
                    {p.maxUses != null ? ` / ${p.maxUses}` : ''}
                  </td>
                  <td>
                    {!p.active ? <span className="badge">Off</span> : expired ? <span className="badge badge-danger">Expired</span> : usedUp ? <span className="badge badge-warning">Used up</span> : <span className="badge badge-success">Active</span>}
                  </td>
                  <td className="right">
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setEditing(p)} aria-label="Edit">
                      <Pencil size={14} />
                    </button>
                    <DeleteButton icon url={`/api/promo-codes/${p.id}`} what={`promo code ${p.code}`} refresh={[['promo-codes'], ['promoCodes']]} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editing && <PromoForm promo={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PromoForm({ promo, onClose }: { promo: any | null; onClose(): void }) {
  const { settings, toast } = useApp();
  const qc = useQueryClient();
  const mu = settings.currencyMinorUnits;
  const [type, setType] = useState<'percent' | 'amount'>(promo?.amountOff != null ? 'amount' : 'percent');
  const [f, setF] = useState({
    code: promo?.code ?? '',
    description: promo?.description ?? '',
    percentOff: promo?.percentOff ?? 10,
    amountOff: toMajorString(promo?.amountOff, mu),
    minSpend: promo?.minSpend ? toMajorString(promo.minSpend, mu) : '',
    validFrom: toLocalInput(promo?.validFrom ?? null),
    validTo: toLocalInput(promo?.validTo ?? null),
    maxUses: promo?.maxUses ?? '',
    active: promo?.active ?? true,
    showInPortal: promo?.showInPortal ?? false,
  });
  const m = useMutation({
    mutationFn: () => {
      const amountOff = type === 'amount' ? parseMoney(f.amountOff, mu) : null;
      if (type === 'amount' && (amountOff == null || amountOff <= 0)) throw new Error('Enter the amount off');
      const minSpend = f.minSpend.trim() ? parseMoney(f.minSpend, mu) : 0;
      if (minSpend == null) throw new Error('Minimum spend is not a valid amount');
      const body: any = {
        description: f.description || null,
        percentOff: type === 'percent' ? Number(f.percentOff) : null,
        amountOff,
        minSpend,
        validFrom: f.validFrom ? new Date(f.validFrom).toISOString() : null,
        validTo: f.validTo ? new Date(f.validTo).toISOString() : null,
        maxUses: f.maxUses === '' ? null : Number(f.maxUses),
        active: f.active,
        showInPortal: f.showInPortal,
      };
      return promo ? patch(`/api/promo-codes/${promo.id}`, body) : post('/api/promo-codes', { ...body, code: f.code });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['promo-codes'] });
      toast('success', promo ? 'Promo code updated' : 'Promo code created');
      onClose();
    },
  });
  return (
    <Modal
      title={promo ? `Edit ${promo.code}` : 'Add promo code'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={(!promo && f.code.length < 3) || m.isPending} onClick={() => m.mutate()}>
            Save
          </button>
        </>
      }
    >
      <ErrorBox error={m.error} />
      <div className="form-grid">
        <Field label="Code" hint={promo ? 'Codes cannot be renamed' : 'Letters, numbers, - and _'}>
          <input className="input mono" disabled={!!promo} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="WELCOME10" autoFocus />
        </Field>
        <Field label="Description">
          <input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="First visit offer" />
        </Field>
        <Field label="Discount type" full>
          <Segmented
            value={type}
            onChange={setType}
            options={[
              { value: 'percent', label: 'Percentage' },
              { value: 'amount', label: 'Fixed amount' },
            ]}
          />
        </Field>
        {type === 'percent' ? (
          <Field label="Percent off">
            <input className="input" type="number" min={1} max={100} value={f.percentOff} onChange={(e) => setF({ ...f, percentOff: Number(e.target.value) })} />
          </Field>
        ) : (
          <Field label={`Amount off (${settings.currencyCode})`}>
            <MoneyInput value={f.amountOff} onChange={(v) => setF({ ...f, amountOff: v })} />
          </Field>
        )}
        <Field label={`Minimum spend (${settings.currencyCode})`}>
          <MoneyInput value={f.minSpend} onChange={(v) => setF({ ...f, minSpend: v })} placeholder="None" />
        </Field>
        <Field label="Valid from">
          <input className="input" type="datetime-local" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} />
        </Field>
        <Field label="Valid until">
          <input className="input" type="datetime-local" value={f.validTo} onChange={(e) => setF({ ...f, validTo: e.target.value })} />
        </Field>
        <Field label="Maximum uses" hint="Blank = unlimited">
          <input className="input" type="number" min={1} value={f.maxUses} onChange={(e) => setF({ ...f, maxUses: e.target.value === '' ? '' : Number(e.target.value) })} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active
        </label>
        <label className="check">
          <input type="checkbox" checked={f.showInPortal} onChange={(e) => setF({ ...f, showInPortal: e.target.checked })} /> Show it to customers in the app (Rewards
          page) so they can use it
        </label>
      </div>
    </Modal>
  );
}

// ───── Play packages: spend / play this much → bonus, announced on the counter speaker ─────

const DEFAULT_MESSAGE = '{name}, your promo bonus has been added. Thank you!';
const PERIODS: Record<string, string> = { day: 'each day', week: 'each week', month: 'each month', once: '' };

function hoursText(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h${m ? ` ${m} min` : ''}` : `${m} min`;
}

function PlayPackages() {
  const { money } = useApp();
  const q = useQuery({ queryKey: ['promo-packages'], queryFn: () => get<any[]>('/api/promo-packages') });
  const [editing, setEditing] = useState<any | 'new' | null>(null);
  const goalText = (p: any) => (p.goal === 'spend' ? `Spend ${money(p.target)}` : `Play ${hoursText(p.target)}`);
  const bonusText = (p: any) =>
    [p.bonusAmount > 0 && `${money(p.bonusAmount)} bonus`, p.bonusMinutes > 0 && `${hoursText(p.bonusMinutes)} free`].filter(Boolean).join(' + ');
  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>
            <Gift size={16} style={{ verticalAlign: -2 }} /> Play packages
          </h2>
          <div className="dim" style={{ fontSize: 12 }}>
            “Spend {money(10000)} this week, get {money(1000)} bonus” or “Play 5 hours this month, get 1 hour free”. Paid automatically when the customer
            reaches it, and the counter speaker calls their name. Customers see their progress on the app’s Rewards page.
          </div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
          <Plus size={14} /> Add package
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Package</th>
              <th>Customer must</th>
              <th>They get</th>
              <th>Runs</th>
              <th className="right">Paid</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {q.data?.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No play packages yet
                </td>
              </tr>
            )}
            {(q.data ?? []).map((p: any) => {
              const expired = p.validTo && new Date(p.validTo) < new Date();
              return (
                <tr key={p.id} style={{ opacity: p.active && !expired ? 1 : 0.55 }}>
                  <td style={{ fontWeight: 600 }}>
                    {p.name}
                    {p.announce && <Volume2 size={13} className="dim" style={{ marginLeft: 6, verticalAlign: -2 }} aria-label="Announced on the speaker" />}
                    {p.description && <div className="dim" style={{ fontWeight: 400, fontSize: 12 }}>{p.description}</div>}
                  </td>
                  <td>
                    {goalText(p)} <span className="dim">{PERIODS[p.period]}</span>
                  </td>
                  <td>{bonusText(p)}</td>
                  <td className="dim">
                    {p.validFrom ? formatDateTime(p.validFrom) : 'Now'} → {p.validTo ? formatDateTime(p.validTo) : 'no end'}
                  </td>
                  <td className="right num">{p.awarded}</td>
                  <td>
                    {!p.active ? <span className="badge">Off</span> : expired ? <span className="badge badge-danger">Ended</span> : <span className="badge badge-success">Active</span>}
                  </td>
                  <td className="right">
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setEditing(p)} aria-label="Edit">
                      <Pencil size={14} />
                    </button>
                    <DeleteButton icon url={`/api/promo-packages/${p.id}`} what={`package "${p.name}"`} refresh={[['promo-packages']]} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editing && <PackageForm pkg={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function PackageForm({ pkg, onClose }: { pkg: any | null; onClose(): void }) {
  const { settings, toast } = useApp();
  const qc = useQueryClient();
  const mu = settings.currencyMinorUnits;
  const [f, setF] = useState({
    name: pkg?.name ?? '',
    description: pkg?.description ?? '',
    goal: (pkg?.goal ?? 'spend') as 'spend' | 'time',
    spend: pkg?.goal === 'spend' ? toMajorString(pkg.target, mu) : '',
    hours: pkg?.goal === 'time' ? String(+(pkg.target / 60).toFixed(2)) : '',
    period: (pkg?.period ?? 'week') as string,
    bonusAmount: pkg?.bonusAmount ? toMajorString(pkg.bonusAmount, mu) : '',
    bonusMinutes: pkg?.bonusMinutes ? String(pkg.bonusMinutes) : '',
    validFrom: toLocalInput(pkg?.validFrom ?? null),
    validTo: toLocalInput(pkg?.validTo ?? null),
    announce: (pkg?.announce ?? true) as boolean,
    message: (pkg?.message ?? '') as string,
    showInPortal: (pkg?.showInPortal ?? true) as boolean,
    active: (pkg?.active ?? true) as boolean,
  });
  const m = useMutation({
    mutationFn: () => {
      let target: number;
      if (f.goal === 'spend') {
        const v = parseMoney(f.spend, mu);
        if (v == null || v <= 0) throw new Error('Enter how much the customer must spend');
        target = v;
      } else {
        const h = Number(f.hours);
        if (!(h > 0)) throw new Error('Enter how many hours the customer must play');
        target = Math.round(h * 60);
      }
      const bonusAmount = f.bonusAmount.trim() ? parseMoney(f.bonusAmount, mu) : 0;
      if (bonusAmount == null) throw new Error('The bonus money is not a valid amount');
      const body = {
        name: f.name,
        description: f.description || null,
        goal: f.goal,
        target,
        period: f.period,
        bonusAmount,
        bonusMinutes: f.bonusMinutes ? Math.max(0, Math.round(Number(f.bonusMinutes))) : 0,
        validFrom: f.validFrom ? new Date(f.validFrom).toISOString() : null,
        validTo: f.validTo ? new Date(f.validTo).toISOString() : null,
        announce: f.announce,
        message: f.message.trim() || null,
        showInPortal: f.showInPortal,
        active: f.active,
      };
      return pkg ? patch(`/api/promo-packages/${pkg.id}`, body) : post('/api/promo-packages', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['promo-packages'] });
      toast('success', pkg ? 'Package updated' : 'Package added');
      onClose();
    },
  });
  const spoken = (f.message.trim() || DEFAULT_MESSAGE).replaceAll('{name}', 'Kofi').replaceAll('{package}', f.name || 'Weekend package');
  return (
    <Modal
      title={pkg ? `Edit ${pkg.name}` : 'Add play package'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={f.name.trim().length < 2 || m.isPending} onClick={() => m.mutate()}>
            Save
          </button>
        </>
      }
    >
      <ErrorBox error={m.error} />
      <div className="form-grid">
        <Field label="Name" full>
          <input className="input" value={f.name} maxLength={60} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Weekend warrior" autoFocus />
        </Field>
        <Field label="Short description (customers see it)" full>
          <input
            className="input"
            value={f.description}
            maxLength={200}
            onChange={(e) => setF({ ...f, description: e.target.value })}
            placeholder="Play 3 hours this weekend and get 30 minutes free"
          />
        </Field>
        <Field label="The customer must" full>
          <Segmented
            value={f.goal}
            onChange={(goal) => setF({ ...f, goal })}
            options={[
              { value: 'spend', label: 'Spend an amount' },
              { value: 'time', label: 'Play for some time' },
            ]}
          />
        </Field>
        {f.goal === 'spend' ? (
          <Field label={`Spend at least (${settings.currencyCode})`} hint="Money paid for play: sessions, extra time and saved time">
            <MoneyInput value={f.spend} onChange={(v) => setF({ ...f, spend: v })} />
          </Field>
        ) : (
          <Field label="Play at least (hours)" hint="Finished sessions. 1.5 = 1 h 30 min">
            <input className="input" type="number" min={0.25} step={0.25} value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} />
          </Field>
        )}
        <Field label="Within" hint="The count starts again each period">
          <select className="select" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })}>
            <option value="day">One day (pays once a day)</option>
            <option value="week">One week, Mon–Sun (pays once a week)</option>
            <option value="month">One month (pays once a month)</option>
            <option value="once">From start to end date (pays once)</option>
          </select>
        </Field>
        <Field label={`Bonus money (${settings.currencyCode})`} hint="Added to the customer's wallet">
          <MoneyInput value={f.bonusAmount} onChange={(v) => setF({ ...f, bonusAmount: v })} placeholder="None" />
        </Field>
        <Field label="Free minutes" hint="Added to the customer's saved time">
          <input className="input" type="number" min={0} value={f.bonusMinutes} onChange={(e) => setF({ ...f, bonusMinutes: e.target.value })} placeholder="None" />
        </Field>
        <Field label="Starts" hint="Blank = now">
          <input className="input" type="datetime-local" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} />
        </Field>
        <Field label="Ends" hint="Blank = no end">
          <input className="input" type="datetime-local" value={f.validTo} onChange={(e) => setF({ ...f, validTo: e.target.value })} />
        </Field>
        <label className="check" style={{ gridColumn: '1 / -1' }}>
          <input type="checkbox" checked={f.announce} onChange={(e) => setF({ ...f, announce: e.target.checked })} /> Announce it on the counter speaker, calling
          the customer&apos;s name
        </label>
        {f.announce && (
          <Field label="What the speaker says" full hint="{name} = customer's first name, {package} = this package's name. Blank = the standard message.">
            <div className="toolbar" style={{ flexWrap: 'nowrap' }}>
              <input className="input" value={f.message} maxLength={200} onChange={(e) => setF({ ...f, message: e.target.value })} placeholder={DEFAULT_MESSAGE} />
              <button type="button" className="btn" onClick={() => previewAnnouncement(spoken)} title={`Plays: “${spoken}”`}>
                <Volume2 size={14} /> Test
              </button>
            </div>
          </Field>
        )}
        <label className="check">
          <input type="checkbox" checked={f.showInPortal} onChange={(e) => setF({ ...f, showInPortal: e.target.checked })} /> Show it in the customer app with
          their progress
        </label>
        <label className="check">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active
        </label>
      </div>
    </Modal>
  );
}
