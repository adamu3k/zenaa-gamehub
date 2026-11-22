import { and, eq, gt, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  activeSecondsAt,
  applyDiscount,
  BillingError,
  computeExtension,
  computePrepaid,
  computeTimeCharge,
  expectedEndAt,
  unusedPrepaidValue,
  type RateSnapshot,
} from '../billing/engine.js';
import { requirePermission, type Actor, type Ctx } from '../context.js';
import type { DbOrTx } from '../db/index.js';
import { customers, membershipTiers, pricingPlans, sessionEvents, sessions, stations } from '../db/schema.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { audit } from './audit.js';
import { getSettings } from './settings.js';
import { checkInBooking, completeBookingForSession } from './bookings.js';
import { findHappyHour, redeemPromo } from './promotions.js';
import { collectTenders, resolveTenders, TenderInputSchema } from './wallet.js';
import { postTime } from './time-bank.js';

export type SessionRow = typeof sessions.$inferSelect;

const PromoCodeField = z.string().trim().min(1).max(30).optional();

export const StartSessionSchema = TenderInputSchema.extend({
  stationId: z.string().uuid(),
  planId: z.string().uuid(),
  billingType: z.enum(['prepaid', 'postpaid']),
  customerId: z.string().uuid().nullish(),
  /** Prepaid time-rate plans: minutes purchased. Ignored for packages. */
  minutes: z.number().int().positive().max(24 * 60).optional(),
  /** Prepaid only — pay-as-you-go sessions take promo codes at checkout. */
  promoCode: PromoCodeField,
  note: z.string().max(500).nullish(),
  /** Booking being checked in with this session. */
  bookingId: z.string().uuid().nullish(),
  /** Play from the customer's saved time (no charge). `minutes` limits how much; default all of it. */
  useSavedTime: z.boolean().optional(),
});

export const ExtendSessionSchema = TenderInputSchema.extend({
  minutes: z.number().int().positive().max(24 * 60),
});

export const EndSessionSchema = TenderInputSchema.extend({
  promoCode: PromoCodeField,
  /** Manual discount in minor units (needs payments.discount and a reason). */
  manualDiscount: z.number().int().min(0).optional(),
  discountReason: z.string().trim().max(200).optional(),
  /** Put the unpaid balance on the customer's tab (needs payments.tab and a credit limit). */
  payLater: z.boolean().optional(),
  /** Prepaid sessions with a customer: put the unplayed time back on their account. */
  saveRemaining: z.boolean().optional(),
  note: z.string().max(500).nullish(),
});
type EndInput = z.infer<typeof EndSessionSchema>;

export const SettleSessionSchema = TenderInputSchema.extend({ note: z.string().max(500).nullish() });

function wrapBilling<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof BillingError) throw badRequest(e.message);
    throw e;
  }
}

async function lockSession(tx: DbOrTx, id: string) {
  const [s] = await tx.select().from(sessions).where(eq(sessions.id, id)).for('update');
  if (!s) throw notFound('Session');
  return s;
}

/** Live view of a session: elapsed, remaining, and what is owed right now. */
export function describeSession(s: SessionRow, at: Date) {
  const active = activeSecondsAt(s, at);
  const remainingSeconds = s.allottedSeconds != null ? Math.max(0, s.allottedSeconds - active) : null;
  let liveGross = s.grossAmount;
  let liveNet = s.netAmount;
  if (s.billingType === 'postpaid' && s.status !== 'ended') {
    const charge = computeTimeCharge(active, s.rate);
    liveGross = charge.amount;
    liveNet = applyDiscount(charge.amount, s.discountPercent).net;
  }
  return {
    ...s,
    activeSeconds: active,
    remainingSeconds,
    expectedEndAt: expectedEndAt(s),
    liveGrossAmount: liveGross,
    liveNetAmount: liveNet,
    balanceDue: Math.max(0, liveNet - s.paidAmount),
    refundable: Math.max(0, s.paidAmount - s.refundedAmount),
    /** Ended prepaid sessions: unused whole minutes and their suggested refund value. */
    unused: s.status === 'ended' && s.billingType === 'prepaid' ? unusedPrepaidValue({ ...s, accumulatedSeconds: s.accumulatedSeconds + s.savedSeconds }) : null,
  };
}

