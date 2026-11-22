/**
 * Station power control through smart plugs (SONOFF, Tasmota, Shelly) on the local network.
 *
 * The rule is simple and self-healing: every station has a *desired* power state derived from the database
 * (session running → on; no session → off), and the plug is driven towards it whenever something changes,
 * plus once a minute ("enforcement"). Billing never waits for, or fails because of, a plug.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { httpOf, type Actor, type Ctx } from '../context.js';
import { sessions, stations, type PowerConfig } from '../db/schema.js';
import { badRequest, notFound } from '../lib/errors.js';
import { audit } from './audit.js';
import { getSettings } from './settings.js';
import { ewelinkCloudCall, ewelinkKeyFor } from './ewelink.js';

export const POWER_DRIVERS = [
  'none',
  'sonoff_lan',
  'sonoff_diy',
  'ewelink_cloud',
  'tasmota',
  'shelly_gen1',
  'shelly_gen2',
  'esphome',
  'home_assistant',
  'generic_http',
] as const;
export type PowerDriverName = (typeof POWER_DRIVERS)[number];

const Url = z.string().trim().max(500).regex(/^https?:\/\/\S+$/, 'Enter a full address starting with http:// or https://');

export const PowerConfigSchema = z.object({
  host: z
    .string()
    .trim()
    .max(200)
    .regex(/^((https?:\/\/)?[a-zA-Z0-9.-]+(:\d{1,5})?\/?)?$/, 'Enter the plug address, e.g. 192.168.1.50')
    .optional(),
  deviceId: z.string().trim().max(40).optional(),
  deviceKey: z.string().trim().max(100).optional(),
  /** Relay/outlet number for multi-channel devices (SONOFF 4CH, Shelly 2.5…). */
  channel: z.number().int().min(0).max(8).optional(),
  username: z.string().trim().max(60).optional(),
  password: z.string().max(100).optional(),
  entityId: z.string().trim().max(120).optional(),
  token: z.string().trim().max(400).optional(),
  onUrl: Url.optional().or(z.literal('')),
  offUrl: Url.optional().or(z.literal('')),
  statusUrl: Url.optional().or(z.literal('')),
  method: z.enum(['GET', 'POST', 'PUT']).optional(),
  onBody: z.string().max(2000).optional(),
  offBody: z.string().max(2000).optional(),
  contentType: z.string().trim().max(100).optional(),
  authHeader: z.string().max(500).optional(),
  statusOnMatch: z.string().max(200).optional(),
});

/**
 * Checks a plug configuration has what its driver needs, with plain-language messages.
 * For SONOFF R4 devices imported from eWeLink it also fills in the device key, so staff never handle it.
 */
export async function validatePowerConfig(ctx: Ctx, driver: string, c: PowerConfig) {
  const need = (ok: unknown, msg: string) => {
    if (!ok) throw badRequest(msg);
  };
  switch (driver) {
    case 'generic_http':
      need(c.onUrl && c.offUrl, 'Enter both the ON address and the OFF address');
      break;
    case 'ewelink_cloud':
      need(c.deviceId, 'Choose the device from your eWeLink account (Integrations → eWeLink)');
      break;
    case 'home_assistant':
      need(c.host, 'Enter the Home Assistant address, e.g. http://192.168.1.20:8123');
      need(c.entityId && /^[a-z_]+\.[a-z0-9_]+$/.test(c.entityId), 'Enter the entity ID, e.g. switch.ps5_tv_plug');
      need(c.token, 'Paste a Home Assistant long-lived access token');
      break;
    case 'esphome':
      need(c.host, 'Enter the device IP address');
      need(c.entityId, 'Enter the switch ID from your ESPHome YAML, e.g. relay');
      break;
    case 'sonoff_lan':
      need(c.host, 'Enter the plug IP address');
      need(c.deviceId, 'Enter the device ID (10 characters, e.g. 1000a1b2c3)');
      if (!c.deviceKey) {
        const key = await ewelinkKeyFor(ctx, c.deviceId!);
        need(key, 'Enter the device key, or import your devices once in Integrations → eWeLink so ZENAA fills it in');
        c.deviceKey = key!;
      }
      break;
    default:
      need(c.host, 'Enter the plug IP address');
  }
  return c;
}

