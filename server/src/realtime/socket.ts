import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import type { Bus } from './bus.js';

/** Forwards bus events to authenticated browsers. Clients re-fetch what changed. */
export function attachRealtime(app: FastifyInstance, bus: Bus) {
  const io = new Server(app.server, { path: '/socket.io', serveClient: false, destroyUpgrade: false });
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (typeof token !== 'string') return next(new Error('unauthorized'));
      socket.data.staff = await app.resolveToken(token);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });
  const off = bus.on((e) => io.emit('event', e));
  app.addHook('onClose', async () => {
    off();
    await io.close();
  });
  return io;
}
