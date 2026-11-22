import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorOf } from '../auth/plugin.js';
import type { Ctx } from '../context.js';
import { parse } from '../lib/errors.js';
import { changeBooking, createBooking, listBookings } from '../services/bookings.js';

export async function bookingRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/api/bookings', { preHandler: app.auth('stations.view') }, async (req) => {
    const q = parse(
      z.object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        stationId: z.string().uuid().optional(),
        customerId: z.string().uuid().optional(),
        status: z.string().optional(),
      }),
      req.query,
    );
    return listBookings(ctx.db, { ...q, status: q.status ? q.status.split(',') : undefined });
  });

  app.post('/api/bookings', { preHandler: app.auth('bookings.manage') }, async (req) => createBooking(ctx, { source: 'staff', actor: actorOf(req) }, req.body));

  app.post<{ Params: { id: string; action: string } }>('/api/bookings/:id/:action', { preHandler: app.auth('bookings.manage') }, async (req) => {
    const action = z.enum(['confirm', 'cancel', 'no_show']).parse(req.params.action);
    const body = parse(z.object({ reason: z.string().trim().max(200).nullish() }), req.body);
    return changeBooking(ctx, req.params.id, action, { by: 'staff', actor: actorOf(req) }, body.reason);
  });
}
