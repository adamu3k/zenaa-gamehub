/**
 * v0.9.7 — taking time off a running session (staff and the customer app), and "Book now" / any-minute bookings.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { ensureAdmin } from '../src/bootstrap.js';
import { openDatabase, type DbHandle } from '../src/db/index.js';
import { ManualClock } from '../src/lib/clock.js';
import { Bus } from '../src/realtime/bus.js';

let handle: DbHandle;
let app: FastifyInstance;
const clock = new ManualClock(Date.parse('2026-05-04T12:00:00Z'));
let admin = '';
let cashier = '';
let pc = '';
let pc2 = '';
let pc3 = '';
let pcCat = '';
let pcPlan = '';

async function call(token: string, method: string, url: string, payload?: unknown) {
  const res = await app.inject({ method: method as any, url, payload: payload as any, headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: res.statusCode, body: res.json() as any };
}
const ok = async (token: string, method: string, url: string, payload?: unknown) => {
  const r = await call(token, method, url, payload);
  if (r.status !== 200) throw new Error(`${method} ${url} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const signup = async (name: string, phone: string) => {
  const token = (await ok('', 'POST', '/api/portal/signup', { fullName: name, phone, password: 'secret-pass-1' })).token as string;
  const me = await ok(token, 'GET', '/api/portal/me');
  return { token, id: me.id as string };
};

beforeAll(async () => {
  handle = await openDatabase({ pgliteDir: null });
  app = await buildApp({ db: handle.db, clock, bus: new Bus() } as any, { jwtSecret: 'test-secret-test-secret-test-secret-123' });
  await ensureAdmin(handle.db, 'admin', 'admin-pass-123');
  admin = (await ok('', 'POST', '/api/auth/login', { username: 'admin', password: 'admin-pass-123' })).token;
  await ok(admin, 'POST', '/api/staff', { username: 'cash7', fullName: 'Kofi Cashier', role: 'cashier', password: 'cashier-pass' });
  cashier = (await ok('', 'POST', '/api/auth/login', { username: 'cash7', password: 'cashier-pass' })).token;
  pcCat = (await ok(admin, 'POST', '/api/station-categories', { name: 'PC' })).id;
  pc = (await ok(admin, 'POST', '/api/stations', { code: 'PC-01', name: 'PC 1', platform: 'pc', categoryId: pcCat })).id;
  pc2 = (await ok(admin, 'POST', '/api/stations', { code: 'PC-02', name: 'PC 2', platform: 'pc', categoryId: pcCat })).id;
  pc3 = (await ok(admin, 'POST', '/api/stations', { code: 'PC-03', name: 'PC 3', platform: 'pc', categoryId: pcCat })).id;
  pcPlan = (await ok(admin, 'POST', '/api/pricing-plans', { name: 'PC hourly', kind: 'time_rate', ratePerHour: 1_200, categoryId: pcCat })).id;
  const s = await ok(admin, 'GET', '/api/settings');
  await ok(admin, 'PUT', '/api/settings', { ...s, openingTime: '00:00', closingTime: '00:00', powerOffDelaySeconds: 0, bookingMinNoticeMinutes: 30, bookingAutoConfirm: true });
});

afterAll(async () => {
  await app?.close();
  await handle?.close();
});

describe('taking time off a running session', () => {
  it('staff: time goes back on saved time; money back in cash; a walk-in can only be shortened or refunded', async () => {
    const ama = await signup('Ama Mensah', '0241120001');
    const s = await ok(admin, 'POST', '/api/sessions', { stationId: pc, planId: pcPlan, billingType: 'prepaid', customerId: ama.id, minutes: 120, paymentMethod: 'cash' });
    expect(s).toMatchObject({ netAmount: 2_400, paidAmount: 2_400 });
    clock.advance(10 * 60);

    // 30 min back on saved time; the price stays
    let r = await ok(cashier, 'POST', `/api/sessions/${s.id}/reduce`, { minutes: 30, back: 'saved' });
    expect(r).toMatchObject({ allottedSeconds: 90 * 60, netAmount: 2_400, remainingSeconds: 80 * 60 });
    let c = await ok(admin, 'GET', `/api/customers/${ama.id}`);
    expect(c.savedSeconds).toBe(30 * 60);

    // 30 min refunded in cash: half of the remaining 90 bought minutes' price share
    expect((await call(cashier, 'POST', `/api/sessions/${s.id}/reduce`, { minutes: 30, back: 'refund' })).status).toBe(403); // cashiers can't refund
    r = await ok(admin, 'POST', `/api/sessions/${s.id}/reduce`, { minutes: 30, back: 'refund', method: 'cash' });
    expect(r).toMatchObject({ allottedSeconds: 60 * 60, netAmount: 1_600, refundedAmount: 800 });

    // can't take off more than what is left (keep 1 minute)
    clock.advance(45 * 60);
    const tooMuch = await call(admin, 'POST', `/api/sessions/${s.id}/reduce`, { minutes: 5, back: 'keep' });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.message ?? tooMuch.body.error).toMatch(/At most 4 min/);
    r = await ok(admin, 'POST', `/api/sessions/${s.id}/reduce`, { minutes: 2, back: 'keep' });
    expect(r).toMatchObject({ allottedSeconds: 58 * 60, netAmount: 1_600 });
    await ok(admin, 'POST', `/api/sessions/${s.id}/end`, {});

    // walk-in: no saved time to put it on
    const w = await ok(admin, 'POST', '/api/sessions', { stationId: pc, planId: pcPlan, billingType: 'prepaid', minutes: 60, paymentMethod: 'cash' });
    expect((await call(admin, 'POST', `/api/sessions/${w.id}/reduce`, { minutes: 10, back: 'saved' })).status).toBe(400);
    await ok(admin, 'POST', `/api/sessions/${w.id}/end`, {});

    // pay-as-you-go: refused
    const pp = await ok(admin, 'POST', '/api/sessions', { stationId: pc, planId: pcPlan, billingType: 'postpaid' });
    expect((await call(admin, 'POST', `/api/sessions/${pp.id}/reduce`, { minutes: 10 })).status).toBe(400);
    await ok(admin, 'POST', `/api/sessions/${pp.id}/end`, { paymentMethod: 'cash' });
  });

  it('pay later: taking time off lowers what they owe instead of giving money back', async () => {
    const kofi = await signup('Kofi Boateng', '0241120002');
    await ok(admin, 'PATCH', `/api/customers/${kofi.id}`, { creditLimit: 10_000 });
    const s = await ok(admin, 'POST', '/api/sessions', { stationId: pc2, planId: pcPlan, billingType: 'prepaid', customerId: kofi.id, minutes: 60, payLater: true });
    expect(s).toMatchObject({ netAmount: 1_200, paidAmount: 0, onTab: true });
    const r = await ok(admin, 'POST', `/api/sessions/${s.id}/reduce`, { minutes: 30, back: 'refund' });
    expect(r).toMatchObject({ netAmount: 600, refundedAmount: 0, onTab: true });
    const c = await ok(admin, 'GET', `/api/customers/${kofi.id}`);
    expect(c.outstanding ?? c.tab?.owed).toBe(600);
    await ok(admin, 'POST', `/api/sessions/${s.id}/end`, { payLater: true });
  });

  it('customer app: takes time off their own session and it goes back on saved time', async () => {
    const yaw = await signup('Yaw Ofori', '0241120003');
    await ok(admin, 'POST', `/api/customers/${yaw.id}/time`, { mode: 'buy', minutes: 90, planId: pcPlan, paymentMethod: 'cash' });
    const s = await ok(yaw.token, 'POST', '/api/portal/play/start', { stationId: pc3 });
    expect(s.allottedSeconds).toBe(90 * 60);
    const r = await ok(yaw.token, 'POST', `/api/portal/play/${s.id}/reduce`, { minutes: 40 });
    expect(r.allottedSeconds).toBe(50 * 60);
    const me = await ok(yaw.token, 'GET', '/api/portal/me');
    expect(me.savedSeconds).toBe(40 * 60);
    expect(me.savedTime[0]).toMatchObject({ categoryId: pcCat, seconds: 40 * 60 });
    const other = await signup('Esi Owusu', '0241120004');
    expect((await call(other.token, 'POST', `/api/portal/play/${s.id}/reduce`, { minutes: 5 })).status).toBe(404);
    await ok(yaw.token, 'POST', `/api/portal/play/${s.id}/stop`);
  });
});

describe('book now and any-minute bookings', () => {
  it('"Book now" starts this minute without the advance notice; custom start minute and length work', async () => {
    const esi = await signup('Esi Mensah', '0241120005');
    // normal booking inside the notice period is refused
    const soon = new Date(clock.now().getTime() + 5 * 60_000).toISOString();
    expect((await call(esi.token, 'POST', '/api/portal/bookings', { stationId: pc, startAt: soon, minutes: 45 })).status).toBe(400);
    clock.advance(17); // not on a whole minute
    const b = await ok(esi.token, 'POST', '/api/portal/bookings', { stationId: pc, startAt: clock.now().toISOString(), minutes: 45, now: true });
    expect(new Date(b.startAt).getSeconds()).toBe(0);
    expect(new Date(b.endAt).getTime() - new Date(b.startAt).getTime()).toBe(45 * 60_000);
    // custom minute: 13:47 for 1 h 25 min
    const at = new Date(clock.now().getTime() + 3 * 3600_000);
    at.setUTCSeconds(0, 0);
    at.setUTCMinutes(47);
    const avail = await ok(esi.token, 'GET', `/api/portal/availability?start=${encodeURIComponent(at.toISOString())}&minutes=85`);
    expect(avail.stations.find((s: any) => s.id === pc2).available).toBe(true);
    const b2 = await ok(esi.token, 'POST', '/api/portal/bookings', { stationId: pc2, startAt: at.toISOString(), minutes: 85 });
    expect(new Date(b2.startAt).getUTCMinutes()).toBe(47);
  });
});
