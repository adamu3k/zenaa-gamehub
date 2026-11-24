/**
 * Paystack online payments — wallet top-ups from the customer portal or at the counter (scan-to-pay).
 *
 * Money is only ever credited after the server itself asks Paystack "did this reference succeed, for this
 * amount, in this currency?" (verify API). The browser redirect, the webhook and a background re-check all
 * funnel into the same idempotent `verifyOnlinePayment`, so a payment is credited exactly once.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, gt, isNull, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { httpOf, type Actor, type Ctx } from '../context.js';
import { customers, onlinePayments, payments } from '../db/schema.js';
import { AppError, badRequest, conflict, notFound } from '../lib/errors.js';
import { audit } from './audit.js';
import { getKv, getSettings, setKv } from './settings.js';
import { formatCustomerCode, openShiftId, postWallet } from './wallet.js';
import { payOwedFromWallet } from './sessions.js';

const API = 'https://api.paystack.co';
const KEY = 'integration.paystack';

export const PaystackConfigSchema = z.object({
  enabled: z.boolean(),
  publicKey: z.string().trim().max(200).regex(/^(pk_(test|live)_\w+)?$/, 'Public key starts with pk_test_ or pk_live_').default(''),
  /** Leave empty when saving to keep the stored secret. */
  secretKey: z.string().trim().max(200).regex(/^(sk_(test|live)_\w+)?$/, 'Secret key starts with sk_test_ or sk_live_').optional(),
  /** Public address of this system (e.g. https://zenaa.example.com) for the return link after paying. Empty = the address the customer used. */
  callbackBaseUrl: z.string().trim().max(200).regex(/^(https?:\/\/[^\s/]+)?\/?$/, 'Use an address like https://zenaa.example.com').default(''),
});
export type PaystackConfig = { enabled: boolean; publicKey: string; secretKey: string; callbackBaseUrl: string };

const DEFAULTS: PaystackConfig = { enabled: false, publicKey: '', secretKey: '', callbackBaseUrl: '' };

export async function getPaystackConfig(ctx: Ctx): Promise<PaystackConfig> {
  return { ...DEFAULTS, ...((await getKv<Partial<PaystackConfig>>(ctx.db, KEY)) ?? {}) };
}

export function maskConfig(c: PaystackConfig) {
  return {
    enabled: c.enabled,
    publicKey: c.publicKey,
    callbackBaseUrl: c.callbackBaseUrl,
    hasSecretKey: !!c.secretKey,
    secretKeyHint: c.secretKey ? `${c.secretKey.slice(0, 8)}…${c.secretKey.slice(-4)}` : null,
    mode: c.secretKey.startsWith('sk_live_') ? 'live' : c.secretKey ? 'test' : null,
  };
}

export async function savePaystackConfig(ctx: Ctx, actor: Actor, raw: unknown) {
  const input = PaystackConfigSchema.parse(raw);
  const cur = await getPaystackConfig(ctx);
  const next: PaystackConfig = {
    enabled: input.enabled,
    publicKey: input.publicKey,
    secretKey: input.secretKey ? input.secretKey : cur.secretKey,
    callbackBaseUrl: input.callbackBaseUrl.replace(/\/$/, ''),
  };
  if (next.enabled && !next.secretKey) throw badRequest('Enter your Paystack secret key to switch Paystack on');
  if (next.secretKey && next.publicKey && next.secretKey.slice(3, 7) !== next.publicKey.slice(3, 7)) {
    throw badRequest('The public and secret keys must both be test keys or both be live keys');
  }
  await setKv(ctx.db, KEY, next);
  await audit(ctx.db, actor, 'integration.paystack_update', undefined, { enabled: next.enabled, publicKey: next.publicKey, secretChanged: !!input.secretKey });
  return maskConfig(next);
}