/** Customers' unpaid balances on ended sessions. */
export async function outstandingFor(tx: DbOrTx, customerId: string) {
  const [r] = await tx
    .select({ owed: sql<number>`coalesce(sum(${sessions.netAmount} - ${sessions.paidAmount}),0)::bigint` })
    .from(sessions)
    .where(and(eq(sessions.customerId, customerId), eq(sessions.status, 'ended'), gt(sessions.netAmount, sessions.paidAmount)));
  return Number(r?.owed ?? 0);
}

async function awardPoints(tx: DbOrTx, customerId: string | null, paid: number) {
  if (!customerId || paid <= 0) return;
  const [c] = await tx.select().from(customers).where(eq(customers.id, customerId));
  if (!c?.tierId) return;
  const [tier] = await tx.select().from(membershipTiers).where(eq(membershipTiers.id, c.tierId));
  if (!tier || tier.spendPerPoint <= 0) return;
  const earned = Math.floor(paid / tier.spendPerPoint);
  if (earned > 0) await tx.update(customers).set({ points: sql`${customers.points} + ${earned}` }).where(eq(customers.id, c.id));
}

export async function startSession(ctx: Ctx, actor: Actor, raw: unknown) {
  const input = StartSessionSchema.parse(raw);
  const now = ctx.clock.now();
  const result = await ctx.db.transaction(async (tx) => {
    const [station] = await tx.select().from(stations).where(eq(stations.id, input.stationId)).for('update');
    if (!station || station.status === 'archived') throw notFound('Station');
    if (station.status !== 'active') throw conflict(`${station.name} is ${station.status} and cannot start a session`);

    const [open] = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.stationId, station.id), ne(sessions.status, 'ended')))
      .limit(1);
    if (open) throw conflict(`${station.name} already has an active session`);
    // A paid session replaces any staff unlock.
    if (station.bypassUntil) await tx.update(stations).set({ bypassUntil: null, bypassBy: null, bypassReason: null }).where(eq(stations.id, station.id));

    const [plan] = await tx.select().from(pricingPlans).where(eq(pricingPlans.id, input.planId));
    if (!plan || !plan.active) throw notFound('Pricing plan');
    if (plan.categoryId && plan.categoryId !== station.categoryId) throw badRequest('This plan does not apply to this station');
    if (plan.kind === 'package' && input.billingType !== 'prepaid') throw badRequest('Packages must be prepaid');

    const rate: RateSnapshot = {
      planId: plan.id,
      planName: plan.name,
      kind: plan.kind,
      ratePerHour: plan.kind === 'time_rate' && station.hourlyRateOverride != null ? station.hourlyRateOverride : plan.ratePerHour,
      billingUnitMinutes: plan.billingUnitMinutes,
      minimumMinutes: plan.minimumMinutes,
      graceMinutes: plan.graceMinutes,
      packageMinutes: plan.packageMinutes,
      packagePrice: plan.packagePrice,
    };

    // Percentage discount: the better of the member's tier and any happy hour running now (they do not stack).
    let discountPercent = 0;
    if (input.customerId) {
      const [c] = await tx.select().from(customers).where(eq(customers.id, input.customerId));
      if (!c) throw notFound('Customer');
      if (c.status !== 'active') throw conflict(`${c.fullName}'s account is suspended`);
      if (c.tierId) {
        const [tier] = await tx.select().from(membershipTiers).where(eq(membershipTiers.id, c.tierId));
        discountPercent = tier?.discountPercent ?? 0;
      }
    }
    const happy = await findHappyHour(tx, station.categoryId, now);
    const happyHourId = happy && happy.discountPercent > discountPercent ? happy.id : null;
    if (happy && happyHourId) discountPercent = happy.discountPercent;

    if (input.useSavedTime) {
      if (!input.customerId) throw badRequest('Choose the customer whose saved time to use');
      if (input.billingType !== 'prepaid') throw badRequest('Saved time is played as prepaid time');
      if (input.promoCode) throw badRequest('Promo codes do not apply to saved time');
    }
    if (input.promoCode && input.billingType === 'postpaid') {
      throw badRequest('For pay-as-you-go sessions, enter the promo code at checkout');
    }

    let allottedSeconds: number | null = null;
    let gross = 0;
    let discount = 0;
    let net = 0;
    let promoCodeId: string | null = null;
    let promoOff = 0;
    let tenders: ReturnType<typeof resolveTenders> = [];
    let fromSaved = 0;
    if (input.useSavedTime) {
      const [c] = await tx.select({ saved: customers.savedSeconds }).from(customers).where(eq(customers.id, input.customerId!));
      fromSaved = input.minutes ? Math.min(input.minutes * 60, c.saved) : c.saved;
      if (fromSaved < 60) throw conflict('This customer has no saved time left');
      allottedSeconds = fromSaved;
    } else if (input.billingType === 'prepaid') {
      const charge = wrapBilling(() => computePrepaid(rate, input.minutes));
      allottedSeconds = charge.billedMinutes * 60;
      gross = charge.amount;
      ({ discount, net } = applyDiscount(gross, discountPercent));
      if (input.promoCode) {
        const r = await redeemPromo(tx, input.promoCode, net, now);
        promoCodeId = r.promo.id;
        promoOff = r.discount;
        net -= promoOff;
        discount += promoOff;
      }
      tenders = resolveTenders(net, input);
    }

    const [session] = await tx
      .insert(sessions)
      .values({
        stationId: station.id,
        customerId: input.customerId ?? null,
        planId: plan.id,
        rate,
        discountPercent,
        happyHourId,
        promoCodeId,
        promoDiscount: promoOff,
        billingType: input.billingType,
        status: 'running',
        startedAt: now,
        lastResumedAt: now,
        allottedSeconds,
        billedMinutes: allottedSeconds != null ? Math.floor(allottedSeconds / 60) : 0,
        fromSavedSeconds: fromSaved,
        grossAmount: gross,
        discountAmount: discount,
        netAmount: net,
        paidAmount: net,
        note: input.note ?? null,
        startedBy: actor.staffId,
      })
      .returning();

    await collectTenders(tx, tenders, { kind: 'session', actor, customerId: input.customerId, sessionId: session.id, at: now });
    if (fromSaved > 0) {
      await postTime(tx, { customerId: input.customerId!, seconds: -fromSaved, kind: 'used', actor, at: now, sessionId: session.id, planName: plan.name });
    }
    if (input.bookingId) await checkInBooking(tx, input.bookingId, session, now);
    await tx.insert(sessionEvents).values({
      sessionId: session.id,
      type: 'start',
      at: now,
      secondsAdded: allottedSeconds,
      amount: net,
      staffId: actor.staffId,
      meta: fromSaved ? { fromSavedSeconds: fromSaved } : happyHourId || promoCodeId ? { happyHour: happyHourId ? happy!.name : undefined, promoCode: input.promoCode?.toUpperCase() } : null,
    });
    await audit(tx, actor, 'session.start', { type: 'session', id: session.id }, {
      station: station.code,
      plan: plan.name,
      billingType: input.billingType,
      amount: net,
      fromSavedMinutes: fromSaved ? Math.floor(fromSaved / 60) : undefined,
      tenders,
      discountPercent,
      happyHour: happyHourId ? happy!.name : undefined,
      promoCode: input.promoCode?.toUpperCase(),
    });
    return session;
  });
  ctx.bus.emit({ type: 'sessions.changed', sessionId: result.id, stationId: result.stationId });
  if (input.billingType === 'prepaid') ctx.bus.emit({ type: 'payments.changed' });
  if (input.bookingId) ctx.bus.emit({ type: 'bookings.changed', bookingId: input.bookingId, stationId: result.stationId });
  return describeSession(result, now);
}

