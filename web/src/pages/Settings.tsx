import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ErrorBox, Field, PageHeader, PasswordInput } from '../components/ui';
import { del, get, post, put, setToken } from '../lib/api';
import { useApp, type WebsiteGame, type WebsiteSettings } from '../lib/app-context';
import { formatMoney, parseMoney, toMajorString } from '../lib/format';
import { AppearanceCard } from './SettingsAppearance';

interface Country {
  code: string;
  name: string;
  currency: string;
  minorUnits: number;
  dialCode: string;
  timezone: string;
  mobileMoney: string[];
}

/** Every ISO currency the browser knows, with its usual number of decimals. */
function allCurrencies(): { code: string; name: string; digits: number }[] {
  const codes: string[] = (Intl as any).supportedValuesOf?.('currency') ?? ['GHS', 'NGN', 'KES', 'ZAR', 'XOF', 'XAF', 'USD', 'EUR', 'GBP'];
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames(['en'], { type: 'currency' });
  } catch {
    /* older browser */
  }
  return codes.map((code) => {
    let digits = 2;
    try {
      digits = new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? 2;
    } catch {
      /* keep 2 */
    }
    return { code, name: names?.of(code) ?? code, digits };
  });
}

function allTimeZones(): string[] {
  return (Intl as any).supportedValuesOf?.('timeZone') ?? ['Africa/Accra', 'Africa/Lagos', 'Africa/Nairobi', 'Africa/Johannesburg', 'UTC'];
}

