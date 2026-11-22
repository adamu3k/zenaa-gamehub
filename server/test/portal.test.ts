/**
 * v0.3 — custom user types, customer portal, bookings, Paystack and smart-plug power control.
 * Paystack and the plugs are faked at the HTTP level (injected fetch), so no network is used.
 */
import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { ensureAdmin } from '../src/bootstrap.js';
import type { Ctx } from '../src/context.js';
import { openDatabase, type DbHandle } from '../src/db/index.js';
import { ManualClock } from '../src/lib/clock.js';
import { Bus } from '../src/realtime/bus.js';
import { sweepNoShows, withinOpeningHours } from '../src/services/bookings.js';
import { sweepPendingPayments } from '../src/services/paystack.js';
import { ewelinkDecrypt, ewelinkEncrypt } from '../src/services/power.js';

let handle: DbHandle;
let app: FastifyInstance;
const clock = new ManualClock(Date.parse('2026-01-05T10:00:00Z'));
const bus = new Bus();
const alerts: string[] = [];
bus.on((e) => e.type === 'alert' && alerts.push(e.message));
let admin = '';

// ── Fake network: Paystack API + smart plugs ──
type Call = { url: string; method: string; body: any };
const calls: Call[] = [];
const plugs = new Map<string, boolean>(); // host → on?
let paystackTx: Record<string, { status: string; amount: number; currency: string }> = {};
let plugDown = false;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ url, method, body });
  if (url.startsWith('https://api.paystack.co')) {
    const auth = (init?.headers as Record<string, string>)?.authorization;
    if (auth !== 'Bearer sk_test_abc123') return json(401, { status: false, message: 'Invalid key' });
    if (url.endsWith('/transaction/initialize')) {
      paystackTx[body.reference] = { status: 'abandoned', amount: body.amount, currency: body.currency };
      return json(200, { status: true, data: { authorization_url: `https://checkout.paystack.com/${body.reference}`, reference: body.reference } });
    }
    const m = url.match(/\/transaction\/verify\/(.+)$/);
    if (m) {
      const t = paystackTx[decodeURIComponent(m[1])];
      if (!t) return json(400, { status: false, message: 'Transaction reference not found' });
      return json(200, { status: true, data: { ...t, channel: 'mobile_money', paid_at: '2026-01-05T10:01:00Z', gateway_response: 'Approved' } });
    }
    if (url.includes('/transaction?')) return json(200, { status: true, data: [] });
  }
  const host = new URL(url).host;
  if (plugDown) throw new TypeError('fetch failed');
  // Fake SONOFF R4 (stock firmware, LAN Control): encrypted, key 'r4-device-key', only accepts "switches".
  if (body?.encrypt) {
    let data: any;
    try {
      data = ewelinkDecrypt('r4-device-key', body.data, body.iv);
    } catch {
      return json(500, {});
    }
    if (body.deviceid !== '1000r4r4r4') return json(200, { seq: 1, error: 404 });
    if (url.endsWith('/zeroconf/switch')) return json(500, {});
    if (url.endsWith('/zeroconf/switches')) {
      plugs.set(host, data.switches[0].switch === 'on');
      return json(200, { seq: 1, error: 0 });
    }
    if (url.endsWith('/zeroconf/info')) {
      const enc = ewelinkEncrypt('r4-device-key', { switches: [{ switch: plugs.get(host) ? 'on' : 'off', outlet: 0 }] });
      return json(200, { seq: 1, error: 0, encrypt: true, ...enc });
    }
  }
  if (url.includes('/zeroconf/switch')) {
    plugs.set(host, body.data.switch === 'on');
    return json(200, { seq: 1, error: 0 });
  }
  if (url.includes('/zeroconf/info')) return json(200, { seq: 1, error: 0, data: { switch: plugs.get(host) ? 'on' : 'off' } });
  if (url.includes('/cm?')) {
    const cmnd = new URL(url).searchParams.get('cmnd')!;
    if (cmnd.endsWith(' On')) plugs.set(host, true);
    if (cmnd.endsWith(' Off')) plugs.set(host, false);
    return json(200, { POWER: plugs.get(host) ? 'ON' : 'OFF' });
  }
  return json(404, {});
};

