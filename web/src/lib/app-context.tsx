import { type Appearance, DEFAULT_APPEARANCE } from './appearance';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { get, getToken, post, setToken, setUnauthorizedHandler } from './api';
import { announce } from './announcer';
import { formatMoney, type CurrencyCfg } from './format';

export interface Me {
  id: string;
  username: string;
  fullName: string;
  role: 'admin' | 'manager' | 'cashier';
  roleName?: string;
  permissions: string[];
  hasPin?: boolean;
}
export type SocialLinks = { youtube: string; tiktok: string; instagram: string; facebook: string; x: string; snapchat: string; whatsapp: string; website: string };
export type MomoAccount = { network: string; number: string; name: string };
export interface Settings extends CurrencyCfg {
  centerName: string;
  countryCode: string;
  timezone: string;
  phonePrefix: string;
  mobileMoneyProviders: string[];
  requireMomoReference: boolean;
  warningMinutes: number[];
  requireOpenShift: boolean;
  defaultCreditLimit?: number;
  portalSelfStart?: boolean;
  autoPayOwed?: boolean;
  receiptHeader: string;
  receiptFooter: string;
  portalEnabled: boolean;
  portalSelfSignup: boolean;
  bookingsEnabled: boolean;
  bookingAutoConfirm: boolean;
  bookingMinNoticeMinutes: number;
  bookingMaxDaysAhead: number;
  bookingGraceMinutes: number;
  openingTime: string;
  closingTime: string;
  powerOffDelaySeconds: number;
  powerOffOnPause: boolean;
  powerEnforce: boolean;
  agentLockWhenIdle: boolean;
  agentScreenOff: boolean;
  agentExitPin: string;
  agentDockStyle: 'island' | 'corner';
  agentWeather: boolean;
  weatherLat: number;
  weatherLon: number;
  leaderboardPublic: boolean;
  matchmakingEnabled: boolean;
  agentIslandScale: number;
  requirePinFor: string[];
  blindShiftClose: boolean;
  momoAccounts: MomoAccount[];
  momoTopupEnabled: boolean;
  momoAutoConfirm: boolean;
  momoAutoMax: number;
  momoAutoHoursOn: boolean;
  momoAutoFrom: string;
  momoAutoTo: string;
  smsNotifyOn: boolean;
  smsNotifyMomo: boolean;
  smsNotifyTopup: boolean;
  smsNotifyGame: boolean;
  smsTemplateMomo: string;
  smsTemplateTopup: string;
  smsTemplateGame: string;
  momoSmsSenders: string[];
  momoMinTopup: number;
  momoMaxTopup: number;
  socialLinks: SocialLinks;
  publicUrl: string;
  autoBackupHours: number;
  autoBackupKeep: number;
  updateRepo: string;
  updateBranch: string;
  chatEnabled: boolean;
  chatBlockedWords: string[];
  rewardsEnabled: boolean;
  newsFeeds: { url: string; name: string }[];
  newsFeedCount: number;
  appearance: Appearance;
  social: SocialSettings;
  website?: WebsiteSettings;
}
export interface WebsiteGame {
  name: string;
  tag: string;
  image: string;
}
export interface WebsiteSettings {
  enabled: boolean;
  tagline: string;
  intro: string;
  about: string;
  address: string;
  mapsLink: string;
  phone: string;
  email: string;
  games: WebsiteGame[];
}
export interface SocialSettings {
  ideasOn: boolean;
  ideasTime: string;
  ideasPerDay: number;
  notifyPhone: string;
  handle: string;
  hashtags: string;
  captionTemplate: string;
  brandDark: string;
  brandMain: string;
  brandPop: string;
  brandLight: string;
}
export interface Toast {
  id: number;
  level: 'info' | 'warning' | 'critical' | 'error' | 'success';
  message: string;
}

interface AppCtx {
  me: Me | null;
  loading: boolean;
  settings: Settings;
  login(username: string, password: string): Promise<void>;
  logout(): void;
  refreshMe(): void;
  can(perm: string): boolean;
  money(minor: number | null | undefined): string;
  toast(level: Toast['level'], message: string): void;
  connected: boolean;
  serverOffsetMs: number;
  setServerTime(iso: string): void;
}

