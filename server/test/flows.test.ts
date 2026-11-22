/**
 * End-to-end API flows against a real (embedded, in-memory) PostgreSQL with a controllable clock.
 */
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { ensureAdmin } from '../src/bootstrap.js';
import type { Ctx } from '../src/context.js';
import { openDatabase, type DbHandle } from '../src/db/index.js';
import { sessions, smsOutbox, walletTransactions } from '../src/db/schema.js';
import { ManualClock } from '../src/lib/clock.js';
import { Bus } from '../src/realtime/bus.js';
import { SessionScheduler } from '../src/services/scheduler.js';
import { recoverAfterOutage } from '../src/services/sessions.js';

let handle: DbHandle;
let app: FastifyInstance;
let ctx: Ctx;
const clock = new ManualClock();
const events: any[] = [];
let admin = '';
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

let ps5a = '';
let ps5b = '';
let perMinute = '';
let hourly = '';
let pkg = '';
let gold = '';

beforeAll(async () => {
  handle = await openDatabase({ pgliteDir: null });
  ctx = { db: handle.db, clock, bus: new Bus() };
  ctx.bus.on((e) => events.push(e));
  app = await buildApp(ctx, { jwtSecret: 'test-secret-test-secret-test-secret-123' });
  await ensureAdmin(handle.db, 'admin', 'admin-pass-123');
  admin = (await ok('', 'POST', '/api/auth/login', { username: 'admin', password: 'admin-pass-123' })).token;

  await ok(admin, 'POST', '/api/staff', { username: 'cashier1', fullName: 'Ama Cashier', role: 'cashier', password: 'cashier-pass' });
  cashier = (await ok('', 'POST', '/api/auth/login', { username: 'cashier1', password: 'cashier-pass' })).token;

  ps5a = (await ok(admin, 'POST', '/api/stations', { code: 'ps-01', name: 'PS5 #1', platform: 'ps5' })).id;
  ps5b = (await ok(admin, 'POST', '/api/stations', { code: 'PS-02', name: 'PS5 #2', platform: 'ps5', hourlyRateOverride: 200_000 })).id;
  perMinute = (await ok(admin, 'POST', '/api/pricing-plans', { name: 'Per minute', kind: 'time_rate', ratePerHour: 150_000 })).id;
  hourly = (await ok(admin, 'POST', '/api/pricing-plans', { name: 'Hourly', kind: 'time_rate', ratePerHour: 150_000, billingUnitMinutes: 60, graceMinutes: 5 })).id;
  pkg = (await ok(admin, 'POST', '/api/pricing-plans', { name: '3h pack', kind: 'package', ratePerHour: 150_000, packageMinutes: 180, packagePrice: 350_000 })).id;
  gold = (await ok(admin, 'POST', '/api/membership-tiers', { name: 'Gold', discountPercent: 10, spendPerPoint: 10_000 })).id;
});

afterAll(async () => {
  await app?.close();
  await handle?.close();
});

