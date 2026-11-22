/**
 * Matches and tournaments: recording results, fixture generation, knockout progression, completion, prizes.
 * Every result goes through recordResult(), so friendlies, Find-match games and tournament games all feed
 * the same leaderboard.
 */
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Actor, Ctx } from '../context.js';
import type { DbOrTx } from '../db/index.js';
import { customers, games, matches, posts, tournamentEntries, tournaments, type Prize } from '../db/schema.js';
import { normalizePhone } from '../lib/countries.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { audit } from '../services/audit.js';
import { getSettings } from '../services/settings.js';
import { postWallet } from '../services/wallet.js';
import { loadPlayers, ref } from './common.js';
import { firstRound, roundName, roundRobin, snakeGroups, standings } from './engine.js';
import { matchView } from './leaderboard.js';

type MatchRow = typeof matches.$inferSelect;
type TournamentRow = typeof tournaments.$inferSelect;

const KNOCKOUT_STAGES = ['knockout', 'third_place'];
const emit = (ctx: Ctx) => ctx.bus.emit({ type: 'competitions.changed' });

// ───────────────────────── Results ─────────────────────────

export const ResultSchema = z.object({
  homeScore: z.number().int().min(0).max(999).nullish(),
  awayScore: z.number().int().min(0).max(999).nullish(),
  homePens: z.number().int().min(0).max(99).nullish(),
  awayPens: z.number().int().min(0).max(99).nullish(),
  /** Forfeit: this player goes through without a score (no rating change). */
  walkoverWinnerId: z.string().uuid().nullish(),
  playedAt: z.string().datetime({ offset: true }).nullish(),
  stationId: z.string().uuid().nullish(),
  note: z.string().max(300).nullish(),
});
export type ResultInput = z.infer<typeof ResultSchema>;

function decideWinner(m: MatchRow, game: { allowDraws: boolean }, r: ResultInput) {
  if (r.walkoverWinnerId) {
    if (r.walkoverWinnerId !== m.homeId && r.walkoverWinnerId !== m.awayId) throw badRequest('The walkover winner must be one of the two players');
    return { winnerId: r.walkoverWinnerId, walkover: true };
  }
  if (r.homeScore == null || r.awayScore == null) throw badRequest('Enter both scores');
  if (r.homeScore !== r.awayScore) return { winnerId: r.homeScore > r.awayScore ? m.homeId : m.awayId, walkover: false };
  if (KNOCKOUT_STAGES.includes(m.stage)) {
    if (r.homePens == null || r.awayPens == null || r.homePens === r.awayPens) {
      throw badRequest('A knockout match needs a winner — enter the penalty shoot-out (or deciding game) score');
    }
    return { winnerId: r.homePens > r.awayPens ? m.homeId : m.awayId, walkover: false };
  }
  if (!game.allowDraws) throw badRequest('This game has no draws — enter the deciding score');
  return { winnerId: null, walkover: false };
}

/** Records (or corrects) a result and moves the tournament on. Final for staff; portal reports use matchmaking. */
export async function recordResult(ctx: Ctx, actor: Actor, matchId: string, raw: unknown) {
  const r = ResultSchema.parse(raw);
  const out = await ctx.db.transaction(async (tx) => {
    const [m] = await tx.select().from(matches).where(eq(matches.id, matchId)).for('update');
    if (!m) throw notFound('Match');
    if (!m.homeId || !m.awayId) throw badRequest('Both players must be known before a result can be entered');
    if (m.status === 'cancelled') throw conflict('This match was cancelled');
    const [game] = await tx.select().from(games).where(eq(games.id, m.gameId));
    let t: TournamentRow | undefined;
    if (m.tournamentId) {
      [t] = await tx.select().from(tournaments).where(eq(tournaments.id, m.tournamentId)).for('update');
      if (t.status !== 'live') throw conflict(t.status === 'completed' ? 'This tournament is finished — its results are final' : 'Start the tournament first');
      if (m.status === 'completed') await assertEditable(tx, t, m);
    }
    const { winnerId, walkover } = decideWinner(m, game, r);
    const now = ctx.clock.now();
    const [saved] = await tx
      .update(matches)
      .set({
        homeScore: walkover ? null : r.homeScore,
        awayScore: walkover ? null : r.awayScore,
        homePens: walkover || r.homeScore !== r.awayScore ? null : (r.homePens ?? null),
        awayPens: walkover || r.homeScore !== r.awayScore ? null : (r.awayPens ?? null),
        winnerId,
        walkover,
        status: 'completed',
        reportedBy: null,
        recordedBy: actor.staffId,
        playedAt: r.playedAt ? new Date(r.playedAt) : (m.playedAt ?? now),
        stationId: r.stationId ?? m.stationId,
        note: r.note ?? m.note,
        updatedAt: now,
      })
      .where(eq(matches.id, m.id))
      .returning();
    if (t) await progress(ctx, tx, t, saved);
    await audit(tx, actor, m.status === 'completed' ? 'match.correct' : 'match.result', { type: 'match', id: m.id }, {
      score: walkover ? 'walkover' : `${r.homeScore}-${r.awayScore}`,
      tournament: t?.name,
    });
    return saved;
  });
  emit(ctx);
  return out;
}

