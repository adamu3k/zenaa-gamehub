import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MoneyInput } from '../components/money';
import { DeleteButton } from '../components/DeleteButton';
import { ErrorBox, Field, Modal, PageHeader, Segmented } from '../components/ui';
import { get, patch, post } from '../lib/api';
import { useApp } from '../lib/app-context';
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
