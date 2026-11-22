import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { bestHappyHour, promoDiscount } from '../billing/engine.js';
import type { DbOrTx } from '../db/index.js';
import { happyHours, promoCodes } from '../db/schema.js';
import { badRequest, conflict } from '../lib/errors.js';

export type PromoRow = typeof promoCodes.$inferSelect;

export const HappyHourBody = z
  .object({
    name: z.string().trim().min(1).max(60),
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7).transform((d) => [...new Set(d)].sort()),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(0).max(1439),
    discountPercent: z.number().int().min(1).max(100),
    categoryId: z.string().uuid().nullish(),
    active: z.boolean().optional(),
  });

export const PromoBody = z
  .object({
    code: z
      .string()
      .trim()
      .min(3)
      .max(30)
      .regex(/^[A-Za-z0-9_-]+$/, 'Use letters, numbers, - and _ only')
      .transform((c) => c.toUpperCase()),
    description: z.string().max(200).nullish(),
    percentOff: z.number().int().min(1).max(100).nullish(),
    amountOff: z.number().int().positive().nullish(),
    minSpend: z.number().int().min(0).optional(),
    validFrom: z.coerce.date().nullish(),
    validTo: z.coerce.date().nullish(),
    maxUses: z.number().int().positive().nullish(),
    active: z.boolean().optional(),
    /** List it on the customer app's Rewards page. */
    showInPortal: z.boolean().optional(),
  });

export function checkPromoShape(p: { percentOff?: number | null; amountOff?: number | null; validFrom?: Date | null; validTo?: Date | null }) {
  if ((p.percentOff == null) === (p.amountOff == null)) throw badRequest('Set either a percentage or a fixed amount off (not both)');
  if (p.validFrom && p.validTo && p.validTo <= p.validFrom) throw badRequest('The end date must be after the start date');
}

/** Local wall-clock day/minute of an instant, in the server's time zone (TZ). */
export function localDayMinute(at: Date) {
  return { day: at.getDay(), minute: at.getHours() * 60 + at.getMinutes() };
}

export async function findHappyHour(tx: DbOrTx, categoryId: string | null, at: Date) {
  const rules = await tx.select().from(happyHours).where(eq(happyHours.active, true));
  const { day, minute } = localDayMinute(at);
  return bestHappyHour(rules, categoryId, day, minute);
}

/** Validates a promo code against a subtotal. Throws a readable error when it cannot be used. */
export function validatePromo(p: PromoRow | undefined, subtotal: number, at: Date): number {
  if (!p || !p.active) throw badRequest('That promo code is not valid');
  if (p.validFrom && at < p.validFrom) throw badRequest('That promo code is not active yet');
  if (p.validTo && at >= p.validTo) throw badRequest('That promo code has expired');
  if (p.maxUses != null && p.usesCount >= p.maxUses) throw conflict('That promo code has been fully used');
  if (subtotal < p.minSpend) throw badRequest(`That promo code needs a minimum spend of ${p.minSpend}`);
  return promoDiscount(subtotal, p);
}

/** Looks up and applies a promo code inside a transaction, counting one use. */
export async function redeemPromo(tx: DbOrTx, code: string, subtotal: number, at: Date) {
  const [p] = await tx.select().from(promoCodes).where(eq(promoCodes.code, code.trim().toUpperCase())).for('update');
  const discount = validatePromo(p, subtotal, at);
  await tx.update(promoCodes).set({ usesCount: p!.usesCount + 1 }).where(eq(promoCodes.id, p!.id));
  return { promo: p!, discount };
}

/** Read-only check used by the checkout screen before committing. */
export async function previewPromo(db: DbOrTx, code: string, subtotal: number, at: Date) {
  const [p] = await db.select().from(promoCodes).where(eq(promoCodes.code, code.trim().toUpperCase()));
  const discount = validatePromo(p, subtotal, at);
  return { code: p!.code, description: p!.description, discount };
}
