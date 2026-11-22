import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema.js';

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
export type DbOrTx = DB | Tx;

const here = path.dirname(fileURLToPath(import.meta.url));
/** server/drizzle — same relative location from src/db and dist/db. */
export const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? path.resolve(here, '../../drizzle');

export interface DbHandle {
  db: DB;
  kind: 'postgres' | 'pglite';
  close(): Promise<void>;
}

/**
 * Opens the database and applies pending migrations.
 * - `url` → PostgreSQL (production).
 * - otherwise → PGlite (embedded Postgres) at `pgliteDir`, or in memory when `pgliteDir` is null (tests).
 */
export async function openDatabase(opts: { url?: string; pgliteDir?: string | null }): Promise<DbHandle> {
  if (opts.url) {
    const pg = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');
    const pool = new pg.default.Pool({ connectionString: opts.url, max: 10 });
    const db = drizzle(pool, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    return { db: db as unknown as DB, kind: 'postgres', close: () => pool.end() };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  if (opts.pgliteDir) mkdirSync(opts.pgliteDir, { recursive: true });
  const client = opts.pgliteDir ? new PGlite(opts.pgliteDir) : new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db: db as unknown as DB, kind: 'pglite', close: () => client.close() };
}
