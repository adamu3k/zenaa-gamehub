/**
 * Customer chat in the portal.
 *
 *  - "lobby": one room for every signed-in customer (and staff, who post as the venue).
 *  - Private messages between two players: room "dm:<idA>:<idB>" with the two ids sorted.
 *
 * Clients poll "messages after number N" every few seconds — cheap, and works on any phone/network.
 * Staff can read every room, delete messages and mute a player (muted players can still read).
 */
import { and, desc, eq, gt, ilike, inArray, isNotNull, isNull, like, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Actor, Ctx } from '../context.js';
import { chatMessages, customers, sessions, staff } from '../db/schema.js';
import { AppError, badRequest, forbidden, notFound } from '../lib/errors.js';
import { avatarUrl, publicName } from '../competitions/common.js';
import { audit } from './audit.js';
import { getSettings } from './settings.js';
import { notifyLater } from './push.js';

export const LOBBY = 'lobby';
const PAGE = 60;
const MIN_GAP_MS = 1500;
const lastPost = new Map<string, number>();

export const dmRoom = (a: string, b: string) => `dm:${[a, b].sort().join(':')}`;

export const ChatPostSchema = z.object({
  /** "lobby" or the other player's customer id (private message). */
  to: z.string().trim().min(1).max(60),
  body: z.string().trim().min(1, 'Type a message').max(500, 'Keep messages under 500 characters'),
});

/** Hides blocked words (whole words, any case) with stars. */
export function cleanText(body: string, blocked: string[]) {
  let out = body.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
  for (const w of blocked) {
    const esc = w.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!esc) continue;
    out = out.replace(new RegExp(`(^|[^\\p{L}\\p{N}])(${esc})(?=$|[^\\p{L}\\p{N}])`, 'giu'), (_m, pre: string, word: string) => pre + '*'.repeat(word.length));
  }
  return out;
}

async function chatOn(ctx: Ctx) {
  const s = await getSettings(ctx.db);
  if (!s.chatEnabled) throw new AppError(403, 'Chat is switched off', 'chat_off');
  return s;
}

type Row = typeof chatMessages.$inferSelect;

async function present(ctx: Ctx, rows: Row[], viewer: { customerId?: string; staff?: boolean }) {
  const cIds = [...new Set(rows.map((r) => r.customerId).filter((x): x is string => !!x))];
  const people = cIds.length
    ? await ctx.db.select({ id: customers.id, fullName: customers.fullName, gamertag: customers.gamertag, muted: customers.chatMuted, avatarAt: customers.avatarAt }).from(customers).where(inArray(customers.id, cIds))
    : [];
  const byId = new Map(people.map((p) => [p.id, p]));
  const center = (await getSettings(ctx.db)).centerName;
  const staffNames = new Map<string, string>();
  if (viewer.staff) {
    const sIds = [...new Set(rows.map((r) => r.staffId).filter((x): x is string => !!x))];
    if (sIds.length) for (const s of await ctx.db.select({ id: staff.id, name: staff.fullName }).from(staff).where(inArray(staff.id, sIds))) staffNames.set(s.id, s.name);
  }
  return rows.map((r) => {
    const p = r.customerId ? byId.get(r.customerId) : null;
    return {
      id: r.id,
      number: r.number,
      room: r.room,
      from: p
        ? { id: p.id, name: publicName(p), staff: false, avatarUrl: avatarUrl(p.id, p.avatarAt), ...(viewer.staff ? { fullName: p.fullName, muted: p.muted } : {}) }
        : { id: null, name: center, staff: true, ...(viewer.staff && r.staffId ? { fullName: staffNames.get(r.staffId) ?? 'Staff' } : {}) },
      mine: !!viewer.customerId && r.customerId === viewer.customerId,
      body: r.deleted ? '' : r.body,
      deleted: r.deleted,
      ...(viewer.staff ? { reported: r.reported } : {}),
      createdAt: r.createdAt.toISOString(),
    };
  });
}