/** A knockout result can only change while the next-round match has not been played. */
async function assertEditable(tx: DbOrTx, t: TournamentRow, m: MatchRow) {
  if (m.stage === 'group') {
    const [ko] = await tx.select({ id: matches.id }).from(matches).where(and(eq(matches.tournamentId, t.id), eq(matches.stage, 'knockout'))).limit(1);
    if (ko) throw conflict('The knockout stage has already been drawn — group results can no longer change');
  }
  if (m.stage === 'knockout') {
    const ko = await tx.select().from(matches).where(and(eq(matches.tournamentId, t.id), inArray(matches.stage, KNOCKOUT_STAGES)));
    const R = maxRound(ko);
    const played = (x: MatchRow) => x.status === 'completed' && !x.walkover;
    const blocked = ko.some(
      (x) =>
        played(x) &&
        ((x.stage === 'knockout' && x.round === m.round! + 1 && x.bracketSlot === Math.floor(m.bracketSlot! / 2)) || (x.stage === 'third_place' && m.round === R - 1)),
    );
    if (blocked) throw conflict('The next match for these players has been played — clear that result first');
  }
}

const maxRound = (ms: MatchRow[]) => Math.max(0, ...ms.filter((x) => x.stage === 'knockout').map((x) => x.round ?? 0));

/** Clears a result (back to "to be played"), if nothing depends on it yet. */
export async function clearResult(ctx: Ctx, actor: Actor, matchId: string) {
  await ctx.db.transaction(async (tx) => {
    const [m] = await tx.select().from(matches).where(eq(matches.id, matchId)).for('update');
    if (!m) throw notFound('Match');
    if (m.status !== 'completed' && m.status !== 'pending_confirmation') throw badRequest('This match has no result to clear');
    if (m.tournamentId) {
      const [t] = await tx.select().from(tournaments).where(eq(tournaments.id, m.tournamentId));
      if (t.status !== 'live') throw conflict('This tournament is finished — its results are final');
      await assertEditable(tx, t, m);
      if (m.walkover && m.stage === 'knockout' && m.round === 1 && (!m.homeId || !m.awayId)) throw conflict('Byes cannot be cleared');
      // Remove the winner from the next round again.
      if (m.stage === 'knockout' && m.winnerId) {
        const next = await nextMatch(tx, t.id, m);
        if (next) await tx.update(matches).set(m.bracketSlot! % 2 === 0 ? { homeId: null } : { awayId: null }).where(eq(matches.id, next.id));
      }
    }
    await tx
      .update(matches)
      .set({ homeScore: null, awayScore: null, homePens: null, awayPens: null, winnerId: null, walkover: false, status: 'scheduled', reportedBy: null, updatedAt: ctx.clock.now() })
      .where(eq(matches.id, m.id));
    await audit(tx, actor, 'match.clear', { type: 'match', id: m.id });
  });
  emit(ctx);
  return { ok: true };
}

async function nextMatch(tx: DbOrTx, tournamentId: string, m: MatchRow) {
  const [n] = await tx
    .select()
    .from(matches)
    .where(and(eq(matches.tournamentId, tournamentId), eq(matches.stage, 'knockout'), eq(matches.round, m.round! + 1), eq(matches.bracketSlot, Math.floor(m.bracketSlot! / 2))));
  return n ?? null;
}

// ───────────────────────── Progression ─────────────────────────

async function progress(ctx: Ctx, tx: DbOrTx, t: TournamentRow, m: MatchRow) {
  const all = await tx.select().from(matches).where(eq(matches.tournamentId, t.id));
  if (KNOCKOUT_STAGES.includes(m.stage)) {
    const loser = m.winnerId === m.homeId ? m.awayId : m.homeId;
    const R = maxRound(all);
    if (m.stage === 'knockout' && m.round! < R) {
      const next = await nextMatch(tx, t.id, m);
      if (next) await tx.update(matches).set(m.bracketSlot! % 2 === 0 ? { homeId: m.winnerId } : { awayId: m.winnerId }).where(eq(matches.id, next.id));
      if (m.round === R - 1 && t.thirdPlaceMatch && loser) {
        await tx
          .update(matches)
          .set(m.bracketSlot! % 2 === 0 ? { homeId: loser } : { awayId: loser })
          .where(and(eq(matches.tournamentId, t.id), eq(matches.stage, 'third_place')));
      }
    }
    if (m.winnerId) await setEntryStatus(tx, t.id, m.winnerId, 'active');
    if (loser) await setEntryStatus(tx, t.id, loser, 'eliminated');
    const fresh = await tx.select().from(matches).where(eq(matches.tournamentId, t.id));
    const final = fresh.find((x) => x.stage === 'knockout' && x.round === R);
    const third = fresh.find((x) => x.stage === 'third_place');
    if (final?.status === 'completed' && (!third || third.status === 'completed')) await completeTournament(ctx, tx, t, fresh);
    return;
  }
  if (all.some((x) => (x.stage === 'group' || x.stage === 'league') && x.status !== 'completed')) return;
  if (t.format === 'league') return completeTournament(ctx, tx, t, all);
  if (t.format === 'groups_knockout' && !all.some((x) => x.stage === 'knockout')) await drawKnockoutFromGroups(tx, t, all);
}