export const PauseSchema = z.object({ mode: z.enum(['off', 'screen', 'open']).optional() }).nullish();

/**
 * Pauses the clock. mode: off = lock the screen and switch the plug off; screen = lock the screen but keep the
 * TV/console on; open = only stop the clock (nothing locked). Default from Settings (power off on pause).
 */
export async function pauseSession(ctx: Ctx, actor: Actor, id: string, raw?: unknown) {
  const input = PauseSchema.parse(raw ?? null) ?? {};
  const mode = input.mode ?? ((await getSettings(ctx.db)).powerOffOnPause ? 'off' : 'screen');
  const now = ctx.clock.now();
  const s = await ctx.db.transaction(async (tx) => {
    const s = await lockSession(tx, id);
    if (s.status !== 'running') throw conflict('Only a running session can be paused');
    const exp = expectedEndAt(s);
    if (exp && exp <= now) {
      // Time already ran out — close it at the true expiry instead of pausing.
      return finalizeSession(tx, actor, s, exp, 'time_expired');
    }
    const active = activeSecondsAt(s, now);
    const [u] = await tx
      .update(sessions)
      .set({ status: 'paused', accumulatedSeconds: active, lastResumedAt: null, pauseMode: mode })
      .where(eq(sessions.id, s.id))
      .returning();
    await tx.insert(sessionEvents).values({ sessionId: s.id, type: 'pause', at: now, staffId: actor.staffId, meta: { mode } });
    await audit(tx, actor, 'session.pause', { type: 'session', id: s.id }, { mode });
    return u;
  });
  ctx.bus.emit({ type: 'sessions.changed', sessionId: s.id, stationId: s.stationId });
  return describeSession(s, now);
}

