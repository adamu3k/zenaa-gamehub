import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { applyDiscount, BillingError, computePrepaid, type RateSnapshot } from '../billing/engine.js';
import { requirePermission, type Actor, type Ctx } from '../context.js';
import type { DbOrTx } from '../db/index.js';
import { customers, customerTimeLog, membershipTiers, pricingPlans, stationCategories } from '../db/schema.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { audit } from './audit.js';
import { collectTenders, resolveTenders, TenderInputSchema } from './wallet.js';
import { checkPackages } from './promo-packages.js';

export type TimeKind = 'bought' | 'saved' | 'used' | 'adjust' | 'convert';

/**
 * Saved time is kept per station type ("PC", "PS5"…) because the types have different prices.
 * customers.savedSeconds is the total; customers.timeByCategory holds the part tied to one type,
 * and the rest ("any") plays on every station (time saved before v0.9.6, or bought on an all-stations plan).
 */
export function timeBuckets(c: { savedSeconds: number; timeByCategory: Record<string, number> | null }) {
  const byCategory: Record<string, number> = {};
  let tied = 0;
  for (const [k, v] of Object.entries(c.timeByCategory ?? {})) {
    if (v > 0) {
      byCategory[k] = v;
      tied += v;
    }
  }
  return { any: Math.max(0, c.savedSeconds - tied), byCategory };
}

/** Seconds a customer can play on a station of this type (its own time + time for any station). */
export function playableSeconds(c: { savedSeconds: number; timeByCategory: Record<string, number> | null }, categoryId: string | null | undefined) {
  const b = timeBuckets(c);
  return b.any + (categoryId ? (b.byCategory[categoryId] ?? 0) : 0);
}

/**
 * Adds (positive) or removes (negative) saved playing time on a customer's account and logs it.
 * `categoryId` = the station type it belongs to (null = any station). Removing takes that type's time
 * first, then time for any station. Refuses to go below zero.
 */
export async function postTime(
  tx: DbOrTx,
  input: {
    customerId: string;
    seconds: number;
    kind: TimeKind;
    actor: Actor;
    at: Date;
    categoryId?: string | null;
    sessionId?: string | null;
    planName?: string | null;
    amount?: number | null;
    note?: string | null;
  },
) {
  const [c] = await tx.select().from(customers).where(eq(customers.id, input.customerId)).for('update');
  if (!c) throw notFound('Customer');
  const secs = Math.round(input.seconds);
  const cat = input.categoryId ?? null;
  const b = timeBuckets(c);
  const map = { ...b.byCategory };
  if (secs >= 0) {
    if (cat) map[cat] = (map[cat] ?? 0) + secs;
  } else {
    let need = -secs;
    const fromCat = cat ? Math.min(need, map[cat] ?? 0) : 0;
    if (cat && fromCat) map[cat] -= fromCat;
    need -= fromCat;
    const fromAny = Math.min(need, b.any);
    need -= fromAny;
    // A correction without a type may also take time tied to a type.
    if (need > 0 && !cat && input.kind === 'adjust') {
      for (const k of Object.keys(map)) {
        const t = Math.min(need, map[k]);
        map[k] -= t;
        need -= t;
      }
    }
    if (need > 0) {
      const have = Math.floor((cat ? playableSeconds(c, cat) : b.any) / 60);
      throw conflict(`${c.fullName} only has ${have} min of saved time${cat ? ' for this station type' : ''}`);
    }
  }
  for (const k of Object.keys(map)) if (map[k] <= 0) delete map[k];
  const after = c.savedSeconds + secs;
  if (after < 0) throw conflict(`${c.fullName} only has ${Math.floor(c.savedSeconds / 60)} min saved`);
  await tx.update(customers).set({ savedSeconds: after, timeByCategory: map }).where(eq(customers.id, c.id));
  const [row] = await tx
    .insert(customerTimeLog)
    .values({
      customerId: c.id,
      kind: input.kind,
      seconds: secs,
      balanceAfter: after,
      sessionId: input.sessionId ?? null,
      categoryId: cat,
      planName: input.planName ?? null,
      amount: input.amount ?? null,
      note: input.note ?? null,
      staffId: input.actor.staffId,
      createdAt: input.at,
    })
    .returning();
  return row;
}

export async function timeLog(db: DbOrTx, customerId: string, limit = 50) {
  return db.select().from(customerTimeLog).where(eq(customerTimeLog.customerId, customerId)).orderBy(desc(customerTimeLog.createdAt)).limit(limit);
}