async function setEntryStatus(tx: DbOrTx, tournamentId: string, customerId: string, status: 'active' | 'eliminated') {
  await tx
    .update(tournamentEntries)
    .set({ status })
    .where(and(eq(tournamentEntries.tournamentId, tournamentId), eq(tournamentEntries.customerId, customerId)));
}

function groupTables(t: TournamentRow, entries: (typeof tournamentEntries.$inferSelect)[], ms: MatchRow[]) {
  const names = [...new Set(entries.map((e) => e.groupName).filter((g): g is string => !!g))].sort();
  return names.map((g) => {
    const ids = entries.filter((e) => e.groupName === g).sort((a, b) => (a.seed ?? 999) - (b.seed ?? 999)).map((e) => e.customerId);
    const played = ms.filter((m) => m.groupName === g && m.status === 'completed' && !m.walkover && m.homeScore != null) as (MatchRow & { homeId: string; awayId: string; homeScore: number; awayScore: number })[];
    return { name: g, table: standings(ids, played, { win: t.pointsWin, draw: t.pointsDraw }) };
  });
}

async function drawKnockoutFromGroups(tx: DbOrTx, t: TournamentRow, ms: MatchRow[]) {
  const entries = await tx.select().from(tournamentEntries).where(and(eq(tournamentEntries.tournamentId, t.id), ne(tournamentEntries.status, 'withdrawn')));
  const tables = groupTables(t, entries, ms);
  const qualifiers: string[] = [];
  for (let pos = 0; pos < t.advancePerGroup; pos++) for (const g of tables) if (g.table[pos]) qualifiers.push(g.table[pos].customerId);
  for (const e of entries) if (!qualifiers.includes(e.customerId)) await setEntryStatus(tx, t.id, e.customerId, 'eliminated');
  await createBracket(tx, t, qualifiers);
}

async function createBracket(tx: DbOrTx, t: TournamentRow, seeded: string[]) {
  const pairs = firstRound(seeded);
  const size = pairs.length * 2;
  const R = Math.log2(size);
  const rows: (typeof matches.$inferInsert)[] = [];
  for (let r = 1; r <= R; r++) {
    for (let slot = 0; slot < size / 2 ** r; slot++) {
      rows.push({
        gameId: t.gameId,
        tournamentId: t.id,
        stage: 'knockout',
        round: r,
        bracketSlot: slot,
        homeId: r === 1 ? pairs[slot][0] : null,
        awayId: r === 1 ? pairs[slot][1] : null,
      });
    }
  }
  if (t.thirdPlaceMatch && R >= 2) rows.push({ gameId: t.gameId, tournamentId: t.id, stage: 'third_place', round: R, bracketSlot: 0 });
  const created = await tx.insert(matches).values(rows).returning();
  // Byes: a lone player goes straight through.
  for (const m of created.filter((x) => x.round === 1 && (!x.homeId || !x.awayId))) {
    const winner = m.homeId ?? m.awayId;
    if (!winner) continue;
    await tx.update(matches).set({ status: 'completed', walkover: true, winnerId: winner, note: 'Bye' }).where(eq(matches.id, m.id));
    if (R > 1) {
      const next = created.find((x) => x.stage === 'knockout' && x.round === 2 && x.bracketSlot === Math.floor(m.bracketSlot! / 2))!;
      await tx.update(matches).set(m.bracketSlot! % 2 === 0 ? { homeId: winner } : { awayId: winner }).where(eq(matches.id, next.id));
    }
  }
}

async function completeTournament(ctx: Ctx, tx: DbOrTx, t: TournamentRow, ms: MatchRow[]) {
  const places = new Map<string, number>();
  if (t.format === 'league') {
    const entries = await tx.select().from(tournamentEntries).where(and(eq(tournamentEntries.tournamentId, t.id), ne(tournamentEntries.status, 'withdrawn')));
    const [table] = groupTables(t, entries.map((e) => ({ ...e, groupName: e.groupName ?? 'A' })), ms.map((m) => ({ ...m, groupName: m.groupName ?? 'A' })));
    table.table.forEach((row, i) => places.set(row.customerId, i + 1));
  } else {
    const R = maxRound(ms);
    const final = ms.find((x) => x.stage === 'knockout' && x.round === R)!;
    const loserOf = (m: MatchRow) => (m.winnerId === m.homeId ? m.awayId : m.homeId);
    if (final.winnerId) places.set(final.winnerId, 1);
    const ru = loserOf(final);
    if (ru) places.set(ru, 2);
    const third = ms.find((x) => x.stage === 'third_place');
    if (third?.winnerId) {
      places.set(third.winnerId, 3);
      const fourth = loserOf(third);
      if (fourth) places.set(fourth, 4);
    } else {
      for (const semi of ms.filter((x) => x.stage === 'knockout' && x.round === R - 1)) {
        const l = loserOf(semi);
        if (l && !places.has(l)) places.set(l, 3);
      }
    }
  }
  const prizeFor = (place: number) => t.prizes.find((p) => p.place === place)?.amount ?? null;
  const entries = await tx.select().from(tournamentEntries).where(eq(tournamentEntries.tournamentId, t.id));
  for (const e of entries) {
    const place = places.get(e.customerId) ?? null;
    await tx
      .update(tournamentEntries)
      .set({ finalPlace: place, prizeAmount: place ? prizeFor(place) : null, status: e.status === 'withdrawn' ? 'withdrawn' : place === 1 ? 'winner' : 'eliminated' })
      .where(eq(tournamentEntries.id, e.id));
  }
  const championId = [...places.entries()].find(([, p]) => p === 1)?.[0] ?? null;
  await tx.update(tournaments).set({ status: 'completed', championId, completedAt: ctx.clock.now(), updatedAt: ctx.clock.now() }).where(eq(tournaments.id, t.id));
  if (championId) {
    const players = await loadPlayers(tx, [championId]);
    ctx.bus.emit({ type: 'alert', level: 'info', message: `🏆 ${players.get(championId)?.name} won ${t.name}!` });
  }
}

