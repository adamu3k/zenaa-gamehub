import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cable, Cloud, Download, Gamepad2, Monitor, Plug, Radar, Search, Tv, Wrench , Smartphone } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ErrorBox, Field, PageHeader, PasswordInput } from '../components/ui';
import { del, get, post } from '../lib/api';
import { useApp } from '../lib/app-context';
import { DEVICES, DRIVER_LABEL } from '../lib/devices';
import { formatDateTime } from '../lib/format';

type Tab = 'devices' | 'ewelink' | 'screens' | 'custom';

export function IntegrationsPage() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(params.get('ewelink') ? 'ewelink' : 'devices');
  return (
    <>
      <PageHeader title="Integrations" subtitle="Smart plugs and relays, your eWeLink account, station screen apps, and custom integrations" />
      <div className="tabs" style={{ overflowX: 'auto' }}>
        {(
          [
            ['devices', 'Supported devices'],
            ['ewelink', 'eWeLink / SONOFF account'],
            ['screens', 'Station screen apps'],
            ['custom', 'Custom & DIY'],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'devices' && <Devices />}
      {tab === 'ewelink' && <Ewelink />}
      {tab === 'screens' && <Screens />}
      {tab === 'custom' && <Custom />}
    </>
  );
}

function Devices() {
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return DEVICES.filter((d) => !t || `${d.brand} ${d.model} ${d.kind} ${d.note}`.toLowerCase().includes(t));
  }, [q]);
  return (
    <div className="card">
      <div className="card-head">
        <h2>
          <Plug size={16} /> Which plug type to choose
        </h2>
        <div style={{ position: 'relative', width: 260 }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-dim)' }} />
          <input className="input" style={{ paddingLeft: 32 }} placeholder="Search model, e.g. MINIR3, Tapo" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Device</th>
              <th>Best plug type</th>
              <th className="hide-sm">Also works</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.brand + d.model}>
                <td>
                  <strong>{d.brand}</strong> {d.model}
                  <div className="dim" style={{ fontSize: 12 }}>
                    {d.kind}
                    {d.channels ? ` · up to ${d.channels} stations` : ''}
                  </div>
                </td>
                <td>
                  <span className="badge badge-primary">{DRIVER_LABEL[d.best]}</span>
                </td>
                <td className="hide-sm" style={{ fontSize: 12 }}>
                  {d.also.map((a) => DRIVER_LABEL[a]).join(' · ') || '—'}
                </td>
                <td style={{ fontSize: 13, maxWidth: 420 }}>{d.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card-pad hint">
        Put the plug on the <strong>TV / monitor</strong>, not the PS5 — cutting power to a running PS5 can corrupt its storage. Full guide:{' '}
        <Link to="/help?doc=11-smart-devices-catalog.md">Help → Smart devices</Link>.
      </div>
    </div>
  );
}

