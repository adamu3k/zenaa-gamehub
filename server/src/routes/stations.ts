import { and, asc, eq, gt, inArray, isNull, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorOf } from '../auth/plugin.js';
import type { Ctx } from '../context.js';
import { bookings, customers, matches, sessions, staff, stationCategories, stations } from '../db/schema.js';
import { endBypass, startBypass } from '../services/bypass.js';
import { pinGate } from '../services/pins.js';
import { conflict, notFound, parse } from '../lib/errors.js';
import { audit } from '../services/audit.js';
import { upcomingByStation } from '../services/bookings.js';
import { PowerConfigSchema, POWER_DRIVERS, validatePowerConfig } from '../services/power.js';
import type { PowerConfig } from '../db/schema.js';
import { describeSession } from '../services/sessions.js';
import { createVncTicket } from '../services/vnc.js';
import { formatCustomerCode } from '../services/wallet.js';

const Platform = z.enum(['ps5', 'ps4', 'xbox_series', 'xbox_one', 'nintendo_switch', 'pc', 'vr', 'racing_sim', 'other']);
const StationBody = z.object({
  code: z.string().trim().min(1).max(16),
  name: z.string().trim().min(1).max(60),
  platform: Platform,
  categoryId: z.string().uuid().nullable().optional(),
  status: z.enum(['active', 'maintenance', 'offline', 'archived']).optional(),
  hourlyRateOverride: z.number().int().min(0).nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
  sortOrder: z.number().int().optional(),
  powerDriver: z.enum(POWER_DRIVERS).optional(),
  powerConfig: PowerConfigSchema.nullish(),
  room: z.string().trim().max(40).nullish().transform((v) => v || null),
  vncConfig: z
    .object({
      host: z.string().trim().max(120).regex(/^[A-Za-z0-9.:_-]*$/, 'Type an IP address or computer name, e.g. 192.168.1.21').optional(),
      port: z.number().int().min(1).max(65535).optional(),
      password: z.string().max(64).optional(),
    })
    .nullish(),
});

/** Plug settings that are secrets: never sent to browsers, kept when a form leaves them blank. */
export const POWER_SECRETS = ['password', 'deviceKey', 'token', 'authHeader'] as const;

/** Never send plug passwords, keys or tokens to browsers. */
export function publicStation<T extends { powerConfig: any; vncConfig?: { host?: string; port?: number; password?: string } | null }>(st: T) {
  const vc = st.vncConfig;
  const vncConfig = vc ? { host: vc.host ?? '', port: vc.port ?? 5900, hasPassword: !!vc.password } : null;
  st = { ...st, vncConfig } as T;
  const pc = st.powerConfig;
  if (!pc) return { ...st, powerConfig: null };
  const out: Record<string, unknown> = { ...pc };
  for (const k of POWER_SECRETS) {
    out[`has${k[0].toUpperCase()}${k.slice(1)}`] = !!pc[k];
    delete out[k];
  }
  return { ...st, powerConfig: out };
}

/** Fills blank secrets in an edited plug config from the stored one. */
export function keepSecrets(next: PowerConfig | null | undefined, stored: PowerConfig | null | undefined) {
  if (!next || !stored) return next;
  for (const k of POWER_SECRETS) if (!next[k] && stored[k]) next[k] = stored[k];
  return next;
}

/** Masks secrets for the audit trail. */
const auditConfig = (pc: PowerConfig | null | undefined) =>
  pc ? Object.fromEntries(Object.entries(pc).map(([k, v]) => [k, (POWER_SECRETS as readonly string[]).includes(k) && v ? '***' : v])) : pc;

