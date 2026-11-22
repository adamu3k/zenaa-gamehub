/**
 * v0.9 — appearance settings, admin-only calculator/social permissions, post ideas from news, posting to socials.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { ROLE_DEFAULTS } from '../src/auth/permissions.js';
import { ensureAdmin } from '../src/bootstrap.js';
import type { Ctx } from '../src/context.js';
import { openDatabase, type DbHandle } from '../src/db/index.js';
import { posts, smsOutbox } from '../src/db/schema.js';
import { ManualClock } from '../src/lib/clock.js';
import { Bus, type BusEvent } from '../src/realtime/bus.js';
import type { FeedItem } from '../src/services/newsfeed.js';
import { dailyIdeasTick, isPrivateAddress } from '../src/services/social.js';

let handle: DbHandle;
let app: FastifyInstance;
const clock = new ManualClock(Date.parse('2026-05-04T07:00:00Z')); // 07:00 in Accra
const bus = new Bus();
const events: BusEvent[] = [];
const calls: { url: string; body?: any }[] = [];
let admin = '';
let ctx: Ctx;

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

/** Stands in for Facebook, Telegram and news websites. */
const fakeFetch = (async (input: any, init?: any) => {
  const url = String(input);
  calls.push({ url, body: init?.body });
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  if (url.startsWith('http://93.184.216.34/pic.png')) return new Response(PNG, { headers: { 'content-type': 'image/png' } });
  if (url.startsWith('http://93.184.216.34/page.html')) return new Response('<html>', { headers: { 'content-type': 'text/html' } });
  if (url.includes('graph.facebook.com/v21.0/1234567890/photos')) return json({ id: '111', post_id: '1234567890_111' });
  if (url.includes('graph.facebook.com/v21.0/1234567890?fields=name')) return json({ name: 'Zenaa Mega Games', instagram_business_account: { id: '17840000000', username: 'zenaamegagames' } });
  if (url.includes('api.telegram.org/bot') && url.includes('/sendPhoto')) return json({ ok: true, result: { message_id: 42 } });
  if (url.includes('api.telegram.org/bot') && url.includes('/getChat')) return json({ ok: true, result: { title: 'ZMG Channel' } });
  return json({ error: { message: `unexpected ${url}` } }, 400);
}) as typeof fetch;

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

const items: FeedItem[] = [
  { title: 'GTA 6 trailer 3 is out', url: 'https://news.example/gta', summary: 'Rockstar shows Vice City again.', imageUrl: 'http://93.184.216.34/pic.png', source: 'Game News', publishedAt: null },
  { title: 'EA FC 27 patch notes', url: 'https://news.example/fc', summary: 'Defending changes.', imageUrl: null, source: 'Game News', publishedAt: null },
  { title: 'New PS5 update', url: 'https://news.example/ps5', summary: 'Faster downloads.', imageUrl: 'http://93.184.216.34/pic.png', source: 'Game News', publishedAt: null },
];

beforeAll(async () => {
  handle = await openDatabase({ pgliteDir: null });
  ctx = { db: handle.db, clock, bus, fetch: fakeFetch };
  bus.on((e) => events.push(e));
  app = await buildApp(ctx, { jwtSecret: 'test-secret-test-secret-test-secret-123' });
  await ensureAdmin(handle.db, 'admin', 'admin-pass-123');
  admin = (await ok('', 'POST', '/api/auth/login', { username: 'admin', password: 'admin-pass-123' })).token;
});

afterAll(async () => {
  await app?.close();
  await handle?.close();
});

