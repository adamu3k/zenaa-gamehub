/**
 * Customers running their own session from the app: start their booking (or saved time on a free station),
 * pause, continue, and stop early (the time left goes back on their account).
 * Only time that is already paid (saved time, or a booking paid from the wallet) can be started here —
 * anything that needs money goes through the counter.
 */
import { and, eq, gt, inArray, lt, ne } from 'drizzle-orm';
import { z } from 'zod';
import type { Actor, Ctx } from '../context.js';
import { bookings, customers, sessions, stations } from '../db/schema.js';
import { AppError, badRequest, conflict, notFound } from '../lib/errors.js';
import { defaultPlanFor, LIVE_STATUSES } from './bookings.js';
import { describeSession, endSession, pauseSession, reduceSession, resumeSession, startSession } from './sessions.js';
import { getSettings } from './settings.js';
import { playableSeconds } from './time-bank.js';

const EARLY_MIN = 15;

export const SelfStartSchema = z.object({
  bookingId: z.string().uuid().optional(),
  stationId: z.string().uuid().optional(),
  /** Minutes to play (default: the booking's length, or all saved time). */
  minutes: z.number().int().min(5).max(24 * 60).optional(),
});

const appActor = (customerId: string): Actor => ({ staffId: null, ip: `app:${customerId}` });

async function enabled(ctx: Ctx) {
  const s = await getSettings(ctx.db);
  if (!s.portalSelfStart) throw new AppError(403, 'Starting from the app is switched off — please go to the counter', 'self_start_off');
  return s;
}

/** The customer's open session, if any. */
export async function mySession(ctx: Ctx, customerId: string) {
  const [r] = await ctx.db
    .select({ s: sessions, stationName: stations.name })
    .from(sessions)
    .innerJoin(stations, eq(stations.id, sessions.stationId))
    .where(and(eq(sessions.customerId, customerId), ne(sessions.status, 'ended')))
    .limit(1);
  if (!r) return null;
  const d = describeSession(r.s, ctx.clock.now());
  return {
    id: d.id,
    stationName: r.stationName,
    status: d.status,
    billingType: d.billingType,
    planName: d.rate.planName,
    activeSeconds: d.activeSeconds,
    remainingSeconds: d.remainingSeconds,
    expectedEndAt: d.expectedEndAt,
    liveNetAmount: d.liveNetAmount,
    startedAt: d.startedAt,
    canStop: d.billingType === 'prepaid',
  };
}

export async function selfStart(ctx: Ctx, customerId: string, raw: unknown) {
  await enabled(ctx);
  const b = SelfStartSchema.parse(raw);
  if (!b.bookingId && !b.stationId) throw badRequest('Choose your booking or a free station');
  if (await mySession(ctx, customerId)) throw conflict('You are already playing — stop that session first');
  const now = ctx.clock.now();
  const [c] = await ctx.db.select().from(customers).where(eq(customers.id, customerId));
  if (!c || c.status !== 'active') throw notFound('Account');

  let stationId = b.stationId!;
  let minutes = b.minutes;
  if (b.bookingId) {
    const [bk] = await ctx.db.select().from(bookings).where(eq(bookings.id, b.bookingId));
    if (!bk || bk.customerId !== customerId) throw notFound('Booking');
    if (bk.status !== 'pending' && bk.status !== 'confirmed') throw conflict(`This booking is ${bk.status.replace('_', ' ')}`);
    if (now.getTime() < bk.startAt.getTime() - EARLY_MIN * 60_000) throw conflict(`You can start from ${EARLY_MIN} minutes before your booking`);
    if (now >= bk.endAt) throw conflict('This booking time has passed');
    if (bk.payment === 'counter') throw conflict('This booking is not paid yet — pay it from your wallet in the app, or at the counter');
    stationId = bk.stationId;
    minutes ??= Math.round((bk.endAt.getTime() - bk.startAt.getTime()) / 60_000);
  }
  const [station] = await ctx.db.select().from(stations).where(eq(stations.id, stationId));
  if (!station || station.status !== 'active' || station.deletedAt) throw conflict('That station is not available');

  const have = playableSeconds(c, station.categoryId);
  if (have < 60) {
    throw conflict(c.savedSeconds >= 60 ? `Your saved time is for another station type — change it in Wallet → Saved time` : 'You have no saved time — buy time at the counter or pay a booking from your wallet');
  }
  const seconds = Math.min(have, (minutes ?? Math.floor(have / 60)) * 60);

  if (!b.bookingId) {
    // Don't take a station someone else has booked during this time.
    const until = new Date(now.getTime() + seconds * 1000);
    const [clash] = await ctx.db
      .select({ id: bookings.id, startAt: bookings.startAt })
      .from(bookings)
      .where(and(eq(bookings.stationId, station.id), inArray(bookings.status, [...LIVE_STATUSES]), lt(bookings.startAt, until), gt(bookings.endAt, now), ne(bookings.customerId, customerId)))
      .limit(1);
    if (clash) {
      const mins = Math.floor((clash.startAt.getTime() - now.getTime()) / 60_000);
      throw conflict(mins >= 10 ? `${station.name} is booked in ${mins} min — choose up to ${mins} min, or another station` : `${station.name} is booked now — choose another station`);
    }
  }
  const plan = await defaultPlanFor(ctx.db, station);
  if (!plan) throw conflict('No price is set for this station — ask at the counter');
  return startSession(ctx, appActor(customerId), {
    stationId: station.id,
    planId: plan.id,
    billingType: 'prepaid',
    customerId,
    useSavedTime: true,
    minutes: Math.floor(seconds / 60),
    bookingId: b.bookingId ?? null,
    note: 'Started by the customer in the app',
  });
}

async function own(ctx: Ctx, customerId: string, id: string) {
  const [s] = await ctx.db.select().from(sessions).where(eq(sessions.id, id));
  if (!s || s.customerId !== customerId) throw notFound('Session');
  return s;
}

export async function selfPause(ctx: Ctx, customerId: string, id: string) {
  const st = await enabled(ctx);
  await own(ctx, customerId, id);
  // Customers can't choose "clock stopped only" — the screen is always locked while paused.
  return pauseSession(ctx, appActor(customerId), id, { mode: st.powerOffOnPause ? 'off' : 'screen' });
}

export async function selfResume(ctx: Ctx, customerId: string, id: string) {
  await enabled(ctx);
  await own(ctx, customerId, id);
  return resumeSession(ctx, appActor(customerId), id);
}

/** Takes minutes off the customer's own fixed-time session; they go back on their saved time. */
export async function selfReduce(ctx: Ctx, customerId: string, id: string, raw: unknown) {
  await enabled(ctx);
  const s = await own(ctx, customerId, id);
  if (s.billingType !== 'prepaid') throw conflict('Pay-as-you-go sessions are ended and paid at the counter');
  const { minutes } = z.object({ minutes: z.number().int().positive().max(24 * 60) }).parse(raw);
  return reduceSession(ctx, appActor(customerId), id, { minutes, back: 'saved' });
}

/** Stops a prepaid session early; the time left goes back on the customer's saved time. */
export async function selfStop(ctx: Ctx, customerId: string, id: string) {
  await enabled(ctx);
  const s = await own(ctx, customerId, id);
  if (s.billingType !== 'prepaid') throw conflict('Pay-as-you-go sessions are ended and paid at the counter');
  return endSession(ctx, appActor(customerId), id, { saveRemaining: true });
}
