import { and, desc, eq, isNotNull, or } from 'drizzle-orm';
import type { Ctx } from '../context.js';
import type { DbOrTx } from '../db/index.js';
import { matches, tournaments } from '../db/schema.js';
import { getGame, loadPlayers, ref } from './common.js';
import { computeStats, rankPlayers, type PlayedMatch, type SortKey } from './engine.js';

export type Period = 'all' | 'month' | 'week';

/** Start of the current week (Monday) or month in the server's local time zone (Settings → time zone). */
export function periodStart(period: Period, now: Date) {
  if (period === 'all') return null;
  const d = new Date(now.getFullYear(), now.getMonth(), period === 'month' ? 1 : now.getDate());
  if (period === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

export async function playedMatches(db: DbOrTx, gameId: string): Promise<PlayedMatch[]> {
  const rows = await db
    .select()
    .from(matches)
    .where(and(eq(matches.gameId, gameId), eq(matches.status, 'completed'), eq(matches.walkover, false), isNotNull(matches.homeId), isNotNull(matches.awayId)));
  return rows
    .filter((m) => m.homeScore != null && m.awayScore != null)
    .map((m) => ({
      id: m.id,
      homeId: m.homeId!,
      awayId: m.awayId!,
      homeScore: m.homeScore!,
      awayScore: m.awayScore!,
      winnerId: m.winnerId,
      playedAt: m.playedAt ?? m.updatedAt,
      tournamentId: m.tournamentId,
    }));
}

export async function leaderboard(
  ctx: Ctx,
  opts: { gameId?: string | null; period?: Period; sort?: SortKey; limit?: number; staff?: boolean; viewerId?: string | null },
) {
  const now = ctx.clock.now();
  const game = await getGame(ctx.db, opts.gameId);
  const period = opts.period ?? 'all';
  const from = periodStart(period, now);
  const all = await playedMatches(ctx.db, game.id);
  const stats = computeStats(all, { from, changeSince: from ?? new Date(now.getTime() - 7 * 86_400_000) });
  const players = await loadPlayers(ctx.db, [...stats.keys()]);
  const champs = await ctx.db
    .select({ championId: tournaments.championId })
    .from(tournaments)
    .where(and(eq(tournaments.gameId, game.id), eq(tournaments.status, 'completed'), isNotNull(tournaments.championId)));
  const titles = new Map<string, number>();
  for (const c of champs) titles.set(c.championId!, (titles.get(c.championId!) ?? 0) + 1);

  const visible = [...stats.values()].filter((s) => opts.staff || !players.get(s.customerId)?.hidden || s.customerId === opts.viewerId);
  const ranked = rankPlayers(visible, opts.sort ?? (period === 'all' ? 'rating' : 'points')).map((s) => {
    const p = players.get(s.customerId);
    return { ...s, player: ref(p, !!opts.staff), name: p?.name ?? '?', avatarUrl: p && (opts.staff || !p.hidden) ? p.avatarUrl : null, titles: titles.get(s.customerId) ?? 0 };
  });

  // Highlights for the window.
  const windowMatches = all.filter((m) => !from || m.playedAt >= from);
  const big = [...windowMatches].sort((a, b) => Math.abs(b.homeScore - b.awayScore) - Math.abs(a.homeScore - a.awayScore) || b.playedAt.getTime() - a.playedAt.getTime())[0];
  const best = (f: (r: (typeof ranked)[number]) => number) => [...ranked].sort((a, b) => f(b) - f(a))[0];
  const pick = (r: (typeof ranked)[number] | undefined, value: number | undefined) => (r && value ? { name: r.name, player: r.player, value } : null);
  const topScorer = best((r) => r.gf);
  const streaker = best((r) => r.longestWinStreak);
  const busiest = best((r) => r.played);
  const hot = best((r) => (r.streak?.type === 'W' ? r.streak.count : 0));
  const highlights = {
    biggestWin:
      big && big.homeScore !== big.awayScore
        ? {
            winner: ref(players.get(big.homeScore > big.awayScore ? big.homeId : big.awayId), !!opts.staff),
            loser: ref(players.get(big.homeScore > big.awayScore ? big.awayId : big.homeId), !!opts.staff),
            score: `${Math.max(big.homeScore, big.awayScore)}–${Math.min(big.homeScore, big.awayScore)}`,
            playedAt: big.playedAt.toISOString(),
          }
        : null,
    topScorer: pick(topScorer, topScorer?.gf),
    longestStreak: pick(streaker, streaker?.longestWinStreak),
    mostActive: pick(busiest, busiest?.played),
    onFire: hot?.streak?.type === 'W' && hot.streak.count >= 2 ? { name: hot.name, player: hot.player, value: hot.streak.count } : null,
  };
  const me = opts.viewerId ? (ranked.find((r) => r.customerId === opts.viewerId) ?? null) : null;
  return {
    game,
    period,
    from: from?.toISOString() ?? null,
    totals: { matches: windowMatches.length, goals: windowMatches.reduce((t, m) => t + m.homeScore + m.awayScore, 0), players: ranked.length },
    rows: ranked.slice(0, opts.limit ?? 100),
    me,
    highlights,
  };
}

/** Latest results, optionally for one player or tournament. */
export async function recentResults(ctx: Ctx, opts: { gameId?: string | null; customerId?: string | null; tournamentId?: string | null; limit?: number; staff?: boolean }) {
  const conds = [eq(matches.status, 'completed'), eq(matches.walkover, false)];
  if (opts.gameId) conds.push(eq(matches.gameId, opts.gameId));
  if (opts.tournamentId) conds.push(eq(matches.tournamentId, opts.tournamentId));
  if (opts.customerId) conds.push(or(eq(matches.homeId, opts.customerId), eq(matches.awayId, opts.customerId))!);
  const rows = await ctx.db
    .select()
    .from(matches)
    .where(and(...conds))
    .orderBy(desc(matches.playedAt), desc(matches.number))
    .limit(opts.limit ?? 20);
  const players = await loadPlayers(ctx.db, rows.flatMap((m) => [m.homeId, m.awayId]));
  return rows.map((m) => matchView(m, players, !!opts.staff));
}

export function matchView(m: typeof matches.$inferSelect, players: Awaited<ReturnType<typeof loadPlayers>>, staff: boolean) {
  return {
    id: m.id,
    number: m.number,
    gameId: m.gameId,
    tournamentId: m.tournamentId,
    stage: m.stage,
    round: m.round,
    groupName: m.groupName,
    bracketSlot: m.bracketSlot,
    status: m.status,
    home: ref(players.get(m.homeId ?? ''), staff),
    away: ref(players.get(m.awayId ?? ''), staff),
    homeScore: m.homeScore,
    awayScore: m.awayScore,
    homePens: m.homePens,
    awayPens: m.awayPens,
    winnerId: m.winnerId,
    walkover: m.walkover,
    reportedBy: m.reportedBy,
    stationId: m.stationId,
    scheduledAt: m.scheduledAt?.toISOString() ?? null,
    playedAt: m.playedAt?.toISOString() ?? null,
    note: m.note,
  };
}

/** Head-to-head record between two players in one game. */
export async function headToHead(ctx: Ctx, gameId: string, a: string, b: string, staff = false) {
  const rows = await ctx.db
    .select()
    .from(matches)
    .where(
      and(
        eq(matches.gameId, gameId),
        eq(matches.status, 'completed'),
        eq(matches.walkover, false),
        or(and(eq(matches.homeId, a), eq(matches.awayId, b)), and(eq(matches.homeId, b), eq(matches.awayId, a))),
      ),
    )
    .orderBy(desc(matches.playedAt));
  const players = await loadPlayers(ctx.db, [a, b]);
  let aw = 0;
  let bw = 0;
  let d = 0;
  let ag = 0;
  let bg = 0;
  for (const m of rows) {
    const as = m.homeId === a ? m.homeScore! : m.awayScore!;
    const bs = m.homeId === a ? m.awayScore! : m.homeScore!;
    ag += as;
    bg += bs;
    if (as > bs) aw++;
    else if (bs > as) bw++;
    else d++;
  }
  return {
    a: ref(players.get(a), staff),
    b: ref(players.get(b), staff),
    played: rows.length,
    aWins: aw,
    bWins: bw,
    draws: d,
    aGoals: ag,
    bGoals: bg,
    matches: rows.slice(0, 20).map((m) => matchView(m, players, staff)),
  };
}
