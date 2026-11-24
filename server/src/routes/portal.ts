/**
 * Customer portal API (/api/portal/*): sign-up / sign-in, profile, wallet top-up by Paystack, bookings.
 * Customer tokens are separate from staff tokens (typ: 'customer') and can never reach staff endpoints.
 */
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { avatarUrl } from '../competitions/common.js';
import type { Ctx } from '../context.js';
import { customers, membershipTiers, onlinePayments, pricingPlans, sessions, stationCategories, stations, walletTransactions } from '../db/schema.js';
import { normalizePhone } from '../lib/countries.js';
import { AppError, badRequest, conflict, forbidden, notFound, parse, unauthorized } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { audit } from '../services/audit.js';
import { availability, changeBooking, createBooking, defaultPlanFor, listBookings, payBooking } from '../services/bookings.js';
import { mySession, selfPause, selfReduce, selfResume, selfStart, selfStop } from '../services/self-play.js';
import { pushPublicKey, subscribe, unsubscribe, notifyCustomer } from '../services/push.js';
import { getPaystackConfig, startTopup, TopupSchema, verifyOnlinePayment } from '../services/paystack.js';
import { outstandingFor, payOwedFromWallet } from '../services/sessions.js';
import { getSettings } from '../services/settings.js';
import { convertTime, playableSeconds, priceTime, timeLog, timeSummary } from '../services/time-bank.js';
import { formatCustomerCode } from '../services/wallet.js';

const Password = z.string().min(8, 'Password must be at least 8 characters').max(200);
const Phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid phone number');
/** Leaderboard name: letters, numbers, _ . - and spaces. */
export const Gamertag = z
  .string()
  .trim()
  .min(2, 'Gamertag must be at least 2 characters')
  .max(24)
  .regex(/^[\p{L}\p{N}_.\- ]+$/u, 'Use letters, numbers, spaces, _ . or -');
const Email = z.string().trim().toLowerCase().email('Enter a valid email address').max(120);

const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;

/** Base address for return links: the configured public address, else the one the visitor used. */
export function originOf(req: FastifyRequest, configured: string) {
  if (configured) return configured.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost';
  return `${req.protocol}://${host}`;
}

