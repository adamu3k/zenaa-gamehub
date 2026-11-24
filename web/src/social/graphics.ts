/**
 * Social graphics: branded posts drawn on a canvas from the ZMG brand files in /brand (logos, blue texture),
 * the venue's colours (Social → Accounts & settings) and news pictures. Every template can be animated
 * (6 seconds) and recorded to a video in the browser.
 */
import '@fontsource/anton/400.css';
import '@fontsource/archivo-black/400.css';
import { getToken } from '../lib/api';

export type TemplateKey = string;
export type FormatKey = 'post' | 'square' | 'story';
export const FORMATS: Record<FormatKey, { label: string; w: number; h: number; hint: string }> = {
  post: { label: 'Post 4:5', w: 1080, h: 1350, hint: 'Instagram & Facebook feed' },
  square: { label: 'Square 1:1', w: 1080, h: 1080, hint: 'Any feed, WhatsApp' },
  story: { label: 'Story / Reel 9:16', w: 1080, h: 1920, hint: 'Stories, Reels, TikTok, Shorts, Status' },
};

export type FieldDef = { key: string; label: string; kind: 'text' | 'textarea' | 'image' | 'rows'; hint?: string; placeholder?: string };
export interface TemplateInfo {
  label: string;
  about: string;
  group: string;
  fields: FieldDef[];
}
const BASE_TEMPLATES: Record<string, TemplateInfo> = {
  news: {
    label: 'News',
    about: 'Big picture on top, headline below',
    group: 'News',
    fields: [
      { key: 'tag', label: 'Label', kind: 'text', placeholder: 'GAMING NEWS' },
      { key: 'headline', label: 'Headline', kind: 'textarea' },
      { key: 'sub', label: 'Short summary', kind: 'textarea' },
      { key: 'source', label: 'Source', kind: 'text', placeholder: 'e.g. IGN' },
      { key: 'imageUrl', label: 'Picture', kind: 'image' },
    ],
  },
  breaking: {
    label: 'Breaking',
    about: 'Blue ZMG texture, framed picture, bold highlight text',
    group: 'News',
    fields: [
      { key: 'tag', label: 'Big background word', kind: 'text', placeholder: 'BREAKING' },
      { key: 'headline', label: 'Headline', kind: 'textarea' },
      { key: 'sub', label: 'Line under it', kind: 'textarea' },
      { key: 'imageUrl', label: 'Picture', kind: 'image' },
    ],
  },
  quote: {
    label: 'Quote / hot take',
    about: 'Speech bubble on lime — questions, opinions, fan quotes',
    group: 'Community',
    fields: [
      { key: 'tag', label: 'Label', kind: 'text', placeholder: 'COMMUNITY VOICES' },
      { key: 'headline', label: 'Quote or question', kind: 'textarea' },
      { key: 'sub', label: 'Who said it', kind: 'text', placeholder: '@player or ZMG' },
    ],
  },
  versus: {
    label: 'Next match',
    about: 'Player vs player with photos',
    group: 'Matches & players',
    fields: [
      { key: 'p1Name', label: 'Player 1', kind: 'text' },
      { key: 'p1Photo', label: 'Player 1 photo', kind: 'image' },
      { key: 'p2Name', label: 'Player 2', kind: 'text' },
      { key: 'p2Photo', label: 'Player 2 photo', kind: 'image' },
      { key: 'game', label: 'Game', kind: 'text', placeholder: 'EA FC 26' },
      { key: 'when', label: 'When / where', kind: 'text', placeholder: 'Saturday 7 PM · Station 1' },
    ],
  },
  leaderboard: {
    label: 'Leaderboard',
    about: 'Standings table from your rankings',
    group: 'Matches & players',
    fields: [
      { key: 'headline', label: 'Title', kind: 'text', placeholder: 'LEADERBOARD' },
      { key: 'sub', label: 'Game / period', kind: 'text', placeholder: 'EA FC 26 · This month' },
      { key: 'rows', label: 'Players', kind: 'rows', hint: 'One per line: name, points' },
    ],
  },
  promo: {
    label: 'Promo / event',
    about: 'Happy hour, tournaments, merch, opening hours',
    group: 'Events',
    fields: [
      { key: 'tag', label: 'Label', kind: 'text', placeholder: 'THIS WEEKEND' },
      { key: 'headline', label: 'Title', kind: 'textarea', placeholder: 'HAPPY HOUR' },
      { key: 'sub', label: 'Subtitle', kind: 'textarea' },
      { key: 'lines', label: 'Details (one per line)', kind: 'textarea' },
      { key: 'price', label: 'Price badge', kind: 'text', placeholder: 'GHS 10' },
      { key: 'cta', label: 'Call to action', kind: 'text', placeholder: 'WhatsApp 059 000 0000' },
      { key: 'imageUrl', label: 'Picture (optional)', kind: 'image' },
    ],
  },
  winner: {
    label: 'Winner',
    about: 'Champion photo with WINNER title and confetti',
    group: 'Matches & players',
    fields: [
      { key: 'tag', label: 'Big word', kind: 'text', placeholder: 'WINNER' },
      { key: 'headline', label: 'Name', kind: 'text' },
      { key: 'sub', label: 'Event / prize', kind: 'textarea' },
      { key: 'imageUrl', label: 'Photo', kind: 'image' },
    ],
  },
};

export interface Brand {
  dark: string;
  main: string;
  pop: string;
  light: string;
  handle: string;
  centre: string;
}
export interface Spec {
  template: TemplateKey;
  format: FormatKey;
  fields: Record<string, any>;
}
interface Assets {
  bg: HTMLImageElement | null;
  logoOutline: HTMLImageElement | null;
  logoNavy: HTMLImageElement | null;
  photos: Record<string, HTMLImageElement | null>;
}

export const DURATION = 6;

// ───────── Loading ─────────

const imgCache = new Map<string, Promise<HTMLImageElement | null>>();
function loadImg(src: string): Promise<HTMLImageElement | null> {
  if (!imgCache.has(src)) {
    imgCache.set(
      src,
      new Promise((resolve) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => resolve(null);
        im.src = src;
      }),
    );
  }
  return imgCache.get(src)!;
}

/** Outside pictures come through ZENAA (staff sign-in), so the canvas can still be saved. */
async function loadPhoto(src: string | undefined | null): Promise<HTMLImageElement | null> {
  if (!src || typeof src !== 'string' || src.startsWith('upload:')) return null;
  if (src.startsWith('data:') || src.startsWith('/')) return loadImg(src);
  const key = `proxy:${src}`;
  if (!imgCache.has(key)) {
    imgCache.set(
      key,
      fetch(`/api/social/image?url=${encodeURIComponent(src)}`, { headers: { authorization: `Bearer ${getToken() ?? ''}` } })
        .then((r) => (r.ok ? r.blob() : null))
        .then((b) => (b ? loadImg(URL.createObjectURL(b)) : null))
        .catch(() => null),
    );
  }
  return imgCache.get(key)!;
}

let fontsReady: Promise<unknown> | null = null;
export function loadFonts() {
  fontsReady ??= Promise.all([document.fonts.load('100px Anton'), document.fonts.load("100px 'Archivo Black'")]).catch(() => undefined);
  return fontsReady;
}

export async function loadAssets(spec: Spec): Promise<Assets> {
  await loadFonts();
  const [bg, logoOutline, logoNavy] = await Promise.all([loadImg('/brand/bg-blue.jpg'), loadImg('/brand/logo-outline.png'), loadImg('/brand/logo-navy.png')]);
  const photos: Record<string, HTMLImageElement | null> = {};
  for (const f of (TEMPLATES[spec.template] ?? TEMPLATES.news).fields) if (f.kind === 'image') photos[f.key] = await loadPhoto(spec.fields[f.key]);
  return { bg, logoOutline, logoNavy, photos };
}

// ───────── Drawing helpers ─────────

type C = CanvasRenderingContext2D;
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const easeOut = (p: number) => 1 - (1 - clamp(p)) ** 3;
const easeBack = (p: number) => {
  const x = clamp(p);
  const c1 = 1.70158;
  return 1 + (c1 + 1) * (x - 1) ** 3 + c1 * (x - 1) ** 2;
};
/** Progress 0→1 of a step that starts at `start` seconds and lasts `dur`. */
const step = (t: number, start: number, dur: number) => (t === Infinity ? 1 : clamp((t - start) / dur));

const DISPLAY = 'Anton, Impact, sans-serif';
const HEAVY = "'Archivo Black', 'Arial Black', sans-serif";
const BODY = "'Segoe UI', Roboto, Arial, sans-serif";

function cover(c: C, im: HTMLImageElement, x: number, y: number, w: number, h: number, zoom = 1, focusY = 0.4) {
  const s = Math.max(w / im.width, h / im.height) * zoom;
  const dw = im.width * s;
  const dh = im.height * s;
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  c.drawImage(im, x + (w - dw) / 2, y + (h - dh) * focusY, dw, dh);
  c.restore();
}

function roundRect(c: C, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

/** Splits text into lines that fit, shrinking the font until it fits the box. */
function fit(c: C, text: string, family: string, maxW: number, maxH: number, maxSize: number, minSize: number, lineH = 1.05, upper = true) {
  const words = (upper ? text.toUpperCase() : text).split(/\s+/).filter(Boolean);
  for (let size = maxSize; size >= minSize; size -= 4) {
    c.font = `${size}px ${family}`;
    const lines: string[] = [];
    let cur = '';
    let tooWide = false;
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (c.measureText(next).width <= maxW) cur = next;
      else {
        if (cur) lines.push(cur);
        cur = w;
        if (c.measureText(w).width > maxW) tooWide = true;
      }
    }
    if (cur) lines.push(cur);
    if (!tooWide && lines.length * size * lineH <= maxH) return { size, lines, lineH: size * lineH };
  }
  c.font = `${minSize}px ${family}`;
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (c.measureText(next).width <= maxW || !cur) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  const max = Math.max(1, Math.floor(maxH / (minSize * lineH)));
  if (lines.length > max) {
    lines.length = max;
    lines[max - 1] = `${lines[max - 1].replace(/\W*$/, '')}…`;
  }
  return { size: minSize, lines, lineH: minSize * lineH };
}

/** Text lines rising in one after another. */
function riseLines(c: C, f: ReturnType<typeof fit>, x: number, y: number, t: number, start: number, color: string, align: CanvasTextAlign = 'left', family = DISPLAY) {
  c.font = `${f.size}px ${family}`;
  c.textAlign = align;
  c.textBaseline = 'top';
  f.lines.forEach((line, i) => {
    const p = easeOut(step(t, start + i * 0.12, 0.6));
    c.save();
    c.globalAlpha = p;
    c.fillStyle = color;
    c.fillText(line, x, y + i * f.lineH + (1 - p) * 40);
    c.restore();
  });
  return y + f.lines.length * f.lineH;
}

function texture(c: C, a: Assets, b: Brand, W: number, H: number, t: number) {
  c.fillStyle = b.dark;
  c.fillRect(0, 0, W, H);
  if (a.bg) {
    const z = t === Infinity ? 1.04 : 1 + 0.06 * Math.min(1, t / DURATION);
    cover(c, a.bg, 0, 0, W, H, z, 0.5);
  }
}

function logo(c: C, im: HTMLImageElement | null, cx: number, cy: number, w: number, t: number, start: number) {
  if (!im) return;
  const p = easeBack(step(t, start, 0.55));
  if (p <= 0) return;
  const h = (im.height / im.width) * w;
  c.save();
  c.globalAlpha = clamp(p);
  c.translate(cx, cy);
  c.scale(p, p);
  c.drawImage(im, -w / 2, -h / 2, w, h);
  c.restore();
}

/** Slanted label, e.g. GAMING NEWS. */
function label(c: C, text: string, x: number, y: number, size: number, bg: string, fg: string, t: number, start: number) {
  if (!text) return 0;
  c.font = `${size}px ${HEAVY}`;
  const w = c.measureText(text.toUpperCase()).width + size * 1.2;
  const h = size * 1.6;
  const p = easeOut(step(t, start, 0.5));
  c.save();
  c.translate(x - (1 - p) * (w + 60), y);
  c.beginPath();
  c.moveTo(size * 0.4, 0);
  c.lineTo(w + size * 0.4, 0);
  c.lineTo(w, h);
  c.lineTo(0, h);
  c.closePath();
  c.fillStyle = bg;
  c.fill();
  c.fillStyle = fg;
  c.textBaseline = 'middle';
  c.textAlign = 'left';
  c.fillText(text.toUpperCase(), size * 0.6, h / 2 + 2);
  c.restore();
  return h;
}

function footer(c: C, b: Brand, W: number, H: number, fg: string, t: number, start = 1.8) {
  const p = easeOut(step(t, start, 0.6));
  c.save();
  c.globalAlpha = p;
  c.font = `26px ${HEAVY}`;
  c.fillStyle = fg;
  c.textBaseline = 'alphabetic';
  c.textAlign = 'left';
  c.fillText(b.handle ? `FOLLOW ${b.handle.toUpperCase()}` : b.centre.toUpperCase(), 60, H - 52);
  c.textAlign = 'right';
  c.font = `22px ${BODY}`;
  c.globalAlpha = p * 0.8;
  c.fillText('PLAY · COMPETE · WIN', W - 60, H - 54);
  c.restore();
}

function photoOrPattern(c: C, im: HTMLImageElement | null, b: Brand, x: number, y: number, w: number, h: number, zoom: number) {
  if (im) cover(c, im, x, y, w, h, zoom);
  else {
    const g = c.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, b.main);
    g.addColorStop(1, b.dark);
    c.fillStyle = g;
    c.fillRect(x, y, w, h);
    c.save();
    c.globalAlpha = 0.12;
    c.strokeStyle = b.pop;
    c.lineWidth = 3;
    for (let i = -h; i < w; i += 46) {
      c.beginPath();
      c.moveTo(x + i, y + h);
      c.lineTo(x + i + h, y);
      c.stroke();
    }
    c.restore();
  }
}

// ───────── Templates ─────────

type Draw = (c: C, W: number, H: number, f: Record<string, any>, a: Assets, b: Brand, t: number) => void;

const news: Draw = (c, W, H, f, a, b, t) => {
  const ph = Math.round(H * (H > W * 1.5 ? 0.55 : 0.6));
  c.fillStyle = b.dark;
  c.fillRect(0, 0, W, H);
  const z = t === Infinity ? 1.05 : 1.12 - 0.07 * easeOut(t / DURATION);
  c.save();
  c.globalAlpha = easeOut(step(t, 0, 0.8));
  photoOrPattern(c, a.photos.imageUrl, b, 0, 0, W, ph, z);
  c.restore();
  const g = c.createLinearGradient(0, ph * 0.45, 0, ph + 2);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, b.dark);
  c.fillStyle = g;
  c.fillRect(0, 0, W, ph + 2);
  logo(c, a.logoOutline, W - 120, 110, 150, t, 2.1);
  const top = ph - 40;
  const lh = label(c, f.tag || 'GAMING NEWS', 60, top, 30, b.pop, b.dark, t, 0.3);
  const head = fit(c, String(f.headline || 'Your headline here'), DISPLAY, W - 120, H - top - lh - 250, 120, 56);
  let y = riseLines(c, head, 60, top + lh + 24, t, 0.55, '#ffffff');
  const bar = easeOut(step(t, 1.2, 0.5));
  c.fillStyle = b.pop;
  c.fillRect(60, y + 14, 160 * bar, 10);
  y += 46;
  if (f.sub) {
    c.save();
    c.globalAlpha = easeOut(step(t, 1.4, 0.6));
    const s = fit(c, String(f.sub), BODY, W - 120, H - y - 130, 36, 26, 1.3, false);
    c.font = `${s.size}px ${BODY}`;
    c.fillStyle = 'rgba(255,255,255,0.86)';
    s.lines.forEach((l, i) => c.fillText(l, 60, y + i * s.lineH));
    c.restore();
  }
  if (f.source) {
    c.save();
    c.globalAlpha = 0.7 * easeOut(step(t, 1.6, 0.5));
    c.font = `22px ${BODY}`;
    c.fillStyle = '#ffffff';
    c.textAlign = 'right';
    c.fillText(`Source: ${f.source}`, W - 60, ph - 70);
    c.restore();
  }
  footer(c, b, W, H, b.pop, t);
};

const breaking: Draw = (c, W, H, f, a, b, t) => {
  texture(c, a, b, W, H, t);
  c.fillStyle = 'rgba(4,10,60,0.35)';
  c.fillRect(0, 0, W, H);
  // Huge outlined words in the background (like the stream overlays).
  const word = String(f.tag || 'BREAKING').toUpperCase();
  c.save();
  c.font = `260px ${DISPLAY}`;
  c.textBaseline = 'top';
  c.lineWidth = 3;
  c.strokeStyle = 'rgba(255,255,255,0.12)';
  const shift = t === Infinity ? 0 : (t / DURATION) * 160;
  for (let r = 0; r < Math.ceil(H / 250) + 1; r++) {
    const off = (r % 2 ? -1 : 1) * shift - 200;
    c.strokeText(`${word} ${word} ${word}`, off, r * 250 - 40);
  }
  c.restore();
  const fw = W - 120;
  const fh = Math.round(fw * (H > 1500 ? 0.9 : 0.62));
  const p = easeBack(step(t, 0.2, 0.7));
  c.save();
  c.translate(W / 2, 140 + fh / 2);
  c.scale(0.85 + 0.15 * p, 0.85 + 0.15 * p);
  c.globalAlpha = clamp(p);
  roundRect(c, -fw / 2, -fh / 2, fw, fh, 28);
  c.save();
  c.clip();
  photoOrPattern(c, a.photos.imageUrl, b, -fw / 2, -fh / 2, fw, fh, t === Infinity ? 1.03 : 1.08 - 0.05 * (t / DURATION));
  c.restore();
  c.lineWidth = 8;
  c.strokeStyle = b.pop;
  roundRect(c, -fw / 2, -fh / 2, fw, fh, 28);
  c.stroke();
  c.restore();
  label(c, word, 60, 90, 34, b.pop, b.dark, t, 0.4);
  // Headline in lime boxes, line by line.
  let y = 140 + fh + 50;
  const head = fit(c, String(f.headline || 'Your headline here'), DISPLAY, W - 160, H - y - 230, 104, 52, 1.18);
  c.font = `${head.size}px ${DISPLAY}`;
  c.textBaseline = 'top';
  head.lines.forEach((line, i) => {
    const q = easeOut(step(t, 0.8 + i * 0.15, 0.45));
    const w = c.measureText(line).width + 40;
    c.fillStyle = i % 2 ? b.light : b.pop;
    c.fillRect(60, y + i * head.lineH, w * q, head.size * 1.08);
    c.save();
    c.globalAlpha = q;
    c.fillStyle = b.dark;
    c.fillText(line, 80, y + i * head.lineH + head.size * 0.04);
    c.restore();
  });
  y += head.lines.length * head.lineH + 26;
  if (f.sub) {
    c.save();
    c.globalAlpha = easeOut(step(t, 1.6, 0.5));
    const s = fit(c, String(f.sub), BODY, W - 120, H - y - 120, 34, 24, 1.3, false);
    c.font = `600 ${s.size}px ${BODY}`;
    c.fillStyle = '#ffffff';
    s.lines.forEach((l, i) => c.fillText(l, 60, y + i * s.lineH));
    c.restore();
  }
  logo(c, a.logoOutline, W - 120, H - 150, 150, t, 2);
  footer(c, b, W, H, '#ffffff', t);
};

const quote: Draw = (c, W, H, f, a, b, t) => {
  c.fillStyle = b.light;
  c.fillRect(0, 0, W, H);
  c.save();
  c.globalAlpha = 0.18;
  c.fillStyle = b.pop;
  for (let i = 0; i < 6; i++) c.fillRect(-200 + i * 260, 0, 90, H);
  c.restore();
  logo(c, a.logoNavy, W / 2, 140, 190, t, 0.1);
  label(c, f.tag || 'COMMUNITY VOICES', 60, 270, 28, b.dark, b.pop, t, 0.3);
  const bx = 60;
  const by = 350;
  const bw = W - 120;
  const bh = Math.min(H - by - 230, bw * 0.85);
  const p = easeBack(step(t, 0.4, 0.6));
  c.save();
  c.translate(bx + bw / 2, by + bh / 2);
  c.scale(p, p);
  c.fillStyle = b.dark;
  roundRect(c, -bw / 2, -bh / 2, bw, bh, 44);
  c.fill();
  c.beginPath();
  c.moveTo(bw / 2 - 220, bh / 2 - 2);
  c.lineTo(bw / 2 - 120, bh / 2 + 90);
  c.lineTo(bw / 2 - 110, bh / 2 - 2);
  c.fill();
  c.fillStyle = b.pop;
  c.font = `200px ${HEAVY}`;
  c.textBaseline = 'top';
  c.fillText('“', -bw / 2 + 40, -bh / 2 + 10);
  c.restore();
  if (p > 0.6) {
    const text = String(f.headline || 'What do you think?');
    // Typewriter.
    const shown = t === Infinity ? text.length : Math.floor(text.length * clamp((t - 0.9) / 1.6));
    const q = fit(c, text, HEAVY, bw - 120, bh - 260, 76, 34, 1.22, false);
    c.font = `${q.size}px ${HEAVY}`;
    c.fillStyle = '#ffffff';
    c.textBaseline = 'top';
    c.textAlign = 'left';
    let left = shown;
    q.lines.forEach((line, i) => {
      if (left <= 0) return;
      c.fillText(line.slice(0, left), bx + 60, by + 190 + i * q.lineH);
      left -= line.length + 1;
    });
    if (f.sub) {
      c.save();
      c.globalAlpha = easeOut(step(t, 2.4, 0.5));
      c.font = `600 30px ${BODY}`;
      c.fillStyle = b.pop;
      c.fillText(`— ${f.sub}`, bx + 60, by + bh - 90);
      c.restore();
    }
  }
  footer(c, b, W, H, b.dark, t, 2.2);
};

function playerCard(c: C, im: HTMLImageElement | null, name: string, x: number, y: number, w: number, h: number, b: Brand, p: number, fromLeft: boolean) {
  c.save();
  c.globalAlpha = clamp(p);
  c.translate((fromLeft ? -1 : 1) * (1 - p) * 300, 0);
  roundRect(c, x, y, w, h, 26);
  c.save();
  c.clip();
  photoOrPattern(c, im, b, x, y, w, h, 1);
  const g = c.createLinearGradient(0, y + h * 0.55, 0, y + h);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, b.dark);
  c.fillStyle = g;
  c.fillRect(x, y, w, h);
  c.restore();
  c.lineWidth = 6;
  c.strokeStyle = b.pop;
  roundRect(c, x, y, w, h, 26);
  c.stroke();
  const n = fit(c, name || 'Player', DISPLAY, w - 40, 140, 70, 34, 1.0);
  c.font = `${n.size}px ${DISPLAY}`;
  c.fillStyle = '#ffffff';
  c.textAlign = 'center';
  c.textBaseline = 'bottom';
  n.lines.forEach((l, i) => c.fillText(l, x + w / 2, y + h - 24 - (n.lines.length - 1 - i) * n.lineH));
  c.restore();
}

const versus: Draw = (c, W, H, f, a, b, t) => {
  texture(c, a, b, W, H, t);
  c.fillStyle = 'rgba(4,10,60,0.45)';
  c.fillRect(0, 0, W, H);
  const p0 = easeOut(step(t, 0.1, 0.6));
  c.save();
  c.globalAlpha = p0;
  c.font = `150px ${DISPLAY}`;
  c.textBaseline = 'top';
  c.textAlign = 'left';
  c.fillStyle = '#ffffff';
  c.fillText('NEXT', 60, 90);
  const nw = c.measureText('NEXT ').width;
  c.fillStyle = b.pop;
  c.fillText('MATCH', 60 + nw, 90);
  c.restore();
  const cw = (W - 180) / 2;
  const ch = Math.min(cw * 1.35, H - 600);
  const cy = 300 + (H - 300 - 260 - ch) / 2;
  playerCard(c, a.photos.p1Photo, f.p1Name, 60, cy, cw, ch, b, easeOut(step(t, 0.4, 0.6)), true);
  playerCard(c, a.photos.p2Photo, f.p2Name, W - 60 - cw, cy, cw, ch, b, easeOut(step(t, 0.55, 0.6)), false);
  const v = easeBack(step(t, 1.1, 0.5));
  c.save();
  c.translate(W / 2, cy + ch / 2);
  c.scale(v, v);
  c.fillStyle = b.pop;
  c.beginPath();
  c.arc(0, 0, 95, 0, Math.PI * 2);
  c.fill();
  c.font = `110px ${DISPLAY}`;
  c.fillStyle = b.dark;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('VS', 0, 6);
  c.restore();
  c.save();
  c.globalAlpha = easeOut(step(t, 1.5, 0.5));
  c.textAlign = 'center';
  c.textBaseline = 'top';
  c.font = `52px ${DISPLAY}`;
  c.fillStyle = '#ffffff';
  if (f.game) c.fillText(String(f.game).toUpperCase(), W / 2, cy + ch + 40);
  c.font = `600 34px ${BODY}`;
  c.fillStyle = b.pop;
  if (f.when) c.fillText(String(f.when), W / 2, cy + ch + 110);
  c.restore();
  logo(c, a.logoOutline, W - 110, 150, 130, t, 1.8);
  footer(c, b, W, H, '#ffffff', t);
};

export function parseRows(v: unknown): { name: string; value: string }[] {
  if (Array.isArray(v)) return v.map((r: any) => ({ name: String(r.name ?? ''), value: String(r.value ?? '') }));
  return String(v ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = /^(.*?)[,;\t]\s*([^,;\t]*)$/.exec(l);
      return m ? { name: m[1].trim(), value: m[2].trim() } : { name: l, value: '' };
    });
}

const leaderboard: Draw = (c, W, H, f, a, b, t) => {
  c.fillStyle = b.dark;
  c.fillRect(0, 0, W, H);
  if (a.bg) {
    c.save();
    c.globalAlpha = 0.35;
    cover(c, a.bg, 0, 0, W, H, 1.1, 0.5);
    c.restore();
  }
  c.save();
  c.globalAlpha = easeOut(step(t, 0, 0.5));
  c.font = `120px ${DISPLAY}`;
  c.fillStyle = b.pop;
  c.textBaseline = 'top';
  c.textAlign = 'left';
  c.fillText(String(f.headline || 'LEADERBOARD').toUpperCase(), 60, 70);
  c.font = `600 34px ${BODY}`;
  c.fillStyle = '#ffffff';
  if (f.sub) c.fillText(String(f.sub), 64, 205);
  c.restore();
  logo(c, a.logoOutline, W - 110, 130, 130, t, 0.4);
  const rows = parseRows(f.rows).slice(0, 10);
  const top = 280;
  const avail = H - top - 140;
  const rh = Math.min(96, avail / Math.max(rows.length, 5));
  rows.forEach((r, i) => {
    const p = easeOut(step(t, 0.4 + i * 0.12, 0.45));
    const y = top + i * rh;
    c.save();
    c.globalAlpha = p;
    c.translate((1 - p) * 120, 0);
    c.fillStyle = i < 3 ? b.pop : i % 2 ? 'rgba(255,255,255,0.08)' : 'rgba(29,68,249,0.45)';
    roundRect(c, 60, y + 6, W - 120, rh - 12, 14);
    c.fill();
    const fg = i < 3 ? b.dark : '#ffffff';
    c.fillStyle = fg;
    c.textBaseline = 'middle';
    c.font = `${Math.round(rh * 0.5)}px ${DISPLAY}`;
    c.textAlign = 'left';
    c.fillText(String(i + 1), 90, y + rh / 2 + 2);
    c.font = `${Math.round(rh * 0.36)}px ${HEAVY}`;
    const nm = r.name.toUpperCase();
    let shown = nm;
    while (c.measureText(shown).width > W - 420 && shown.length > 3) shown = shown.slice(0, -2);
    c.fillText(shown === nm ? nm : `${shown}…`, 170, y + rh / 2 + 2);
    c.textAlign = 'right';
    c.font = `${Math.round(rh * 0.42)}px ${DISPLAY}`;
    c.fillText(r.value, W - 90, y + rh / 2 + 2);
    c.restore();
  });
  if (!rows.length) {
    c.font = `600 34px ${BODY}`;
    c.fillStyle = '#ffffff';
    c.fillText('Add players (or fill from your rankings)', 60, top + 40);
  }
  footer(c, b, W, H, b.pop, t);
};