// ───────────────────────── Tournament setup ─────────────────────────

const PrizeSchema = z.object({ place: z.number().int().min(1).max(64), amount: z.number().int().min(0), label: z.string().max(60).nullish().transform((v) => v ?? undefined) });

export const TournamentSchema = z.object({
  name: z.string().trim().min(2).max(80),
  gameId: z.string().uuid(),
  format: z.enum(['knockout', 'league', 'groups_knockout']),
  maxPlayers: z.number().int().min(2).max(256).default(16),
  groupCount: z.number().int().min(1).max(16).default(1),
  advancePerGroup: z.number().int().min(1).max(8).default(2),
  doubleRoundRobin: z.boolean().default(false),
  thirdPlaceMatch: z.boolean().default(false),
  pointsWin: z.number().int().min(0).max(10).default(3),
  pointsDraw: z.number().int().min(0).max(10).default(1),
  entryFee: z.number().int().min(0).default(0),
  prizes: z.array(PrizeSchema).max(32).default([]),
  publicRegistration: z.boolean().default(true),
  startsAt: z.string().datetime({ offset: true }).nullish(),
  description: z.string().max(2000).nullish(),
  rules: z.string().max(4000).nullish(),
});

function checkShape(b: { format: string; groupCount: number; advancePerGroup: number; maxPlayers: number }) {
  if (b.format === 'groups_knockout') {
    if (b.groupCount < 2) throw badRequest('Use at least 2 groups (or choose the League format for one group)');
    if (b.groupCount * b.advancePerGroup < 2) throw badRequest('At least 2 players must go through to the knockout stage');
    if (b.maxPlayers < b.groupCount * 2) throw badRequest('Each group needs at least 2 players — raise the player limit');
  }
}

export async function createTournament(ctx: Ctx, actor: Actor, raw: unknown) {
  const b = TournamentSchema.parse(raw);
  checkShape(b);
  const [t] = await ctx.db
    .insert(tournaments)
    .values({ ...b, prizes: b.prizes as Prize[], startsAt: b.startsAt ? new Date(b.startsAt) : null, createdBy: actor.staffId, status: 'draft' })
    .returning();
  await audit(ctx.db, actor, 'tournament.create', { type: 'tournament', id: t.id }, { name: t.name, format: t.format });
  emit(ctx);
  return t;
}

export async function updateTournament(ctx: Ctx, actor: Actor, id: string, raw: unknown) {
  const b = TournamentSchema.partial().parse(raw);
  const [cur] = await ctx.db.select().from(tournaments).where(eq(tournaments.id, id));
  if (!cur) throw notFound('Tournament');
  const structural = ['format', 'groupCount', 'advancePerGroup', 'doubleRoundRobin', 'thirdPlaceMatch', 'gameId', 'pointsWin', 'pointsDraw'] as const;
  if (!['draft', 'registration'].includes(cur.status) && structural.some((k) => b[k] !== undefined && b[k] !== cur[k])) {
    throw conflict('The format, groups and game cannot change after the tournament has started');
  }
  checkShape({ ...cur, ...b });
  const [t] = await ctx.db
    .update(tournaments)
    .set({ ...b, prizes: b.prizes as Prize[] | undefined, startsAt: b.startsAt === undefined ? undefined : b.startsAt ? new Date(b.startsAt) : null, updatedAt: ctx.clock.now() })
    .where(eq(tournaments.id, id))
    .returning();
  // Prizes changed after the finish: refresh what each place has won (unpaid ones only).
  if (t.status === 'completed' && b.prizes) {
    const entries = await ctx.db.select().from(tournamentEntries).where(eq(tournamentEntries.tournamentId, id));
    for (const e of entries) {
      if (e.finalPlace && !e.prizePaidAt) {
        await ctx.db
          .update(tournamentEntries)
          .set({ prizeAmount: t.prizes.find((p) => p.place === e.finalPlace)?.amount ?? null })
          .where(eq(tournamentEntries.id, e.id));
      }
    }
  }
  await audit(ctx.db, actor, 'tournament.update', { type: 'tournament', id }, b);
  emit(ctx);
  return t;
}

