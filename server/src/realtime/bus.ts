import { EventEmitter } from 'node:events';

export type BusEvent =
  | { type: 'stations.changed'; stationId?: string }
  | { type: 'sessions.changed'; sessionId: string; stationId?: string }
  | { type: 'customers.changed'; customerId: string }
  | { type: 'payments.changed' }
  | { type: 'power.changed'; stationId: string }
  | { type: 'bookings.changed'; bookingId?: string; stationId?: string }
  | { type: 'competitions.changed' }
  | { type: 'momo.changed' }
  | { type: 'posts.changed' }
  | { type: 'chat.changed'; room: string }
  | { type: 'rewards.changed' }
  | { type: 'social.changed' }
  | {
      type: 'alert';
      level: 'info' | 'warning' | 'critical';
      message: string;
      stationId?: string;
      sessionId?: string;
      /** Counter PC: play this sound and read `speak` aloud (when turned on there). */
      sound?: 'warning' | 'timeup' | 'promo';
      speak?: string;
    };

/** In-process event bus. The WebSocket layer forwards these to connected browsers. */
export class Bus {
  private ee = new EventEmitter();
  constructor() {
    this.ee.setMaxListeners(50);
  }
  emit(e: BusEvent) {
    this.ee.emit('event', e);
  }
  on(fn: (e: BusEvent) => void) {
    this.ee.on('event', fn);
    return () => this.ee.off('event', fn);
  }
}