async function readRoom(ctx: Ctx, room: string, after: number | undefined) {
  if (after && after > 0) {
    return ctx.db.select().from(chatMessages).where(and(eq(chatMessages.room, room), gt(chatMessages.number, after))).orderBy(chatMessages.number).limit(200);
  }
  const rows = await ctx.db.select().from(chatMessages).where(eq(chatMessages.room, room)).orderBy(desc(chatMessages.number)).limit(PAGE);
  return rows.reverse();
}

async function roomFor(ctx: Ctx, me: string, to: string) {
  if (to === LOBBY) return LOBBY;
  if (!z.string().uuid().safeParse(to).success) throw badRequest('Unknown chat');
  if (to === me) throw badRequest('You cannot message yourself');
  const [other] = await ctx.db.select({ id: customers.id, status: customers.status }).from(customers).where(eq(customers.id, to));
  if (!other || other.status !== 'active') throw notFound('Player');
  return dmRoom(me, to);
}

/** Portal: messages in the lobby or with one player. */
export async function customerMessages(ctx: Ctx, me: string, to: string, after?: number) {
  await chatOn(ctx);
  const room = await roomFor(ctx, me, to);
  const rows = await readRoom(ctx, room, after);
  const [c] = await ctx.db.select({ muted: customers.chatMuted }).from(customers).where(eq(customers.id, me));
  let other = null as null | { id: string; name: string };
  if (room !== LOBBY) {
    const [o] = await ctx.db.select({ id: customers.id, fullName: customers.fullName, gamertag: customers.gamertag }).from(customers).where(eq(customers.id, to));
    other = o ? { id: o.id, name: publicName(o) } : null;
  }
  return { room, other, muted: !!c?.muted, messages: await present(ctx, rows, { customerId: me }) };
}

export async function customerPost(ctx: Ctx, me: string, raw: unknown) {
  const s = await chatOn(ctx);
  const b = ChatPostSchema.parse(raw);
  const [c] = await ctx.db.select({ muted: customers.chatMuted }).from(customers).where(eq(customers.id, me));
  if (c?.muted) throw forbidden('Staff have paused your chat. Ask at the counter.');
  const now = Date.now();
  if (now - (lastPost.get(me) ?? 0) < MIN_GAP_MS) throw new AppError(429, 'Slow down a little', 'slow_down');
  lastPost.set(me, now);
  const room = await roomFor(ctx, me, b.to);
  const body = cleanText(b.body, s.chatBlockedWords);
  if (!body.trim()) throw badRequest('Type a message');
  const [m] = await ctx.db.insert(chatMessages).values({ room, customerId: me, body, createdAt: ctx.clock.now() }).returning();
  ctx.bus.emit({ type: 'chat.changed', room });
  if (room !== LOBBY) {
    const [from] = await ctx.db.select({ fullName: customers.fullName, gamertag: customers.gamertag }).from(customers).where(eq(customers.id, me));
    notifyLater(ctx, b.to, { title: `💬 ${from ? publicName(from) : 'New message'}`, body: body.slice(0, 140), url: `/portal/chat?to=${me}`, tag: `dm-${me}` });
  }
  return (await present(ctx, [m], { customerId: me }))[0];
}

