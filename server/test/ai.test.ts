/**
 * v0.9.5 — AI assistant for Social graphics (Claude or OpenAI), with the internet mocked.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { ensureAdmin } from '../src/bootstrap.js';
import { openDatabase, type DbHandle } from '../src/db/index.js';
import { ManualClock } from '../src/lib/clock.js';
import { Bus } from '../src/realtime/bus.js';

let handle: DbHandle;
let app: FastifyInstance;
let admin = '';
const seen: { url: string; body: any; headers: Record<string, string> }[] = [];
let reply = '{"template":"","fields":{"headline":"FIFA FRIDAY"},"caption":"See you Friday!","note":"New headline"}';

const fakeFetch = (async (input: any, init?: any) => {
  const url = String(input?.url ?? input);
  const body = JSON.parse(String(init?.body ?? '{}'));
  const headers: Record<string, string> = {};
  new Headers(init?.headers ?? {}).forEach((v, k) => (headers[k] = v));
  seen.push({ url, body, headers });
  if (url.includes('anthropic.com')) {
    return new Response(
      JSON.stringify({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: body.model,
        content: [{ type: 'text', text: reply }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }
  return new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

async function call(token: string, method: string, url: string, payload?: unknown) {
  const res = await app.inject({ method: method as any, url, payload: payload as any, headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: res.statusCode, body: res.json() as any };
}
const ok = async (token: string, method: string, url: string, payload?: unknown) => {
  const r = await call(token, method, url, payload);
  if (r.status !== 200) throw new Error(`${method} ${url} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const edit = {
  instruction: 'Make it about FIFA Friday',
  template: 'news',
  fields: { headline: 'OLD', sub: 'keep me' },
  fieldDefs: [
    { key: 'headline', label: 'Headline', kind: 'text' },
    { key: 'sub', label: 'Line', kind: 'text' },
    { key: 'imageUrl', label: 'Picture', kind: 'image' },
  ],
  looks: [{ key: 'news', label: 'News', group: 'News' }],
};

beforeAll(async () => {
  handle = await openDatabase({ pgliteDir: null });
  app = await buildApp({ db: handle.db, clock: new ManualClock(Date.parse('2026-05-04T12:00:00Z')), bus: new Bus(), fetch: fakeFetch } as any, {
    jwtSecret: 'test-secret-test-secret-test-secret-123',
  });
  await ensureAdmin(handle.db, 'admin', 'admin-pass-123');
  admin = (await ok('', 'POST', '/api/auth/login', { username: 'admin', password: 'admin-pass-123' })).token;
});
afterAll(async () => {
  await app?.close();
  await handle?.close();
});

describe('AI assistant', () => {
  it('asks to connect first, and never shows the key', async () => {
    expect((await call(admin, 'POST', '/api/social/ai/edit', edit)).status).toBe(400);
    const c = await ok(admin, 'PUT', '/api/social/ai', { provider: 'anthropic', apiKey: 'sk-ant-test-1234ABCD' });
    expect(c).toMatchObject({ connected: true, keyHint: '…ABCD', model: 'claude-opus-5-5' });
    expect(JSON.stringify(await ok(admin, 'GET', '/api/social/ai'))).not.toContain('sk-ant-test');
  });

  it('edits the text with Claude and keeps only known fields', async () => {
    reply = '{"template":"","fields":{"headline":"FIFA FRIDAY","hacker":"x"},"caption":"See you Friday!","note":"New headline"}';
    const r = await ok(admin, 'POST', '/api/social/ai/edit', edit);
    expect(r).toMatchObject({ template: null, fields: { headline: 'FIFA FRIDAY' }, caption: 'See you Friday!' });
    expect(r.fields.hacker).toBeUndefined();
    const sent = seen.at(-1)!;
    expect(sent.url).toContain('api.anthropic.com/v1/messages');
    expect(sent.headers['x-api-key'] ?? sent.headers.authorization).toMatch(/sk-ant-test-1234ABCD/);
    expect(sent.body.model).toBe('claude-opus-5-5');
    expect(JSON.stringify(sent.body)).not.toContain('imageUrl');
  });

  it('works with OpenAI too, keeping the saved key when only the model changes', async () => {
    await ok(admin, 'PUT', '/api/social/ai', { provider: 'openai', apiKey: 'sk-openai-9999' });
    await ok(admin, 'PUT', '/api/social/ai', { provider: 'openai', apiKey: '', model: 'gpt-4o-mini' });
    reply = '{"fields":{"sub":"Prize GH₵500"},"note":"ok"}';
    const r = await ok(admin, 'POST', '/api/social/ai/edit', edit);
    expect(r.fields).toEqual({ sub: 'Prize GH₵500' });
    expect(seen.at(-1)!.headers.authorization).toBe('Bearer sk-openai-9999');
  });
});
