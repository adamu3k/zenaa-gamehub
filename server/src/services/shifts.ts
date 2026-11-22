import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { requirePermission, type Actor, type Ctx } from '../context.js';
import type { DbOrTx } from '../db/index.js';
import { payments, shifts } from '../db/schema.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { audit } from './audit.js';
import { openShiftId } from './wallet.js';

export type ShiftRow = typeof shifts.$inferSelect;

export const OpenShiftSchema = z.object({
  openingFloat: z.number().int().min(0),
  notes: z.string().max(500).nullish(),
});
export const CloseShiftSchema = z.object({
  countedCash: z.number().int().min(0),
  /** Notes and coins counted: face value (major units, as text) → count. */
  countedBreakdown: z.record(z.string().regex(/^\d+(\.\d+)?$/), z.number().int().min(0).max(100_000)).nullish(),
  /** MoMo actually received in the shift (from the MoMo phone/statement). */
  countedMomo: z.number().int().min(0).nullish(),
  notes: z.string().max(500).nullish(),
});
export const CASH_CATEGORIES = {
  in: { float: 'Change float added', owner: 'Owner put money in', other: 'Other money in' },
  out: {
    safe_drop: 'Safe drop (moved to the safe)',
    bank_deposit: 'Bank / MoMo deposit',
    owner_withdrawal: 'Owner withdrawal',
    supplies: 'Supplies & drinks stock',
    electricity: 'Electricity / prepaid units',
    internet: 'Internet / data',
    fuel: 'Generator fuel',
    repairs: 'Repairs & controllers',
    salary: 'Wages & allowances',
    rent: 'Rent',
    transport: 'Transport',
    other: 'Other expense',
  },
} as const;
export const CashMovementSchema = z.object({
  direction: z.enum(['in', 'out']),
  amount: z.number().int().positive(),
  category: z.string().trim().max(40).nullish(),
  reason: z.string().trim().min(3, 'Give a reason').max(300),
});

const METHODS = ['cash', 'card', 'bank_transfer', 'mobile_money', 'wallet', 'paystack'] as const;

/**
 * Totals for a shift. Payment amounts are signed, so cash expected in the drawer is simply
 * opening float + every cash amount (sales and deposits in, refunds/withdrawals/payouts out).
 */
export async function shiftSummary(db: DbOrTx, shift: ShiftRow) {
  const rows = await db.select().from(payments).where(eq(payments.shiftId, shift.id)).orderBy(asc(payments.createdAt));
  const byMethod: Record<string, number> = Object.fromEntries(METHODS.map((m) => [m, 0]));
  const byKind: Record<string, number> = {};
  let sales = 0;
  let refunds = 0;
  for (const p of rows) {
    byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amount;
    byKind[p.kind] = (byKind[p.kind] ?? 0) + p.amount;
    if (p.kind === 'session' || p.kind === 'extension' || p.kind === 'sale') sales += p.amount;
    if (p.kind === 'refund') refunds += -p.amount;
  }
  const expectedCash = shift.openingFloat + byMethod.cash;
  const expenses: Record<string, number> = {};
  for (const p of rows) if (p.kind === 'cash_out') expenses[p.category ?? 'other'] = (expenses[p.category ?? 'other'] ?? 0) - p.amount;
  return {
    /** Mobile money expected on the venue's MoMo phone for this shift. */
    expectedMomo: byMethod.mobile_money,
    expenses,
    transactions: rows.length,
    byMethod,
    byKind,
    /** Revenue taken in the shift (all methods, before refunds). */
    sales,
    refunds,
    netRevenue: sales - refunds,
    expectedCash,
  };
}

export function describeShift(shift: ShiftRow, live?: Awaited<ReturnType<typeof shiftSummary>>) {
  const summary = (shift.closedAt ? shift.summary : live) as Awaited<ReturnType<typeof shiftSummary>> | null;
  const expected = shift.closedAt ? shift.expectedCash : (live?.expectedCash ?? null);
  return {
    ...shift,
    summary,
    expectedCash: expected,
    variance: shift.countedCash != null && expected != null ? shift.countedCash - expected : null,
    momoVariance: shift.countedMomo != null && summary ? shift.countedMomo - (summary.expectedMomo ?? summary.byMethod?.mobile_money ?? 0) : null,
  };
}

