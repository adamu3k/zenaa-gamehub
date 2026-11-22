import type { DB } from './db/index.js';
import type { Clock } from './lib/clock.js';
import type { Bus } from './realtime/bus.js';
import { AppError } from './lib/errors.js';

/** Dependencies shared by all services. Injected so tests can control the clock. */
export interface Ctx {
  db: DB;
  clock: Clock;
  bus: Bus;
  /** HTTP client for smart plugs and Paystack. Injected in tests; defaults to global fetch. */
  fetch?: typeof fetch;
}

export const httpOf = (ctx: Ctx): typeof fetch => ctx.fetch ?? fetch;

/** Who is performing an action (null staffId = the system itself). */
export interface Actor {
  staffId: string | null;
  ip?: string;
  /** Effective permissions of the staff member (empty for the system). */
  permissions?: readonly string[];
  /** Staff member who approved this action with their PIN (manager override). */
  approvedBy?: string | null;
}

export function requirePermission(actor: Actor, perm: string, what: string) {
  if (!actor.permissions?.includes(perm)) throw new AppError(403, `You do not have permission to ${what}`, 'forbidden');
}
