/**
 * Staff PINs.
 *
 * Every staff member can have a 4–8 digit PIN. It is used to:
 *  - approve sensitive actions at the counter (cash in/out, refunds, discounts…) — when Settings ask for it,
 *    or when the signed-in person lacks the permission and someone who has it types their PIN (manager override);
 *  - unlock or exit the station screen apps (PC / Android TV) and send the console timer from a console's browser.
 *
 * PINs are stored as a keyed HMAC (unique per staff member), so a PIN alone identifies who typed it.
 * Wrong PINs are rate-limited per device.
 */
import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { actorOf, loadStaffById } from '../auth/plugin.js';
import type { Permission } from '../auth/permissions.js';
import type { Actor, Ctx } from '../context.js';
import type { DbOrTx } from '../db/index.js';
import { staff } from '../db/schema.js';
import { AppError, badRequest } from '../lib/errors.js';
import { getSettings } from './settings.js';

let pinKey = 'zenaa-pin-dev';
/** Derives the PIN hashing key from the server secret (called once at start-up). */
export function setPinKey(secret: string) {
  pinKey = createHmac('sha256', secret).update('zenaa-staff-pin-v1').digest('hex');
}
export const hashPin = (pin: string) => createHmac('sha256', pinKey).update(pin).digest('hex');

export const PinSchema = z
  .string()
  .regex(/^\d{4,8}$/, 'PIN: 4 to 8 digits')
  .refine((p) => !/^(\d)\1+$/.test(p), 'PIN is too easy (all the same digit)')
  .refine((p) => !'0123456789012345'.includes(p) && !'9876543210987654'.includes(p), 'PIN is too easy (1234…)');

const MAX_WRONG = 5;
const LOCK_MS = 5 * 60_000;
const failures = new Map<string, { count: number; until: number }>();

export interface PinStaff {
  id: string;
  fullName: string;
  roleName: string;
  permissions: Permission[];
}

/** Finds the active staff member with this PIN. Throws 403 pin_wrong (rate-limited per `source`). */
export async function verifyPin(db: DbOrTx, pin: unknown, source: string): Promise<PinStaff> {
  const f = failures.get(source);
  if (f && f.count >= MAX_WRONG && f.until > Date.now()) throw new AppError(429, 'Too many wrong PINs — wait 5 minutes', 'locked');
  const value = typeof pin === 'string' ? pin.trim() : typeof pin === 'number' ? String(pin) : '';
  const [s] = /^\d{4,8}$/.test(value) ? await db.select().from(staff).where(eq(staff.pinHash, hashPin(value))) : [];
  if (!s || !s.active) {
    failures.set(source, { count: (f && f.until > Date.now() ? f.count : 0) + 1, until: Date.now() + LOCK_MS });
    throw new AppError(403, 'Wrong PIN', 'pin_wrong');
  }
  failures.delete(source);
  const full = (await loadStaffById(db as never, s.id))!;
  return { id: s.id, fullName: s.fullName, roleName: full.roleName, permissions: full.permissions };
}

/** Sets (or clears with null) a staff member's PIN. */
export async function setPin(db: DbOrTx, staffId: string, pin: string | null, at: Date) {
  if (pin === null) {
    await db.update(staff).set({ pinHash: null, pinSetAt: null }).where(eq(staff.id, staffId));
    return;
  }
  const value = PinSchema.parse(pin);
  const h = hashPin(value);
  const [other] = await db.select({ id: staff.id }).from(staff).where(eq(staff.pinHash, h));
  if (other && other.id !== staffId) throw badRequest('That PIN cannot be used — choose a different one');
  await db.update(staff).set({ pinHash: h, pinSetAt: at }).where(eq(staff.id, staffId));
}

export const PIN_ACTIONS = {
  cash_movement: 'Cash in / cash out (expenses, safe drops)',
  refund: 'Refunds and voids',
  discount: 'Manual discounts at checkout',
  wallet_withdraw: 'Wallet withdrawals (cash back to a customer)',
  wallet_adjust: 'Wallet adjustments',
  shift_close: 'Closing a shift (cash count)',
  bypass: 'Turn a station on with no charge (staff unlock)',
  momo_confirm: 'Confirming a MoMo payment by hand',
} as const;
export type PinAction = keyof typeof PIN_ACTIONS;

/**
 * Gate for a sensitive action. Returns the actor to use.
 *  - Settings require a PIN for this action → the body must carry `pin` (anyone's PIN who holds `perm`).
 *  - The signed-in person lacks `perm` → someone who has it can approve with their PIN (manager override).
 * Responds 428 pin_required so the web app can ask for the PIN and retry.
 */
export async function pinGate(ctx: Ctx, req: FastifyRequest, action: PinAction, perm: Permission | null): Promise<Actor> {
  const base = actorOf(req);
  const has = !perm || req.staff!.permissions.includes(perm);
  const settings = await getSettings(ctx.db);
  const required = settings.requirePinFor.includes(action);
  if (has && !required) return base;
  const pin = (req.body as { pin?: unknown } | undefined)?.pin;
  if (pin === undefined || pin === null || pin === '') {
    throw new AppError(
      428,
      has ? 'Type your staff PIN to confirm' : `You don't have permission for this — someone who does can approve it with their PIN`,
      'pin_required',
    );
  }
  const approver = await verifyPin(ctx.db, pin, `staff:${req.staff!.id}`);
  if (perm && !approver.permissions.includes(perm)) {
    throw new AppError(403, `${approver.fullName} (${approver.roleName}) does not have permission for this either`, 'forbidden');
  }
  return {
    ...base,
    permissions: [...new Set([...(base.permissions ?? []), ...(perm ? [perm] : [])])],
    approvedBy: approver.id,
  };
}