const promo: Draw = (c, W, H, f, a, b, t) => {
  texture(c, a, b, W, H, t);
  const im = a.photos.imageUrl;
  const top = im ? Math.round(H * 0.38) : 120;
  if (im) {
    c.save();
    c.globalAlpha = easeOut(step(t, 0, 0.7));
    cover(c, im, 0, 0, W, top + 80, t === Infinity ? 1.04 : 1.1 - 0.06 * (t / DURATION));
    const g = c.createLinearGradient(0, top - 200, 0, top + 80);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(4,21,104,1)');
    c.fillStyle = g;
    c.fillRect(0, 0, W, top + 82);
    c.restore();
  }
  logo(c, a.logoOutline, im ? W - 110 : W / 2, im ? 120 : 150, im ? 130 : 190, t, 0.2);
  let y = im ? top : top + 180;
  y += label(c, f.tag || '', 60, y, 30, b.pop, b.dark, t, 0.3) + (f.tag ? 20 : 0);
  const head = fit(c, String(f.headline || 'Big title'), DISPLAY, W - 120, H * 0.26, 190, 70, 0.98);
  y = riseLines(c, head, 60, y, t, 0.5, b.pop) + 14;
  if (f.sub) {
    const s = fit(c, String(f.sub), HEAVY, W - 120, 150, 54, 30, 1.15);
    y = riseLines(c, s, 60, y, t, 0.9, '#ffffff', 'left', HEAVY) + 20;
  }
  const lines = String(f.lines || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 6);
  lines.forEach((l, i) => {
    const p = easeOut(step(t, 1.3 + i * 0.12, 0.4));
    c.save();
    c.globalAlpha = p;
    c.fillStyle = b.pop;
    c.fillRect(60, y + i * 58 + 12, 14, 14);
    c.font = `600 36px ${BODY}`;
    c.fillStyle = '#ffffff';
    c.textBaseline = 'top';
    c.textAlign = 'left';
    c.fillText(l, 92, y + i * 58);
    c.restore();
  });
  if (f.price) {
    const p = easeBack(step(t, 1.9, 0.5));
    c.save();
    c.translate(W - 200, im ? Math.max(200, top - 190) : 330);
    c.rotate(-0.12);
    c.scale(p, p);
    c.fillStyle = b.pop;
    c.beginPath();
    for (let i = 0; i < 24; i++) {
      const r = i % 2 ? 120 : 138;
      const an = (i / 24) * Math.PI * 2;
      c.lineTo(Math.cos(an) * r, Math.sin(an) * r);
    }
    c.closePath();
    c.fill();
    const pf = fit(c, String(f.price), DISPLAY, 190, 170, 80, 32, 1);
    c.font = `${pf.size}px ${DISPLAY}`;
    c.fillStyle = b.dark;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    pf.lines.forEach((l, i) => c.fillText(l, 0, (i - (pf.lines.length - 1) / 2) * pf.lineH + 4));
    c.restore();
  }
  if (f.cta) {
    const p = easeOut(step(t, 2.2, 0.5));
    c.save();
    c.globalAlpha = p;
    c.fillStyle = b.pop;
    c.fillRect(0, H - 170, W * p, 84);
    c.font = `40px ${DISPLAY}`;
    c.fillStyle = b.dark;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(String(f.cta).toUpperCase(), W / 2, H - 126);
    c.restore();
  }
  footer(c, b, W, H, '#ffffff', t);
};

