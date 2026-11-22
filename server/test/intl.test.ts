/** Country/currency settings, phone normalisation and mobile-money references. */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { ensureAdmin } from '../src/bootstrap.js';
import { openDatabase, type DbHandle } from '../src/db/index.js';
import { COUNTRIES, normalizePhone } from '../src/lib/countries.js';
import { ManualClock } from '../src/lib/clock.js';
import { Bus } from '../src/realtime/bus.js';

let handle: DbHandle;
let app: FastifyInstance;
let admin = '';
const originalTz = process.env.TZ;

async function call(method: string, url: string, payload?: unknown) {
  const res = await app.inject({ method: method as any, url, payload: payload as any, headers: { authorization: `Bearer ${admin}` } });
  return { status: res.statusCode, body: res.json() as any };
}

beforeAll(async () => {
  handle = await openDatabase({ pgliteDir: null });
  app = await buildApp({ db: handle.db, clock: new ManualClock(), bus: new Bus() }, { jwtSecret: 'test-secret-test-secret-test-secret-123' });
  await ensureAdmin(handle.db, 'admin', 'admin-pass-123');
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'admin', password: 'admin-pass-123' } });
  admin = r.json().token;
});
afterAll(async () => {
  process.env.TZ = originalTz;
  await app?.close();
  await handle?.close();
});

describe('country catalogue', () => {
  it('covers all 54 African countries plus the USA, with valid data', () => {
    expect(COUNTRIES).toHaveLength(55);
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(55);
    for (const c of COUNTRIES) {
      expect(c.currency).toMatch(/^[A-Z]{3}$/);
      expect(() => new Intl.DateTimeFormat('en', { timeZone: c.timezone })).not.toThrow();
      expect(c.dialCode).toMatch(/^\+\d{1,4}$/);
    }
    const gh = COUNTRIES.find((c) => c.code === 'GH')!;
    expect([gh.currency, gh.minorUnits, gh.dialCode, gh.timezone]).toEqual(['GHS', 2, '+233', 'Africa/Accra']);
    expect(COUNTRIES.find((c) => c.code === 'SN')!.minorUnits).toBe(0); // CFA franc has no decimals
  });

  it('normalises local phone numbers', () => {
    expect(normalizePhone('024 123 4567', '+233')).toBe('+233241234567');
    expect(normalizePhone('+234 803 000 0000', '+233')).toBe('+2348030000000');
    expect(normalizePhone('00254712345678', '+233')).toBe('+254712345678');
  });
});

describe('settings', () => {
  it('defaults to Ghana / GHS and serves the country list', async () => {
    const s = (await call('GET', '/api/settings')).body;
    expect(s.countryCode).toBe('GH');
    expect(s.currencyCode).toBe('GHS');
    expect(s.mobileMoneyProviders).toContain('MTN MoMo');
    expect((await call('GET', '/api/countries')).body).toHaveLength(55);
  });

  it('rejects unknown time zones and applies a valid one', async () => {
    const s = (await call('GET', '/api/settings')).body;
    expect((await call('PUT', '/api/settings', { ...s, timezone: 'Mars/Olympus' })).status).toBe(400);
    expect((await call('PUT', '/api/settings', { ...s, timezone: 'Africa/Lagos' })).status).toBe(200);
    expect(process.env.TZ).toBe('Africa/Lagos');
  });

  it('stores customer phones in international form and finds them by local number', async () => {
    const c = (await call('POST', '/api/customers', { fullName: 'Ama Serwaa', phone: '024 555 1234' })).body;
    expect(c.phone).toBe('+233245551234');
    expect((await call('POST', '/api/customers', { fullName: 'Dup', phone: '+233245551234' })).status).toBe(409);
    const found = (await call('GET', `/api/customers?q=${encodeURIComponent('0245551234')}`)).body;
    expect(found.map((x: any) => x.id)).toContain(c.id);
  });

  it('records mobile-money references and can require them', async () => {
    const s = (await call('GET', '/api/settings')).body;
    const cust = (await call('POST', '/api/customers', { fullName: 'Kojo' })).body;
    const ok = await call('POST', `/api/customers/${cust.id}/wallet`, { operation: 'deposit', amount: 5000, method: 'mobile_money', reference: 'MTN MoMo · 4429183301' });
    expect(ok.status).toBe(200);
    const pays = (await call('GET', '/api/payments?kind=deposit')).body;
    expect(pays[0].reference).toBe('MTN MoMo · 4429183301');

    await call('PUT', '/api/settings', { ...s, requireMomoReference: true });
    const missing = await call('POST', `/api/customers/${cust.id}/wallet`, { operation: 'deposit', amount: 5000, method: 'mobile_money', reference: 'MTN MoMo' });
    expect(missing.status).toBe(400);
    // cash is unaffected
    expect((await call('POST', `/api/customers/${cust.id}/wallet`, { operation: 'deposit', amount: 5000, method: 'cash' })).status).toBe(200);
  });

  it('refuses to change decimal places once money has been recorded', async () => {
    const s = (await call('GET', '/api/settings')).body;
    const r = await call('PUT', '/api/settings', { ...s, currencyCode: 'XOF', currencyMinorUnits: 0 });
    expect(r.status).toBe(409);
    expect((await call('PUT', '/api/settings', { ...s, countryCode: 'NG', currencyCode: 'NGN' })).status).toBe(200);
  });
});