export async function resumeSession(ctx: Ctx, actor: Actor, id: string) {
  const now = ctx.clock.now();
  const s = await ctx.db.transaction(async (tx) => {
    const s = await lockSession(tx, id);
    if (s.status !== 'paused') throw conflict('Only a paused session can be resumed');
    const [u] = await tx
      .update(sessions)
      .set({ status: 'running', lastResumedAt: now, pauseMode: null })
      .where(eq(sessions.id, s.id))
      .returning();
    await tx.insert(sessionEvents).values({ sessionId: s.id, type: 'resume', at: now, staffId: actor.staffId });
    await audit(tx, actor, 'session.resume', { type: 'session', id: s.id });
    return u;
  });
  ctx.bus.emit({ type: 'sessions.changed', sessionId: s.id, stationId: s.stationId });
  return describeSession(s, now);
}

export async function extendSession(ctx: Ctx, actor: Actor, id: string, raw: unknown) {
  const input = ExtendSessionSchema.parse(raw);
  const now = ctx.clock.now();
  const s = await ctx.db.transaction(async (tx) => {
    const s = await lockSession(tx, id);
    if (s.status === 'ended') throw conflict('Session has already ended');
    if (s.billingType !== 'prepaid' || s.allottedSeconds == null) throw badRequest('Only prepaid sessions can be extended');
    const exp = expectedEndAt(s);
    if (exp && exp <= now) throw conflict('Session time has already expired — start a new session');
    const charge = wrapBilling(() => computeExtension(s.rate, input.minutes));
    const { discount, net } = applyDiscount(charge.amount, s.discountPercent);
    const tenders = resolveTenders(net, input);
    const [u] = await tx
      .update(sessions)
      .set({
        allottedSeconds: s.allottedSeconds + input.minutes * 60,
        billedMinutes: s.billedMinutes + input.minutes,
        grossAmount: s.grossAmount + charge.amount,
        discountAmount: s.discountAmount + discount,
        netAmount: s.netAmount + net,
        paidAmount: s.paidAmount + net,
      })
      .where(eq(sessions.id, s.id))
      .returning();
    await collectTenders(tx, tenders, { kind: 'extension', actor, customerId: s.customerId, sessionId: s.id, at: now });
    await tx.insert(sessionEvents).values({
      sessionId: s.id,
      type: 'extend',
      at: now,
      secondsAdded: input.minutes * 60,
      amount: net,
      staffId: actor.staffId,
    });
    await audit(tx, actor, 'session.extend', { type: 'session', id: s.id }, { minutes: input.minutes, amount: net, tenders });
    return u;
  });
  ctx.bus.emit({ type: 'sessions.changed', sessionId: s.id, stationId: s.stationId });
  ctx.bus.emit({ type: 'payments.changed' });
  return describeSession(s, now);
}

