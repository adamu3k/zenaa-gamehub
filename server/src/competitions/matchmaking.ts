/**
 * Friendlies and "Find match".
 *
 *  - Staff record a friendly result at the counter (final straight away).
 *  - Players post a request in the portal ("looking for an FC opponent tonight"), or challenge a player
 *    directly from the leaderboard. Accepting creates a scheduled friendly match.
 *  - After playing, one player reports the score and the opponent confirms it, so nobody can invent wins.
 *    Disputed scores go to staff.
 */
import { and, desc, eq, gt, inArray, lt, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Actor, Ctx } from '../context.js';
import { customers, games, matches, matchRequests, sessions } from '../db/schema.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../services/audit.js';
import { getGame, loadPlayers, ref } from './common.js';
import { computeStats, MIN_RANKED_MATCHES, START_RATING, tierFor } from './engine.js';
import { matchView, playedMatches } from './leaderboard.js';
import { recordResult, ResultSchema } from './tournaments.js';

const emit = (ctx: Ctx) => ctx.bus.emit({ type: 'competitions.changed' });
const MAX_OPEN_REQUESTS = 3;
export const SIMILAR_RANGE = 150;

// ───────────────────────── Friendlies (staff) ─────────────────────────

export const FriendlySchema = ResultSchema.extend({
  gameId: z.string().uuid(),
  homeId: z.string().uuid(),
  awayId: z.string().uuid(),
  scheduledAt: z.string().datetime({ offset: true }).nullish(),
  /** false = schedule only (no score yet). */
  withResult: z.boolean().default(true),
});

export async function createFriendly(ctx: Ctx, actor: Actor, raw: unknown) {
  const b = FriendlySchema.parse(raw);
  if (b.homeId === b.awayId) throw badRequest('Choose two different players');
  await getGame(ctx.db, b.gameId);
  const [m] = await ctx.db
    .insert(matches)
    .values({
      gameId: b.gameId,
      stage: 'friendly',
      homeId: b.homeId,
      awayId: b.awayId,
      stationId: b.stationId ?? null,
      scheduledAt: b.scheduledAt ? new Date(b.scheduledAt) : null,
      note: b.note ?? null,
      recordedBy: actor.staffId,
    })
    .returning();
  if (!b.withResult) {
    emit(ctx);
    return m;
  }
  try {
    return await recordResult(ctx, actor, m.id, b);
  } catch (err) {
    await ctx.db.delete(matches).where(eq(matches.id, m.id));
    throw err;
  }
}

export async function deleteMatch(ctx: Ctx, actor: Actor, id: string) {
  const [m] = await ctx.db.select().from(matches).where(eq(matches.id, id));
  if (!m) throw notFound('Match');
  if (m.tournamentId) throw conflict('Tournament matches cannot be deleted — clear the result instead');
  await ctx.db.update(matchRequests).set({ matchId: null, status: 'cancelled' }).where(eq(matchRequests.matchId, id));
  await ctx.db.delete(matches).where(eq(matches.id, id));
  await audit(ctx.db, actor, 'match.delete', { type: 'match', id }, { homeId: m.homeId, awayId: m.awayId, score: `${m.homeScore}-${m.awayScore}` });
  emit(ctx);
  return { ok: true };
}

// ───────────────────────── Find match ─────────────────────────

export const RequestSchema = z.object({
  gameId: z.string().uuid(),
  mode: z.enum(['venue', 'online']).default('venue'),
  skill: z.enum(['any', 'similar']).default('any'),
  preferredAt: z.string().datetime({ offset: true }).nullish(),
  note: z.string().trim().max(200).nullish(),
  /** Online: room ID / password / lobby code — only the opponent sees it. */
  lobbyCode: z.string().trim().max(60).nullish(),
  targetCustomerId: z.string().uuid().nullish(),
});

async function ratingsFor(ctx: Ctx, gameId: string) {
  const stats = computeStats(await playedMatches(ctx.db, gameId));
  return (id: string) => {
    const s = stats.get(id);
    return { rating: s?.rating ?? START_RATING, played: s?.allTimePlayed ?? 0, tier: tierFor(s?.rating ?? START_RATING), provisional: (s?.allTimePlayed ?? 0) < MIN_RANKED_MATCHES };
  };
}

/** Marks requests whose time has passed as expired. */
async function expire(ctx: Ctx) {
  await ctx.db.update(matchRequests).set({ status: 'expired' }).where(and(eq(matchRequests.status, 'open'), lt(matchRequests.expiresAt, ctx.clock.now())));
}

