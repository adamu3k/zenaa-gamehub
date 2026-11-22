/**
 * Mobile money top-ups without a payment gateway (no Paystack fee).
 *
 *  1. The customer opens "Top up with MoMo" in the portal, picks an amount → gets a short number reference code (e.g. 482193)
 *     and the venue's MoMo number.
 *  2. They send the money with their phone (*170# / MoMo app) and type the code as the "Reference".
 *  3. The venue's MoMo phone receives the network's "Payment received…" SMS. The ZENAA MoMo Relay app (or any
 *     SMS-forwarder app) forwards it to ZENAA. ZENAA reads amount, transaction ID and reference, finds the request
 *     and credits the wallet at once — the customer's page turns green.
 *  4. Without the relay, or when something doesn't match, staff see it in the MoMo inbox and confirm with one tap.
 *
 * Safety: only SMS from trusted sender names (e.g. "MobileMoney") count, never from phone numbers; each transaction ID
 * is credited once; the amount must match exactly; amounts above a limit wait for staff.
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Actor, Ctx } from '../context.js';
import type { DbOrTx } from '../db/index.js';
import { customers, momoRequests, momoSms } from '../db/schema.js';
import { badRequest, conflict, notFound, unauthorized } from '../lib/errors.js';
import { audit } from './audit.js';
import { getKv, getSettings, setKv, type AppSettings } from './settings.js';
import { moneyText, queueCustomerSms } from './sms.js';
import { walletOperation } from './wallet.js';

// ───────────── SMS parsing ─────────────

export interface ParsedSms {
  incoming: boolean;
  /** Major units as written ("1,250.50" → 1250.5). */
  amountMajor: number | null;
  txnId: string | null;
  reference: string | null;
  payerName: string | null;
  payerPhone: string | null;
}

const CUR = '(?:GHS|GH₵|GH¢|GHC|GH\\s?C|₵|¢|NGN|₦|KES|KSh|UGX|TZS|RWF|XOF|XAF|ZMW|MWK|USD|\\$)';