async function ps<T = any>(ctx: Ctx, secret: string, path: string, init: RequestInit = {}): Promise<{ status: number; body: T & { status?: boolean; message?: string } }> {
  let res: Response;
  try {
    res = await httpOf(ctx)(`${API}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AppError(502, 'Cannot reach Paystack — check the internet connection', 'paystack_unreachable');
  }
  let body: any = {};
  try {
    body = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, body };
}

/** Checks the secret key against Paystack (Settings → "Test"). */
export async function testPaystack(ctx: Ctx) {
  const cfg = await getPaystackConfig(ctx);
  if (!cfg.secretKey) throw badRequest('Save your secret key first');
  const r = await ps(ctx, cfg.secretKey, '/transaction?perPage=1');
  if (r.status === 401) return { ok: false, message: 'Paystack rejected the secret key' };
  if (r.status >= 400) return { ok: false, message: r.body.message ?? `Paystack answered ${r.status}` };
  return { ok: true, message: `Connected to Paystack (${cfg.secretKey.startsWith('sk_live_') ? 'LIVE' : 'TEST'} mode)` };
}

/** Paystack wants amounts in the currency's subunit ×100 (pesewas, kobo, cents). */
function toPaystackAmount(minor: number, minorUnits: number) {
  return minor * 10 ** (2 - minorUnits);
}

export const TopupSchema = z.object({
  amount: z.number().int().positive(),
  email: z.string().trim().email('Enter a valid email address — Paystack sends the receipt there').max(120),
});

export async function startTopup(
  ctx: Ctx,
  input: { customerId: string; amount: number; email: string; initiatedBy: string | null; callbackUrl: string },
) {
  const cfg = await getPaystackConfig(ctx);
  if (!cfg.enabled || !cfg.secretKey) throw conflict('Online payment (Paystack) is not set up yet');
  const settings = await getSettings(ctx.db);
  if (settings.currencyMinorUnits > 2) throw conflict('Paystack cannot be used with this currency setting');
  const min = 10 ** settings.currencyMinorUnits; // 1 whole unit
  if (input.amount < min) throw badRequest('The minimum top-up is 1.00');
  if (input.amount > 1_000_000 * min) throw badRequest('That amount is too large');
  const [c] = await ctx.db.select().from(customers).where(eq(customers.id, input.customerId));
  if (!c) throw notFound('Customer');
  if (c.status !== 'active') throw conflict('This customer account is suspended');

  const reference = `zg_${formatCustomerCode(c.number).replace('-', '').toLowerCase()}_${randomBytes(6).toString('hex')}`;
  const [row] = await ctx.db
    .insert(onlinePayments)
    .values({
      reference,
      purpose: 'wallet_topup',
      customerId: c.id,
      amount: input.amount,
      currency: settings.currencyCode,
      email: input.email.toLowerCase(),
      initiatedBy: input.initiatedBy,
      createdAt: ctx.clock.now(),
    })
    .returning();

  const r = await ps(ctx, cfg.secretKey, '/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      email: row.email,
      amount: toPaystackAmount(input.amount, settings.currencyMinorUnits),
      currency: settings.currencyCode,
      reference,
      callback_url: `${input.callbackUrl}?reference=${encodeURIComponent(reference)}`,
      metadata: {
        purpose: 'wallet_topup',
        customer_code: formatCustomerCode(c.number),
        customer_name: c.fullName,
        cancel_action: input.callbackUrl,
        custom_fields: [{ display_name: 'Customer', variable_name: 'customer', value: `${c.fullName} (${formatCustomerCode(c.number)})` }],
      },
    }),
  });
  if (r.status >= 400 || !r.body.status) {
    await ctx.db.update(onlinePayments).set({ status: 'failed', failureReason: r.body.message ?? `HTTP ${r.status}` }).where(eq(onlinePayments.id, row.id));
    throw new AppError(502, `Paystack: ${r.body.message ?? 'could not start the payment'}`, 'paystack_error');
  }
  const url = (r.body as any).data?.authorization_url as string;
  await ctx.db.update(onlinePayments).set({ authorizationUrl: url }).where(eq(onlinePayments.id, row.id));
  await audit(ctx.db, { staffId: input.initiatedBy }, 'paystack.initialize', { type: 'online_payment', id: row.id }, { amount: input.amount, customerId: c.id, reference });
  return { id: row.id, reference, authorizationUrl: url, amount: input.amount, currency: settings.currencyCode };
}

/** Asks Paystack for the outcome of a reference and credits the wallet once on success. Safe to call any number of times. */
export async function verifyOnlinePayment(ctx: Ctx, reference: string) {
  const [row] = await ctx.db.select().from(onlinePayments).where(eq(onlinePayments.reference, reference));
  if (!row) throw notFound('Payment');
  if (row.status !== 'pending') return row;
  const cfg = await getPaystackConfig(ctx);
  if (!cfg.secretKey) return row;
  const now = ctx.clock.now();
  const stale = now.getTime() - row.createdAt.getTime() > 24 * 3600_000;

  const r = await ps(ctx, cfg.secretKey, `/transaction/verify/${encodeURIComponent(reference)}`);
  const data: any = (r.body as any).data ?? {};
  await ctx.db.update(onlinePayments).set({ lastCheckedAt: now }).where(eq(onlinePayments.id, row.id));
  if (r.status === 404 || (r.status < 500 && !r.body.status)) {
    if (stale) return finish(ctx, row.id, 'expired', 'Never paid');
    return { ...row, lastCheckedAt: now };
  }
  if (r.status >= 400) return row; // Paystack trouble — try again later

  const settings = await getSettings(ctx.db);
  if (data.status === 'success') {
    const expected = toPaystackAmount(row.amount, settings.currencyMinorUnits);
    if (Number(data.amount) !== expected || String(data.currency).toUpperCase() !== row.currency) {
      ctx.bus.emit({ type: 'alert', level: 'critical', message: `Paystack payment ${reference} did not match (amount/currency) — not credited. Check the Paystack dashboard.` });
      return finish(ctx, row.id, 'failed', `Amount or currency mismatch: got ${data.amount} ${data.currency}`, data);
    }
    return credit(ctx, row.id, data);
  }
  if (data.status === 'failed' || data.status === 'reversed') return finish(ctx, row.id, 'failed', data.gateway_response ?? data.status, data);
  if (stale) return finish(ctx, row.id, 'expired', data.gateway_response ?? 'Not completed within 24 hours', data);
  return { ...row, lastCheckedAt: now };
}

async function finish(ctx: Ctx, id: string, status: 'failed' | 'expired', reason: string, data?: any) {
  const [u] = await ctx.db
    .update(onlinePayments)
    .set({ status, failureReason: String(reason).slice(0, 300), providerData: data ? pickData(data) : undefined })
    .where(and(eq(onlinePayments.id, id), eq(onlinePayments.status, 'pending')))
    .returning();
  if (u) ctx.bus.emit({ type: 'customers.changed', customerId: u.customerId });
  return u ?? (await ctx.db.select().from(onlinePayments).where(eq(onlinePayments.id, id)))[0];
}

const pickData = (d: any) => ({
  id: d.id,
  status: d.status,
  channel: d.channel,
  amount: d.amount,
  currency: d.currency,
  fees: d.fees,
  paid_at: d.paid_at,
  gateway_response: d.gateway_response,
  bank: d.authorization?.bank,
  last4: d.authorization?.last4,
  mobile_money_number: d.authorization?.mobile_money_number,
});

async function credit(ctx: Ctx, id: string, data: any) {
  const now = ctx.clock.now();
  const result = await ctx.db.transaction(async (tx) => {
    // Only the first caller to flip pending → success credits the wallet.
    const [row] = await tx
      .update(onlinePayments)
      .set({ status: 'success', channel: data.channel ?? null, paidAt: data.paid_at ? new Date(data.paid_at) : now, providerData: pickData(data) })
      .where(and(eq(onlinePayments.id, id), eq(onlinePayments.status, 'pending')))
      .returning();
    if (!row) return null;
    const channel = data.channel ? ` · ${String(data.channel).replace('_', ' ')}` : '';
    const [p] = await tx
      .insert(payments)
      .values({
        kind: 'deposit',
        method: 'paystack',
        amount: row.amount,
        reference: `Paystack · ${row.reference}${channel}`.slice(0, 100),
        customerId: row.customerId,
        staffId: row.initiatedBy,
        shiftId: await openShiftId(tx, row.initiatedBy),
        note: row.initiatedBy ? 'Paystack top-up at the counter' : 'Paystack top-up (customer portal)',
        createdAt: now,
      })
      .returning();
    await postWallet(tx, {
      customerId: row.customerId,
      type: 'deposit',
      amount: row.amount,
      actor: { staffId: row.initiatedBy },
      paymentId: p.id,
      note: 'Paystack top-up',
      at: now,
    });
    const [u] = await tx.update(onlinePayments).set({ paymentId: p.id }).where(eq(onlinePayments.id, row.id)).returning();
    await payOwedFromWallet(tx, row.customerId, { staffId: row.initiatedBy }, now);
    await audit(tx, { staffId: null }, 'paystack.credited', { type: 'online_payment', id: row.id }, { amount: row.amount, reference: row.reference, channel: data.channel });
    return u;
  });
  if (!result) return (await ctx.db.select().from(onlinePayments).where(eq(onlinePayments.id, id)))[0];
  ctx.bus.emit({ type: 'customers.changed', customerId: result.customerId });
  ctx.bus.emit({ type: 'payments.changed' });
  return result;
}

/** Paystack webhook: verify the HMAC-SHA512 signature, then re-check the transaction through the API. */
export async function handleWebhook(ctx: Ctx, rawBody: string, signature: string | undefined) {
  const cfg = await getPaystackConfig(ctx);
  if (!cfg.secretKey || !signature) return false;
  const expected = createHmac('sha512', cfg.secretKey).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return false;
  }
  const reference = event?.data?.reference;
  if (event?.event === 'charge.success' && typeof reference === 'string') {
    const [row] = await ctx.db.select({ id: onlinePayments.id }).from(onlinePayments).where(eq(onlinePayments.reference, reference));
    if (row) await verifyOnlinePayment(ctx, reference);
  }
  return true;
}

/** Background safety net for customers who closed the page before returning: re-check open payments. */
export async function sweepPendingPayments(ctx: Ctx) {
  const now = ctx.clock.now();
  const rows = await ctx.db
    .select({ reference: onlinePayments.reference })
    .from(onlinePayments)
    .where(
      and(
        eq(onlinePayments.status, 'pending'),
        lt(onlinePayments.createdAt, new Date(now.getTime() - 20_000)),
        or(isNull(onlinePayments.lastCheckedAt), lt(onlinePayments.lastCheckedAt, new Date(now.getTime() - 90_000))),
      ),
    )
    .orderBy(desc(onlinePayments.createdAt))
    .limit(20);
  for (const r of rows) {
    try {
      await verifyOnlinePayment(ctx, r.reference);
    } catch {
      /* try again next sweep */
    }
  }
  return rows.length;
}

export async function listOnlinePayments(ctx: Ctx, q: { customerId?: string; since?: Date; limit?: number }) {
  return ctx.db
    .select({ o: onlinePayments, customerName: customers.fullName })
    .from(onlinePayments)
    .innerJoin(customers, eq(customers.id, onlinePayments.customerId))
    .where(and(q.customerId ? eq(onlinePayments.customerId, q.customerId) : undefined, q.since ? gt(onlinePayments.createdAt, q.since) : undefined))
    .orderBy(desc(onlinePayments.createdAt))
    .limit(q.limit ?? 100)
    .then((rows) => rows.map((r) => ({ ...r.o, customerName: r.customerName })));
}
