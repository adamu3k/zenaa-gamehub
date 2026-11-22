import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorOf, BUILTIN_ROLE_NAMES, loadStaffById } from '../auth/plugin.js';
import { ALL_PERMISSIONS, PERMISSIONS, ROLE_DEFAULTS, effectivePermissions } from '../auth/permissions.js';
import type { Ctx } from '../context.js';
import { staff, staffRoles } from '../db/schema.js';
import { AppError, badRequest, conflict, notFound, parse, unauthorized } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { audit } from '../services/audit.js';
import { PIN_ACTIONS, PinSchema, setPin, verifyPin } from '../services/pins.js';

const LoginSchema = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(200) });
const PasswordSchema = z.string().min(8, 'Password must be at least 8 characters').max(200);

const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;

export async function authRoutes(app: FastifyInstance, ctx: Ctx) {
  const failures = new Map<string, { count: number; until: number }>();

  app.post('/api/auth/login', async (req) => {
    const body = parse(LoginSchema, req.body);
    const username = body.username.trim().toLowerCase();
    const key = `${req.ip}|${username}`;
    const f = failures.get(key);
    if (f && f.count >= MAX_FAILURES && f.until > Date.now()) {
      throw new AppError(429, 'Too many failed attempts. Try again in 15 minutes.', 'locked');
    }
    const [s] = await ctx.db.select().from(staff).where(eq(staff.username, username));
    const ok = s && s.active && (await verifyPassword(body.password, s.passwordHash));
    if (!ok) {
      const next = { count: (f && f.until > Date.now() ? f.count : 0) + 1, until: Date.now() + LOCK_MS };
      failures.set(key, next);
      await audit(ctx.db, { staffId: s?.id ?? null, ip: req.ip }, 'auth.login_failed', undefined, { username });
      throw unauthorized('Incorrect username or password');
    }
    failures.delete(key);
    await ctx.db.update(staff).set({ lastLoginAt: ctx.clock.now() }).where(eq(staff.id, s.id));
    await audit(ctx.db, { staffId: s.id, ip: req.ip }, 'auth.login');
    const token = app.jwt.sign({ sub: s.id, tv: s.tokenVersion });
    const full = (await loadStaffById(ctx.db, s.id))!;
    return {
      token,
      staff: { id: s.id, username: s.username, fullName: s.fullName, role: s.role, roleId: s.roleId, roleName: full.roleName, permissions: full.permissions },
    };
  });

  app.get('/api/auth/me', { preHandler: app.auth() }, async (req) => {
    const [s] = await ctx.db.select({ pinSetAt: staff.pinSetAt }).from(staff).where(eq(staff.id, req.staff!.id));
    return { ...req.staff, hasPin: !!s?.pinSetAt };
  });

  /** Set or change your own PIN (needs your password). */
  app.post('/api/auth/pin', { preHandler: app.auth() }, async (req) => {
    const body = parse(z.object({ password: z.string().min(1), pin: PinSchema }), req.body);
    const [s] = await ctx.db.select().from(staff).where(eq(staff.id, req.staff!.id));
    if (!(await verifyPassword(body.password, s.passwordHash))) throw badRequest('Password is incorrect');
    await setPin(ctx.db, s.id, body.pin, ctx.clock.now());
    await audit(ctx.db, actorOf(req), 'auth.pin_set', { type: 'staff', id: s.id });
    return { ok: true };
  });

  /** Check a PIN (e.g. the counter "who is this?" prompt). Returns who it belongs to. */
  app.post('/api/auth/pin/check', { preHandler: app.auth() }, async (req) => {
    const who = await verifyPin(ctx.db, (req.body as { pin?: unknown })?.pin, `staff:${req.staff!.id}`);
    return { id: who.id, fullName: who.fullName, roleName: who.roleName };
  });

  app.get('/api/pin-actions', { preHandler: app.auth() }, async () => Object.entries(PIN_ACTIONS).map(([key, label]) => ({ key, label })));

  app.post('/api/auth/change-password', { preHandler: app.auth() }, async (req) => {
    const body = parse(z.object({ currentPassword: z.string(), newPassword: PasswordSchema }), req.body);
    const [s] = await ctx.db.select().from(staff).where(eq(staff.id, req.staff!.id));
    if (!(await verifyPassword(body.currentPassword, s.passwordHash))) throw badRequest('Current password is incorrect');
    await ctx.db
      .update(staff)
      .set({ passwordHash: await hashPassword(body.newPassword), tokenVersion: s.tokenVersion + 1 })
      .where(eq(staff.id, s.id));
    await audit(ctx.db, actorOf(req), 'auth.password_changed', { type: 'staff', id: s.id });
    return { ok: true, token: app.jwt.sign({ sub: s.id, tv: s.tokenVersion + 1 }) };
  });

  // ── Staff management ──
  const rolePerms = async () => new Map((await ctx.db.select().from(staffRoles)).map((r) => [r.id, r]));
  const publicStaff = (s: typeof staff.$inferSelect, roles: Map<string, typeof staffRoles.$inferSelect>) => ({
    id: s.id,
    username: s.username,
    fullName: s.fullName,
    role: s.role,
    roleId: s.roleId,
    roleName: (s.roleId && roles.get(s.roleId)?.name) || BUILTIN_ROLE_NAMES[s.role],
    active: s.active,
    permissions: s.permissions,
    effectivePermissions: effectivePermissions(s.role, s.permissions, s.roleId ? (roles.get(s.roleId)?.permissions ?? []) : null),
    lastLoginAt: s.lastLoginAt,
    hasPin: !!s.pinSetAt,
    createdAt: s.createdAt,
  });

  app.get('/api/permissions', { preHandler: app.auth('staff.manage') }, async () => ({
    permissions: ALL_PERMISSIONS.map((key) => ({ key, label: PERMISSIONS[key] })),
    roleDefaults: ROLE_DEFAULTS,
  }));

  app.get('/api/staff', { preHandler: app.auth('staff.manage') }, async () => {
    const roles = await rolePerms();
    return (await ctx.db.select().from(staff).orderBy(asc(staff.fullName))).map((s) => publicStaff(s, roles));
  });

  // ── Custom user types ──
  const RoleBody = z.object({
    name: z.string().trim().min(2).max(40),
    description: z.string().trim().max(200).nullish(),
    permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])),
  });
  const reservedName = (n: string) => Object.values(BUILTIN_ROLE_NAMES).some((b) => b.toLowerCase() === n.toLowerCase()) || ['admin'].includes(n.toLowerCase());

  app.get('/api/staff-roles', { preHandler: app.auth('staff.manage') }, async () => {
    const roles = await ctx.db.select().from(staffRoles).orderBy(asc(staffRoles.name));
    const counts = await ctx.db.select({ roleId: staff.roleId }).from(staff);
    return roles.map((r) => ({ ...r, members: counts.filter((c) => c.roleId === r.id).length }));
  });

  app.post('/api/staff-roles', { preHandler: app.auth('staff.manage') }, async (req) => {
    const body = parse(RoleBody, req.body);
    if (reservedName(body.name)) throw badRequest('That name is used by a built-in role');
    const [r] = await ctx.db.insert(staffRoles).values(body).returning();
    await audit(ctx.db, actorOf(req), 'staff_role.create', { type: 'staff_role', id: r.id }, body);
    return r;
  });

  app.patch<{ Params: { id: string } }>('/api/staff-roles/:id', { preHandler: app.auth('staff.manage') }, async (req) => {
    const body = parse(RoleBody.partial(), req.body);
    if (body.name && reservedName(body.name)) throw badRequest('That name is used by a built-in role');
    const [r] = await ctx.db.update(staffRoles).set(body).where(eq(staffRoles.id, req.params.id)).returning();
    if (!r) throw notFound('User type');
    await audit(ctx.db, actorOf(req), 'staff_role.update', { type: 'staff_role', id: r.id }, body);
    return r;
  });

  app.delete<{ Params: { id: string } }>('/api/staff-roles/:id', { preHandler: app.auth('staff.manage') }, async (req) => {
    const [used] = await ctx.db.select({ id: staff.id }).from(staff).where(eq(staff.roleId, req.params.id)).limit(1);
    if (used) throw conflict('Move the staff using this user type to another type first');
    const [r] = await ctx.db.delete(staffRoles).where(eq(staffRoles.id, req.params.id)).returning();
    if (!r) throw notFound('User type');
    await audit(ctx.db, actorOf(req), 'staff_role.delete', { type: 'staff_role', id: r.id }, { name: r.name });
    return { ok: true };
  });

  const Overrides = z.object({ grant: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])), revoke: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])) });

  app.post('/api/staff', { preHandler: app.auth('staff.manage') }, async (req) => {
    const body = parse(
      z.object({
        username: z.string().regex(/^[a-zA-Z0-9._-]{3,32}$/, 'Username: 3–32 letters, digits, . _ -'),
        fullName: z.string().min(1).max(80),
        role: z.enum(['admin', 'manager', 'cashier']),
        roleId: z.string().uuid().nullish(),
        password: PasswordSchema,
        permissions: Overrides.optional(),
      }),
      req.body,
    );
    const username = body.username.toLowerCase();
    const [exists] = await ctx.db.select({ id: staff.id }).from(staff).where(eq(staff.username, username));
    if (exists) throw conflict('That username is taken');
    const [s] = await ctx.db
      .insert(staff)
      .values({
        username,
        fullName: body.fullName,
        role: body.roleId ? 'cashier' : body.role,
        roleId: body.roleId ?? null,
        passwordHash: await hashPassword(body.password),
        permissions: body.permissions ?? { grant: [], revoke: [] },
      })
      .returning();
    await audit(ctx.db, actorOf(req), 'staff.create', { type: 'staff', id: s.id }, { username, role: s.role, roleId: s.roleId });
    return publicStaff(s, await rolePerms());
  });

  app.patch<{ Params: { id: string } }>('/api/staff/:id', { preHandler: app.auth('staff.manage') }, async (req) => {
    const body = parse(
      z.object({
        fullName: z.string().min(1).max(80).optional(),
        role: z.enum(['admin', 'manager', 'cashier']).optional(),
        roleId: z.string().uuid().nullish(),
        active: z.boolean().optional(),
        permissions: Overrides.optional(),
      }),
      req.body,
    );
    const [s] = await ctx.db.select().from(staff).where(eq(staff.id, req.params.id));
    if (!s) throw notFound('Staff member');
    if (body.roleId) body.role = 'cashier';
    else if (body.role) body.roleId = null;
    if (s.id === req.staff!.id && (body.active === false || (body.role && body.role !== 'admin' && s.role === 'admin'))) {
      throw badRequest('You cannot deactivate or demote your own account');
    }
    const revoke = body.active === false || (body.role && body.role !== s.role) || (body.roleId !== undefined && body.roleId !== s.roleId);
    const [u] = await ctx.db
      .update(staff)
      .set({ ...body, tokenVersion: revoke ? s.tokenVersion + 1 : s.tokenVersion })
      .where(eq(staff.id, s.id))
      .returning();
    await audit(ctx.db, actorOf(req), 'staff.update', { type: 'staff', id: s.id }, body);
    return publicStaff(u, await rolePerms());
  });

  /** Admin: set or remove someone's PIN. */
  app.post<{ Params: { id: string } }>('/api/staff/:id/pin', { preHandler: app.auth('staff.manage') }, async (req) => {
    const body = parse(z.object({ pin: PinSchema.nullable() }), req.body);
    const [s] = await ctx.db.select().from(staff).where(eq(staff.id, req.params.id));
    if (!s) throw notFound('Staff member');
    await setPin(ctx.db, s.id, body.pin, ctx.clock.now());
    await audit(ctx.db, actorOf(req), body.pin ? 'staff.pin_set' : 'staff.pin_cleared', { type: 'staff', id: s.id });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/staff/:id/reset-password', { preHandler: app.auth('staff.manage') }, async (req) => {
    const body = parse(z.object({ password: PasswordSchema }), req.body);
    const [s] = await ctx.db.select().from(staff).where(eq(staff.id, req.params.id));
    if (!s) throw notFound('Staff member');
    await ctx.db
      .update(staff)
      .set({ passwordHash: await hashPassword(body.password), tokenVersion: s.tokenVersion + 1 })
      .where(eq(staff.id, s.id));
    await audit(ctx.db, actorOf(req), 'staff.reset_password', { type: 'staff', id: s.id });
    return { ok: true };
  });
}
