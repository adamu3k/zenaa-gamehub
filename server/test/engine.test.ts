import { describe, expect, it } from 'vitest';
import {
  activeSecondsAt,
  applyDiscount,
  computeExtension,
  computePrepaid,
  computeTimeCharge,
  divRoundHalfUp,
  expectedEndAt,
  validateRate,
  type RateSnapshot,
} from '../src/billing/engine.js';

const rate = (o: Partial<RateSnapshot> = {}): RateSnapshot => ({
  planId: 'p',
  planName: 'Standard',
  kind: 'time_rate',
  ratePerHour: 150_000, // 1,500.00 per hour
  billingUnitMinutes: 1,
  minimumMinutes: 0,
  graceMinutes: 0,
  packageMinutes: null,
  packagePrice: null,
  ...o,
});

describe('rounding', () => {
  it('rounds half up with integers only', () => {
    expect(divRoundHalfUp(5, 2)).toBe(3);
    expect(divRoundHalfUp(4, 2)).toBe(2);
    expect(divRoundHalfUp(149, 100)).toBe(1);
    expect(divRoundHalfUp(150, 100)).toBe(2);
    expect(divRoundHalfUp(0, 60)).toBe(0);
  });
  it('rejects non-integers', () => {
    expect(() => divRoundHalfUp(1.5, 2)).toThrow();
  });
});

describe('postpaid per-minute', () => {
  it('charges nothing for zero time', () => {
    expect(computeTimeCharge(0, rate())).toEqual({ billedMinutes: 0, amount: 0 });
  });
  it('rounds partial minutes up', () => {
    expect(computeTimeCharge(1, rate())).toEqual({ billedMinutes: 1, amount: 2_500 });
    expect(computeTimeCharge(60, rate())).toEqual({ billedMinutes: 1, amount: 2_500 });
    expect(computeTimeCharge(61, rate())).toEqual({ billedMinutes: 2, amount: 5_000 });
  });
  it('bills a full hour exactly', () => {
    expect(computeTimeCharge(3600, rate())).toEqual({ billedMinutes: 60, amount: 150_000 });
  });
  it('applies the minimum', () => {
    expect(computeTimeCharge(120, rate({ minimumMinutes: 30 }))).toEqual({ billedMinutes: 30, amount: 75_000 });
  });
  it('rounds odd rates correctly', () => {
    // 7 minutes at 1,000.00/h = 116.666… → 116.67
    expect(computeTimeCharge(7 * 60, rate({ ratePerHour: 100_000 })).amount).toBe(11_667);
  });
});

describe('postpaid hourly with grace', () => {
  const hourly = rate({ billingUnitMinutes: 60, graceMinutes: 5 });
  it('always bills the first started hour', () => {
    expect(computeTimeCharge(4 * 60, hourly)).toEqual({ billedMinutes: 60, amount: 150_000 });
  });
  it('forgives overrun within grace', () => {
    expect(computeTimeCharge(65 * 60, hourly)).toEqual({ billedMinutes: 60, amount: 150_000 });
  });
  it('bills the next hour after grace', () => {
    expect(computeTimeCharge(65 * 60 + 1, hourly)).toEqual({ billedMinutes: 120, amount: 300_000 });
  });
});

describe('prepaid', () => {
  it('prices requested minutes', () => {
    expect(computePrepaid(rate(), 90)).toEqual({ billedMinutes: 90, amount: 225_000 });
  });
  it('requires multiples of the billing unit', () => {
    expect(() => computePrepaid(rate({ billingUnitMinutes: 30 }), 45)).toThrow(/multiple of 30/);
  });
  it('enforces minimum', () => {
    expect(() => computePrepaid(rate({ minimumMinutes: 30 }), 15)).toThrow(/Minimum/);
  });
  it('uses package price', () => {
    const pkg = rate({ kind: 'package', packageMinutes: 180, packagePrice: 350_000 });
    expect(computePrepaid(pkg)).toEqual({ billedMinutes: 180, amount: 350_000 });
  });
  it('prices extensions at the hourly rate without minimum', () => {
    expect(computeExtension(rate({ minimumMinutes: 60 }), 10)).toEqual({ billedMinutes: 10, amount: 25_000 });
  });
});

describe('discounts', () => {
  it('rounds discount half up and never exceeds amount', () => {
    expect(applyDiscount(10_001, 10)).toEqual({ discount: 1_000, net: 9_001 });
    expect(applyDiscount(10_005, 10)).toEqual({ discount: 1_001, net: 9_004 });
    expect(applyDiscount(5_000, 100)).toEqual({ discount: 5_000, net: 0 });
    expect(applyDiscount(5_000, 0)).toEqual({ discount: 0, net: 5_000 });
  });
});