const TIMEOUT_MS = 4000;

/** For plugs that answer with an empty or non-JSON body on success (ESPHome, custom HTTP). */
async function requestText(http: typeof fetch, url: string, init: RequestInit = {}) {
  let res: Response;
  try {
    res = await http(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    const msg = (err as Error).name === 'TimeoutError' ? 'timed out' : (err as Error).message;
    throw new Error(`Device not reachable (${msg}) — check it is powered and on the same network`);
  }
  if (res.status === 401 || res.status === 403) throw new Error('The device refused the login / token');
  if (res.status === 404) throw new Error('The device answered "not found" (HTTP 404) — check the ID or address');
  if (!res.ok) throw new Error(`The device answered HTTP ${res.status}`);
  return res.text();
}

function base(host: string | undefined, defaultPort?: number) {
  const scheme = /^https:\/\//i.test(host ?? '') ? 'https' : 'http';
  const h = (host ?? '').replace(/^https?:\/\//i, '').replace(/\/$/, '');
  return `${scheme}://${h.includes(':') || !defaultPort || scheme === 'https' ? h : `${h}:${defaultPort}`}`;
}

async function request(http: typeof fetch, url: string, init: RequestInit = {}) {
  let res: Response;
  try {
    res = await http(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    const msg = (err as Error).name === 'TimeoutError' ? 'timed out' : (err as Error).message;
    throw new Error(`Plug not reachable (${msg}) — check it is powered and on the same network`);
  }
  if (res.status === 401 || res.status === 403) throw new Error('The plug refused the username/password');
  if (!res.ok) throw new Error(`The plug answered HTTP ${res.status}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('The plug sent an unexpected answer — check the driver type');
  }
}

interface Driver {
  set(on: boolean): Promise<void>;
  get(): Promise<boolean>;
}

/** The plug obeys commands but does not report its on/off state over the LAN. */
export class StateNotReadable extends Error {}

// ── eWeLink LAN encryption (stock firmware with "LAN Control" on: SONOFF BASICR4, MINIR4, …) ──
// AES-128-CBC, key = MD5(devicekey) as 16 raw bytes, random IV per message, PKCS7 padding, base64.
const ewelinkKey = (devicekey: string) => createHash('md5').update(devicekey, 'utf8').digest();

export function ewelinkEncrypt(devicekey: string, data: unknown) {
  const iv = randomBytes(16);
  const c = createCipheriv('aes-128-cbc', ewelinkKey(devicekey), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(data), 'utf8'), c.final()]);
  return { data: ct.toString('base64'), iv: iv.toString('base64') };
}

export function ewelinkDecrypt(devicekey: string, dataB64: string, ivB64: string) {
  const d = createDecipheriv('aes-128-cbc', ewelinkKey(devicekey), Buffer.from(ivB64, 'base64'));
  const out = Buffer.concat([d.update(Buffer.from(dataB64, 'base64')), d.final()]).toString('utf8');
  // Some firmware leaves control characters after the JSON.
  return JSON.parse(out.replace(/[\x00-\x1f]+$/, ''));
}

let lanSeq = 0;
/** Which command shape each device accepted last time ('switch' or 'switches'). */
const lanMode = new Map<string, 'switch' | 'switches'>();

/** SONOFF with stock eWeLink firmware and "LAN Control" on (R4 series): encrypted POST :8081/zeroconf/… */
function sonoffLan(http: typeof fetch, c: PowerConfig): Driver {
  const id = c.deviceId?.trim() ?? '';
  const key = c.deviceKey?.trim() ?? '';
  const missing = () => new Error('Enter the device ID and device key (see docs/08-sonoff-basicr4.md)');
  const post = async (command: string, data: unknown) => {
    if (!id || !key) throw missing();
    lanSeq = Math.max(lanSeq + 1, Date.now());
    const enc = ewelinkEncrypt(key, data);
    let r: any;
    try {
      r = await request(http, `${base(c.host, 8081)}/zeroconf/${command}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', connection: 'close' },
        body: JSON.stringify({ sequence: String(lanSeq), deviceid: id, selfApikey: '123', data: enc.data, encrypt: true, iv: enc.iv }),
      });
    } catch (err) {
      const m = (err as Error).message;
      if (/HTTP (400|401|500)/.test(m)) {
        throw new Error(`${m} — usually a wrong device ID or device key, or LAN Control is off in the eWeLink app`);
      }
      throw err;
    }
    if (typeof r?.error === 'number' && r.error !== 0) {
      const e = new Error(`SONOFF answered error ${r.error}${r.error === 401 ? ' (wrong device key)' : r.error === 404 ? ' (wrong device ID)' : ''}`);
      (e as any).code = r.error;
      throw e;
    }
    if (typeof r?.data === 'string' && r.data && r.iv) {
      try {
        return ewelinkDecrypt(key, r.data, r.iv);
      } catch {
        throw new Error('Could not read the answer — the device key is wrong');
      }
    }
    return r?.data && typeof r.data === 'object' ? r.data : {};
  };
  const slot = `${c.host}|${id}`;
  const outlet = c.channel ?? 0;
  const sendSwitches = (v: string) => post('switches', { switches: [{ switch: v, outlet }] });
  return {
    async set(on) {
      const v = on ? 'on' : 'off';
      if (c.channel != null || lanMode.get(slot) === 'switches') return void (await sendSwitches(v));
      try {
        await post('switch', { switch: v });
        lanMode.set(slot, 'switch');
      } catch (err) {
        // Some single-channel firmware only accepts the multi-outlet form.
        if (/not reachable|device key|device ID/.test((err as Error).message) && !/HTTP/.test((err as Error).message)) throw err;
        await sendSwitches(v);
        lanMode.set(slot, 'switches');
      }
    },
    async get() {
      let d: any;
      try {
        d = await post('info', {});
      } catch (err) {
        if (/not reachable|device key|device ID|LAN Control/.test((err as Error).message)) throw err;
        throw new StateNotReadable((err as Error).message);
      }
      const sw = Array.isArray(d?.switches) ? d.switches.find((x: any) => (x.outlet ?? 0) === outlet)?.switch : d?.switch;
      if (sw !== 'on' && sw !== 'off') throw new StateNotReadable('This plug does not report its state');
      return sw === 'on';
    },
  };
}