/** Refuses a tab that would take the customer past their credit limit. */
async function checkCredit(tx: DbOrTx, customerId: string | null, adding: number) {
  if (!customerId) throw badRequest('Pay later needs a registered customer');
  const [c] = await tx.select().from(customers).where(eq(customers.id, customerId)).for('update');
  if (!c) throw notFound('Customer');
  if (c.creditLimit <= 0) throw conflict(`${c.fullName} has no credit limit set — a manager can set one on the customer page`);
  const owed = await outstandingFor(tx, customerId);
  if (owed + adding > c.creditLimit) {
    throw conflict(`Credit limit exceeded: ${c.fullName} already owes ${owed} of a ${c.creditLimit} limit`);
  }
}

/**
 * Closes a locked session at `at`. For postpaid sessions this computes the bill (percentage discount,
 * then promo code, then manual discount) and settles it with the given tenders, or puts it on the tab.
 * Awards loyalty points on what was paid.
 */
async function finalizeSession(tx: DbOrTx, actor: Actor, s: SessionRow, at: Date, reason: string, checkout: EndInput = {}) {
  const active = activeSecondsAt(s, at);
  let { grossAmount, discountAmount, netAmount, paidAmount, billedMinutes, promoCodeId, promoDiscount, manualDiscount } = s;
  let onTab = s.onTab;
  let collected = 0;
  let tenders: ReturnType<typeof resolveTenders> = [];

  if (s.billingType === 'postpaid') {
    const charge = computeTimeCharge(active, s.rate);
    const d = applyDiscount(charge.amount, s.discountPercent);
    grossAmount = charge.amount;
    billedMinutes = charge.billedMinutes;
    let subtotal = d.net;
    if (checkout.promoCode) {
      const r = await redeemPromo(tx, checkout.promoCode, subtotal, at);
      promoCodeId = r.promo.id;
      promoDiscount = r.discount;
      subtotal -= r.discount;
    }
    if (checkout.manualDiscount) {
      requirePermission(actor, 'payments.discount', 'give manual discounts');
      if (!checkout.discountReason) throw badRequest('Give a reason for the discount');
      if (checkout.manualDiscount > subtotal) throw badRequest('The discount is larger than the bill');
      manualDiscount = checkout.manualDiscount;
      subtotal -= manualDiscount;
    }
    netAmount = subtotal;
    discountAmount = d.discount + promoDiscount + manualDiscount;

    const due = netAmount - paidAmount;
    if (due > 0) {
      if (checkout.payLater) {
        requirePermission(actor, 'payments.tab', 'let customers pay later');
        // Optional part-payment now; the rest goes on the tab.
        const partial = checkout.payments?.length || checkout.paymentMethod ? checkout : null;
        tenders = partial ? resolveTenders(due, partial, { allowPartial: true }) : [];
        collected = tenders.reduce((a, t) => a + t.amount, 0);
        if (collected < due) await checkCredit(tx, s.customerId, due - collected);
      } else {
        tenders = resolveTenders(due, checkout);
        collected = due;
      }
      await collectTenders(tx, tenders, { kind: 'session', actor, customerId: s.customerId, sessionId: s.id, note: checkout.note, at });
      paidAmount += collected;
      onTab = paidAmount < netAmount;
    }
  } else if (checkout.promoCode || checkout.manualDiscount) {
    throw badRequest('Prepaid sessions were paid at the start — use a refund to give money back');
  }

  // Put the unplayed prepaid time back on the customer's account to continue another day.
  let savedSeconds = s.savedSeconds;
  if (checkout.saveRemaining && s.billingType === 'prepaid' && s.allottedSeconds != null) {
    if (!s.customerId) throw badRequest('Saving time needs a registered customer on the session');
    const left = Math.max(0, s.allottedSeconds - active);
    if (left >= 60) {
      await postTime(tx, { customerId: s.customerId, seconds: left, kind: 'saved', actor, at, sessionId: s.id, planName: s.rate.planName });
      savedSeconds = left;
    }
  }

  const [u] = await tx
    .update(sessions)
    .set({
      status: 'ended',
      endedAt: at,
      endReason: reason,
      accumulatedSeconds: active,
      lastResumedAt: null,
      grossAmount,
      discountAmount,
      netAmount,
      paidAmount,
      billedMinutes,
      promoCodeId,
      promoDiscount,
      manualDiscount,
      onTab,
      savedSeconds,
      endedBy: actor.staffId,
    })
    .where(eq(sessions.id, s.id))
    .returning();

  await completeBookingForSession(tx, s.id, at);

  // Prepaid money was received at start/extension; postpaid only what was collected now.
  await awardPoints(tx, s.customerId, s.billingType === 'prepaid' ? paidAmount : collected);

  await tx.insert(sessionEvents).values({
    sessionId: s.id,
    type: 'end',
    at,
    amount: netAmount,
    staffId: actor.staffId,
    meta: { reason, activeSeconds: active, ...(savedSeconds ? { savedSeconds } : {}), ...(onTab ? { onTab: netAmount - paidAmount } : {}) },
  });
  await audit(tx, actor, 'session.end', { type: 'session', id: s.id }, {
    reason,
    activeSeconds: active,
    netAmount,
    tenders,
    promoCode: checkout.promoCode?.toUpperCase(),
    manualDiscount: manualDiscount || undefined,
    discountReason: checkout.discountReason,
    onTab: onTab ? netAmount - paidAmount : undefined,
  });
  return u;
}

