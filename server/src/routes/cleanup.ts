/**
 * Deleting things and clearing whole areas.
 *
 * Rules that keep the money side correct:
 *  - Anything that past payments, sessions or results point to is never torn out. It is *hidden* instead
 *    (customers: personal details wiped; prices / promotions: marked deleted and switched off).
 *  - Things with nothing pointing at them are removed completely.
 *  - "Clear everything" actions need the signed-in person's password and are written to the audit trail.
 */
import { outstandingFor } from '../services/sessions.js';
import { and, count, eq, gt, inArray, isNull, like, lt, ne, notInArray, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorOf } from '../auth/plugin.js';
import type { Actor, Ctx } from '../context.js';
import type { DbOrTx } from '../db/index.js';
import {
  auditLogs,
  bookings,
  chatMessages,
  customers,
  happyHours,
  matches,
  matchRequests,
  membershipTiers,
  momoRequests,
  momoSms,
  posts,
  pricingPlans,
  promoCodes,
  rewardClaims,
  rewardOffers,
  sessions,
  socialPosts,
  staff,
  tournamentEntries,
  tournaments,
} from '../db/schema.js';
import { AppError, conflict, notFound, parse } from '../lib/errors.js';
import { verifyPassword } from '../lib/password.js';
import { audit } from '../services/audit.js';
import { hideNews, unhideAllNews } from '../services/newsfeed.js';

const isFk = (e: unknown) => {
  const c = (e as { code?: string; cause?: { code?: string } })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;
  return c === '23503';
};

/** Why this customer cannot be deleted yet, or null. */
async function customerBlocker(db: DbOrTx, id: string) {
  const [c] = await db.select().from(customers).where(eq(customers.id, id));
  if (!c || c.deletedAt) return 'not found';
  if (c.balance !== 0) return 'still has money in their wallet (take it out or set it to 0 first)';
  if (c.savedSeconds > 0) return 'still has saved playing time';
  const [open] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.customerId, id), ne(sessions.status, 'ended')))
    .limit(1);
  if (open) return 'is playing right now';
  if ((await outstandingFor(db, id)) > 0) return 'still owes money on their account (unpaid tab)';
  return null;
}

/**
 * Removes one customer. Returns 'deleted' (gone completely) or 'hidden' (personal details wiped,
 * row kept because payments / results point to it).
 */
export async function removeCustomer(ctx: Ctx, id: string): Promise<'deleted' | 'hidden'> {
  const why = await customerBlocker(ctx.db, id);
  if (why === 'not found') throw notFound('Customer');
  if (why) throw conflict(`This customer ${why}`);
  const now = ctx.clock.now();
  return ctx.db.transaction(async (tx) => {
    // Things that only belong to this customer.
    await tx.delete(chatMessages).where(or(eq(chatMessages.customerId, id), like(chatMessages.room, `dm:%${id}%`)));
    await tx.delete(rewardClaims).where(eq(rewardClaims.customerId, id));
    await tx.update(matchRequests).set({ targetCustomerId: null }).where(eq(matchRequests.targetCustomerId, id));
    await tx.update(matchRequests).set({ opponentId: null }).where(eq(matchRequests.opponentId, id));
    await tx.delete(matchRequests).where(eq(matchRequests.customerId, id));
    await tx
      .update(bookings)
      .set({ status: 'cancelled' })
      .where(and(eq(bookings.customerId, id), inArray(bookings.status, ['pending', 'confirmed']), gt(bookings.endAt, now)));
    const notStarted = await tx.select({ id: tournaments.id }).from(tournaments).where(inArray(tournaments.status, ['draft', 'registration']));
    if (notStarted.length)
      await tx.delete(tournamentEntries).where(and(eq(tournamentEntries.customerId, id), inArray(tournamentEntries.tournamentId, notStarted.map((t) => t.id))));
    await tx.update(momoRequests).set({ status: 'expired' }).where(and(eq(momoRequests.customerId, id), eq(momoRequests.status, 'pending')));
    try {
      await tx.transaction(async (sp) => {
        await sp.delete(customers).where(eq(customers.id, id));
      });
      return 'deleted' as const;
    } catch (e) {
      if (!isFk(e)) throw e;
    }
    const [c] = await tx.select({ v: customers.portalTokenVersion }).from(customers).where(eq(customers.id, id));
    await tx
      .update(customers)
      .set({
        fullName: 'Deleted customer',
        phone: null,
        email: null,
        notes: null,
        passwordHash: null,
        portalEnabled: false,
        portalTokenVersion: (c?.v ?? 0) + 1,
        activationCodeHash: null,
        activationExpiresAt: null,
        gamertag: null,
        psnId: null,
        eaId: null,
        avatar: null,
        avatarAt: null,
        leaderboardHidden: true,
        chatMuted: true,
        creditLimit: 0,
        status: 'suspended',
        deletedAt: now,
        updatedAt: now,
      })
      .where(eq(customers.id, id));
    return 'hidden' as const;
  });
}

