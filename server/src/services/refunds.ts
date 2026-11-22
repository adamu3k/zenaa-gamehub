import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, type Actor, type Ctx } from '../context.js';
import type { DbOrTx } from '../db/index.js';
import { payments, sessionEvents, sessions } from '../db/schema.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { audit } from './audit.js';
import { PaymentMethodSchema, postWallet, shiftForMoney } from './wallet.js';

type PaymentRow = typeof payments.$inferSelect;

/** Payment kinds that represent revenue and can therefore be refunded. */
export const REFUNDABLE_KINDS = ['session', 'extension', 'sale'] as const;

export const RefundSchema = z.object({
  /** Minor units. Omit to refund everything still refundable (a void). */
  amount: z.number().int().positive().optional(),
  /**
   * How the money goes back. Wallet-paid money always returns to the wallet.
   * Defaults to the original method.
   */
  method: PaymentMethodSchema.optional(),
  reason: z.string().trim().min(3, 'Give a reason for the refund').max(300),
});

/** Amount of each payment already refunded, keyed by payment id. */
export async function refundedByPayment(db: DbOrTx, ids: string[]) {
  const map = new Map<string, number>();
  if (!ids.length) return map;
  const rows = await db
    .select({ id: payments.refundOfId, total: sql<number>`coalesce(sum(-${payments.amount}),0)::bigint` })
    .from(payments)
    .where(inArray(payments.refundOfId, ids))
    .groupBy(payments.refundOfId);
  for (const r of rows) if (r.id) map.set(r.id, Number(r.total));
  return map;
}

async function refundOne(tx: DbOrTx, actor: Actor, p: PaymentRow, amount: number, method: z.infer<typeof PaymentMethodSchema> | undefined, reason: string, at: Date) {
  const target = p.method === 'wallet' ? 'wallet' : (method ?? p.method);
  if (target === 'wallet' && !p.customerId) throw badRequest('Only registered customers can be refunded to a wallet');
  const [r] = await tx
    .insert(payments)
    .values({
      kind: 'refund',
      method: target,
      amount: -amount,
      sessionId: p.sessionId,
      customerId: p.customerId,
      staffId: actor.staffId,
      shiftId: await shiftForMoney(tx, actor),
      refundOfId: p.id,
      note: reason,
      createdAt: at,
    })
    .returning();
  if (target === 'wallet') {
    await postWallet(tx, { customerId: p.customerId!, type: 'refund', amount, actor, sessionId: p.sessionId, paymentId: r.id, note: reason, at });
  }
  if (p.sessionId) {
    await tx
      .update(sessions)
      .set({ refundedAmount: sql`${sessions.refundedAmount} + ${amount}` })
      .where(eq(sessions.id, p.sessionId));
    await tx.insert(sessionEvents).values({
      sessionId: p.sessionId,
      type: 'refund',
      at,
      amount,
      staffId: actor.staffId,
      meta: { method: target, reason, paymentNumber: p.number },
    });
  }
  return r;
}

/** Refunds part or all of a single payment. */
export async function refundPayment(ctx: Ctx, actor: Actor, paymentId: string, raw: unknown) {
  requirePermission(actor, 'payments.refund', 'refund payments');
  const input = RefundSchema.parse(raw);
  const now = ctx.clock.now();
  const refund = await ctx.db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for('update');
    if (!p) throw notFound('Payment');
    if (!(REFUNDABLE_KINDS as readonly string[]).includes(p.kind) || p.amount <= 0) {
      throw badRequest('Only payments for sessions and sales can be refunded');
    }
    const done = (await refundedByPayment(tx, [p.id])).get(p.id) ?? 0;
    const refundable = p.amount - done;
    if (refundable <= 0) throw conflict('This payment has already been fully refunded');
    const amount = input.amount ?? refundable;
    if (amount > refundable) throw badRequest(`At most ${refundable} can be refunded on this payment`);
    if (p.sessionId) await tx.select({ id: sessions.id }).from(sessions).where(eq(sessions.id, p.sessionId)).for('update');
    const r = await refundOne(tx, actor, p, amount, input.method, input.reason, now);
    await audit(tx, actor, 'payment.refund', { type: 'payment', id: p.id }, { amount, method: r.method, reason: input.reason, number: p.number });
    return r;
  });
  emit(ctx, refund);
  return refund;
}

/**
 * Refunds money taken for a session (e.g. unused prepaid time, or a void), newest payment first.
 * Wallet-paid parts return to the wallet; the rest go back by `method` (default: as paid).
 */
export async function refundSession(ctx: Ctx, actor: Actor, sessionId: string, raw: unknown) {
  requirePermission(actor, 'payments.refund', 'refund payments');
  const input = RefundSchema.parse(raw);
  const now = ctx.clock.now();
  const result = await ctx.db.transaction(async (tx) => {
    const [s] = await tx.select().from(sessions).where(eq(sessions.id, sessionId)).for('update');
    if (!s) throw notFound('Session');
    if (s.status !== 'ended') throw conflict('End the session before refunding it');
    const refundable = s.paidAmount - s.refundedAmount;
    if (refundable <= 0) throw conflict('Nothing left to refund on this session');
    const amount = input.amount ?? refundable;
    if (amount > refundable) throw badRequest(`At most ${refundable} can be refunded on this session`);

    const paid = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.sessionId, s.id), inArray(payments.kind, [...REFUNDABLE_KINDS]), gt(payments.amount, 0)))
      .orderBy(desc(payments.createdAt), desc(payments.number))
      .for('update');
    const done = await refundedByPayment(tx, paid.map((p) => p.id));
    let left = amount;
    const rows = [];
    for (const p of paid) {
      if (left <= 0) break;
      const take = Math.min(left, p.amount - (done.get(p.id) ?? 0));
      if (take <= 0) continue;
      rows.push(await refundOne(tx, actor, p, take, input.method, input.reason, now));
      left -= take;
    }
    if (left > 0) throw conflict('Could not match the refund to the payments on this session');
    await audit(tx, actor, amount === refundable && s.refundedAmount === 0 ? 'session.void' : 'session.refund', { type: 'session', id: s.id }, {
      amount,
      reason: input.reason,
      methods: rows.map((r) => ({ method: r.method, amount: -r.amount })),
    });
    return { sessionId: s.id, stationId: s.stationId, customerId: s.customerId, amount, refunds: rows };
  });
  ctx.bus.emit({ type: 'sessions.changed', sessionId: result.sessionId, stationId: result.stationId });
  ctx.bus.emit({ type: 'payments.changed' });
  if (result.customerId) ctx.bus.emit({ type: 'customers.changed', customerId: result.customerId });
  return result;
}

function emit(ctx: Ctx, r: PaymentRow) {
  ctx.bus.emit({ type: 'payments.changed' });
  if (r.sessionId) ctx.bus.emit({ type: 'sessions.changed', sessionId: r.sessionId });
  if (r.customerId) ctx.bus.emit({ type: 'customers.changed', customerId: r.customerId });
}
