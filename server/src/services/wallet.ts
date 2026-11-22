import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { Actor } from '../context.js';
import type { DbOrTx } from '../db/index.js';
import { customers, payments, sessions, shifts, stations, walletTransactions } from '../db/schema.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { getSettings } from './settings.js';
import { queueCustomerSms } from './sms.js';

export type PaymentMethod = (typeof payments.$inferInsert)['method'];
export type PaymentKind = (typeof payments.$inferInsert)['kind'];
export type WalletTxType = (typeof walletTransactions.$inferInsert)['type'];

export const formatCustomerCode = (n: number) => `ZG-${String(n).padStart(6, '0')}`;

/**
 * Applies a signed change to a customer's wallet with a row lock and an append-only ledger entry.
 * Refuses to take the balance below zero.
 */
export async function postWallet(
  tx: DbOrTx,
  input: {
    customerId: string;
    type: WalletTxType;
    amount: number;
    actor: Actor;
    sessionId?: string | null;
    paymentId?: string | null;
    note?: string | null;
    at: Date;
  },
) {
  if (!Number.isSafeInteger(input.amount) || input.amount === 0) throw badRequest('Amount must be a non-zero whole number');
  const [c] = await tx.select().from(customers).where(eq(customers.id, input.customerId)).for('update');
  if (!c) throw notFound('Customer');
  if (c.status === 'suspended' && input.amount < 0 && input.type === 'charge') throw conflict('Customer account is suspended');
  const balanceAfter = c.balance + input.amount;
  if (balanceAfter < 0) throw conflict(`Insufficient wallet balance (available ${c.balance})`);
  await tx.update(customers).set({ balance: balanceAfter, updatedAt: input.at }).where(eq(customers.id, c.id));
  const [row] = await tx
    .insert(walletTransactions)
    .values({
      customerId: c.id,
      type: input.type,
      amount: input.amount,
      balanceAfter,
      sessionId: input.sessionId ?? null,
      paymentId: input.paymentId ?? null,
      staffId: input.actor.staffId,
      note: input.note ?? null,
      createdAt: input.at,
    })
    .returning();
  return row;
}

export async function openShiftId(tx: DbOrTx, staffId: string | null) {
  if (!staffId) return null;
  const [s] = await tx
    .select({ id: shifts.id })
    .from(shifts)
    .where(and(eq(shifts.staffId, staffId), isNull(shifts.closedAt)))
    .orderBy(desc(shifts.openedAt))
    .limit(1);
  return s?.id ?? null;
}

/**
 * The actor's open shift, which every money movement is attached to.
 * When the "require open shift" setting is on, staff without an open shift are refused.
 */
export async function shiftForMoney(tx: DbOrTx, actor: Actor) {
  const id = await openShiftId(tx, actor.staffId);
  if (!id && actor.staffId) {
    const s = await getSettings(tx);
    if (s.requireOpenShift) throw conflict('Open your shift (cash drawer) before taking or paying out money');
  }
  return id;
}

// ───────────── Tenders (split payments) ─────────────

export const PaymentMethodSchema = z.enum(['cash', 'card', 'bank_transfer', 'mobile_money', 'wallet']);
const ReferenceSchema = z.string().trim().max(100).optional();
export const TenderSchema = z.object({ method: PaymentMethodSchema, amount: z.number().int().positive(), reference: ReferenceSchema });
export type Tender = z.infer<typeof TenderSchema>;

/** Accepted by every endpoint that takes money: one method for the whole amount, or a split. */
export const TenderInputSchema = z.object({
  paymentMethod: PaymentMethodSchema.optional(),
  /** Reference for the single-method form, e.g. "MTN MoMo · 4429183301". */
  paymentReference: ReferenceSchema,
  payments: z.array(TenderSchema).min(1).max(6).optional(),
});
export type TenderInput = z.infer<typeof TenderInputSchema>;

/**
 * Turns the input into concrete tenders for `due`.
 * A split must add up exactly to `due` (or at most `due` when `allowPartial`).
 */
export function resolveTenders(due: number, input: TenderInput, opts: { allowPartial?: boolean } = {}): Tender[] {
  if (due <= 0) {
    if (input.payments?.length) throw badRequest('Nothing is owed');
    return [];
  }
  if (input.payments?.length) {
    const sum = input.payments.reduce((a, t) => a + t.amount, 0);
    if (sum > due) throw badRequest(`Payments add up to ${sum} but only ${due} is owed`);
    if (sum < due && !opts.allowPartial) throw badRequest(`Payments add up to ${sum} but ${due} is owed`);
    return input.payments;
  }
  if (!input.paymentMethod) throw badRequest('Choose how the customer is paying');
  return [{ method: input.paymentMethod, amount: due, reference: input.paymentReference }];
}