/** Reads a "money received" SMS from MTN MoMo, Telecel Cash, AT Money and similar networks. */
export function parseMomoSms(text: string): ParsedSms {
  const t = text.replace(/\s+/g, ' ').trim();
  const incoming =
    /(payment (has been )?received|you have received|received (a )?(payment|money)|cash ?in received|has been credited|credited to your|deposit received|received\s+(GHS|GH₵|GH¢|GHC|₵|¢))/i.test(t) &&
    !/(you have sent|payment made for|you have paid|withdrawal of|cash ?out of|transferred to)/i.test(t);

  // Amount: the first currency amount after "received", else the first one at all (balances come later).
  const re = new RegExp(`${CUR}\\s?([0-9][0-9,]*(?:\\.[0-9]{1,2})?)`, 'ig');
  const all = [...t.matchAll(re)].map((m) => ({ at: m.index ?? 0, v: Number(m[1].replace(/,/g, '')) }));
  const rx = /received/i.exec(t);
  const after = rx ? all.find((a) => a.at > rx.index) : undefined;
  const amountMajor = (after ?? all[0])?.v ?? null;

  const txn =
    /(?:financial transaction id|transaction id|trans(?:action)?\.?\s?id|txn\s?id|transaction no\.?|trx\s?id|ref(?:erence)? no\.?)\s*[:#-]?\s*([A-Z0-9][A-Z0-9.]{5,30})/i.exec(t) ??
    /^([0-9]{8,})\s+confirmed/i.exec(t);
  const ref = /\breference\s*[:-]?\s*([^.;\n]{1,40}?)(?=\s*(?:[.;]|$|transaction|current|your|fee|available|balance|tran))/i.exec(t);
  const phone = /(?:from|by)\s+(?:[A-Za-z .'-]{2,40}?\s+)?\(?(\+?233\d{9}|0\d{9}|\+?\d{10,13})\)?/i.exec(t);
  const name =
    /from\s+(?:\+?\d{9,13}\s*[-–]\s*)?([A-Z][A-Za-z .'-]{1,40}?)(?=\s*(?:\(|\d|on\s|\.|,|current|reference|$))/i.exec(t);
  return {
    incoming,
    amountMajor: amountMajor != null && Number.isFinite(amountMajor) ? amountMajor : null,
    txnId: txn ? txn[1].replace(/\.$/, '').toUpperCase() : null,
    reference: ref ? ref[1].trim() : null,
    payerName: name ? name[1].trim() : null,
    payerPhone: phone ? phone[1] : null,
  };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
export function trustedSender(sender: string, settings: Pick<AppSettings, 'momoSmsSenders'>) {
  const s = sender.trim();
  if (/^\+?[\d\s-]{6,}$/.test(s)) return false; // a phone number — anyone can send those
  return settings.momoSmsSenders.some((x) => norm(x) === norm(s));
}

/**
 * Reference codes: 6 digits, never starting with 0, e.g. 482193. Numbers only, so they are easy to type
 * on a keypad phone (*170#) where capital letters are hard or impossible.
 */
function newCode() {
  return String(randomInt(100_000, 1_000_000));
}
/** Codes from before v0.7.1 (two letters + four digits, e.g. KD4821) still match. */
const OLD_CODE_RE = /\b([A-HJ-NP-Z]{2}\d{4})\b/g;
const NUM_CODE_RE = /(?<!\d)([1-9]\d{5})(?!\d)/g;

/**
 * Codes a payment SMS could be for. Number codes are only read from the Reference part (the rest of an SMS is full of
 * phone numbers, balances and transaction IDs); spaces, dots or dashes typed inside the code are ignored.
 */
export function codesInSms(reference: string | null, body: string) {
  const ref = (reference ?? '').toUpperCase();
  const squeezed = ref.replace(/(\d)[\s.-]+(?=\d)/g, '$1');
  const found = [
    ...[...ref.matchAll(OLD_CODE_RE)].map((m) => m[1]),
    ...[...body.toUpperCase().matchAll(OLD_CODE_RE)].map((m) => m[1]),
    ...[...squeezed.matchAll(NUM_CODE_RE)].map((m) => m[1]),
  ];
  return [...new Set(found)];
}

const toMinor = (major: number, mu: number) => Math.round(major * 10 ** mu);

// ───────────── Customer requests ─────────────

export const MomoTopupSchema = z.object({
  amount: z.number().int().positive(),
  network: z.string().trim().min(1).max(40),
});

const REQUEST_TTL_MS = 2 * 3600_000;

export async function createMomoRequest(ctx: Ctx, customerId: string, raw: unknown) {
  const input = MomoTopupSchema.parse(raw);
  const s = await getSettings(ctx.db);
  if (!s.momoTopupEnabled || s.momoAccounts.length === 0) throw conflict('MoMo top-up is not available — please pay at the counter');
  if (input.amount < s.momoMinTopup) throw badRequest('Amount is below the minimum top-up');
  if (s.momoMaxTopup > 0 && input.amount > s.momoMaxTopup) throw badRequest('Amount is above the maximum top-up');
  const account = s.momoAccounts.find((a) => a.network === input.network) ?? s.momoAccounts[0];
  const now = ctx.clock.now();
  const open = await ctx.db
    .select({ id: momoRequests.id })
    .from(momoRequests)
    .where(and(eq(momoRequests.customerId, customerId), eq(momoRequests.status, 'pending')));
  if (open.length >= 3) throw conflict('You already have 3 MoMo top-ups waiting — finish or cancel one first');
  for (let i = 0; i < 8; i++) {
    const code = newCode();
    const [dupe] = await ctx.db.select({ id: momoRequests.id }).from(momoRequests).where(eq(momoRequests.code, code));
    if (dupe) continue;
    const [r] = await ctx.db
      .insert(momoRequests)
      .values({ customerId, amount: input.amount, network: account.network, code, expiresAt: new Date(now.getTime() + REQUEST_TTL_MS), createdAt: now })
      .returning();
    ctx.bus.emit({ type: 'momo.changed' });
    return describeRequest(r, s);
  }
  throw conflict('Could not create a reference — try again');
}

export function describeRequest(r: typeof momoRequests.$inferSelect, s: AppSettings) {
  const account = s.momoAccounts.find((a) => a.network === r.network) ?? s.momoAccounts[0] ?? null;
  return { ...r, account };
}

/** Customer typed the transaction ID from their MoMo message. */
export async function submitTxn(ctx: Ctx, customerId: string, id: string, raw: unknown) {
  const input = z
    .object({ txnId: z.string().trim().toUpperCase().regex(/^[A-Z0-9.]{6,30}$/, 'Type the transaction ID from your MoMo message'), payerPhone: z.string().trim().max(20).nullish() })
    .parse(raw);
  const [r] = await ctx.db.select().from(momoRequests).where(and(eq(momoRequests.id, id), eq(momoRequests.customerId, customerId)));
  if (!r) throw notFound('Top-up');
  if (r.status === 'confirmed') return r;
  if (r.status === 'rejected') throw conflict('This top-up was rejected — please see the counter');
  const [used] = await ctx.db
    .select({ id: momoRequests.id })
    .from(momoRequests)
    .where(and(eq(momoRequests.txnId, input.txnId), sql`${momoRequests.id} <> ${r.id}`));
  if (used) throw conflict('That transaction ID was already used for another top-up');
  await ctx.db.update(momoRequests).set({ txnId: input.txnId, payerPhone: input.payerPhone ?? r.payerPhone }).where(eq(momoRequests.id, r.id));
  const [sms] = await ctx.db
    .select()
    .from(momoSms)
    .where(and(eq(momoSms.txnId, input.txnId), eq(momoSms.status, 'unmatched')))
    .limit(1);
  if (sms) await matchSms(ctx, sms);
  ctx.bus.emit({ type: 'momo.changed' });
  const [u] = await ctx.db.select().from(momoRequests).where(eq(momoRequests.id, r.id));
  return u;
}

// ───────────── Confirming ─────────────

/** Credits the wallet once (status guard) and marks the request confirmed. */
async function credit(ctx: Ctx, tx: DbOrTx, r: typeof momoRequests.$inferSelect, via: 'sms' | 'staff', actor: Actor, extra: { txnId?: string | null; smsId?: string | null; note?: string | null }) {
  const now = ctx.clock.now();
  const [claimed] = await tx
    .update(momoRequests)
    .set({
      status: 'confirmed',
      confirmedVia: via,
      confirmedBy: via === 'staff' ? (actor.approvedBy ?? actor.staffId) : null,
      confirmedAt: now,
      txnId: extra.txnId ?? r.txnId,
      smsId: extra.smsId ?? r.smsId,
      note: extra.note ?? r.note,
    })
    .where(and(eq(momoRequests.id, r.id), inArray(momoRequests.status, ['pending', 'expired'])))
    .returning();
  if (!claimed) throw conflict('This top-up was already handled');
  const w = await walletOperation(tx, {
    customerId: r.customerId,
    operation: 'deposit',
    amount: r.amount,
    method: 'mobile_money',
    reference: `${r.network} · ${claimed.txnId ?? r.code}`,
    note: `MoMo top-up ${r.code}${via === 'sms' ? ' (confirmed by SMS)' : ''}`,
    actor,
    at: now,
  });
  await tx.update(momoRequests).set({ paymentId: w.paymentId }).where(eq(momoRequests.id, r.id));
  await queueCustomerSms(tx, r.customerId, 'momo', { amount: r.amount }, now);
  await audit(tx, actor, 'momo.confirmed', { type: 'momo_request', id: r.id }, { amount: r.amount, code: r.code, via, txnId: claimed.txnId });
  return claimed;
}

const SYSTEM: Actor = { staffId: null };

/** "HH:MM" in the venue's time zone. */
export function localTime(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  const h = parts.find((x) => x.type === 'hour')?.value ?? '00';
  const m = parts.find((x) => x.type === 'minute')?.value ?? '00';
  return `${h}:${m}`;
}

/** True when `at` is inside from–to (local time); handles windows that cross midnight, e.g. 18:00–02:00. */
export function inAutoHours(at: Date, s: Pick<AppSettings, 'momoAutoHoursOn' | 'momoAutoFrom' | 'momoAutoTo' | 'timezone'>) {
  if (!s.momoAutoHoursOn || s.momoAutoFrom === s.momoAutoTo) return true;
  const t = localTime(at, s.timezone);
  return s.momoAutoFrom < s.momoAutoTo ? t >= s.momoAutoFrom && t < s.momoAutoTo : t >= s.momoAutoFrom || t < s.momoAutoTo;
}

/** Why a matched payment must wait for staff instead of being credited automatically (null = credit now). */
export function waitReason(amount: number, at: Date, s: AppSettings) {
  if (!s.momoAutoConfirm) return 'automatic crediting is off';
  if (s.momoAutoMax > 0 && amount >= s.momoAutoMax) return `${moneyText(s.momoAutoMax, s)} and above is checked by staff`;
  if (!inAutoHours(at, s)) return `outside automatic hours ${s.momoAutoFrom}–${s.momoAutoTo}`;
  return null;
}

async function byPayerPhone(ctx: Ctx, sms: typeof momoSms.$inferSelect) {
  const last9 = (sms.payerPhone ?? '').replace(/\D/g, '').slice(-9);
  if (last9.length < 9 || sms.amount == null) return undefined;
  const since = new Date(ctx.clock.now().getTime() - 24 * 3600_000);
  const rows = await ctx.db
    .select({ r: momoRequests })
    .from(momoRequests)
    .innerJoin(customers, eq(customers.id, momoRequests.customerId))
    .where(
      and(
        eq(momoRequests.status, 'pending'),
        eq(momoRequests.amount, sms.amount),
        sql`${momoRequests.createdAt} > ${since}`,
        sql`right(regexp_replace(coalesce(${customers.phone}, ''), '[^0-9]', '', 'g'), 9) = ${last9}`,
      ),
    )
    .limit(2);
  return rows.length === 1 ? rows[0].r : undefined;
}

/** Tries to match an unmatched SMS with a waiting request; credits when everything agrees. */
export async function matchSms(ctx: Ctx, sms: typeof momoSms.$inferSelect) {
  if (sms.status !== 'unmatched' || sms.amount == null) return null;
  const s = await getSettings(ctx.db);
  const codes = codesInSms(sms.reference, sms.body);
  const conds = [];
  if (codes.length) conds.push(inArray(momoRequests.code, codes));
  if (sms.txnId) conds.push(eq(momoRequests.txnId, sms.txnId));
  let [r]: (typeof momoRequests.$inferSelect | undefined)[] = conds.length
    ? await ctx.db
        .select()
        .from(momoRequests)
        .where(and(inArray(momoRequests.status, ['pending', 'expired']), or(...conds)))
        .orderBy(desc(momoRequests.createdAt))
        .limit(1)
    : [];
  // No code (customer forgot it): the payer's number is the customer's registered phone and exactly one waiting
  // top-up of exactly that amount exists → it's theirs.
  if (!r && sms.payerPhone) r = await byPayerPhone(ctx, sms);
  if (!r) return null;
  const now = ctx.clock.now();
  const recent = now.getTime() - r.createdAt.getTime() < 7 * 86400_000;
  if (sms.amount !== r.amount || !recent) {
    await ctx.db.update(momoSms).set({ requestId: r.id }).where(eq(momoSms.id, sms.id));
    await ctx.db
      .update(momoRequests)
      .set({ smsId: sms.id, note: sms.amount !== r.amount ? `SMS amount differs (${sms.amount} received) — check before confirming` : 'Paid late — check before confirming' })
      .where(eq(momoRequests.id, r.id));
    ctx.bus.emit({ type: 'alert', level: 'warning', message: `MoMo ${r.code}: the SMS does not match the request — check the MoMo inbox` });
    return null;
  }
  const wait = waitReason(r.amount, now, s);
  await ctx.db.update(momoSms).set({ requestId: r.id, status: wait ? 'unmatched' : 'matched' }).where(eq(momoSms.id, sms.id));
  if (wait) {
    await ctx.db.update(momoRequests).set({ smsId: sms.id, txnId: r.txnId ?? sms.txnId, note: `Payment received — waiting for staff (${wait})` }).where(eq(momoRequests.id, r.id));
    const [c] = await ctx.db.select({ fullName: customers.fullName }).from(customers).where(eq(customers.id, r.customerId));
    ctx.bus.emit({ type: 'alert', level: 'info', message: `MoMo ${moneyText(r.amount, s)} from ${c?.fullName ?? 'a customer'} (${r.code}) arrived — confirm it in the MoMo inbox (${wait})` });
    ctx.bus.emit({ type: 'momo.changed' });
    return null;
  }
  const done = await ctx.db.transaction((tx) => credit(ctx, tx, r, 'sms', SYSTEM, { txnId: sms.txnId, smsId: sms.id }));
  ctx.bus.emit({ type: 'customers.changed', customerId: r.customerId });
  ctx.bus.emit({ type: 'payments.changed' });
  ctx.bus.emit({ type: 'momo.changed' });
  return done;
}

export async function confirmByStaff(ctx: Ctx, actor: Actor, id: string, raw: unknown) {
  const input = z.object({ txnId: z.string().trim().toUpperCase().max(30).nullish(), note: z.string().trim().max(200).nullish() }).parse(raw ?? {});
  const [r] = await ctx.db.select().from(momoRequests).where(eq(momoRequests.id, id));
  if (!r) throw notFound('Top-up');
  const done = await ctx.db.transaction(async (tx) => {
    const c = await credit(ctx, tx, r, 'staff', actor, { txnId: input.txnId || null, note: input.note });
    if (r.smsId) await tx.update(momoSms).set({ status: 'matched', requestId: r.id }).where(eq(momoSms.id, r.smsId));
    return c;
  });
  ctx.bus.emit({ type: 'customers.changed', customerId: r.customerId });
  ctx.bus.emit({ type: 'payments.changed' });
  ctx.bus.emit({ type: 'momo.changed' });
  return done;
}

export async function rejectRequest(ctx: Ctx, actor: Actor, id: string, raw: unknown) {
  const input = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(200) }).parse(raw);
  const [r] = await ctx.db
    .update(momoRequests)
    .set({ status: 'rejected', note: input.reason, confirmedBy: actor.staffId, confirmedAt: ctx.clock.now() })
    .where(and(eq(momoRequests.id, id), inArray(momoRequests.status, ['pending', 'expired'])))
    .returning();
  if (!r) throw conflict('This top-up was already handled');
  await audit(ctx.db, actor, 'momo.rejected', { type: 'momo_request', id }, { reason: input.reason });
  ctx.bus.emit({ type: 'momo.changed' });
  return r;
}

/** Staff: credit an SMS nobody claimed to a customer (e.g. they forgot the reference). */
export async function assignSms(ctx: Ctx, actor: Actor, smsId: string, raw: unknown) {
  const input = z.object({ customerId: z.string().uuid() }).parse(raw);
  const [sms] = await ctx.db.select().from(momoSms).where(eq(momoSms.id, smsId));
  if (!sms) throw notFound('SMS');
  if (sms.status === 'matched') throw conflict('This SMS was already credited');
  if (!sms.amount || sms.amount <= 0) throw badRequest('No amount could be read from this SMS');
  const [c] = await ctx.db.select().from(customers).where(eq(customers.id, input.customerId));
  if (!c) throw notFound('Customer');
  const now = ctx.clock.now();
  const done = await ctx.db.transaction(async (tx) => {
    const [r] = await tx
      .insert(momoRequests)
      .values({
        customerId: c.id,
        amount: sms.amount!,
        network: 'MoMo',
        code: `S${String(randomInt(0, 100_000)).padStart(5, '0')}`,
        txnId: sms.txnId,
        payerPhone: sms.payerPhone,
        smsId: sms.id,
        expiresAt: now,
        createdAt: now,
      })
      .returning();
    const out = await credit(ctx, tx, r, 'staff', actor, { txnId: sms.txnId, smsId: sms.id, note: 'Assigned from the MoMo inbox' });
    await tx.update(momoSms).set({ status: 'matched', requestId: r.id }).where(eq(momoSms.id, sms.id));
    return out;
  });
  ctx.bus.emit({ type: 'customers.changed', customerId: c.id });
  ctx.bus.emit({ type: 'payments.changed' });
  ctx.bus.emit({ type: 'momo.changed' });
  return done;
}

export async function expireMomoRequests(ctx: Ctx) {
  const rows = await ctx.db
    .update(momoRequests)
    .set({ status: 'expired' })
    .where(and(eq(momoRequests.status, 'pending'), lt(momoRequests.expiresAt, ctx.clock.now())))
    .returning({ id: momoRequests.id });
  if (rows.length) ctx.bus.emit({ type: 'momo.changed' });
  return rows.length;
}

// ───────────── Relay (the venue's MoMo phone) ─────────────

type RelayDevice = { id: string; hash: string; device: string; createdAt: string; lastSeenAt?: string };
const RELAY_KEY = 'momo_relay';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export async function relayDevices(db: DbOrTx) {
  return (await getKv<RelayDevice[]>(db, RELAY_KEY)) ?? [];
}

export async function addRelayDevice(ctx: Ctx, device: string) {
  const token = randomBytes(24).toString('base64url');
  const list = await relayDevices(ctx.db);
  const entry: RelayDevice = { id: randomBytes(6).toString('hex'), hash: sha(token), device: device.slice(0, 60) || 'MoMo phone', createdAt: ctx.clock.now().toISOString() };
  await setKv(ctx.db, RELAY_KEY, [...list.slice(-4), entry]);
  return { token, id: entry.id };
}

export async function removeRelayDevice(ctx: Ctx, id: string) {
  await setKv(ctx.db, RELAY_KEY, (await relayDevices(ctx.db)).filter((d) => d.id !== id));
}

export async function relayAuth(ctx: Ctx, token: string | undefined) {
  if (!token) throw unauthorized('Missing relay token');
  const list = await relayDevices(ctx.db);
  const d = list.find((x) => x.hash === sha(token));
  if (!d) throw unauthorized('This MoMo phone is not paired (or was removed) — pair it again in Settings → MoMo');
  const now = ctx.clock.now();
  if (!d.lastSeenAt || now.getTime() - Date.parse(d.lastSeenAt) > 60_000) {
    d.lastSeenAt = now.toISOString();
    await setKv(ctx.db, RELAY_KEY, list);
  }
  return d;
}

/** Accepts the common SMS-forwarder field names. */
export const IncomingSmsSchema = z
  .object({
    from: z.string().optional(),
    sender: z.string().optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
    body: z.string().optional(),
    text: z.string().optional(),
    message: z.string().optional(),
    msg: z.string().optional(),
    content: z.string().optional(),
  })
  .passthrough()
  .transform((b) => ({ from: (b.from ?? b.sender ?? b.address ?? b.phone ?? '').trim(), body: (b.body ?? b.text ?? b.message ?? b.msg ?? b.content ?? '').trim() }))
  .refine((b) => b.from && b.body, 'Expected the SMS sender ("from") and text ("body")');

export async function ingestSms(ctx: Ctx, device: string, raw: unknown) {
  const input = IncomingSmsSchema.parse(raw);
  const s = await getSettings(ctx.db);
  const p = parseMomoSms(input.body);
  const trusted = trustedSender(input.from, s);
  const amount = p.amountMajor != null ? toMinor(p.amountMajor, s.currencyMinorUnits) : null;
  let status = trusted && p.incoming && amount ? 'unmatched' : 'ignored';
  if (status === 'unmatched' && p.txnId) {
    const [dupe] = await ctx.db.select({ id: momoSms.id }).from(momoSms).where(eq(momoSms.txnId, p.txnId)).limit(1);
    if (dupe) status = 'ignored';
  }
  const [row] = await ctx.db
    .insert(momoSms)
    .values({
      sender: input.from.slice(0, 40),
      body: input.body.slice(0, 1000),
      amount,
      txnId: p.txnId,
      reference: p.reference,
      payerName: p.payerName,
      payerPhone: p.payerPhone,
      status,
      device,
      receivedAt: ctx.clock.now(),
    })
    .returning();
  const matched = status === 'unmatched' ? await matchSms(ctx, row) : null;
  ctx.bus.emit({ type: 'momo.changed' });
  return {
    ok: true,
    status: matched ? 'credited' : status,
    reason: !trusted ? 'sender not trusted (add it in Settings → MoMo if it is your network)' : !p.incoming ? 'not a money-received message' : !amount ? 'no amount found' : undefined,
  };
}
