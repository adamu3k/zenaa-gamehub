/**
 * eWeLink account integration (SONOFF stock firmware).
 *
 *  - Import: signs in to the eWeLink cloud once with the owner's own developer App ID / App Secret
 *    (free at dev.ewelink.cc) and stores each device's ID and LAN key server-side. Staff then pick a device
 *    from a list — nobody copies keys by hand.
 *  - Locate: scans the venue network for eWeLink LAN devices (port 8081) and matches each to an imported
 *    device by trying its key, so the IP address is filled in too.
 *  - Cloud control (driver "ewelink_cloud"): switches any eWeLink device through the internet by device ID
 *    only — the fallback for devices whose LAN mode is off or unreliable.
 *
 * Sign-in: "Sign in with eWeLink" (OAuth 2.0, works with the free developer App ID) or, for App IDs that allow it,
 * email + password. eWeLink answers error 407 to password sign-in for standard developer apps.
 *
 * The eWeLink password is never stored. Keys, App Secret and tokens never leave the server.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { httpOf, type Actor, type Ctx } from '../context.js';
import { stations } from '../db/schema.js';
import { badRequest } from '../lib/errors.js';
import { audit } from './audit.js';
import { makeDriver, StateNotReadable } from './power.js';
import { getKv, setKv } from './settings.js';

export const EWELINK_HOSTS = {
  eu: 'https://eu-apia.coolkit.cc',
  as: 'https://as-apia.coolkit.cc',
  us: 'https://us-apia.coolkit.cc',
  cn: 'https://cn-apia.coolkit.cn',
} as const;
type Region = keyof typeof EWELINK_HOSTS;

export interface EwelinkDevice {
  deviceid: string;
  devicekey?: string;
  name: string;
  model: string | null;
  online: boolean | null;
  /** Number of relays (1 for BASIC/MINI, 2–4 for DUALR3 / 4CH). */
  channels: number;
  ip?: string | null;
}

interface EwelinkStore {
  appId: string;
  appSecret: string;
  region: Region;
  login: string;
  at: string;
  rt: string;
  importedAt: string;
  devices: EwelinkDevice[];
}

const KV = 'ewelink';
const load = (ctx: Ctx) => getKv<EwelinkStore>(ctx.db, KV);

export const EwelinkImportSchema = z.object({
  appId: z.string().trim().min(10).max(80),
  appSecret: z.string().trim().min(10).max(120),
  login: z.string().trim().min(3).max(120),
  password: z.string().min(1).max(200),
  countryCode: z
    .string()
    .trim()
    .regex(/^\+\d{1,4}$/, 'Use a country code like +233')
    .default('+233'),
  region: z.enum(['eu', 'as', 'us', 'cn']).optional(),
});

const sign = (secret: string, body: string) => createHmac('sha256', Buffer.from(secret, 'utf8')).update(Buffer.from(body, 'utf8')).digest('base64');