/** With "require MoMo reference" on, refuses mobile-money payments that have no transaction ID. */
async function checkReference(tx: DbOrTx, method: PaymentMethod, reference: string | null | undefined) {
  if (method !== 'mobile_money') return;
  const s = await getSettings(tx);
  // A bare network name ("MTN MoMo") is not enough — there must be a transaction ID with digits/letters after it.
  const id = reference?.split('·').pop()?.trim() ?? '';
  if (s.requireMomoReference && (!reference || id.length < 4 || s.mobileMoneyProviders.includes(id))) {
    throw badRequest('Enter the mobile money transaction ID');
  }
}

export async function collectTenders(
  tx: DbOrTx,
  tenders: Tender[],
  common: { kind: PaymentKind; actor: Actor; customerId?: string | null; sessionId?: string | null; note?: string | null; at: Date },
) {
  const rows = [];
  for (const t of tenders) {
    const p = await collectPayment(tx, { ...common, amount: t.amount, method: t.method, reference: t.reference });
    if (p) rows.push(p);
  }
  const total = rows.reduce((a, p) => a + p.amount, 0);
  if (common.customerId && total > 0 && (common.kind === 'session' || common.kind === 'extension')) {
    let station: string | null = null;
    if (common.sessionId) {
      const [st] = await tx.select({ name: stations.name }).from(sessions).innerJoin(stations, eq(stations.id, sessions.stationId)).where(eq(sessions.id, common.sessionId));
      station = st?.name ?? null;
    }
    await queueCustomerSms(tx, common.customerId, 'game', { amount: total, station }, common.at);
  }
  return rows;
}

/**
 * Records money received for a session/extension/sale. When paid by wallet, debits the wallet too.
 * Returns null when amount is 0 (nothing to collect).
 */
export async function collectPayment(
  tx: DbOrTx,
  input: {
    amount: number;
    method: PaymentMethod;
    kind: PaymentKind;
    actor: Actor;
    customerId?: string | null;
    sessionId?: string | null;
    note?: string | null;
    reference?: string | null;
    at: Date;
  },
) {
  if (input.amount < 0) throw badRequest('Payment amount cannot be negative');
  if (input.amount === 0) return null;
  if (input.method === 'wallet' && !input.customerId) throw badRequest('Wallet payment requires a registered customer');
  await checkReference(tx, input.method, input.reference);
  const [p] = await tx
    .insert(payments)
    .values({
      kind: input.kind,
      method: input.method,
      amount: input.amount,
      reference: input.reference || null,
      sessionId: input.sessionId ?? null,
      customerId: input.customerId ?? null,
      staffId: input.actor.staffId,
      shiftId: await shiftForMoney(tx, input.actor),
      note: input.note ?? null,
      createdAt: input.at,
    })
    .returning();
  if (input.method === 'wallet') {
    await postWallet(tx, {
      customerId: input.customerId!,
      type: 'charge',
      amount: -input.amount,
      actor: input.actor,
      sessionId: input.sessionId,
      paymentId: p.id,
      note: input.note,
      at: input.at,
    });
  }
  return p;
}

/** Cash-desk wallet operations: deposit (money in), withdrawal (money out), adjustment (no cash moves). */
export async function walletOperation(
  tx: DbOrTx,
  input: {
    customerId: string;
    operation: 'deposit' | 'withdrawal' | 'adjustment';
    amount: number;
    method?: Exclude<PaymentMethod, 'wallet'>;
    note?: string | null;
    reference?: string | null;
    actor: Actor;
    at: Date;
  },
) {
  if (input.operation === 'adjustment') {
    if (!input.note) throw badRequest('A reason is required for adjustments');
    return postWallet(tx, { ...input, type: 'adjustment', amount: input.amount });
  }
  if (input.amount <= 0) throw badRequest('Amount must be greater than zero');
  const method = input.method ?? 'cash';
  const signed = input.operation === 'deposit' ? input.amount : -input.amount;
  if (input.operation === 'deposit') await checkReference(tx, method, input.reference);
  const [p] = await tx
    .insert(payments)
    .values({
      kind: input.operation,
      method,
      amount: signed,
      reference: input.reference || null,
      customerId: input.customerId,
      staffId: input.actor.staffId,
      shiftId: await shiftForMoney(tx, input.actor),
      note: input.note ?? null,
      createdAt: input.at,
    })
    .returning();
  return postWallet(tx, {
    customerId: input.customerId,
    type: input.operation,
    amount: signed,
    actor: input.actor,
    paymentId: p.id,
    note: input.note,
    at: input.at,
  });
}