/** Saved time split by station type, with names, for the customer page and the app. */
export async function timeSummary(db: DbOrTx, c: { savedSeconds: number; timeByCategory: Record<string, number> | null }) {
  const b = timeBuckets(c);
  const cats = await db.select({ id: stationCategories.id, name: stationCategories.name }).from(stationCategories);
  const names = new Map(cats.map((x) => [x.id, x.name]));
  return [
    ...(b.any > 0 ? [{ categoryId: null as string | null, name: 'Any station', seconds: b.any }] : []),
    ...Object.entries(b.byCategory).map(([id, seconds]) => ({ categoryId: id as string | null, name: names.get(id) ?? 'Station type', seconds })),
  ];
}

/** Station type of a pricing plan (null = the plan is for every station). */
export async function planCategory(tx: DbOrTx, planId: string | null | undefined) {
  if (!planId) return null;
  const [p] = await tx.select({ categoryId: pricingPlans.categoryId }).from(pricingPlans).where(eq(pricingPlans.id, planId));
  return p?.categoryId ?? null;
}

/** Price of one hour on a station type: its cheapest hourly plan (or package), else the all-stations plan. */
export async function hourlyValue(tx: DbOrTx, categoryId: string | null): Promise<number> {
  const plans = await tx
    .select()
    .from(pricingPlans)
    .where(and(eq(pricingPlans.active, true), isNull(pricingPlans.deletedAt), categoryId ? eq(pricingPlans.categoryId, categoryId) : isNull(pricingPlans.categoryId)))
    .orderBy(asc(pricingPlans.sortOrder));
  const perHour = plans
    .map((p) => (p.kind === 'time_rate' ? p.ratePerHour : p.packageMinutes && p.packagePrice != null ? Math.round((p.packagePrice * 60) / p.packageMinutes) : 0))
    .filter((v) => v > 0);
  if (perHour.length) return Math.min(...perHour);
  return categoryId ? hourlyValue(tx, null) : 0;
}

export const ConvertTimeSchema = z.object({
  fromCategoryId: z.string().uuid().nullable(),
  toCategoryId: z.string().uuid().nullable(),
  /** Minutes of the "from" time to change. */
  minutes: z.number().int().min(1).max(100_000),
  /** Only work out the result, change nothing. */
  preview: z.boolean().optional(),
});

/**
 * Changes saved time from one station type to another at the same money value,
 * e.g. 5 h of PC time at GH₵10/h = GH₵50 = 2 h 30 min of PS5 time at GH₵20/h. Rounds down to whole minutes.
 */
export async function convertTime(ctx: Ctx, actor: Actor, customerId: string, raw: unknown) {
  const b = ConvertTimeSchema.parse(raw);
  if (b.fromCategoryId === b.toCategoryId) throw badRequest('Choose two different station types');
  if (!b.toCategoryId) throw badRequest('Choose the station type to change the time to');
  const now = ctx.clock.now();
  const out = await ctx.db.transaction(async (tx) => {
    const [c] = await tx.select().from(customers).where(eq(customers.id, customerId)).for('update');
    if (!c) throw notFound('Customer');
    const bk = timeBuckets(c);
    const have = b.fromCategoryId ? (bk.byCategory[b.fromCategoryId] ?? 0) : bk.any;
    if (b.minutes * 60 > have) throw conflict(`Only ${Math.floor(have / 60)} min of that time is saved`);
    const [fromRate, toRate] = [await hourlyValue(tx, b.fromCategoryId), await hourlyValue(tx, b.toCategoryId)];
    if (!fromRate || !toRate) throw conflict('A price is missing for one of the station types — add an hourly price under Pricing first');
    const toMinutes = Math.floor((b.minutes * fromRate) / toRate);
    if (toMinutes < 1) throw badRequest('That is too little time to change');
    const cats = await tx.select({ id: stationCategories.id, name: stationCategories.name }).from(stationCategories);
    const name = (id: string | null) => (id ? (cats.find((x) => x.id === id)?.name ?? 'Station type') : 'Any station');
    const result = { fromMinutes: b.minutes, toMinutes, fromRate, toRate, from: name(b.fromCategoryId), to: name(b.toCategoryId) };
    if (b.preview) return result;
    const note = `Changed ${b.minutes} min ${result.from} → ${toMinutes} min ${result.to}`;
    // Taken from its own bucket (checked above, so it never spills into another type's time).
    await postTime(tx, { customerId, seconds: -b.minutes * 60, kind: 'convert', actor, at: now, categoryId: b.fromCategoryId, note });
    await postTime(tx, { customerId, seconds: toMinutes * 60, kind: 'convert', actor, at: now, categoryId: b.toCategoryId, note });
    await audit(tx, actor, 'customer.time_convert', { type: 'customer', id: customerId }, result);
    return result;
  });
  if (!b.preview) ctx.bus.emit({ type: 'customers.changed', customerId });
  return out;
}