async function call(token: string, method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) {
  const res = await app.inject({ method: method as any, url, payload: payload as any, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
  let body: any = null;
  try {
    body = res.json();
  } catch {
    body = res.body;
  }
  return { status: res.statusCode, body };
}
const ok = async (token: string, method: string, url: string, payload?: unknown) => {
  const r = await call(token, method, url, payload);
  if (r.status !== 200) throw new Error(`${method} ${url} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

let st1 = '';
let st2 = '';
let plan = '';

beforeAll(async () => {
  handle = await openDatabase({ pgliteDir: null });
  const ctx: Ctx = { db: handle.db, clock, bus, fetch: fakeFetch };
  app = await buildApp(ctx, { jwtSecret: 'test-secret-test-secret-test-secret-123' });
  await ensureAdmin(handle.db, 'admin', 'admin-pass-123');
  admin = (await ok('', 'POST', '/api/auth/login', { username: 'admin', password: 'admin-pass-123' })).token;
  st1 = (await ok(admin, 'POST', '/api/stations', { code: 'P1', name: 'PS5 One', platform: 'ps5' })).id;
  st2 = (await ok(admin, 'POST', '/api/stations', { code: 'P2', name: 'PS5 Two', platform: 'ps5' })).id;
  plan = (await ok(admin, 'POST', '/api/pricing-plans', { name: 'Standard', kind: 'time_rate', ratePerHour: 1_200 })).id;
  const s = await ok(admin, 'GET', '/api/settings');
  // Open 24 h for the booking flow tests (opening-hours maths is tested on its own below); switch plugs off immediately.
  await ok(admin, 'PUT', '/api/settings', { ...s, openingTime: '00:00', closingTime: '00:00', powerOffDelaySeconds: 0 });
});

afterAll(async () => {
  await app?.close();
  await handle?.close();
});

describe('custom user types', () => {
  it('creates a user type whose permissions replace the built-in defaults', async () => {
    const role = await ok(admin, 'POST', '/api/staff-roles', { name: 'Attendant', description: 'Floor staff', permissions: ['stations.view', 'bookings.manage'] });
    expect((await call(admin, 'POST', '/api/staff-roles', { name: 'manager', permissions: [] })).status).toBe(400);
    const s = await ok(admin, 'POST', '/api/staff', { username: 'kwame', fullName: 'Kwame', role: 'manager', roleId: role.id, password: 'kwame-pass-1' });
    expect(s.role).toBe('cashier');
    expect(s.roleName).toBe('Attendant');
    expect(s.effectivePermissions).toEqual(['stations.view', 'bookings.manage']);
    const login = await ok('', 'POST', '/api/auth/login', { username: 'kwame', password: 'kwame-pass-1' });
    expect(login.staff.roleName).toBe('Attendant');
    expect((await call(login.token, 'POST', '/api/sessions', {})).status).toBe(403);
    expect((await call(admin, 'DELETE', `/api/staff-roles/${role.id}`)).status).toBe(409);
    const roles = await ok(admin, 'GET', '/api/staff-roles');
    expect(roles[0].members).toBe(1);
  });
});

describe('customer portal accounts', () => {
  let token = '';
  let counterCustomer = '';

  it('lets a customer sign up and sign in with a local phone number', async () => {
    const r = await ok('', 'POST', '/api/portal/signup', { fullName: 'Ama Mensah', phone: '024 111 2222', email: 'ama@example.com', password: 'ama-secret-1' });
    expect(r.token).toBeTruthy();
    token = (await ok('', 'POST', '/api/portal/login', { login: '0241112222', password: 'ama-secret-1' })).token;
    const me = await ok(token, 'GET', '/api/portal/me');
    expect(me.phone).toBe('+233241112222');
    expect(me.balance).toBe(0);
    expect(me.code).toMatch(/^ZG-/);
    expect((await call('', 'POST', '/api/portal/login', { login: 'ama@example.com', password: 'wrong-password' })).status).toBe(401);
  });

  it('keeps customer and staff tokens apart and never leaks password hashes', async () => {
    expect((await call(token, 'GET', '/api/customers')).status).toBe(401);
    expect((await call(admin, 'GET', '/api/portal/me')).status).toBe(401);
    const list = await ok(admin, 'GET', '/api/customers');
    const ama = list.find((c: any) => c.fullName === 'Ama Mensah');
    expect(ama.passwordHash).toBeUndefined();
    expect(ama.hasPortalAccount).toBe(true);
    expect(JSON.stringify(await ok(admin, 'GET', `/api/customers/${ama.id}`))).not.toContain('scrypt$');
  });

  it('activates a counter-registered customer with a code from staff', async () => {
    counterCustomer = (await ok(admin, 'POST', '/api/customers', { fullName: 'Kofi Boateng', phone: '0209998888' })).id;
    const s = await call('', 'POST', '/api/portal/signup', { fullName: 'Kofi', phone: '0209998888', password: 'kofi-pass-1' });
    expect(s.status).toBe(409);
    expect(s.body.message).toContain('activation code');
    const { code } = await ok(admin, 'POST', `/api/customers/${counterCustomer}/portal-code`);
    expect(code).toMatch(/^\d{6}$/);
    expect((await call('', 'POST', '/api/portal/activate', { phone: '0209998888', code: code === '000000' ? '111111' : '000000', password: 'kofi-pass-1' })).status).toBe(400);
    const t = (await ok('', 'POST', '/api/portal/activate', { phone: '0209998888', code, password: 'kofi-pass-1' })).token;
    expect((await ok(t, 'GET', '/api/portal/me')).fullName).toBe('Kofi Boateng');
    // Codes are single-use.
    expect((await call('', 'POST', '/api/portal/activate', { phone: '0209998888', code, password: 'kofi-pass-2' })).status).toBe(400);
    // Staff switching portal access off signs the customer out at once.
    await ok(admin, 'PATCH', `/api/customers/${counterCustomer}`, { portalEnabled: false });
    expect((await call(t, 'GET', '/api/portal/me')).status).toBe(401);
  });

  describe('bookings', () => {
    const at = (h: number, m = 0) => new Date(Date.UTC(2026, 0, 5, h, m)).toISOString();

    it('books a free station and refuses clashes, short notice and too many bookings', async () => {
      const avail = await ok(token, 'GET', `/api/portal/availability?start=${encodeURIComponent(at(14))}&minutes=60`);
      expect(avail.stations.every((s: any) => s.available)).toBe(true);
      const b = await ok(token, 'POST', '/api/portal/bookings', { stationId: st1, startAt: at(14), minutes: 60, customerId: 'ignored' });
      expect(b.status).toBe('confirmed');
      expect(b.source).toBe('portal');
      expect((await call(token, 'POST', '/api/portal/bookings', { stationId: st1, startAt: at(14, 30), minutes: 60 })).status).toBe(409);
      expect((await call(token, 'POST', '/api/portal/bookings', { stationId: st1, startAt: at(10, 10), minutes: 60 })).status).toBe(400);
      const again = await ok(token, 'GET', `/api/portal/availability?start=${encodeURIComponent(at(14, 30))}&minutes=30`);
      expect(again.stations.find((s: any) => s.id === st1).reason).toBe('Booked');
      await ok(token, 'POST', '/api/portal/bookings', { stationId: st2, startAt: at(15), minutes: 60 });
      await ok(token, 'POST', '/api/portal/bookings', { stationId: st2, startAt: at(17), minutes: 60 });
      expect((await call(token, 'POST', '/api/portal/bookings', { stationId: st2, startAt: at(19), minutes: 60 })).status).toBe(409);
    });

    it('lets the customer cancel their own booking only', async () => {
      const mine = await ok(token, 'GET', '/api/portal/bookings');
      const late = mine.find((b: any) => b.startAt === at(17));
      const other = (await ok('', 'POST', '/api/portal/signup', { fullName: 'Yaa', phone: '0551234567', password: 'yaa-pass-12' })).token;
      expect((await call(other, 'POST', `/api/portal/bookings/${late.id}/cancel`)).status).toBe(404);
      expect((await ok(token, 'POST', `/api/portal/bookings/${late.id}/cancel`)).status).toBe('cancelled');
    });

    it('checks a booking in by starting its session and completes it when the session ends', async () => {
      clock.set(new Date(at(14, 2)));
      const stations = (await ok(admin, 'GET', '/api/stations')).stations;
      const s1 = stations.find((s: any) => s.id === st1);
      expect(s1.nextBooking.name).toBe('Ama Mensah');
      const booking = s1.nextBooking.id;
      const sess = await ok(admin, 'POST', '/api/sessions', { stationId: st1, planId: plan, billingType: 'postpaid', bookingId: booking });
      let list = await ok(admin, 'GET', `/api/bookings?from=${encodeURIComponent(at(0))}&to=${encodeURIComponent(at(23))}`);
      expect(list.find((b: any) => b.id === booking).status).toBe('checked_in');
      clock.advance(30 * 60);
      await ok(admin, 'POST', `/api/sessions/${sess.id}/end`, { paymentMethod: 'cash' });
      list = await ok(admin, 'GET', `/api/bookings?from=${encodeURIComponent(at(0))}&to=${encodeURIComponent(at(23))}`);
      expect(list.find((b: any) => b.id === booking).status).toBe('completed');
    });

    it('marks bookings nobody turned up for as no-shows', async () => {
      clock.set(new Date(at(15, 20)));
      expect(await sweepNoShows({ db: handle.db, clock, bus })).toBe(1);
      const list = await ok(admin, 'GET', `/api/bookings?from=${encodeURIComponent(at(0))}&to=${encodeURIComponent(at(23))}`);
      expect(list.find((b: any) => b.startAt === at(15)).status).toBe('no_show');
    });

    it('lets staff book for a walk-in contact', async () => {
      const b = await ok(admin, 'POST', '/api/bookings', { stationId: st2, startAt: at(20), minutes: 120, contactName: 'Team Accra', contactPhone: '0270000000' });
      expect(b.contactPhone).toBe('+233270000000');
      expect((await call(admin, 'POST', '/api/bookings', { stationId: st2, startAt: at(21), minutes: 30, contactName: 'X' })).status).toBe(409);
    });
  });

  describe('Paystack wallet top-up', () => {
    it('stores the keys without ever returning the secret', async () => {
      expect((await call(admin, 'PUT', '/api/integrations/paystack', { enabled: true, publicKey: 'pk_test_abc123' })).status).toBe(400);
      const r = await ok(admin, 'PUT', '/api/integrations/paystack', { enabled: true, publicKey: 'pk_test_abc123', secretKey: 'sk_test_abc123' });
      expect(r.hasSecretKey).toBe(true);
      expect(JSON.stringify(r)).not.toContain('sk_test_abc123');
      expect((await ok(admin, 'POST', '/api/integrations/paystack/test')).ok).toBe(true);
      expect((await ok('', 'GET', '/api/portal/info')).paystackEnabled).toBe(true);
    });

    it('credits the wallet exactly once after Paystack confirms the payment', async () => {
      const start = await ok(token, 'POST', '/api/portal/topup', { amount: 5_000, email: 'ama@example.com' });
      expect(start.authorizationUrl).toContain('checkout.paystack.com');
      const init = calls.find((c) => c.url.endsWith('/transaction/initialize'))!;
      expect(init.body).toMatchObject({ amount: 5_000, currency: 'GHS', email: 'ama@example.com' });
      expect(init.body.callback_url).toContain('/portal/paid?reference=');

      // Not paid yet → stays pending, nothing credited.
      expect((await ok('', 'GET', `/api/portal/payments/${start.reference}`)).status).toBe('pending');
      paystackTx[start.reference].status = 'success';
      const a = await ok('', 'GET', `/api/portal/payments/${start.reference}`);
      expect(a.status).toBe('success');
      // Webhook + background sweep + another check must not credit again.
      const raw = JSON.stringify({ event: 'charge.success', data: { reference: start.reference } });
      const sig = createHmac('sha512', 'sk_test_abc123').update(raw).digest('hex');
      const hook = await call('', 'POST', '/api/paystack/webhook', raw, { 'content-type': 'application/json', 'x-paystack-signature': sig });
      expect(hook.status).toBe(200);
      await sweepPendingPayments({ db: handle.db, clock, bus, fetch: fakeFetch });
      await ok('', 'GET', `/api/portal/payments/${start.reference}`);
      const me = await ok(token, 'GET', '/api/portal/me');
      expect(me.balance).toBe(5_000);
      expect(me.ledger.filter((l: any) => l.type === 'deposit')).toHaveLength(1);
      const pays = await ok(admin, 'GET', '/api/payments?limit=50');
      const p = (pays.payments ?? pays).find((x: any) => x.method === 'paystack');
      expect(p.reference).toContain(start.reference);
    });

    it('rejects forged webhooks and never credits a mismatched amount', async () => {
      const raw = JSON.stringify({ event: 'charge.success', data: { reference: 'zg_fake_1' } });
      expect((await call('', 'POST', '/api/paystack/webhook', raw, { 'content-type': 'application/json', 'x-paystack-signature': 'bad' })).status).toBe(401);
      const start = await ok(token, 'POST', '/api/portal/topup', { amount: 2_000, email: 'ama@example.com' });
      paystackTx[start.reference] = { status: 'success', amount: 200, currency: 'GHS' };
      expect((await ok('', 'GET', `/api/portal/payments/${start.reference}`)).status).toBe('failed');
      expect((await ok(token, 'GET', '/api/portal/me')).balance).toBe(5_000);
      expect(alerts.some((m) => m.includes('did not match'))).toBe(true);
    });

    it('lets staff take a Paystack top-up at the counter with a QR code', async () => {
      const r = await ok(admin, 'POST', `/api/customers/${counterCustomer}/paystack`, { amount: 3_000, email: 'kofi@example.com' });
      expect(r.qr).toMatch(/^data:image\/png;base64,/);
      paystackTx[r.reference].status = 'success';
      expect((await ok(admin, 'GET', `/api/paystack/payments/${r.reference}`)).status).toBe('success');
      expect((await ok(admin, 'GET', `/api/customers/${counterCustomer}`)).balance).toBe(3_000);
    });
  });
});

describe('smart-plug power control', () => {
  it('switches the plug on at start and off at the end, and hides the plug password', async () => {
    clock.set(new Date('2026-01-05T18:00:00Z'));
    await ok(admin, 'PATCH', `/api/stations/${st2}`, { powerDriver: 'sonoff_diy', powerConfig: { host: '192.168.1.60', deviceId: '1000abcd', password: 'x' } });
    await app.power.idle();
    expect(plugs.get('192.168.1.60:8081')).toBe(false); // no session → off
    const listed = (await ok(admin, 'GET', '/api/stations')).stations.find((s: any) => s.id === st2);
    expect(listed.powerConfig.password).toBeUndefined();
    expect(listed.powerConfig.hasPassword).toBe(true);
    expect(listed.powerState).toBe('off');

    const s = await ok(admin, 'POST', '/api/sessions', { stationId: st2, planId: plan, billingType: 'prepaid', minutes: 30, paymentMethod: 'cash' });
    await app.power.idle();
    expect(plugs.get('192.168.1.60:8081')).toBe(true);
    const sw = calls.filter((c) => c.url === 'http://192.168.1.60:8081/zeroconf/switch').pop()!;
    expect(sw.body).toEqual({ deviceid: '1000abcd', data: { switch: 'on' } });

    await ok(admin, 'POST', `/api/sessions/${s.id}/pause`);
    await app.power.idle();
    expect(plugs.get('192.168.1.60:8081')).toBe(false);
    await ok(admin, 'POST', `/api/sessions/${s.id}/resume`);
    await app.power.idle();
    expect(plugs.get('192.168.1.60:8081')).toBe(true);
    await ok(admin, 'POST', `/api/sessions/${s.id}/end`, {});
    await app.power.idle();
    expect(plugs.get('192.168.1.60:8081')).toBe(false);
  });

  it('enforces the off state when someone switches the plug on by hand', async () => {
    plugs.set('192.168.1.60:8081', true);
    await app.power.enforceAll();
    expect(plugs.get('192.168.1.60:8081')).toBe(false);
    const r = await ok(admin, 'POST', `/api/stations/${st2}/power`, { on: true });
    expect(r.note).toContain('Maintenance');
  });

  it('drives Tasmota plugs and reports unreachable plugs without blocking billing', async () => {
    const r = await ok(admin, 'POST', '/api/power/test', { driver: 'tasmota', config: { host: '192.168.1.70' }, action: 'on' });
    expect(r).toEqual({ ok: true, state: 'on' });
    plugDown = true;
    const s = await ok(admin, 'POST', '/api/sessions', { stationId: st2, planId: plan, billingType: 'postpaid' });
    await app.power.idle();
    const listed = (await ok(admin, 'GET', '/api/stations')).stations.find((x: any) => x.id === st2);
    expect(listed.powerError).toContain('not reachable');
    expect(alerts.some((m) => m.includes('power plug problem'))).toBe(true);
    plugDown = false;
    await ok(admin, 'POST', `/api/sessions/${s.id}/end`, { paymentMethod: 'cash' });
    await app.power.idle();
    expect((await ok(admin, 'GET', '/api/stations')).stations.find((x: any) => x.id === st2).powerError).toBeNull();
  });
});

describe('SONOFF R4 (encrypted eWeLink LAN)', () => {
  it('switches a BASICR4 with the device key and hides the key', async () => {
    const cfg = { host: '192.168.1.80', deviceId: '1000r4r4r4', deviceKey: 'r4-device-key' };
    expect(await ok(admin, 'POST', '/api/power/test', { driver: 'sonoff_lan', config: cfg, action: 'on' })).toEqual({ ok: true, state: 'on' });
    expect(plugs.get('192.168.1.80:8081')).toBe(true);
    const wrongKey = await ok(admin, 'POST', '/api/power/test', { driver: 'sonoff_lan', config: { ...cfg, deviceKey: 'nope' }, action: 'status' });
    expect(wrongKey.ok).toBe(false);
    expect(wrongKey.error).toMatch(/device key/);
    const wrongId = await ok(admin, 'POST', '/api/power/test', { driver: 'sonoff_lan', config: { ...cfg, deviceId: '1000xxxxxx' }, action: 'status' });
    expect(wrongId.error).toMatch(/device ID/);

    await ok(admin, 'PATCH', `/api/stations/${st1}`, { powerDriver: 'sonoff_lan', powerConfig: cfg });
    await app.power.idle();
    expect(plugs.get('192.168.1.80:8081')).toBe(false);
    const listed = (await ok(admin, 'GET', '/api/stations')).stations.find((s: any) => s.id === st1);
    expect(listed.powerConfig.deviceKey).toBeUndefined();
    expect(listed.powerConfig.hasDeviceKey).toBe(true);
    // Saving the form again without re-typing the key keeps it.
    await ok(admin, 'PATCH', `/api/stations/${st1}`, { powerDriver: 'sonoff_lan', powerConfig: { host: '192.168.1.80', deviceId: '1000r4r4r4' } });
    const s = await ok(admin, 'POST', '/api/sessions', { stationId: st1, planId: plan, billingType: 'postpaid' });
    await app.power.idle();
    expect(plugs.get('192.168.1.80:8081')).toBe(true);
    await ok(admin, 'POST', `/api/sessions/${s.id}/end`, { paymentMethod: 'cash' });
    await app.power.idle();
    expect(plugs.get('192.168.1.80:8081')).toBe(false);
  });
});

describe('opening hours', () => {
  const local = (d: number, h: number, m = 0) => new Date(2026, 0, d, h, m);
  it('handles normal days, closing after midnight and 24-hour opening', () => {
    const day = { openingTime: '10:00', closingTime: '23:00' };
    expect(withinOpeningHours(local(5, 10), local(5, 11), day)).toBe(true);
    expect(withinOpeningHours(local(5, 22, 30), local(5, 23, 30), day)).toBe(false);
    expect(withinOpeningHours(local(5, 9), local(5, 10), day)).toBe(false);
    const late = { openingTime: '12:00', closingTime: '02:00' };
    expect(withinOpeningHours(local(5, 23), local(6, 1), late)).toBe(true);
    expect(withinOpeningHours(local(6, 0, 30), local(6, 1, 30), late)).toBe(true);
    expect(withinOpeningHours(local(6, 1, 30), local(6, 2, 30), late)).toBe(false);
    expect(withinOpeningHours(local(5, 3), local(5, 4), { openingTime: '00:00', closingTime: '00:00' })).toBe(true);
  });
});