const winner: Draw = (c, W, H, f, a, b, t) => {
  c.fillStyle = b.dark;
  c.fillRect(0, 0, W, H);
  c.save();
  c.globalAlpha = easeOut(step(t, 0, 0.8));
  photoOrPattern(c, a.photos.imageUrl, b, 0, 0, W, H * 0.78, t === Infinity ? 1.04 : 1.12 - 0.08 * (t / DURATION));
  c.restore();
  const g = c.createLinearGradient(0, H * 0.35, 0, H * 0.8);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, b.dark);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H * 0.8 + 2);
  // Confetti.
  const seedRand = (n: number) => {
    const x = Math.sin(n * 999.7) * 43758.5453;
    return x - Math.floor(x);
  };
  const tt = t === Infinity ? 2.6 : t;
  if (tt > 0.6) {
    for (let i = 0; i < 70; i++) {
      const x = seedRand(i) * W;
      const sp = 220 + seedRand(i + 100) * 320;
      const y = -40 + ((tt - 0.6) * sp + seedRand(i + 200) * H * 0.6) % (H + 80);
      c.save();
      c.translate(x + Math.sin(tt * 3 + i) * 20, y);
      c.rotate(tt * 4 + i);
      c.fillStyle = [b.pop, '#ffffff', b.main, b.light][i % 4];
      c.fillRect(-8, -4, 16, 8);
      c.restore();
    }
  }
  const word = String(f.tag || 'WINNER').toUpperCase();
  const p = easeBack(step(t, 0.5, 0.6));
  c.save();
  c.translate(W / 2, H * 0.6);
  c.scale(p, p);
  const wf = fit(c, word, DISPLAY, W - 100, 260, 240, 90, 1);
  c.font = `${wf.size}px ${DISPLAY}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.lineWidth = 10;
  c.strokeStyle = b.dark;
  c.strokeText(wf.lines[0] ?? word, 0, 0);
  c.fillStyle = b.pop;
  c.fillText(wf.lines[0] ?? word, 0, 0);
  c.restore();
  const n = fit(c, String(f.headline || 'Champion'), HEAVY, W - 120, 150, 80, 40, 1.05);
  riseLines(c, n, W / 2, H * 0.6 + 130, t, 1.0, '#ffffff', 'center', HEAVY);
  if (f.sub) {
    c.save();
    c.globalAlpha = easeOut(step(t, 1.5, 0.5));
    const s = fit(c, String(f.sub), BODY, W - 160, 120, 36, 24, 1.3, false);
    c.font = `600 ${s.size}px ${BODY}`;
    c.fillStyle = b.pop;
    c.textAlign = 'center';
    c.textBaseline = 'top';
    s.lines.forEach((l, i) => c.fillText(l, W / 2, H * 0.6 + 150 + n.lines.length * n.lineH + i * s.lineH));
    c.restore();
  }
  logo(c, a.logoOutline, W / 2, 120, 150, t, 1.6);
  footer(c, b, W, H, '#ffffff', t);
};

const BASE_DRAW: Record<string, Draw> = { news, breaking, quote, versus, leaderboard, promo, winner };

/** Draws one frame. `t` in seconds; Infinity = the finished still picture. */
export function drawFrame(canvas: HTMLCanvasElement, spec: Spec, assets: Assets, brand: Brand, t: number) {
  const { w, h } = FORMATS[spec.format] ?? FORMATS.post;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const c = canvas.getContext('2d')!;
  c.save();
  c.clearRect(0, 0, w, h);
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  (DRAW[spec.template] ?? news)(c, w, h, spec.fields ?? {}, assets, brand, t);
  c.restore();
}

export function canvasBlob(canvas: HTMLCanvasElement, type = 'image/jpeg', q = 0.92) {
  return new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not save the picture'))), type, q));
}

export function blobToDataUrl(b: Blob) {
  return new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });
}

/** Best video type this browser can record: MP4 (Chrome/Edge 126+, Safari) or WebM. */
export function videoType() {
  const list = ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1.42E01F', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];
  return typeof MediaRecorder === 'undefined' ? null : (list.find((m) => MediaRecorder.isTypeSupported(m)) ?? null);
}

/** Plays the animation once in real time and records it (keep the tab open while it records). */
export async function recordVideo(canvas: HTMLCanvasElement, render: (t: number) => void, seconds: number, onProgress?: (p: number) => void) {
  const type = videoType();
  if (!type || !canvas.captureStream) throw new Error('This browser cannot make videos. Use Chrome or Edge.');
  const stream = canvas.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<void>((res) => (rec.onstop = () => res()));
  render(0);
  rec.start(250);
  const start = performance.now();
  await new Promise<void>((res) => {
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      render(Math.min(t, seconds));
      onProgress?.(Math.min(1, t / seconds));
      if (t >= seconds + 0.3) return res();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  rec.stop();
  await done;
  stream.getTracks().forEach((x) => x.stop());
  return new Blob(chunks, { type: type.split(';')[0] });
}

/** Shrinks an uploaded photo (max 1280 px, JPEG) so drafts stay small. */
export async function shrinkPhoto(file: File, max = 1280) {
  const url = URL.createObjectURL(file);
  try {
    const im = await loadImg(url);
    if (!im) throw new Error('That file is not a picture');
    const s = Math.min(1, max / Math.max(im.width, im.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(im.width * s);
    cv.height = Math.round(im.height * s);
    cv.getContext('2d')!.drawImage(im, 0, 0, cv.width, cv.height);
    return isCutout(im) ? smallAlphaUrl(cv) : cv.toDataURL('image/jpeg', 0.86);
  } finally {
    imgCache.delete(url);
    URL.revokeObjectURL(url);
  }
}

/** A finished design as a data URL small enough to save with a post (JPEG, lowering quality until it fits). */
export function postableDataUrl(cv: HTMLCanvasElement) {
  let u = '';
  for (let q = 0.92; q >= 0.5; q -= 0.07) {
    u = cv.toDataURL('image/jpeg', q);
    if (u.length < 680_000) return u;
  }
  return u;
}

/** A see-through picture as a data URL small enough to save with a draft (WebP, PNG if WebP is missing). */
function smallAlphaUrl(cv: HTMLCanvasElement) {
  for (let q = 0.9; q >= 0.5; q -= 0.1) {
    const u = cv.toDataURL('image/webp', q);
    if (!u.startsWith('data:image/webp')) break;
    if (u.length < 650_000) return u;
  }
  const png = cv.toDataURL('image/png');
  if (png.length < 650_000) return png;
  const s = Math.sqrt(600_000 / png.length);
  const sm = document.createElement('canvas');
  sm.width = Math.round(cv.width * s);
  sm.height = Math.round(cv.height * s);
  sm.getContext('2d')!.drawImage(cv, 0, 0, sm.width, sm.height);
  return sm.toDataURL('image/png');
}

/**
 * Removes a plain or simple background (studio wall, sky, green screen, the white background an AI picture
 * was made on). Fills in from the edges of the picture through every pixel close to the edge colours, then
 * softens the cut edge. Busy backgrounds need a proper cut-out (the "Remove background" prompt).
 */
export async function removeBackground(src: string, tolerance = 45): Promise<string> {
  const im = await loadPhoto(src);
  if (!im) throw new Error('Could not open that picture');
  const s = Math.min(1, 1280 / Math.max(im.width, im.height));
  const w = Math.max(1, Math.round(im.width * s));
  const h = Math.max(1, Math.round(im.height * s));
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const x = cv.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(im, 0, 0, w, h);
  const img = x.getImageData(0, 0, w, h);
  const d = img.data;
  // The main colours along the edge.
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  // Top and side edges only: people usually run off the bottom of a photo.
  const border: number[] = [];
  for (let i = 0; i < w; i++) border.push(i);
  for (let j = 0; j < h; j++) border.push(j * w, j * w + w - 1);
  for (const i of border) {
    const o = i * 4;
    if (d[o + 3] < 20) continue;
    const k = ((d[o] >> 4) << 8) | ((d[o + 1] >> 4) << 4) | (d[o + 2] >> 4);
    const e = buckets.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++;
    e.r += d[o];
    e.g += d[o + 1];
    e.b += d[o + 2];
    buckets.set(k, e);
  }
  const refs = [...buckets.values()]
    .sort((p, q) => q.n - p.n)
    .slice(0, 6)
    .filter((e) => e.n > border.length * 0.06)
    .map((e) => [e.r / e.n, e.g / e.n, e.b / e.n]);
  if (!refs.length) throw new Error('This picture already has no background');
  const tol2 = tolerance * tolerance;
  const near = (o: number) => {
    for (const [r, g, b] of refs) {
      const dr = d[o] - r;
      const dg = d[o + 1] - g;
      const db = d[o + 2] - b;
      if (dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11 < tol2 * 0.5) return true;
    }
    return false;
  };
  const step = (o: number, p: number) => {
    const dr = d[o] - d[p];
    const dg = d[o + 1] - d[p + 1];
    const db = d[o + 2] - d[p + 2];
    return dr * dr + dg * dg + db * db < tol2 * 0.12;
  };
  const bg = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < w; i++) border.push((h - 1) * w + i);
  for (const i of border) {
    if (!bg[i] && (d[i * 4 + 3] < 20 || near(i * 4))) {
      bg[i] = 1;
      queue[tail++] = i;
    }
  }
  while (head < tail) {
    const i = queue[head++];
    const px = i % w;
    const o = i * 4;
    for (const n of [px > 0 ? i - 1 : -1, px < w - 1 ? i + 1 : -1, i - w, i + w]) {
      if (n < 0 || n >= w * h || bg[n]) continue;
      const no = n * 4;
      // close to a background colour, or a smooth continuation of a shaded background
      if (d[no + 3] < 20 || near(no) || (step(no, o) && nearLoose(no))) {
        bg[n] = 1;
        queue[tail++] = n;
      }
    }
  }
  function nearLoose(o: number) {
    for (const [r, g, b] of refs) {
      const dr = d[o] - r;
      const dg = d[o + 1] - g;
      const db = d[o + 2] - b;
      if (dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11 < tol2 * 2) return true;
    }
    return false;
  }
  if (tail > w * h * 0.97) throw new Error('That would remove the whole picture — try "Gentle"');
  // Soft edge: alpha from a 3×3 average of the mask.
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      if (bg[k]) {
        d[k * 4 + 3] = 0;
        continue;
      }
      let n = 0;
      let c = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = i + dx;
          const yy = j + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          c++;
          if (bg[yy * w + xx]) n++;
        }
      if (n) d[k * 4 + 3] = Math.round(d[k * 4 + 3] * (1 - (n / c) * 0.7));
    }
  }
  x.putImageData(img, 0, 0);
  // Trim the empty space around the cut-out.
  let x0 = w;
  let y0 = h;
  let x1 = 0;
  let y1 = 0;
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++)
      if (d[(j * w + i) * 4 + 3] > 30) {
        if (i < x0) x0 = i;
        if (i > x1) x1 = i;
        if (j < y0) y0 = j;
        if (j > y1) y1 = j;
      }
  if (x1 <= x0 || y1 <= y0) throw new Error('Nothing was left — try "Gentle"');
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d')!.drawImage(cv, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return smallAlphaUrl(out);
}

// ───────── More looks: 10 layouts × 4 brand colourways = 40 ─────────

type PalKey = 'navy' | 'blue' | 'lime' | 'light' | 'black' | 'white';
interface Pal {
  bg: string;
  fg: string;
  acc: string;
  onAcc: string;
  dark: boolean;
  tex: boolean;
}
const PAL_NAME: Record<PalKey, string> = { navy: 'navy', blue: 'blue', lime: 'lime', light: 'light', black: 'black', white: 'white' };

function pal(k: PalKey, b: Brand): Pal {
  switch (k) {
    case 'navy':
      return { bg: b.dark, fg: '#ffffff', acc: b.pop, onAcc: b.dark, dark: true, tex: true };
    case 'blue':
      return { bg: b.main, fg: '#ffffff', acc: b.pop, onAcc: b.dark, dark: true, tex: false };
    case 'lime':
      return { bg: b.pop, fg: b.dark, acc: b.dark, onAcc: b.pop, dark: false, tex: false };
    case 'light':
      return { bg: b.light, fg: b.dark, acc: b.main, onAcc: '#ffffff', dark: false, tex: false };
    case 'black':
      return { bg: '#08080d', fg: '#ffffff', acc: b.pop, onAcc: b.dark, dark: true, tex: false };
    default:
      return { bg: '#ffffff', fg: b.dark, acc: b.main, onAcc: '#ffffff', dark: false, tex: false };
  }
}

/** #rrggbb → rgba() with alpha. */
function hexA(hex: string, a: number) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
const soft = (p: Pal, alpha: number) => (p.dark ? `rgba(255,255,255,${alpha})` : `rgba(4,21,104,${alpha})`);
const logoFor = (p: Pal, a: Assets) => (p.dark ? a.logoOutline : a.logoNavy);
const slowZoom = (t: number, from = 1.1, to = 1.03) => (t === Infinity ? to : from - (from - to) * easeOut(t / DURATION));

/** Background in the colourway: the blue texture for navy, faint diagonal lines otherwise. */
function ground(c: C, a: Assets, p: Pal, W: number, H: number, t: number) {
  c.fillStyle = p.bg;
  c.fillRect(0, 0, W, H);
  if (p.tex && a.bg) {
    c.save();
    c.globalAlpha = 0.55;
    cover(c, a.bg, 0, 0, W, H, slowZoom(t, 1.0, 1.04), 0.5);
    c.restore();
    return;
  }
  c.save();
  c.strokeStyle = soft(p, 0.06);
  c.lineWidth = 2;
  for (let i = -H; i < W; i += 38) {
    c.beginPath();
    c.moveTo(i, H);
    c.lineTo(i + H, 0);
    c.stroke();
  }
  c.restore();
}

/** Body text that fades in; returns the y under it. */
function para(c: C, text: unknown, x: number, y: number, w: number, maxH: number, max: number, min: number, color: string, t: number, start: number, align: CanvasTextAlign = 'left', alpha = 0.9) {
  if (!text || maxH < min) return y;
  const s = fit(c, String(text), BODY, w, maxH, max, min, 1.3, false);
  c.save();
  c.globalAlpha = alpha * easeOut(step(t, start, 0.5));
  c.font = `600 ${s.size}px ${BODY}`;
  c.fillStyle = color;
  c.textAlign = align;
  c.textBaseline = 'top';
  s.lines.forEach((l, i) => c.fillText(l, x, y + i * s.lineH));
  c.restore();
  return y + s.lines.length * s.lineH;
}

function handleLine(c: C, b: Brand, x: number, y: number, color: string, t: number, align: CanvasTextAlign = 'left') {
  c.save();
  c.globalAlpha = easeOut(step(t, 1.8, 0.6));
  c.font = `26px ${HEAVY}`;
  c.fillStyle = color;
  c.textAlign = align;
  c.textBaseline = 'alphabetic';
  c.fillText(b.handle ? `FOLLOW ${b.handle.toUpperCase()}` : b.centre.toUpperCase(), x, y);
  c.restore();
}

function clipText(c: C, s: string, maxW: number) {
  if (c.measureText(s).width <= maxW) return s;
  let x = s;
  while (x.length > 2 && c.measureText(`${x}…`).width > maxW) x = x.slice(0, -1);
  return `${x}…`;
}

function sourceLine(c: C, f: Record<string, any>, x: number, y: number, color: string, t: number) {
  if (!f.source) return;
  c.save();
  c.globalAlpha = 0.6 * easeOut(step(t, 1.6, 0.5));
  c.font = `22px ${BODY}`;
  c.fillStyle = color;
  c.textAlign = 'left';
  c.textBaseline = 'top';
  c.fillText(`Source: ${f.source}`, x, y);
  c.restore();
}

/** 1. Split — picture on one half, story on the other (top/bottom on Story size). */
const splitLook = (k: PalKey, flip: boolean): Draw => (c, W, H, f, a, b, t) => {
  const p = pal(k, b);
  ground(c, a, p, W, H, t);
  const story = H > W * 1.5;
  const pw = story ? W : Math.round(W * 0.5);
  const ph = story ? Math.round(H * 0.48) : H;
  const px = story || !flip ? 0 : W - pw;
  const r = easeOut(step(t, 0, 0.8));
  c.save();
  c.beginPath();
  if (story) c.rect(0, 0, W, ph * r);
  else c.rect(flip ? px + pw * (1 - r) : px, 0, pw * r, H);
  c.clip();
  photoOrPattern(c, a.photos.imageUrl, b, px, 0, pw, ph, slowZoom(t));
  c.restore();
  c.fillStyle = p.acc;
  if (story) c.fillRect(0, ph - 6, W * r, 12);
  else c.fillRect(flip ? px - 6 : px + pw - 6, 0, 12, H * r);
  const tx = story || flip ? 60 : pw + 56;
  const tw = story ? W - 120 : W - pw - 116;
  let y = story ? ph + 50 : 80;
  logo(c, logoFor(p, a), tx + 60, y + 45, 120, t, 0.3);
  y += 120;
  y += label(c, f.tag || 'GAMING NEWS', tx, y, 26, p.acc, p.onAcc, t, 0.4) + 26;
  const bottom = H - 110;
  const head = fit(c, String(f.headline || 'Your headline here'), DISPLAY, tw, (bottom - y) * 0.62, story ? 150 : 120, 44);
  y = riseLines(c, head, tx, y, t, 0.6, p.fg) + 24;
  y = para(c, f.sub, tx, y, tw, bottom - y - 50, 34, 22, p.fg, t, 1.3);
  sourceLine(c, f, tx, y + 16, p.fg, t);
  handleLine(c, b, tx, H - 52, p.fg, t);
};

/** 2. Magazine cover — full photo, masthead, cover lines, big headline. */
const coverLook = (k: PalKey): Draw => (c, W, H, f, a, b, t) => {
  const p = pal(k, b);
  c.fillStyle = p.bg;
  c.fillRect(0, 0, W, H);
  c.save();
  c.globalAlpha = easeOut(step(t, 0, 0.8));
  photoOrPattern(c, a.photos.imageUrl, b, 0, 0, W, H, slowZoom(t, 1.14, 1.04));
  c.restore();
  let g = c.createLinearGradient(0, 0, 0, H * 0.3);
  g.addColorStop(0, hexA(p.bg, 0.9));
  g.addColorStop(1, hexA(p.bg, 0));
  c.fillStyle = g;
  c.fillRect(0, 0, W, H * 0.3);
  g = c.createLinearGradient(0, H * 0.45, 0, H);
  g.addColorStop(0, hexA(p.bg, 0));
  g.addColorStop(0.6, hexA(p.bg, 0.95));
  g.addColorStop(1, p.bg);
  c.fillStyle = g;
  c.fillRect(0, H * 0.45, W, H * 0.55);
  const mast = String(f.tag || 'ZMG').toUpperCase();
  const mf = fit(c, mast, DISPLAY, W - 100, H * 0.17, 280, 80, 1);
  const mp = easeOut(step(t, 0.2, 0.7));
  c.save();
  c.globalAlpha = mp;
  c.font = `${mf.size}px ${DISPLAY}`;
  c.fillStyle = p.acc;
  c.textAlign = 'center';
  c.textBaseline = 'top';
  c.fillText(mf.lines[0] ?? mast, W / 2, 36 - (1 - mp) * 60);
  c.font = `22px ${HEAVY}`;
  c.fillStyle = p.fg;
  const date = new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' }).toUpperCase();
  c.fillText(`${date}  ·  ${(b.handle || b.centre).toUpperCase()}`, W / 2, 36 + mf.size + 6);
  c.restore();
  const lines = String(f.lines || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 3);
  lines.forEach((l, i) => {
    const q = easeOut(step(t, 0.8 + i * 0.15, 0.5));
    const y = H * 0.34 + i * 74;
    c.save();
    c.globalAlpha = q;
    c.translate((1 - q) * -80, 0);
    c.fillStyle = p.dark ? p.acc : b.pop;
    c.fillRect(60, y, 10, 48);
    c.font = `34px ${HEAVY}`;
    c.fillStyle = '#ffffff';
    c.shadowColor = 'rgba(0,0,0,0.7)';
    c.shadowBlur = 14;
    c.textBaseline = 'top';
    c.textAlign = 'left';
    c.fillText(clipText(c, l.toUpperCase(), W * 0.6), 86, y + 4);
    c.restore();
  });
  const head = fit(c, String(f.headline || 'Your headline here'), DISPLAY, W - 120, H * 0.24, 150, 60, 0.95);
  const hy = H - 120 - head.lines.length * head.lineH;
  if (f.sub) {
    c.font = `26px ${HEAVY}`;
    label(c, clipText(c, String(f.sub).toUpperCase(), W - 180), 60, hy - 70, 26, p.acc, p.onAcc, t, 0.9);
  }
  riseLines(c, head, 60, hy, t, 1.0, p.fg);
  footer(c, b, W, H, p.fg, t);
};

/** 3. Big statement — one giant word or number. */
const bigwordLook = (k: PalKey): Draw => (c, W, H, f, a, b, t) => {
  const p = pal(k, b);
  ground(c, a, p, W, H, t);
  const word = String(f.tag || 'GG').toUpperCase();
  const wf = fit(c, word, DISPLAY, W - 120, H * 0.42, 560, 120, 0.92);
  const blockH = wf.lines.length * wf.lineH;
  const top = H > W * 1.5 ? H * 0.24 : H * 0.12;
  c.save();
  c.font = `${wf.size}px ${DISPLAY}`;
  c.textAlign = 'center';
  c.textBaseline = 'top';
  c.lineWidth = 3;
  c.strokeStyle = p.acc;
  for (let e = 3; e >= 1; e--) {
    c.globalAlpha = 0.22 * easeOut(step(t, 0.15 * e, 0.7));
    const d = e * 16 * easeOut(step(t, 0.15 * e, 0.9));
    wf.lines.forEach((l, i) => c.strokeText(l, W / 2 + d, top + i * wf.lineH + d));
  }
  c.restore();
  const s = easeBack(step(t, 0.1, 0.6));
  c.save();
  c.globalAlpha = clamp(s);
  c.translate(W / 2, top + blockH / 2);
  c.scale(s, s);
  c.font = `${wf.size}px ${DISPLAY}`;
  c.fillStyle = p.acc;
  c.textAlign = 'center';
  c.textBaseline = 'top';
  wf.lines.forEach((l, i) => c.fillText(l, 0, -blockH / 2 + i * wf.lineH));
  c.restore();
  // Corner brackets.
  const q = easeOut(step(t, 0.6, 0.6));
  const L = 70 * q;
  c.save();
  c.strokeStyle = p.acc;
  c.lineWidth = 8;
  for (const [x, y, dx, dy] of [
    [40, 40, 1, 1],
    [W - 40, 40, -1, 1],
    [40, H - 100, 1, -1],
    [W - 40, H - 100, -1, -1],
  ]) {
    c.beginPath();
    c.moveTo(x + dx * L, y);
    c.lineTo(x, y);
    c.lineTo(x, y + dy * L);
    c.stroke();
  }
  c.restore();
  let y = top + blockH + 50;
  const head = fit(c, String(f.headline || 'Say it loud'), HEAVY, W - 180, H * 0.2, 76, 34, 1.12);
  y = riseLines(c, head, W / 2, y, t, 0.7, p.fg, 'center', HEAVY) + 20;
  y = para(c, f.sub, W / 2, y, W - 200, H - y - 260, 36, 24, p.fg, t, 1.2, 'center', 0.85);
  if (y < H - 260) logo(c, logoFor(p, a), W / 2, H - 185, 120, t, 1.4);
  footer(c, b, W, H, p.fg, t);
};

/** 4. News card — floating card with picture and story. */
const cardLook = (k: PalKey): Draw => (c, W, H, f, a, b, t) => {
  const p = pal(k, b);
  ground(c, a, p, W, H, t);
  logo(c, logoFor(p, a), W / 2, 100, 140, t, 0.1);
  const cx = 60;
  const cy = 190;
  const cw = W - 120;
  const ch = H - 190 - 120;
  const cardBg = p.dark ? '#ffffff' : b.dark;
  const cardFg = p.dark ? b.dark : '#ffffff';
  const q = easeOut(step(t, 0.2, 0.7));
  c.save();
  c.translate(0, (1 - q) * 120);
  c.globalAlpha = q;
  c.shadowColor = 'rgba(0,0,0,0.35)';
  c.shadowBlur = 40;
  c.shadowOffsetY = 16;
  c.fillStyle = cardBg;
  roundRect(c, cx, cy, cw, ch, 36);
  c.fill();
  c.shadowColor = 'transparent';
  const phh = Math.round(ch * 0.52);
  c.save();
  c.beginPath();
  c.roundRect(cx, cy, cw, phh, [36, 36, 0, 0]);
  c.clip();
  photoOrPattern(c, a.photos.imageUrl, b, cx, cy, cw, phh, slowZoom(t));
  c.restore();
  label(c, f.tag || 'GAMING NEWS', cx + 40, cy + phh - 26, 26, b.pop, b.dark, t, 0.5);
  const head = fit(c, String(f.headline || 'Your headline here'), DISPLAY, cw - 80, (ch - phh) * 0.55, 96, 40);
  let y = riseLines(c, head, cx + 40, cy + phh + 50, t, 0.7, cardFg) + 18;
  y = para(c, f.sub, cx + 40, y, cw - 80, cy + ch - y - 60, 32, 22, cardFg, t, 1.3, 'left', 0.75);
  sourceLine(c, f, cx + 40, cy + ch - 50, cardFg, t);
  c.restore();
  footer(c, b, W, H, p.fg, t);
};

/** 5. TV broadcast — LIVE pill, lower third and a scrolling ticker. */
const broadcastLook = (k: PalKey): Draw => (c, W, H, f, a, b, t) => {
  const p = pal(k, b);
  c.fillStyle = '#000';
  c.fillRect(0, 0, W, H);
  photoOrPattern(c, a.photos.imageUrl, b, 0, 0, W, H, slowZoom(t, 1.12, 1.03));
  let g = c.createLinearGradient(0, 0, 0, 280);
  g.addColorStop(0, 'rgba(0,0,0,0.6)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, W, 280);
  g = c.createLinearGradient(0, H * 0.45, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.88)');
  c.fillStyle = g;
  c.fillRect(0, H * 0.45, W, H * 0.55);
  const pill = String(f.tag || 'LIVE').toUpperCase().slice(0, 16);
  c.save();
  c.globalAlpha = easeOut(step(t, 0.2, 0.4));
  c.font = `30px ${HEAVY}`;
  const pw = c.measureText(pill).width + 110;
  c.fillStyle = 'rgba(0,0,0,0.55)';
  roundRect(c, 50, 60, pw, 64, 32);
  c.fill();
  const pulse = t === Infinity ? 1 : 0.65 + 0.35 * Math.sin(t * 6);
  c.fillStyle = '#ff2d2d';
  c.beginPath();
  c.arc(88, 92, 13 * pulse, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#ffffff';
  c.textBaseline = 'middle';
  c.textAlign = 'left';
  c.fillText(pill, 114, 94);
  c.restore();
  logo(c, a.logoOutline, W - 110, 92, 120, t, 0.3);
  const head = fit(c, String(f.headline || 'Your headline here'), DISPLAY, W - 180, 240, 86, 40, 1.05);
  const bh = head.lines.length * head.lineH + 50;
  const by = H - 180 - bh;
  label(c, String(f.source || 'BREAKING NEWS'), 40, by - 52, 24, p.acc, p.onAcc, t, 0.5);
  const q = easeOut(step(t, 0.4, 0.6));
  c.fillStyle = p.bg;
  c.fillRect(40, by, (W - 80) * q, bh);
  c.fillStyle = p.acc;
  c.fillRect(40, by, 14, bh * q);
  riseLines(c, head, 84, by + 25, t, 0.7, p.fg);
  // Ticker.
  const ty = H - 150;
  const th = 62;
  c.save();
  c.fillStyle = p.acc;
  c.fillRect(0, ty, W, th);
  c.beginPath();
  c.rect(0, ty, W, th);
  c.clip();
  c.font = `28px ${HEAVY}`;
  c.fillStyle = p.onAcc;
  c.textBaseline = 'middle';
  c.textAlign = 'left';
  const msg = `${String(f.sub || f.headline || 'ZMG').toUpperCase()}     •     `;
  const mw = Math.max(200, c.measureText(msg).width);
  const off = t === Infinity ? 0 : (t * 220) % mw;
  for (let x = 30 - off; x < W; x += mw) c.fillText(msg, x, ty + th / 2 + 2);
  c.restore();
  footer(c, b, W, H, '#ffffff', t);
};

/** 6. Countdown — big number inside an animated ring. */
const countdownLook = (k: PalKey): Draw => (c, W, H, f, a, b, t) => {
  const p = pal(k, b);
  ground(c, a, p, W, H, t);
  label(c, f.tag || 'TOURNAMENT', 60, 80, 30, p.acc, p.onAcc, t, 0.1);
  logo(c, logoFor(p, a), W - 110, 110, 120, t, 0.2);
  const R = Math.min(W, H * 0.62) * 0.33;
  const cx = W / 2;
  const cy = H * 0.41;
  c.save();
  c.translate(cx, cy);
  c.rotate(t === Infinity ? 0 : t * 0.15);
  c.strokeStyle = soft(p, 0.35);
  c.lineWidth = 4;
  for (let i = 0; i < 60; i++) {
    const an = (i / 60) * Math.PI * 2;
    const r2 = R + (i % 5 ? 40 : 58);
    c.beginPath();
    c.moveTo(Math.cos(an) * (R + 28), Math.sin(an) * (R + 28));
    c.lineTo(Math.cos(an) * r2, Math.sin(an) * r2);
    c.stroke();
  }
  c.restore();
  c.save();
  c.lineWidth = 34;
  c.strokeStyle = soft(p, 0.12);
  c.beginPath();
  c.arc(cx, cy, R, 0, Math.PI * 2);
  c.stroke();
  const sweep = 0.78 * easeOut(step(t, 0.3, 1.4));
  c.strokeStyle = p.acc;
  c.lineCap = 'round';
  if (sweep > 0.001) {
    c.beginPath();
    c.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + sweep * Math.PI * 2);
    c.stroke();
  }
  c.restore();
  const nf = fit(c, String(f.headline || '3'), DISPLAY, R * 1.4, R * 0.95, 380, 80, 1);
  const s = easeBack(step(t, 0.5, 0.6));
  c.save();
  c.translate(cx, cy - R * 0.12);
  c.scale(s, s);
  c.globalAlpha = clamp(s);
  c.font = `${nf.size}px ${DISPLAY}`;
  c.fillStyle = p.fg;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(nf.lines[0] ?? '', 0, 0);
  c.restore();
  c.save();
  c.globalAlpha = easeOut(step(t, 0.9, 0.5));
  c.font = `${Math.round(R * 0.13)}px ${HEAVY}`;
  c.fillStyle = p.acc;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(String(f.sub || 'DAYS TO GO').toUpperCase(), cx, cy + R * 0.45);
  c.restore();
  const y = cy + R + 90;
  if (f.when) {
    const wf = fit(c, String(f.when), HEAVY, W - 140, Math.max(40, H - y - 260), 60, 28, 1.15);
    riseLines(c, wf, W / 2, y, t, 1.2, p.fg, 'center', HEAVY);
  }
  if (f.cta) {
    const q = easeOut(step(t, 1.8, 0.5));
    c.save();
    c.globalAlpha = q;
    c.fillStyle = p.acc;
    c.fillRect(0, H - 170, W * q, 80);
    c.font = `38px ${DISPLAY}`;
    c.fillStyle = p.onAcc;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(String(f.cta).toUpperCase(), W / 2, H - 128);
    c.restore();
  }
  footer(c, b, W, H, p.fg, t);
};

/** 7. Fixtures — time chips and matches. */
const fixturesLook = (k: PalKey): Draw => (c, W, H, f, a, b, t) => {
  const p = pal(k, b);
  ground(c, a, p, W, H, t);
  c.save();
  c.globalAlpha = easeOut(step(t, 0, 0.5));
  const title = fit(c, String(f.headline || 'FIXTURES'), DISPLAY, W - 300, 130, 116, 50, 1);
  c.font = `${title.size}px ${DISPLAY}`;
  c.fillStyle = p.acc;
  c.textAlign = 'left';
  c.textBaseline = 'top';
  c.fillText(title.lines[0] ?? '', 60, 70);
  c.font = `600 32px ${BODY}`;
  c.fillStyle = p.fg;
  if (f.sub) c.fillText(clipText(c, String(f.sub), W - 300), 64, 70 + title.size + 14);
  c.restore();
  logo(c, logoFor(p, a), W - 110, 125, 130, t, 0.3);
  const rows = parseRows(f.rows).slice(0, 8);
  const top = 300;
  const avail = H - top - (f.when ? 210 : 150);
  const rh = Math.min(H > W * 1.5 ? 170 : 124, avail / Math.max(rows.length, 4));
  rows.forEach((r, i) => {
    const q = easeOut(step(t, 0.4 + i * 0.12, 0.45));
    const y = top + i * rh;
    c.save();
    c.globalAlpha = q;
    c.translate((1 - q) * -120, 0);
    c.fillStyle = soft(p, 0.08);
    roundRect(c, 60, y + 8, W - 120, rh - 16, 18);
    c.fill();
    c.font = `${Math.round(rh * 0.28)}px ${HEAVY}`;
    const time = clipText(c, r.name.toUpperCase(), W * 0.3);
    const chipW = Math.max(rh * 1.7, c.measureText(time).width + 44);
    c.fillStyle = p.acc;
    roundRect(c, 60, y + 8, chipW, rh - 16, 18);
    c.fill();
    c.fillStyle = p.onAcc;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(time, 60 + chipW / 2, y + rh / 2 + 2);
    c.font = `${Math.round(rh * 0.32)}px ${HEAVY}`;
    c.fillStyle = p.fg;
    c.textAlign = 'left';
    c.fillText(clipText(c, (r.value || '').toUpperCase(), W - 120 - chipW - 60), 60 + chipW + 30, y + rh / 2 + 2);
    c.restore();
  });
  if (!rows.length) {
    c.font = `600 32px ${BODY}`;
    c.fillStyle = p.fg;
    c.textAlign = 'left';
    c.textBaseline = 'top';
    c.fillText('One per line: time, match', 60, top + 30);
  }
  if (f.when) para(c, f.when, 60, H - 175, W - 120, 60, 32, 22, p.fg, t, 1.6);
  footer(c, b, W, H, p.fg, t);
};

/** 8. Player spotlight — photo plus stat tiles that count up. */
const statsLook = (k: PalKey, flip: boolean): Draw => (c, W, H, f, a, b, t) => {
  const p = pal(k, b);
  ground(c, a, p, W, H, t);
  const story = H > W * 1.5;
  label(c, f.tag || 'PLAYER SPOTLIGHT', 60, 70, 26, p.acc, p.onAcc, t, 0.1);
  logo(c, logoFor(p, a), W - 110, 105, 120, t, 0.2);
  const nameF = fit(c, String(f.headline || 'Player name'), DISPLAY, W - 260, 120, 110, 50, 1);
  let y = riseLines(c, nameF, 60, 130, t, 0.3, p.fg);
  y = para(c, f.sub, 60, y + 6, W - 260, 44, 32, 22, p.fg, t, 0.6, 'left', 0.8);
  const top = Math.max(y + 30, 300);
  const rows = parseRows(f.rows).slice(0, 4);
  let px: number, py: number, pw: number, ph: number;
  let tiles: { x: number; y: number; w: number; h: number }[] = [];
  if (story) {
    px = 60;
    py = top;
    pw = W - 120;
    ph = Math.round(H * 0.42);
    const ty = py + ph + 30;
    const tw = (W - 120 - 24) / 2;
    const thh = Math.min(220, (H - ty - 110 - 24) / 2);
    tiles = rows.map((_, i) => ({ x: 60 + (i % 2) * (tw + 24), y: ty + Math.floor(i / 2) * (thh + 24), w: tw, h: thh }));
  } else {
    pw = Math.round(W * 0.44);
    px = flip ? W - 60 - pw : 60;
    py = top;
    ph = H - top - 120;
    const tx = flip ? 60 : px + pw + 36;
    const tw = W - 120 - pw - 36;
    const n = Math.max(rows.length, 1);
    const thh = Math.min(240, (ph - (n - 1) * 20) / n);
    tiles = rows.map((_, i) => ({ x: tx, y: py + i * (thh + 20), w: tw, h: thh }));
  }
  const q = easeOut(step(t, 0.3, 0.7));
  c.save();
  c.globalAlpha = q;
  roundRect(c, px, py, pw, ph, 28);
  c.save();
  c.clip();
  photoOrPattern(c, a.photos.imageUrl, b, px, py, pw, ph, slowZoom(t));
  c.restore();
  c.lineWidth = 6;
  c.strokeStyle = p.acc;
  roundRect(c, px, py, pw, ph, 28);
  c.stroke();
  c.restore();
  rows.forEach((r, i) => {
    const tl = tiles[i];
    const pr = easeOut(step(t, 0.7 + i * 0.15, 0.6));
    c.save();
    c.globalAlpha = pr;
    c.translate((1 - pr) * 60, 0);
    c.fillStyle = soft(p, 0.1);
    roundRect(c, tl.x, tl.y, tl.w, tl.h, 20);
    c.fill();
    const num = Number(String(r.value).replace(/[^0-9.]/g, ''));
    const counting = r.value && /^\s*\d+(\.\d+)?\s*\D{0,6}$/.test(r.value) && t !== Infinity;
    const shown = counting ? String(r.value).replace(/\d+(\.\d+)?/, String(Math.round(num * easeOut(step(t, 0.8 + i * 0.15, 1.0))))) : r.value;
    const vf = fit(c, shown || '–', DISPLAY, tl.w - 40, tl.h * 0.55, 110, 30, 1);
    c.font = `${vf.size}px ${DISPLAY}`;
    c.fillStyle = p.acc;
    c.textAlign = 'left';
    c.textBaseline = 'top';
    c.fillText(vf.lines[0] ?? '', tl.x + 24, tl.y + tl.h * 0.12);
    c.font = `600 ${Math.max(20, Math.min(28, tl.h * 0.16))}px ${BODY}`;
    c.fillStyle = p.fg;
    c.globalAlpha = pr * 0.85;
    c.textBaseline = 'bottom';
    c.fillText(clipText(c, r.name.toUpperCase(), tl.w - 48), tl.x + 24, tl.y + tl.h - 18);
    c.restore();
  });
  if (!rows.length) {
    c.font = `600 28px ${BODY}`;
    c.fillStyle = p.fg;
    c.textAlign = 'left';
    c.textBaseline = 'top';
    c.fillText('Add stats: one per line, e.g. Wins, 24', story ? 60 : flip ? 60 : px + pw + 36, story ? py + ph + 40 : py + 20);
  }
  footer(c, b, W, H, p.fg, t);
};

/** 9. Photo dump — three polaroids dropping onto the table. */
const polaroidLook = (k: PalKey): Draw => (c, W, H, f, a, b, t) => {
  const p = pal(k, b);
  ground(c, a, p, W, H, t);
  c.save();
  c.fillStyle = soft(p, 0.12);
  for (let x = 30; x < W; x += 48) for (let y = 30; y < H; y += 48) c.fillRect(x - 2, y - 2, 4, 4);
  c.restore();
  label(c, f.tag || 'PHOTO DUMP', 60, 70, 28, p.acc, p.onAcc, t, 0.1);
  logo(c, logoFor(p, a), W - 110, 105, 120, t, 0.2);
  const areaTop = 170;
  const areaH = H * (H > W * 1.5 ? 0.56 : 0.55);
  const fw = Math.min(W * 0.48, areaH / 1.18 / 1.05);
  const fh = fw * 1.18;
  const spots = [
    { x: W * 0.3, y: areaTop + fh * 0.5 + 10, r: -0.12, im: a.photos.imageUrl },
    { x: W * 0.7, y: areaTop + fh * 0.55 + 30, r: 0.09, im: a.photos.image2 },
    { x: W * 0.5, y: areaTop + areaH - fh * 0.5, r: -0.03, im: a.photos.image3 },
  ];
  spots.forEach((s, i) => {
    const q = easeBack(step(t, 0.3 + i * 0.25, 0.55));
    if (q <= 0) return;
    c.save();
    c.translate(s.x, s.y);
    c.rotate(s.r);
    const sc = 1.35 - 0.35 * q;
    c.scale(sc, sc);
    c.globalAlpha = clamp(q * 1.5);
    c.shadowColor = 'rgba(0,0,0,0.35)';
    c.shadowBlur = 30;
    c.shadowOffsetY = 12;
    c.fillStyle = '#ffffff';
    c.fillRect(-fw / 2, -fh / 2, fw, fh);
    c.shadowColor = 'transparent';
    const m = fw * 0.06;
    photoOrPattern(c, s.im ?? null, b, -fw / 2 + m, -fh / 2 + m, fw - 2 * m, fw - 2 * m, 1);
    c.rotate(-0.05);
    c.fillStyle = hexA(p.dark ? b.pop : b.main, 0.7);
    c.fillRect(-60, -fh / 2 - 18, 120, 36);
    c.restore();
  });
  let y = areaTop + areaH + 40;
  const head = fit(c, String(f.headline || 'Weekend at ZMG'), HEAVY, W - 160, Math.max(60, (H - y - 170) * 0.65), 74, 34, 1.2);
  c.font = `${head.size}px ${HEAVY}`;
  head.lines.forEach((l, i) => {
    const q = easeOut(step(t, 1.1 + i * 0.15, 0.5));
    const w = c.measureText(l).width;
    c.fillStyle = hexA(p.dark ? b.pop : b.main, 0.35);
    c.fillRect(60, y + i * head.lineH + head.size * 0.55, (w + 20) * q, head.size * 0.5);
  });
  y = riseLines(c, head, 70, y, t, 1.0, p.fg, 'left', HEAVY) + 16;
  para(c, f.sub, 70, y, W - 160, H - y - 110, 32, 22, p.fg, t, 1.5);
  footer(c, b, W, H, p.fg, t);
};

/** 10. Slash — photo on top, colour block below a slanted edge. */
const slashLook = (k: PalKey, flip: boolean): Draw => (c, W, H, f, a, b, t) => {
  const p = pal(k, b);
  c.fillStyle = p.bg;
  c.fillRect(0, 0, W, H);
  const story = H > W * 1.5;
  const lo = H * (story ? 0.52 : 0.5);
  const hi = H * (story ? 0.42 : 0.36);
  const y1 = flip ? hi : lo;
  const y2 = flip ? lo : hi;
  c.save();
  c.beginPath();
  c.moveTo(0, 0);
  c.lineTo(W, 0);
  c.lineTo(W, y2 + 4);
  c.lineTo(0, y1 + 4);
  c.closePath();
  c.clip();
  c.globalAlpha = easeOut(step(t, 0, 0.7));
  photoOrPattern(c, a.photos.imageUrl, b, 0, 0, W, Math.max(y1, y2) + 10, slowZoom(t));
  c.restore();
  const q = easeOut(step(t, 0.3, 0.6));
  c.save();
  c.beginPath();
  c.moveTo(0, y1);
  c.lineTo(W * q, y1 + (y2 - y1) * q);
  c.lineTo(W * q, y1 + (y2 - y1) * q - 22);
  c.lineTo(0, y1 - 22);
  c.closePath();
  c.fillStyle = p.acc;
  c.fill();
  c.restore();
  label(c, f.tag || 'GAMING NEWS', 60, 70, 28, p.acc, p.onAcc, t, 0.4);
  logo(c, a.logoOutline, W - 110, 105, 120, t, 0.5);
  let y = Math.max(y1, y2) + 40;
  const head = fit(c, String(f.headline || 'Your headline here'), DISPLAY, W - 120, (H - y - 170) * 0.7, 130, 48);
  y = riseLines(c, head, 60, y, t, 0.7, p.fg) + 18;
  y = para(c, f.sub, 60, y, W - 120, H - y - 120, 34, 22, p.fg, t, 1.3);
  sourceLine(c, f, 60, y + 12, p.fg, t);
  footer(c, b, W, H, p.fg, t);
};

const NEWS_FIELDS: FieldDef[] = [
  { key: 'tag', label: 'Label', kind: 'text', placeholder: 'GAMING NEWS' },
  { key: 'headline', label: 'Headline', kind: 'textarea' },
  { key: 'sub', label: 'Short summary', kind: 'textarea' },
  { key: 'source', label: 'Source', kind: 'text', placeholder: 'e.g. IGN' },
  { key: 'imageUrl', label: 'Picture', kind: 'image' },
];

interface Family {
  name: string;
  about: string;
  group: string;
  fields: FieldDef[];
  variants: [PalKey, boolean][];
  make: (k: PalKey, flip: boolean) => Draw;
}
const FAMILIES: Record<string, Family> = {
  split: {
    name: 'Split',
    about: 'Picture on one half, the story on the other',
    group: 'News',
    fields: NEWS_FIELDS,
    variants: [['navy', false], ['lime', false], ['light', true], ['black', true]],
    make: splitLook,
  },
  cover: {
    name: 'Magazine cover',
    about: 'Full photo, big masthead, cover lines and headline',
    group: 'News',
    fields: [
      { key: 'tag', label: 'Masthead', kind: 'text', placeholder: 'ZMG' },
      { key: 'headline', label: 'Headline', kind: 'textarea' },
      { key: 'sub', label: 'Small label above the headline', kind: 'text', placeholder: 'EXCLUSIVE' },
      { key: 'lines', label: 'Cover lines (one per line, up to 3)', kind: 'textarea' },
      { key: 'imageUrl', label: 'Picture', kind: 'image' },
    ],
    variants: [['navy', false], ['blue', false], ['lime', false], ['white', false]],
    make: (k) => coverLook(k),
  },
  card: {
    name: 'News card',
    about: 'Floating card with picture and story',
    group: 'News',
    fields: NEWS_FIELDS,
    variants: [['navy', false], ['blue', false], ['lime', false], ['light', false]],
    make: (k) => cardLook(k),
  },
  slash: {
    name: 'Slash',
    about: 'Photo on top, colour below a slanted edge',
    group: 'News',
    fields: NEWS_FIELDS,
    variants: [['lime', false], ['blue', true], ['navy', false], ['white', true]],
    make: slashLook,
  },
  broadcast: {
    name: 'TV live',
    about: 'LIVE pill, TV lower third and scrolling ticker',
    group: 'News',
    fields: [
      { key: 'tag', label: 'Top pill', kind: 'text', placeholder: 'LIVE' },
      { key: 'source', label: 'Small tag above the headline', kind: 'text', placeholder: 'BREAKING NEWS' },
      { key: 'headline', label: 'Headline', kind: 'textarea' },
      { key: 'sub', label: 'Scrolling ticker text', kind: 'textarea' },
      { key: 'imageUrl', label: 'Picture', kind: 'image' },
    ],
    variants: [['navy', false], ['blue', false], ['lime', false], ['black', false]],
    make: (k) => broadcastLook(k),
  },
  bigword: {
    name: 'Big word',
    about: 'One giant word or number — GG, NEW, OPEN, 50%',
    group: 'Events',
    fields: [
      { key: 'tag', label: 'Big word or number', kind: 'text', placeholder: 'GG' },
      { key: 'headline', label: 'Line under it', kind: 'textarea' },
      { key: 'sub', label: 'Small text', kind: 'textarea' },
    ],
    variants: [['lime', false], ['blue', false], ['black', false], ['light', false]],
    make: (k) => bigwordLook(k),
  },
  countdown: {
    name: 'Countdown',
    about: 'Days or hours to go, inside an animated ring',
    group: 'Events',
    fields: [
      { key: 'tag', label: 'Event label', kind: 'text', placeholder: 'TOURNAMENT' },
      { key: 'headline', label: 'Number', kind: 'text', placeholder: '3' },
      { key: 'sub', label: 'Unit', kind: 'text', placeholder: 'DAYS TO GO' },
      { key: 'when', label: 'Event / date / place', kind: 'textarea', placeholder: 'EA FC 26 CUP · SAT 7 PM' },
      { key: 'cta', label: 'Call to action', kind: 'text', placeholder: 'Register at the counter' },
    ],
    variants: [['navy', false], ['lime', false], ['blue', false], ['black', false]],
    make: (k) => countdownLook(k),
  },
  fixtures: {
    name: 'Fixtures',
    about: 'Match schedule with time chips',
    group: 'Matches & players',
    fields: [
      { key: 'headline', label: 'Title', kind: 'text', placeholder: 'FIXTURES' },
      { key: 'sub', label: 'Game / day', kind: 'text', placeholder: 'EA FC 26 · Saturday' },
      { key: 'rows', label: 'Matches', kind: 'rows', hint: 'One per line: time, match — e.g. 7:00 PM, Kofi vs Ama' },
      { key: 'when', label: 'Bottom line', kind: 'text', placeholder: 'Live at ZMG · Free to watch' },
    ],
    variants: [['navy', false], ['light', false], ['blue', false], ['lime', false]],
    make: (k) => fixturesLook(k),
  },
  stats: {
    name: 'Player stats',
    about: 'Player photo with stat tiles that count up',
    group: 'Matches & players',
    fields: [
      { key: 'tag', label: 'Label', kind: 'text', placeholder: 'PLAYER SPOTLIGHT' },
      { key: 'headline', label: 'Player name', kind: 'text' },
      { key: 'sub', label: 'Game / role', kind: 'text', placeholder: 'EA FC 26 · Champion' },
      { key: 'imageUrl', label: 'Photo', kind: 'image' },
      { key: 'rows', label: 'Stats', kind: 'rows', hint: 'One per line (up to 4): stat, value — e.g. Wins, 24' },
    ],
    variants: [['navy', false], ['blue', true], ['black', false], ['lime', true]],
    make: statsLook,
  },
  polaroid: {
    name: 'Photo dump',
    about: 'Three polaroid photos dropping in, with a caption',
    group: 'Moments',
    fields: [
      { key: 'tag', label: 'Label', kind: 'text', placeholder: 'PHOTO DUMP' },
      { key: 'headline', label: 'Caption', kind: 'textarea' },
      { key: 'sub', label: 'Small text', kind: 'textarea' },
      { key: 'imageUrl', label: 'Photo 1', kind: 'image' },
      { key: 'image2', label: 'Photo 2', kind: 'image' },
      { key: 'image3', label: 'Photo 3', kind: 'image' },
    ],
    variants: [['light', false], ['navy', false], ['lime', false], ['blue', false]],
    make: (k) => polaroidLook(k),
  },
};

const MORE_TEMPLATES: Record<string, TemplateInfo> = {};
const MORE_DRAW: Record<string, Draw> = {};
for (const [fam, F] of Object.entries(FAMILIES)) {
  for (const [k, flip] of F.variants) {
    const key = `${fam}-${k}`;
    MORE_TEMPLATES[key] = { label: `${F.name} · ${PAL_NAME[k]}`, about: F.about, group: F.group, fields: F.fields };
    MORE_DRAW[key] = F.make(k, flip);
  }
}


// ───────── Reference-pack looks (v0.9.3): 28 layouts × 4 colourways + 3D character looks ─────────

type PK = PalKey | 'magenta' | 'purple' | 'green' | 'gold' | 'warm' | 'sunset' | 'orange' | 'red' | 'fest' | 'pink';
interface Pal3 extends Pal {
  bg2: string;
  acc2: string;
  pat: '' | 'knit' | 'grain' | 'dots';
  /** A bright colour that reads on top of a dark photo. */
  hi: string;
}
const PK_NAME: Record<PK, string> = {
  ...PAL_NAME,
  magenta: 'magenta',
  purple: 'purple',
  green: 'green',
  gold: 'gold',
  warm: 'warm yellow',
  sunset: 'sunset',
  orange: 'orange',
  red: 'red',
  fest: 'festival red',
  pink: 'pink',
};

function mix(a: string, b: string, t: number) {
  const n = (h: string) => {
    let x = h.replace('#', '');
    if (x.length === 3) x = x.split('').map((y) => y + y).join('');
    const v = parseInt(x.slice(0, 6), 16) || 0;
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  };
  const A = n(a);
  const B = n(b);
  return `#${A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

