import { sql } from 'drizzle-orm';
import type { DB } from './db/index.js';
import { staff } from './db/schema.js';
import { hashPassword } from './lib/password.js';
import { audit } from './services/audit.js';

/** Creates the first administrator when the staff table is empty. Never touches existing accounts. */
export async function ensureAdmin(db: DB, username: string, password: string | undefined) {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(staff);
  if (Number(n) > 0) return { created: false as const };
  if (!password) {
    throw new Error('No staff accounts exist yet. Set ADMIN_PASSWORD (min 8 chars) in .env for the first start.');
  }
  const [s] = await db
    .insert(staff)
    .values({ username: username.toLowerCase(), fullName: 'Administrator', role: 'admin', passwordHash: await hashPassword(password) })
    .returning();
  await audit(db, { staffId: null }, 'staff.bootstrap_admin', { type: 'staff', id: s.id }, { username: s.username });
  return { created: true as const, username: s.username };
}