export async function createRequest(ctx: Ctx, customerId: string, raw: unknown, actor: Actor = { staffId: null }) {
  const b = RequestSchema.parse(raw);
  await expire(ctx);
  await getGame(ctx.db, b.gameId);
  if (b.targetCustomerId === customerId) throw badRequest('You cannot challenge yourself');
  const now = ctx.clock.now();
  const preferred = b.preferredAt ? new Date(b.preferredAt) : null;
  if (preferred && preferred.getTime() < now.getTime() - 5 * 60_000) throw badRequest('Choose a time in the future');
  if (preferred && preferred.getTime() > now.getTime() + 14 * 86_400_000) throw badRequest('Choose a time within the next 14 days');
  const [{ n }] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(matchRequests)
    .where(and(eq(matchRequests.customerId, customerId), eq(matchRequests.status, 'open')));
  if (n >= MAX_OPEN_REQUESTS) throw conflict(`You already have ${MAX_OPEN_REQUESTS} open requests — cancel one first`);
  if (b.targetCustomerId) {
    const players = await loadPlayers(ctx.db, [b.targetCustomerId]);
    if (!players.size) throw notFound('Player');
  }
  const expiresAt = preferred ? new Date(preferred.getTime() + 2 * 3_600_000) : new Date(now.getTime() + 24 * 3_600_000);
  const [r] = await ctx.db
    .insert(matchRequests)
    .values({ customerId, gameId: b.gameId, mode: b.mode, skill: b.skill, preferredAt: preferred, note: b.note || null, lobbyCode: b.mode === 'online' ? b.lobbyCode || null : null, targetCustomerId: b.targetCustomerId ?? null, expiresAt, createdBy: actor.staffId })
    .returning();
  if (b.targetCustomerId) {
    const p = await loadPlayers(ctx.db, [customerId]);
    ctx.bus.emit({ type: 'alert', level: 'info', message: `⚔️ ${p.get(customerId)?.name} challenged a player to a match` });
  }
  emit(ctx);
  return r;
}

type RequestRow = typeof matchRequests.$inferSelect;

async function requestViews(ctx: Ctx, rows: RequestRow[], viewerId: string | null, staff: boolean) {
  const players = await loadPlayers(ctx.db, rows.flatMap((r) => [r.customerId, r.opponentId, r.targetCustomerId]));
  const gameIds = [...new Set(rows.map((r) => r.gameId))];
  const gameRows = gameIds.length ? await ctx.db.select().from(games).where(inArray(games.id, gameIds)) : [];
  const rating = new Map<string, Awaited<ReturnType<typeof ratingsFor>>>();
  for (const g of gameIds) rating.set(g, await ratingsFor(ctx, g));
  const matchRows = rows.some((r) => r.matchId)
    ? await ctx.db
        .select()
        .from(matches)
        .where(inArray(matches.id, rows.map((r) => r.matchId).filter((x): x is string => !!x)))
    : [];
  return rows.map((r) => {
    const rt = rating.get(r.gameId)!;
    const mine = viewerId === r.customerId;
    const involved = mine || viewerId === r.opponentId;
    const me = viewerId ? rt(viewerId) : null;
    const them = rt(r.customerId);
    const m = matchRows.find((x) => x.id === r.matchId);
    const opp = players.get((mine ? r.opponentId : r.customerId) ?? '');
    return {
      id: r.id,
      number: r.number,
      game: gameRows.find((g) => g.id === r.gameId)?.name ?? '',
      gameId: r.gameId,
      mode: r.mode,
      skill: r.skill,
      preferredAt: r.preferredAt?.toISOString() ?? null,
      note: r.note,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      player: { ...ref(players.get(r.customerId), staff), ...them },
      opponent: r.opponentId ? { ...ref(players.get(r.opponentId), staff), ...rt(r.opponentId) } : null,
      challenge: r.targetCustomerId ? ref(players.get(r.targetCustomerId), staff) : null,
      mine,
      /** Only the two players (and staff) see PSN IDs, and only for online matches. */
      contact:
        (involved || staff) && r.mode === 'online' && r.status !== 'open'
          ? { psnId: opp?.psnId ?? null, eaId: opp?.eaId ?? null, lobbyCode: m?.lobbyCode ?? r.lobbyCode ?? null }
          : null,
      /** Online: how to meet in this game (EA FC friendlies, eFootball rooms…). */
      howTo: r.mode === 'online' ? (gameRows.find((g) => g.id === r.gameId)?.onlineHowTo ?? null) : null,
      hasLobbyCode: !!(m?.lobbyCode ?? r.lobbyCode),
      ratingGap: me ? Math.abs(me.rating - them.rating) : null,
      canAccept:
        !!viewerId &&
        !mine &&
        r.status === 'open' &&
        (!r.targetCustomerId || r.targetCustomerId === viewerId) &&
        (r.skill !== 'similar' || !me || Math.abs(me.rating - them.rating) <= SIMILAR_RANGE || me.provisional || them.provisional),
      match: m ? matchView(m, players, staff) : null,
    };
  });
}

