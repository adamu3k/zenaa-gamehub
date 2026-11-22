/**
 * Milestone 7b — money operations: shifts & cash reconciliation, refunds/voids, split payments,
 * pay-later tabs, manual discounts, happy hours and promo codes. Real embedded Postgres, controlled clock.
 */
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { ensureAdmin } from '../src/bootstrap.js';
import type { Ctx } from '../src/context.js';
import { openDatabase, type DbHandle } from '../src/db/index.js';
import { walletTransactions } from '../src/db/schema.js';
import { ManualClock } from '../src/lib/clock.js';
import { Bus } from '../src/realtime/bus.js';
import { localDayMinute } from '../src/services/promotions.js';

let handle: DbHandle;
let app: FastifyInstance;
const clock = new ManualClock();
let admin = '';
let manager = '';
let cashier = '';

async function call(token: string, method: string, url: string, payload?: unknown) {
  const res = await app.inject({ method: method as any, url, payload: payload as any, headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: res.statusCode, body: res.json() as any };
}
const ok = async (token: string, method: string, url: string, payload?: unknown) => {
  const r = await call(token, method, url, payload);
  if (r.status !== 200) throw new Error(`${method} ${url} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const status = async (token: string, method: string, url: string, payload?: unknown) => (await call(token, method, url, payload)).status;

let stA = '';
let stB = '';
let perMinute = ''; // 150,000/h = 2,500 per minute
let gold = '';

beforeAll(async () => {
  handle = await openDatabase({ pgliteDir: null });
  const ctx: Ctx = { db: handle.db, clock, bus: new Bus() };
  app = await buildApp(ctx, { jwtSecret: 'test-secret-test-secret-test-secret-123' });
  await ensureAdmin(handle.db, 'admin', 'admin-pass-123');
  admin = (await ok('', 'POST', '/api/auth/login', { username: 'admin', password: 'admin-pass-123' })).token;
  await ok(admin, 'POST', '/api/staff', { username: 'mgr', fullName: 'Efua Manager', role: 'manager', password: 'manager-pass' });
  await ok(admin, 'POST', '/api/staff', { username: 'cash', fullName: 'Yaw Cashier', role: 'cashier', password: 'cashier-pass' });
  manager = (await ok('', 'POST', '/api/auth/login', { username: 'mgr', password: 'manager-pass' })).token;
  cashier = (await ok('', 'POST', '/api/auth/login', { username: 'cash', password: 'cashier-pass' })).token;

  stA = (await ok(admin, 'POST', '/api/stations', { code: 'A1', name: 'PS5 A', platform: 'ps5' })).id;
  stB = (await ok(admin, 'POST', '/api/stations', { code: 'B1', name: 'PS5 B', platform: 'ps5' })).id;
  perMinute = (await ok(admin, 'POST', '/api/pricing-plans', { name: 'Per minute', kind: 'time_rate', ratePerHour: 150_000 })).id;
  gold = (await ok(admin, 'POST', '/api/membership-tiers', { name: 'Gold', discountPercent: 10, spendPerPoint: 10_000 })).id;
});

afterAll(async () => {
  await app?.close();
  await handle?.close();
});

const prepaid = (stationId: string, minutes: number, extra: object = {}) => ({ stationId, planId: perMinute, billingType: 'prepaid', minutes, ...extra });
const postpaid = (stationId: string, extra: object = {}) => ({ stationId, planId: perMinute, billingType: 'postpaid', ...extra });

describe('shifts, cash reconciliation and refunds', () => {
  let cashierShift = '';
  let managerShift = '';

  it('opens one shift per person and attaches payments to it', async () => {
    cashierShift = (await ok(cashier, 'POST', '/api/shifts/open', { openingFloat: 1_000_000 })).id;
    expect(await status(cashier, 'POST', '/api/shifts/open', { openingFloat: 0 })).toBe(409);
    managerShift = (await ok(manager, 'POST', '/api/shifts/open', { openingFloat: 200_000 })).id;

    const s = await ok(cashier, 'POST', '/api/sessions', prepaid(stA, 60, { paymentMethod: 'cash' }));
    expect(s.netAmount).toBe(150_000);
    const cur = (await ok(cashier, 'GET', '/api/shifts/current')).shift;
    expect(cur.id).toBe(cashierShift);
    expect(cur.summary.byMethod.cash).toBe(150_000);
    expect(cur.expectedCash).toBe(1_150_000);

    // early exit: 20m30s used of 60 → 39 whole minutes unused = 97,500 suggested refund
    clock.advance(20 * 60 + 30);
    const ended = await ok(cashier, 'POST', `/api/sessions/${s.id}/end`, {});
    expect(ended.unused).toEqual({ unusedMinutes: 39, amount: 97_500 });
    expect(ended.refundable).toBe(150_000);

    // cashiers cannot refund or record petty cash
    expect(await status(cashier, 'POST', `/api/sessions/${s.id}/refund`, { amount: 97_500, reason: 'Left early' })).toBe(428);
    expect(await status(cashier, 'POST', '/api/shifts/cash-movement', { direction: 'out', amount: 1, reason: 'test' })).toBe(428);
    // a reason is mandatory
    expect(await status(manager, 'POST', `/api/sessions/${s.id}/refund`, { amount: 97_500 })).toBe(400);

    const r = await ok(manager, 'POST', `/api/sessions/${s.id}/refund`, { amount: 97_500, reason: 'Left early', method: 'cash' });
    expect(r.amount).toBe(97_500);
    expect(await status(manager, 'POST', `/api/sessions/${s.id}/refund`, { amount: 60_000, reason: 'Too much' })).toBe(400);
    const after = await ok(cashier, 'GET', `/api/sessions/${s.id}`);
    expect(after.refundedAmount).toBe(97_500);
    expect(after.refundable).toBe(52_500);
    expect(after.events.map((e: any) => e.type)).toContain('refund');

    await ok(manager, 'POST', '/api/shifts/cash-movement', { direction: 'out', amount: 20_000, reason: 'Bought drinking water' });
    const mgr = (await ok(manager, 'GET', '/api/shifts/current')).shift;
    // 200,000 float − 97,500 refund − 20,000 payout
    expect(mgr.expectedCash).toBe(82_500);
    expect(mgr.summary.refunds).toBe(97_500);
  });

  it('closes with a counted-cash variance; only managers close other people’s shifts', async () => {
    expect(await status(cashier, 'POST', `/api/shifts/${managerShift}/close`, { countedCash: 0 })).toBe(403);
    const closed = await ok(cashier, 'POST', `/api/shifts/${cashierShift}/close`, { countedCash: 1_149_000, notes: 'Short by 1,000' });
    expect(closed.expectedCash).toBe(1_150_000);
    expect(closed.variance).toBe(-1_000);
    expect(closed.summary.sales).toBe(150_000);
    expect(await status(cashier, 'POST', `/api/shifts/${cashierShift}/close`, { countedCash: 0 })).toBe(409);
    expect((await ok(cashier, 'GET', '/api/shifts/current')).shift).toBeNull();

    const list = await ok(manager, 'GET', '/api/shifts');
    expect(list.map((s: any) => s.id)).toEqual(expect.arrayContaining([cashierShift, managerShift]));
    expect(await status(cashier, 'GET', '/api/shifts')).toBe(403);
    const detail = await ok(manager, 'GET', `/api/shifts/${cashierShift}`);
    expect(detail.payments).toHaveLength(1);
  });

  it('can require an open shift before money is taken', async () => {
    const settings = await ok(admin, 'GET', '/api/settings');
    await ok(admin, 'PUT', '/api/settings', { ...settings, requireOpenShift: true });
    expect(await status(cashier, 'POST', '/api/sessions', prepaid(stB, 30, { paymentMethod: 'cash' }))).toBe(409);
    await ok(admin, 'PUT', '/api/settings', { ...settings, requireOpenShift: false });
    await ok(manager, 'POST', `/api/shifts/${managerShift}/close`, { countedCash: 82_500 });
  });
});

describe('split payments and promo codes', () => {
  let esi = '';

  it('splits a postpaid bill across wallet and cash after a promo code', async () => {
    esi = (await ok(cashier, 'POST', '/api/customers', { fullName: 'Esi Owusu', tierId: gold })).id;
    await ok(cashier, 'POST', `/api/customers/${esi}/wallet`, { operation: 'deposit', amount: 100_000, method: 'cash' });
    await ok(manager, 'POST', '/api/promo-codes', { code: 'welcome', percentOff: 20 });
    expect(await status(manager, 'POST', '/api/promo-codes', { code: 'BAD', percentOff: 10, amountOff: 100 })).toBe(400);

    expect(await status(cashier, 'POST', '/api/sessions', postpaid(stA, { customerId: esi, promoCode: 'WELCOME' }))).toBe(400);
    const s = await ok(cashier, 'POST', '/api/sessions', postpaid(stA, { customerId: esi }));
    clock.advance(60 * 60);
    // 150,000 − 10% Gold = 135,000 − 20% promo (27,000) = 108,000
    const preview = await ok(cashier, 'GET', `/api/promo-codes/check?code=welcome&subtotal=135000`);
    expect(preview.discount).toBe(27_000);
    expect(
      await status(cashier, 'POST', `/api/sessions/${s.id}/end`, {
        promoCode: 'welcome',
        payments: [{ method: 'wallet', amount: 100_000 }, { method: 'cash', amount: 5_000 }],
      }),
    ).toBe(400);
    const ended = await ok(cashier, 'POST', `/api/sessions/${s.id}/end`, {
      promoCode: 'welcome',
      payments: [{ method: 'wallet', amount: 100_000 }, { method: 'cash', amount: 8_000 }],
    });
    expect(ended.grossAmount).toBe(150_000);
    expect(ended.promoDiscount).toBe(27_000);
    expect(ended.discountAmount).toBe(42_000);
    expect(ended.netAmount).toBe(108_000);
    expect(ended.paidAmount).toBe(108_000);

    const c = await ok(cashier, 'GET', `/api/customers/${esi}`);
    expect(c.balance).toBe(0);
    expect(c.points).toBe(10);
    const detail = await ok(cashier, 'GET', `/api/sessions/${s.id}`);
    expect(detail.payments.map((p: any) => [p.method, p.amount])).toEqual([
      ['wallet', 100_000],
      ['cash', 8_000],
    ]);
  });

  it('enforces promo usage limits, expiry and fixed amounts on prepaid', async () => {
    await ok(manager, 'POST', '/api/promo-codes', { code: 'ONCE', amountOff: 50_000, maxUses: 1 });
    const s = await ok(cashier, 'POST', '/api/sessions', prepaid(stB, 30, { promoCode: 'once', paymentMethod: 'cash' }));
    expect(s.netAmount).toBe(25_000); // 75,000 − 50,000
    await ok(cashier, 'POST', `/api/sessions/${s.id}/end`, {});
    expect(await status(cashier, 'POST', '/api/sessions', prepaid(stB, 30, { promoCode: 'ONCE', paymentMethod: 'cash' }))).toBe(409);

    const past = new Date(clock.now().getTime() - 86_400_000).toISOString();
    await ok(manager, 'POST', '/api/promo-codes', { code: 'OLD', percentOff: 50, validTo: past });
    expect(await status(cashier, 'POST', '/api/sessions', prepaid(stB, 30, { promoCode: 'OLD', paymentMethod: 'cash' }))).toBe(400);
    expect(await status(cashier, 'POST', '/api/sessions', prepaid(stB, 30, { promoCode: 'NOPE', paymentMethod: 'cash' }))).toBe(400);
    expect(await status(cashier, 'GET', '/api/promo-codes')).toBe(403);
  });

  it('applies the better of happy hour and tier discount at start', async () => {
    const { day, minute } = localDayMinute(clock.now());
    const h = await ok(manager, 'POST', '/api/happy-hours', {
      name: 'Lunch rush',
      days: [day],
      startMinute: minute,
      endMinute: (minute + 60) % 1440,
      discountPercent: 30,
    });
    expect((await ok(cashier, 'GET', `/api/happy-hours/current?stationId=${stA}`)).happyHour.id).toBe(h.id);
    await ok(cashier, 'POST', `/api/customers/${esi}/wallet`, { operation: 'deposit', amount: 200_000, method: 'cash' });
    const s = await ok(cashier, 'POST', '/api/sessions', prepaid(stA, 60, { customerId: esi, paymentMethod: 'wallet' }));
    expect(s.discountPercent).toBe(30); // 30% happy hour beats 10% Gold
    expect(s.happyHourId).toBe(h.id);
    expect(s.netAmount).toBe(105_000);
    await ok(manager, 'PATCH', `/api/happy-hours/${h.id}`, { active: false });
    expect((await ok(cashier, 'GET', `/api/happy-hours/current?stationId=${stA}`)).happyHour).toBeNull();

    // Void: everything back; wallet-paid money always returns to the wallet even if cash is requested
    clock.advance(10 * 60);
    await ok(cashier, 'POST', `/api/sessions/${s.id}/end`, {});
    const v = await ok(manager, 'POST', `/api/sessions/${s.id}/refund`, { reason: 'Console fault', method: 'cash' });
    expect(v.amount).toBe(105_000);
    expect(v.refunds[0].method).toBe('wallet');
    const c = await ok(cashier, 'GET', `/api/customers/${esi}`);
    expect(c.balance).toBe(200_000);
    const ledger = await handle.db.select().from(walletTransactions).where(eq(walletTransactions.customerId, esi));
    expect(ledger.reduce((a, t) => a + t.amount, 0)).toBe(c.balance);
    const audit = await ok(admin, 'GET', '/api/audit');
    expect(audit.some((a: any) => a.action === 'session.void')).toBe(true);
  });

  it('refuses refunds of deposits, and refunds count against revenue', async () => {
    const deposits = await ok(manager, 'GET', '/api/payments?kind=deposit');
    expect(deposits.length).toBeGreaterThan(0);
    expect(deposits[0].refundable).toBe(0);
    expect(await status(manager, 'POST', `/api/payments/${deposits[0].id}/refund`, { reason: 'Mistake' })).toBe(400);
    const refunds = await ok(manager, 'GET', '/api/payments?kind=refund');
    expect(refunds.every((p: any) => p.amount < 0)).toBe(true);
    expect(await status(cashier, 'GET', '/api/payments')).toBe(403);
  });
});

describe('manual discounts and pay-later tabs', () => {
  it('manual discount needs permission and a reason', async () => {
    const s = await ok(cashier, 'POST', '/api/sessions', postpaid(stA));
    clock.advance(40 * 60); // 100,000
    expect(await status(cashier, 'POST', `/api/sessions/${s.id}/end`, { manualDiscount: 10_000, discountReason: 'Regular', paymentMethod: 'cash' })).toBe(428);
    expect(await status(manager, 'POST', `/api/sessions/${s.id}/end`, { manualDiscount: 10_000, paymentMethod: 'cash' })).toBe(400);
    const e = await ok(manager, 'POST', `/api/sessions/${s.id}/end`, { manualDiscount: 10_000, discountReason: 'Controller drift', paymentMethod: 'cash' });
    expect(e.netAmount).toBe(90_000);
    expect(e.manualDiscount).toBe(10_000);
  });

  it('tabs respect credit limits, allow part-payment, and settle later', async () => {
    const kwame = (await ok(cashier, 'POST', '/api/customers', { fullName: 'Kwame Asante' })).id;
    const s1 = await ok(cashier, 'POST', '/api/sessions', postpaid(stA, { customerId: kwame }));
    clock.advance(60 * 60); // 150,000
    expect(await status(manager, 'POST', `/api/sessions/${s1.id}/end`, { payLater: true })).toBe(409); // no credit limit
    expect(await status(cashier, 'PATCH', `/api/customers/${kwame}`, { creditLimit: 200_000 })).toBe(403);
    await ok(manager, 'PATCH', `/api/customers/${kwame}`, { creditLimit: 200_000 });
    expect(await status(cashier, 'POST', `/api/sessions/${s1.id}/end`, { payLater: true })).toBe(403);

    const e1 = await ok(manager, 'POST', `/api/sessions/${s1.id}/end`, { payLater: true, paymentMethod: undefined, payments: [{ method: 'cash', amount: 50_000 }] });
    expect(e1.status).toBe('ended');
    expect(e1.onTab).toBe(true);
    expect(e1.balanceDue).toBe(100_000);
    expect((await ok(cashier, 'GET', `/api/customers/${kwame}`)).outstanding).toBe(100_000);

    const s2 = await ok(cashier, 'POST', '/api/sessions', postpaid(stA, { customerId: kwame }));
    clock.advance(60 * 60);
    expect(await status(manager, 'POST', `/api/sessions/${s2.id}/end`, { payLater: true })).toBe(409); // 100k + 150k > 200k
    await ok(manager, 'POST', `/api/sessions/${s2.id}/end`, { paymentMethod: 'card' });

    const tabs = await ok(cashier, 'GET', '/api/tabs');
    expect(tabs.total).toBe(100_000);
    expect(tabs.customers[0].customerId).toBe(kwame);
    expect((await ok(admin, 'GET', '/api/dashboard')).openTabs.owed).toBe(100_000);

    expect(await status(cashier, 'POST', `/api/sessions/${s1.id}/settle`, { payments: [{ method: 'cash', amount: 150_000 }] })).toBe(400);
    const p1 = await ok(cashier, 'POST', `/api/sessions/${s1.id}/settle`, { payments: [{ method: 'cash', amount: 40_000 }] });
    expect(p1.balanceDue).toBe(60_000);
    expect(p1.onTab).toBe(true);
    const p2 = await ok(cashier, 'POST', `/api/sessions/${s1.id}/settle`, { paymentMethod: 'mobile_money' });
    expect(p2.balanceDue).toBe(0);
    expect(p2.onTab).toBe(false);
    expect(await status(cashier, 'POST', `/api/sessions/${s1.id}/settle`, { paymentMethod: 'cash' })).toBe(409);
    expect((await ok(cashier, 'GET', `/api/customers/${kwame}`)).outstanding).toBe(0);
    expect((await ok(cashier, 'GET', '/api/tabs')).total).toBe(0);
  });

  it('builds a receipt for a session', async () => {
    const [last] = await ok(cashier, 'GET', '/api/sessions?limit=1');
    const r = await ok(cashier, 'GET', `/api/receipts/session/${last.id}`);
    expect(r.settings.centerName).toBe('ZENAA GAMEHUB');
    expect(r.session.stationName).toBeTruthy();
    expect(r.payments.length).toBeGreaterThan(0);
  });
});
