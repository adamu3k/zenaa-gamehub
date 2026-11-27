/**
 * v1.4 — play packages: spend / play this much in a day, week, month or date range → wallet bonus or free minutes,
 * paid once per period and announced on the counter speaker with the customer's name.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { ensureAdmin } from '../src/bootstrap.js';
import { openDatabase, type DbHandle } from '../src/db/index.js';
import { ManualClock } from '../src/lib/clock.js';
import { Bus, type BusEvent } from '../src/realtime/bus.js';
import { periodOf } from '../src/services/promo-packages.js';

let handle: DbHandle;
let app: FastifyInstance;
const clock = new ManualClock(Date.parse('2026-11-24T12:00:00Z')); // a Tuesday
const bus = new Bus();
const alerts: Extract<BusEvent, { type: 'alert' }>[] = [];
let admin = '';
let station = '';
let hourly = '';
let pack = '';
let amaId = '';

async function call(token: string, method: string, url: string, payload?: unknown) {
  const res = await app.inject({ method: method as any, url, payload: payload as any, headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: res.statusCode, body: res.json() as any };
}
const ok = async (token: string, method: string, url: string, payload?: unknown) => {
  const r = await call(token, method, url, payload);
  if (r.status !== 200) throw new Error(`${method} ${url} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const customer = async (id: string) => ok(admin, 'GET', `/api/customers/${id}`);

beforeAll(async () => {
  handle = await openDatabase({ pgliteDir: null });
  bus.on((e) => {
    if (e.type === 'alert') alerts.push(e);
  });
  app = await buildApp({ db: handle.db, clock, bus }, { jwtSecret: 'test-secret-test-secret-test-secret-123' });
  await ensureAdmin(handle.db, 'admin', 'admin-pass-123');
  admin = (await ok('', 'POST', '/api/auth/login', { username: 'admin', password: 'admin-pass-123' })).token;
  station = (await ok(admin, 'POST', '/api/stations', { code: 'PS-01', name: 'PS5 One', platform: 'ps5' })).id;
  hourly = (await ok(admin, 'POST', '/api/pricing-plans', { name: 'Hourly', kind: 'time_rate', ratePerHour: 2000 })).id;
  pack = (await ok(admin, 'POST', '/api/pricing-plans', { name: '3h pack', kind: 'package', ratePerHour: 2000, packageMinutes: 180, packagePrice: 5000 })).id;
});

afterAll(async () => {
  await app?.close();
  await handle?.close();
});

describe('play packages', () => {
  it('checks the shape', async () => {
    expect((await call(admin, 'POST', '/api/promo-packages', { name: 'Nothing', goal: 'spend', target: 100, period: 'week' })).status).toBe(400);
    expect((await call(admin, 'POST', '/api/promo-packages', { name: 'Bad', goal: 'oops', target: 100, period: 'week', bonusAmount: 1 })).status).toBe(400);
  });

  it('pays a spend bonus once per week and calls the name on the speaker', async () => {
    const p = await ok(admin, 'POST', '/api/promo-packages', { name: 'Spend 40 this week', goal: 'spend', target: 4000, period: 'week', bonusAmount: 500 });
    const yaw = (await ok(admin, 'POST', '/api/customers', { fullName: 'Yaw Mensah', phone: '0241113333' })).id;

    await ok(admin, 'POST', `/api/customers/${yaw}/time`, { mode: 'buy', planId: pack, packages: 1, paymentMethod: 'cash' }); // 50.00
    expect((await customer(yaw)).balance).toBe(500);
    const a = alerts.find((x) => x.sound === 'promo');
    expect(a?.speak).toBe('Yaw, your promo bonus has been added. Thank you!');

    // Same week: no second bonus.
    await ok(admin, 'POST', `/api/customers/${yaw}/time`, { mode: 'buy', planId: pack, packages: 1, paymentMethod: 'cash' });
    expect((await customer(yaw)).balance).toBe(500);

    // Next week, spending again pays again.
    clock.set(new Date('2026-12-01T12:00:00Z'));
    await ok(admin, 'POST', `/api/customers/${yaw}/time`, { mode: 'buy', planId: pack, packages: 1, paymentMethod: 'cash' });
    expect((await customer(yaw)).balance).toBe(1000);
    const list = await ok(admin, 'GET', '/api/promo-packages');
    expect(list.find((x: any) => x.id === p.id).awarded).toBe(2);
    await ok(admin, 'DELETE', `/api/promo-packages/${p.id}`);
  });

  it('gives free minutes after playing enough, with a custom message', async () => {
    clock.set(new Date('2026-12-02T10:00:00Z'));
    await ok(admin, 'POST', '/api/promo-packages', {
      name: 'Play 1 hour today',
      goal: 'time',
      target: 60,
      period: 'day',
      bonusMinutes: 15,
      message: '{name}, {package} done. 15 free minutes added!',
    });
    const ama = (await ok(admin, 'POST', '/api/customers', { fullName: 'Ama Owusu', phone: '0241114444' })).id;
    amaId = ama;
    const s = await ok(admin, 'POST', '/api/sessions', { stationId: station, planId: hourly, billingType: 'postpaid', customerId: ama });
    clock.set(new Date('2026-12-02T10:30:00Z'));
    await ok(admin, 'POST', `/api/sessions/${s.id}/end`, { paymentMethod: 'cash' });
    expect((await customer(ama)).savedSeconds).toBe(0); // only 30 minutes so far

    const s2 = await ok(admin, 'POST', '/api/sessions', { stationId: station, planId: hourly, billingType: 'postpaid', customerId: ama });
    clock.set(new Date('2026-12-02T11:01:00Z'));
    await ok(admin, 'POST', `/api/sessions/${s2.id}/end`, { paymentMethod: 'cash' });
    expect((await customer(ama)).savedSeconds).toBe(15 * 60);
    expect(alerts.at(-1)?.speak).toBe('Ama, Play 1 hour today done. 15 free minutes added!');
  });

  it('can leave the name out', async () => {
    const s = await ok(admin, 'GET', '/api/settings');
    await ok(admin, 'PUT', '/api/settings', { ...s, announceNames: false });
    clock.set(new Date('2026-12-03T10:00:00Z'));
    const kojo = (await ok(admin, 'POST', '/api/customers', { fullName: 'Kojo Asante', phone: '0241115555' })).id;
    const ses = await ok(admin, 'POST', '/api/sessions', { stationId: station, planId: hourly, billingType: 'postpaid', customerId: kojo });
    clock.set(new Date('2026-12-03T11:05:00Z'));
    await ok(admin, 'POST', `/api/sessions/${ses.id}/end`, { paymentMethod: 'cash' });
    expect(alerts.at(-1)?.speak).toBe('Player, Play 1 hour today done. 15 free minutes added!');
  });

  it('shows progress in the customer app data', async () => {
    const { customerPackages } = await import('../src/services/promo-packages.js');
    clock.set(new Date('2026-12-02T18:00:00Z'));
    const list = await customerPackages({ db: handle.db, clock, bus }, amaId);
    expect(list.find((x) => x.name === 'Play 1 hour today')).toMatchObject({ goal: 'time', target: 60, progress: 60, earned: true });
  });

  it('names the period', () => {
    const now = new Date(2026, 10, 27, 15, 0); // Friday 27 Nov, local time
    expect(periodOf('day', now).key).toBe('2026-11-27');
    expect(periodOf('month', now).key).toBe('2026-11');
    expect(periodOf('week', now).key).toBe('week-2026-11-23');
    expect(periodOf('once', now).key).toBe('once');
  });
});
