import { randomInt } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { actorOf } from '../auth/plugin.js';
import type { Ctx } from '../context.js';
import { customers, momoRequests, momoSms } from '../db/schema.js';
import { AppError, badRequest, notFound, parse } from '../lib/errors.js';
import { audit } from '../services/audit.js';
import {
  addRelayDevice,
  assignSms,
  confirmByStaff,
  createMomoRequest,
  describeRequest,
  ingestSms,
  rejectRequest,
  relayAuth,
  relayDevices,
  removeRelayDevice,
  submitTxn,
} from '../services/momo.js';
import { pinGate } from '../services/pins.js';
import { listOutbox, queueTestSms, relayReportOutbox, relayTakeOutbox, retryOutbox } from '../services/sms.js';
import { getSettings } from '../services/settings.js';
import { formatCustomerCode } from '../services/wallet.js';

const PAIR_TTL_MS = 10 * 60_000;

export async function momoRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: app.customerAuth() };

  // ───── Customer portal ─────
  app.get('/api/portal/momo', auth, async (req) => {
    const s = await getSettings(ctx.db);
    const rows = await ctx.db
      .select()
      .from(momoRequests)
      .where(eq(momoRequests.customerId, req.customer!.id))
      .orderBy(desc(momoRequests.createdAt))
      .limit(10);
    return {
      enabled: s.momoTopupEnabled && s.momoAccounts.length > 0,
      accounts: s.momoAccounts,
      min: s.momoMinTopup,
      max: s.momoMaxTopup,
      requests: rows.map((r) => describeRequest(r, s)),
    };
  });
  app.post('/api/portal/momo', auth, async (req) => createMomoRequest(ctx, req.customer!.id, req.body));
  app.get<{ Params: { id: string } }>('/api/portal/momo/:id', auth, async (req) => {
    const [r] = await ctx.db
      .select()
      .from(momoRequests)
      .where(and(eq(momoRequests.id, req.params.id), eq(momoRequests.customerId, req.customer!.id)));
    if (!r) throw notFound('Top-up');
    const [c] = await ctx.db.select({ balance: customers.balance }).from(customers).where(eq(customers.id, r.customerId));
    return { ...describeRequest(r, await getSettings(ctx.db)), balance: c?.balance ?? 0 };
  });
  app.post<{ Params: { id: string } }>('/api/portal/momo/:id/txn', auth, async (req) => submitTxn(ctx, req.customer!.id, req.params.id, req.body));
  app.post<{ Params: { id: string } }>('/api/portal/momo/:id/cancel', auth, async (req) => {
    const [r] = await ctx.db
      .update(momoRequests)
      .set({ status: 'rejected', note: 'Cancelled by the customer' })
      .where(and(eq(momoRequests.id, req.params.id), eq(momoRequests.customerId, req.customer!.id), eq(momoRequests.status, 'pending')))
      .returning();
    if (!r) throw badRequest('This top-up can no longer be cancelled');
    ctx.bus.emit({ type: 'momo.changed' });
    return r;
  });

  // ───── Staff: MoMo inbox ─────
  const inbox = { preHandler: app.auth('momo.confirm') };
  app.get('/api/momo/requests', inbox, async (req) => {
    const q = parse(z.object({ status: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
    const statuses = (q.status?.split(',').filter(Boolean) ?? []) as ('pending' | 'confirmed' | 'rejected' | 'expired')[];
    const rows = await ctx.db
      .select({ r: momoRequests, name: customers.fullName, number: customers.number, phone: customers.phone })
      .from(momoRequests)
      .innerJoin(customers, eq(customers.id, momoRequests.customerId))
      .where(statuses.length ? inArray(momoRequests.status, statuses) : undefined)
      .orderBy(desc(momoRequests.createdAt))
      .limit(q.limit);
    const smsIds = rows.map((r) => r.r.smsId).filter((x): x is string => !!x);
    const sms = smsIds.length ? await ctx.db.select().from(momoSms).where(inArray(momoSms.id, smsIds)) : [];
    return rows.map((r) => ({
      ...r.r,
      customerName: r.name,
      customerCode: formatCustomerCode(r.number),
      customerPhone: r.phone,
      sms: sms.find((x) => x.id === r.r.smsId) ?? null,
    }));
  });
  app.get('/api/momo/sms', inbox, async (req) => {
    const q = parse(z.object({ status: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
    const statuses = q.status?.split(',').filter(Boolean) ?? [];
    return ctx.db
      .select()
      .from(momoSms)
      .where(statuses.length ? inArray(momoSms.status, statuses) : undefined)
      .orderBy(desc(momoSms.receivedAt))
      .limit(q.limit);
  });
  app.post<{ Params: { id: string } }>('/api/momo/requests/:id/confirm', { preHandler: app.auth() }, async (req) =>
    confirmByStaff(ctx, await pinGate(ctx, req, 'momo_confirm', 'momo.confirm'), req.params.id, req.body),
  );
  app.post<{ Params: { id: string } }>('/api/momo/requests/:id/reject', inbox, async (req) => rejectRequest(ctx, actorOf(req), req.params.id, req.body));
  app.post<{ Params: { id: string } }>('/api/momo/sms/:id/assign', { preHandler: app.auth() }, async (req) =>
    assignSms(ctx, await pinGate(ctx, req, 'momo_confirm', 'momo.confirm'), req.params.id, req.body),
  );
  app.post<{ Params: { id: string } }>('/api/momo/sms/:id/ignore', inbox, async (req) => {
    const [r] = await ctx.db.update(momoSms).set({ status: 'ignored' }).where(and(eq(momoSms.id, req.params.id), eq(momoSms.status, 'unmatched'))).returning();
    if (!r) throw badRequest('Only unmatched messages can be ignored');
    await audit(ctx.db, actorOf(req), 'momo.sms_ignored', { type: 'momo_sms', id: r.id });
    ctx.bus.emit({ type: 'momo.changed' });
    return r;
  });

  // ───── Relay phone pairing ─────
  const codes = new Map<string, number>();
  const failures = new Map<string, { count: number; until: number }>();
  const admin = { preHandler: app.auth('settings.manage') };
  app.get('/api/momo/relay', admin, async () =>
    (await relayDevices(ctx.db)).map((d) => ({ id: d.id, device: d.device, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt ?? null })),
  );
  app.post('/api/momo/relay/code', admin, async (req) => {
    for (const [c, exp] of codes) if (exp < Date.now()) codes.delete(c);
    let code = '';
    do code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    while (codes.has(code));
    codes.set(code, Date.now() + PAIR_TTL_MS);
    await audit(ctx.db, actorOf(req), 'momo.relay_code');
    return { code, expiresInSeconds: PAIR_TTL_MS / 1000 };
  });
  /** For third-party SMS-forwarder apps: a webhook link with a token (shown once). */
  app.post('/api/momo/relay/link', admin, async (req) => {
    const b = parse(z.object({ device: z.string().trim().max(60).default('SMS forwarder') }), req.body ?? {});
    const { token, id } = await addRelayDevice(ctx, b.device);
    await audit(ctx.db, actorOf(req), 'momo.relay_link', undefined, { id, device: b.device });
    return { id, token, path: `/api/momo/sms?token=${token}` };
  });
  app.delete<{ Params: { id: string } }>('/api/momo/relay/:id', admin, async (req) => {
    await removeRelayDevice(ctx, req.params.id);
    await audit(ctx.db, actorOf(req), 'momo.relay_removed', undefined, { id: req.params.id });
    return { ok: true };
  });
  /** ZENAA MoMo Relay app: exchange the 6-digit code for a token. */
  app.post('/api/momo/relay/pair', async (req) => {
    const b = parse(z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from ZENAA'), device: z.string().trim().max(60).default('MoMo phone') }), req.body);
    const f = failures.get(req.ip);
    if (f && f.count >= 8 && f.until > Date.now()) throw new AppError(429, 'Too many wrong codes. Wait 15 minutes.', 'locked');
    const exp = codes.get(b.code);
    if (!exp || exp < Date.now()) {
      failures.set(req.ip, { count: (f && f.until > Date.now() ? f.count : 0) + 1, until: Date.now() + 15 * 60_000 });
      throw badRequest('That code is wrong or has expired — get a new one in Settings → MoMo');
    }
    codes.delete(b.code);
    const { token, id } = await addRelayDevice(ctx, b.device);
    await audit(ctx.db, { staffId: null, ip: req.ip }, 'momo.relay_paired', undefined, { id, device: b.device });
    const s = await getSettings(ctx.db);
    return { token, centerName: s.centerName };
  });

  const relayToken = (req: FastifyRequest) => {
    const h = req.headers.authorization;
    if (h?.startsWith('Bearer ')) return h.slice(7).trim();
    return (req.query as { token?: string } | undefined)?.token;
  };
  /** The MoMo phone forwards an SMS. */
  app.post('/api/momo/sms', async (req) => {
    const d = await relayAuth(ctx, relayToken(req));
    return ingestSms(ctx, d.device, req.body);
  });
  /** The relay app checks its connection. */
  app.get('/api/momo/relay/ping', async (req) => {
    const d = await relayAuth(ctx, relayToken(req));
    return { ok: true, device: d.device, centerName: (await getSettings(ctx.db)).centerName };
  });

  // ───── Thank-you SMS sent by the MoMo phone ─────
  /** The phone asks for messages to send (every few seconds). */
  app.get('/api/momo/relay/outbox', async (req) => {
    const d = await relayAuth(ctx, relayToken(req));
    return { messages: await relayTakeOutbox(ctx, d.device) };
  });
  /** The phone reports whether a message went out. */
  app.post<{ Params: { id: string } }>('/api/momo/relay/outbox/:id', async (req) => {
    await relayAuth(ctx, relayToken(req));
    return relayReportOutbox(ctx, parse(z.string().uuid(), req.params.id), req.body);
  });
  app.get('/api/momo/outbox', inbox, async (req) => listOutbox(ctx, Number((req.query as { limit?: string }).limit) || 100));
  app.post('/api/momo/outbox/test', { preHandler: app.auth('settings.manage') }, async (req) => queueTestSms(ctx, req.body));
  app.post<{ Params: { id: string } }>('/api/momo/outbox/:id/retry', inbox, async (req) => retryOutbox(ctx, parse(z.string().uuid(), req.params.id)));
}
