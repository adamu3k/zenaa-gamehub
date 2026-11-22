/**
 * Customer chat, rewards (follow us for a bonus, bonus codes) and outside game news.
 *   Portal:  /api/portal/chat/*, /api/portal/rewards/*
 *   Staff:   /api/chat/*, /api/rewards/*, /api/news-feeds/*
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { actorOf } from '../auth/plugin.js';
import type { Ctx } from '../context.js';
import { parse } from '../lib/errors.js';
import {
  customerMessages,
  customerPost,
  customerThreads,
  LOBBY,
  reportMessage,
  setMuted,
  staffDelete,
  staffDismissReport,
  staffMessages,
  staffPost,
  staffRooms,
} from '../services/chat.js';
import { feedStatus, refreshNow, testFeed } from '../services/newsfeed.js';
import { claimFollow, createOffer, customerRewards, decideClaim, deleteOffer, listClaims, listOffers, pendingClaims, redeemCode, updateOffer } from '../services/rewards.js';

const After = z.object({ after: z.coerce.number().int().min(0).optional() });

export async function communityRoutes(app: FastifyInstance, ctx: Ctx) {
  const player = { preHandler: app.customerAuth() };
  const me = (req: FastifyRequest) => req.customer!.id;

  // ── Chat (portal) ──
  app.get('/api/portal/chat', player, async (req) => customerThreads(ctx, me(req)));
  app.get('/api/portal/chat/messages', player, async (req) => {
    const q = parse(After.extend({ to: z.string().trim().min(1).max(60).default(LOBBY) }), req.query);
    return customerMessages(ctx, me(req), q.to, q.after);
  });
  app.post('/api/portal/chat/messages', player, async (req) => customerPost(ctx, me(req), req.body));
  app.post<{ Params: { id: string } }>('/api/portal/chat/messages/:id/report', player, async (req) => reportMessage(ctx, me(req), req.params.id));

  // ── Chat (staff) ──
  const mod = { preHandler: app.auth('chat.moderate') };
  app.get('/api/chat/rooms', mod, async () => staffRooms(ctx));
  app.get('/api/chat/messages', mod, async (req) => {
    const q = parse(After.extend({ room: z.string().trim().min(1).max(90).default(LOBBY) }), req.query);
    return staffMessages(ctx, q.room, q.after);
  });
  app.post('/api/chat/messages', mod, async (req) => staffPost(ctx, actorOf(req), req.body));
  app.delete<{ Params: { id: string } }>('/api/chat/messages/:id', mod, async (req) => staffDelete(ctx, actorOf(req), req.params.id));
  app.post<{ Params: { id: string } }>('/api/chat/messages/:id/keep', mod, async (req) => staffDismissReport(ctx, req.params.id));
  app.post('/api/chat/mute', mod, async (req) => {
    const b = parse(z.object({ customerId: z.string().uuid(), muted: z.boolean() }), req.body);
    return setMuted(ctx, actorOf(req), b.customerId, b.muted);
  });

  // ── Rewards (portal) ──
  app.get('/api/portal/rewards', player, async (req) => customerRewards(ctx, me(req)));
  app.post<{ Params: { id: string } }>('/api/portal/rewards/:id/claim', player, async (req) => claimFollow(ctx, me(req), req.params.id, req.body, req.ip));
  app.post('/api/portal/rewards/code', player, async (req) => redeemCode(ctx, me(req), req.body, req.ip));

  // ── Rewards (staff) ──
  const rw = { preHandler: app.auth('rewards.manage') };
  app.get('/api/rewards', rw, async () => ({ offers: await listOffers(ctx), pending: await pendingClaims(ctx) }));
  app.post('/api/rewards', rw, async (req) => createOffer(ctx, actorOf(req), req.body));
  app.patch<{ Params: { id: string } }>('/api/rewards/:id', rw, async (req) => updateOffer(ctx, actorOf(req), req.params.id, req.body));
  app.delete<{ Params: { id: string } }>('/api/rewards/:id', rw, async (req) => deleteOffer(ctx, actorOf(req), req.params.id));
  app.get('/api/rewards/claims', rw, async (req) => {
    const q = parse(z.object({ status: z.enum(['pending', 'all']).default('pending') }), req.query);
    return listClaims(ctx, q.status);
  });
  app.post<{ Params: { id: string } }>('/api/rewards/claims/:id/approve', rw, async (req) => decideClaim(ctx, actorOf(req), req.params.id, true));
  app.post<{ Params: { id: string } }>('/api/rewards/claims/:id/reject', rw, async (req) => {
    const b = parse(z.object({ note: z.string().trim().max(200).nullish() }), req.body);
    return decideClaim(ctx, actorOf(req), req.params.id, false, b.note);
  });

  // ── Outside game news (staff) ──
  const content = { preHandler: app.auth('content.manage') };
  app.get('/api/news-feeds', content, async () => feedStatus(ctx));
  app.post('/api/news-feeds/refresh', content, async () => refreshNow(ctx));
  app.post('/api/news-feeds/test', content, async (req) => {
    const b = parse(z.object({ url: z.string().trim().url().max(300).regex(/^https?:\/\//i, 'Use an http(s) address') }), req.body);
    return testFeed(ctx, b.url);
  });
}
