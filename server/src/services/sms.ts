/**
 * Thank-you / receipt SMS to customers, sent from the venue's MoMo phone (ZENAA MoMo app 1.2+).
 *
 * ZENAA puts each message in an outbox; the paired MoMo phone asks for waiting messages every few seconds,
 * sends them as normal SMS from its SIM (costs that SIM's normal SMS price) and reports back.
 * Messages are queued inside the same database transaction as the payment, so a rolled-back payment never texts.
 */
import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import type { DbOrTx } from '../db/index.js';
import { customers, smsOutbox } from '../db/schema.js';
import { badRequest, notFound } from '../lib/errors.js';
import { getSettings, type AppSettings } from './settings.js';

export type SmsKind = 'momo' | 'topup' | 'game' | 'test';

export const SMS_PLACEHOLDERS = ['{name}', '{amount}', '{balance}', '{centre}', '{station}'] as const;

export function moneyText(v: number, s: Pick<AppSettings, 'currencyCode' | 'currencyMinorUnits'>) {
  return `${s.currencyCode} ${(v / 10 ** s.currencyMinorUnits).toFixed(s.currencyMinorUnits)}`;
}

/** Replaces {name}, {amount}… Unknown placeholders are left as typed; extra spaces are tidied. */
export function fillTemplate(template: string, vars: Record<string, string>) {
  return template
    .replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m))
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,!?])/g, '$1')
    .trim();
}

/** Keeps + and digits only, e.g. "024 123 4567" → "0241234567". */
export function cleanPhone(p: string) {
  const t = p.trim();
  return (t.startsWith('+') ? '+' : '') + t.replace(/\D/g, '');
}

const TEMPLATE: Record<Exclude<SmsKind, 'test'>, keyof AppSettings> = { momo: 'smsTemplateMomo', topup: 'smsTemplateTopup', game: 'smsTemplateGame' };
const SWITCH: Record<Exclude<SmsKind, 'test'>, keyof AppSettings> = { momo: 'smsNotifyMomo', topup: 'smsNotifyTopup', game: 'smsNotifyGame' };

/**
 * Queues a message to a registered customer (inside the caller's transaction). Does nothing when switched off
 * or when the customer has no phone number.
 */
export async function queueCustomerSms(tx: DbOrTx, customerId: string, kind: Exclude<SmsKind, 'test'>, vars: { amount: number; station?: string | null }, at: Date) {
  const s = await getSettings(tx);
  if (!s.smsNotifyOn || !s[SWITCH[kind]]) return null;
  const [c] = await tx.select({ id: customers.id, fullName: customers.fullName, phone: customers.phone, balance: customers.balance }).from(customers).where(eq(customers.id, customerId));
  const phone = c?.phone ? cleanPhone(c.phone) : '';
  if (!c || phone.replace('+', '').length < 9) return null;
  const body = fillTemplate(String(s[TEMPLATE[kind]]), {
    name: c.fullName.trim().split(/\s+/)[0] ?? '',
    amount: moneyText(vars.amount, s),
    balance: moneyText(c.balance, s),
    centre: s.centerName,
    station: vars.station ?? '',
  }).slice(0, 320);
  const [row] = await tx.insert(smsOutbox).values({ customerId: c.id, phone, body, kind, createdAt: at }).returning();
  return row;
}

// ───────────── The MoMo phone ─────────────

const MAX_AGE_MS = 12 * 3600_000; // older messages are not sent any more (e.g. the phone was off all night)
const STUCK_MS = 5 * 60_000; // handed to the phone but never reported: failed (not re-sent, to avoid a double SMS)
const MAX_TRIES = 3;

/** Gives the phone up to 5 waiting messages and marks them as being sent. */
export async function relayTakeOutbox(ctx: Ctx, device: string) {
  const now = ctx.clock.now();
  await ctx.db
    .update(smsOutbox)
    .set({ status: 'expired', error: 'Not sent within 12 hours (was the MoMo phone off?)' })
    .where(and(inArray(smsOutbox.status, ['queued', 'sending']), lt(smsOutbox.createdAt, new Date(now.getTime() - MAX_AGE_MS))));
  await ctx.db
    .update(smsOutbox)
    .set({ status: 'failed', error: 'The phone did not report back — it may or may not have been sent' })
    .where(and(eq(smsOutbox.status, 'sending'), lt(smsOutbox.claimedAt, new Date(now.getTime() - STUCK_MS))));
  const rows = await ctx.db.select().from(smsOutbox).where(eq(smsOutbox.status, 'queued')).orderBy(asc(smsOutbox.createdAt)).limit(5);
  if (!rows.length) return [];
  await ctx.db
    .update(smsOutbox)
    .set({ status: 'sending', claimedAt: now, device: device.slice(0, 60), attempts: sql`${smsOutbox.attempts} + 1` })
    .where(inArray(smsOutbox.id, rows.map((r) => r.id)));
  return rows.map((r) => ({ id: r.id, to: r.phone, body: r.body }));
}

export async function relayReportOutbox(ctx: Ctx, id: string, raw: unknown) {
  const input = z.object({ ok: z.boolean(), error: z.string().max(200).nullish() }).parse(raw);
  const [r] = await ctx.db.select().from(smsOutbox).where(eq(smsOutbox.id, id));
  if (!r) throw notFound('Message');
  if (r.status !== 'sending') return { ok: true };
  const retry = !input.ok && r.attempts < MAX_TRIES;
  await ctx.db
    .update(smsOutbox)
    .set(input.ok ? { status: 'sent', sentAt: ctx.clock.now(), error: null } : { status: retry ? 'queued' : 'failed', error: input.error || 'The phone could not send it' })
    .where(eq(smsOutbox.id, id));
  return { ok: true };
}

// ───────────── Staff ─────────────

export async function listOutbox(ctx: Ctx, limit = 100) {
  return ctx.db
    .select({
      id: smsOutbox.id,
      phone: smsOutbox.phone,
      body: smsOutbox.body,
      kind: smsOutbox.kind,
      status: smsOutbox.status,
      attempts: smsOutbox.attempts,
      error: smsOutbox.error,
      createdAt: smsOutbox.createdAt,
      sentAt: smsOutbox.sentAt,
      customerId: smsOutbox.customerId,
      customerName: customers.fullName,
    })
    .from(smsOutbox)
    .leftJoin(customers, eq(customers.id, smsOutbox.customerId))
    .orderBy(desc(smsOutbox.createdAt))
    .limit(Math.min(Math.max(limit, 1), 300));
}

export async function queueTestSms(ctx: Ctx, raw: unknown) {
  const input = z.object({ phone: z.string().trim().min(9).max(20) }).parse(raw);
  const phone = cleanPhone(input.phone);
  if (phone.replace('+', '').length < 9) throw badRequest('Type a full phone number, e.g. 0241234567');
  const s = await getSettings(ctx.db);
  const [row] = await ctx.db
    .insert(smsOutbox)
    .values({ phone, body: `Test from ${s.centerName}: thank-you SMS from your MoMo phone are working.`, kind: 'test', createdAt: ctx.clock.now() })
    .returning();
  return row;
}

export async function retryOutbox(ctx: Ctx, id: string) {
  const [r] = await ctx.db
    .update(smsOutbox)
    .set({ status: 'queued', attempts: 0, error: null, createdAt: ctx.clock.now() })
    .where(and(eq(smsOutbox.id, id), inArray(smsOutbox.status, ['failed', 'expired'])))
    .returning();
  if (!r) throw notFound('Failed message');
  return r;
}
