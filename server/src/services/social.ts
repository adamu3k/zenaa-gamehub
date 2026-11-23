/**
 * Social page: post ideas made from game news, finished graphics/videos, and posting to the venue's pages.
 *
 * Graphics are drawn in the browser (canvas) from the brand assets; the server keeps ideas and drafts, posts the
 * finished file to Facebook / Instagram / Telegram / the customer app, and reads page numbers back.
 * Access tokens are kept in the settings table under `social.secrets` and never sent to browsers.
 */
import { randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { httpOf, type Ctx } from '../context.js';
import { posts, smsOutbox, socialMedia, socialPosts } from '../db/schema.js';
import { badRequest, notFound } from '../lib/errors.js';
import { localTime } from './momo.js';
import { type FeedItem, outsideNews } from './newsfeed.js';
import { cleanPhone } from './sms.js';
import { type AppSettings, getKv, getSettings, setKv } from './settings.js';

/** Look names: the originals plus layout-colourway pairs such as split-navy (drawn in the browser). */
export const TemplateName = z.string().regex(/^[a-z]+(-[a-z]+)?$/, 'Unknown look').max(40);
export const DIRECT_PLATFORMS = ['facebook', 'instagram', 'telegram', 'portal'] as const;
const GRAPH = 'https://graph.facebook.com/v21.0';
const GRAPH_VIDEO = 'https://graph-video.facebook.com/v21.0';
const SECRETS_KEY = 'social.secrets';
const IDEAS_DAY_KEY = 'social.ideasDay';

export interface SocialSecrets {
  fbPageId?: string;
  fbToken?: string;
  fbPageName?: string;
  igUserId?: string;
  igUsername?: string;
  tgBotToken?: string;
  tgChatId?: string;
  tgTitle?: string;
}

// ───────── Captions ─────────

export function fillCaption(template: string, vars: Record<string, string | undefined | null>) {
  return template
    .replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k] ?? '') : m))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function shorten(s: string, n: number) {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), n - 20)).replace(/[,.;:!?\s]+$/, '')}…`;
}

export function captionFor(s: AppSettings, v: { title: string; summary?: string; source?: string; link?: string }) {
  return fillCaption(s.social.captionTemplate, {
    title: v.title,
    summary: shorten(v.summary ?? '', 220),
    source: v.source ?? '',
    link: v.link ?? '',
    centre: s.centerName,
    hashtags: s.social.hashtags,
    handle: s.social.handle,
  });
}

// ───────── Ideas from news ─────────

/** Looks used for news ideas with a picture, in rotation. */
const IDEA_TEMPLATES = ['news', 'breaking', 'split-navy', 'card-navy', 'slash-lime', 'broadcast-navy', 'cover-navy', 'card-blue'] as const;

/** Turns news stories into post ideas (one per story, never twice). Returns the new ideas. */
export async function ideasFromItems(ctx: Ctx, items: FeedItem[], limit: number) {
  const s = await getSettings(ctx.db);
  const blocked = s.chatBlockedWords.map((w) => w.toLowerCase());
  const usable = items.filter((i) => i.url && i.title && !blocked.some((w) => `${i.title} ${i.summary}`.toLowerCase().includes(w)));
  if (!usable.length) return [];
  const seen = await ctx.db
    .select({ url: socialPosts.newsUrl })
    .from(socialPosts)
    .where(inArray(socialPosts.newsUrl, usable.map((i) => i.url)));
  const known = new Set(seen.map((r) => r.url));
  const [{ n }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(socialPosts).where(eq(socialPosts.source, 'news'));
  const fresh = usable.filter((i) => !known.has(i.url)).slice(0, limit);
  const out = [];
  for (const [k, i] of fresh.entries()) {
    // Rotate looks so the feed doesn't repeat itself; stories without a picture become quote cards.
    const template = i.imageUrl ? IDEA_TEMPLATES[(Number(n) + k) % IDEA_TEMPLATES.length] : 'quote';
    const [row] = await ctx.db
      .insert(socialPosts)
      .values({
        status: 'idea',
        source: 'news',
        template,
        newsUrl: i.url,
        fields: {
          headline: shorten(i.title, 110),
          sub: shorten(i.summary ?? '', 160),
          tag: template === 'breaking' ? 'BREAKING' : template === 'broadcast-navy' ? 'LIVE' : template === 'cover-navy' ? 'ZMG' : 'GAMING NEWS',
          imageUrl: i.imageUrl,
          source: i.source,
        },
        caption: captionFor(s, { title: i.title, summary: i.summary, source: i.source, link: i.url }),
        createdAt: ctx.clock.now(),
        updatedAt: ctx.clock.now(),
      })
      .onConflictDoNothing()
      .returning();
    if (row) out.push(row);
  }
  return out;
}

/** Tells staff (and optionally the owner's phone) that new ideas are ready. */
async function announceIdeas(ctx: Ctx, rows: { fields: Record<string, unknown> }[]) {
  if (!rows.length) return;
  const s = await getSettings(ctx.db);
  const n = rows.length;
  ctx.bus.emit({ type: 'social.changed' });
  ctx.bus.emit({ type: 'alert', level: 'info', message: `${n} new post idea${n > 1 ? 's are' : ' is'} ready — open Social to post ${n > 1 ? 'them' : 'it'}` });
  const phone = cleanPhone(s.social.notifyPhone || '');
  if (phone.replace('+', '').length >= 9) {
    const first = String(rows[0].fields.headline ?? '');
    await ctx.db.insert(smsOutbox).values({
      phone,
      body: `${s.centerName}: ${n} new post idea${n > 1 ? 's' : ''} ready in ZENAA > Social. "${shorten(first, 70)}"`,
      kind: 'social',
      createdAt: ctx.clock.now(),
    });
  }
}

/** Staff pressed "Get ideas now". */
export async function ideasNow(ctx: Ctx, items: FeedItem[]) {
  const s = await getSettings(ctx.db);
  const rows = await ideasFromItems(ctx, items, s.social.ideasPerDay);
  if (rows.length) ctx.bus.emit({ type: 'social.changed' });
  return rows;
}

/** Once a day after the chosen time: make ideas from the newest stories. Called every minute. */
export async function dailyIdeasTick(ctx: Ctx, items?: FeedItem[]) {
  const s = await getSettings(ctx.db);
  if (!s.social.ideasOn || !s.newsFeeds.length) return 0;
  const now = ctx.clock.now();
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: s.timezone }).format(now);
  if (localTime(now, s.timezone) < s.social.ideasTime) return 0;
  if ((await getKv<string>(ctx.db, IDEAS_DAY_KEY)) === day) return 0;
  const list = items ?? (await outsideNews(ctx));
  if (!list.length) return 0; // feeds not read yet — try again next minute
  await setKv(ctx.db, IDEAS_DAY_KEY, day);
  const rows = await ideasFromItems(ctx, list, s.social.ideasPerDay);
  await announceIdeas(ctx, rows);
  return rows.length;
}

// ───────── Posts (drafts) ─────────

export const FieldsSchema = z.record(z.string().max(40), z.union([z.string().max(700_000), z.number(), z.boolean(), z.null(), z.array(z.any()).max(20)]));
export const PostBody = z.object({
  template: TemplateName,
  fields: FieldsSchema.default({}),
  caption: z.string().max(2200).default(''),
  status: z.enum(['idea', 'draft', 'dismissed', 'posted']).optional(),
});

export async function listPosts(ctx: Ctx, status?: string) {
  const where =
    status === 'ideas'
      ? inArray(socialPosts.status, ['idea', 'draft'])
      : status && status !== 'all'
        ? eq(socialPosts.status, status)
        : undefined;
  const rows = await ctx.db.select().from(socialPosts).where(where).orderBy(desc(socialPosts.createdAt)).limit(150);
  // Pictures the staff uploaded are big: the list only says one is there; open the post to load it.
  return rows.map((r) => ({ ...r, fields: lighten(r.fields) }));
}

function lighten(f: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) out[k] = typeof v === 'string' && v.startsWith('data:') && v.length > 2000 ? `upload:${k}` : v;
  return out;
}

export async function getPost(ctx: Ctx, id: string) {
  const [p] = await ctx.db.select().from(socialPosts).where(eq(socialPosts.id, id));
  if (!p) throw notFound('Post');
  return p;
}

// ───────── Pictures from news websites (so the browser can draw them on a canvas) ─────────

function privateV4(ip: string) {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}
export function isPrivateAddress(ip: string) {
  if (net.isIPv4(ip)) return privateV4(ip);
  const v = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped) return privateV4(mapped[1]);
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb');
}

async function assertPublic(u: URL) {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw badRequest('Only http(s) pictures');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw badRequest('That picture address could not be found');
  if (addrs.some((a) => isPrivateAddress(a.address))) throw badRequest('Pictures from the local network are not allowed');
}

const MAX_IMAGE = 8_000_000;
export async function fetchImage(ctx: Ctx, raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw badRequest('Not a picture address');
  }
  const http = httpOf(ctx);
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(url);
    const res = await http(url.toString(), { redirect: 'manual', signal: AbortSignal.timeout(12_000), headers: { 'user-agent': 'Mozilla/5.0 (ZENAA social graphics)', accept: 'image/*' } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location')!, url);
      continue;
    }
    if (!res.ok) throw badRequest(`The website answered ${res.status}`);
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(type)) throw badRequest('That address is not a picture');
    if (Number(res.headers.get('content-length') ?? 0) > MAX_IMAGE) throw badRequest('Picture too big');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE) throw badRequest('Picture too big');
    return { type, buf };
  }
  throw badRequest('Too many redirects');
}

// ───────── Accounts ─────────

export async function getSecrets(ctx: Ctx) {
  return (await getKv<SocialSecrets>(ctx.db, SECRETS_KEY)) ?? {};
}

/** What browsers may see: never the tokens. */
export async function accountStatus(ctx: Ctx) {
  const x = await getSecrets(ctx);
  const s = await getSettings(ctx.db);
  return {
    facebook: { connected: !!(x.fbPageId && x.fbToken), pageId: x.fbPageId ?? '', pageName: x.fbPageName ?? '' },
    instagram: {
      connected: !!(x.igUserId && x.fbToken),
      userId: x.igUserId ?? '',
      username: x.igUsername ?? '',
      publicUrlOk: /^https:\/\//i.test(s.publicUrl),
    },
    telegram: { connected: !!(x.tgBotToken && x.tgChatId), chatId: x.tgChatId ?? '', title: x.tgTitle ?? '' },
  };
}

export const AccountsBody = z.object({
  fbPageId: z.string().trim().regex(/^$|^\d{5,30}$/, 'The Page ID is a number (Facebook → your Page → About → Page transparency)').optional(),
  fbToken: z.string().trim().max(600).optional(),
  igUserId: z.string().trim().regex(/^$|^\d{5,30}$/, 'The Instagram account ID is a number').optional(),
  tgBotToken: z.string().trim().regex(/^$|^\d+:[\w-]{20,}$/, 'A bot token looks like 123456:ABC-DEF…').optional(),
  tgChatId: z.string().trim().regex(/^$|^(@[\w]{4,}|-?\d{5,20})$/, 'Use @yourchannel or the chat number').optional(),
  disconnect: z.array(z.enum(['facebook', 'instagram', 'telegram'])).default([]),
});

export async function saveAccounts(ctx: Ctx, raw: unknown) {
  const b = AccountsBody.parse(raw);
  const x = await getSecrets(ctx);
  const next: SocialSecrets = { ...x };
  if (b.fbPageId !== undefined && b.fbPageId !== x.fbPageId) {
    next.fbPageId = b.fbPageId || undefined;
    next.fbPageName = undefined;
  }
  if (b.fbToken) next.fbToken = b.fbToken; // blank = keep the saved token
  if (b.igUserId !== undefined) next.igUserId = b.igUserId || undefined;
  if (b.tgBotToken) next.tgBotToken = b.tgBotToken;
  if (b.tgChatId !== undefined && b.tgChatId !== x.tgChatId) {
    next.tgChatId = b.tgChatId || undefined;
    next.tgTitle = undefined;
  }
  for (const d of b.disconnect) {
    if (d === 'facebook') Object.assign(next, { fbPageId: undefined, fbToken: undefined, fbPageName: undefined, igUserId: undefined, igUsername: undefined });
    if (d === 'instagram') Object.assign(next, { igUserId: undefined, igUsername: undefined });
    if (d === 'telegram') Object.assign(next, { tgBotToken: undefined, tgChatId: undefined, tgTitle: undefined });
  }
  await setKv(ctx.db, SECRETS_KEY, JSON.parse(JSON.stringify(next)));
  insightsCache = null;
  return accountStatus(ctx);
}

async function graphGet(ctx: Ctx, path: string, token: string) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await httpOf(ctx)(`${GRAPH}/${path}${sep}access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(15_000) });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error?.message ?? `Facebook answered ${res.status}`);
  return j;
}