const DEFAULT_SETTINGS: Settings = {
  centerName: 'ZENAA GAMEHUB',
  countryCode: 'GH',
  currencyCode: 'GHS',
  currencyMinorUnits: 2,
  timezone: 'Africa/Accra',
  phonePrefix: '+233',
  mobileMoneyProviders: ['MTN MoMo', 'Telecel Cash', 'AT Money'],
  requireMomoReference: false,
  warningMinutes: [5, 1],
  requireOpenShift: false,
  receiptHeader: '',
  receiptFooter: '',
  portalEnabled: true,
  portalSelfSignup: true,
  bookingsEnabled: true,
  bookingAutoConfirm: true,
  bookingMinNoticeMinutes: 30,
  bookingMaxDaysAhead: 14,
  bookingGraceMinutes: 15,
  openingTime: '10:00',
  closingTime: '23:00',
  powerOffDelaySeconds: 10,
  powerOffOnPause: true,
  powerEnforce: true,
  agentLockWhenIdle: true,
  agentScreenOff: false,
  agentExitPin: '',
  agentDockStyle: 'island',
  agentWeather: true,
  weatherLat: 5.6037,
  weatherLon: -0.187,
  leaderboardPublic: true,
  matchmakingEnabled: true,
  agentIslandScale: 70,
  requirePinFor: [],
  blindShiftClose: false,
  momoAccounts: [],
  momoTopupEnabled: true,
  momoAutoConfirm: true,
  momoAutoMax: 30_000,
  momoAutoHoursOn: false,
  momoAutoFrom: '06:00',
  momoAutoTo: '23:00',
  smsNotifyOn: true,
  smsNotifyMomo: true,
  smsNotifyTopup: true,
  smsNotifyGame: true,
  smsTemplateMomo: 'Hi {name}, thank you! {amount} has been added to your {centre} wallet. Balance: {balance}.',
  smsTemplateTopup: 'Hi {name}, {amount} has been added to your {centre} wallet. Balance: {balance}. Thank you!',
  smsTemplateGame: 'Thanks for playing at {centre}, {name}! {amount} paid for your game on {station}. See you again!',
  momoSmsSenders: [],
  momoMinTopup: 500,
  momoMaxTopup: 200_000,
  socialLinks: { youtube: '', tiktok: '', instagram: '', facebook: '', x: '', snapchat: '', whatsapp: '', website: '' },
  publicUrl: '',
  autoBackupHours: 24,
  autoBackupKeep: 14,
  updateRepo: '',
  updateBranch: 'main',
  chatEnabled: true,
  chatBlockedWords: [],
  rewardsEnabled: true,
  newsFeeds: [],
  newsFeedCount: 2,
  appearance: DEFAULT_APPEARANCE,
  social: {
    ideasOn: true,
    ideasTime: '09:00',
    ideasPerDay: 3,
    notifyPhone: '',
    handle: '',
    hashtags: '#ZenaaMegaGames #ZMG #GamingGhana #PS5',
    captionTemplate: '{title}\n\n{summary}\n\n🎮 Come and play at {centre}!\n{hashtags}',
    brandDark: '#041568',
    brandMain: '#1d44f9',
    brandPop: '#ccf02a',
    brandLight: '#ebfc9c',
  },
};
const Ctx = createContext<AppCtx>(null as unknown as AppCtx);
export const useApp = () => useContext(Ctx);