/** Portal: the lobby plus every private conversation, newest first. */
export async function customerThreads(ctx: Ctx, me: string) {
  await chatOn(ctx);
  const [lobbyLast] = await ctx.db.select({ number: chatMessages.number, createdAt: chatMessages.createdAt }).from(chatMessages).where(eq(chatMessages.room, LOBBY)).orderBy(desc(chatMessages.number)).limit(1);
  const mine = await ctx.db
    .select({ room: chatMessages.room, last: sql<number>`max(${chatMessages.number})`.mapWith(Number) })
    .from(chatMessages)
    .where(and(like(chatMessages.room, 'dm:%'), or(like(chatMessages.room, `dm:${me}:%`), like(chatMessages.room, `dm:%:${me}`))))
    .groupBy(chatMessages.room);
  const lastRows = mine.length ? await ctx.db.select().from(chatMessages).where(inArray(chatMessages.number, mine.map((m) => m.last))) : [];
  const otherIds = lastRows.map((r) => r.room.slice(3).split(':').find((x) => x !== me)!).filter(Boolean);
  const others = otherIds.length ? await ctx.db.select({ id: customers.id, fullName: customers.fullName, gamertag: customers.gamertag, avatarAt: customers.avatarAt }).from(customers).where(inArray(customers.id, otherIds)) : [];
  const names = new Map(others.map((o) => [o.id, publicName(o)]));
  const pics = new Map(others.map((o) => [o.id, avatarUrl(o.id, o.avatarAt)]));
  const threads = lastRows
    .map((r) => {
      const otherId = r.room.slice(3).split(':').find((x) => x !== me)!;
      return {
        to: otherId,
        name: names.get(otherId) ?? 'Player',
        avatarUrl: pics.get(otherId) ?? null,
        lastNumber: r.number,
        lastText: r.deleted ? 'Message removed' : r.body.slice(0, 80),
        lastMine: r.customerId === me,
        lastAt: r.createdAt.toISOString(),
      };
    })
    .sort((a, b) => b.lastNumber - a.lastNumber);
  return { lobby: { to: LOBBY, lastNumber: lobbyLast?.number ?? 0, lastAt: lobbyLast?.createdAt.toISOString() ?? null }, threads };
}

export async function reportMessage(ctx: Ctx, me: string, id: string) {
  const [m] = await ctx.db.select().from(chatMessages).where(eq(chatMessages.id, id));
  if (!m || (m.room !== LOBBY && !m.room.split(':').includes(me))) throw notFound('Message');
  if (m.customerId === me) throw badRequest('You cannot report your own message');
  if (!m.reported) {
    await ctx.db.update(chatMessages).set({ reported: true }).where(eq(chatMessages.id, id));
    ctx.bus.emit({ type: 'alert', level: 'warning', message: 'A chat message was reported — open Chat to check it' });
    ctx.bus.emit({ type: 'chat.changed', room: m.room });
  }
  return { ok: true };
}

// ───────── Staff ─────────

/** Staff: rooms with activity (lobby first), with reported counts. */
export async function staffRooms(ctx: Ctx) {
  const rows = await ctx.db
    .select({
      room: chatMessages.room,
      last: sql<number>`max(${chatMessages.number})`.mapWith(Number),
      count: sql<number>`count(*)`.mapWith(Number),
      reported: sql<number>`count(*) filter (where ${chatMessages.reported} and not ${chatMessages.deleted})`.mapWith(Number),
    })
    .from(chatMessages)
    .groupBy(chatMessages.room)
    .orderBy(desc(sql`max(${chatMessages.number})`))
    .limit(100);
  const ids = [...new Set(rows.flatMap((r) => (r.room.startsWith('dm:') ? r.room.slice(3).split(':') : [])))];
  const ppl = ids.length
    ? await ctx.db.select({ id: customers.id, fullName: customers.fullName, gamertag: customers.gamertag, avatarAt: customers.avatarAt }).from(customers).where(inArray(customers.id, ids))
    : [];
  const names = new Map(ppl.map((p) => [p.id, publicName(p)]));
  const pics = new Map(ppl.map((p) => [p.id, avatarUrl(p.id, p.avatarAt)]));
  const list = rows.map((r) => ({
    room: r.room,
    title: r.room === LOBBY ? 'Lobby (everyone)' : r.room.slice(3).split(':').map((id) => names.get(id) ?? '?').join(' ↔ '),
    lastNumber: r.last,
    count: r.count,
    reported: r.reported,
    people: r.room.startsWith('dm:') ? r.room.slice(3).split(':').map((id) => ({ id, name: names.get(id) ?? '?', avatarUrl: pics.get(id) ?? null })) : [],
  }));
  if (!list.some((r) => r.room === LOBBY)) list.unshift({ room: LOBBY, title: 'Lobby (everyone)', lastNumber: 0, count: 0, reported: 0, people: [] });
  return list.sort((a, b) => (a.room === LOBBY ? -1 : b.room === LOBBY ? 1 : b.lastNumber - a.lastNumber));
}