/** SONOFF "DIY mode" LAN API (MINI R2/R3, BASIC R3, RF R3, 4CH R3…): POST :8081/zeroconf/… */
function sonoffDiy(http: typeof fetch, c: PowerConfig): Driver {
  const url = (p: string) => `${base(c.host, 8081)}/zeroconf/${p}`;
  const multi = c.channel != null;
  const post = async (path: string, data: unknown) => {
    const r = await request(http, url(path), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceid: c.deviceId ?? '', data }),
    });
    if (r?.error && r.error !== 0) throw new Error(`SONOFF error ${r.error}${r.error === 401 ? ' (enable DIY / LAN mode)' : ''}`);
    return typeof r?.data === 'string' ? JSON.parse(r.data || '{}') : (r?.data ?? {});
  };
  return {
    async set(on) {
      const v = on ? 'on' : 'off';
      if (multi) await post('switches', { switches: [{ switch: v, outlet: c.channel }] });
      else await post('switch', { switch: v });
    },
    async get() {
      const d = await post('info', {});
      if (multi) {
        const sw = (d.switches ?? []).find((x: any) => x.outlet === c.channel);
        if (!sw) throw new Error(`Outlet ${c.channel} not found on this SONOFF`);
        return sw.switch === 'on';
      }
      if (d.switch !== 'on' && d.switch !== 'off') throw new Error('SONOFF did not report its switch state');
      return d.switch === 'on';
    },
  };
}

