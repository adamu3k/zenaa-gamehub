/**
 * Rewards in the customer portal:
 *  - "Follow us": follow / subscribe to the venue's page (YouTube, TikTok…) and get a wallet bonus. The app can't
 *    see who followed, so by default staff check the customer's username first ("needs approval").
 *  - Bonus codes: a word staff share (on a poster, a live stream, a WhatsApp status) that gives a wallet bonus once
 *    per customer.
 *  - Promo codes marked "show in the customer app" are listed so customers can use them at the counter.
 * Each reward pays out at most once per customer.
 */
import { and, asc, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Actor, Ctx } from '../context.js';
import { customers, promoCodes, rewardClaims, rewardOffers } from '../db/schema.js';
import { AppError, badRequest, conflict, notFound, pgErrorCode } from '../lib/errors.js';
import { audit } from './audit.js';
import { getSettings } from './settings.js';
import { postWallet } from './wallet.js';
import { customerPackages } from './promo-packages.js';

export const PLATFORMS = ['youtube', 'tiktok', 'instagram', 'facebook', 'x', 'snapchat', 'whatsapp', 'website'] as const;

export const OfferSchema = z
  .object({
    kind: z.enum(['follow', 'code']),
    title: z.string().trim().min(2).max(80),
    description: z.string().trim().max(300).nullish(),
    platform: z.enum(PLATFORMS).nullish(),
    url: z
      .string()
      .trim()
      .max(300)
      .regex(/^https?:\/\//i, 'Link must start with https://')
      .or(z.literal(''))
      .nullish(),
    code: z
      .string()
      .trim()
      .max(30)
      .regex(/^[A-Za-z0-9_-]*$/, 'Use letters, numbers, - and _ only')
      .transform((c) => c.toUpperCase())
      .nullish(),
    bonusAmount: z.number().int().min(0).max(100_000_000),
    promoCode: z.string().trim().max(30).nullish(),
    needsApproval: z.boolean().default(true),
    maxClaims: z.number().int().positive().nullish(),
    validTo: z.coerce.date().nullish(),
    active: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(999).default(0),
  });

function checkOffer(o: { kind: string; url?: string | null; code?: string | null; bonusAmount: number; promoCode?: string | null }) {
  if (o.kind === 'follow' && !o.url) throw badRequest('Add the link to your page (e.g. your YouTube channel)');
  if (o.kind === 'code' && (!o.code || o.code.length < 3)) throw badRequest('Type the bonus code customers will enter (at least 3 letters)');
  if (!o.bonusAmount && !o.promoCode) throw badRequest('Give a bonus amount or a promo code (or both)');
}

async function rewardsOn(ctx: Ctx) {
  if (!(await getSettings(ctx.db)).rewardsEnabled) throw new AppError(403, 'Rewards are switched off', 'rewards_off');
}

const isLive = (o: typeof rewardOffers.$inferSelect, now: Date) =>
  o.active && (!o.validTo || o.validTo > now) && (o.maxClaims == null || o.claimsCount < o.maxClaims);

// ───────── Staff ─────────

export async function listOffers(ctx: Ctx) {
  const offers = await ctx.db.select().from(rewardOffers).orderBy(desc(rewardOffers.active), asc(rewardOffers.sortOrder), desc(rewardOffers.createdAt));
  return offers;
}

export async function createOffer(ctx: Ctx, actor: Actor, raw: unknown) {
  const b = OfferSchema.parse(raw);
  checkOffer(b);
  if (b.kind === 'code') await codeFree(ctx, b.code!);
  const now = ctx.clock.now();
  const [o] = await ctx.db
    .insert(rewardOffers)
    .values({ ...b, url: b.url || null, code: b.kind === 'code' ? b.code : null, platform: b.kind === 'follow' ? (b.platform ?? null) : null, needsApproval: b.kind === 'follow' ? b.needsApproval : false, promoCode: b.promoCode || null, createdAt: now, updatedAt: now })
    .returning();
  await audit(ctx.db, actor, 'reward.create', { type: 'reward_offer', id: o.id }, { title: o.title, bonus: o.bonusAmount });
  ctx.bus.emit({ type: 'rewards.changed' });
  return o;
}

async function codeFree(ctx: Ctx, code: string, exceptId?: string) {
  const [o] = await ctx.db.select({ id: rewardOffers.id }).from(rewardOffers).where(eq(rewardOffers.code, code));
  if (o && o.id !== exceptId) throw conflict('Another bonus code already uses that word');
}

export async function updateOffer(ctx: Ctx, actor: Actor, id: string, raw: unknown) {
  const b = OfferSchema.partial().parse(raw);
  const [cur] = await ctx.db.select().from(rewardOffers).where(eq(rewardOffers.id, id));
  if (!cur) throw notFound('Reward');
  const next = { ...cur, ...b };
  checkOffer(next);
  if (next.kind === 'code' && b.code) await codeFree(ctx, b.code, id);
  const [o] = await ctx.db
    .update(rewardOffers)
    .set({ ...b, ...(b.url !== undefined ? { url: b.url || null } : {}), ...(b.promoCode !== undefined ? { promoCode: b.promoCode || null } : {}), updatedAt: ctx.clock.now() })
    .where(eq(rewardOffers.id, id))
    .returning();
  await audit(ctx.db, actor, 'reward.update', { type: 'reward_offer', id }, b);
  ctx.bus.emit({ type: 'rewards.changed' });
  return o;
}

export async function deleteOffer(ctx: Ctx, actor: Actor, id: string) {
  const [paid] = await ctx.db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(rewardClaims).where(and(eq(rewardClaims.offerId, id), eq(rewardClaims.status, 'approved')));
  if (paid.n > 0) {
    // Keep the history of paid bonuses: switch it off instead.
    await ctx.db.update(rewardOffers).set({ active: false, updatedAt: ctx.clock.now() }).where(eq(rewardOffers.id, id));
    await audit(ctx.db, actor, 'reward.deactivate', { type: 'reward_offer', id });
    ctx.bus.emit({ type: 'rewards.changed' });
    return { ok: true, deactivated: true };
  }
  const [o] = await ctx.db.delete(rewardOffers).where(eq(rewardOffers.id, id)).returning();
  if (!o) throw notFound('Reward');
  await audit(ctx.db, actor, 'reward.delete', { type: 'reward_offer', id }, { title: o.title });
  ctx.bus.emit({ type: 'rewards.changed' });
  return { ok: true, deactivated: false };
}

export async function listClaims(ctx: Ctx, status: 'pending' | 'all') {
  const rows = await ctx.db
    .select({ c: rewardClaims, title: rewardOffers.title, platform: rewardOffers.platform, url: rewardOffers.url, kind: rewardOffers.kind, name: customers.fullName, gamertag: customers.gamertag, number: customers.number })
    .from(rewardClaims)
    .innerJoin(rewardOffers, eq(rewardOffers.id, rewardClaims.offerId))
    .innerJoin(customers, eq(customers.id, rewardClaims.customerId))
    .where(status === 'pending' ? eq(rewardClaims.status, 'pending') : undefined)
    .orderBy(desc(rewardClaims.createdAt))
    .limit(200);
  return rows.map((r) => ({ ...r.c, offer: { title: r.title, platform: r.platform, url: r.url, kind: r.kind }, customer: { name: r.name, gamertag: r.gamertag, number: r.number } }));
}

/** Pays the bonus (once) and marks the claim approved. */
async function pay(ctx: Ctx, actor: Actor, claimId: string) {
  return ctx.db.transaction(async (tx) => {
    const [c] = await tx.select().from(rewardClaims).where(eq(rewardClaims.id, claimId)).for('update');
    if (!c) throw notFound('Claim');
    if (c.status === 'approved') return c;
    const [o] = await tx.select().from(rewardOffers).where(eq(rewardOffers.id, c.offerId));
    if (!o) throw notFound('Reward');
    const now = ctx.clock.now();
    if (o.bonusAmount > 0) {
      await postWallet(tx, { customerId: c.customerId, type: 'bonus', amount: o.bonusAmount, actor, note: `Reward: ${o.title}`, at: now });
    }
    const [done] = await tx
      .update(rewardClaims)
      .set({ status: 'approved', amount: o.bonusAmount, decidedBy: actor.staffId, decidedAt: now })
      .where(eq(rewardClaims.id, c.id))
      .returning();
    await audit(tx, actor, 'reward.paid', { type: 'customer', id: c.customerId }, { reward: o.title, amount: o.bonusAmount });
    return done;
  });
}

export async function decideClaim(ctx: Ctx, actor: Actor, claimId: string, approve: boolean, note?: string | null) {
  const [c] = await ctx.db.select().from(rewardClaims).where(eq(rewardClaims.id, claimId));
  if (!c) throw notFound('Claim');
  if (c.status !== 'pending') throw conflict('This claim was already decided');
  let out;
  if (approve) out = await pay(ctx, actor, claimId);
  else {
    [out] = await ctx.db
      .update(rewardClaims)
      .set({ status: 'rejected', decidedBy: actor.staffId, decidedAt: ctx.clock.now(), note: note ?? null })
      .where(eq(rewardClaims.id, claimId))
      .returning();
    // Free the slot so the offer's limit only counts real payouts.
    await ctx.db.update(rewardOffers).set({ claimsCount: sql`greatest(${rewardOffers.claimsCount} - 1, 0)` }).where(eq(rewardOffers.id, c.offerId));
    await audit(ctx.db, actor, 'reward.rejected', { type: 'customer', id: c.customerId }, { claimId, note });
  }
  ctx.bus.emit({ type: 'rewards.changed' });
  ctx.bus.emit({ type: 'customers.changed', customerId: c.customerId });
  return out;
}

// ───────── Customers ─────────

export async function customerRewards(ctx: Ctx, me: string) {
  await rewardsOn(ctx);
  const now = ctx.clock.now();
  const offers = await ctx.db.select().from(rewardOffers).where(eq(rewardOffers.active, true)).orderBy(asc(rewardOffers.sortOrder), desc(rewardOffers.createdAt));
  const claims = await ctx.db.select().from(rewardClaims).where(eq(rewardClaims.customerId, me));
  const mine = new Map(claims.map((c) => [c.offerId, c]));
  const promos = await ctx.db
    .select({ code: promoCodes.code, description: promoCodes.description, percentOff: promoCodes.percentOff, amountOff: promoCodes.amountOff, minSpend: promoCodes.minSpend, validTo: promoCodes.validTo, maxUses: promoCodes.maxUses, usesCount: promoCodes.usesCount })
    .from(promoCodes)
    .where(and(eq(promoCodes.active, true), eq(promoCodes.showInPortal, true), or(isNull(promoCodes.validTo), gt(promoCodes.validTo, now)), or(isNull(promoCodes.validFrom), sql`${promoCodes.validFrom} <= ${now}`)));
  const follow = offers
    .filter((o) => o.kind === 'follow' && (isLive(o, now) || mine.has(o.id)))
    .map((o) => {
      const c = mine.get(o.id);
      return {
        id: o.id,
        title: o.title,
        description: o.description,
        platform: o.platform,
        url: o.url,
        bonusAmount: o.bonusAmount,
        needsApproval: o.needsApproval,
        validTo: o.validTo,
        status: c?.status ?? null,
        note: c?.status === 'rejected' ? c.note : null,
        promoCode: c?.status === 'approved' ? o.promoCode : null,
        hasPromoCode: !!o.promoCode,
      };
    });
  const redeemed = offers
    .filter((o) => o.kind === 'code' && mine.get(o.id)?.status === 'approved')
    .map((o) => ({ id: o.id, title: o.title, bonusAmount: o.bonusAmount, promoCode: o.promoCode, at: mine.get(o.id)!.createdAt }));
  return {
    follow,
    redeemed,
    hasCodes: offers.some((o) => o.kind === 'code' && isLive(o, now)),
    promoCodes: promos.filter((p) => p.maxUses == null || p.usesCount < p.maxUses).map(({ maxUses: _m, usesCount: _u, ...p }) => p),
    packages: await customerPackages(ctx, me),
  };
}

const ClaimSchema = z.object({ handle: z.string().trim().min(2, 'Type your username on that app').max(60) });

/** "I've followed": pays at once, or waits for staff when the reward needs approval. */
export async function claimFollow(ctx: Ctx, me: string, offerId: string, raw: unknown, ip?: string) {
  await rewardsOn(ctx);
  const b = ClaimSchema.parse(raw);
  const now = ctx.clock.now();
  const claim = await ctx.db.transaction(async (tx) => {
    const [o] = await tx.select().from(rewardOffers).where(eq(rewardOffers.id, offerId)).for('update');
    if (!o || o.kind !== 'follow') throw notFound('Reward');
    if (!isLive(o, now)) throw conflict('This reward has ended');
    try {
      const [c] = await tx.insert(rewardClaims).values({ offerId, customerId: me, handle: b.handle, createdAt: now }).returning();
      await tx.update(rewardOffers).set({ claimsCount: o.claimsCount + 1 }).where(eq(rewardOffers.id, o.id));
      return { c, o };
    } catch (err) {
      if (pgErrorCode(err) === '23505') throw conflict('You already claimed this reward');
      throw err;
    }
  });
  const actor = { staffId: null, ip };
  if (!claim.o.needsApproval) await pay(ctx, actor, claim.c.id);
  else ctx.bus.emit({ type: 'alert', level: 'info', message: `Reward claim to check: ${claim.o.title} (${b.handle})` });
  ctx.bus.emit({ type: 'rewards.changed' });
  ctx.bus.emit({ type: 'customers.changed', customerId: me });
  return { status: claim.o.needsApproval ? 'pending' : 'approved', bonusAmount: claim.o.bonusAmount, promoCode: claim.o.needsApproval ? null : claim.o.promoCode };
}

const fails = new Map<string, { n: number; until: number }>();

/** A bonus code typed by the customer: pays once per customer. */
export async function redeemCode(ctx: Ctx, me: string, raw: unknown, ip?: string) {
  await rewardsOn(ctx);
  const f = fails.get(me);
  if (f && f.n >= 8 && f.until > Date.now()) throw new AppError(429, 'Too many wrong codes. Try again in 15 minutes.', 'locked');
  const b = z.object({ code: z.string().trim().min(1).max(30) }).parse(raw);
  const code = b.code.toUpperCase();
  const now = ctx.clock.now();
  const [o] = await ctx.db.select().from(rewardOffers).where(and(eq(rewardOffers.kind, 'code'), eq(rewardOffers.code, code)));
  if (!o || !isLive(o, now)) {
    // A promo code? Tell them where it works instead of "wrong code".
    const [p] = await ctx.db.select({ id: promoCodes.id }).from(promoCodes).where(and(eq(promoCodes.code, code), eq(promoCodes.active, true)));
    if (p) throw badRequest('That is a promo code: give it at the counter when you pay to get the discount.');
    const cur = fails.get(me);
    fails.set(me, { n: (cur && cur.until > Date.now() ? cur.n : 0) + 1, until: Date.now() + 15 * 60_000 });
    throw badRequest(o ? 'This code has ended' : 'That code is not valid');
  }
  const claim = await ctx.db.transaction(async (tx) => {
    const [locked] = await tx.select().from(rewardOffers).where(eq(rewardOffers.id, o.id)).for('update');
    if (!isLive(locked, now)) throw conflict('This code has been fully used');
    try {
      const [c] = await tx.insert(rewardClaims).values({ offerId: o.id, customerId: me, handle: null, createdAt: now }).returning();
      await tx.update(rewardOffers).set({ claimsCount: locked.claimsCount + 1 }).where(eq(rewardOffers.id, o.id));
      return c;
    } catch (err) {
      if (pgErrorCode(err) === '23505') throw conflict('You already used this code');
      throw err;
    }
  });
  await pay(ctx, { staffId: null, ip }, claim.id);
  ctx.bus.emit({ type: 'rewards.changed' });
  ctx.bus.emit({ type: 'customers.changed', customerId: me });
  return { title: o.title, bonusAmount: o.bonusAmount, promoCode: o.promoCode };
}

/** Pending claim count for the staff menu badge. */
export async function pendingClaims(ctx: Ctx) {
  const [r] = await ctx.db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(rewardClaims).where(eq(rewardClaims.status, 'pending'));
  return r.n;
}
