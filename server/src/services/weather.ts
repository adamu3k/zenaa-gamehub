/**
 * Outside temperature for the station screen "island" (PC, Android TV and console apps).
 *
 * One request to Open-Meteo (free, no account, no key) every 15 minutes for the whole venue — the screens
 * never go to the internet themselves. Never blocks: callers get the last value (or null) immediately and
 * a refresh runs in the background. Only the venue coordinates from Settings are sent.
 */
export interface Weather {
  tempC: number;
  /** sun | moon | partly | cloud | fog | rain | storm | snow */
  icon: string;
  label: string;
  at: string;
}

const FRESH_MS = 15 * 60_000;
const RETRY_MS = 5 * 60_000;

let cache: { key: string; value: Weather | null; at: number; tried: number } = { key: '', value: null, at: 0, tried: 0 };
let inflight = false;

/** WMO weather code → short icon name + label. */
export function describeWeather(code: number, isDay: boolean): { icon: string; label: string } {
  if (code === 0) return { icon: isDay ? 'sun' : 'moon', label: 'Clear' };
  if (code <= 2) return { icon: 'partly', label: 'Partly cloudy' };
  if (code === 3) return { icon: 'cloud', label: 'Cloudy' };
  if (code === 45 || code === 48) return { icon: 'fog', label: 'Fog' };
  if (code >= 95) return { icon: 'storm', label: 'Thunderstorm' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { icon: 'snow', label: 'Snow' };
  if (code >= 51) return { icon: 'rain', label: code >= 80 ? 'Showers' : 'Rain' };
  return { icon: 'cloud', label: 'Cloudy' };
}

async function refresh(lat: number, lon: number, key: string) {
  inflight = true;
  cache.tried = Date.now();
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=temperature_2m,weather_code,is_day`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'zenaa-gamehub' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = (await res.json()) as { current?: { temperature_2m?: number; weather_code?: number; is_day?: number } };
    const c = j.current;
    if (!c || typeof c.temperature_2m !== 'number') throw new Error('no data');
    const d = describeWeather(c.weather_code ?? 3, c.is_day !== 0);
    cache = { key, value: { tempC: Math.round(c.temperature_2m), ...d, at: new Date().toISOString() }, at: Date.now(), tried: Date.now() };
  } catch {
    // Keep the last value (if it is for the same place); try again later.
    if (cache.key !== key) cache = { key, value: null, at: 0, tried: Date.now() };
  } finally {
    inflight = false;
  }
}

export function currentWeather(opts: { enabled: boolean; lat: number; lon: number }): Weather | null {
  if (!opts.enabled || process.env.NODE_ENV === 'test' || process.env.VITEST || process.env.ZENAA_NO_WEATHER === '1') return null;
  const key = `${opts.lat.toFixed(3)},${opts.lon.toFixed(3)}`;
  const now = Date.now();
  const stale = cache.key !== key || now - cache.at > FRESH_MS;
  if (stale && !inflight && now - cache.tried > (cache.key === key ? RETRY_MS : 0)) void refresh(opts.lat, opts.lon, key);
  if (cache.key !== key) return null;
  // Older than 2 hours: better show nothing than a wrong temperature.
  return cache.value && now - cache.at < 2 * 3600_000 ? cache.value : null;
}
