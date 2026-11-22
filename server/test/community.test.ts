/**
 * v0.7 — opponent search, customer chat, rewards (follow us / bonus codes / promo codes in the app), outside game news.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { ensureAdmin } from '../src/bootstrap.js';
import type { Ctx } from '../src/context.js';
import { openDatabase, type DbHandle } from '../src/db/index.js';
import { ManualClock } from '../src/lib/clock.js';
import { Bus } from '../src/realtime/bus.js';
import { cleanText } from '../src/services/chat.js';
import { discoverFeed, mixItems, parseFeed } from '../src/services/newsfeed.js';

let handle: DbHandle;
let app: FastifyInstance;
const clock = new ManualClock(Date.parse('2026-05-04T12:00:00Z'));
const bus = new Bus();
let admin = '';
let fc = '';
const p: Record<string, string> = {};
const t: Record<string, string> = {};

const RSS = `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Play News</title>
<item><title><![CDATA[EA FC 27 &amp; new modes]]></title><link>https://news.example/fc27</link><pubDate>Mon, 04 May 2026 10:00:00 GMT</pubDate>
<description>&lt;p&gt;Big &lt;b&gt;update&lt;/b&gt; today&lt;/p&gt;&lt;img src="https://img.example/fc.jpg"&gt;</description></item>
<item><title>GTA VI date</title><link>https://news.example/gta</link><pubDate>Sun, 03 May 2026 10:00:00 GMT</pubDate>
<media:content url="https://img.example/gta.jpg" medium="image"/><description>Rockstar news</description></item>
</channel></rss>`;
const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Games</title>
<entry><title>PS5 system update</title><link rel="alternate" href="https://atom.example/ps5"/><updated>2026-05-04T11:00:00Z</updated><summary>Faster menus</summary></entry></feed>`;
const PAGE = `<html><head><link rel="alternate" type="application/rss+xml" title="Feed" href="/feed.xml"></head><body>hi</body></html>`;

const fakeFetch: typeof fetch = async (input) => {
  const url = String(input);
  if (url === 'https://news.example/rss') return new Response(RSS, { headers: { 'content-type': 'application/rss+xml' } });
  if (url === 'https://site.example/') return new Response(PAGE, { headers: { 'content-type': 'text/html' } });
  if (url === 'https://site.example/feed.xml') return new Response(ATOM);
  if (url === 'https://down.example/rss') return new Response('nope', { status: 503 });
  throw new TypeError('fetch failed');
};

async function call(token: string, method: string, url: string, payload?: unknown) {
  const res = await app.inject({ method: method as any, url, payload: payload as any, headers: token ? { authorization: `Bearer ${token}` } : {} });
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

beforeAll(async () => {
  handle = await openDatabase({ pgliteDir: null });
  const ctx: Ctx = { db: handle.db, clock, bus, fetch: fakeFetch };
  app = await buildApp(ctx, { jwtSecret: 'test-secret-test-secret-test-secret-123' });
  await ensureAdmin(handle.db, 'admin', 'admin-pass-123');
  admin = (await ok('', 'POST', '/api/auth/login', { username: 'admin', password: 'admin-pass-123' })).token;
  fc = (await ok(admin, 'GET', '/api/games')).find((g: any) => g.name === 'EA SPORTS FC').id;
  for (const [i, n] of ['Ama', 'Kofi', 'Yaw', 'Esi'].entries()) {
    const r = await ok('', 'POST', '/api/portal/signup', { fullName: `${n} Player`, phone: `02500000${i}0`, password: 'secret-pass-1' });
    t[n] = r.token;
    p[n] = (await ok(r.token, 'GET', '/api/portal/me')).id;
  }
  await ok(t.Kofi, 'PATCH', '/api/portal/me', { gamertag: 'KofiKing', psnId: 'kofi_psn_99' });
});

afterAll(async () => {
  await app?.close();
  await handle?.close();
});

describe('find opponents', () => {
  it('searches by gamertag, name and PSN ID and shows level, record, head-to-head and who is at the centre', async () => {
    await ok(admin, 'POST', '/api/matches', { gameId: fc, homeId: p.Ama, awayId: p.Kofi, homeScore: 3, awayScore: 1 });
    await ok(admin, 'POST', '/api/matches', { gameId: fc, homeId: p.Yaw, awayId: p.Kofi, homeScore: 0, awayScore: 2 });

    // Browse: everyone with results in the game (not me).
    let r = await ok(t.Ama, 'GET', `/api/portal/players/search?gameId=${fc}`);
    expect(r.players.map((x: any) => x.player.name).sort()).toEqual(['KofiKing', 'Yaw P.']);
    const kofi = r.players.find((x: any) => x.player.id === p.Kofi);
    expect(kofi).toMatchObject({ played: 2, won: 1, lost: 1, headToHead: { w: 1, d: 0, l: 0 }, atCentre: false, hasPsn: true });
    expect(kofi.player).not.toHaveProperty('psnId');

    // Search by PSN ID part, by name part (players with no results are found too).
    r = await ok(t.Ama, 'GET', `/api/portal/players/search?gameId=${fc}&q=psn_99`);
    expect(r.players.map((x: any) => x.player.id)).toEqual([p.Kofi]);
    r = await ok(t.Ama, 'GET', `/api/portal/players/search?gameId=${fc}&q=esi`);
    expect(r.players).toHaveLength(1);
    expect(r.players[0]).toMatchObject({ played: 0, rating: 1000 });

    // At the centre now.
    const plan = (await ok(admin, 'POST', '/api/pricing-plans', { name: 'Hour', kind: 'time_rate', ratePerHour: 1200 })).id;
    const st = (await ok(admin, 'POST', '/api/stations', { code: 'S1', name: 'PS5 #1', platform: 'ps5' })).id;
    await ok(admin, 'POST', '/api/sessions', { stationId: st, planId: plan, billingType: 'postpaid', customerId: p.Yaw });
    r = await ok(t.Ama, 'GET', `/api/portal/players/search?gameId=${fc}&filter=here`);
    expect(r.players.map((x: any) => x.player.id)).toEqual([p.Yaw]);

    // Looking for a game.
    await ok(t.Esi, 'POST', '/api/portal/matchmaking', { gameId: fc, mode: 'venue', skill: 'any' });
    r = await ok(t.Ama, 'GET', `/api/portal/players/search?gameId=${fc}&filter=looking`);
    expect(r.players.map((x: any) => x.player.id)).toEqual([p.Esi]);
    expect(r.players[0].looking.requestId).toBeTruthy();
  });
});

describe('chat', () => {
  it('lobby, private messages, blocked words, report, delete and mute', async () => {
    expect(cleanText('you are a Fool, fooling', ['fool'])).toBe('you are a ****, fooling');

    const s = await ok(admin, 'GET', '/api/settings');
    await ok(admin, 'PUT', '/api/settings', { ...s, chatBlockedWords: ['idiot'] });

    const m1 = await ok(t.Ama, 'POST', '/api/portal/chat/messages', { to: 'lobby', body: 'Who wants FC tonight?' });
    expect(m1).toMatchObject({ room: 'lobby', mine: true, from: { name: 'Ama P.' } });
    clock.advance(2000);
    await new Promise((r) => setTimeout(r, 1600)); // the 1.5 s per-player gap uses real time
    const m2 = await ok(t.Kofi, 'POST', '/api/portal/chat/messages', { to: 'lobby', body: 'Me, you idiot' });
    expect(m2.body).toBe('Me, you *****');
    // Too fast.
    expect((await call(t.Kofi, 'POST', '/api/portal/chat/messages', { to: 'lobby', body: 'again' })).status).toBe(429);

    let lobby = await ok(t.Ama, 'GET', '/api/portal/chat/messages?to=lobby');
    expect(lobby.messages.map((m: any) => m.body)).toEqual(['Who wants FC tonight?', 'Me, you *****']);
    const after = await ok(t.Ama, 'GET', `/api/portal/chat/messages?to=lobby&after=${m1.number}`);
    expect(after.messages).toHaveLength(1);

    // Private message: only the two players (and staff) see it.
    const dm = await ok(t.Ama, 'POST', '/api/portal/chat/messages', { to: p.Kofi, body: 'Room 4829, pw 11' });
    expect(dm.room.startsWith('dm:')).toBe(true);
    const kofiDm = await ok(t.Kofi, 'GET', `/api/portal/chat/messages?to=${p.Ama}`);
    expect(kofiDm.messages[0].body).toBe('Room 4829, pw 11');
    expect(kofiDm.other.name).toBe('Ama P.');
    const threads = await ok(t.Kofi, 'GET', '/api/portal/chat');
    expect(threads.threads[0]).toMatchObject({ to: p.Ama, name: 'Ama P.', lastText: 'Room 4829, pw 11' });
    expect((await ok(t.Yaw, 'GET', '/api/portal/chat')).threads).toHaveLength(0);
    expect((await call(t.Yaw, 'POST', `/api/portal/chat/messages/${dm.id}/report`)).status).toBe(404);

    // Report → staff see it; delete; mute.
    await ok(t.Ama, 'POST', `/api/portal/chat/messages/${m2.id}/report`);
    const rooms = await ok(admin, 'GET', '/api/chat/rooms');
    expect(rooms[0]).toMatchObject({ room: 'lobby', reported: 1 });
    expect(rooms.some((r: any) => r.room === dm.room)).toBe(true);
    await ok(admin, 'DELETE', `/api/chat/messages/${m2.id}`);
    lobby = await ok(t.Ama, 'GET', '/api/portal/chat/messages?to=lobby');
    expect(lobby.messages[1]).toMatchObject({ deleted: true, body: '' });
    await ok(admin, 'POST', '/api/chat/mute', { customerId: p.Kofi, muted: true });
    await new Promise((r) => setTimeout(r, 1600));
    expect((await call(t.Kofi, 'POST', '/api/portal/chat/messages', { to: 'lobby', body: 'hello?' })).status).toBe(403);
    expect((await ok(t.Kofi, 'GET', '/api/portal/chat/messages?to=lobby')).muted).toBe(true);
    const staffMsg = await ok(admin, 'POST', '/api/chat/messages', { body: 'Tournament at 6pm!' });
    expect(staffMsg.from.staff).toBe(true);

    // Chat switched off.
    await ok(admin, 'PUT', '/api/settings', { ...s, chatEnabled: false });
    expect((await call(t.Ama, 'GET', '/api/portal/chat')).status).toBe(403);
    await ok(admin, 'PUT', '/api/settings', { ...s, chatEnabled: true });
    // Customers can't use staff chat endpoints.
    expect((await call(t.Ama, 'GET', '/api/chat/rooms')).status).toBe(401);
  });
});

describe('rewards', () => {
  it('pays a follow bonus after staff approve, once per customer; bonus codes pay at once; promo codes are listed', async () => {
    expect((await call(admin, 'POST', '/api/rewards', { kind: 'follow', title: 'Subscribe on YouTube', bonusAmount: 500 })).status).toBe(400); // no link
    const yt = await ok(admin, 'POST', '/api/rewards', {
      kind: 'follow', title: 'Subscribe on YouTube', platform: 'youtube', url: 'https://youtube.com/@zenaa', bonusAmount: 500, promoCode: 'SUBSCRIBER10',
    });
    const tk = await ok(admin, 'POST', '/api/rewards', { kind: 'follow', title: 'Follow on TikTok', platform: 'tiktok', url: 'https://tiktok.com/@zenaa', bonusAmount: 200, needsApproval: false });
    const code = await ok(admin, 'POST', '/api/rewards', { kind: 'code', title: 'Live stream bonus', code: 'live500', bonusAmount: 300, maxClaims: 1 });
    expect(code.code).toBe('LIVE500');
    await ok(admin, 'POST', '/api/promo-codes', { code: 'WEEKEND20', percentOff: 20, description: '20% off on weekends', showInPortal: true });
    await ok(admin, 'POST', '/api/promo-codes', { code: 'STAFFONLY', percentOff: 50 });

    let r = await ok(t.Esi, 'GET', '/api/portal/rewards');
    expect(r.follow.map((o: any) => o.title).sort()).toEqual(['Follow on TikTok', 'Subscribe on YouTube']);
    expect(r.follow[0].promoCode).toBeNull();
    expect(r.hasCodes).toBe(true);
    expect(r.promoCodes.map((x: any) => x.code)).toEqual(['WEEKEND20']);

    // Needs approval: pending, no money yet.
    let c = await ok(t.Esi, 'POST', `/api/portal/rewards/${yt.id}/claim`, { handle: '@esi_gh' });
    expect(c.status).toBe('pending');
    expect((await ok(t.Esi, 'GET', '/api/portal/me')).balance).toBe(0);
    expect((await call(t.Esi, 'POST', `/api/portal/rewards/${yt.id}/claim`, { handle: '@esi_gh' })).status).toBe(409);
    const pending = await ok(admin, 'GET', '/api/rewards/claims');
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ handle: '@esi_gh', offer: { title: 'Subscribe on YouTube' } });
    await ok(admin, 'POST', `/api/rewards/claims/${pending[0].id}/approve`);
    expect((await call(admin, 'POST', `/api/rewards/claims/${pending[0].id}/approve`)).status).toBe(409);
    expect((await ok(t.Esi, 'GET', '/api/portal/me')).balance).toBe(500);
    r = await ok(t.Esi, 'GET', '/api/portal/rewards');
    expect(r.follow.find((o: any) => o.id === yt.id)).toMatchObject({ status: 'approved', promoCode: 'SUBSCRIBER10' });

    // No approval needed: paid straight away.
    c = await ok(t.Esi, 'POST', `/api/portal/rewards/${tk.id}/claim`, { handle: '@esi_gh' });
    expect(c.status).toBe('approved');
    expect((await ok(t.Esi, 'GET', '/api/portal/me')).balance).toBe(700);

    // Rejected claim: no money.
    await ok(t.Yaw, 'POST', `/api/portal/rewards/${yt.id}/claim`, { handle: 'yaw' });
    const yawClaim = (await ok(admin, 'GET', '/api/rewards/claims')).find((x: any) => x.handle === 'yaw');
    await ok(admin, 'POST', `/api/rewards/claims/${yawClaim.id}/reject`, { note: 'Not found on YouTube' });
    expect((await ok(t.Yaw, 'GET', '/api/portal/me')).balance).toBe(0);
    expect((await ok(t.Yaw, 'GET', '/api/portal/rewards')).follow.find((o: any) => o.id === yt.id)).toMatchObject({ status: 'rejected', note: 'Not found on YouTube' });

    // Bonus code: once, limited to 1 customer; promo codes get a helpful answer; wrong codes fail.
    const red = await ok(t.Ama, 'POST', '/api/portal/rewards/code', { code: ' live500 ' });
    expect(red).toMatchObject({ bonusAmount: 300 });
    expect((await ok(t.Ama, 'GET', '/api/portal/me')).balance).toBe(300);
    expect((await call(t.Ama, 'POST', '/api/portal/rewards/code', { code: 'LIVE500' })).status).toBe(400); // ended (limit reached)
    expect((await call(t.Kofi, 'POST', '/api/portal/rewards/code', { code: 'LIVE500' })).status).toBe(400);
    const promo = await call(t.Kofi, 'POST', '/api/portal/rewards/code', { code: 'weekend20' });
    expect(promo.body.message).toMatch(/promo code/);
    expect((await call(t.Kofi, 'POST', '/api/portal/rewards/code', { code: 'NOPE' })).status).toBe(400);

    // Wallet ledger shows the bonus.
    const cust = await ok(admin, 'GET', `/api/customers/${p.Esi}`);
    expect(cust.balance).toBe(700);

    // Offers with paid claims are switched off, not deleted.
    expect((await ok(admin, 'DELETE', `/api/rewards/${yt.id}`)).deactivated).toBe(true);
    expect((await ok(t.Kofi, 'GET', '/api/portal/rewards')).follow.map((o: any) => o.id)).toEqual([tk.id]);
  });
});

describe('outside game news', () => {
  it('parses RSS and Atom, finds a site’s feed, and mixes stories into the portal news', async () => {
    const rss = parseFeed(RSS, 'https://news.example/rss')!;
    expect(rss.title).toBe('Play News');
    expect(rss.items[0]).toMatchObject({ title: 'EA FC 27 & new modes', url: 'https://news.example/fc27', summary: 'Big update today', imageUrl: 'https://img.example/fc.jpg', source: 'Play News' });
    expect(rss.items[1].imageUrl).toBe('https://img.example/gta.jpg');
    const atom = parseFeed(ATOM, 'https://site.example/feed.xml', 'AtomG')!;
    expect(atom.items[0]).toMatchObject({ title: 'PS5 system update', url: 'https://atom.example/ps5', source: 'AtomG' });
    expect(parseFeed(PAGE, 'https://site.example/')).toBeNull();
    expect(discoverFeed(PAGE, 'https://site.example/')).toBe('https://site.example/feed.xml');
    expect(mixItems([rss.items, atom.items]).map((i) => i.title)).toEqual(['PS5 system update', 'EA FC 27 & new modes', 'GTA VI date']);

    // Test button: a web page address finds its feed.
    const tst = await ok(admin, 'POST', '/api/news-feeds/test', { url: 'https://site.example/' });
    expect(tst).toMatchObject({ ok: true, feedUrl: 'https://site.example/feed.xml', count: 1 });
    expect((await ok(admin, 'POST', '/api/news-feeds/test', { url: 'https://down.example/rss' })).ok).toBe(false);

    const s = await ok(admin, 'GET', '/api/settings');
    await ok(admin, 'PUT', '/api/settings', {
      ...s,
      newsFeeds: [
        { url: 'https://news.example/rss', name: '' },
        { url: 'https://site.example/', name: 'Atom Games' },
        { url: 'https://down.example/rss', name: 'Down' },
      ],
      newsFeedCount: 2,
    });
    const ref = await ok(admin, 'POST', '/api/news-feeds/refresh');
    expect(ref.status.map((x: any) => x.ok)).toEqual([true, true, false]);
    const news = await ok('', 'GET', '/api/public/news');
    expect(news.outsideShow).toBe(2);
    expect(news.outside.map((i: any) => i.source)).toEqual(['Atom Games', 'Play News', 'Play News']);
    await ok(admin, 'PUT', '/api/settings', { ...s, newsFeedCount: 0 });
    expect((await ok('', 'GET', '/api/public/news')).outside).toEqual([]);
  });
});
