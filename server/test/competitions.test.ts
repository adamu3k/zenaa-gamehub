/**
 * v0.4 — station delete, leaderboards, tournaments, Find match, station screen apps, new plug drivers, eWeLink import.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { ensureAdmin } from '../src/bootstrap.js';
import { computeStats, eloDelta, firstRound, rankPlayers, roundRobin, seedOrder, snakeGroups, standings } from '../src/competitions/engine.js';
import type { Ctx } from '../src/context.js';
import { openDatabase, type DbHandle } from '../src/db/index.js';
import { ManualClock } from '../src/lib/clock.js';
import { Bus } from '../src/realtime/bus.js';
import { ewelinkEncrypt } from '../src/services/power.js';

let handle: DbHandle;
let app: FastifyInstance;
const clock = new ManualClock(Date.parse('2026-03-02T12:00:00Z'));
const bus = new Bus();
let admin = '';

type Call = { url: string; method: string; body: any; headers: Record<string, string> };
const calls: Call[] = [];
const devices = new Map<string, boolean>();
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  const method = init?.method ?? 'GET';
  const headers = (init?.headers ?? {}) as Record<string, string>;
  let body: any;
  try {
    body = init?.body ? JSON.parse(String(init.body)) : undefined;
  } catch {
    body = String(init?.body);
  }
  calls.push({ url, method, body, headers });
  // eWeLink cloud
  if (url.startsWith('https://eu-apia.coolkit.cc')) {
    if (url.endsWith('/v2/user/login')) {
      if (body.password !== 'right-pass') return json(200, { error: 10014, msg: 'wrong password' });
      return json(200, { error: 0, data: { at: 'AT1', rt: 'RT1', region: 'eu' } });
    }
    if (url.endsWith('/v2/user/oauth/token')) {
      if (body.code !== 'good-code' || !String(headers.authorization ?? '').startsWith('Sign ')) return json(200, { error: 405, msg: 'invalid code' });
      return json(200, { error: 0, data: { accessToken: 'AT1', refreshToken: 'RT1', atExpiredTime: 0, rtExpiredTime: 0 } });
    }
    if (url.includes('/v2/device/thing?')) {
      return json(200, {
        error: 0,
        data: { thingList: [{ itemData: { deviceid: '1000aaaa01', devicekey: 'key-one', name: 'TV plug 1', productModel: 'BASICR4', online: true, params: { switch: 'off' } } }] },
      });
    }
    if (url.includes('/v2/device/thing/status')) {
      if (method === 'POST') {
        devices.set('cloud:' + body.id, body.params.switch === 'on');
        return json(200, { error: 0, data: {} });
      }
      return json(200, { error: 0, data: { params: { switch: devices.get('cloud:1000aaaa01') ? 'on' : 'off' } } });
    }
  }
  // Home Assistant
  if (url.startsWith('http://10.0.0.5:8123')) {
    if (headers.authorization !== 'Bearer ha-token') return json(401, { message: 'unauthorized' });
    if (url.includes('/api/services/homeassistant/turn_on')) return (devices.set('ha', true), json(200, []));
    if (url.includes('/api/services/homeassistant/turn_off')) return (devices.set('ha', false), json(200, []));
    if (url.includes('/api/states/switch.tv_plug')) return json(200, { state: devices.get('ha') ? 'on' : 'off' });
  }
  // Custom HTTP relay (e.g. a DIY ESP8266 board)
  if (url.startsWith('http://10.0.0.9/')) {
    if (url.endsWith('/relay/on')) return (devices.set('diy', true), new Response('OK'));
    if (url.endsWith('/relay/off')) return (devices.set('diy', false), new Response('OK'));
    if (url.endsWith('/relay/status')) return new Response(devices.get('diy') ? 'relay=1' : 'relay=0');
  }
  // eWeLink LAN device at .40 with key-one
  if (url.startsWith('http://192.168.9.40:8081/zeroconf/')) {
    if (!body?.encrypt) return json(200, { seq: 1, error: 400 });
    if (body.deviceid !== '1000aaaa01') return json(200, { seq: 1, error: 404 });
    const enc = ewelinkEncrypt('key-one', { switches: [{ switch: 'off', outlet: 0 }] });
    return json(200, { seq: 1, error: 0, encrypt: true, ...enc });
  }
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

let fc = '';
let mk = '';
const p: Record<string, string> = {};
const tokens: Record<string, string> = {};

beforeAll(async () => {
  handle = await openDatabase({ pgliteDir: null });
  const ctx: Ctx = { db: handle.db, clock, bus, fetch: fakeFetch };
  app = await buildApp(ctx, { jwtSecret: 'test-secret-test-secret-test-secret-123' });
  await ensureAdmin(handle.db, 'admin', 'admin-pass-123');
  admin = (await ok('', 'POST', '/api/auth/login', { username: 'admin', password: 'admin-pass-123' })).token;
  const games = await ok(admin, 'GET', '/api/games');
  fc = games.find((g: any) => g.name === 'EA SPORTS FC').id;
  mk = games.find((g: any) => g.name === 'Mortal Kombat').id;
  for (const [i, n] of ['Ama', 'Kofi', 'Yaw', 'Esi', 'Kwame', 'Abena', 'Kojo', 'Akua'].entries()) {
    const r = await ok('', 'POST', '/api/portal/signup', { fullName: `${n} Player`, phone: `02400000${String(i).padStart(2, '0')}`, password: 'secret-pass-1' });
    tokens[n] = r.token;
    p[n] = (await ok(r.token, 'GET', '/api/portal/me')).id;
  }
});

afterAll(async () => {
  await app?.close();
  await handle?.close();
});

describe('engine', () => {
  it('builds fair round-robin fixtures, balanced groups and seeded brackets', () => {
    const rr = roundRobin(['a', 'b', 'c', 'd', 'e']);
    expect(rr).toHaveLength(10);
    const pairs = new Set(rr.map((f) => [f.homeId, f.awayId].sort().join('')));
    expect(pairs.size).toBe(10);
    expect(roundRobin(['a', 'b', 'c', 'd'], true)).toHaveLength(12);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(firstRound(['s1', 's2', 's3', 's4', 's5'])).toEqual([
      ['s1', null],
      ['s4', 's5'],
      ['s2', null],
      ['s3', null],
    ]);
    const g = snakeGroups(['1', '2', '3', '4', '5', '6', '7', '8'], 2);
    expect(g.get('A')).toEqual(['1', '4', '5', '8']);
    expect(g.get('B')).toEqual(['2', '3', '6', '7']);
  });

  it('rates bigger wins higher and ranks provisional players last', () => {
    expect(eloDelta(1000, 1000, 1, 0)).toBe(16);
    expect(eloDelta(1000, 1000, 5, 0)).toBeGreaterThan(16);
    expect(eloDelta(1000, 1000, 2, 2)).toBe(0);
    const d = new Date('2026-01-01');
    const stats = computeStats([
      { id: '1', homeId: 'x', awayId: 'y', homeScore: 3, awayScore: 0, winnerId: 'x', playedAt: d },
      { id: '2', homeId: 'x', awayId: 'y', homeScore: 1, awayScore: 1, winnerId: null, playedAt: d },
      { id: '3', homeId: 'y', awayId: 'x', homeScore: 0, awayScore: 2, winnerId: 'x', playedAt: d },
      { id: '4', homeId: 'z', awayId: 'x', homeScore: 1, awayScore: 0, winnerId: 'z', playedAt: d },
    ]);
    const x = stats.get('x')!;
    expect([x.won, x.drawn, x.lost, x.gf, x.ga, x.points]).toEqual([2, 1, 1, 6, 2, 7]);
    expect(x.form).toEqual(['W', 'D', 'W', 'L']);
    expect(x.streak).toEqual({ type: 'L', count: 1 });
    const ranked = rankPlayers([...stats.values()]);
    expect(ranked[0].customerId).toBe('x');
    expect(ranked.at(-1)!.provisional).toBe(true);
    const table = standings(['a', 'b', 'c'], [
      { homeId: 'a', awayId: 'b', homeScore: 1, awayScore: 0 },
      { homeId: 'b', awayId: 'c', homeScore: 2, awayScore: 0 },
      { homeId: 'c', awayId: 'a', homeScore: 1, awayScore: 1 },
    ]);
    expect(table.map((r) => r.customerId)).toEqual(['a', 'b', 'c']);
  });
});

describe('stations', () => {
  it('deletes an unused station and hides one with history', async () => {
    const plan = (await ok(admin, 'POST', '/api/pricing-plans', { name: 'Std', kind: 'time_rate', ratePerHour: 1200 })).id;
    const unused = (await ok(admin, 'POST', '/api/stations', { code: 'DEL1', name: 'Unused', platform: 'ps5' })).id;
    expect((await ok(admin, 'DELETE', `/api/stations/${unused}`)).removed).toBe('deleted');
    const used = (await ok(admin, 'POST', '/api/stations', { code: 'DEL2', name: 'Used', platform: 'ps5' })).id;
    const s = await ok(admin, 'POST', '/api/sessions', { stationId: used, planId: plan, billingType: 'postpaid' });
    expect((await call(admin, 'DELETE', `/api/stations/${used}`)).status).toBe(409);
    clock.advance(10 * 60_000);
    await ok(admin, 'POST', `/api/sessions/${s.id}/end`, { paymentMethod: 'cash' });
    expect((await ok(admin, 'DELETE', `/api/stations/${used}`)).removed).toBe('hidden');
    const list = await ok(admin, 'GET', '/api/stations');
    expect(list.stations.some((x: any) => x.id === used)).toBe(false);
    // The code is free again, and history still shows the old session.
    await ok(admin, 'POST', '/api/stations', { code: 'DEL2', name: 'New one', platform: 'ps5' });
    expect((await ok(admin, 'GET', `/api/sessions/${s.id}`)).id ?? s.id).toBe(s.id);
    expect((await call(admin, 'DELETE', `/api/stations/${used}`)).status).toBe(404);
  });
});

describe('leaderboard & friendlies', () => {
  it('records friendlies and ranks players; hidden players stay off the public board', async () => {
    await ok(admin, 'POST', '/api/matches', { gameId: fc, homeId: p.Ama, awayId: p.Kofi, homeScore: 3, awayScore: 1 });
    clock.advance(60_000);
    await ok(admin, 'POST', '/api/matches', { gameId: fc, homeId: p.Kofi, awayId: p.Ama, homeScore: 0, awayScore: 2 });
    clock.advance(60_000);
    await ok(admin, 'POST', '/api/matches', { gameId: fc, homeId: p.Ama, awayId: p.Yaw, homeScore: 1, awayScore: 1 });
    clock.advance(60_000);
    await ok(admin, 'POST', '/api/matches', { gameId: fc, homeId: p.Yaw, awayId: p.Kofi, homeScore: 4, awayScore: 0 });
    // Fighting games have no draws.
    expect((await call(admin, 'POST', '/api/matches', { gameId: mk, homeId: p.Ama, awayId: p.Kofi, homeScore: 2, awayScore: 2 })).status).toBe(400);
    expect((await call(admin, 'POST', '/api/matches', { gameId: fc, homeId: p.Ama, awayId: p.Ama, homeScore: 1, awayScore: 0 })).status).toBe(400);

    const board = await ok(admin, 'GET', `/api/leaderboard?gameId=${fc}`);
    expect(board.rows[0].player.id).toBe(p.Ama);
    expect(board.rows[0].won).toBe(2);
    expect(board.rows[0].form).toEqual(['W', 'W', 'D']);
    expect(board.totals.matches).toBe(4);
    expect(board.highlights.biggestWin.score).toBe('4–0');

    await ok(tokens.Ama, 'PATCH', '/api/portal/me', { gamertag: 'AmaTheGoat', leaderboardHidden: false });
    expect((await call(tokens.Kofi, 'PATCH', '/api/portal/me', { gamertag: 'amathegoat' })).status).toBe(409);
    await ok(tokens.Kofi, 'PATCH', '/api/portal/me', { leaderboardHidden: true });
    const pub = await ok('', 'GET', `/api/public/leaderboard?gameId=${fc}`);
    expect(pub.rows[0].name).toBe('AmaTheGoat');
    expect(pub.rows[0].player.fullName).toBeUndefined();
    expect(pub.rows.some((r: any) => r.player.id === p.Kofi)).toBe(false);
    const mine = await ok(tokens.Kofi, 'GET', `/api/portal/competitions/leaderboard?gameId=${fc}`);
    expect(mine.me.player.id).toBe(p.Kofi);
    await ok(tokens.Kofi, 'PATCH', '/api/portal/me', { leaderboardHidden: false });

    const h2h = await ok(admin, 'GET', `/api/head-to-head?gameId=${fc}&a=${p.Ama}&b=${p.Kofi}`);
    expect([h2h.played, h2h.aWins, h2h.bWins, h2h.aGoals, h2h.bGoals]).toEqual([2, 2, 0, 5, 1]);
  });
});

describe('tournaments', () => {
  it('runs a 5-player knockout with byes, a third-place match and prizes', async () => {
    const t = await ok(admin, 'POST', '/api/tournaments', {
      name: 'Friday Night Cup',
      gameId: fc,
      format: 'knockout',
      maxPlayers: 8,
      thirdPlaceMatch: true,
      entryFee: 2000,
      prizes: [
        { place: 1, amount: 50000 },
        { place: 2, amount: 20000 },
        { place: 3, amount: 5000 },
      ],
    });
    await ok(admin, 'POST', `/api/tournaments/${t.id}/status`, { status: 'registration' });
    // Players register themselves in the portal.
    for (const n of ['Ama', 'Kofi', 'Yaw', 'Esi']) await ok(tokens[n], 'POST', `/api/portal/tournaments/${t.id}/register`);
    expect((await call(tokens.Ama, 'POST', `/api/portal/tournaments/${t.id}/register`)).status).toBe(409);
    // Staff add a walk-in who has no account yet.
    const walkIn = await ok(admin, 'POST', `/api/tournaments/${t.id}/entries`, { newPlayer: { fullName: 'Walk In', gamertag: 'Walky' } });
    let d = await ok(admin, 'GET', `/api/tournaments/${t.id}`);
    expect(d.entries).toHaveLength(5);
    // Entry fee from the wallet fails without money.
    expect((await call(admin, 'PATCH', `/api/tournaments/${t.id}/entries/${d.entries[0].id}`, { chargeWallet: true })).status).toBe(409);
    await ok(admin, 'PATCH', `/api/tournaments/${t.id}/entries/${d.entries[0].id}`, { paid: true, paidNote: 'Cash' });

    d = await ok(admin, 'POST', `/api/tournaments/${t.id}/start`, {});
    expect(d.tournament.status).toBe('live');
    expect(d.bracket.rounds.map((r: any) => r.name)).toEqual(['Quarter-finals', 'Semi-finals', 'Final']);
    expect(d.bracket.rounds[0].matches.filter((m: any) => m.walkover)).toHaveLength(3);
    expect(d.progress.total).toBe(5); // 1 real QF + 2 SF + final + third place (byes don't count)
    expect(d.bracket.thirdPlace).toBeTruthy();
    expect((await call(tokens.Esi, 'POST', `/api/portal/tournaments/${t.id}/withdraw`)).status).toBe(409);

    const play = async (m: any, hs: number, as: number, pens?: [number, number]) =>
      ok(admin, 'PUT', `/api/matches/${m.id}/result`, { homeScore: hs, awayScore: as, ...(pens ? { homePens: pens[0], awayPens: pens[1] } : {}) });
    const qf = d.bracket.rounds[0].matches.find((m: any) => !m.walkover);
    // Knockout draws need penalties.
    expect((await call(admin, 'PUT', `/api/matches/${qf.id}/result`, { homeScore: 1, awayScore: 1 })).status).toBe(400);
    await play(qf, 1, 1, [5, 4]);
    d = await ok(admin, 'GET', `/api/tournaments/${t.id}`);
    const [sf1, sf2] = d.bracket.rounds[1].matches;
    expect(sf1.home && sf1.away && sf2.home && sf2.away).toBeTruthy();
    await play(sf1, 2, 0);
    await play(sf2, 0, 3);
    d = await ok(admin, 'GET', `/api/tournaments/${t.id}`);
    // Correcting a semi is still allowed until the final / 3rd place match is played.
    await play(d.bracket.rounds[1].matches[0], 3, 0);
    const final = d.bracket.rounds[2].matches[0];
    await play(d.bracket.thirdPlace, 2, 1);
    expect((await call(admin, 'PUT', `/api/matches/${sf1.id}/result`, { homeScore: 0, awayScore: 1 })).status).toBe(409);
    await play(final, 4, 2);
    d = await ok(admin, 'GET', `/api/tournaments/${t.id}`);
    expect(d.tournament.status).toBe('completed');
    expect(d.champion.id).toBe(final.home.id);
    const places = Object.fromEntries(d.entries.map((e: any) => [e.player.id, e.finalPlace]));
    expect(places[final.home.id]).toBe(1);
    expect(places[final.away.id]).toBe(2);
    expect(Object.values(places).filter((x) => x === 3)).toHaveLength(1);
    expect(Object.values(places).filter((x) => x === 4)).toHaveLength(1);
    expect(d.topScorers[0].goals).toBeGreaterThan(0);
    expect((await call(admin, 'PUT', `/api/matches/${final.id}/result`, { homeScore: 0, awayScore: 1 })).status).toBe(409);

    // Prize into the champion's wallet.
    const champ = d.entries.find((e: any) => e.finalPlace === 1);
    expect(champ.prizeAmount).toBe(50000);
    await ok(admin, 'POST', `/api/tournaments/${t.id}/entries/${champ.id}/prize`, { method: 'wallet' });
    expect((await call(admin, 'POST', `/api/tournaments/${t.id}/entries/${champ.id}/prize`, { method: 'cash' })).status).toBe(409);
    const cust = await ok(admin, 'GET', `/api/customers/${champ.customerId}`);
    expect(cust.balance).toBe(50000);
    // Titles show on the leaderboard; the public list has the champion.
    const board = await ok(admin, 'GET', `/api/leaderboard?gameId=${fc}`);
    expect(board.rows.find((r: any) => r.player.id === champ.customerId).titles).toBe(1);
    const pubList = await ok('', 'GET', '/api/public/tournaments');
    expect(pubList[0].champion.id).toBe(champ.customerId);
    expect(walkIn.customerId).toBeTruthy();
  });

  it('runs groups then a knockout drawn from the group tables', async () => {
    const t = await ok(admin, 'POST', '/api/tournaments', { name: 'Division Cup', gameId: fc, format: 'groups_knockout', groupCount: 2, advancePerGroup: 2, maxPlayers: 8 });
    for (const n of Object.keys(p)) await ok(admin, 'POST', `/api/tournaments/${t.id}/entries`, { customerId: p[n] });
    expect((await call(admin, 'POST', `/api/tournaments/${t.id}/entries`, { customerId: p.Ama })).status).toBe(409);
    let d = await ok(admin, 'POST', `/api/tournaments/${t.id}/start`, { shuffle: true });
    expect(d.groups).toHaveLength(2);
    expect(d.groups[0].table).toHaveLength(4);
    expect(d.progress.total).toBe(12);
    // Home player always wins 2–0.
    for (const r of d.rounds) for (const m of r.matches) await ok(admin, 'PUT', `/api/matches/${m.id}/result`, { homeScore: 2, awayScore: 0 });
    d = await ok(admin, 'GET', `/api/tournaments/${t.id}`);
    expect(d.bracket.rounds.map((r: any) => r.name)).toEqual(['Semi-finals', 'Final']);
    const semis = d.bracket.rounds[0].matches;
    const a1 = d.groups[0].table[0].player.id;
    const b2 = d.groups[1].table[1].player.id;
    expect([semis[0].home.id, semis[0].away.id]).toEqual([a1, b2]);
    expect(d.entries.filter((e: any) => e.status === 'eliminated')).toHaveLength(4);
    // Group results are locked once the knockout is drawn.
    expect((await call(admin, 'PUT', `/api/matches/${d.rounds[0].matches[0].id}/result`, { homeScore: 0, awayScore: 0 })).status).toBe(409);
  });

  it('finishes a league when the last match is played', async () => {
    const t = await ok(admin, 'POST', '/api/tournaments', { name: 'MK League', gameId: mk, format: 'league', maxPlayers: 3, prizes: [{ place: 1, amount: 1000 }] });
    for (const n of ['Ama', 'Kofi', 'Yaw']) await ok(admin, 'POST', `/api/tournaments/${t.id}/entries`, { customerId: p[n] });
    expect((await call(admin, 'POST', `/api/tournaments/${t.id}/entries`, { customerId: p.Esi })).status).toBe(409);
    let d = await ok(admin, 'POST', `/api/tournaments/${t.id}/start`, {});
    const ms = d.rounds.flatMap((r: any) => r.matches);
    expect(ms).toHaveLength(3);
    for (const m of ms) await ok(admin, 'PUT', `/api/matches/${m.id}/result`, m.home.id === p.Yaw || m.away.id === p.Yaw ? (m.home.id === p.Yaw ? { homeScore: 3, awayScore: 1 } : { homeScore: 1, awayScore: 3 }) : { homeScore: 3, awayScore: 2 });
    d = await ok(admin, 'GET', `/api/tournaments/${t.id}`);
    expect(d.tournament.status).toBe('completed');
    expect(d.champion.id).toBe(p.Yaw);
    expect(d.entries.find((e: any) => e.player.id === p.Yaw).prizeAmount).toBe(1000);
  });
});

describe('find match', () => {
  it('matches two players, needs the opponent to confirm the score, and sends disputes to staff', async () => {
    const req = await ok(tokens.Esi, 'POST', '/api/portal/matchmaking', { gameId: fc, mode: 'online', note: 'Tonight 8pm' });
    await ok(tokens.Esi, 'PATCH', '/api/portal/me', { psnId: 'Esi_PSN' });
    await ok(tokens.Kojo, 'PATCH', '/api/portal/me', { psnId: 'Kojo_PSN' });
    const list = await ok(tokens.Kojo, 'GET', `/api/portal/matchmaking?gameId=${fc}`);
    const r = list.open.find((x: any) => x.id === req.id);
    expect(r.canAccept).toBe(true);
    expect(r.contact).toBeNull();
    expect((await call(tokens.Esi, 'POST', `/api/portal/matchmaking/${req.id}/accept`)).status).toBe(400);
    const m = await ok(tokens.Kojo, 'POST', `/api/portal/matchmaking/${req.id}/accept`);
    expect((await call(tokens.Akua, 'POST', `/api/portal/matchmaking/${req.id}/accept`)).status).toBe(409);
    const after = await ok(tokens.Kojo, 'GET', '/api/portal/matchmaking');
    expect(after.history[0].contact.psnId).toBe('Esi_PSN');
    // Reporter cannot confirm their own score; an outsider cannot see the match.
    await ok(tokens.Esi, 'POST', `/api/portal/matches/${m.id}/report`, { myScore: 3, opponentScore: 1 });
    expect((await call(tokens.Esi, 'POST', `/api/portal/matches/${m.id}/confirm`)).status).toBe(400);
    expect((await call(tokens.Akua, 'POST', `/api/portal/matches/${m.id}/confirm`)).status).toBe(404);
    const before = (await ok(admin, 'GET', `/api/leaderboard?gameId=${fc}`)).totals.matches;
    await ok(tokens.Kojo, 'POST', `/api/portal/matches/${m.id}/confirm`);
    expect((await ok(admin, 'GET', `/api/leaderboard?gameId=${fc}`)).totals.matches).toBe(before + 1);

    // Direct challenge, then a disputed score.
    const ch = await ok(tokens.Akua, 'POST', '/api/portal/matchmaking', { gameId: fc, targetCustomerId: p.Abena });
    expect((await ok(tokens.Kojo, 'GET', '/api/portal/matchmaking')).open.some((x: any) => x.id === ch.id)).toBe(false);
    const m2 = await ok(tokens.Abena, 'POST', `/api/portal/matchmaking/${ch.id}/accept`);
    await ok(tokens.Abena, 'POST', `/api/portal/matches/${m2.id}/report`, { myScore: 5, opponentScore: 0 });
    await ok(tokens.Akua, 'POST', `/api/portal/matches/${m2.id}/dispute`);
    const open = await ok(tokens.Akua, 'GET', `/api/portal/competitions/me?gameId=${fc}`);
    expect(open.openMatches.find((x: any) => x.id === m2.id).status).toBe('scheduled');
    // Staff settle it.
    await ok(admin, 'PUT', `/api/matches/${m2.id}/result`, { homeScore: 1, awayScore: 2 });
    expect((await call(tokens.Akua, 'POST', `/api/portal/matches/${m2.id}/report`, { myScore: 9, opponentScore: 0 })).status).toBe(409);
    // Limit of 3 open requests.
    for (let i = 0; i < 3; i++) await ok(tokens.Yaw, 'POST', '/api/portal/matchmaking', { gameId: fc });
    expect((await call(tokens.Yaw, 'POST', '/api/portal/matchmaking', { gameId: fc })).status).toBe(409);
    // Requests expire after 24 h.
    clock.advance(25 * 3_600_000);
    expect((await ok(tokens.Kojo, 'GET', '/api/portal/matchmaking')).open.filter((x: any) => x.player.id === p.Yaw)).toHaveLength(0);
  });
});

describe('station screen apps', () => {
  it('pairs a screen with a code, reports the session state and can be unpaired', async () => {
    const st = await ok(admin, 'POST', '/api/stations', { code: 'TV1', name: 'TV Station', platform: 'ps5' });
    const { code } = await ok(admin, 'POST', `/api/stations/${st.id}/agent-code`);
    expect((await call('', 'POST', '/api/agent/pair', { code: code === '000000' ? '000001' : '000000' })).status).toBe(400);
    const pair = await ok('', 'POST', '/api/agent/pair', { code, kind: 'android_tv', name: 'Living room TV' });
    expect((await call('', 'POST', '/api/agent/pair', { code })).status).toBe(400); // single use
    let s = await ok(pair.token, 'GET', '/api/agent/state');
    expect(s.phase).toBe('idle');
    expect(s.lock).toBe(true);
    // Agent tokens never reach staff endpoints.
    expect((await call(pair.token, 'GET', '/api/stations')).status).toBe(401);
    expect((await call(pair.token, 'GET', '/api/portal/me')).status).toBe(401);
    const plan = (await ok(admin, 'POST', '/api/pricing-plans', { name: 'Hour', kind: 'time_rate', ratePerHour: 1200 })).id;
    const sess = await ok(admin, 'POST', '/api/sessions', { stationId: st.id, planId: plan, billingType: 'prepaid', minutes: 30, paymentMethod: 'cash', customerId: p.Ama });
    s = await ok(pair.token, 'GET', '/api/agent/state');
    expect(s.phase).toBe('running');
    expect(s.lock).toBe(false);
    expect(s.session.remainingSeconds).toBe(1800);
    expect(s.session.playerName).toBe('Ama');
    clock.advance(26 * 60_000);
    expect((await ok(pair.token, 'GET', '/api/agent/state')).phase).toBe('warning');
    await ok(admin, 'POST', `/api/stations/${st.id}/agent-message`, { text: 'Top up at the counter' });
    expect((await ok(pair.token, 'GET', '/api/agent/state')).message.text).toBe('Top up at the counter');
    const live = await ok(admin, 'GET', '/api/stations');
    expect(live.stations.find((x: any) => x.id === st.id).agentOnline).toBe(true);
    await ok(admin, 'POST', `/api/sessions/${sess.id}/end`, {});
    await ok(admin, 'DELETE', `/api/stations/${st.id}/agent`);
    expect((await call(pair.token, 'GET', '/api/agent/state')).status).toBe(401);
  });

  it('sends the PS4/PS5 payload with the station token inside, and serves the plain-text console state', async () => {
    const net = await import('node:net');
    const st = await ok(admin, 'POST', '/api/stations', { code: 'PS9', name: 'Console 9', platform: 'ps5' });
    // A fake ELF loader: receives whatever is sent until the socket closes.
    const received: Buffer[] = [];
    const loader = net.createServer((s) => {
      const chunks: Buffer[] = [];
      s.on('data', (c) => chunks.push(c));
      s.on('end', () => received.push(Buffer.concat(chunks)));
    });
    await new Promise<void>((r) => loader.listen(0, '127.0.0.1', () => r()));
    const port = (loader.address() as import('node:net').AddressInfo).port;

    // localhost is refused as the server address (the console could never reach it).
    const bad = await call(admin, 'POST', `/api/stations/${st.id}/console-push`, { platform: 'ps5', host: '127.0.0.1', port, serverUrl: 'http://localhost:8080' });
    expect(bad.status).toBe(400);

    const r = await ok(admin, 'POST', `/api/stations/${st.id}/console-push`, { platform: 'ps5', host: '127.0.0.1', port, serverUrl: 'http://192.168.1.10:8080' });
    expect(r.ok).toBe(true);
    await new Promise((res) => setTimeout(res, 50));
    loader.close();
    const elf = received[0];
    expect(elf.subarray(0, 4).toString('latin1')).toBe('\x7fELF');
    const at = elf.indexOf('@@ZENAA_CONFIG_V1@@');
    const cfg = elf.subarray(at, at + 1024).toString('utf8').replace(/\0+$/, '');
    expect(cfg).toContain('url=http://192.168.1.10:8080\n');
    const token = /token=(\S+)/.exec(cfg)![1];

    // The token inside the payload works as a station-screen token.
    const text = (await call(token, 'GET', '/api/agent/console')).body as string;
    expect(text).toContain('phase=idle\n');
    expect(text).toContain('station=PS9\n');
    expect(text).toContain('remaining=-1\n');
    const state = await ok(token, 'GET', '/api/agent/state');
    expect(state.dock.style).toBe('island');
    expect(state.dock.weather).toBeNull(); // never calls the internet in tests
    const live = await ok(admin, 'GET', '/api/stations');
    expect(live.stations.find((x: any) => x.id === st.id).agentInfo.kind).toBe('ps5');

    // Unreachable console → clear error.
    const closed = await call(admin, 'POST', `/api/stations/${st.id}/console-push`, { platform: 'ps4', host: '127.0.0.1', port, serverUrl: 'http://192.168.1.10:8080' });
    expect(closed.status).toBe(502);
    expect(closed.body.message).toContain('ELF loader');

    // Download variant + unpair revokes the payload token too.
    const dl = await app.inject({ method: 'GET', url: `/api/stations/${st.id}/console-payload?platform=ps4&serverUrl=http://192.168.1.10:8080`, headers: { authorization: `Bearer ${admin}` } });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-disposition']).toContain('zenaa-ps9-ps4.elf');
    await ok(admin, 'DELETE', `/api/stations/${st.id}/agent`);
    expect((await call(token, 'GET', '/api/agent/console')).status).toBe(401);
  });
});

describe('more smart-plug drivers', () => {
  it('drives Home Assistant, a custom HTTP relay and validates what each needs', async () => {
    const ha = await ok(admin, 'POST', '/api/power/test', { driver: 'home_assistant', config: { host: '10.0.0.5', entityId: 'switch.tv_plug', token: 'ha-token' }, action: 'on' });
    expect(ha).toEqual({ ok: true, state: 'on' });
    const bad = await ok(admin, 'POST', '/api/power/test', { driver: 'home_assistant', config: { host: '10.0.0.5', entityId: 'switch.tv_plug' } });
    expect(bad.error).toContain('token');
    const diyCfg = { onUrl: 'http://10.0.0.9/relay/on', offUrl: 'http://10.0.0.9/relay/off', statusUrl: 'http://10.0.0.9/relay/status', statusOnMatch: 'relay=1' };
    expect(await ok(admin, 'POST', '/api/power/test', { driver: 'generic_http', config: diyCfg, action: 'on' })).toEqual({ ok: true, state: 'on' });
    expect(await ok(admin, 'POST', '/api/power/test', { driver: 'generic_http', config: diyCfg, action: 'off' })).toEqual({ ok: true, state: 'off' });
    const st = await ok(admin, 'POST', '/api/stations', { code: 'HA1', name: 'HA station', platform: 'ps5', powerDriver: 'home_assistant', powerConfig: { host: '10.0.0.5', entityId: 'switch.tv_plug', token: 'ha-token' } });
    expect(st.powerConfig.token).toBeUndefined();
    expect(st.powerConfig.hasToken).toBe(true);
    // Editing without re-typing the token keeps it.
    const ed = await ok(admin, 'PATCH', `/api/stations/${st.id}`, { powerConfig: { host: '10.0.0.5', entityId: 'switch.tv_plug' } });
    expect(ed.powerConfig.hasToken).toBe(true);
    expect((await call(admin, 'POST', '/api/stations', { code: 'BAD', name: 'Bad', platform: 'ps5', powerDriver: 'generic_http', powerConfig: { onUrl: 'http://x/on' } })).status).toBe(400);
  });

  it('imports eWeLink devices, fills in keys, finds them on the LAN and switches through the cloud', async () => {
    expect((await call(admin, 'POST', '/api/integrations/ewelink/import', { appId: 'app-id-123456', appSecret: 'app-secret-1234567', login: 'me@example.com', password: 'wrong' })).status).toBe(400);
    const imp = await ok(admin, 'POST', '/api/integrations/ewelink/import', { appId: 'app-id-123456', appSecret: 'app-secret-1234567', login: 'me@example.com', password: 'right-pass' });
    expect(imp.devices).toHaveLength(1);
    expect(imp.devices[0].hasKey).toBe(true);
    expect(JSON.stringify(imp)).not.toContain('key-one');
    // A station saved with only IP + device ID gets the key from the import.
    const st = await ok(admin, 'POST', '/api/stations', { code: 'R4', name: 'R4 station', platform: 'ps5', powerDriver: 'sonoff_lan', powerConfig: { host: '192.168.9.40', deviceId: '1000aaaa01' } });
    expect(st.powerConfig.hasDeviceKey).toBe(true);
    const found = await ok(admin, 'POST', '/api/integrations/ewelink/locate', { subnet: '192.168.9' });
    expect(found.found).toEqual([{ ip: '192.168.9.40', deviceid: '1000aaaa01', name: 'TV plug 1', mode: 'lan' }]);
    expect((await ok(admin, 'GET', '/api/integrations/ewelink')).devices[0].ip).toBe('192.168.9.40');
    const cloud = await ok(admin, 'POST', '/api/power/test', { driver: 'ewelink_cloud', config: { deviceId: '1000aaaa01' }, action: 'on' });
    expect(cloud).toEqual({ ok: true, state: 'on' });
    const cloudCall = calls.find((c) => c.url.includes('/v2/device/thing/status') && c.method === 'POST')!;
    expect(cloudCall.headers.authorization).toBe('Bearer AT1');
  });

  it('signs in with eWeLink (OAuth 2.0) when password sign-in is not allowed', async () => {
    const start = await ok(admin, 'POST', '/api/integrations/ewelink/oauth', { appId: 'app-id-123456', appSecret: 'app-secret-1234567', origin: 'http://192.168.1.10:8080' });
    expect(start.redirectUrl).toBe('http://192.168.1.10:8080/api/integrations/ewelink/callback');
    const u = new URL(start.url);
    expect(u.origin + u.pathname).toBe('https://c2ccdn.coolkit.cc/oauth/index.html');
    const { createHmac } = await import('node:crypto');
    const seq = u.searchParams.get('seq')!;
    expect(u.searchParams.get('authorization')).toBe(createHmac('sha256', 'app-secret-1234567').update(`app-id-123456_${seq}`).digest('base64'));
    expect(u.searchParams.get('nonce')).toMatch(/^[A-Za-z0-9]{8}$/);
    const state = u.searchParams.get('state')!;
    // A wrong state is refused.
    const bad = await app.inject({ method: 'GET', url: `/api/integrations/ewelink/callback?code=good-code&region=eu&state=nope` });
    expect(bad.headers.location).toContain('ewelink=error');
    const back = await app.inject({ method: 'GET', url: `/api/integrations/ewelink/callback?code=good-code&region=eu&state=${state}` });
    expect(back.statusCode).toBe(302);
    expect(decodeURIComponent(String(back.headers.location))).toBe('/integrations?ewelink=ok&n=1');
    const list = await ok(admin, 'GET', '/api/integrations/ewelink');
    expect(list.connected).toBe(true);
    expect(list.login).toBe('eWeLink account');
    // The state works once only.
    const again = await app.inject({ method: 'GET', url: `/api/integrations/ewelink/callback?code=good-code&region=eu&state=${state}` });
    expect(again.headers.location).toContain('ewelink=error');
    // Disconnect forgets the account.
    await ok(admin, 'DELETE', '/api/integrations/ewelink');
    expect((await ok(admin, 'GET', '/api/integrations/ewelink')).connected).toBe(false);
  });
});
