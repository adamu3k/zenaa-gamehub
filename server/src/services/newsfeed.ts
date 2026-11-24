/**
 * Game news from other websites, mixed into the portal "News" next to the venue's own posts.
 *
 * Staff paste a site's RSS/Atom feed — or just the website address: most news sites announce their feed in the
 * page, and it is found automatically. The server reads the feeds at most once an hour (never the customers'
 * phones), keeps the newest stories, and the portal shows the few newest (Settings → News from other sites).
 * Only the title, a short summary, the picture address and the link are kept; customers tap through to the site.
 */
import type { Ctx } from '../context.js';
import { httpOf } from '../context.js';
import { getKv, getSettings, setKv } from './settings.js';

export interface FeedItem {
  title: string;
  url: string;
  summary: string;
  imageUrl: string | null;
  source: string;
  publishedAt: string | null;
}

interface Cache {
  key: string;
  fetchedAt: number;
  items: FeedItem[];
  perFeed?: Record<string, FeedItem[]>;
  status: { url: string; ok: boolean; count: number; error?: string; feedUrl?: string; title?: string }[];
}

const KV = 'news_feed_cache';
const FRESH_MS = 60 * 60_000;
const RETRY_MS = 10 * 60_000;
const MAX_BYTES = 3_000_000;
let inflight: Promise<Cache> | null = null;
let lastTry = 0;

// ───────── Parsing (RSS 2.0, RSS 1.0/RDF and Atom, without an XML library) ─────────

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

export function decodeEntities(s: string) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const unCdata = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

/** Plain text from an element's content (CDATA, entities and HTML tags removed). */
export function textOf(s: string | undefined | null) {
  if (!s) return '';
  let t = unCdata(s);
  // Escaped HTML inside RSS descriptions: decode once, then strip the tags.
  if (/&lt;\/?[a-z]/i.test(t)) t = decodeEntities(t);
  t = t
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(t).replace(/\s+/g, ' ').trim();
}

function tag(block: string, name: string) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
  return re.exec(block)?.[1];
}