export const AddTimeSchema = TenderInputSchema.extend({
  /** buy = sell a package / minutes and take payment; adjust = add or remove time without payment (corrections, gifts). */
  mode: z.enum(['buy', 'adjust']),
  planId: z.string().uuid().optional(),
  /** buy on an hourly plan: minutes; adjust: signed minutes. */
  minutes: z.number().int().min(-100_000).max(100_000).optional(),
  /** buy on a package plan: how many packages. */
  packages: z.number().int().min(1).max(50).optional(),
  /** adjust: the station type the time is for (empty = any station). */
  categoryId: z.string().uuid().nullish(),
  note: z.string().trim().max(300).nullish(),
});

export function rateOf(plan: typeof pricingPlans.$inferSelect): RateSnapshot {
  return {
    planId: plan.id,
    planName: plan.name,
    kind: plan.kind,
    ratePerHour: plan.ratePerHour,
    billingUnitMinutes: plan.billingUnitMinutes,
    minimumMinutes: plan.minimumMinutes,
    graceMinutes: plan.graceMinutes,
    packageMinutes: plan.packageMinutes,
    packagePrice: plan.packagePrice,
  };
}

/** Price of `minutes` (or n packages) on a plan after the customer's member discount. */
export async function priceTime(tx: DbOrTx, plan: typeof pricingPlans.$inferSelect, customer: { tierId: string | null }, minutes?: number, packages?: number) {
  let total: number;
  let gross: number;
  try {
    if (plan.kind === 'package') {
      const one = computePrepaid(rateOf(plan), undefined);
      const n = packages ?? (minutes ? Math.max(1, Math.ceil(minutes / one.billedMinutes)) : 1);
      total = one.billedMinutes * n;
      gross = one.amount * n;
    } else {
      if (!minutes || minutes <= 0) throw badRequest('Enter how many minutes');
      const ch = computePrepaid(rateOf(plan), minutes);
      total = ch.billedMinutes;
      gross = ch.amount;
    }
  } catch (e) {
    if (e instanceof BillingError) throw badRequest(e.message);
    throw e;
  }
  let pct = 0;
  if (customer.tierId) {
    const [tier] = await tx.select().from(membershipTiers).where(eq(membershipTiers.id, customer.tierId));
    pct = tier?.discountPercent ?? 0;
  }
  return { minutes: total, gross, net: applyDiscount(gross, pct).net };
}

/** Sells time onto a customer's account, or corrects it. Needs customers.time. */
export async function addCustomerTime(ctx: Ctx, actor: Actor, customerId: string, raw: unknown) {
  requirePermission(actor, 'customers.time', "change customers' saved time");
  const input = AddTimeSchema.parse(raw);
  const now = ctx.clock.now();
  const row = await ctx.db.transaction(async (tx) => {
    const [c] = await tx.select().from(customers).where(eq(customers.id, customerId));
    if (!c) throw notFound('Customer');
    if (input.mode === 'adjust') {
      if (!input.minutes) throw badRequest('Enter the minutes to add (or minus to remove)');
      if (!input.note) throw badRequest('Give a reason for the change');
      const r = await postTime(tx, { customerId, seconds: input.minutes * 60, kind: 'adjust', actor, at: now, categoryId: input.categoryId ?? null, note: input.note });
      await audit(tx, actor, 'customer.time_adjust', { type: 'customer', id: customerId }, { minutes: input.minutes, note: input.note });
      return r;
    }
    if (c.status !== 'active') throw conflict(`${c.fullName}'s account is suspended`);
    if (!input.planId) throw badRequest('Choose a package or pricing plan');
    const [plan] = await tx.select().from(pricingPlans).where(eq(pricingPlans.id, input.planId));
    if (!plan || !plan.active) throw notFound('Pricing plan');
    const p = await priceTime(tx, plan, c, plan.kind === 'package' ? undefined : input.minutes, input.packages ?? 1);
    const tenders = resolveTenders(p.net, input);
    await collectTenders(tx, tenders, { kind: 'session', actor, customerId, note: `Saved time: ${plan.name}`, at: now });
    const r = await postTime(tx, { customerId, seconds: p.minutes * 60, kind: 'bought', actor, at: now, categoryId: plan.categoryId, planName: plan.name, amount: p.net, note: input.note });
    await audit(tx, actor, 'customer.time_buy', { type: 'customer', id: customerId }, { plan: plan.name, minutes: p.minutes, amount: p.net, tenders });
    return r;
  });
  ctx.bus.emit({ type: 'customers.changed', customerId });
  if (input.mode === 'buy') {
    ctx.bus.emit({ type: 'payments.changed' });
    await checkPackages(ctx, customerId, actor);
  }
  return row;
}
