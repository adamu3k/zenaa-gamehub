/**
 * Pure billing engine. No I/O, no clocks — fully deterministic and unit tested.
 * All amounts are integers in currency minor units.
 */

export type PlanKind = 'time_rate' | 'package';

export interface RateSnapshot {
  planId: string;
  planName: string;
  kind: PlanKind;
  /** Minor units per hour. Also used to price extensions on packages. */
  ratePerHour: number;
  /** Size of a billing unit in minutes: 1 = per-minute, 60 = hourly. */
  billingUnitMinutes: number;
  /** Minimum billable minutes once any time has been used. */
  minimumMinutes: number;
  /** Tolerance on the final partial unit (only after the first unit). */
  graceMinutes: number;
  packageMinutes: number | null;
  packagePrice: number | null;
}

export interface Charge {
  billedMinutes: number;
  amount: number;
}

/** Round-half-up of n/d for non-negative integers, using integer arithmetic only. */
export function divRoundHalfUp(n: number, d: number): number {
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d) || n < 0 || d <= 0) {
    throw new RangeError(`divRoundHalfUp expects non-negative safe integers (got ${n}/${d})`);
  }
  return Math.floor((2 * n + d) / (2 * d));
}

/** Price for an exact number of minutes at an hourly rate. */
export function priceForMinutes(minutes: number, ratePerHour: number): number {
  return divRoundHalfUp(minutes * ratePerHour, 60);
}

/** Postpaid charge for the time actually used. */
export function computeTimeCharge(activeSeconds: number, rate: RateSnapshot): Charge {
  if (activeSeconds <= 0) return { billedMinutes: 0, amount: 0 };
  const unitSeconds = rate.billingUnitMinutes * 60;
  const fullUnits = Math.floor(activeSeconds / unitSeconds);
  const remainder = activeSeconds - fullUnits * unitSeconds;
  const chargeRemainder = remainder > 0 && (fullUnits === 0 || remainder > rate.graceMinutes * 60);
  const units = fullUnits + (chargeRemainder ? 1 : 0);
  const billedMinutes = Math.max(units * rate.billingUnitMinutes, rate.minimumMinutes);
  return { billedMinutes, amount: priceForMinutes(billedMinutes, rate.ratePerHour) };
}

/** Up-front price and allotted time for a prepaid session. */
export function computePrepaid(rate: RateSnapshot, requestedMinutes?: number): Charge {
  if (rate.kind === 'package') {
    if (!rate.packageMinutes || rate.packagePrice == null) throw new Error('Package plan is missing minutes or price');
    return { billedMinutes: rate.packageMinutes, amount: rate.packagePrice };
  }
  if (!requestedMinutes || !Number.isInteger(requestedMinutes) || requestedMinutes <= 0) {
    throw new BillingError('Enter the number of minutes to prepay');
  }
  if (requestedMinutes % rate.billingUnitMinutes !== 0) {
    throw new BillingError(`Prepaid time must be a multiple of ${rate.billingUnitMinutes} minutes for this plan`);
  }
  if (requestedMinutes < rate.minimumMinutes) {
    throw new BillingError(`Minimum time for this plan is ${rate.minimumMinutes} minutes`);
  }
  return { billedMinutes: requestedMinutes, amount: priceForMinutes(requestedMinutes, rate.ratePerHour) };
}

/** Price of a prepaid extension (charged at the hourly rate, no minimum). */
export function computeExtension(rate: RateSnapshot, minutes: number): Charge {
  if (!Number.isInteger(minutes) || minutes <= 0) throw new BillingError('Extension minutes must be a positive whole number');
  return { billedMinutes: minutes, amount: priceForMinutes(minutes, rate.ratePerHour) };
}

export function applyDiscount(amount: number, percent: number): { discount: number; net: number } {
  if (percent <= 0) return { discount: 0, net: amount };
  const p = Math.min(percent, 100);
  const discount = divRoundHalfUp(amount * p, 100);
  return { discount, net: amount - discount };
}

/** Promo discount on a subtotal: percentage (rounded half-up) or a fixed amount, never more than the subtotal. */
export function promoDiscount(subtotal: number, promo: { percentOff: number | null; amountOff: number | null }): number {
  if (subtotal <= 0) return 0;
  if (promo.percentOff != null) return applyDiscount(subtotal, promo.percentOff).discount;
  if (promo.amountOff != null) return Math.min(Math.max(0, promo.amountOff), subtotal);
  return 0;
}

export interface HappyHourRule {
  id: string;
  days: number[];
  startMinute: number;
  endMinute: number;
  discountPercent: number;
  categoryId: string | null;
  active: boolean;
}

