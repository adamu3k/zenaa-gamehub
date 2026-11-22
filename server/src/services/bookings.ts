/**
 * Station bookings (reservations), made by customers in the portal or by staff at the desk.
 * One station can never have two overlapping live bookings (pending / confirmed / checked in).
 */
import { and, asc, eq, gt, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Actor, Ctx } from '../context.js';
import type { DbOrTx } from '../db/index.js';
import { bookings, customers, sessions, stationCategories, stations } from '../db/schema.js';
import { normalizePhone } from '../lib/countries.js';
import { AppError, badRequest, conflict, notFound } from '../lib/errors.js';
import { audit } from './audit.js';
import { getSettings, type AppSettings } from './settings.js';
import { formatCustomerCode } from './wallet.js';

export const LIVE_STATUSES = ['pending', 'confirmed', 'checked_in'] as const;
const MAX_UPCOMING_PER_CUSTOMER = 3;

export const BookingCreateSchema = z.object({
  stationId: z.string().uuid(),
  startAt: z.coerce.date(),
  minutes: z.number().int().min(15).max(12 * 60),
  note: z.string().trim().max(300).nullish(),
  // Staff only:
  customerId: z.string().uuid().nullish(),
  contactName: z.string().trim().max(80).nullish(),
  contactPhone: z.string().trim().max(24).nullish(),
});

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** True when [start, end] fits inside one opening period (handles closing after midnight; equal times = 24 h). */
export function withinOpeningHours(start: Date, end: Date, s: Pick<AppSettings, 'openingTime' | 'closingTime'>) {
  const open = toMin(s.openingTime);
  const close = toMin(s.closingTime);
  if (open === close) return true;
  for (const offset of [-1, 0]) {
    const winStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset, 0, open);
    const winEnd = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset + (close <= open ? 1 : 0), 0, close);
    if (start >= winStart && end <= winEnd) return true;
  }
  return false;
}

async function overlapping(tx: DbOrTx, stationId: string, start: Date, end: Date, excludeId?: string) {
  const [b] = await tx
    .select({ id: bookings.id, startAt: bookings.startAt, endAt: bookings.endAt })
    .from(bookings)
    .where(
      and(
        eq(bookings.stationId, stationId),
        inArray(bookings.status, [...LIVE_STATUSES]),
        lt(bookings.startAt, end),
        gt(bookings.endAt, start),
        excludeId ? ne(bookings.id, excludeId) : undefined,
      ),
    )
    .limit(1);
  return b ?? null;
}

/** A station is busy "now" for bookings that start within the next hour if a session is open on it. */
async function busyWithSession(tx: DbOrTx, stationId: string, start: Date, now: Date) {
  if (start.getTime() - now.getTime() > 60 * 60_000) return false;
  const [open] = await tx
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.stationId, stationId), ne(sessions.status, 'ended')))
    .limit(1);
  return !!open;
}

