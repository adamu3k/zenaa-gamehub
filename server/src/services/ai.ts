/**
 * AI helper for the Social page: the staff type what they want ("make it about Friday FIFA night, prize
 * GH₵500") and the AI fills or edits the graphic's text, can suggest a different look, and writes a caption.
 *
 * Works with Claude (Anthropic, official SDK) or OpenAI. The API key is kept on the server (database
 * key-value store) and never sent to browsers; staff only see the last 4 characters.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { httpOf, type Ctx } from '../context.js';
import { AppError, badRequest, parse } from '../lib/errors.js';
import { getKv, getSettings, setKv } from './settings.js';

const KV = 'ai_config';
export const AI_DEFAULT_MODEL = { anthropic: 'claude-opus-5-5', openai: 'gpt-4o-mini' } as const;

interface AiConfig {
  provider: 'anthropic' | 'openai';
  apiKey: string;
  model: string;
}

export async function aiConfigPublic(ctx: Ctx) {
  const c = await getKv<AiConfig>(ctx.db, KV);
  return {
    provider: c?.provider ?? 'anthropic',
    model: c?.model || AI_DEFAULT_MODEL[c?.provider ?? 'anthropic'],
    connected: !!c?.apiKey,
    keyHint: c?.apiKey ? `…${c.apiKey.slice(-4)}` : null,
    defaults: AI_DEFAULT_MODEL,
  };
}

export const AiConfigBody = z.object({
  provider: z.enum(['anthropic', 'openai']),
  /** Empty = keep the saved key; null = forget it. */
  apiKey: z.string().trim().max(400).nullish(),
  model: z.string().trim().max(80).optional(),
});

export async function saveAiConfig(ctx: Ctx, raw: unknown) {
  const b = parse(AiConfigBody, raw);
  const cur = await getKv<AiConfig>(ctx.db, KV);
  const apiKey = b.apiKey === null ? '' : b.apiKey ? b.apiKey : (cur?.provider === b.provider ? cur.apiKey : '');
  await setKv(ctx.db, KV, { provider: b.provider, apiKey, model: b.model || AI_DEFAULT_MODEL[b.provider] } satisfies AiConfig);
  return aiConfigPublic(ctx);
}

/** Sends one prompt and returns the reply text. */
async function ask(ctx: Ctx, system: string, user: string): Promise<string> {
  const c = await getKv<AiConfig>(ctx.db, KV);
  if (!c?.apiKey) throw new AppError(400, 'Connect an AI first: Social → Accounts & settings → AI assistant', 'ai_not_connected');
  const http = httpOf(ctx);
  if (c.provider === 'anthropic') {
    const client = new Anthropic({ apiKey: c.apiKey, fetch: http as never, maxRetries: 1, timeout: 60_000 });
    try {
      const res = await client.beta.messages.create({
        model: c.model || AI_DEFAULT_MODEL.anthropic,
        max_tokens: 4000,
        // Short creative writing: low effort keeps it quick.
        output_config: { effort: 'low' },
        // If the model declines, the API retries on a suitable fallback model in the same call.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system,
        messages: [{ role: 'user', content: user }],
      } as never);
      const msg = res as unknown as Anthropic.Message;
      if (msg.stop_reason === 'refusal') throw new AppError(422, 'The AI would not write this one — try different words', 'ai_refused');
      return msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    } catch (e) {
      if (e instanceof AppError) throw e;
      if (e instanceof Anthropic.AuthenticationError) throw new AppError(400, 'Claude did not accept the API key — check it in AI assistant settings', 'ai_key');
      if (e instanceof Anthropic.NotFoundError) throw new AppError(400, `Claude does not know the model "${c.model}" — clear the model box to use the default`, 'ai_model');
      if (e instanceof Anthropic.RateLimitError) throw new AppError(429, 'Claude is busy or the account is out of credit — try again in a minute', 'ai_busy');
      if (e instanceof Anthropic.BadRequestError) throw new AppError(400, `Claude: ${e.message}`, 'ai_bad_request');
      if (e instanceof Anthropic.APIError) throw new AppError(502, `Claude answered with an error (${e.status ?? 'network'})`, 'ai_error');
      throw new AppError(502, 'Could not reach Claude — check the internet connection', 'ai_offline');
    }
  }
  let r: Response;
  try {
    r = await http('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${c.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: c.model || AI_DEFAULT_MODEL.openai,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new AppError(502, 'Could not reach OpenAI — check the internet connection', 'ai_offline');
  }
  const data = (await r.json().catch(() => null)) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } } | null;
  if (r.status === 401) throw new AppError(400, 'OpenAI did not accept the API key — check it in AI assistant settings', 'ai_key');
  if (r.status === 429) throw new AppError(429, 'OpenAI is busy or the account is out of credit — try again later', 'ai_busy');
  if (!r.ok) throw new AppError(502, `OpenAI: ${data?.error?.message ?? r.status}`, 'ai_error');
  return data?.choices?.[0]?.message?.content ?? '';
}