export function AppProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(!!getToken());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [connected, setConnected] = useState(false);
  const [serverOffsetMs, setOffset] = useState(0);
  const socketRef = useRef<Socket | null>(null);

  const toast = useCallback((level: Toast['level'], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-4), { id, level, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), level === 'critical' || level === 'warning' ? 9000 : 5000);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setMe(null);
    socketRef.current?.disconnect();
    qc.clear();
  }, [qc]);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!getToken()) return;
    // Only a real "not signed in" answer signs the person out; a slow or dropped connection retries.
    let off = false;
    const load = (tries: number) =>
      get<Me>('/api/auth/me')
        .then((m) => {
          if (off) return;
          setMe(m);
          setLoading(false);
        })
        .catch((e: any) => {
          if (off) return;
          const status = e?.status ?? e?.statusCode;
          if (status === 401 || tries >= 6) {
            if (status === 401) setToken(null);
            setLoading(false);
            return;
          }
          setTimeout(() => load(tries + 1), Math.min(4000, 500 * 2 ** tries));
        });
    load(0);
    return () => {
      off = true;
    };
  }, [logout]);

  // Real-time: invalidate the right queries when the server reports a change.
  useEffect(() => {
    if (!me) return;
    const s = io({ path: '/socket.io', auth: { token: getToken() }, transports: ['websocket', 'polling'] });
    socketRef.current = s;
    s.on('connect', () => {
      setConnected(true);
      qc.invalidateQueries();
    });
    s.on('disconnect', () => setConnected(false));
    s.on('event', (e: any) => {
      switch (e.type) {
        case 'sessions.changed':
        case 'stations.changed':
          qc.invalidateQueries({ queryKey: ['stations'] });
          qc.invalidateQueries({ queryKey: ['dashboard'] });
          qc.invalidateQueries({ queryKey: ['sessions'] });
          qc.invalidateQueries({ queryKey: ['tabs'] });
          if (e.sessionId) qc.invalidateQueries({ queryKey: ['session', e.sessionId] });
          break;
        case 'competitions.changed':
          qc.invalidateQueries({ queryKey: ['competitions'] });
          break;
        case 'customers.changed':
          qc.invalidateQueries({ queryKey: ['customers'] });
          qc.invalidateQueries({ queryKey: ['customer', e.customerId] });
          break;
        case 'payments.changed':
          qc.invalidateQueries({ queryKey: ['dashboard'] });
          qc.invalidateQueries({ queryKey: ['payments'] });
          qc.invalidateQueries({ queryKey: ['shift'] });
          qc.invalidateQueries({ queryKey: ['shifts'] });
          qc.invalidateQueries({ queryKey: ['tabs'] });
          break;
        case 'power.changed':
          qc.invalidateQueries({ queryKey: ['stations'] });
          break;
        case 'bookings.changed':
          qc.invalidateQueries({ queryKey: ['bookings'] });
          qc.invalidateQueries({ queryKey: ['stations'] });
          break;
        case 'momo.changed':
          qc.invalidateQueries({ queryKey: ['momo'] });
          break;
        case 'posts.changed':
          qc.invalidateQueries({ queryKey: ['posts'] });
          break;
        case 'chat.changed':
          qc.invalidateQueries({ queryKey: ['chat'] });
          break;
        case 'social.changed':
          qc.invalidateQueries({ queryKey: ['social'] });
          break;
        case 'rewards.changed':
          qc.invalidateQueries({ queryKey: ['rewards'] });
          break;
        case 'alert':
          toast(e.level, e.message);
          announce(e);
          qc.invalidateQueries({ queryKey: ['dashboard'] });
          break;
      }
    });
    return () => {
      s.disconnect();
    };
  }, [me, qc, toast]);

  const settingsQ = useQuery({ queryKey: ['settings'], queryFn: () => get<Settings>('/api/settings'), enabled: !!me, staleTime: 60_000 });
  const settings = settingsQ.data ?? DEFAULT_SETTINGS;

  const value = useMemo<AppCtx>(
    () => ({
      me,
      loading,
      settings,
      async login(username, password) {
        const r = await post<{ token: string; staff: Me }>('/api/auth/login', { username, password });
        setToken(r.token);
        setMe(r.staff);
      },
      logout,
      refreshMe: () => {
        get<Me>('/api/auth/me').then(setMe).catch(() => {});
      },
      can: (p) => !!me?.permissions.includes(p),
      money: (m) => formatMoney(m, settings),
      toast,
      connected,
      serverOffsetMs,
      setServerTime: (iso) => setOffset(Date.parse(iso) - Date.now()),
    }),
    [me, loading, settings, logout, toast, connected, serverOffsetMs],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.level}`}>
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

/** Re-renders every second for live timers. */
export function useTick(ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}
