/**
 * Finance: what came in and went out, by method, day, staff member and expense category;
 * wallet balances owed to customers, tabs owed to the venue, shift cash/MoMo differences. CSV export.
 */
import { and, asc, eq, gt, gte, inArray, lt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { auditLogs, customers, momoRequests, payments, sessions, shifts, staff } from '../db/schema.js';
import { parse } from '../lib/errors.js';
import { getSettings } from '../services/settings.js';
import { CASH_CATEGORIES } from '../services/shifts.js';
import { formatCustomerCode } from '../services/wallet.js';

const Range = z.object({ from: z.coerce.date(), to: z.coerce.date() });
const REVENUE = ['session', 'extension', 'sale'];
const approver = alias(staff, 'approver');

export async function financeRoutes(app: FastifyInstance, ctx: Ctx) {
  const guard = { preHandler: app.auth('finance.view') };

  app.get('/api/finance/categories', { preHandler: app.auth() }, async () => CASH_CATEGORIES);

  app.get('/api/finance/summary', guard, async (req) => {
    const q = parse(Range, req.query);
    const s = await getSettings(ctx.db);
    const rows = await ctx.db
      .select({ p: payments, staffName: staff.fullName })
      .from(payments)
      .leftJoin(staff, eq(staff.id, payments.staffId))
      .where(and(gte(payments.createdAt, q.from), lt(payments.createdAt, q.to)))
      .orderBy(asc(payments.createdAt));

    const day = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: s.timezone });
    const add = (o: Record<string, number>, k: string, v: number) => (o[k] = (o[k] ?? 0) + v);
    let gross = 0;
    let refunds = 0;
    const moneyIn: Record<string, number> = {};
    const moneyOut: Record<string, number> = {};
    const expenses: Record<string, number> = {};
    const cashIns: Record<string, number> = {};
    const wallet = { deposits: 0, spent: 0, withdrawals: 0 };
    const byDay = new Map<string, { date: string; revenue: number; cash: number; momo: number; other: number; expenses: number }>();
    const byStaff = new Map<string, { staffId: string | null; name: string; revenue: number; cash: number; momo: number; transactions: number }>();

    for (const { p, staffName } of rows) {
      const d = day(p.createdAt);
      const dd = byDay.get(d) ?? { date: d, revenue: 0, cash: 0, momo: 0, other: 0, expenses: 0 };
      byDay.set(d, dd);
      const key = p.staffId ?? 'system';
      const st = byStaff.get(key) ?? { staffId: p.staffId, name: staffName ?? 'System (online / automatic)', revenue: 0, cash: 0, momo: 0, transactions: 0 };
      byStaff.set(key, st);
      st.transactions++;

      if (REVENUE.includes(p.kind)) {
        gross += p.amount;
        dd.revenue += p.amount;
        st.revenue += p.amount;
      }
      if (p.kind === 'refund') {
        refunds += -p.amount;
        dd.revenue += p.amount;
        st.revenue += p.amount;
      }
      if (p.method === 'wallet') {
        if (REVENUE.includes(p.kind)) wallet.spent += p.amount;
        continue; // no real money moved
      }
      if (p.kind === 'deposit') wallet.deposits += p.amount;
      if (p.kind === 'withdrawal') wallet.withdrawals += -p.amount;
      if (p.amount >= 0) add(moneyIn, p.method, p.amount);
      else add(moneyOut, p.method, -p.amount);
      if (p.kind === 'cash_out') {
        add(expenses, p.category ?? 'other', -p.amount);
        dd.expenses += -p.amount;
      }
      if (p.kind === 'cash_in') add(cashIns, p.category ?? 'other', p.amount);
      if (p.kind !== 'cash_in' && p.kind !== 'cash_out') {
        if (p.method === 'cash') {
          dd.cash += p.amount;
          st.cash += p.amount;
        } else if (p.method === 'mobile_money') {
          dd.momo += p.amount;
          st.momo += p.amount;
        } else dd.other += p.amount;
      }
    }

    const [liab] = await ctx.db.select({ v: sql<number>`coalesce(sum(${customers.balance}),0)::bigint` }).from(customers);
    const [tabs] = await ctx.db
      .select({ v: sql<number>`coalesce(sum(${sessions.netAmount} - ${sessions.paidAmount}),0)::bigint` })
      .from(sessions)
      .where(and(eq(sessions.status, 'ended'), gt(sessions.netAmount, sessions.paidAmount)));
    const [sess] = await ctx.db
      .select({ n: sql<number>`count(*)::int`, minutes: sql<number>`coalesce(sum(${sessions.billedMinutes}),0)::int` })
      .from(sessions)
      .where(and(gte(sessions.startedAt, q.from), lt(sessions.startedAt, q.to)));
    const shiftRows = await ctx.db
      .select({ s: shifts, name: staff.fullName })
      .from(shifts)
      .innerJoin(staff, eq(staff.id, shifts.staffId))
      .where(and(gte(shifts.openedAt, q.from), lt(shifts.openedAt, q.to)))
      .orderBy(asc(shifts.openedAt));
    const momo = await ctx.db
      .select({ status: momoRequests.status, n: sql<number>`count(*)::int`, amount: sql<number>`coalesce(sum(${momoRequests.amount}),0)::bigint` })
      .from(momoRequests)
      .where(and(gte(momoRequests.createdAt, q.from), lt(momoRequests.createdAt, q.to)))
      .groupBy(momoRequests.status);
    const [bypass] = await ctx.db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'station.bypass_on'), gte(auditLogs.createdAt, q.from), lt(auditLogs.createdAt, q.to)));

    const totalIn = Object.values(moneyIn).reduce((a, b) => a + b, 0);
    const totalOut = Object.values(moneyOut).reduce((a, b) => a + b, 0);
    return {
      from: q.from,
      to: q.to,
      revenue: { gross, refunds, net: gross - refunds },
      moneyIn,
      moneyOut,
      totalIn,
      totalOut,
      netCashFlow: totalIn - totalOut,
      expenses,
      totalExpenses: Object.values(expenses).reduce((a, b) => a + b, 0),
      cashIns,
      wallet: { ...wallet, owedToCustomers: Number(liab?.v ?? 0) },
      tabsOwedToVenue: Number(tabs?.v ?? 0),
      sessions: { count: Number(sess?.n ?? 0), billedMinutes: Number(sess?.minutes ?? 0) },
      staffUnlocks: Number(bypass?.n ?? 0),
      momo: Object.fromEntries(momo.map((m) => [m.status, { count: Number(m.n), amount: Number(m.amount) }])),
      byDay: [...byDay.values()],
      byStaff: [...byStaff.values()].sort((a, b) => b.revenue - a.revenue),
      shifts: shiftRows.map(({ s: sh, name }) => {
        const sum = sh.summary as { expectedMomo?: number; byMethod?: Record<string, number> } | null;
        const expMomo = sum?.expectedMomo ?? sum?.byMethod?.mobile_money ?? null;
        return {
          id: sh.id,
          staffName: name,
          openedAt: sh.openedAt,
          closedAt: sh.closedAt,
          expectedCash: sh.expectedCash,
          countedCash: sh.countedCash,
          variance: sh.countedCash != null && sh.expectedCash != null ? sh.countedCash - sh.expectedCash : null,
          expectedMomo: expMomo,
          countedMomo: sh.countedMomo,
          momoVariance: sh.countedMomo != null && expMomo != null ? sh.countedMomo - expMomo : null,
        };
      }),
    };
  });

  /** Every payment in the range as CSV (opens in Excel / Google Sheets). */
  app.get('/api/finance/export.csv', guard, async (req, reply) => {
    const q = parse(Range.extend({ kinds: z.string().optional() }), req.query);
    const s = await getSettings(ctx.db);
    const kinds = q.kinds?.split(',').filter(Boolean) as (typeof payments.$inferSelect)['kind'][] | undefined;
    const rows = await ctx.db
      .select({ p: payments, staffName: staff.fullName, approverName: approver.fullName, customerName: customers.fullName, customerNumber: customers.number })
      .from(payments)
      .leftJoin(staff, eq(staff.id, payments.staffId))
      .leftJoin(approver, eq(approver.id, payments.approvedBy))
      .leftJoin(customers, eq(customers.id, payments.customerId))
      .where(and(gte(payments.createdAt, q.from), lt(payments.createdAt, q.to), kinds?.length ? inArray(payments.kind, kinds) : undefined))
      .orderBy(asc(payments.createdAt));
    const div = 10 ** s.currencyMinorUnits;
    const cell = (v: unknown) => {
      const t = String(v ?? '');
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const header = ['Number', 'Date', 'Time', 'Type', 'Method', `Amount (${s.currencyCode})`, 'Category', 'Reference', 'Customer', 'Customer ID', 'Staff', 'Approved by (PIN)', 'Note'];
    const lines = rows.map(({ p, staffName, approverName, customerName, customerNumber }) =>
      [
        p.number,
        p.createdAt.toLocaleDateString('en-CA', { timeZone: s.timezone }),
        p.createdAt.toLocaleTimeString('en-GB', { timeZone: s.timezone }),
        p.kind,
        p.method,
        (p.amount / div).toFixed(s.currencyMinorUnits),
        p.category ?? '',
        p.reference ?? '',
        customerName ?? '',
        customerNumber != null ? formatCustomerCode(customerNumber) : '',
        staffName ?? 'System',
        approverName ?? '',
        p.note ?? '',
      ]
        .map(cell)
        .join(','),
    );
    const name = `zenaa-payments-${q.from.toISOString().slice(0, 10)}-to-${new Date(q.to.getTime() - 1).toISOString().slice(0, 10)}.csv`;
    reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${name}"`);
    return '﻿' + [header.join(','), ...lines].join('\r\n') + '\r\n';
  });
}