/** Deletes a tournament with everything in it (entries, its matches). */
async function dropTournament(db: DbOrTx, id: string) {
  const ms = await db.select({ id: matches.id }).from(matches).where(eq(matches.tournamentId, id));
  if (ms.length) await db.update(matchRequests).set({ matchId: null }).where(inArray(matchRequests.matchId, ms.map((m) => m.id)));
  await db.update(posts).set({ tournamentId: null }).where(eq(posts.tournamentId, id));
  await db.delete(tournaments).where(eq(tournaments.id, id));
}

export const CLEAR_AREAS = {
  customers: 'Customers (those with money, saved time or an unpaid tab are skipped)',
  leaderboard: 'Leaderboard: friendly match results',
  tournaments: 'Tournaments (with their players and matches)',
  matchmaking: 'Find match requests',
  chat: 'Customer chat messages',
  rewardClaims: 'Reward claims',
  bookings: 'Old bookings (past, cancelled, no-show)',
  momo: 'MoMo inbox: unmatched texts and unpaid requests',
  news: 'News & posters posts',
  outsideNews: 'Game news from other websites (hides what is showing now)',
  socialDrafts: 'Social ideas and drafts (posted ones stay)',
  audit: 'Audit trail',
} as const;
type Area = keyof typeof CLEAR_AREAS;

async function counts(ctx: Ctx, gameId?: string) {
  const n = async (q: Promise<{ n: number }[]>) => Number((await q)[0]?.n ?? 0);
  const now = ctx.clock.now();
  return {
    customers: await n(ctx.db.select({ n: count() }).from(customers).where(isNull(customers.deletedAt))),
    leaderboard: await n(
      ctx.db
        .select({ n: count() })
        .from(matches)
        .where(and(isNull(matches.tournamentId), gameId ? eq(matches.gameId, gameId) : undefined)),
    ),
    tournaments: await n(ctx.db.select({ n: count() }).from(tournaments)),
    matchmaking: await n(ctx.db.select({ n: count() }).from(matchRequests)),
    chat: await n(ctx.db.select({ n: count() }).from(chatMessages)),
    rewardClaims: await n(ctx.db.select({ n: count() }).from(rewardClaims)),
    bookings: await n(
      ctx.db
        .select({ n: count() })
        .from(bookings)
        .where(or(notInArray(bookings.status, ['pending', 'confirmed']), lt(bookings.endAt, now))),
    ),
    momo:
      (await n(ctx.db.select({ n: count() }).from(momoSms).where(ne(momoSms.status, 'matched')))) +
      (await n(ctx.db.select({ n: count() }).from(momoRequests).where(and(ne(momoRequests.status, 'confirmed'), isNull(momoRequests.paymentId))))),
    news: await n(ctx.db.select({ n: count() }).from(posts)),
    outsideNews: 0,
    socialDrafts: await n(ctx.db.select({ n: count() }).from(socialPosts).where(ne(socialPosts.status, 'posted'))),
    audit: await n(ctx.db.select({ n: count() }).from(auditLogs)),
  } satisfies Record<Area, number>;
}