export async function setTournamentStatus(ctx: Ctx, actor: Actor, id: string, status: 'draft' | 'registration' | 'cancelled') {
  const [cur] = await ctx.db.select().from(tournaments).where(eq(tournaments.id, id));
  if (!cur) throw notFound('Tournament');
  if (cur.status === 'completed') throw conflict('This tournament is finished');
  if (cur.status === 'live' && status !== 'cancelled') throw conflict('A running tournament can only be cancelled');
  await ctx.db.update(tournaments).set({ status, updatedAt: ctx.clock.now() }).where(eq(tournaments.id, id));
  await audit(ctx.db, actor, `tournament.${status}`, { type: 'tournament', id });
  if (status === 'registration') await announceTournament(ctx, cur, actor).catch(() => {});
  emit(ctx);
  return { ok: true };
}

export async function deleteTournament(ctx: Ctx, actor: Actor, id: string) {
  const [cur] = await ctx.db.select().from(tournaments).where(eq(tournaments.id, id));
  if (!cur) throw notFound('Tournament');
  if (cur.status === 'live' || cur.status === 'completed') {
    const [played] = await ctx.db
      .select({ id: matches.id })
      .from(matches)
      .where(and(eq(matches.tournamentId, id), eq(matches.status, 'completed'), eq(matches.walkover, false)))
      .limit(1);
    if (played) throw conflict('Results have been recorded in this tournament — cancel it instead of deleting it');
  }
  await ctx.db.delete(tournaments).where(eq(tournaments.id, id));
  await audit(ctx.db, actor, 'tournament.delete', { type: 'tournament', id }, { name: cur.name });
  emit(ctx);
  return { ok: true };
}

export const EntrySchema = z.union([
  z.object({ customerId: z.string().uuid(), seed: z.number().int().min(1).max(256).nullish() }),
  z.object({
    newPlayer: z.object({
      fullName: z.string().trim().min(2).max(80),
      phone: z.string().trim().max(24).nullish(),
      gamertag: z.string().trim().min(2).max(24).nullish(),
    }),
    seed: z.number().int().min(1).max(256).nullish(),
  }),
]);

/** Adds a player (existing customer, or a new one created on the spot) before the tournament starts. */
export async function addEntry(ctx: Ctx, actor: Actor, tournamentId: string, raw: unknown, opts: { self?: boolean } = {}) {
  const b = EntrySchema.parse(raw);
  const out = await ctx.db.transaction(async (tx) => {
    const [t] = await tx.select().from(tournaments).where(eq(tournaments.id, tournamentId)).for('update');
    if (!t) throw notFound('Tournament');
    if (opts.self) {
      if (t.status !== 'registration' || !t.publicRegistration) throw conflict('Registration for this tournament is closed');
    } else if (!['draft', 'registration'].includes(t.status)) {
      throw conflict('Players can only be added before the tournament starts');
    }
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(tournamentEntries)
      .where(and(eq(tournamentEntries.tournamentId, t.id), ne(tournamentEntries.status, 'withdrawn')));
    if (n >= t.maxPlayers) throw conflict(`The tournament is full (${t.maxPlayers} players)`);
    let customerId: string;
    if ('customerId' in b) {
      customerId = b.customerId;
      const [c] = await tx.select({ id: customers.id, status: customers.status }).from(customers).where(eq(customers.id, customerId));
      if (!c) throw notFound('Customer');
      if (c.status !== 'active') throw conflict('This customer account is suspended');
    } else {
      const s = await getSettings(tx);
      const phone = b.newPlayer.phone ? normalizePhone(b.newPlayer.phone.replace(/[^0-9+]/g, ''), s.phonePrefix) : null;
      if (phone) {
        const [exists] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.phone, phone));
        if (exists) throw conflict('A customer with this phone number already exists — search for them instead');
      }
      const [c] = await tx
        .insert(customers)
        .values({ fullName: b.newPlayer.fullName, phone, gamertag: b.newPlayer.gamertag || null })
        .returning();
      customerId = c.id;
    }
    const [existing] = await tx
      .select()
      .from(tournamentEntries)
      .where(and(eq(tournamentEntries.tournamentId, t.id), eq(tournamentEntries.customerId, customerId)));
    if (existing && existing.status !== 'withdrawn') throw conflict('This player is already in the tournament');
    const [e] = existing
      ? await tx.update(tournamentEntries).set({ status: 'registered', seed: b.seed ?? null }).where(eq(tournamentEntries.id, existing.id)).returning()
      : await tx.insert(tournamentEntries).values({ tournamentId: t.id, customerId, seed: b.seed ?? null }).returning();
    await audit(tx, actor, 'tournament.entry_add', { type: 'tournament', id: t.id }, { customerId, self: !!opts.self });
    return e;
  });
  emit(ctx);
  return out;
}

export async function removeEntry(ctx: Ctx, actor: Actor, tournamentId: string, entryId: string, opts: { customerId?: string } = {}) {
  const [t] = await ctx.db.select().from(tournaments).where(eq(tournaments.id, tournamentId));
  if (!t) throw notFound('Tournament');
  const [e] = await ctx.db.select().from(tournamentEntries).where(and(eq(tournamentEntries.id, entryId), eq(tournamentEntries.tournamentId, tournamentId)));
  if (!e || (opts.customerId && e.customerId !== opts.customerId)) throw notFound('Entry');
  if (!['draft', 'registration'].includes(t.status)) throw conflict('Players cannot leave after the tournament has started — record a walkover instead');
  await ctx.db.delete(tournamentEntries).where(eq(tournamentEntries.id, e.id));
  await audit(ctx.db, actor, 'tournament.entry_remove', { type: 'tournament', id: t.id }, { customerId: e.customerId });
  emit(ctx);
  return { ok: true };
}

