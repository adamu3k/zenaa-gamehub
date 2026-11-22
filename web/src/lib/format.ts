export interface CurrencyCfg {
  currencyCode: string;
  currencyMinorUnits: number;
  /** ISO country — picks the local currency symbol, e.g. GH₵ in Ghana, ₦ in Nigeria. */
  countryCode?: string;
}

function moneyLocale(country?: string) {
  if (!country) return undefined;
  try {
    return Intl.NumberFormat.supportedLocalesOf([`en-${country}`]).length ? `en-${country}` : undefined;
  } catch {
    return undefined;
  }
}

export function formatMoney(minor: number | null | undefined, cfg: CurrencyCfg): string {
  const v = (minor ?? 0) / 10 ** cfg.currencyMinorUnits;
  try {
    return new Intl.NumberFormat(moneyLocale(cfg.countryCode), {
      style: 'currency',
      currency: cfg.currencyCode,
      minimumFractionDigits: cfg.currencyMinorUnits,
      maximumFractionDigits: cfg.currencyMinorUnits,
    }).format(v);
  } catch {
    return `${cfg.currencyCode} ${v.toFixed(cfg.currencyMinorUnits)}`;
  }
}

/** Parses a typed amount like "1,500.50" into integer minor units without floating-point error. */
export function parseMoney(input: string, minorUnits: number): number | null {
  const s = input.replace(/[,\s]/g, '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const neg = s.startsWith('-');
  const [whole, frac = ''] = s.replace('-', '').split('.');
  if (frac.length > minorUnits) return null;
  const minor = Number(whole) * 10 ** minorUnits + Number((frac + '0'.repeat(minorUnits)).slice(0, minorUnits) || '0');
  return neg ? -minor : minor;
}

export function toMajorString(minor: number | null | undefined, minorUnits: number): string {
  if (minor == null) return '';
  return (minor / 10 ** minorUnits).toFixed(minorUnits);
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const formatDateTime = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
export const formatTime = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '—';

export const PLATFORM_LABEL: Record<string, string> = {
  ps5: 'PlayStation 5',
  ps4: 'PlayStation 4',
  xbox_series: 'Xbox Series',
  xbox_one: 'Xbox One',
  nintendo_switch: 'Nintendo Switch',
  pc: 'Gaming PC',
  vr: 'VR',
  racing_sim: 'Racing sim',
  other: 'Other',
};

export const METHOD_LABEL: Record<string, string> = {
  cash: 'Cash',
  card: 'Card',
  bank_transfer: 'Bank transfer',
  mobile_money: 'Mobile money (MoMo)',
  wallet: 'Wallet',
  paystack: 'Paystack (online)',
};