/** Open requests a player can see (others' open ones, challenges to them) plus their own recent ones. */
export async function listRequests(ctx: Ctx, opts: { viewerId?: string | null; staff?: boolean; gameId?: string | null }) {
  await expire(ctx);
  const since = new Date(ctx.clock.now().getTime() - 7 * 86_400_000);
  const viewer = opts.viewerId ?? null;
  const base = [gt(matchRequests.createdAt, since)];
  if (opts.gameId) base.push(eq(matchRequests.gameId, opts.gameId));
  const open = await ctx.db
    .select()
    .from(matchRequests)
    .where(and(...base, eq(matchRequests.status, 'open')))
    .orderBy(desc(matchRequests.createdAt))
    .limit(100);
  const visibleOpen = open.filter((r) => opts.staff || !r.targetCustomerId || r.targetCustomerId === viewer || r.customerId === viewer);
  const mine = viewer
    ? await ctx.db
        .select()
        .from(matchRequests)
        .where(and(...base, ne(matchRequests.status, 'open'), or(eq(matchRequests.customerId, viewer), eq(matchRequests.opponentId, viewer))))
        .orderBy(desc(matchRequests.createdAt))
        .limit(30)
    : opts.staff
      ? await ctx.db
          .select()
          .from(matchRequests)
          .where(and(...base, inArray(matchRequests.status, ['matched', 'completed'])))
          .orderBy(desc(matchRequests.createdAt))
          .limit(60)
      : [];
  return {
    open: await requestViews(ctx, visibleOpen, viewer, !!opts.staff),
    history: await requestViews(ctx, mine, viewer, !!opts.staff),
  };
}

/** Accepts a request: both players are matched and a friendly match is scheduled. */
export async function acceptRequest(ctx: Ctx, requestId: string, customerId: string, actor: Actor = { staffId: null }) {
  await expire(ctx);
  const out = await ctx.db.transaction(async (tx) => {
    const [r] = await tx.select().from(matchRequests).where(eq(matchRequests.id, requestId)).for('update');
    if (!r) throw notFound('Request');
    if (r.status !== 'open') throw conflict('Someone has already taken this match, or it was cancelled');
    if (r.customerId === customerId) throw badRequest('You cannot accept your own request');
    if (r.targetCustomerId && r.targetCustomerId !== customerId) throw forbidden('This challenge is for another player');
    if (r.skill === 'similar') {
      const rt = await ratingsFor(ctx, r.gameId);
      const a = rt(customerId);
      const b = rt(r.customerId);
      if (!a.provisional && !b.provisional && Math.abs(a.rating - b.rating) > SIMILAR_RANGE) {
        throw conflict(`This player wants an opponent of a similar level (within ${SIMILAR_RANGE} rating points)`);
      }
    }
    const [m] = await tx
      .insert(matches)
      .values({ gameId: r.gameId, stage: 'friendly', homeId: r.customerId, awayId: customerId, scheduledAt: r.preferredAt ?? ctx.clock.now(), matchRequestId: r.id, note: r.mode === 'online' ? 'Online (PSN)' : null, lobbyCode: r.lobbyCode })
      .returning();
    await tx.update(matchRequests).set({ status: 'matched', opponentId: customerId, matchId: m.id, acceptedAt: ctx.clock.now() }).where(eq(matchRequests.id, r.id));
    await audit(tx, actor, 'matchmaking.accept', { type: 'match_request', id: r.id }, { customerId });
    return m;
  });
  const p = await loadPlayers(ctx.db, [out.homeId, out.awayId]);
  ctx.bus.emit({ type: 'alert', level: 'info', message: `🎮 Match on: ${p.get(out.homeId!)?.name} vs ${p.get(out.awayId!)?.name}` });
  emit(ctx);
  return out;
}

