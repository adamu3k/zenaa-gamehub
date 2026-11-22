/**
 * v0.6 — staff PINs & manager override, staff unlock (turn on with no charge) incl. from the station screen,
 * the console browser page, MoMo top-ups confirmed by SMS relay or staff, news, finance, backups and updates.
 */
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { ensureAdmin } from '../src/bootstrap.js';
import type { Ctx } from '../src/context.js';
import { openDatabase, type DbHandle } from '../src/db/index.js';
import { payments } from '../src/db/schema.js';
import { ManualClock } from '../src/lib/clock.js';
import { Bus } from '../src/realtime/bus.js';
import { codesInSms, inAutoHours, parseMomoSms, waitReason } from '../src/services/momo.js';
import { DEFAULT_SETTINGS } from '../src/services/settings.js';

process.env.BACKUP_DIR = mkdtempSync(path.join(os.tmpdir(), 'zenaa-bk-'));
process.env.UPDATE_DIR = mkdtempSync(path.join(os.tmpdir(), 'zenaa-up-'));

let handle: DbHandle;
let app: FastifyInstance;
const clock = new ManualClock();
let admin = '';
let manager = '';
let cashier = '';
let managerId = '';
let cashierId = '';
let st = '';
let plan = '';
let fakeLatest = '0.6.0';

