import { and, desc, eq, gt, gte, inArray, lt, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorOf } from '../auth/plugin.js';
import type { Ctx } from '../context.js';
import { auditLogs, customers, payments, sessions, staff } from '../db/schema.js';
import { conflict, parse } from '../lib/errors.js';
import { COUNTRIES } from '../lib/countries.js';
import { audit } from '../services/audit.js';
import { activeSecondsAt } from '../billing/engine.js';
import { applyTimezone, getSettings, saveSettings, SettingsSchema } from '../services/settings.js';
import { formatCustomerCode } from '../services/wallet.js';
import { listStationsLive } from './stations.js';

const REVENUE_KINDS = ['session', 'extension', 'sale', 'refund'] as const;

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export async function dashboardRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/api/dashboard', { preHandler: app.auth('stations.view') }, async (req) => {
    const now = ctx.clock.now();
    const canSeeMoney = req.staff!.permissions.includes('reports.view');
    const today = startOfDay(now);
    const week = new Date(today);
    week.setDate(week.getDate() - ((week.getDay() + 6) % 7)); // Monday
    const month = new Date(today.getFullYear(), today.getMonth(), 1);
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const since = new Date(Math.min(month.getTime(), sevenDaysAgo.getTime(), week.getTime()));

    const stationList = await listStationsLive(ctx);
    const counts = { total: stationList.length, available: 0, in_use: 0, paused: 0, maintenance: 0, offline: 0 };
    for (const s of stationList) counts[s.liveStatus as keyof typeof counts]++;

    // Utilisation today: active seconds of sessions overlapping today / (operational stations × seconds since midnight)
    const todaysSessions = await ctx.db
      .select()
      .from(sessions)
      .where(or(gte(sessions.startedAt, today), ne(sessions.status, 'ended')));
    let usedSeconds = 0;
    for (const s of todaysSessions) usedSeconds += activeSecondsAt(s, now);
    const operational = stationList.filter((s) => s.status === 'active').length;
    const capacity = operational * Math.max(1, (now.getTime() - today.getTime()) / 1000);
    const utilisation = capacity > 0 ? Math.min(100, Math.round((usedSeconds / capacity) * 1000) / 10) : 0;

    const alerts: { level: 'warning' | 'critical' | 'info'; message: string }[] = [];
    for (const s of stationList) {
      if (s.status === 'maintenance') alerts.push({ level: 'info', message: `${s.name} is under maintenance` });
      if (s.status === 'offline') alerts.push({ level: 'warning', message: `${s.name} is offline` });
      if (s.session?.status === 'paused') alerts.push({ level: 'info', message: `${s.name}: session paused` });
      if (s.session?.remainingSeconds != null && s.session.status === 'running' && s.session.remainingSeconds <= 300)
        alerts.push({ level: 'warning', message: `${s.name}: ${Math.ceil(s.session.remainingSeconds / 60)} min left` });
    }

    const activity = await ctx.db
      .select({ a: auditLogs, staffName: staff.fullName })
      .from(auditLogs)
      .leftJoin(staff, eq(staff.id, auditLogs.staffId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(12);

    const base = {
      serverTime: now.toISOString(),
      stations: counts,
      activeSessions: counts.in_use + counts.paused,
      utilisationToday: utilisation,
      alerts,
      activity: activity.map((x) => ({ id: x.a.id, action: x.a.action, staffName: x.staffName ?? 'System', createdAt: x.a.createdAt })),
    };
    if (!canSeeMoney) return { ...base, revenue: null, recentTransactions: [], revenueByDay: [] };

    const pays = await ctx.db
      .select({ amount: payments.amount, createdAt: payments.createdAt })
      .from(payments)
      .where(and(gte(payments.createdAt, since), inArray(payments.kind, [...REVENUE_KINDS])));
    const revenue = { today: 0, week: 0, month: 0 };
    const byDay = new Map<string, number>();
    for (let i = 0; i < 7; i++) {
      const d = new Date(sevenDaysAgo);
      d.setDate(d.getDate() + i);
      byDay.set(d.toDateString(), 0);
    }
    for (const p of pays) {
      if (p.createdAt >= today) revenue.today += p.amount;
      if (p.createdAt >= week) revenue.week += p.amount;
      if (p.createdAt >= month) revenue.month += p.amount;
      const k = startOfDay(p.createdAt).toDateString();
      if (byDay.has(k)) byDay.set(k, byDay.get(k)! + p.amount);
    }

    const recent = await ctx.db
      .select({ p: payments, staffName: staff.fullName, customerName: customers.fullName, customerNumber: customers.number })
      .from(payments)
      .leftJoin(staff, eq(staff.id, payments.staffId))
      .leftJoin(customers, eq(customers.id, payments.customerId))
      .orderBy(desc(payments.createdAt))
      .limit(10);

    const [tabs] = await ctx.db
      .select({ owed: sql<number>`coalesce(sum(${sessions.netAmount} - ${sessions.paidAmount}),0)::bigint`, count: sql<number>`count(*)::int` })
      .from(sessions)
      .where(and(eq(sessions.status, 'ended'), gt(sessions.netAmount, sessions.paidAmount)));

    return {
      ...base,
      revenue,
      openTabs: { owed: Number(tabs.owed), sessions: Number(tabs.count) },
      revenueByDay: [...byDay.entries()].map(([day, amount]) => ({ day: new Date(day).toISOString(), amount })),
      recentTransactions: recent.map((r) => ({
        ...r.p,
        staffName: r.staffName,
        customerName: r.customerName,
        customerCode: r.customerNumber != null ? formatCustomerCode(r.customerNumber) : null,
      })),
    };
  });

  app.get('/api/audit', { preHandler: app.auth('audit.view') }, async (req) => {
    const q = parse(
      z.object({
        before: z.coerce.date().optional(),
        staffId: z.string().uuid().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      }),
      req.query,
    );
    const rows = await ctx.db
      .select({ a: auditLogs, staffName: staff.fullName })
      .from(auditLogs)
      .leftJoin(staff, eq(staff.id, auditLogs.staffId))
      .where(and(q.before ? lt(auditLogs.createdAt, q.before) : undefined, q.staffId ? eq(auditLogs.staffId, q.staffId) : undefined))
      .orderBy(desc(auditLogs.createdAt))
      .limit(q.limit);
    return rows.map((r) => ({ ...r.a, staffName: r.staffName ?? 'System' }));
  });

  // Settings are readable by any signed-in user (currency formatting); writable with settings.manage.
  app.get('/api/settings', { preHandler: app.auth() }, async () => getSettings(ctx.db));
  app.put('/api/settings', { preHandler: app.auth('settings.manage') }, async (req) => {
    const body = parse(SettingsSchema, req.body);
    const current = await getSettings(ctx.db);
    if (body.currencyMinorUnits !== current.currencyMinorUnits) {
      // Amounts are stored in minor units: changing the decimal places would silently multiply or divide every stored amount.
      const [{ n }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(payments);
      if (Number(n) > 0) {
        throw conflict(
          `Decimal places cannot change after money has been recorded (${current.currencyMinorUnits} → ${body.currencyMinorUnits}). Keep ${current.currencyMinorUnits}, or start with a fresh database.`,
        );
      }
    }
    await saveSettings(ctx.db, body);
    applyTimezone(body.timezone);
    await audit(ctx.db, actorOf(req), 'settings.update', undefined, body);
    return body;
  });

  /** Colours and fonts for the login page and the customer app (no sign-in needed; nothing secret). */
  app.get('/api/public/appearance', async (_req, reply) => {
    const s = await getSettings(ctx.db);
    reply.header('cache-control', 'no-cache');
    return { centerName: s.centerName, appearance: s.appearance };
  });

  /** Country presets for the settings page (currency, decimals, time zone, phone prefix, mobile-money networks). */
  app.get('/api/countries', { preHandler: app.auth() }, async () => COUNTRIES);
}
