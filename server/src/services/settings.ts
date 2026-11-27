import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DbOrTx } from '../db/index.js';
import { settings } from '../db/schema.js';

const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, e.g. 09:30');

export const SettingsSchema = z.object({
  centerName: z.string().min(1).max(80),
  /** ISO 3166 country code — pre-fills currency, time zone, phone prefix and mobile-money networks. */
  countryCode: z.string().regex(/^[A-Z]{2}$/).default('GH'),
  currencyCode: z.string().regex(/^[A-Z]{3}$/, 'Use a 3-letter ISO currency code, e.g. GHS, NGN, USD'),
  currencyMinorUnits: z.number().int().min(0).max(3),
  /** IANA time zone used for day boundaries, reports and happy hours, e.g. Africa/Accra. */
  timezone: z
    .string()
    .max(64)
    .refine(isValidTimeZone, 'Unknown time zone')
    .default('Africa/Accra'),
  /** International dialling prefix used to tidy up locally written phone numbers, e.g. +233. */
  phonePrefix: z.string().regex(/^\+\d{1,4}$/, 'Use a prefix like +233').or(z.literal('')).default('+233'),
  /** Mobile-money networks offered at the till (MTN MoMo, Telecel Cash…). */
  mobileMoneyProviders: z.array(z.string().trim().min(1).max(40)).max(12).default(['MTN MoMo', 'Telecel Cash', 'AT Money']),
  /** When true, mobile-money payments must include the network's transaction ID. */
  requireMomoReference: z.boolean().default(false),
  /** Minutes-before-expiry at which staff are alerted for prepaid sessions. */
  warningMinutes: z.array(z.number().int().min(1).max(120)).max(5),
  /** Counter speaker says the player's first name too: "Kofi, PS5 One, 5 minutes remaining". */
  announceNames: z.boolean().default(true),
  /** When true, staff must open a shift (cash drawer) before taking or paying out money. */
  requireOpenShift: z.boolean().default(false),
  /** Credit limit for customers who have none of their own (0 = only customers with their own limit may pay later). */
  defaultCreditLimit: z.number().int().min(0).default(0),
  /** Printed under the centre name on receipts (address, phone…). */
  receiptHeader: z.string().max(300).default(''),
  receiptFooter: z.string().max(300).default('Thank you for playing!'),

  // ── Customer portal & bookings ──
  /** Customers can sign in at /portal. */
  portalEnabled: z.boolean().default(true),
  /** Customers can create their own account (otherwise staff issue activation codes). */
  portalSelfSignup: z.boolean().default(true),
  bookingsEnabled: z.boolean().default(true),
  /** New portal bookings are confirmed straight away (otherwise staff confirm them). */
  bookingAutoConfirm: z.boolean().default(true),
  bookingMinNoticeMinutes: z.number().int().min(0).max(1440).default(30),
  bookingMaxDaysAhead: z.number().int().min(1).max(90).default(14),
  /** A confirmed booking not checked in this many minutes after its start becomes a no-show. */
  bookingGraceMinutes: z.number().int().min(5).max(240).default(15),
  /** Customers can start, pause and stop their own session from the app (their booking, or saved time on a free station). */
  portalSelfStart: z.boolean().default(true),
  /** Money put into a wallet (cash, MoMo, Paystack) first pays what the customer owes. */
  autoPayOwed: z.boolean().default(true),
  /** Opening hours "HH:MM". Closing at or before opening means past midnight; equal = open 24 h. */
  openingTime: TimeSchema.default('10:00'),
  closingTime: TimeSchema.default('23:00'),

  // ── Smart plugs (station power) ──
  /** Seconds to wait after a session ends before switching the station off. */
  powerOffDelaySeconds: z.number().int().min(0).max(600).default(10),
  /** Switch the station off while a session is paused. */
  powerOffOnPause: z.boolean().default(true),
  /** Every minute, switch off active stations that have no session (stops play without paying). */
  powerEnforce: z.boolean().default(true),

  // ── Station screen apps (PC / Android TV) ──
  /** Cover the screen when no session is running ("See the counter to play"). */
  agentLockWhenIdle: z.boolean().default(true),
  /** Android TV: also switch the TV screen off when time is up (needs the app's device-admin permission). */
  agentScreenOff: z.boolean().default(false),
  /** PIN staff type on a station screen to close the app or unlock it by hand. Empty = no exit. */
  agentExitPin: z.string().regex(/^\d{0,8}$/, 'Use up to 8 digits').default(''),
  /** Timer look on the screen apps: a pill at the top centre ("island") or the classic corner box. */
  agentDockStyle: z.enum(['island', 'corner']).default('island'),
  /** Show the outside temperature in the island (the server asks Open-Meteo every 15 minutes; no key needed). */
  agentWeather: z.boolean().default(true),
  weatherLat: z.coerce.number().min(-90).max(90).default(5.6037),
  weatherLon: z.coerce.number().min(-180).max(180).default(-0.187),
  /** Island size on the screen apps, % of the full design (50–100). */
  agentIslandScale: z.number().int().min(40).max(100).default(70),

  // ── Competitions ──
  /** Leaderboards and tournaments are visible without signing in (venue TV, portal visitors). */
  leaderboardPublic: z.boolean().default(true),
  /** Customers can use "Find match" in the portal. */
  matchmakingEnabled: z.boolean().default(true),

  // ── Staff PINs ──
  /** Actions that always need a staff PIN at the counter (cash in/out, refunds…). */
  requirePinFor: z
    .array(z.enum(['cash_movement', 'refund', 'discount', 'wallet_withdraw', 'wallet_adjust', 'shift_close', 'bypass', 'momo_confirm']))
    .default([]),
  /** Shift close: hide the expected cash until the count is entered (blind count). */
  blindShiftClose: z.boolean().default(false),

  // ── MoMo without a gateway ──
  /** Numbers customers send MoMo to (shown in the portal top-up). */
  momoAccounts: z
    .array(z.object({ network: z.string().trim().min(1).max(40), number: z.string().trim().min(5).max(20), name: z.string().trim().max(60).default('') }))
    .max(6)
    .default([]),
  /** Customers can start a MoMo top-up in the portal. */
  momoTopupEnabled: z.boolean().default(true),
  /** Credit automatically when the MoMo phone's SMS matches (otherwise staff confirm every one). */
  momoAutoConfirm: z.boolean().default(true),
  /** Payments of this amount AND ABOVE wait for staff (minor units); smaller ones are credited automatically. 0 = no limit. */
  momoAutoMax: z.number().int().min(0).default(30_000),
  /** Only credit automatically between these local times; outside them (e.g. late at night) payments wait for staff. */
  momoAutoHoursOn: z.boolean().default(false),
  momoAutoFrom: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 06:00').default('06:00'),
  momoAutoTo: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 23:00').default('23:00'),
  /** Thank-you SMS to customers, sent from the MoMo phone (ZENAA MoMo app 1.2+). */
  smsNotifyOn: z.boolean().default(true),
  smsNotifyMomo: z.boolean().default(true),
  smsNotifyTopup: z.boolean().default(true),
  smsNotifyGame: z.boolean().default(true),
  smsTemplateMomo: z.string().trim().min(5).max(300).default('Hi {name}, thank you! {amount} has been added to your {centre} wallet. Balance: {balance}.'),
  smsTemplateTopup: z.string().trim().min(5).max(300).default('Hi {name}, {amount} has been added to your {centre} wallet. Balance: {balance}. Thank you!'),
  smsTemplateGame: z.string().trim().min(5).max(300).default('Thanks for playing at {centre}, {name}! {amount} paid for your game on {station}. See you again!'),
  /** SMS sender names trusted as the MoMo service (case-insensitive). Messages from phone numbers are never trusted. */
  momoSmsSenders: z.array(z.string().trim().min(2).max(30)).max(20).default(['MobileMoney', 'MTN MoMo', 'MTNMoMo', 'T-CASH', 'TelecelCash', 'Telecel', 'VodaCash', 'AT Money', 'AirtelTigo']),
  /** Minimum and maximum portal top-up (minor units). */
  momoMinTopup: z.number().int().min(0).default(500),
  momoMaxTopup: z.number().int().min(0).default(200_000),

  // ── Socials (portal "Follow us", QR posters) ──
  socialLinks: z
    .object({
      youtube: z.string().trim().max(200).default(''),
      tiktok: z.string().trim().max(200).default(''),
      instagram: z.string().trim().max(200).default(''),
      facebook: z.string().trim().max(200).default(''),
      x: z.string().trim().max(200).default(''),
      snapchat: z.string().trim().max(200).default(''),
      whatsapp: z.string().trim().max(200).default(''),
      website: z.string().trim().max(200).default(''),
    })
    .default({}),
  /** Address customers use to reach the portal (for QR posters), e.g. https://play.zenaa.gh — empty = this server. */
  publicUrl: z.string().trim().max(200).default(''),

  // ── Backups & updates ──
  /** Hours between automatic backups written by the app (0 = off). */
  autoBackupHours: z.number().int().min(0).max(168).default(24),
  autoBackupKeep: z.number().int().min(1).max(365).default(14),
  /** GitHub repository with ZENAA updates, e.g. myname/zenaa-gamehub. Empty = updates not set up. */
  updateRepo: z.string().trim().regex(/^$|^[\w.-]+\/[\w.-]+$/, 'Use owner/repository').default(''),
  updateBranch: z.string().trim().max(60).default('main'),

  // ── Customer chat ──
  /** Customers can chat in the portal (everyone's "Lobby" and private messages). */
  chatEnabled: z.boolean().default(true),
  /** Words hidden with *** in chat messages. */
  chatBlockedWords: z.array(z.string().trim().min(2).max(40)).max(200).default([]),

  // ── Rewards ──
  /** Customers see the Rewards page (follow us for a bonus, bonus codes, promo codes). */
  rewardsEnabled: z.boolean().default(true),

  // ── Game news from other websites ──
  /** RSS/Atom feeds (or website addresses that have one) whose newest stories are mixed into the portal news. */
  newsFeeds: z
    .array(z.object({ url: z.string().trim().url().max(300).regex(/^https?:\/\//i, 'Use an http(s) address'), name: z.string().trim().max(40).default('') }))
    .max(8)
    .default([]),
  /** How many outside stories to show next to your own news (0 = none). */
  newsFeedCount: z.number().int().min(0).max(10).default(2),

  // ── Appearance (staff app and customer app) ──
  appearance: z
    .object({
      /** Main colour: buttons, links, the selected menu item. */
      primary: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #7c5cff').default('#7c5cff'),
      /** Second colour of gradients (logo tile, customer app banners). */
      accent: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #7c5cff').default('#c04cff'),
      /** Text size in percent (100 = normal). */
      textScale: z.number().int().min(85).max(130).default(100),
      /** Body font. */
      font: z.enum(['inter', 'segoe', 'verdana', 'trebuchet', 'tahoma', 'georgia']).default('inter'),
      /** Heading font: same as body, or a bold brand style. */
      headingFont: z.enum(['same', 'anton', 'archivo']).default('same'),
      /** Corner roundness. */
      corners: z.enum(['sharp', 'normal', 'round']).default('normal'),
      /** Dark backgrounds tinted with the main colour (e.g. navy for a blue brand) instead of neutral grey. */
      tintedBackground: z.boolean().default(false),
      /** Theme for devices that never picked light/dark themselves. */
      defaultTheme: z.enum(['dark', 'light', 'system']).default('dark'),
      /** Use the same colours in the customer app. */
      applyToPortal: z.boolean().default(true),
    })
    .default({}),

  // ── Social (Social page: post ideas from news, graphics, posting) ──
  social: z
    .object({
      /** Make post ideas from the newest game news every day. */
      ideasOn: z.boolean().default(true),
      ideasTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:00').default('09:00'),
      ideasPerDay: z.number().int().min(1).max(10).default(3),
      /** Text this phone (through the MoMo phone) when new ideas are ready. Empty = only the alert in ZENAA. */
      notifyPhone: z.string().trim().max(20).default(''),
      /** Your handle printed on graphics, e.g. @zenaamegagames */
      handle: z.string().trim().max(40).default(''),
      hashtags: z.string().trim().max(300).default('#ZenaaMegaGames #ZMG #GamingGhana #PS5'),
      captionTemplate: z.string().trim().max(1000).default('{title}\n\n{summary}\n\n🎮 Come and play at {centre}!\n{hashtags}'),
      /** Brand colours used in graphics. */
      brandDark: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #7c5cff').default('#041568'),
      brandMain: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #7c5cff').default('#1d44f9'),
      brandPop: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #7c5cff').default('#ccf02a'),
      brandLight: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #7c5cff').default('#ebfc9c'),
    })
    .default({}),

  // ── Public home page (what visitors and Google see before signing in) ──
  website: z
    .object({
      /** Show the home page at the main address. Off = visitors go straight to the staff sign-in. */
      enabled: z.boolean().default(true),
      /** Big line at the top. */
      tagline: z.string().trim().max(80).default('Play. Compete. Win.'),
      /** Short text under the tagline, also used as the Google description. */
      intro: z.string().trim().max(300).default(''),
      /** "About us" text. Blank lines start a new paragraph. */
      about: z.string().trim().max(2000).default(''),
      /** Street address / area, shown in "Find us" and used to place the Google map. */
      address: z.string().trim().max(200).default(''),
      /** Optional Google Maps link (Share → Copy link) for the "Directions" button. */
      mapsLink: z.string().trim().max(300).default(''),
      phone: z.string().trim().max(30).default(''),
      email: z.string().trim().max(120).default(''),
      /** Game cards on the home page. */
      games: z
        .array(
          z.object({
            name: z.string().trim().min(1).max(40),
            tag: z.string().trim().max(30).default(''),
            /** Optional picture address (https://…). Empty = a coloured card. */
            image: z.string().trim().max(500).default(''),
          }),
        )
        .max(24)
        .default([]),
    })
    .default({}),
});
export type AppSettings = z.infer<typeof SettingsSchema>;

export function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Applies the configured time zone to this process so "today", reports and happy hours use local time. */
export function applyTimezone(tz: string | undefined) {
  if (tz && isValidTimeZone(tz)) process.env.TZ = tz;
}

export const DEFAULT_SETTINGS: AppSettings = {
  centerName: 'ZENAA GAMEHUB',
  countryCode: 'GH',
  currencyCode: 'GHS',
  currencyMinorUnits: 2,
  timezone: 'Africa/Accra',
  phonePrefix: '+233',
  mobileMoneyProviders: ['MTN MoMo', 'Telecel Cash', 'AT Money'],
  requireMomoReference: false,
  warningMinutes: [5, 1],
  announceNames: true,
  requireOpenShift: false,
  defaultCreditLimit: 0,
  receiptHeader: '',
  receiptFooter: 'Thank you for playing!',
  portalEnabled: true,
  portalSelfSignup: true,
  bookingsEnabled: true,
  bookingAutoConfirm: true,
  bookingMinNoticeMinutes: 30,
  bookingMaxDaysAhead: 14,
  bookingGraceMinutes: 15,
  portalSelfStart: true,
  autoPayOwed: true,
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
  agentIslandScale: 70,
  leaderboardPublic: true,
  matchmakingEnabled: true,
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
  momoSmsSenders: ['MobileMoney', 'MTN MoMo', 'MTNMoMo', 'T-CASH', 'TelecelCash', 'Telecel', 'VodaCash', 'AT Money', 'AirtelTigo'],
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
  appearance: {
    primary: '#7c5cff',
    accent: '#c04cff',
    textScale: 100,
    font: 'inter',
    headingFont: 'same',
    corners: 'normal',
    tintedBackground: false,
    defaultTheme: 'dark',
    applyToPortal: true,
  },
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
  website: {
    enabled: true,
    tagline: 'Play. Compete. Win.',
    intro: 'PS5 stations, racing wheel setups, tournaments and a players app with your wallet, bookings and rankings.',
    about:
      'ZENAA GAMEHUB by ZENAA MEGA GAMES is a gaming lounge built for players. Come alone or bring the squad: book a station, top up with MoMo, and climb the leaderboard.\n\nWe run regular tournaments, keep the newest games ready to play, and our players app keeps your time, wallet and rankings in your pocket.',
    address: '',
    mapsLink: '',
    phone: '',
    email: '',
    games: [
      { name: 'EA SPORTS FC', tag: 'Football', image: '' },
      { name: 'Call of Duty', tag: 'Shooter', image: '' },
      { name: 'Grand Theft Auto', tag: 'Open world', image: '' },
      { name: 'Racing Wheel', tag: 'Gran Turismo · F1', image: '' },
      { name: 'Mortal Kombat', tag: 'Fighting', image: '' },
      { name: 'Tekken 8', tag: 'Fighting', image: '' },
      { name: 'NBA 2K', tag: 'Basketball', image: '' },
      { name: 'WWE 2K', tag: 'Wrestling', image: '' },
      { name: 'Fortnite', tag: 'Battle royale', image: '' },
      { name: "Marvel's Spider-Man", tag: 'Adventure', image: '' },
    ],
  },
};

const KEY = 'app';

export async function getSettings(db: DbOrTx): Promise<AppSettings> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  const envTz = process.env.TZ && isValidTimeZone(process.env.TZ) ? process.env.TZ : DEFAULT_SETTINGS.timezone;
  const v = (row?.value as Partial<AppSettings>) ?? {};
  // Grouped settings saved by an older version may lack newer keys: fill them from the defaults.
  return {
    ...DEFAULT_SETTINGS,
    timezone: envTz,
    ...v,
    appearance: { ...DEFAULT_SETTINGS.appearance, ...(v.appearance ?? {}) },
    social: { ...DEFAULT_SETTINGS.social, ...(v.social ?? {}) },
    website: { ...DEFAULT_SETTINGS.website, ...(v.website ?? {}) },
  };
}

export async function saveSettings(db: DbOrTx, value: AppSettings) {
  await db
    .insert(settings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

export async function getKv<T>(db: DbOrTx, key: string): Promise<T | undefined> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  return row?.value as T | undefined;
}

/** Stores a value; null/undefined removes the key (the column can't hold SQL NULL). */
export async function setKv(db: DbOrTx, key: string, value: unknown) {
  if (value === null || value === undefined) {
    await db.delete(settings).where(eq(settings.key, key));
    return;
  }
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}
