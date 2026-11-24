/**
 * Phone notifications for customers (Web Push), like a WhatsApp alert: they arrive when the app is closed.
 *
 * The browser gives us a "subscription" (an address at Google / Apple / Mozilla's push service). We send a
 * small encrypted message there, signed with our VAPID key; the phone shows it. Needs:
 *  - the app opened over HTTPS (browsers only allow push on secure pages; http://localhost is the exception),
 *  - internet on the server (the message goes through the push service),
 *  - on iPhone: the app added to the Home Screen (iOS 16.4+).
 * The private VAPID key stays in the database; only the public key is given to browsers.
 */
import { and, eq } from 'drizzle-orm';
import webpush from 'web-push';
import { z } from 'zod';
import { httpOf, type Ctx } from '../context.js';
import { pushSubscriptions } from '../db/schema.js';
import { parse } from '../lib/errors.js';
import { getKv, getSettings, setKv } from './settings.js';

const KV = 'push_vapid';
interface Vapid {
  publicKey: string;
  privateKey: string;
}

async function vapid(ctx: Ctx): Promise<Vapid> {
  const cur = await getKv<Vapid>(ctx.db, KV);
  if (cur?.publicKey && cur.privateKey) return cur;
  const k = webpush.generateVAPIDKeys();
  await setKv(ctx.db, KV, { publicKey: k.publicKey, privateKey: k.privateKey });
  return k;
}

export async function pushPublicKey(ctx: Ctx) {
  return (await vapid(ctx)).publicKey;
}

export const SubscribeSchema = z.object({
  endpoint: z.string().url().max(1000).startsWith('https://'),
  keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
});

export async function subscribe(ctx: Ctx, customerId: string, raw: unknown, userAgent?: string) {
  const b = parse(SubscribeSchema, raw);
  const now = ctx.clock.now();
  await ctx.db
    .insert(pushSubscriptions)
    .values({ customerId, endpoint: b.endpoint, p256dh: b.keys.p256dh, auth: b.keys.auth, userAgent: userAgent?.slice(0, 200) ?? null, createdAt: now })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { customerId, p256dh: b.keys.p256dh, auth: b.keys.auth, createdAt: now } });
  return { ok: true };
}

export async function unsubscribe(ctx: Ctx, customerId: string, endpoint: string) {
  await ctx.db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.customerId, customerId), eq(pushSubscriptions.endpoint, endpoint)));
  return { ok: true };
}

export interface PushMessage {
  title: string;
  body: string;
  /** Page to open when tapped, e.g. /portal/chat?to=… */
  url?: string;
  /** Same tag = replaces the older notification (e.g. one per chat). */
  tag?: string;
}

/** Sends to every phone the customer turned notifications on for. Never throws. */
export async function notifyCustomer(ctx: Ctx, customerId: string | null | undefined, msg: PushMessage): Promise<number> {
  if (!customerId) return 0;
  try {
    const subs = await ctx.db.select().from(pushSubscriptions).where(eq(pushSubscriptions.customerId, customerId));
    if (!subs.length) return 0;
    const keys = await vapid(ctx);
    const s = await getSettings(ctx.db);
    const subject = /^https:\/\//.test(s.publicUrl) ? s.publicUrl : 'https://github.com/adamu3k/zenaa-gamehub';
    const payload = JSON.stringify({ ...msg, center: s.centerName });
    let sent = 0;
    for (const sub of subs) {
      try {
        const d = webpush.generateRequestDetails({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
          vapidDetails: { subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
          TTL: 6 * 3600,
          urgency: 'high',
        });
        const res = await httpOf(ctx)(d.endpoint, { method: d.method, headers: d.headers as Record<string, string>, body: d.body as unknown as BodyInit, signal: AbortSignal.timeout(15_000) });
        if (res.status === 404 || res.status === 410) {
          // The phone unsubscribed or the app was removed.
          await ctx.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
        } else if (res.ok) {
          sent++;
          await ctx.db.update(pushSubscriptions).set({ lastOkAt: ctx.clock.now() }).where(eq(pushSubscriptions.id, sub.id));
        }
      } catch {
        // Offline or a bad subscription: skip this phone.
      }
    }
    return sent;
  } catch {
    return 0;
  }
}

/** Fire-and-forget helper for places that must not wait for the internet. */
export function notifyLater(ctx: Ctx, customerId: string | null | undefined, msg: PushMessage) {
  if (customerId) void notifyCustomer(ctx, customerId, msg);
}
