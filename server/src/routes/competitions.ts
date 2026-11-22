/**
 * Leaderboards, matches, tournaments and Find match.
 *   /api/games, /api/leaderboard, /api/matches, /api/tournaments, /api/matchmaking  — staff
 *   /api/public/*                                                                 — anyone (if enabled)
 *   /api/portal/competitions/*, /api/portal/matchmaking/*, /api/portal/tournaments — signed-in players
 */
import { and, asc, eq, ilike, ne, or } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { actorOf } from '../auth/plugin.js';
import type { Ctx } from '../context.js';
import { customers, games, matches } from '../db/schema.js';
import { badRequest, forbidden, notFound, parse } from '../lib/errors.js';
import { audit } from '../services/audit.js';
import { getSettings } from '../services/settings.js';
import { activeGames, getGame, loadPlayers, ref } from '../competitions/common.js';
import { headToHead, leaderboard, recentResults } from '../competitions/leaderboard.js';
import {
  acceptRequest,
  cancelRequest,
  createFriendly,
  createRequest,
  deleteMatch,
  listRequests,
  myOpenMatches,
  reportResult,
  respondToResult,
  staffPair,
  searchPlayers,
  suggestOpponents,
} from '../competitions/matchmaking.js';
import {
  addEntry,
  clearResult,
  createTournament,
  deleteTournament,
  listTournaments,
  patchEntry,
  payPrize,
  recordResult,
  removeEntry,
  setTournamentStatus,
  startTournament,
  tournamentDetail,
  updateTournament,
} from '../competitions/tournaments.js';