/** Tasmota firmware (any SONOFF flashed with Tasmota): GET /cm?cmnd=Power1 On */
function tasmota(http: typeof fetch, c: PowerConfig): Driver {
  const key = `POWER${c.channel ?? ''}`;
  const run = async (cmnd: string) => {
    const q = new URLSearchParams({ cmnd });
    if (c.username) q.set('user', c.username);
    if (c.password) q.set('password', c.password);
    const r = await request(http, `${base(c.host)}/cm?${q}`);
    if (r?.WARNING) throw new Error(`Tasmota: ${r.WARNING}`);
    const v = r?.[key] ?? (c.channel == null || c.channel === 1 ? (r?.POWER ?? r?.POWER1) : undefined);
    if (v !== 'ON' && v !== 'OFF') throw new Error('Tasmota did not report the relay state — check the channel');
    return v === 'ON';
  };
  return {
    async set(on) {
      await run(`Power${c.channel ?? ''} ${on ? 'On' : 'Off'}`);
    },
    get: () => run(`Power${c.channel ?? ''}`),
  };
}

function basicAuth(c: PowerConfig): Record<string, string> {
  return c.username ? { authorization: `Basic ${Buffer.from(`${c.username}:${c.password ?? ''}`).toString('base64')}` } : {};
}

/** Shelly Gen1 (Shelly 1, Plug S…): GET /relay/0?turn=on */
function shellyGen1(http: typeof fetch, c: PowerConfig): Driver {
  const url = (q = '') => `${base(c.host)}/relay/${c.channel ?? 0}${q}`;
  return {
    async set(on) {
      await request(http, url(`?turn=${on ? 'on' : 'off'}`), { headers: basicAuth(c) });
    },
    async get() {
      const r = await request(http, url(), { headers: basicAuth(c) });
      return !!r.ison;
    },
  };
}

/** Shelly Gen2/Plus/Gen3 (Plus Plug S, Plus 1…): GET /rpc/Switch.Set?id=0&on=true (keep device auth off on the LAN). */
function shellyGen2(http: typeof fetch, c: PowerConfig): Driver {
  const id = c.channel ?? 0;
  return {
    async set(on) {
      await request(http, `${base(c.host)}/rpc/Switch.Set?id=${id}&on=${on}`);
    },
    async get() {
      const r = await request(http, `${base(c.host)}/rpc/Switch.GetStatus?id=${id}`);
      return !!r.output;
    },
  };
}

/** ESPHome with `web_server:` in its YAML: POST /switch/<id>/turn_on, GET /switch/<id> → {"state":"ON"}. */
function esphome(http: typeof fetch, c: PowerConfig): Driver {
  const id = encodeURIComponent((c.entityId ?? '').replace(/^switch[.-]/, ''));
  const url = (p = '') => `${base(c.host!)}/switch/${id}${p}`;
  return {
    async set(on) {
      await requestText(http, url(on ? '/turn_on' : '/turn_off'), { method: 'POST', headers: basicAuth(c) });
    },
    async get() {
      const t = await requestText(http, url(), { headers: basicAuth(c) });
      let j: any;
      try {
        j = JSON.parse(t);
      } catch {
        throw new Error('ESPHome sent an unexpected answer — is web_server enabled?');
      }
      if (typeof j.value === 'boolean') return j.value;
      if (j.state === 'ON' || j.state === 'OFF') return j.state === 'ON';
      throw new StateNotReadable('ESPHome did not report the switch state');
    },
  };
}

/**
 * Home Assistant REST API — reaches anything HA can switch: TP-Link Kasa/Tapo, Tuya/Smart Life, Meross,
 * Broadlink, Zigbee/Z-Wave plugs, SONOFF through the eWeLink/SonoffLAN integrations, IR blasters…
 */
