/**
 * Public home page: what visitors (and Google) see at the main address before signing in.
 * Big buttons lead to the customer app; the staff sign-in is a quiet link in the footer.
 */
import { useQuery } from '@tanstack/react-query';
import {
  CalendarCheck,
  Car,
  ChevronLeft,
  ChevronRight,
  Clock,
  Crosshair,
  Dribbble,
  Facebook,
  Flame,
  Gamepad2,
  Globe,
  Instagram,
  Mail,
  Map as MapIcon,
  MapPin,
  Medal,
  Menu,
  MessageCircle,
  Music2,
  Newspaper,
  Phone,
  Play,
  Sparkles,
  Swords,
  Target,
  Trophy,
  UserPlus,
  Users,
  Wallet,
  X,
  Youtube,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { InstallButton, setupPwa } from '../lib/pwa';
import { getPortalToken } from '../portal/portal-api';
import type { WebsiteSettings } from '../lib/app-context';
import './landing.css';

interface SiteInfo {
  centerName: string;
  brandName: string;
  openingTime: string;
  closingTime: string;
  phonePrefix: string;
  socialLinks: Record<string, string>;
  website: WebsiteSettings;
  portalEnabled: boolean;
  selfSignup: boolean;
  bookingsEnabled: boolean;
  leaderboardPublic: boolean;
}

interface NewsItem {
  key: string;
  title: string;
  summary: string;
  image: string | null;
  source: string;
  href: string;
  external: boolean;
  date: string | null;
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

// ── Small helpers ──

/** Same game name → same colours every time. */
const PALETTES = [
  ['#1d44f9', '#041568', '#ccf02a'],
  ['#ff3d6e', '#3a0a4f', '#ffd166'],
  ['#00c2ff', '#06224a', '#7cffb2'],
  ['#ff7a18', '#4a0d0d', '#ffe26a'],
  ['#8b5cf6', '#160c3d', '#5eead4'],
  ['#10b981', '#06281f', '#ccf02a'],
  ['#f43f5e', '#1b0b2e', '#60a5fa'],
  ['#eab308', '#2b1a03', '#f97316'],
];
function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}
function iconFor(name: string, tag: string): LucideIcon {
  const t = `${name} ${tag}`.toLowerCase();
  if (/wheel|racing|race|gran turismo|f1|forza|need for speed|drive/.test(t)) return Car;
  if (/shoot|call of duty|cod|battlefield|valorant|apex|warzone/.test(t)) return Crosshair;
  if (/fight|kombat|tekken|street fighter|ufc|boxing|wrestl|wwe/.test(t)) return Swords;
  if (/basket|nba/.test(t)) return Dribbble;
  if (/football|fc|fifa|pes|efootball|soccer/.test(t)) return Trophy;
  if (/open world|gta|grand theft|adventure|spider/.test(t)) return MapIcon;
  if (/battle royale|fortnite|pubg/.test(t)) return Target;
  if (/vr|virtual/.test(t)) return Sparkles;
  return Gamepad2;
}
function waLink(v: string, prefix: string) {
  if (/^https?:\/\//i.test(v)) return v.trim();
  let d = v.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('0')) d = prefix.replace(/\D/g, '') + d.slice(1);
  return d ? `https://wa.me/${d}` : '';
}
/** Only http(s) links from settings become links or pictures. */
function safeUrl(v: string | undefined | null) {
  return v && /^https?:\/\//i.test(v.trim()) ? v.trim() : '';
}
function telLink(v: string) {
  return `tel:${v.replace(/[^\d+]/g, '')}`;
}
function paragraphs(t: string) {
  return t
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
function openNow(open: string, close: string) {
  const now = new Date();
  const m = now.getHours() * 60 + now.getMinutes();
  const [oh, om] = open.split(':').map(Number);
  const [ch, cm] = close.split(':').map(Number);
  const o = oh * 60 + om;
  const c = ch * 60 + cm;
  if (o === c) return true;
  return o < c ? m >= o && m < c : m >= o || m < c;
}
function ago(iso: string | null) {
  if (!iso) return '';
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 3600) return `${Math.max(1, Math.round(d / 60))} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  if (d < 86400 * 7) return `${Math.round(d / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}

const SOCIALS: { key: string; label: string; Icon: LucideIcon }[] = [
  { key: 'instagram', label: 'Instagram', Icon: Instagram },
  { key: 'tiktok', label: 'TikTok', Icon: Music2 },
  { key: 'youtube', label: 'YouTube', Icon: Youtube },
  { key: 'facebook', label: 'Facebook', Icon: Facebook },
  { key: 'x', label: 'X', Icon: X },
  { key: 'snapchat', label: 'Snapchat', Icon: Zap },
  { key: 'whatsapp', label: 'WhatsApp', Icon: MessageCircle },
  { key: 'website', label: 'Website', Icon: Globe },
];

// ── Page ──

export function LandingPage() {
  const site = useQuery({ queryKey: ['public-site'], queryFn: () => getJson<SiteInfo>('/api/public/site'), staleTime: 60_000 });
  const news = useQuery({ queryKey: ['public-news'], queryFn: () => getJson<any>('/api/public/news'), staleTime: 120_000 });
  const [menu, setMenu] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Installing from this page gives the customer app (opens straight on the customer area).
  useEffect(() => setupPwa('portal'), []);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  const s = site.data;
  const w = s?.website;
  const name = s?.brandName || 'ZENAA MEGA GAMES';
  const centre = s?.centerName || 'ZENAA GAMEHUB';

  // Website switched off in Settings: visitors go straight to the staff sign-in, as before.
  useEffect(() => {
    if (s && s.website && s.website.enabled === false && window.location.pathname === '/') window.location.replace('/login');
  }, [s]);
  useEffect(() => {
    document.title = `${centre} — ${w?.tagline || 'Gaming lounge'}`;
    const desc = w?.intro || `${centre}: PS5 gaming lounge with racing wheels, tournaments and a customer app.`;
    let m = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!m) {
      m = document.createElement('meta');
      m.name = 'description';
      document.head.appendChild(m);
    }
    m.content = desc;
  }, [centre, w?.tagline, w?.intro]);

  // Already signed in to the customer app on this phone: the buttons open the account instead of sign-up.
  const customer = !!getPortalToken();
  const signupOk = !customer && (s ? s.selfSignup : true);
  const playHref = s?.bookingsEnabled ? '/portal/book' : '/portal';
  const games = w?.games ?? [];
  const socials = SOCIALS.filter((x) => s?.socialLinks?.[x.key]).map((x) => ({
    ...x,
    href: x.key === 'whatsapp' ? waLink(s!.socialLinks[x.key], s!.phonePrefix) : safeUrl(s!.socialLinks[x.key]),
  })).filter((x) => x.href);
  const isOpen = s ? openNow(s.openingTime, s.closingTime) : null;
  const hours = s ? (s.openingTime === s.closingTime ? '24 hours' : `${s.openingTime} – ${s.closingTime}`) : '';
  const mapQuery = w?.address || '';
  const directions = safeUrl(w?.mapsLink) || (mapQuery ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(mapQuery)}` : '');

  const items: NewsItem[] = [
    ...((news.data?.posts ?? []) as any[]).map((p) => ({
      key: `p${p.id}`,
      title: p.title,
      summary: p.body ?? '',
      image: p.imageUrl ?? null,
      source: centre,
      href: '/portal/news',
      external: false,
      date: p.publishedAt ?? p.createdAt ?? null,
    })),
    ...((news.data?.outside ?? []) as any[]).slice(0, Math.max(3, news.data?.outsideShow ?? 0) + 3).map((o, i) => ({
      key: `o${i}`,
      title: o.title,
      summary: o.summary ?? '',
      image: o.imageUrl ?? null,
      source: o.source ?? 'Game news',
      href: o.url,
      external: true,
      date: o.publishedAt ?? null,
    })),
  ].slice(0, 6);

  const nav = [
    ['#games', 'Games'],
    ['#how', 'How it works'],
    ['#news', 'News'],
    ['#about', 'About'],
    ['#find', 'Find us'],
  ];

  return (
    <div className="lp">
      {/* ── Top bar ── */}
      <header className={`lp-top ${scrolled ? 'solid' : ''}`}>
        <div className="lp-wrap lp-top-in">
          <a href="#top" className="lp-logo" onClick={() => setMenu(false)}>
            <img src="/brand/logo-mark.png" alt="" width={44} height={28} />
            <span>{centre}</span>
          </a>
          <nav className={`lp-nav ${menu ? 'open' : ''}`} onClick={() => setMenu(false)}>
            {nav.map(([h, l]) => (
              <a key={h} href={h}>
                {l}
              </a>
            ))}
            <a href="/portal" className="lp-nav-signin">
              Sign in
            </a>
          </nav>
          <div className="lp-top-cta">
            {!customer && (
              <a href="/portal" className="lp-btn lp-btn-ghost lp-hide-sm">
                Sign in
              </a>
            )}
            <a href={signupOk ? '/portal?signup' : '/portal'} className="lp-btn lp-btn-pop">
              {customer ? 'My account' : signupOk ? 'Join now' : 'Open app'}
            </a>
            <button className="lp-menu" aria-label="Menu" onClick={() => setMenu((m) => !m)}>
              {menu ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="lp-hero" id="top">
        <div className="lp-hero-bg" aria-hidden />
        <div className="lp-wrap lp-hero-in">
          <div className="lp-hero-text">
            {isOpen !== null && (
              <div className={`lp-live ${isOpen ? 'on' : ''}`}>
                <span className="dot" /> {isOpen ? 'Open now' : 'Closed now'} · {hours}
              </div>
            )}
            <div className="lp-kicker">{name}</div>
            <h1 className="lp-h1">{w?.tagline || 'Play. Compete. Win.'}</h1>
            <p className="lp-lead">{w?.intro || 'PS5 stations, racing wheel setups, tournaments and a players app with your wallet, bookings and rankings.'}</p>
            <div className="lp-cta">
              <a href={signupOk ? '/portal?signup' : '/portal'} className="lp-btn lp-btn-pop lp-btn-lg">
                <UserPlus size={18} /> {customer ? 'Open my account' : signupOk ? 'Create free account' : 'Open the players app'}
              </a>
              {!customer && (
                <a href="/portal" className="lp-btn lp-btn-ghost lp-btn-lg">
                  Sign in
                </a>
              )}
            </div>
            <div className="lp-hero-note">Customer area: your wallet, bookings, saved time, rankings and tournaments.</div>
          </div>
          <div className="lp-hero-art" aria-hidden>
            <img src="/brand/logo-mark.png" alt="" />
            <div className="lp-ring r1" />
            <div className="lp-ring r2" />
          </div>
        </div>
        <div className="lp-wrap lp-chips">
          <Chip icon={<Gamepad2 size={18} />} title="PS5 stations" sub="Latest games, ready to play" />
          <Chip icon={<Car size={18} />} title="Racing wheel" sub="Feel every corner" />
          <Chip icon={<Trophy size={18} />} title="Tournaments" sub="Win prizes & ranking" />
          <Chip icon={<Wallet size={18} />} title="MoMo top-up" sub="Pay from your phone" />
        </div>
      </section>

      {/* ── Games ── */}
      <section className="lp-sec" id="games">
        <div className="lp-wrap">
          <SectionHead kicker="Play here" title="Games on our stations" more={{ href: playHref, label: s?.bookingsEnabled ? 'Book a station' : 'Open app' }} />
        </div>
        <GameRow games={games} href={playHref} />
      </section>

      {/* ── How it works ── */}
      <section className="lp-sec" id="how">
        <div className="lp-wrap">
          <SectionHead kicker="3 steps" title="How it works" />
          <div className="lp-steps">
            <Step n={1} icon={<UserPlus size={22} />} title="Create your account" text="Sign up in a minute with your phone number. It's free." />
            <Step n={2} icon={<Wallet size={22} />} title="Top up your wallet" text="Pay with MoMo or at the counter. Your balance and saved time stay in the app." />
            <Step n={3} icon={<CalendarCheck size={22} />} title="Book & play" text="Pick a station and a time, or walk in. Your time starts when you sit down." />
          </div>
          <div className="lp-feature-grid">
            <Feature icon={<Medal size={20} />} title="Rankings" text="Every match counts. Climb the leaderboard." href="/portal/ranks" />
            <Feature icon={<Trophy size={20} />} title="Tournaments" text="Join cups and play for prizes." href="/portal/cups" />
            <Feature icon={<Users size={20} />} title="Find a match" text="Find opponents at your level." href="/portal/match" />
            <Feature icon={<Flame size={20} />} title="Rewards" text="Follow us and use bonus codes." href="/portal/rewards" />
          </div>
        </div>
      </section>

      {/* ── News ── */}
      {items.length > 0 && (
        <section className="lp-sec" id="news">
          <div className="lp-wrap">
            <SectionHead kicker="Latest" title="News & updates" more={{ href: '/portal/news', label: 'All news' }} />
            <div className="lp-news">
              {items.map((n, i) => (
                <a key={n.key} className={`lp-news-card ${i === 0 ? 'big' : ''}`} href={n.href} target={n.external ? '_blank' : undefined} rel={n.external ? 'noreferrer noopener' : undefined}>
                  <div className="lp-news-img">
                    {n.image ? <img src={n.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = 'none')} /> : <Newspaper size={34} />}
                  </div>
                  <div className="lp-news-body">
                    <div className="lp-news-meta">
                      {n.source}
                      {n.date && <> · {ago(n.date)}</>}
                    </div>
                    <h3>{n.title}</h3>
                    {n.summary && <p>{n.summary}</p>}
                  </div>
                </a>
              ))}
            </div>
          </div>
        </section>
      )}
      {items.length === 0 && <div id="news" />}

      {/* ── About ── */}
      <section className="lp-sec" id="about">
        <div className="lp-wrap lp-about">
          <div>
            <SectionHead kicker="Who we are" title={`About ${centre}`} />
            {paragraphs(w?.about || '').map((p, i) => (
              <p key={i} className="lp-p">
                {p}
              </p>
            ))}
            {socials.length > 0 && (
              <div className="lp-follow">
                <div className="lp-follow-title">Follow us</div>
                <div className="lp-socials">
                  {socials.map(({ key, label, Icon, href }) => (
                    <a key={key} href={href} target="_blank" rel="noreferrer noopener" aria-label={label} title={label}>
                      <Icon size={18} />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="lp-about-card">
            <img src="/brand/logo-mark.png" alt="" />
            <div className="lp-about-stats">
              <div>
                <b>PS5</b>
                <span>Stations</span>
              </div>
              <div>
                <b>
                  <Car size={22} />
                </b>
                <span>Racing wheel</span>
              </div>
              <div>
                <b>
                  <Trophy size={22} />
                </b>
                <span>Tournaments</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Find us ── */}
      <section className="lp-sec" id="find">
        <div className="lp-wrap">
          <SectionHead kicker="Visit" title="Find us" />
          <div className="lp-find">
            <div className="lp-map">
              {mapQuery ? (
                <iframe
                  title="Map"
                  src={`https://www.google.com/maps?q=${encodeURIComponent(mapQuery)}&output=embed`}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  allowFullScreen
                />
              ) : (
                <div className="lp-map-empty">
                  <MapPin size={34} />
                  <div>Map coming soon</div>
                </div>
              )}
            </div>
            <div className="lp-contact">
              {w?.address && <Info icon={<MapPin size={18} />} title="Address" text={w.address} />}
              {s && <Info icon={<Clock size={18} />} title="Opening hours" text={`Every day · ${hours}`} />}
              {w?.phone && <Info icon={<Phone size={18} />} title="Call us" text={<a href={telLink(w.phone)}>{w.phone}</a>} />}
              {s?.socialLinks?.whatsapp && (
                <Info
                  icon={<MessageCircle size={18} />}
                  title="WhatsApp"
                  text={
                    <a href={waLink(s.socialLinks.whatsapp, s.phonePrefix)} target="_blank" rel="noreferrer noopener">
                      Chat with us
                    </a>
                  }
                />
              )}
              {w?.email && <Info icon={<Mail size={18} />} title="Email" text={<a href={`mailto:${w.email}`}>{w.email}</a>} />}
              <div className="lp-contact-btns">
                {directions && (
                  <a className="lp-btn lp-btn-pop" href={directions} target="_blank" rel="noreferrer noopener">
                    <MapPin size={16} /> Directions
                  </a>
                )}
                {s?.bookingsEnabled && (
                  <a className="lp-btn lp-btn-ghost" href="/portal/book">
                    <CalendarCheck size={16} /> Book a station
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── App band ── */}
      <section className="lp-band">
        <div className="lp-wrap lp-band-in">
          <div>
            <h2>Your gaming wallet in your pocket</h2>
            <p>Balance, saved time, bookings, rankings and tournaments. Install the players app on your phone.</p>
          </div>
          <div className="lp-band-btns">
            <a href={signupOk ? '/portal?signup' : '/portal'} className="lp-btn lp-btn-dark lp-btn-lg">
              <Play size={16} /> {signupOk ? 'Get started' : 'Open app'}
            </a>
            <InstallButton label="Install the app" />
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-grid">
          <div>
            <a href="#top" className="lp-logo">
              <img src="/brand/logo-mark.png" alt="" width={44} height={28} />
              <span>{centre}</span>
            </a>
            <p className="lp-foot-txt">{w?.tagline || 'Play. Compete. Win.'} Gaming lounge by {name}.</p>
            {socials.length > 0 && (
              <div className="lp-socials">
                {socials.map(({ key, label, Icon, href }) => (
                  <a key={key} href={href} target="_blank" rel="noreferrer noopener" aria-label={label} title={label}>
                    <Icon size={18} />
                  </a>
                ))}
              </div>
            )}
          </div>
          <div>
            <h4>Players</h4>
            <a href={signupOk ? '/portal?signup' : '/portal'}>Create account</a>
            <a href="/portal">Sign in</a>
            {s?.bookingsEnabled && <a href="/portal/book">Book a station</a>}
            <a href="/portal/ranks">Rankings</a>
            <a href="/portal/cups">Tournaments</a>
          </div>
          <div>
            <h4>Venue</h4>
            <a href="#games">Games</a>
            <a href="#about">About us</a>
            <a href="#find">Find us</a>
            <a href="#news">News</a>
          </div>
          <div>
            <h4>Contact</h4>
            {w?.address && <span>{w.address}</span>}
            {s && <span>{hours}</span>}
            {w?.phone && <a href={telLink(w.phone)}>{w.phone}</a>}
            {w?.email && <a href={`mailto:${w.email}`}>{w.email}</a>}
            {s?.socialLinks?.whatsapp && (
              <a href={waLink(s.socialLinks.whatsapp, s.phonePrefix)} target="_blank" rel="noreferrer noopener">
                WhatsApp
              </a>
            )}
          </div>
        </div>
        <div className="lp-wrap lp-foot-bottom">
          <span>
            © {new Date().getFullYear()} {name}
          </span>
          <a href="/login" className="lp-staff">
            Staff
          </a>
        </div>
      </footer>
    </div>
  );
}

