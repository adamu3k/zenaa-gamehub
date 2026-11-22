/**
 * /ps — a plain web page to open in a jailbroken PS4/PS5's own web browser (or any phone on the Wi-Fi).
 * Pick the station once, type a staff PIN, press Send: the server sends the ZENAA timer to the console's
 * ELF loader. The console's IP is detected from the request when possible, and everything is remembered
 * in a cookie on that console, so after a restart it is: open the bookmark → PIN → Send.
 *
 * No JavaScript (old console browsers), no internet: everything stays on the local network.
 */
import { and, asc, eq, isNull, ne } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Ctx } from '../context.js';
import { stations } from '../db/schema.js';
import { AppError } from '../lib/errors.js';
import { audit } from '../services/audit.js';
import { verifyPin } from '../services/pins.js';
import { getSettings } from '../services/settings.js';
import { patchedPayload, sendToLoader, type ConsolePlatform } from './agent.js';

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A LAN address worth pre-filling (not Docker's own networks or loopback). */
export function lanGuess(ip: string) {
  const v = ip.replace(/^::ffff:/, '');
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(v)) return '';
  if (/^127\./.test(v) || /^172\.(1[6-9]|2\d|3[01])\./.test(v) || /^192\.168\.65\./.test(v)) return '';
  return /^(10\.|192\.168\.)/.test(v) ? v : '';
}

function readCookie(req: FastifyRequest): Record<string, string> {
  const m = /(?:^|;\s*)zenaa_ps=([^;]+)/.exec(req.headers.cookie ?? '');
  if (!m) return {};
  try {
    return Object.fromEntries(new URLSearchParams(decodeURIComponent(m[1])));
  } catch {
    return {};
  }
}