describe('appearance', () => {
  it('saves colours and fonts and shows them without sign-in', async () => {
    const before = await ok('', 'GET', '/api/public/appearance');
    expect(before.appearance).toMatchObject({ primary: '#7c5cff', textScale: 100, applyToPortal: true });
    const s = await ok(admin, 'GET', '/api/settings');
    await ok(admin, 'PUT', '/api/settings', { ...s, appearance: { ...s.appearance, primary: '#1d44f9', accent: '#ccf02a', textScale: 115, headingFont: 'anton' } });
    const after = await ok('', 'GET', '/api/public/appearance');
    expect(after.appearance).toMatchObject({ primary: '#1d44f9', accent: '#ccf02a', textScale: 115, headingFont: 'anton', font: 'inter' });
    const bad = await call(admin, 'PUT', '/api/settings', { ...s, appearance: { ...s.appearance, primary: 'purple' } });
    expect(bad.status).toBe(400);
  });

  it('keeps the calculator and the Social page for admins unless granted', () => {
    expect(ROLE_DEFAULTS.admin).toContain('sessions.calculator');
    expect(ROLE_DEFAULTS.admin).toContain('social.manage');
    expect(ROLE_DEFAULTS.manager).not.toContain('sessions.calculator');
    expect(ROLE_DEFAULTS.manager).not.toContain('social.manage');
    expect(ROLE_DEFAULTS.cashier).not.toContain('social.manage');
  });
});

describe('post ideas from news', () => {
  it('makes ideas once a day after the chosen time, tells staff and texts the owner', async () => {
    const s = await ok(admin, 'GET', '/api/settings');
    await ok(admin, 'PUT', '/api/settings', {
      ...s,
      newsFeeds: [{ url: 'https://news.example/feed', name: 'Game News' }],
      social: { ...s.social, ideasTime: '09:00', ideasPerDay: 2, notifyPhone: '0241234567' },
    });
    expect(await dailyIdeasTick(ctx, items)).toBe(0); // 07:00: too early
    clock.set(new Date('2026-05-04T09:05:00Z'));
    events.length = 0;
    expect(await dailyIdeasTick(ctx, items)).toBe(2);
    expect(await dailyIdeasTick(ctx, items)).toBe(0); // once a day
    expect(events.some((e) => e.type === 'alert' && /2 new post ideas/.test(e.message))).toBe(true);
    const sms = await handle.db.select().from(smsOutbox);
    expect(sms.find((m) => m.kind === 'social')).toMatchObject({ phone: '0241234567' });

    const ideas = await ok(admin, 'GET', '/api/social/posts?status=ideas');
    expect(ideas).toHaveLength(2);
    const gta = ideas.find((i: any) => i.newsUrl === 'https://news.example/gta');
    expect(gta.fields.headline).toBe('GTA 6 trailer 3 is out');
    expect(gta.caption).toContain('#ZenaaMegaGames');
    expect(gta.caption).toContain('Rockstar shows Vice City again.');
    const fc = ideas.find((i: any) => i.newsUrl === 'https://news.example/fc');
    expect(fc.template).toBe('quote'); // no picture → quote card

    // The next day only the unused story is left.
    clock.set(new Date('2026-05-05T10:00:00Z'));
    expect(await dailyIdeasTick(ctx, items)).toBe(1);
  });
});

