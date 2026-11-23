import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Circle,
  Copy,
  Download,
  Eraser,
  Eye,
  EyeOff,
  FolderOpen,
  ImagePlus,
  Lock,
  Redo2,
  Save,
  Send,
  Square,
  Trash2,
  Type,
  Undo2,
  Unlock,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../lib/app-context';
import { type Brand, type FormatKey, FORMATS, loadFonts, postableDataUrl, removeBackground, shrinkPhoto } from './graphics';

// ───────── Document model ─────────

type Kind = 'text' | 'rect' | 'ellipse' | 'image';
export interface Layer {
  id: string;
  kind: Kind;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  opacity: number;
  hidden?: boolean;
  locked?: boolean;
  // shapes
  fill: string;
  fill2?: string;
  stroke: string;
  strokeW: number;
  radius: number;
  shadow: number;
  glow?: string;
  // text
  text?: string;
  font?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  upper?: boolean;
  align?: CanvasTextAlign;
  spacing?: number;
  lineH?: number;
  // image
  src?: string;
  flipX?: boolean;
  bright?: number;
  contrast?: number;
  sat?: number;
}
interface Doc {
  format: FormatKey;
  bg: string;
  bg2: string;
  bgImage?: string;
  layers: Layer[];
}

const FONTS = [
  { label: 'Anton (poster)', value: 'Anton, Impact, sans-serif' },
  { label: 'Archivo Black (heavy)', value: "'Archivo Black', 'Arial Black', sans-serif" },
  { label: 'Segoe UI (clean)', value: "'Segoe UI', Roboto, Arial, sans-serif" },
  { label: 'Impact', value: 'Impact, sans-serif' },
  { label: 'Georgia (serif)', value: 'Georgia, serif' },
  { label: 'Courier (typewriter)', value: "'Courier New', monospace" },
  { label: 'Comic', value: "'Comic Sans MS', 'Comic Neue', cursive" },
];
const STORE = 'zmg.studio.v1';
const uid = () => Math.random().toString(36).slice(2, 10);

function blankDoc(b: Brand, format: FormatKey = 'post'): Doc {
  return { format, bg: b.dark, bg2: b.main, layers: [] };
}

// ───────── Drawing ─────────

const imgs = new Map<string, HTMLImageElement>();
function img(src: string, onLoad: () => void) {
  let im = imgs.get(src);
  if (!im) {
    im = new Image();
    im.onload = onLoad;
    im.src = src;
    imgs.set(src, im);
  }
  return im.complete && im.naturalWidth ? im : null;
}

const measure = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d')! : (null as unknown as CanvasRenderingContext2D);
function fontOf(l: Layer) {
  return `${l.italic ? 'italic ' : ''}${l.bold ? '700 ' : ''}${l.size}px ${l.font}`;
}
function textLines(l: Layer) {
  const c = measure;
  c.font = fontOf(l);
  (c as any).letterSpacing = `${l.spacing ?? 0}px`;
  const raw = l.upper ? String(l.text ?? '').toUpperCase() : String(l.text ?? '');
  const out: string[] = [];
  for (const para of raw.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const tryL = line ? `${line} ${word}` : word;
      if (line && c.measureText(tryL).width > l.w) {
        out.push(line);
        line = word;
      } else line = tryL;
    }
    out.push(line);
  }
  (c as any).letterSpacing = '0px';
  return out;
}
/** Text boxes grow to fit their lines. */
function fitText(l: Layer): Layer {
  if (l.kind !== 'text') return l;
  const h = Math.max(1, textLines(l).length) * (l.size ?? 60) * (l.lineH ?? 1.1);
  return h === l.h ? l : { ...l, h };
}