export const EntryPatchSchema = z.object({
  seed: z.number().int().min(1).max(256).nullish(),
  paid: z.boolean().optional(),
  paidNote: z.string().max(120).nullish(),
  /** Take the entry fee from the customer's wallet. */
  chargeWallet: z.boolean().optional(),
});

export async function patchEntry(ctx: Ctx, actor: Actor, tournamentId: string, entryId: string, raw: unknown) {
  const b = EntryPatchSchema.parse(raw);
  const out = await ctx.db.transaction(async (tx) => {
    const [t] = await tx.select().from(tournaments).where(eq(tournaments.id, tournamentId));
    const [e] = await tx.select().from(tournamentEntries).where(and(eq(tournamentEntries.id, entryId), eq(tournamentEntries.tournamentId, tournamentId)));
    if (!t || !e) throw notFound('Entry');
    if (b.seed !== undefined && !['draft', 'registration'].includes(t.status)) throw conflict('Seeds are fixed once the tournament starts');
    let paidNote = b.paidNote;
    if (b.chargeWallet) {
      if (e.paid) throw conflict('The entry fee is already paid');
      if (t.entryFee <= 0) throw badRequest('This tournament has no entry fee');
      await postWallet(tx, { customerId: e.customerId, type: 'charge', amount: -t.entryFee, actor, note: `Entry fee: ${t.name}`, at: ctx.clock.now() });
      paidNote = 'Wallet';
    }
    const [row] = await tx
      .update(tournamentEntries)
      .set({ seed: b.seed, paid: b.chargeWallet ? true : b.paid, paidNote })
      .where(eq(tournamentEntries.id, e.id))
      .returning();
    await audit(tx, actor, 'tournament.entry_update', { type: 'tournament', id: t.id }, { entryId, ...b });
    return row;
  });
  emit(ctx);
  return out;
}

/** Locks the player list, draws groups / bracket and creates every fixture. */
export async function startTournament(ctx: Ctx, actor: Actor, id: string, opts: { shuffle?: boolean } = {}) {
  await ctx.db.transaction(async (tx) => {
    const [t] = await tx.select().from(tournaments).where(eq(tournaments.id, id)).for('update');
    if (!t) throw notFound('Tournament');
    if (!['draft', 'registration'].includes(t.status)) throw conflict('This tournament has already started');
    const entries = (await tx.select().from(tournamentEntries).where(and(eq(tournamentEntries.tournamentId, id), ne(tournamentEntries.status, 'withdrawn')))).sort(
      (a, b) => (a.seed ?? 9999) - (b.seed ?? 9999) || a.createdAt.getTime() - b.createdAt.getTime(),
    );
    const n = entries.length;
    if (n < 2) throw badRequest('Add at least 2 players first');
    if (t.format === 'groups_knockout') {
      if (n < t.groupCount * 2) throw badRequest(`${t.groupCount} groups need at least ${t.groupCount * 2} players (you have ${n})`);
      if (Math.floor(n / t.groupCount) < t.advancePerGroup) throw badRequest(`Each group must have more than ${t.advancePerGroup} players — use fewer groups or fewer going through`);
    }
    let seeded = entries.map((e) => e.customerId);
    if (opts.shuffle) {
      for (let i = seeded.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [seeded[i], seeded[j]] = [seeded[j], seeded[i]];
      }
    }
    for (const [i, cid] of seeded.entries()) {
      await tx
        .update(tournamentEntries)
        .set({ seed: i + 1, status: 'active' })
        .where(and(eq(tournamentEntries.tournamentId, id), eq(tournamentEntries.customerId, cid)));
    }
    if (t.format === 'knockout') {
      await createBracket(tx, t, seeded);
    } else {
      const groups = t.format === 'league' ? new Map([['A', seeded]]) : snakeGroups(seeded, t.groupCount);
      const rows: (typeof matches.$inferInsert)[] = [];
      for (const [g, ids] of groups) {
        if (t.format === 'groups_knockout') {
          await tx.update(tournamentEntries).set({ groupName: g }).where(and(eq(tournamentEntries.tournamentId, id), inArray(tournamentEntries.customerId, ids)));
        }
        for (const f of roundRobin(ids, t.doubleRoundRobin)) {
          rows.push({ gameId: t.gameId, tournamentId: id, stage: t.format === 'league' ? 'league' : 'group', groupName: t.format === 'league' ? null : g, round: f.round, homeId: f.homeId, awayId: f.awayId });
        }
      }
      if (rows.length) await tx.insert(matches).values(rows);
    }
    await tx.update(tournaments).set({ status: 'live', startedAt: ctx.clock.now(), updatedAt: ctx.clock.now() }).where(eq(tournaments.id, id));
    await audit(tx, actor, 'tournament.start', { type: 'tournament', id }, { players: n, shuffle: !!opts.shuffle });
    // A 2-player knockout with a bye cannot happen, but a bracket of byes could already finish a round.
  });
  emit(ctx);
  return tournamentDetail(ctx, id, { staff: true });
}