function pal3(k: PK, b: Brand, photo = false): Pal3 {
  const p = pal3raw(k, b);
  return !photo && p.hi.toLowerCase() === p.bg.toLowerCase() ? { ...p, hi: p.acc2 } : p;
}
function pal3raw(k: PK, b: Brand): Pal3 {
  switch (k) {
    case 'magenta':
      return { bg: '#560b2c', bg2: '#230311', fg: '#ffffff', acc: '#ff2d87', acc2: '#ffffff', onAcc: '#ffffff', dark: true, tex: false, pat: 'knit', hi: '#ff2d87' };
    case 'purple':
      return { bg: '#3020c8', bg2: '#12073f', fg: '#fff4dc', acc: '#ff1f8e', acc2: '#f4ff2b', onAcc: '#ffffff', dark: true, tex: false, pat: 'grain', hi: '#f4ff2b' };
    case 'green':
      return { bg: '#11521e', bg2: '#04160a', fg: '#ffffff', acc: '#62ff5a', acc2: '#2fe6b8', onAcc: '#04230b', dark: true, tex: false, pat: 'grain', hi: '#62ff5a' };
    case 'gold':
      return { bg: '#f4eee2', bg2: '#e2d5ba', fg: '#121212', acc: '#e2a417', acc2: '#121212', onAcc: '#121212', dark: false, tex: false, pat: 'grain', hi: '#f0b323' };
    case 'warm':
      return { bg: '#f6cf80', bg2: '#eab25a', fg: '#161616', acc: '#161616', acc2: '#c8322c', onAcc: '#f6cf80', dark: false, tex: false, pat: '', hi: '#f6cf80' };
    case 'sunset':
      return { bg: '#2a103f', bg2: '#0e0616', fg: '#ffffff', acc: '#ff5fa2', acc2: '#ffb347', onAcc: '#ffffff', dark: true, tex: false, pat: '', hi: '#ff5fa2' };
    case 'orange':
      return { bg: '#f7930f', bg2: '#d9520a', fg: '#ffffff', acc: '#141414', acc2: '#ffe14d', onAcc: '#ffffff', dark: true, tex: false, pat: 'dots', hi: '#ff9a1f' };
    case 'red':
      return { bg: '#1c090d', bg2: '#030102', fg: '#ffffff', acc: '#e8202a', acc2: '#f5c518', onAcc: '#ffffff', dark: true, tex: false, pat: '', hi: '#e8202a' };
    case 'fest':
      return { bg: '#f3f2ef', bg2: '#e3e1db', fg: '#5c0c24', acc: '#c8123f', acc2: '#f6c21a', onAcc: '#ffffff', dark: false, tex: false, pat: 'grain', hi: '#c8123f' };
    case 'pink':
      return { bg: '#ffe3ef', bg2: '#ffc0da', fg: '#3a0a22', acc: '#ff2d87', acc2: '#3a0a22', onAcc: '#ffffff', dark: false, tex: false, pat: 'dots', hi: '#ff5fa2' };
    default: {
      const p = pal(k, b);
      const hi = k === 'light' || k === 'white' ? b.main : k === 'black' || k === 'navy' || k === 'blue' || k === 'lime' ? b.pop : p.acc;
      return { ...p, bg2: mix(p.bg, '#000000', p.dark ? 0.45 : 0.08), acc2: p.dark ? '#ffffff' : b.main, pat: '', hi };
    }
  }
}

const tileCache = new Map<string, HTMLCanvasElement>();
function tile(kind: 'knit' | 'grain' | 'dots', color: string) {
  const key = `${kind}|${color}`;
  let cv = tileCache.get(key);
  if (cv) return cv;
  cv = document.createElement('canvas');
  const x = cv.getContext('2d')!;
  if (kind === 'knit') {
    cv.width = 22;
    cv.height = 14;
    x.strokeStyle = color;
    x.lineWidth = 3;
    x.lineCap = 'round';
    x.beginPath();
    x.moveTo(3, 3);
    x.lineTo(11, 11);
    x.lineTo(19, 3);
    x.stroke();
  } else if (kind === 'dots') {
    cv.width = cv.height = 22;
    x.fillStyle = color;
    x.beginPath();
    x.arc(11, 11, 2.4, 0, Math.PI * 2);
    x.fill();
  } else {
    cv.width = cv.height = 220;
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    x.fillStyle = color;
    for (let i = 0; i < 2600; i++) {
      x.globalAlpha = 0.25 + rnd() * 0.75;
      x.fillRect(rnd() * 220, rnd() * 220, 1 + rnd() * 1.6, 1 + rnd() * 1.6);
    }
  }
  tileCache.set(key, cv);
  return cv;
}

/** Background: two-tone gradient, brand texture or knit / grain / dots on top. */
function ground3(c: C, a: Assets, p: Pal3, W: number, H: number, t: number, pat = p.pat) {
  const g = c.createLinearGradient(0, 0, W * 0.3, H);
  g.addColorStop(0, p.bg);
  g.addColorStop(1, p.bg2);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  if (p.tex && a.bg) {
    c.save();
    c.globalAlpha = 0.5;
    cover(c, a.bg, 0, 0, W, H, slowZoom(t, 1.0, 1.04), 0.5);
    c.restore();
  }
  if (pat) {
    const col = pat === 'knit' ? hexA(p.dark ? p.acc : p.fg, p.dark ? 0.32 : 0.12) : p.dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
    const pt = c.createPattern(tile(pat, col), 'repeat');
    if (pt) {
      c.save();
      c.fillStyle = pt;
      c.fillRect(0, 0, W, H);
      c.restore();
    }
  }
}

const easeOutQuint = (p: number) => 1 - (1 - clamp(p)) ** 5;
const fade = (t: number, s: number, d = 0.5) => easeOutQuint(step(t, s, d * 1.25));

function say(c: C, s: unknown, x: number, y: number, font: string, color: string | CanvasGradient, align: CanvasTextAlign = 'left', alpha = 1, spacing = 0, base: CanvasTextBaseline = 'top') {
  const str = String(s ?? '');
  if (!str || alpha <= 0) return;
  c.save();
  c.globalAlpha *= alpha;
  c.font = font;
  c.fillStyle = color;
  c.textAlign = align;
  c.textBaseline = base;
  if (spacing) (c as any).letterSpacing = `${spacing}px`;
  c.fillText(str, x, y);
  c.restore();
}

/** Spaced small caps line, e.g. H A P P Y  N E W  M O N T H. */
function spaced(c: C, s: unknown, x: number, y: number, size: number, color: string, t: number, start: number, align: CanvasTextAlign = 'center', maxW = 960) {
  const str = String(s ?? '').toUpperCase();
  if (!str) return;
  let sp = size * 0.45;
  c.font = `${size}px ${HEAVY}`;
  (c as any).letterSpacing = `${sp}px`;
  while (c.measureText(str).width > maxW && sp > 1) {
    sp -= 1;
    (c as any).letterSpacing = `${sp}px`;
  }
  (c as any).letterSpacing = '0px';
  say(c, str, x, y, `${size}px ${HEAVY}`, color, align, fade(t, start, 0.6), sp);
}

function pill(c: C, s: unknown, x: number, y: number, size: number, bg: string, fg: string, t: number, start: number, align: 'left' | 'center' | 'right' = 'left', rot = 0, font = HEAVY) {
  const str = String(s ?? '').toUpperCase();
  if (!str) return { w: 0, h: 0 };
  c.font = `${size}px ${font}`;
  const w = c.measureText(str).width + size * 1.5;
  const h = size * 1.75;
  const q = easeBack(step(t, start, 0.5));
  if (q <= 0) return { w, h };
  const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  c.save();
  c.globalAlpha = clamp(q);
  c.translate(x0 + w / 2, y + h / 2);
  c.rotate(rot);
  c.scale(q, q);
  roundRect(c, -w / 2, -h / 2, w, h, h / 2);
  c.fillStyle = bg;
  c.fill();
  c.fillStyle = fg;
  c.font = `${size}px ${font}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(str, 0, 2);
  c.restore();
  return { w, h };
}

const COMIC = "'Comic Sans MS', 'Comic Neue', 'Segoe Print', sans-serif";

/** Comic speech bubble with a tail. */
function bubble(c: C, s: unknown, x: number, y: number, w: number, t: number, start: number, tail: 'left' | 'right' = 'right', size = 38) {
  const str = String(s ?? '');
  if (!str) return 0;
  const f = fit(c, str, COMIC, w - 70, size * 4, size, 22, 1.2, false);
  const h = f.lines.length * f.lineH + 50;
  const q = easeBack(step(t, start, 0.5));
  if (q <= 0) return h;
  c.save();
  c.globalAlpha = clamp(q);
  c.translate(x + w / 2, y + h / 2);
  c.scale(q, q);
  c.translate(-w / 2, -h / 2);
  c.lineWidth = 5;
  c.strokeStyle = '#111';
  c.fillStyle = '#ffffff';
  const tx = tail === 'right' ? w * 0.72 : w * 0.28;
  roundRect(c, 0, 0, w, h, 34);
  c.fill();
  c.stroke();
  c.beginPath();
  c.moveTo(tx - 22, h - 3);
  c.lineTo(tx + (tail === 'right' ? 6 : -6), h + 34);
  c.lineTo(tx + 22, h - 3);
  c.closePath();
  c.fill();
  c.stroke();
  c.fillStyle = '#ffffff';
  c.fillRect(tx - 19, h - 8, 38, 9);
  c.font = `${f.size}px ${COMIC}`;
  c.fillStyle = '#111';
  c.textAlign = 'center';
  c.textBaseline = 'top';
  f.lines.forEach((l, i) => c.fillText(l, w / 2, 25 + i * f.lineH));
  c.restore();
  return h + 34;
}

/** Comic caption box, e.g. 10 SECONDS LATER… */
function capBox(c: C, s: unknown, x: number, y: number, size: number, bg: string, fg: string, t: number, start: number, maxW = 900) {
  const str = String(s ?? '').toUpperCase();
  if (!str) return;
  const font = `700 ${size}px ${COMIC}`;
  c.font = font;
  const txt = clipText(c, str, maxW - size * 1.4);
  const w = c.measureText(txt).width + size * 1.4;
  const h = size * 1.9;
  const q = fade(t, start, 0.45);
  c.save();
  c.globalAlpha = q;
  c.translate((1 - q) * -40, 0);
  c.fillStyle = 'rgba(0,0,0,0.35)';
  c.fillRect(x + 6, y + 6, w, h);
  c.fillStyle = bg;
  c.fillRect(x, y, w, h);
  c.lineWidth = 4;
  c.strokeStyle = '#111';
  c.strokeRect(x, y, w, h);
  say(c, txt, x + size * 0.7, y + h / 2 + 2, font, fg, 'left', 1, 1, 'middle');
  c.restore();
}

/** Comic shout word, e.g. BUSTED! */
function shout(c: C, s: unknown, x: number, y: number, maxW: number, size: number, rot: number, fill: string, t: number, start: number, align: CanvasTextAlign = 'left') {
  const str = String(s ?? '').toUpperCase();
  if (!str) return;
  let sz = size;
  c.font = `italic ${sz}px ${DISPLAY}`;
  while (c.measureText(str).width > maxW && sz > 40) {
    sz -= 4;
    c.font = `italic ${sz}px ${DISPLAY}`;
  }
  const q = easeBack(step(t, start, 0.45));
  if (q <= 0) return;
  c.save();
  c.globalAlpha = clamp(q);
  c.translate(x, y);
  c.rotate(rot);
  c.scale(q, q);
  c.font = `italic ${sz}px ${DISPLAY}`;
  c.textAlign = align;
  c.textBaseline = 'middle';
  c.lineJoin = 'round';
  c.lineWidth = sz * 0.14;
  c.strokeStyle = '#111';
  c.strokeText(str, 0, 0);
  c.fillStyle = fill;
  c.fillText(str, 0, 0);
  c.restore();
}

/** Big name with a white→grey metal fill, bottom-anchored. Returns top y. */
function metalName(c: C, s: unknown, x: number, bottom: number, maxW: number, maxH: number, maxSize: number, t: number, start: number, align: CanvasTextAlign = 'left', top = '#ffffff', low = '#b8bccb') {
  const f = fit(c, String(s || 'NAME'), DISPLAY, maxW, maxH, maxSize, 50, 0.98);
  const y0 = bottom - f.lines.length * f.lineH;
  f.lines.forEach((l, i) => {
    const q = fade(t, start + i * 0.12, 0.6);
    const y = y0 + i * f.lineH + (1 - q) * 50;
    const g = c.createLinearGradient(0, y, 0, y + f.size);
    g.addColorStop(0, top);
    g.addColorStop(1, low);
    c.save();
    c.globalAlpha = q;
    c.shadowColor = 'rgba(0,0,0,0.55)';
    c.shadowBlur = 24;
    c.shadowOffsetY = 6;
    say(c, l, x, y, `${f.size}px ${DISPLAY}`, g, align);
    c.restore();
  });
  return y0;
}

/** White paint streaks on the sides (sports poster style). */
function brushes(c: C, W: number, H: number, color: string, t: number) {
  const q = fade(t, 0.2, 0.8);
  const strokes: [number, number, number, number, number][] = [
    [W * 1.02, H * 0.25, Math.PI * 0.82, W * 0.22, 56],
    [W * 1.03, H * 0.42, Math.PI * 0.9, W * 0.16, 40],
    [W * -0.02, H * 0.86, -Math.PI * 0.22, W * 0.2, 50],
    [W * -0.02, H * 0.38, -Math.PI * 0.1, W * 0.1, 30],
    [W * 1.02, H * 0.9, Math.PI * 1.15, W * 0.14, 36],
  ];
  c.save();
  c.fillStyle = color;
  strokes.forEach(([x, y, ang, len, wid], si) => {
    const L = len * q;
    c.save();
    c.translate(x, y);
    c.rotate(ang);
    c.beginPath();
    c.moveTo(0, -wid / 2);
    for (let i = 0; i <= 12; i++) c.lineTo((L * i) / 12, -wid / 2 + Math.sin(i * 2.1 + si) * wid * 0.18 + (wid * i) / 30);
    for (let i = 12; i >= 0; i--) c.lineTo((L * i) / 12, wid / 2 - Math.cos(i * 1.7 + si) * wid * 0.2 - (wid * i) / 30);
    c.closePath();
    c.globalAlpha = 0.85;
    c.fill();
    c.restore();
  });
  c.restore();
}

/** A person / cut-out, fitted inside a box and standing on its bottom edge, edges softened. */
function figure(c: C, im: HTMLImageElement | null, p: Pal3, x: number, y: number, w: number, h: number, t: number, start: number, focus: 'center' | 'left' | 'right' = 'center') {
  const q = fade(t, start, 0.8);
  if (q <= 0) return;
  c.save();
  c.globalAlpha = q;
  // Rise a little and settle (scale 96% → 100%) around the bottom-centre of the box.
  const k = 0.96 + 0.04 * q;
  c.translate(x + w / 2, y + h);
  c.scale(k, k);
  c.translate(-(x + w / 2), -(y + h) + (1 - q) * 36);
  if (!im) {
    c.fillStyle = soft(p, 0.18);
    const cx = x + w / 2;
    const hr = Math.min(w, h) * 0.17;
    c.beginPath();
    c.arc(cx, y + h * 0.3, hr, 0, Math.PI * 2);
    c.fill();
    c.beginPath();
    c.ellipse(cx, y + h, w * 0.4, h * 0.5, 0, Math.PI, 0);
    c.fill();
    c.restore();
    return;
  }
  const cut = isCutout(im);
  if (!cut) {
    // An ordinary photo: a framed, slightly tilted photo card with a strong shadow.
    const fr = Math.max(8, Math.min(w, h) * 0.022);
    const sc = Math.min((w * 0.9) / im.width, (h * 0.92) / im.height);
    const cw = im.width * sc;
    const ch = im.height * sc;
    const cx = focus === 'left' ? x + cw / 2 + fr : focus === 'right' ? x + w - cw / 2 - fr : x + w / 2;
    const cy = y + h - ch / 2 - fr;
    const glow = c.createRadialGradient(cx, cy, 0, cx, cy, Math.max(cw, ch) * 0.8);
    glow.addColorStop(0, hexA(p.hi, 0.45));
    glow.addColorStop(1, hexA(p.hi, 0));
    c.fillStyle = glow;
    c.fillRect(cx - cw, cy - ch, cw * 2, ch * 2);
    c.translate(cx, cy);
    c.rotate((-2.5 + (1 - q) * -4) * (Math.PI / 180));
    c.shadowColor = 'rgba(0,0,0,0.55)';
    c.shadowBlur = 40;
    c.shadowOffsetY = 18;
    c.fillStyle = '#ffffff';
    c.fillRect(-cw / 2 - fr, -ch / 2 - fr, cw + fr * 2, ch + fr * 2);
    c.shadowColor = 'transparent';
    c.save();
    c.beginPath();
    c.rect(-cw / 2, -ch / 2, cw, ch);
    c.clip();
    const z = slowZoom(t, 1.08, 1.0);
    c.filter = 'contrast(1.12) saturate(1.2)';
    c.drawImage(im, (-cw * z) / 2, (-ch * z) / 2, cw * z, ch * z);
    c.filter = 'none';
    c.restore();
    c.fillStyle = p.hi;
    c.fillRect(-cw / 2 - fr, ch / 2 + fr - 6, cw + fr * 2, 6);
    c.restore();
    return;
  }
  const s = Math.min(w / im.width, h / im.height) * slowZoom(t, 1.06, 1.0);
  const dw = im.width * s;
  const dh = im.height * s;
  const dx = focus === 'left' ? x : focus === 'right' ? x + w - dw : x + (w - dw) / 2;
  const dy = y + h - dh;
  // Light behind the player, a coloured rim light and a dark contact shadow.
  const gx = dx + dw / 2;
  const gy = dy + dh * 0.45;
  const glow = c.createRadialGradient(gx, gy, 0, gx, gy, Math.max(dw, dh) * 0.62);
  glow.addColorStop(0, hexA(p.hi, 0.55));
  glow.addColorStop(0.5, hexA(p.hi, 0.18));
  glow.addColorStop(1, hexA(p.hi, 0));
  c.fillStyle = glow;
  c.fillRect(gx - dw, gy - dh, dw * 2, dh * 2);
  c.save();
  c.shadowColor = hexA(p.hi, 0.9);
  c.shadowBlur = 28;
  c.drawImage(im, dx, dy, dw, dh);
  c.restore();
  c.save();
  c.shadowColor = 'rgba(0,0,0,0.6)';
  c.shadowBlur = 30;
  c.shadowOffsetY = 14;
  c.filter = 'contrast(1.1) saturate(1.15)';
  c.drawImage(im, dx, dy, dw, dh);
  c.restore();
  c.restore();
}

const cutoutCache = new WeakMap<HTMLImageElement, boolean>();
/** True when the picture has a see-through background (a cut-out PNG). */
export function isCutout(im: HTMLImageElement) {
  const known = cutoutCache.get(im);
  if (known !== undefined) return known;
  let cut = false;
  try {
    const cv = document.createElement('canvas');
    cv.width = 48;
    cv.height = 48;
    const x = cv.getContext('2d', { willReadFrequently: true })!;
    x.drawImage(im, 0, 0, 48, 48);
    const d = x.getImageData(0, 0, 48, 48).data;
    let clear = 0;
    let edge = 0;
    for (let i = 0; i < 48; i++) {
      for (const [px, py] of [[i, 0], [i, 47], [0, i], [47, i]]) {
        edge++;
        if (d[(py * 48 + px) * 4 + 3] < 40) clear++;
      }
    }
    cut = clear / edge > 0.3;
  } catch {
    cut = false;
  }
  cutoutCache.set(im, cut);
  return cut;
}

function partnersRow(c: C, s: unknown, W: number, y: number, color: string, t: number) {
  const parts = String(s ?? '')
    .split(/[,·|\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (!parts.length) return;
  c.font = `24px ${HEAVY}`;
  say(c, clipText(c, parts.join('   •   ').toUpperCase(), W - 140), W / 2, y, `24px ${HEAVY}`, color, 'center', 0.85 * fade(t, 1.6, 0.6));
}

function cornerHandle(c: C, b: Brand, W: number, H: number, color: string, t: number) {
  say(c, b.handle || b.centre, W - 50, H - 44, `600 26px ${BODY}`, color, 'right', 0.9 * fade(t, 1.8, 0.6), 0, 'alphabetic');
}

function darkBottom(c: C, W: number, H: number, from: number, alpha = 0.92, color = '#000000') {
  const g = c.createLinearGradient(0, H * from, 0, H);
  g.addColorStop(0, hexA(color, 0));
  g.addColorStop(0.55, hexA(color, alpha * 0.7));
  g.addColorStop(1, hexA(color, alpha));
  c.fillStyle = g;
  c.fillRect(0, H * from, W, H * (1 - from));
}
function darkTop(c: C, W: number, H: number, to: number, alpha = 0.6) {
  const g = c.createLinearGradient(0, 0, 0, H * to);
  g.addColorStop(0, `rgba(0,0,0,${alpha})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H * to);
}

function confetti(c: C, W: number, H: number, colors: string[], t: number, n = 46) {
  const T = t === Infinity ? 4.5 : t;
  c.save();
  for (let i = 0; i < n; i++) {
    const r1 = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const r2 = (Math.sin(i * 78.233) * 12543.123) % 1;
    const x = Math.abs(r1) * W;
    const sp = 140 + Math.abs(r2) * 220;
    const y = ((-80 + T * sp + Math.abs(r2) * H * 0.9) % (H + 100)) - 40;
    c.save();
    c.translate(x + Math.sin(T * 2 + i) * 20, y);
    c.rotate(T * 3 + i);
    c.fillStyle = colors[i % colors.length];
    c.globalAlpha = 0.85;
    c.fillRect(-7, -12, 14, 24);
    c.restore();
  }
  c.restore();
}

function topBrand(c: C, a: Assets, p: Pal3, b: Brand, W: number, s: unknown, t: number, y = 110, im = logoFor(p, a)) {
  const str = String(s ?? '').toUpperCase();
  if (!str) {
    logo(c, im, W / 2, y, 150, t, 0.1);
    return;
  }
  logo(c, im, W / 2 - 130, y, 140, t, 0.1);
  c.save();
  c.globalAlpha = fade(t, 0.3);
  c.fillStyle = soft(p, 0.5);
  c.fillRect(W / 2 - 30, y - 55, 3, 110);
  c.restore();
  c.font = `italic 50px ${HEAVY}`;
  say(c, clipText(c, str, W / 2 - 60), W / 2 + 10, y, `italic 50px ${HEAVY}`, p.acc, 'left', fade(t, 0.35), 0, 'middle');
}

/** Number that counts up, keeping commas and any prefix/suffix. */
function countUp(s: unknown, q: number) {
  const str = String(s ?? '');
  const m = /^(\D*)([\d,]+(?:\.\d+)?)(.*)$/.exec(str);
  if (!m || q >= 1) return str;
  const v = Number(m[2].replace(/,/g, ''));
  const cur = Math.round(v * q);
  return m[1] + (m[2].includes(',') ? cur.toLocaleString('en-US') : String(cur)) + m[3];
}

const lines = (s: unknown, max = 20) =>
  String(s ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, max);

// 1 — Comic panel
const comicLook = (k: PK): Draw => (c, W, H, f, a, b, t) => {
  const box: Record<string, [string, string, string]> = {
    warm: ['#f6c623', '#111111', '#ff3b4f'],
    lime: [b.pop, b.dark, b.main],
    pink: ['#ff2d87', '#ffffff', '#ffd400'],
    white: ['#ffffff', '#111111', '#ff2d87'],
  };
  const [bg, fg, sh] = box[k] ?? box.warm;
  photoOrPattern(c, a.photos.imageUrl, b, 0, 0, W, H, slowZoom(t, 1.08, 1.0));
  capBox(c, f.tag, 44, 44, 34, bg, fg, t, 0.3, W * 0.55);
  shout(c, f.sub, W - 50, 120, W * 0.5, 130, -0.12, sh, t, 0.6, 'right');
  bubble(c, f.headline, W * 0.5, f.sub ? 220 : 60, W * 0.44, t, 1.0, 'right');
  if (f.when) capBox(c, f.when, 44, H - 140, 32, bg, fg, t, 1.5, W * 0.7);
  logo(c, a.logoOutline, W - 90, H - 100, 110, t, 1.6);
  say(c, b.handle || b.centre, W - 40, H - 26, `600 24px ${BODY}`, '#ffffff', 'right', fade(t, 1.8), 0, 'alphabetic');
};

// 2 — Game character card (loading-screen style)
const characterLook = (k: PK): Draw => (c, W, H, f, a, b, t) => {
  const p = pal3(k, b, true);
  photoOrPattern(c, a.photos.imageUrl, b, 0, 0, W, H, slowZoom(t, 1.12, 1.02));
  c.fillStyle = hexA(p.bg, 0.18);
  c.fillRect(0, 0, W, H);
  darkBottom(c, W, H, 0.55, 0.85, p.dark ? p.bg2 : '#000000');
  darkTop(c, W, H, 0.2, 0.35);
  logo(c, a.logoOutline, 120, 110, 150, t, 0.2);
  if (f.tag) {
    const q = easeBack(step(t, 0.4, 0.5));
    const s = 170;
    c.save();
    c.globalAlpha = clamp(q);
    c.translate(W - 60 - s / 2, 50 + s / 2);
    c.scale(q, q);
    const g = c.createLinearGradient(-s / 2, -s / 2, s / 2, s / 2);
    g.addColorStop(0, p.hi);
    g.addColorStop(1, p.dark ? p.acc2 : b.main);
    roundRect(c, -s / 2, -s / 2, s, s, 22);
    c.fillStyle = g;
    c.fill();
    const tf = fit(c, String(f.tag), HEAVY, s - 26, s - 26, 54, 20, 1.0);
    c.fillStyle = '#ffffff';
    c.shadowColor = 'rgba(0,0,0,0.45)';
    c.shadowBlur = 8;
    c.font = `${tf.size}px ${HEAVY}`;
    c.textAlign = 'center';
    c.textBaseline = 'top';
    tf.lines.forEach((l, i) => c.fillText(l, 0, -(tf.lines.length * tf.lineH) / 2 + i * tf.lineH + 4));
    c.restore();
  }
  const top = metalName(c, f.headline, 56, H - 110, W - 140, H * 0.22, 230, t, 0.7);
  if (f.sub) spaced(c, f.sub, 62, top - 50, 26, p.hi, t, 1.1, 'left', W - 140);
  cornerHandle(c, b, W, H, '#ffffff', t);
};

// 3 — Knit game reveal
const revealLook = (k: PK): Draw => (c, W, H, f, a, b, t) => {
  const p = pal3(k, b);
  ground3(c, a, p, W, H, t, 'knit');
  brushes(c, W, H, '#ffffff', t);
  topBrand(c, a, p, b, W, f.tag, t, 110);
  const tf = fit(c, String(f.headline || 'GAME TITLE'), DISPLAY, W - 160, H * 0.17, 190, 60, 0.95);
  c.save();
  c.translate(W / 2, H * 0.2);
  c.transform(1, 0, -0.18, 1, 0, 0);
  c.shadowColor = hexA(p.acc, 0.8);
  c.shadowOffsetX = 8;
  c.shadowOffsetY = 8;
  riseLines(c, tf, 0, 0, t, 0.4, '#ffffff', 'center');
  c.restore();
  const ty = H * 0.2 + tf.lines.length * tf.lineH;
  figure(c, a.photos.imageUrl, p, W * 0.1, ty, W * 0.8, H * 0.8 - ty, t, 0.8);
  c.font = `40px ${HEAVY}`;
  if (f.sub) say(c, clipText(c, String(f.sub).toUpperCase(), W - 120), W / 2, H * 0.8 + 10, `40px ${HEAVY}`, p.acc2 === '#ffffff' ? p.hi : p.acc2, 'center', fade(t, 1.3));
  partnersRow(c, f.partners, W, H - 130, p.fg, t);
  cornerHandle(c, b, W, H, p.fg, t);
};

