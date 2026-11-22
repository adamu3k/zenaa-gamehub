/**
 * v0.8 — rooms, pause choices, profile pictures, counter-PC alarm hints, remote view (VNC bridge).
 */
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { buildApp } from '../src/app.js';
import { ensureAdmin } from '../src/bootstrap.js';
import type { Ctx } from '../src/context.js';
import { openDatabase, type DbHandle } from '../src/db/index.js';
import { ManualClock } from '../src/lib/clock.js';
import { Bus, type BusEvent } from '../src/realtime/bus.js';
import { SessionScheduler } from '../src/services/scheduler.js';
import { addTicketForTest, attachVncBridge } from '../src/services/vnc.js';

let handle: DbHandle;
let app: FastifyInstance;
const clock = new ManualClock(Date.parse('2026-05-04T12:00:00Z'));
const bus = new Bus();
const events: BusEvent[] = [];
let admin = '';
let ctx: Ctx;
let plan = '';
let st = '';
let agent = '';

async function call(token: string, method: string, url: string, payload?: unknown) {
  const res = await app.inject({ method: method as any, url, payload: payload as any, headers: token ? { authorization: `Bearer ${token}` } : {} });
  let body: any = null;
  try {
    body = res.json();
  } catch {
    body = res.body;
  }
  return { status: res.statusCode, body, headers: res.headers, raw: res.rawPayload };
}
const ok = async (token: string, method: string, url: string, payload?: unknown) => {
  const r = await call(token, method, url, payload);
  if (r.status !== 200) throw new Error(`${method} ${url} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

beforeAll(async () => {
  handle = await openDatabase({ pgliteDir: null });
  ctx = { db: handle.db, clock, bus };
  bus.on((e) => events.push(e));
  app = await buildApp(ctx, { jwtSecret: 'test-secret-test-secret-test-secret-123' });
  attachVncBridge(app);
  await app.listen({ port: 0, host: '127.0.0.1' });
  await ensureAdmin(handle.db, 'admin', 'admin-pass-123');
  admin = (await ok('', 'POST', '/api/auth/login', { username: 'admin', password: 'admin-pass-123' })).token;
  plan = (await ok(admin, 'POST', '/api/pricing-plans', { name: 'Per minute', kind: 'time_rate', ratePerHour: 600 })).id;
});

afterAll(async () => {
  await app?.close();
  await handle?.close();
});

describe('rooms', () => {
  it('saves a room per station and lists it', async () => {
    st = (await ok(admin, 'POST', '/api/stations', { code: 'PS-01', name: 'PS5 One', platform: 'ps5', room: 'Downstairs' })).id;
    await ok(admin, 'POST', '/api/stations', { code: 'PS-02', name: 'PS5 Two', platform: 'ps5', room: '  ' });
    const list = (await ok(admin, 'GET', '/api/stations')).stations;
    expect(list.find((s: any) => s.code === 'PS-01').room).toBe('Downstairs');
    expect(list.find((s: any) => s.code === 'PS-02').room).toBeNull();
    await ok(admin, 'PATCH', `/api/stations/${st}`, { room: 'Upstairs' });
    expect((await ok(admin, 'GET', '/api/stations')).stations.find((s: any) => s.id === st).room).toBe('Upstairs');
  });
});

describe('pause choices', () => {
  it('locks the screen, keeps it on, or only stops the clock', async () => {
    const code = (await ok(admin, 'POST', `/api/stations/${st}/agent-code`)).code;
    agent = (await ok('', 'POST', '/api/agent/pair', { code, kind: 'pc' })).token;
    const s = await ok(admin, 'POST', '/api/sessions', { stationId: st, planId: plan, billingType: 'prepaid', minutes: 30, paymentMethod: 'cash' });

    const state = async () => ok(agent, 'GET', '/api/agent/state');
    await ok(admin, 'POST', `/api/sessions/${s.id}/pause`, { mode: 'open' });
    let a = await state();
    expect(a).toMatchObject({ phase: 'paused', pauseMode: 'open', lock: false });
    expect(await app.power.desired(st)).toMatchObject({ reason: 'no plug' });

    await ok(admin, 'POST', `/api/sessions/${s.id}/resume`);
    await ok(admin, 'POST', `/api/sessions/${s.id}/pause`, { mode: 'screen' });
    a = await state();
    expect(a).toMatchObject({ phase: 'paused', pauseMode: 'screen', lock: true });

    await ok(admin, 'POST', `/api/sessions/${s.id}/resume`);
    await ok(admin, 'POST', `/api/sessions/${s.id}/pause`); // default from Settings: power off on pause
    expect((await state()).pauseMode).toBe('off');
    expect((await call(admin, 'POST', `/api/sessions/${s.id}/resume`)).status).toBe(200);
    expect((await call(admin, 'POST', `/api/sessions/${s.id}/pause`, { mode: 'sideways' })).status).toBe(400);
  });

  it('asks the counter PC to beep and speak at 5 minutes and at time up', async () => {
    const scheduler = new SessionScheduler(ctx, { error: (e) => console.error(e), info: () => {} });
    clock.advance(26 * 60);
    await scheduler.tick();
    expect(events.find((e) => e.type === 'alert' && e.sound === 'warning')).toMatchObject({ speak: 'PS5 One, 5 minutes remaining' });
    clock.advance(5 * 60);
    await scheduler.tick();
    expect(events.find((e) => e.type === 'alert' && e.sound === 'timeup')).toMatchObject({ message: 'PS5 One: time is up', speak: 'PS5 One, time up' });
  });
});

describe('profile pictures', () => {
  // 1×1 PNG
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  it('uploads, shows and removes a picture', async () => {
    const c = await ok('', 'POST', '/api/portal/signup', { fullName: 'Ama Mensah', phone: '0241112222', password: 'ama-secret-1' });
    expect((await call(c.token, 'PUT', '/api/portal/me/avatar', { image: 'data:text/html;base64,PGI+' })).status).toBe(400);
    const r = await ok(c.token, 'PUT', '/api/portal/me/avatar', { image: PNG });
    expect(r.avatarUrl).toMatch(/^\/api\/avatars\/[0-9a-f-]+\?v=\d+$/);
    const me = await ok(c.token, 'GET', '/api/portal/me');
    expect(me.avatarUrl).toBe(r.avatarUrl);
    const img = await call('', 'GET', r.avatarUrl);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    // Staff lists carry the link, never the picture itself.
    const staffView = await ok(admin, 'GET', `/api/customers/${me.id}`);
    expect(staffView.avatar).toBeUndefined();
    expect(staffView.avatarUrl).toBe(r.avatarUrl);
    await ok(c.token, 'DELETE', '/api/portal/me/avatar');
    expect((await call('', 'GET', r.avatarUrl)).status).toBe(404);
  });
});

describe('remote view (VNC)', () => {
  it('only gives tickets for a station with an address, and never to this server', async () => {
    const st2 = (await ok(admin, 'GET', '/api/stations')).stations.find((s: any) => s.code === 'PS-02').id;
    expect((await call(admin, 'POST', `/api/stations/${st2}/vnc`)).status).toBe(400);
    await ok(admin, 'PATCH', `/api/stations/${st2}`, { vncConfig: { host: '127.0.0.1', port: 5900, password: 'secret12' } });
    expect((await call(admin, 'POST', `/api/stations/${st2}/vnc`)).status).toBe(400);
    await ok(admin, 'PATCH', `/api/stations/${st2}`, { vncConfig: { host: '192.168.1.21', port: 5900, password: '' } });
    const pub = (await ok(admin, 'GET', '/api/stations')).stations.find((s: any) => s.id === st2);
    expect(pub.vncConfig).toEqual({ host: '192.168.1.21', port: 5900, hasPassword: true }); // blank kept the password
    const t = await ok(admin, 'POST', `/api/stations/${st2}/vnc`);
    expect(t).toMatchObject({ host: '192.168.1.21', port: 5900, password: 'secret12' });
    expect(t.path).toMatch(/^\/api\/vnc\//);
  });

  it('bridges the browser to the station VNC server, and refuses unknown tickets', async () => {
    const echo = net.createServer((sock) => sock.on('data', (d) => sock.write(Buffer.concat([Buffer.from('RFB:'), d]))));
    await new Promise<void>((r) => echo.listen(0, '127.0.0.1', r));
    const port = (app.server.address() as AddressInfo).port;
    const ticket = addTicketForTest('127.0.0.1', (echo.address() as AddressInfo).port);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/vnc/${ticket}`);
    const reply = await new Promise<string>((resolve, reject) => {
      ws.on('open', () => ws.send(Buffer.from('hello')));
      ws.on('message', (d) => resolve(d.toString()));
      ws.on('error', reject);
    });
    expect(reply).toBe('RFB:hello');
    ws.close();
    const again = new WebSocket(`ws://127.0.0.1:${port}/api/vnc/${ticket}`); // single use
    const err = await new Promise<string>((resolve) => {
      again.on('unexpected-response', (_req, res) => resolve(String(res.statusCode)));
      again.on('error', (e) => resolve(e.message));
    });
    expect(err).toMatch(/403/);
    echo.close();
  });
});