export const PrizePayoutSchema = z.object({
  method: z.enum(['wallet', 'cash', 'mobile_money', 'bank_transfer', 'other']),
  note: z.string().max(120).nullish(),
});

/** Marks a prize as paid; "wallet" credits the winner's wallet straight away. */
export async function payPrize(ctx: Ctx, actor: Actor, tournamentId: string, entryId: string, raw: unknown) {
  const b = PrizePayoutSchema.parse(raw);
  const out = await ctx.db.transaction(async (tx) => {
    const [t] = await tx.select().from(tournaments).where(eq(tournaments.id, tournamentId));
    const [e] = await tx.select().from(tournamentEntries).where(and(eq(tournamentEntries.id, entryId), eq(tournamentEntries.tournamentId, tournamentId))).for('update');
    if (!t || !e) throw notFound('Entry');
    if (t.status !== 'completed') throw conflict('Prizes are paid after the tournament has finished');
    if (!e.prizeAmount) throw badRequest('This player has no prize');
    if (e.prizePaidAt) throw conflict('This prize has already been paid');
    if (b.method === 'wallet') {
      if (!actor.permissions?.includes('wallet.adjust')) throw badRequest('Paying a prize into a wallet needs the "wallet adjustments" permission');
      await postWallet(tx, { customerId: e.customerId, type: 'bonus', amount: e.prizeAmount, actor, note: `Prize: ${t.name} (place ${e.finalPlace})`, at: ctx.clock.now() });
    }
    const label = { wallet: 'Wallet', cash: 'Cash', mobile_money: 'Mobile money', bank_transfer: 'Bank transfer', other: 'Other' }[b.method];
    const [row] = await tx
      .update(tournamentEntries)
      .set({ prizePaidAt: ctx.clock.now(), prizePaidNote: [label, b.note].filter(Boolean).join(' · ') })
      .where(eq(tournamentEntries.id, e.id))
      .returning();
    await audit(tx, actor, 'tournament.prize_paid', { type: 'tournament', id: t.id }, { customerId: e.customerId, amount: e.prizeAmount, method: b.method });
    return row;
  });
  emit(ctx);
  return out;
}

// ───────────────────────── Views ─────────────────────────

export async function listTournaments(ctx: Ctx, opts: { publicOnly?: boolean; viewerId?: string | null } = {}) {
  const rows = await ctx.db
    .select({ t: tournaments, gameName: games.name })
    .from(tournaments)
    .innerJoin(games, eq(games.id, tournaments.gameId))
    .orderBy(desc(tournaments.createdAt));
  const visible = rows.filter((r) => !opts.publicOnly || r.t.status !== 'draft');
  const ids = visible.map((r) => r.t.id);
  const entries = ids.length ? await ctx.db.select().from(tournamentEntries).where(and(inArray(tournamentEntries.tournamentId, ids), ne(tournamentEntries.status, 'withdrawn'))) : [];
  const champs = await loadPlayers(ctx.db, visible.map((r) => r.t.championId));
  const order = { live: 0, registration: 1, draft: 2, completed: 3, cancelled: 4 } as const;
  return visible
    .map(({ t, gameName }) => ({
      id: t.id,
      number: t.number,
      name: t.name,
      gameId: t.gameId,
      gameName,
      format: t.format,
      status: t.status,
      maxPlayers: t.maxPlayers,
      players: entries.filter((e) => e.tournamentId === t.id).length,
      entryFee: t.entryFee,
      prizePool: t.prizes.reduce((s, p) => s + p.amount, 0),
      startsAt: t.startsAt?.toISOString() ?? null,
      publicRegistration: t.publicRegistration,
      champion: ref(champs.get(t.championId ?? ''), !opts.publicOnly),
      registered: opts.viewerId ? entries.some((e) => e.tournamentId === t.id && e.customerId === opts.viewerId) : undefined,
    }))
    .sort((a, b) => order[a.status] - order[b.status] || (b.startsAt ?? '').localeCompare(a.startsAt ?? ''));
}

