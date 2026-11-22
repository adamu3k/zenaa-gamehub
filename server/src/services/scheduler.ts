import { and, eq } from 'drizzle-orm';
import { activeSecondsAt } from '../billing/engine.js';
import type { Ctx } from '../context.js';
import { sessionEvents, sessions, stations } from '../db/schema.js';
import { expireSession, recoverAfterOutage } from './sessions.js';
import { getKv, getSettings, setKv } from './settings.js';

const HEARTBEAT_KEY = 'system.heartbeat';
const OUTAGE_THRESHOLD_MS = 120_000;

/**
 * Background loop: prepaid expiry, pre-expiry warnings, heartbeat.
 * Timing never depends on this loop being punctual — expiry is computed from stored timestamps.
 */
export class SessionScheduler {
  private timer: NodeJS.Timeout | null = null;
  private warned = new Set<string>();
  private lastHeartbeat = 0;
  private running = false;

  constructor(
    private ctx: Ctx,
    private log: { error: (o: unknown, m?: string) => void; info: (m: string) => void },
  ) {}

  /** Runs outage recovery, then starts ticking. */
  async start(intervalMs = 2000) {
    const hb = await getKv<string>(this.ctx.db, HEARTBEAT_KEY);
    const now = this.ctx.clock.now();
    if (hb && now.getTime() - Date.parse(hb) > OUTAGE_THRESHOLD_MS) {
      const changed = await recoverAfterOutage(this.ctx, new Date(hb));
      if (changed.length) this.log.info(`Outage recovery: ${changed.length} session(s) adjusted (last heartbeat ${hb})`);
    }
    await this.heartbeat(true);
    await this.primeWarnings();
    this.timer = setInterval(() => void this.tick(), intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async heartbeat(force = false) {
    const now = this.ctx.clock.now().getTime();
    if (!force && now - this.lastHeartbeat < 30_000) return;
    this.lastHeartbeat = now;
    await setKv(this.ctx.db, HEARTBEAT_KEY, new Date(now).toISOString());
  }

  /** Don't re-alert thresholds that were already passed before a restart. */
  private async primeWarnings() {
    const { warningMinutes } = await getSettings(this.ctx.db);
    const now = this.ctx.clock.now();
    const open = await this.openPrepaid();
    for (const s of open) {
      const remaining = (s.allottedSeconds ?? 0) - activeSecondsAt(s, now);
      for (const w of warningMinutes) if (remaining <= w * 60) this.warned.add(`${s.id}:${w}`);
    }
  }

  private openPrepaid() {
    return this.ctx.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.status, 'running'), eq(sessions.billingType, 'prepaid')));
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const now = this.ctx.clock.now();
      const { warningMinutes } = await getSettings(this.ctx.db);
      for (const s of await this.openPrepaid()) {
        const remaining = (s.allottedSeconds ?? 0) - activeSecondsAt(s, now);
        if (remaining <= 0) {
          await expireSession(this.ctx, s.id);
          continue;
        }
        for (const w of [...warningMinutes].sort((a, b) => a - b)) {
          const key = `${s.id}:${w}`;
          if (remaining <= w * 60 && !this.warned.has(key)) {
            for (const other of warningMinutes) if (other >= w) this.warned.add(`${s.id}:${other}`);
            const [st] = await this.ctx.db.select({ name: stations.name }).from(stations).where(eq(stations.id, s.stationId));
            await this.ctx.db.insert(sessionEvents).values({ sessionId: s.id, type: 'warning', at: now, meta: { minutesLeft: w } });
            this.ctx.bus.emit({
              type: 'alert',
              level: 'warning',
              message: `${st?.name ?? 'Station'}: ${w} minute${w === 1 ? '' : 's'} left`,
              sessionId: s.id,
              stationId: s.stationId,
              sound: 'warning',
              speak: `${st?.name ?? 'Station'}, ${w} minute${w === 1 ? '' : 's'} remaining`,
            });
            break;
          }
        }
      }
      await this.heartbeat();
    } catch (err) {
      this.log.error(err, 'scheduler tick failed');
    } finally {
      this.running = false;
    }
  }
}
