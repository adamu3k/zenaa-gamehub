/**
 * v0.9.1 — saved playing time on customer accounts: sell time, save what's left at the end, continue later.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { ROLE_DEFAULTS } from '../src/auth/permissions.js';
import { ensureAdmin } from '../src/bootstrap.js';
import { openDatabase, type DbHandle } from '../src/db/index.js';
import { ManualClock } from '../src/lib/clock.js';
import { Bus } from '../src/realtime/bus.js';

let handle: DbHandle;
let app: FastifyInstance;
const clock = new ManualClock(Date.parse('2026-05-04T12:00:00Z'));
let admin = '';
let cashier = '';
let station = '';
let hourly = '';
let pack = '';
let cust = '';

async function call(token: string, method: string, url: string, payload?: unknown) {
  const res = await app.inject({ method: method as any, url, payload: payload as any, headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: res.statusCode, body: res.json() as any };
}
const ok = async (token: string, method: string, url: string, payload?: unknown) => {
  const r = await call(token, method, url, payload);
  if (r.status !== 200) throw new Error(`${method} ${url} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const saved = async () => (await ok(admin, 'GET', `/api/customers/${cust}`)).savedSeconds as number;

beforeAll(async () => {
  handle = await openDatabase({ pgliteDir: null });
  app = await buildApp({ db: handle.db, clock, bus: new Bus() }, { jwtSecret: 'test-secret-test-secret-test-secret-123' });
  await ensureAdmin(handle.db, 'admin', 'admin-pass-123');
  admin = (await ok('', 'POST', '/api/auth/login', { username: 'admin', password: 'admin-pass-123' })).token;
  await ok(admin, 'POST', '/api/staff', { username: 'cash2', fullName: 'Kofi Cashier', role: 'cashier', password: 'cashier-pass' });
  cashier = (await ok('', 'POST', '/api/auth/login', { username: 'cash2', password: 'cashier-pass' })).token;
  station = (await ok(admin, 'POST', '/api/stations', { code: 'PS-09', name: 'PS5 #9', platform: 'ps5' })).id;
  hourly = (await ok(admin, 'POST', '/api/pricing-plans', { name: 'Hourly', kind: 'time_rate', ratePerHour: 2000 })).id;
  pack = (await ok(admin, 'POST', '/api/pricing-plans', { name: '3h pack', kind: 'package', ratePerHour: 2000, packageMinutes: 180, packagePrice: 5000 })).id;
  cust = (await ok(admin, 'POST', '/api/customers', { fullName: 'Yaw Gamer', phone: '0241112222' })).id;
});

afterAll(async () => {
  await app?.close();
  await handle?.close();
});

describe('saved time', () => {
  it('lets admins (and managers) sell or correct time, not cashiers', async () => {
    expect(ROLE_DEFAULTS.cashier).not.toContain('customers.time');
    expect((await call(cashier, 'POST', `/api/customers/${cust}/time`, { mode: 'adjust', minutes: 30, note: 'x' })).status).toBe(403);
    await ok(admin, 'POST', `/api/customers/${cust}/time`, { mode: 'buy', planId: pack, packages: 1, paymentMethod: 'cash' });
    expect(await saved()).toBe(180 * 60);
    expect((await call(admin, 'POST', `/api/customers/${cust}/time`, { mode: 'adjust', minutes: 15 })).status).toBe(400); // needs a reason
    await ok(admin, 'POST', `/api/customers/${cust}/time`, { mode: 'adjust', minutes: -20, note: 'correction' });
    expect(await saved()).toBe(160 * 60);
    const d = await ok(admin, 'GET', `/api/customers/${cust}`);
    expect(d.timeLog.map((t: any) => t.kind).sort()).toEqual(['adjust', 'bought']);
    expect(d.timeLog.find((t: any) => t.kind === 'bought').amount).toBe(5000);
  });

  it('plays from saved time for free and puts the rest back at the end', async () => {
    const s = await ok(cashier, 'POST', '/api/sessions', { stationId: station, planId: hourly, billingType: 'prepaid', customerId: cust, useSavedTime: true, minutes: 60 });
    expect(s).toMatchObject({ allottedSeconds: 3600, netAmount: 0, paidAmount: 0, fromSavedSeconds: 3600 });
    expect(await saved()).toBe(100 * 60);
    clock.set(new Date(clock.now().getTime() + 25 * 60_000));
    const end = await ok(cashier, 'POST', `/api/sessions/${s.id}/end`, { saveRemaining: true });
    expect(end.savedSeconds).toBe(35 * 60);
    expect(end.unused.amount).toBe(0); // nothing to refund once it is saved
    expect(await saved()).toBe(135 * 60);
  });

  it('saves the rest of a paid prepaid session too, and refuses when nothing is saved', async () => {
    const s = await ok(cashier, 'POST', '/api/sessions', { stationId: station, planId: hourly, billingType: 'prepaid', customerId: cust, minutes: 30, paymentMethod: 'cash' });
    clock.set(new Date(clock.now().getTime() + 10 * 60_000));
    await ok(cashier, 'POST', `/api/sessions/${s.id}/end`, { saveRemaining: true });
    expect(await saved()).toBe(155 * 60);
    const portalLess = await ok(admin, 'POST', '/api/customers', { fullName: 'New Kid' });
    const r = await call(cashier, 'POST', '/api/sessions', { stationId: station, planId: hourly, billingType: 'prepaid', customerId: portalLess.id, useSavedTime: true });
    expect(r.status).toBe(409);
    // All of it when no minutes are given.
    const all = await ok(cashier, 'POST', '/api/sessions', { stationId: station, planId: hourly, billingType: 'prepaid', customerId: cust, useSavedTime: true });
    expect(all.allottedSeconds).toBe(155 * 60);
    expect(await saved()).toBe(0);
  });
});