/** Checks the saved accounts, fills in names, and finds the Instagram account linked to the Facebook Page. */
export async function checkAccounts(ctx: Ctx) {
  const x = await getSecrets(ctx);
  const result: Record<string, { ok: boolean; message: string }> = {};
  if (x.fbPageId && x.fbToken) {
    try {
      const p = await graphGet(ctx, `${x.fbPageId}?fields=name,instagram_business_account{id,username}`, x.fbToken);
      x.fbPageName = p.name;
      if (p.instagram_business_account?.id) {
        x.igUserId = x.igUserId || p.instagram_business_account.id;
        x.igUsername = p.instagram_business_account.username ?? x.igUsername;
      }
      result.facebook = { ok: true, message: `Connected to the Page "${p.name}"` };
      result.instagram = x.igUserId
        ? { ok: true, message: `Instagram account ${x.igUsername ? '@' + x.igUsername : x.igUserId} found` }
        : { ok: false, message: 'No Instagram professional account is linked to this Facebook Page' };
    } catch (e: any) {
      result.facebook = { ok: false, message: e.message };
    }
  }
  if (x.tgBotToken && x.tgChatId) {
    try {
      const res = await httpOf(ctx)(`https://api.telegram.org/bot${x.tgBotToken}/getChat?chat_id=${encodeURIComponent(x.tgChatId)}`, { signal: AbortSignal.timeout(15_000) });
      const j: any = await res.json();
      if (!j.ok) throw new Error(j.description ?? 'Telegram refused');
      x.tgTitle = j.result.title ?? j.result.username ?? '';
      result.telegram = { ok: true, message: `Connected to "${x.tgTitle}"` };
    } catch (e: any) {
      result.telegram = { ok: false, message: e.message };
    }
  }
  await setKv(ctx.db, SECRETS_KEY, JSON.parse(JSON.stringify(x)));
  return { result, status: await accountStatus(ctx) };
}

