/**
 * v0.9.6 — paying bookings ahead and starting them from the app, saved time per station type (and changing it),
 * the customer's account (pay later / tab), adding time from a chosen account, chat people, phone notifications.
 */
import type { FastifyInstance } from 'fastify';
import { createECDH, randomBytes } from 'node:crypto';
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
let ps = '';
let pcCat = '';
let psCat = '';
let pcPlan = '';
let psPlan = '';
const pushes: { url: string; headers: Record<string, string> }[] = [];
let pushStatus = 201;

const fakeFetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input);
  const headers: Record<string, string> = {};
  new Headers(init?.headers ?? {}).forEach((v, k) => (headers[k] = v));
  if (url.startsWith('https://push.example')) {
    pushes.push({ url, headers });
    return new Response('', { status: pushStatus });
  }
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

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
const waitFor = async (fn: () => boolean) => {
  for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 20));
  return fn();
};

beforeAll(async () => {
  handle = await openDatabase({ pgliteDir: null });
  app = await buildApp({ db: handle.db, clock, bus: new Bus(), fetch: fakeFetch } as any, { jwtSecret: 'test-secret-test-secret-test-secret-123' });
  await ensureAdmin(handle.db, 'admin', 'admin-pass-123');
  admin = (await ok('', 'POST', '/api/auth/login', { username: 'admin', password: 'admin-pass-123' })).token;
  await ok(admin, 'POST', '/api/staff', { username: 'cash6', fullName: 'Kofi Cashier', role: 'cashier', password: 'cashier-pass' });
  cashier = (await ok('', 'POST', '/api/auth/login', { username: 'cash6', password: 'cashier-pass' })).token;
  pcCat = (await ok(admin, 'POST', '/api/station-categories', { name: 'PC' })).id;
  psCat = (await ok(admin, 'POST', '/api/station-categories', { name: 'PS5' })).id;
  pc = (await ok(admin, 'POST', '/api/stations', { code: 'PC-01', name: 'PC 1', platform: 'pc', categoryId: pcCat })).id;
  ps = (await ok(admin, 'POST', '/api/stations', { code: 'PS-01', name: 'PS5 1', platform: 'ps5', categoryId: psCat })).id;
  pcPlan = (await ok(admin, 'POST', '/api/pricing-plans', { name: 'PC hourly', kind: 'time_rate', ratePerHour: 1_000, categoryId: pcCat })).id;
  psPlan = (await ok(admin, 'POST', '/api/pricing-plans', { name: 'PS5 hourly', kind: 'time_rate', ratePerHour: 2_000, categoryId: psCat })).id;
  const s = await ok(admin, 'GET', '/api/settings');
  await ok(admin, 'PUT', '/api/settings', { ...s, openingTime: '00:00', closingTime: '00:00', powerOffDelaySeconds: 0 });
});

afterAll(async () => {
  await app?.close();
  await handle?.close();
});