export async function portalRoutes(app: FastifyInstance, ctx: Ctx) {
  const failures = new Map<string, { count: number; until: number }>();
  const limited = (key: string) => {
    const f = failures.get(key);
    if (f && f.count >= MAX_FAILURES && f.until > Date.now()) throw new AppError(429, 'Too many attempts. Try again in 15 minutes.', 'locked');
  };
  const fail = (key: string) => {
    const f = failures.get(key);
    failures.set(key, { count: (f && f.until > Date.now() ? f.count : 0) + 1, until: Date.now() + LOCK_MS });
  };
  const auth = { preHandler: app.customerAuth() };
  const tokenFor = (c: { id: string; portalTokenVersion: number }) =>
    app.jwt.sign({ sub: c.id, tv: c.portalTokenVersion, typ: 'customer' }, { expiresIn: '30d' });
  const phoneOf = async (raw: string) => normalizePhone(raw.replace(/[^0-9+]/g, ''), (await getSettings(ctx.db)).phonePrefix);

  async function portalOn() {
    const s = await getSettings(ctx.db);
    if (!s.portalEnabled) throw new AppError(403, 'The customer portal is switched off', 'portal_off');
    return s;
  }

  async function emailFree(email: string | null | undefined, exceptId?: string) {
    if (!email) return;
    const [other] = await ctx.db
      .select({ id: customers.id })
      .from(customers)
      .where(and(sql`lower(${customers.email}) = ${email.toLowerCase()}`, sql`${customers.passwordHash} is not null`, exceptId ? ne(customers.id, exceptId) : undefined))
      .limit(1);
    if (other) throw conflict('That email is already used by another account');
  }

  /** Public: what the sign-in page needs (no secrets). */
  app.get('/api/portal/info', async () => {
    const s = await getSettings(ctx.db);
    const ps = await getPaystackConfig(ctx);
    return {
      centerName: s.centerName,
      countryCode: s.countryCode,
      currencyCode: s.currencyCode,
      currencyMinorUnits: s.currencyMinorUnits,
      phonePrefix: s.phonePrefix,
      portalEnabled: s.portalEnabled,
      selfSignup: s.portalSelfSignup,
      bookingsEnabled: s.bookingsEnabled,
      bookingMinNoticeMinutes: s.bookingMinNoticeMinutes,
      bookingMaxDaysAhead: s.bookingMaxDaysAhead,
      openingTime: s.openingTime,
      closingTime: s.closingTime,
      paystackEnabled: ps.enabled && !!ps.secretKey,
      receiptHeader: s.receiptHeader,
      leaderboardPublic: s.leaderboardPublic,
      matchmakingEnabled: s.matchmakingEnabled,
      momoTopupEnabled: s.momoTopupEnabled && s.momoAccounts.length > 0,
      socialLinks: s.socialLinks,
      chatEnabled: s.chatEnabled,
      rewardsEnabled: s.rewardsEnabled,
      selfStart: s.portalSelfStart,
      autoPayOwed: s.autoPayOwed,
    };
  });

  app.post('/api/portal/signup', async (req) => {
    const s = await portalOn();
    if (!s.portalSelfSignup) throw forbidden('New accounts are created at the counter — ask staff for an activation code');
    const body = parse(z.object({ fullName: z.string().trim().min(2).max(80), phone: Phone, email: Email.nullish().or(z.literal('').transform(() => null)), password: Password }), req.body);
    const phone = await phoneOf(body.phone);
    await emailFree(body.email);
    const [existing] = await ctx.db.select().from(customers).where(eq(customers.phone, phone));
    if (existing?.passwordHash) throw conflict('An account with this phone number already exists — sign in instead');
    if (existing) {
      throw conflict('This phone number is already registered at the centre. Ask staff for an activation code, then choose "I have a code".');
    }
    const now = ctx.clock.now();
    const [c] = await ctx.db
      .insert(customers)
      .values({ fullName: body.fullName, phone, email: body.email ?? null, passwordHash: await hashPassword(body.password), portalLastLoginAt: now, createdAt: now, updatedAt: now })
      .returning();
    await audit(ctx.db, { staffId: null, ip: req.ip }, 'portal.signup', { type: 'customer', id: c.id }, { name: c.fullName });
    ctx.bus.emit({ type: 'customers.changed', customerId: c.id });
    return { token: tokenFor(c) };
  });

  app.post('/api/portal/login', async (req) => {
    await portalOn();
    const body = parse(z.object({ login: z.string().trim().min(3).max(120), password: z.string().min(1).max(200) }), req.body);
    const key = `${req.ip}|${body.login.toLowerCase()}`;
    limited(key);
    const isEmail = body.login.includes('@');
    const [c] = await ctx.db
      .select()
      .from(customers)
      .where(isEmail ? and(sql`lower(${customers.email}) = ${body.login.toLowerCase()}`, sql`${customers.passwordHash} is not null`) : eq(customers.phone, await phoneOf(body.login)))
      .limit(1);
    const ok = c?.passwordHash && (await verifyPassword(body.password, c.passwordHash));
    if (!ok) {
      fail(key);
      throw unauthorized('Incorrect phone/email or password');
    }
    if (!c.portalEnabled) throw forbidden('Portal access is switched off for this account — please speak to staff');
    if (c.status !== 'active') throw forbidden('This account is suspended — please speak to staff');
    failures.delete(key);
    await ctx.db.update(customers).set({ portalLastLoginAt: ctx.clock.now() }).where(eq(customers.id, c.id));
    return { token: tokenFor(c) };
  });

  /** Activation (first sign-in for counter-registered customers) and password reset, with a code from staff. */
  app.post('/api/portal/activate', async (req) => {
    await portalOn();
    const body = parse(z.object({ phone: Phone, code: z.string().trim().regex(/^\d{6}$/, 'The code has 6 digits'), password: Password }), req.body);
    const phone = await phoneOf(body.phone);
    const key = `${req.ip}|act|${phone}`;
    limited(key);
    const [c] = await ctx.db.select().from(customers).where(eq(customers.phone, phone));
    const valid =
      c?.activationCodeHash && c.activationExpiresAt && c.activationExpiresAt > ctx.clock.now() && (await verifyPassword(body.code, c.activationCodeHash));
    if (!valid) {
      fail(key);
      throw badRequest('That code is not valid or has expired — ask staff for a new one');
    }
    if (c.status !== 'active') throw forbidden('This account is suspended — please speak to staff');
    const [u] = await ctx.db
      .update(customers)
      .set({
        passwordHash: await hashPassword(body.password),
        activationCodeHash: null,
        activationExpiresAt: null,
        portalEnabled: true,
        portalTokenVersion: c.portalTokenVersion + 1,
        portalLastLoginAt: ctx.clock.now(),
      })
      .where(eq(customers.id, c.id))
      .returning();
    failures.delete(key);
    await audit(ctx.db, { staffId: null, ip: req.ip }, 'portal.activate', { type: 'customer', id: c.id });
    return { token: tokenFor(u) };
  });

  app.get('/api/portal/me', auth, async (req) => {
    const id = req.customer!.id;
    const [r] = await ctx.db
      .select({ c: customers, tierName: membershipTiers.name, tierDiscount: membershipTiers.discountPercent })
      .from(customers)
      .leftJoin(membershipTiers, eq(membershipTiers.id, customers.tierId))
      .where(eq(customers.id, id));
    const c = r.c;
    const now = ctx.clock.now();
    const recent = await ctx.db
      .select({ s: sessions, stationName: stations.name })
      .from(sessions)
      .innerJoin(stations, eq(stations.id, sessions.stationId))
      .where(eq(sessions.customerId, id))
      .orderBy(desc(sessions.startedAt))
      .limit(15);
    const ledger = await ctx.db.select().from(walletTransactions).where(eq(walletTransactions.customerId, id)).orderBy(desc(walletTransactions.createdAt)).limit(30);
    const online = await ctx.db.select().from(onlinePayments).where(eq(onlinePayments.customerId, id)).orderBy(desc(onlinePayments.createdAt)).limit(10);
    return {
      id: c.id,
      code: formatCustomerCode(c.number),
      fullName: c.fullName,
      phone: c.phone,
      email: c.email,
      balance: c.balance,
      points: c.points,
      savedSeconds: c.savedSeconds,
      savedTime: await timeSummary(ctx.db, c),
      activeSession: await mySession(ctx, id),
      timeLog: (await timeLog(ctx.db, id, 20)).map((t) => ({ id: t.id, kind: t.kind, seconds: t.seconds, balanceAfter: t.balanceAfter, planName: t.planName, createdAt: t.createdAt })),
      tierName: r.tierName,
      tierDiscount: r.tierDiscount ?? 0,
      outstanding: await outstandingFor(ctx.db, id),
      memberSince: c.createdAt,
      gamertag: c.gamertag,
      psnId: c.psnId,
      eaId: c.eaId,
      leaderboardHidden: c.leaderboardHidden,
      avatarUrl: avatarUrl(c.id, c.avatarAt),
      sessions: recent.map(({ s, stationName }) => ({
        id: s.id,
        number: s.number,
        stationName,
        status: s.status,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        billedMinutes: s.billedMinutes,
        netAmount: s.netAmount,
        paidAmount: s.paidAmount,
        planName: s.rate.planName,
      })),
      ledger: ledger.map((l) => ({ id: l.id, type: l.type, amount: l.amount, balanceAfter: l.balanceAfter, note: l.note, createdAt: l.createdAt })),
      onlinePayments: online.map((o) => ({ reference: o.reference, amount: o.amount, status: o.status, channel: o.channel, createdAt: o.createdAt, failureReason: o.failureReason })),
      upcomingBookings: (await listBookings(ctx.db, { customerId: id, from: now, status: ['pending', 'confirmed', 'checked_in'] })).slice(0, 5),
    };
  });

  app.patch('/api/portal/me', auth, async (req) => {
    const body = parse(
      z.object({
        fullName: z.string().trim().min(2).max(80).optional(),
        email: Email.nullish().or(z.literal('').transform(() => null)),
        gamertag: Gamertag.nullish().or(z.literal('').transform(() => null)),
        psnId: z.string().trim().max(32).nullish().transform((v) => v || null),
        eaId: z.string().trim().max(32).nullish().transform((v) => v || null),
        leaderboardHidden: z.boolean().optional(),
      }),
      req.body,
    );
    await emailFree(body.email, req.customer!.id);
    await ctx.db.update(customers).set({ ...body, updatedAt: ctx.clock.now() }).where(eq(customers.id, req.customer!.id));
    await audit(ctx.db, { staffId: null, ip: req.ip }, 'portal.profile_update', { type: 'customer', id: req.customer!.id }, body);
    ctx.bus.emit({ type: 'customers.changed', customerId: req.customer!.id });
    return { ok: true };
  });

  /** Profile picture: a small JPEG/PNG/WebP made by the app (it shrinks the photo to 256×256 first). */
  app.put('/api/portal/me/avatar', auth, async (req) => {
    const body = parse(
      z.object({
        image: z
          .string()
          .max(400_000, 'Picture too large — try another one')
          .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, 'Use a JPG, PNG or WebP picture'),
      }),
      req.body,
    );
    const now = ctx.clock.now();
    await ctx.db.update(customers).set({ avatar: body.image, avatarAt: now, updatedAt: now }).where(eq(customers.id, req.customer!.id));
    ctx.bus.emit({ type: 'customers.changed', customerId: req.customer!.id });
    return { avatarUrl: avatarUrl(req.customer!.id, now) };
  });
  app.delete('/api/portal/me/avatar', auth, async (req) => {
    await ctx.db.update(customers).set({ avatar: null, avatarAt: null, updatedAt: ctx.clock.now() }).where(eq(customers.id, req.customer!.id));
    ctx.bus.emit({ type: 'customers.changed', customerId: req.customer!.id });
    return { avatarUrl: null };
  });
  /** Public: pictures are shown next to names in chat, leaderboards and find-a-match. */
  app.get<{ Params: { id: string } }>('/api/avatars/:id', async (req, reply) => {
    const id = parse(z.string().uuid(), req.params.id);
    const [c] = await ctx.db.select({ avatar: customers.avatar, hidden: customers.leaderboardHidden }).from(customers).where(eq(customers.id, id));
    const m = c?.avatar && /^data:(image\/[a-z]+);base64,(.+)$/.exec(c.avatar);
    if (!m) throw notFound('Picture');
    reply.header('content-type', m[1]).header('cache-control', 'public, max-age=604800, immutable').header('x-content-type-options', 'nosniff');
    return reply.send(Buffer.from(m[2], 'base64'));
  });

  app.post('/api/portal/me/password', auth, async (req) => {
    const body = parse(z.object({ currentPassword: z.string().min(1), newPassword: Password }), req.body);
    const [c] = await ctx.db.select().from(customers).where(eq(customers.id, req.customer!.id));
    if (!(await verifyPassword(body.currentPassword, c.passwordHash!))) throw badRequest('Current password is incorrect');
    const [u] = await ctx.db
      .update(customers)
      .set({ passwordHash: await hashPassword(body.newPassword), portalTokenVersion: c.portalTokenVersion + 1 })
      .where(eq(customers.id, c.id))
      .returning();
    await audit(ctx.db, { staffId: null, ip: req.ip }, 'portal.password_changed', { type: 'customer', id: c.id });
    return { token: tokenFor(u) };
  });

  /** Stations and whether they are free right now (no customer details). */
  app.get('/api/portal/stations', auth, async () => {
    const rows = await ctx.db
      .select({ s: stations, categoryName: stationCategories.name })
      .from(stations)
      .leftJoin(stationCategories, eq(stationCategories.id, stations.categoryId))
      .where(ne(stations.status, 'archived'))
      .orderBy(asc(stations.sortOrder), asc(stations.code));
    const open = await ctx.db.select({ stationId: sessions.stationId }).from(sessions).where(ne(sessions.status, 'ended'));
    const busy = new Set(open.map((o) => o.stationId));
    return rows.map(({ s, categoryName }) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      platform: s.platform,
      categoryId: s.categoryId,
      categoryName,
      state: s.status !== 'active' ? 'unavailable' : busy.has(s.id) ? 'in_use' : 'available',
    }));
  });

  app.get('/api/portal/prices', auth, async () => {
    const rows = await ctx.db
      .select({ p: pricingPlans, categoryName: stationCategories.name })
      .from(pricingPlans)
      .leftJoin(stationCategories, eq(stationCategories.id, pricingPlans.categoryId))
      .where(eq(pricingPlans.active, true))
      .orderBy(asc(pricingPlans.sortOrder), asc(pricingPlans.name));
    return rows.map(({ p, categoryName }) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      ratePerHour: p.ratePerHour,
      packageMinutes: p.packageMinutes,
      packagePrice: p.packagePrice,
      categoryName,
    }));
  });

  app.get('/api/portal/availability', auth, async (req) => {
    const q = parse(z.object({ start: z.coerce.date(), minutes: z.coerce.number().int().min(15).max(720) }), req.query);
    return availability(ctx, q.start, q.minutes);
  });

  app.get('/api/portal/bookings', auth, async (req) => {
    const all = await listBookings(ctx.db, { customerId: req.customer!.id, from: new Date(ctx.clock.now().getTime() - 60 * 86_400_000) });
    return all.reverse();
  });

  app.post('/api/portal/bookings', auth, async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    // Customers cannot book for someone else.
    const { customerId: _c, contactName: _n, contactPhone: _p, ...rest } = body;
    return createBooking(ctx, { source: 'portal', customerId: req.customer!.id }, rest);
  });

  /**
   * Price of a booking and how much saved time the customer has for that station (before booking).
   * `planId` = a chosen price or game package; `options` = every price / package for this station with its cost
   * for this booking (a package covers the booking with whole packages; extra time goes on saved time).
   */
  app.get('/api/portal/booking-quote', auth, async (req) => {
    const q = parse(z.object({ stationId: z.string().uuid(), minutes: z.coerce.number().int().min(15).max(720), planId: z.string().uuid().optional() }), req.query);
    const [station] = await ctx.db.select().from(stations).where(eq(stations.id, q.stationId));
    if (!station) throw notFound('Station');
    const [c] = await ctx.db.select().from(customers).where(eq(customers.id, req.customer!.id));
    const all = (await ctx.db.select().from(pricingPlans).where(eq(pricingPlans.active, true)))
      .filter((p) => !p.deletedAt && (!p.categoryId || p.categoryId === station.categoryId))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    const options = [];
    for (const p of all) {
      try {
        const pr = await priceTime(ctx.db, p, c, q.minutes);
        options.push({ id: p.id, name: p.name, kind: p.kind, packageMinutes: p.packageMinutes, price: pr.net, minutes: pr.minutes, ratePerHour: p.kind === 'time_rate' ? p.ratePerHour : null });
      } catch {
        // a price that can't sell this length (e.g. minimum time) is left out
      }
    }
    const chosen = (q.planId && options.find((o) => o.id === q.planId)) || null;
    const def = chosen ? null : await defaultPlanFor(ctx.db, station);
    const pick = chosen ?? options.find((o) => o.id === def?.id) ?? null;
    return {
      planId: pick?.id ?? null,
      planName: pick?.name ?? null,
      price: pick?.price ?? null,
      minutes: pick?.minutes ?? q.minutes,
      balance: c.balance,
      savedSeconds: playableSeconds(c, station.categoryId),
      options,
    };
  });

  /** Pays what the customer owes from their wallet (as far as it goes). */
  app.post('/api/portal/account/pay-from-wallet', auth, async (req) => {
    const id = req.customer!.id;
    const paid = await ctx.db.transaction((tx) => payOwedFromWallet(tx, id, { staffId: null, ip: `app:${id}` }, ctx.clock.now(), { force: true }));
    if (!paid) throw conflict('Nothing to pay — or your wallet is empty');
    ctx.bus.emit({ type: 'customers.changed', customerId: id });
    ctx.bus.emit({ type: 'payments.changed' });
    return { paid, outstanding: await outstandingFor(ctx.db, id) };
  });

  app.post<{ Params: { id: string } }>('/api/portal/bookings/:id/pay', auth, async (req) => payBooking(ctx, req.customer!.id, req.params.id, req.body));

  // ── Play from the app: start (booking or saved time), pause, continue, stop ──
  app.post('/api/portal/play/start', auth, async (req) => selfStart(ctx, req.customer!.id, req.body));
  app.post<{ Params: { id: string } }>('/api/portal/play/:id/pause', auth, async (req) => selfPause(ctx, req.customer!.id, req.params.id));
  app.post<{ Params: { id: string } }>('/api/portal/play/:id/resume', auth, async (req) => selfResume(ctx, req.customer!.id, req.params.id));
  app.post<{ Params: { id: string } }>('/api/portal/play/:id/stop', auth, async (req) => selfStop(ctx, req.customer!.id, req.params.id));
  app.post<{ Params: { id: string } }>('/api/portal/play/:id/reduce', auth, async (req) => selfReduce(ctx, req.customer!.id, req.params.id, req.body));

  /** Change saved time between station types (same money value). */
  app.post('/api/portal/time/convert', auth, async (req) => convertTime(ctx, { staffId: null, ip: `app:${req.customer!.id}` }, req.customer!.id, req.body));

  // ── Phone notifications ──
  app.get('/api/portal/push/key', auth, async () => ({ publicKey: await pushPublicKey(ctx) }));
  app.post('/api/portal/push/subscribe', auth, async (req) => subscribe(ctx, req.customer!.id, req.body, req.headers['user-agent']));
  app.post('/api/portal/push/unsubscribe', auth, async (req) => {
    const b = parse(z.object({ endpoint: z.string().max(1000) }), req.body);
    return unsubscribe(ctx, req.customer!.id, b.endpoint);
  });
  app.post('/api/portal/push/test', auth, async (req) => {
    const sent = await notifyCustomer(ctx, req.customer!.id, { title: '🔔 Notifications are on', body: 'You will get a message here for chats, match challenges, bookings and your time.', url: '/portal', tag: 'test' });
    if (!sent) throw conflict('Could not reach your phone — check the internet, or turn notifications off and on again');
    return { sent };
  });

  app.post<{ Params: { id: string } }>('/api/portal/bookings/:id/cancel', auth, async (req) =>
    changeBooking(ctx, req.params.id, 'cancel', { by: 'customer', customerId: req.customer!.id }),
  );

  // ── Paystack wallet top-up ──
  app.post('/api/portal/topup', auth, async (req) => {
    const body = parse(TopupSchema, req.body);
    const cfg = await getPaystackConfig(ctx);
    const [c] = await ctx.db.select().from(customers).where(eq(customers.id, req.customer!.id));
    if (!c.email) await ctx.db.update(customers).set({ email: body.email }).where(eq(customers.id, c.id));
    return startTopup(ctx, {
      customerId: c.id,
      amount: body.amount,
      email: body.email,
      initiatedBy: null,
      callbackUrl: `${originOf(req, cfg.callbackBaseUrl)}/portal/paid`,
    });
  });

  /** Public by unguessable reference: the "payment received?" page after Paystack sends the customer back. */
  app.get<{ Params: { reference: string } }>('/api/portal/payments/:reference', async (req) => {
    const ref = z.string().regex(/^zg_[a-z0-9_]{6,60}$/).safeParse(req.params.reference);
    if (!ref.success) throw notFound('Payment');
    const o = await verifyOnlinePayment(ctx, ref.data);
    return { reference: o.reference, status: o.status, amount: o.amount, currency: o.currency, channel: o.channel, failureReason: o.failureReason };
  });
}