/** Staff pair two players directly (from two requests, or any two customers). */
export async function staffPair(ctx: Ctx, actor: Actor, raw: unknown) {
  const b = z.object({ requestId: z.string().uuid(), opponentId: z.string().uuid() }).parse(raw);
  const [r] = await ctx.db.select().from(matchRequests).where(eq(matchRequests.id, b.requestId));
  if (!r) throw notFound('Request');
  // Close the opponent's own open request for the same game, if any — they are now matched.
  const m = await acceptRequest(ctx, r.id, b.opponentId, actor);
  await ctx.db
    .update(matchRequests)
    .set({ status: 'cancelled' })
    .where(and(eq(matchRequests.customerId, b.opponentId), eq(matchRequests.gameId, r.gameId), eq(matchRequests.status, 'open')));
  return m;
}

export async function cancelRequest(ctx: Ctx, requestId: string, by: { customerId?: string; actor: Actor }) {
  const [r] = await ctx.db.select().from(matchRequests).where(eq(matchRequests.id, requestId));
  if (!r) throw notFound('Request');
  if (by.customerId && r.customerId !== by.customerId && r.targetCustomerId !== by.customerId) throw notFound('Request');
  if (r.status === 'open') {
    await ctx.db.update(matchRequests).set({ status: 'cancelled' }).where(eq(matchRequests.id, r.id));
  } else if (r.status === 'matched' && r.matchId) {
    const [m] = await ctx.db.select().from(matches).where(eq(matches.id, r.matchId));
    if (m?.status === 'completed') throw conflict('This match has been played');
    if (by.customerId && r.opponentId !== by.customerId && r.customerId !== by.customerId) throw notFound('Request');
    await ctx.db.update(matchRequests).set({ status: 'cancelled', matchId: null }).where(eq(matchRequests.id, r.id));
    await ctx.db.delete(matches).where(eq(matches.id, r.matchId));
  } else {
    throw conflict('This request is already closed');
  }
  await audit(ctx.db, by.actor, 'matchmaking.cancel', { type: 'match_request', id: r.id }, { by: by.customerId ?? 'staff' });
  emit(ctx);
  return { ok: true };
}

// ───────────────────────── Player-reported results ─────────────────────────

const ReportSchema = z.object({ myScore: z.number().int().min(0).max(999), opponentScore: z.number().int().min(0).max(999) });

/** A player reports the score of their friendly; it counts once the opponent confirms. */
export async function reportResult(ctx: Ctx, customerId: string, matchId: string, raw: unknown) {
  const b = ReportSchema.parse(raw);
  const [m] = await ctx.db.select().from(matches).where(eq(matches.id, matchId));
  if (!m || (m.homeId !== customerId && m.awayId !== customerId)) throw notFound('Match');
  if (m.tournamentId) throw forbidden('Tournament results are entered by staff');
  if (m.status === 'completed') throw conflict('This result is already final');
  const [game] = await ctx.db.select().from(games).where(eq(games.id, m.gameId));
  if (b.myScore === b.opponentScore && !game.allowDraws) throw badRequest('This game has no draws — enter the deciding score');
  const home = m.homeId === customerId;
  await ctx.db
    .update(matches)
    .set({
      homeScore: home ? b.myScore : b.opponentScore,
      awayScore: home ? b.opponentScore : b.myScore,
      status: 'pending_confirmation',
      reportedBy: customerId,
      playedAt: ctx.clock.now(),
      updatedAt: ctx.clock.now(),
    })
    .where(eq(matches.id, m.id));
  emit(ctx);
  return { ok: true };
}

/** The opponent confirms (result becomes final) or disputes (staff are alerted). */
export async function respondToResult(ctx: Ctx, customerId: string, matchId: string, agree: boolean) {
  const [m] = await ctx.db.select().from(matches).where(eq(matches.id, matchId));
  if (!m || (m.homeId !== customerId && m.awayId !== customerId)) throw notFound('Match');
  if (m.status !== 'pending_confirmation') throw conflict('There is no reported score to confirm');
  if (m.reportedBy === customerId) throw badRequest('Your opponent has to confirm the score you reported');
  if (agree) {
    await recordResult(ctx, { staffId: null }, m.id, { homeScore: m.homeScore, awayScore: m.awayScore, playedAt: (m.playedAt ?? ctx.clock.now()).toISOString() });
    if (m.matchRequestId) await ctx.db.update(matchRequests).set({ status: 'completed' }).where(eq(matchRequests.id, m.matchRequestId));
  } else {
    await ctx.db
      .update(matches)
      .set({ status: 'scheduled', homeScore: null, awayScore: null, reportedBy: null, note: 'Score disputed — staff will confirm the result', updatedAt: ctx.clock.now() })
      .where(eq(matches.id, m.id));
    const p = await loadPlayers(ctx.db, [m.homeId, m.awayId]);
    ctx.bus.emit({ type: 'alert', level: 'warning', message: `Disputed score: ${p.get(m.homeId!)?.name} vs ${p.get(m.awayId!)?.name} — record the result in Find match` });
  }
  emit(ctx);
  return { ok: true };
}