describe('timing', () => {
  const t0 = new Date('2026-01-01T10:00:00Z');
  const at = (s: number) => new Date(t0.getTime() + s * 1000);
  it('accumulates only while running', () => {
    expect(activeSecondsAt({ status: 'running', accumulatedSeconds: 100, lastResumedAt: t0, allottedSeconds: null }, at(50))).toBe(150);
    expect(activeSecondsAt({ status: 'paused', accumulatedSeconds: 100, lastResumedAt: null, allottedSeconds: null }, at(500))).toBe(100);
  });
  it('caps prepaid at allotted time', () => {
    expect(activeSecondsAt({ status: 'running', accumulatedSeconds: 0, lastResumedAt: t0, allottedSeconds: 600 }, at(9999))).toBe(600);
  });
  it('computes expected end from remaining time', () => {
    expect(expectedEndAt({ status: 'running', accumulatedSeconds: 200, lastResumedAt: t0, allottedSeconds: 600 })).toEqual(at(400));
    expect(expectedEndAt({ status: 'paused', accumulatedSeconds: 200, lastResumedAt: null, allottedSeconds: 600 })).toBeNull();
  });
});

describe('plan validation', () => {
  it('rejects grace >= unit', () => {
    expect(validateRate({ ...rate({ billingUnitMinutes: 10, graceMinutes: 10 }) })).toMatch(/Grace/);
  });
  it('requires package fields', () => {
    expect(validateRate({ ...rate({ kind: 'package' }) })).toMatch(/Package/);
  });
  it('accepts a valid plan', () => {
    expect(validateRate(rate({ billingUnitMinutes: 60, graceMinutes: 5 }))).toBeNull();
  });
});

describe('promotions', () => {
  it('promo discount: percent rounds half-up, fixed is capped at the subtotal', async () => {
    const { promoDiscount } = await import('../src/billing/engine.js');
    expect(promoDiscount(10_005, { percentOff: 10, amountOff: null })).toBe(1_001);
    expect(promoDiscount(50_000, { percentOff: null, amountOff: 20_000 })).toBe(20_000);
    expect(promoDiscount(5_000, { percentOff: null, amountOff: 20_000 })).toBe(5_000);
    expect(promoDiscount(0, { percentOff: 50, amountOff: null })).toBe(0);
  });

  it('happy hour windows, including ones that run past midnight', async () => {
    const { happyHourMatches, bestHappyHour } = await import('../src/billing/engine.js');
    const weekdayLunch = { days: [1, 2, 3, 4, 5], startMinute: 12 * 60, endMinute: 16 * 60 };
    expect(happyHourMatches(weekdayLunch, 1, 12 * 60)).toBe(true);
    expect(happyHourMatches(weekdayLunch, 1, 16 * 60)).toBe(false); // end is exclusive
    expect(happyHourMatches(weekdayLunch, 6, 13 * 60)).toBe(false);
    const lateFri = { days: [5], startMinute: 22 * 60, endMinute: 2 * 60 };
    expect(happyHourMatches(lateFri, 5, 23 * 60)).toBe(true);
    expect(happyHourMatches(lateFri, 6, 60)).toBe(true); // Saturday 01:00 belongs to Friday night
    expect(happyHourMatches(lateFri, 5, 60)).toBe(false); // Friday 01:00 belongs to Thursday night
    const rules = [
      { id: 'a', ...weekdayLunch, discountPercent: 10, categoryId: null, active: true },
      { id: 'b', ...weekdayLunch, discountPercent: 25, categoryId: 'vip', active: true },
      { id: 'c', ...weekdayLunch, discountPercent: 50, categoryId: null, active: false },
    ];
    expect(bestHappyHour(rules, null, 2, 13 * 60)?.id).toBe('a');
    expect(bestHappyHour(rules, 'vip', 2, 13 * 60)?.id).toBe('b');
    expect(bestHappyHour(rules, 'vip', 0, 13 * 60)).toBeNull();
  });

  it('unused prepaid value is proportional and capped at what is refundable', async () => {
    const { unusedPrepaidValue } = await import('../src/billing/engine.js');
    const s = { allottedSeconds: 3600, accumulatedSeconds: 20 * 60 + 30, netAmount: 150_000, paidAmount: 150_000, refundedAmount: 0 };
    // 39 whole minutes unused of 60 → 97,500
    expect(unusedPrepaidValue(s)).toEqual({ unusedMinutes: 39, amount: 97_500 });
    expect(unusedPrepaidValue({ ...s, refundedAmount: 100_000 }).amount).toBe(50_000);
    expect(unusedPrepaidValue({ ...s, accumulatedSeconds: 3600 })).toEqual({ unusedMinutes: 0, amount: 0 });
  });
});
