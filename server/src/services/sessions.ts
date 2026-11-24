import { and, asc, eq, gt, ne, sql } from 'drizzle-orm';
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
import { customerCharges, customers, membershipTiers, pricingPlans, sessionEvents, sessions, stations } from '../db/schema.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { audit } from './audit.js';
import { getSettings } from './settings.js';
import { checkInBooking, completeBookingForSession } from './bookings.js';
import { findHappyHour, redeemPromo } from './promotions.js';
import { collectPayment, collectTenders, PaymentMethodSchema, resolveTenders, TenderInputSchema, type Tender } from './wallet.js';
import { refundSessionMoney } from './refunds.js';
import { planCategory, playableSeconds, postTime } from './time-bank.js';
import { moneyText } from './sms.js';
import { notifyLater } from './push.js';

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
  /** Prepaid: put the price on the customer's account to pay later (needs payments.tab and credit). */
  payLater: z.boolean().optional(),
});

export const ExtendSessionSchema = TenderInputSchema.extend({
  minutes: z.number().int().positive().max(24 * 60),
  /** pay = take money now (wallet = this account's wallet); saved = from this account's saved time; tab = put it on this account to pay later. */
  source: z.enum(['pay', 'saved', 'tab']).default('pay'),
  /** Customer whose wallet / saved time / account is used. Default: the session's customer. */
  accountId: z.string().uuid().nullish(),
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
  /** Walk-in session put on an account: the customer who will pay later. */
  accountId: z.string().uuid().optional(),
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

/** What a customer owes: unpaid sessions (put on their account) plus other charges on their account. */
export async function outstandingFor(tx: DbOrTx, customerId: string) {
  const [r] = await tx
    .select({ owed: sql<number>`coalesce(sum(${sessions.netAmount} - ${sessions.paidAmount}),0)::bigint` })
    .from(sessions)
    .where(and(eq(sessions.customerId, customerId), gt(sessions.netAmount, sessions.paidAmount)));
  const [c] = await tx
    .select({ owed: sql<number>`coalesce(sum(${customerCharges.amount} - ${customerCharges.paidAmount}),0)::bigint` })
    .from(customerCharges)
    .where(and(eq(customerCharges.customerId, customerId), gt(customerCharges.amount, customerCharges.paidAmount)));
  return Number(r?.owed ?? 0) + Number(c?.owed ?? 0);
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

    if (input.payLater) {
      if (!input.customerId) throw badRequest('Choose the customer whose account to put it on');
      if (input.billingType !== 'prepaid' || input.useSavedTime) throw badRequest('Only prepaid time can be put on the account at the start');
      requirePermission(actor, 'payments.tab', 'let customers pay later');
    }
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
      const [c] = await tx.select().from(customers).where(eq(customers.id, input.customerId!));
      const playable = playableSeconds(c, station.categoryId);
      fromSaved = input.minutes ? Math.min(input.minutes * 60, playable) : playable;
      if (fromSaved < 60) {
        throw conflict(c.savedSeconds >= 60 ? 'Their saved time is for another station type — change it on the customer page (Convert)' : 'This customer has no saved time left');
      }
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
      if (input.payLater) await checkCredit(tx, input.customerId!, net);
      else tenders = resolveTenders(net, input);
    }
    const unpaid = input.payLater ? net : 0;

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
        paidAmount: net - unpaid,
        onTab: unpaid > 0,
        note: input.note ?? null,
        startedBy: actor.staffId,
      })
      .returning();

    await collectTenders(tx, tenders, { kind: 'session', actor, customerId: input.customerId, sessionId: session.id, at: now });
    if (fromSaved > 0) {
      await postTime(tx, { customerId: input.customerId!, seconds: -fromSaved, kind: 'used', actor, at: now, categoryId: station.categoryId, sessionId: session.id, planName: plan.name });
    }
    if (input.bookingId) await checkInBooking(tx, input.bookingId, session, now);
    await tx.insert(sessionEvents).values({
      sessionId: session.id,
      type: 'start',
      at: now,
      secondsAdded: allottedSeconds,
      amount: net,
      staffId: actor.staffId,
      meta: fromSaved ? { fromSavedSeconds: fromSaved } : unpaid ? { onAccount: unpaid } : happyHourId || promoCodeId ? { happyHour: happyHourId ? happy!.name : undefined, promoCode: input.promoCode?.toUpperCase() } : null,
    });
    await audit(tx, actor, 'session.start', { type: 'session', id: session.id }, {
      station: station.code,
      plan: plan.name,
      billingType: input.billingType,
      amount: net,
      onAccount: unpaid || undefined,
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
  let account: string | null = null;
  const s = await ctx.db.transaction(async (tx) => {
    const s = await lockSession(tx, id);
    if (s.status === 'ended') throw conflict('Session has already ended');
    if (s.billingType !== 'prepaid' || s.allottedSeconds == null) throw badRequest('Only prepaid sessions can be extended');
    const exp = expectedEndAt(s);
    if (exp && exp <= now) throw conflict('Session time has already expired — start a new session');
    account = input.accountId ?? s.customerId;
    if (input.source !== 'pay' && !account) throw badRequest('Choose the customer account to take the time from');
    if (account) {
      const [c] = await tx.select({ id: customers.id, status: customers.status }).from(customers).where(eq(customers.id, account));
      if (!c) throw notFound('Customer');
      if (c.status !== 'active') throw conflict("That customer's account is suspended");
    }
    const seconds = input.minutes * 60;
    let set: Partial<SessionRow> = { allottedSeconds: s.allottedSeconds + seconds, billedMinutes: s.billedMinutes + input.minutes };
    let net = 0;
    let tenders: Tender[] = [];
    const meta: Record<string, unknown> = { source: input.source, ...(account && account !== s.customerId ? { accountId: account } : {}) };
    if (input.source === 'saved') {
      const [st] = await tx.select({ categoryId: stations.categoryId }).from(stations).where(eq(stations.id, s.stationId));
      await postTime(tx, { customerId: account!, seconds: -seconds, kind: 'used', actor, at: now, categoryId: st?.categoryId ?? null, sessionId: s.id, planName: s.rate.planName });
      set = { ...set, fromSavedSeconds: s.fromSavedSeconds + seconds };
    } else {
      const charge = wrapBilling(() => computeExtension(s.rate, input.minutes));
      const d = applyDiscount(charge.amount, s.discountPercent);
      net = d.net;
      set = { ...set, grossAmount: s.grossAmount + charge.amount, discountAmount: s.discountAmount + d.discount, netAmount: s.netAmount + net };
      if (input.source === 'tab') {
        requirePermission(actor, 'payments.tab', 'let customers pay later');
        await checkCredit(tx, account!, net);
        if (account === s.customerId) {
          set = { ...set, onTab: true };
        } else {
          // Another player pays later: the debt goes on their account, this session counts as settled.
          const [st] = await tx.select({ name: stations.name }).from(stations).where(eq(stations.id, s.stationId));
          await tx.insert(customerCharges).values({ customerId: account!, amount: net, note: `${input.minutes} min added on ${st?.name ?? 'a station'} (session #${s.number})`, sessionId: s.id, staffId: actor.staffId, createdAt: now });
          set = { ...set, paidAmount: s.paidAmount + net };
        }
        meta.onAccount = net;
      } else {
        tenders = resolveTenders(net, input);
        set = { ...set, paidAmount: s.paidAmount + net };
      }
    }
    const [u] = await tx.update(sessions).set(set).where(eq(sessions.id, s.id)).returning();
    await collectTenders(tx, tenders, { kind: 'extension', actor, customerId: account ?? s.customerId, sessionId: s.id, at: now });
    await tx.insert(sessionEvents).values({ sessionId: s.id, type: 'extend', at: now, secondsAdded: seconds, amount: net, staffId: actor.staffId, meta });
    await audit(tx, actor, 'session.extend', { type: 'session', id: s.id }, { minutes: input.minutes, amount: net, tenders, ...meta });
    return u;
  });
  ctx.bus.emit({ type: 'sessions.changed', sessionId: s.id, stationId: s.stationId });
  ctx.bus.emit({ type: 'payments.changed' });
  if (account) ctx.bus.emit({ type: 'customers.changed', customerId: account });
  return describeSession(s, now);
}

export const ReduceSessionSchema = z.object({
  minutes: z.number().int().positive().max(24 * 60),
  /** saved = the time goes on the customer's saved time; refund = money back (or less to pay later); keep = just shorter. */
  back: z.enum(['saved', 'refund', 'keep']).default('saved'),
  /** Refund: how the money goes back (wallet-paid money always returns to the wallet). */
  method: PaymentMethodSchema.optional(),
  reason: z.string().trim().max(300).nullish(),
});

/** Takes minutes off a running fixed-time session. At least one minute must be left — otherwise end the session. */
export async function reduceSession(ctx: Ctx, actor: Actor, id: string, raw: unknown) {
  const input = ReduceSessionSchema.parse(raw);
  const now = ctx.clock.now();
  const s = await ctx.db.transaction(async (tx) => {
    const s = await lockSession(tx, id);
    if (s.status === 'ended') throw conflict('Session has already ended');
    if (s.billingType !== 'prepaid' || s.allottedSeconds == null) throw badRequest('Only fixed-time sessions can have time taken off — pay-as-you-go is billed for the time played');
    const left = s.allottedSeconds - activeSecondsAt(s, now);
    const most = Math.floor((left - 60) / 60);
    const seconds = input.minutes * 60;
    if (most < 1) throw conflict('Less than 2 minutes are left — end the session instead');
    if (input.minutes > most) throw badRequest(`At most ${most} min can be taken off (${Math.floor(left / 60)} min left)`);
    let set: Partial<SessionRow> = { allottedSeconds: s.allottedSeconds - seconds, billedMinutes: Math.max(0, s.billedMinutes - input.minutes) };
    const meta: Record<string, unknown> = { back: input.back, ...(input.reason ? { reason: input.reason } : {}) };
    let refunded = 0;
    const toSaved = async (secs: number) => {
      if (secs <= 0) return;
      if (!s.customerId) throw badRequest('Putting time back on saved time needs a registered customer on the session');
      const [st] = await tx.select({ categoryId: stations.categoryId }).from(stations).where(eq(stations.id, s.stationId));
      // Time that came from saved time goes back to the same station type; bought time follows its price.
      const categoryId = s.fromSavedSeconds > 0 ? (st?.categoryId ?? null) : await planCategory(tx, s.planId);
      await postTime(tx, { customerId: s.customerId, seconds: secs, kind: 'saved', actor, at: now, categoryId, sessionId: s.id, planName: s.rate.planName, note: 'Time taken off a running session' });
    };
    if (input.back === 'saved') {
      await toSaved(seconds);
      set.fromSavedSeconds = Math.max(0, s.fromSavedSeconds - seconds);
      meta.savedSeconds = seconds;
    } else if (input.back === 'refund') {
      // Saved time first goes back to saved time; the bought part is worth its share of the price.
      const fromSaved = Math.min(seconds, s.fromSavedSeconds);
      await toSaved(fromSaved);
      const boughtTotal = s.allottedSeconds - s.fromSavedSeconds;
      const bought = seconds - fromSaved;
      const netShare = bought > 0 && boughtTotal > 0 ? Math.round((s.netAmount * bought) / boughtTotal) : 0;
      const grossShare = bought > 0 && boughtTotal > 0 ? Math.round((s.grossAmount * bought) / boughtTotal) : 0;
      const net = s.netAmount - netShare;
      set = {
        ...set,
        fromSavedSeconds: s.fromSavedSeconds - fromSaved,
        netAmount: net,
        grossAmount: s.grossAmount - grossShare,
        discountAmount: Math.max(0, s.discountAmount - (grossShare - netShare)),
        onTab: s.paidAmount < net,
      };
      // Money back only for what was paid beyond the new price; anything unpaid simply costs less.
      refunded = Math.max(0, s.paidAmount - s.refundedAmount - net);
      if (refunded > 0) {
        requirePermission(actor, 'payments.refund', 'give money back');
        await refundSessionMoney(tx, actor, s.id, refunded, input.method, input.reason || `${input.minutes} min taken off`, now);
      }
      meta.priceCut = netShare;
      if (fromSaved) meta.savedSeconds = fromSaved;
    }
    const [u] = await tx.update(sessions).set(set).where(eq(sessions.id, s.id)).returning();
    await tx.insert(sessionEvents).values({ sessionId: s.id, type: 'reduce', at: now, secondsAdded: -seconds, amount: refunded, staffId: actor.staffId, meta });
    await audit(tx, actor, 'session.reduce', { type: 'session', id: s.id }, { minutes: input.minutes, refunded, ...meta });
    return u;
  });
  ctx.bus.emit({ type: 'sessions.changed', sessionId: s.id, stationId: s.stationId });
  ctx.bus.emit({ type: 'payments.changed' });
  if (s.customerId) ctx.bus.emit({ type: 'customers.changed', customerId: s.customerId });
  return describeSession(s, now);
}

/** Refuses a tab that would take the customer past their credit limit. */
async function checkCredit(tx: DbOrTx, customerId: string | null, adding: number) {
  if (!customerId) throw badRequest('Pay later needs a registered customer');
  const [c] = await tx.select().from(customers).where(eq(customers.id, customerId)).for('update');
  if (!c) throw notFound('Customer');
  const limit = c.creditLimit > 0 ? c.creditLimit : (await getSettings(tx)).defaultCreditLimit;
  if (limit <= 0) throw conflict(`${c.fullName} has no credit limit — set one on their customer page (or a default in Settings → Payments)`);
  const owed = await outstandingFor(tx, customerId);
  if (owed + adding > limit) {
    const st = await getSettings(tx);
    throw conflict(`Credit limit reached: ${c.fullName} already owes ${moneyText(owed, st)} of a ${moneyText(limit, st)} limit`);
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
      await postTime(tx, { customerId: s.customerId, seconds: left, kind: 'saved', actor, at, categoryId: await planCategory(tx, s.planId), sessionId: s.id, planName: s.rate.planName });
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
    let s = await lockSession(tx, id);
    if (s.status === 'ended') throw conflict('Session has already ended');
    if (input.accountId && input.payLater && !s.customerId) {
      // A walk-in who will pay later: the session becomes theirs.
      const [c] = await tx.select({ id: customers.id, status: customers.status }).from(customers).where(eq(customers.id, input.accountId));
      if (!c) throw notFound('Customer');
      if (c.status !== 'active') throw conflict("That customer's account is suspended");
      [s] = await tx.update(sessions).set({ customerId: c.id }).where(eq(sessions.id, s.id)).returning();
    }
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
    notifyLater(ctx, s.customerId, { title: '⏰ Time is up', body: `Your time on ${name} has finished. Thanks for playing!`, url: '/portal', tag: `session-${s.id}` });
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

// ───────────── The customer's account (tab): everything they owe ─────────────

/** Unpaid sessions and charges on a customer's account, oldest first. */
export async function tabItems(tx: DbOrTx, customerId: string) {
  const ss = await tx
    .select({ s: sessions, stationName: stations.name })
    .from(sessions)
    .innerJoin(stations, eq(stations.id, sessions.stationId))
    .where(and(eq(sessions.customerId, customerId), gt(sessions.netAmount, sessions.paidAmount)))
    .orderBy(asc(sessions.startedAt));
  const cs = await tx
    .select()
    .from(customerCharges)
    .where(and(eq(customerCharges.customerId, customerId), gt(customerCharges.amount, customerCharges.paidAmount)))
    .orderBy(asc(customerCharges.createdAt));
  return [
    ...ss.map(({ s, stationName }) => ({
      kind: 'session' as const,
      id: s.id,
      label: `${stationName} · ${s.rate.planName}${s.status !== 'ended' ? ' (playing now)' : ''}`,
      amount: s.netAmount,
      owed: s.netAmount - s.paidAmount,
      at: s.startedAt,
    })),
    ...cs.map((c) => ({ kind: 'charge' as const, id: c.id, label: c.note, amount: c.amount, owed: c.amount - c.paidAmount, at: c.createdAt })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
}

export const ChargeSchema = z.object({
  amount: z.number().int().positive(),
  note: z.string().trim().min(2, 'Write what it is for').max(200),
});

/** Puts an amount on a customer's account to pay later (play not paid for, drinks…). Needs payments.tab. */
export async function addCharge(ctx: Ctx, actor: Actor, customerId: string, raw: unknown) {
  requirePermission(actor, 'payments.tab', 'let customers pay later');
  const b = ChargeSchema.parse(raw);
  const now = ctx.clock.now();
  const row = await ctx.db.transaction(async (tx) => {
    await checkCredit(tx, customerId, b.amount);
    const [c] = await tx.insert(customerCharges).values({ customerId, amount: b.amount, note: b.note, staffId: actor.staffId, createdAt: now }).returning();
    await audit(tx, actor, 'customer.charge', { type: 'customer', id: customerId }, { amount: b.amount, note: b.note });
    return c;
  });
  ctx.bus.emit({ type: 'customers.changed', customerId });
  return row;
}

/** Removes a charge put on by mistake (only while nothing of it is paid). */
export async function removeCharge(ctx: Ctx, actor: Actor, chargeId: string) {
  requirePermission(actor, 'payments.tab', 'change customer accounts');
  const row = await ctx.db.transaction(async (tx) => {
    const [c] = await tx.select().from(customerCharges).where(eq(customerCharges.id, chargeId)).for('update');
    if (!c) throw notFound('Charge');
    if (c.paidAmount > 0) throw conflict('Part of this is already paid — it cannot be removed');
    if (c.sessionId) throw conflict('This came from adding time to a session — it cannot be removed here');
    await tx.delete(customerCharges).where(eq(customerCharges.id, c.id));
    await audit(tx, actor, 'customer.charge_remove', { type: 'customer', id: c.customerId }, { amount: c.amount, note: c.note });
    return c;
  });
  ctx.bus.emit({ type: 'customers.changed', customerId: row.customerId });
  return { ok: true };
}

/** Takes payment for (part of) everything a customer owes, oldest first. */
export async function payTab(ctx: Ctx, actor: Actor, customerId: string, raw: unknown) {
  const input = SettleSessionSchema.parse(raw);
  const now = ctx.clock.now();
  const out = await ctx.db.transaction((tx) => payTabTx(tx, actor, customerId, input, now));
  ctx.bus.emit({ type: 'customers.changed', customerId });
  ctx.bus.emit({ type: 'payments.changed' });
  return out;
}

/**
 * Pays what a customer owes from their wallet, as far as the wallet goes. Used right after money goes into the wallet
 * (when the autoPayOwed setting is on) and by "Pay from my wallet" in the app. Returns the amount paid.
 */
export async function payOwedFromWallet(tx: DbOrTx, customerId: string, actor: Actor, at: Date, opts: { force?: boolean } = {}) {
  if (!opts.force && !(await getSettings(tx)).autoPayOwed) return 0;
  const owed = await outstandingFor(tx, customerId);
  if (owed <= 0) return 0;
  const [c] = await tx.select({ balance: customers.balance }).from(customers).where(eq(customers.id, customerId));
  const amount = Math.min(owed, c?.balance ?? 0);
  if (amount <= 0) return 0;
  const r = await payTabTx(tx, actor, customerId, { payments: [{ method: 'wallet', amount }], note: 'Paid from the wallet' }, at);
  return r.paid;
}

async function payTabTx(tx: DbOrTx, actor: Actor, customerId: string, input: z.infer<typeof SettleSessionSchema>, now: Date) {
  {
    const items = await tabItems(tx, customerId);
    const due = items.reduce((a, i) => a + i.owed, 0);
    if (due <= 0) throw conflict('Nothing is owed');
    const queue = resolveTenders(due, input, { allowPartial: true }).map((t) => ({ ...t }));
    let paidTotal = 0;
    for (const item of items) {
      let need = item.owed;
      let paid = 0;
      while (need > 0 && queue.length) {
        const t = queue[0];
        const take = Math.min(need, t.amount);
        await collectPayment(tx, { amount: take, method: t.method, reference: t.reference, kind: 'session', actor, customerId, sessionId: item.kind === 'session' ? item.id : null, note: input.note ?? (item.kind === 'charge' ? `Account: ${item.label}` : 'Account payment'), at: now });
        t.amount -= take;
        need -= take;
        paid += take;
        if (t.amount === 0) queue.shift();
      }
      if (!paid) break;
      paidTotal += paid;
      if (item.kind === 'session') {
        const [cur] = await tx.select().from(sessions).where(eq(sessions.id, item.id)).for('update');
        await tx.update(sessions).set({ paidAmount: cur.paidAmount + paid, onTab: cur.paidAmount + paid < cur.netAmount }).where(eq(sessions.id, item.id));
        await tx.insert(sessionEvents).values({ sessionId: item.id, type: 'payment', at: now, amount: paid, staffId: actor.staffId, meta: { account: true } });
        await awardPoints(tx, customerId, paid);
      } else {
        const [cur] = await tx.select().from(customerCharges).where(eq(customerCharges.id, item.id)).for('update');
        const total = cur.paidAmount + paid;
        await tx.update(customerCharges).set({ paidAmount: total, paidAt: total >= cur.amount ? now : null }).where(eq(customerCharges.id, item.id));
      }
    }
    await audit(tx, actor, 'customer.account_pay', { type: 'customer', id: customerId }, { amount: paidTotal, remaining: due - paidTotal });
    return { paid: paidTotal, remaining: due - paidTotal };
  }
}