// 4 — Giant word behind the player
const behindLook = (k: PK): Draw => (c, W, H, f, a, b, t) => {
  const p = pal3(k, b);
  ground3(c, a, p, W, H, t);
  if (k === 'magenta') brushes(c, W, H, '#ffffff', t);
  logo(c, logoFor(p, a), W / 2, 100, 130, t, 0.1);
  if (f.tag) say(c, String(f.tag).toUpperCase(), W / 2, 180, `italic 64px ${HEAVY}`, p.fg, 'center', fade(t, 0.3));
  const word = String(f.headline || 'KICK').toUpperCase();
  const wf = fit(c, word, DISPLAY, W - 60, H * 0.55, 700, 120, 0.9);
  const q = fade(t, 0.4, 0.8);
  c.save();
  c.globalAlpha = q;
  c.font = `${wf.size}px ${DISPLAY}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = p.dark ? '#ffffff' : p.fg;
  const wy = H * 0.56;
  wf.lines.forEach((l, i) => {
    c.save();
    c.translate(W / 2, wy + (i - (wf.lines.length - 1) / 2) * wf.lineH);
    c.scale(1, 1.25 + (1 - q) * 0.3);
    c.fillText(l, 0, 0);
    c.restore();
  });
  c.restore();
  figure(c, a.photos.imageUrl, p, W * 0.12, H * 0.2, W * 0.76, H * 0.68, t, 0.7);
  pill(c, f.sub, W * 0.66, H * 0.5, 46, p.hi, p.dark ? '#ffffff' : p.onAcc, t, 1.2, 'left', -0.06, DISPLAY);
  partnersRow(c, f.partners, W, H - 120, p.fg, t);
  cornerHandle(c, b, W, H, p.fg, t);
};

// 5 — Match day "IT'S TODAY"
const todayLook = (k: PK): Draw => (c, W, H, f, a, b, t) => {
  const p = pal3(k, b);
  ground3(c, a, p, W, H, t);
  const edge = String(f.tag || b.centre).toUpperCase();
  spaced(c, edge, W / 2, 26, 22, soft(p, 0.55), t, 0.1, 'center', W - 80);
  c.save();
  c.translate(W - 34, H * 0.5);
  c.rotate(Math.PI / 2);
  spaced(c, edge, 0, -11, 22, soft(p, 0.55), t, 0.1, 'center', H - 200);
  c.restore();
  figure(c, a.photos.imageUrl, p, W * 0.36, H * 0.05, W * 0.62, H * 0.62, t, 0.4, 'right');
  logo(c, logoFor(p, a), 150, 150, 170, t, 0.2);
  if (f.sub) say(c, String(f.sub).toUpperCase(), 70, H * 0.26, `40px ${DISPLAY}`, p.acc, 'left', fade(t, 0.5));
  const words = String(f.headline || "IT'S TODAY").toUpperCase().split(/\s+/);
  const w1 = words[0] ?? '';
  const rest = words.slice(1).join(' ');
  const s1 = fit(c, w1, DISPLAY, W * 0.5, H * 0.3, 420, 100, 1);
  c.save();
  c.translate(70, H * 0.31);
  c.scale(1, 1.15);
  riseLines(c, s1, 0, 0, t, 0.7, p.acc2, 'left');
  c.restore();
  if (rest) {
    const s2 = fit(c, rest, DISPLAY, W * 0.45, H * 0.2, 200, 60, 1);
    riseLines(c, s2, W * 0.5, H * 0.31 + s1.size * 1.15 * 0.55, t, 0.9, p.fg, 'left');
  }
  const by = H * 0.74;
  if (f.when) say(c, f.when, W / 2, by, `48px ${DISPLAY}`, p.fg, 'center', fade(t, 1.3));
  if (f.cta) say(c, String(f.cta).toUpperCase(), W / 2, by + 70, `80px ${DISPLAY}`, p.acc2, 'center', fade(t, 1.5));
  partnersRow(c, f.partners, W, H - 110, p.fg, t);
  cornerHandle(c, b, W, H, p.fg, t);
};

// 6 — Cinematic title over a photo
const cinemaLook = (k: PK): Draw => (c, W, H, f, a, b, t) => {
  const p = pal3(k, b, true);
  photoOrPattern(c, a.photos.imageUrl, b, 0, 0, W, H, slowZoom(t, 1.15, 1.03));
  c.fillStyle = hexA(p.hi, 0.12);
  c.fillRect(0, 0, W, H);
  darkTop(c, W, H, 0.25, 0.45);
  darkBottom(c, W, H, 0.7, 0.6);
  spaced(c, f.tag || `${b.centre} presents`, W / 2, 70, 32, '#ffffff', t, 0.3, 'center', W - 120);
  const tf = fit(c, String(f.headline || 'VI'), DISPLAY, W - 160, H * 0.32, 420, 90, 0.95);
  const ty = H * 0.5 - (tf.lines.length * tf.lineH) / 2;
  const q = fade(t, 0.6, 1.0);
  c.save();
  c.globalAlpha = q;
  c.font = `${tf.size}px ${DISPLAY}`;
  c.textAlign = 'center';
  c.textBaseline = 'top';
  tf.lines.forEach((l, i) => {
    const y = ty + i * tf.lineH + (1 - q) * 30;
    const g = c.createLinearGradient(0, y, 0, y + tf.size);
    g.addColorStop(0, p.acc2 === '#ffffff' || p.acc2 === '#121212' ? p.hi : p.acc2);
    g.addColorStop(1, p.hi === p.acc ? mix(p.hi, '#2a005a', 0.5) : p.acc);
    c.lineJoin = 'round';
    c.lineWidth = tf.size * 0.08;
    c.strokeStyle = '#2a0a3a';
    c.shadowColor = hexA(p.hi, 0.8);
    c.shadowBlur = 40;
    c.strokeText(l, W / 2, y);
    c.shadowBlur = 0;
    c.fillStyle = g;
    c.fillText(l, W / 2, y);
  });
  c.restore();
  spaced(c, f.sub || 'Swipe to see what happened', W / 2, H - 150, 30, '#ffffff', t, 1.4, 'center', W - 120);
  cornerHandle(c, b, W, H, '#ffffff', t);
};

// 7 — Happy new month
const monthLook = (k: PK): Draw => (c, W, H, f, a, b, t) => {
  const p = pal3(k, b);
  ground3(c, a, p, W, H, t, '');
  logo(c, logoFor(p, a), W / 2, 110, 150, t, 0.1);
  spaced(c, f.tag || 'Happy new month', W / 2, 210, 30, p.fg, t, 0.3);
  const mf = fit(c, String(f.headline || 'AUGUST'), HEAVY, W - 120, H * 0.18, 230, 80, 1, false);
  const my = 290;
  pill(c, f.sub || 'Welcome to', W / 2 - 60, my - 10, 32, p.hi, p.dark ? '#ffffff' : p.onAcc, t, 0.7, 'center', -0.07, BODY);
  riseLines(c, mf, W / 2, my + 40, t, 0.5, p.hi, 'center', HEAVY);
  const gy = my + 40 + mf.lines.length * mf.lineH;
  const gh = H - 240 - gy;
  const rg = c.createRadialGradient(W / 2, gy + gh / 2, 10, W / 2, gy + gh / 2, W * 0.5);
  rg.addColorStop(0, hexA(p.hi, 0.55 * fade(t, 0.8, 1)));
  rg.addColorStop(1, hexA(p.hi, 0));
  c.fillStyle = rg;
  c.fillRect(0, gy, W, gh);
  figure(c, a.photos.imageUrl, p, W * 0.15, gy, W * 0.7, gh * 0.85, t, 0.9);
  para(c, f.when, W / 2, H - 230, W - 200, 80, 28, 20, p.fg, t, 1.4, 'center');
  const hq = fade(t, 1.7);
  c.save();
  c.globalAlpha = hq;
  roundRect(c, W * 0.2, H - 130, W * 0.6, 76, 16);
  c.fillStyle = hexA(p.hi, 0.9);
  c.fill();
  c.restore();
  say(c, `f  ·  ig  ·  x  ·  tiktok   ${b.handle || b.centre}`, W / 2, H - 92, `30px ${HEAVY}`, p.dark ? '#ffffff' : p.onAcc, 'center', hq, 0, 'middle');
};

// 8 — Season tease with a slanted ribbon
const seasonLook = (k: PK): Draw => (c, W, H, f, a, b, t) => {
  const p = pal3(k, b);
  ground3(c, a, p, W, H, t);
  logo(c, logoFor(p, a), W / 2, 110, 150, t, 0.1);
  spaced(c, f.tag || 'Season 1 created a king', W / 2, 205, 34, p.fg, t, 0.3, 'center', W - 100);
  const word = String(f.headline || 'SEASON 2').toUpperCase();
  c.font = `200px ${DISPLAY}`;
  const m = c.measureText(word);
  const asc = m.actualBoundingBoxAscent || 150;
  const sx = (W - 100) / m.width;
  const sy = Math.max(sx, Math.min((H * 0.36) / asc, sx * 2.6));
  const wordTop = 265;
  const wordBottom = wordTop + asc * sy;
  const q = fade(t, 0.5, 0.9);
  c.save();
  c.globalAlpha = q;
  c.translate(W / 2, wordTop);
  c.scale(sx, sy * (0.8 + 0.2 * q));
  say(c, word, 0, asc, `200px ${DISPLAY}`, p.dark ? '#ffffff' : p.fg, 'center', 1, 0, 'alphabetic');
  c.restore();
  figure(c, a.photos.imageUrl, p, W * 0.2, wordBottom - 40, W * 0.6, H - wordBottom - 50, t, 1.0);
  if (f.sub) {
    const rq = fade(t, 1.2, 0.5);
    c.save();
    c.translate(W / 2, wordTop + (wordBottom - wordTop) * 0.68);
    c.rotate(-0.08);
    c.font = `56px ${HEAVY}`;
    const rw = Math.min(W * 0.9, c.measureText(String(f.sub).toUpperCase()).width + 80) * rq;
    c.fillStyle = p.hi;
    c.fillRect(-rw / 2, -46, rw, 92);
    c.beginPath();
    c.rect(-rw / 2, -46, rw, 92);
    c.clip();
    say(c, String(f.sub).toUpperCase(), 0, 4, `56px ${HEAVY}`, p.dark ? p.bg2 : '#ffffff', 'center', 1, 0, 'middle');
    c.restore();
  }
  cornerHandle(c, b, W, H, p.fg, t);
};

function tableRows(v: unknown, max: number) {
  return lines(v, max).map((l) => l.split(/\s*[,;\t]\s*/));
}

// 9 — League standings table
const tableLook = (k: PK): Draw => (c, W, H, f, a, b, t) => {
  const p = pal3(k, b);
  ground3(c, a, p, W, H, t);
  const story = H > W * 1.5;
  logo(c, logoFor(p, a), 110, 90, 130, t, 0.1);
  if (f.tag) say(c, String(f.tag).toUpperCase(), 190, 90, `34px ${HEAVY}`, p.fg, 'left', fade(t, 0.2), 0, 'middle');
  const title = String(f.headline || 'STANDINGS').toUpperCase();
  c.save();
  c.translate(W - 70, H * 0.5);
  c.rotate(Math.PI / 2);
  c.font = `italic 120px ${HEAVY}`;
  let ts = 120;
  while (c.measureText(title).width > H - 300 && ts > 50) {
    ts -= 6;
    c.font = `italic ${ts}px ${HEAVY}`;
  }
  say(c, title, 0, 0, `italic ${ts}px ${HEAVY}`, p.dark ? '#ffffff' : p.fg, 'center', fade(t, 0.3), 0, 'middle');
  c.restore();
  const cols = String(f.cols || 'P, W, D, L, GD, PTS')
    .split(/\s*,\s*/)
    .filter(Boolean)
    .slice(0, 8);
  const rows = tableRows(f.rows || 'Kofi, 10, 8, 1, 1, 28, 25\nAma, 8, 8, 0, 0, 31, 24\nYaw, 10, 7, 1, 2, 16, 22\nEsi, 8, 7, 0, 1, 22, 21\nKwame, 11, 5, 1, 5, 2, 16', story ? 22 : 16);
  const x0 = 50;
  const x1 = W - 150;
  const top = 170;
  const bottom = H - (f.sub ? 170 : 110);
  const rh = Math.min(84, (bottom - top) / (rows.length + 1));
  const cw = Math.min(78, (x1 - x0) * 0.5 / Math.max(1, cols.length));
  const fs = Math.min(30, rh * 0.42);
  const nameX = x0 + fs * 3.6;
  const up = Number(f.up ?? 0) || 0;
  const down = Number(f.down ?? 0) || 0;
  c.fillStyle = hexA(p.hi, 0.9);
  c.fillRect(x0, top, x1 - x0, rh);
  const hc = p.dark && p.hi !== '#ffffff' ? '#0b0b14' : '#ffffff';
  say(c, 'POS', x0 + 14, top + rh / 2, `${fs}px ${HEAVY}`, hc, 'left', 1, 0, 'middle');
  say(c, String(f.nameCol || 'PLAYER').toUpperCase(), nameX, top + rh / 2, `${fs}px ${HEAVY}`, hc, 'left', 1, 0, 'middle');
  cols.forEach((h, j) => say(c, h.toUpperCase(), x1 - cw * (cols.length - j - 0.5), top + rh / 2, `${fs}px ${HEAVY}`, hc, 'center', 1, 0, 'middle'));
  rows.forEach((r, i) => {
    const q = fade(t, 0.5 + i * 0.06, 0.4);
    const y = top + rh * (i + 1);
    const zone = i < up ? '#3ee86b' : rows.length - i <= down ? '#ff3a3a' : '';
    c.save();
    c.globalAlpha = q;
    c.translate((1 - q) * -60, 0);
    c.fillStyle = zone || (i % 2 ? hexA(p.dark ? '#ffffff' : p.fg, 0.06) : hexA(p.dark ? '#ffffff' : p.fg, 0.13));
    c.fillRect(x0, y + 3, x1 - x0, rh - 6);
    const tc = zone ? '#0b0b14' : p.dark ? '#ffffff' : p.fg;
    say(c, String(i + 1), x0 + 24, y + rh / 2, `${fs}px ${HEAVY}`, tc, 'left', 1, 0, 'middle');
    c.font = `${fs}px ${HEAVY}`;
    say(c, clipText(c, String(r[0] ?? '').toUpperCase(), x1 - cw * cols.length - nameX - 10), nameX, y + rh / 2, `${fs}px ${HEAVY}`, tc, 'left', 1, 0, 'middle');
    cols.forEach((_, j) => {
      const last = j === cols.length - 1;
      const cx = x1 - cw * (cols.length - j - 0.5);
      if (last) {
        c.fillStyle = p.acc;
        c.fillRect(x1 - cw, y + 3, cw, rh - 6);
      }
      say(c, r[j + 1] ?? '', cx, y + rh / 2, `${fs}px ${HEAVY}`, last ? p.onAcc : tc, 'center', 1, 0, 'middle');
    });
    c.restore();
  });
  if (f.sub) pill(c, f.sub, (x0 + x1) / 2, H - 150, 26, 'rgba(0,0,0,0.35)', '#ffffff', t, 1.6, 'center');
  cornerHandle(c, b, W, H, p.fg, t);
};

function parseResult(l: string) {
  const m = /^(.*?)\s+(\d+)\s*[-–:x]\s*(\d+)\s+(.*)$/i.exec(l.trim());
  if (m) return { a: m[1], sa: m[2], sb: m[3], b: m[4] };
  const parts = l.split(/\s*,\s*/);
  return { a: parts[0] ?? l, sa: parts[1] ?? '', sb: parts[2] ?? '', b: parts[3] ?? '' };
}

// 10 — Match results list
const resultsLook = (k: PK): Draw => (c, W, H, f, a, b, t) => {
  const p = pal3(k, b);
  ground3(c, a, p, W, H, t);
  logo(c, logoFor(p, a), W / 2, 85, 120, t, 0.1);
  spaced(c, f.tag || 'League · Season 1', W / 2, 160, 26, p.fg, t, 0.2);
  const tq = fade(t, 0.3, 0.6);
  const ts = 150;
  const g = c.createLinearGradient(0, 200, 0, 200 + ts);
  g.addColorStop(0, p.hi);
  g.addColorStop(1, p.dark ? p.acc2 : b.main);
  c.save();
  c.translate(W / 2, 200);
  c.scale(1, 0.9 + 0.1 * tq);
  say(c, String(f.headline || 'RESULTS').toUpperCase(), 0, 0, `${ts}px ${DISPLAY}`, g, 'center', tq);
  c.restore();
  pill(c, f.sub, W / 2 + 200, 300, 22, '#ffffff', '#111111', t, 0.8, 'left', -0.12);
  spaced(c, f.when, W / 2, 365, 24, p.fg, t, 0.5);
  const rs = lines(f.rows || 'Kofi 5-3 Ama\nYaw 4-2 Esi\nKwame 1-1 Abena', 14).map(parseResult);
  const bottom = H - (f.cta ? 170 : 110);
  const rh = Math.min(84, (bottom - 420) / Math.max(rs.length, 1));
  const top = 420 + Math.max(0, (bottom - 420 - rh * rs.length) / 3);
  const bw = W * 0.3;
  const sw = 62;
  const vw = 90;
  const cx = W / 2;
  const fs = Math.min(32, rh * 0.48);
  c.save();
  c.globalAlpha = fade(t, 0.6);
  const vg = c.createLinearGradient(0, top, 0, top + rs.length * rh);
  vg.addColorStop(0, p.hi);
  vg.addColorStop(1, p.dark ? p.acc2 : b.main);
  c.fillStyle = vg;
  c.fillRect(cx - vw / 2, top - 10, vw, rs.length * rh + 20);
  c.restore();
  rs.forEach((r, i) => {
    const q = fade(t, 0.7 + i * 0.07, 0.4);
    const y = top + i * rh + 4;
    const h = rh - 8;
    c.save();
    c.globalAlpha = q;
    c.fillStyle = '#ffffff';
    c.fillRect(cx - vw / 2 - sw - bw - (1 - q) * 80, y, bw, h);
    c.fillRect(cx + vw / 2 + sw + (1 - q) * 80, y, bw, h);
    c.fillStyle = p.dark ? mix(p.acc, '#000000', 0.15) : p.acc;
    c.fillRect(cx - vw / 2 - sw, y, sw, h);
    c.fillRect(cx + vw / 2, y, sw, h);
    c.font = `${fs}px ${HEAVY}`;
    say(c, clipText(c, r.a.toUpperCase(), bw - 24), cx - vw / 2 - sw - 14, y + h / 2, `${fs}px ${HEAVY}`, '#111111', 'right', 1, 0, 'middle');
    say(c, clipText(c, r.b.toUpperCase(), bw - 24), cx + vw / 2 + sw + 14, y + h / 2, `${fs}px ${HEAVY}`, '#111111', 'left', 1, 0, 'middle');
    say(c, r.sa, cx - vw / 2 - sw / 2, y + h / 2, `${fs}px ${HEAVY}`, p.onAcc, 'center', 1, 0, 'middle');
    say(c, r.sb, cx + vw / 2 + sw / 2, y + h / 2, `${fs}px ${HEAVY}`, p.onAcc, 'center', 1, 0, 'middle');
    say(c, 'VS', cx, y + h / 2, `italic ${fs + 4}px ${DISPLAY}`, p.dark ? '#0b0b14' : '#ffffff', 'center', 1, 0, 'middle');
    c.restore();
  });
  if (f.cta) pill(c, f.cta, W / 2, H - 150, 24, 'rgba(0,0,0,0.35)', '#ffffff', t, 1.5, 'center');
  cornerHandle(c, b, W, H, p.fg, t);
};

// 11 — Predictions board
const predictLook = (k: PK): Draw => (c, W, H, f, a, b, t) => {
  const p = pal3(k, b);
  ground3(c, a, p, W, H, t);
  const sq = fade(t, 0, 1);
  c.save();
  c.globalAlpha = 0.9 * sq;
  c.fillStyle = p.hi;
  c.beginPath();
  c.moveTo(W, H * 0.15);
  c.bezierCurveTo(W * 0.55, H * 0.5, W * 0.9, H * 0.85, W * 0.4, H);
  c.lineTo(W, H);
  c.closePath();
  c.fill();
  c.restore();
  logo(c, logoFor(p, a), 120, 100, 140, t, 0.1);
  const lw = W * 0.44;
  const hf = fit(c, String(f.headline || 'PREDICTIONS'), DISPLAY, lw, 180, 96, 40, 0.95);
  let y = riseLines(c, hf, 50, 180, t, 0.3, p.dark ? '#ffffff' : p.fg) + 20;
  const rows = parseRows(f.rows || 'Champions, France\nBest player, Mbappé\nTop scorer, Kane');
  const rh = Math.min(140, (H - 160 - y) / Math.max(1, rows.length) - 12);
  rows.slice(0, 6).forEach((r, i) => {
    const q = fade(t, 0.6 + i * 0.12, 0.45);
    c.save();
    c.globalAlpha = q;
    c.translate((1 - q) * -60, 0);
    c.fillStyle = '#ffffff';
    c.fillRect(50, y, lw, rh);
    c.fillStyle = p.acc;
    c.fillRect(50, y, 10, rh);
    say(c, `${r.name}:`, 76, y + 14, `600 ${Math.min(30, rh * 0.28)}px ${BODY}`, p.dark ? p.acc : b.main, 'left');
    c.font = `${Math.min(52, rh * 0.42)}px ${HEAVY}`;
    say(c, clipText(c, r.value.toUpperCase(), lw - 50), 76, y + rh - 14, `${Math.min(52, rh * 0.42)}px ${HEAVY}`, '#111111', 'left', 1, 0, 'bottom');
    c.restore();
    y += rh + 12;
  });
  const fx = W * 0.53;
  const fw = W - fx - 50;
  const fy = H * 0.14;
  const fh = H * 0.62;
  c.save();
  c.globalAlpha = fade(t, 0.4, 0.7);
  roundRect(c, fx, fy, fw, fh, 40);
  c.fillStyle = soft(p, 0.2);
  c.fill();
  c.clip();
  photoOrPattern(c, a.photos.imageUrl, b, fx, fy, fw, fh, slowZoom(t));
  c.restore();
  if (f.sub) {
    const nq = fade(t, 1.2, 0.6);
    const nf = fit(c, String(f.sub), HEAVY, fw - 40, 150, 60, 30, 1.0, false);
    const ny = fy + fh - 40;
    c.save();
    c.globalAlpha = nq;
    c.strokeStyle = p.hi === '#ffffff' ? p.acc : p.hi;
    c.lineWidth = 6;
    c.beginPath();
    c.ellipse(fx + fw / 2, ny + (nf.lines.length * nf.lineH) / 2, fw / 2 + 20, (nf.lines.length * nf.lineH) / 2 + 40, -0.08, 0, Math.PI * 2 * nq);
    c.stroke();
    c.shadowColor = 'rgba(0,0,0,0.6)';
    c.shadowBlur = 12;
    riseLines(c, nf, fx + fw / 2, ny, t, 1.2, '#ffffff', 'center', HEAVY);
    if (f.when) say(c, f.when, fx + fw / 2, ny + nf.lines.length * nf.lineH + 6, `600 24px ${BODY}`, '#ffffff', 'center');
    c.restore();
  }
  footer(c, b, W, H, p.fg, t);
};

// 12 — Winner announcement
const winnerAnnLook = (k: PK): Draw => (c, W, H, f, a, b, t) => {
  const p = pal3(k, b);
  ground3(c, a, p, W, H, t);
  figure(c, a.photos.imageUrl, p, W * 0.42, H * 0.1, W * 0.6, H * 0.9, t, 0.3, 'right');
  confetti(c, W, H, [p.hi, p.acc2 === '#ffffff' ? '#ffd400' : p.acc2, '#ffffff'], t, 30);
  logo(c, logoFor(p, a), 170, 160, 220, t, 0.2);
  const lw = W * 0.52;
  let y = 320;
  const sf = fit(c, String(f.tag || 'CHAMPIONSHIP SERIES'), DISPLAY, lw, 200, 100, 44, 0.92);
  c.save();
  c.transform(1, 0, -0.08, 1, 0, 0);
  y = riseLines(c, sf, 70, y, t, 0.4, p.dark ? '#ffffff' : p.fg) + 12;
  c.restore();
  if (f.sub) y += pill(c, f.sub, 60, y, 26, p.acc, p.onAcc, t, 0.7).h + 20;
  const wf = fit(c, String(f.headline || 'WINNER'), DISPLAY, lw + 40, 240, 230, 70, 0.95);
  c.save();
  c.transform(1, 0, -0.12, 1, 0, 0);
  c.shadowColor = 'rgba(0,0,0,0.35)';
  c.shadowOffsetY = 8;
  y = riseLines(c, wf, 90 + y * 0.12, y, t, 0.9, p.hi) + 20;
  c.restore();
  y = para(c, f.when, 60, y, lw, H - y - 140, 36, 20, p.dark ? '#ffffff' : p.fg, t, 1.3);
  footer(c, b, W, H, p.fg, t);
};

// 13 — Happy birthday
const birthdayLook = (k: PK): Draw => (c, W, H, f, a, b, t) => {
  const p = pal3(k, b);
  ground3(c, a, p, W, H, t);
  const wm = logoFor(p, a);
  if (wm) {
    c.save();
    c.globalAlpha = 0.07;
    const ww = W * 0.9;
    c.drawImage(wm, (W - ww) / 2, H * 0.16, ww, (wm.height / wm.width) * ww);
    c.restore();
  }
  say(c, b.centre.toUpperCase(), 50, 60, `40px ${HEAVY}`, p.fg, 'left', fade(t, 0.1));
  spaced(c, 'esports', 52, 112, 20, p.fg, t, 0.2, 'left', 300);
  figure(c, a.photos.imageUrl, p, -W * 0.04, H * 0.2, W * 0.66, H * 0.8, t, 0.3, 'left');
  confetti(c, W, H, [p.hi, p.acc, '#ffffff'], t, 24);
  const x = W * 0.5;
  const bar = (txt: string, y: number, size: number, start: number, col: string) => {
    const q = fade(t, start, 0.5);
    c.font = `${size}px ${DISPLAY}`;
    const s = fit(c, txt.toUpperCase(), DISPLAY, W - x - 30, size * 1.1, size, 40, 1).size;
    c.save();
    c.globalAlpha = q;
    c.fillStyle = col;
    c.fillRect(x + (1 - q) * 300, y + s * 0.22, W - x, s * 0.82);
    say(c, txt.toUpperCase(), x + 20, y, `${s}px ${DISPLAY}`, p.dark && col !== p.hi ? '#ffffff' : '#111111', 'left');
    c.restore();
    return s;
  };
  logo(c, logoFor(p, a), W * 0.8, H * 0.24, 110, t, 0.4);
  let y = H * 0.32;
  y += bar(String(f.tag || 'HAPPY'), y, 170, 0.5, p.hi) * 0.98;
  y += bar('BIRTHDAY', y, 210, 0.7, p.hi) * 1.02;
  const nm = String(f.headline || 'NAME');
  let ns = 72;
  c.font = `${ns}px ${HEAVY}`;
  while (c.measureText(nm.toUpperCase()).width > W - x - 50 && ns > 30) {
    ns -= 4;
    c.font = `${ns}px ${HEAVY}`;
  }
  const nw = Math.min(W - x, c.measureText(nm.toUpperCase()).width + 60);
  const nq = fade(t, 1.0, 0.5);
  c.save();
  c.globalAlpha = nq;
  c.fillStyle = p.hi;
  c.fillRect(W - nw, y + 10, nw, 84);
  say(c, clipText(c, nm.toUpperCase(), nw - 40), W - 24, y + 52, `${ns}px ${HEAVY}`, '#111111', 'right', 1, 0, 'middle');
  c.restore();
  spaced(c, f.sub, W - 30, y + 116, 24, p.fg, t, 1.2, 'right', W - x);
  const words = String(f.when || 'PLAY COMPETE GROW BELONG')
    .split(/[\s·•,]+/)
    .filter(Boolean)
    .slice(0, 5);
  words.forEach((w, i) => spaced(c, w, W - 40, H - 60 - (words.length - i) * 40, 26, p.fg, t, 1.4 + i * 0.1, 'right', 400));
};

// 14 — Milestone thank you
const thanksLook = (k: PK): Draw => (c, W, H, f, a, b, t) => {
  const p = pal3(k, b);
  ground3(c, a, p, W, H, t);
  const wm = logoFor(p, a);
  if (wm) {
    c.save();
    c.globalAlpha = 0.06;
    const ww = W * 1.1;
    c.drawImage(wm, (W - ww) / 2, H * 0.1, ww, (wm.height / wm.width) * ww);
    c.restore();
  }
  logo(c, wm, W / 2, 110, 160, t, 0.1);
  const lf = fit(c, String(f.tag || 'THANK YOU'), DISPLAY, W - 160, H * 0.2, 220, 80, 0.95);
  let y = riseLines(c, lf, W / 2, H * 0.2, t, 0.3, p.dark ? '#fff4dc' : p.fg, 'center');
  const q = fade(t, 0.7, 1.8);
  const num = countUp(f.headline || '10,000', q);
  const nf = fit(c, String(f.headline || '10,000'), DISPLAY, W - 140, H * 0.24, 280, 90, 1);
  say(c, num, W / 2, y + 10, `${nf.size}px ${DISPLAY}`, p.hi, 'center', fade(t, 0.7));
  y += nf.size + 40;
  if (f.sub) say(c, f.sub, W / 2, y, `52px ${HEAVY}`, p.dark ? '#ffffff' : p.fg, 'center', fade(t, 1.4));
  if (f.sub) y += 80;
  const bf = fit(c, String(f.when || 'FOLLOWERS'), DISPLAY, W - 160, H * 0.14, 150, 60, 1);
  riseLines(c, bf, W / 2, y, t, 1.6, p.dark ? '#fff4dc' : p.fg, 'center');
  cornerHandle(c, b, W, H, p.fg, t);
};

// 15 — Rules / four boxes around a picture
const rulesLook = (k: PK): Draw => (c, W, H, f, a, b, t) => {
  const p = pal3(k, b);
  ground3(c, a, p, W, H, t, 'dots');
  logo(c, logoFor(p, a), W / 2, 80, 110, t, 0.1);
  const hf = fit(c, String(f.headline || 'SQUAD RULES'), DISPLAY, W - 120, 150, 130, 50, 0.95);
  riseLines(c, hf, W / 2, 140, t, 0.2, p.dark ? '#fff4dc' : p.fg, 'center');
  const top = 150 + hf.lines.length * hf.lineH + 20;
  figure(c, a.photos.imageUrl, p, W * 0.28, top, W * 0.44, H - top - 90, t, 0.4);
  const rows = parseRows(f.rows || 'Max 1 player, rated 92+\nMax 3 players, rated 88-91\nMax 1, ICON\nMax 1, HERO').slice(0, 4);
  const bw = W * 0.25;
  const bh = (H - top - 140) / 2 - 70;
  rows.forEach((r, i) => {
    const left = i % 2 === 0;
    const x = left ? 40 : W - 40 - bw;
    const y = top + Math.floor(i / 2) * (bh + 90);
    const q = easeBack(step(t, 0.6 + i * 0.15, 0.5));
    c.save();
    c.globalAlpha = clamp(q);
    c.translate(x + bw / 2, y + bh / 2 + 40);
    c.scale(q, q);
    say(c, r.name, 0, -bh / 2 - 46, `34px ${DISPLAY}`, p.acc, 'center');
    const g = c.createLinearGradient(-bw / 2, -bh / 2, bw / 2, bh / 2);
    g.addColorStop(0, p.hi);
    g.addColorStop(1, mix(p.hi, '#000000', 0.45));
    roundRect(c, -bw / 2, -bh / 2, bw, bh, 26);
    c.fillStyle = g;
    c.fill();
    c.lineWidth = 3;
    c.strokeStyle = 'rgba(255,255,255,0.5)';
    c.stroke();
    const vf = fit(c, r.value || '', DISPLAY, bw - 30, bh - 30, 70, 26, 1);
    c.fillStyle = '#ffffff';
    c.shadowColor = 'rgba(0,0,0,0.4)';
    c.shadowBlur = 8;
    c.font = `${vf.size}px ${DISPLAY}`;
    c.textAlign = 'center';
    c.textBaseline = 'top';
    vf.lines.forEach((l, j) => c.fillText(l, 0, -(vf.lines.length * vf.lineH) / 2 + j * vf.lineH));
    c.restore();
  });
  if (f.sub) say(c, f.sub, 50, H - 60, `600 24px ${BODY}`, p.fg, 'left', fade(t, 1.6), 0, 'alphabetic');
  cornerHandle(c, b, W, H, p.fg, t);
};

// 16 — Meme with quote and scoreboard
const memeLook = (k: PK): Draw => (c, W, H, f, a, b, t) => {
  const p = pal3(k, b);
  ground3(c, a, p, W, H, t, '');
  figure(c, a.photos.imageUrl, p, W * 0.3, H * 0.3, W * 0.72, H * 0.7, t, 0.5, 'right');
  logo(c, logoFor(p, a), 110, 90, 120, t, 0.1);
  spaced(c, 'Play • Compete • Win', W - 50, 74, 22, p.fg, t, 0.2, 'right', 500);
  let y = 190;
  if (f.tag) {
    spaced(c, f.tag, 60, y, 20, soft(p, 0.7), t, 0.3, 'left', W * 0.6);
    y += 44;
  }
  y = para(c, f.sub, 60, y, W * 0.6, 120, 34, 24, p.fg, t, 0.4, 'left', 1) + 14;
  const hl = String(f.headline || 'WHEN YOU’RE 4-0 UP').toUpperCase();
  const hf = fit(c, hl, DISPLAY, W * 0.62, H * 0.26, 170, 48, 1.0);
  hf.lines.forEach((l, i) => {
    const q = fade(t, 0.6 + i * 0.12, 0.5);
    say(c, l, 60, y + i * hf.lineH + (1 - q) * 30, `${hf.size}px ${DISPLAY}`, i === hf.lines.length - 1 && hf.lines.length > 1 ? p.acc2 : p.fg, 'left', q);
  });
  y += hf.lines.length * hf.lineH + 30;
  if (f.when) {
    const qq = easeBack(step(t, 1.1, 0.5));
    c.font = `44px ${DISPLAY}`;
    const str = `“${String(f.when).toUpperCase()}”`;
    const qw = Math.min(W * 0.62, c.measureText(str).width + 60);
    const qx = W - 60 - qw;
    const qy = Math.max(y, H * 0.4);
    c.save();
    c.globalAlpha = clamp(qq);
    c.translate(qx + qw / 2, qy + 40);
    c.scale(qq, qq);
    c.shadowColor = 'rgba(0,0,0,0.25)';
    c.shadowBlur = 16;
    roundRect(c, -qw / 2, -40, qw, 80, 18);
    c.fillStyle = '#fffdf6';
    c.fill();
    c.shadowBlur = 0;
    c.lineWidth = 4;
    c.strokeStyle = '#111';
    c.stroke();
    c.font = `44px ${DISPLAY}`;
    say(c, clipText(c, str, qw - 40), 0, 2, `44px ${DISPLAY}`, '#111111', 'center', 1, 0, 'middle');
    c.restore();
    if (f.score) {
      const sq = fade(t, 1.4);
      c.font = `34px ${HEAVY}`;
      const sw = c.measureText(String(f.score).toUpperCase()).width + 50;
      c.save();
      c.globalAlpha = sq;
      roundRect(c, W - 60 - sw, qy + 110, sw, 66, 12);
      c.fillStyle = '#16161c';
      c.fill();
      c.lineWidth = 3;
      c.strokeStyle = p.hi === '#161616' ? '#f6cf80' : p.hi;
      c.stroke();
      say(c, String(f.score).toUpperCase(), W - 60 - sw / 2, qy + 145, `34px ${HEAVY}`, '#ffffff', 'center', 1, 0, 'middle');
      c.restore();
    }
  }
  c.save();
  c.globalAlpha = fade(t, 1.7);
  c.fillStyle = p.acc === p.fg ? p.acc2 : p.acc;
  c.fillRect(60, H - 100, 70, 5);
  c.restore();
  spaced(c, `${b.centre} / memes`, 60, H - 74, 20, p.fg, t, 1.7, 'left', 500);
  cornerHandle(c, b, W, H, p.fg, t);
};

// 17 — Good luck to the squad
const goodluckLook = (k: PK): Draw => (c, W, H, f, a, b, t) => {
  const p = pal3(k, b);
  ground3(c, a, p, W, H, t, '');
  const py = H * 0.42;
  c.save();
  c.globalAlpha = fade(t, 0.5, 0.8);
  photoOrPattern(c, a.photos.imageUrl, b, 0, py, W, H - py, slowZoom(t));
  const g = c.createLinearGradient(0, py, 0, py + 180);
  g.addColorStop(0, p.bg);
  g.addColorStop(1, hexA(p.bg, 0));
  c.fillStyle = g;
  c.fillRect(0, py - 1, W, 181);
  c.restore();
  darkBottom(c, W, H, 0.8, 0.6);
  logo(c, logoFor(p, a), W / 2, 100, 130, t, 0.1);
  const hf = fit(c, String(f.headline || 'GOOD LUCK, BOYS.'), DISPLAY, W - 120, H * 0.14, 130, 50, 1);
  c.save();
  c.transform(1, 0, -0.08, 1, 0, 0);
  riseLines(c, hf, W / 2 + 190 * 0.08, 180, t, 0.2, p.fg, 'center');
  c.restore();
  const y = 190 + hf.lines.length * hf.lineH;
  spaced(c, f.sub, W / 2, y, 24, p.fg, t, 0.5, 'center', W - 120);
  if (f.tag) {
    const q = fade(t, 0.8);
    c.font = `italic 40px ${HEAVY}`;
    const s = String(f.tag).toUpperCase();
    const w = c.measureText(s).width + 70;
    c.save();
    c.globalAlpha = q;
    c.translate(W / 2, y + 80);
    c.transform(1, 0, -0.2, 1, 0, 0);
    c.fillStyle = p.dark ? p.hi : '#161616';
    c.fillRect(-w / 2, -32, w, 64);
    c.restore();
    say(c, s, W / 2, y + 82, `italic 40px ${HEAVY}`, p.dark ? '#111111' : p.bg, 'center', q, 4, 'middle');
  }
  if (f.when) say(c, f.when, W / 2, H - 120, `italic 700 38px ${BODY}`, '#ffffff', 'center', fade(t, 1.4));
  spaced(c, `${b.centre} / esports`, 50, H - 60, 20, '#ffffff', t, 1.6, 'left', 500);
  cornerHandle(c, b, W, H, '#ffffff', t);
};

// 18 — Tournament flyer
const flyerLook = (k: PK): Draw => (c, W, H, f, a, b, t) => {
  const p = pal3(k, b);
  ground3(c, a, p, W, H, t);
  const px = W * 0.48;
  const q = fade(t, 0.2, 0.8);
  c.save();
  c.globalAlpha = q;
  roundRect(c, px + (1 - q) * 100, H * 0.1, W - px + 100, H, 140);
  c.fillStyle = '#ffffff';
  c.fill();
  roundRect(c, px + 20 + (1 - q) * 100, H * 0.1 + 20, W - px + 100, H, 125);
  c.clip();
  photoOrPattern(c, a.photos.imageUrl, b, px + 20, H * 0.1 + 20, W - px - 20, H * 0.9, slowZoom(t));
  c.restore();
  logo(c, logoFor(p, a), 160, 110, 190, t, 0.1);
  const lw = W * 0.44;
  const tf = fit(c, String(f.tag || 'CHAMPIONSHIP SERIES'), DISPLAY, lw, 220, 110, 44, 0.9);
  c.save();
  c.transform(1, 0, -0.08, 1, 0, 0);
  let y = riseLines(c, tf, 60 + 230 * 0.08, 230, t, 0.3, p.dark ? '#ffffff' : p.fg) + 10;
  c.restore();
  if (f.sub) y += pill(c, f.sub, 50, y, 24, p.hi, p.dark ? '#111111' : '#ffffff', t, 0.6).h + 24;
  lines(f.rows || 'Starting, Monday 13/07\nTime, 8 PM\nPrize, GH₵ 5,000', 5)
    .map((l) => {
      const m = /^([^,:]*)[,:]\s*(.*)$/.exec(l);
      return m ? { name: m[1].trim(), value: m[2].trim() } : { name: '', value: l };
    })
    .forEach((r, i) => {
      const qq = fade(t, 0.8 + i * 0.12);
      say(c, r.name.toUpperCase(), 54, y, `600 22px ${BODY}`, soft(p, 0.75), 'left', qq);
      c.font = `48px ${DISPLAY}`;
      say(c, clipText(c, r.value.toUpperCase(), lw), 54, y + 26, `48px ${DISPLAY}`, p.dark ? '#ffffff' : p.fg, 'left', qq);
      y += 90;
    });
  if (f.when) {
    let ps = 60;
    c.font = `${ps}px ${HEAVY}`;
    while (c.measureText(`☎ ${f.when}`).width > lw && ps > 24) {
      ps -= 3;
      c.font = `${ps}px ${HEAVY}`;
    }
    say(c, `☎ ${f.when}`, 50, y + 10, `${ps}px ${HEAVY}`, p.dark ? '#ffffff' : p.fg, 'left', fade(t, 1.3));
  }
  if (f.cta) {
    const s = String(f.cta).toUpperCase();
    shout(c, s, W - 70, H - 170, W * 0.45, 70, -0.06, p.hi, t, 1.5, 'right');
  }
  footer(c, b, W, H, p.fg, t);
};

// 19 — Massive new chapter (stacked words)
const chapterLook = (k: PK): Draw => (c, W, H, f, a, b, t) => {
  const p = pal3(k, b);
  ground3(c, a, p, W, H, t);
  logo(c, logoFor(p, a), W / 2, 90, 130, t, 0.1);
  const words = String(f.headline || 'MASSIVE NEW CHAPTER').split(/\s+/).filter(Boolean).slice(0, 5);
  let y = 170;
  const maxH = (H * 0.45) / Math.max(1, words.length);
  words.forEach((w, i) => {
    const odd = i % 2 === 1;
    const fam = odd ? "Georgia, 'Times New Roman', serif" : DISPLAY;
    const txt = odd ? w.toLowerCase() : w.toUpperCase();
    let s = Math.min(maxH * 1.1, 240);
    c.font = odd ? `italic 700 ${s}px ${fam}` : `${s}px ${fam}`;
    while (c.measureText(txt).width > W * 0.62 && s > 40) {
      s -= 6;
      c.font = odd ? `italic 700 ${s}px ${fam}` : `${s}px ${fam}`;
    }
    const q = fade(t, 0.3 + i * 0.18, 0.5);
    say(c, txt, W / 2, y + (1 - q) * 40, c.font, odd ? p.acc : p.dark ? '#ffffff' : p.fg, 'center', q);
    y += s * 0.95;
  });
  if (f.sub) say(c, String(f.sub).toUpperCase(), W / 2, y + 20, `70px ${DISPLAY}`, p.dark ? p.acc2 : p.acc, 'center', fade(t, 1.1));
  if (f.when) say(c, String(f.when).toUpperCase(), W / 2, y + 100, `60px ${DISPLAY}`, p.dark ? '#ffffff' : p.fg, 'center', fade(t, 1.3));
  const fy = y + 180;
  figure(c, a.photos.imageUrl, p, W * 0.3, fy, W * 0.4, H - fy - 70, t, 1.2);
  cornerHandle(c, b, W, H, p.fg, t);
};

// 20 — Arcade reveal
const arcadeLook = (k: PK): Draw => (c, W, H, f, a, b, t) => {
  const p = pal3(k, b);
  ground3(c, a, p, W, H, t, 'knit');
  topBrand(c, a, p, b, W, f.tag, t, 100);
  const cx = W * 0.08;
  const cw = W * 0.84;
  const cy = 210;
  const ch = H - cy - 20;
  const q = fade(t, 0.2, 0.8);
  c.save();
  c.globalAlpha = q;
  c.translate(0, (1 - q) * 80);
  c.fillStyle = '#1a0b14';
  roundRect(c, cx, cy, cw, ch, 40);
  c.fill();
  c.lineWidth = 10;
  c.strokeStyle = mix(p.hi, '#000000', 0.3);
  c.stroke();
  const mh = ch * 0.13;
  c.fillStyle = '#0d0509';
  c.fillRect(cx + 40, cy + 30, cw - 80, mh);
  const mf = fit(c, String(f.headline || "WHO'S NEXT?"), HEAVY, cw - 140, mh - 16, 90, 30, 1);
  c.font = `${mf.size}px ${HEAVY}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.lineWidth = 8;
  c.strokeStyle = '#000';
  c.strokeText(mf.lines[0] ?? '', W / 2, cy + 30 + mh / 2);
  c.fillStyle = '#ffffff';
  c.fillText(mf.lines[0] ?? '', W / 2, cy + 30 + mh / 2);
  const sy = cy + 60 + mh;
  const sh = ch * 0.5;
  const flick = t === Infinity ? 1 : 0.85 + 0.15 * Math.sin(t * 9);
  const sg = c.createRadialGradient(W / 2, sy + sh / 2, 20, W / 2, sy + sh / 2, cw * 0.55);
  sg.addColorStop(0, mix(p.hi, '#ffffff', 0.45));
  sg.addColorStop(1, mix(p.hi, '#000000', 0.25));
  roundRect(c, cx + 70, sy, cw - 140, sh, 50);
  c.fillStyle = sg;
  c.shadowColor = p.hi;
  c.shadowBlur = 60 * flick;
  c.fill();
  c.shadowBlur = 0;
  c.restore();
  const sf = fit(c, String(f.sub || 'GAMES REVEAL'), HEAVY, cw - 220, sh * 0.62, 150, 40, 0.98);
  c.save();
  c.shadowColor = mix(p.hi, '#000000', 0.4);
  c.shadowOffsetY = 6;
  riseLines(c, sf, W / 2, sy + sh * 0.12, t, 0.8, '#fffaf0', 'center', HEAVY);
  c.restore();
  if (f.when) say(c, String(f.when).toUpperCase(), W / 2, sy + sh - 70, `40px ${HEAVY}`, '#fffaf0', 'center', fade(t, 1.3));
  const by = sy + sh + 60;
  c.save();
  c.globalAlpha = fade(t, 1.0);
  for (let i = 0; i < 6; i++) {
    c.fillStyle = i % 2 ? p.hi : '#ffffff';
    c.beginPath();
    c.ellipse(W * 0.38 + (i % 3) * 70, by + Math.floor(i / 3) * 56, 24, 16, 0, 0, Math.PI * 2);
    c.fill();
  }
  [W * 0.22, W * 0.78].forEach((x) => {
    c.fillStyle = '#ccc';
    c.fillRect(x - 6, by - 10, 12, 60);
    c.fillStyle = p.hi;
    c.beginPath();
    c.arc(x, by - 16, 30, 0, Math.PI * 2);
    c.fill();
  });
  c.restore();
  partnersRow(c, f.partners, W, H - 110, '#ffffff', t);
};

