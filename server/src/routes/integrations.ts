import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { z } from 'zod';
import { actorOf } from '../auth/plugin.js';
import type { Ctx } from '../context.js';
import { notFound, parse } from '../lib/errors.js';
import {
  getPaystackConfig,
  handleWebhook,
  listOnlinePayments,
  maskConfig,
  savePaystackConfig,
  startTopup,
  testPaystack,
  TopupSchema,
  verifyOnlinePayment,
} from '../services/paystack.js';
import { discoverPlugs, PowerConfigSchema, POWER_DRIVERS, validatePowerConfig, type PowerManager } from '../services/power.js';
import { finishEwelinkOauth, forgetEwelink, importEwelink, listEwelink, locateEwelink, startEwelinkOauth } from '../services/ewelink.js';
import { keepSecrets } from './stations.js';
import { httpOf } from '../context.js';
import { stations } from '../db/schema.js';
import { originOf } from './portal.js';

export async function integrationRoutes(app: FastifyInstance, ctx: Ctx, power: PowerManager) {
  // ── Paystack settings ──
  app.get('/api/integrations/paystack', { preHandler: app.auth('settings.manage') }, async () => maskConfig(await getPaystackConfig(ctx)));
  app.put('/api/integrations/paystack', { preHandler: app.auth('settings.manage') }, async (req) => savePaystackConfig(ctx, actorOf(req), req.body));
  app.post('/api/integrations/paystack/test', { preHandler: app.auth('settings.manage') }, async () => testPaystack(ctx));

  /** Is online payment available? (any signed-in staff — decides whether to show the "Paystack" button). */
  app.get('/api/paystack/status', { preHandler: app.auth() }, async () => {
    const c = await getPaystackConfig(ctx);
    return { enabled: c.enabled && !!c.secretKey, mode: c.secretKey.startsWith('sk_live_') ? 'live' : 'test' };
  });

  /** Counter top-up: returns the Paystack checkout link and a QR code the customer scans to pay on their phone. */
  app.post<{ Params: { id: string } }>('/api/customers/:id/paystack', { preHandler: app.auth('wallet.deposit') }, async (req) => {
    const body = parse(TopupSchema, req.body);
    const cfg = await getPaystackConfig(ctx);
    const r = await startTopup(ctx, {
      customerId: req.params.id,
      amount: body.amount,
      email: body.email,
      initiatedBy: req.staff!.id,
      callbackUrl: `${originOf(req, cfg.callbackBaseUrl)}/portal/paid`,
    });
    const qr = await QRCode.toDataURL(r.authorizationUrl, { margin: 1, width: 260 });
    return { ...r, qr };
  });

  app.get<{ Params: { reference: string } }>('/api/paystack/payments/:reference', { preHandler: app.auth('customers.view') }, async (req) =>
    verifyOnlinePayment(ctx, req.params.reference),
  );

  app.get('/api/paystack/payments', { preHandler: app.auth('reports.view') }, async (req) => {
    const q = parse(z.object({ customerId: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
    return listOnlinePayments(ctx, q);
  });

  /**
   * Paystack webhook (set https://<your-public-address>/api/paystack/webhook in the Paystack dashboard).
   * Needs the raw body for the signature, so it gets its own JSON parser.
   */
  await app.register(async (sub) => {
    sub.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 200_000 }, (_req, body, done) => done(null, body));
    sub.post('/api/paystack/webhook', async (req, reply) => {
      const ok = await handleWebhook(ctx, String(req.body ?? ''), req.headers['x-paystack-signature'] as string | undefined).catch((err) => {
        req.log.error(err, 'paystack webhook');
        return true; // signature was fine; we'll re-check in the background sweep
      });
      return reply.status(ok ? 200 : 401).send({ ok });
    });
  });

  // ── Station power (smart plugs) ──
  app.get('/api/power/drivers', { preHandler: app.auth('stations.view') }, async () => POWER_DRIVERS);

  app.post<{ Params: { id: string } }>('/api/stations/:id/power', { preHandler: app.auth('stations.power') }, async (req) => {
    const body = parse(z.object({ on: z.boolean() }), req.body);
    return power.setManual(req.params.id, body.on, actorOf(req));
  });

  app.post<{ Params: { id: string } }>('/api/stations/:id/power/refresh', { preHandler: app.auth('stations.view') }, async (req) => {
    const d = await power.desired(req.params.id);
    if (!d.station) throw notFound('Station');
    await power.enforceAll();
    return { ok: true };
  });

  /** Station form "Find plugs" button: scan the venue network for Tasmota / Shelly plugs. */
  app.get('/api/power/discover', { preHandler: app.auth('stations.manage') }, async (req) => {
    const q = parse(z.object({ subnet: z.string().trim().optional() }), req.query);
    // Default: the network the staff member's browser used to open ZENAA (e.g. 192.168.100.12 → 192.168.100).
    const hostIp = String(req.headers.host ?? '').split(':')[0];
    const subnet = q.subnet || (/^\d+\.\d+\.\d+\.\d+$/.test(hostIp) && !hostIp.startsWith('127.') ? hostIp.split('.').slice(0, 3).join('.') : '');
    if (!subnet) return { subnet: null, plugs: [] };
    const plugs = await discoverPlugs(httpOf(ctx), subnet);
    const used = await ctx.db.select({ code: stations.code, cfg: stations.powerConfig }).from(stations);
    return {
      subnet,
      plugs: plugs.map((p) => ({ ...p, usedBy: used.find((s) => s.cfg?.host?.replace(/^https?:\/\//, '').replace(/[:/].*$/, '') === p.ip)?.code ?? null })),
    };
  });

  /** Station form "Test" button: talk to a plug with unsaved settings. */
  app.post('/api/power/test', { preHandler: app.auth('stations.manage') }, async (req) => {
    const body = parse(
      z.object({ driver: z.enum(POWER_DRIVERS), config: PowerConfigSchema, action: z.enum(['status', 'on', 'off']).default('status'), stationId: z.string().uuid().optional() }),
      req.body,
    );
    // Keep the stored password / key / token when the form leaves it blank.
    if (body.stationId) keepSecrets(body.config, (await power.desired(body.stationId)).station?.powerConfig);
    try {
      await validatePowerConfig(ctx, body.driver, body.config);
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
    return power.test(body.driver, body.config, body.action);
  });

  // ── eWeLink account: import device IDs + keys, find them on the LAN ──
  app.get('/api/integrations/ewelink', { preHandler: app.auth('stations.manage') }, async () => listEwelink(ctx));
  app.post('/api/integrations/ewelink/import', { preHandler: app.auth('settings.manage') }, async (req) => importEwelink(ctx, actorOf(req), req.body));
  // Sign in with eWeLink (OAuth 2.0): works with the free developer App ID, which may not sign in with a password.
  app.post('/api/integrations/ewelink/oauth', { preHandler: app.auth('settings.manage') }, async (req) => startEwelinkOauth(ctx, actorOf(req), req.body));
  // eWeLink sends the browser back here (no ZENAA sign-in header on a redirect: the one-time state proves it).
  app.get('/api/integrations/ewelink/callback', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    try {
      const r = await finishEwelinkOauth(ctx, { code: q.code, region: q.region, state: q.state, ip: req.ip });
      return reply.redirect(`/integrations?ewelink=ok&n=${r.devices.length}`);
    } catch (err) {
      return reply.redirect(`/integrations?ewelink=error&msg=${encodeURIComponent((err as Error).message.slice(0, 300))}`);
    }
  });
  app.delete('/api/integrations/ewelink', { preHandler: app.auth('settings.manage') }, async (req) => forgetEwelink(ctx, actorOf(req)));
  app.post('/api/integrations/ewelink/locate', { preHandler: app.auth('stations.manage') }, async (req) => {
    const q = parse(z.object({ subnet: z.string().trim().optional() }), req.body);
    const hostIp = String(req.headers.host ?? '').split(':')[0];
    const subnet = q.subnet || (/^\d+\.\d+\.\d+\.\d+$/.test(hostIp) && !hostIp.startsWith('127.') ? hostIp.split('.').slice(0, 3).join('.') : '');
    if (!subnet) return { subnet: null, found: [] };
    return locateEwelink(ctx, subnet);
  });
}
