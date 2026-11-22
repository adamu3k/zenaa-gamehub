/** Serves the setup & troubleshooting guides (docs/*.md) to signed-in staff — the in-app Help page. */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { notFound } from '../lib/errors.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function docsDir() {
  const candidates = [process.env.DOCS_DIR, path.resolve(here, '../../../docs')].filter((x): x is string => !!x);
  return candidates.find((d) => existsSync(d)) ?? null;
}

export async function docsRoutes(app: FastifyInstance) {
  app.get('/api/docs', { preHandler: app.auth() }, async () => {
    const dir = docsDir();
    if (!dir) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .sort()
      .map((f) => {
        const text = readFileSync(path.join(dir, f), 'utf8');
        const title = text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? f;
        return { file: f, title };
      });
  });

  app.get<{ Params: { file: string } }>('/api/docs/:file', { preHandler: app.auth() }, async (req) => {
    const dir = docsDir();
    const file = path.basename(req.params.file);
    if (!dir || !file.endsWith('.md') || !existsSync(path.join(dir, file))) throw notFound('Guide');
    return { file, text: readFileSync(path.join(dir, file), 'utf8') };
  });
}