export async function openShift(ctx: Ctx, actor: Actor, raw: unknown) {
  const input = OpenShiftSchema.parse(raw);
  if (!actor.staffId) throw badRequest('Only staff can open shifts');
  const shift = await ctx.db.transaction(async (tx) => {
    if (await openShiftId(tx, actor.staffId)) throw conflict('You already have an open shift');
    const [s] = await tx
      .insert(shifts)
      .values({ staffId: actor.staffId!, openedAt: ctx.clock.now(), openingFloat: input.openingFloat, notes: input.notes ?? null })
      .returning();
    await audit(tx, actor, 'shift.open', { type: 'shift', id: s.id }, { openingFloat: input.openingFloat });
    return s;
  });
  ctx.bus.emit({ type: 'payments.changed' });
  return describeShift(shift, await shiftSummary(ctx.db, shift));
}

export async function closeShift(ctx: Ctx, actor: Actor, id: string, raw: unknown) {
  const input = CloseShiftSchema.parse(raw);
  const shift = await ctx.db.transaction(async (tx) => {
    const [s] = await tx.select().from(shifts).where(eq(shifts.id, id)).for('update');
    if (!s) throw notFound('Shift');
    if (s.closedAt) throw conflict('This shift is already closed');
    if (s.staffId !== actor.staffId) requirePermission(actor, 'shifts.manage', "close another staff member's shift");
    const summary = await shiftSummary(tx, s);
    const [u] = await tx
      .update(shifts)
      .set({
        closedAt: ctx.clock.now(),
        closedBy: actor.staffId,
        expectedCash: summary.expectedCash,
        countedCash: input.countedCash,
        countedBreakdown: input.countedBreakdown ?? null,
        countedMomo: input.countedMomo ?? null,
        summary,
        notes: [s.notes, input.notes].filter(Boolean).join('\n') || null,
      })
      .where(eq(shifts.id, s.id))
      .returning();
    await audit(tx, actor, 'shift.close', { type: 'shift', id: s.id }, {
      expectedCash: summary.expectedCash,
      countedCash: input.countedCash,
      variance: input.countedCash - summary.expectedCash,
      momoVariance: input.countedMomo != null ? input.countedMomo - summary.expectedMomo : undefined,
    });
    return u;
  });
  ctx.bus.emit({ type: 'payments.changed' });
  return describeShift(shift);
}

/** Petty cash: money put into or taken out of the drawer that is not a sale (change float, supplies…). */
export async function cashMovement(ctx: Ctx, actor: Actor, raw: unknown) {
  requirePermission(actor, 'shifts.manage', 'record cash in/out');
  const input = CashMovementSchema.parse(raw);
  const row = await ctx.db.transaction(async (tx) => {
    const shiftId = await openShiftId(tx, actor.staffId);
    if (!shiftId) throw conflict('Open your shift before recording cash in or out');
    const [p] = await tx
      .insert(payments)
      .values({
        kind: input.direction === 'in' ? 'cash_in' : 'cash_out',
        method: 'cash',
        amount: input.direction === 'in' ? input.amount : -input.amount,
        staffId: actor.staffId,
        shiftId,
        note: input.reason,
        category: input.category || (input.direction === 'out' ? 'other' : null),
        approvedBy: actor.approvedBy ?? null,
        createdAt: ctx.clock.now(),
      })
      .returning();
    await audit(tx, actor, `shift.cash_${input.direction}`, { type: 'shift', id: shiftId }, { amount: input.amount, category: input.category, reason: input.reason });
    return p;
  });
  ctx.bus.emit({ type: 'payments.changed' });
  return row;
}

export async function currentShift(db: DbOrTx, staffId: string) {
  const [s] = await db
    .select()
    .from(shifts)
    .where(and(eq(shifts.staffId, staffId), isNull(shifts.closedAt)));
  return s ? describeShift(s, await shiftSummary(db, s)) : null;
}