async function call(http: typeof fetch, url: string, init: RequestInit) {
  let res: Response;
  try {
    res = await http(url, { ...init, signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    throw new Error(`Cannot reach the eWeLink cloud (${(err as Error).message}) — check the internet connection`);
  }
  try {
    return (await res.json()) as { error: number; msg?: string; data?: any };
  } catch {
    throw new Error(`eWeLink answered HTTP ${res.status}`);
  }
}

function loginError(e: { error: number; msg?: string }) {
  const hint =
    e.error === 407
      ? 'This App ID is not allowed to sign in with a password (normal for free developer apps). Use the "Sign in with eWeLink" button instead — see Help → guide 12.'
      : e.error === 10001 || e.error === 401
        ? 'Check the App ID and App Secret.'
        : e.error === 10014 || e.error === 10011 || e.error === 10003
          ? 'Check the email/phone, country code and password.'
          : '';
  return badRequest(`eWeLink sign-in failed (error ${e.error}${e.msg ? `: ${e.msg}` : ''}). ${hint}`.trim());
}

/** Signs in, lists every device in the account and stores IDs + keys. Returns the device list without keys. */
export async function importEwelink(ctx: Ctx, actor: Actor, raw: unknown) {
  const b = EwelinkImportSchema.parse(raw);
  const http = httpOf(ctx);
  const payload: Record<string, string> = { password: b.password, countryCode: b.countryCode };
  if (b.login.includes('@')) payload.email = b.login;
  else payload.phoneNumber = b.login.startsWith('+') ? b.login.replace(/\s/g, '') : `${b.countryCode}${b.login.replace(/\D/g, '').replace(/^0/, '')}`;
  const body = JSON.stringify(payload);
  const loginAt = (region: Region) =>
    call(http, `${EWELINK_HOSTS[region]}/v2/user/login`, {
      method: 'POST',
      headers: { authorization: `Sign ${sign(b.appSecret, body)}`, 'content-type': 'application/json', 'x-ck-appid': b.appId },
      body,
    });
  let region: Region = b.region ?? 'eu';
  let r = await loginAt(region);
  // Wrong region: eWeLink tells us which one the account lives in.
  if (r.error === 10004 && r.data?.region && r.data.region in EWELINK_HOSTS) {
    region = r.data.region;
    r = await loginAt(region);
  }
  if (r.error !== 0) throw loginError(r);
  return storeImport(ctx, actor, { appId: b.appId, appSecret: b.appSecret, region, login: b.login, at: r.data.at as string, rt: r.data.rt as string });
}

/** Lists every device in the signed-in account and stores IDs + keys. */
async function storeImport(ctx: Ctx, actor: Actor, a: { appId: string; appSecret: string; region: Region; login: string; at: string; rt: string }) {
  const http = httpOf(ctx);
  const { appId, appSecret, region, login, at, rt } = a;
  const list = await call(http, `${EWELINK_HOSTS[region]}/v2/device/thing?num=0`, { headers: { authorization: `Bearer ${at}`, 'x-ck-appid': appId } });
  if (list.error !== 0) throw badRequest(`Signed in, but could not list devices (error ${list.error}${list.msg ? `: ${list.msg}` : ''})`);
  const old = await load(ctx);
  const devices: EwelinkDevice[] = (list.data?.thingList ?? [])
    .map((t: any) => t.itemData)
    .filter((d: any) => d?.deviceid)
    .map((d: any) => ({
      deviceid: String(d.deviceid),
      devicekey: d.devicekey ? String(d.devicekey) : undefined,
      name: String(d.name ?? d.deviceid),
      model: d.productModel ?? d.extra?.model ?? null,
      online: typeof d.online === 'boolean' ? d.online : null,
      channels: Array.isArray(d.params?.switches) ? Math.max(1, d.params.switches.length) : 1,
      ip: old?.devices.find((o) => o.deviceid === String(d.deviceid))?.ip ?? null,
    }));
  await setKv(ctx.db, KV, {
    appId,
    appSecret,
    region,
    login,
    at,
    rt,
    importedAt: ctx.clock.now().toISOString(),
    devices,
  } satisfies EwelinkStore);
  await audit(ctx.db, actor, 'ewelink.import', undefined, { region, devices: devices.length });
  return listEwelink(ctx);
}

// ───────────────────────── Sign in with eWeLink (OAuth 2.0) ─────────────────────────

const OAUTH_KV = 'ewelink_oauth';
const OAUTH_PAGE = 'https://c2ccdn.coolkit.cc/oauth/index.html';
const OAUTH_TTL_MS = 15 * 60_000;

interface OauthPending {
  appId: string;
  appSecret: string;
  redirectUrl: string;
  state: string;
  staffId: string | null;
  createdAt: number;
}

export const EwelinkOauthStartSchema = z.object({
  appId: z.string().trim().min(10).max(80),
  appSecret: z.string().trim().min(10).max(120),
  /** The address the browser uses for ZENAA, e.g. http://192.168.1.10:8080 — eWeLink sends the browser back there. */
  origin: z
    .string()
    .trim()
    .regex(/^https?:\/\/[^/\s?#]+$/, 'Bad address'),
});

/** The address to register as "Redirect URL" in the dev.ewelink.cc app. */
export const ewelinkRedirectUrl = (origin: string) => `${origin.replace(/\/+$/, '')}/api/integrations/ewelink/callback`;

/** Step 1: returns the eWeLink sign-in page address. The browser goes there; the customer signs in on eWeLink's own page. */
export async function startEwelinkOauth(ctx: Ctx, actor: Actor, raw: unknown) {
  const b = EwelinkOauthStartSchema.parse(raw);
  const seq = String(ctx.clock.now().getTime());
  const state = randomBytes(12).toString('hex');
  const nonce = randomBytes(6).toString('base64').replace(/[^A-Za-z0-9]/g, 'x').slice(0, 8).padEnd(8, '0');
  const redirectUrl = ewelinkRedirectUrl(b.origin);
  await setKv(ctx.db, OAUTH_KV, {
    appId: b.appId,
    appSecret: b.appSecret,
    redirectUrl,
    state,
    staffId: actor.staffId,
    createdAt: ctx.clock.now().getTime(),
  } satisfies OauthPending);
  const q = new URLSearchParams({
    clientId: b.appId,
    seq,
    authorization: sign(b.appSecret, `${b.appId}_${seq}`),
    redirectUrl,
    grantType: 'authorization_code',
    state,
    nonce,
    showQRCode: 'false',
  });
  return { url: `${OAUTH_PAGE}?${q.toString()}`, redirectUrl };
}

/** Step 2: eWeLink sends the browser back with a one-time code (valid 30 s). Exchanges it and imports the devices. */
export async function finishEwelinkOauth(ctx: Ctx, query: { code?: string; region?: string; state?: string; ip?: string }) {
  const p = await getKv<OauthPending>(ctx.db, OAUTH_KV);
  if (!p || !query.state || query.state !== p.state) throw badRequest('This eWeLink sign-in link is not valid any more. Press "Sign in with eWeLink" again.');
  if (ctx.clock.now().getTime() - p.createdAt > OAUTH_TTL_MS) throw badRequest('The eWeLink sign-in took too long. Press "Sign in with eWeLink" again.');
  if (!query.code) throw badRequest('eWeLink did not send a sign-in code (was the sign-in cancelled?).');
  await setKv(ctx.db, OAUTH_KV, null); // one use only
  const region: Region = query.region && query.region in EWELINK_HOSTS ? (query.region as Region) : 'eu';
  const body = JSON.stringify({ code: query.code, redirectUrl: p.redirectUrl, grantType: 'authorization_code' });
  const nonce = randomBytes(6).toString('hex').slice(0, 8);
  const r = await call(httpOf(ctx), `${EWELINK_HOSTS[region]}/v2/user/oauth/token`, {
    method: 'POST',
    headers: { authorization: `Sign ${sign(p.appSecret, body)}`, 'content-type': 'application/json', 'x-ck-appid': p.appId, 'x-ck-nonce': nonce },
    body,
  });
  if (r.error !== 0 || !r.data?.accessToken) {
    const hint =
      r.error === 405
        ? 'The code expired (it lasts 30 seconds). Try again.'
        : r.error === 10001 || r.error === 401 || r.error === 407
          ? 'Check the App ID and App Secret, and that the Redirect URL in dev.ewelink.cc is exactly the one ZENAA shows.'
          : '';
    throw badRequest(`eWeLink sign-in failed (error ${r.error}${r.msg ? `: ${r.msg}` : ''}). ${hint}`.trim());
  }
  return storeImport(
    ctx,
    { staffId: p.staffId, ip: query.ip },
    { appId: p.appId, appSecret: p.appSecret, region, login: 'eWeLink account', at: r.data.accessToken, rt: r.data.refreshToken },
  );
}

/** Imported devices without keys, with the station using each one. */
export async function listEwelink(ctx: Ctx) {
  const s = await load(ctx);
  if (!s) return { connected: false as const, devices: [] };
  const used = await ctx.db.select({ code: stations.code, cfg: stations.powerConfig, driver: stations.powerDriver, deletedAt: stations.deletedAt }).from(stations);
  return {
    connected: true as const,
    region: s.region,
    login: /[@\d]/.test(s.login) ? s.login.replace(/^(.{2}).*(.{2})$/, '$1•••$2') : s.login,
    importedAt: s.importedAt,
    devices: s.devices.map(({ devicekey, ...d }) => ({
      ...d,
      hasKey: !!devicekey,
      usedBy: used.find((u) => !u.deletedAt && u.cfg?.deviceId === d.deviceid)?.code ?? null,
    })),
  };
}

export async function forgetEwelink(ctx: Ctx, actor: Actor) {
  await setKv(ctx.db, KV, null);
  await audit(ctx.db, actor, 'ewelink.forget');
  return { ok: true };
}

/** The LAN key of an imported device (used when a station is saved without one). */
export async function ewelinkKeyFor(ctx: Ctx, deviceid: string) {
  return (await load(ctx))?.devices.find((d) => d.deviceid === deviceid.trim())?.devicekey ?? null;
}

/** Calls the eWeLink cloud API with the stored token, refreshing it once if it has expired. */
export async function ewelinkCloudCall(ctx: Ctx, method: 'GET' | 'POST', path: string, body?: unknown) {
  const s = await load(ctx);
  if (!s?.at) throw new Error('eWeLink is not connected — open Integrations → eWeLink and import your devices');
  const http = httpOf(ctx);
  const host = EWELINK_HOSTS[s.region];
  const run = (at: string) =>
    call(http, `${host}${path}`, {
      method,
      headers: { authorization: `Bearer ${at}`, 'x-ck-appid': s.appId, 'content-type': 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  let r = await run(s.at);
  if (r.error === 401 || r.error === 402) {
    const rb = JSON.stringify({ rt: s.rt });
    let ref = await call(http, `${host}/v2/user/refresh`, {
      method: 'POST',
      headers: { authorization: `Bearer ${s.at}`, 'x-ck-appid': s.appId, 'content-type': 'application/json' },
      body: rb,
    });
    if (ref.error !== 0) {
      ref = await call(http, `${host}/v2/user/refresh`, {
        method: 'POST',
        headers: { authorization: `Sign ${sign(s.appSecret, rb)}`, 'x-ck-appid': s.appId, 'content-type': 'application/json' },
        body: rb,
      });
    }
    if (ref.error !== 0) throw new Error('The eWeLink sign-in has expired — import your devices again (Integrations → eWeLink)');
    await setKv(ctx.db, KV, { ...s, at: ref.data.at, rt: ref.data.rt ?? s.rt });
    r = await run(ref.data.at);
  }
  if (r.error !== 0) {
    const hint = r.error === 4002 || r.error === 503 ? ' — the device is offline (check its power and Wi-Fi)' : r.error === 405 ? ' — this device is not in the imported account' : '';
    throw new Error(`eWeLink error ${r.error}${r.msg ? ` (${r.msg})` : ''}${hint}`);
  }
  return r.data;
}

/**
 * Finds imported eWeLink devices on the LAN: probes port 8081 on every address of a /24 network and tries each
 * device's key on whatever answers. Nothing is switched — only the read-only "info" command is sent.
 */
export async function locateEwelink(ctx: Ctx, subnet: string, timeoutMs = 1200) {
  if (!/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(subnet) || subnet.split('.').some((n) => Number(n) > 255)) {
    throw badRequest('Enter the network as three numbers, e.g. 192.168.1');
  }
  const s = await load(ctx);
  const http = httpOf(ctx);
  const ips = Array.from({ length: 254 }, (_, i) => `${subnet}.${i + 1}`);
  const answering: { ip: string; diyId: string | null }[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: 48 }, async () => {
      while (next < ips.length) {
        const ip = ips[next++];
        try {
          const res = await http(`http://${ip}:8081/zeroconf/info`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ deviceid: '', data: {} }),
            signal: AbortSignal.timeout(timeoutMs),
          });
          const j: any = await res.json().catch(() => null);
          if (j && (typeof j.error === 'number' || typeof j.seq === 'number' || j.data)) {
            let data = j.data;
            if (typeof data === 'string') data = (() => { try { return JSON.parse(data); } catch { return null; } })();
            answering.push({ ip, diyId: data?.deviceid ?? null });
          }
        } catch {
          /* nothing on :8081 */
        }
      }
    }),
  );
  const devices = s?.devices ?? [];
  const found: { ip: string; deviceid: string | null; name: string | null; mode: 'lan' | 'diy' | 'unknown' }[] = [];
  for (const a of answering.sort((x, y) => Number(x.ip.split('.')[3]) - Number(y.ip.split('.')[3]))) {
    if (a.diyId) {
      found.push({ ip: a.ip, deviceid: a.diyId, name: devices.find((d) => d.deviceid === a.diyId)?.name ?? null, mode: 'diy' });
      continue;
    }
    let match: EwelinkDevice | null = null;
    for (const d of devices) {
      if (!d.devicekey || found.some((f) => f.deviceid === d.deviceid)) continue;
      try {
        await makeDriver(http, 'sonoff_lan', { host: a.ip, deviceId: d.deviceid, deviceKey: d.devicekey })!.get();
        match = d;
        break;
      } catch (err) {
        if (err instanceof StateNotReadable) continue;
      }
    }
    found.push({ ip: a.ip, deviceid: match?.deviceid ?? null, name: match?.name ?? null, mode: match ? 'lan' : 'unknown' });
  }
  if (s) {
    for (const f of found) {
      const d = s.devices.find((x) => x.deviceid === f.deviceid);
      if (d) d.ip = f.ip;
    }
    await setKv(ctx.db, KV, s);
  }
  return { subnet, found };
}
