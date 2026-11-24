/**
 * v0.9.8 — what a customer owes shows as a minus balance and is paid first by money put into the wallet
 * (cash at the counter, MoMo code, Paystack); "Pay from my wallet" in the app; game packages when booking.
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
let pc = '';
let pc2 = '';
let pcCat = '';
let pcPlan = '';
let pkgPlan = '';

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
const setSettings = async (patch: Record<string, unknown>) => ok(admin, 'PUT', '/api/settings', { ...(await ok(admin, 'GET', '/api/settings')), ...patch });
/** Plays 60 min on account (pay later) and ends: owes 1 200. */
const owe = async (customerId: string, station = pc) => {
  const s = await ok(admin, 'POST', '/api/sessions', { stationId: station, planId: pcPlan, billingType: 'prepaid', customerId, minutes: 60, payLater: true });
  await ok(admin, 'POST', `/api/sessions/${s.id}/end`, { payLater: true });
};

beforeAll(async () => {
  handle = await openDatabase({ pgliteDir: null });
  app = await buildApp({ db: handle.db, clock, bus: new Bus() } as any, { jwtSecret: 'test-secret-test-secret-test-secret-123' });
  await ensureAdmin(handle.db, 'admin', 'admin-pass-123');
  admin = (await ok('', 'POST', '/api/auth/login', { username: 'admin', password: 'admin-pass-123' })).token;
  pcCat = (await ok(admin, 'POST', '/api/station-categories', { name: 'PC' })).id;
  pc = (await ok(admin, 'POST', '/api/stations', { code: 'PC-01', name: 'PC 1', platform: 'pc', categoryId: pcCat })).id;
  pc2 = (await ok(admin, 'POST', '/api/stations', { code: 'PC-02', name: 'PC 2', platform: 'pc', categoryId: pcCat })).id;
  pcPlan = (await ok(admin, 'POST', '/api/pricing-plans', { name: 'PC hourly', kind: 'time_rate', ratePerHour: 1_200, categoryId: pcCat })).id;
  pkgPlan = (await ok(admin, 'POST', '/api/pricing-plans', { name: 'GTA 5 — 3 hours', kind: 'package', ratePerHour: 1_000, packageMinutes: 180, packagePrice: 3_000, categoryId: pcCat })).id;
  await setSettings({ openingTime: '00:00', closingTime: '00:00', powerOffDelaySeconds: 0, defaultCreditLimit: 50_000, bookingMinNoticeMinutes: 0, bookingAutoConfirm: true });
});

afterAll(async () => {
  await app?.close();
  await handle?.close();
});

describe('owed money is paid first by money put into the wallet', () => {
  it('cash top-up at the counter pays what is owed; the rest stays in the wallet', async () => {
    const ama = await signup('Ama Mensah', '0241130001');
    await owe(ama.id);
    let me = await ok(ama.token, 'GET', '/api/portal/me');
    expect(me).toMatchObject({ balance: 0, outstanding: 1_200 });
    const dep = await ok(admin, 'POST', `/api/customers/${ama.id}/wallet`, { operation: 'deposit', amount: 2_000, method: 'cash' });
    expect(dep.paidOwed).toBe(1_200);
    me = await ok(ama.token, 'GET', '/api/portal/me');
    expect(me).toMatchObject({ balance: 800, outstanding: 0 });
    // a small top-up pays part of it
    await owe(ama.id);
    await ok(admin, 'POST', `/api/customers/${ama.id}/wallet`, { operation: 'deposit', amount: 200, method: 'cash' });
    me = await ok(ama.token, 'GET', '/api/portal/me');
    expect(me).toMatchObject({ balance: 0, outstanding: 200 });
  });

  it('with the setting off, top-ups stay in the wallet and the customer pays from the app', async () => {
    await setSettings({ autoPayOwed: false });
    const kofi = await signup('Kofi Boateng', '0241130002');
    await owe(kofi.id);
    await ok(admin, 'POST', `/api/customers/${kofi.id}/wallet`, { operation: 'deposit', amount: 500, method: 'cash' });
    let me = await ok(kofi.token, 'GET', '/api/portal/me');
    expect(me).toMatchObject({ balance: 500, outstanding: 1_200 });
    const r = await ok(kofi.token, 'POST', '/api/portal/account/pay-from-wallet');
    expect(r).toEqual({ paid: 500, outstanding: 700 });
    me = await ok(kofi.token, 'GET', '/api/portal/me');
    expect(me).toMatchObject({ balance: 0, outstanding: 700 });
    expect((await call(kofi.token, 'POST', '/api/portal/account/pay-from-wallet')).status).toBe(409); // wallet empty
    await setSettings({ autoPayOwed: true });
  });

  it('a MoMo code payment pays what is owed', async () => {
    await setSettings({ momoAccounts: [{ network: 'MTN MoMo', number: '0240000000', name: 'ZENAA' }], momoMinTopup: 100 });
    const yaw = await signup('Yaw Ofori', '0241130003');
    await owe(yaw.id);
    const req = await ok(yaw.token, 'POST', '/api/portal/momo', { amount: 1_200, network: 'MTN MoMo' });
    expect(req.code).toMatch(/^\d{6}$/);
    await ok(admin, 'POST', `/api/momo/requests/${req.id}/confirm`, { txnId: 'TX12345678' });
    const me = await ok(yaw.token, 'GET', '/api/portal/me');
    expect(me).toMatchObject({ balance: 0, outstanding: 0 });
  });
});

describe('game packages when booking', () => {
  it('lists prices and packages for the booking; paying with a package puts whole packages on saved time', async () => {
    const esi = await signup('Esi Owusu', '0241130004');
    await ok(admin, 'POST', `/api/customers/${esi.id}/wallet`, { operation: 'deposit', amount: 5_000, method: 'cash' });
    const q = await ok(esi.token, 'GET', `/api/portal/booking-quote?stationId=${pc2}&minutes=180`);
    expect(q.options.map((o: any) => [o.name, o.price, o.minutes])).toEqual(
      expect.arrayContaining([
        ['PC hourly', 3_600, 180],
        ['GTA 5 — 3 hours', 3_000, 180],
      ]),
    );
    const qp = await ok(esi.token, 'GET', `/api/portal/booking-quote?stationId=${pc2}&minutes=180&planId=${pkgPlan}`);
    expect(qp).toMatchObject({ planId: pkgPlan, price: 3_000, minutes: 180 });
    const startAt = new Date(clock.now().getTime() + 3600_000).toISOString();
    const b = await ok(esi.token, 'POST', '/api/portal/bookings', { stationId: pc2, startAt, minutes: 180, pay: 'wallet', planId: pkgPlan });
    expect(b).toMatchObject({ payment: 'wallet', paidAmount: 3_000, paidSeconds: 180 * 60, planId: pkgPlan });
    const me = await ok(esi.token, 'GET', '/api/portal/me');
    expect(me.balance).toBe(2_000);
    expect(me.savedSeconds).toBe(180 * 60);
  });
});
