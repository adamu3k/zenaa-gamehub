/**
 * System: backups (download / restore / automatic), version and one-click updates.
 *
 * Updates: ZENAA can't rebuild its own Docker container from inside. The "Update" button writes a request file into
 * UPDATE_DIR (./updates on the server PC); the small updater on the PC (infra/updater/zenaa-updater.ps1, started at
 * logon) sees it, takes a backup, runs `git pull` and `docker compose up -d --build`, and writes its progress back.
 */
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorOf } from '../auth/plugin.js';
import { httpOf, type Ctx } from '../context.js';
import { AppError, badRequest, notFound, parse } from '../lib/errors.js';
import { audit } from '../services/audit.js';
import {
  appVersion,
  BACKUP_DIR,
  backupName,
  createBackup,
  gzipBackup,
  listBackupFiles,
  readBackup,
  restoreBackup,
  safeBackupName,
  writeBackupFile,
} from '../services/backup.js';
import { getKv, getSettings } from '../services/settings.js';

export const UPDATE_DIR = () => process.env.UPDATE_DIR ?? path.resolve(process.cwd(), '..', 'updates');

/** "0.10.2" > "0.9.9" */
export function newer(a: string, b: string) {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

export async function systemRoutes(app: FastifyInstance, ctx: Ctx) {
  const backupPerm = { preHandler: app.auth('system.backup') };
  const updatePerm = { preHandler: app.auth('system.update') };

  app.addContentTypeParser(['application/octet-stream', 'application/gzip', 'application/x-gzip'], { parseAs: 'buffer', bodyLimit: 300 * 1024 * 1024 }, (_req, body, done) =>
    done(null, body),
  );

  app.get('/api/system/info', { preHandler: app.auth() }, async () => {
    const status = await readJson<Record<string, unknown>>(path.join(UPDATE_DIR(), 'status.json'));
    const beat = await stat(path.join(UPDATE_DIR(), 'heartbeat')).catch(() => null);
    return {
      version: await appVersion(),
      backupDir: BACKUP_DIR(),
      lastAutoBackup: await getKv(ctx.db, 'backup_last'),
      updater: {
        installed: !!beat && Date.now() - beat.mtime.getTime() < 3 * 60_000,
        lastSeen: beat?.mtime ?? null,
        status,
      },
    };
  });

  // ───── Backups ─────
  app.get('/api/system/backup', backupPerm, async (req, reply) => {
    const b = await createBackup(ctx);
    const buf = gzipBackup(b);
    await audit(ctx.db, actorOf(req), 'system.backup_download', undefined, { size: buf.length });
    reply
      .header('content-type', 'application/gzip')
      .header('content-disposition', `attachment; filename="${backupName('backup', ctx.clock.now())}"`)
      .header('cache-control', 'no-store');
    return reply.send(buf);
  });

  app.post('/api/system/backups/run', backupPerm, async (req) => {
    const r = await writeBackupFile(ctx, 'manual');
    await audit(ctx.db, actorOf(req), 'system.backup_written', undefined, { name: r.name });
    return r;
  });

  app.get('/api/system/backups', backupPerm, async () => listBackupFiles());

  app.get<{ Params: { name: string } }>('/api/system/backups/:name', backupPerm, async (req, reply) => {
    if (!safeBackupName(req.params.name)) throw badRequest('Bad file name');
    const file = path.join(BACKUP_DIR(), req.params.name);
    await stat(file).catch(() => {
      throw notFound('Backup file');
    });
    reply.header('content-type', 'application/octet-stream').header('content-disposition', `attachment; filename="${req.params.name}"`);
    return reply.send(createReadStream(file));
  });

  /** Restore: upload the .json.gz (body) with ?confirm=RESTORE, or name a file already in the backup folder. */
  app.post('/api/system/restore', { preHandler: app.auth('system.backup'), bodyLimit: 300 * 1024 * 1024 }, async (req) => {
    const qy = parse(z.object({ confirm: z.string(), file: z.string().optional() }), req.query);
    if (qy.confirm !== 'RESTORE') throw badRequest('Type RESTORE to confirm — this replaces all current data');
    let buf: Buffer;
    if (qy.file) {
      if (!safeBackupName(qy.file) || !qy.file.endsWith('.json.gz')) throw badRequest('Choose a ZENAA .json.gz backup');
      buf = await readFile(path.join(BACKUP_DIR(), qy.file));
    } else {
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw badRequest('Upload the backup file');
      buf = req.body;
    }
    const b = readBackup(buf);
    // Safety copy of what is being replaced.
    const safety = await writeBackupFile(ctx, 'before-restore').catch(() => null);
    const actor = actorOf(req);
    const counts = await restoreBackup(ctx, b);
    await audit(ctx.db, { staffId: null, ip: actor.ip }, 'system.restore', undefined, {
      by: req.staff!.username,
      from: b.createdAt,
      appVersion: b.appVersion,
      safetyCopy: safety?.name,
    });
    return { ok: true, restoredFrom: b.createdAt, centerName: b.centerName, counts, safetyCopy: safety?.name ?? null };
  });

  // ───── Updates ─────
  app.get('/api/system/update/check', updatePerm, async () => {
    const s = await getSettings(ctx.db);
    const current = await appVersion();
    if (!s.updateRepo) return { current, configured: false };
    const http = httpOf(ctx);
    const raw = `https://raw.githubusercontent.com/${s.updateRepo}/${encodeURIComponent(s.updateBranch || 'main')}/server/package.json`;
    let latest: string;
    try {
      const r = await http(raw, { signal: AbortSignal.timeout(8000), headers: { 'cache-control': 'no-cache' } });
      if (r.status === 404) throw new AppError(502, `Not found on GitHub: ${s.updateRepo} (${s.updateBranch}). Private repositories need the updater on the PC to check.`, 'update_check');
      if (!r.ok) throw new AppError(502, `GitHub answered ${r.status}`, 'update_check');
      latest = ((await r.json()) as { version: string }).version;
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError(502, `Cannot reach GitHub (${(e as Error).message}) — is the server online?`, 'update_check');
    }
    let notes: string | null = null;
    try {
      const r = await http(`https://api.github.com/repos/${s.updateRepo}/releases/latest`, { signal: AbortSignal.timeout(6000), headers: { accept: 'application/vnd.github+json', 'user-agent': 'zenaa-updater' } });
      if (r.ok) notes = ((await r.json()) as { body?: string }).body ?? null;
    } catch {
      /* release notes are optional */
    }
    return { current, latest, available: newer(latest, current), configured: true, repo: s.updateRepo, branch: s.updateBranch, notes };
  });

  app.post('/api/system/update', updatePerm, async (req) => {
    const s = await getSettings(ctx.db);
    if (!s.updateRepo) throw badRequest('Set the GitHub repository in Settings → System first');
    const dir = UPDATE_DIR();
    await mkdir(dir, { recursive: true });
    const beat = await stat(path.join(dir, 'heartbeat')).catch(() => null);
    if (!beat || Date.now() - beat.mtime.getTime() > 3 * 60_000) {
      throw new AppError(409, 'The updater is not running on the server PC — install it once: infra\\updater\\install-updater.ps1 (Help → 17)', 'updater_missing');
    }
    const request = { id: Date.now().toString(36), requestedAt: ctx.clock.now().toISOString(), by: req.staff!.username, repo: s.updateRepo, branch: s.updateBranch };
    await writeFile(path.join(dir, 'request.json'), JSON.stringify(request, null, 2));
    await audit(ctx.db, actorOf(req), 'system.update_requested', undefined, request);
    return { ok: true, request };
  });
}