// ── Pieces ──

function SectionHead({ kicker, title, more }: { kicker: string; title: string; more?: { href: string; label: string } }) {
  return (
    <div className="lp-head">
      <div>
        <div className="lp-kicker">{kicker}</div>
        <h2 className="lp-h2">{title}</h2>
      </div>
      {more && (
        <a className="lp-more" href={more.href}>
          {more.label} <ChevronRight size={16} />
        </a>
      )}
    </div>
  );
}

function Chip({ icon, title, sub }: { icon: ReactNode; title: string; sub: string }) {
  return (
    <div className="lp-chip">
      <div className="lp-chip-ic">{icon}</div>
      <div>
        <b>{title}</b>
        <span>{sub}</span>
      </div>
    </div>
  );
}

function Step({ n, icon, title, text }: { n: number; icon: ReactNode; title: string; text: string }) {
  return (
    <div className="lp-step">
      <div className="lp-step-n">{n}</div>
      <div className="lp-step-ic">{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function Feature({ icon, title, text, href }: { icon: ReactNode; title: string; text: string; href: string }) {
  return (
    <a className="lp-feature" href={href}>
      <div className="lp-feature-ic">{icon}</div>
      <div>
        <b>{title}</b>
        <span>{text}</span>
      </div>
      <ChevronRight size={18} className="lp-feature-go" />
    </a>
  );
}

function Info({ icon, title, text }: { icon: ReactNode; title: string; text: ReactNode }) {
  return (
    <div className="lp-info">
      <div className="lp-info-ic">{icon}</div>
      <div>
        <span>{title}</span>
        <b>{text}</b>
      </div>
    </div>
  );
}

function GameRow({ games, href }: { games: WebsiteSettings['games']; href: string }) {
  const row = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => row.current?.scrollBy({ left: dir * row.current.clientWidth * 0.8, behavior: 'smooth' });
  if (!games.length) return null;
  return (
    <div className="lp-row-wrap">
      <button className="lp-row-btn left" aria-label="Scroll left" onClick={() => scroll(-1)}>
        <ChevronLeft size={22} />
      </button>
      <div className="lp-row" ref={row}>
        {games.map((g, i) => {
          const [a, b, c] = PALETTES[hash(g.name) % PALETTES.length];
          const Icon = iconFor(g.name, g.tag);
          return (
            <a
              key={`${g.name}-${i}`}
              className="lp-game"
              href={href}
              style={{ ['--ga' as any]: a, ['--gb' as any]: b, ['--gc' as any]: c }}
              aria-label={`Play ${g.name}`}
            >
              <div className="lp-game-art">
                {safeUrl(g.image) ? (
                  <img src={safeUrl(g.image)} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.display = 'none')} />
                ) : (
                  <>
                    <Icon className="lp-game-icon" size={120} strokeWidth={1.2} />
                    <div className="lp-game-title">{g.name}</div>
                  </>
                )}
              </div>
              <div className="lp-game-info">
                <div>
                  <b>{g.name}</b>
                  {g.tag && <span>{g.tag}</span>}
                </div>
                <div className="lp-game-play">
                  <Play size={16} fill="currentColor" />
                </div>
              </div>
            </a>
          );
        })}
      </div>
      <button className="lp-row-btn right" aria-label="Scroll right" onClick={() => scroll(1)}>
        <ChevronRight size={22} />
      </button>
    </div>
  );
}
