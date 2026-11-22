import { and, asc, desc, eq, gte, lt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorOf } from '../auth/plugin.js';
import type { Ctx } from '../context.js';
import { customers, payments, sessionEvents, sessions, staff, stations } from '../db/schema.js';
import { notFound, parse } from '../lib/errors.js';
import { describeSession, endSession, extendSession, pauseSession, resumeSession, startSession } from '../services/sessions.js';
import { formatCustomerCode } from '../services/wallet.js';
import { pinGate } from '../services/pins.js';

export async function sessionRoutes(app: FastifyInstance, ctx: Ctx) {
  const op = { preHandler: app.auth('sessions.operate') };

  app.post('/api/sessions', op, async (req) => startSession(ctx, actorOf(req), req.body));
  app.post<{ Params: { id: string } }>('/api/sessions/:id/pause', op, async (req) => pauseSession(ctx, actorOf(req), req.params.id, req.body));
  app.post<{ Params: { id: string } }>('/api/sessions/:id/resume', op, async (req) => resumeSession(ctx, actorOf(req), req.params.id));
  app.post<{ Params: { id: string } }>('/api/sessions/:id/extend', op, async (req) => extendSession(ctx, actorOf(req), req.params.id, req.body));
  app.post<{ Params: { id: string } }>('/api/sessions/:id/end', op, async (req) => {
    const manual = Number((req.body as { manualDiscount?: unknown } | undefined)?.manualDiscount ?? 0);
    const actor = manual > 0 ? await pinGate(ctx, req, 'discount', 'payments.discount') : actorOf(req);
    return endSession(ctx, actor, req.params.id, req.body);
  });

  /** Live quote / detail including the event timeline. */
  app.get<{ Params: { id: string } }>('/api/sessions/:id', { preHandler: app.auth('stations.view') }, async (req) => {
    const [s] = await ctx.db.select().from(sessions).where(eq(sessions.id, req.params.id));
    if (!s) throw notFound('Session');
    const events = await ctx.db
      .select({ e: sessionEvents, staffName: staff.fullName })
      .from(sessionEvents)
      .leftJoin(staff, eq(staff.id, sessionEvents.staffId))
      .where(eq(sessionEvents.sessionId, s.id))
      .orderBy(asc(sessionEvents.at));
    const pays = await ctx.db
      .select({ p: payments, staffName: staff.fullName })
      .from(payments)
      .leftJoin(staff, eq(staff.id, payments.staffId))
      .where(eq(payments.sessionId, s.id))
      .orderBy(asc(payments.createdAt), asc(payments.number));
    return {
      ...describeSession(s, ctx.clock.now()),
      events: events.map((x) => ({ ...x.e, staffName: x.staffName })),
      payments: pays.map((x) => ({ ...x.p, staffName: x.staffName ?? 'System' })),
    };
  });

  app.get('/api/sessions', { preHandler: app.auth('stations.view') }, async (req) => {
    const q = parse(
      z.object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        stationId: z.string().uuid().optional(),
        customerId: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      }),
      req.query,
    );
    const where = and(
      q.from ? gte(sessions.startedAt, q.from) : undefined,
      q.to ? lt(sessions.startedAt, q.to) : undefined,
      q.stationId ? eq(sessions.stationId, q.stationId) : undefined,
      q.customerId ? eq(sessions.customerId, q.customerId) : undefined,
    );
    const rows = await ctx.db
      .select({ s: sessions, stationName: stations.name, stationCode: stations.code, customerName: customers.fullName, customerNumber: customers.number })
      .from(sessions)
      .innerJoin(stations, eq(stations.id, sessions.stationId))
      .leftJoin(customers, eq(customers.id, sessions.customerId))
      .where(where)
      .orderBy(desc(sessions.startedAt))
      .limit(q.limit);
    const now = ctx.clock.now();
    return rows.map((r) => ({
      ...describeSession(r.s, now),
      stationName: r.stationName,
      stationCode: r.stationCode,
      customerName: r.customerName,
      customerCode: r.customerNumber != null ? formatCustomerCode(r.customerNumber) : null,
    }));
  });
}