/** Stations with their open session (if any) and derived live status. */
export async function listStationsLive(ctx: Ctx) {
  const now = ctx.clock.now();
  const rows = await ctx.db
    .select()
    .from(stations)
    .where(ne(stations.status, 'archived'))
    .orderBy(asc(stations.sortOrder), asc(stations.code));
  const open = await ctx.db
    .select({ s: sessions, customerName: customers.fullName, customerNumber: customers.number })
    .from(sessions)
    .leftJoin(customers, eq(customers.id, sessions.customerId))
    .where(ne(sessions.status, 'ended'));
  const byStation = new Map(open.map((o) => [o.s.stationId, o]));
  const upcoming = await upcomingByStation(ctx.db, now);
  const staffNames = new Map((await ctx.db.select({ id: staff.id, n: staff.fullName }).from(staff)).map((r) => [r.id, r.n]));
  return rows.map((st) => {
    const o = byStation.get(st.id);
    const session = o
      ? {
          ...describeSession(o.s, now),
          customerName: o.customerName,
          customerCode: o.customerNumber != null ? formatCustomerCode(o.customerNumber) : null,
        }
      : null;
    const bypass = !session && st.bypassUntil && st.bypassUntil.getTime() > now.getTime();
    const liveStatus =
      st.status !== 'active' ? st.status : session ? (session.status === 'paused' ? 'paused' : 'in_use') : bypass ? 'staff_use' : 'available';
    const b = upcoming.get(st.id);
    const nextBooking = b ? { id: b.id, number: b.number, name: b.name, startAt: b.startAt, endAt: b.endAt, status: b.status, customerId: b.customerId } : null;
    const agentOnline = !!st.agentLastSeenAt && now.getTime() - st.agentLastSeenAt.getTime() < 30_000;
    return {
      ...publicStation(st),
      bypassUntil: bypass ? st.bypassUntil : null,
      bypassByName: bypass && st.bypassBy ? (staffNames.get(st.bypassBy) ?? null) : null,
      liveStatus,
      session,
      nextBooking,
      agentOnline,
    };
  });
}

