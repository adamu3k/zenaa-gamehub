import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Palette, RotateCcw, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ErrorBox, Field, Segmented } from '../components/ui';
import { put } from '../lib/api';
import { applyAppearance, type Appearance, DEFAULT_APPEARANCE, FONTS, HEADING_FONTS, PRESETS, rememberAppearance, textOn } from '../lib/appearance';
import { useApp } from '../lib/app-context';

function HexInput({ value, onChange }: { value: string; onChange(v: string): void }) {
  const commit = (v: string) => {
    const x = v.trim().toLowerCase().replace(/^([0-9a-f]{6})$/, '#$1');
    if (/^#[0-9a-f]{6}$/.test(x)) onChange(x);
  };
  return (
    <input
      key={value}
      className="input mono"
      style={{ width: 110 }}
      defaultValue={value}
      maxLength={7}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && commit((e.target as HTMLInputElement).value)}
    />
  );
}

/** Settings → Appearance: colours, text size, fonts and corners for everyone (changes show live while you choose). */
export function AppearanceCard() {
  const { settings, toast } = useApp();
  const qc = useQueryClient();
  const saved = { ...DEFAULT_APPEARANCE, ...(settings.appearance ?? {}) };
  const [a, setA] = useState<Appearance>(saved);
  useEffect(() => setA({ ...DEFAULT_APPEARANCE, ...(settings.appearance ?? {}) }), [settings.appearance]);
  const dirty = JSON.stringify(a) !== JSON.stringify(saved);

  // Preview live; put the saved look back when leaving without saving.
  useEffect(() => applyAppearance(a), [a]);
  useEffect(() => () => applyAppearance(JSON.parse(localStorage.getItem('zenaa.appearance') ?? 'null') ?? DEFAULT_APPEARANCE), []);

  const save = useMutation({
    mutationFn: () => put('/api/settings', { ...settings, appearance: a }),
    onSuccess: () => {
      rememberAppearance(a);
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast('success', 'Appearance saved for everyone');
    },
  });
  const set = (p: Partial<Appearance>) => setA({ ...a, ...p });
  const lightOnLight = textOn(a.primary) !== '#ffffff';

  return (
    <div className="card card-pad" id="appearance" style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="toolbar">
        <Palette size={18} />
        <h2 style={{ flex: 1 }}>Appearance</h2>
        {dirty && <span className="badge badge-warning">Not saved yet</span>}
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Changes show straight away on this screen. Press <b>Save appearance</b> to use them on every computer and phone (staff app{a.applyToPortal ? ' and customer app' : ''}).
        Light or dark stays each person's own choice (the sun/moon switch).
      </p>
      <ErrorBox error={save.error} />

      <Field label="Ready-made colours">
        <div className="swatch-row">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              title={p.name}
              aria-label={p.name}
              className={`swatch ${a.primary === p.primary && a.accent === p.accent ? 'on' : ''}`}
              style={{ background: `linear-gradient(135deg, ${p.primary} 55%, ${p.accent} 55%)` }}
              onClick={() => set({ primary: p.primary, accent: p.accent, ...(p.tinted !== undefined ? { tintedBackground: p.tinted } : {}) })}
            />
          ))}
        </div>
      </Field>

      <div className="form-grid">
        <Field label="Main colour" hint="Buttons, links and the selected menu item">
          <div className="color-input">
            <input type="color" value={a.primary} onChange={(e) => set({ primary: e.target.value })} />
            <HexInput value={a.primary} onChange={(v) => set({ primary: v })} />
          </div>
        </Field>
        <Field label="Second colour" hint="Gradients: the logo tile, customer app banners">
          <div className="color-input">
            <input type="color" value={a.accent} onChange={(e) => set({ accent: e.target.value })} />
            <HexInput value={a.accent} onChange={(v) => set({ accent: v })} />
          </div>
        </Field>
        <Field label={`Text size: ${a.textScale}%`} hint="Makes everything bigger or smaller (100% = normal)">
          <input type="range" min={85} max={130} step={5} value={a.textScale} onChange={(e) => set({ textScale: Number(e.target.value) })} />
        </Field>
        <Field label="Corners">
          <Segmented
            value={a.corners}
            onChange={(v) => set({ corners: v })}
            options={[
              { value: 'sharp', label: 'Sharp' },
              { value: 'normal', label: 'Normal' },
              { value: 'round', label: 'Round' },
            ]}
          />
        </Field>
        <Field label="Text font">
          <select className="select" value={a.font} onChange={(e) => set({ font: e.target.value as Appearance['font'] })}>
            {Object.entries(FONTS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Heading font" hint="Page titles and section headings">
          <select className="select" value={a.headingFont} onChange={(e) => set({ headingFont: e.target.value as Appearance['headingFont'] })}>
            {Object.entries(HEADING_FONTS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Theme for new devices" hint="Used until someone picks light or dark on that device">
          <Segmented
            value={a.defaultTheme}
            onChange={(v) => set({ defaultTheme: v })}
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
              { value: 'system', label: 'Follow device' },
            ]}
          />
        </Field>
      </div>
      <label className="check">
        <input type="checkbox" checked={a.tintedBackground} onChange={(e) => set({ tintedBackground: e.target.checked })} /> Tint dark backgrounds with the main colour (e.g. navy for blue)
      </label>
      <label className="check">
        <input type="checkbox" checked={a.applyToPortal} onChange={(e) => set({ applyToPortal: e.target.checked })} /> Use these colours in the customer app too
      </label>
      {lightOnLight && <div className="hint">This is a light colour: button text turns black so it stays readable. In the light theme, links in this colour can be hard to read — the dark theme suits it best.</div>}

      <div className="appearance-preview">
        <span className="dim" style={{ fontSize: 12 }}>
          Preview
        </span>
        <h2>Station 1 — PS5</h2>
        <div className="toolbar">
          <button type="button" className="btn btn-primary">
            Start session
          </button>
          <button type="button" className="btn">
            Pause…
          </button>
          <span className="badge badge-primary">Running</span>
          <a style={{ color: 'var(--primary)', fontWeight: 600 }}>A link</a>
        </div>
        <div style={{ height: 34, borderRadius: 'var(--radius-sm)', background: 'linear-gradient(135deg, var(--primary), var(--accent))' }} />
      </div>

      <div className="toolbar">
        <button className="btn btn-primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          <Save size={16} /> Save appearance
        </button>
        <button className="btn" disabled={!dirty} onClick={() => setA(saved)}>
          Undo changes
        </button>
        <button className="btn btn-ghost" onClick={() => setA(DEFAULT_APPEARANCE)}>
          <RotateCcw size={14} /> Back to ZENAA default
        </button>
      </div>
    </div>
  );
}
