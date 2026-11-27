import { asc, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorOf } from '../auth/plugin.js';
import type { Ctx } from '../context.js';
import { happyHours, promoCodes, stations } from '../db/schema.js';
import { notFound, parse } from '../lib/errors.js';
import { audit } from '../services/audit.js';
import { createPackage, deletePackage, listPackages, updatePackage } from '../services/promo-packages.js';
import { checkPromoShape, findHappyHour, HappyHourBody, previewPromo, PromoBody } from '../services/promotions.js';

export async function promotionRoutes(app: FastifyInstance, ctx: Ctx) {
  const manage = { preHandler: app.auth('pricing.manage') };

  // ───── Happy hours ─────
  app.get('/api/happy-hours', { preHandler: app.auth('stations.view') }, async () =>
    ctx.db.select().from(happyHours).where(isNull(happyHours.deletedAt)).orderBy(desc(happyHours.active), asc(happyHours.startMinute)),
  );

  /** The happy hour that would apply if a session started on this station right now. */
  app.get('/api/happy-hours/current', { preHandler: app.auth('stations.view') }, async (req) => {
    const q = parse(z.object({ stationId: z.string().uuid() }), req.query);
    const [st] = await ctx.db.select().from(stations).where(eq(stations.id, q.stationId));
    if (!st) throw notFound('Station');
    return { happyHour: await findHappyHour(ctx.db, st.categoryId, ctx.clock.now()) };
  });

  app.post('/api/happy-hours', manage, async (req) => {
    const body = parse(HappyHourBody, req.body);
    const [h] = await ctx.db.insert(happyHours).values(body).returning();
    await audit(ctx.db, actorOf(req), 'happy_hour.create', { type: 'happy_hour', id: h.id }, body);
    return h;
  });

  app.patch<{ Params: { id: string } }>('/api/happy-hours/:id', manage, async (req) => {
    const body = parse(HappyHourBody.partial(), req.body);
    const [h] = await ctx.db.update(happyHours).set(body).where(eq(happyHours.id, req.params.id)).returning();
    if (!h) throw notFound('Happy hour');
    await audit(ctx.db, actorOf(req), 'happy_hour.update', { type: 'happy_hour', id: h.id }, body);
    return h;
  });

  // ───── Promo codes ─────
  app.get('/api/promo-codes', manage, async () => ctx.db.select().from(promoCodes).where(isNull(promoCodes.deletedAt)).orderBy(desc(promoCodes.active), desc(promoCodes.createdAt)));

  /** Checkout preview: is the code valid for this subtotal, and how much does it take off? */
  app.get('/api/promo-codes/check', { preHandler: app.auth('sessions.operate') }, async (req) => {
    const q = parse(z.object({ code: z.string().trim().min(1).max(30), subtotal: z.coerce.number().int().min(0) }), req.query);
    return previewPromo(ctx.db, q.code, q.subtotal, ctx.clock.now());
  });

  app.post('/api/promo-codes', manage, async (req) => {
    const body = parse(PromoBody, req.body);
    checkPromoShape(body);
    const [p] = await ctx.db.insert(promoCodes).values(body).returning();
    await audit(ctx.db, actorOf(req), 'promo_code.create', { type: 'promo_code', id: p.id }, { ...body });
    return p;
  });

  app.patch<{ Params: { id: string } }>('/api/promo-codes/:id', manage, async (req) => {
    const body = parse(PromoBody.partial().omit({ code: true }), req.body);
    const [cur] = await ctx.db.select().from(promoCodes).where(eq(promoCodes.id, req.params.id));
    if (!cur) throw notFound('Promo code');
    checkPromoShape({ ...cur, ...body });
    const [p] = await ctx.db.update(promoCodes).set(body).where(eq(promoCodes.id, cur.id)).returning();
    await audit(ctx.db, actorOf(req), 'promo_code.update', { type: 'promo_code', id: p.id }, { ...body });
    return p;
  });

  // ───── Play packages (spend / play this much → bonus) ─────
  app.get('/api/promo-packages', manage, async () => listPackages(ctx));
  app.post('/api/promo-packages', manage, async (req) => createPackage(ctx, actorOf(req), req.body));
  app.patch<{ Params: { id: string } }>('/api/promo-packages/:id', manage, async (req) => updatePackage(ctx, actorOf(req), req.params.id, req.body));
  app.delete<{ Params: { id: string } }>('/api/promo-packages/:id', manage, async (req) => deletePackage(ctx, actorOf(req), req.params.id));
}