async function clearArea(ctx: Ctx, actor: Actor, area: Area, o: { gameId?: string; olderThanDays?: number }) {
  const db = ctx.db;
  const now = ctx.clock.now();
  switch (area) {
    case 'customers': {
      const all = await db.select({ id: customers.id }).from(customers).where(isNull(customers.deletedAt));
      let deleted = 0;
      let hidden = 0;
      let skipped = 0;
      for (const c of all) {
        try {
          if ((await removeCustomer(ctx, c.id)) === 'deleted') deleted++;
          else hidden++;
        } catch {
          skipped++;
        }
      }
      ctx.bus.emit({ type: 'customers.changed', customerId: '' });
      return { removed: deleted + hidden, skipped, note: skipped ? `${skipped} kept: they have money, saved time, an unpaid tab or are playing` : undefined };
    }
    case 'leaderboard': {
      const ms = await db
        .select({ id: matches.id })
        .from(matches)
        .where(and(isNull(matches.tournamentId), o.gameId ? eq(matches.gameId, o.gameId) : undefined));
      if (ms.length) {
        const ids = ms.map((m) => m.id);
        await db.update(matchRequests).set({ matchId: null }).where(inArray(matchRequests.matchId, ids));
        await db.delete(matches).where(inArray(matches.id, ids));
      }
      ctx.bus.emit({ type: 'competitions.changed' });
      return { removed: ms.length };
    }
    case 'tournaments': {
      const ts = await db.select({ id: tournaments.id }).from(tournaments);
      for (const t of ts) await dropTournament(db, t.id);
      ctx.bus.emit({ type: 'competitions.changed' });
      return { removed: ts.length };
    }
    case 'matchmaking': {
      const r = await db.delete(matchRequests).returning({ id: matchRequests.id });
      ctx.bus.emit({ type: 'competitions.changed' });
      return { removed: r.length };
    }
    case 'chat': {
      const r = await db.delete(chatMessages).returning({ id: chatMessages.id });
      ctx.bus.emit({ type: 'chat.changed', room: 'lobby' });
      return { removed: r.length };
    }
    case 'rewardClaims': {
      const r = await db.delete(rewardClaims).returning({ id: rewardClaims.id });
      await db.update(rewardOffers).set({ claimsCount: 0 });
      ctx.bus.emit({ type: 'rewards.changed' });
      return { removed: r.length };
    }
    case 'bookings': {
      const r = await db
        .delete(bookings)
        .where(or(notInArray(bookings.status, ['pending', 'confirmed']), lt(bookings.endAt, now)))
        .returning({ id: bookings.id });
      ctx.bus.emit({ type: 'bookings.changed' });
      return { removed: r.length };
    }
    case 'momo': {
      const a = await db.delete(momoSms).where(ne(momoSms.status, 'matched')).returning({ id: momoSms.id });
      const b = await db.delete(momoRequests).where(and(ne(momoRequests.status, 'confirmed'), isNull(momoRequests.paymentId))).returning({ id: momoRequests.id });
      ctx.bus.emit({ type: 'momo.changed' });
      return { removed: a.length + b.length };
    }
    case 'news': {
      const r = await db.delete(posts).returning({ id: posts.id });
      ctx.bus.emit({ type: 'posts.changed' });
      return { removed: r.length };
    }
    case 'outsideNews': {
      const n = await hideNews(ctx, 'all');
      ctx.bus.emit({ type: 'posts.changed' });
      return { removed: n };
    }
    case 'socialDrafts': {
      const r = await db.delete(socialPosts).where(ne(socialPosts.status, 'posted')).returning({ id: socialPosts.id });
      ctx.bus.emit({ type: 'social.changed' });
      return { removed: r.length };
    }
    case 'audit': {
      const before = o.olderThanDays ? new Date(now.getTime() - o.olderThanDays * 86_400_000) : null;
      const r = await db
        .delete(auditLogs)
        .where(before ? lt(auditLogs.createdAt, before) : undefined)
        .returning({ id: auditLogs.id });
      return { removed: r.length };
    }
  }
}

