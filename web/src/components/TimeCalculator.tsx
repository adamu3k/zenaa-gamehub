import { useQuery } from '@tanstack/react-query';
import { Calculator } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { get } from '../lib/api';
import { useApp } from '../lib/app-context';
import { formatMinutes, parseMoney } from '../lib/format';
import { MoneyInput } from './money';
import { Field, Modal } from './ui';

export interface CalcPlan {
  id: string;
  name: string;
  kind: 'time_rate' | 'package';
  ratePerHour: number;
  billingUnitMinutes: number;
  minimumMinutes: number;
  packageMinutes: number | null;
  packagePrice: number | null;
  active: boolean;
}

const price = (min: number, rate: number) => Math.floor((min * rate * 2 + 60) / 120); // same half-up rounding as the server

/**
 * How long `amount` buys on a plan (before discounts).
 * Hourly plans: whole billing units whose price fits the amount. Packages: whole packages, and what the rest buys at
 * the plan's hourly rate.
 */
export function timeForAmount(amount: number, plan: CalcPlan, rateOverride?: number | null) {
  if (!(amount > 0)) return null;
  if (plan.kind === 'package') {
    const p = plan.packagePrice ?? 0;
    const pm = plan.packageMinutes ?? 0;
    if (p <= 0 || pm <= 0) return null;
    const packs = Math.floor(amount / p);
    const left = amount - packs * p;
    const extra = plan.ratePerHour > 0 ? Math.floor((left * 60) / plan.ratePerHour) : 0;
    return { minutes: packs * pm, packs, cost: packs * p, change: left, extraMinutes: extra, belowMinimum: packs === 0 };
  }
  const rate = rateOverride ?? plan.ratePerHour;
  if (rate <= 0) return null;
  const unit = Math.max(1, plan.billingUnitMinutes);
  let min = Math.floor((amount * 60) / rate / unit) * unit;
  while (min > 0 && price(min, rate) > amount) min -= unit;
  const cost = price(min, rate);
  return { minutes: min, packs: 0, cost, change: amount - cost, extraMinutes: 0, belowMinimum: min < Math.max(plan.minimumMinutes, unit) };
}

/** Amount → time calculator (permission sessions.calculator; admins by default). */
export function TimeCalculatorModal({ onClose }: { onClose(): void }) {
  const { money, settings } = useApp();
  const plansQ = useQuery({ queryKey: ['plans'], queryFn: () => get<CalcPlan[]>('/api/pricing-plans') });
  const plans = useMemo(() => (plansQ.data ?? []).filter((p) => p.active), [plansQ.data]);
  const [planId, setPlanId] = useState('');
  const [amountText, setAmountText] = useState('');
  useEffect(() => {
    if (!planId && plans.length) setPlanId(plans[0].id);
  }, [plans, planId]);
  const plan = plans.find((p) => p.id === planId);
  const amount = parseMoney(amountText, settings.currencyMinorUnits) ?? 0;
  const r = plan ? timeForAmount(amount, plan) : null;

  return (
    <Modal title="Amount → playing time" onClose={onClose}>
      <Field label="Package / pricing plan">
        <select className="select" value={planId} onChange={(e) => setPlanId(e.target.value)}>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} — {p.kind === 'package' ? `${formatMinutes(p.packageMinutes ?? 0)} for ${money(p.packagePrice ?? 0)}` : `${money(p.ratePerHour)}/h`}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Amount the customer pays">
        <MoneyInput value={amountText} onChange={setAmountText} placeholder="e.g. 25" autoFocus />
      </Field>
      <div className="toolbar">
        {[5, 10, 20, 50, 100].map((v) => (
          <button key={v} type="button" className="btn btn-sm" onClick={() => setAmountText(String(v))}>
            {money(v * 10 ** settings.currencyMinorUnits)}
          </button>
        ))}
      </div>
      {plansQ.data && plans.length === 0 && <div className="error-box">No active pricing plans yet (Pricing &amp; tiers).</div>}
      {plan && r && (
        <div className="calc-result">
          <span className="muted">{money(amount)} on {plan.name} gives</span>
          <span className="big">{r.minutes > 0 ? formatMinutes(r.minutes) : 'Not enough'}</span>
          {plan.kind === 'package' ? (
            <>
              {r.packs > 0 && (
                <span>
                  {r.packs} × package ({formatMinutes(plan.packageMinutes ?? 0)} for {money(plan.packagePrice ?? 0)}) = {money(r.cost)}
                </span>
              )}
              {r.change > 0 && (
                <span>
                  {money(r.change)} left over
                  {r.extraMinutes > 0 ? ` — that's about ${formatMinutes(r.extraMinutes)} more at ${money(plan.ratePerHour)}/h (as an extension)` : ''}
                </span>
              )}
              {r.packs === 0 && <span>One package costs {money(plan.packagePrice ?? 0)}.</span>}
            </>
          ) : (
            <>
              <span>
                Costs {money(r.cost)} at {money(plan.ratePerHour)}/h{plan.billingUnitMinutes > 1 ? ` (blocks of ${plan.billingUnitMinutes} min)` : ''}
                {r.change > 0 ? ` · ${money(r.change)} change` : ''}
              </span>
              {r.belowMinimum && r.minutes > 0 && <span className="dim">Below this plan's minimum of {formatMinutes(Math.max(plan.minimumMinutes, plan.billingUnitMinutes))}.</span>}
            </>
          )}
          <span className="dim" style={{ fontSize: 12 }}>
            Before member discounts, happy hours and promo codes (those give more time for the same money).
          </span>
        </div>
      )}
    </Modal>
  );
}

/** Header button: shown only to staff with sessions.calculator. */
export function TimeCalculatorButton() {
  const { can } = useApp();
  const [open, setOpen] = useState(false);
  if (!can('sessions.calculator')) return null;
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)} title="How much time does an amount buy?">
        <Calculator size={16} /> Amount → time
      </button>
      {open && <TimeCalculatorModal onClose={() => setOpen(false)} />}
    </>
  );
}
