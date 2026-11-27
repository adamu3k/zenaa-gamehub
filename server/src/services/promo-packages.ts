/**
 * Play packages (Promotions → Play packages): "spend GHS 100 this week → GHS 10 bonus", "play 5 hours this month →
 * 1 free hour". Checked after a customer pays for play or finishes a session. The bonus is paid at most once per
 * customer per day / week / month (or once while the package runs), and the counter PC speaker calls the customer's
 * name: "Kofi, your promo bonus has been added. Thank you!".
 */
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Actor, Ctx } from '../context.js';
import type { DbOrTx } from '../db/index.js';
import { customers, payments, promoPackageAwards, promoPackages, sessions } from '../db/schema.js';
import { badRequest, notFound, parse } from '../lib/errors.js';
import { audit } from './audit.js';
import { notifyLater } from './push.js';
import { getSettings } from './settings.js';
import { postTime } from './time-bank.js';
import { postWallet } from './wallet.js';

export type PackageRow = typeof promoPackages.$inferSelect;

export const DEFAULT_PACKAGE_MESSAGE = '{name}, your promo bonus has been added. Thank you!';

export const PackageBody = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(200).nullish(),
  goal: z.enum(['spend', 'time']),
  /** Minor units for spend, minutes for time. */
  target: z.number().int().min(1).max(2_000_000_000),
  period: z.enum(['day', 'week', 'month', 'once']),
  bonusAmount: z.number().int().min(0).max(100_000_000).default(0),
  bonusMinutes: z.number().int().min(0).max(100_000).default(0),
  validFrom: z.coerce.date().nullish(),
  validTo: z.coerce.date().nullish(),
  announce: z.boolean().default(true),
  message: z.string().trim().max(200).nullish(),
  showInPortal: z.boolean().default(true),
  active: z.boolean().default(true),
});