export function SettingsPage() {
  const { settings, toast } = useApp();
  const qc = useQueryClient();
  const countriesQ = useQuery({ queryKey: ['countries'], queryFn: () => get<Country[]>('/api/countries'), staleTime: Infinity });
  const currencies = useMemo(allCurrencies, []);
  const zones = useMemo(allTimeZones, []);
  const init = () => ({
    ...settings,
    warning: settings.warningMinutes.join(', '),
    newProvider: '',
    blocked: (settings.chatBlockedWords ?? []).join(', '),
    creditText: settings.defaultCreditLimit ? toMajorString(settings.defaultCreditLimit, settings.currencyMinorUnits) : '',
  });
  const [f, setF] = useState(init);
  useEffect(() => setF(init()), [settings]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickCountry = (code: string) => {
    const c = countriesQ.data?.find((x) => x.code === code);
    if (!c) return setF({ ...f, countryCode: code });
    setF({
      ...f,
      countryCode: c.code,
      currencyCode: c.currency,
      currencyMinorUnits: c.minorUnits,
      timezone: c.timezone,
      phonePrefix: c.dialCode,
      mobileMoneyProviders: c.mobileMoney.length ? c.mobileMoney : f.mobileMoneyProviders,
    });
  };
  const pickCurrency = (code: string) => {
    const c = currencies.find((x) => x.code === code);
    setF({ ...f, currencyCode: code, currencyMinorUnits: c ? Math.min(3, c.digits) : f.currencyMinorUnits });
  };
  const addProvider = () => {
    const p = f.newProvider.trim();
    if (!p || f.mobileMoneyProviders.includes(p)) return;
    setF({ ...f, mobileMoneyProviders: [...f.mobileMoneyProviders, p], newProvider: '' });
  };

  const save = useMutation({
    mutationFn: () =>
      put('/api/settings', {
        centerName: f.centerName,
        countryCode: f.countryCode,
        currencyCode: f.currencyCode.toUpperCase(),
        currencyMinorUnits: Number(f.currencyMinorUnits),
        timezone: f.timezone,
        phonePrefix: f.phonePrefix,
        mobileMoneyProviders: f.mobileMoneyProviders,
        requireMomoReference: f.requireMomoReference,
        warningMinutes: f.warning
          .split(',')
          .map((x) => Number(x.trim()))
          .filter((x) => Number.isInteger(x) && x > 0),
        announceNames: f.announceNames !== false,
        requireOpenShift: f.requireOpenShift,
        defaultCreditLimit: f.creditText.trim() ? (parseMoney(f.creditText, settings.currencyMinorUnits) ?? 0) : 0,
        portalSelfStart: f.portalSelfStart !== false,
        autoPayOwed: f.autoPayOwed !== false,
        receiptHeader: f.receiptHeader,
        receiptFooter: f.receiptFooter,
        portalEnabled: f.portalEnabled,
        portalSelfSignup: f.portalSelfSignup,
        bookingsEnabled: f.bookingsEnabled,
        bookingAutoConfirm: f.bookingAutoConfirm,
        bookingMinNoticeMinutes: Number(f.bookingMinNoticeMinutes),
        bookingMaxDaysAhead: Number(f.bookingMaxDaysAhead),
        bookingGraceMinutes: Number(f.bookingGraceMinutes),
        openingTime: f.openingTime,
        closingTime: f.closingTime,
        powerOffDelaySeconds: Number(f.powerOffDelaySeconds),
        powerOffOnPause: f.powerOffOnPause,
        powerEnforce: f.powerEnforce,
        agentLockWhenIdle: f.agentLockWhenIdle,
        agentScreenOff: f.agentScreenOff,
        agentExitPin: f.agentExitPin,
        agentDockStyle: f.agentDockStyle,
        agentWeather: f.agentWeather,
        weatherLat: Number(f.weatherLat),
        weatherLon: Number(f.weatherLon),
        leaderboardPublic: f.leaderboardPublic,
        matchmakingEnabled: f.matchmakingEnabled,
        agentIslandScale: Number(f.agentIslandScale),
        requirePinFor: f.requirePinFor,
        blindShiftClose: f.blindShiftClose,
        momoAccounts: f.momoAccounts.filter((a) => a.number.trim()),
        momoTopupEnabled: f.momoTopupEnabled,
        momoAutoConfirm: f.momoAutoConfirm,
        momoAutoMax: Number(f.momoAutoMax) || 0,
        momoAutoHoursOn: f.momoAutoHoursOn,
        momoAutoFrom: f.momoAutoFrom || '06:00',
        momoAutoTo: f.momoAutoTo || '23:00',
        smsNotifyOn: f.smsNotifyOn,
        smsNotifyMomo: f.smsNotifyMomo,
        smsNotifyTopup: f.smsNotifyTopup,
        smsNotifyGame: f.smsNotifyGame,
        smsTemplateMomo: f.smsTemplateMomo,
        smsTemplateTopup: f.smsTemplateTopup,
        smsTemplateGame: f.smsTemplateGame,
        momoSmsSenders: f.momoSmsSenders,
        momoMinTopup: Number(f.momoMinTopup) || 0,
        momoMaxTopup: Number(f.momoMaxTopup) || 0,
        socialLinks: f.socialLinks,
        publicUrl: f.publicUrl.trim().replace(/\/$/, ''),
        autoBackupHours: Number(f.autoBackupHours),
        autoBackupKeep: Number(f.autoBackupKeep),
        updateRepo: f.updateRepo,
        updateBranch: f.updateBranch || 'main',
        chatEnabled: f.chatEnabled,
        chatBlockedWords: f.blocked
          .split(/[,\n]/)
          .map((w) => w.trim())
          .filter((w) => w.length >= 2),
        rewardsEnabled: f.rewardsEnabled,
        newsFeeds: f.newsFeeds,
        newsFeedCount: f.newsFeedCount,
        appearance: settings.appearance,
        social: settings.social,
        website: f.website && { ...f.website, games: f.website.games.filter((g) => g.name.trim()) },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast('success', 'Settings saved');
    },
  });

  const pinActions = useQuery({ queryKey: ['pin-actions'], queryFn: () => get<any[]>('/api/pin-actions'), staleTime: Infinity });
  const country = countriesQ.data?.find((c) => c.code === f.countryCode);
  const sample = formatMoney(1234567 * 10 ** Math.max(0, f.currencyMinorUnits - 2), f);

  return (
    <>
      <PageHeader title="Settings" />
      <AppearanceCard />
      <div className="card card-pad" style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <ErrorBox error={save.error} />
        <h2>Centre & country</h2>
        <div className="form-grid">
          <Field label="Centre name" full>
            <input className="input" value={f.centerName} onChange={(e) => setF({ ...f, centerName: e.target.value })} />
          </Field>
          <Field label="Country" full hint="Choosing a country fills in the currency, time zone, phone prefix and mobile-money networks. You can still change each one below.">
            <select className="select" value={f.countryCode} onChange={(e) => pickCountry(e.target.value)}>
              {!countriesQ.data && <option value={f.countryCode}>{f.countryCode}</option>}
              {(countriesQ.data ?? []).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} — {c.currency}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Currency" hint={`Example: ${sample}`}>
            <select className="select" value={f.currencyCode} onChange={(e) => pickCurrency(e.target.value)}>
              {!currencies.some((c) => c.code === f.currencyCode) && <option value={f.currencyCode}>{f.currencyCode}</option>}
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Decimal places" hint="Fixed once money has been recorded (amounts are stored in the smallest unit, e.g. pesewas)">
            <input className="input" type="number" min={0} max={3} value={f.currencyMinorUnits} onChange={(e) => setF({ ...f, currencyMinorUnits: Number(e.target.value) })} />
          </Field>
          <Field label="Time zone" hint="Used for 'today', reports and happy hours">
            <select className="select" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })}>
              {!zones.includes(f.timezone) && <option value={f.timezone}>{f.timezone}</option>}
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Phone prefix" hint={`Local numbers like 024… are saved as ${f.phonePrefix || '+…'}24…`}>
            <input className="input" value={f.phonePrefix} placeholder={country?.dialCode ?? '+233'} onChange={(e) => setF({ ...f, phonePrefix: e.target.value.trim() })} />
          </Field>
        </div>

        <h2>Mobile money</h2>
        <div className="muted" style={{ fontSize: 13 }}>
          Networks offered when a customer pays by mobile money. Staff pick the network and type the transaction ID, which is printed on receipts and shown in the
          transaction list for reconciliation.
        </div>
        <div className="toolbar">
          {f.mobileMoneyProviders.map((p) => (
            <span key={p} className="badge badge-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {p}
              <button
                type="button"
                aria-label={`Remove ${p}`}
                style={{ border: 0, background: 'none', color: 'inherit', cursor: 'pointer', padding: 0, display: 'flex' }}
                onClick={() => setF({ ...f, mobileMoneyProviders: f.mobileMoneyProviders.filter((x) => x !== p) })}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          {f.mobileMoneyProviders.length === 0 && <span className="dim">No networks — staff can still type one in.</span>}
        </div>
        <div className="toolbar" style={{ flexWrap: 'nowrap', maxWidth: 420 }}>
          <input
            className="input"
            placeholder="Add a network, e.g. MTN MoMo"
            value={f.newProvider}
            onChange={(e) => setF({ ...f, newProvider: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && addProvider()}
          />
          <button type="button" className="btn btn-sm" onClick={addProvider} disabled={!f.newProvider.trim()}>
            <Plus size={14} /> Add
          </button>
        </div>
        <label className="check">
          <input type="checkbox" checked={f.requireMomoReference} onChange={(e) => setF({ ...f, requireMomoReference: e.target.checked })} /> Require the transaction ID
          for every mobile-money payment
        </label>

        <h2 id="momo">MoMo top-ups without a gateway (no fees)</h2>
        <div className="muted" style={{ fontSize: 13 }}>
          Customers tap <b>Top up with MoMo</b> in the app, get a number code like <span className="mono">482193</span> (numbers only, easy on keypad phones), and send MoMo to your number with that code as the
          reference. Pair your MoMo phone below and ZENAA reads the "Payment received" SMS and credits the wallet within seconds — like a payment gateway, but the money goes
          straight to your MoMo and nobody takes a cut. Without the phone, staff confirm each one in the MoMo inbox. Help → 18.
        </div>
        {f.momoAccounts.map((a, i) => (
          <div className="form-grid" key={i} style={{ alignItems: 'end' }}>
            <Field label="Network">
              <select className="select" value={a.network} onChange={(e) => setF({ ...f, momoAccounts: f.momoAccounts.map((x, j) => (j === i ? { ...x, network: e.target.value } : x)) })}>
                {[...new Set([...f.mobileMoneyProviders, a.network])].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </Field>
            <Field label="Number customers send to">
              <input className="input mono" value={a.number} onChange={(e) => setF({ ...f, momoAccounts: f.momoAccounts.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)) })} />
            </Field>
            <Field label="Name they will see" hint="As registered on the MoMo account / merchant">
              <input className="input" value={a.name} onChange={(e) => setF({ ...f, momoAccounts: f.momoAccounts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
            </Field>
            <div>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setF({ ...f, momoAccounts: f.momoAccounts.filter((_, j) => j !== i) })}>
                <X size={14} /> Remove
              </button>
            </div>
          </div>
        ))}
        <div>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setF({ ...f, momoAccounts: [...f.momoAccounts, { network: f.mobileMoneyProviders[0] ?? 'MTN MoMo', number: '', name: f.centerName }] })}
          >
            <Plus size={14} /> Add a MoMo number
          </button>
        </div>
        <div className="form-grid">
          <label className="check">
            <input type="checkbox" checked={f.momoTopupEnabled} onChange={(e) => setF({ ...f, momoTopupEnabled: e.target.checked })} /> Customers can top up with MoMo in
            the app
          </label>
          <label className="check">
            <input type="checkbox" checked={f.momoAutoConfirm} onChange={(e) => setF({ ...f, momoAutoConfirm: e.target.checked })} /> Credit automatically when the MoMo
            phone's SMS matches (amount + code or transaction ID)
          </label>
          <Field label={`Wait for staff from this amount up (${f.currencyCode})`} hint="e.g. 300: GHS 300 and above waits for you to confirm; smaller payments go straight to the customer's wallet. 0 = no limit.">
            <input className="input" type="number" min={0} value={f.momoAutoMax / 10 ** f.currencyMinorUnits} onChange={(e) => setF({ ...f, momoAutoMax: Math.round(Number(e.target.value) * 10 ** f.currencyMinorUnits) })} />
          </Field>
          <Field label="Automatic crediting hours" hint="Outside these hours (e.g. after 11 pm) every payment waits for staff. Times are the venue's local time.">
            <div className="toolbar" style={{ flexWrap: 'nowrap' }}>
              <label className="check" style={{ whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={f.momoAutoHoursOn} onChange={(e) => setF({ ...f, momoAutoHoursOn: e.target.checked })} /> Only from
              </label>
              <input className="input" type="time" value={f.momoAutoFrom} disabled={!f.momoAutoHoursOn} onChange={(e) => setF({ ...f, momoAutoFrom: e.target.value })} />
              <span>to</span>
              <input className="input" type="time" value={f.momoAutoTo} disabled={!f.momoAutoHoursOn} onChange={(e) => setF({ ...f, momoAutoTo: e.target.value })} />
            </div>
          </Field>
          <Field label={`Smallest / largest top-up (${f.currencyCode})`}>
            <div className="toolbar" style={{ flexWrap: 'nowrap' }}>
              <input className="input" type="number" min={0} value={f.momoMinTopup / 10 ** f.currencyMinorUnits} onChange={(e) => setF({ ...f, momoMinTopup: Math.round(Number(e.target.value) * 10 ** f.currencyMinorUnits) })} />
              <input className="input" type="number" min={0} value={f.momoMaxTopup / 10 ** f.currencyMinorUnits} onChange={(e) => setF({ ...f, momoMaxTopup: Math.round(Number(e.target.value) * 10 ** f.currencyMinorUnits) })} />
            </div>
          </Field>
          <Field label="Trusted SMS senders" full hint="The name the MoMo service's SMS comes from on your phone (comma separated). Texts from ordinary phone numbers are never trusted.">
            <input className="input" value={f.momoSmsSenders.join(', ')} onChange={(e) => setF({ ...f, momoSmsSenders: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} />
          </Field>
        </div>
        <MomoRelay />

        <h3 style={{ margin: '8px 0 0' }}>Thank-you SMS to customers</h3>
        <div className="muted" style={{ fontSize: 13 }}>
          Sent as a normal SMS <b>from the MoMo phone</b> (ZENAA MoMo app 1.2 or newer), to the phone number on the customer's account. Each SMS costs that SIM's normal SMS
          price. Words in braces are filled in: <span className="mono">{'{name} {amount} {balance} {centre} {station}'}</span>. Keep messages under 160 characters so
          each is one SMS.
        </div>
        <label className="check">
          <input type="checkbox" checked={f.smsNotifyOn} onChange={(e) => setF({ ...f, smsNotifyOn: e.target.checked })} /> Send thank-you SMS
        </label>
        {f.smsNotifyOn && (
          <div className="form-grid">
            {(
              [
                ['smsNotifyMomo', 'smsTemplateMomo', 'When a MoMo top-up is credited'],
                ['smsNotifyTopup', 'smsTemplateTopup', 'When staff add money at the counter'],
                ['smsNotifyGame', 'smsTemplateGame', 'When a customer pays for a game'],
              ] as const
            ).map(([on, tpl, label]) => (
              <Field key={tpl} label={label} full hint={`${f[tpl].length} characters${f[tpl].length > 160 ? ' — longer than one SMS (costs 2)' : ''}`}>
                <label className="check">
                  <input type="checkbox" checked={f[on]} onChange={(e) => setF({ ...f, [on]: e.target.checked })} /> Send
                </label>
                <textarea className="input" rows={2} maxLength={300} value={f[tpl]} disabled={!f[on]} onChange={(e) => setF({ ...f, [tpl]: e.target.value })} />
              </Field>
            ))}
          </div>
        )}
        <TestSms />

        <h2>Operations & receipts</h2>
        <div className="form-grid">
          <Field label="Low-time alerts (minutes before end)" full hint="Comma separated, e.g. 5, 1">
            <input className="input" value={f.warning} onChange={(e) => setF({ ...f, warning: e.target.value })} />
          </Field>
          <label className="check" style={{ gridColumn: '1 / -1' }}>
            <input type="checkbox" checked={f.announceNames !== false} onChange={(e) => setF({ ...f, announceNames: e.target.checked })} /> Counter speaker calls the
            player's first name (e.g. "Kofi, PS5 One, 5 minutes remaining" and "Kofi, your promo bonus has been added")
          </label>
          <Field label="Receipt header" full hint="Printed under the centre name — address, phone, etc.">
            <textarea className="textarea" value={f.receiptHeader} maxLength={300} onChange={(e) => setF({ ...f, receiptHeader: e.target.value })} />
          </Field>
          <Field label="Receipt footer" full>
            <input className="input" value={f.receiptFooter} maxLength={300} onChange={(e) => setF({ ...f, receiptFooter: e.target.value })} />
          </Field>
          <label className="check" style={{ gridColumn: '1 / -1' }}>
            <input type="checkbox" checked={f.requireOpenShift} onChange={(e) => setF({ ...f, requireOpenShift: e.target.checked })} /> Staff must open a shift (cash
            drawer) before taking or refunding money — recommended once everyone is used to shifts
          </label>
          <Field
            label={`Pay later: credit limit for every customer (${settings.currencyCode})`}
            full
            hint="The most a customer may owe on their account when they have no limit of their own (set one on the customer page to change it for that person). Empty or 0 = only customers with their own limit can pay later."
          >
            <input className="input" inputMode="decimal" style={{ maxWidth: 200 }} value={f.creditText} onChange={(e) => setF({ ...f, creditText: e.target.value })} placeholder="0" />
          </Field>
          <label className="check" style={{ gridColumn: '1 / -1' }}>
            <input type="checkbox" checked={f.autoPayOwed !== false} onChange={(e) => setF({ ...f, autoPayOwed: e.target.checked })} /> Money put into a customer's wallet (cash at
            the counter, MoMo code, Paystack) first pays what they owe on their account
          </label>
        </div>

        <h2 id="pins">Staff PINs & approvals</h2>
        <div className="muted" style={{ fontSize: 13 }}>
          Everyone sets a PIN under <b>My PIN</b> (bottom of the menu); admins can set them in Users & roles. When someone lacks a permission, a manager types their PIN to
          approve (recorded as "approved by"). Tick an action to <b>always</b> ask for a PIN, even for people who have the permission.
        </div>
        <div className="form-grid">
          {(pinActions.data ?? []).map((a: any) => (
            <label className="check" key={a.key}>
              <input
                type="checkbox"
                checked={f.requirePinFor.includes(a.key)}
                onChange={(e) => setF({ ...f, requirePinFor: e.target.checked ? [...f.requirePinFor, a.key] : f.requirePinFor.filter((x) => x !== a.key) })}
              />{' '}
              {a.label}
            </label>
          ))}
          <label className="check" style={{ gridColumn: '1 / -1' }}>
            <input type="checkbox" checked={f.blindShiftClose} onChange={(e) => setF({ ...f, blindShiftClose: e.target.checked })} /> Blind cash count: staff count the drawer
            before they see the expected amount
          </label>
        </div>

        <h2>Customer portal & bookings</h2>
        <div className="muted" style={{ fontSize: 13 }}>
          Customers sign in at <strong>{window.location.origin}/portal</strong> to see their wallet, top up with Paystack and book stations.
        </div>
        <div className="form-grid">
          <label className="check">
            <input type="checkbox" checked={f.portalEnabled} onChange={(e) => setF({ ...f, portalEnabled: e.target.checked })} /> Customer portal is on
          </label>
          <label className="check">
            <input type="checkbox" checked={f.portalSelfSignup} onChange={(e) => setF({ ...f, portalSelfSignup: e.target.checked })} /> Customers can create their own
            account (otherwise staff give an activation code)
          </label>
          <label className="check">
            <input type="checkbox" checked={f.bookingsEnabled} onChange={(e) => setF({ ...f, bookingsEnabled: e.target.checked })} /> Online booking is on
          </label>
          <label className="check">
            <input type="checkbox" checked={f.bookingAutoConfirm} onChange={(e) => setF({ ...f, bookingAutoConfirm: e.target.checked })} /> Confirm online bookings
            automatically (otherwise staff confirm each one)
          </label>
          <Field label="Opening time">
            <input className="input" type="time" value={f.openingTime} onChange={(e) => setF({ ...f, openingTime: e.target.value })} />
          </Field>
          <Field label="Closing time" hint="Earlier than opening = closes after midnight. Same as opening = open 24 hours.">
            <input className="input" type="time" value={f.closingTime} onChange={(e) => setF({ ...f, closingTime: e.target.value })} />
          </Field>
          <Field label="Minimum notice (minutes)">
            <input className="input" type="number" min={0} max={1440} value={f.bookingMinNoticeMinutes} onChange={(e) => setF({ ...f, bookingMinNoticeMinutes: Number(e.target.value) })} />
          </Field>
          <Field label="Book up to (days ahead)">
            <input className="input" type="number" min={1} max={90} value={f.bookingMaxDaysAhead} onChange={(e) => setF({ ...f, bookingMaxDaysAhead: Number(e.target.value) })} />
          </Field>
          <label className="check" style={{ gridColumn: '1 / -1' }}>
            <input type="checkbox" checked={f.portalSelfStart !== false} onChange={(e) => setF({ ...f, portalSelfStart: e.target.checked })} /> Customers can start, pause and stop
            their own time from the app (a paid booking, or their saved time on a free station). Paying is never done from here — only time that is already paid.
          </label>
          <Field label="No-show after (minutes late)" hint="Bookings not checked in by then free the station">
            <input className="input" type="number" min={5} max={240} value={f.bookingGraceMinutes} onChange={(e) => setF({ ...f, bookingGraceMinutes: Number(e.target.value) })} />
          </Field>
        </div>

        <h2 id="socials">Socials & public address</h2>
        <div className="form-grid">
          <Field label="Public address of the customer app" full hint="Used for QR posters. e.g. http://192.168.1.10:8080 (Wi-Fi only) or your https address. Empty = this address.">
            <input className="input mono" value={f.publicUrl} onChange={(e) => setF({ ...f, publicUrl: e.target.value })} placeholder={window.location.origin} />
          </Field>
          {(['youtube', 'tiktok', 'instagram', 'facebook', 'x', 'snapchat', 'whatsapp', 'website'] as const).map((k) => (
            <Field key={k} label={k === 'x' ? 'X (Twitter)' : k === 'whatsapp' ? 'WhatsApp (channel / chat link)' : k[0].toUpperCase() + k.slice(1)}>
              <input className="input" value={f.socialLinks[k] ?? ''} onChange={(e) => setF({ ...f, socialLinks: { ...f.socialLinks, [k]: e.target.value } })} placeholder="https://…" />
            </Field>
          ))}
        </div>

        {f.website && <WebsiteFields value={f.website} onChange={(website) => setF({ ...f, website })} />}

        <h2>Smart plugs (station power)</h2>
        <div className="muted" style={{ fontSize: 13 }}>
          Set the plug for each station under Stations → edit (pencil). Help & guides → Smart devices explains every supported plug, SONOFF and DIY board.
        </div>
        <div className="form-grid">
          <Field label="Switch off after session ends (seconds)" hint="A short delay lets players see the end screen">
            <input className="input" type="number" min={0} max={600} value={f.powerOffDelaySeconds} onChange={(e) => setF({ ...f, powerOffDelaySeconds: Number(e.target.value) })} />
          </Field>
          <div />
          <label className="check">
            <input type="checkbox" checked={f.powerOffOnPause} onChange={(e) => setF({ ...f, powerOffOnPause: e.target.checked })} /> Switch off while a session is
            paused
          </label>
          <label className="check">
            <input type="checkbox" checked={f.powerEnforce} onChange={(e) => setF({ ...f, powerEnforce: e.target.checked })} /> Every minute, switch off stations
            that have no session (stops free play). Stations in Maintenance are left alone.
          </label>
        </div>
        <h2>Station screen apps (PC, Android TV, PS4/PS5)</h2>
        <div className="muted" style={{ fontSize: 13 }}>
          Pair a screen under Stations → edit → Station screen. Download the apps in Integrations → Station screen apps.
        </div>
        <div className="form-grid">
          <label className="check">
            <input type="checkbox" checked={f.agentLockWhenIdle} onChange={(e) => setF({ ...f, agentLockWhenIdle: e.target.checked })} /> Cover the screen when no session
            is running ("See the counter to play")
          </label>
          <label className="check">
            <input type="checkbox" checked={f.agentScreenOff} onChange={(e) => setF({ ...f, agentScreenOff: e.target.checked })} /> Android TV: also switch the TV panel
            off when time is up
          </label>
          <Field label="Shared exit PIN (backup)" hint="Staff normally use their own PIN on the screen (PC: Ctrl+Shift+F12, TV: type it on the cover). This shared PIN also works on every screen, online or offline (offline it unlocks 10 minutes). Empty = none.">
            <input className="input mono" inputMode="numeric" maxLength={8} value={f.agentExitPin} onChange={(e) => setF({ ...f, agentExitPin: e.target.value.replace(/\D/g, '') })} />
          </Field>
          <Field label="Timer look" hint="Island = a small pill at the top centre of the screen (like a phone's dynamic island). Corner = the classic box.">
            <select className="input" value={f.agentDockStyle} onChange={(e) => setF({ ...f, agentDockStyle: e.target.value as 'island' | 'corner' })}>
              <option value="island">Island (top centre)</option>
              <option value="corner">Corner box</option>
            </select>
          </Field>
          <Field label={`Island size: ${f.agentIslandScale}%`} hint="Smaller = less of the game covered. Same design. Applies to PC and Android TV within a few seconds.">
            <input type="range" min={40} max={100} step={5} value={f.agentIslandScale} onChange={(e) => setF({ ...f, agentIslandScale: Number(e.target.value) })} />
          </Field>
          <label className="check">
            <input type="checkbox" checked={f.agentWeather} onChange={(e) => setF({ ...f, agentWeather: e.target.checked })} /> Show the outside temperature in the
            island (needs internet on the server; free Open-Meteo service, no account)
          </label>
          {f.agentWeather && (
            <>
              <Field label="Venue latitude" hint="Default: Accra. Copy from Google Maps (right-click the venue).">
                <input className="input mono" inputMode="decimal" value={String(f.weatherLat)} onChange={(e) => setF({ ...f, weatherLat: e.target.value as unknown as number })} />
              </Field>
              <Field label="Venue longitude">
                <input className="input mono" inputMode="decimal" value={String(f.weatherLon)} onChange={(e) => setF({ ...f, weatherLon: e.target.value as unknown as number })} />
              </Field>
            </>
          )}
        </div>

        <h2 id="backup">Backups</h2>
        <div className="form-grid">
          <Field label="Automatic backup every (hours)" hint="0 = off. Files go to the backups folder on the server PC (Backup & updates page).">
            <input className="input" type="number" min={0} max={168} value={f.autoBackupHours} onChange={(e) => setF({ ...f, autoBackupHours: Number(e.target.value) })} />
          </Field>
          <Field label="Keep the last">
            <input className="input" type="number" min={1} max={365} value={f.autoBackupKeep} onChange={(e) => setF({ ...f, autoBackupKeep: Number(e.target.value) })} />
          </Field>
        </div>

        <h2 id="system">Updates</h2>
        <div className="form-grid">
          <Field label="GitHub repository" hint="owner/name, e.g. yourname/zenaa-gamehub — set this when the project is on GitHub">
            <input className="input mono" value={f.updateRepo} onChange={(e) => setF({ ...f, updateRepo: e.target.value.trim() })} placeholder="owner/repository" />
          </Field>
          <Field label="Branch">
            <input className="input mono" value={f.updateBranch} onChange={(e) => setF({ ...f, updateBranch: e.target.value.trim() })} />
          </Field>
        </div>

        <h2>Competitions</h2>
        <div className="form-grid">
          <label className="check">
            <input type="checkbox" checked={f.leaderboardPublic} onChange={(e) => setF({ ...f, leaderboardPublic: e.target.checked })} /> Leaderboard and tournaments are
            public (venue TV board at {window.location.origin}/board, portal visitors)
          </label>
          <label className="check">
            <input type="checkbox" checked={f.matchmakingEnabled} onChange={(e) => setF({ ...f, matchmakingEnabled: e.target.checked })} /> Customers can use Find match
            in the portal
          </label>
        </div>

        <h2 id="chat">Customer chat & rewards</h2>
        <div className="form-grid">
          <label className="check">
            <input type="checkbox" checked={f.chatEnabled} onChange={(e) => setF({ ...f, chatEnabled: e.target.checked })} /> Customers can chat in the app (Lobby for
            everyone + private messages). Staff read and moderate it under Customers → Chat.
          </label>
          <label className="check">
            <input type="checkbox" checked={f.rewardsEnabled} onChange={(e) => setF({ ...f, rewardsEnabled: e.target.checked })} /> Show the Rewards page (follow us for a
            bonus, bonus codes, promo codes). Set the rewards under Customers → Rewards.
          </label>
          <Field label="Blocked words" full hint="Separated by commas. They show as *** in chat messages, and outside news stories that contain one are not shown.">
            <textarea className="textarea" rows={2} value={f.blocked} onChange={(e) => setF({ ...f, blocked: e.target.value })} placeholder="e.g. insult1, insult2" />
          </Field>
        </div>
        <div>
          <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
            Save settings
          </button>
        </div>
      </div>
      <PaystackSettings />
      <ChangePassword />
    </>
  );
}

function ChangePassword() {
  const { toast } = useApp();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const m = useMutation({
    mutationFn: () => post('/api/auth/change-password', { currentPassword: cur, newPassword: next }),
    onSuccess: (r: any) => {
      setToken(r.token);
      setCur('');
      setNext('');
      toast('success', 'Password changed');
    },
  });
  return (
    <div className="card card-pad" style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2>Change my password</h2>
      <ErrorBox error={m.error} />
      <div className="form-grid">
        <Field label="Current password">
          <PasswordInput className="input" value={cur} onChange={(e) => setCur(e.target.value)} />
        </Field>
        <Field label="New password" hint="At least 8 characters">
          <PasswordInput className="input" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
      </div>
      <div>
        <button className="btn" disabled={!cur || next.length < 8 || m.isPending} onClick={() => m.mutate()}>
          Change password
        </button>
      </div>
    </div>
  );
}

function PaystackSettings() {
  const { toast, settings } = useApp();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['paystack-config'], queryFn: () => get('/api/integrations/paystack') });
  const [f, setF] = useState<{ enabled: boolean; publicKey: string; secretKey: string; callbackBaseUrl: string } | null>(null);
  useEffect(() => {
    if (q.data && !f) setF({ enabled: q.data.enabled, publicKey: q.data.publicKey, secretKey: '', callbackBaseUrl: q.data.callbackBaseUrl });
  }, [q.data, f]);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const save = useMutation({
    mutationFn: () => put('/api/integrations/paystack', { ...f, secretKey: f!.secretKey.trim() || undefined }),
    onSuccess: (r: any) => {
      qc.setQueryData(['paystack-config'], r);
      qc.invalidateQueries({ queryKey: ['paystack-status'] });
      setF((x) => (x ? { ...x, secretKey: '' } : x));
      toast('success', 'Paystack settings saved');
    },
  });
  const test = useMutation({ mutationFn: () => post('/api/integrations/paystack/test'), onSuccess: setResult, onError: (e: Error) => setResult({ ok: false, message: e.message }) });
  if (!f) return null;
  const supported = ['GHS', 'NGN', 'KES', 'ZAR', 'USD', 'XOF', 'EGP', 'RWF'].includes(settings.currencyCode);
  return (
    <div className="card card-pad" style={{ maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <ErrorBox error={save.error} />
      <div className="toolbar">
        <h2>Paystack (online payments)</h2>
        {q.data?.mode && <span className={`badge ${q.data.mode === 'live' ? 'badge-success' : 'badge-warning'}`}>{q.data.mode === 'live' ? 'LIVE' : 'TEST mode'}</span>}
      </div>
      <div className="muted" style={{ fontSize: 13 }}>
        Customers top up their wallet by card or mobile money — in the customer portal, or by scanning a QR code at the counter. Get your keys from the Paystack
        dashboard → Settings → API Keys & Webhooks. Start with the <strong>test</strong> keys. Guide: <strong>docs/07-paystack.md</strong>.
      </div>
      {!supported && <div className="error-box">Paystack may not support {settings.currencyCode}. It works in Ghana, Nigeria, Kenya, South Africa, Côte d'Ivoire and a few others.</div>}
      <label className="check">
        <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} /> Accept payments through Paystack
      </label>
      <div className="form-grid">
        <Field label="Public key">
          <input className="input mono" value={f.publicKey} onChange={(e) => setF({ ...f, publicKey: e.target.value.trim() })} placeholder="pk_test_…" />
        </Field>
        <Field label="Secret key" hint={q.data?.hasSecretKey ? `Saved (${q.data.secretKeyHint}) — leave blank to keep it` : 'Never shown again after saving'}>
          <PasswordInput className="input mono" autoComplete="off" value={f.secretKey} onChange={(e) => setF({ ...f, secretKey: e.target.value.trim() })} placeholder="sk_test_…" />
        </Field>
        <Field label="Public address of this system (optional)" full hint="Where Paystack sends customers back after paying, e.g. https://zenaa.example.com. Leave blank to use the address they opened.">
          <input className="input" value={f.callbackBaseUrl} onChange={(e) => setF({ ...f, callbackBaseUrl: e.target.value.trim() })} placeholder="https://…" />
        </Field>
        <Field label="Webhook URL (paste into Paystack)" full hint="Only works once the system is reachable from the internet. Without it, payments are still confirmed automatically within a minute or two.">
          <input className="input mono" readOnly value={`${f.callbackBaseUrl || window.location.origin}/api/paystack/webhook`} onFocus={(e) => e.target.select()} />
        </Field>
      </div>
      <div className="toolbar">
        <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
          Save Paystack
        </button>
        <button className="btn" disabled={test.isPending || !q.data?.hasSecretKey} onClick={() => test.mutate()}>
          Test connection
        </button>
        {result && <span style={{ fontSize: 13, color: result.ok ? 'var(--success)' : 'var(--danger)' }}>{result.message}</span>}
      </div>
    </div>
  );
}

/** Pair the venue's MoMo phone (ZENAA MoMo Relay app), or get a webhook link for another SMS-forwarder app. */
function TestSms() {
  const [phone, setPhone] = useState('');
  const [done, setDone] = useState(false);
  const send = useMutation({ mutationFn: () => post('/api/momo/outbox/test', { phone }), onSuccess: () => setDone(true) });
  return (
    <div className="toolbar">
      <input className="input mono" style={{ maxWidth: 200 }} placeholder="Your phone, e.g. 0241234567" value={phone} onChange={(e) => (setPhone(e.target.value), setDone(false))} />
      <button type="button" className="btn btn-sm" onClick={() => send.mutate()} disabled={send.isPending || phone.trim().length < 9}>
        Send a test SMS
      </button>
      {done && <span className="dim" style={{ fontSize: 13 }}>Queued — the MoMo phone sends it within a few seconds. See MoMo inbox → Thank-you SMS.</span>}
      <ErrorBox error={send.error} />
    </div>
  );
}

function MomoRelay() {
  const qc = useQueryClient();
  const devices = useQuery({ queryKey: ['momo', 'relay'], queryFn: () => get<any[]>('/api/momo/relay') });
  const [code, setCode] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const pair = useMutation({ mutationFn: () => post('/api/momo/relay/code'), onSuccess: (r: any) => setCode(r.code) });
  const makeLink = useMutation({
    mutationFn: () => post('/api/momo/relay/link', { device: 'SMS forwarder app' }),
    onSuccess: (r: any) => {
      setLink(`${window.location.origin}${r.path}`);
      qc.invalidateQueries({ queryKey: ['momo', 'relay'] });
    },
  });
  const remove = useMutation({ mutationFn: (id: string) => del(`/api/momo/relay/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['momo', 'relay'] }) });
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--surface-2)' }}>
      <strong>The MoMo phone (reads "Payment received" SMS)</strong>
      <div className="dim" style={{ fontSize: 13 }}>
        Install <b>ZenaaMoMo.apk</b> (Integrations → downloads) on the Android phone that holds your MoMo SIM, open it, type this server's address and the 6-digit code.
      </div>
      <ErrorBox error={pair.error || makeLink.error || remove.error} />
      <div className="toolbar">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => pair.mutate()} disabled={pair.isPending}>
          Pair the MoMo phone
        </button>
        <button type="button" className="btn btn-sm" onClick={() => makeLink.mutate()} disabled={makeLink.isPending}>
          Link for another SMS-forwarder app
        </button>
      </div>
      {code && (
        <div className="alert alert-success">
          Code: <b className="mono" style={{ fontSize: 22, letterSpacing: 3 }}>{code}</b> (10 minutes). Server address for the app: <span className="mono">{window.location.origin}</span>
        </div>
      )}
      {link && (
        <div className="alert alert-info" style={{ wordBreak: 'break-all' }}>
          Webhook URL (POST, JSON with "from" and "body"; shown once — keep it secret): <span className="mono">{link}</span>
        </div>
      )}
      {(devices.data ?? []).map((d: any) => (
        <div key={d.id} className="toolbar">
          <span className="badge badge-success">Paired</span> {d.device}
          <span className="dim" style={{ fontSize: 12 }}>
            {d.lastSeenAt ? `last message/check ${new Date(d.lastSeenAt).toLocaleString()}` : 'not heard from yet'}
          </span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => remove.mutate(d.id)}>
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

/** Settings → Public home page (the page visitors and Google see at the main address). */
function WebsiteFields({ value: w, onChange }: { value: WebsiteSettings; onChange: (w: WebsiteSettings) => void }) {
  const set = (p: Partial<WebsiteSettings>) => onChange({ ...w, ...p });
  const setGame = (i: number, p: Partial<WebsiteGame>) => set({ games: w.games.map((g, j) => (j === i ? { ...g, ...p } : g)) });
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= w.games.length) return;
    const g = [...w.games];
    [g[i], g[j]] = [g[j], g[i]];
    set({ games: g });
  };
  return (
    <>
      <h2 id="website">Public home page</h2>
      <div className="muted" style={{ fontSize: 13 }}>
        What visitors and Google see at your main address before signing in. Buttons on it open the customer app; staff use the small "Staff" link at the bottom, or{' '}
        <span className="mono">/login</span>.{' '}
        <a href="/home" target="_blank" rel="noreferrer">
          Open the home page ↗
        </a>
      </div>
      <div className="form-grid">
        <label className="check" style={{ gridColumn: '1 / -1' }}>
          <input type="checkbox" checked={w.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> Show the home page (off = the main address opens the staff sign-in)
        </label>
        <Field label="Big headline">
          <input className="input" maxLength={80} value={w.tagline} onChange={(e) => set({ tagline: e.target.value })} placeholder="Play. Compete. Win." />
        </Field>
        <Field label="Short intro" hint="Under the headline. Google may show it in search results.">
          <input className="input" maxLength={300} value={w.intro} onChange={(e) => set({ intro: e.target.value })} />
        </Field>
        <Field label="About us" full hint="An empty line starts a new paragraph.">
          <textarea className="input" rows={5} maxLength={2000} value={w.about} onChange={(e) => set({ about: e.target.value })} />
        </Field>
        <Field label="Address / location" hint="Shown under Find us and used to place the Google map, e.g. Madina Zongo Junction, Accra.">
          <input className="input" maxLength={200} value={w.address} onChange={(e) => set({ address: e.target.value })} />
        </Field>
        <Field label="Google Maps link (optional)" hint="Google Maps → your place → Share → Copy link. Used for the Directions button.">
          <input className="input" maxLength={300} value={w.mapsLink} onChange={(e) => set({ mapsLink: e.target.value })} placeholder="https://maps.app.goo.gl/…" />
        </Field>
        <Field label="Phone">
          <input className="input" maxLength={30} value={w.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="024 000 0000" />
        </Field>
        <Field label="Email">
          <input className="input" type="email" maxLength={120} value={w.email} onChange={(e) => set({ email: e.target.value })} />
        </Field>
      </div>
      <h3 style={{ margin: '14px 0 6px' }}>Game cards</h3>
      <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
        Clicking a card opens the customer app (booking, if bookings are on). Picture is optional: an https:// address of a cover image you may use; empty = a coloured card.
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {w.games.map((g, i) => (
          <div key={i} className="toolbar" style={{ flexWrap: 'wrap', gap: 6 }}>
            <input className="input" style={{ flex: '2 1 160px' }} maxLength={40} value={g.name} onChange={(e) => setGame(i, { name: e.target.value })} placeholder="Game name" />
            <input className="input" style={{ flex: '1 1 120px' }} maxLength={30} value={g.tag} onChange={(e) => setGame(i, { tag: e.target.value })} placeholder="Type, e.g. Racing" />
            <input className="input" style={{ flex: '3 1 200px' }} maxLength={500} value={g.image} onChange={(e) => setGame(i, { image: e.target.value })} placeholder="Picture https://… (optional)" />
            <button type="button" className="btn btn-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
              ↑
            </button>
            <button type="button" className="btn btn-sm" onClick={() => move(i, 1)} disabled={i === w.games.length - 1} aria-label="Move down">
              ↓
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => set({ games: w.games.filter((_, j) => j !== i) })}>
              Remove
            </button>
          </div>
        ))}
        {w.games.length < 24 && (
          <div>
            <button type="button" className="btn btn-sm" onClick={() => set({ games: [...w.games, { name: '', tag: '', image: '' }] })}>
              + Add game
            </button>
          </div>
        )}
      </div>
    </>
  );
}