function drawLayer(c: CanvasRenderingContext2D, l: Layer, redraw: () => void) {
  if (l.hidden) return;
  c.save();
  c.globalAlpha = l.opacity;
  c.translate(l.x + l.w / 2, l.y + l.h / 2);
  c.rotate((l.rot * Math.PI) / 180);
  const x = -l.w / 2;
  const y = -l.h / 2;
  if (l.shadow) {
    c.shadowColor = l.glow || 'rgba(0,0,0,0.55)';
    c.shadowBlur = l.shadow;
    c.shadowOffsetY = l.glow ? 0 : l.shadow / 3;
  }
  const paint = () => {
    if (l.fill2 && l.fill2 !== l.fill) {
      const g = c.createLinearGradient(0, y, 0, y + l.h);
      g.addColorStop(0, l.fill);
      g.addColorStop(1, l.fill2);
      return g;
    }
    return l.fill;
  };
  if (l.kind === 'rect' || l.kind === 'ellipse') {
    c.beginPath();
    if (l.kind === 'rect') c.roundRect(x, y, l.w, l.h, Math.min(l.radius, l.w / 2, l.h / 2));
    else c.ellipse(0, 0, l.w / 2, l.h / 2, 0, 0, Math.PI * 2);
    if (l.fill !== 'transparent') {
      c.fillStyle = paint();
      c.fill();
    }
    c.shadowColor = 'transparent';
    if (l.strokeW) {
      c.strokeStyle = l.stroke;
      c.lineWidth = l.strokeW;
      c.stroke();
    }
  } else if (l.kind === 'image' && l.src) {
    const im = img(l.src, redraw);
    if (im) {
      if (l.radius) {
        c.save();
        c.beginPath();
        c.roundRect(x, y, l.w, l.h, Math.min(l.radius, l.w / 2, l.h / 2));
        c.shadowColor = 'transparent';
        c.clip();
      }
      if (l.flipX) c.scale(-1, 1);
      c.filter = `brightness(${l.bright ?? 1}) contrast(${l.contrast ?? 1}) saturate(${l.sat ?? 1})`;
      c.drawImage(im, x, y, l.w, l.h);
      c.filter = 'none';
      if (l.radius) c.restore();
      if (l.strokeW) {
        c.shadowColor = 'transparent';
        c.beginPath();
        c.roundRect(x, y, l.w, l.h, Math.min(l.radius, l.w / 2, l.h / 2));
        c.strokeStyle = l.stroke;
        c.lineWidth = l.strokeW;
        c.stroke();
      }
    }
  } else if (l.kind === 'text') {
    const lines = textLines(l);
    const lh = (l.size ?? 60) * (l.lineH ?? 1.1);
    c.font = fontOf(l);
    (c as any).letterSpacing = `${l.spacing ?? 0}px`;
    c.textBaseline = 'middle';
    c.textAlign = l.align ?? 'left';
    const tx = l.align === 'center' ? 0 : l.align === 'right' ? l.w / 2 : x;
    lines.forEach((s, i) => {
      const ty = y + lh * i + lh / 2;
      if (l.strokeW) {
        c.save();
        c.lineJoin = 'round';
        c.strokeStyle = l.stroke;
        c.lineWidth = l.strokeW * 2;
        c.strokeText(s, tx, ty);
        c.restore();
        c.shadowColor = 'transparent';
      }
      c.fillStyle = l.fill2 && l.fill2 !== l.fill ? paint() : l.fill;
      c.fillText(s, tx, ty);
    });
  }
  c.restore();
}

function drawDoc(c: CanvasRenderingContext2D, d: Doc, redraw: () => void) {
  const { w, h } = FORMATS[d.format];
  c.clearRect(0, 0, w, h);
  const g = c.createLinearGradient(0, 0, w * 0.3, h);
  g.addColorStop(0, d.bg);
  g.addColorStop(1, d.bg2 || d.bg);
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
  if (d.bgImage) {
    const im = img(d.bgImage, redraw);
    if (im) {
      const s = Math.max(w / im.width, h / im.height);
      c.drawImage(im, (w - im.width * s) / 2, (h - im.height * s) / 2, im.width * s, im.height * s);
    }
  }
  for (const l of d.layers) drawLayer(c, l, redraw);
}

// ───────── Geometry ─────────

type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'e' | 'w' | 'rot';
const rotate = (x: number, y: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) };
};
function toLocal(l: Layer, px: number, py: number) {
  return rotate(px - (l.x + l.w / 2), py - (l.y + l.h / 2), -l.rot);
}
function handlesOf(l: Layer, hs: number) {
  const out: [Handle, number, number][] = [
    ['nw', -l.w / 2, -l.h / 2],
    ['ne', l.w / 2, -l.h / 2],
    ['sw', -l.w / 2, l.h / 2],
    ['se', l.w / 2, l.h / 2],
    ['rot', 0, -l.h / 2 - hs * 4],
  ];
  if (l.kind === 'text' || l.kind === 'rect') out.push(['e', l.w / 2, 0], ['w', -l.w / 2, 0]);
  return out;
}

interface Drag {
  mode: 'move' | Handle;
  id: string;
  sx: number;
  sy: number;
  start: Layer;
}

// ───────── Component ─────────