describe('bookings paid ahead and started from the app', () => {
  it('pays a booking from the wallet, starts it from the app, pauses, continues and stops (time left is saved)', async () => {
    const ama = await signup('Ama Mensah', '0241110001');
    await ok(admin, 'POST', `/api/customers/${ama.id}/wallet`, { operation: 'deposit', amount: 5_000, method: 'cash' });
    const quote = await ok(ama.token, 'GET', `/api/portal/booking-quote?stationId=${ps}&minutes=60`);
    expect(quote).toMatchObject({ planName: 'PS5 hourly', price: 2_000, balance: 5_000 });

    const startAt = new Date(clock.now().getTime() + 60 * 60_000).toISOString();
    const b = await ok(ama.token, 'POST', '/api/portal/bookings', { stationId: ps, startAt, minutes: 60, pay: 'wallet' });
    expect(b).toMatchObject({ payment: 'wallet', paidAmount: 2_000, paidSeconds: 3600 });
    let me = await ok(ama.token, 'GET', '/api/portal/me');
    expect(me.balance).toBe(3_000);
    expect(me.savedTime).toEqual([{ categoryId: psCat, name: 'PS5', seconds: 3600 }]);

    // too early
    expect((await call(ama.token, 'POST', '/api/portal/play/start', { bookingId: b.id })).status).toBe(409);
    clock.advance(50 * 60);
    const s = await ok(ama.token, 'POST', '/api/portal/play/start', { bookingId: b.id });
    expect(s).toMatchObject({ status: 'running', allottedSeconds: 3600, paidAmount: 0 });
    me = await ok(ama.token, 'GET', '/api/portal/me');
    expect(me.activeSession).toMatchObject({ stationName: 'PS5 1', status: 'running', canStop: true });
    expect(me.savedSeconds).toBe(0);

    clock.advance(10 * 60);
    expect((await ok(ama.token, 'POST', `/api/portal/play/${s.id}/pause`)).status).toBe('paused');
    clock.advance(30 * 60); // paused time is free
    expect((await ok(ama.token, 'POST', `/api/portal/play/${s.id}/resume`)).status).toBe('running');
    clock.advance(20 * 60);
    const end = await ok(ama.token, 'POST', `/api/portal/play/${s.id}/stop`);
    expect(end.status).toBe('ended');
    me = await ok(ama.token, 'GET', '/api/portal/me');
    expect(me.savedSeconds).toBe(30 * 60);
    expect(me.savedTime[0]).toMatchObject({ categoryId: psCat, seconds: 1800 });
    expect(me.activeSession).toBeNull();
    // someone else's session can't be touched
    const kofi = await signup('Kofi Boateng', '0241110002');
    expect((await call(kofi.token, 'POST', `/api/portal/play/${s.id}/pause`)).status).toBe(404);
  });

  it('a "pay at the counter" booking cannot be started from the app until it is paid; saved time for the wrong station type is refused', async () => {
    const yaw = await signup('Yaw Ofori', '0241110003');
    await ok(admin, 'POST', `/api/customers/${yaw.id}/time`, { mode: 'buy', planId: pcPlan, minutes: 120, paymentMethod: 'cash' });
    const startAt = new Date(clock.now().getTime() + 40 * 60_000).toISOString();
    const b = await ok(yaw.token, 'POST', '/api/portal/bookings', { stationId: ps, startAt, minutes: 60 });
    expect(b.payment).toBe('counter');
    clock.advance(30 * 60);
    expect((await call(yaw.token, 'POST', '/api/portal/play/start', { bookingId: b.id })).body.message).toMatch(/not paid/);
    // PC time does not play on the PS5
    const r = await call(yaw.token, 'POST', `/api/portal/bookings/${b.id}/pay`, { pay: 'saved' });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/another station type/);
    // …but it can be changed: 2 h of PC (GH₵20) = 1 h of PS5
    const prev = await ok(yaw.token, 'POST', '/api/portal/time/convert', { fromCategoryId: pcCat, toCategoryId: psCat, minutes: 120, preview: true });
    expect(prev).toMatchObject({ toMinutes: 60, from: 'PC', to: 'PS5' });
    await ok(yaw.token, 'POST', '/api/portal/time/convert', { fromCategoryId: pcCat, toCategoryId: psCat, minutes: 120 });
    expect((await ok(yaw.token, 'GET', '/api/portal/me')).savedTime).toEqual([{ categoryId: psCat, name: 'PS5', seconds: 3600 }]);
    await ok(yaw.token, 'POST', `/api/portal/bookings/${b.id}/pay`, { pay: 'saved' });
    const s = await ok(yaw.token, 'POST', '/api/portal/play/start', { bookingId: b.id });
    expect(s.allottedSeconds).toBe(3600);
    await ok(admin, 'POST', `/api/sessions/${s.id}/end`, {});
  });

  it('plays saved time on a free station, but not into someone else\'s booking', async () => {
    const efua = await signup('Efua Asante', '0241110004');
    await ok(admin, 'POST', `/api/customers/${efua.id}/time`, { mode: 'buy', planId: pcPlan, minutes: 180, paymentMethod: 'cash' });
    const other = await signup('Booked Person', '0241110005');
    await ok(other.token, 'POST', '/api/portal/bookings', { stationId: pc, startAt: new Date(clock.now().getTime() + 60 * 60_000).toISOString(), minutes: 60 });
    const r = await call(efua.token, 'POST', '/api/portal/play/start', { stationId: pc });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/booked in 60 min/);
    const s = await ok(efua.token, 'POST', '/api/portal/play/start', { stationId: pc, minutes: 45 });
    expect(s.allottedSeconds).toBe(45 * 60);
    expect((await ok(efua.token, 'GET', '/api/portal/me')).savedSeconds).toBe(135 * 60);
    await ok(admin, 'POST', `/api/sessions/${s.id}/end`, {});
  });
});