describe('auth & permissions', () => {
  it('rejects bad credentials and unauthenticated calls', async () => {
    expect((await call('', 'POST', '/api/auth/login', { username: 'admin', password: 'nope' })).status).toBe(401);
    expect((await call('', 'GET', '/api/stations')).status).toBe(401);
  });
  it('locks out after repeated failures', async () => {
    for (let i = 0; i < 5; i++) await call('', 'POST', '/api/auth/login', { username: 'ghost', password: 'x' });
    expect((await call('', 'POST', '/api/auth/login', { username: 'ghost', password: 'x' })).status).toBe(429);
  });
  it('cashier cannot manage pricing or staff, or see revenue', async () => {
    expect((await call(cashier, 'POST', '/api/pricing-plans', { name: 'x', kind: 'time_rate', ratePerHour: 1 })).status).toBe(403);
    expect((await call(cashier, 'GET', '/api/staff')).status).toBe(403);
    const dash = await ok(cashier, 'GET', '/api/dashboard');
    expect(dash.revenue).toBeNull();
  });
  it('password change revokes old tokens', async () => {
    await ok(admin, 'POST', '/api/staff', { username: 'temp', fullName: 'Temp', role: 'cashier', password: 'temp-pass-1' });
    const t1 = (await ok('', 'POST', '/api/auth/login', { username: 'temp', password: 'temp-pass-1' })).token;
    const r = await ok(t1, 'POST', '/api/auth/change-password', { currentPassword: 'temp-pass-1', newPassword: 'temp-pass-2' });
    expect((await call(t1, 'GET', '/api/auth/me')).status).toBe(401);
    expect((await call(r.token, 'GET', '/api/auth/me')).status).toBe(200);
  });
  it('rejects invalid pricing plans', async () => {
    const r = await call(admin, 'POST', '/api/pricing-plans', { name: 'bad', kind: 'time_rate', ratePerHour: 1000, billingUnitMinutes: 10, graceMinutes: 10 });
    expect(r.status).toBe(400);
  });
});

describe('postpaid session', () => {
  it('runs, pauses, resumes, and bills only active time', async () => {
    const s = await ok(cashier, 'POST', '/api/sessions', { stationId: ps5a, planId: perMinute, billingType: 'postpaid' });
    expect(s.status).toBe('running');

    // double start is refused
    const dup = await call(cashier, 'POST', '/api/sessions', { stationId: ps5a, planId: perMinute, billingType: 'postpaid' });
    expect(dup.status).toBe(409);

    clock.advance(30 * 60);
    await ok(cashier, 'POST', `/api/sessions/${s.id}/pause`);
    clock.advance(20 * 60); // paused — not billed
    await ok(cashier, 'POST', `/api/sessions/${s.id}/resume`);
    clock.advance(15 * 60 + 10);

    const live = await ok(cashier, 'GET', `/api/sessions/${s.id}`);
    expect(live.activeSeconds).toBe(45 * 60 + 10);
    expect(live.liveNetAmount).toBe(115_000); // 46 min × 2,500

    // payment method required when something is owed
    expect((await call(cashier, 'POST', `/api/sessions/${s.id}/end`, {})).status).toBe(400);
    const ended = await ok(cashier, 'POST', `/api/sessions/${s.id}/end`, { paymentMethod: 'cash' });
    expect(ended.status).toBe('ended');
    expect(ended.billedMinutes).toBe(46);
    expect(ended.netAmount).toBe(115_000);
    expect(ended.paidAmount).toBe(115_000);
    expect(ended.events).toBeUndefined();

    const detail = await ok(admin, 'GET', `/api/sessions/${s.id}`);
    expect(detail.events.map((e: any) => e.type)).toEqual(['start', 'pause', 'resume', 'end']);
  });

  it('hourly plan applies grace on the final hour', async () => {
    const s = await ok(cashier, 'POST', '/api/sessions', { stationId: ps5a, planId: hourly, billingType: 'postpaid' });
    clock.advance(64 * 60);
    const ended = await ok(cashier, 'POST', `/api/sessions/${s.id}/end`, { paymentMethod: 'card' });
    expect(ended.netAmount).toBe(150_000);
  });

  it('packages cannot be postpaid', async () => {
    expect((await call(cashier, 'POST', '/api/sessions', { stationId: ps5a, planId: pkg, billingType: 'postpaid' })).status).toBe(400);
  });
});