export function Studio({ brand, onClose, onUse }: { brand: Brand; onClose(): void; onUse(dataUrl: string, format: FormatKey): void }) {
  const { toast } = useApp();
  const [doc, setDocRaw] = useState<Doc>(() => {
    try {
      const s = localStorage.getItem(STORE);
      if (s) return JSON.parse(s) as Doc;
    } catch {
      /* fresh */
    }
    return blankDoc(brand);
  });
  const [sel, setSel] = useState<string | null>(null);
  const [guides, setGuides] = useState<{ v: boolean; h: boolean }>({ v: false, h: false });
  const [, setTick] = useState(0);
  const redraw = useCallback(() => setTick((n) => n + 1), []);
  const past = useRef<Doc[]>([]);
  const future = useRef<Doc[]>([]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const bgFile = useRef<HTMLInputElement>(null);
  const projFile = useRef<HTMLInputElement>(null);
  const { w: W, h: H } = FORMATS[doc.format];

  useEffect(() => {
    loadFonts()?.then(redraw);
  }, [redraw]);

  /** Change the design (and remember it for Undo). */
  const setDoc = useCallback((fn: (d: Doc) => Doc, history = true) => {
    setDocRaw((d) => {
      const n = fn(d);
      if (history && n !== d) {
        past.current.push(d);
        if (past.current.length > 80) past.current.shift();
        future.current = [];
      }
      return n;
    });
  }, []);
  const undo = () => {
    const p = past.current.pop();
    if (!p) return;
    future.current.push(doc);
    setDocRaw(p);
  };
  const redo = () => {
    const n = future.current.pop();
    if (!n) return;
    past.current.push(doc);
    setDocRaw(n);
  };

  // Keep a copy in this browser so the work is still there next time.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORE, JSON.stringify(doc));
      } catch {
        /* too big for browser storage — "Save project" still works */
      }
    }, 600);
    return () => clearTimeout(t);
  }, [doc]);

  const layer = doc.layers.find((l) => l.id === sel) ?? null;
  const update = (id: string, patch: Partial<Layer>, history = true) =>
    setDoc((d) => ({ ...d, layers: d.layers.map((l) => (l.id === id ? fitText({ ...l, ...patch }) : l)) }), history);
  const add = (l: Omit<Layer, 'id'>) => {
    const n = fitText({ ...l, id: uid() });
    setDoc((d) => ({ ...d, layers: [...d.layers, n] }));
    setSel(n.id);
  };
  const remove = (id: string) => {
    setDoc((d) => ({ ...d, layers: d.layers.filter((l) => l.id !== id) }));
    setSel(null);
  };
  const duplicate = (id: string) => {
    const l = doc.layers.find((x) => x.id === id);
    if (!l) return;
    const n = { ...l, id: uid(), x: l.x + 30, y: l.y + 30, name: `${l.name} copy` };
    setDoc((d) => ({ ...d, layers: [...d.layers, n] }));
    setSel(n.id);
  };
  const move = (id: string, dir: 1 | -1) =>
    setDoc((d) => {
      const i = d.layers.findIndex((l) => l.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.layers.length) return d;
      const ls = [...d.layers];
      [ls[i], ls[j]] = [ls[j], ls[i]];
      return { ...d, layers: ls };
    });

  const base = { rot: 0, opacity: 1, stroke: '#000000', strokeW: 0, radius: 0, shadow: 0 };
  const addText = (heading: boolean) =>
    add({
      ...base,
      kind: 'text',
      name: heading ? 'Heading' : 'Text',
      text: heading ? 'BIG HEADING' : 'Your text here',
      font: heading ? FONTS[0].value : FONTS[2].value,
      size: heading ? 150 : 48,
      bold: !heading,
      upper: heading,
      align: 'center',
      lineH: heading ? 1.0 : 1.25,
      spacing: 0,
      fill: heading ? '#ffffff' : brand.pop,
      x: 90,
      y: H * (heading ? 0.12 : 0.45),
      w: W - 180,
      h: 100,
    });
  const addShape = (kind: 'rect' | 'ellipse') =>
    add({ ...base, kind, name: kind === 'rect' ? 'Box' : 'Circle', fill: brand.pop, x: W / 2 - 200, y: H / 2 - 200, w: 400, h: kind === 'rect' ? 160 : 400, radius: kind === 'rect' ? 20 : 0 });
  const addImage = (src: string, name = 'Picture', frac = 0.8) => {
    const im = new Image();
    im.onload = () => {
      const s = Math.min((W * frac) / im.width, (H * frac * 0.9) / im.height, 1.5);
      const w = im.width * s;
      const h = im.height * s;
      imgs.set(src, im);
      add({ ...base, kind: 'image', name, src, fill: 'transparent', x: (W - w) / 2, y: (H - h) / 2, w, h, bright: 1, contrast: 1, sat: 1 });
    };
    im.onerror = () => toast('error', 'Could not open that picture');
    im.src = src;
  };
  const upload = async (f: File | undefined) => {
    if (!f) return;
    try {
      addImage(await shrinkPhoto(f, 1600), f.name.replace(/\.[^.]+$/, '').slice(0, 30) || 'Picture');
    } catch (e: any) {
      toast('error', e.message);
    }
  };

  // ── Draw on screen (with the selection box) ──
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    if (cv.width !== W) cv.width = W;
    if (cv.height !== H) cv.height = H;
    const c = cv.getContext('2d')!;
    drawDoc(c, doc, redraw);
    const k = W / Math.max(1, cv.getBoundingClientRect().width || W);
    if (guides.v || guides.h) {
      c.save();
      c.strokeStyle = '#ff2bd6';
      c.lineWidth = 2 * k;
      c.setLineDash([10 * k, 8 * k]);
      c.beginPath();
      if (guides.v) {
        c.moveTo(W / 2, 0);
        c.lineTo(W / 2, H);
      }
      if (guides.h) {
        c.moveTo(0, H / 2);
        c.lineTo(W, H / 2);
      }
      c.stroke();
      c.restore();
    }
    if (layer && !layer.hidden) {
      c.save();
      c.translate(layer.x + layer.w / 2, layer.y + layer.h / 2);
      c.rotate((layer.rot * Math.PI) / 180);
      c.strokeStyle = '#2bb3ff';
      c.lineWidth = 2 * k;
      c.strokeRect(-layer.w / 2, -layer.h / 2, layer.w, layer.h);
      if (!layer.locked) {
        const hs = 7 * k;
        c.beginPath();
        c.moveTo(0, -layer.h / 2);
        c.lineTo(0, -layer.h / 2 - hs * 4);
        c.stroke();
        for (const [, hx, hy] of handlesOf(layer, hs)) {
          c.beginPath();
          c.arc(hx, hy, hs, 0, Math.PI * 2);
          c.fillStyle = '#ffffff';
          c.fill();
          c.stroke();
        }
      }
      c.restore();
    }
  });

  const point = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height, k: W / r.width };
  };
  const onDown = (e: React.PointerEvent) => {
    const p = point(e);
    const hs = 7 * p.k;
    if (layer && !layer.locked && !layer.hidden) {
      const lp = toLocal(layer, p.x, p.y);
      for (const [hname, hx, hy] of handlesOf(layer, hs)) {
        if (Math.hypot(lp.x - hx, lp.y - hy) < hs * 2) {
          drag.current = { mode: hname, id: layer.id, sx: p.x, sy: p.y, start: layer };
          canvas.current!.setPointerCapture(e.pointerId);
          past.current.push(doc);
          future.current = [];
          return;
        }
      }
    }
    for (let i = doc.layers.length - 1; i >= 0; i--) {
      const l = doc.layers[i];
      if (l.hidden) continue;
      const lp = toLocal(l, p.x, p.y);
      if (Math.abs(lp.x) <= l.w / 2 + 4 * p.k && Math.abs(lp.y) <= l.h / 2 + 4 * p.k) {
        setSel(l.id);
        if (!l.locked) {
          drag.current = { mode: 'move', id: l.id, sx: p.x, sy: p.y, start: l };
          canvas.current!.setPointerCapture(e.pointerId);
          past.current.push(doc);
          future.current = [];
        }
        return;
      }
    }
    setSel(null);
  };
  const onMove = (e: React.PointerEvent) => {
    const g = drag.current;
    if (!g) return;
    const p = point(e);
    const s = g.start;
    const dx = p.x - g.sx;
    const dy = p.y - g.sy;
    let patch: Partial<Layer> = {};
    if (g.mode === 'move') {
      let x = s.x + dx;
      let y = s.y + dy;
      const snap = 12 * p.k;
      const v = Math.abs(x + s.w / 2 - W / 2) < snap;
      const h = Math.abs(y + s.h / 2 - H / 2) < snap;
      if (v) x = W / 2 - s.w / 2;
      if (h) y = H / 2 - s.h / 2;
      if (v !== guides.v || h !== guides.h) setGuides({ v, h });
      patch = { x, y };
    } else if (g.mode === 'rot') {
      let a = (Math.atan2(p.y - (s.y + s.h / 2), p.x - (s.x + s.w / 2)) * 180) / Math.PI + 90;
      const snapTo = e.shiftKey ? 15 : 90;
      const near = Math.round(a / snapTo) * snapTo;
      if (e.shiftKey || Math.abs(a - near) < 4) a = near;
      patch = { rot: ((a % 360) + 360) % 360 };
    } else {
      const ld = rotate(dx, dy, -s.rot);
      const sx = g.mode.includes('e') ? 1 : g.mode.includes('w') ? -1 : 0;
      const sy = g.mode.includes('s') ? 1 : g.mode.includes('n') ? -1 : 0;
      let nw = Math.max(20, s.w + sx * ld.x);
      let nh = Math.max(20, s.h + sy * ld.y);
      const keep = (s.kind === 'image' || s.kind === 'text' || e.shiftKey) && sx && sy;
      if (keep) {
        const kx = nw / s.w;
        const ky = nh / s.h;
        const kk = Math.abs(kx - 1) > Math.abs(ky - 1) ? kx : ky;
        nw = s.w * kk;
        nh = s.h * kk;
      }
      if (!sy) nh = s.h;
      if (!sx) nw = s.w;
      if (s.kind === 'text') {
        if (sx && sy) patch.size = Math.max(8, Math.round((s.size ?? 60) * (nw / s.w)));
        nh = s.h;
      }
      // keep the opposite corner / side still
      const ax = (-(sx || 0) * s.w) / 2;
      const ay = (-(sy || 0) * s.h) / 2;
      const A = rotate(ax, ay, s.rot);
      const cx0 = s.x + s.w / 2 + A.x;
      const cy0 = s.y + s.h / 2 + A.y;
      const B = rotate((-(sx || 0) * nw) / 2, (-(sy || 0) * nh) / 2, s.rot);
      const ncx = cx0 - B.x;
      const ncy = cy0 - B.y;
      patch = { ...patch, w: nw, h: nh, x: ncx - nw / 2, y: ncy - nh / 2 };
    }
    setDocRaw((d) => ({ ...d, layers: d.layers.map((l) => (l.id === g.id ? fitText({ ...l, ...patch }) : l)) }));
  };
  const onUp = () => {
    drag.current = null;
    if (guides.v || guides.h) setGuides({ v: false, h: false });
  };

  // ── Keyboard: Delete, arrows, Ctrl+Z / Y / D ──
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (ctrl && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (sel && ctrl && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicate(sel);
      } else if (sel && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        remove(sel);
      } else if (sel && e.key.startsWith('Arrow') && layer && !layer.locked) {
        e.preventDefault();
        const n = e.shiftKey ? 10 : 1;
        update(sel, {
          x: layer.x + (e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0),
          y: layer.y + (e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0),
        });
      } else if (e.key === 'Escape') setSel(null);
    };
    const paste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
      if (f) {
        e.preventDefault();
        upload(f);
      }
    };
    window.addEventListener('keydown', key);
    window.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('paste', paste);
    };
  });

  // ── Output ──
  const render = () => {
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    drawDoc(cv.getContext('2d')!, doc, () => undefined);
    return cv;
  };
  const save = (blob: Blob | null, name: string) => {
    if (!blob) return toast('error', 'Could not make the file');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  const ready = () => [doc.bgImage, ...doc.layers.map((l) => l.src)].every((s) => !s || imgs.get(s)?.complete);
  const download = (type: 'png' | 'jpeg') => {
    if (!ready()) return toast('warning', 'Pictures are still loading — try again in a second');
    render().toBlob((b) => save(b, `zmg-design.${type === 'png' ? 'png' : 'jpg'}`), `image/${type}`, 0.93);
  };
  const saveProject = () => save(new Blob([JSON.stringify(doc)], { type: 'application/json' }), 'zmg-design.zmgdesign.json');
  const openProject = async (f: File | undefined) => {
    if (!f) return;
    try {
      const d = JSON.parse(await f.text()) as Doc;
      if (!d || !Array.isArray(d.layers) || !FORMATS[d.format]) throw new Error('bad');
      setDoc(() => d);
      setSel(null);
    } catch {
      toast('error', 'That is not a design file saved from here');
    }
  };
  const fresh = () => {
    if (doc.layers.length && !window.confirm('Start a new blank design? (Undo brings the old one back.)')) return;
    setDoc((d) => blankDoc(brand, d.format));
    setSel(null);
  };
  const swatches = [brand.dark, brand.main, brand.pop, brand.light, '#ffffff', '#000000', '#ff2bd6', '#ff3b30', '#ffb800', '#16c172', '#7c3aed', 'transparent'];

  return (
    <div className="studio">
      <div className="studio-bar card card-pad">
        <button className="btn btn-sm" onClick={onClose}>
          <ArrowLeft size={14} /> Back
        </button>
        <span className="studio-sep" />
        <button className="btn btn-sm" onClick={() => addText(true)} title="Big heading">
          <Type size={14} /> Heading
        </button>
        <button className="btn btn-sm" onClick={() => addText(false)}>
          <Type size={12} /> Text
        </button>
        <button className="btn btn-sm" onClick={() => addShape('rect')}>
          <Square size={14} /> Box
        </button>
        <button className="btn btn-sm" onClick={() => addShape('ellipse')}>
          <Circle size={14} /> Circle
        </button>
        <button className="btn btn-sm" onClick={() => file.current?.click()}>
          <ImagePlus size={14} /> Picture
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => addImage('/brand/logo-color.png', 'ZMG logo', 0.35)}>
          + Logo
        </button>
        <span className="studio-sep" />
        <button className="btn btn-sm btn-ghost" onClick={undo} disabled={!past.current.length} title="Undo (Ctrl+Z)">
          <Undo2 size={14} />
        </button>
        <button className="btn btn-sm btn-ghost" onClick={redo} disabled={!future.current.length} title="Redo (Ctrl+Y)">
          <Redo2 size={14} />
        </button>
        <span style={{ flex: 1 }} />
        <button className="btn btn-sm btn-ghost" onClick={fresh}>
          New
        </button>
        <button className="btn btn-sm btn-ghost" onClick={() => projFile.current?.click()} title="Open a saved design file">
          <FolderOpen size={14} /> Open
        </button>
        <button className="btn btn-sm btn-ghost" onClick={saveProject} title="Save an editable design file">
          <Save size={14} /> Save
        </button>
        <button className="btn btn-sm" onClick={() => download('png')}>
          <Download size={14} /> PNG
        </button>
        <button className="btn btn-sm" onClick={() => download('jpeg')}>
          <Download size={14} /> JPG
        </button>
        <button
          className="btn btn-sm btn-primary"
          onClick={() => {
            if (!ready()) return toast('warning', 'Pictures are still loading — try again in a second');
            onUse(postableDataUrl(render()), doc.format);
          }}
          title="Opens it in the post editor to add a caption and post"
        >
          <Send size={14} /> Use in a post
        </button>
      </div>

      <div className="studio-main">
        <div
          className="studio-stage"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            upload([...e.dataTransfer.files].find((f) => f.type.startsWith('image/')));
          }}
        >
          <canvas
            ref={canvas}
            style={{ aspectRatio: `${W} / ${H}`, cursor: drag.current ? 'grabbing' : 'default' }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onDoubleClick={() => {
              if (layer?.kind === 'text') document.getElementById('studio-text')?.focus();
            }}
          />
          <span className="dim" style={{ fontSize: 12 }}>
            Drag to move · corners to resize (Shift keeps the shape) · top dot to turn · arrows nudge · Ctrl+D copies · Delete removes · drop or paste pictures
          </span>
        </div>

        <div className="studio-side">
          {layer ? (
            <LayerPanel
              l={layer}
              swatches={swatches}
              set={(p, h) => update(layer.id, p, h)}
              onDup={() => duplicate(layer.id)}
              onDel={() => remove(layer.id)}
              onCut={async (tol) => {
                try {
                  const src = await removeBackground(layer.src!, tol);
                  const im = new Image();
                  im.onload = () => {
                    imgs.set(src, im);
                    const s = Math.min(layer.w / im.width, layer.h / im.height);
                    update(layer.id, { src, w: im.width * s, h: im.height * s, x: layer.x + (layer.w - im.width * s) / 2, y: layer.y + (layer.h - im.height * s) });
                    toast('success', 'Background removed — Undo (Ctrl+Z) if it took too much');
                  };
                  im.src = src;
                } catch (e: any) {
                  toast('error', e.message);
                }
              }}
            />
          ) : (
            <div className="card card-pad studio-panel">
              <h3>Design</h3>
              <label className="studio-row">
                <span>Size</span>
                <select className="select" value={doc.format} onChange={(e) => setDoc((d) => ({ ...d, format: e.target.value as FormatKey }))}>
                  {(Object.keys(FORMATS) as FormatKey[]).map((k) => (
                    <option key={k} value={k}>
                      {FORMATS[k].label}
                    </option>
                  ))}
                </select>
              </label>
              <ColorRow label="Background" value={doc.bg} swatches={swatches.filter((s) => s !== 'transparent')} onChange={(v) => setDoc((d) => ({ ...d, bg: v, bg2: d.bg2 === d.bg ? v : d.bg2 }))} />
              <ColorRow label="Fades to" value={doc.bg2} swatches={swatches.filter((s) => s !== 'transparent')} onChange={(v) => setDoc((d) => ({ ...d, bg2: v }))} />
              <div className="toolbar" style={{ gap: 6 }}>
                <button className="btn btn-sm" onClick={() => bgFile.current?.click()}>
                  <ImagePlus size={14} /> Background picture
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => setDoc((d) => ({ ...d, bgImage: '/brand/bg-blue.jpg' }))}>
                  ZMG texture
                </button>
                {doc.bgImage && (
                  <button className="btn btn-sm btn-ghost" onClick={() => setDoc((d) => ({ ...d, bgImage: undefined }))}>
                    Remove
                  </button>
                )}
              </div>
              <span className="dim" style={{ fontSize: 12 }}>
                Click anything on the design to change it. Your work is kept in this browser; <b>Save</b> makes a file you can open again anywhere.
              </span>
            </div>
          )}

          <div className="card card-pad studio-panel">
            <h3>Layers</h3>
            {!doc.layers.length && <span className="dim">Nothing yet — add a heading, text, a box or a picture.</span>}
            <div className="studio-layers">
              {[...doc.layers].reverse().map((l) => (
                <div key={l.id} className={`studio-layer ${l.id === sel ? 'on' : ''}`} onClick={() => setSel(l.id)}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {l.kind === 'text' ? `T  ${String(l.text).split('\n')[0].slice(0, 24)}` : l.name}
                  </span>
                  <button className="btn btn-sm btn-ghost" title="Bring forward" onClick={(e) => (e.stopPropagation(), move(l.id, 1))}>
                    <ArrowUp size={12} />
                  </button>
                  <button className="btn btn-sm btn-ghost" title="Send back" onClick={(e) => (e.stopPropagation(), move(l.id, -1))}>
                    <ArrowDown size={12} />
                  </button>
                  <button className="btn btn-sm btn-ghost" title={l.hidden ? 'Show' : 'Hide'} onClick={(e) => (e.stopPropagation(), update(l.id, { hidden: !l.hidden }))}>
                    {l.hidden ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                  <button className="btn btn-sm btn-ghost" title={l.locked ? 'Unlock' : 'Lock'} onClick={(e) => (e.stopPropagation(), update(l.id, { locked: !l.locked }))}>
                    {l.locked ? <Lock size={12} /> : <Unlock size={12} />}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <input ref={file} type="file" accept="image/*" hidden onChange={(e) => (upload(e.target.files?.[0]), (e.target.value = ''))} />
      <input
        ref={bgFile}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) {
            const u = await shrinkPhoto(f, 1920).catch(() => null);
            if (u) setDoc((d) => ({ ...d, bgImage: u }));
          }
        }}
      />
      <input ref={projFile} type="file" accept=".json,application/json" hidden onChange={(e) => (openProject(e.target.files?.[0]), (e.target.value = ''))} />
    </div>
  );
}