describe("the customer's account (pay later)", () => {
  it('starts on the account within the credit limit, uses the default limit, and takes payment oldest first', async () => {
    const c = (await ok(admin, 'POST', '/api/customers', { fullName: 'Tab Player', phone: '0241110010' })).id;
    // no limit anywhere → refused
    let r = await call(admin, 'POST', '/api/sessions', { stationId: ps, planId: psPlan, billingType: 'prepaid', minutes: 60, customerId: c, payLater: true });
    expect(r.status).toBe(409);
    expect(r.body.message).toMatch(/no credit limit/);
    const s0 = await ok(admin, 'GET', '/api/settings');
    await ok(admin, 'PUT', '/api/settings', { ...s0, defaultCreditLimit: 5_000 });
    // cashiers don't have payments.tab by default
    expect((await call(cashier, 'POST', '/api/sessions', { stationId: ps, planId: psPlan, billingType: 'prepaid', minutes: 60, customerId: c, payLater: true })).status).toBe(403);
    const s = await ok(admin, 'POST', '/api/sessions', { stationId: ps, planId: psPlan, billingType: 'prepaid', minutes: 60, customerId: c, payLater: true });
    expect(s).toMatchObject({ netAmount: 2_000, paidAmount: 0, onTab: true });
    expect((await ok(admin, 'GET', `/api/customers/${c}`)).outstanding).toBe(2_000);
    // drinks on the account
    await ok(admin, 'POST', `/api/customers/${c}/charges`, { amount: 1_000, note: 'Drinks' });
    r = await call(admin, 'POST', `/api/customers/${c}/charges`, { amount: 2_500, note: 'Too much' });
    expect(r.body.message).toMatch(/Credit limit reached/);
    await ok(admin, 'POST', `/api/sessions/${s.id}/end`, {});
    const d = await ok(admin, 'GET', `/api/customers/${c}`);
    expect(d.outstanding).toBe(3_000);
    expect(d.tab.map((t: any) => [t.kind, t.owed])).toEqual([
      ['session', 2_000],
      ['charge', 1_000],
    ]);
    // part payment: the session first
    expect(await ok(admin, 'POST', `/api/customers/${c}/account/pay`, { payments: [{ method: 'cash', amount: 2_500 }] })).toEqual({ paid: 2_500, remaining: 500 });
    const d2 = await ok(admin, 'GET', `/api/customers/${c}`);
    expect(d2.tab).toEqual([expect.objectContaining({ kind: 'charge', owed: 500 })]);
    await ok(admin, 'POST', `/api/customers/${c}/account/pay`, { paymentMethod: 'mobile_money', paymentReference: 'MTN MoMo · 12345678' });
    expect((await ok(admin, 'GET', `/api/customers/${c}`)).outstanding).toBe(0);
  });

  it('adds time from another account: wallet, saved time, or their tab', async () => {
    const player = (await ok(admin, 'POST', '/api/customers', { fullName: 'On Station', phone: '0241110020' })).id;
    const friend = (await ok(admin, 'POST', '/api/customers', { fullName: 'Rich Friend', phone: '0241110021' })).id;
    await ok(admin, 'POST', `/api/customers/${friend}/wallet`, { operation: 'deposit', amount: 3_000, method: 'cash' });
    await ok(admin, 'POST', `/api/customers/${friend}/time`, { mode: 'buy', planId: psPlan, minutes: 60, paymentMethod: 'cash' });
    const s = await ok(admin, 'POST', '/api/sessions', { stationId: ps, planId: psPlan, billingType: 'prepaid', minutes: 30, customerId: player, paymentMethod: 'cash' });

    // 30 min paid from the friend's wallet
    let e = await ok(admin, 'POST', `/api/sessions/${s.id}/extend`, { minutes: 30, source: 'pay', accountId: friend, paymentMethod: 'wallet' });
    expect(e.allottedSeconds).toBe(3600);
    expect((await ok(admin, 'GET', `/api/customers/${friend}`)).balance).toBe(2_000);
    // 30 min from the friend's saved time (no money)
    e = await ok(admin, 'POST', `/api/sessions/${s.id}/extend`, { minutes: 30, source: 'saved', accountId: friend });
    expect(e).toMatchObject({ allottedSeconds: 5400, netAmount: 2_000 });
    expect((await ok(admin, 'GET', `/api/customers/${friend}`)).savedSeconds).toBe(1800);
    // 30 min on the friend's account → a charge on the friend, the session counts as paid
    e = await ok(admin, 'POST', `/api/sessions/${s.id}/extend`, { minutes: 30, source: 'tab', accountId: friend });
    expect(e).toMatchObject({ netAmount: 3_000, paidAmount: 3_000, onTab: false });
    const f = await ok(admin, 'GET', `/api/customers/${friend}`);
    expect(f.outstanding).toBe(1_000);
    expect(f.tab[0]).toMatchObject({ kind: 'charge', owed: 1_000 });
    expect(f.tab[0].label).toMatch(/30 min added on PS5 1/);
    // the player's own account
    e = await ok(admin, 'POST', `/api/sessions/${s.id}/extend`, { minutes: 15, source: 'tab' });
    expect(e).toMatchObject({ netAmount: 3_500, paidAmount: 3_000, onTab: true });
    await ok(admin, 'POST', `/api/sessions/${s.id}/end`, {});
    expect((await ok(admin, 'GET', `/api/customers/${player}`)).outstanding).toBe(500);
  });
});

