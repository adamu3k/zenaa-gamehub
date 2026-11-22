/**
 * Settings → Appearance: main colour, gradient colour, text size, fonts, corners, tinted dark backgrounds.
 * Saved on the server for everyone; cached on each device so the page opens in the right colours straight away.
 */
import '@fontsource/anton/400.css';
import '@fontsource/archivo-black/400.css';

export interface Appearance {
  primary: string;
  accent: string;
  textScale: number;
  font: 'inter' | 'segoe' | 'verdana' | 'trebuchet' | 'tahoma' | 'georgia';
  headingFont: 'same' | 'anton' | 'archivo';
  corners: 'sharp' | 'normal' | 'round';
  tintedBackground: boolean;
  defaultTheme: 'dark' | 'light' | 'system';
  applyToPortal: boolean;
}

export const DEFAULT_APPEARANCE: Appearance = {
  primary: '#7c5cff',
  accent: '#c04cff',
  textScale: 100,
  font: 'inter',
  headingFont: 'same',
  corners: 'normal',
  tintedBackground: false,
  defaultTheme: 'dark',
  applyToPortal: true,
};

export const FONTS: Record<Appearance['font'], { label: string; stack: string }> = {
  inter: { label: 'Standard (Inter / Segoe UI)', stack: "'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  segoe: { label: 'Segoe UI (Windows)', stack: "'Segoe UI', system-ui, Roboto, sans-serif" },
  verdana: { label: 'Verdana (very readable)', stack: 'Verdana, Geneva, Tahoma, sans-serif' },
  trebuchet: { label: 'Trebuchet', stack: "'Trebuchet MS', 'Segoe UI', sans-serif" },
  tahoma: { label: 'Tahoma (compact)', stack: 'Tahoma, Verdana, sans-serif' },
  georgia: { label: 'Georgia (serif)', stack: "Georgia, 'Times New Roman', serif" },
};
export const HEADING_FONTS: Record<Appearance['headingFont'], { label: string; stack: string | null }> = {
  same: { label: 'Same as text', stack: null },
  anton: { label: 'ANTON — tall bold (poster style)', stack: "'Anton', Impact, sans-serif" },
  archivo: { label: 'ARCHIVO BLACK — wide heavy', stack: "'Archivo Black', 'Arial Black', sans-serif" },
};
const CORNERS = { sharp: ['4px', '3px'], normal: ['12px', '8px'], round: ['20px', '12px'] } as const;

export const PRESETS: { name: string; primary: string; accent: string; tinted?: boolean }[] = [
  { name: 'ZENAA purple (default)', primary: '#7c5cff', accent: '#c04cff' },
  { name: 'ZMG blue + lime', primary: '#1d44f9', accent: '#ccf02a', tinted: true },
  { name: 'ZMG lime', primary: '#ccf02a', accent: '#1d44f9', tinted: false },
  { name: 'Ocean', primary: '#0ea5e9', accent: '#6366f1' },
  { name: 'Emerald', primary: '#10b981', accent: '#84cc16' },
  { name: 'Fire', primary: '#ef4444', accent: '#f97316' },
  { name: 'Gold', primary: '#f59e0b', accent: '#ef4444' },
  { name: 'Pink', primary: '#ec4899', accent: '#8b5cf6' },
];

const KEY = 'zenaa.appearance';

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
/** Black text on light colours (e.g. lime), white on dark ones. */
export function textOn(hex: string) {
  return luminance(hex) > 0.4 ? '#0b0d12' : '#ffffff';
}

export function applyAppearance(raw: Partial<Appearance> | null | undefined) {
  const a = { ...DEFAULT_APPEARANCE, ...(raw ?? {}) };
  const r = document.documentElement;
  const st = r.style;
  st.setProperty('--primary', a.primary);
  st.setProperty('--accent', a.accent);
  st.setProperty('--on-primary', textOn(a.primary));
  st.setProperty('--font', FONTS[a.font]?.stack ?? FONTS.inter.stack);
  const hf = HEADING_FONTS[a.headingFont]?.stack;
  if (hf) st.setProperty('--heading-font', hf);
  else st.removeProperty('--heading-font');
  r.classList.toggle('heading-display', !!hf);
  st.setProperty('--ui-zoom', String(Math.min(130, Math.max(85, a.textScale)) / 100));
  const [big, small] = CORNERS[a.corners] ?? CORNERS.normal;
  st.setProperty('--radius', big);
  st.setProperty('--radius-sm', small);
  r.classList.toggle('tinted', a.tintedBackground);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', a.primary);
}

export function cachedAppearance(): Appearance | null {
  try {
    const v = localStorage.getItem(KEY);
    return v ? { ...DEFAULT_APPEARANCE, ...JSON.parse(v) } : null;
  } catch {
    return null;
  }
}
function cache(a: Appearance) {
  try {
    localStorage.setItem(KEY, JSON.stringify(a));
  } catch {
    /* private window */
  }
}

const isPortal = () => location.pathname === '/portal' || location.pathname.startsWith('/portal/') || location.pathname === '/board';

/** Before React renders: last known colours (no flash), then the current ones from the server. */
export function bootAppearance() {
  const c = cachedAppearance();
  if (c && !(isPortal() && !c.applyToPortal)) applyAppearance(c);
  fetch('/api/public/appearance')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!d?.appearance) return;
      cache(d.appearance);
      applyAppearance(isPortal() && !d.appearance.applyToPortal ? DEFAULT_APPEARANCE : d.appearance);
    })
    .catch(() => undefined);
}

/** After saving in Settings. */
export function rememberAppearance(a: Appearance) {
  cache(a);
  applyAppearance(a);
}
