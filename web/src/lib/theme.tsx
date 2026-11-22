import { Monitor, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';
const KEY = 'zenaa.theme';

function systemTheme(): 'light' | 'dark' {
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function stored(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
    // Never chosen on this device: the default from Settings → Appearance.
    const d = JSON.parse(localStorage.getItem('zenaa.appearance') ?? '{}').defaultTheme;
    return d === 'light' || d === 'system' ? d : 'dark';
  } catch {
    return 'dark';
  }
}

/** Applies the saved theme before React renders (no flash). */
export function applyInitialTheme() {
  const c = stored();
  document.documentElement.dataset.theme = c === 'system' ? systemTheme() : c;
}

/** Shared theme state: light, dark, or follow the device. */
export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(stored);
  useEffect(() => {
    const apply = () => (document.documentElement.dataset.theme = choice === 'system' ? systemTheme() : choice);
    apply();
    try {
      localStorage.setItem(KEY, choice);
    } catch {
      /* storage unavailable */
    }
    if (choice !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [choice]);
  return [choice, setChoice] as const;
}

const OPTIONS: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'Auto (follow device)', icon: Monitor },
];

/** Compact three-way switch: light · dark · auto. */
export function ThemeToggle() {
  const [choice, setChoice] = useTheme();
  return (
    <div className="segmented theme-toggle" role="radiogroup" aria-label="Colour theme">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={choice === o.value}
          className={choice === o.value ? 'on' : ''}
          title={o.label}
          aria-label={o.label}
          onClick={() => setChoice(o.value)}
        >
          <o.icon size={15} />
        </button>
      ))}
    </div>
  );
}
