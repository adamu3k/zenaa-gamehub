import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { applyDiscount, BillingError, computePrepaid, type RateSnapshot } from '../billing/engine.js';
import { requirePermission, type Actor, type Ctx } from '../context.js';
import type { DbOrTx } from '../db/index.js';
import { customers, customerTimeLog, membershipTiers, pricingPlans } from '../db/schema.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { audit } from './audit.js';
import { collectTenders, resolveTenders, TenderInputSchema } from './wallet.js';

export type TimeKind = 'bought' | 'saved' | 'used' | 'adjust';

/**
 * Adds (positive) or removes (negative) saved playing time on a customer's account and logs it.
 * Refuses to go below zero.
 */
export async function postTime(
  tx: DbOrTx,
  input: { customerId: string; seconds: number; kind: TimeKind; actor: Actor; at: Date; sessionId?: string | null; planName?: string | null; amount?: number | null; note?: string | null },
) {
  const [c] = await tx.select().from(customers).where(eq(customers.id, input.customerId)).for('update');
  if (!c) throw notFound('Customer');
  const after = c.savedSeconds + Math.round(input.seconds);
  if (after < 0) throw conflict(`${c.fullName} only has ${Math.floor(c.savedSeconds / 60)} min saved`);
  await tx.update(customers).set({ savedSeconds: after }).where(eq(customers.id, c.id));
  const [row] = await tx
    .insert(customerTimeLog)
    .values({
      customerId: c.id,
      kind: input.kind,
      seconds: Math.round(input.seconds),
      balanceAfter: after,
      sessionId: input.sessionId ?? null,
      planName: input.planName ?? null,
      amount: input.amount ?? null,
      note: input.note ?? null,
      staffId: input.actor.staffId,
      createdAt: input.at,
    })
    .returning();
  return row;
}

export async function timeLog(db: DbOrTx, customerId: string, limit = 50) {
  return db.select().from(customerTimeLog).where(eq(customerTimeLog.customerId, customerId)).orderBy(desc(customerTimeLog.createdAt)).limit(limit);
}

export const AddTimeSchema = TenderInputSchema.extend({
  /** buy = sell a package / minutes and take payment; adjust = add or remove time without payment (corrections, gifts). */
  mode: z.enum(['buy', 'adjust']),
  planId: z.string().uuid().optional(),
  /** buy on an hourly plan: minutes; adjust: signed minutes. */
  minutes: z.number().int().min(-100_000).max(100_000).optional(),
  /** buy on a package plan: how many packages. */
  packages: z.number().int().min(1).max(50).optional(),
  note: z.string().trim().max(300).nullish(),
});

/** Sells time onto a customer's account, or corrects it. Needs customers.time. */
export async function addCustomerTime(ctx: Ctx, actor: Actor, customerId: string, raw: unknown) {
  requirePermission(actor, 'customers.time', "change customers' saved time");
  const input = AddTimeSchema.parse(raw);
  const now = ctx.clock.now();
  const row = await ctx.db.transaction(async (tx) => {
    const [c] = await tx.select().from(customers).where(eq(customers.id, customerId));
    if (!c) throw notFound('Customer');
    if (input.mode === 'adjust') {
      if (!input.minutes) throw badRequest('Enter the minutes to add (or minus to remove)');
      if (!input.note) throw badRequest('Give a reason for the change');
      const r = await postTime(tx, { customerId, seconds: input.minutes * 60, kind: 'adjust', actor, at: now, note: input.note });
      await audit(tx, actor, 'customer.time_adjust', { type: 'customer', id: customerId }, { minutes: input.minutes, note: input.note });
      return r;
    }
    if (c.status !== 'active') throw conflict(`${c.fullName}'s account is suspended`);
    if (!input.planId) throw badRequest('Choose a package or pricing plan');
    const [plan] = await tx.select().from(pricingPlans).where(eq(pricingPlans.id, input.planId));
    if (!plan || !plan.active) throw notFound('Pricing plan');
    const rate: RateSnapshot = {
      planId: plan.id,
      planName: plan.name,
      kind: plan.kind,
      ratePerHour: plan.ratePerHour,
      billingUnitMinutes: plan.billingUnitMinutes,
      minimumMinutes: plan.minimumMinutes,
      graceMinutes: plan.graceMinutes,
      packageMinutes: plan.packageMinutes,
      packagePrice: plan.packagePrice,
    };
    let minutes: number;
    let gross: number;
    try {
      if (plan.kind === 'package') {
        const n = input.packages ?? 1;
        const one = computePrepaid(rate, undefined);
        minutes = one.billedMinutes * n;
        gross = one.amount * n;
      } else {
        if (!input.minutes || input.minutes <= 0) throw badRequest('Enter how many minutes to sell');
        const ch = computePrepaid(rate, input.minutes);
        minutes = ch.billedMinutes;
        gross = ch.amount;
      }
    } catch (e) {
      if (e instanceof BillingError) throw badRequest(e.message);
      throw e;
    }
    let pct = 0;
    if (c.tierId) {
      const [tier] = await tx.select().from(membershipTiers).where(eq(membershipTiers.id, c.tierId));
      pct = tier?.discountPercent ?? 0;
    }
    const { net } = applyDiscount(gross, pct);
    const tenders = resolveTenders(net, input);
    await collectTenders(tx, tenders, { kind: 'session', actor, customerId, note: `Saved time: ${plan.name}`, at: now });
    const r = await postTime(tx, { customerId, seconds: minutes * 60, kind: 'bought', actor, at: now, planName: plan.name, amount: net, note: input.note });
    await audit(tx, actor, 'customer.time_buy', { type: 'customer', id: customerId }, { plan: plan.name, minutes, amount: net, tenders });
    return r;
  });
  ctx.bus.emit({ type: 'customers.changed', customerId });
  if (input.mode === 'buy') ctx.bus.emit({ type: 'payments.changed' });
  return row;
}
