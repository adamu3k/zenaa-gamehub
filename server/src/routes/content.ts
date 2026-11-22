/**
 * News, events and promotions for the customer portal, social links, and QR codes for posters.
 */
import { and, desc, eq, gt, isNull, lte, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import QRCode from 'qrcode';
import { z } from 'zod';
import { actorOf } from '../auth/plugin.js';
import type { Ctx } from '../context.js';
import { posts } from '../db/schema.js';
import { badRequest, notFound, parse } from '../lib/errors.js';
import { audit } from '../services/audit.js';
import { outsideNews } from '../services/newsfeed.js';
import { getSettings } from '../services/settings.js';

const IMAGE_RE = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/;

const PostBody = z.object({
  kind: z.enum(['news', 'event', 'promo', 'tournament', 'announcement']).default('news'),
  title: z.string().trim().min(2).max(120),
  body: z.string().trim().max(5000).default(''),
  image: z
    .string()
    .max(1_500_000, 'Image too large — use a smaller picture')
    .regex(IMAGE_RE, 'Image must be a JPEG, PNG, WebP or GIF')
    .nullish(),
  linkUrl: z
    .string()
    .trim()
    .max(300)
    .regex(/^(https?:\/\/|\/)/, 'Link must start with https:// or /')
    .or(z.literal(''))
    .nullish(),
  linkLabel: z.string().trim().max(40).nullish(),
  eventAt: z.coerce.date().nullish(),
  pinned: z.boolean().default(false),
  published: z.boolean().default(true),
  publishAt: z.coerce.date().nullish(),
  expiresAt: z.coerce.date().nullish(),
});

/** Public shape: the image is served from its own URL so lists stay small. */
export function publicPost(p: typeof posts.$inferSelect) {
  const { image, ...rest } = p;
  return { ...rest, imageUrl: image ? `/api/posts/${p.id}/image?v=${p.updatedAt.getTime()}` : null };
}

export async function livePosts(ctx: Ctx, limit = 30) {
  const now = ctx.clock.now();
  const rows = await ctx.db
    .select()
    .from(posts)
    .where(
      and(
        eq(posts.published, true),
        or(isNull(posts.publishAt), lte(posts.publishAt, now)),
        or(isNull(posts.expiresAt), gt(posts.expiresAt, now)),
      ),
    )
    .orderBy(desc(posts.pinned), desc(posts.createdAt))
    .limit(limit);
  return rows.map(publicPost);
}

export async function contentRoutes(app: FastifyInstance, ctx: Ctx) {
  // ── Staff ──
  const manage = { preHandler: app.auth('content.manage') };
  app.get('/api/posts', manage, async () => (await ctx.db.select().from(posts).orderBy(desc(posts.createdAt)).limit(200)).map(publicPost));
  app.post('/api/posts', { ...manage, bodyLimit: 2_500_000 }, async (req) => {
    const b = parse(PostBody, req.body);
    const now = ctx.clock.now();
    const [p] = await ctx.db
      .insert(posts)
      .values({ ...b, linkUrl: b.linkUrl || null, createdBy: req.staff!.id, createdAt: now, updatedAt: now })
      .returning();
    await audit(ctx.db, actorOf(req), 'post.create', { type: 'post', id: p.id }, { title: p.title, kind: p.kind });
    ctx.bus.emit({ type: 'posts.changed' });
    return publicPost(p);
  });
  app.patch<{ Params: { id: string } }>('/api/posts/:id', { ...manage, bodyLimit: 2_500_000 }, async (req) => {
    const b = parse(PostBody.partial(), req.body);
    const [p] = await ctx.db
      .update(posts)
      .set({ ...b, ...(b.linkUrl !== undefined ? { linkUrl: b.linkUrl || null } : {}), updatedAt: ctx.clock.now() })
      .where(eq(posts.id, req.params.id))
      .returning();
    if (!p) throw notFound('Post');
    await audit(ctx.db, actorOf(req), 'post.update', { type: 'post', id: p.id }, { title: p.title });
    ctx.bus.emit({ type: 'posts.changed' });
    return publicPost(p);
  });
  app.delete<{ Params: { id: string } }>('/api/posts/:id', manage, async (req) => {
    const [p] = await ctx.db.delete(posts).where(eq(posts.id, req.params.id)).returning();
    if (!p) throw notFound('Post');
    await audit(ctx.db, actorOf(req), 'post.delete', { type: 'post', id: p.id }, { title: p.title });
    ctx.bus.emit({ type: 'posts.changed' });
    return { ok: true };
  });

  // ── Public (portal, venue TV, visitors) ──
  app.get('/api/public/news', async () => {
    const s = await getSettings(ctx.db);
    // Stories with a blocked word (Settings → Customer chat) are left out.
    const blocked = s.chatBlockedWords.map((w) => w.toLowerCase());
    const outside =
      s.newsFeedCount > 0
        ? (await outsideNews(ctx)).filter((i) => !blocked.some((w) => `${i.title} ${i.summary}`.toLowerCase().includes(w))).slice(0, s.newsFeedCount + 10)
        : [];
    return { centerName: s.centerName, socialLinks: s.socialLinks, posts: await livePosts(ctx), outside, outsideShow: s.newsFeedCount };
  });
  app.get<{ Params: { id: string } }>('/api/posts/:id/image', async (req, reply) => {
    const [p] = await ctx.db.select({ image: posts.image }).from(posts).where(eq(posts.id, req.params.id));
    const m = p?.image && /^data:(image\/[a-z]+);base64,(.+)$/.exec(p.image);
    if (!m) throw notFound('Image');
    reply.header('content-type', m[1]).header('cache-control', 'public, max-age=604800, immutable');
    return reply.send(Buffer.from(m[2], 'base64'));
  });

  /** QR code (SVG) for posters and the counter: sign-up, MoMo top-up, socials… */
  app.get('/api/qr', async (req, reply) => {
    const q = parse(z.object({ text: z.string().min(1).max(500) }), req.query);
    if (/[\r\n]/.test(q.text)) throw badRequest('One line only');
    const svg = await QRCode.toString(q.text, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    reply.header('content-type', 'image/svg+xml').header('cache-control', 'private, max-age=3600');
    return reply.send(svg);
  });
}