describe('graphics and posting', () => {
  it('fetches news pictures for the canvas but never from the local network', async () => {
    const r = await call(admin, 'GET', `/api/social/image?url=${encodeURIComponent('http://93.184.216.34/pic.png')}`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect((await call(admin, 'GET', `/api/social/image?url=${encodeURIComponent('http://127.0.0.1:8080/api/settings')}`)).status).toBe(400);
    expect((await call(admin, 'GET', `/api/social/image?url=${encodeURIComponent('http://93.184.216.34/page.html')}`)).status).toBe(400);
    expect(isPrivateAddress('192.168.1.10')).toBe(true);
    expect(isPrivateAddress('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect((await call('', 'GET', `/api/social/image?url=${encodeURIComponent('http://93.184.216.34/pic.png')}`)).status).toBe(401);
  });

  it('connects accounts without showing tokens, and posts to Facebook, Telegram and the customer app', async () => {
    const saved = await ok(admin, 'PUT', '/api/social/accounts', { fbPageId: '1234567890', fbToken: 'EAAB-secret-token', tgBotToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ', tgChatId: '@zmgchannel' });
    expect(JSON.stringify(saved)).not.toContain('secret');
    expect(JSON.stringify(saved)).not.toContain('ABCDEFGHIJ');
    const checked = await ok(admin, 'POST', '/api/social/accounts/check');
    expect(checked.status.facebook).toMatchObject({ connected: true, pageName: 'Zenaa Mega Games' });
    expect(checked.status.instagram).toMatchObject({ connected: true, username: 'zenaamegagames', publicUrlOk: false });
    expect(checked.status.telegram).toMatchObject({ connected: true, title: 'ZMG Channel' });
    // A blank token keeps the saved one.
    await ok(admin, 'PUT', '/api/social/accounts', { fbPageId: '1234567890', fbToken: '' });
    expect((await ok(admin, 'GET', '/api/social/accounts')).facebook.connected).toBe(true);

    const draft = await ok(admin, 'POST', '/api/social/posts', { template: 'promo', fields: { headline: 'HAPPY HOUR', sub: '50% off 2–5 pm' }, caption: 'Happy hour today!' });
    const media = `data:image/png;base64,${PNG.toString('base64')}`;
    const out = await ok(admin, 'POST', `/api/social/posts/${draft.id}/publish`, { platforms: ['facebook', 'telegram', 'portal', 'instagram'], caption: 'Happy hour today!', media });
    const by = Object.fromEntries(out.results.map((r: any) => [r.platform, r]));
    expect(by.facebook).toMatchObject({ ok: true, url: 'https://www.facebook.com/1234567890_111' });
    expect(by.telegram).toMatchObject({ ok: true, url: 'https://t.me/zmgchannel/42' });
    expect(by.portal.ok).toBe(true);
    expect(by.instagram.ok).toBe(false); // ZENAA is not on the internet (no https public address)
    expect(by.instagram.error).toMatch(/https/);
    expect(out.post.status).toBe('posted');

    const fb = calls.find((c) => c.url.includes('/1234567890/photos'))!;
    expect((fb.body as FormData).get('message')).toBe('Happy hour today!');
    expect((fb.body as FormData).get('access_token')).toBe('EAAB-secret-token');
    const portal = await handle.db.select().from(posts);
    expect(portal.find((p) => p.title === 'HAPPY HOUR')).toBeTruthy();

    const history = await ok(admin, 'GET', '/api/social/posts?status=posted');
    expect(history[0].id).toBe(draft.id);
  });

  it('serves posted files only with their key', async () => {
    const d = await ok(admin, 'POST', '/api/social/posts', { template: 'news', fields: { headline: 'x' } });
    await ok(admin, 'POST', `/api/social/posts/${d.id}/publish`, { platforms: ['portal'], media: `data:image/png;base64,${PNG.toString('base64')}` });
    const { socialMedia } = await import('../src/db/schema.js');
    const [m] = (await handle.db.select().from(socialMedia)).filter((x) => x.postId === d.id);
    expect((await call('', 'GET', `/api/social/media/${m.id}?k=wrong`)).status).toBe(404);
    const r = await call('', 'GET', `/api/social/media/${m.id}?k=${m.key}`);
    expect(r.status).toBe(200);
    expect(r.raw.equals(PNG)).toBe(true);
  });

  it('records posts shared by hand', async () => {
    const d = await ok(admin, 'POST', '/api/social/posts', { template: 'quote', fields: { headline: 'Who wins?' } });
    const row = await ok(admin, 'POST', `/api/social/posts/${d.id}/mark-posted`, { platforms: ['tiktok', 'whatsapp'] });
    expect(row.status).toBe('posted');
    expect(row.results.map((r: any) => r.platform)).toEqual(['tiktok', 'whatsapp']);
  });
});
