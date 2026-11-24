import { existsSync } from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { registerAuth } from './auth/plugin.js';
import { setPinKey } from './services/pins.js';
import type { Ctx } from './context.js';
import { AppError, pgErrorCode } from './lib/errors.js';
import { authRoutes } from './routes/auth.js';
import { bookingRoutes } from './routes/bookings.js';
import { competitionRoutes } from './routes/competitions.js';
import { agentRoutes } from './routes/agent.js';
import { consolePageRoutes } from './routes/console-page.js';
import { momoRoutes } from './routes/momo.js';
import { contentRoutes } from './routes/content.js';
import { communityRoutes } from './routes/community.js';
import { financeRoutes } from './routes/finance.js';
import { systemRoutes } from './routes/system.js';
import { cleanupRoutes } from './routes/cleanup.js';
import { docsRoutes } from './routes/docs.js';
import { integrationRoutes } from './routes/integrations.js';
import { portalRoutes } from './routes/portal.js';
import { PowerManager } from './services/power.js';
import { customerRoutes } from './routes/customers.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { moneyRoutes } from './routes/money.js';
import { pricingRoutes } from './routes/pricing.js';
import { promotionRoutes } from './routes/promotions.js';
import { sessionRoutes } from './routes/sessions.js';
import { stationRoutes } from './routes/stations.js';
import { socialRoutes } from './routes/social.js';

export interface BuildOptions {
  jwtSecret: string;
  webDist?: string;
  logger?: boolean | object;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Smart-plug controller for station power. */
    power: PowerManager;
  }
}

export async function buildApp(ctx: Ctx, opts: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true, bodyLimit: 1_000_000 });
  const power = new PowerManager(ctx);
  app.decorate('power', power);
  power.listen(app.log);
  app.addHook('onClose', async () => power.stop());

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) return reply.status(err.statusCode).send({ error: err.code, message: err.message });
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: 'validation', message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    }
    const code = pgErrorCode(err);
    if (code === '23505') return reply.status(409).send({ error: 'conflict', message: 'That record already exists (duplicate value)' });
    if (code === '23503') return reply.status(400).send({ error: 'bad_reference', message: 'A referenced record does not exist' });
    if (code === '22P02') return reply.status(400).send({ error: 'bad_request', message: 'Invalid identifier' });
    if ((err as { statusCode?: number }).statusCode && (err as { statusCode: number }).statusCode < 500) {
      return reply.status((err as { statusCode: number }).statusCode).send({ error: 'bad_request', message: (err as Error).message });
    }
    req.log.error(err);
    return reply.status(500).send({ error: 'internal', message: 'Unexpected server error — it has been logged' });
  });

  await registerAuth(app, ctx.db, opts.jwtSecret);
  setPinKey(opts.jwtSecret);

  app.get('/api/health', async () => ({ ok: true, time: ctx.clock.now().toISOString() }));
  await authRoutes(app, ctx);
  await stationRoutes(app, ctx);
  await pricingRoutes(app, ctx);
  await sessionRoutes(app, ctx);
  await customerRoutes(app, ctx);
  await dashboardRoutes(app, ctx);
  await moneyRoutes(app, ctx);
  await promotionRoutes(app, ctx);
  await bookingRoutes(app, ctx);
  await portalRoutes(app, ctx);
  await integrationRoutes(app, ctx, power);
  await competitionRoutes(app, ctx);
  await agentRoutes(app, ctx);
  await consolePageRoutes(app, ctx);
  await momoRoutes(app, ctx);
  await contentRoutes(app, ctx);
  await communityRoutes(app, ctx);
  await financeRoutes(app, ctx);
  await systemRoutes(app, ctx);
  await socialRoutes(app, ctx);
  await docsRoutes(app);
  await cleanupRoutes(app, ctx);

  if (opts.webDist && existsSync(path.join(opts.webDist, 'index.html'))) {
    const fastifyStatic = (await import('@fastify/static')).default;
    await app.register(fastifyStatic, {
      root: path.resolve(opts.webDist),
      wildcard: false,
      // Sends the .br / .gz copies made at build time (much faster on phones and slow Wi-Fi).
      preCompressed: true,
      // We set cache-control ourselves below.
      cacheControl: false,
      setHeaders: (res, file) => {
        // Hashed build files never change: keep them for a year. The page itself and the service worker: always check.
        if (/[\\/]assets[\\/]/.test(file)) res.setHeader('cache-control', 'public, max-age=31536000, immutable');
        else if (/(index\.html|sw\.js|\.webmanifest)$/.test(file)) res.setHeader('cache-control', 'no-cache');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/socket.io')) {
        return reply.status(404).send({ error: 'not_found', message: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'not_found', message: 'Not found' }));
  }

  return app;
}