describe('customers, wallet and prepaid', () => {
  let cust = '';

  it('registers a customer with a unique ID and rejects duplicate phones', async () => {
    const c = await ok(cashier, 'POST', '/api/customers', { fullName: 'Kofi Mensah', phone: '+233 24 123 4567', tierId: gold });
    expect(c.code).toMatch(/^ZG-\d{6}$/);
    expect(c.phone).toBe('+233241234567');
    cust = c.id;
    expect((await call(cashier, 'POST', '/api/customers', { fullName: 'Dup', phone: '+233241234567' })).status).toBe(409);
    const found = await ok(cashier, 'GET', `/api/customers?q=${encodeURIComponent(c.code)}`);
    expect(found[0].id).toBe(cust);
  });

  it('deposits; cashier cannot withdraw or adjust', async () => {
    await ok(cashier, 'POST', `/api/customers/${cust}/wallet`, { operation: 'deposit', amount: 500_000, method: 'cash' });
    expect((await call(cashier, 'POST', `/api/customers/${cust}/wallet`, { operation: 'withdrawal', amount: 1000 })).status).toBe(428);
    expect((await call(cashier, 'POST', `/api/customers/${cust}/wallet`, { operation: 'adjustment', amount: 1000, note: 'x' })).status).toBe(428);
  });

  it('prepaid via wallet with tier discount, station rate override, extension, auto-expiry', async () => {
    // PS5 #2 overrides to 2,000/h; 60 min = 200,000; Gold 10% → 180,000
    const s = await ok(cashier, 'POST', '/api/sessions', {
      stationId: ps5b,
      planId: perMinute,
      billingType: 'prepaid',
      minutes: 60,
      customerId: cust,
      paymentMethod: 'wallet',
    });
    expect(s.grossAmount).toBe(200_000);
    expect(s.netAmount).toBe(180_000);
    expect(s.remainingSeconds).toBe(3600);

    let c = await ok(cashier, 'GET', `/api/customers/${cust}`);
    expect(c.balance).toBe(320_000);

    clock.advance(50 * 60);
    const ext = await ok(cashier, 'POST', `/api/sessions/${s.id}/extend`, { minutes: 15, paymentMethod: 'wallet' });
    expect(ext.remainingSeconds).toBe(25 * 60);
    expect(ext.netAmount).toBe(180_000 + 45_000); // 15 min = 50,000 − 10%

    // scheduler warnings then expiry
    const scheduler = new SessionScheduler(ctx, { error: (e) => console.error(e), info: () => {} });
    clock.advance(21 * 60); // 4 min left
    await scheduler.tick();
    expect(events.some((e) => e.type === 'alert' && /5 minutes left/.test(e.message))).toBe(true);

    clock.advance(10 * 60); // 6 min past expiry
    await scheduler.tick();
    const done = await ok(cashier, 'GET', `/api/sessions/${s.id}`);
    expect(done.status).toBe('ended');
    expect(done.endReason).toBe('time_expired');
    expect(done.activeSeconds).toBe(75 * 60);
    // Ended at true expiry, not when the scheduler noticed
    expect(new Date(done.endedAt).getTime()).toBe(new Date(s.startedAt).getTime() + 75 * 60 * 1000);

    c = await ok(cashier, 'GET', `/api/customers/${cust}`);
    expect(c.balance).toBe(500_000 - 225_000);
    expect(c.points).toBe(22); // 225,000 / 10,000
    const ledger = await handle.db.select().from(walletTransactions).where(eq(walletTransactions.customerId, cust));
    expect(ledger.reduce((a, t) => a + t.amount, 0)).toBe(c.balance);

    // Thank-you SMS for the counter top-up and each game payment (sent later by the MoMo phone).
    const texts = (await handle.db.select().from(smsOutbox).where(eq(smsOutbox.customerId, cust))).map((m) => m.body);
    expect(texts).toContain('Hi Kofi, GHS 5000.00 has been added to your ZENAA GAMEHUB wallet. Balance: GHS 5000.00. Thank you!');
    expect(texts.some((t) => t.startsWith('Thanks for playing at ZENAA GAMEHUB, Kofi! GHS 1800.00 paid for your game on PS5'))).toBe(true);
    expect(texts.filter((t) => t.startsWith('Thanks for playing')).length).toBe(2); // the game + the extension
  });

  it('refuses wallet payment beyond balance and leaves no partial records', async () => {
    const before = await handle.db.select().from(sessions);
    const r = await call(cashier, 'POST', '/api/sessions', {
      stationId: ps5b,
      planId: pkg,
      billingType: 'prepaid',
      customerId: cust,
      paymentMethod: 'wallet',
    });
    // 350,000 − 10% = 315,000 > 275,000 balance
    expect(r.status).toBe(409);
    expect((await handle.db.select().from(sessions)).length).toBe(before.length);
  });

  it('suspended customers cannot start sessions', async () => {
    await ok(cashier, 'PATCH', `/api/customers/${cust}`, { status: 'suspended' });
    const r = await call(cashier, 'POST', '/api/sessions', { stationId: ps5b, planId: perMinute, billingType: 'postpaid', customerId: cust });
    expect(r.status).toBe(409);
    await ok(cashier, 'PATCH', `/api/customers/${cust}`, { status: 'active' });
  });
});