function attr(block: string, tagName: string, attrName: string, where?: (t: string) => boolean) {
  const re = new RegExp(`<${tagName}\\b[^>]*>`, 'gi');
  for (const m of block.match(re) ?? []) {
    if (where && !where(m)) continue;
    const a = new RegExp(`\\s${attrName}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(m);
    if (a) return decodeEntities(a[2] ?? a[3] ?? '');
  }
  return undefined;
}

const httpUrl = (u: string | undefined | null, base?: string) => {
  if (!u) return null;
  try {
    const x = new URL(u.trim(), base);
    return x.protocol === 'http:' || x.protocol === 'https:' ? x.toString() : null;
  } catch {
    return null;
  }
};

function imageOf(block: string, base: string) {
  const fromAttr =
    attr(block, 'media:content', 'url', (t) => !/medium\s*=\s*["'](video|audio)/i.test(t) && (!/type\s*=/i.test(t) || /type\s*=\s*["']image/i.test(t))) ??
    attr(block, 'media:thumbnail', 'url') ??
    attr(block, 'enclosure', 'url', (t) => /type\s*=\s*["']image/i.test(t) || /\.(jpe?g|png|webp|gif)/i.test(t)) ??
    attr(block, 'itunes:image', 'href');
  if (fromAttr) return httpUrl(fromAttr, base);
  // First picture inside the story's HTML.
  const html = decodeEntities(unCdata(tag(block, 'content:encoded') ?? tag(block, 'description') ?? tag(block, 'content') ?? tag(block, 'summary') ?? ''));
  const img = /<img\b[^>]*\ssrc\s*=\s*["']([^"']+)["']/i.exec(html)?.[1];
  return httpUrl(img, base);
}

const dateOf = (s: string | undefined) => {
  if (!s) return null;
  const t = Date.parse(textOf(s));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

const shorten = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s);

/** Parses a feed. Returns null when the text is not a feed (e.g. a web page). */
export function parseFeed(xml: string, feedUrl: string, sourceName?: string): { title: string; items: FeedItem[] } | null {
  const head = xml.slice(0, 2000);
  const isAtom = /<feed[\s>]/i.test(head);
  const isRss = /<rss[\s>]|<rdf:RDF[\s>]|<channel[\s>]/i.test(head) || /<rss[\s>]/i.test(xml.slice(0, 5000));
  if (!isAtom && !isRss) return null;
  const channel = isAtom ? xml.split(/<entry[\s>]/i)[0] : (tag(xml, 'channel') ?? xml).split(/<item[\s>]/i)[0];
  const feedTitle = textOf(tag(channel, 'title')) || new URL(feedUrl).hostname.replace(/^www\./, '');
  const source = sourceName?.trim() || feedTitle;
  const blocks = isAtom ? (xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? []) : (xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? []);
  const items: FeedItem[] = [];
  for (const b of blocks.slice(0, 40)) {
    const title = textOf(tag(b, 'title'));
    const link = isAtom
      ? (attr(b, 'link', 'href', (t) => !/rel\s*=/i.test(t) || /rel\s*=\s*["']alternate["']/i.test(t)) ?? attr(b, 'link', 'href'))
      : textOf(tag(b, 'link')) || attr(b, 'link', 'href') || (/isPermaLink\s*=\s*["']true/i.test(b) ? textOf(tag(b, 'guid')) : undefined) || textOf(tag(b, 'guid'));
    const url = httpUrl(link, feedUrl);
    if (!title || !url) continue;
    const summary = shorten(textOf(tag(b, 'description') ?? tag(b, 'summary') ?? tag(b, 'content') ?? tag(b, 'content:encoded')), 220);
    items.push({
      title: shorten(title, 160),
      url,
      summary,
      imageUrl: imageOf(b, feedUrl),
      source,
      publishedAt: dateOf(tag(b, 'pubDate') ?? tag(b, 'published') ?? tag(b, 'updated') ?? tag(b, 'dc:date')),
    });
  }
  return { title: feedTitle, items };
}

/** A web page's announced feed: <link rel="alternate" type="application/rss+xml" href="…">. */
export function discoverFeed(html: string, pageUrl: string) {
  for (const m of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/rel\s*=\s*["']?alternate/i.test(m) || !/type\s*=\s*["']application\/(rss|atom)\+xml/i.test(m)) continue;
    const href = /href\s*=\s*("([^"]*)"|'([^']*)')/i.exec(m);
    const u = httpUrl(decodeEntities(href?.[2] ?? href?.[3] ?? ''), pageUrl);
    if (u) return u;
  }
  return null;
}

// ───────── Fetching ─────────

async function getText(ctx: Ctx, url: string) {
  const res = await httpOf(ctx)(url, {
    signal: AbortSignal.timeout(12_000),
    redirect: 'follow',
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; ZenaaGamehub/1.0; +news reader)', accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5' },
  });
  if (!res.ok) throw new Error(`the site answered HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_BYTES) throw new Error('the page is too big');
  const text = await res.text();
  return text.length > MAX_BYTES ? text.slice(0, MAX_BYTES) : text;
}

/** Reads one feed (or finds the feed of a web page). */
export async function readFeed(ctx: Ctx, url: string, name?: string) {
  const text = await getText(ctx, url);
  let parsed = parseFeed(text, url, name);
  let feedUrl = url;
  if (!parsed) {
    const found = discoverFeed(text, url);
    if (!found) throw new Error('no news feed found at this address — paste the site’s RSS feed link instead');
    feedUrl = found;
    parsed = parseFeed(await getText(ctx, found), found, name);
    if (!parsed) throw new Error('the feed could not be read');
  }
  return { ...parsed, feedUrl };
}

/** Newest stories first, at most 3 in a row from the same site. */
export function mixItems(lists: FeedItem[][], limit = 30) {
  const all = lists.flat().filter((x, i, arr) => arr.findIndex((y) => y.url === x.url) === i);
  all.sort((a, b) => (b.publishedAt ? Date.parse(b.publishedAt) : 0) - (a.publishedAt ? Date.parse(a.publishedAt) : 0));
  const out: FeedItem[] = [];
  const perSource = new Map<string, number>();
  for (const it of all) {
    const n = perSource.get(it.source) ?? 0;
    if (n >= 3 && lists.length > 1) continue;
    perSource.set(it.source, n + 1);
    out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}

async function refresh(ctx: Ctx, feeds: { url: string; name: string }[], key: string): Promise<Cache> {
  lastTry = Date.now();
  const results = await Promise.all(
    feeds.map(async (f) => {
      try {
        const r = await readFeed(ctx, f.url, f.name);
        return { items: r.items, status: { url: f.url, ok: true, count: r.items.length, feedUrl: r.feedUrl !== f.url ? r.feedUrl : undefined, title: r.title } };
      } catch (err) {
        return { items: [] as FeedItem[], status: { url: f.url, ok: false, count: 0, error: (err as Error).name === 'TimeoutError' ? 'the site did not answer in time' : (err as Error).message.slice(0, 160) } };
      }
    }),
  );
  const old = await getKv<Cache>(ctx.db, KV);
  // A site that is down keeps its last stories.
  const perFeed: Record<string, FeedItem[]> = {};
  results.forEach((r) => (perFeed[r.status.url] = r.status.ok ? r.items : (old?.perFeed?.[r.status.url] ?? [])));
  const items = mixItems(Object.values(perFeed));
  const cache: Cache = { key, fetchedAt: Date.now(), items, perFeed, status: results.map((r) => r.status) };
  await setKv(ctx.db, KV, cache);
  return cache;
}

const keyOf = (feeds: { url: string; name: string }[]) => feeds.map((f) => `${f.url}|${f.name}`).join('\n');

function testMode() {
  return process.env.NODE_ENV === 'test' || !!process.env.VITEST;
}

const HIDDEN = 'news_feed_hidden';
async function hiddenSet(ctx: Ctx) {
  return new Set((await getKv<string[]>(ctx.db, HIDDEN)) ?? []);
}
const visible = (items: FeedItem[], hidden: Set<string>) => (hidden.size ? items.filter((i) => !hidden.has(i.url)) : items);

/** Staff removed these stories (or 'all' = everything showing now). Returns how many are hidden now. */
export async function hideNews(ctx: Ctx, urls: string[] | 'all') {
  const h = await hiddenSet(ctx);
  if (urls === 'all') {
    const c = await getKv<Cache>(ctx.db, KV);
    for (const i of c?.items ?? []) h.add(i.url);
    for (const list of Object.values(c?.perFeed ?? {})) for (const i of list) h.add(i.url);
  } else for (const u of urls) h.add(u);
  // Keep the list from growing for ever.
  await setKv(ctx.db, HIDDEN, [...h].slice(-2000));
  return h.size;
}
export async function unhideAllNews(ctx: Ctx) {
  await setKv(ctx.db, HIDDEN, []);
}

/** Outside stories for the portal. Never waits for the internet: refreshes in the background when old. */
export async function outsideNews(ctx: Ctx): Promise<FeedItem[]> {
  const s = await getSettings(ctx.db);
  if (!s.newsFeeds.length || s.newsFeedCount === 0) return [];
  const key = keyOf(s.newsFeeds);
  const cache = await getKv<Cache>(ctx.db, KV);
  const stale = !cache || cache.key !== key || Date.now() - cache.fetchedAt > FRESH_MS;
  if (stale && !inflight && Date.now() - lastTry > (cache?.key === key ? RETRY_MS : 0) && !(testMode() && !ctx.fetch)) {
    inflight = refresh(ctx, s.newsFeeds, key).finally(() => (inflight = null));
    inflight.catch(() => undefined);
  }
  return cache?.key === key ? visible(cache.items, await hiddenSet(ctx)) : [];
}

/** Staff: read every feed now and show what worked. */
export async function refreshNow(ctx: Ctx) {
  const s = await getSettings(ctx.db);
  if (!s.newsFeeds.length) return { fetchedAt: null, status: [], items: [] };
  const c = await (inflight ?? refresh(ctx, s.newsFeeds, keyOf(s.newsFeeds)));
  return { fetchedAt: new Date(c.fetchedAt).toISOString(), status: c.status, items: visible(c.items, await hiddenSet(ctx)).slice(0, 12) };
}

export async function feedStatus(ctx: Ctx) {
  const c = await getKv<Cache>(ctx.db, KV);
  return c
    ? { fetchedAt: new Date(c.fetchedAt).toISOString(), status: c.status, items: visible(c.items, await hiddenSet(ctx)).slice(0, 12), hidden: (await hiddenSet(ctx)).size }
    : { fetchedAt: null, status: [], items: [], hidden: 0 };
}

/** Staff "Test" button for one address. */
export async function testFeed(ctx: Ctx, url: string) {
  try {
    const r = await readFeed(ctx, url);
    return { ok: true, title: r.title, feedUrl: r.feedUrl, count: r.items.length, sample: r.items.slice(0, 3) };
  } catch (err) {
    return { ok: false, error: (err as Error).name === 'TimeoutError' ? 'the site did not answer in time' : (err as Error).message };
  }
}