/**
 * Whether a local wall-clock instant (day 0=Sun…6=Sat, minute after midnight) falls in a rule's window.
 * A window whose end is before its start runs past midnight and belongs to the day it starts on.
 */
export function happyHourMatches(rule: Pick<HappyHourRule, 'days' | 'startMinute' | 'endMinute'>, day: number, minute: number): boolean {
  const { startMinute: s, endMinute: e, days } = rule;
  if (s === e) return days.includes(day); // whole day
  if (s < e) return days.includes(day) && minute >= s && minute < e;
  const prev = (day + 6) % 7;
  return (days.includes(day) && minute >= s) || (days.includes(prev) && minute < e);
}

/** Best active happy-hour rule for a station category at a local instant, or null. */
export function bestHappyHour<T extends HappyHourRule>(rules: T[], categoryId: string | null, day: number, minute: number): T | null {
  let best: T | null = null;
  for (const r of rules) {
    if (!r.active) continue;
    if (r.categoryId && r.categoryId !== categoryId) continue;
    if (!happyHourMatches(r, day, minute)) continue;
    if (!best || r.discountPercent > best.discountPercent) best = r;
  }
  return best;
}

/**
 * Suggested refund for unused prepaid time: the share of the net bill matching the unused whole minutes,
 * capped at what is still refundable.
 */
export function unusedPrepaidValue(s: {
  allottedSeconds: number | null;
  accumulatedSeconds: number;
  netAmount: number;
  paidAmount: number;
  refundedAmount: number;
}): { unusedMinutes: number; amount: number } {
  if (!s.allottedSeconds || s.allottedSeconds <= 0) return { unusedMinutes: 0, amount: 0 };
  const unusedMinutes = Math.floor(Math.max(0, s.allottedSeconds - s.accumulatedSeconds) / 60);
  const allottedMinutes = Math.floor(s.allottedSeconds / 60);
  if (unusedMinutes <= 0 || allottedMinutes <= 0) return { unusedMinutes: 0, amount: 0 };
  const share = divRoundHalfUp(s.netAmount * unusedMinutes, allottedMinutes);
  return { unusedMinutes, amount: Math.max(0, Math.min(share, s.paidAmount - s.refundedAmount)) };
}

export function validateRate(rate: Pick<RateSnapshot, 'kind' | 'ratePerHour' | 'billingUnitMinutes' | 'minimumMinutes' | 'graceMinutes' | 'packageMinutes' | 'packagePrice'>): string | null {
  if (!Number.isSafeInteger(rate.ratePerHour) || rate.ratePerHour < 0) return 'Rate per hour must be a non-negative amount';
  if (!Number.isInteger(rate.billingUnitMinutes) || rate.billingUnitMinutes < 1 || rate.billingUnitMinutes > 1440)
    return 'Billing unit must be between 1 and 1440 minutes';
  if (!Number.isInteger(rate.minimumMinutes) || rate.minimumMinutes < 0) return 'Minimum minutes must be zero or more';
  if (!Number.isInteger(rate.graceMinutes) || rate.graceMinutes < 0) return 'Grace minutes must be zero or more';
  if (rate.graceMinutes >= rate.billingUnitMinutes && rate.graceMinutes > 0)
    return 'Grace period must be shorter than the billing unit';
  if (rate.kind === 'package') {
    if (!rate.packageMinutes || rate.packageMinutes <= 0) return 'Package minutes are required';
    if (rate.packagePrice == null || rate.packagePrice < 0) return 'Package price is required';
  }
  return null;
}

export class BillingError extends Error {}

/** Live state of a session at an instant. */
export interface TimingState {
  status: 'running' | 'paused' | 'ended';
  accumulatedSeconds: number;
  lastResumedAt: Date | null;
  allottedSeconds: number | null;
}

export function activeSecondsAt(s: TimingState, at: Date): number {
  let total = s.accumulatedSeconds;
  if (s.status === 'running' && s.lastResumedAt) {
    total += Math.max(0, Math.floor((at.getTime() - s.lastResumedAt.getTime()) / 1000));
  }
  return s.allottedSeconds != null ? Math.min(total, s.allottedSeconds) : total;
}

/** When a running prepaid session runs out of time (null if not applicable). */
export function expectedEndAt(s: TimingState): Date | null {
  if (s.status !== 'running' || s.allottedSeconds == null || !s.lastResumedAt) return null;
  const remaining = Math.max(0, s.allottedSeconds - s.accumulatedSeconds);
  return new Date(s.lastResumedAt.getTime() + remaining * 1000);
}