function ColorRow({ label, value, swatches, onChange }: { label: string; value: string; swatches: string[]; onChange(v: string): void }) {
  return (
    <div className="studio-row">
      <span>{label}</span>
      <div className="studio-swatches">
        {swatches.map((s) => (
          <button
            key={s}
            type="button"
            title={s}
            className={value === s ? 'on' : ''}
            style={{ background: s === 'transparent' ? 'repeating-conic-gradient(#bbb 0 25%, #fff 0 50%) 50% / 10px 10px' : s }}
            onClick={() => onChange(s)}
          />
        ))}
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'} onChange={(e) => onChange(e.target.value)} title="Any colour" />
      </div>
    </div>
  );
}

function Slider({ label, value, min, max, step = 1, onChange, onStart }: { label: string; value: number; min: number; max: number; step?: number; onChange(v: number, done: boolean): void; onStart?(): void }) {
  return (
    <label className="studio-row">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={onStart}
        onKeyDown={onStart}
        onChange={(e) => onChange(Number(e.target.value), false)}
      />
      <span className="dim" style={{ width: 40, textAlign: 'right', fontSize: 12 }}>
        {step < 1 ? value.toFixed(2) : Math.round(value)}
      </span>
    </label>
  );
}

function LayerPanel({
  l,
  swatches,
  set,
  onDup,
  onDel,
  onCut,
}: {
  l: Layer;
  swatches: string[];
  set(p: Partial<Layer>, history?: boolean): void;
  onDup(): void;
  onDel(): void;
  onCut(tol: number): Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  /** Remember the layer for Undo when a slider is grabbed; moving it does not fill the Undo list. */
  const mark = () => set({}, true);
  const slide = (k: keyof Layer) => (v: number) => set({ [k]: v } as Partial<Layer>, false);
  return (
    <div className="card card-pad studio-panel">
      <div className="toolbar">
        <h3 style={{ flex: 1 }}>{l.kind === 'text' ? 'Text' : l.kind === 'image' ? 'Picture' : l.kind === 'rect' ? 'Box' : 'Circle'}</h3>
        <button className="btn btn-sm btn-ghost" onClick={onDup} title="Copy (Ctrl+D)">
          <Copy size={14} />
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onDel} title="Delete">
          <Trash2 size={14} />
        </button>
      </div>

      {l.kind === 'text' && (
        <>
          <textarea id="studio-text" className="input" rows={3} value={l.text} onChange={(e) => set({ text: e.target.value })} />
          <label className="studio-row">
            <span>Font</span>
            <select className="select" value={l.font} onChange={(e) => set({ font: e.target.value })}>
              {FONTS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <Slider onStart={mark} label="Size" value={l.size ?? 60} min={10} max={400} onChange={slide('size')} />
          <div className="toolbar" style={{ gap: 4 }}>
            <button className={`btn btn-sm ${l.bold ? 'btn-primary' : ''}`} onClick={() => set({ bold: !l.bold })}>
              <b>B</b>
            </button>
            <button className={`btn btn-sm ${l.italic ? 'btn-primary' : ''}`} onClick={() => set({ italic: !l.italic })}>
              <i>I</i>
            </button>
            <button className={`btn btn-sm ${l.upper ? 'btn-primary' : ''}`} onClick={() => set({ upper: !l.upper })}>
              AA
            </button>
            {(['left', 'center', 'right'] as CanvasTextAlign[]).map((a) => (
              <button key={a} className={`btn btn-sm ${l.align === a ? 'btn-primary' : ''}`} onClick={() => set({ align: a })}>
                {a === 'left' ? '⟸' : a === 'center' ? '≡' : '⟹'}
              </button>
            ))}
          </div>
          <Slider onStart={mark} label="Spacing" value={l.spacing ?? 0} min={-5} max={40} onChange={slide('spacing')} />
          <Slider onStart={mark} label="Line gap" value={l.lineH ?? 1.1} min={0.7} max={2} step={0.05} onChange={slide('lineH')} />
          <ColorRow label="Colour" value={l.fill} swatches={swatches.filter((s) => s !== 'transparent')} onChange={(v) => set({ fill: v, fill2: undefined })} />
          <ColorRow label="Fade to" value={l.fill2 ?? l.fill} swatches={swatches.filter((s) => s !== 'transparent')} onChange={(v) => set({ fill2: v })} />
          <Slider onStart={mark} label="Outline" value={l.strokeW} min={0} max={20} onChange={slide('strokeW')} />
          {l.strokeW > 0 && <ColorRow label="Outline colour" value={l.stroke} swatches={swatches.filter((s) => s !== 'transparent')} onChange={(v) => set({ stroke: v })} />}
        </>
      )}

      {(l.kind === 'rect' || l.kind === 'ellipse') && (
        <>
          <ColorRow label="Fill" value={l.fill} swatches={swatches} onChange={(v) => set({ fill: v, fill2: undefined })} />
          {l.fill !== 'transparent' && <ColorRow label="Fade to" value={l.fill2 ?? l.fill} swatches={swatches.filter((s) => s !== 'transparent')} onChange={(v) => set({ fill2: v })} />}
          <Slider onStart={mark} label="Border" value={l.strokeW} min={0} max={40} onChange={slide('strokeW')} />
          {l.strokeW > 0 && <ColorRow label="Border colour" value={l.stroke} swatches={swatches.filter((s) => s !== 'transparent')} onChange={(v) => set({ stroke: v })} />}
          {l.kind === 'rect' && <Slider onStart={mark} label="Round corners" value={l.radius} min={0} max={300} onChange={slide('radius')} />}
        </>
      )}

      {l.kind === 'image' && (
        <>
          <div className="toolbar" style={{ gap: 6 }}>
            <button
              className="btn btn-sm btn-primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await onCut(45);
                setBusy(false);
              }}
              title="Works best on a plain background"
            >
              <Eraser size={14} /> {busy ? 'Removing…' : 'Remove background'}
            </button>
            <button
              className="btn btn-sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await onCut(80);
                setBusy(false);
              }}
            >
              Stronger
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => set({ flipX: !l.flipX })}>
              Flip
            </button>
          </div>
          <Slider onStart={mark} label="Brightness" value={l.bright ?? 1} min={0.3} max={2} step={0.05} onChange={slide('bright')} />
          <Slider onStart={mark} label="Contrast" value={l.contrast ?? 1} min={0.3} max={2} step={0.05} onChange={slide('contrast')} />
          <Slider onStart={mark} label="Colour" value={l.sat ?? 1} min={0} max={2.5} step={0.05} onChange={slide('sat')} />
          <Slider onStart={mark} label="Round corners" value={l.radius} min={0} max={400} onChange={slide('radius')} />
          <Slider onStart={mark} label="Border" value={l.strokeW} min={0} max={40} onChange={slide('strokeW')} />
          {l.strokeW > 0 && <ColorRow label="Border colour" value={l.stroke} swatches={swatches.filter((s) => s !== 'transparent')} onChange={(v) => set({ stroke: v })} />}
        </>
      )}

      <Slider onStart={mark} label="Shadow" value={l.shadow} min={0} max={80} onChange={slide('shadow')} />
      {l.shadow > 0 && <ColorRow label="Shadow / glow" value={l.glow ?? 'rgba(0,0,0,0.55)'} swatches={['rgba(0,0,0,0.55)', ...swatches.filter((s) => s !== 'transparent' && s !== '#000000')]} onChange={(v) => set({ glow: v.startsWith('rgba') ? undefined : v })} />}
      <Slider onStart={mark} label="See-through" value={1 - l.opacity} min={0} max={0.95} step={0.05} onChange={(v) => set({ opacity: 1 - v }, false)} />
      <Slider onStart={mark} label="Turn" value={l.rot} min={0} max={359} onChange={slide('rot')} />
    </div>
  );
}
