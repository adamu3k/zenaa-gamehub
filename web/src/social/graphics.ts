/**
 * Social graphics: branded posts drawn on a canvas from the ZMG brand files in /brand (logos, blue texture),
 * the venue's colours (Social → Accounts & settings) and news pictures. Every template can be animated
 * (6 seconds) and recorded to a video in the browser.
 */
import '@fontsource/anton/400.css';
import '@fontsource/archivo-black/400.css';
import { getToken } from '../lib/api';

export type TemplateKey = 'news' | 'breaking' | 'quote' | 'versus' | 'leaderboard' | 'promo' | 'winner';
export type FormatKey = 'post' | 'square' | 'story';
export const FORMATS: Record<FormatKey, { label: string; w: number; h: number; hint: string }> = {
  post: { label: 'Post 4:5', w: 1080, h: 1350, hint: 'Instagram & Facebook feed' },
  square: { label: 'Square 1:1', w: 1080, h: 1080, hint: 'Any feed, WhatsApp' },
  story: { label: 'Story / Reel 9:16', w: 1080, h: 1920, hint: 'Stories, Reels, TikTok, Shorts, Status' },
};

export type FieldDef = { key: string; label: string; kind: 'text' | 'textarea' | 'image' | 'rows'; hint?: string; placeholder?: string };
export const TEMPLATES: Record<TemplateKey, { label: string; about: string; fields: FieldDef[] }> = {
  news: {
    label: 'News',
    about: 'Big picture on top, headline below',
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
    fields: [
      { key: 'tag', label: 'Label', kind: 'text', placeholder: 'COMMUNITY VOICES' },
      { key: 'headline', label: 'Quote or question', kind: 'textarea' },
      { key: 'sub', label: 'Who said it', kind: 'text', placeholder: '@player or ZMG' },
    ],
  },
  versus: {
    label: 'Next match',
    about: 'Player vs player with photos',
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
    fields: [
      { key: 'headline', label: 'Title', kind: 'text', placeholder: 'LEADERBOARD' },
      { key: 'sub', label: 'Game / period', kind: 'text', placeholder: 'EA FC 26 · This month' },
      { key: 'rows', label: 'Players', kind: 'rows', hint: 'One per line: name, points' },
    ],
  },
  promo: {
    label: 'Promo / event',
    about: 'Happy hour, tournaments, merch, opening hours',
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
  for (const f of TEMPLATES[spec.template].fields) if (f.kind === 'image') photos[f.key] = await loadPhoto(spec.fields[f.key]);
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

const DRAW: Record<TemplateKey, Draw> = { news, breaking, quote, versus, leaderboard, promo, winner };

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
    return cv.toDataURL('image/jpeg', 0.86);
  } finally {
    imgCache.delete(url);
    URL.revokeObjectURL(url);
  }
}