// ───────── Publishing ─────────

export const PublishBody = z.object({
  platforms: z.array(z.enum(DIRECT_PLATFORMS)).min(1),
  caption: z.string().max(2200).default(''),
  /** The finished graphic (image/jpeg or image/png) or animation (video/mp4 or video/webm) as a data URL. */
  media: z.string().max(60_000_000),
  /** Small JPEG of the graphic for the customer app and the history list. */
  thumb: z.string().max(1_500_000).optional(),
});

function decodeDataUrl(d: string) {
  const m = /^data:([a-z]+\/[a-z0-9.+-]+)(?:;[^,]*)?;base64,(.+)$/i.exec(d);
  if (!m) throw badRequest('The graphic did not arrive');
  return { mime: m[1].toLowerCase(), buf: Buffer.from(m[2], 'base64') };
}

type Result = { platform: string; ok: boolean; url?: string | null; error?: string; at: string };

async function postForm(ctx: Ctx, url: string, fd: FormData, who: string) {
  const res = await httpOf(ctx)(url, { method: 'POST', body: fd, signal: AbortSignal.timeout(180_000) });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || j.error || j.ok === false) throw new Error(j.error?.message ?? j.description ?? `${who} answered ${res.status}`);
  return j;
}

async function toFacebook(ctx: Ctx, x: SocialSecrets, m: { mime: string; buf: Buffer }, caption: string) {
  if (!x.fbPageId || !x.fbToken) throw new Error('Facebook is not connected (Social → Accounts)');
  const fd = new FormData();
  fd.append('access_token', x.fbToken);
  const video = m.mime.startsWith('video/');
  fd.append(video ? 'description' : 'message', caption);
  fd.append('source', new Blob([new Uint8Array(m.buf)], { type: m.mime }), video ? 'zenaa.mp4' : 'zenaa.jpg');
  const j = await postForm(ctx, video ? `${GRAPH_VIDEO}/${x.fbPageId}/videos` : `${GRAPH}/${x.fbPageId}/photos`, fd, 'Facebook');
  const id = j.post_id ?? j.id;
  return id ? `https://www.facebook.com/${id}` : null;
}