describe('walk-in put on an account at the end', () => {
  it('attaches the chosen customer and puts the bill on their account', async () => {
    const c = (await ok(admin, 'POST', '/api/customers', { fullName: 'Walk In Later', phone: '0241110050' })).id;
    const s = await ok(admin, 'POST', '/api/sessions', { stationId: pc, planId: pcPlan, billingType: 'postpaid' });
    clock.advance(60 * 60);
    expect((await call(admin, 'POST', `/api/sessions/${s.id}/end`, { payLater: true })).status).toBe(400);
    const e = await ok(admin, 'POST', `/api/sessions/${s.id}/end`, { payLater: true, accountId: c });
    expect(e).toMatchObject({ customerId: c, netAmount: 1_000, paidAmount: 0, onTab: true });
    expect((await ok(admin, 'GET', `/api/customers/${c}`)).outstanding).toBe(1_000);
  });
});

describe('chat people and phone notifications', () => {
  it('lists people online first and searches by name', async () => {
    const a = await signup('Chat Alpha', '0241110030');
    const b = await signup('Chat Bravo', '0241110031');
    await ok(b.token, 'PATCH', '/api/portal/me', { gamertag: 'BravoKing' });
    await new Promise((r) => setTimeout(r, 50));
    const people = await ok(a.token, 'GET', '/api/portal/chat/people');
    expect(people.find((p: any) => p.id === b.id)).toMatchObject({ name: 'BravoKing', online: true });
    expect(people.find((p: any) => p.id === a.id)).toBeUndefined();
    const found = await ok(a.token, 'GET', '/api/portal/chat/people?q=bravo');
    expect(found.map((p: any) => p.id)).toEqual([b.id]);
    expect(JSON.stringify(found)).not.toContain('0241110031');
  });

  it('sends a push to the other player for a private message, and forgets phones that unsubscribed', async () => {
    const a = await signup('Push Sender', '0241110040');
    const b = await signup('Push Receiver', '0241110041');
    const key = await ok(b.token, 'GET', '/api/portal/push/key');
    expect(key.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    const ecdh = createECDH('prime256v1');
    ecdh.generateKeys();
    const sub = { endpoint: 'https://push.example/send/abc', keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
    expect((await call(b.token, 'POST', '/api/portal/push/subscribe', { ...sub, endpoint: 'http://insecure.example/x' })).status).toBe(400);
    await ok(b.token, 'POST', '/api/portal/push/subscribe', sub);
    expect(await ok(b.token, 'POST', '/api/portal/push/test')).toEqual({ sent: 1 });
    expect(pushes.at(-1)!.headers.authorization).toMatch(/^vapid t=/);

    pushes.length = 0;
    await ok(a.token, 'POST', '/api/portal/chat/messages', { to: b.id, body: 'Game tonight?' });
    expect(await waitFor(() => pushes.length === 1)).toBe(true);
    expect(pushes[0].url).toBe(sub.endpoint);
    expect(pushes[0].headers['content-encoding']).toBe('aes128gcm');

    // the phone removed the app → 410 → subscription deleted
    pushStatus = 410;
    await new Promise((r) => setTimeout(r, 1600)); // chat allows one message every 1.5 s
    await ok(a.token, 'POST', '/api/portal/chat/messages', { to: b.id, body: 'Hello?' });
    await waitFor(() => pushes.length === 2);
    pushStatus = 201;
    expect((await call(b.token, 'POST', '/api/portal/push/test')).status).toBe(409);
  });
});