function page(title: string, body: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
body{margin:0;background:#0b0d12;color:#eef1f6;font:20px/1.45 -apple-system,Segoe UI,Roboto,Arial,sans-serif}
.w{max-width:760px;margin:0 auto;padding:28px 20px}
h1{font-size:30px;margin:0 0 6px}p.d{color:#9aa4b2;margin:0 0 22px}
label{display:block;font-weight:600;margin:18px 0 6px}
select,input{width:100%;box-sizing:border-box;font-size:24px;padding:14px;border-radius:12px;border:2px solid #2a3140;background:#141822;color:#fff}
.row{display:flex;gap:12px}.row>*{flex:1}
.seg label{display:inline-block;margin:0 10px 0 0;padding:12px 22px;border:2px solid #2a3140;border-radius:12px;font-weight:600}
.seg input{width:auto}
button{margin-top:26px;width:100%;font-size:28px;font-weight:700;padding:18px;border:0;border-radius:14px;background:#22c55e;color:#04210f}
.box{border-radius:14px;padding:16px 18px;margin:18px 0;background:#141822;border:2px solid #2a3140}
.ok{border-color:#22c55e}.err{border-color:#ef4444;color:#fecaca}.dim{color:#9aa4b2;font-size:17px}
a{color:#7dd3fc}
</style></head><body><div class="w">${body}</div></body></html>`;
}

export async function consolePageRoutes(app: FastifyInstance, ctx: Ctx) {
  if (!app.hasContentTypeParser('application/x-www-form-urlencoded')) {
    app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 4096 }, (_req, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(body as string)));
    });
  }

  const form = async (req: FastifyRequest, reply: FastifyReply, notice = '') => {
    const settings = await getSettings(ctx.db);
    const list = await ctx.db
      .select()
      .from(stations)
      .where(and(isNull(stations.deletedAt), ne(stations.status, 'archived')))
      .orderBy(asc(stations.sortOrder), asc(stations.code));
    const c = readCookie(req);
    const ua = String(req.headers['user-agent'] ?? '');
    const platform = c.platform || (/PlayStation 4/i.test(ua) ? 'ps4' : 'ps5');
    const guess = lanGuess(req.ip);
    const selected = list.find((s) => s.id === c.station);
    const host = c.host || guess || selected?.consoleHost || '';
    const opts = list
      .map((s) => `<option value="${esc(s.id)}"${s.id === c.station ? ' selected' : ''}>${esc(s.code)} — ${esc(s.name)}</option>`)
      .join('');
    const onConsole = /PlayStation/i.test(ua);
    reply.type('text/html; charset=utf-8').header('cache-control', 'no-store');
    return page(
      'ZENAA console timer',
      `<h1>🎮 ${esc(settings.centerName)} — console timer</h1>
<p class="d">Run the jailbreak and start the ELF loader first. Then type a staff PIN and press Send.${onConsole ? ' Bookmark this page on the console.' : ''}</p>
${notice}
<form method="post" action="/ps">
<label>Station</label><select name="station">${opts}</select>
<label>Console</label><div class="seg">
<label><input type="radio" name="platform" value="ps5"${platform === 'ps5' ? ' checked' : ''}> PS5</label>
<label><input type="radio" name="platform" value="ps4"${platform === 'ps4' ? ' checked' : ''}> PS4</label></div>
<div class="row"><div><label>Console IP</label><input name="host" value="${esc(host)}" placeholder="192.168.1.50" inputmode="decimal"></div>
<div style="flex:.5"><label>Loader port</label><input name="port" value="${esc(c.port || '9021')}" inputmode="numeric"></div></div>
<p class="dim">${guess ? `This device's address was detected: <b>${esc(guess)}</b>.` : 'Console IP: PS Settings → Network → View connection status.'} PS5 etaHEN / elfldr and PS4 elfldr use port 9021.</p>
<label>Staff PIN</label><input name="pin" type="password" inputmode="numeric" autocomplete="off" placeholder="••••">
<button type="submit">Send the timer</button>
</form>
<p class="dim">Works without internet: the console only talks to this ZENAA server on your network. Guide: Help → 16.</p>`,
    );
  };

  app.get('/ps', async (req, reply) => form(req, reply));

  app.post('/ps', async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, string>;
    const fail = (msg: string) => form(req, reply, `<div class="box err">✖ ${esc(msg)}</div>`);
    const platform = (b.platform === 'ps4' ? 'ps4' : 'ps5') as ConsolePlatform;
    const host = String(b.host ?? '').trim();
    const port = Number(b.port) || 9021;
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return fail('Type the console IP, e.g. 192.168.1.50');
    const hostHeader = String(req.headers.host ?? '');
    if (!hostHeader || /^(localhost|127\.|\[::1\])/i.test(hostHeader)) {
      return fail('Open this page with the server network address (e.g. http://192.168.1.10:8080/ps), not localhost.');
    }
    let who;
    try {
      who = await verifyPin(ctx.db, b.pin, `ps:${req.ip}`);
    } catch (e) {
      return fail(e instanceof AppError ? e.message : 'Wrong PIN');
    }
    if (!who.permissions.includes('stations.manage') && !who.permissions.includes('stations.bypass')) {
      return fail(`${who.fullName} cannot send the console timer`);
    }
    const [st] = await ctx.db
      .select()
      .from(stations)
      .where(and(eq(stations.id, String(b.station ?? '')), isNull(stations.deletedAt)));
    if (!st) return fail('Choose a station');
    try {
      await ctx.db
        .update(stations)
        .set({ consoleHost: host, agentInfo: { kind: platform, name: platform === 'ps5' ? 'PS5 (payload)' : 'PS4 (payload)', version: '1.0.0', ip: host } })
        .where(eq(stations.id, st.id));
      const token = app.jwt.sign({ sub: st.id, tv: st.agentTokenVersion, typ: 'agent' }, { expiresIn: '3650d' });
      const elf = await patchedPayload(platform, `http://${hostHeader}`, token);
      await sendToLoader(host, port, elf);
    } catch (e) {
      return fail(e instanceof AppError ? e.message : (e as Error).message);
    }
    ctx.bus.emit({ type: 'stations.changed', stationId: st.id });
    await audit(ctx.db, { staffId: who.id, ip: req.ip }, 'station.console_push', { type: 'station', id: st.id }, { platform, host, port, via: 'console page' });
    const cookie = encodeURIComponent(new URLSearchParams({ station: st.id, platform, host, port: String(port) }).toString());
    reply.header('set-cookie', `zenaa_ps=${cookie}; Path=/ps; Max-Age=31536000; SameSite=Lax`);
    reply.type('text/html; charset=utf-8').header('cache-control', 'no-store');
    return page(
      'Timer sent',
      `<h1>✅ Timer sent to ${esc(st.code)}</h1>
<div class="box ok">"ZENAA timer started" should pop up within a few seconds. You can close the browser and start the game.<br><span class="dim">Sent by ${esc(who.fullName)} to ${esc(host)}:${port}</span></div>
<p class="dim">After every console restart: jailbreak → open this page → PIN → Send.</p>
<p><a href="/ps">← Back</a></p>`,
    );
  });
}
