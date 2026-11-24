import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Gamepad2, Gift, Home, LayoutGrid, LogOut, Medal, Megaphone, MessagesSquare, Swords, Trophy, User, Wallet, Zap } from 'lucide-react';
import { MorePage, PortalChat, PortalRewards, RewardsTeaser, useChatUnread } from './PortalCommunity';
import { MomoTopup, NewsFeed, NewsPreview } from './PortalExtras';
import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { ErrorBox, Field, StatusBadge, PasswordInput } from '../components/ui';
import { formatDateTime, formatMinutes, formatMoney, formatTime, PLATFORM_LABEL, parseMoney } from '../lib/format';
import { ThemeToggle } from '../lib/theme';
import { getPortalToken, onPortalSignedOut, papi, pdel, pget, ppatch, ppost, setPortalToken } from './portal-api';
import { InstallButton, isStandalone, setupPwa } from '../lib/pwa';
import { Avatar } from '../competitions/ui';
import { CompeteTeaser, PortalFindMatch, PortalLeaderboard, PortalTournament, PortalTournaments } from './PortalCompete';
import { BookingActions, BookingPayChoice, MainBalance, MyPlayCard, NotificationsCard, PayOwedCard, SavedTimeCard } from './PortalPlay';

interface Info {
  centerName: string;
  countryCode: string;
  currencyCode: string;
  currencyMinorUnits: number;
  phonePrefix: string;
  portalEnabled: boolean;
  selfSignup: boolean;
  bookingsEnabled: boolean;
  bookingMinNoticeMinutes: number;
  bookingMaxDaysAhead: number;
  openingTime: string;
  closingTime: string;
  paystackEnabled: boolean;
  receiptHeader: string;
  leaderboardPublic: boolean;
  matchmakingEnabled: boolean;
  momoTopupEnabled?: boolean;
  socialLinks?: Record<string, string>;
  chatEnabled?: boolean;
  rewardsEnabled?: boolean;
  selfStart?: boolean;
  autoPayOwed?: boolean;
}

interface PortalCtx {
  info: Info;
  money(minor: number | null | undefined): string;
  signIn(token: string): void;
  signOut(): void;
}
const Ctx = createContext<PortalCtx>(null as unknown as PortalCtx);
const usePortal = () => useContext(Ctx);