export function checkPackageShape(p: { bonusAmount?: number; bonusMinutes?: number; validFrom?: Date | null; validTo?: Date | null }) {
  if (!p.bonusAmount && !p.bonusMinutes) throw badRequest('Give a bonus amount or free minutes (or both)');
  if (p.validFrom && p.validTo && p.validTo <= p.validFrom) throw badRequest('The end date must be after the start date');
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Start of the current day / week (Monday) / month in local time, and a key naming that period. */
export function periodOf(period: PackageRow['period'], now: Date): { start: Date; key: string } {
  if (period === 'once') return { start: new Date(0), key: 'once' };
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'day') return { start: d, key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` };
  if (period === 'month') return { start: new Date(now.getFullYear(), now.getMonth(), 1), key: `${now.getFullYear()}-${pad(now.getMonth() + 1)}` };
  const back = (d.getDay() + 6) % 7; // days since Monday
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back);
  return { start: monday, key: `week-${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}` };
}

export function isLive(p: PackageRow, now: Date) {
  return p.active && !p.deletedAt && (!p.validFrom || p.validFrom <= now) && (!p.validTo || now < p.validTo);
}

/** Only play counted since the package started (old history never pays out). */
function windowStart(p: PackageRow, now: Date) {
  const times = [periodOf(p.period, now).start.getTime(), p.createdAt.getTime()];
  if (p.validFrom) times.push(p.validFrom.getTime());
  return new Date(Math.max(...times));
}

/** Money paid for play (sessions, extra time, saved time) and minutes played, since `from`. */
async function progressSince(db: DbOrTx, customerId: string, from: Date) {
  const [paid] = await db
    .select({ n: sql<number>`coalesce(sum(${payments.amount}), 0)`.mapWith(Number) })
    .from(payments)
    .where(and(eq(payments.customerId, customerId), inArray(payments.kind, ['session', 'extension']), gte(payments.createdAt, from)));
  const [played] = await db
    .select({ n: sql<number>`coalesce(sum(${sessions.accumulatedSeconds}), 0)`.mapWith(Number) })
    .from(sessions)
    .where(and(eq(sessions.customerId, customerId), eq(sessions.status, 'ended'), gte(sessions.endedAt, from)));
  return { spent: paid?.n ?? 0, minutes: Math.floor((played?.n ?? 0) / 60) };
}

const progressValue = (p: PackageRow, pr: { spent: number; minutes: number }) => (p.goal === 'spend' ? pr.spent : pr.minutes);

/** First name to call out ("Kofi Mensah" → "Kofi"); the gamer tag when there is no name. */
export function spokenName(c: { fullName: string; gamertag?: string | null }) {
  const first = c.fullName.trim().split(/\s+/)[0];
  return first || c.gamertag || 'Player';
}

/**
 * Pays every package the customer has just reached. Safe to call often: each package pays at most once per period.
 * Never throws (a failed bonus must not break the payment or session that triggered it).
 */
export async function checkPackages(ctx: Ctx, customerId: string | null | undefined, actor: Actor = { staffId: null }) {
  if (!customerId) return [];
  try {
    const now = ctx.clock.now();
    const live = (await ctx.db.select().from(promoPackages).where(and(eq(promoPackages.active, true), isNull(promoPackages.deletedAt)))).filter((p) => isLive(p, now));
    if (!live.length) return [];
    const paid: PackageRow[] = [];
    for (const p of live) {
      const { key } = periodOf(p.period, now);
      const [already] = await ctx.db
        .select({ id: promoPackageAwards.id })
        .from(promoPackageAwards)
        .where(and(eq(promoPackageAwards.packageId, p.id), eq(promoPackageAwards.customerId, customerId), eq(promoPackageAwards.periodKey, key)));
      if (already) continue;
      if (progressValue(p, await progressSince(ctx.db, customerId, windowStart(p, now))) < p.target) continue;
      const ok = await ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(promoPackageAwards)
          .values({ packageId: p.id, customerId, periodKey: key, bonusAmount: p.bonusAmount, bonusMinutes: p.bonusMinutes, createdAt: now })
          .onConflictDoNothing()
          .returning();
        if (!row) return false; // paid by a parallel check
        const note = `Play package: ${p.name}`;
        if (p.bonusAmount > 0) await postWallet(tx, { customerId, type: 'bonus', amount: p.bonusAmount, actor, note, at: now });
        if (p.bonusMinutes > 0) await postTime(tx, { customerId, seconds: p.bonusMinutes * 60, kind: 'adjust', actor, at: now, note });
        await audit(tx, actor, 'package.paid', { type: 'customer', id: customerId }, { package: p.name, amount: p.bonusAmount, minutes: p.bonusMinutes });
        return true;
      });
      if (ok) paid.push(p);
    }
    if (paid.length) await announcePaid(ctx, customerId, paid);
    return paid;
  } catch (err) {
    console.error('play package check failed', err);
    return [];
  }
}

async function announcePaid(ctx: Ctx, customerId: string, paid: PackageRow[]) {
  const [c] = await ctx.db.select({ fullName: customers.fullName, gamertag: customers.gamertag }).from(customers).where(eq(customers.id, customerId));
  const s = await getSettings(ctx.db);
  const name = c ? spokenName(c) : 'Player';
  ctx.bus.emit({ type: 'customers.changed', customerId });
  for (const p of paid) {
    const call = s.announceNames === false ? 'Player' : name;
    const speak = (p.message?.trim() || DEFAULT_PACKAGE_MESSAGE).replaceAll('{name}', call).replaceAll('{package}', p.name);
    ctx.bus.emit({
      type: 'alert',
      level: 'info',
      message: `🎁 ${c?.fullName ?? 'Customer'} reached "${p.name}" — bonus added`,
      ...(p.announce ? { sound: 'promo' as const, speak } : {}),
    });
    notifyLater(ctx, customerId, { title: '🎁 Promo bonus added', body: `You reached "${p.name}". Your bonus is in your account. Thank you!`, url: '/portal/rewards', tag: `package-${p.id}` });
  }
}

// ───── Staff ─────

export async function listPackages(ctx: Ctx) {
  const rows = await ctx.db.select().from(promoPackages).where(isNull(promoPackages.deletedAt)).orderBy(desc(promoPackages.active), desc(promoPackages.createdAt));
  const counts = await ctx.db
    .select({ id: promoPackageAwards.packageId, n: sql<number>`count(*)`.mapWith(Number) })
    .from(promoPackageAwards)
    .groupBy(promoPackageAwards.packageId);
  const byId = new Map(counts.map((c) => [c.id, c.n]));
  return rows.map((p) => ({ ...p, awarded: byId.get(p.id) ?? 0 }));
}

export async function createPackage(ctx: Ctx, actor: Actor, raw: unknown) {
  const b = parse(PackageBody, raw);
  checkPackageShape(b);
  const [p] = await ctx.db.insert(promoPackages).values({ ...b, createdAt: ctx.clock.now() }).returning();
  await audit(ctx.db, actor, 'package.create', { type: 'promo_package', id: p.id }, { name: p.name });
  return p;
}

export async function updatePackage(ctx: Ctx, actor: Actor, id: string, raw: unknown) {
  const b = parse(PackageBody.partial(), raw);
  const [cur] = await ctx.db.select().from(promoPackages).where(and(eq(promoPackages.id, id), isNull(promoPackages.deletedAt)));
  if (!cur) throw notFound('Package');
  checkPackageShape({ ...cur, ...b });
  const [p] = await ctx.db.update(promoPackages).set(b).where(eq(promoPackages.id, id)).returning();
  await audit(ctx.db, actor, 'package.update', { type: 'promo_package', id }, { name: p.name });
  return p;
}

/** Kept (hidden) so the history of paid bonuses stays readable. */
export async function deletePackage(ctx: Ctx, actor: Actor, id: string) {
  const [p] = await ctx.db.update(promoPackages).set({ deletedAt: ctx.clock.now(), active: false }).where(eq(promoPackages.id, id)).returning();
  if (!p) throw notFound('Package');
  await audit(ctx.db, actor, 'package.delete', { type: 'promo_package', id }, { name: p.name });
  return { ok: true };
}

// ───── Customer app ─────

/** Live packages with the customer's progress this period. */
export async function customerPackages(ctx: Ctx, customerId: string) {
  const now = ctx.clock.now();
  const live = (await ctx.db.select().from(promoPackages).where(and(eq(promoPackages.showInPortal, true), isNull(promoPackages.deletedAt)))).filter((p) => isLive(p, now));
  const out = [];
  for (const p of live) {
    const { key } = periodOf(p.period, now);
    const [done] = await ctx.db
      .select({ id: promoPackageAwards.id })
      .from(promoPackageAwards)
      .where(and(eq(promoPackageAwards.packageId, p.id), eq(promoPackageAwards.customerId, customerId), eq(promoPackageAwards.periodKey, key)));
    const progress = progressValue(p, await progressSince(ctx.db, customerId, windowStart(p, now)));
    out.push({
      id: p.id,
      name: p.name,
      description: p.description,
      goal: p.goal,
      target: p.target,
      period: p.period,
      bonusAmount: p.bonusAmount,
      bonusMinutes: p.bonusMinutes,
      validTo: p.validTo,
      progress: Math.min(progress, p.target),
      earned: !!done,
    });
  }
  return out;
}