async function toInstagram(ctx: Ctx, x: SocialSecrets, s: AppSettings, media: { id: string; key: string; mime: string }, caption: string) {
  if (!x.igUserId || !x.fbToken) throw new Error('Instagram is not connected (Social → Accounts → Check)');
  if (!/^https:\/\//i.test(s.publicUrl)) throw new Error('Instagram copies the picture from your ZENAA address, so ZENAA must be reachable from the internet over https (Settings → Socials & public address). Use Share / Download instead.');
  if (media.mime === 'video/webm') throw new Error('Instagram needs MP4 videos. This browser made a WebM video: post the picture, or use Chrome/Edge to make an MP4.');
  const mediaUrl = `${s.publicUrl}/api/social/media/${media.id}?k=${media.key}`;
  const video = media.mime.startsWith('video/');
  const fd = new FormData();
  fd.append('access_token', x.fbToken);
  fd.append('caption', caption);
  if (video) {
    fd.append('media_type', 'REELS');
    fd.append('video_url', mediaUrl);
  } else fd.append('image_url', mediaUrl);
  const c = await postForm(ctx, `${GRAPH}/${x.igUserId}/media`, fd, 'Instagram');
  // Instagram downloads and processes the file first.
  for (let i = 0; i < 45; i++) {
    const st = await graphGet(ctx, `${c.id}?fields=status_code`, x.fbToken);
    if (st.status_code === 'FINISHED') break;
    if (st.status_code === 'ERROR' || st.status_code === 'EXPIRED') throw new Error(`Instagram could not process the ${video ? 'video' : 'picture'}`);
    await new Promise((r) => setTimeout(r, ctx.fetch ? 1 : 2000));
  }
  const pub = new FormData();
  pub.append('access_token', x.fbToken);
  pub.append('creation_id', c.id);
  const p = await postForm(ctx, `${GRAPH}/${x.igUserId}/media_publish`, pub, 'Instagram');
  const link = await graphGet(ctx, `${p.id}?fields=permalink`, x.fbToken).catch(() => null);
  return link?.permalink ?? null;
}

async function toTelegram(ctx: Ctx, x: SocialSecrets, m: { mime: string; buf: Buffer }, caption: string) {
  if (!x.tgBotToken || !x.tgChatId) throw new Error('Telegram is not connected (Social → Accounts)');
  const video = m.mime.startsWith('video/');
  const fd = new FormData();
  fd.append('chat_id', x.tgChatId);
  fd.append('caption', caption.slice(0, 1024));
  fd.append(video ? 'video' : 'photo', new Blob([new Uint8Array(m.buf)], { type: m.mime }), video ? 'zenaa.mp4' : 'zenaa.jpg');
  const j = await postForm(ctx, `https://api.telegram.org/bot${x.tgBotToken}/${video ? 'sendVideo' : 'sendPhoto'}`, fd, 'Telegram');
  const msg = j.result?.message_id;
  return x.tgChatId.startsWith('@') && msg ? `https://t.me/${x.tgChatId.slice(1)}/${msg}` : null;
}

export async function publishPost(ctx: Ctx, id: string, raw: unknown, staffId: string | null) {
  const b = PublishBody.parse(raw);
  const post = await getPost(ctx, id);
  const s = await getSettings(ctx.db);
  const x = await getSecrets(ctx);
  const m = decodeDataUrl(b.media);
  if (!/^(image\/(jpeg|png)|video\/(mp4|webm))$/.test(m.mime)) throw badRequest('Only JPEG/PNG pictures and MP4/WebM videos can be posted');
  const key = randomBytes(18).toString('base64url');
  const [media] = await ctx.db.insert(socialMedia).values({ postId: id, mime: m.mime, data: m.buf.toString('base64'), key, createdAt: ctx.clock.now() }).returning({ id: socialMedia.id, key: socialMedia.key, mime: socialMedia.mime });
  // Old files are only needed while Instagram downloads them.
  await ctx.db.delete(socialMedia).where(lt(socialMedia.createdAt, new Date(ctx.clock.now().getTime() - 30 * 86_400_000)));

  const at = () => ctx.clock.now().toISOString();
  const results: Result[] = [];
  for (const platform of b.platforms) {
    try {
      let url: string | null = null;
      if (platform === 'facebook') url = await toFacebook(ctx, x, m, b.caption);
      else if (platform === 'instagram') url = await toInstagram(ctx, x, s, media, b.caption);
      else if (platform === 'telegram') url = await toTelegram(ctx, x, m, b.caption);
      else if (platform === 'portal') {
        const thumb = b.thumb ?? (m.mime.startsWith('image/') && b.media.length < 1_500_000 ? b.media : null);
        const headline = String(post.fields.headline ?? post.fields.title ?? '').trim() || b.caption.split('\n')[0].slice(0, 100) || 'News';
        await ctx.db.insert(posts).values({
          kind: 'news',
          title: headline.slice(0, 120),
          body: b.caption,
          image: thumb,
          linkUrl: post.newsUrl,
          linkLabel: post.newsUrl ? 'Read the full story' : null,
          createdBy: staffId,
          createdAt: ctx.clock.now(),
          updatedAt: ctx.clock.now(),
        });
        ctx.bus.emit({ type: 'posts.changed' });
      }
      results.push({ platform, ok: true, url, at: at() });
    } catch (e: any) {
      results.push({ platform, ok: false, error: String(e?.message ?? e).slice(0, 400), at: at() });
    }
  }
  const anyOk = results.some((r) => r.ok);
  const [row] = await ctx.db
    .update(socialPosts)
    .set({
      results: [...post.results, ...results],
      caption: b.caption,
      ...(anyOk ? { status: 'posted', postedAt: ctx.clock.now() } : {}),
      updatedAt: ctx.clock.now(),
    })
    .where(eq(socialPosts.id, id))
    .returning();
  ctx.bus.emit({ type: 'social.changed' });
  insightsCache = null;
  return { post: row, results };
}

/** Staff posted it themselves (Share / Download): note where. */
export async function markPosted(ctx: Ctx, id: string, platforms: string[]) {
  const post = await getPost(ctx, id);
  const at = ctx.clock.now().toISOString();
  const [row] = await ctx.db
    .update(socialPosts)
    .set({ status: 'posted', postedAt: ctx.clock.now(), updatedAt: ctx.clock.now(), results: [...post.results, ...platforms.map((platform) => ({ platform, ok: true, url: null, at, error: 'posted by hand' }))] })
    .where(eq(socialPosts.id, id))
    .returning();
  ctx.bus.emit({ type: 'social.changed' });
  return row;
}

export async function mediaFile(ctx: Ctx, id: string, key: string) {
  const [m] = await ctx.db.select().from(socialMedia).where(and(eq(socialMedia.id, id), eq(socialMedia.key, key)));
  if (!m) throw notFound('File');
  return { mime: m.mime, buf: Buffer.from(m.data, 'base64') };
}

// ───────── Page updates (followers, latest posts) ─────────

let insightsCache: { at: number; data: unknown } | null = null;

export async function insights(ctx: Ctx, force = false) {
  if (!force && insightsCache && Date.now() - insightsCache.at < 10 * 60_000) return insightsCache.data;
  const x = await getSecrets(ctx);
  const out: Record<string, unknown> = {};
  if (x.fbPageId && x.fbToken) {
    try {
      const p = await graphGet(ctx, `${x.fbPageId}?fields=name,link,followers_count,fan_count,picture{url}`, x.fbToken);
      const list = await graphGet(
        ctx,
        `${x.fbPageId}/posts?limit=8&fields=message,created_time,permalink_url,full_picture,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares`,
        x.fbToken,
      );
      out.facebook = {
        name: p.name,
        link: p.link,
        picture: p.picture?.data?.url ?? null,
        followers: p.followers_count ?? null,
        likes: p.fan_count ?? null,
        posts: (list.data ?? []).map((q: any) => ({
          text: q.message ?? '',
          at: q.created_time,
          url: q.permalink_url,
          image: q.full_picture ?? null,
          reactions: q.reactions?.summary?.total_count ?? 0,
          comments: q.comments?.summary?.total_count ?? 0,
          shares: q.shares?.count ?? 0,
        })),
      };
    } catch (e: any) {
      out.facebook = { error: e.message };
    }
  }
  if (x.igUserId && x.fbToken) {
    try {
      const u = await graphGet(ctx, `${x.igUserId}?fields=username,followers_count,media_count,profile_picture_url`, x.fbToken);
      const media = await graphGet(ctx, `${x.igUserId}/media?limit=8&fields=caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count`, x.fbToken);
      out.instagram = {
        username: u.username,
        picture: u.profile_picture_url ?? null,
        followers: u.followers_count ?? null,
        mediaCount: u.media_count ?? null,
        posts: (media.data ?? []).map((q: any) => ({
          text: q.caption ?? '',
          at: q.timestamp,
          url: q.permalink,
          image: q.media_type === 'VIDEO' ? q.thumbnail_url : q.media_url,
          likes: q.like_count ?? 0,
          comments: q.comments_count ?? 0,
        })),
      };
    } catch (e: any) {
      out.instagram = { error: e.message };
    }
  }
  if (x.tgBotToken && x.tgChatId) {
    try {
      const res = await httpOf(ctx)(`https://api.telegram.org/bot${x.tgBotToken}/getChatMemberCount?chat_id=${encodeURIComponent(x.tgChatId)}`, { signal: AbortSignal.timeout(15_000) });
      const j: any = await res.json();
      out.telegram = j.ok ? { title: x.tgTitle ?? x.tgChatId, members: j.result } : { error: j.description };
    } catch (e: any) {
      out.telegram = { error: e.message };
    }
  }
  const [counts] = await ctx.db
    .select({
      ideas: sql<number>`count(*) filter (where ${socialPosts.status} = 'idea')::int`,
      drafts: sql<number>`count(*) filter (where ${socialPosts.status} = 'draft')::int`,
      posted30: sql<number>`count(*) filter (where ${socialPosts.status} = 'posted' and ${socialPosts.postedAt} > now() - interval '30 days')::int`,
    })
    .from(socialPosts);
  const data = { ...out, zenaa: counts, checkedAt: new Date().toISOString() };
  insightsCache = { at: Date.now(), data };
  return data;
}