export async function cleanupRoutes(app: FastifyInstance, ctx: Ctx) {
  const admin = { preHandler: app.auth('settings.manage') };

  // ── Customers ──
  app.delete<{ Params: { id: string } }>('/api/customers/:id', { preHandler: app.auth('customers.manage') }, async (req) => {
    const [c] = await ctx.db.select({ fullName: customers.fullName, number: customers.number }).from(customers).where(eq(customers.id, req.params.id));
    const r = await removeCustomer(ctx, req.params.id);
    await audit(ctx.db, actorOf(req), 'customer.delete', { type: 'customer', id: req.params.id }, { name: c?.fullName, number: c?.number, kept: r === 'hidden' });
    ctx.bus.emit({ type: 'customers.changed', customerId: req.params.id });
    return { ok: true, removed: r };
  });

  // ── Pricing ──
  app.delete<{ Params: { id: string } }>('/api/pricing-plans/:id', { preHandler: app.auth('pricing.manage') }, async (req) => {
    const [cur] = await ctx.db.select().from(pricingPlans).where(and(eq(pricingPlans.id, req.params.id), isNull(pricingPlans.deletedAt)));
    if (!cur) throw notFound('Price');
    const [open] = await ctx.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.planId, cur.id), ne(sessions.status, 'ended')))
      .limit(1);
    if (open) throw conflict('A session is using this price right now — end it first');
    let removed: 'deleted' | 'hidden' = 'deleted';
    try {
      await ctx.db.transaction(async (tx) => {
        await tx.delete(pricingPlans).where(eq(pricingPlans.id, cur.id));
      });
    } catch (e) {
      if (!isFk(e)) throw e;
      removed = 'hidden';
      await ctx.db.update(pricingPlans).set({ active: false, deletedAt: ctx.clock.now() }).where(eq(pricingPlans.id, cur.id));
    }
    await audit(ctx.db, actorOf(req), 'pricing_plan.delete', { type: 'pricing_plan', id: cur.id }, { name: cur.name, kept: removed === 'hidden' });
    ctx.bus.emit({ type: 'stations.changed' });
    return { ok: true, removed };
  });
  app.delete<{ Params: { id: string } }>('/api/membership-tiers/:id', { preHandler: app.auth('pricing.manage') }, async (req) => {
    const [cur] = await ctx.db.select().from(membershipTiers).where(eq(membershipTiers.id, req.params.id));
    if (!cur) throw notFound('Membership');
    await ctx.db.update(customers).set({ tierId: null }).where(eq(customers.tierId, cur.id));
    await ctx.db.delete(membershipTiers).where(eq(membershipTiers.id, cur.id));
    await audit(ctx.db, actorOf(req), 'membership_tier.delete', { type: 'membership_tier', id: cur.id }, { name: cur.name });
    return { ok: true };
  });

  // ── Promotions ──
  const manage = { preHandler: app.auth('pricing.manage') };
  app.delete<{ Params: { id: string } }>('/api/happy-hours/:id', manage, async (req) => {
    const [cur] = await ctx.db.select().from(happyHours).where(and(eq(happyHours.id, req.params.id), isNull(happyHours.deletedAt)));
    if (!cur) throw notFound('Happy hour');
    let removed: 'deleted' | 'hidden' = 'deleted';
    try {
      await ctx.db.transaction(async (tx) => {
        await tx.delete(happyHours).where(eq(happyHours.id, cur.id));
      });
    } catch (e) {
      if (!isFk(e)) throw e;
      removed = 'hidden';
      await ctx.db.update(happyHours).set({ active: false, deletedAt: ctx.clock.now() }).where(eq(happyHours.id, cur.id));
    }
    await audit(ctx.db, actorOf(req), 'happy_hour.delete', { type: 'happy_hour', id: cur.id }, { name: cur.name, kept: removed === 'hidden' });
    return { ok: true, removed };
  });
  app.delete<{ Params: { id: string } }>('/api/promo-codes/:id', manage, async (req) => {
    const [cur] = await ctx.db.select().from(promoCodes).where(and(eq(promoCodes.id, req.params.id), isNull(promoCodes.deletedAt)));
    if (!cur) throw notFound('Promo code');
    let removed: 'deleted' | 'hidden' = 'deleted';
    try {
      await ctx.db.transaction(async (tx) => {
        await tx.delete(promoCodes).where(eq(promoCodes.id, cur.id));
      });
    } catch (e) {
      if (!isFk(e)) throw e;
      removed = 'hidden';
      // Free the code so it can be made again later.
      const now = ctx.clock.now();
      await ctx.db
        .update(promoCodes)
        .set({ active: false, showInPortal: false, deletedAt: now, code: `${cur.code}~DEL${now.getTime().toString(36).toUpperCase()}` })
        .where(eq(promoCodes.id, cur.id));
    }
    await audit(ctx.db, actorOf(req), 'promo_code.delete', { type: 'promo_code', id: cur.id }, { code: cur.code, kept: removed === 'hidden' });
    return { ok: true, removed };
  });

  // ── Competitions ──
  const comp = { preHandler: app.auth('competitions.manage') };
  app.delete<{ Params: { id: string } }>('/api/matchmaking/requests/:id', comp, async (req) => {
    const r = await ctx.db.delete(matchRequests).where(eq(matchRequests.id, req.params.id)).returning({ id: matchRequests.id });
    if (!r.length) throw notFound('Request');
    await audit(ctx.db, actorOf(req), 'match_request.delete', { type: 'match_request', id: req.params.id });
    ctx.bus.emit({ type: 'competitions.changed' });
    return { ok: true };
  });
  /** Deletes a tournament even after results (with everything in it). */
  app.delete<{ Params: { id: string } }>('/api/tournaments/:id/everything', comp, async (req) => {
    const [cur] = await ctx.db.select().from(tournaments).where(eq(tournaments.id, req.params.id));
    if (!cur) throw notFound('Tournament');
    await ctx.db.transaction((tx) => dropTournament(tx, cur.id));
    await audit(ctx.db, actorOf(req), 'tournament.delete', { type: 'tournament', id: cur.id }, { name: cur.name, withResults: true });
    ctx.bus.emit({ type: 'competitions.changed' });
    return { ok: true };
  });

  // ── Rewards ──
  app.delete<{ Params: { id: string } }>('/api/rewards/claims/:id', { preHandler: app.auth('rewards.manage') }, async (req) => {
    const [cl] = await ctx.db.delete(rewardClaims).where(eq(rewardClaims.id, req.params.id)).returning();
    if (!cl) throw notFound('Claim');
    await ctx.db
      .update(rewardOffers)
      .set({ claimsCount: sql`greatest(${rewardOffers.claimsCount} - 1, 0)` })
      .where(eq(rewardOffers.id, cl.offerId));
    await audit(ctx.db, actorOf(req), 'reward_claim.delete', { type: 'reward_claim', id: cl.id }, { status: cl.status });
    ctx.bus.emit({ type: 'rewards.changed' });
    return { ok: true };
  });

  // ── Chat ──
  app.delete<{ Querystring: { room?: string } }>('/api/chat/room', { preHandler: app.auth('chat.moderate') }, async (req) => {
    const room = parse(z.object({ room: z.string().min(1).max(120) }), req.query).room;
    const r = await ctx.db.delete(chatMessages).where(eq(chatMessages.room, room)).returning({ id: chatMessages.id });
    await audit(ctx.db, actorOf(req), 'chat.clear', { type: 'chat_room', id: room }, { messages: r.length });
    ctx.bus.emit({ type: 'chat.changed', room });
    return { ok: true, removed: r.length };
  });

  // ── Outside news ──
  app.post('/api/news-feeds/hide', { preHandler: app.auth('content.manage') }, async (req) => {
    const b = parse(z.object({ url: z.string().min(1).max(2000) }), req.body);
    await hideNews(ctx, [b.url]);
    ctx.bus.emit({ type: 'posts.changed' });
    return { ok: true };
  });
  app.post('/api/news-feeds/hide-all', { preHandler: app.auth('content.manage') }, async (req) => {
    await hideNews(ctx, 'all');
    await audit(ctx.db, actorOf(req), 'news.hide_all');
    ctx.bus.emit({ type: 'posts.changed' });
    return { ok: true };
  });
  app.post('/api/news-feeds/unhide-all', { preHandler: app.auth('content.manage') }, async () => {
    await unhideAllNews(ctx);
    ctx.bus.emit({ type: 'posts.changed' });
    return { ok: true };
  });

  // ── Audit ──
  app.delete<{ Params: { id: string } }>('/api/audit/:id', admin, async (req) => {
    const r = await ctx.db.delete(auditLogs).where(eq(auditLogs.id, req.params.id)).returning({ action: auditLogs.action });
    if (!r.length) throw notFound('Audit entry');
    await audit(ctx.db, actorOf(req), 'audit.delete', { type: 'audit', id: req.params.id }, { action: r[0].action });
    return { ok: true };
  });

  // ── Clear whole areas (System → Clean up) ──
  app.get<{ Querystring: { gameId?: string } }>('/api/cleanup', admin, async (req) => {
    const q = parse(z.object({ gameId: z.string().uuid().optional() }), req.query);
    return { areas: CLEAR_AREAS, counts: await counts(ctx, q.gameId) };
  });
  app.post('/api/cleanup', admin, async (req) => {
    const b = parse(
      z.object({
        areas: z.array(z.enum(Object.keys(CLEAR_AREAS) as [Area, ...Area[]])).min(1),
        password: z.string().min(1, 'Type your password to confirm'),
        gameId: z.string().uuid().optional(),
        olderThanDays: z.number().int().min(1).max(3650).optional(),
      }),
      req.body,
    );
    const [me] = await ctx.db.select().from(staff).where(eq(staff.id, req.staff!.id));
    if (!me || !(await verifyPassword(b.password, me.passwordHash))) throw new AppError(403, 'Password is incorrect', 'bad_password');
    const actor = actorOf(req);
    const results: Record<string, { removed: number; skipped?: number; note?: string }> = {};
    for (const a of b.areas) results[a] = await clearArea(ctx, actor, a, b);
    await audit(ctx.db, actor, 'data.clear', undefined, { areas: b.areas, results, gameId: b.gameId, olderThanDays: b.olderThanDays });
    return { ok: true, results };
  });
}
