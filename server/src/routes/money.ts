import { and, asc, desc, eq, gt, gte, inArray, isNull, lt } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorOf } from '../auth/plugin.js';
import type { Ctx } from '../context.js';
import { customers, payments, pricingPlans, sessions, shifts, staff, stations } from '../db/schema.js';
import { forbidden, notFound, parse } from '../lib/errors.js';
import { refundedByPayment, refundPayment, refundSession, REFUNDABLE_KINDS } from '../services/refunds.js';
import { describeSession, settleSession } from '../services/sessions.js';
import { getSettings } from '../services/settings.js';
import { cashMovement, closeShift, currentShift, describeShift, openShift, shiftSummary } from '../services/shifts.js';
import { formatCustomerCode } from '../services/wallet.js';
import { pinGate } from '../services/pins.js';

const closedBy = alias(staff, 'closed_by_staff');

/** Payments with staff/customer names and, for refundable kinds, how much is still refundable. */
async function paymentRows(ctx: Ctx, where: ReturnType<typeof and>, limit = 500) {
  const rows = await ctx.db
    .select({ p: payments, staffName: staff.fullName, customerName: customers.fullName, customerNumber: customers.number })
    .from(payments)
    .leftJoin(staff, eq(staff.id, payments.staffId))
    .leftJoin(customers, eq(customers.id, payments.customerId))
    .where(where)
    .orderBy(desc(payments.createdAt), desc(payments.number))
    .limit(limit);
  const refunded = await refundedByPayment(
    ctx.db,
    rows.filter((r) => (REFUNDABLE_KINDS as readonly string[]).includes(r.p.kind)).map((r) => r.p.id),
  );
  return rows.map((r) => {
    const refundable = (REFUNDABLE_KINDS as readonly string[]).includes(r.p.kind) && r.p.amount > 0 ? r.p.amount - (refunded.get(r.p.id) ?? 0) : 0;
    return {
      ...r.p,
      staffName: r.staffName ?? 'System',
      customerName: r.customerName,
      customerCode: r.customerNumber != null ? formatCustomerCode(r.customerNumber) : null,
      refundable,
    };
  });
}