/** Player's own friendlies that still need a score or a confirmation. */
export async function myOpenMatches(ctx: Ctx, customerId: string) {
  const rows = await ctx.db
    .select()
    .from(matches)
    .where(and(or(eq(matches.homeId, customerId), eq(matches.awayId, customerId)), inArray(matches.status, ['scheduled', 'pending_confirmation'])))
    .orderBy(desc(matches.createdAt))
    .limit(30);
  const players = await loadPlayers(ctx.db, rows.flatMap((m) => [m.homeId, m.awayId]));
  const howTos = new Map((await ctx.db.select({ id: games.id, h: games.onlineHowTo }).from(games)).map((g) => [g.id, g.h]));
  return rows
    .filter((m) => m.homeId && m.awayId)
    .map((m) => {
      const opp = players.get((m.homeId === customerId ? m.awayId : m.homeId) ?? '');
      const online = m.note === 'Online (PSN)' || !!m.lobbyCode;
      return {
        ...matchView(m, players, false),
        canReport: !m.tournamentId && m.status === 'scheduled',
        mustConfirm: m.status === 'pending_confirmation' && m.reportedBy !== customerId,
        /** Only the two players see these. */
        lobbyCode: m.lobbyCode,
        online,
        opponentContact: { psnId: opp?.psnId ?? null, eaId: opp?.eaId ?? null },
        howTo: online ? (howTos.get(m.gameId) ?? null) : null,
      };
    });
}

/** Players of a similar level to challenge (active in the last 60 days). */
export async function suggestOpponents(ctx: Ctx, customerId: string, gameId: string) {
  const all = await playedMatches(ctx.db, gameId);
  const stats = computeStats(all);
  const me = stats.get(customerId);
  const myRating = me?.rating ?? START_RATING;
  const since = ctx.clock.now().getTime() - 60 * 86_400_000;
  const candidates = [...stats.values()].filter((s) => s.customerId !== customerId && s.lastPlayedAt && Date.parse(s.lastPlayedAt) > since);
  const players = await loadPlayers(ctx.db, candidates.map((c) => c.customerId));
  return candidates
    .filter((c) => !players.get(c.customerId)?.hidden)
    .sort((a, b) => Math.abs(a.rating - myRating) - Math.abs(b.rating - myRating))
    .slice(0, 6)
    .map((c) => ({ player: ref(players.get(c.customerId), false), rating: c.rating, tier: c.tier, played: c.played, winRate: c.winRate, gap: c.rating - myRating }));
}

// ───────────────────────── Player search (portal "Find opponents") ─────────────────────────

export const PlayerSearchSchema = z.object({
  gameId: z.string().uuid().optional(),
  /** Gamertag, name, PSN ID or EA ID (any part). Empty = browse. */
  q: z.string().trim().max(40).default(''),
  /** all | similar (near my rating) | here (playing at the centre now) | looking (has an open request) */
  filter: z.enum(['all', 'similar', 'here', 'looking']).default('all'),
});

/**
 * Finds opponents with everything a player needs to choose: level, record, recent form, whether they are at the
 * centre right now or looking for a game, and the head-to-head record against the viewer. PSN/EA IDs are searched
 * but never shown (they are shared only once a match is agreed).
 */