export async function createBooking(
  ctx: Ctx,
  who: { source: 'portal'; customerId: string } | { source: 'staff'; actor: Actor },
  raw: unknown,
) {
  const input = BookingCreateSchema.parse(raw);
  const settings = await getSettings(ctx.db);
  const now = ctx.clock.now();
  const start = input.startAt;
  const end = new Date(start.getTime() + input.minutes * 60_000);
  const portal = who.source === 'portal';

  if (portal) {
    if (!settings.bookingsEnabled) throw new AppError(403, 'Online booking is switched off — please call the centre', 'forbidden');
    if (start.getTime() < now.getTime() + settings.bookingMinNoticeMinutes * 60_000) {
      throw badRequest(`Bookings must be made at least ${settings.bookingMinNoticeMinutes} minutes ahead`);
    }
    if (start.getTime() > now.getTime() + settings.bookingMaxDaysAhead * 86_400_000) {
      throw badRequest(`You can book up to ${settings.bookingMaxDaysAhead} days ahead`);
    }
    if (!withinOpeningHours(start, end, settings)) {
      throw badRequest(`That time is outside opening hours (${settings.openingTime}–${settings.closingTime})`);
    }
  } else if (start.getTime() < now.getTime() - 15 * 60_000) {
    throw badRequest('That start time is in the past');
  }

  const customerId = portal ? who.customerId : (input.customerId ?? null);
  const contactPhone = !portal && input.contactPhone ? normalizePhone(input.contactPhone.replace(/[^0-9+]/g, ''), settings.phonePrefix) : null;
  if (!portal && !customerId && !input.contactName) throw badRequest('Choose a customer or enter a contact name');

  const row = await ctx.db.transaction(async (tx) => {
    // Lock the station so two people cannot grab the same slot at the same moment.
    const [station] = await tx.select().from(stations).where(eq(stations.id, input.stationId)).for('update');
    if (!station || station.status === 'archived') throw notFound('Station');
    if (station.status !== 'active' && (portal || station.status === 'offline')) throw conflict(`${station.name} is not available for booking`);
    if (customerId) {
      const [c] = await tx.select().from(customers).where(eq(customers.id, customerId));
      if (!c) throw notFound('Customer');
      if (c.status !== 'active') throw conflict('This customer account is suspended');
      if (portal) {
        const [{ n }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(bookings)
          .where(and(eq(bookings.customerId, customerId), inArray(bookings.status, ['pending', 'confirmed']), gt(bookings.endAt, now)));
        if (Number(n) >= MAX_UPCOMING_PER_CUSTOMER) throw conflict(`You can have at most ${MAX_UPCOMING_PER_CUSTOMER} upcoming bookings`);
      }
    }
    const clash = await overlapping(tx, station.id, start, end);
    if (clash) throw conflict(`${station.name} is already booked at that time — pick another station or time`);
    if (portal && (await busyWithSession(tx, station.id, start, now))) throw conflict(`${station.name} is in use right now — pick another station`);

    const [b] = await tx
      .insert(bookings)
      .values({
        customerId,
        contactName: customerId ? null : (input.contactName ?? null),
        contactPhone,
        stationId: station.id,
        startAt: start,
        endAt: end,
        status: portal && !settings.bookingAutoConfirm ? 'pending' : 'confirmed',
        source: who.source,
        note: input.note ?? null,
        createdBy: portal ? null : who.actor.staffId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await audit(tx, portal ? { staffId: null } : who.actor, 'booking.create', { type: 'booking', id: b.id }, {
      station: station.code,
      startAt: start.toISOString(),
      minutes: input.minutes,
      source: who.source,
      customerId,
    });
    return b;
  });
  ctx.bus.emit({ type: 'bookings.changed', bookingId: row.id, stationId: row.stationId });
  return row;
}

type Transition = 'confirm' | 'cancel' | 'no_show';

export async function changeBooking(
  ctx: Ctx,
  id: string,
  action: Transition,
  who: { by: 'customer'; customerId: string } | { by: 'staff'; actor: Actor },
  reason?: string | null,
) {
  const now = ctx.clock.now();
  const row = await ctx.db.transaction(async (tx) => {
    const [b] = await tx.select().from(bookings).where(eq(bookings.id, id)).for('update');
    if (!b || (who.by === 'customer' && b.customerId !== who.customerId)) throw notFound('Booking');
    if (b.status !== 'pending' && b.status !== 'confirmed') throw conflict(`This booking is already ${b.status.replace('_', ' ')}`);
    if (who.by === 'customer') {
      if (action !== 'cancel') throw badRequest('Not allowed');
      if (b.startAt <= now) throw conflict('This booking has already started — please speak to staff');
    }
    if (action === 'confirm' && b.status !== 'pending') throw conflict('Booking is already confirmed');
    const status = action === 'confirm' ? 'confirmed' : action === 'cancel' ? 'cancelled' : 'no_show';
    const [u] = await tx
      .update(bookings)
      .set({ status, cancelReason: action === 'cancel' ? (reason ?? (who.by === 'customer' ? 'Cancelled by customer' : null)) : b.cancelReason, updatedAt: now })
      .where(eq(bookings.id, b.id))
      .returning();
    await audit(tx, who.by === 'staff' ? who.actor : { staffId: null }, `booking.${action}`, { type: 'booking', id: b.id }, { reason, by: who.by });
    return u;
  });
  ctx.bus.emit({ type: 'bookings.changed', bookingId: row.id, stationId: row.stationId });
  return row;
}

/** Links a booking to the session that was started for it (called inside startSession's transaction). */
export async function checkInBooking(tx: DbOrTx, bookingId: string, session: { id: string; stationId: string }, at: Date) {
  const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).for('update');
  if (!b) throw notFound('Booking');
  if (b.status !== 'pending' && b.status !== 'confirmed') throw conflict(`This booking is ${b.status.replace('_', ' ')} and cannot be checked in`);
  await tx
    .update(bookings)
    // The customer may have been moved to another station at the desk.
    .set({ status: 'checked_in', sessionId: session.id, stationId: session.stationId, updatedAt: at })
    .where(eq(bookings.id, b.id));
  return b;
}

export async function completeBookingForSession(tx: DbOrTx, sessionId: string, at: Date) {
  await tx
    .update(bookings)
    .set({ status: 'completed', updatedAt: at })
    .where(and(eq(bookings.sessionId, sessionId), eq(bookings.status, 'checked_in')));
}

/** Bookings nobody turned up for become no-shows after the grace period. */
export async function sweepNoShows(ctx: Ctx) {
  const { bookingGraceMinutes } = await getSettings(ctx.db);
  const cutoff = new Date(ctx.clock.now().getTime() - bookingGraceMinutes * 60_000);
  const rows = await ctx.db
    .update(bookings)
    .set({ status: 'no_show', updatedAt: ctx.clock.now() })
    .where(and(inArray(bookings.status, ['pending', 'confirmed']), lt(bookings.startAt, cutoff)))
    .returning({ id: bookings.id });
  if (rows.length) ctx.bus.emit({ type: 'bookings.changed' });
  return rows.length;
}

export async function listBookings(
  db: DbOrTx,
  q: { from?: Date; to?: Date; customerId?: string; stationId?: string; status?: string[] },
) {
  const rows = await db
    .select({ b: bookings, stationName: stations.name, stationCode: stations.code, customerName: customers.fullName, customerNumber: customers.number, customerPhone: customers.phone })
    .from(bookings)
    .innerJoin(stations, eq(stations.id, bookings.stationId))
    .leftJoin(customers, eq(customers.id, bookings.customerId))
    .where(
      and(
        q.from ? gte(bookings.endAt, q.from) : undefined,
        q.to ? lt(bookings.startAt, q.to) : undefined,
        q.customerId ? eq(bookings.customerId, q.customerId) : undefined,
        q.stationId ? eq(bookings.stationId, q.stationId) : undefined,
        q.status?.length ? inArray(bookings.status, q.status as any) : undefined,
      ),
    )
    .orderBy(asc(bookings.startAt))
    .limit(500);
  return rows.map((r) => ({
    ...r.b,
    stationName: r.stationName,
    stationCode: r.stationCode,
    name: r.customerName ?? r.b.contactName ?? 'Guest',
    phone: r.customerPhone ?? r.b.contactPhone,
    customerCode: r.customerNumber != null ? formatCustomerCode(r.customerNumber) : null,
    minutes: Math.round((r.b.endAt.getTime() - r.b.startAt.getTime()) / 60_000),
  }));
}

/** Which stations are free for [start, start+minutes) — used by the portal booking screen. */
export async function availability(ctx: Ctx, start: Date, minutes: number) {
  const end = new Date(start.getTime() + minutes * 60_000);
  const now = ctx.clock.now();
  const settings = await getSettings(ctx.db);
  const list = await ctx.db
    .select({ s: stations, categoryName: stationCategories.name })
    .from(stations)
    .leftJoin(stationCategories, eq(stationCategories.id, stations.categoryId))
    .where(ne(stations.status, 'archived'))
    .orderBy(asc(stations.sortOrder), asc(stations.code));
  const out = [];
  for (const { s, categoryName } of list) {
    let reason: string | null = null;
    if (s.status !== 'active') reason = 'Not available';
    else if (await overlapping(ctx.db, s.id, start, end)) reason = 'Booked';
    else if (await busyWithSession(ctx.db, s.id, start, now)) reason = 'In use now';
    out.push({ id: s.id, code: s.code, name: s.name, platform: s.platform, categoryName, available: !reason, reason });
  }
  return { openingTime: settings.openingTime, closingTime: settings.closingTime, withinHours: withinOpeningHours(start, end, settings), stations: out };
}

/** Next live booking per station starting within `withinMinutes` (or running now) — for the station grid. */
export async function upcomingByStation(db: DbOrTx, now: Date, withinMinutes = 120) {
  const until = new Date(now.getTime() + withinMinutes * 60_000);
  const rows = await listBookings(db, { from: now, to: until, status: ['pending', 'confirmed'] });
  const map = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!map.has(r.stationId)) map.set(r.stationId, r);
  return map;
}