function homeAssistant(http: typeof fetch, c: PowerConfig): Driver {
  const root = base(c.host!, 8123);
  const headers = { authorization: `Bearer ${c.token ?? ''}`, 'content-type': 'application/json' };
  return {
    async set(on) {
      await requestText(http, `${root}/api/services/homeassistant/${on ? 'turn_on' : 'turn_off'}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ entity_id: c.entityId }),
      });
    },
    async get() {
      const r = await request(http, `${root}/api/states/${encodeURIComponent(c.entityId ?? '')}`, { headers });
      if (r?.state === 'on' || r?.state === 'off') return r.state === 'on';
      if (r?.state === 'unavailable') throw new Error('Home Assistant reports this device as unavailable');
      throw new StateNotReadable(`Home Assistant state is "${r?.state}"`);
    },
  };
}

/** Reads an on/off state from common JSON shapes (Tasmota, Shelly, ESPHome, HA, Node-RED…). */
function guessOnState(text: string): boolean | null {
  let j: any;
  try {
    j = JSON.parse(text);
  } catch {
    const t = text.trim().toLowerCase();
    if (t === 'on' || t === '1' || t === 'true') return true;
    if (t === 'off' || t === '0' || t === 'false') return false;
    return null;
  }
  for (const v of [j?.POWER, j?.POWER1, j?.state, j?.switch, j?.status, j?.ison, j?.output, j?.on, j?.value, j?.relay]) {
    if (v === true || v === 'ON' || v === 'on' || v === 1) return true;
    if (v === false || v === 'OFF' || v === 'off' || v === 0) return false;
  }
  return null;
}

/** Custom integration: any device or service with an ON URL and an OFF URL (and optionally a status URL). */
function genericHttp(http: typeof fetch, c: PowerConfig): Driver {
  const headers: Record<string, string> = {};
  if (c.authHeader) headers.authorization = c.authHeader;
  const method = c.method ?? 'GET';
  const send = (url: string, body?: string) =>
    requestText(http, url, {
      method,
      headers: method !== 'GET' && body ? { ...headers, 'content-type': c.contentType || 'application/json' } : headers,
      body: method !== 'GET' && body ? body : undefined,
    });
  return {
    async set(on) {
      await send((on ? c.onUrl : c.offUrl)!, on ? c.onBody : c.offBody);
    },
    async get() {
      if (!c.statusUrl) throw new StateNotReadable('No status address set');
      const text = await requestText(http, c.statusUrl, { headers });
      const m = c.statusOnMatch?.trim();
      if (m) {
        const rx = m.length > 2 && m.startsWith('/') && m.endsWith('/') ? new RegExp(m.slice(1, -1), 'i') : null;
        return rx ? rx.test(text) : text.includes(m);
      }
      const v = guessOnState(text);
      if (v === null) throw new StateNotReadable('Could not tell ON from OFF in the status answer — fill in "ON looks like"');
      return v;
    },
  };
}

/** eWeLink cloud (internet): any SONOFF/eWeLink device by its device ID, no LAN key or IP needed. */
function ewelinkCloud(ctx: Ctx, c: PowerConfig): Driver {
  const outlet = c.channel;
  return {
    async set(on) {
      const v = on ? 'on' : 'off';
      await ewelinkCloudCall(ctx, 'POST', '/v2/device/thing/status', {
        type: 1,
        id: c.deviceId,
        params: outlet != null ? { switches: [{ switch: v, outlet }] } : { switch: v },
      });
    },
    async get() {
      const d = await ewelinkCloudCall(ctx, 'GET', `/v2/device/thing/status?type=1&id=${encodeURIComponent(c.deviceId ?? '')}&params=${outlet != null ? 'switches' : 'switch'}`);
      const p = d?.params ?? {};
      const sw = outlet != null ? (p.switches ?? []).find((x: any) => (x.outlet ?? 0) === outlet)?.switch : p.switch;
      if (sw !== 'on' && sw !== 'off') throw new StateNotReadable('eWeLink did not report the switch state');
      return sw === 'on';
    },
  };
}

export function makeDriver(http: typeof fetch, driver: string, config: PowerConfig | null | undefined, ctx?: Ctx): Driver | null {
  if (!config || driver === 'none') return null;
  if (driver === 'generic_http') return config.onUrl && config.offUrl ? genericHttp(http, config) : null;
  if (driver === 'ewelink_cloud') return ctx && config.deviceId ? ewelinkCloud(ctx, config) : null;
  if (!config.host) return null;
  switch (driver) {
    case 'esphome':
      return esphome(http, config);
    case 'home_assistant':
      return homeAssistant(http, config);
    case 'sonoff_lan':
      return sonoffLan(http, config);
    case 'sonoff_diy':
      return sonoffDiy(http, config);
    case 'tasmota':
      return tasmota(http, config);
    case 'shelly_gen1':
      return shellyGen1(http, config);
    case 'shelly_gen2':
      return shellyGen2(http, config);
    default:
      return null;
  }
}

type Log = { error: (o: unknown, m?: string) => void; info: (m: string) => void; warn?: (m: string) => void };
type Want = { want: boolean | null; delayMs: number; reason: string };

export class PowerManager {
  private chains = new Map<string, Promise<unknown>>();
  private timers = new Map<string, NodeJS.Timeout>();
  private interval: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;
  private log: Log = { error: () => {}, info: () => {} };

  constructor(private ctx: Ctx) {}

  /** Reacts to session/station changes. Call once the app is built. */
  listen(log?: Log) {
    if (log) this.log = log;
    this.unsubscribe = this.ctx.bus.on((e) => {
      if ((e.type === 'sessions.changed' || e.type === 'stations.changed') && e.stationId) void this.reconcile(e.stationId);
    });
  }

  /** Periodic enforcement (production only). */
  startEnforcement(intervalMs = 60_000) {
    this.interval = setInterval(() => void this.enforceAll(), intervalMs);
    void this.enforceAll();
  }

  stop() {
    this.unsubscribe?.();
    if (this.interval) clearInterval(this.interval);
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  /** Resolves when all queued plug commands have finished (used by tests). */
  async idle() {
    for (let i = 0; i < 20; i++) {
      const all = [...this.chains.values()];
      await Promise.allSettled(all);
      await new Promise((r) => setImmediate(r));
      if ([...this.chains.values()].every((p) => all.includes(p))) return;
    }
  }

  /** Runs work for one station strictly in order, so a quick start→end never lands out of order. */
  private serial<T>(stationId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(stationId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.chains.set(stationId, next.catch(() => {}));
    return next;
  }

  async desired(stationId: string): Promise<Want & { station: typeof stations.$inferSelect | null }> {
    const [station] = await this.ctx.db.select().from(stations).where(eq(stations.id, stationId));
    if (!station || station.powerDriver === 'none') return { station: station ?? null, want: null, delayMs: 0, reason: 'no plug' };
    const settings = await getSettings(this.ctx.db);
    const [open] = await this.ctx.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.stationId, stationId), ne(sessions.status, 'ended')))
      .limit(1);
    if (open) {
      if (open.status === 'running') return { station, want: true, delayMs: 0, reason: 'session running' };
      const mode = open.pauseMode ?? (settings.powerOffOnPause ? 'off' : 'screen');
      return mode === 'off'
        ? { station, want: false, delayMs: 0, reason: 'session paused' }
        : { station, want: true, delayMs: 0, reason: mode === 'open' ? 'session paused (nothing locked)' : 'session paused (power kept on)' };
    }
    if (station.bypassUntil && station.bypassUntil.getTime() > this.ctx.clock.now().getTime()) {
      return { station, want: true, delayMs: 0, reason: 'staff unlock (no charge)' };
    }
    if (station.status === 'maintenance') return { station, want: null, delayMs: 0, reason: 'maintenance — manual control' };
    const [last] = await this.ctx.db
      .select({ endedAt: sessions.endedAt })
      .from(sessions)
      .where(eq(sessions.stationId, stationId))
      .orderBy(desc(sessions.endedAt))
      .limit(1);
    const since = last?.endedAt ? this.ctx.clock.now().getTime() - last.endedAt.getTime() : Infinity;
    const delayMs = Math.max(0, settings.powerOffDelaySeconds * 1000 - since);
    return { station, want: false, delayMs, reason: 'no session' };
  }

  /** Drives one station's plug to its desired state. Never throws. */
  reconcile(stationId: string) {
    return this.serial(stationId, async () => {
      try {
        const d = await this.desired(stationId);
        if (d.want === null || !d.station) return;
        clearTimeout(this.timers.get(stationId));
        this.timers.delete(stationId);
        if (d.delayMs > 0) {
          this.timers.set(
            stationId,
            setTimeout(() => {
              this.timers.delete(stationId);
              void this.reconcile(stationId);
            }, d.delayMs + 50),
          );
          return;
        }
        await this.apply(d.station, d.want);
      } catch (err) {
        this.log.error(err, `power reconcile failed for ${stationId}`);
      }
    });
  }

  private async apply(station: typeof stations.$inferSelect, on: boolean) {
    const driver = makeDriver(httpOf(this.ctx), station.powerDriver, station.powerConfig, this.ctx);
    if (!driver) return;
    try {
      await driver.set(on);
      await this.record(station, on ? 'on' : 'off', null);
    } catch (err) {
      await this.record(station, 'unknown', (err as Error).message);
      throw err;
    }
  }

  private async record(station: typeof stations.$inferSelect, state: 'on' | 'off' | 'unknown', error: string | null) {
    await this.ctx.db
      .update(stations)
      .set({ powerState: state, powerError: error, powerCheckedAt: this.ctx.clock.now() })
      .where(eq(stations.id, station.id));
    if (state !== station.powerState || error !== station.powerError) {
      this.ctx.bus.emit({ type: 'power.changed', stationId: station.id });
      if (error && error !== station.powerError) {
        this.ctx.bus.emit({ type: 'alert', level: 'warning', message: `${station.name}: power plug problem — ${error}`, stationId: station.id });
      }
    }
  }

  /** Once a minute: read every plug and correct any that differ from what they should be. */
  async enforceAll() {
    try {
      const settings = await getSettings(this.ctx.db);
      const list = await this.ctx.db.select().from(stations).where(and(ne(stations.powerDriver, 'none'), ne(stations.status, 'archived')));
      await Promise.all(
        list.map((st) =>
          this.serial(st.id, async () => {
            const d = await this.desired(st.id);
            if (!d.station || d.want === null || d.delayMs > 0) return;
            const driver = makeDriver(httpOf(this.ctx), d.station.powerDriver, d.station.powerConfig, this.ctx);
            if (!driver) return;
            try {
              const actual = await driver.get();
              // Without enforcement we only correct plugs that should be ON (e.g. after a power cut).
              if (actual !== d.want && (settings.powerEnforce || d.want)) {
                await driver.set(d.want);
                await this.record(d.station, d.want ? 'on' : 'off', null);
              } else {
                await this.record(d.station, actual ? 'on' : 'off', null);
              }
            } catch (err) {
              if (err instanceof StateNotReadable && settings.powerEnforce) {
                // Can't read it, so just repeat the command (harmless if it is already in that state).
                try {
                  await driver.set(d.want);
                  await this.record(d.station, d.want ? 'on' : 'off', null);
                } catch (e2) {
                  await this.record(d.station, 'unknown', (e2 as Error).message);
                }
              } else if (!(err instanceof StateNotReadable)) {
                await this.record(d.station, 'unknown', (err as Error).message);
              }
            }
          }),
        ),
      );
    } catch (err) {
      this.log.error(err, 'power enforcement failed');
    }
  }

  /** Manual switch from the station grid (stations.power). */
  async setManual(stationId: string, on: boolean, actor: Actor) {
    const [station] = await this.ctx.db.select().from(stations).where(eq(stations.id, stationId));
    if (!station) throw notFound('Station');
    if (station.powerDriver === 'none') throw badRequest('This station has no smart plug configured');
    await this.serial(stationId, async () => {
      await this.apply(station, on).catch((err) => {
        throw badRequest((err as Error).message);
      });
    });
    await audit(this.ctx.db, actor, on ? 'station.power_on' : 'station.power_off', { type: 'station', id: station.id }, { manual: true });
    const d = await this.desired(stationId);
    const settings = await getSettings(this.ctx.db);
    const willRevert = d.want !== null && d.want !== on && (settings.powerEnforce || d.want);
    return {
      state: on ? 'on' : 'off',
      note: willRevert
        ? `It will switch ${d.want ? 'on' : 'off'} again automatically (${d.reason}). Set the station to Maintenance to control it by hand.`
        : null,
    };
  }

  /** Reads a plug's state with the given settings (the station form's "Test" button). */
  async test(driver: string, config: PowerConfig, action: 'status' | 'on' | 'off' = 'status') {
    const d = makeDriver(httpOf(this.ctx), driver, config, this.ctx);
    if (!d) throw badRequest('Choose a plug type and enter its address');
    try {
      if (action !== 'status') await d.set(action === 'on');
      try {
        return { ok: true, state: (await d.get()) ? 'on' : 'off' };
      } catch (err) {
        if (!(err instanceof StateNotReadable)) throw err;
        if (action !== 'status') return { ok: true, state: action };
        return { ok: true, state: 'unknown', note: 'Connected, but this plug does not report its state — use Test ON / Test OFF and watch the TV' };
      }
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }
}

export interface FoundPlug {
  ip: string;
  driver: 'tasmota' | 'shelly_gen1' | 'shelly_gen2';
  name: string;
  model: string | null;
  mac: string | null;
  /** Tasmota with a web password: found, but ZENAA needs the username/password. */
  needsPassword?: boolean;
}

async function probe(http: typeof fetch, ip: string, timeoutMs: number): Promise<FoundPlug | null> {
  const get = async (path: string) => {
    const r = await http(`http://${ip}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
    const text = await r.text();
    try {
      return { status: r.status, json: JSON.parse(text) as any };
    } catch {
      return { status: r.status, json: null };
    }
  };
  try {
    const t = await get('/cm?cmnd=Status%200');
    if (t.json?.Status || t.json?.StatusNET) {
      const s = t.json;
      return {
        ip,
        driver: 'tasmota',
        name: s.Status?.DeviceName || s.Status?.FriendlyName?.[0] || s.StatusNET?.Hostname || 'Tasmota',
        model: s.StatusFWR?.Hardware ?? null,
        mac: s.StatusNET?.Mac ?? null,
      };
    }
    if (t.json?.WARNING) return { ip, driver: 'tasmota', name: 'Tasmota (password protected)', model: null, mac: null, needsPassword: true };
  } catch {
    return null; // nothing answering on port 80
  }
  try {
    const s = await get('/shelly');
    if (s.json?.gen >= 2) return { ip, driver: 'shelly_gen2', name: s.json.name || s.json.id || 'Shelly', model: s.json.model ?? null, mac: s.json.mac ?? null };
    if (s.json?.type) return { ip, driver: 'shelly_gen1', name: s.json.type, model: s.json.type, mac: s.json.mac ?? null };
  } catch {
    /* not a Shelly */
  }
  return null;
}

/**
 * Scans a /24 network (e.g. "192.168.100") for Tasmota and Shelly plugs, so staff can pick a plug
 * instead of typing its IP address. Takes a few seconds; nothing is changed on the plugs.
 */
export async function discoverPlugs(http: typeof fetch, subnet: string, timeoutMs = 1500): Promise<FoundPlug[]> {
  if (!/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(subnet) || subnet.split('.').some((n) => Number(n) > 255)) {
    throw badRequest('Enter the network as three numbers, e.g. 192.168.1');
  }
  const ips = Array.from({ length: 254 }, (_, i) => `${subnet}.${i + 1}`);
  const found: FoundPlug[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: 48 }, async () => {
      while (next < ips.length) {
        const r = await probe(http, ips[next++], timeoutMs);
        if (r) found.push(r);
      }
    }),
  );
  return found.sort((a, b) => Number(a.ip.split('.')[3]) - Number(b.ip.split('.')[3]));
}
