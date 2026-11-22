import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorOf } from '../auth/plugin.js';
import type { Ctx } from '../context.js';
import { socialPosts } from '../db/schema.js';
import { parse } from '../lib/errors.js';
import { audit } from '../services/audit.js';
import { outsideNews, refreshNow } from '../services/newsfeed.js';
import {
  accountStatus,
  checkAccounts,
  fetchImage,
  getPost,
  ideasNow,
  insights,
  listPosts,
  markPosted,
  mediaFile,
  PostBody,
  publishPost,
  saveAccounts,
} from '../services/social.js';

/** Social page (permission social.manage): ideas, drafts, graphics, posting, accounts, page numbers. */
export async function socialRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = { preHandler: app.auth('social.manage') };
  const big = { ...auth, bodyLimit: 5_000_000 };

  app.get<{ Querystring: { status?: string } }>('/api/social/posts', auth, async (req) => listPosts(ctx, req.query.status));
  app.get<{ Params: { id: string } }>('/api/social/posts/:id', auth, async (req) => getPost(ctx, req.params.id));

  app.post('/api/social/posts', big, async (req) => {
    const b = parse(PostBody, req.body);
    const [row] = await ctx.db
      .insert(socialPosts)
      .values({ ...b, status: b.status ?? 'draft', source: 'custom', createdBy: actorOf(req).staffId, createdAt: ctx.clock.now(), updatedAt: ctx.clock.now() })
      .returning();
    ctx.bus.emit({ type: 'social.changed' });
    return row;
  });

  app.patch<{ Params: { id: string } }>('/api/social/posts/:id', big, async (req) => {
    const b = parse(PostBody.partial(), req.body);
    const cur = await getPost(ctx, req.params.id);
    const [row] = await ctx.db
      .update(socialPosts)
      .set({ ...b, ...(b.status === undefined && cur.status === 'idea' && (b.fields || b.caption) ? { status: 'draft' } : {}), updatedAt: ctx.clock.now() })
      .where(eq(socialPosts.id, cur.id))
      .returning();
    ctx.bus.emit({ type: 'social.changed' });
    return row;
  });

  app.delete<{ Params: { id: string } }>('/api/social/posts/:id', auth, async (req) => {
    await ctx.db.delete(socialPosts).where(eq(socialPosts.id, req.params.id));
    ctx.bus.emit({ type: 'social.changed' });
    return { ok: true };
  });

  /** "Get ideas now": reads the news feeds and makes ideas from stories not used yet. */
  app.post('/api/social/ideas', auth, async () => {
    const fresh = await refreshNow(ctx).catch(() => null);
    const items = (await outsideNews(ctx)).length ? await outsideNews(ctx) : ((fresh?.items as any[]) ?? []);
    const rows = await ideasNow(ctx, items);
    return { created: rows.length, feeds: fresh?.status ?? [] };
  });

  app.post<{ Params: { id: string } }>('/api/social/posts/:id/publish', { ...auth, bodyLimit: 80_000_000 }, async (req) => {
    const out = await publishPost(ctx, req.params.id, req.body, actorOf(req).staffId);
    await audit(ctx.db, actorOf(req), 'social.publish', { type: 'social_post', id: req.params.id }, { results: out.results.map((r) => ({ platform: r.platform, ok: r.ok, error: r.error })) });
    return out;
  });

  app.post<{ Params: { id: string } }>('/api/social/posts/:id/mark-posted', auth, async (req) => {
    const b = parse(z.object({ platforms: z.array(z.string().trim().min(2).max(30)).min(1).max(10) }), req.body);
    return markPosted(ctx, req.params.id, b.platforms);
  });

  /** News pictures, fetched by the server so the browser can draw them into graphics. */
  app.get<{ Querystring: { url?: string } }>('/api/social/image', auth, async (req, reply) => {
    const q = parse(z.object({ url: z.string().url().max(2000) }), req.query);
    const img = await fetchImage(ctx, q.url);
    reply.header('content-type', img.type).header('cache-control', 'private, max-age=86400');
    return reply.send(img.buf);
  });

  /** Posted files, for Instagram to download (needs the random key). */
  app.get<{ Params: { id: string }; Querystring: { k?: string } }>('/api/social/media/:id', async (req, reply) => {
    const f = await mediaFile(ctx, req.params.id, String(req.query.k ?? ''));
    reply.header('content-type', f.mime).header('cache-control', 'public, max-age=86400');
    return reply.send(f.buf);
  });

  app.get('/api/social/accounts', auth, async () => accountStatus(ctx));
  app.put('/api/social/accounts', auth, async (req) => {
    const out = await saveAccounts(ctx, req.body);
    const b = (req.body ?? {}) as Record<string, unknown>;
    await audit(ctx.db, actorOf(req), 'social.accounts', undefined, {
      changed: Object.keys(b).filter((k) => b[k] !== undefined && b[k] !== ''),
      // Tokens are never written to the audit trail.
    });
    return out;
  });
  app.post('/api/social/accounts/check', auth, async () => checkAccounts(ctx));
  app.get<{ Querystring: { force?: string } }>('/api/social/insights', auth, async (req) => insights(ctx, req.query.force === '1'));
}