const BoardQuery = z.object({
  gameId: z.string().uuid().optional(),
  period: z.enum(['all', 'month', 'week']).default('all'),
  sort: z.enum(['rating', 'points', 'wins', 'goals', 'winrate']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const GameBody = z.object({
  name: z.string().trim().min(2).max(60),
  shortName: z.string().trim().max(16).nullish(),
  scoring: z.enum(['goals', 'points', 'rounds']).default('goals'),
  allowDraws: z.boolean().default(true),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

export async function competitionRoutes(app: FastifyInstance, ctx: Ctx) {
  const manage = { preHandler: app.auth('competitions.manage') };
  const view = { preHandler: app.auth() };
  const player = { preHandler: app.customerAuth() };

  // ── Games ──
  app.get('/api/games', view, async () => ctx.db.select().from(games).orderBy(asc(games.sortOrder), asc(games.name)));
  app.post('/api/games', manage, async (req) => {
    const b = parse(GameBody, req.body);
    const [g] = await ctx.db.insert(games).values(b).returning();
    await audit(ctx.db, actorOf(req), 'game.create', { type: 'game', id: g.id }, { name: g.name });
    return g;
  });
  app.patch<{ Params: { id: string } }>('/api/games/:id', manage, async (req) => {
    const b = parse(GameBody.partial(), req.body);
    const [g] = await ctx.db.update(games).set(b).where(eq(games.id, req.params.id)).returning();
    if (!g) throw notFound('Game');
    await audit(ctx.db, actorOf(req), 'game.update', { type: 'game', id: g.id }, b);
    return g;
  });

  // ── Leaderboard & results (staff see hidden players and real names) ──
  app.get('/api/leaderboard', view, async (req) => {
    const q = parse(BoardQuery, req.query);
    return leaderboard(ctx, { ...q, staff: true });
  });
  app.get('/api/matches', view, async (req) => {
    const q = parse(
      z.object({ gameId: z.string().uuid().optional(), customerId: z.string().uuid().optional(), tournamentId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(30) }),
      req.query,
    );
    return recentResults(ctx, { ...q, staff: true });
  });
  app.get('/api/head-to-head', view, async (req) => {
    const q = parse(z.object({ gameId: z.string().uuid(), a: z.string().uuid(), b: z.string().uuid() }), req.query);
    return headToHead(ctx, q.gameId, q.a, q.b, true);
  });
  app.post('/api/matches', manage, async (req) => createFriendly(ctx, actorOf(req), req.body));
  app.put<{ Params: { id: string } }>('/api/matches/:id/result', manage, async (req) => recordResult(ctx, actorOf(req), req.params.id, req.body));
  app.post<{ Params: { id: string } }>('/api/matches/:id/clear', manage, async (req) => clearResult(ctx, actorOf(req), req.params.id));
  app.delete<{ Params: { id: string } }>('/api/matches/:id', manage, async (req) => deleteMatch(ctx, actorOf(req), req.params.id));

  // ── Tournaments ──
  app.get('/api/tournaments', view, async () => listTournaments(ctx));
  app.post('/api/tournaments', manage, async (req) => createTournament(ctx, actorOf(req), req.body));
  app.get<{ Params: { id: string } }>('/api/tournaments/:id', view, async (req) => tournamentDetail(ctx, req.params.id, { staff: true }));
  app.patch<{ Params: { id: string } }>('/api/tournaments/:id', manage, async (req) => updateTournament(ctx, actorOf(req), req.params.id, req.body));
  app.delete<{ Params: { id: string } }>('/api/tournaments/:id', manage, async (req) => deleteTournament(ctx, actorOf(req), req.params.id));
  app.post<{ Params: { id: string } }>('/api/tournaments/:id/status', manage, async (req) => {
    const b = parse(z.object({ status: z.enum(['draft', 'registration', 'cancelled']) }), req.body);
    return setTournamentStatus(ctx, actorOf(req), req.params.id, b.status);
  });
  app.post<{ Params: { id: string } }>('/api/tournaments/:id/start', manage, async (req) => {
    const b = parse(z.object({ shuffle: z.boolean().default(false) }), req.body);
    return startTournament(ctx, actorOf(req), req.params.id, b);
  });
  app.post<{ Params: { id: string } }>('/api/tournaments/:id/entries', manage, async (req) => addEntry(ctx, actorOf(req), req.params.id, req.body));
  app.patch<{ Params: { id: string; entryId: string } }>('/api/tournaments/:id/entries/:entryId', manage, async (req) =>
    patchEntry(ctx, actorOf(req), req.params.id, req.params.entryId, req.body),
  );
  app.delete<{ Params: { id: string; entryId: string } }>('/api/tournaments/:id/entries/:entryId', manage, async (req) =>
    removeEntry(ctx, actorOf(req), req.params.id, req.params.entryId),
  );
  app.post<{ Params: { id: string; entryId: string } }>('/api/tournaments/:id/entries/:entryId/prize', manage, async (req) =>
    payPrize(ctx, actorOf(req), req.params.id, req.params.entryId, req.body),
  );

  // ── Find match (staff view) ──
  app.get('/api/matchmaking', view, async (req) => {
    const q = parse(z.object({ gameId: z.string().uuid().optional() }), req.query);
    return listRequests(ctx, { staff: true, gameId: q.gameId });
  });
  app.post('/api/matchmaking/requests', manage, async (req) => {
    const b = parse(z.object({ customerId: z.string().uuid() }).passthrough(), req.body);
    return createRequest(ctx, b.customerId, req.body, actorOf(req));
  });
  app.post('/api/matchmaking/pair', manage, async (req) => staffPair(ctx, actorOf(req), req.body));
  app.post<{ Params: { id: string } }>('/api/matchmaking/requests/:id/cancel', manage, async (req) => cancelRequest(ctx, req.params.id, { actor: actorOf(req) }));

  // ── Public (venue TV, portal visitors) ──
  const publicOn = async () => {
    if (!(await getSettings(ctx.db)).leaderboardPublic) throw forbidden('The leaderboard is not public');
  };
  app.get('/api/public/games', async () => {
    await publicOn();
    return (await activeGames(ctx.db)).map((g) => ({ id: g.id, name: g.name, shortName: g.shortName, scoring: g.scoring }));
  });
  app.get('/api/public/leaderboard', async (req) => {
    await publicOn();
    const q = parse(BoardQuery, req.query);
    return leaderboard(ctx, { ...q, limit: Math.min(q.limit, 100) });
  });
  app.get('/api/public/results', async (req) => {
    await publicOn();
    const q = parse(z.object({ gameId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(50).default(12) }), req.query);
    return recentResults(ctx, q);
  });
  app.get('/api/public/tournaments', async () => {
    await publicOn();
    return listTournaments(ctx, { publicOnly: true });
  });
  app.get<{ Params: { id: string } }>('/api/public/tournaments/:id', async (req) => {
    await publicOn();
    return tournamentDetail(ctx, req.params.id);
  });

  // ── Players (portal) ──
  const me = (req: FastifyRequest) => req.customer!.id;
  const playerActor = (req: FastifyRequest) => ({ staffId: null, ip: req.ip });
  const matchmakingOn = async () => {
    if (!(await getSettings(ctx.db)).matchmakingEnabled) throw forbidden('Find match is switched off');
  };

  app.get('/api/portal/competitions/games', player, async () => (await activeGames(ctx.db)).map((g) => ({ id: g.id, name: g.name, scoring: g.scoring, allowDraws: g.allowDraws })));
  app.get('/api/portal/competitions/leaderboard', player, async (req) => {
    const q = parse(BoardQuery, req.query);
    return leaderboard(ctx, { ...q, limit: Math.min(q.limit, 100), viewerId: me(req) });
  });
  app.get('/api/portal/competitions/me', player, async (req) => {
    const q = parse(z.object({ gameId: z.string().uuid().optional() }), req.query);
    const game = await getGame(ctx.db, q.gameId);
    const board = await leaderboard(ctx, { gameId: game.id, viewerId: me(req), limit: 1 });
    return {
      game,
      me: board.me,
      recent: await recentResults(ctx, { gameId: game.id, customerId: me(req), limit: 10 }),
      openMatches: await myOpenMatches(ctx, me(req)),
      suggestions: await suggestOpponents(ctx, me(req), game.id),
      tournaments: (await listTournaments(ctx, { publicOnly: true, viewerId: me(req) })).filter((t) => t.registered),
    };
  });
  app.get('/api/portal/competitions/head-to-head', player, async (req) => {
    const q = parse(z.object({ gameId: z.string().uuid(), opponentId: z.string().uuid() }), req.query);
    return headToHead(ctx, q.gameId, me(req), q.opponentId);
  });
  app.get('/api/portal/tournaments', player, async (req) => listTournaments(ctx, { publicOnly: true, viewerId: me(req) }));
  app.get<{ Params: { id: string } }>('/api/portal/tournaments/:id', player, async (req) => tournamentDetail(ctx, req.params.id, { viewerId: me(req) }));
  app.post<{ Params: { id: string } }>('/api/portal/tournaments/:id/register', player, async (req) =>
    addEntry(ctx, playerActor(req), req.params.id, { customerId: me(req) }, { self: true }),
  );
  app.post<{ Params: { id: string } }>('/api/portal/tournaments/:id/withdraw', player, async (req) => {
    const d = await tournamentDetail(ctx, req.params.id, { viewerId: me(req) });
    if (!d.myEntry) throw notFound('Your entry');
    return removeEntry(ctx, playerActor(req), req.params.id, d.myEntry, { customerId: me(req) });
  });

  app.get('/api/portal/matchmaking', player, async (req) => {
    await matchmakingOn();
    const q = parse(z.object({ gameId: z.string().uuid().optional() }), req.query);
    return listRequests(ctx, { viewerId: me(req), gameId: q.gameId });
  });
  app.post('/api/portal/matchmaking', player, async (req) => {
    await matchmakingOn();
    return createRequest(ctx, me(req), req.body, playerActor(req));
  });
  app.post<{ Params: { id: string } }>('/api/portal/matchmaking/:id/accept', player, async (req) => {
    await matchmakingOn();
    return acceptRequest(ctx, req.params.id, me(req), playerActor(req));
  });
  app.post<{ Params: { id: string } }>('/api/portal/matchmaking/:id/cancel', player, async (req) => cancelRequest(ctx, req.params.id, { customerId: me(req), actor: playerActor(req) }));
  /** Either player sets the online room ID / password; both see it. */
  app.post<{ Params: { id: string } }>('/api/portal/matches/:id/lobby', player, async (req) => {
    const b = parse(z.object({ lobbyCode: z.string().trim().max(60).nullish() }), req.body);
    const [m] = await ctx.db.select().from(matches).where(eq(matches.id, req.params.id));
    if (!m || (m.homeId !== me(req) && m.awayId !== me(req))) throw notFound('Match');
    if (m.status !== 'scheduled') throw badRequest('This match is already played');
    await ctx.db.update(matches).set({ lobbyCode: b.lobbyCode || null, updatedAt: ctx.clock.now() }).where(eq(matches.id, m.id));
    ctx.bus.emit({ type: 'competitions.changed' });
    return { ok: true };
  });
  app.post<{ Params: { id: string } }>('/api/portal/matches/:id/report', player, async (req) => reportResult(ctx, me(req), req.params.id, req.body));
  app.post<{ Params: { id: string } }>('/api/portal/matches/:id/confirm', player, async (req) => respondToResult(ctx, me(req), req.params.id, true));
  app.post<{ Params: { id: string } }>('/api/portal/matches/:id/dispute', player, async (req) => respondToResult(ctx, me(req), req.params.id, false));
  /** Find opponents: search by name / gamertag / PSN / EA ID, or browse by level, at the centre now, looking for a game. */
  app.get('/api/portal/players/search', player, async (req) => {
    await matchmakingOn();
    return searchPlayers(ctx, me(req), req.query);
  });
  app.get('/api/portal/players', player, async (req) => {
    // Lookup for challenges: search by gamertag/name among players who have played.
    const q = parse(z.object({ q: z.string().trim().min(2).max(40) }), req.query);
    const rows = await ctx.db
      .select({ id: customers.id })
      .from(customers)
      .where(and(or(ilike(customers.gamertag, `%${q.q}%`), ilike(customers.fullName, `${q.q}%`)), eq(customers.leaderboardHidden, false), ne(customers.id, me(req)), eq(customers.status, 'active')))
      .limit(10);
    const players = await loadPlayers(ctx.db, rows.map((r) => r.id));
    return rows.map((r) => ref(players.get(r.id), false));
  });
}
