import { buildApp } from './app.js';
import { ensureAdmin } from './bootstrap.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db/index.js';
import { systemClock } from './lib/clock.js';
import { Bus } from './realtime/bus.js';
import { attachRealtime } from './realtime/socket.js';
import { attachVncBridge } from './services/vnc.js';
import { sweepNoShows } from './services/bookings.js';
import { sweepPendingPayments } from './services/paystack.js';
import { SessionScheduler } from './services/scheduler.js';
import { expireMomoRequests } from './services/momo.js';
import { autoBackupTick } from './services/backup.js';
import { dailyIdeasTick } from './services/social.js';
import { applyTimezone, getKv } from './services/settings.js';

async function main() {
  const config = loadConfig();
  const handle = await openDatabase({ url: config.DATABASE_URL, pgliteDir: config.PGLITE_DIR });
  const ctx = { db: handle.db, clock: systemClock, bus: new Bus() };
  // The centre's time zone (Settings) wins over the container's TZ for day boundaries and happy hours.
  applyTimezone((await getKv<{ timezone?: string }>(handle.db, 'app'))?.timezone);

  const app = await buildApp(ctx, {
    jwtSecret: config.JWT_SECRET,
    webDist: config.WEB_DIST,
    logger: { level: config.LOG_LEVEL },
  });
  app.log.info(`Database: ${handle.kind}${handle.kind === 'pglite' ? ` (${config.PGLITE_DIR})` : ''} — migrations applied`);

  const admin = await ensureAdmin(handle.db, config.ADMIN_USERNAME, config.ADMIN_PASSWORD);
  if (admin.created) app.log.warn(`Created first administrator "${admin.username}". Remove ADMIN_PASSWORD from .env now.`);

  attachRealtime(app, ctx.bus);
  attachVncBridge(app);
  const scheduler = new SessionScheduler(ctx, app.log);
  await scheduler.start();
  // Smart plugs: correct any plug that drifted (power cut, someone pressed the button) once a minute.
  app.power.startEnforcement(60_000);
  // Paystack payments whose customer never came back to the page; bookings nobody turned up for.
  const jobs = setInterval(() => {
    sweepPendingPayments(ctx).catch((err) => app.log.error(err, 'paystack sweep'));
    sweepNoShows(ctx).catch((err) => app.log.error(err, 'booking no-show sweep'));
    expireMomoRequests(ctx).catch((err) => app.log.error(err, 'momo expiry'));
    dailyIdeasTick(ctx).catch((err) => app.log.error(err, 'social ideas'));
  }, 60_000);
  // Automatic backups (Settings → Backup): checked every 5 minutes, first check 2 minutes after start.
  const backups = setInterval(() => void autoBackupTick(ctx).catch((err) => app.log.error(err, 'auto backup')), 5 * 60_000);
  setTimeout(() => void autoBackupTick(ctx).catch((err) => app.log.error(err, 'auto backup')), 2 * 60_000).unref();

  await app.listen({ host: config.HOST, port: config.PORT });

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    app.log.info(`${signal} received — shutting down cleanly`);
    scheduler.stop();
    clearInterval(jobs);
    clearInterval(backups);
    await app.close();
    await handle.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