export async function tournamentDetail(ctx: Ctx, id: string, opts: { staff?: boolean; viewerId?: string | null } = {}) {
  const staff = !!opts.staff;
  const [row] = await ctx.db.select({ t: tournaments, game: games }).from(tournaments).innerJoin(games, eq(games.id, tournaments.gameId)).where(eq(tournaments.id, id));
  if (!row || (!staff && row.t.status === 'draft')) throw notFound('Tournament');
  const { t, game } = row;
  const entries = (await ctx.db.select().from(tournamentEntries).where(eq(tournamentEntries.tournamentId, id)).orderBy(asc(tournamentEntries.seed), asc(tournamentEntries.createdAt))).filter(
    (e) => e.status !== 'withdrawn',
  );
  const ms = await ctx.db.select().from(matches).where(eq(matches.tournamentId, id)).orderBy(asc(matches.round), asc(matches.bracketSlot), asc(matches.number));
  const players = await loadPlayers(ctx.db, [...entries.map((e) => e.customerId), ...ms.flatMap((m) => [m.homeId, m.awayId])]);
  const view = (m: MatchRow) => matchView(m, players, staff);

  const groups =
    t.format === 'knockout'
      ? []
      : groupTables(
          t,
          entries.map((e) => ({ ...e, groupName: e.groupName ?? (t.format === 'league' ? 'A' : null) })),
          ms.filter((m) => m.stage === 'league' || m.stage === 'group').map((m) => ({ ...m, groupName: m.groupName ?? 'A' })),
        ).map((g) => ({
          name: t.format === 'league' ? 'League' : `Group ${g.name}`,
          key: g.name,
          table: g.table.map((r, i) => ({ ...r, position: i + 1, player: ref(players.get(r.customerId), staff), qualifies: t.format === 'groups_knockout' && i < t.advancePerGroup })),
        }));

  const ko = ms.filter((m) => m.stage === 'knockout');
  const R = Math.max(0, ...ko.map((m) => m.round ?? 0));
  const bracket = {
    rounds: Array.from({ length: R }, (_, i) => ({ round: i + 1, name: roundName(i + 1, R), matches: ko.filter((m) => m.round === i + 1).map(view) })),
    thirdPlace: ms.find((m) => m.stage === 'third_place') ? view(ms.find((m) => m.stage === 'third_place')!) : null,
  };
  const rr = ms.filter((m) => m.stage === 'league' || m.stage === 'group');
  const rounds = [...new Set(rr.map((m) => m.round ?? 0))].sort((a, b) => a - b).map((r) => ({ round: r, matches: rr.filter((m) => m.round === r).map(view) }));

  const goals = new Map<string, { goals: number; played: number; conceded: number }>();
  for (const m of ms) {
    if (m.status !== 'completed' || m.walkover || m.homeScore == null) continue;
    for (const [pid, gf, ga] of [
      [m.homeId!, m.homeScore, m.awayScore!],
      [m.awayId!, m.awayScore!, m.homeScore],
    ] as const) {
      const g = goals.get(pid) ?? { goals: 0, played: 0, conceded: 0 };
      g.goals += gf;
      g.conceded += ga;
      g.played++;
      goals.set(pid, g);
    }
  }
  const topScorers = [...goals.entries()]
    .map(([pid, g]) => ({ player: ref(players.get(pid), staff), ...g }))
    .sort((a, b) => b.goals - a.goals || a.played - b.played)
    .slice(0, 10);

  const real = ms.filter((m) => !(m.walkover && m.note === 'Bye'));
  return {
    tournament: { ...t, gameName: game.name, scoring: game.scoring, allowDraws: game.allowDraws },
    entries: entries.map((e) => ({
      id: e.id,
      player: ref(players.get(e.customerId), staff),
      seed: e.seed,
      groupName: e.groupName,
      status: e.status,
      finalPlace: e.finalPlace,
      prizeAmount: e.prizeAmount,
      prizePaid: !!e.prizePaidAt,
      ...(staff ? { paid: e.paid, paidNote: e.paidNote, prizePaidNote: e.prizePaidNote, customerId: e.customerId } : {}),
    })),
    groups,
    rounds,
    bracket,
    topScorers,
    progress: { played: real.filter((m) => m.status === 'completed').length, total: real.length },
    prizePool: t.prizes.reduce((s, p) => s + p.amount, 0),
    entryFeesCollected: staff ? entries.filter((e) => e.paid).length * t.entryFee : undefined,
    champion: ref(players.get(t.championId ?? ''), staff),
    myEntry: opts.viewerId ? (entries.find((e) => e.customerId === opts.viewerId)?.id ?? null) : undefined,
    upcoming: ms.filter((m) => m.status === 'scheduled' && m.homeId && m.awayId).slice(0, 12).map(view),
  };
}

/** Opening registration posts the tournament on the portal News page (once). */
async function announceTournament(ctx: Ctx, t: typeof tournaments.$inferSelect, actor: Actor) {
  const [exists] = await ctx.db.select({ id: posts.id }).from(posts).where(eq(posts.tournamentId, t.id)).limit(1);
  if (exists) return;
  const settings = await getSettings(ctx.db);
  const money = (v: number) => `${settings.currencyCode} ${(v / 10 ** settings.currencyMinorUnits).toFixed(settings.currencyMinorUnits)}`;
  const prizes = (t.prizes ?? []).filter((p) => p.amount > 0);
  const lines = [
    t.description ?? '',
    t.startsAt ? `Starts: ${t.startsAt.toLocaleString('en-GB', { timeZone: settings.timezone, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : '',
    `Players: up to ${t.maxPlayers}`,
    t.entryFee > 0 ? `Entry: ${money(t.entryFee)}` : 'Entry: free',
    prizes.length ? `Prizes: ${prizes.map((p) => `#${p.place} ${money(p.amount)}`).join(' · ')}` : '',
    t.publicRegistration ? 'Register in the app (Cups tab) or at the counter.' : 'Register at the counter.',
  ].filter(Boolean);
  const now = ctx.clock.now();
  await ctx.db.insert(posts).values({
    kind: 'tournament',
    title: `🏆 ${t.name} — registration open`,
    body: lines.join(String.fromCharCode(10)),
    linkUrl: '/portal/cups',
    linkLabel: 'Register',
    eventAt: t.startsAt,
    tournamentId: t.id,
    createdBy: actor.staffId,
    createdAt: now,
    updatedAt: now,
  });
  ctx.bus.emit({ type: 'posts.changed' });
}
