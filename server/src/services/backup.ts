/**
 * One-file backups of everything (all tables) as gzip'd JSON, restorable from Settings on any ZENAA server —
 * same machine or a new PC. Schema-agnostic: it reads/writes every table in the public schema, in foreign-key
 * order, and keeps only the columns both versions know (new columns take their defaults).
 *
 * Automatic backups are written to BACKUP_DIR (Docker: ./backups on the server PC). Point that folder at a
 * Google Drive / OneDrive / Dropbox synced folder and every backup goes to the cloud too.
 */
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { sql } from 'drizzle-orm';
import type { Ctx } from '../context.js';
import type { DbOrTx } from '../db/index.js';
import { badRequest, conflict } from '../lib/errors.js';
import { applyTimezone, getKv, getSettings, setKv } from './settings.js';

export const BACKUP_DIR = () => process.env.BACKUP_DIR ?? path.resolve(process.cwd(), '..', 'backups');

export async function appVersion() {
  try {
    return (JSON.parse(await readFile(path.resolve(process.cwd(), 'package.json'), 'utf8')) as { version: string }).version;
  } catch {
    return '0.0.0';
  }
}

type Rows<T> = { rows: T[] };
const q = async <T>(db: DbOrTx, query: ReturnType<typeof sql>) => ((await db.execute(query)) as unknown as Rows<T>).rows;
const ident = (n: string) => `"${n.replace(/"/g, '""')}"`;

/** App tables, parents before children. */
async function tablesInOrder(db: DbOrTx) {
  const tables = (await q<{ t: string }>(db, sql`select tablename as t from pg_tables where schemaname = 'public' order by tablename`)).map((r) => r.t);
  const fks = await q<{ child: string; parent: string }>(
    db,
    sql`select c.relname as child, p.relname as parent from pg_constraint k
        join pg_class c on c.oid = k.conrelid join pg_class p on p.oid = k.confrelid
        join pg_namespace n on n.oid = c.relnamespace
        where k.contype = 'f' and n.nspname = 'public'`,
  );
  const deps = new Map(tables.map((t) => [t, new Set<string>()]));
  for (const f of fks) if (f.child !== f.parent) deps.get(f.child)?.add(f.parent);
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (t: string) => {
    if (seen.has(t)) return;
    seen.add(t);
    for (const p of deps.get(t) ?? []) visit(p);
    out.push(t);
  };
  tables.forEach(visit);
  return out;
}