export async function staffMessages(ctx: Ctx, room: string, after?: number) {
  if (room !== LOBBY && !/^dm:[0-9a-f-]{36}:[0-9a-f-]{36}$/.test(room)) throw badRequest('Unknown chat');
  return { room, messages: await present(ctx, await readRoom(ctx, room, after), { staff: true }) };
}

export async function staffPost(ctx: Ctx, actor: Actor, raw: unknown) {
  const b = z.object({ body: z.string().trim().min(1).max(500) }).parse(raw);
  const [m] = await ctx.db.insert(chatMessages).values({ room: LOBBY, staffId: actor.staffId, body: b.body, createdAt: ctx.clock.now() }).returning();
  ctx.bus.emit({ type: 'chat.changed', room: LOBBY });
  return (await present(ctx, [m], { staff: true }))[0];
}

export async function staffDelete(ctx: Ctx, actor: Actor, id: string) {
  const [m] = await ctx.db.update(chatMessages).set({ deleted: true, reported: false }).where(eq(chatMessages.id, id)).returning();
  if (!m) throw notFound('Message');
  await audit(ctx.db, actor, 'chat.delete', { type: 'chat_message', id }, { room: m.room, body: m.body.slice(0, 200), customerId: m.customerId });
  ctx.bus.emit({ type: 'chat.changed', room: m.room });
  return { ok: true };
}

export async function staffDismissReport(ctx: Ctx, id: string) {
  const [m] = await ctx.db.update(chatMessages).set({ reported: false }).where(eq(chatMessages.id, id)).returning();
  if (!m) throw notFound('Message');
  ctx.bus.emit({ type: 'chat.changed', room: m.room });
  return { ok: true };
}

export async function setMuted(ctx: Ctx, actor: Actor, customerId: string, muted: boolean) {
  const [c] = await ctx.db.update(customers).set({ chatMuted: muted, updatedAt: ctx.clock.now() }).where(eq(customers.id, customerId)).returning({ id: customers.id, name: customers.fullName });
  if (!c) throw notFound('Customer');
  await audit(ctx.db, actor, muted ? 'chat.mute' : 'chat.unmute', { type: 'customer', id: c.id }, { name: c.name });
  ctx.bus.emit({ type: 'chat.changed', room: LOBBY });
  return { ok: true, muted };
}

const ONLINE_MS = 5 * 60_000;

/**
 * Portal: players to message — search by name or gamertag, or browse who is online / playing now.
 * Only app users are listed; only their public name and picture are shown.
 */
export async function customerPeople(ctx: Ctx, me: string, q?: string) {
  await chatOn(ctx);
  const term = (q ?? '').trim().slice(0, 40);
  const rows = await ctx.db
    .select({ id: customers.id, fullName: customers.fullName, gamertag: customers.gamertag, avatarAt: customers.avatarAt, lastSeenAt: customers.lastSeenAt })
    .from(customers)
    .where(
      and(
        ne(customers.id, me),
        isNotNull(customers.passwordHash),
        isNull(customers.deletedAt),
        eq(customers.status, 'active'),
        eq(customers.portalEnabled, true),
        term ? or(ilike(customers.gamertag, `%${term.replace(/[%_\\]/g, '')}%`), ilike(customers.fullName, `%${term.replace(/[%_\\]/g, '')}%`)) : undefined,
      ),
    )
    .orderBy(sql`${customers.lastSeenAt} desc nulls last`)
    .limit(term ? 30 : 60);
  const ids = rows.map((r) => r.id);
  const playing = ids.length
    ? new Set((await ctx.db.select({ id: sessions.customerId }).from(sessions).where(and(inArray(sessions.customerId, ids), ne(sessions.status, 'ended')))).map((r) => r.id))
    : new Set<string | null>();
  const now = ctx.clock.now().getTime();
  return rows
    .map((r) => ({
      id: r.id,
      name: publicName(r),
      avatarUrl: avatarUrl(r.id, r.avatarAt),
      online: !!r.lastSeenAt && now - r.lastSeenAt.getTime() < ONLINE_MS,
      playing: playing.has(r.id),
      lastSeenAt: r.lastSeenAt?.toISOString() ?? null,
    }))
    .sort((a, b) => Number(b.playing || b.online) - Number(a.playing || a.online));
}