export function PortalApp() {
  const qc = useQueryClient();
  const [token, setTok] = useState(getPortalToken);
  const infoQ = useQuery({
    queryKey: ['portal', 'info'],
    queryFn: () => pget<Info>('/api/portal/info'),
    staleTime: 60_000,
  });
  useEffect(() => {
    onPortalSignedOut(() => setTok(null));
    setupPwa('portal');
  }, []);
  if (infoQ.error)
    return (
      <Centered>
        <ErrorBox error={infoQ.error} />
      </Centered>
    );
  if (!infoQ.data)
    return (
      <Centered>
        <span className="muted">Loading…</span>
      </Centered>
    );
  const info = infoQ.data;
  const value: PortalCtx = {
    info,
    money: (m) => formatMoney(m, info),
    signIn: (t) => {
      setPortalToken(t);
      setTok(t);
    },
    signOut: () => {
      setPortalToken(null);
      setTok(null);
      qc.removeQueries({ queryKey: ['portal', 'me'] });
    },
  };
  return (
    <Ctx.Provider value={value}>
      <Routes>
        {/* Paystack sends customers here after paying — works even when signed out. */}
        <Route path="portal/paid" element={<PaidPage />} />
        <Route path="*" element={!info.portalEnabled ? <Closed /> : token ? <Signed /> : <AuthScreen />} />
      </Routes>
    </Ctx.Provider>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="login-wrap">{children}</div>;
}

function Brand({ sub }: { sub?: string }) {
  const { info } = usePortal();
  return (
    <div className="brand">
      <div className="brand-mark">
        <Zap size={18} />
      </div>
      <div>
        {info.centerName}
        <small>{sub ?? 'Player portal'}</small>
      </div>
    </div>
  );
}

function Closed() {
  return (
    <Centered>
      <div className="card login-card">
        <Brand />
        <p className="muted">The customer portal is not available right now. Please ask at the counter.</p>
      </div>
    </Centered>
  );
}

// ───────────────────────── Sign in / sign up / activate ─────────────────────────

function AuthScreen() {
  const { info, signIn } = usePortal();
  // QR posters link to /portal?signup to open the sign-up form straight away.
  const [mode, setMode] = useState<'login' | 'signup' | 'code'>(() => (new URLSearchParams(window.location.search).has('signup') && info.selfSignup ? 'signup' : 'login'));
  const [f, setF] = useState({
    login: '',
    password: '',
    fullName: '',
    phone: '',
    email: '',
    code: '',
    confirm: '',
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode !== 'login' && f.password !== f.confirm) return setError(new Error('The two passwords do not match'));
    setBusy(true);
    try {
      const r =
        mode === 'login'
          ? await ppost('/api/portal/login', {
              login: f.login,
              password: f.password,
            })
          : mode === 'signup'
            ? await ppost('/api/portal/signup', {
                fullName: f.fullName,
                phone: f.phone,
                email: f.email,
                password: f.password,
              })
            : await ppost('/api/portal/activate', {
                phone: f.phone,
                code: f.code,
                password: f.password,
              });
      signIn(r.token);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const phoneHint = `e.g. 0${info.countryCode === 'GH' ? '24 123 4567' : '…'} — ${info.phonePrefix} is added for you`;
  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit} style={{ maxWidth: 420 }}>
        <div className="toolbar">
          <Brand />
          <div className="spacer" />
          <ThemeToggle />
        </div>
        <div className="tabs">
          <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>
            Sign in
          </button>
          {info.selfSignup && (
            <button type="button" className={mode === 'signup' ? 'on' : ''} onClick={() => setMode('signup')}>
              Create account
            </button>
          )}
          <button type="button" className={mode === 'code' ? 'on' : ''} onClick={() => setMode('code')}>
            I have a code
          </button>
        </div>
        <ErrorBox error={error} />
        {mode === 'login' && (
          <>
            <Field label="Phone number or email">
              <input className="input" autoFocus autoComplete="username" value={f.login} onChange={set('login')} required />
            </Field>
            <Field label="Password">
              <PasswordInput className="input" autoComplete="current-password" value={f.password} onChange={set('password')} required />
            </Field>
            <div className="hint">Forgot your password? Ask staff at the counter for a code, then use “I have a code”.</div>
          </>
        )}
        {mode === 'signup' && (
          <>
            <Field label="Full name">
              <input className="input" autoFocus autoComplete="name" value={f.fullName} onChange={set('fullName')} required />
            </Field>
            <Field label="Phone number" hint={phoneHint}>
              <input className="input" inputMode="tel" autoComplete="tel" value={f.phone} onChange={set('phone')} required />
            </Field>
            <Field label="Email (optional)" hint="Needed for online payment receipts">
              <input className="input" type="email" autoComplete="email" value={f.email} onChange={set('email')} />
            </Field>
          </>
        )}
        {mode === 'code' && (
          <>
            <div className="hint">Already registered at the counter, or resetting your password? Staff give you a 6-digit code.</div>
            <Field label="Phone number" hint={phoneHint}>
              <input className="input" inputMode="tel" autoFocus value={f.phone} onChange={set('phone')} required />
            </Field>
            <Field label="6-digit code">
              <input className="input mono" inputMode="numeric" maxLength={6} value={f.code} onChange={set('code')} required />
            </Field>
          </>
        )}
        {mode !== 'login' && (
          <>
            <Field label="Choose a password" hint="At least 8 characters">
              <PasswordInput className="input" autoComplete="new-password" value={f.password} onChange={set('password')} minLength={8} required />
            </Field>
            <Field label="Repeat password">
              <PasswordInput className="input" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} minLength={8} required />
            </Field>
          </>
        )}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create my account' : 'Activate & sign in'}
        </button>
        <InstallButton compact label="Install the app on this phone" />
        <a href="/" className="dim" style={{ fontSize: 12, textAlign: 'center' }}>
          Staff sign-in
        </a>
      </form>
    </div>
  );
}

// ───────────────────────── Signed-in shell ─────────────────────────

function useMe() {
  return useQuery({
    queryKey: ['portal', 'me'],
    queryFn: () => pget('/api/portal/me'),
    refetchInterval: 30_000,
  });
}

