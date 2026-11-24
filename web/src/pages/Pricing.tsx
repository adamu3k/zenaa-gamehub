import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { DeleteButton } from '../components/DeleteButton';
import { ErrorBox, Field, Modal, PageHeader, Segmented } from '../components/ui';
import { get, patch, post } from '../lib/api';
import { useApp } from '../lib/app-context';
import { formatMinutes, parseMoney, toMajorString } from '../lib/format';

export function PricingPage() {
  const { money, can } = useApp();
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => get('/api/pricing-plans') });
  const tiers = useQuery({ queryKey: ['tiers'], queryFn: () => get('/api/membership-tiers'), enabled: can('customers.view') });
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => get('/api/station-categories') });
  const [plan, setPlan] = useState<any>(null);
  const [tier, setTier] = useState<any>(null);
  const [cat, setCat] = useState<any>(null);
  const catName = (id: string | null) => (id ? cats.data?.find((c: any) => c.id === id)?.name ?? '—' : 'All stations');
  const canPrice = can('pricing.manage');

  return (
    <>
      <PageHeader title="Pricing & tiers" subtitle="Changes apply to new sessions only — running sessions keep the rate they started with." />

      <div className="card">
        <div className="card-head">
          <h2>Pricing plans</h2>
          {canPrice && (
            <button className="btn btn-primary btn-sm" onClick={() => setPlan('new')}>
              <Plus size={14} /> New plan
            </button>
          )}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Applies to</th>
                <th>Rate</th>
                <th>Billing unit</th>
                <th>Minimum / grace</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {plans.data?.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
                    No plans yet — create one to start sessions.
                  </td>
                </tr>
              )}
              {(plans.data ?? []).map((p: any) => (
                <tr key={p.id} className={canPrice ? 'clickable' : ''} onClick={() => canPrice && setPlan(p)}>
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td>{p.kind === 'package' ? 'Package' : 'Time rate'}</td>
                  <td>{catName(p.categoryId)}</td>
                  <td className="num">{p.kind === 'package' ? `${money(p.packagePrice)} / ${formatMinutes(p.packageMinutes)}` : `${money(p.ratePerHour)}/h`}</td>
                  <td>{p.billingUnitMinutes === 1 ? 'Per minute' : p.billingUnitMinutes === 60 ? 'Hourly' : `${p.billingUnitMinutes} min`}</td>
                  <td>
                    {p.minimumMinutes} min / {p.graceMinutes} min
                  </td>
                  <td>{p.active ? <span className="badge badge-success">Active</span> : <span className="badge">Inactive</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid two-col">
        <div className="card">
          <div className="card-head">
            <h2>Membership tiers</h2>
            {canPrice && (
              <button className="btn btn-sm" onClick={() => setTier('new')}>
                <Plus size={14} /> New tier
              </button>
            )}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Tier</th>
                  <th>Discount</th>
                  <th>Loyalty</th>
                </tr>
              </thead>
              <tbody>
                {(tiers.data ?? []).map((t: any) => (
                  <tr key={t.id} className={canPrice ? 'clickable' : ''} onClick={() => canPrice && setTier(t)}>
                    <td style={{ fontWeight: 600 }}>{t.name}</td>
                    <td>{t.discountPercent}%</td>
                    <td>{t.spendPerPoint > 0 ? `1 point per ${money(t.spendPerPoint)}` : 'No points'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Station categories</h2>
            {can('stations.manage') && (
              <button className="btn btn-sm" onClick={() => setCat('new')}>
                <Plus size={14} /> New
              </button>
            )}
          </div>
          <div className="list">
            {(cats.data ?? []).map((c: any) => (
              <div key={c.id} className="list-item" style={{ cursor: can('stations.manage') ? 'pointer' : undefined }} onClick={() => can('stations.manage') && setCat(c)}>
                <strong>{c.name}</strong>
                <span className="dim">{c.description}</span>
              </div>
            ))}
            {cats.data?.length === 0 && <div className="list-item muted">e.g. Standard, VIP room</div>}
          </div>
        </div>
      </div>

      {plan && <PlanForm plan={plan === 'new' ? null : plan} cats={cats.data ?? []} onClose={() => setPlan(null)} />}
      {tier && <TierForm tier={tier === 'new' ? null : tier} onClose={() => setTier(null)} />}
      {cat && <CategoryForm cat={cat === 'new' ? null : cat} onClose={() => setCat(null)} />}
    </>
  );
}

function PlanForm({ plan, cats, onClose }: { plan: any; cats: any[]; onClose(): void }) {
  const { settings } = useApp();
  const qc = useQueryClient();
  const mu = settings.currencyMinorUnits;
  const [f, setF] = useState({
    name: plan?.name ?? '',
    kind: (plan?.kind ?? 'time_rate') as 'time_rate' | 'package',
    categoryId: plan?.categoryId ?? '',
    rate: toMajorString(plan?.ratePerHour, mu),
    unit: String(plan?.billingUnitMinutes ?? 1),
    min: String(plan?.minimumMinutes ?? 0),
    grace: String(plan?.graceMinutes ?? 0),
    pkgMin: String(plan?.packageMinutes ?? 180),
    pkgPrice: toMajorString(plan?.packagePrice, mu),
    active: plan?.active ?? true,
  });
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const m = useMutation({
    mutationFn: () => {
      const rate = parseMoney(f.rate, mu);
      if (rate == null || rate < 0) throw new Error('Enter a valid hourly rate');
      const pkgPrice = f.kind === 'package' ? parseMoney(f.pkgPrice, mu) : null;
      if (f.kind === 'package' && (pkgPrice == null || pkgPrice < 0)) throw new Error('Enter a valid package price');
      const body = {
        name: f.name,
        kind: f.kind,
        categoryId: f.categoryId || null,
        ratePerHour: rate,
        billingUnitMinutes: Number(f.unit),
        minimumMinutes: Number(f.min),
        graceMinutes: Number(f.grace),
        packageMinutes: f.kind === 'package' ? Number(f.pkgMin) : null,
        packagePrice: pkgPrice,
        active: f.active,
      };
      return plan ? patch(`/api/pricing-plans/${plan.id}`, body) : post('/api/pricing-plans', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plans'] });
      onClose();
    },
  });
  return (
    <Modal
      title={plan ? `Edit plan — ${plan.name}` : 'New pricing plan'}
      onClose={onClose}
      footer={
        <>
          {plan && (
            <span style={{ marginRight: 'auto' }}>
              <DeleteButton url={`/api/pricing-plans/${plan.id}`} what={`price "${plan.name}"`} refresh={[['plans']]} onDone={onClose} small={false} />
            </span>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!f.name || m.isPending} onClick={() => m.mutate()}>
            Save
          </button>
        </>
      }
    >
      <ErrorBox error={m.error} />
      <Segmented
        value={f.kind}
        onChange={(kind) => setF({ ...f, kind })}
        options={[
          { value: 'time_rate', label: 'Time rate' },
          { value: 'package', label: 'Package (fixed time & price)' },
        ]}
      />
      <div className="form-grid">
        <Field label="Name" full>
          <input className="input" value={f.name} onChange={set('name')} placeholder={f.kind === 'package' ? '3-hour bundle' : 'Standard PS5'} />
        </Field>
        <Field label="Applies to">
          <select className="select" value={f.categoryId} onChange={set('categoryId')}>
            <option value="">All stations</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={`Rate per hour (${settings.currencyCode})`} hint={f.kind === 'package' ? 'Used to price extensions' : undefined}>
          <input className="input" inputMode="decimal" value={f.rate} onChange={set('rate')} />
        </Field>
        {f.kind === 'package' ? (
          <>
            <Field label="Package minutes">
              <input className="input" type="number" min={1} value={f.pkgMin} onChange={set('pkgMin')} />
            </Field>
            <Field label={`Package price (${settings.currencyCode})`}>
              <input className="input" inputMode="decimal" value={f.pkgPrice} onChange={set('pkgPrice')} />
            </Field>
          </>
        ) : (
          <>
            <Field label="Billing unit (minutes)" hint="1 = per-minute, 60 = hourly">
              <input className="input" type="number" min={1} value={f.unit} onChange={set('unit')} />
            </Field>
            <Field label="Minimum charge (minutes)">
              <input className="input" type="number" min={0} value={f.min} onChange={set('min')} />
            </Field>
            <Field label="Grace on last unit (minutes)" hint="Overrun forgiven before the next unit is charged">
              <input className="input" type="number" min={0} value={f.grace} onChange={set('grace')} />
            </Field>
          </>
        )}
        <label className="check full">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active (available when starting sessions)
        </label>
      </div>
    </Modal>
  );
}

function TierForm({ tier, onClose }: { tier: any; onClose(): void }) {
  const { settings } = useApp();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: tier?.name ?? '', discount: String(tier?.discountPercent ?? 0), spend: toMajorString(tier?.spendPerPoint ?? 0, settings.currencyMinorUnits) });
  const m = useMutation({
    mutationFn: () => {
      const spend = parseMoney(f.spend || '0', settings.currencyMinorUnits);
      if (spend == null || spend < 0) throw new Error('Enter a valid amount');
      const body = { name: f.name, discountPercent: Number(f.discount), spendPerPoint: spend };
      return tier ? patch(`/api/membership-tiers/${tier.id}`, body) : post('/api/membership-tiers', body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tiers'] });
      onClose();
    },
  });
  return (
    <Modal
      title={tier ? 'Edit tier' : 'New membership tier'}
      onClose={onClose}
      footer={
        <>
          {tier && (
            <span style={{ marginRight: 'auto' }}>
              <DeleteButton
                url={`/api/membership-tiers/${tier.id}`}
                what={`membership "${tier.name}"`}
                confirmText={`Delete the "${tier.name}" membership? Customers on it go back to no membership.`}
                refresh={[['tiers'], ['customers']]}
                onDone={onClose}
                small={false}
              />
            </span>
          )}
          <button className="btn btn-primary" disabled={!f.name || m.isPending} onClick={() => m.mutate()}>
            Save
          </button>
        </>
      }
    >
      <ErrorBox error={m.error} />
      <Field label="Name">
        <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Gold" />
      </Field>
      <Field label="Discount on play time (%)">
        <input className="input" type="number" min={0} max={100} value={f.discount} onChange={(e) => setF({ ...f, discount: e.target.value })} />
      </Field>
      <Field label={`Spend per loyalty point (${settings.currencyCode})`} hint="0 = this tier earns no points">
        <input className="input" inputMode="decimal" value={f.spend} onChange={(e) => setF({ ...f, spend: e.target.value })} />
      </Field>
    </Modal>
  );
}

function CategoryForm({ cat, onClose }: { cat: any; onClose(): void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: cat?.name ?? '', description: cat?.description ?? '' });
  const m = useMutation({
    mutationFn: () => (cat ? patch(`/api/station-categories/${cat.id}`, f) : post('/api/station-categories', f)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] });
      onClose();
    },
  });
  return (
    <Modal
      title={cat ? 'Edit category' : 'New station category'}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" disabled={!f.name || m.isPending} onClick={() => m.mutate()}>
          Save
        </button>
      }
    >
      <ErrorBox error={m.error} />
      <Field label="Name">
        <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="VIP room" />
      </Field>
      <Field label="Description">
        <input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
      </Field>
    </Modal>
  );
}
