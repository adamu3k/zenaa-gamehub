/**
 * Remote view of a station's screen (VNC) inside ZENAA.
 *
 * The station PC runs a normal VNC server (TightVNC / UltraVNC; Android TV: droidVNC-NG). Browsers can't speak
 * raw TCP, so ZENAA bridges: browser (noVNC, WebSocket) ⇄ ZENAA server ⇄ station:5900 (TCP).
 *
 * Safety: only staff with `stations.remote` get a ticket; a ticket is single-use, valid 60 s, and only opens the
 * host/port saved on that one station — the bridge can never be pointed anywhere else.
 */
import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Ctx } from '../context.js';
import { stations } from '../db/schema.js';
import { badRequest, notFound } from '../lib/errors.js';
import { audit } from './audit.js';
import type { Actor } from '../context.js';

type Ticket = { host: string; port: number; stationId: string; staffId: string | null; expires: number };
const tickets = new Map<string, Ticket>();
const TICKET_MS = 60_000;

/** Where to connect: the saved VNC address, else the IP the station's screen app last reported. */
export function vncTarget(st: typeof stations.$inferSelect) {
  const host = (st.vncConfig?.host || st.agentInfo?.ip || '').replace(/^::ffff:/, '').trim();
  return { host, port: st.vncConfig?.port || 5900 };
}

export async function createVncTicket(ctx: Ctx, actor: Actor, stationId: string) {
  const [st] = await ctx.db.select().from(stations).where(eq(stations.id, stationId));
  if (!st) throw notFound('Station');
  const { host, port } = vncTarget(st);
  if (!host) throw badRequest('No VNC address for this station yet: edit the station → Remote view (VNC) → computer address');
  if (/^(127\.|0\.|localhost$)/i.test(host)) throw badRequest('Use the station computer’s network address (e.g. 192.168.1.21), not this server');
  const now = Date.now();
  for (const [k, t] of tickets) if (t.expires < now) tickets.delete(k);
  const ticket = randomBytes(18).toString('base64url');
  tickets.set(ticket, { host, port, stationId: st.id, staffId: actor.staffId, expires: now + TICKET_MS });
  await audit(ctx.db, actor, 'station.remote_view', { type: 'station', id: st.id }, { host, port });
  return { ticket, path: `/api/vnc/${ticket}`, name: `${st.code} · ${st.name}`, host, port, password: st.vncConfig?.password ?? '' };
}

/** Tests only: a ticket to any address (the real route refuses this server's own addresses). */
export function addTicketForTest(host: string, port: number) {
  const ticket = randomBytes(18).toString('base64url');
  tickets.set(ticket, { host, port, stationId: 'test', staffId: null, expires: Date.now() + TICKET_MS });
  return ticket;
}

/** Takes a ticket (once). Exported for tests. */
export function useTicket(ticket: string) {
  const t = tickets.get(ticket);
  tickets.delete(ticket);
  return t && t.expires >= Date.now() ? t : null;
}

/** Bridges WebSocket upgrades on /api/vnc/<ticket> to the station's VNC server. */
export function attachVncBridge(app: FastifyInstance) {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  app.server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const m = /^\/api\/vnc\/([A-Za-z0-9_-]{10,64})(?:\?.*)?$/.exec(req.url ?? '');
    if (!m) return; // socket.io and others handle their own paths
    const t = useTicket(m[1]);
    if (!t) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => bridge(ws, t, app));
  });
  app.addHook('onClose', async () => {
    for (const c of wss.clients) c.terminate();
    wss.close();
  });
}

function bridge(ws: WebSocket, t: Ticket, app: FastifyInstance) {
  const tcp = net.connect({ host: t.host, port: t.port });
  tcp.setNoDelay(true);
  tcp.setTimeout(10_000, () => tcp.destroy(new Error('timeout')));
  tcp.once('connect', () => tcp.setTimeout(0));
  tcp.on('data', (d) => {
    if (ws.readyState === ws.OPEN) ws.send(d);
  });
  ws.on('message', (d: Buffer) => tcp.write(d));
  const close = (why?: Error) => {
    if (why) app.log.warn({ host: t.host, port: t.port, err: why.message }, 'vnc bridge closed');
    tcp.destroy();
    if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close(1000);
  };
  tcp.on('error', close);
  tcp.on('close', () => close());
  ws.on('close', () => tcp.destroy());
  ws.on('error', () => tcp.destroy());
}