function Signed() {
  const { info, signOut, money } = usePortal();
  const me = useMe();
  const unread = useChatUnread(!!info.chatEnabled && !!me.data);
  const dot = (n: number) => (n > 0 ? <span className="nav-count">{n}</span> : undefined);
  const nav: {
    to: string;
    label: string;
    icon: any;
    end: boolean;
    badge?: ReactNode;
  }[] = [
    { to: '/portal', label: 'Home', icon: Home, end: true },
    { to: '/portal/news', label: 'News', icon: Megaphone, end: false },
    ...(info.bookingsEnabled ? [{ to: '/portal/book', label: 'Book', icon: CalendarDays, end: false }] : []),
    ...(info.matchmakingEnabled ? [{ to: '/portal/match', label: 'Match', icon: Swords, end: false }] : []),
    ...(info.chatEnabled
      ? [
          {
            to: '/portal/chat',
            label: 'Chat',
            icon: MessagesSquare,
            end: false,
            badge: dot(unread.dms),
          },
        ]
      : []),
    { to: '/portal/ranks', label: 'Ranks', icon: Medal, end: false },
    { to: '/portal/cups', label: 'Cups', icon: Trophy, end: false },
    ...(info.rewardsEnabled ? [{ to: '/portal/rewards', label: 'Rewards', icon: Gift, end: false }] : []),
    { to: '/portal/wallet', label: 'Wallet', icon: Wallet, end: false },
    { to: '/portal/profile', label: 'Profile', icon: User, end: false },
  ];
  // Phones: four main destinations in a bottom tab bar, then "More" with everything; wallet & profile also sit in the top bar.
  const bottom = [
    ...nav.filter((n) => ['/portal', '/portal/book', '/portal/match', '/portal/chat', '/portal/news', '/portal/ranks'].includes(n.to)).slice(0, 4),
    { to: '/portal/more', label: 'More', icon: LayoutGrid, end: false },
  ];
  return (
    <div className="portal">
      <div className="portal-top">
        <Brand sub={me.data ? me.data.code : undefined} />
        <div className="spacer" />
        {me.data && (
          <Link to="/portal/wallet" className="wallet-chip" title="Wallet">
            <Wallet size={14} /> {money(me.data.balance)}
          </Link>
        )}
        <span className="hide-sm">
          <InstallButton compact />
        </span>
        <ThemeToggle />
        {me.data && (
          <Link to="/portal/profile" aria-label="Profile" title="Profile" style={{ display: 'flex' }}>
            <Avatar name={me.data.gamertag || me.data.fullName} src={me.data?.avatarUrl} size={32} />
          </Link>
        )}
        <button className="btn btn-ghost btn-icon hide-sm" onClick={signOut} aria-label="Sign out" title="Sign out">
          <LogOut size={18} />
        </button>
      </div>
      <nav className="portal-nav">
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            <n.icon size={16} /> {n.label}
            {n.badge}
          </NavLink>
        ))}
      </nav>
      <main className="portal-main">
        <ErrorBox error={me.error} />
        {me.data && (
          <Routes>
            <Route path="portal" element={<HomePage me={me.data} />} />
            {info.bookingsEnabled && <Route path="portal/book" element={<BookPage />} />}
            <Route path="portal/ranks" element={<PortalLeaderboard me={me.data} money={money} />} />
            <Route path="portal/cups" element={<PortalTournaments money={money} />} />
            <Route path="portal/cups/:id" element={<PortalTournament me={me.data} money={money} />} />
            {info.matchmakingEnabled && <Route path="portal/match" element={<PortalFindMatch me={me.data} />} />}
            <Route path="portal/wallet" element={<WalletPage me={me.data} />} />
            <Route path="portal/news" element={<NewsFeed />} />
            {info.chatEnabled && <Route path="portal/chat" element={<PortalChat />} />}
            {info.rewardsEnabled && <Route path="portal/rewards" element={<PortalRewards money={money} />} />}
            <Route path="portal/more" element={<MorePage items={nav.filter((n) => n.to !== '/portal')} onSignOut={signOut} />} />
            <Route path="portal/profile" element={<ProfilePage me={me.data} />} />
            <Route path="*" element={<Navigate to="/portal" replace />} />
          </Routes>
        )}
      </main>
      <nav className="portal-bottom" aria-label="Main">
        {bottom.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            <n.icon size={21} />
            <span>{n.label}</span>
            {n.to === '/portal/chat'
              ? nav.find((x) => x.to === '/portal/chat')?.badge
              : n.to === '/portal/more' && unread.dms > 0 && !bottom.some((b) => b.to === '/portal/chat')
                ? dot(unread.dms)
                : null}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function HomePage({ me }: { me: any }) {
  const { money, info } = usePortal();
  const stations = useQuery({
    queryKey: ['portal', 'stations'],
    queryFn: () => pget('/api/portal/stations'),
    refetchInterval: 30_000,
  });
  const prices = useQuery({
    queryKey: ['portal', 'prices'],
    queryFn: () => pget('/api/portal/prices'),
    staleTime: 300_000,
  });
  const free = (stations.data ?? []).filter((s: any) => s.state === 'available').length;
  return (
    <>
      <div className="portal-hello">
        <div>
          <div className="dim" style={{ fontSize: 13 }}>
            Welcome back
          </div>
          <h1>{me.gamertag || me.fullName.split(/\s+/)[0]} 👋</h1>
        </div>
      </div>
      {!isStandalone() && (
        <div className="card install-card">
          <img src="/icons/icon-192.png" alt="" width={44} height={44} style={{ borderRadius: 12 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong>Get the {info.centerName} app</strong>
            <div className="dim" style={{ fontSize: 12 }}>
              Opens full screen from your home screen — no app store needed.
            </div>
          </div>
          <InstallButton compact label="Install" />
        </div>
      )}
      <MyPlayCard me={me} selfStart={!!info.selfStart} />
      <NewsPreview />
      {info.rewardsEnabled && <RewardsTeaser money={money} />}
      <div className="grid stats">
        <div className="card hero-balance">
          <span className="stat-label">{me.outstanding > 0 ? 'Main balance' : 'Wallet balance'}</span>
          <MainBalance me={me} money={money} light />
          <span style={{ fontSize: 13, opacity: 0.9 }}>
            {me.points} points
            {me.tierName ? ` · ${me.tierName} member (${me.tierDiscount}% off)` : ''}
          </span>
          <div className="toolbar" style={{ marginTop: 6 }}>
            {(info.paystackEnabled || info.momoTopupEnabled) && (
              <NavLink
                to="/portal/wallet"
                className="btn btn-sm"
                style={{
                  background: 'rgba(255,255,255,0.18)',
                  borderColor: 'transparent',
                  color: '#fff',
                }}
              >
                Top up
              </NavLink>
            )}
            {info.bookingsEnabled && (
              <NavLink
                to="/portal/book"
                className="btn btn-sm"
                style={{
                  background: '#fff',
                  borderColor: '#fff',
                  color: '#4b2bd6',
                }}
              >
                Book a station
              </NavLink>
            )}
          </div>
        </div>
        <SavedTimeCard me={me} />
        <div className="card stat">
          <span className="stat-label">
            <Gamepad2 size={14} /> Free right now
          </span>
          <span className="stat-value">
            {free} / {(stations.data ?? []).length}
          </span>
          <span className="stat-sub">
            Open {info.openingTime}–{info.closingTime}
          </span>
        </div>
        <PayOwedCard me={me} info={info} money={money} />
      </div>

      <CompeteTeaser me={me} />

      <div className="card">
        <div className="card-head">
          <h2>Upcoming bookings</h2>
          {info.bookingsEnabled && (
            <NavLink to="/portal/book" className="btn btn-sm">
              New booking
            </NavLink>
          )}
        </div>
        <BookingList bookings={me.upcomingBookings} empty="No upcoming bookings" playing={!!me.activeSession} />
      </div>

      <div className="grid two-col">
        <div className="card">
          <div className="card-head">
            <h2>Recent sessions</h2>
          </div>
          <div className="list">
            {me.sessions.length === 0 && <div className="empty-inline">No games played yet</div>}
            {me.sessions.slice(0, 8).map((s: any) => (
              <div key={s.id} className="list-item">
                <span>
                  <strong>{s.stationName}</strong>
                  <div className="dim" style={{ fontSize: 12 }}>
                    {formatDateTime(s.startedAt)} · {s.status === 'ended' ? formatMinutes(s.billedMinutes) : 'playing now'}
                  </div>
                </span>
                <span className="num">{money(s.netAmount)}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-head">
            <h2>Prices</h2>
          </div>
          <div className="list">
            {(prices.data ?? []).length === 0 && <div className="empty-inline">Ask at the counter</div>}
            {(prices.data ?? []).map((p: any) => (
              <div key={p.id} className="list-item">
                <span>
                  {p.name}
                  {p.categoryName && <span className="dim"> · {p.categoryName}</span>}
                </span>
                <span className="num">{p.kind === 'package' ? `${formatMinutes(p.packageMinutes)} · ${money(p.packagePrice)}` : `${money(p.ratePerHour)}/h`}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function BookingList({ bookings, empty, cancellable, playing }: { bookings: any[]; empty: string; cancellable?: boolean; playing?: boolean }) {
  const { info, money } = usePortal();
  const qc = useQueryClient();
  const cancel = useMutation({
    mutationFn: (id: string) => ppost(`/api/portal/bookings/${id}/cancel`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal'] });
    },
  });
  return (
    <div className="list">
      <ErrorBox error={cancel.error} />
      {bookings.length === 0 && <div className="empty-inline">{empty}</div>}
      {bookings.map((b: any) => {
        const canCancel = (cancellable ?? true) && (b.status === 'pending' || b.status === 'confirmed') && Date.parse(b.startAt) > Date.now();
        return (
          <div key={b.id} className="list-item">
            <span>
              <strong>{b.stationName}</strong> ·{' '}
              {new Date(b.startAt).toLocaleDateString(undefined, {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
              })}{' '}
              {formatTime(b.startAt)}–{formatTime(b.endAt)}
              <div className="dim" style={{ fontSize: 12 }}>
                Booking #{b.number} · {formatMinutes(b.minutes)}
              </div>
            </span>
            <span className="toolbar" style={{ justifyContent: 'flex-end' }}>
              <StatusBadge status={b.status} />
              <BookingActions b={b} selfStart={!!info.selfStart} playing={!!playing} money={money} />
              {canCancel && (
                <button
                  className="btn btn-sm btn-ghost"
                  disabled={cancel.isPending}
                  onClick={() => window.confirm(b.payment === 'wallet' ? 'Cancel this booking? The time you paid for stays on your saved time.' : 'Cancel this booking?') && cancel.mutate(b.id)}
                >
                  Cancel
                </button>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ───────────────────────── Booking ─────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const DURATIONS = [30, 60, 90, 120, 180, 240];
const isoLocal = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Start of a custom "HH:MM" on a day (times before opening count as after midnight when the venue closes after midnight). */
function customStart(day: Date, hhmm: string, info: Info) {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return null;
  let m = toMin(hhmm);
  const open = toMin(info.openingTime);
  const close = toMin(info.closingTime);
  if (close <= open && m < open && m < close) m += 24 * 60;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, m);
}

/** Start times (every 30 min) inside opening hours for a given calendar day. */
function slotsFor(day: Date, info: Info, minutes: number) {
  const open = toMin(info.openingTime);
  let close = toMin(info.closingTime);
  if (close <= open) close += 24 * 60; // past midnight, or 24 h when equal
  const earliest = Date.now() + info.bookingMinNoticeMinutes * 60_000;
  const out: Date[] = [];
  for (let m = open; m + minutes <= close; m += 30) {
    const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, m);
    if (d.getTime() >= earliest) out.push(d);
  }
  return out;
}

function BookPage() {
  const { info } = usePortal();
  const qc = useQueryClient();
  const days = Array.from({ length: info.bookingMaxDaysAhead + 1 }, (_, i) => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + i);
  });
  const [dayIdx, setDayIdx] = useState(0);
  const [minutes, setMinutes] = useState(60);
  const [customLen, setCustomLen] = useState(false);
  const [lenH, setLenH] = useState('1');
  const [lenM, setLenM] = useState('0');
  // when: now = start this minute; slot = 30-minute list; custom = any minute
  const [when, setWhen] = useState<'now' | 'slot' | 'custom'>('slot');
  const [customTime, setCustomTime] = useState('');
  const slots = slotsFor(days[dayIdx], info, minutes);
  const [start, setStart] = useState<string>('');
  const [nowAt, setNowAt] = useState(() => new Date());
  useEffect(() => {
    if (when !== 'now') return;
    setNowAt(new Date());
    const t = setInterval(() => setNowAt(new Date()), 60_000);
    return () => clearInterval(t);
  }, [when]);
  const custom = when === 'custom' ? customStart(days[dayIdx], customTime, info) : null;
  const customErr = custom && custom.getTime() < Date.now() + info.bookingMinNoticeMinutes * 60_000 ? `Pick a time at least ${info.bookingMinNoticeMinutes} min from now — or use "Now"` : null;
  const startIso =
    when === 'now'
      ? new Date(Math.floor(nowAt.getTime() / 60_000) * 60_000).toISOString()
      : when === 'custom'
        ? custom && !customErr
          ? custom.toISOString()
          : ''
        : slots.some((s) => s.toISOString() === start)
          ? start
          : '';
  const [stationId, setStationId] = useState('');
  const [note, setNote] = useState('');
  const [pay, setPay] = useState('counter');
  const [planId, setPlanId] = useState('');
  const [done, setDone] = useState<any>(null);
  const { money } = usePortal();
  const me = useMe();
  const avail = useQuery({
    queryKey: ['portal', 'availability', startIso, minutes],
    queryFn: () => pget(`/api/portal/availability?start=${encodeURIComponent(startIso)}&minutes=${minutes}`),
    enabled: !!startIso,
  });
  const mine = useQuery({
    queryKey: ['portal', 'bookings'],
    queryFn: () => pget('/api/portal/bookings'),
  });
  const book = useMutation({
    mutationFn: () =>
      ppost('/api/portal/bookings', {
        planId: pay === 'wallet' && planId ? planId : undefined,
        stationId,
        startAt: when === 'now' ? new Date().toISOString() : startIso,
        minutes,
        note: note || null,
        pay,
        now: when === 'now' || undefined,
      }),
    onSuccess: (b) => {
      setDone(b);
      setStationId('');
      setNote('');
      qc.invalidateQueries({ queryKey: ['portal'] });
    },
  });
  const chosen = (avail.data?.stations ?? []).find((s: any) => s.id === stationId);
  return (
    <>
      <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2>Book a station</h2>
        {done && (
          <div className="card card-pad" style={{ borderColor: 'var(--success)' }}>
            <strong>Booked!</strong> {done.status === 'pending' ? 'Staff will confirm it shortly.' : 'Your station is reserved.'}{' '}
            {done.payment === 'wallet'
              ? `Paid ${money(done.paidAmount)} from your wallet. When you arrive, press Start on your booking.`
              : done.payment === 'saved'
                ? 'It will use your saved time. When you arrive, press Start on your booking.'
                : 'Pay at the counter when you arrive.'}{' '}
            Bookings are released if you are more than a few minutes late.
          </div>
        )}
        <ErrorBox error={book.error} />
        <div className="toolbar">
          <button
            type="button"
            className={`btn ${when === 'now' ? 'btn-primary' : ''}`}
            onClick={() => {
              setWhen('now');
              setDayIdx(0);
            }}
          >
            ⚡ Book now
          </button>
          <button type="button" className={`btn ${when === 'slot' ? 'btn-primary' : ''}`} onClick={() => setWhen('slot')}>
            Pick a time
          </button>
          <button type="button" className={`btn ${when === 'custom' ? 'btn-primary' : ''}`} onClick={() => setWhen('custom')}>
            Exact time
          </button>
        </div>
        {when === 'now' && <div className="hint">Starts right now ({isoLocal(nowAt)}). Choose how long, then a free station.</div>}
        <div className="form-grid">
          {when !== 'now' && (
            <Field label="Day">
              <select className="select" value={dayIdx} onChange={(e) => setDayIdx(Number(e.target.value))}>
                {days.map((d, i) => (
                  <option key={i} value={i}>
                    {i === 0
                      ? 'Today'
                      : i === 1
                        ? 'Tomorrow'
                        : d.toLocaleDateString(undefined, {
                            weekday: 'long',
                            day: 'numeric',
                            month: 'short',
                          })}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="How long">
            <select
              className="select"
              value={customLen ? 'custom' : minutes}
              onChange={(e) => {
                if (e.target.value === 'custom') {
                  setCustomLen(true);
                  setLenH(String(Math.floor(minutes / 60)));
                  setLenM(String(minutes % 60));
                } else {
                  setCustomLen(false);
                  setMinutes(Number(e.target.value));
                }
              }}
            >
              {DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {formatMinutes(d)}
                </option>
              ))}
              <option value="custom">Other length…</option>
            </select>
          </Field>
          {customLen && (
            <Field label="Length (hours and minutes)" hint="From 15 minutes to 12 hours.">
              <div className="toolbar" style={{ flexWrap: 'nowrap' }}>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={12}
                  value={lenH}
                  aria-label="Hours"
                  onChange={(e) => {
                    setLenH(e.target.value);
                    const t = (Number(e.target.value) || 0) * 60 + (Number(lenM) || 0);
                    if (t >= 15 && t <= 720) setMinutes(t);
                  }}
                />
                <span>h</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={59}
                  step={5}
                  value={lenM}
                  aria-label="Minutes"
                  onChange={(e) => {
                    setLenM(e.target.value);
                    const t = (Number(lenH) || 0) * 60 + (Number(e.target.value) || 0);
                    if (t >= 15 && t <= 720) setMinutes(t);
                  }}
                />
                <span>min</span>
              </div>
            </Field>
          )}
          {when === 'custom' && (
            <Field label="Start at (any minute)" full>
              <input className="input" type="time" step={60} value={customTime} onChange={(e) => setCustomTime(e.target.value)} />
              {customErr && <div className="error-text">{customErr}</div>}
            </Field>
          )}
          {when === 'slot' && (
            <Field label="Start time" full>
              <select className="select" value={startIso} onChange={(e) => setStart(e.target.value)}>
                <option value="">{slots.length ? 'Choose a time…' : 'No times left on this day'}</option>
                {slots.map((s) => (
                  <option key={s.toISOString()} value={s.toISOString()}>
                    {pad(s.getHours())}:{pad(s.getMinutes())}
                    {s.getDate() !== days[dayIdx].getDate() ? ' (after midnight)' : ''}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        {startIso && (
          <>
            <h3>Choose a station {when === 'now' ? '— free now' : `— ${formatTime(startIso)} to ${formatTime(new Date(new Date(startIso).getTime() + minutes * 60_000).toISOString())}`}</h3>
            {avail.data && !avail.data.withinHours && (
              <div className="error-text">
                That time is outside opening hours ({avail.data.openingTime}–{avail.data.closingTime}).
              </div>
            )}
            <ErrorBox error={avail.error} />
            <div className="slot-grid">
              {(avail.data?.stations ?? []).map((s: any) => (
                <button key={s.id} type="button" className={`slot ${stationId === s.id ? 'on' : ''}`} disabled={!s.available} onClick={() => setStationId(s.id)}>
                  <strong>{s.name}</strong>
                  <span className="dim" style={{ fontSize: 12 }}>
                    {PLATFORM_LABEL[s.platform]}
                    {s.categoryName ? ` · ${s.categoryName}` : ''}
                  </span>
                  <span className={`badge ${s.available ? 'badge-success' : ''}`} style={{ alignSelf: 'flex-start' }}>
                    {s.available ? 'Free' : s.reason}
                  </span>
                </button>
              ))}
            </div>
            <BookingPayChoice
              stationId={stationId}
              minutes={minutes}
              value={pay}
              onChange={setPay}
              money={money}
              planId={planId}
              onPlan={(id, len) => {
                setPlanId(id);
                if (len && len >= 15 && len <= 720 && len !== minutes) {
                  setMinutes(len);
                  if (DURATIONS.includes(len)) setCustomLen(false);
                  else {
                    setCustomLen(true);
                    setLenH(String(Math.floor(len / 60)));
                    setLenM(String(len % 60));
                  }
                }
              }}
            />
            <Field label="Note for staff (optional)">
              <input className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. we are 4 players" />
            </Field>
            <div>
              <button className="btn btn-primary" disabled={!chosen || book.isPending} onClick={() => book.mutate()}>
                {chosen ? `${pay === 'wallet' ? 'Pay & book' : 'Book'} ${chosen.name} · ${when === 'now' ? 'now' : formatTime(startIso)} for ${formatMinutes(minutes)}` : 'Pick a station'}
              </button>
            </div>
          </>
        )}
      </div>
      <div className="card">
        <div className="card-head">
          <h2>My bookings</h2>
        </div>
        <BookingList bookings={mine.data ?? []} empty="You have not booked yet" playing={!!me.data?.activeSession} />
      </div>
    </>
  );
}

// ───────────────────────── Wallet & Paystack ─────────────────────────

const LEDGER_LABEL: Record<string, string> = {
  deposit: 'Top-up',
  withdrawal: 'Withdrawal',
  charge: 'Game time',
  refund: 'Refund',
  adjustment: 'Adjustment',
  bonus: 'Bonus',
};

function WalletPage({ me }: { me: any }) {
  const { info, money } = usePortal();
  const [amount, setAmount] = useState('');
  const [email, setEmail] = useState(me.email ?? '');
  const parsed = parseMoney(amount, info.currencyMinorUnits);
  const unit = 10 ** info.currencyMinorUnits;
  const quick = [20, 50, 100, 200].map((x) => x * unit);
  const pay = useMutation({
    mutationFn: () => ppost('/api/portal/topup', { amount: parsed, email: email.trim() }),
    onSuccess: (r: any) => {
      window.location.href = r.authorizationUrl;
    },
  });
  return (
    <>
      {info.momoTopupEnabled && <MomoTopup money={(v) => money(v)} currencyCode={info.currencyCode} minorUnits={info.currencyMinorUnits} />}
      <div className="grid two-col">
        <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2>{info.momoTopupEnabled ? 'Pay by card or MoMo (Paystack)' : 'Top up your wallet'}</h2>
          {!info.paystackEnabled ? (
            <div className="muted">
              {info.momoTopupEnabled
                ? 'Card payment is not available — use MoMo above, or pay at the counter.'
                : 'Online top-up is not available yet — top up with cash or mobile money at the counter.'}
            </div>
          ) : (
            <>
              <ErrorBox error={pay.error} />
              <div className="toolbar">
                {quick.map((q) => (
                  <button key={q} type="button" className={`btn btn-sm ${parsed === q ? 'btn-primary' : ''}`} onClick={() => setAmount(String(q / unit))}>
                    {money(q)}
                  </button>
                ))}
              </div>
              <Field label={`Amount (${info.currencyCode})`}>
                <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Other amount" />
              </Field>
              <Field label="Email for your receipt">
                <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <button className="btn btn-primary" disabled={pay.isPending || parsed == null || parsed < unit || !email.includes('@')} onClick={() => pay.mutate()}>
                {pay.isPending ? 'Opening Paystack…' : `Pay ${parsed ? money(parsed) : ''} with Paystack`}
              </button>
              <div className="hint">Card or mobile money, on Paystack’s secure page. Your balance updates as soon as the payment is confirmed.</div>
            </>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card hero-balance">
            <span className="stat-label">{me.outstanding > 0 ? 'Main balance' : 'Balance'}</span>
            <MainBalance me={me} money={money} light />
            <span style={{ fontSize: 13, opacity: 0.9 }}>{me.points} loyalty points</span>
          </div>
          <SavedTimeCard me={me} />
          <PayOwedCard me={me} info={info} money={money} />
        </div>
      </div>
      {me.onlinePayments.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>Online payments</h2>
          </div>
          <div className="list">
            {me.onlinePayments.map((o: any) => (
              <div key={o.reference} className="list-item">
                <span>
                  {formatDateTime(o.createdAt)}
                  <div className="dim" style={{ fontSize: 12 }}>
                    {o.channel ? o.channel.replace('_', ' ') : 'Paystack'} · {o.reference}
                  </div>
                </span>
                <span className="toolbar" style={{ flexWrap: 'nowrap' }}>
                  <span className="num">{money(o.amount)}</span>
                  {o.status === 'pending' ? <span className="badge badge-warning">Processing</span> : <StatusBadge status={o.status} />}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="card">
        <div className="card-head">
          <h2>Wallet history</h2>
        </div>
        <div className="list">
          {me.ledger.length === 0 && <div className="empty-inline">No wallet activity yet</div>}
          {me.ledger.map((l: any) => (
            <div key={l.id} className="list-item">
              <span>
                {LEDGER_LABEL[l.type] ?? l.type}
                <div className="dim" style={{ fontSize: 12 }}>
                  {formatDateTime(l.createdAt)}
                  {l.note ? ` · ${l.note}` : ''}
                </div>
              </span>
              <span
                className="num"
                style={{
                  color: l.amount < 0 ? 'var(--danger)' : 'var(--success)',
                  fontWeight: 600,
                }}
              >
                {l.amount > 0 ? '+' : ''}
                {money(l.amount)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/** Return page after Paystack: confirm the payment with the server and show the result. */
function PaidPage() {
  const { money } = usePortal();
  const reference = new URLSearchParams(window.location.search).get('reference') ?? '';
  const [tries, setTries] = useState(0);
  const q = useQuery({
    queryKey: ['portal', 'paid', reference],
    queryFn: () => pget(`/api/portal/payments/${encodeURIComponent(reference)}`),
    enabled: !!reference,
    refetchInterval: (query) => (query.state.data?.status === 'pending' && tries < 40 ? 3000 : false),
  });
  useEffect(() => {
    if (q.data?.status === 'pending') setTries((t) => t + 1);
  }, [q.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const st = q.data?.status;
  return (
    <Centered>
      <div className="card login-card" style={{ textAlign: 'center', alignItems: 'center' }}>
        <Brand />
        {!reference ? (
          <p className="muted">No payment reference.</p>
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : !q.data || st === 'pending' ? (
          <>
            <h1>Confirming your payment…</h1>
            <p className="muted">This usually takes a few seconds. You can close this page — your wallet will update automatically.</p>
          </>
        ) : st === 'success' ? (
          <>
            <h1>Payment received</h1>
            <p className="stat-value" style={{ color: 'var(--success)' }}>
              +{money(q.data.amount)}
            </p>
            <p className="muted">It has been added to your wallet.</p>
          </>
        ) : (
          <>
            <h1>Payment not completed</h1>
            <p className="muted">{q.data.failureReason ?? 'Nothing was charged.'}</p>
          </>
        )}
        <a className="btn btn-primary" href="/portal/wallet">
          Back to my wallet
        </a>
      </div>
    </Centered>
  );
}

// ───────────────────────── Profile ─────────────────────────

/** Shrinks any photo to a 256×256 JPEG (centre square) in the phone, so uploads are small and fast. */
async function squareJpeg(file: File, size = 256): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('That file is not a picture we can read — try a JPG or PNG'));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const g = c.getContext('2d')!;
    g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    return c.toDataURL('image/jpeg', 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function ProfilePicture({ me }: { me: any }) {
  const qc = useQueryClient();
  const upload = useMutation({
    mutationFn: async (file: File) => papi('PUT', '/api/portal/me/avatar', { image: await squareJpeg(file) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal'] }),
  });
  const remove = useMutation({
    mutationFn: () => pdel('/api/portal/me/avatar'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal'] }),
  });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <Avatar name={me.gamertag || me.fullName} size={72} src={me.avatarUrl} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
          {upload.isPending ? 'Uploading…' : me.avatarUrl ? 'Change picture' : 'Add a profile picture'}
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) upload.mutate(f);
            }}
          />
        </label>
        {me.avatarUrl && (
          <button className="btn btn-sm btn-ghost" onClick={() => remove.mutate()} disabled={remove.isPending}>
            Remove picture
          </button>
        )}
        <span className="dim" style={{ fontSize: 12 }}>
          Shown next to your name in chat, rankings and find a match.
        </span>
        <ErrorBox error={upload.error || remove.error} />
      </div>
    </div>
  );
}

function ProfilePage({ me }: { me: any }) {
  const { signIn, signOut } = usePortal();
  const qc = useQueryClient();
  const [fullName, setFullName] = useState(me.fullName);
  const [email, setEmail] = useState(me.email ?? '');
  const [gamertag, setGamertag] = useState(me.gamertag ?? '');
  const [psnId, setPsnId] = useState(me.psnId ?? '');
  const [eaId, setEaId] = useState(me.eaId ?? '');
  const [hidden, setHidden] = useState<boolean>(!!me.leaderboardHidden);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      ppatch('/api/portal/me', {
        fullName,
        email,
        gamertag,
        psnId,
        eaId,
        leaderboardHidden: hidden,
      }),
    onSuccess: () => {
      setSaved(true);
      qc.invalidateQueries({ queryKey: ['portal', 'me'] });
    },
  });
  const [pw, setPw] = useState({ current: '', next: '' });
  const [pwDone, setPwDone] = useState(false);
  const change = useMutation({
    mutationFn: () =>
      ppost('/api/portal/me/password', {
        currentPassword: pw.current,
        newPassword: pw.next,
      }),
    onSuccess: (r: any) => {
      signIn(r.token);
      setPw({ current: '', next: '' });
      setPwDone(true);
    },
  });
  return (
    <div className="grid two-col">
      <NotificationsCard />
      <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2>My details</h2>
        <ProfilePicture me={me} />
        <ErrorBox error={save.error} />
        <dl className="kv">
          <dt>Member ID</dt>
          <dd className="mono">{me.code}</dd>
          <dt>Phone</dt>
          <dd>{me.phone}</dd>
          <dt>Member since</dt>
          <dd>{formatDateTime(me.memberSince)}</dd>
          {me.tierName && (
            <>
              <dt>Membership</dt>
              <dd>
                {me.tierName} · {me.tierDiscount}% off
              </dd>
            </>
          )}
        </dl>
        <Field label="Full name">
          <input className="input" value={fullName} onChange={(e) => (setFullName(e.target.value), setSaved(false))} />
        </Field>
        <Field label="Email" hint="For Paystack receipts. To change your phone number, ask at the counter.">
          <input className="input" type="email" value={email} onChange={(e) => (setEmail(e.target.value), setSaved(false))} />
        </Field>
        <Field label="Gamertag" hint="Your name on the leaderboard and in Find match">
          <input className="input" value={gamertag} maxLength={24} onChange={(e) => (setGamertag(e.target.value), setSaved(false))} placeholder="e.g. AccraKing" />
        </Field>
        <Field label="PSN ID" hint="Shown only to opponents you are matched with online">
          <input className="input" value={psnId} maxLength={32} onChange={(e) => (setPsnId(e.target.value), setSaved(false))} />
        </Field>
        <Field label="EA ID" hint="For EA SPORTS FC online friendlies — shown only to matched opponents">
          <input className="input" value={eaId} maxLength={32} onChange={(e) => (setEaId(e.target.value), setSaved(false))} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={hidden} onChange={(e) => (setHidden(e.target.checked), setSaved(false))} /> Hide me from the public leaderboard
        </label>
        <div className="toolbar">
          <button className="btn btn-primary" disabled={save.isPending || fullName.trim().length < 2} onClick={() => save.mutate()}>
            Save
          </button>
          {saved && <span style={{ color: 'var(--success)', fontSize: 13 }}>Saved</span>}
        </div>
      </div>
      <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2>Password</h2>
        <ErrorBox error={change.error} />
        <Field label="Current password">
          <PasswordInput className="input" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
        </Field>
        <Field label="New password" hint="At least 8 characters. Other devices will be signed out.">
          <PasswordInput className="input" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
        </Field>
        <div className="toolbar">
          <button className="btn" disabled={change.isPending || !pw.current || pw.next.length < 8} onClick={() => change.mutate()}>
            Change password
          </button>
          {pwDone && <span style={{ color: 'var(--success)', fontSize: 13 }}>Password changed</span>}
        </div>
        <div className="spacer" />
        <InstallButton />
        <button className="btn btn-ghost" onClick={signOut}>
          <LogOut size={16} /> Sign out
        </button>
      </div>
    </div>
  );
}
