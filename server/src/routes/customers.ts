import { asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorOf } from '../auth/plugin.js';
import type { Ctx } from '../context.js';
import { customers, membershipTiers, sessions, stations, walletTransactions } from '../db/schema.js';
import { randomInt } from 'node:crypto';
import { badRequest, forbidden, notFound, parse } from '../lib/errors.js';
import { hashPassword } from '../lib/password.js';
import { pinGate } from '../services/pins.js';
import { audit } from '../services/audit.js';
import { normalizePhone } from '../lib/countries.js';
import { outstandingFor } from '../services/sessions.js';
import { getSettings } from '../services/settings.js';
import { queueCustomerSms } from '../services/sms.js';
import { formatCustomerCode, walletOperation } from '../services/wallet.js';
import { avatarUrl } from '../competitions/common.js';
import { Gamertag } from './portal.js';
import { addCustomerTime, timeLog } from '../services/time-bank.js';

const CustomerBody = z.object({
  fullName: z.string().trim().min(1).max(80),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid phone number')
    .nullish()
    .transform((v) => (v ? v.replace(/[^0-9+]/g, '') : null)),
  email: z.string().trim().email().nullish().or(z.literal('').transform(() => null)),
  tierId: z.string().uuid().nullish(),
  notes: z.string().max(1000).nullish(),
  gamertag: Gamertag.nullish().or(z.literal('').transform(() => null)),
  psnId: z.string().trim().max(32).nullish().transform((v) => v || null),
  leaderboardHidden: z.boolean().optional(),
});

/** Adds the ZG- code and strips portal secrets before a customer row leaves the server. */
const withCode = <T extends { id: string; number: number; passwordHash?: string | null; activationCodeHash?: string | null; avatar?: string | null; avatarAt?: Date | null }>(c: T) => {
  const { passwordHash, activationCodeHash, avatar, ...rest } = c;
  return {
    ...rest,
    code: formatCustomerCode(c.number),
    hasPortalAccount: !!passwordHash,
    hasActivationCode: !!activationCodeHash,
    avatarUrl: avatarUrl(c.id, c.avatarAt),
  };
};

