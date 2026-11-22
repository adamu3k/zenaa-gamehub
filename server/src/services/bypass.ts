/**
 * Staff unlock ("Turn on — no charge"): a station is switched on and its screen unlocked for a while
 * without a session, so staff can update games, test a controller or play an event — no revenue recorded.
 */
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import type { Actor, Ctx } from '../context.js';
import { sessions, stations } from '../db/schema.js';
import { conflict, notFound } from '../lib/errors.js';
import { audit } from './audit.js';

export const BypassSchema = z.object({
  /** Minutes; 0 = until someone turns it off (capped at 12 hours). */
  minutes: z.number().int().min(0).max(720).default(30),
  reason: z.string().trim().max(200).nullish(),
});

const MAX_MS = 12 * 3600_000;
const timers = new Map<string, NodeJS.Timeout>();

export function bypassActive(st: { bypassUntil: Date | null }, now: Date) {
  return !!st.bypassUntil && st.bypassUntil.getTime() > now.getTime();
}

export async function startBypass(ctx: Ctx, actor: Actor & { approvedBy?: string | null }, stationId: string, raw: unknown, via = 'counter') {
  const input = BypassSchema.parse(raw ?? {});
  const now = ctx.clock.now();
  const [st] = await ctx.db.select().from(stations).where(eq(stations.id, stationId));
  if (!st || st.deletedAt) throw notFound('Station');
  const [open] = await ctx.db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.stationId, st.id), ne(sessions.status, 'ended')))
    .limit(1);
  if (open) throw conflict(`${st.name} has a session running — it is already on`);
  const until = new Date(now.getTime() + (input.minutes > 0 ? input.minutes * 60_000 : MAX_MS));
  const by = actor.approvedBy ?? actor.staffId;
  const [u] = await ctx.db
    .update(stations)
    .set({ bypassUntil: until, bypassBy: by, bypassReason: input.reason || null })
    .where(eq(stations.id, st.id))
    .returning();
  await audit(ctx.db, actor, 'station.bypass_on', { type: 'station', id: st.id }, { minutes: input.minutes, until, reason: input.reason, via });
  schedule(ctx, st.id, until);
  ctx.bus.emit({ type: 'stations.changed', stationId: st.id });
  return u;
}

export async function endBypass(ctx: Ctx, actor: Actor, stationId: string) {
  const [st] = await ctx.db.select().from(stations).where(eq(stations.id, stationId));
  if (!st) throw notFound('Station');
  await ctx.db.update(stations).set({ bypassUntil: null, bypassBy: null, bypassReason: null }).where(eq(stations.id, st.id));
  if (st.bypassUntil) await audit(ctx.db, actor, 'station.bypass_off', { type: 'station', id: st.id });
  clearTimeout(timers.get(st.id));
  timers.delete(st.id);
  ctx.bus.emit({ type: 'stations.changed', stationId: st.id });
  return { ok: true };
}

/** When the unlock runs out, tell everyone (power manager switches the plug off, screens lock again). */
function schedule(ctx: Ctx, stationId: string, until: Date) {
  clearTimeout(timers.get(stationId));
  const t = setTimeout(() => {
    timers.delete(stationId);
    ctx.bus.emit({ type: 'stations.changed', stationId });
  }, Math.max(0, until.getTime() - ctx.clock.now().getTime()) + 500);
  t.unref?.();
  timers.set(stationId, t);
}