export async function searchPlayers(ctx: Ctx, viewerId: string, raw: unknown) {
  const b = PlayerSearchSchema.parse(raw);
  const game = await getGame(ctx.db, b.gameId);
  const all = await playedMatches(ctx.db, game.id);
  const stats = computeStats(all);
  const myRating = stats.get(viewerId)?.rating ?? START_RATING;

  // Who is at the centre now (a running/paused session) and who is looking for a game.
  const here = new Set(
    (await ctx.db.select({ id: sessions.customerId }).from(sessions).where(and(inArray(sessions.status, ['running', 'paused']), sql`${sessions.customerId} is not null`))).map((r) => r.id!),
  );
  const looking = new Map(
    (
      await ctx.db
        .select({ id: matchRequests.customerId, reqId: matchRequests.id, mode: matchRequests.mode, target: matchRequests.targetCustomerId })
        .from(matchRequests)
        .where(and(eq(matchRequests.status, 'open'), eq(matchRequests.gameId, game.id), gt(matchRequests.expiresAt, ctx.clock.now())))
    )
      .filter((r) => !r.target || r.target === viewerId)
      .map((r) => [r.id, { requestId: r.reqId, mode: r.mode }]),
  );

  const q = b.q.toLowerCase();
  let ids: string[];
  if (q.length >= 1) {
    const rows = await ctx.db
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          eq(customers.status, 'active'),
          eq(customers.leaderboardHidden, false),
          ne(customers.id, viewerId),
          or(...[customers.gamertag, customers.fullName, customers.psnId, customers.eaId].map((col) => sql`strpos(lower(coalesce(${col}, '')), ${q}) > 0`)),
        ),
      )
      .limit(200);
    ids = rows.map((r) => r.id);
  } else {
    // Browse: everyone with results in this game, plus whoever is at the centre or looking right now.
    ids = [...new Set([...stats.keys(), ...here, ...looking.keys()])].filter((id) => id !== viewerId);
  }
  const players = await loadPlayers(ctx.db, ids);
  const active = ids.length
    ? new Set((await ctx.db.select({ id: customers.id }).from(customers).where(and(inArray(customers.id, ids), eq(customers.status, 'active')))).map((r) => r.id))
    : new Set<string>();

  // Head-to-head against the viewer, from the same match list.
  const h2h = new Map<string, { w: number; d: number; l: number }>();
  for (const m of all) {
    const other = m.homeId === viewerId ? m.awayId : m.awayId === viewerId ? m.homeId : null;
    if (!other) continue;
    const mine = m.homeId === viewerId ? m.homeScore : m.awayScore;
    const theirs = m.homeId === viewerId ? m.awayScore : m.homeScore;
    const r = h2h.get(other) ?? { w: 0, d: 0, l: 0 };
    if (mine > theirs) r.w++;
    else if (mine < theirs) r.l++;
    else r.d++;
    h2h.set(other, r);
  }

  const score = (p: { gamertag: string | null; fullName: string; psnId: string | null; eaId: string | null }) => {
    if (!q) return 0;
    const names = [p.gamertag, p.fullName, p.psnId, p.eaId].map((x) => (x ?? '').toLowerCase());
    if (names.some((n) => n === q)) return 3;
    if (names.some((n) => n.startsWith(q) || n.split(/\s+/).some((w) => w.startsWith(q)))) return 2;
    return 1;
  };

  const list = ids
    .map((id) => players.get(id))
    .filter((p): p is NonNullable<typeof p> => !!p && !p.hidden && active.has(p.id))
    .map((p) => {
      const s = stats.get(p.id);
      const rating = s?.rating ?? START_RATING;
      return {
        player: { id: p.id, name: p.name, avatarUrl: p.avatarUrl },
        rating,
        tier: tierFor(rating),
        played: s?.played ?? 0,
        won: s?.won ?? 0,
        drawn: s?.drawn ?? 0,
        lost: s?.lost ?? 0,
        winRate: s?.played ? Math.round((s.won / s.played) * 100) : 0,
        form: s?.form ?? [],
        provisional: (s?.played ?? 0) < MIN_RANKED_MATCHES,
        lastPlayedAt: s?.lastPlayedAt ?? null,
        gap: rating - myRating,
        atCentre: here.has(p.id),
        looking: looking.get(p.id) ?? null,
        headToHead: h2h.get(p.id) ?? null,
        hasPsn: !!p.psnId,
        hasEa: !!p.eaId,
        _score: score(p),
      };
    })
    .filter((r) =>
      b.filter === 'similar' ? Math.abs(r.gap) <= SIMILAR_RANGE : b.filter === 'here' ? r.atCentre : b.filter === 'looking' ? !!r.looking : true,
    )
    .sort(
      (a, c) =>
        c._score - a._score ||
        Number(!!c.looking) - Number(!!a.looking) ||
        Number(c.atCentre) - Number(a.atCentre) ||
        Math.abs(a.gap) - Math.abs(c.gap) ||
        c.played - a.played,
    )
    .slice(0, 40)
    .map(({ _score, ...r }) => r);
  return { game: { id: game.id, name: game.name }, myRating, total: list.length, players: list };
}