async function call(token: string, method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) {
  const res = await app.inject({ method: method as any, url, payload: payload as any, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
  let body: any = res.body;
  try {
    body = res.json();
  } catch {
    /* not json */
  }
  return { status: res.statusCode, body, raw: res.rawPayload, headers: res.headers };
}
const ok = async (token: string, method: string, url: string, payload?: unknown) => {
  const r = await call(token, method, url, payload);
  if (r.status !== 200) throw new Error(`${method} ${url} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const setSettings = async (patch: object) => ok(admin, 'PUT', '/api/settings', { ...(await ok(admin, 'GET', '/api/settings')), ...patch });

beforeAll(async () => {
  handle = await openDatabase({ pgliteDir: null });
  const fakeFetch = (async (url: string) => {
    if (String(url).includes('raw.githubusercontent.com')) return new Response(JSON.stringify({ version: fakeLatest }), { status: 200 });
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  const ctx: Ctx = { db: handle.db, clock, bus: new Bus(), fetch: fakeFetch };
  app = await buildApp(ctx, { jwtSecret: 'test-secret-test-secret-test-secret-123' });
  await ensureAdmin(handle.db, 'admin', 'admin-pass-123');
  admin = (await ok('', 'POST', '/api/auth/login', { username: 'admin', password: 'admin-pass-123' })).token;
  managerId = (await ok(admin, 'POST', '/api/staff', { username: 'mgr', fullName: 'Efua Manager', role: 'manager', password: 'manager-pass' })).id;
  cashierId = (await ok(admin, 'POST', '/api/staff', { username: 'cash', fullName: 'Yaw Cashier', role: 'cashier', password: 'cashier-pass' })).id;
  manager = (await ok('', 'POST', '/api/auth/login', { username: 'mgr', password: 'manager-pass' })).token;
  cashier = (await ok('', 'POST', '/api/auth/login', { username: 'cash', password: 'cashier-pass' })).token;
  st = (await ok(admin, 'POST', '/api/stations', { code: 'PS-01', name: 'PS5 One', platform: 'ps5' })).id;
  plan = (await ok(admin, 'POST', '/api/pricing-plans', { name: 'Hour', kind: 'time_rate', ratePerHour: 1_000 })).id;
});

afterAll(async () => {
  await app?.close();
  await handle?.close();
});

describe('staff PINs and manager override', () => {
  it('sets PINs, refuses easy and duplicate PINs', async () => {
    expect((await call(manager, 'POST', '/api/auth/pin', { password: 'manager-pass', pin: '1234' })).status).toBe(400);
    expect((await call(manager, 'POST', '/api/auth/pin', { password: 'wrong', pin: '2580' })).status).toBe(400);
    await ok(manager, 'POST', '/api/auth/pin', { password: 'manager-pass', pin: '2580' });
    expect((await ok(manager, 'GET', '/api/auth/me')).hasPin).toBe(true);
    // Admin sets the cashier's PIN; a PIN already used by someone else is refused.
    expect((await call(admin, 'POST', `/api/staff/${cashierId}/pin`, { pin: '2580' })).status).toBe(400);
    await ok(admin, 'POST', `/api/staff/${cashierId}/pin`, { pin: '7391' });
    const list = await ok(admin, 'GET', '/api/staff');
    expect(list.find((s: any) => s.id === cashierId).hasPin).toBe(true);
    expect((await ok(cashier, 'POST', '/api/auth/pin/check', { pin: '2580' })).fullName).toBe('Efua Manager');
  });

  it('a cashier without permission gets a manager to approve with a PIN', async () => {
    await ok(cashier, 'POST', '/api/shifts/open', { openingFloat: 5_000 });
    const body = { direction: 'out', amount: 1_500, category: 'fuel', reason: 'Generator fuel' };
    const r1 = await call(cashier, 'POST', '/api/shifts/cash-movement', body);
    expect(r1.status).toBe(428);
    expect(r1.body.error).toBe('pin_required');
    expect((await call(cashier, 'POST', '/api/shifts/cash-movement', { ...body, pin: '7391' })).status).toBe(403); // own PIN, no permission
    expect((await call(cashier, 'POST', '/api/shifts/cash-movement', { ...body, pin: '9999' })).body.error).toBe('pin_wrong');
    const p = await ok(cashier, 'POST', '/api/shifts/cash-movement', { ...body, pin: '2580' });
    const [row] = await handle.db.select().from(payments).where(eq(payments.id, p.id));
    expect(row.approvedBy).toBe(managerId);
    expect(row.staffId).toBe(cashierId);
    expect(row.category).toBe('fuel');
  });

  it('Settings can require a PIN for actions even for people who have the permission', async () => {
    await setSettings({ requirePinFor: ['cash_movement'] });
    await ok(manager, 'POST', '/api/shifts/open', { openingFloat: 0 });
    const body = { direction: 'in', amount: 500, reason: 'Change float' };
    expect((await call(manager, 'POST', '/api/shifts/cash-movement', body)).status).toBe(428);
    await ok(manager, 'POST', '/api/shifts/cash-movement', { ...body, pin: '2580' });
    await setSettings({ requirePinFor: [] });
  });

  it('closes a shift with a note/coin count and MoMo count', async () => {
    const shift = (await ok(cashier, 'GET', '/api/shifts/current')).shift;
    const closed = await ok(cashier, 'POST', `/api/shifts/${shift.id}/close`, { countedCash: 3_500, countedBreakdown: { '20': 1, '10': 1, '5': 1 }, countedMomo: 0 });
    expect(closed.variance).toBe(0);
    expect(closed.momoVariance).toBe(0);
    expect(closed.countedBreakdown).toEqual({ '20': 1, '10': 1, '5': 1 });
    expect(closed.summary.expenses.fuel).toBe(1_500);
  });
});

describe('staff unlock (turn on with no charge)', () => {
  let agent = '';
  it('turns a station on without a session, shows it to the screen app, and ends when a session starts', async () => {
    const code = (await ok(admin, 'POST', `/api/stations/${st}/agent-code`)).code;
    agent = (await ok('', 'POST', '/api/agent/pair', { code, kind: 'pc' })).token;
    expect((await ok(agent, 'GET', '/api/agent/state')).dock.scale).toBe(70);

    expect((await call(cashier, 'POST', `/api/stations/${st}/bypass`, { minutes: 15 })).status).toBe(428);
    await ok(cashier, 'POST', `/api/stations/${st}/bypass`, { minutes: 15, reason: 'Game update', pin: '2580' });
    const live = (await ok(admin, 'GET', '/api/stations')).stations.find((s: any) => s.id === st);
    expect(live.liveStatus).toBe('staff_use');
    expect(live.bypassByName).toBe('Efua Manager');
    const state = await ok(agent, 'GET', '/api/agent/state');
    expect(state.phase).toBe('staff');
    expect(state.lock).toBe(false);
    expect(state.bypass.remainingSeconds).toBe(900);

    clock.advance(16 * 60);
    expect((await ok(agent, 'GET', '/api/agent/state')).phase).toBe('idle');
  });

  it('staff unlock a screen with their PIN; cashiers cannot', async () => {
    expect((await call(agent, 'POST', '/api/agent/unlock', { pin: '7391', action: 'unlock' })).status).toBe(403);
    const r = await ok(agent, 'POST', '/api/agent/unlock', { pin: '2580', action: 'unlock', minutes: 10 });
    expect(r.name).toBe('Efua Manager');
    expect((await ok(agent, 'GET', '/api/agent/state')).phase).toBe('staff');
    expect((await ok(agent, 'POST', '/api/agent/unlock', { pin: '2580', action: 'exit' })).ok).toBe(true);
    // A paid session replaces the unlock.
    await ok(cashier, 'POST', '/api/sessions', { stationId: st, planId: plan, billingType: 'postpaid' });
    const state = await ok(agent, 'GET', '/api/agent/state');
    expect(state.phase).toBe('running');
    expect(state.bypass).toBeNull();
  });

  it('the shared exit PIN from Settings also works while online', async () => {
    await setSettings({ agentExitPin: '4826' });
    const r = await ok(agent, 'POST', '/api/agent/unlock', { pin: '4826', action: 'exit' });
    expect(r.name).toBe('Shared exit PIN');
    expect((await call(agent, 'POST', '/api/agent/unlock', { pin: '4827', action: 'exit' })).status).toBe(403);
  });

  it('serves the console browser page and checks the PIN', async () => {
    const page = await call('', 'GET', '/ps', undefined, { 'user-agent': 'Mozilla/5.0 (PlayStation 4 11.00) AppleWebKit' });
    expect(page.status).toBe(200);
    expect(page.body).toContain('PS-01');
    expect(page.body).toMatch(/value="ps4" checked/);
    const bad = await app.inject({
      method: 'POST',
      url: '/ps',
      headers: { 'content-type': 'application/x-www-form-urlencoded', host: '192.168.1.10:8080' },
      payload: `station=${st}&platform=ps5&host=192.168.1.50&port=9021&pin=0000`,
    });
    expect(bad.body).toContain('Wrong PIN');
  });
});

describe('MoMo top-ups without a gateway', () => {
  it('reads MTN, Telecel and AT money-received messages', () => {
    const mtn = parseMomoSms(
      'Payment received for GHS 20.00 from KWAME MENSAH 0241234567 Current Balance: GHS 1,520.50 . Available Balance: GHS 1,520.50. Reference: KD4821. Transaction ID: 51234567890. TRANSACTION FEE: 0.00',
    );
    expect(mtn).toMatchObject({ incoming: true, amountMajor: 20, txnId: '51234567890', reference: 'KD4821', payerPhone: '0241234567' });
    const tel = parseMomoSms('0000012345678 Confirmed. You have received GHS1,250.50 from AMA SERWAA 0201234567 on 2026-11-19 at 10:15:23. Reference: KD4821. Your Telecel Cash balance is GHS340.00.');
    expect(tel).toMatchObject({ incoming: true, amountMajor: 1250.5, txnId: '0000012345678' });
    const at = parseMomoSms('You have received GHS 20.00 from 0571234567 YAW BOATENG. Ref: KD4821. Trans ID: 1234567890. Your new balance is GHS 100.00');
    expect(at).toMatchObject({ incoming: true, amountMajor: 20, txnId: '1234567890' });
    expect(parseMomoSms('You have sent GHS 20.00 to KOFI. Transaction ID: 99999999').incoming).toBe(false);
  });

  let customer = '';
  let relay = '';
  const sms = (body: string, from = 'MobileMoney') => call('', 'POST', `/api/momo/sms?token=${relay}`, { from, body });

  it('credits the wallet when the MoMo phone forwards the matching SMS', async () => {
    customer = (await ok('', 'POST', '/api/portal/signup', { fullName: 'Ama Mensah', phone: '0241112222', password: 'ama-secret-1' })).token;
    expect((await call(customer, 'POST', '/api/portal/momo', { amount: 2_000, network: 'MTN MoMo' })).status).toBe(409); // no account yet
    await setSettings({ momoAccounts: [{ network: 'MTN MoMo', number: '0240000000', name: 'ZENAA GAMEHUB' }] });
    const req = await ok(customer, 'POST', '/api/portal/momo', { amount: 2_000, network: 'MTN MoMo' });
    expect(req.code).toMatch(/^[1-9]\d{5}$/);
    expect(req.account.number).toBe('0240000000');

    relay = (await ok(admin, 'POST', '/api/momo/relay/link', { device: 'Counter phone' })).token;
    expect((await call('', 'POST', '/api/momo/sms?token=nope', { from: 'MobileMoney', body: 'x' })).status).toBe(401);
    // A text from a phone number is never trusted.
    const fake = await sms(`Payment received for GHS 20.00 from X. Reference: ${req.code}. Transaction ID: 11111111111.`, '+233241234567');
    expect(fake.body.status).toBe('ignored');
    const real = await sms(`Payment received for GHS 20.00 from AMA MENSAH 0241112222 Current Balance: GHS 520.00. Reference: ${req.code}. Transaction ID: 51234567890.`);
    expect(real.body.status).toBe('credited');
    const after = await ok(customer, 'GET', `/api/portal/momo/${req.id}`);
    expect(after.status).toBe('confirmed');
    expect(after.balance).toBe(2_000);
    // The same message again is not credited twice.
    expect((await sms(`Payment received for GHS 20.00 from AMA. Reference: ${req.code}. Transaction ID: 51234567890.`)).body.status).toBe('ignored');

    // Keypad phone: the number code typed with a space still matches.
    const kp = await ok(customer, 'POST', '/api/portal/momo', { amount: 500, network: 'MTN MoMo' });
    const spaced = `${kp.code.slice(0, 3)} ${kp.code.slice(3)}`;
    const typed = await sms(`Payment received for GHS 5.00 from KOFI 0551234567 Current Balance: GHS 525.00. Reference: ${spaced}. Transaction ID: 51234567999.`);
    expect(typed.body.status).toBe('credited');
  });

  it('reads number codes only from the Reference, never from phone numbers or balances', () => {
    expect(codesInSms('482193', 'x')).toEqual(['482193']);
    expect(codesInSms('482 193', 'x')).toEqual(['482193']);
    expect(codesInSms('kd4821', 'x')).toEqual(['KD4821']); // codes from before v0.7.1
    expect(codesInSms(null, 'Payment received for GHS 20.00 from 0241234567. Transaction ID: 482193.')).toEqual([]);
    expect(codesInSms('1234567', 'x')).toEqual([]); // 7 digits is not a code
  });

  it('decides when to credit automatically: under the limit and inside the hours', () => {
    const base = { ...DEFAULT_SETTINGS, timezone: 'Africa/Accra', momoAutoMax: 30_000, momoAutoHoursOn: true, momoAutoFrom: '06:00', momoAutoTo: '23:00' };
    const noon = new Date('2026-11-20T12:00:00Z');
    expect(waitReason(29_999, noon, base)).toBeNull();
    expect(waitReason(30_000, noon, base)).toMatch(/GHS 300.00 and above/);
    expect(waitReason(5_000, new Date('2026-11-20T23:30:00Z'), base)).toMatch(/outside automatic hours/);
    expect(waitReason(5_000, new Date('2026-11-21T05:59:00Z'), base)).toMatch(/outside/);
    expect(waitReason(5_000, new Date('2026-11-20T23:30:00Z'), { ...base, momoAutoHoursOn: false })).toBeNull();
    // A window across midnight: 18:00–02:00.
    expect(inAutoHours(new Date('2026-11-20T01:00:00Z'), { ...base, momoAutoFrom: '18:00', momoAutoTo: '02:00' })).toBe(true);
    expect(inAutoHours(new Date('2026-11-20T12:00:00Z'), { ...base, momoAutoFrom: '18:00', momoAutoTo: '02:00' })).toBe(false);
  });

  it('big payments wait for staff; a payment from the customer\'s own phone without the code still matches', async () => {
    await setSettings({ momoAutoMax: 30_000 });
    const big = await ok(customer, 'POST', '/api/portal/momo', { amount: 30_000, network: 'MTN MoMo' });
    expect((await sms(`Payment received for GHS 300.00 from AMA. Reference: ${big.code}. Transaction ID: 81234567890.`)).body.status).toBe('unmatched');
    const waiting = (await ok(cashier, 'GET', '/api/momo/requests?status=pending')).find((x: any) => x.id === big.id);
    expect(waiting.note).toMatch(/waiting for staff.*and above/);
    await ok(cashier, 'POST', `/api/momo/requests/${big.id}/reject`, { reason: 'test' });

    const nocode = await ok(customer, 'POST', '/api/portal/momo', { amount: 700, network: 'MTN MoMo' });
    const r = await sms('Payment received for GHS 7.00 from AMA MENSAH 0241112222 Current Balance: GHS 900.00. Transaction ID: 81234567891.');
    expect(r.body.status).toBe('credited');
    expect((await ok(customer, 'GET', `/api/portal/momo/${nocode.id}`)).status).toBe('confirmed');
  });

  it('queues a thank-you SMS that the MoMo phone sends and reports', async () => {
    const box = await ok(cashier, 'GET', '/api/momo/outbox');
    const thanks = box.find((m: any) => m.kind === 'momo' && m.body.includes('GHS 20.00'));
    expect(thanks.phone).toMatch(/241112222$/);
    expect(thanks.body).toMatch(/^Hi Ama, thank you! GHS 20.00 has been added to your ZENAA GAMEHUB wallet\. Balance: GHS/);
    expect((await call('', 'GET', '/api/momo/relay/outbox?token=nope')).status).toBe(401);
    const take = await ok('', 'GET', `/api/momo/relay/outbox?token=${relay}`);
    expect(take.messages.length).toBeGreaterThan(0);
    expect((await ok('', 'GET', `/api/momo/relay/outbox?token=${relay}`)).messages.length).toBe(0); // not handed out twice
    for (const m of take.messages) await ok('', 'POST', `/api/momo/relay/outbox/${m.id}?token=${relay}`, { ok: true });
    expect((await ok(cashier, 'GET', '/api/momo/outbox')).find((m: any) => m.id === thanks.id).status).toBe('sent');

    await setSettings({ smsNotifyMomo: false });
    const off = await ok(customer, 'POST', '/api/portal/momo', { amount: 600, network: 'MTN MoMo' });
    await sms(`Payment received for GHS 6.00 from AMA. Reference: ${off.code}. Transaction ID: 81234567892.`);
    expect((await ok('', 'GET', `/api/momo/relay/outbox?token=${relay}`)).messages.length).toBe(0);
    await setSettings({ smsNotifyMomo: true });

    expect((await call(cashier, 'POST', '/api/momo/outbox/test', { phone: '0241112222' })).status).toBe(403);
    const t = await ok(admin, 'POST', '/api/momo/outbox/test', { phone: '024 111 2222' });
    expect(t.phone).toBe('0241112222');
    const [m] = (await ok('', 'GET', `/api/momo/relay/outbox?token=${relay}`)).messages;
    await ok('', 'POST', `/api/momo/relay/outbox/${m.id}?token=${relay}`, { ok: false, error: 'No signal' });
    expect((await ok(cashier, 'GET', '/api/momo/outbox')).find((x: any) => x.id === t.id).status).toBe('queued'); // tried again later
  });

  it('matches by the transaction ID the customer types, and leaves odd amounts to staff', async () => {
    const req = await ok(customer, 'POST', '/api/portal/momo', { amount: 1_000, network: 'MTN MoMo' });
    expect((await sms('Payment received for GHS 10.00 from AMA MENSAH. Transaction ID: 62345678901.')).body.status).toBe('unmatched');
    const r = await ok(customer, 'POST', `/api/portal/momo/${req.id}/txn`, { txnId: '62345678901' });
    expect(r.status).toBe('confirmed');

    const odd = await ok(customer, 'POST', '/api/portal/momo', { amount: 3_000, network: 'MTN MoMo' });
    expect((await sms(`Payment received for GHS 25.00 from AMA. Reference: ${odd.code}. Transaction ID: 72345678901.`)).body.status).toBe('unmatched');
    const inbox = await ok(cashier, 'GET', '/api/momo/requests?status=pending');
    const item = inbox.find((x: any) => x.id === odd.id);
    expect(item.note).toMatch(/amount differs/i);
    await ok(cashier, 'POST', `/api/momo/requests/${odd.id}/reject`, { reason: 'Paid 25 not 30' });
    // Credit the unclaimed SMS to the customer instead.
    const unmatched = (await ok(cashier, 'GET', '/api/momo/sms?status=unmatched')).find((x: any) => x.txnId === '72345678901');
    await ok(cashier, 'POST', `/api/momo/sms/${unmatched.id}/assign`, { customerId: (await ok(customer, 'GET', '/api/portal/me')).id });
    expect((await ok(customer, 'GET', '/api/portal/me')).balance).toBe(2_000 + 500 + 700 + 600 + 1_000 + 2_500);
  });
});

describe('news, finance, backups and updates', () => {
  it('posts news with a picture and shows it publicly; tournaments announce themselves', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    expect((await call(cashier, 'POST', '/api/posts', { title: 'Hi', body: '' })).status).toBe(403);
    await ok(admin, 'POST', '/api/posts', { kind: 'promo', title: 'Happy hour 2–5pm', body: '20% off', image: png, pinned: true });
    await ok(admin, 'POST', '/api/posts', { title: 'Hidden', published: false });
    await setSettings({ socialLinks: { youtube: 'https://youtube.com/@zenaa' } });
    const pub = await ok('', 'GET', '/api/public/news');
    expect(pub.posts.map((p: any) => p.title)).toEqual(['Happy hour 2–5pm']);
    expect(pub.socialLinks.youtube).toBe('https://youtube.com/@zenaa');
    const img = await call('', 'GET', pub.posts[0].imageUrl);
    expect(img.headers['content-type']).toBe('image/png');

    const games = await ok(admin, 'GET', '/api/games');
    const t = await ok(admin, 'POST', '/api/tournaments', { name: 'Friday FC Cup', gameId: games[0].id, format: 'knockout', maxPlayers: 8 });
    await ok(admin, 'POST', `/api/tournaments/${t.id}/status`, { status: 'registration' });
    const pub2 = await ok('', 'GET', '/api/public/news');
    expect(pub2.posts.some((p: any) => p.kind === 'tournament' && p.title.includes('Friday FC Cup'))).toBe(true);
    expect((await call('', 'GET', '/api/qr?text=http://192.168.1.10:8080/portal')).headers['content-type']).toBe('image/svg+xml');
  });

  it('summarises money in and out, and exports CSV', async () => {
    const from = new Date(clock.now().getTime() - 86400_000).toISOString();
    const to = new Date(clock.now().getTime() + 86400_000).toISOString();
    expect((await call(cashier, 'GET', `/api/finance/summary?from=${from}&to=${to}`)).status).toBe(403);
    const f = await ok(manager, 'GET', `/api/finance/summary?from=${from}&to=${to}`);
    expect(f.expenses.fuel).toBe(1_500);
    expect(f.moneyIn.mobile_money).toBe(7_300);
    expect(f.wallet.owedToCustomers).toBe(7_300);
    expect(f.momo.confirmed.count).toBe(6);
    const csv = await call(manager, 'GET', `/api/finance/export.csv?from=${from}&to=${to}`);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.raw.toString()).toContain('Approved by (PIN)');
    expect(csv.raw.toString()).toContain('Efua Manager');
  });

  it('downloads a one-file backup and restores it', async () => {
    expect((await call(manager, 'GET', '/api/system/backup')).status).toBe(403);
    const dl = await call(admin, 'GET', '/api/system/backup');
    expect(dl.status).toBe(200);
    const parsed = JSON.parse(gunzipSync(dl.raw).toString());
    expect(parsed.format).toBe('zenaa-backup');
    expect(parsed.tables.customers.length).toBe(1);

    await ok(admin, 'POST', '/api/customers', { fullName: 'After Backup', phone: '0209990000' });
    expect((await call(admin, 'POST', '/api/system/restore?confirm=nope', dl.raw, { 'content-type': 'application/gzip' })).status).toBe(400);
    const r = await call(admin, 'POST', '/api/system/restore?confirm=RESTORE', dl.raw, { 'content-type': 'application/gzip' });
    expect(r.status).toBe(200);
    expect(r.body.safetyCopy).toMatch(/^zenaa-before-restore-/);
    const list = await ok(admin, 'GET', '/api/customers');
    const names = (list.customers ?? list).map((c: any) => c.fullName);
    expect(names).not.toContain('After Backup');
    // Numbering continues after the restored rows.
    const c = await ok(admin, 'POST', '/api/customers', { fullName: 'New One', phone: '0209990001' });
    expect(c.code).toBe('ZG-000002');
    expect((await ok(admin, 'GET', '/api/system/backups')).some((f: any) => f.name === r.body.safetyCopy)).toBe(true);
  });

  it('checks GitHub for a newer version and hands the update to the updater on the PC', async () => {
    expect((await ok(admin, 'GET', '/api/system/update/check')).configured).toBe(false);
    await setSettings({ updateRepo: 'someone/zenaa-gamehub' });
    fakeLatest = '9.0.0';
    const c = await ok(admin, 'GET', '/api/system/update/check');
    expect(c.available).toBe(true);
    expect(c.latest).toBe('9.0.0');
    expect((await call(admin, 'POST', '/api/system/update')).body.error).toBe('updater_missing');
  });
});