function Ewelink() {
  const { can, toast, settings } = useApp();
  const qc = useQueryClient();
  const st = useQuery({ queryKey: ['ewelink'], queryFn: () => get('/api/integrations/ewelink') });
  const [f, setF] = useState({ appId: '', appSecret: '', login: '', password: '', countryCode: settings.phonePrefix || '+233', region: '' });
  const [subnet, setSubnet] = useState('');
  const imp = useMutation({
    mutationFn: () => post('/api/integrations/ewelink/import', { ...f, region: f.region || undefined }),
    onSuccess: (r: any) => {
      qc.setQueryData(['ewelink'], r);
      setF({ ...f, password: '' });
      toast('success', `Imported ${r.devices.length} device(s) from eWeLink`);
    },
  });
  const locate = useMutation({
    mutationFn: () => post('/api/integrations/ewelink/locate', { subnet: subnet.trim() || undefined }),
    onSuccess: (r: any) => {
      if (r.subnet) setSubnet(r.subnet);
      qc.invalidateQueries({ queryKey: ['ewelink'] });
    },
  });
  const forget = useMutation({ mutationFn: () => del('/api/integrations/ewelink'), onSuccess: () => qc.invalidateQueries({ queryKey: ['ewelink'] }) });
  const set = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const data = st.data as any;
  // Sign in with eWeLink (OAuth 2.0): the browser goes to eWeLink's page and comes back to the callback.
  const origin = window.location.origin;
  const redirectUrl = `${origin}/api/integrations/ewelink/callback`;
  const [params, setParams] = useSearchParams();
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  useEffect(() => {
    const r = params.get('ewelink');
    if (!r) return;
    if (r === 'ok') {
      toast('success', `Signed in to eWeLink — imported ${params.get('n') ?? 0} device(s)`);
      qc.invalidateQueries({ queryKey: ['ewelink'] });
    } else setOauthError(params.get('msg') || 'eWeLink sign-in failed');
    setParams({}, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const oauth = useMutation({
    mutationFn: () => post<{ url: string }>('/api/integrations/ewelink/oauth', { appId: f.appId, appSecret: f.appSecret, origin }),
    onSuccess: (r) => {
      window.location.href = r.url;
    },
  });
  const copy = (t: string) => {
    try {
      navigator.clipboard.writeText(t);
      toast('success', 'Copied');
    } catch {
      /* select it by hand */
    }
  };
  return (
    <div className="grid two-col">
      <div className="card">
        <div className="card-head">
          <h2>
            <Cloud size={16} /> Devices in your eWeLink account
          </h2>
          {data?.connected && (
            <button className="btn btn-sm" disabled={locate.isPending} onClick={() => locate.mutate()}>
              <Radar size={15} /> {locate.isPending ? 'Scanning…' : 'Find their IP addresses'}
            </button>
          )}
        </div>
        <ErrorBox error={st.error || locate.error || forget.error} />
        {!data?.connected ? (
          <div className="empty-inline">Not connected yet. Import once with the form → every SONOFF appears here with its device ID, and ZENAA keeps the LAN keys for you.</div>
        ) : (
          <>
            <div className="card-pad dim" style={{ fontSize: 13, paddingBottom: 0 }}>
              Account {data.login} · region {data.region} · imported {formatDateTime(data.importedAt)}
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>Device ID</th>
                    <th>IP</th>
                    <th>Station</th>
                  </tr>
                </thead>
                <tbody>
                  {data.devices.map((d: any) => (
                    <tr key={d.deviceid}>
                      <td>
                        <strong>{d.name}</strong>
                        <div className="dim" style={{ fontSize: 12 }}>
                          {d.model ?? 'model ?'} {d.channels > 1 ? `· ${d.channels} channels` : ''} {d.online === false ? '· offline' : ''} {d.hasKey ? '· key saved' : '· no LAN key'}
                        </div>
                      </td>
                      <td className="mono">{d.deviceid}</td>
                      <td className="mono">{d.ip ?? <span className="dim">—</span>}</td>
                      <td>{d.usedBy ?? <span className="dim">not used</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card-pad toolbar">
              <Field label="Network to scan">
                <input className="input" style={{ width: 160 }} value={subnet} onChange={(e) => setSubnet(e.target.value)} placeholder="192.168.1" />
              </Field>
              <div className="spacer" />
              {can('settings.manage') && (
                <button className="btn btn-sm btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => window.confirm('Forget the eWeLink account? Stations using eWeLink cloud stop working.') && forget.mutate()}>
                  Disconnect
                </button>
              )}
            </div>
            {locate.data && (
              <div className="card-pad" style={{ paddingTop: 0, fontSize: 13 }}>
                {locate.data.found.length === 0
                  ? `No eWeLink LAN devices answered on ${locate.data.subnet}.x — make sure LAN Control is on in the eWeLink app and the device is on this Wi-Fi.`
                  : locate.data.found.map((x: any) => (
                      <div key={x.ip}>
                        <span className="mono">{x.ip}</span> → {x.name ?? 'unknown eWeLink device'} {x.mode === 'diy' ? '(DIY mode)' : x.mode === 'unknown' ? '(key not matched)' : ''}
                      </div>
                    ))}
              </div>
            )}
            <div className="card-pad hint" style={{ paddingTop: 0 }}>
              Then open Stations → ✏️ → Smart plug → <strong>SONOFF eWeLink LAN</strong> and enter just the IP and device ID — the key is filled in automatically. Or pick <strong>eWeLink cloud</strong> to switch by device ID
              over the internet.
            </div>
          </>
        )}
      </div>
      {can('settings.manage') && (
        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h2>{data?.connected ? 'Re-import (new devices or expired sign-in)' : 'Import from eWeLink'}</h2>
          <div className="hint">
            <b>Step 1 — once:</b> at <strong>dev.ewelink.cc</strong> create a free app (guide:{' '}
            <Link to="/help?doc=12-ewelink-without-device-key.md">Help → guide 12</Link>) and set its <b>Redirect URL</b> to exactly:
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input className="input mono" readOnly value={redirectUrl} onFocus={(e) => e.target.select()} style={{ flex: 1, fontSize: 12.5 }} />
            <button className="btn btn-sm" onClick={() => copy(redirectUrl)}>
              Copy
            </button>
          </div>
          {/^https?:\/\/(localhost|127\.)/.test(origin) && (
            <div className="dim" style={{ fontSize: 12 }}>
              You opened ZENAA as <span className="mono">{origin}</span>, so sign in from this PC. To sign in from another computer, open ZENAA there by its network address and register that
              address's Redirect URL instead.
            </div>
          )}
          <div className="hint">
            <b>Step 2:</b> paste the app's App ID and App Secret, then press <b>Sign in with eWeLink</b>. eWeLink's own page opens: sign in with your eWeLink email/phone and password. You
            come straight back here with every device listed. ZENAA never sees your password.
          </div>
          <ErrorBox error={oauth.error || imp.error || (oauthError ? new Error(oauthError) : null)} />
          <div className="form-grid">
            <Field label="App ID">
              <input className="input mono" value={f.appId} onChange={set('appId')} />
            </Field>
            <Field label="App Secret">
              <PasswordInput className="input mono" autoComplete="off" value={f.appSecret} onChange={set('appSecret')} />
            </Field>
          </div>
          <div>
            <button className="btn btn-primary" disabled={oauth.isPending || !f.appId || !f.appSecret} onClick={() => (setOauthError(null), oauth.mutate())}>
              {oauth.isPending ? 'Opening eWeLink…' : 'Sign in with eWeLink'}
            </button>
          </div>
          <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setShowPassword(!showPassword)}>
            {showPassword ? 'Hide' : 'Other way:'} email + password here (only some App IDs allow it)
          </button>
          {showPassword && (
            <>
              <div className="form-grid">
                <Field label="eWeLink email or phone">
                  <input className="input" value={f.login} onChange={set('login')} />
                </Field>
                <Field label="eWeLink password">
                  <PasswordInput className="input" autoComplete="off" value={f.password} onChange={set('password')} />
                </Field>
                <Field label="Country code">
                  <input className="input" value={f.countryCode} onChange={set('countryCode')} />
                </Field>
                <Field label="Region" hint="Leave on automatic">
                  <select className="select" value={f.region} onChange={set('region')}>
                    <option value="">Automatic</option>
                    <option value="eu">Europe / Africa (eu)</option>
                    <option value="as">Asia (as)</option>
                    <option value="us">Americas (us)</option>
                    <option value="cn">China (cn)</option>
                  </select>
                </Field>
              </div>
              <div>
                <button className="btn" disabled={imp.isPending || !f.appId || !f.appSecret || !f.login || !f.password} onClick={() => imp.mutate()}>
                  {imp.isPending ? 'Signing in…' : 'Import with password'}
                </button>
                <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>
                  Error 407 means your App ID can't use a password — use <b>Sign in with eWeLink</b> above. Your password is used once and never stored.
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Screens() {
  const st = useQuery({ queryKey: ['stations'], queryFn: () => get('/api/stations') });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))' }}>
        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2>
            <Monitor size={17} /> ZENAA Station for Windows PCs
          </h2>
          <div className="muted" style={{ fontSize: 13 }}>
            Timer "island" pill at the top centre (ring, time, temperature) that grows for alerts, warning before time runs out, full-screen lock when time is up or nobody has paid. Staff PIN to unlock. Starts with Windows.
          </div>
          <a className="btn btn-primary" href="/downloads/ZenaaStation.exe" download>
            <Download size={15} /> Download ZenaaStation.exe
          </a>
        </div>
        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2>
            <Tv size={17} /> ZENAA TV for Android TV / Google TV
          </h2>
          <div className="muted" style={{ fontSize: 13 }}>
            Shows the timer island on top of the PS5 picture (on TVs that allow overlays), blacks out the screen when time is up and can switch the panel off — no smart plug needed.
          </div>
          <a className="btn btn-primary" href="/downloads/ZenaaTV.apk" download>
            <Download size={15} /> Download ZenaaTV.apk
          </a>
        </div>
        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2>
            <Gamepad2 size={17} /> PS4 / PS5 (jailbroken)
          </h2>
          <div className="muted" style={{ fontSize: 13 }}>
            Jailbroken consoles run the ZENAA timer payload: "Game on", time left, staff messages and "Time is up" appear as PlayStation notifications over the game. Easiest:
            open <strong className="mono">{window.location.origin}/ps</strong> in the console's own browser → staff PIN → Send (no internet needed). Retail (normal)
            consoles cannot run it. <Link to="/help?doc=16-ps4-ps5-console-timer.md">Setup guide →</Link>
          </div>
        </div>
        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h2>
            <Smartphone size={17} /> ZENAA MoMo (the venue MoMo phone)
          </h2>
          <div className="muted" style={{ fontSize: 13 }}>
            Install on the Android phone with your MoMo SIM. It forwards the "Payment received" SMS to ZENAA, so customers' MoMo top-ups are credited automatically — no
            payment gateway, no fees. Pair it in Settings → MoMo top-ups. <Link to="/help?doc=18-momo-without-gateway-and-paystack.md">Guide →</Link>
          </div>
          <a className="btn btn-primary" href="/downloads/ZenaaMoMo.apk" download>
            <Download size={15} /> Download ZenaaMoMo.apk
          </a>
          <div className="muted" style={{ fontSize: 12.5 }}>
            <b>SMS permission blocked or Play Protect refuses the app?</b> Install it from the server PC instead: connect the phone with a USB cable and double-click{' '}
            <span className="mono">tools\ZENAA-MoMo-phone-setup.cmd</span> in the ZENAA folder. It installs the app with SMS already allowed.{' '}
            <Link to="/help?doc=18-momo-without-gateway-and-paystack.md">Steps →</Link>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <h2>Screens by station</h2>
          <Link className="btn btn-sm" to="/stations">
            Pair from Stations
          </Link>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Station</th>
                <th>Screen</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(st.data?.stations ?? []).map((s: any) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.code}</strong> {s.name}
                  </td>
                  <td>{s.agentInfo ? `${s.agentInfo.kind === 'android_tv' ? 'Android TV' : s.agentInfo.kind === 'pc' ? 'Windows PC' : 'App'}${s.agentInfo.name ? ` · ${s.agentInfo.name}` : ''}${s.agentInfo.version ? ` · v${s.agentInfo.version}` : ''}` : <span className="dim">Not paired</span>}</td>
                  <td>{s.agentInfo ? <span className={`badge ${s.agentOnline ? 'badge-success' : 'badge-danger'}`}>{s.agentOnline ? 'Online' : 'Offline'}</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Custom() {
  return (
    <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))' }}>
      <div className="card card-pad doc">
        <h3 style={{ marginTop: 0, borderTop: 0, paddingTop: 0 }}>
          <Cable size={16} /> Custom HTTP — any board or service
        </h3>
        <p>Choose plug type <strong>Custom HTTP</strong> on a station and fill in:</p>
        <ul>
          <li>
            <strong>ON address</strong> — e.g. <code>http://192.168.1.60/relay/on</code>
          </li>
          <li>
            <strong>OFF address</strong> — e.g. <code>http://192.168.1.60/relay/off</code>
          </li>
          <li>
            <strong>Status address</strong> (optional) and <strong>ON looks like</strong> — the text that appears when it is on, e.g. <code>relay=1</code> or <code>"state":"ON"</code>, or a pattern like <code>/on|true/</code>
          </li>
          <li>Method GET / POST / PUT, an optional body (JSON) and an Authorization header (kept secret).</li>
        </ul>
        <p>Works with ESP8266/ESP32 sketches, Raspberry Pi scripts, Node-RED flows, Hubitat/openHAB, IFTTT and other webhooks.</p>
      </div>
      <div className="card card-pad doc">
        <h3 style={{ marginTop: 0, borderTop: 0, paddingTop: 0 }}>
          <Wrench size={16} /> Home Assistant — hundreds of brands
        </h3>
        <ol>
          <li>Add the device to Home Assistant (Kasa, Tapo, Tuya, Meross, Zigbee, Matter, smart TVs…).</li>
          <li>Profile → Security → <strong>Long-lived access tokens</strong> → Create token.</li>
          <li>Station → plug type <strong>Home Assistant</strong>: address <code>http://192.168.1.20:8123</code>, entity <code>switch.ps5_tv_plug</code>, paste the token.</li>
        </ol>
        <p>
          Full guides with a ready-made ESP8266 sketch and ESPHome YAML: <Link to="/help?doc=11-smart-devices-catalog.md">Help → Smart devices catalog</Link>.
        </p>
      </div>
    </div>
  );
}
