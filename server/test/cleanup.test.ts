/**
 * v0.9.5 — deleting things and clearing whole areas without breaking past payments or results.
 */
import type { FastifyInstance } from 'fastify';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
let station = '';
let hourly = '';
let fc = '';

async function call(token: string, method: string, url: string, payload?: unknown) {
  const res = await app.inject({ method: method as any, url, payload: payload as any, headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: res.statusCode, body: res.json() as any };
}
const ok = async (token: string, method: string, url: string, payload?: unknown) => {
  const r = await call(token, method, url, payload);
  if (r.status !== 200) throw new Error(`${method} ${url} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const newCustomer = async (name: string, phone: string) => (await ok(admin, 'POST', '/api/customers', { fullName: name, phone })).id as string;

beforeAll(async () => {
  // Safety copies made by restores go to a throw-away folder, not the real backups folder.
  process.env.BACKUP_DIR = mkdtempSync(path.join(tmpdir(), 'zenaa-test-backups-'));
  handle = await openDatabase({ pgliteDir: null });
  app = await buildApp({ db: handle.db, clock, bus: new Bus() }, { jwtSecret: 'test-secret-test-secret-test-secret-123' });
  await ensureAdmin(handle.db, 'admin', 'admin-pass-123');
  admin = (await ok('', 'POST', '/api/auth/login', { username: 'admin', password: 'admin-pass-123' })).token;
  await ok(admin, 'POST', '/api/staff', { username: 'cash3', fullName: 'Kofi Cashier', role: 'cashier', password: 'cashier-pass' });
  cashier = (await ok('', 'POST', '/api/auth/login', { username: 'cash3', password: 'cashier-pass' })).token;
  station = (await ok(admin, 'POST', '/api/stations', { code: 'PS-01', name: 'PS5 #1', platform: 'ps5' })).id;
  hourly = (await ok(admin, 'POST', '/api/pricing-plans', { name: 'Hourly', kind: 'time_rate', ratePerHour: 2000 })).id;
  fc = (await ok(admin, 'GET', '/api/games')).find((g: any) => g.name === 'EA SPORTS FC').id;
});

afterAll(async () => {
  await app?.close();
  await handle?.close();
});

describe('deleting single things', () => {
  it('removes a new customer completely and hides one with history', async () => {
    const fresh = await newCustomer('Fresh Player', '0240000001');
    expect((await ok(admin, 'DELETE', `/api/customers/${fresh}`)).removed).toBe('deleted');
    expect((await call(admin, 'GET', `/api/customers/${fresh}`)).status).toBe(404);

    const played = await newCustomer('Played Before', '0240000002');
    const s = await ok(admin, 'POST', '/api/sessions', { stationId: station, planId: hourly, billingType: 'prepaid', customerId: played, minutes: 30, paymentMethod: 'cash' });
    await ok(admin, 'POST', `/api/sessions/${s.id}/end`, {});
    expect((await ok(admin, 'DELETE', `/api/customers/${played}`)).removed).toBe('hidden');
    const d = await ok(admin, 'GET', `/api/customers/${played}`);
    expect(d).toMatchObject({ fullName: 'Deleted customer', phone: null, portalEnabled: false });
    const list = await ok(admin, 'GET', '/api/customers');
    expect(list.find((c: any) => c.id === played)).toBeUndefined();
    // the phone number is free again
    await newCustomer('New Owner', '0240000002');
  });

  it('refuses while a customer still has wallet money, and cashiers cannot delete prices', async () => {
    const rich = await newCustomer('Has Money', '0240000003');
    await ok(admin, 'POST', `/api/customers/${rich}/wallet`, { operation: 'deposit', amount: 5_000, method: 'cash' });
    const r = await call(admin, 'DELETE', `/api/customers/${rich}`);
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/wallet/);
    expect((await call(cashier, 'DELETE', `/api/pricing-plans/${hourly}`)).status).toBe(403);
  });

  it('deletes prices and promotions (hiding ones that past sessions used)', async () => {
    const unused = (await ok(admin, 'POST', '/api/pricing-plans', { name: 'Unused', kind: 'time_rate', ratePerHour: 1000 })).id;
    expect((await ok(admin, 'DELETE', `/api/pricing-plans/${unused}`)).removed).toBe('deleted');
    expect((await ok(admin, 'DELETE', `/api/pricing-plans/${hourly}`)).removed).toBe('hidden');
    expect((await ok(admin, 'GET', '/api/pricing-plans')).map((p: any) => p.id)).not.toContain(hourly);
    hourly = (await ok(admin, 'POST', '/api/pricing-plans', { name: 'Hourly 2', kind: 'time_rate', ratePerHour: 2000 })).id;

    const code = (await ok(admin, 'POST', '/api/promo-codes', { code: 'GONE10', percentOff: 10 })).id;
    expect((await ok(admin, 'DELETE', `/api/promo-codes/${code}`)).removed).toBe('deleted');
    const h = (await ok(admin, 'POST', '/api/happy-hours', { name: 'Morning', days: [1, 2], startMinute: 600, endMinute: 720, discountPercent: 20 })).id;
    await ok(admin, 'DELETE', `/api/happy-hours/${h}`);
    expect((await ok(admin, 'GET', '/api/happy-hours')).map((x: any) => x.id)).not.toContain(h);
  });

  it('deletes a tournament even after results', async () => {
    const a = await newCustomer('Ama', '0240000010');
    const b = await newCustomer('Kofi', '0240000011');
    const t = await ok(admin, 'POST', '/api/tournaments', { name: 'Cup', gameId: fc, format: 'knockout', maxPlayers: 4 });
    await ok(admin, 'POST', `/api/tournaments/${t.id}/entries`, { customerId: a });
    await ok(admin, 'POST', `/api/tournaments/${t.id}/entries`, { customerId: b });
    await ok(admin, 'POST', `/api/tournaments/${t.id}/start`, {});
    const detail = await ok(admin, 'GET', `/api/tournaments/${t.id}`);
    const m = detail.bracket.rounds[0].matches.find((x: any) => !x.walkover);
    await ok(admin, 'PUT', `/api/matches/${m.id}/result`, { homeScore: 2, awayScore: 1 });
    expect((await call(admin, 'DELETE', `/api/tournaments/${t.id}`)).status).toBe(409);
    await ok(admin, 'DELETE', `/api/tournaments/${t.id}/everything`);
    expect((await call(admin, 'GET', `/api/tournaments/${t.id}`)).status).toBe(404);
  });
});

describe('clearing whole areas', () => {
  it('needs the password and only admins', async () => {
    expect((await call(cashier, 'GET', '/api/cleanup')).status).toBe(403);
    expect((await call(admin, 'POST', '/api/cleanup', { areas: ['leaderboard'], password: 'wrong' })).status).toBe(403);
  });

  it('clears the leaderboard and customers, keeping customers with money', async () => {
    const a = await newCustomer('Yaw', '0240000020');
    const b = await newCustomer('Esi', '0240000021');
    await ok(admin, 'POST', '/api/matches', { gameId: fc, homeId: a, awayId: b, homeScore: 3, awayScore: 1 });
    const before = await ok(admin, 'GET', '/api/cleanup');
    expect(before.counts.leaderboard).toBeGreaterThan(0);
    const r = await ok(admin, 'POST', '/api/cleanup', { areas: ['leaderboard', 'customers'], password: 'admin-pass-123' });
    expect(r.results.leaderboard.removed).toBeGreaterThan(0);
    expect(r.results.customers.skipped).toBe(1); // "Has Money"
    const after = await ok(admin, 'GET', '/api/cleanup');
    expect(after.counts.leaderboard).toBe(0);
    expect(after.counts.customers).toBe(1);
    const audit = await ok(admin, 'GET', '/api/audit');
    expect(audit.some((x: any) => x.action === 'data.clear')).toBe(true);
  });

  it('clears the audit trail but records that it was cleared', async () => {
    await ok(admin, 'POST', '/api/cleanup', { areas: ['audit'], password: 'admin-pass-123' });
    const audit = await ok(admin, 'GET', '/api/audit');
    expect(audit.map((x: any) => x.action)).toEqual(['data.clear']);
    await ok(admin, 'DELETE', `/api/audit/${audit[0].id}`);
  });
});

describe('part backups', () => {
  it('backs up only the chosen part and merges it back without touching the rest', async () => {
    const extra = (await ok(admin, 'POST', '/api/pricing-plans', { name: 'Night rate', kind: 'time_rate', ratePerHour: 1500 })).id;
    const res = await app.inject({ method: 'GET', url: '/api/system/backup?sections=stations', headers: { authorization: `Bearer ${admin}` } });
    expect(res.statusCode).toBe(200);
    const file = res.rawPayload;
    const info = await app.inject({ method: 'POST', url: '/api/system/backup/inspect', payload: file, headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/octet-stream' } });
    expect(info.json().sections).toEqual(['stations']);
    expect(info.json().rows.customers).toBeUndefined();
    expect(info.json().rows.pricing_plans).toBeGreaterThan(0);

    await ok(admin, 'DELETE', `/api/pricing-plans/${extra}`);
    const customersBefore = (await ok(admin, 'GET', '/api/customers')).length;
    const back = await app.inject({
      method: 'POST',
      url: '/api/system/restore?confirm=RESTORE',
      payload: file,
      headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/octet-stream' },
    });
    expect(back.statusCode).toBe(200);
    expect((await ok(admin, 'GET', '/api/pricing-plans')).map((p: any) => p.id)).toContain(extra);
    expect((await ok(admin, 'GET', '/api/customers')).length).toBe(customersBefore);
  });
});

