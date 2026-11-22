/**
 * Station screen apps (ZENAA Station for Windows PCs, ZENAA TV for Android TV).
 *
 * Pairing: staff press "Pair a screen" on a station → a 6-digit code (10 minutes). The app sends the code and
 * gets a long-lived token tied to that one station. Unpairing bumps the station's agentTokenVersion, which
 * invalidates every token issued for it.
 *
 * The app polls GET /api/agent/state every few seconds and shows: a small timer dock while a session runs,
 * a warning before time runs out, and a full-screen cover (or screen off) when no session is running.
 */
import { randomInt, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { and, eq, isNull, ne } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { actorOf } from '../auth/plugin.js';
import type { Ctx } from '../context.js';
import { customers, sessions, stations } from '../db/schema.js';
import { AppError, badRequest, notFound, parse, unauthorized } from '../lib/errors.js';
import { audit } from '../services/audit.js';
import { describeSession } from '../services/sessions.js';
import { getSettings } from '../services/settings.js';
import { currentWeather } from '../services/weather.js';
import { endBypass, startBypass } from '../services/bypass.js';
import { verifyPin } from '../services/pins.js';

const CONFIG_MARKER = Buffer.from('@@ZENAA_CONFIG_V1@@');
const CONFIG_BLOCK = 1024;
export type ConsolePlatform = 'ps4' | 'ps5';

/** Reads the console payload and writes the server address + station token into its config block. */
export async function patchedPayload(platform: ConsolePlatform, serverUrl: string, token: string) {
  const dir = process.env.CONSOLE_DIR ?? path.resolve(process.cwd(), 'console');
  let elf: Buffer;
  try {
    elf = await readFile(path.join(dir, `zenaa-${platform}.elf`));
  } catch {
    throw new AppError(500, `The ${platform.toUpperCase()} payload is missing from this server — run agents/console/build.ps1, then rebuild ZENAA`, 'payload_missing');
  }
  const at = elf.indexOf(CONFIG_MARKER);
  if (at < 0) throw new AppError(500, 'The console payload has no config block (wrong file)', 'payload_bad');
  const cfg = Buffer.from(`@@ZENAA_CONFIG_V1@@\nurl=${serverUrl}\ntoken=${token}\n`);
  if (cfg.length >= CONFIG_BLOCK) throw badRequest('Server address too long');
  const out = Buffer.from(elf);
  out.fill(0, at, at + CONFIG_BLOCK);
  cfg.copy(out, at);
  return out;
}

/** Sends a payload to a console's ELF loader (raw TCP: connect, write, close). */
export function sendToLoader(host: string, port: number, data: Buffer, timeoutMs = 8000) {
  return new Promise<void>((resolve, reject) => {
    const sock = net.connect({ host, port });
    let done = false;
    const fail = (msg: string) => {
      if (done) return;
      done = true;
      sock.destroy();
      reject(new AppError(502, msg, 'console_unreachable'));
    };
    sock.setTimeout(timeoutMs, () => fail(`No answer from ${host}:${port}. Is the console on, jailbroken, and is the ELF loader running on port ${port}?`));
    sock.on('error', (e: NodeJS.ErrnoException) =>
      fail(
        e.code === 'ECONNREFUSED'
          ? `${host} refused port ${port}: the ELF loader is not running. Jailbreak the console and start the ELF loader first (see Help → doc 16).`
          : `Cannot reach ${host}:${port} (${e.code ?? e.message}). Check the console IP (PS Settings → Network → Connection status).`,
      ),
    );
    sock.on('connect', () =>
      sock.end(data, () => {
        if (done) return;
        done = true;
        resolve();
      }),
    );
  });
}

const CODE_TTL_MS = 10 * 60_000;
/** A screen counts as online if it asked for its state within this time. */
export const AGENT_ONLINE_MS = 30_000;

declare module 'fastify' {
  interface FastifyRequest {
    agentStation?: typeof stations.$inferSelect;
  }
}

export async function agentRoutes(app: FastifyInstance, ctx: Ctx) {
  const codes = new Map<string, { stationId: string; expires: number }>();
  const failures = new Map<string, { count: number; until: number }>();

  const agentAuth = async (req: FastifyRequest) => {
    try {
      await req.jwtVerify();
    } catch {
      throw unauthorized('This screen is not paired — pair it again from Stations');
    }
    if (req.user.typ !== 'agent') throw unauthorized();
    const [st] = await ctx.db.select().from(stations).where(and(eq(stations.id, req.user.sub), isNull(stations.deletedAt)));
    if (!st || st.agentTokenVersion !== req.user.tv) throw unauthorized('This screen was unpaired — pair it again from Stations');
    req.agentStation = st;
  };

  /** Staff: get a pairing code for a station. */
  app.post<{ Params: { id: string } }>('/api/stations/:id/agent-code', { preHandler: app.auth('stations.manage') }, async (req) => {
    const [st] = await ctx.db.select().from(stations).where(and(eq(stations.id, req.params.id), isNull(stations.deletedAt)));
    if (!st) throw notFound('Station');
    for (const [c, v] of codes) if (v.expires < Date.now() || v.stationId === st.id) codes.delete(c);
    let code = '';
    do code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    while (codes.has(code));
    codes.set(code, { stationId: st.id, expires: Date.now() + CODE_TTL_MS });
    await audit(ctx.db, actorOf(req), 'station.agent_code', { type: 'station', id: st.id });
    return { code, expiresInSeconds: CODE_TTL_MS / 1000 };
  });

  /** Staff: unpair every screen of a station. */
  app.delete<{ Params: { id: string } }>('/api/stations/:id/agent', { preHandler: app.auth('stations.manage') }, async (req) => {
    const [st] = await ctx.db.select().from(stations).where(eq(stations.id, req.params.id));
    if (!st) throw notFound('Station');
    await ctx.db.update(stations).set({ agentTokenVersion: st.agentTokenVersion + 1, agentInfo: null, agentLastSeenAt: null }).where(eq(stations.id, st.id));
    await audit(ctx.db, actorOf(req), 'station.agent_unpair', { type: 'station', id: st.id });
    ctx.bus.emit({ type: 'stations.changed', stationId: st.id });
    return { ok: true };
  });

  /** Staff: show a message on the station screen ("5 minutes left — top up at the counter"). */
  app.post<{ Params: { id: string } }>('/api/stations/:id/agent-message', { preHandler: app.auth('sessions.operate') }, async (req) => {
    const b = parse(z.object({ text: z.string().trim().min(1).max(200) }), req.body);
    const [st] = await ctx.db
      .update(stations)
      .set({ screenMessage: { id: String(Date.now()), text: b.text, at: ctx.clock.now().toISOString() } })
      .where(eq(stations.id, req.params.id))
      .returning();
    if (!st) throw notFound('Station');
    await audit(ctx.db, actorOf(req), 'station.screen_message', { type: 'station', id: st.id }, { text: b.text });
    return { ok: true };
  });

  /** App: exchange a pairing code for a station token. */
  app.post('/api/agent/pair', async (req) => {
    const b = parse(
      z.object({
        code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code shown in ZENAA'),
        kind: z.enum(['pc', 'android_tv', 'other']).default('other'),
        name: z.string().trim().max(60).optional(),
        version: z.string().trim().max(20).optional(),
      }),
      req.body,
    );
    const f = failures.get(req.ip);
    if (f && f.count >= 8 && f.until > Date.now()) throw new AppError(429, 'Too many wrong codes. Wait 15 minutes.', 'locked');
    const entry = codes.get(b.code);
    if (!entry || entry.expires < Date.now()) {
      failures.set(req.ip, { count: (f && f.until > Date.now() ? f.count : 0) + 1, until: Date.now() + 15 * 60_000 });
      throw badRequest('That code is wrong or has expired — get a new one: Stations → ✏️ → Station screen → Pair');
    }
    codes.delete(b.code);
    failures.delete(req.ip);
    const [st] = await ctx.db.select().from(stations).where(eq(stations.id, entry.stationId));
    if (!st) throw notFound('Station');
    await ctx.db
      .update(stations)
      .set({ agentInfo: { kind: b.kind, name: b.name, version: b.version, ip: req.ip }, agentLastSeenAt: ctx.clock.now() })
      .where(eq(stations.id, st.id));
    await audit(ctx.db, { staffId: null, ip: req.ip }, 'station.agent_paired', { type: 'station', id: st.id }, { kind: b.kind, name: b.name });
    ctx.bus.emit({ type: 'stations.changed', stationId: st.id });
    const token = app.jwt.sign({ sub: st.id, tv: st.agentTokenVersion, typ: 'agent' }, { expiresIn: '3650d' });
    return { token, station: { id: st.id, code: st.code, name: st.name } };
  });

  const buildState = async (req: FastifyRequest) => {
    const st = req.agentStation!;
    const now = ctx.clock.now();
    const settings = await getSettings(ctx.db);
    const v = z.object({ v: z.string().max(20).optional(), name: z.string().max(60).optional() }).safeParse(req.query);
    const prevSeen = st.agentLastSeenAt?.getTime() ?? 0;
    // Write "last seen" at most every 10 s to keep the database quiet.
    if (now.getTime() - prevSeen > 10_000) {
      await ctx.db
        .update(stations)
        .set({ agentLastSeenAt: now, agentInfo: { ...(st.agentInfo ?? {}), ip: req.ip, ...(v.success && v.data.v ? { version: v.data.v } : {}) } })
        .where(eq(stations.id, st.id));
      if (now.getTime() - prevSeen > AGENT_ONLINE_MS) ctx.bus.emit({ type: 'stations.changed', stationId: st.id });
    }
    const [open] = await ctx.db
      .select({ s: sessions, customerName: customers.fullName })
      .from(sessions)
      .leftJoin(customers, eq(customers.id, sessions.customerId))
      .where(and(eq(sessions.stationId, st.id), ne(sessions.status, 'ended')))
      .limit(1);
    const d = open ? describeSession(open.s, now) : null;
    const warnAt = Math.max(0, ...settings.warningMinutes) * 60;
    let phase: 'idle' | 'running' | 'warning' | 'paused' | 'maintenance' | 'staff' = 'idle';
    const bypass = !open && st.bypassUntil && st.bypassUntil.getTime() > now.getTime() ? st.bypassUntil : null;
    if (bypass) phase = 'staff';
    else if (st.status === 'maintenance' || st.status === 'offline') phase = 'maintenance';
    else if (d?.status === 'paused') phase = 'paused';
    else if (d) phase = d.remainingSeconds != null && d.remainingSeconds <= warnAt ? 'warning' : 'running';
    const pauseMode = phase === 'paused' ? (open!.s.pauseMode ?? (settings.powerOffOnPause ? 'off' : 'screen')) : null;
    const lock = (phase === 'paused' && pauseMode !== 'open') || (phase === 'idle' && settings.agentLockWhenIdle);
    return {
      serverTime: now.toISOString(),
      centerName: settings.centerName,
      station: { id: st.id, code: st.code, name: st.name },
      phase,
      lock,
      /** Android TV: switch the panel off while locked (needs device-admin permission in the app). */
      screenOff: lock && settings.agentScreenOff && (phase === 'idle' || pauseMode === 'off'),
      pauseMode,
      lockTitle: phase === 'paused' ? 'Session paused' : 'Time is up',
      lockText:
        phase === 'paused'
          ? 'Your time is stopped — your session is paused. Please see the counter to continue.'
          : 'Please see the counter to play again. Thank you for playing!',
      session: d
        ? {
            status: d.status,
            billingType: d.billingType,
            elapsedSeconds: d.activeSeconds,
            remainingSeconds: d.remainingSeconds,
            playerName: open!.customerName ? open!.customerName.split(/\s+/)[0] : null,
          }
        : null,
      message: st.screenMessage,
      /** Staff unlock (no charge): unlocked until this time; the apps show "STAFF" and the time left. */
      bypass: bypass ? { until: bypass.toISOString(), remainingSeconds: Math.round((bypass.getTime() - now.getTime()) / 1000) } : null,
      /** sha256 of the staff exit PIN (empty = the app cannot be closed from the screen). */
      exitPinHash: settings.agentExitPin ? createHash('sha256').update(settings.agentExitPin).digest('hex') : '',
      /** The timer look: "island" pill at the top centre (icon · time · temperature) or the classic corner box. */
      dock: {
        style: settings.agentDockStyle,
        /** Island size, % of the full design. */
        scale: settings.agentIslandScale,
        weather: currentWeather({ enabled: settings.agentWeather, lat: settings.weatherLat, lon: settings.weatherLon }),
      },
      pollSeconds: 3,
    };
  };

  /**
   * App: a staff member typed their PIN on the screen (admin bypass).
   *  - unlock: turn the station on with no charge for `minutes` (default 30)
   *  - exit:   allowed to close the app (PC) / leave the app (TV)
   * Needs the stations.bypass permission. Wrong PINs are rate-limited per screen.
   */
  app.post('/api/agent/unlock', { preHandler: agentAuth }, async (req) => {
    const st = req.agentStation!;
    const b = parse(
      z.object({ pin: z.string().trim().min(1).max(8), action: z.enum(['unlock', 'exit', 'lock']).default('unlock'), minutes: z.number().int().min(0).max(720).default(30) }),
      req.body,
    );
    // The shared "Offline exit PIN" from Settings also works while online (recorded without a name).
    const settings = await getSettings(ctx.db);
    const shared = !!settings.agentExitPin && b.pin === String(settings.agentExitPin).trim();
    const who = shared
      ? { id: null as string | null, fullName: 'Shared exit PIN', permissions: ['stations.bypass'] as readonly string[] }
      : await verifyPin(ctx.db, b.pin, `agent:${st.id}`);
    if (!who.permissions.includes('stations.bypass')) {
      throw new AppError(403, `${who.fullName} cannot unlock screens (needs "Turn on with no charge")`, 'forbidden');
    }
    const actor = { staffId: who.id, ip: req.ip, permissions: who.permissions };
    if (b.action === 'unlock') await startBypass(ctx, actor, st.id, { minutes: b.minutes, reason: 'Unlocked on the station screen' }, 'screen');
    else if (b.action === 'lock') await endBypass(ctx, actor, st.id);
    else await audit(ctx.db, actor, 'station.agent_exit', { type: 'station', id: st.id });
    return { ok: true, name: who.fullName, action: b.action };
  });

  /** App: what to show right now. */
  app.get('/api/agent/state', { preHandler: agentAuth }, async (req) => buildState(req));

  /** Console payload (PS4/PS5): the same state as plain key=value lines — easy to read in C. */
  app.get('/api/agent/console', { preHandler: agentAuth }, async (req, reply) => {
    const s = await buildState(req);
    const clean = (v: unknown) => String(v ?? '').replace(/[\r\n]+/g, ' ').slice(0, 200);
    const w = s.dock.weather;
    const lines: Record<string, unknown> = {
      ok: 1,
      phase: s.phase,
      remaining: s.session?.remainingSeconds ?? s.bypass?.remainingSeconds ?? -1,
      elapsed: s.session?.elapsedSeconds ?? 0,
      station: s.station.code,
      player: s.session?.playerName ?? '',
      msgid: s.message?.id ?? '',
      msg: s.message?.text ?? '',
      weather: w ? `${w.tempC}°C ${w.label}` : '',
      center: s.centerName,
    };
    reply.type('text/plain; charset=utf-8');
    return Object.entries(lines).map(([k, v]) => `${k}=${clean(v)}`).join('\n') + '\n';
  });

  const ConsoleBody = z.object({
    platform: z.enum(['ps4', 'ps5']),
    /** Address of this ZENAA server as the console sees it, e.g. http://192.168.1.10:8080 */
    serverUrl: z
      .string()
      .trim()
      .regex(/^http:\/\/[^\s/]+(:\d+)?\/?$/, 'Server address must look like http://192.168.1.10:8080 (plain http, no path)')
      .refine((u) => !/^http:\/\/(localhost|127\.|\[::1\])/i.test(u), 'Use the server network address (e.g. http://192.168.1.10:8080), not localhost — the console cannot reach "localhost"'),
  });

  /** Mints a station token for a console and records it as the station's screen. */
  const consoleToken = async (stationId: string, platform: ConsolePlatform, ip: string) => {
    const [st] = await ctx.db.select().from(stations).where(and(eq(stations.id, stationId), isNull(stations.deletedAt)));
    if (!st) throw notFound('Station');
    await ctx.db
      .update(stations)
      .set({ agentInfo: { kind: platform, name: platform === 'ps5' ? 'PS5 (payload)' : 'PS4 (payload)', version: '1.0.0', ip } })
      .where(eq(stations.id, st.id));
    ctx.bus.emit({ type: 'stations.changed', stationId: st.id });
    return { st, token: app.jwt.sign({ sub: st.id, tv: st.agentTokenVersion, typ: 'agent' }, { expiresIn: '3650d' }) };
  };

  /** Staff: send the timer payload straight to a jailbroken console's ELF loader. */
  app.post<{ Params: { id: string } }>('/api/stations/:id/console-push', { preHandler: app.auth('stations.manage') }, async (req) => {
    const b = parse(
      ConsoleBody.extend({
        host: z
          .string()
          .trim()
          .regex(/^(\d{1,3}\.){3}\d{1,3}$/, 'Enter the console IP, e.g. 192.168.1.50'),
        port: z.coerce.number().int().min(1).max(65535).default(9021),
      }),
      req.body,
    );
    const { st, token } = await consoleToken(req.params.id, b.platform, b.host);
    const elf = await patchedPayload(b.platform, b.serverUrl.replace(/\/$/, ''), token);
    await sendToLoader(b.host, b.port, elf);
    await audit(ctx.db, actorOf(req), 'station.console_push', { type: 'station', id: st.id }, { platform: b.platform, host: b.host, port: b.port });
    return { ok: true, bytes: elf.length };
  });

  /** Staff: download the payload with this station's token inside (for your own payload sender). */
  app.get<{ Params: { id: string } }>('/api/stations/:id/console-payload', { preHandler: app.auth('stations.manage') }, async (req, reply) => {
    const q = parse(ConsoleBody, req.query);
    const { st, token } = await consoleToken(req.params.id, q.platform, '');
    const elf = await patchedPayload(q.platform, q.serverUrl.replace(/\/$/, ''), token);
    await audit(ctx.db, actorOf(req), 'station.console_download', { type: 'station', id: st.id }, { platform: q.platform });
    reply.header('content-type', 'application/octet-stream');
    reply.header('content-disposition', `attachment; filename="zenaa-${st.code.toLowerCase()}-${q.platform}.elf"`);
    reply.header('cache-control', 'no-store');
    return reply.send(elf);
  });
}