export async function endSession(ctx: Ctx, actor: Actor, id: string, raw: unknown) {
  const input = EndSessionSchema.parse(raw);
  const now = ctx.clock.now();
  const s = await ctx.db.transaction(async (tx) => {
    const s = await lockSession(tx, id);
    if (s.status === 'ended') throw conflict('Session has already ended');
    const exp = expectedEndAt(s);
    const at = exp && exp < now ? exp : now;
    return finalizeSession(tx, actor, s, at, exp && exp <= now ? 'time_expired' : 'ended_by_staff', input);
  });
  ctx.bus.emit({ type: 'sessions.changed', sessionId: s.id, stationId: s.stationId });
  ctx.bus.emit({ type: 'payments.changed' });
  if (s.customerId) ctx.bus.emit({ type: 'customers.changed', customerId: s.customerId });
  return describeSession(s, now);
}

/** Pays off (all or part of) an ended session's unpaid balance — i.e. settles a tab. */
export async function settleSession(ctx: Ctx, actor: Actor, id: string, raw: unknown) {
  const input = SettleSessionSchema.parse(raw);
  const now = ctx.clock.now();
  const s = await ctx.db.transaction(async (tx) => {
    const s = await lockSession(tx, id);
    if (s.status !== 'ended') throw conflict('This session is still open — end it to take payment');
    const due = s.netAmount - s.paidAmount;
    if (due <= 0) throw conflict('Nothing is owed on this session');
    const tenders = resolveTenders(due, input, { allowPartial: true });
    const paid = tenders.reduce((a, t) => a + t.amount, 0);
    await collectTenders(tx, tenders, { kind: 'session', actor, customerId: s.customerId, sessionId: s.id, note: input.note, at: now });
    const [u] = await tx
      .update(sessions)
      .set({ paidAmount: s.paidAmount + paid, onTab: s.paidAmount + paid < s.netAmount })
      .where(eq(sessions.id, s.id))
      .returning();
    await awardPoints(tx, s.customerId, paid);
    await tx.insert(sessionEvents).values({ sessionId: s.id, type: 'payment', at: now, amount: paid, staffId: actor.staffId, meta: { tenders } });
    await audit(tx, actor, 'session.settle', { type: 'session', id: s.id }, { amount: paid, remaining: due - paid, tenders });
    return u;
  });
  ctx.bus.emit({ type: 'sessions.changed', sessionId: s.id, stationId: s.stationId });
  ctx.bus.emit({ type: 'payments.changed' });
  if (s.customerId) ctx.bus.emit({ type: 'customers.changed', customerId: s.customerId });
  return describeSession(s, now);
}