export async function stationRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/api/stations', { preHandler: app.auth('stations.view') }, async () => ({
    serverTime: ctx.clock.now().toISOString(),
    stations: await listStationsLive(ctx),
  }));

  app.post('/api/stations', { preHandler: app.auth('stations.manage') }, async (req) => {
    const body = parse(StationBody, req.body);
    if (body.powerConfig && body.powerDriver && body.powerDriver !== 'none') await validatePowerConfig(ctx, body.powerDriver, body.powerConfig);
    const [s] = await ctx.db.insert(stations).values({ ...body, powerConfig: body.powerConfig ?? null, code: body.code.toUpperCase() }).returning();
    await audit(ctx.db, actorOf(req), 'station.create', { type: 'station', id: s.id }, { code: s.code });
    ctx.bus.emit({ type: 'stations.changed', stationId: s.id });
    return publicStation(s);
  });

  app.patch<{ Params: { id: string } }>('/api/stations/:id', { preHandler: app.auth('stations.manage') }, async (req) => {
    const body = parse(StationBody.partial(), req.body);
    const [cur] = await ctx.db.select().from(stations).where(eq(stations.id, req.params.id));
    if (!cur) throw notFound('Station');
    if (body.status && body.status !== 'active' && body.status !== cur.status) {
      const [active] = await ctx.db
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(eq(sessions.stationId, cur.id), ne(sessions.status, 'ended')))
        .limit(1);
      if (active) throw conflict('End the active session before changing this station’s status');
    }
    // A blank password / key / token in the form keeps the stored one.
    keepSecrets(body.powerConfig, cur.powerConfig);
    // A blank VNC password keeps the stored one.
    if (body.vncConfig && !body.vncConfig.password && cur.vncConfig?.password) body.vncConfig.password = cur.vncConfig.password;
    if (body.powerDriver === 'none') body.powerConfig = null;
    if (body.powerConfig) await validatePowerConfig(ctx, body.powerDriver ?? cur.powerDriver, body.powerConfig);
    const [s] = await ctx.db
      .update(stations)
      .set({ ...body, code: body.code?.toUpperCase(), updatedAt: ctx.clock.now() })
      .where(eq(stations.id, cur.id))
      .returning();
    await audit(ctx.db, actorOf(req), 'station.update', { type: 'station', id: s.id }, {
      ...body,
      powerConfig: auditConfig(body.powerConfig),
      vncConfig: body.vncConfig ? { ...body.vncConfig, password: body.vncConfig.password ? '***' : undefined } : body.vncConfig,
    });
    ctx.bus.emit({ type: 'stations.changed', stationId: s.id });
    return publicStation(s);
  });

  /**
   * Delete a station. One that was never used is removed completely; one with sessions or bookings in its
   * history is hidden everywhere (its code is freed for reuse) so past bills and reports stay correct.
   */
  app.delete<{ Params: { id: string } }>('/api/stations/:id', { preHandler: app.auth('stations.manage') }, async (req) => {
    const [cur] = await ctx.db.select().from(stations).where(and(eq(stations.id, req.params.id), isNull(stations.deletedAt)));
    if (!cur) throw notFound('Station');
    const [open] = await ctx.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.stationId, cur.id), ne(sessions.status, 'ended')))
      .limit(1);
    if (open) throw conflict('End the session on this station before deleting it');
    const [upcoming] = await ctx.db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.stationId, cur.id), inArray(bookings.status, ['pending', 'confirmed']), gt(bookings.endAt, ctx.clock.now())))
      .limit(1);
    if (upcoming) throw conflict('This station has upcoming bookings — cancel or move them first (Bookings page)');
    const used =
      (await ctx.db.select({ id: sessions.id }).from(sessions).where(eq(sessions.stationId, cur.id)).limit(1)).length > 0 ||
      (await ctx.db.select({ id: bookings.id }).from(bookings).where(eq(bookings.stationId, cur.id)).limit(1)).length > 0 ||
      (await ctx.db.select({ id: matches.id }).from(matches).where(eq(matches.stationId, cur.id)).limit(1)).length > 0;
    if (used) {
      const now = ctx.clock.now();
      await ctx.db
        .update(stations)
        .set({
          status: 'archived',
          deletedAt: now,
          code: `${cur.code}~DEL${now.getTime().toString(36).toUpperCase()}`.slice(0, 40),
          powerDriver: 'none',
          powerConfig: null,
          agentTokenVersion: cur.agentTokenVersion + 1,
          updatedAt: now,
        })
        .where(eq(stations.id, cur.id));
    } else {
      await ctx.db.delete(stations).where(eq(stations.id, cur.id));
    }
    await audit(ctx.db, actorOf(req), 'station.delete', { type: 'station', id: cur.id }, { code: cur.code, name: cur.name, kept: used });
    ctx.bus.emit({ type: 'stations.changed', stationId: cur.id });
    return { ok: true, removed: used ? 'hidden' : 'deleted' };
  });

  /** Turn on with no charge (staff unlock): plug on + screen unlocked, no session, no revenue. */
  app.post<{ Params: { id: string } }>('/api/stations/:id/bypass', { preHandler: app.auth() }, async (req) => {
    const actor = await pinGate(ctx, req, 'bypass', 'stations.bypass');
    return publicStation(await startBypass(ctx, actor, req.params.id, req.body));
  });
  app.delete<{ Params: { id: string } }>('/api/stations/:id/bypass', { preHandler: app.auth('sessions.operate') }, async (req) =>
    endBypass(ctx, actorOf(req), req.params.id),
  );

  /** Archived (hidden) stations, for restoring them. */
  /** Remote view: a one-time ticket for the VNC bridge (see services/vnc.ts). */
  app.post<{ Params: { id: string } }>('/api/stations/:id/vnc', { preHandler: app.auth('stations.remote') }, async (req) =>
    createVncTicket(ctx, actorOf(req), req.params.id),
  );

  app.get('/api/stations/archived', { preHandler: app.auth('stations.manage') }, async () =>
    (
      await ctx.db
        .select()
        .from(stations)
        .where(and(eq(stations.status, 'archived'), isNull(stations.deletedAt)))
        .orderBy(asc(stations.code))
    ).map(publicStation),
  );

  app.get('/api/station-categories', { preHandler: app.auth('stations.view') }, async () =>
    ctx.db.select().from(stationCategories).orderBy(asc(stationCategories.name)),
  );

  app.post('/api/station-categories', { preHandler: app.auth('stations.manage') }, async (req) => {
    const body = parse(z.object({ name: z.string().trim().min(1).max(40), description: z.string().max(200).nullish() }), req.body);
    const [c] = await ctx.db.insert(stationCategories).values(body).returning();
    await audit(ctx.db, actorOf(req), 'station_category.create', { type: 'station_category', id: c.id }, body);
    return c;
  });

  app.patch<{ Params: { id: string } }>('/api/station-categories/:id', { preHandler: app.auth('stations.manage') }, async (req) => {
    const body = parse(z.object({ name: z.string().trim().min(1).max(40).optional(), description: z.string().max(200).nullish() }), req.body);
    const [c] = await ctx.db.update(stationCategories).set(body).where(eq(stationCategories.id, req.params.id)).returning();
    if (!c) throw notFound('Category');
    await audit(ctx.db, actorOf(req), 'station_category.update', { type: 'station_category', id: c.id }, body);
    return c;
  });
}