export async function customerRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/api/customers', { preHandler: app.auth('customers.view') }, async (req) => {
    const q = parse(z.object({ q: z.string().trim().max(80).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query);
    let where;
    if (q.q) {
      const like = `%${q.q.replace(/[%_]/g, '')}%`;
      const num = Number(q.q.replace(/^zg-?/i, ''));
      // "024 123…" should also find "+23324123…"
      const digits = q.q.replace(/[^0-9+]/g, '');
      const intl = digits.length >= 4 ? normalizePhone(digits, (await getSettings(ctx.db)).phonePrefix) : null;
      where = or(
        ilike(customers.fullName, like),
        ilike(customers.phone, like),
        intl ? ilike(customers.phone, `${intl}%`) : undefined,
        ilike(customers.email, like),
        Number.isInteger(num) && num > 0 ? eq(customers.number, num) : undefined,
      );
    }
    const rows = await ctx.db
      .select({ c: customers, tierName: membershipTiers.name, tierDiscount: membershipTiers.discountPercent })
      .from(customers)
      .leftJoin(membershipTiers, eq(membershipTiers.id, customers.tierId))
      .where(where)
      .orderBy(q.q ? asc(customers.fullName) : desc(customers.createdAt))
      .limit(q.limit);
    return rows.map((r) => ({ ...withCode(r.c), tierName: r.tierName, tierDiscount: r.tierDiscount ?? 0 }));
  });

  app.post('/api/customers', { preHandler: app.auth('customers.manage') }, async (req) => {
    const body = parse(CustomerBody, req.body);
    if (body.phone) body.phone = normalizePhone(body.phone, (await getSettings(ctx.db)).phonePrefix);
    const [c] = await ctx.db.insert(customers).values(body).returning();
    await audit(ctx.db, actorOf(req), 'customer.create', { type: 'customer', id: c.id }, { name: c.fullName });
    ctx.bus.emit({ type: 'customers.changed', customerId: c.id });
    return withCode(c);
  });

  app.get<{ Params: { id: string } }>('/api/customers/:id', { preHandler: app.auth('customers.view') }, async (req) => {
    const [r] = await ctx.db
      .select({ c: customers, tierName: membershipTiers.name, tierDiscount: membershipTiers.discountPercent })
      .from(customers)
      .leftJoin(membershipTiers, eq(membershipTiers.id, customers.tierId))
      .where(eq(customers.id, req.params.id));
    if (!r) throw notFound('Customer');
    const [stats] = await ctx.db
      .select({
        sessions: sql<number>`count(*)::int`,
        spent: sql<number>`coalesce(sum(${sessions.paidAmount}),0)::bigint`,
        seconds: sql<number>`coalesce(sum(${sessions.accumulatedSeconds}),0)::bigint`,
      })
      .from(sessions)
      .where(eq(sessions.customerId, r.c.id));
    const ledger = await ctx.db
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.customerId, r.c.id))
      .orderBy(desc(walletTransactions.createdAt))
      .limit(50);
    const history = await ctx.db
      .select({ s: sessions, stationName: stations.name })
      .from(sessions)
      .innerJoin(stations, eq(stations.id, sessions.stationId))
      .where(eq(sessions.customerId, r.c.id))
      .orderBy(desc(sessions.startedAt))
      .limit(50);
    return {
      ...withCode(r.c),
      tierName: r.tierName,
      tierDiscount: r.tierDiscount,
      outstanding: await outstandingFor(ctx.db, r.c.id),
      stats: { sessions: Number(stats.sessions), spent: Number(stats.spent), seconds: Number(stats.seconds) },
      ledger,
      timeLog: await timeLog(ctx.db, r.c.id),
      sessions: history.map((h) => ({ ...h.s, stationName: h.stationName })),
    };
  });

  app.patch<{ Params: { id: string } }>('/api/customers/:id', { preHandler: app.auth('customers.manage') }, async (req) => {
    const body = parse(
      CustomerBody.partial().extend({
        status: z.enum(['active', 'suspended']).optional(),
        creditLimit: z.number().int().min(0).optional(),
        portalEnabled: z.boolean().optional(),
      }),
      req.body,
    );
    if (body.creditLimit !== undefined && !req.staff!.permissions.includes('payments.tab')) {
      throw forbidden('You do not have permission to set credit limits');
    }
    if (body.phone) body.phone = normalizePhone(body.phone, (await getSettings(ctx.db)).phonePrefix);
    const extra = body.portalEnabled === false || body.status === 'suspended' ? { portalTokenVersion: sql`${customers.portalTokenVersion} + 1` } : {};
    const [c] = await ctx.db
      .update(customers)
      .set({ ...body, ...extra, updatedAt: ctx.clock.now() })
      .where(eq(customers.id, req.params.id))
      .returning();
    if (!c) throw notFound('Customer');
    await audit(ctx.db, actorOf(req), body.status ? `customer.${body.status === 'suspended' ? 'suspend' : 'reactivate'}` : 'customer.update', { type: 'customer', id: c.id }, body);
    ctx.bus.emit({ type: 'customers.changed', customerId: c.id });
    return withCode(c);
  });

  /** One-time 6-digit code the customer uses to activate (or reset) their portal account. Valid 48 hours. */
  app.post<{ Params: { id: string } }>('/api/customers/:id/portal-code', { preHandler: app.auth('customers.manage') }, async (req) => {
    const [c] = await ctx.db.select().from(customers).where(eq(customers.id, req.params.id));
    if (!c) throw notFound('Customer');
    if (!c.phone) throw badRequest('Add a phone number first — the customer signs in with it');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(ctx.clock.now().getTime() + 48 * 3600_000);
    await ctx.db.update(customers).set({ activationCodeHash: await hashPassword(code), activationExpiresAt: expiresAt }).where(eq(customers.id, c.id));
    await audit(ctx.db, actorOf(req), 'customer.portal_code', { type: 'customer', id: c.id });
    return { code, expiresAt, phone: c.phone };
  });

  /** Sell time onto the customer's account, or correct it (customers.time). */
  app.post<{ Params: { id: string } }>('/api/customers/:id/time', { preHandler: app.auth('customers.view') }, async (req) =>
    addCustomerTime(ctx, actorOf(req), req.params.id, req.body),
  );

  app.post<{ Params: { id: string } }>('/api/customers/:id/wallet', { preHandler: app.auth('customers.view') }, async (req) => {
    const body = parse(
      z.object({
        operation: z.enum(['deposit', 'withdrawal', 'adjustment']),
        amount: z.number().int().refine((n) => n !== 0, 'Amount cannot be zero'),
        method: z.enum(['cash', 'card', 'bank_transfer', 'mobile_money']).optional(),
        reference: z.string().trim().max(100).nullish(),
        note: z.string().max(300).nullish(),
      }),
      req.body,
    );
    const perm = body.operation === 'deposit' ? 'wallet.deposit' : body.operation === 'withdrawal' ? 'wallet.withdraw' : 'wallet.adjust';
    const actor =
      body.operation === 'deposit'
        ? (() => {
            if (!req.staff!.permissions.includes(perm)) throw forbidden();
            return actorOf(req);
          })()
        : await pinGate(ctx, req, body.operation === 'withdrawal' ? 'wallet_withdraw' : 'wallet_adjust', perm);
    const tx = await ctx.db.transaction(async (tx) => {
      const row = await walletOperation(tx, { ...body, customerId: req.params.id, actor, at: ctx.clock.now() });
      await audit(tx, actor, `wallet.${body.operation}`, { type: 'customer', id: req.params.id }, { amount: body.amount, method: body.method, note: body.note });
      if (body.operation === 'deposit') await queueCustomerSms(tx, req.params.id, 'topup', { amount: body.amount }, ctx.clock.now());
      return row;
    });
    ctx.bus.emit({ type: 'customers.changed', customerId: req.params.id });
    ctx.bus.emit({ type: 'payments.changed' });
    return tx;
  });
}