/** Used by the scheduler: ends a prepaid session whose time ran out, at its true expiry instant. */
export async function expireSession(ctx: Ctx, id: string) {
  const s = await ctx.db.transaction(async (tx) => {
    const s = await lockSession(tx, id);
    const exp = expectedEndAt(s);
    if (s.status !== 'running' || !exp || exp > ctx.clock.now()) return null;
    return finalizeSession(tx, { staffId: null }, s, exp, 'time_expired');
  });
  if (s) {
    ctx.bus.emit({ type: 'sessions.changed', sessionId: s.id, stationId: s.stationId });
    const [st] = await ctx.db.select({ name: stations.name }).from(stations).where(eq(stations.id, s.stationId));
    const name = st?.name ?? 'Station';
    ctx.bus.emit({ type: 'alert', level: 'warning', message: `${name}: time is up`, sessionId: s.id, stationId: s.stationId, sound: 'timeup', speak: `${name}, time up` });
  }
  return s;
}

/**
 * Outage recovery: called at boot when the last heartbeat is stale.
 * Sessions are paused at the heartbeat; prepaid sessions that would have expired during the outage end at expiry.
 */
export async function recoverAfterOutage(ctx: Ctx, lastHeartbeat: Date) {
  const open = await ctx.db.select().from(sessions).where(eq(sessions.status, 'running'));
  const changed: SessionRow[] = [];
  for (const row of open) {
    const s = await ctx.db.transaction(async (tx) => {
      const s = await lockSession(tx, row.id);
      if (s.status !== 'running') return null;
      const exp = expectedEndAt(s);
      if (exp && exp <= lastHeartbeat) return finalizeSession(tx, { staffId: null }, s, exp, 'time_expired');
      const pauseAt = s.lastResumedAt && s.lastResumedAt > lastHeartbeat ? s.lastResumedAt : lastHeartbeat;
      const active = activeSecondsAt(s, pauseAt);
      const [u] = await tx
        .update(sessions)
        .set({ status: 'paused', accumulatedSeconds: active, lastResumedAt: null })
        .where(eq(sessions.id, s.id))
        .returning();
      await tx.insert(sessionEvents).values({
        sessionId: s.id,
        type: 'system_pause',
        at: pauseAt,
        meta: { reason: 'server_offline', serverBackAt: ctx.clock.now().toISOString() },
      });
      await audit(tx, { staffId: null }, 'session.system_pause', { type: 'session', id: s.id }, { pausedAt: pauseAt });
      return u;
    });
    if (s) changed.push(s);
  }
  if (changed.length) {
    ctx.bus.emit({
      type: 'alert',
      level: 'warning',
      message: `Server was offline. ${changed.length} session(s) were paused or closed at the moment it went down — review and resume.`,
    });
  }
  return changed;
}
