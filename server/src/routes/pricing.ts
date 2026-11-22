import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorOf } from '../auth/plugin.js';
import { validateRate } from '../billing/engine.js';
import type { Ctx } from '../context.js';
import { membershipTiers, pricingPlans } from '../db/schema.js';
import { badRequest, notFound, parse } from '../lib/errors.js';
import { audit } from '../services/audit.js';

const PlanBody = z.object({
  name: z.string().trim().min(1).max(60),
  kind: z.enum(['time_rate', 'package']),
  categoryId: z.string().uuid().nullable().optional(),
  ratePerHour: z.number().int().min(0),
  billingUnitMinutes: z.number().int().min(1).max(1440).default(1),
  minimumMinutes: z.number().int().min(0).default(0),
  graceMinutes: z.number().int().min(0).default(0),
  packageMinutes: z.number().int().positive().nullable().optional(),
  packagePrice: z.number().int().min(0).nullable().optional(),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

const TierBody = z.object({
  name: z.string().trim().min(1).max(40),
  discountPercent: z.number().int().min(0).max(100),
  spendPerPoint: z.number().int().min(0),
});

export async function pricingRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/api/pricing-plans', { preHandler: app.auth('stations.view') }, async () =>
    ctx.db.select().from(pricingPlans).orderBy(asc(pricingPlans.sortOrder), asc(pricingPlans.name)),
  );

  app.post('/api/pricing-plans', { preHandler: app.auth('pricing.manage') }, async (req) => {
    const body = parse(PlanBody, req.body);
    const err = validateRate({ ...body, packageMinutes: body.packageMinutes ?? null, packagePrice: body.packagePrice ?? null });
    if (err) throw badRequest(err);
    const [p] = await ctx.db.insert(pricingPlans).values(body).returning();
    await audit(ctx.db, actorOf(req), 'pricing_plan.create', { type: 'pricing_plan', id: p.id }, body);
    return p;
  });

  app.patch<{ Params: { id: string } }>('/api/pricing-plans/:id', { preHandler: app.auth('pricing.manage') }, async (req) => {
    const body = parse(PlanBody.partial(), req.body);
    const [cur] = await ctx.db.select().from(pricingPlans).where(eq(pricingPlans.id, req.params.id));
    if (!cur) throw notFound('Pricing plan');
    const merged = { ...cur, ...body };
    const err = validateRate(merged);
    if (err) throw badRequest(err);
    // Running sessions keep their rate snapshot — edits only affect new sessions.
    const [p] = await ctx.db.update(pricingPlans).set(body).where(eq(pricingPlans.id, cur.id)).returning();
    await audit(ctx.db, actorOf(req), 'pricing_plan.update', { type: 'pricing_plan', id: p.id }, { before: cur, changes: body });
    return p;
  });

  app.get('/api/membership-tiers', { preHandler: app.auth('customers.view') }, async () =>
    ctx.db.select().from(membershipTiers).orderBy(asc(membershipTiers.discountPercent)),
  );

  app.post('/api/membership-tiers', { preHandler: app.auth('pricing.manage') }, async (req) => {
    const body = parse(TierBody, req.body);
    const [t] = await ctx.db.insert(membershipTiers).values(body).returning();
    await audit(ctx.db, actorOf(req), 'membership_tier.create', { type: 'membership_tier', id: t.id }, body);
    return t;
  });

  app.patch<{ Params: { id: string } }>('/api/membership-tiers/:id', { preHandler: app.auth('pricing.manage') }, async (req) => {
    const body = parse(TierBody.partial(), req.body);
    const [t] = await ctx.db.update(membershipTiers).set(body).where(eq(membershipTiers.id, req.params.id)).returning();
    if (!t) throw notFound('Membership tier');
    await audit(ctx.db, actorOf(req), 'membership_tier.update', { type: 'membership_tier', id: t.id }, body);
    return t;
  });
}
