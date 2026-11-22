import jwt from '@fastify/jwt';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DB } from '../db/index.js';
import { customers, staff, staffRoles } from '../db/schema.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { effectivePermissions, type Permission } from './permissions.js';

export interface TokenPayload {
  sub: string;
  tv: number;
  /** 'customer' for customer-portal tokens, 'agent' for station screen apps; absent for staff tokens. */
  typ?: 'customer' | 'agent';
}

export interface AuthedStaff {
  id: string;
  username: string;
  fullName: string;
  role: 'admin' | 'manager' | 'cashier';
  /** Custom user type, if any. */
  roleId: string | null;
  /** Display name of the user type ("Administrator", "Cashier", or the custom type's name). */
  roleName: string;
  permissions: Permission[];
}

export interface AuthedCustomer {
  id: string;
  fullName: string;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: TokenPayload;
    user: TokenPayload;
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    staff?: AuthedStaff;
    customer?: AuthedCustomer;
  }
  interface FastifyInstance {
    /** preHandler that requires a signed-in active staff member (and optionally a permission). */
    auth: (perm?: Permission) => (req: FastifyRequest) => Promise<void>;
    /** preHandler that requires a signed-in customer (portal). */
    customerAuth: () => (req: FastifyRequest) => Promise<void>;
    resolveToken: (token: string) => Promise<AuthedStaff>;
  }
}

export const BUILTIN_ROLE_NAMES = { admin: 'Administrator', manager: 'Manager', cashier: 'Cashier' } as const;

/** Loads a staff row with its custom user type and computes effective permissions. */
export async function loadStaffById(db: DB, id: string) {
  const [r] = await db
    .select({ s: staff, roleName: staffRoles.name, rolePerms: staffRoles.permissions })
    .from(staff)
    .leftJoin(staffRoles, eq(staffRoles.id, staff.roleId))
    .where(eq(staff.id, id));
  if (!r) return null;
  return {
    row: r.s,
    roleName: r.roleName ?? BUILTIN_ROLE_NAMES[r.s.role],
    permissions: effectivePermissions(r.s.role, r.s.permissions, r.s.roleId ? (r.rolePerms ?? []) : null),
  };
}

export async function registerAuth(app: FastifyInstance, db: DB, secret: string) {
  await app.register(jwt, { secret, sign: { expiresIn: '12h' } });

  async function loadStaff(payload: TokenPayload): Promise<AuthedStaff> {
    if (payload.typ) throw unauthorized(); // customer and station-agent tokens never reach staff endpoints
    const r = await loadStaffById(db, payload.sub);
    if (!r || !r.row.active || r.row.tokenVersion !== payload.tv) throw unauthorized('Your session has expired — sign in again');
    return {
      id: r.row.id,
      username: r.row.username,
      fullName: r.row.fullName,
      role: r.row.role,
      roleId: r.row.roleId,
      roleName: r.roleName,
      permissions: r.permissions,
    };
  }

  app.decorate('resolveToken', async (token: string) => {
    let payload: TokenPayload;
    try {
      payload = app.jwt.verify<TokenPayload>(token);
    } catch {
      throw unauthorized();
    }
    return loadStaff(payload);
  });

  app.decorate('auth', (perm?: Permission) => async (req: FastifyRequest) => {
    try {
      await req.jwtVerify();
    } catch {
      throw unauthorized();
    }
    req.staff = await loadStaff(req.user);
    if (perm && !req.staff.permissions.includes(perm)) throw forbidden();
  });

  app.decorate('customerAuth', () => async (req: FastifyRequest) => {
    try {
      await req.jwtVerify();
    } catch {
      throw unauthorized();
    }
    if (req.user.typ !== 'customer') throw unauthorized();
    const [c] = await db.select().from(customers).where(eq(customers.id, req.user.sub));
    if (!c || !c.passwordHash || !c.portalEnabled || c.status !== 'active' || c.portalTokenVersion !== req.user.tv) {
      throw unauthorized('Your session has expired — sign in again');
    }
    req.customer = { id: c.id, fullName: c.fullName };
  });
}

export function actorOf(req: FastifyRequest) {
  return { staffId: req.staff?.id ?? null, ip: req.ip, permissions: req.staff?.permissions ?? [] };
}