async function migrationCount(db: DbOrTx) {
  try {
    const [r] = await q<{ n: number }>(db, sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    return Number(r?.n ?? 0);
  } catch {
    return 0;
  }
}

export interface BackupFile {
  format: 'zenaa-backup';
  version: 1;
  appVersion: string;
  migrations: number;
  createdAt: string;
  centerName: string;
  tables: Record<string, unknown[]>;
}

export async function createBackup(ctx: Ctx): Promise<BackupFile> {
  const tables: Record<string, unknown[]> = {};
  for (const t of await tablesInOrder(ctx.db)) {
    const [r] = await q<{ rows: unknown[] }>(ctx.db, sql.raw(`select coalesce(json_agg(x), '[]'::json) as rows from ${ident(t)} x`));
    tables[t] = (r?.rows as unknown[]) ?? [];
  }
  const s = await getSettings(ctx.db);
  return {
    format: 'zenaa-backup',
    version: 1,
    appVersion: await appVersion(),
    migrations: await migrationCount(ctx.db),
    createdAt: ctx.clock.now().toISOString(),
    centerName: s.centerName,
    tables,
  };
}

export const gzipBackup = (b: BackupFile) => gzipSync(Buffer.from(JSON.stringify(b)));

export function readBackup(buf: Buffer): BackupFile {
  let text: string;
  try {
    text = (buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf).toString('utf8');
  } catch {
    throw badRequest('This file is damaged or is not a ZENAA backup');
  }
  let b: BackupFile;
  try {
    b = JSON.parse(text);
  } catch {
    throw badRequest('This file is not a ZENAA backup (.json.gz from Settings → Backup)');
  }
  if (b?.format !== 'zenaa-backup' || typeof b.tables !== 'object') throw badRequest('This file is not a ZENAA backup');
  return b;
}

export const backupName = (label: string, at: Date) =>
  `zenaa-${label}-${at.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13)}.json.gz`;

/** Replaces ALL data with the backup's. */
export async function restoreBackup(ctx: Ctx, b: BackupFile) {
  const current = await migrationCount(ctx.db);
  if (b.migrations > current) throw conflict(`This backup comes from a newer ZENAA (${b.appVersion}). Update this server first, then restore.`);
  const order = await tablesInOrder(ctx.db);
  const counts: Record<string, number> = {};
  await ctx.db.transaction(async (tx) => {
    await tx.execute(sql.raw(`truncate ${order.map(ident).join(', ')} restart identity cascade`));
    for (const t of order) {
      const rows = (b.tables[t] ?? []) as Record<string, unknown>[];
      counts[t] = rows.length;
      if (!rows.length) continue;
      const cols = (await q<{ c: string }>(tx, sql`select column_name as c from information_schema.columns where table_schema = 'public' and table_name = ${t}`)).map((r) => r.c);
      const keys = new Set<string>();
      for (const r of rows) for (const k of Object.keys(r)) keys.add(k);
      const use = cols.filter((c) => keys.has(c)).map(ident).join(', ');
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = JSON.stringify(rows.slice(i, i + 500));
        await tx.execute(sql`${sql.raw(`insert into ${ident(t)} (${use}) select ${use} from json_populate_recordset(null::${ident(t)}, `)}${chunk}::json)`);
      }
    }
    // Serial counters (customer numbers, receipt numbers…) continue after the restored rows.
    const serials = await q<{ t: string; c: string }>(
      tx,
      sql`select table_name as t, column_name as c from information_schema.columns where table_schema = 'public' and column_default like 'nextval(%'`,
    );
    for (const s of serials) {
      await tx.execute(sql.raw(`select setval(pg_get_serial_sequence('${ident(s.t)}', '${s.c}'), coalesce((select max(${ident(s.c)}) from ${ident(s.t)}), 0) + 1, false)`));
    }
  });
  applyTimezone((await getSettings(ctx.db)).timezone);
  for (const e of ['stations.changed', 'payments.changed', 'competitions.changed', 'momo.changed', 'posts.changed'] as const) ctx.bus.emit({ type: e } as never);
  return counts;
}

// ───────────── Backup folder ─────────────

export async function writeBackupFile(ctx: Ctx, label = 'auto') {
  const dir = BACKUP_DIR();
  await mkdir(dir, { recursive: true });
  const at = ctx.clock.now();
  const name = backupName(label, at);
  const buf = gzipBackup(await createBackup(ctx));
  await writeFile(path.join(dir, `.${name}.partial`), buf);
  const { rename } = await import('node:fs/promises');
  await rename(path.join(dir, `.${name}.partial`), path.join(dir, name));
  return { name, size: buf.length, at };
}

export async function listBackupFiles() {
  const dir = BACKUP_DIR();
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    if (!/^zenaa-.*\.(json\.gz|dump)$/.test(n)) continue;
    const st = await stat(path.join(dir, n));
    out.push({ name: n, size: st.size, at: st.mtime, kind: n.endsWith('.dump') ? 'database' : 'zenaa' });
  }
  return out.sort((a, b) => b.at.getTime() - a.at.getTime());
}

export const safeBackupName = (n: string) => /^zenaa-[\w.-]+\.(json\.gz|dump)$/.test(n) && !n.includes('..');

async function prune(keep: number) {
  const autos = (await listBackupFiles()).filter((f) => f.name.startsWith('zenaa-auto-'));
  for (const f of autos.slice(keep)) await unlink(path.join(BACKUP_DIR(), f.name)).catch(() => {});
}

/** Called every few minutes: writes an automatic backup when one is due. */
export async function autoBackupTick(ctx: Ctx) {
  const s = await getSettings(ctx.db);
  if (!s.autoBackupHours) return null;
  const last = await getKv<{ at: string; name?: string; error?: string }>(ctx.db, 'backup_last');
  const now = ctx.clock.now();
  if (last?.at && now.getTime() - Date.parse(last.at) < s.autoBackupHours * 3600_000) return null;
  try {
    const r = await writeBackupFile(ctx, 'auto');
    await prune(s.autoBackupKeep);
    await setKv(ctx.db, 'backup_last', { at: now.toISOString(), name: r.name, size: r.size });
    return r;
  } catch (e) {
    await setKv(ctx.db, 'backup_last', { at: now.toISOString(), error: (e as Error).message });
    ctx.bus.emit({ type: 'alert', level: 'warning', message: `Automatic backup failed: ${(e as Error).message}` });
    return null;
  }
}