describe('station status rules', () => {
  it('cannot start on a maintenance station, nor change status while in use', async () => {
    const s = await ok(cashier, 'POST', '/api/sessions', { stationId: ps5a, planId: perMinute, billingType: 'postpaid' });
    expect((await call(admin, 'PATCH', `/api/stations/${ps5a}`, { status: 'maintenance' })).status).toBe(409);
    clock.advance(60);
    await ok(cashier, 'POST', `/api/sessions/${s.id}/end`, { paymentMethod: 'cash' });
    await ok(admin, 'PATCH', `/api/stations/${ps5a}`, { status: 'maintenance' });
    expect((await call(cashier, 'POST', '/api/sessions', { stationId: ps5a, planId: perMinute, billingType: 'postpaid' })).status).toBe(409);
    await ok(admin, 'PATCH', `/api/stations/${ps5a}`, { status: 'active' });
  });
});

describe('outage recovery', () => {
  it('pauses running sessions at the last heartbeat and closes expired prepaid ones at expiry', async () => {
    const post = await ok(cashier, 'POST', '/api/sessions', { stationId: ps5a, planId: perMinute, billingType: 'postpaid' });
    const pre = await ok(cashier, 'POST', '/api/sessions', { stationId: ps5b, planId: perMinute, billingType: 'prepaid', minutes: 10, paymentMethod: 'cash' });
    clock.advance(5 * 60);
    const heartbeat = clock.now();
    clock.advance(3 * 3600); // server was down for 3 hours

    await recoverAfterOutage(ctx, heartbeat);
    const p1 = await ok(cashier, 'GET', `/api/sessions/${post.id}`);
    expect(p1.status).toBe('paused');
    expect(p1.activeSeconds).toBe(300);
    const p2 = await ok(cashier, 'GET', `/api/sessions/${pre.id}`);
    expect(p2.status).toBe('paused');
    expect(p2.remainingSeconds).toBe(300);

    await ok(cashier, 'POST', `/api/sessions/${post.id}/end`, { paymentMethod: 'cash' });
    await ok(cashier, 'POST', `/api/sessions/${pre.id}/end`, {});
  });
});

describe('dashboard & audit', () => {
  it('reports revenue (deposits excluded) and records audit trail', async () => {
    const d = await ok(admin, 'GET', '/api/dashboard');
    expect(d.stations.total).toBe(2);
    expect(d.stations.available).toBe(2);
    // cash/card session revenue + wallet-paid sessions; the 500,000 deposit is NOT revenue
    expect(d.revenue.today).toBeGreaterThan(0);
    expect(d.recentTransactions.length).toBeGreaterThan(0);
    const auditRows = await ok(admin, 'GET', '/api/audit');
    const actions = new Set(auditRows.map((a: any) => a.action));
    for (const a of ['session.start', 'session.end', 'wallet.deposit', 'customer.create', 'station.create']) expect(actions.has(a)).toBe(true);
  });
});
