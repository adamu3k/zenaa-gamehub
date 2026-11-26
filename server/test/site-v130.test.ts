/**
 * v1.3 — public home page: /api/public/site (no sign-in, no secrets) and Settings → Public home page.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { ensureAdmin } from '../src/bootstrap.js';
import type { Ctx } from '../src/context.js';
import { openDatabase, type DbHandle } from '../src/db/index.js';
import { ManualClock } from '../src/lib/clock.js';
import { Bus } from '../src/realtime/bus.js';

let handle: DbHandle;
let app: FastifyInstance;
let admin = '';

async function call(token: string, method: string, url: string, payload?: unknown) {
  const res = await app.inject({ method: method as any, url, payload: payload as any, headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: res.statusCode, body: res.json() };
}
const ok = async (token: string, method: string, url: string, payload?: unknown) => {
  const r = await call(token, method, url, payload);
  if (r.status !== 200) throw new Error(`${method} ${url} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

beforeAll(async () => {
  handle = await openDatabase({ pgliteDir: null });
  const ctx: Ctx = { db: handle.db, clock: new ManualClock(Date.parse('2026-11-26T12:00:00Z')), bus: new Bus() };
  app = await buildApp(ctx, { jwtSecret: 'test-secret-test-secret-test-secret-123' });
  await ensureAdmin(handle.db, 'admin', 'admin-pass-123');
  admin = (await ok('', 'POST', '/api/auth/login', { username: 'admin', password: 'admin-pass-123' })).token;
});

afterAll(async () => {
  await app?.close();
  await handle?.close();
});

describe('public home page', () => {
  it('works without signing in and has default games', async () => {
    const r = await ok('', 'GET', '/api/public/site');
    expect(r.centerName).toBe('ZENAA GAMEHUB');
    expect(r.website.enabled).toBe(true);
    expect(r.website.games.length).toBeGreaterThan(3);
    expect(r.website.games.some((g: any) => /wheel/i.test(g.name))).toBe(true);
    // Only public things: no payment keys, PINs or staff settings.
    const text = JSON.stringify(r);
    for (const secret of ['agentExitPin', 'momoAccounts', 'smsTemplate', 'updateRepo', 'requirePinFor']) expect(text).not.toContain(secret);
  });

  it('saves the website settings and keeps them when other settings change', async () => {
    const s = await ok(admin, 'GET', '/api/settings');
    await ok(admin, 'PUT', '/api/settings', {
      ...s,
      website: { ...s.website, address: 'Madina, Accra', phone: '024 000 0000', games: [{ name: 'Racing Wheel', tag: 'Racing', image: '' }] },
    });
    let r = await ok('', 'GET', '/api/public/site');
    expect(r.website.address).toBe('Madina, Accra');
    expect(r.website.games).toEqual([{ name: 'Racing Wheel', tag: 'Racing', image: '' }]);

    const s2 = await ok(admin, 'GET', '/api/settings');
    await ok(admin, 'PUT', '/api/settings', { ...s2, centerName: 'ZENAA ARENA' });
    r = await ok('', 'GET', '/api/public/site');
    expect(r.centerName).toBe('ZENAA ARENA');
    expect(r.website.phone).toBe('024 000 0000');

    const bad = await call(admin, 'PUT', '/api/settings', { ...s2, website: { ...s2.website, games: [{ name: '', tag: '' }] } });
    expect(bad.status).toBe(400);
  });
});