export async function moneyRoutes(app: FastifyInstance, ctx: Ctx) {
  // ───── Shifts ─────
  app.get('/api/shifts/current', { preHandler: app.auth() }, async (req) => ({ shift: await currentShift(ctx.db, req.staff!.id) }));
  /** What the last closed shift left in the drawer, to suggest the next opening float. */
  app.get('/api/shifts/last-count', { preHandler: app.auth() }, async () => {
    const [l] = await ctx.db
      .select({ countedCash: shifts.countedCash, closedAt: shifts.closedAt, staffName: staff.fullName })
      .from(shifts)
      .leftJoin(staff, eq(staff.id, shifts.staffId))
      .where(gt(shifts.closedAt, new Date(0)))
      .orderBy(desc(shifts.closedAt))
      .limit(1);
    return { last: l ?? null };
  });
  app.post('/api/shifts/open', { preHandler: app.auth() }, async (req) => openShift(ctx, actorOf(req), req.body));
  app.post<{ Params: { id: string } }>('/api/shifts/:id/close', { preHandler: app.auth() }, async (req) =>
    closeShift(ctx, await pinGate(ctx, req, 'shift_close', null), req.params.id, req.body),
  );
  app.post('/api/shifts/cash-movement', { preHandler: app.auth() }, async (req) =>
    cashMovement(ctx, await pinGate(ctx, req, 'cash_movement', 'shifts.manage'), req.body),
  );

  app.get('/api/shifts', { preHandler: app.auth('shifts.manage') }, async (req) => {
    const q = parse(
      z.object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        staffId: z.string().uuid().optional(),
        open: z.enum(['true', 'false']).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      }),
      req.query,
    );
    const rows = await ctx.db
      .select({ s: shifts, staffName: staff.fullName, closedByName: closedBy.fullName })
      .from(shifts)
      .innerJoin(staff, eq(staff.id, shifts.staffId))
      .leftJoin(closedBy, eq(closedBy.id, shifts.closedBy))
      .where(
        and(
          q.from ? gte(shifts.openedAt, q.from) : undefined,
          q.to ? lt(shifts.openedAt, q.to) : undefined,
          q.staffId ? eq(shifts.staffId, q.staffId) : undefined,
          q.open === 'true' ? isNull(shifts.closedAt) : undefined,
        ),
      )
      .orderBy(desc(shifts.openedAt))
      .limit(q.limit);
    return Promise.all(
      rows.map(async (r) => ({
        ...describeShift(r.s, r.s.closedAt ? undefined : await shiftSummary(ctx.db, r.s)),
        staffName: r.staffName,
        closedByName: r.closedByName,
      })),
    );
  });

  app.get<{ Params: { id: string } }>('/api/shifts/:id', { preHandler: app.auth() }, async (req) => {
    const [r] = await ctx.db
      .select({ s: shifts, staffName: staff.fullName, closedByName: closedBy.fullName })
      .from(shifts)
      .innerJoin(staff, eq(staff.id, shifts.staffId))
      .leftJoin(closedBy, eq(closedBy.id, shifts.closedBy))
      .where(eq(shifts.id, req.params.id));
    if (!r) throw notFound('Shift');
    if (r.s.staffId !== req.staff!.id && !req.staff!.permissions.includes('shifts.manage')) throw forbidden();
    return {
      ...describeShift(r.s, r.s.closedAt ? undefined : await shiftSummary(ctx.db, r.s)),
      staffName: r.staffName,
      closedByName: r.closedByName,
      payments: await paymentRows(ctx, and(eq(payments.shiftId, r.s.id))),
    };
  });

  // ───── Payments & refunds ─────
  app.get('/api/payments', { preHandler: app.auth('reports.view') }, async (req) => {
    const q = parse(
      z.object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        kind: z.string().optional(),
        method: z.enum(['cash', 'card', 'bank_transfer', 'mobile_money', 'wallet']).optional(),
        staffId: z.string().uuid().optional(),
        customerId: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(1000).default(200),
      }),
      req.query,
    );
    const kinds = q.kind?.split(',').filter(Boolean) as (typeof payments.$inferSelect)['kind'][] | undefined;
    return paymentRows(
      ctx,
      and(
        q.from ? gte(payments.createdAt, q.from) : undefined,
        q.to ? lt(payments.createdAt, q.to) : undefined,
        kinds?.length ? inArray(payments.kind, kinds) : undefined,
        q.method ? eq(payments.method, q.method) : undefined,
        q.staffId ? eq(payments.staffId, q.staffId) : undefined,
        q.customerId ? eq(payments.customerId, q.customerId) : undefined,
      ),
      q.limit,
    );
  });

  app.post<{ Params: { id: string } }>('/api/payments/:id/refund', { preHandler: app.auth() }, async (req) =>
    refundPayment(ctx, await pinGate(ctx, req, 'refund', 'payments.refund'), req.params.id, req.body),
  );
  app.post<{ Params: { id: string } }>('/api/sessions/:id/refund', { preHandler: app.auth() }, async (req) =>
    refundSession(ctx, await pinGate(ctx, req, 'refund', 'payments.refund'), req.params.id, req.body),
  );
  app.post<{ Params: { id: string } }>('/api/sessions/:id/settle', { preHandler: app.auth('sessions.operate') }, async (req) =>
    settleSession(ctx, actorOf(req), req.params.id, req.body),
  );

  // ───── Tabs (pay later) ─────
  app.get('/api/tabs', { preHandler: app.auth('customers.view') }, async () => {
    const rows = await ctx.db
      .select({ s: sessions, stationName: stations.name, customerName: customers.fullName, customerNumber: customers.number, creditLimit: customers.creditLimit, phone: customers.phone })
      .from(sessions)
      .innerJoin(stations, eq(stations.id, sessions.stationId))
      .leftJoin(customers, eq(customers.id, sessions.customerId))
      .where(and(eq(sessions.status, 'ended'), gt(sessions.netAmount, sessions.paidAmount)))
      .orderBy(asc(sessions.endedAt));
    const now = ctx.clock.now();
    const byCustomer = new Map<string, { customerId: string | null; customerName: string; customerCode: string | null; phone: string | null; creditLimit: number; owed: number; sessions: unknown[] }>();
    for (const r of rows) {
      const key = r.s.customerId ?? 'walk-in';
      let g = byCustomer.get(key);
      if (!g) {
        g = {
          customerId: r.s.customerId,
          customerName: r.customerName ?? 'Walk-in',
          customerCode: r.customerNumber != null ? formatCustomerCode(r.customerNumber) : null,
          phone: r.phone,
          creditLimit: r.creditLimit ?? 0,
          owed: 0,
          sessions: [],
        };
        byCustomer.set(key, g);
      }
      g.owed += r.s.netAmount - r.s.paidAmount;
      g.sessions.push({ ...describeSession(r.s, now), stationName: r.stationName });
    }
    const list = [...byCustomer.values()].sort((a, b) => b.owed - a.owed);
    return { total: list.reduce((a, g) => a + g.owed, 0), customers: list };
  });

  // ───── Receipts ─────
  app.get<{ Params: { id: string } }>('/api/receipts/session/:id', { preHandler: app.auth('stations.view') }, async (req) => {
    const [r] = await ctx.db
      .select({ s: sessions, stationName: stations.name, stationCode: stations.code, planName: pricingPlans.name, customerName: customers.fullName, customerNumber: customers.number, balance: customers.balance, points: customers.points })
      .from(sessions)
      .innerJoin(stations, eq(stations.id, sessions.stationId))
      .innerJoin(pricingPlans, eq(pricingPlans.id, sessions.planId))
      .leftJoin(customers, eq(customers.id, sessions.customerId))
      .where(eq(sessions.id, req.params.id));
    if (!r) throw notFound('Session');
    const [cashier] = await ctx.db.select({ name: staff.fullName }).from(staff).where(eq(staff.id, r.s.endedBy ?? r.s.startedBy ?? req.staff!.id));
    return {
      settings: await getSettings(ctx.db),
      printedAt: ctx.clock.now(),
      cashierName: cashier?.name ?? 'System',
      session: { ...describeSession(r.s, ctx.clock.now()), stationName: r.stationName, stationCode: r.stationCode, planName: r.planName },
      customer: r.s.customerId
        ? { name: r.customerName, code: formatCustomerCode(r.customerNumber!), walletBalance: r.balance, points: r.points }
        : null,
      payments: await paymentRows(ctx, and(eq(payments.sessionId, r.s.id))),
    };
  });

  app.get<{ Params: { id: string } }>('/api/receipts/payment/:id', { preHandler: app.auth('customers.view') }, async (req) => {
    const [p] = await paymentRows(ctx, and(eq(payments.id, req.params.id)), 1);
    if (!p) throw notFound('Payment');
    const [c] = p.customerId ? await ctx.db.select().from(customers).where(eq(customers.id, p.customerId)) : [];
    return {
      settings: await getSettings(ctx.db),
      printedAt: ctx.clock.now(),
      payment: p,
      customer: c ? { name: c.fullName, code: formatCustomerCode(c.number), walletBalance: c.balance, points: c.points } : null,
    };
  });
}