function parseJson(text: string): Record<string, unknown> {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new AppError(502, 'The AI answer could not be read — try again', 'ai_parse');
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AppError(502, 'The AI answer could not be read — try again', 'ai_parse');
  }
}

export const AiEditBody = z.object({
  instruction: z.string().trim().min(2, 'Tell the AI what you want').max(1500),
  template: z.string().max(40),
  /** Text fields only (pictures are never sent). */
  fields: z.record(z.string().max(40), z.string().max(3000)).default({}),
  fieldDefs: z.array(z.object({ key: z.string().max(40), label: z.string().max(200), kind: z.string().max(20), hint: z.string().max(300).optional() })).max(40),
  looks: z.array(z.object({ key: z.string().max(40), label: z.string().max(120), group: z.string().max(40) })).max(400).default([]),
  caption: z.string().max(2200).default(''),
  allowLookChange: z.boolean().default(true),
});

/** Fills / edits a graphic's text (and optionally picks another look) from a plain-language request. */
export async function aiEditGraphic(ctx: Ctx, raw: unknown) {
  const b = parse(AiEditBody, raw);
  const s = await getSettings(ctx.db);
  const system = [
    `You write short, punchy social media graphics for ${s.centerName}, a PlayStation gaming centre (handle ${s.social.handle || 'none'}). Currency: ${s.currencyCode}.`,
    'You are given the graphic\'s current look, its text fields and a request from the staff. Change only what the request asks for; keep other fields as they are.',
    'Graphics need very few words: headlines 2–6 words, other lines short. For "rows" fields use one item per line in the format the hint shows. Never invent prices, dates or prize amounts the staff did not give — leave those fields as they are.',
    'Reply with JSON only, no other text, in this shape: {"template": "<look key or empty to keep>", "fields": {"<field key>": "<text>"}, "caption": "<post caption or empty to keep>", "note": "<one short sentence about what you changed>"}.',
  ].join('\n');
  const user = JSON.stringify({
    request: b.instruction,
    currentLook: b.template,
    fields: b.fieldDefs.filter((f) => f.kind !== 'image').map((f) => ({ key: f.key, label: f.label, kind: f.kind, hint: f.hint, value: b.fields[f.key] ?? '' })),
    caption: b.caption,
    ...(b.allowLookChange && b.looks.length ? { otherLooksYouMayPick: b.looks } : {}),
  });
  const out = parseJson(await ask(ctx, system, user));
  const keys = new Set(b.fieldDefs.filter((f) => f.kind !== 'image').map((f) => f.key));
  const fields: Record<string, string> = {};
  if (out.fields && typeof out.fields === 'object') {
    for (const [k, v] of Object.entries(out.fields as Record<string, unknown>)) if (typeof v === 'string' && v.length <= 3000) fields[k] = v;
  }
  const template = typeof out.template === 'string' && out.template && b.looks.some((l) => l.key === out.template) && b.allowLookChange ? out.template : null;
  // Keys from the current look only, unless the look changes (the new look may use other keys).
  const kept = template ? fields : Object.fromEntries(Object.entries(fields).filter(([k]) => keys.has(k)));
  return {
    template,
    fields: kept,
    caption: typeof out.caption === 'string' && out.caption.trim() ? out.caption.slice(0, 2200) : null,
    note: typeof out.note === 'string' ? out.note.slice(0, 300) : '',
  };
}

export async function aiTest(ctx: Ctx) {
  const t = await ask(ctx, 'Reply with JSON only.', 'Reply with {"ok": true}');
  if (!/"ok"\s*:\s*true/.test(t)) throw badRequest('The AI answered, but not as expected — try a different model');
  return { ok: true };
}