// 21 — Event photo with a bottom info bar
const eventbarLook = (k: PK): Draw => (c, W, H, f, a, b, t) => {
  const p = pal3(k, b, true);
  photoOrPattern(c, a.photos.imageUrl, b, 0, 0, W, H, slowZoom(t, 1.1, 1.02));
  darkBottom(c, W, H, 0.45, 0.92, p.dark ? p.bg2 : '#000000');
  if (f.tag) pill(c, f.tag, W / 2, 40, 30, '#ffffff', '#111111', t, 0.2, 'center');
  const tf = fit(c, String(f.headline || 'BEACH POP-UP'), HEAVY, W - 120, H * 0.3, 170, 56, 0.95);
  const ty = H - 230 - tf.lines.length * tf.lineH;
  tf.lines.forEach((l, i) => {
    const q = easeBack(step(t, 0.5 + i * 0.15, 0.5));
    const y = ty + i * tf.lineH;
    c.save();
    c.globalAlpha = clamp(q);
    c.translate(W / 2, y + tf.size / 2);
    c.scale(q, q);
    c.font = `${tf.size}px ${HEAVY}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineJoin = 'round';
    c.fillStyle = mix(p.hi, '#000000', 0.55);
    for (let d = 10; d > 0; d -= 2) c.fillText(l, d * 0.6, d);
    c.lineWidth = tf.size * 0.1;
    c.strokeStyle = '#1a0e05';
    c.strokeText(l, 0, 0);
    const g = c.createLinearGradient(0, -tf.size / 2, 0, tf.size / 2);
    g.addColorStop(0, mix(p.hi, '#ffffff', 0.55));
    g.addColorStop(0.5, p.hi);
    g.addColorStop(1, mix(p.hi, '#000000', 0.2));
    c.fillStyle = g;
    c.fillText(l, 0, 0);
    c.restore();
  });
  const cells = [f.when, f.sub, f.cta].map((v) => String(v ?? '').trim()).filter(Boolean);
  if (cells.length) {
    const bq = fade(t, 1.3);
    const cw = (W - 100) / cells.length;
    cells.forEach((s, i) => {
      const x = 50 + i * cw;
      if (i) {
        c.save();
        c.globalAlpha = bq;
        c.fillStyle = 'rgba(255,255,255,0.6)';
        c.fillRect(x, H - 190, 3, 90);
        c.restore();
      }
      const ff = fit(c, s, HEAVY, cw - 40, 90, 44, 20, 1.0);
      ff.lines.forEach((l, j) => say(c, l, x + cw / 2, H - 190 + (90 - ff.lines.length * ff.lineH) / 2 + j * ff.lineH, `${ff.size}px ${HEAVY}`, j === 0 ? '#ffffff' : p.hi, 'center', bq));
    });
  }
  cornerHandle(c, b, W, H, '#ffffff', t);
};

// 22 — Vote / poll statement
const voteLook = (k: PK): Draw => (c, W, H, f, a, b, t) => {
  const p = pal3(k, b);
  ground3(c, a, p, W, H, t, 'knit');
  brushes(c, W, H, '#ffffff', t);
  topBrand(c, a, p, b, W, f.tag, t, 130);
  const opts = lines(f.rows, 4);
  const hf = fit(c, String(f.headline || 'VOTE FOR YOUR FAVOURITE GAME'), DISPLAY, W - 220, H * (opts.length ? 0.36 : 0.48), 150, 50, 1.0);
  const top = 260 + (H - 520 - hf.lines.length * hf.lineH - opts.length * 90) / 2;
  c.save();
  c.transform(1, 0, -0.14, 1, 0, 0);
  const y = riseLines(c, hf, W / 2 + top * 0.14, top, t, 0.4, '#ffffff', 'center');
  c.restore();
  opts.forEach((o, i) => {
    const q = fade(t, 1.0 + i * 0.12);
    const oy = y + 30 + i * 90;
    c.save();
    c.globalAlpha = q;
    roundRect(c, W * 0.18, oy, W * 0.64, 72, 36);
    c.fillStyle = 'rgba(255,255,255,0.12)';
    c.fill();
    c.lineWidth = 3;
    c.strokeStyle = p.hi;
    c.stroke();
    c.restore();
    c.font = `34px ${HEAVY}`;
    say(c, clipText(c, `${String.fromCharCode(65 + i)}.  ${o.toUpperCase()}`, W * 0.58), W * 0.22, oy + 38, `34px ${HEAVY}`, '#ffffff', 'left', q, 0, 'middle');
  });
  if (f.sub) say(c, f.sub, W / 2, H - 200, `40px ${HEAVY}`, p.hi, 'center', fade(t, 1.5));
  partnersRow(c, f.partners, W, H - 130, '#ffffff', t);
  cornerHandle(c, b, W, H, '#ffffff', t);
};

// 23 — Proudly representing (two players, map arrow)
const representLook = (k: PK): Draw => (c, W, H, f, a, b, t) => {
  const p = pal3(k, b);
  ground3(c, a, p, W, H, t);
  c.save();
  c.globalAlpha = 0.08;
  c.fillStyle = p.fg;
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 90 : 230;
    const an = -Math.PI / 2 + (i * Math.PI) / 5;
    c.lineTo(W * 0.2 + Math.cos(an) * r, H * 0.25 + Math.sin(an) * r);
  }
  c.fill();
  c.restore();
  c.save();
  c.globalAlpha = fade(t, 0.2, 1);
  c.fillStyle = p.hi;
  c.beginPath();
  c.moveTo(0, H * 0.78);
  c.lineTo(W * 0.22, H);
  c.lineTo(0, H);
  c.fill();
  c.fillStyle = p.acc2 === '#121212' ? '#1f8a3b' : p.acc2;
  c.beginPath();
  c.moveTo(W, H * 0.72);
  c.lineTo(W, H);
  c.lineTo(W * 0.74, H);
  c.fill();
  c.restore();
  logo(c, logoFor(p, a), W / 2, 90, 120, t, 0.1);
  spaced(c, f.tag || 'Proudly representing', W / 2, 170, 26, p.fg, t, 0.2);
  const cf = fit(c, String(f.headline || 'GHANA'), HEAVY, W - 200, 120, 90, 40, 1);
  riseLines(c, cf, W / 2, 210, t, 0.3, p.fg, 'center', HEAVY);
  let y = 210 + cf.lines.length * cf.lineH + 6;
  say(c, 'AT THE', W / 2, y, `700 22px ${BODY}`, p.fg, 'center', fade(t, 0.4));
  y += 34;
  const ef = fit(c, String(f.sub || 'RIVALRY SERIES'), DISPLAY, W - 220, 130, 110, 40, 1);
  c.save();
  c.font = `italic ${ef.size}px ${DISPLAY}`;
  c.lineJoin = 'round';
  c.lineWidth = 10;
  c.strokeStyle = p.dark ? '#000000' : '#ffffff';
  c.globalAlpha = fade(t, 0.5);
  c.textAlign = 'center';
  c.textBaseline = 'top';
  ef.lines.forEach((l, i) => {
    c.strokeText(l, W / 2, y + i * ef.lineH);
    c.fillStyle = p.hi;
    c.fillText(l, W / 2, y + i * ef.lineH);
  });
  c.restore();
  y += ef.lines.length * ef.lineH + 30;
  const [from, to] = String(f.when || 'Ghana → Nigeria').split(/\s*(?:→|->|to|,)\s*/i);
  const ax = W * 0.3;
  const bx = W * 0.7;
  const ay = y + 70;
  const q = fade(t, 0.8, 1.0);
  c.save();
  c.setLineDash([12, 10]);
  c.lineWidth = 4;
  c.strokeStyle = p.fg;
  c.beginPath();
  for (let i = 0; i <= 30 * q; i++) {
    const u = i / 30;
    const x = ax + (bx - ax) * u;
    const yy = ay - Math.sin(Math.PI * u) * 70;
    if (i === 0) c.moveTo(x, yy);
    else c.lineTo(x, yy);
  }
  c.stroke();
  c.setLineDash([]);
  [ax, bx].forEach((x, i) => {
    c.fillStyle = i ? p.acc2 === '#121212' ? '#1f8a3b' : p.acc2 : p.hi;
    c.beginPath();
    c.arc(x, ay, 14, 0, Math.PI * 2);
    c.fill();
  });
  c.restore();
  say(c, String(from ?? '').toUpperCase(), ax, ay + 26, `24px ${HEAVY}`, p.fg, 'center', fade(t, 0.8));
  say(c, String(to ?? '').toUpperCase(), bx, ay + 26, `24px ${HEAVY}`, p.fg, 'center', fade(t, 1.6));
  const py = ay + 80;
  const ph = H - py - 80;
  figure(c, a.photos.imageUrl, p, W * 0.04, py, W * 0.46, ph, t, 1.0);
  figure(c, a.photos.image2, p, W * 0.5, py, W * 0.46, ph, t, 1.2);
  [f.name1, f.name2].forEach((n, i) => {
    if (n) pill(c, n, W * (i ? 0.73 : 0.27), H - 150, 34, '#111111', '#ffffff', t, 1.5 + i * 0.1, 'center', 0, BODY);
  });
  const tag = String(f.cta || 'Two players. One nation. One mission.').toUpperCase();
  c.save();
  c.globalAlpha = fade(t, 1.8);
  c.fillStyle = '#1b1b1b';
  c.fillRect(0, H - 64, W, 64);
  c.restore();
  spaced(c, tag, W / 2, H - 46, 20, '#ffffff', t, 1.8, 'center', W - 80);
};

// 24 — Win streak + next opponent cards
const streakLook = (k: PK): Draw => (c, W, H, f, a, b, t) => {
  const p = pal3(k, b);
  ground3(c, a, p, W, H, t, '');
  logo(c, logoFor(p, a), 110, 90, 120, t, 0.1);
  spaced(c, 'Play • Compete • Win', W - 50, 74, 22, p.fg, t, 0.2, 'right', 500);
  const top = 170;
  const gap = 24;
  const ch = (H - top - 140 - gap) / 2;
  const card = (y: number, dark: boolean, im: HTMLImageElement | null, start: number, draw: (x: number, y: number, w: number, h: number, fg: string, q: number) => void) => {
    const q = fade(t, start, 0.6);
    c.save();
    c.globalAlpha = q;
    c.translate(0, (1 - q) * 50);
    roundRect(c, 50, y, W - 100, ch, 36);
    c.fillStyle = dark ? '#221a14' : p.dark ? 'rgba(255,255,255,0.12)' : mix(p.bg, '#ffffff', 0.45);
    c.shadowColor = 'rgba(0,0,0,0.18)';
    c.shadowBlur = 30;
    c.fill();
    c.shadowBlur = 0;
    c.clip();
    c.restore();
    figure(c, im, p, W * 0.55, y + 20, W * 0.42, ch - 20, t, start + 0.2, 'right');
    draw(90, y + 50, W * 0.5, ch - 80, dark ? '#fff8ea' : p.dark ? '#ffffff' : p.fg, q);
  };
  card(top, false, a.photos.imageUrl, 0.3, (x, y, w, h, fg) => {
    spaced(c, f.tag || 'FUT Champions · Game 6', x, y, 20, fg, t, 0.4, 'left', w);
    const hf = fit(c, String(f.headline || 'WON 6 IN A ROW.'), DISPLAY, w, h * 0.5, 110, 44, 1);
    const yy = riseLines(c, hf, x, y + 40, t, 0.5, fg);
    const n = Math.max(0, Math.min(12, Number(f.count ?? 6) || 0));
    for (let i = 0; i < n; i++) {
      const q = easeBack(step(t, 0.9 + i * 0.1, 0.35));
      if (q <= 0) continue;
      c.save();
      c.translate(x + i * 52 + 21, yy + 36);
      c.scale(q, q);
      roundRect(c, -21, -21, 42, 42, 8);
      c.fillStyle = '#2fb350';
      c.fill();
      c.strokeStyle = '#ffffff';
      c.lineWidth = 5;
      c.beginPath();
      c.moveTo(-9, 0);
      c.lineTo(-2, 8);
      c.lineTo(10, -8);
      c.stroke();
      c.restore();
    }
    if (f.sub) say(c, String(f.sub).toUpperCase(), x, yy + 80, `22px ${HEAVY}`, fg, 'left', fade(t, 1.4));
  });
  card(top + ch + gap, true, a.photos.image2, 0.8, (x, y, w, h, fg) => {
    say(c, `● ${String(f.tag2 || 'MATCH FOUND').toUpperCase()}`, x, y, `20px ${HEAVY}`, '#f0b323', 'left', fade(t, 1.0));
    const hf = fit(c, String(f.headline2 || 'NEXT OPPONENT:'), DISPLAY, w, h * 0.45, 110, 44, 1);
    const yy = riseLines(c, hf, x, y + 40, t, 1.0, fg) + 16;
    if (f.opp) {
      const q = fade(t, 1.4);
      c.save();
      c.globalAlpha = q;
      roundRect(c, x, yy, w * 0.8, 120, 16);
      c.fillStyle = '#140f0b';
      c.fill();
      c.strokeStyle = '#f0b323';
      c.lineWidth = 3;
      c.stroke();
      c.restore();
      c.font = `46px ${HEAVY}`;
      say(c, clipText(c, String(f.opp), w * 0.8 - 40), x + 24, yy + 18, `46px ${HEAVY}`, '#ffffff', 'left', q);
      if (f.oppRec) say(c, `RECORD  ${f.oppRec}`, x + 24, yy + 78, `26px ${HEAVY}`, '#f0b323', 'left', q);
    }
  });
  c.save();
  c.globalAlpha = fade(t, 1.7);
  c.fillStyle = p.fg;
  c.fillRect(50, H - 100, 70, 5);
  c.restore();
  spaced(c, `${b.centre} / memes`, 50, H - 74, 20, p.fg, t, 1.7, 'left', 500);
  cornerHandle(c, b, W, H, p.fg, t);
};

function icon(c: C, kind: number, x: number, y: number, s: number, color: string) {
  c.save();
  c.strokeStyle = color;
  c.fillStyle = color;
  c.lineWidth = 4;
  if (kind === 0) {
    c.beginPath();
    c.moveTo(x - s * 0.4, y - s * 0.45);
    c.lineTo(x + s * 0.4, y - s * 0.45);
    c.quadraticCurveTo(x + s * 0.4, y + s * 0.1, x, y + s * 0.15);
    c.quadraticCurveTo(x - s * 0.4, y + s * 0.1, x - s * 0.4, y - s * 0.45);
    c.fill();
    c.fillRect(x - 4, y + s * 0.1, 8, s * 0.25);
    c.fillRect(x - s * 0.25, y + s * 0.35, s * 0.5, 7);
  } else if (kind === 1) {
    [-0.32, 0, 0.32].forEach((dx, i) => {
      c.beginPath();
      c.arc(x + dx * s, y - s * 0.2 + (i === 1 ? -6 : 0), s * 0.13, 0, Math.PI * 2);
      c.stroke();
      c.beginPath();
      c.arc(x + dx * s, y + s * 0.3, s * 0.2, Math.PI, 0);
      c.stroke();
    });
  } else {
    c.strokeRect(x - s * 0.3, y - s * 0.4, s * 0.6, s * 0.8);
    for (let i = 0; i < 3; i++) c.fillRect(x - s * 0.18, y - s * 0.2 + i * s * 0.2, s * 0.36, 4);
  }
  c.restore();
}

// 25 — Prize pool / coming soon
const prizeLook = (k: PK): Draw => (c, W, H, f, a, b, t) => {
  const p = pal3(k, b);
  const g = c.createLinearGradient(0, 0, W * 0.4, H);
  g.addColorStop(0, p.bg);
  g.addColorStop(0.42, p.bg2);
  g.addColorStop(0.62, mix(p.hi, '#000000', 0.25));
  g.addColorStop(0.85, '#0b0b0b');
  g.addColorStop(1, '#050505');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
  const pt = c.createPattern(tile('grain', p.dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)'), 'repeat');
  if (pt) {
    c.fillStyle = pt;
    c.fillRect(0, 0, W, H);
  }
  const top = p.dark ? '#ffffff' : p.fg;
  logo(c, logoFor(p, a), W / 2, 90, 120, t, 0.1);
  say(c, b.centre.toUpperCase(), W / 2, 160, `30px ${HEAVY}`, top, 'center', fade(t, 0.2));
  spaced(c, 'presents', W / 2, 198, 18, p.hi, t, 0.2);
  const t1 = fit(c, String(f.tag || 'THE ARENA'), DISPLAY, W - 160, 150, 140, 50, 1);
  let y = riseLines(c, t1, W / 2, 240, t, 0.3, top, 'center');
  const t2 = fit(c, String(f.headline || 'AWAITS'), DISPLAY, W - 160, 150, 140, 50, 1);
  y = riseLines(c, t2, W / 2, y - 6, t, 0.45, p.hi, 'center') + 20;
  spaced(c, f.sub || 'Prize pool', W / 2, y, 20, top, t, 0.6);
  y += 36;
  const amount = String(f.when || '200,000');
  const af = fit(c, amount, HEAVY, W - 300, 170, 170, 60, 1);
  const q = fade(t, 0.7, 1.8);
  say(c, countUp(amount, q), W / 2, y, `${af.size}px ${HEAVY}`, top === '#ffffff' ? '#ffffff' : '#111111', 'center', fade(t, 0.7));
  c.font = `${af.size}px ${HEAVY}`;
  const aw = c.measureText(amount).width;
  if (f.cta) pill(c, f.cta, W / 2 + aw / 2 + 10, y - 20, 30, p.hi, p.dark ? '#ffffff' : '#111111', t, 1.2, 'left', 0, HEAVY);
  y += af.size + 30;
  const games = String(f.lines || 'FC 26 · eFootball · Tekken 8 · COD Mobile')
    .split(/\n|·|,/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 6);
  say(c, 'FEATURING GAMES', W / 2, y, `30px ${DISPLAY}`, '#ffffff', 'center', fade(t, 1.0));
  y += 50;
  const gw = (W - 100) / games.length;
  games.forEach((gm, i) => {
    c.font = `26px ${HEAVY}`;
    say(c, clipText(c, gm.toUpperCase(), gw - 16), 50 + gw * (i + 0.5), y + 20, `26px ${HEAVY}`, '#ffffff', 'center', fade(t, 1.1 + i * 0.08), 0, 'middle');
    if (i) {
      c.fillStyle = 'rgba(255,255,255,0.35)';
      c.fillRect(50 + gw * i, y, 2, 40);
    }
  });
  y += 90;
  const feats = lines(f.rows || 'Multiple games\nOpen to all\nRegistration open soon', 3);
  const fw = (W - 100) / Math.max(1, feats.length);
  feats.forEach((s, i) => {
    const fx = 50 + fw * i + 50;
    const qq = fade(t, 1.3 + i * 0.1);
    c.save();
    c.globalAlpha = qq;
    icon(c, i, fx, y + 30, 64, p.hi);
    c.restore();
    para(c, s.toUpperCase(), fx + 50, y + 8, fw - 110, 60, 24, 16, '#ffffff', t, 1.3 + i * 0.1, 'left', 0.85);
  });
  const sf = fit(c, String(f.source || 'COMING SOON'), DISPLAY, W - 200, 140, 130, 50, 1);
  riseLines(c, sf, W / 2, H - 120 - sf.lines.length * sf.lineH - 40, t, 1.6, p.hi, 'center');
  spaced(c, f.soon2 || 'Stay tuned. Stay ready.', W / 2, H - 140, 22, '#ffffff', t, 1.8);
  spaced(c, 'Play • Compete • Win', W / 2, H - 70, 18, 'rgba(255,255,255,0.6)', t, 1.9);
};

// 26 — Players reveal (heading on photo)
const animatedLook = (k: PK): Draw => (c, W, H, f, a, b, t) => {
  const p = pal3(k, b, true);
  const accent = k === 'white' ? '#ffffff' : p.hi;
  photoOrPattern(c, a.photos.imageUrl, b, 0, 0, W, H, slowZoom(t));
  darkTop(c, W, H, 0.18, 0.4);
  darkBottom(c, W, H, 0.4, 0.95, '#0b0907');
  logo(c, a.logoOutline, 110, 90, 130, t, 0.1);
  spaced(c, 'Play • Compete • Win', W - 50, 74, 20, '#ffffff', t, 0.2, 'right', 500);
  const l1 = fit(c, String(f.headline || 'OUR PLAYERS,'), DISPLAY, W - 120, H * 0.16, 120, 50, 1);
  const l2 = fit(c, String(f.sub || 'BUT ANIMATED.'), DISPLAY, W - 120, H * 0.16, 120, 50, 1);
  let y = H - 400 - (l1.lines.length + l2.lines.length) * l1.lineH * 0.9;
  y = riseLines(c, l1, 60, y, t, 0.5, '#fff4e0');
  y = riseLines(c, l2, 60, y, t, 0.7, accent) + 30;
  c.save();
  c.globalAlpha = fade(t, 1.0);
  c.fillStyle = accent;
  c.fillRect(60, y, 80, 5);
  c.restore();
  const qf = fit(c, String(f.when || 'CAN YOU IDENTIFY THEM?'), DISPLAY, W - 120, 120, 64, 36, 1);
  y = riseLines(c, qf, 60, y + 30, t, 1.1, '#fff4e0') + 16;
  para(c, f.cta || 'Drop your guesses in the comments.', 60, y, W - 120, 60, 30, 20, '#ffffff', t, 1.4);
  say(c, `#${b.centre.replace(/\s+/g, '').toUpperCase()}`, W - 50, H - 84, `24px ${HEAVY}`, accent, 'right', fade(t, 1.7), 0, 'alphabetic');
  cornerHandle(c, b, W, H, '#ffffff', t);
};

// 27 — Players (label pill + huge word + corner badge)
const playersLook = (k: PK): Draw => (c, W, H, f, a, b, t) => {
  const p = pal3(k, b, true);
  photoOrPattern(c, a.photos.imageUrl, b, 0, 0, W, H, slowZoom(t, 1.1, 1.0));
  darkBottom(c, W, H, 0.55, 0.75);
  logo(c, a.logoOutline, 110, 100, 140, t, 0.1);
  const top = metalName(c, f.headline || 'PLAYERS', 50, H - 100, W * (f.sub ? 0.66 : 0.9), H * 0.2, 240, t, 0.6);
  if (f.tag) {
    const q = fade(t, 0.4);
    c.font = `52px ${HEAVY}`;
    const s = String(f.tag).toUpperCase();
    const w = c.measureText(s).width + 50;
    c.save();
    c.globalAlpha = q;
    const g = c.createLinearGradient(50, 0, 50 + w, 0);
    g.addColorStop(0, p.hi);
    g.addColorStop(1, mix(p.hi, k === 'orange' ? '#ff2d87' : '#ffffff', 0.35));
    roundRect(c, 50 + (1 - q) * -80, top - 90, w, 76, 12);
    c.fillStyle = g;
    c.fill();
    c.restore();
    say(c, s, 75, top - 52, `52px ${HEAVY}`, '#ffffff', 'left', q, 0, 'middle');
  }
  if (f.sub) {
    const s = 190;
    const q = easeBack(step(t, 1.1, 0.5));
    c.save();
    c.globalAlpha = clamp(q);
    c.translate(W - 60 - s / 2, H - 110 - s / 2);
    c.rotate(-0.05);
    c.scale(q, q);
    const g = c.createLinearGradient(-s / 2, -s / 2, s / 2, s / 2);
    g.addColorStop(0, p.hi);
    g.addColorStop(1, '#5b2bd6');
    roundRect(c, -s / 2, -s / 2, s, s, 26);
    c.fillStyle = g;
    c.fill();
    const tf = fit(c, String(f.sub), HEAVY, s - 30, s - 30, 60, 20, 1);
    c.fillStyle = '#ffffff';
    c.font = `${tf.size}px ${HEAVY}`;
    c.textAlign = 'center';
    c.textBaseline = 'top';
    tf.lines.forEach((l, i) => c.fillText(l, 0, -(tf.lines.length * tf.lineH) / 2 + i * tf.lineH + 4));
    c.restore();
  }
  cornerHandle(c, b, W, H, '#ffffff', t);
};

// 28 — Festival poster (chunky outlined title)
const festLook = (k: PK): Draw => (c, W, H, f, a, b, t) => {
  const p = pal3(k, b);
  ground3(c, a, p, W, H, t);
  const bq = fade(t, 0.2, 0.9);
  c.save();
  c.globalAlpha = 0.85;
  [[p.acc, 0.3], [p.acc2, 0.36]].forEach(([col, yy], i) => {
    c.fillStyle = col as string;
    c.beginPath();
    const y0 = H * (yy as number);
    c.moveTo(0, y0);
    for (let x = 0; x <= W * 0.4 * bq; x += 20) c.lineTo(x, y0 + Math.sin(x / 30 + i) * 14 - x * 0.12);
    for (let x = W * 0.4 * bq; x >= 0; x -= 20) c.lineTo(x, y0 + 90 + Math.cos(x / 25 + i) * 18 - x * 0.12);
    c.closePath();
    c.fill();
  });
  c.restore();
  logo(c, logoFor(p, a), W / 2, 100, 140, t, 0.1);
  spaced(c, f.tag || `${b.centre} at the campus`, W * 0.6, 200, 24, p.fg, t, 0.2, 'center', W * 0.7);
  figure(c, a.photos.imageUrl, p, -W * 0.02, H * 0.25, W * 0.36, H * 0.66, t, 0.4, 'left');
  const tx = W * 0.62;
  const tf = fit(c, String(f.headline || 'GAME FEST 2026'), HEAVY, W * 0.6, H * 0.32, 170, 60, 0.92);
  let y = 250;
  tf.lines.forEach((l, i) => {
    const q = easeBack(step(t, 0.5 + i * 0.15, 0.5));
    c.save();
    c.globalAlpha = clamp(q);
    c.translate(tx, y + tf.size / 2);
    c.rotate(-0.03);
    c.scale(q, q);
    c.font = `${tf.size}px ${HEAVY}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineJoin = 'round';
    c.lineWidth = tf.size * 0.34;
    c.strokeStyle = p.acc2;
    c.strokeText(l, 0, 0);
    c.lineWidth = tf.size * 0.18;
    c.strokeStyle = p.acc;
    c.strokeText(l, 0, 0);
    c.fillStyle = '#ffffff';
    c.fillText(l, 0, 0);
    c.restore();
    y += tf.lineH;
  });
  y += 40;
  if (f.sub) {
    const q = fade(t, 1.0);
    c.font = `34px ${DISPLAY}`;
    const s = String(f.sub).toUpperCase();
    const w = Math.min(W * 0.62, c.measureText(s).width + 60);
    c.save();
    c.globalAlpha = q;
    c.fillStyle = p.acc2;
    c.fillRect(tx - w / 2 + 6, y + 6, w, 60);
    c.fillStyle = p.acc;
    c.fillRect(tx - w / 2, y, w, 60);
    c.restore();
    say(c, clipText(c, s, w - 30), tx, y + 32, `34px ${DISPLAY}`, '#ffffff', 'center', q, 0, 'middle');
    y += 110;
  }
  const cols: [string, unknown][] = [
    ['DATE', f.when],
    ['VENUE', f.cta],
  ];
  cols.forEach(([lab, val], i) => {
    if (!val) return;
    const cx = tx + (i ? 1 : -1) * W * 0.15;
    const q = fade(t, 1.2 + i * 0.15);
    c.save();
    c.globalAlpha = q;
    c.strokeStyle = p.acc;
    c.fillStyle = p.acc;
    c.lineWidth = 4;
    if (i === 0) {
      c.strokeRect(cx - 22, y, 44, 40);
      c.fillRect(cx - 22, y, 44, 10);
    } else {
      c.beginPath();
      c.arc(cx, y + 14, 16, Math.PI, 0);
      c.lineTo(cx, y + 44);
      c.closePath();
      c.fill();
    }
    c.restore();
    say(c, lab, cx, y + 56, `600 26px ${BODY}`, p.fg, 'center', q);
    para(c, String(val).toUpperCase(), cx, y + 92, W * 0.28, 90, 28, 18, p.fg, t, 1.3 + i * 0.15, 'center', 1);
  });
  spaced(c, 'Play • Compete • Connect', W / 2, H - 120, 24, p.fg, t, 1.6, 'center', W - 120);
  c.save();
  c.globalAlpha = fade(t, 1.7);
  c.fillStyle = p.acc;
  c.fillRect(0, H - 64, W, 64);
  c.restore();
  say(c, b.handle || b.centre, W / 2, H - 32, `600 24px ${BODY}`, '#ffffff', 'center', fade(t, 1.8), 0, 'middle');
};

const PLAYER_PIC: FieldDef = { key: 'imageUrl', label: 'Player picture', kind: 'image', hint: 'A cut-out PNG with no background looks best (remove.bg makes one free).' };
const PARTNERS: FieldDef = { key: 'partners', label: 'Partners / sponsors line', kind: 'text', placeholder: 'GamePride · Trace · DAS' };

interface PackFamily {
  name: string;
  about: string;
  group: string;
  fields: FieldDef[];
  variants: PK[];
  make: (k: PK) => Draw;
}

const PACK: Record<string, PackFamily> = {
  comic: {
    name: 'Comic panel',
    about: 'Photo with comic caption boxes, a speech bubble and a shout word — great for 3D cartoon pictures',
    group: 'Memes & comics',
    fields: [
      { key: 'imageUrl', label: 'Picture (e.g. your 3D cartoon)', kind: 'image' },
      { key: 'tag', label: 'Top caption box', kind: 'text', placeholder: '10 SECONDS LATER…' },
      { key: 'sub', label: 'Shout word', kind: 'text', placeholder: 'BUSTED!' },
      { key: 'headline', label: 'Speech bubble', kind: 'textarea', placeholder: 'Pass the second controller.' },
      { key: 'when', label: 'Bottom caption box', kind: 'text', placeholder: 'TO BE CONTINUED…' },
    ],
    variants: ['warm', 'lime', 'pink', 'white'],
    make: comicLook,
  },
  character: {
    name: 'Game character',
    about: 'Loading-screen style: full photo, logo, game badge and a huge metal name',
    group: 'Players',
    fields: [
      { key: 'imageUrl', label: 'Picture', kind: 'image' },
      { key: 'headline', label: 'Name', kind: 'text', placeholder: 'LAMAR' },
      { key: 'tag', label: 'Game badge (top right)', kind: 'text', placeholder: 'GTA VI' },
      { key: 'sub', label: 'Small line above the name', kind: 'text', placeholder: 'ZMG PLAYERS' },
    ],
    variants: ['sunset', 'navy', 'lime', 'gold'],
    make: characterLook,
  },
  reveal: {
    name: 'Game reveal',
    about: 'Knitted background, big slanted game title, cut-out characters and paint streaks',
    group: 'Events',
    fields: [
      { key: 'tag', label: 'Event name (next to the logo)', kind: 'text', placeholder: 'CAGE 26' },
      { key: 'headline', label: 'Game title', kind: 'text', placeholder: 'FC MOBILE' },
      PLAYER_PIC,
      { key: 'sub', label: 'Line under the picture', kind: 'text' },
      PARTNERS,
    ],
    variants: ['magenta', 'navy', 'green', 'black'],
    make: revealLook,
  },
  behind: {
    name: 'Word behind player',
    about: 'A giant word behind a cut-out player, with a slanted tag',
    group: 'Matches & players',
    fields: [
      { key: 'tag', label: 'Small title on top', kind: 'text', placeholder: 'FC 26' },
      { key: 'headline', label: 'Giant word', kind: 'text', placeholder: 'KICK' },
      { key: 'sub', label: 'Tag on the word', kind: 'text', placeholder: 'OFF' },
      PLAYER_PIC,
      PARTNERS,
    ],
    variants: ['magenta', 'orange', 'navy', 'lime'],
    make: behindLook,
  },
  today: {
    name: "It's today",
    about: 'Match-day poster: giant first word, player on the right, stream time',
    group: 'Events',
    fields: [
      { key: 'tag', label: 'League name (edges)', kind: 'text', placeholder: 'ELITE SUPER LEAGUE' },
      { key: 'sub', label: 'Series line', kind: 'text', placeholder: 'ROAD TO RIVALRY SERIES' },
      { key: 'headline', label: 'Big words', kind: 'text', placeholder: "IT'S TODAY" },
      PLAYER_PIC,
      { key: 'when', label: 'Where to watch', kind: 'text', placeholder: 'Streaming LIVE on YouTube' },
      { key: 'cta', label: 'Time', kind: 'text', placeholder: '1:00 PM GMT' },
      PARTNERS,
    ],
    variants: ['purple', 'black', 'magenta', 'green'],
    make: todayLook,
  },
  cinema: {
    name: 'Cinematic title',
    about: 'Photo with a glowing movie-style title and spaced lines',
    group: 'Moments',
    fields: [
      { key: 'imageUrl', label: 'Picture', kind: 'image' },
      { key: 'tag', label: 'Top line', kind: 'text', placeholder: 'ZMG PRESENTS' },
      { key: 'headline', label: 'Title', kind: 'text', placeholder: 'VI' },
      { key: 'sub', label: 'Bottom line', kind: 'text', placeholder: 'SWIPE TO SEE WHAT HAPPENED' },
    ],
    variants: ['sunset', 'gold', 'navy', 'lime'],
    make: cinemaLook,
  },
  month: {
    name: 'New month',
    about: 'Happy new month: spaced line, pill, giant month and a glowing picture',
    group: 'Celebrations',
    fields: [
      { key: 'tag', label: 'Top line', kind: 'text', placeholder: 'HAPPY NEW MONTH' },
      { key: 'sub', label: 'Pill', kind: 'text', placeholder: 'WELCOME TO' },
      { key: 'headline', label: 'Month', kind: 'text', placeholder: 'August' },
      { key: 'imageUrl', label: 'Picture (controller, player…)', kind: 'image' },
      { key: 'when', label: 'Message', kind: 'textarea', placeholder: 'A new month means new fixtures and bigger rivalries.' },
    ],
    variants: ['magenta', 'black', 'gold', 'purple'],
    make: monthLook,
  },
  season: {
    name: 'Season tease',
    about: 'Giant stretched title with a slanted ribbon and a trophy',
    group: 'Events',
    fields: [
      { key: 'tag', label: 'Top line', kind: 'text', placeholder: 'SEASON 1 CREATED A KING' },
      { key: 'headline', label: 'Giant title', kind: 'text', placeholder: 'SEASON 2' },
      { key: 'sub', label: 'Ribbon', kind: 'text', placeholder: 'CHALLENGES IT' },
      { key: 'imageUrl', label: 'Trophy / picture', kind: 'image' },
    ],
    variants: ['green', 'magenta', 'navy', 'gold'],
    make: seasonLook,
  },
  table: {
    name: 'League table',
    about: 'Full standings table with promotion / relegation colours',
    group: 'Results & tables',
    fields: [
      { key: 'tag', label: 'League name', kind: 'text', placeholder: 'ZMG LEAGUE' },
      { key: 'headline', label: 'Side title', kind: 'text', placeholder: 'STANDINGS' },
      { key: 'cols', label: 'Columns', kind: 'text', placeholder: 'P, W, D, L, GD, PTS' },
      { key: 'nameCol', label: 'Name column', kind: 'text', placeholder: 'PLAYER' },
      { key: 'rows', label: 'Rows (best first)', kind: 'rows', hint: 'One per line: name, then the numbers — e.g. Kofi, 10, 8, 1, 1, 28, 25' },
      { key: 'up', label: 'Green rows at the top (number)', kind: 'text', placeholder: '4' },
      { key: 'down', label: 'Red rows at the bottom (number)', kind: 'text', placeholder: '3' },
      { key: 'sub', label: 'Bottom pill', kind: 'text', placeholder: 'WATCH LIVE ON YOUTUBE' },
    ],
    variants: ['purple', 'green', 'navy', 'black'],
    make: tableLook,
  },
  results: {
    name: 'Results',
    about: 'Score lines with a VS column',
    group: 'Results & tables',
    fields: [
      { key: 'tag', label: 'League line', kind: 'text', placeholder: 'ELITE LEAGUE SEASON 2' },
      { key: 'headline', label: 'Title', kind: 'text', placeholder: 'RESULTS' },
      { key: 'sub', label: 'Badge', kind: 'text', placeholder: 'WEEK 1' },
      { key: 'when', label: 'Date', kind: 'text', placeholder: 'SUNDAY, 26TH APRIL 2026' },
      { key: 'rows', label: 'Results', kind: 'rows', hint: 'One per line: Kofi 5-3 Ama' },
      { key: 'cta', label: 'Bottom pill', kind: 'text', placeholder: 'WATCH LIVE ON YOUTUBE' },
    ],
    variants: ['green', 'purple', 'navy', 'magenta'],
    make: resultsLook,
  },
  predict: {
    name: 'Predictions',
    about: 'Prediction cards on the left, the guest in a frame with a circled name',
    group: 'Community',
    fields: [
      { key: 'headline', label: 'Title', kind: 'textarea', placeholder: '2026 World Cup predictions' },
      { key: 'rows', label: 'Predictions', kind: 'rows', hint: 'One per line: label, answer — e.g. Champions, France' },
      { key: 'imageUrl', label: 'Guest photo', kind: 'image' },
      { key: 'sub', label: 'Guest name', kind: 'text' },
      { key: 'when', label: 'Guest role', kind: 'text', placeholder: 'CEO, Lockerroom Sports' },
    ],
    variants: ['blue', 'magenta', 'navy', 'gold'],
    make: predictLook,
  },
  winnerann: {
    name: 'Winner announcement',
    about: 'Series title, giant WINNER, message and the champion on the right',
    group: 'Matches & players',
    fields: [
      { key: 'tag', label: 'Series', kind: 'text', placeholder: 'CHAMPIONSHIP SERIES' },
      { key: 'sub', label: 'Episode pill', kind: 'text', placeholder: 'SEASON 1 · EPISODE 2' },
      { key: 'headline', label: 'Big word', kind: 'text', placeholder: 'WINNER' },
      { key: 'when', label: 'Message', kind: 'textarea' },
      PLAYER_PIC,
    ],
    variants: ['red', 'black', 'magenta', 'navy'],
    make: winnerAnnLook,
  },
  birthday: {
    name: 'Happy birthday',
    about: 'Player on the left, HAPPY BIRTHDAY bars and the name',
    group: 'Celebrations',
    fields: [
      { key: 'headline', label: 'Name', kind: 'text' },
      { key: 'sub', label: 'Role', kind: 'text', placeholder: 'FC PLAYER' },
      PLAYER_PIC,
      { key: 'tag', label: 'First word', kind: 'text', placeholder: 'HAPPY' },
      { key: 'when', label: 'Words in the corner', kind: 'text', placeholder: 'PLAY COMPETE GROW BELONG' },
    ],
    variants: ['gold', 'navy', 'pink', 'blue'],
    make: birthdayLook,
  },
  thanks: {
    name: 'Milestone',
    about: 'THANK YOU, a number that counts up and what it counts',
    group: 'Celebrations',
    fields: [
      { key: 'tag', label: 'Top words', kind: 'text', placeholder: 'THANK YOU' },
      { key: 'headline', label: 'Number', kind: 'text', placeholder: '10,000' },
      { key: 'sub', label: 'Platform', kind: 'text', placeholder: 'YouTube' },
      { key: 'when', label: 'What', kind: 'text', placeholder: 'SUBSCRIBERS' },
    ],
    variants: ['purple', 'magenta', 'black', 'gold'],
    make: thanksLook,
  },
  rules: {
    name: 'Rules board',
    about: 'Title, a picture in the middle and four rule boxes around it',
    group: 'Events',
    fields: [
      { key: 'headline', label: 'Title', kind: 'text', placeholder: 'SQUAD RESTRICTIONS' },
      { key: 'rows', label: 'Rules (up to 4)', kind: 'rows', hint: 'One per line: small label, box text — e.g. Max 1 player, rated 92+' },
      { key: 'imageUrl', label: 'Middle picture (trophy…)', kind: 'image' },
      { key: 'sub', label: 'Bottom line', kind: 'text', placeholder: 'Presented by ZMG' },
    ],
    variants: ['purple', 'navy', 'magenta', 'green'],
    make: rulesLook,
  },
  meme: {
    name: 'Meme + quote',
    about: 'Set-up line, a quote bubble, a scoreboard chip and the character',
    group: 'Memes & comics',
    fields: [
      { key: 'tag', label: 'Small line', kind: 'text', placeholder: 'DIVISION RIVALS · DIVISION 1' },
      { key: 'sub', label: 'Set-up', kind: 'textarea', placeholder: 'Promotion match to Elite. 1-1, 88th minute.' },
      { key: 'headline', label: 'Big words (last line in colour)', kind: 'textarea', placeholder: 'OHHH ECG!!!' },
      { key: 'when', label: 'Quote', kind: 'text', placeholder: "IT'S PACKET LOSS." },
      { key: 'score', label: 'Score chip', kind: 'text', placeholder: "YOU 4-0 HIM · 78'" },
      { key: 'imageUrl', label: 'Character (3D cartoon works great)', kind: 'image' },
    ],
    variants: ['warm', 'light', 'lime', 'navy'],
    make: memeLook,
  },
  goodluck: {
    name: 'Good luck squad',
    about: 'Big wish, black slanted pill and the team photo',
    group: 'Matches & players',
    fields: [
      { key: 'headline', label: 'Big words', kind: 'text', placeholder: 'GOOD LUCK, BOYS.' },
      { key: 'sub', label: 'Line', kind: 'text', placeholder: 'OUR PLAYERS ARE READY FOR THE' },
      { key: 'tag', label: 'Pill', kind: 'text', placeholder: 'ELITE SUPER LEAGUE.' },
      { key: 'imageUrl', label: 'Team photo', kind: 'image' },
      { key: 'when', label: 'Bottom line', kind: 'text', placeholder: 'Represent the badge. Make us proud.' },
    ],
    variants: ['warm', 'navy', 'lime', 'light'],
    make: goodluckLook,
  },
  flyer: {
    name: 'Tournament flyer',
    about: 'Details column, phone number, photo panel and a FREE ENTRY sticker',
    group: 'Events',
    fields: [
      { key: 'tag', label: 'Title', kind: 'text', placeholder: 'CHAMPIONSHIP SERIES' },
      { key: 'sub', label: 'Pill', kind: 'text', placeholder: 'SEASON 1 · EPISODE 2' },
      { key: 'rows', label: 'Details', kind: 'rows', hint: 'One per line: label, value — e.g. Time, 8 PM' },
      { key: 'when', label: 'Phone', kind: 'text', placeholder: '059 000 0000' },
      { key: 'cta', label: 'Sticker', kind: 'text', placeholder: 'FREE ENTRY' },
      { key: 'imageUrl', label: 'Photo', kind: 'image' },
    ],
    variants: ['red', 'navy', 'magenta', 'gold'],
    make: flyerLook,
  },
  chapter: {
    name: 'New chapter',
    about: 'Stacked words in two styles, dates and a trophy',
    group: 'Events',
    fields: [
      { key: 'headline', label: 'Words (one per line on the poster)', kind: 'text', placeholder: 'MASSIVE NEW CHAPTER' },
      { key: 'sub', label: 'Dates', kind: 'text', placeholder: '1ST - 29TH' },
      { key: 'when', label: 'Month / year', kind: 'text', placeholder: "NOVEMBER '26" },
      { key: 'imageUrl', label: 'Trophy / picture', kind: 'image' },
    ],
    variants: ['purple', 'magenta', 'black', 'green'],
    make: chapterLook,
  },
  arcade: {
    name: 'Arcade reveal',
    about: 'An arcade machine with a glowing screen',
    group: 'Events',
    fields: [
      { key: 'tag', label: 'Event name (next to the logo)', kind: 'text', placeholder: 'CAGE 26' },
      { key: 'headline', label: 'Top sign', kind: 'text', placeholder: "WHO'S NEXT?" },
      { key: 'sub', label: 'Screen text', kind: 'text', placeholder: 'GAMES REVEAL' },
      { key: 'when', label: 'Date', kind: 'text', placeholder: '21 - 22 AUGUST 2026' },
      PARTNERS,
    ],
    variants: ['magenta', 'purple', 'green', 'gold'],
    make: arcadeLook,
  },
  eventbar: {
    name: 'Event photo',
    about: 'Photo with a chunky 3D title and a date · venue · time bar',
    group: 'Events',
    fields: [
      { key: 'imageUrl', label: 'Photo', kind: 'image' },
      { key: 'tag', label: 'Top pill', kind: 'text', placeholder: 'CREATORS FESTIVAL × ZMG' },
      { key: 'headline', label: 'Title', kind: 'textarea', placeholder: 'BEACH POP UP MIXER' },
      { key: 'when', label: 'Date', kind: 'text', placeholder: "20TH NOV '26" },
      { key: 'sub', label: 'Venue', kind: 'text', placeholder: '@ SANDBOX BEACH CLUB' },
      { key: 'cta', label: 'Time', kind: 'text', placeholder: '2 PM' },
    ],
    variants: ['navy', 'gold', 'magenta', 'lime'],
    make: eventbarLook,
  },
  vote: {
    name: 'Vote / poll',
    about: 'A big slanted question with up to 4 options',
    group: 'Community',
    fields: [
      { key: 'tag', label: 'Event name (next to the logo)', kind: 'text' },
      { key: 'headline', label: 'Question', kind: 'textarea', placeholder: 'VOTE FOR YOUR FAVOURITE PC GAME TO BE ADDED' },
      { key: 'rows', label: 'Options (up to 4)', kind: 'rows', hint: 'One per line' },
      { key: 'sub', label: 'Call to action', kind: 'text', placeholder: 'Comment your pick 👇' },
      PARTNERS,
    ],
    variants: ['magenta', 'navy', 'green', 'black'],
    make: voteLook,
  },
  represent: {
    name: 'Representing',
    about: 'Two players, the country and a travel arrow between two places',
    group: 'Matches & players',
    fields: [
      { key: 'tag', label: 'Top line', kind: 'text', placeholder: 'PROUDLY REPRESENTING' },
      { key: 'headline', label: 'Country', kind: 'text', placeholder: 'GHANA' },
      { key: 'sub', label: 'Event', kind: 'text', placeholder: 'RIVALRY SERIES' },
      { key: 'when', label: 'From → to', kind: 'text', placeholder: 'Accra → Lagos' },
      { key: 'imageUrl', label: 'Player 1', kind: 'image' },
      { key: 'name1', label: 'Player 1 name', kind: 'text' },
      { key: 'image2', label: 'Player 2', kind: 'image' },
      { key: 'name2', label: 'Player 2 name', kind: 'text' },
      { key: 'cta', label: 'Bottom line', kind: 'text', placeholder: 'TWO PLAYERS. ONE NATION. ONE MISSION.' },
    ],
    variants: ['gold', 'navy', 'green', 'light'],
    make: representLook,
  },
  streak: {
    name: 'Streak & next match',
    about: 'Two cards: a win streak with ticks, then the next opponent',
    group: 'Matches & players',
    fields: [
      { key: 'tag', label: 'Card 1 small line', kind: 'text', placeholder: 'FUT CHAMPIONS · GAME 6' },
      { key: 'headline', label: 'Card 1 big words', kind: 'text', placeholder: 'WON 6 IN A ROW.' },
      { key: 'count', label: 'Ticks', kind: 'text', placeholder: '6' },
      { key: 'sub', label: 'Card 1 bottom line', kind: 'text', placeholder: 'FORM +6 · RECORD 6-0' },
      { key: 'imageUrl', label: 'Card 1 picture', kind: 'image' },
      { key: 'tag2', label: 'Card 2 small line', kind: 'text', placeholder: 'MATCH FOUND' },
      { key: 'headline2', label: 'Card 2 big words', kind: 'text', placeholder: 'NEXT OPPONENT:' },
      { key: 'opp', label: 'Opponent', kind: 'text' },
      { key: 'oppRec', label: 'Opponent record', kind: 'text', placeholder: '14-0' },
      { key: 'image2', label: 'Card 2 picture', kind: 'image' },
    ],
    variants: ['warm', 'navy', 'lime', 'light'],
    make: streakLook,
  },
  prize: {
    name: 'Prize pool',
    about: 'Title, a prize that counts up, games list, three features and COMING SOON',
    group: 'Events',
    fields: [
      { key: 'tag', label: 'Title line 1', kind: 'text', placeholder: 'THE ARENA' },
      { key: 'headline', label: 'Title line 2 (colour)', kind: 'text', placeholder: 'AWAITS' },
      { key: 'sub', label: 'Small label', kind: 'text', placeholder: 'PRIZE POOL' },
      { key: 'when', label: 'Amount', kind: 'text', placeholder: '200,000' },
      { key: 'cta', label: 'Currency tag', kind: 'text', placeholder: 'GHC' },
      { key: 'lines', label: 'Games', kind: 'textarea', placeholder: 'FC 26 · eFootball · Tekken 8' },
      { key: 'rows', label: 'Three features', kind: 'rows', hint: 'One per line, up to 3' },
      { key: 'source', label: 'Big bottom words', kind: 'text', placeholder: 'COMING SOON' },
      { key: 'soon2', label: 'Last line', kind: 'text', placeholder: 'STAY TUNED. STAY READY.' },
    ],
    variants: ['gold', 'lime', 'magenta', 'purple'],
    make: prizeLook,
  },
  animated: {
    name: 'Players reveal',
    about: 'Photo with a two-colour heading, a question and a call to comment',
    group: 'Community',
    fields: [
      { key: 'imageUrl', label: 'Picture (e.g. your 2D/3D cartoon)', kind: 'image' },
      { key: 'headline', label: 'Heading line 1', kind: 'text', placeholder: 'ZMG PLAYERS,' },
      { key: 'sub', label: 'Heading line 2 (colour)', kind: 'text', placeholder: 'BUT ANIMATED.' },
      { key: 'when', label: 'Question', kind: 'text', placeholder: 'CAN YOU IDENTIFY THEM?' },
      { key: 'cta', label: 'Small line', kind: 'text', placeholder: 'Drop your guesses in the comments.' },
    ],
    variants: ['gold', 'lime', 'pink', 'white'],
    make: animatedLook,
  },
  players: {
    name: 'Players pill',
    about: 'Photo, a colour label, a huge word and a corner badge',
    group: 'Players',
    fields: [
      { key: 'imageUrl', label: 'Picture', kind: 'image' },
      { key: 'tag', label: 'Label', kind: 'text', placeholder: 'ZMG' },
      { key: 'headline', label: 'Huge word', kind: 'text', placeholder: 'PLAYERS' },
      { key: 'sub', label: 'Corner badge', kind: 'text', placeholder: 'GTA VI' },
    ],
    variants: ['orange', 'lime', 'blue', 'pink'],
    make: playersLook,
  },
  fest: {
    name: 'Festival poster',
    about: 'Chunky outlined title, ribbon, date and venue, people on the side',
    group: 'Events',
    fields: [
      { key: 'tag', label: 'Presenter line', kind: 'text', placeholder: 'ZMG AT KNUST CAMPUS' },
      { key: 'headline', label: 'Title', kind: 'textarea', placeholder: 'GAME FEST 2026' },
      { key: 'sub', label: 'Ribbon', kind: 'text', placeholder: 'SRC CELEBRATION WEEK' },
      { key: 'when', label: 'Date', kind: 'text', placeholder: '14 JULY' },
      { key: 'cta', label: 'Venue', kind: 'text', placeholder: 'Great Hall, KNUST' },
      PLAYER_PIC,
    ],
    variants: ['fest', 'navy', 'green', 'purple'],
    make: festLook,
  },
};

// ───────── 3D character looks + prompt maker ─────────

export interface Ai3dStyle {
  key: string;
  label: string;
  about: string;
  /** Builds the prompt to paste into ChatGPT / Gemini with the photo attached. */
  prompt: (o: Record<string, any>, format: FormatKey, opt?: PromptOptions) => string;
}
export interface PromptOptions {
  /** Ask for a see-through (cut-out) background. */
  cutout?: boolean;
}

const ASPECT: Record<FormatKey, string> = {
  post: 'portrait 4:5 (1080 × 1350 pixels)',
  square: 'square 1:1 (1080 × 1080 pixels)',
  story: 'tall 9:16 (1080 × 1920 pixels)',
};

const SAME_EYES =
  'EYES — keep them exactly the same as in the photo: the same eye shape, size, spacing, eyelids, eye colour and the direction they look. Do NOT enlarge, round off or "cartoonise" the eyes, and do not change the eyebrows.';
function keepLikeness(o: Record<string, any>) {
  const who = o.headline ? `The character is ${o.headline}. ` : '';
  return [
    `${who}Use the attached photo as the exact reference. This is a style conversion of a real person, not a new character: the result must be instantly recognisable as the same person.`,
    'Keep the same face shape, jaw, nose, lips, skin tone, hairline and hairstyle, facial hair, glasses (if any), age and body build.',
    SAME_EYES,
    'If there are several people in the photo, convert every one of them and keep each person\'s own face and position.',
  ].join(' ');
}
function extras(o: Record<string, any>) {
  const out: string[] = [];
  out.push(`Outfit: ${o.outfit || 'keep the clothes from the photo'}.`);
  out.push(`Scene: ${o.scene || 'a cosy gaming room with a big TV, a PS5 and purple-pink LED strip lights'}.`);
  if (o.pose) out.push(`Pose / action: ${o.pose}.`);
  out.push(`Expression: ${o.mood || 'keep the expression from the photo'}.`);
  return out.join(' ');
}
const CUTOUT =
  'BACKGROUND: remove the background completely. Output a PNG with a transparent background containing only the character(s), cut out cleanly with sharp edges around the hair and fingers — no floor, no shadow, no frame, no text. If a transparent background is not possible, use one flat pure white (#FFFFFF) background with nothing else on it.';
const withCut = (parts: string[], opt?: PromptOptions) => (opt?.cutout ? [...parts.filter((x) => !x.startsWith('Scene:')), CUTOUT] : parts);

export const AI3D_STYLES: Ai3dStyle[] = [
  {
    key: 'design',
    label: 'Make my design 3D',
    about: 'Attach a finished design — only the people become 3D; text, logos, colours and layout stay the same',
    prompt: (o, _fmt, opt) =>
      [
        'Edit the attached image. Convert ONLY the people in it into high-quality 3D animated characters (modern Pixar / Disney 3D film style: detailed 3D render, soft studio lighting, realistic skin and fabric textures).',
        'DO NOT change anything else. Keep the design exactly as it is: the same background, layout, colours, text, spelling, fonts, logos, shapes and the exact size and position of every element. Do not add, remove, move or redraw any text or graphics. Keep the same image size and aspect ratio.',
        'Each person must keep the same pose, position, size in the frame, clothes (same colours and logos), hands and anything they are holding.',
        'Keep every person instantly recognisable: the same face shape, skin tone, hairstyle, facial hair, glasses (if any) and age.',
        SAME_EYES,
        o.extra ? `Also: ${o.extra}.` : '',
        opt?.cutout ? 'Then return ONLY the converted people as a transparent PNG cut-out (no background).' : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
  },
  {
    key: 'pixar',
    label: '3D cartoon',
    about: 'Pixar-style 3D animated character (like the comic posts)',
    prompt: (o, fmt, opt) =>
      withCut(
        [
          'Turn the person in the attached photo into a high-quality 3D animated character in the style of a modern Pixar / Disney animated film.',
          keepLikeness(o),
          extras(o),
          'Style: soft rounded 3D shapes, detailed skin and fabric textures, cinematic lighting with a soft purple and pink glow, ultra-detailed 3D render. Keep the real proportions of the face — only the rendering style changes.',
          ...(opt?.cutout
            ? []
            : [
                o.sub ? `Add a white comic speech bubble with a black outline that says exactly: "${o.sub}".` : 'Do not add any text, letters or logos.',
                o.tag ? `Add a yellow comic caption box with a black outline in the top-left corner that says exactly: "${String(o.tag).toUpperCase()}".` : '',
              ]),
          `Image size: ${ASPECT[fmt]}.`,
        ].filter(Boolean),
        opt,
      ).join('\n\n'),
  },
  {
    key: 'game',
    label: 'Game cover',
    about: 'Semi-realistic video-game loading-screen artwork',
    prompt: (o, fmt, opt) =>
      withCut(
        [
          'Turn the person in the attached photo into semi-realistic, painted video-game loading-screen artwork, like the character art of a big open-world crime game.',
          keepLikeness(o),
          extras({ scene: 'a gritty city street at night with police lights, neon signs and wet ground', mood: 'serious and determined', ...o }),
          'Style: dramatic cinematic lighting, rich colours, sharp detail, slight painterly finish, the character in the foreground from the knees up.',
          'Leave clean empty space at the bottom-left for a big name title. Do not write any text, letters or logos.',
          `Image size: ${ASPECT[fmt]}.`,
        ],
        opt,
      ).join('\n\n'),
  },
  {
    key: 'cartoon',
    label: '2D cartoon',
    about: 'Bold 2D cartoon illustration with thick outlines',
    prompt: (o, fmt, opt) =>
      withCut(
        [
          'Turn the person in the attached photo into a bold 2D cartoon illustration.',
          keepLikeness(o),
          extras({ scene: 'a plain warm grey studio background', ...o }),
          'Style: thick clean black outlines, flat cel shading, vibrant colours, like a modern animated TV show. Keep the real proportions of the face.',
          'Leave the bottom third of the image calm and darker for a heading. Do not write any text, letters or logos.',
          `Image size: ${ASPECT[fmt]}.`,
        ],
        opt,
      ).join('\n\n'),
  },
  {
    key: 'figure',
    label: 'Collectible figure',
    about: 'A 3D action figure on a desk with its toy box',
    prompt: (o, fmt) =>
      [
        'Create a photorealistic picture of a 1/7 scale collectible 3D figure of the person in the attached photo.',
        keepLikeness(o),
        `Outfit: ${o.outfit || 'the same clothes as in the photo'}.${o.pose ? ` Pose: ${o.pose}.` : ''}`,
        `The figure stands on a round clear acrylic base on a gaming desk with a PS5 controller next to it. Behind it is a printed toy box with the same character artwork${o.headline ? ` and the name "${o.headline}"` : ''} on the front. On the monitor in the background, the 3D modelling of the figure is shown.`,
        'Style: realistic studio lighting, sharp focus, high detail, glossy plastic and paint finish.',
        `Image size: ${ASPECT[fmt]}.`,
      ].join('\n\n'),
  },
  {
    key: 'cutout',
    label: 'Remove background',
    about: 'Cut the player out of the photo (no background) — the best kind of picture for every look',
    prompt: () =>
      [
        'Remove the background from the attached photo.',
        'Keep ONLY the person (or people) exactly as they are — do not redraw, retouch, beautify or change the face, eyes, skin, hair, clothes or pose in any way. Same pixels, just without the background.',
        CUTOUT,
        'Keep the original resolution and framing.',
      ].join('\n\n'),
  },
];

const AI3D_FIELDS: FieldDef[] = [
  { key: 'imageUrl', label: 'Player photo — then swap in the 3D picture you get back', kind: 'image' },
  { key: 'headline', label: 'Name', kind: 'text' },
  { key: 'outfit', label: 'Outfit (for the prompt)', kind: 'text', placeholder: 'ZMG jersey in navy and lime' },
  { key: 'scene', label: 'Scene / place (for the prompt)', kind: 'text', placeholder: 'gaming room with purple LED lights' },
  { key: 'pose', label: 'Pose / action (for the prompt)', kind: 'text', placeholder: 'holding a PS5 controller, leaning forward' },
  { key: 'mood', label: 'Expression (for the prompt)', kind: 'text', placeholder: 'shocked, sweating' },
  { key: 'sub', label: 'Speech bubble', kind: 'text', placeholder: 'Not today…' },
  { key: 'tag', label: 'Caption box', kind: 'text', placeholder: '10 SECONDS LATER…' },
];

const AI_DESIGN_FIELDS: FieldDef[] = [
  { key: 'imageUrl', label: 'Your finished design (with the players in it) — then swap in the 3D version you get back', kind: 'image' },
  { key: 'extra', label: 'Anything else for the AI (optional)', kind: 'text', placeholder: 'make the lighting a bit brighter' },
];
const AI_CUT_FIELDS: FieldDef[] = [
  { key: 'imageUrl', label: 'Player photo — or use "Remove background" under it', kind: 'image' },
  { key: 'headline', label: 'Name', kind: 'text' },
  { key: 'sub', label: 'Line under the name', kind: 'text', placeholder: 'Striker · ZMG Elite' },
];
/** Shows the uploaded design as it is (cover-fitted) so it can be posted straight away. */
const designLook: Draw = (c, W, H, f, a, b, t) => {
  const im = a.photos.imageUrl;
  c.fillStyle = b.dark;
  c.fillRect(0, 0, W, H);
  if (!im) {
    ground3(c, a, pal3('navy', b), W, H, t);
    say(c, 'Add your design', W / 2, H / 2 - 40, `80px ${DISPLAY}`, '#ffffff', 'center');
    say(c, 'Upload the finished picture above', W / 2, H / 2 + 60, `30px ${BODY}`, b.pop, 'center');
    return;
  }
  const sc = Math.min(W / im.width, H / im.height);
  const bw = im.width * Math.max(W / im.width, H / im.height);
  const bh = im.height * Math.max(W / im.width, H / im.height);
  c.save();
  c.filter = 'blur(30px) brightness(0.6)';
  c.drawImage(im, (W - bw) / 2, (H - bh) / 2, bw, bh);
  c.restore();
  c.drawImage(im, (W - im.width * sc) / 2, (H - im.height * sc) / 2, im.width * sc, im.height * sc);
};
const cutoutLook: Draw = (c, W, H, f, a, b, t) => {
  const p = pal3('navy', b, true);
  ground3(c, a, p, W, H, t);
  logo(c, logoFor(p, a), W / 2, 110, 150, t, 0.1);
  figure(c, a.photos.imageUrl, p, 40, 200, W - 80, H - 200, t, 0.2);
  darkBottom(c, W, H, 0.6, 0.85, p.bg);
  const nm = String(f.headline || 'PLAYER').toUpperCase();
  const nf = fit(c, nm, DISPLAY, W - 120, 200, 190, 60, 1);
  say(c, nm, W / 2, H - 150, `${nf.size}px ${DISPLAY}`, '#ffffff', 'center', fade(t, 0.8), 0, 'alphabetic');
  if (f.sub) spaced(c, f.sub, W / 2, H - 110, 26, p.hi, t, 1.1, 'center', W - 120);
  cornerHandle(c, b, W, H, '#ffffff', t);
};

const figureBoxLook: Draw = (c, W, H, f, a, b, t) => {
  const p = pal3('navy', b);
  ground3(c, a, p, W, H, t);
  const bx = W * 0.12;
  const bw = W * 0.76;
  const by = 170;
  const bh = H - 330;
  const q = fade(t, 0.1, 0.8);
  c.save();
  c.globalAlpha = q;
  roundRect(c, bx, by, bw, bh, 30);
  c.fillStyle = b.pop;
  c.fill();
  roundRect(c, bx + 30, by + 120, bw - 60, bh - 150, 22);
  c.fillStyle = 'rgba(255,255,255,0.25)';
  c.fill();
  c.strokeStyle = '#ffffff';
  c.lineWidth = 6;
  c.stroke();
  c.restore();
  say(c, b.centre.toUpperCase(), W / 2, by + 30, `56px ${DISPLAY}`, b.dark, 'center', q);
  spaced(c, 'collector edition', W / 2, by + 92, 20, b.dark, t, 0.3);
  c.save();
  roundRect(c, bx + 30, by + 120, bw - 60, bh - 150, 22);
  c.clip();
  photoOrPattern(c, a.photos.imageUrl, b, bx + 30, by + 120, bw - 60, bh - 150, slowZoom(t));
  c.restore();
  metalName(c, f.headline || 'PLAYER', W / 2, H - 50, W - 100, 130, 120, t, 0.8, 'center');
};

const grade = typeof document !== 'undefined' ? document.createElement('canvas') : null;
/** Makes a look more intense: punchier colour, a moving light sweep, vignette and fine grain. */
function finish(draw: Draw): Draw {
  return (c, W, H, f, a, b, t) => {
    draw(c, W, H, f, a, b, t);
    c.save();
    if (grade) {
      if (grade.width !== W || grade.height !== H) {
        grade.width = W;
        grade.height = H;
      }
      const g = grade.getContext('2d')!;
      g.clearRect(0, 0, W, H);
      g.drawImage(c.canvas, 0, 0);
      // Soft-light the frame onto itself: richer colour and contrast, fast enough for every video frame.
      c.globalAlpha = 0.32;
      c.globalCompositeOperation = 'soft-light';
      c.drawImage(grade, 0, 0);
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = 1;
    }
    // light sweep from the top corner
    const lx = W * (0.15 + 0.1 * Math.sin(Math.min(t, 6) * 0.6));
    const lg = c.createRadialGradient(lx, -H * 0.05, 0, lx, -H * 0.05, H * 0.75);
    lg.addColorStop(0, 'rgba(255,255,255,0.16)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    c.globalCompositeOperation = 'soft-light';
    c.fillStyle = lg;
    c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = 'source-over';
    // vignette
    const vg = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.hypot(W, H) * 0.62);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.38)');
    c.fillStyle = vg;
    c.fillRect(0, 0, W, H);
    // fine grain
    const pt = c.createPattern(tile('grain', 'rgba(255,255,255,0.05)'), 'repeat');
    if (pt) {
      c.fillStyle = pt;
      c.fillRect(0, 0, W, H);
    }
    c.restore();
  };
}

const AI3D_DRAW: Record<string, Draw> = {
  pixar: (c, W, H, f, a, b, t) => comicLook('warm')(c, W, H, { imageUrl: f.imageUrl, tag: f.tag, headline: f.sub, sub: '', when: f.headline }, a, b, t),
  game: (c, W, H, f, a, b, t) => characterLook('sunset')(c, W, H, { imageUrl: f.imageUrl, headline: f.headline || 'PLAYER', tag: '', sub: f.sub }, a, b, t),
  cartoon: (c, W, H, f, a, b, t) =>
    animatedLook('gold')(c, W, H, { imageUrl: f.imageUrl, headline: f.headline ? `${f.headline},` : `${b.centre} PLAYERS,`, sub: 'BUT ANIMATED.', when: f.sub || 'CAN YOU IDENTIFY THEM?', cta: f.tag || 'Drop your guesses in the comments.' }, a, b, t),
  figure: figureBoxLook,
  design: designLook,
  cutout: cutoutLook,
};

const PACK_TEMPLATES: Record<string, TemplateInfo> = {};
const PACK_DRAW: Record<string, Draw> = {};
for (const s of AI3D_STYLES) {
  const fields = s.key === 'design' ? AI_DESIGN_FIELDS : s.key === 'cutout' ? AI_CUT_FIELDS : AI3D_FIELDS;
  const label = s.key === 'design' || s.key === 'cutout' ? `AI · ${s.label}` : `3D · ${s.label}`;
  PACK_TEMPLATES[`ai-${s.key}`] = { label, about: `${s.about} — gives you a prompt for ChatGPT / Gemini`, group: '3D & AI', fields };
  PACK_DRAW[`ai-${s.key}`] = s.key === 'design' ? designLook : finish(AI3D_DRAW[s.key]);
}
PACK_TEMPLATES.custom = {
  label: 'Your own design',
  about: 'A finished picture (from Blank canvas or anywhere else), posted as it is',
  group: 'My designs',
  fields: [{ key: 'imageUrl', label: 'Your design', kind: 'image' }],
};
PACK_DRAW.custom = designLook;
for (const [fam, F] of Object.entries(PACK)) {
  for (const k of F.variants) {
    PACK_TEMPLATES[`${fam}-${k}`] = { label: `${F.name} · ${PK_NAME[k]}`, about: F.about, group: F.group, fields: F.fields };
    PACK_DRAW[`${fam}-${k}`] = finish(F.make(k));
  }
}

export const TEMPLATES: Record<string, TemplateInfo> = { ...BASE_TEMPLATES, ...MORE_TEMPLATES, ...PACK_TEMPLATES };
export const TEMPLATE_GROUPS = ['My designs', '3D & AI', 'News', 'Events', 'Matches & players', 'Players', 'Results & tables', 'Memes & comics', 'Celebrations', 'Moments', 'Community'];
const DRAW: Record<string, Draw> = { ...BASE_DRAW, ...MORE_DRAW, ...PACK_DRAW };
