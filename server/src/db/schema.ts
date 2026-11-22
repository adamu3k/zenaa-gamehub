/**
 * ZENAA GAMEHUB database schema.
 *
 * Conventions:
 *  - All money columns are BIGINT in currency minor units (e.g. kobo / pesewas / cents).
 *  - All timestamps are timestamptz.
 *  - Ledgers (wallet_transactions, payments, session_events, audit_logs) are append-only.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { RateSnapshot } from '../billing/engine.js';

const money = (name: string) => bigint(name, { mode: 'number' });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

// ───────────────────────── Staff, auth, audit, settings ─────────────────────────

export const staffRole = pgEnum('staff_role', ['admin', 'manager', 'cashier']);

export type PermissionOverrides = { grant: string[]; revoke: string[] };

/** Custom user types (e.g. "Supervisor", "Attendant") with their own permission set. */
export const staffRoles = pgTable('staff_roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  description: text('description'),
  permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const staff = pgTable('staff', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').notNull().unique(),
  fullName: text('full_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  role: staffRole('role').notNull(),
  /** Custom user type. When set, its permissions replace the built-in role defaults (role is then 'cashier'). */
  roleId: uuid('role_id').references(() => staffRoles.id),
  permissions: jsonb('permissions').$type<PermissionOverrides>().notNull().default({ grant: [], revoke: [] }),
  active: boolean('active').notNull().default(true),
  /** Incremented on password change / deactivation to revoke issued tokens. */
  tokenVersion: integer('token_version').notNull().default(0),
  lastLoginAt: ts('last_login_at'),
  /** Keyed hash of the staff PIN (HMAC, unique) used to approve actions and unlock station screens. */
  pinHash: text('pin_hash').unique(),
  pinSetAt: ts('pin_set_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    staffId: uuid('staff_id').references(() => staff.id),
    action: text('action').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    details: jsonb('details').$type<Record<string, unknown>>(),
    ip: text('ip'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('audit_logs_created_at_idx').on(t.createdAt), index('audit_logs_staff_idx').on(t.staffId)],
);

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

// ───────────────────────── Stations & pricing ─────────────────────────

export const stationPlatform = pgEnum('station_platform', [
  'ps5',
  'ps4',
  'xbox_series',
  'xbox_one',
  'nintendo_switch',
  'pc',
  'vr',
  'racing_sim',
  'other',
]);

export const stationStatus = pgEnum('station_status', ['active', 'maintenance', 'offline', 'archived']);

export const stationCategories = pgTable('station_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  description: text('description'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const stations = pgTable('stations', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  platform: stationPlatform('platform').notNull().default('ps5'),
  categoryId: uuid('category_id').references(() => stationCategories.id),
  status: stationStatus('status').notNull().default('active'),
  /** Optional per-station hourly rate (minor units) overriding time-rate plans. */
  hourlyRateOverride: money('hourly_rate_override'),
  notes: text('notes'),
  sortOrder: integer('sort_order').notNull().default(0),
  /** Smart-plug driver controlling this station's power: none | sonoff_diy | tasmota | shelly_gen1 | shelly_gen2. */
  powerDriver: text('power_driver').notNull().default('none'),
  powerConfig: jsonb('power_config').$type<PowerConfig>(),
  /** Last state reported by the plug: on | off | unknown. */
  powerState: text('power_state').notNull().default('unknown'),
  powerCheckedAt: ts('power_checked_at'),
  powerError: text('power_error'),
  /** Station screen app (PC / Android TV): bump to unpair every device paired to this station. */
  agentTokenVersion: integer('agent_token_version').notNull().default(0),
  agentLastSeenAt: ts('agent_last_seen_at'),
  agentInfo: jsonb('agent_info').$type<{ kind?: string; name?: string; version?: string; ip?: string }>(),
  /** Message from staff shown on the station screen (latest only). */
  screenMessage: jsonb('screen_message').$type<{ id: string; text: string; at: string }>(),
  /** Staff unlock ("turn on, no charge"): screen unlocked and plug on until this time, without a session. */
  bypassUntil: ts('bypass_until'),
  bypassBy: uuid('bypass_by'),
  bypassReason: text('bypass_reason'),
  /** Last console IP used for the PS4/PS5 timer payload. */
  consoleHost: text('console_host'),
  /** Room / area, e.g. "Downstairs", "Upstairs", "VIP room" (stations are grouped by it). */
  room: text('room'),
  /** Remote view: the station's VNC server. Blank host = the IP its screen app reports. Password is secret. */
  vncConfig: jsonb('vnc_config').$type<{ host?: string; port?: number; password?: string }>(),
  /** Deleted stations that still have history are hidden instead of removed. */
  deletedAt: ts('deleted_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export type PowerConfig = {
  host?: string;
  deviceId?: string;
  /** eWeLink LAN encryption key (SONOFF R4 and other non-DIY devices). Secret — never sent to browsers. */
  deviceKey?: string;
  channel?: number;
  username?: string;
  password?: string;
  /** Home Assistant entity (switch.tv_plug) or ESPHome switch id (relay). */
  entityId?: string;
  /** Home Assistant long-lived access token. Secret. */
  token?: string;
  /** Custom HTTP integration. */
  onUrl?: string;
  offUrl?: string;
  statusUrl?: string;
  method?: 'GET' | 'POST' | 'PUT';
  onBody?: string;
  offBody?: string;
  contentType?: string;
  /** Sent as the Authorization header. Secret. */
  authHeader?: string;
  /** Text (or /regex/) in the status answer that means ON. */
  statusOnMatch?: string;
};

export const planKind = pgEnum('plan_kind', ['time_rate', 'package']);

export const pricingPlans = pgTable('pricing_plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  kind: planKind('kind').notNull(),
  /** Null = applies to every station category. */
  categoryId: uuid('category_id').references(() => stationCategories.id),
  ratePerHour: money('rate_per_hour').notNull(),
  billingUnitMinutes: integer('billing_unit_minutes').notNull().default(1),
  minimumMinutes: integer('minimum_minutes').notNull().default(0),
  graceMinutes: integer('grace_minutes').notNull().default(0),
  packageMinutes: integer('package_minutes'),
  packagePrice: money('package_price'),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: ts('created_at').notNull().defaultNow(),
});

// ───────────────────────── Customers & wallet ─────────────────────────

export const membershipTiers = pgTable('membership_tiers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  discountPercent: integer('discount_percent').notNull().default(0),
  /** Minor units of spend required to earn 1 loyalty point (0 = no points). */
  spendPerPoint: money('spend_per_point').notNull().default(0),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const customerStatus = pgEnum('customer_status', ['active', 'suspended']);

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Sequential number shown as the customer ID, e.g. ZG-000042. */
    number: serial('number').notNull().unique(),
    fullName: text('full_name').notNull(),
    phone: text('phone').unique(),
    email: text('email'),
    tierId: uuid('tier_id').references(() => membershipTiers.id),
    balance: money('balance').notNull().default(0),
    /** Maximum unpaid "pay later" balance allowed (minor units). 0 = tabs not allowed. */
    creditLimit: money('credit_limit').notNull().default(0),
    points: integer('points').notNull().default(0),
    status: customerStatus('status').notNull().default('active'),
    notes: text('notes'),
    /** Customer-portal sign-in. Null = no portal account yet. */
    passwordHash: text('password_hash'),
    portalEnabled: boolean('portal_enabled').notNull().default(true),
    portalTokenVersion: integer('portal_token_version').notNull().default(0),
    portalLastLoginAt: ts('portal_last_login_at'),
    /** Hashed one-time code staff give a customer to activate (or reset) their portal account. */
    activationCodeHash: text('activation_code_hash'),
    activationExpiresAt: ts('activation_expires_at'),
    /** Player name shown on leaderboards and in Find match (unique, case-insensitive). */
    gamertag: text('gamertag'),
    /** PlayStation Network ID, shared only with matched opponents. */
    psnId: text('psn_id'),
    /** EA ID (EA SPORTS FC online friendlies), shared only with matched opponents. */
    eaId: text('ea_id'),
    /** Hide from public leaderboards (still listed to staff). */
    leaderboardHidden: boolean('leaderboard_hidden').notNull().default(false),
    /** Staff muted this player in the customer chat (can still read). */
    chatMuted: boolean('chat_muted').notNull().default(false),
    /** Profile picture (data: URL, small JPEG made by the app) and when it changed (for caching). */
    avatar: text('avatar'),
    avatarAt: ts('avatar_at'),
    /** Saved playing time (seconds) the customer can continue on a later visit. */
    savedSeconds: integer('saved_seconds').notNull().default(0),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('customers_name_idx').on(t.fullName), uniqueIndex('customers_gamertag_idx').on(sql`lower(${t.gamertag})`)],
);

// ───────────────────────── Shifts & payments ─────────────────────────

export const shifts = pgTable(
  'shifts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id),
    openedAt: ts('opened_at').notNull().defaultNow(),
    closedAt: ts('closed_at'),
    openingFloat: money('opening_float').notNull().default(0),
    expectedCash: money('expected_cash'),
    countedCash: money('counted_cash'),
    /** Notes and coins counted at close: { "200": 3, "0.5": 4 } (face value → count). */
    countedBreakdown: jsonb('counted_breakdown').$type<Record<string, number>>(),
    /** Mobile money actually received during the shift (from the MoMo phone/statement), for reconciliation. */
    countedMomo: money('counted_momo'),
    /** Frozen totals per payment method at close, for the Z-report. */
    summary: jsonb('summary').$type<Record<string, unknown>>(),
    closedBy: uuid('closed_by').references(() => staff.id),
    notes: text('notes'),
  },
  (t) => [uniqueIndex('shifts_one_open_per_staff').on(t.staffId).where(sql`closed_at is null`)],
);

export const paymentMethod = pgEnum('payment_method', ['cash', 'card', 'bank_transfer', 'mobile_money', 'wallet', 'paystack']);
export const paymentKind = pgEnum('payment_kind', [
  'session',
  'extension',
  'sale',
  'deposit',
  'withdrawal',
  'refund',
  'cash_in',
  'cash_out',
]);

// ───────────────────────── Promotions ─────────────────────────

/** Recurring discount windows, e.g. Mon–Fri 12:00–16:00 at 20% off. Applied when a session starts. */
export const happyHours = pgTable('happy_hours', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  /** 0 = Sunday … 6 = Saturday. */
  days: jsonb('days').$type<number[]>().notNull(),
  /** Minutes after local midnight. end < start means the window runs past midnight. */
  startMinute: integer('start_minute').notNull(),
  endMinute: integer('end_minute').notNull(),
  discountPercent: integer('discount_percent').notNull(),
  /** Null = every station category. */
  categoryId: uuid('category_id').references(() => stationCategories.id),
  active: boolean('active').notNull().default(true),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const promoCodes = pgTable('promo_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Stored upper-case. */
  code: text('code').notNull().unique(),
  description: text('description'),
  /** Exactly one of percentOff / amountOff is set. */
  percentOff: integer('percent_off'),
  amountOff: money('amount_off'),
  minSpend: money('min_spend').notNull().default(0),
  validFrom: ts('valid_from'),
  validTo: ts('valid_to'),
  /** Null = unlimited. */
  maxUses: integer('max_uses'),
  usesCount: integer('uses_count').notNull().default(0),
  active: boolean('active').notNull().default(true),
  /** Listed on the customer app's Rewards page so customers can copy it. */
  showInPortal: boolean('show_in_portal').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
});

// ───────────────────────── Sessions ─────────────────────────

export const sessionStatus = pgEnum('session_status', ['running', 'paused', 'ended']);
export const billingType = pgEnum('billing_type', ['prepaid', 'postpaid']);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: serial('number').notNull().unique(),
    stationId: uuid('station_id')
      .notNull()
      .references(() => stations.id),
    customerId: uuid('customer_id').references(() => customers.id),
    /** While paused: off (screen locked + plug off) | screen (locked, power stays on) | open (clock stopped only). */
    pauseMode: text('pause_mode'),
    planId: uuid('plan_id')
      .notNull()
      .references(() => pricingPlans.id),
    /** Frozen copy of the plan/rate at start so later price changes never alter a bill. */
    rate: jsonb('rate').$type<RateSnapshot>().notNull(),
    discountPercent: integer('discount_percent').notNull().default(0),
    /** Set when the percentage discount came from a happy-hour rule rather than the membership tier. */
    happyHourId: uuid('happy_hour_id').references(() => happyHours.id),
    promoCodeId: uuid('promo_code_id').references(() => promoCodes.id),
    promoDiscount: money('promo_discount').notNull().default(0),
    /** Manual checkout discount (requires payments.discount). */
    manualDiscount: money('manual_discount').notNull().default(0),
    billingType: billingType('billing_type').notNull(),
    status: sessionStatus('status').notNull().default('running'),
    startedAt: ts('started_at').notNull(),
    lastResumedAt: ts('last_resumed_at'),
    accumulatedSeconds: integer('accumulated_seconds').notNull().default(0),
    allottedSeconds: integer('allotted_seconds'),
    endedAt: ts('ended_at'),
    endReason: text('end_reason'),
    billedMinutes: integer('billed_minutes').notNull().default(0),
    grossAmount: money('gross_amount').notNull().default(0),
    discountAmount: money('discount_amount').notNull().default(0),
    netAmount: money('net_amount').notNull().default(0),
    /** Gross money received against this bill (refunds are tracked separately). */
    paidAmount: money('paid_amount').notNull().default(0),
    refundedAmount: money('refunded_amount').notNull().default(0),
    /** Ended with an unpaid balance the customer will pay later. */
    onTab: boolean('on_tab').notNull().default(false),
    /** Seconds taken from the customer's saved time when the session started (no charge for them). */
    fromSavedSeconds: integer('from_saved_seconds').notNull().default(0),
    /** Unplayed seconds put back on the customer's account when the session ended. */
    savedSeconds: integer('saved_seconds').notNull().default(0),
    groupId: uuid('group_id'),
    note: text('note'),
    startedBy: uuid('started_by').references(() => staff.id),
    endedBy: uuid('ended_by').references(() => staff.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    // Hard guarantee: a station can never have two open sessions (double-start protection).
    uniqueIndex('sessions_one_open_per_station').on(t.stationId).where(sql`status <> 'ended'`),
    index('sessions_started_at_idx').on(t.startedAt),
    index('sessions_customer_idx').on(t.customerId),
  ],
);

export const sessionEventType = pgEnum('session_event_type', [
  'start',
  'pause',
  'resume',
  'extend',
  'end',
  'warning',
  'system_pause',
  'payment',
  'refund',
]);

export const sessionEvents = pgTable(
  'session_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id),
    type: sessionEventType('type').notNull(),
    at: ts('at').notNull(),
    secondsAdded: integer('seconds_added'),
    amount: money('amount'),
    staffId: uuid('staff_id').references(() => staff.id),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
  },
  (t) => [index('session_events_session_idx').on(t.sessionId)],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: serial('number').notNull().unique(),
    kind: paymentKind('kind').notNull(),
    method: paymentMethod('method').notNull(),
    /** Signed: positive = money received, negative = money paid out. */
    amount: money('amount').notNull(),
    sessionId: uuid('session_id').references(() => sessions.id),
    customerId: uuid('customer_id').references(() => customers.id),
    staffId: uuid('staff_id').references(() => staff.id),
    shiftId: uuid('shift_id').references(() => shifts.id),
    /** For refunds: the payment being refunded. */
    refundOfId: uuid('refund_of_id'),
    /** Mobile money / card / transfer reference, e.g. "MTN MoMo · 4429183301". */
    reference: text('reference'),
    /** Cash out / expenses: supplies, electricity, salary, owner withdrawal, bank deposit… */
    category: text('category'),
    /** Staff member who approved with their PIN (manager override), if any. */
    approvedBy: uuid('approved_by'),
    note: text('note'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('payments_created_at_idx').on(t.createdAt),
    index('payments_session_idx').on(t.sessionId),
    index('payments_shift_idx').on(t.shiftId),
    index('payments_refund_of_idx').on(t.refundOfId),
  ],
);

export const walletTxType = pgEnum('wallet_tx_type', ['deposit', 'withdrawal', 'charge', 'refund', 'adjustment', 'bonus']);

export const walletTransactions = pgTable(
  'wallet_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    type: walletTxType('type').notNull(),
    /** Signed change to the balance. */
    amount: money('amount').notNull(),
    balanceAfter: money('balance_after').notNull(),
    sessionId: uuid('session_id').references(() => sessions.id),
    paymentId: uuid('payment_id').references(() => payments.id),
    staffId: uuid('staff_id').references(() => staff.id),
    note: text('note'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('wallet_tx_customer_idx').on(t.customerId, t.createdAt)],
);

// ───────────────────────── Bookings ─────────────────────────

export const bookingStatus = pgEnum('booking_status', ['pending', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show']);

export const bookings = pgTable(
  'bookings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: serial('number').notNull().unique(),
    customerId: uuid('customer_id').references(() => customers.id),
    /** For bookings taken by phone for people without an account. */
    contactName: text('contact_name'),
    contactPhone: text('contact_phone'),
    stationId: uuid('station_id')
      .notNull()
      .references(() => stations.id),
    startAt: ts('start_at').notNull(),
    endAt: ts('end_at').notNull(),
    status: bookingStatus('status').notNull().default('pending'),
    /** portal | staff */
    source: text('source').notNull(),
    sessionId: uuid('session_id').references(() => sessions.id),
    note: text('note'),
    cancelReason: text('cancel_reason'),
    createdBy: uuid('created_by').references(() => staff.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('bookings_station_start_idx').on(t.stationId, t.startAt), index('bookings_customer_idx').on(t.customerId)],
);

// ───────────────────────── Online payments (Paystack) ─────────────────────────

export const onlinePaymentStatus = pgEnum('online_payment_status', ['pending', 'success', 'failed', 'expired']);

export const onlinePayments = pgTable(
  'online_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: text('provider').notNull().default('paystack'),
    /** Our reference sent to the provider (unique). */
    reference: text('reference').notNull().unique(),
    /** wallet_topup */
    purpose: text('purpose').notNull(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    amount: money('amount').notNull(),
    currency: text('currency').notNull(),
    email: text('email').notNull(),
    status: onlinePaymentStatus('status').notNull().default('pending'),
    /** Staff member who started it at the counter; null = customer via the portal. */
    initiatedBy: uuid('initiated_by').references(() => staff.id),
    authorizationUrl: text('authorization_url'),
    /** Our payments row once the money has been credited. */
    paymentId: uuid('payment_id').references(() => payments.id),
    channel: text('channel'),
    providerData: jsonb('provider_data').$type<Record<string, unknown>>(),
    failureReason: text('failure_reason'),
    lastCheckedAt: ts('last_checked_at'),
    paidAt: ts('paid_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('online_payments_status_idx').on(t.status, t.createdAt), index('online_payments_customer_idx').on(t.customerId)],
);

// ───────────────────────── Competitions: games, matches, tournaments, matchmaking ─────────────────────────

export const games = pgTable('games', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  shortName: text('short_name'),
  /** goals (football), points (basketball), rounds (fighting games). Only changes labels. */
  scoring: text('scoring').notNull().default('goals'),
  allowDraws: boolean('allow_draws').notNull().default(true),
  /** How two players meet online in this game (shown in Find match). */
  onlineHowTo: text('online_how_to'),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const tournamentFormat = pgEnum('tournament_format', ['knockout', 'league', 'groups_knockout']);
export const tournamentStatus = pgEnum('tournament_status', ['draft', 'registration', 'live', 'completed', 'cancelled']);

export type Prize = { place: number; amount: number; label?: string };

export const tournaments = pgTable('tournaments', {
  id: uuid('id').primaryKey().defaultRandom(),
  number: serial('number').notNull().unique(),
  name: text('name').notNull(),
  gameId: uuid('game_id')
    .notNull()
    .references(() => games.id),
  format: tournamentFormat('format').notNull(),
  status: tournamentStatus('status').notNull().default('draft'),
  maxPlayers: integer('max_players').notNull().default(16),
  /** Groups / divisions for the group-stage format. */
  groupCount: integer('group_count').notNull().default(1),
  /** Players going through from each group to the knockout stage. */
  advancePerGroup: integer('advance_per_group').notNull().default(2),
  /** Play every opponent twice in league / group matches. */
  doubleRoundRobin: boolean('double_round_robin').notNull().default(false),
  thirdPlaceMatch: boolean('third_place_match').notNull().default(false),
  pointsWin: integer('points_win').notNull().default(3),
  pointsDraw: integer('points_draw').notNull().default(1),
  entryFee: money('entry_fee').notNull().default(0),
  prizes: jsonb('prizes').$type<Prize[]>().notNull().default([]),
  /** Customers can register themselves in the portal while status is "registration". */
  publicRegistration: boolean('public_registration').notNull().default(true),
  startsAt: ts('starts_at'),
  description: text('description'),
  rules: text('rules'),
  championId: uuid('champion_id').references(() => customers.id),
  createdBy: uuid('created_by').references(() => staff.id),
  startedAt: ts('started_at'),
  completedAt: ts('completed_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const entryStatus = pgEnum('entry_status', ['registered', 'active', 'eliminated', 'winner', 'withdrawn']);

export const tournamentEntries = pgTable(
  'tournament_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    seed: integer('seed'),
    groupName: text('group_name'),
    status: entryStatus('status').notNull().default('registered'),
    paid: boolean('paid').notNull().default(false),
    paidNote: text('paid_note'),
    finalPlace: integer('final_place'),
    prizeAmount: money('prize_amount'),
    prizePaidAt: ts('prize_paid_at'),
    prizePaidNote: text('prize_paid_note'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('tournament_entries_unique').on(t.tournamentId, t.customerId)],
);

export const matchStatus = pgEnum('match_status', ['scheduled', 'pending_confirmation', 'completed', 'cancelled']);

export const matches = pgTable(
  'matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: serial('number').notNull().unique(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id),
    tournamentId: uuid('tournament_id').references(() => tournaments.id, { onDelete: 'cascade' }),
    /** friendly | league | group | knockout | third_place */
    stage: text('stage').notNull().default('friendly'),
    /** League/group matchday, or knockout round (1 = first round). */
    round: integer('round'),
    groupName: text('group_name'),
    /** Position within a knockout round (0-based). */
    bracketSlot: integer('bracket_slot'),
    homeId: uuid('home_id').references(() => customers.id),
    awayId: uuid('away_id').references(() => customers.id),
    homeScore: integer('home_score'),
    awayScore: integer('away_score'),
    homePens: integer('home_pens'),
    awayPens: integer('away_pens'),
    winnerId: uuid('winner_id').references(() => customers.id),
    /** Bye or forfeit: no score, counts for advancement only. */
    walkover: boolean('walkover').notNull().default(false),
    status: matchStatus('status').notNull().default('scheduled'),
    /** Customer who reported the score in the portal (awaiting the opponent's confirmation). */
    reportedBy: uuid('reported_by').references(() => customers.id),
    recordedBy: uuid('recorded_by').references(() => staff.id),
    stationId: uuid('station_id').references(() => stations.id),
    matchRequestId: uuid('match_request_id'),
    /** Online: room ID / password set by either player, visible to both. */
    lobbyCode: text('lobby_code'),
    scheduledAt: ts('scheduled_at'),
    playedAt: ts('played_at'),
    note: text('note'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('matches_played_idx').on(t.gameId, t.playedAt),
    index('matches_tournament_idx').on(t.tournamentId),
    index('matches_home_idx').on(t.homeId),
    index('matches_away_idx').on(t.awayId),
  ],
);

export const matchRequestStatus = pgEnum('match_request_status', ['open', 'matched', 'completed', 'cancelled', 'expired']);

/** "Find match": a player looking for an opponent, or challenging one directly. */
export const matchRequests = pgTable(
  'match_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: serial('number').notNull().unique(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id),
    /** venue = play here at the centre; online = over PSN. */
    mode: text('mode').notNull().default('venue'),
    /** any | similar (opponents within 150 rating points). */
    skill: text('skill').notNull().default('any'),
    preferredAt: ts('preferred_at'),
    note: text('note'),
    /** Online play: room ID / password / lobby code (eFootball rooms, private lobbies) — shown only to the opponent. */
    lobbyCode: text('lobby_code'),
    /** Direct challenge: only this player can accept. */
    targetCustomerId: uuid('target_customer_id').references(() => customers.id),
    status: matchRequestStatus('status').notNull().default('open'),
    opponentId: uuid('opponent_id').references(() => customers.id),
    matchId: uuid('match_id').references(() => matches.id),
    acceptedAt: ts('accepted_at'),
    expiresAt: ts('expires_at').notNull(),
    createdBy: uuid('created_by').references(() => staff.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('match_requests_status_idx').on(t.status, t.createdAt)],
);

// ───────────────────────── Mobile money confirmation (no gateway) ─────────────────────────

export const momoRequestStatus = pgEnum('momo_request_status', ['pending', 'confirmed', 'rejected', 'expired']);

/**
 * A customer says "I'm sending you MoMo": we give them a short reference code; the payment is confirmed
 * by an SMS from the venue's MoMo phone (relay) or by staff, then the wallet is credited.
 */
export const momoRequests = pgTable(
  'momo_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: serial('number').notNull().unique(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    amount: money('amount').notNull(),
    network: text('network').notNull(),
    /** Short code the customer types as the MoMo "reference", e.g. 482193 (older ones: KD4821). */
    code: text('code').notNull().unique(),
    /** Transaction ID the customer typed after paying. */
    txnId: text('txn_id'),
    payerPhone: text('payer_phone'),
    status: momoRequestStatus('status').notNull().default('pending'),
    /** sms (relay matched it automatically) | staff */
    confirmedVia: text('confirmed_via'),
    confirmedBy: uuid('confirmed_by').references(() => staff.id),
    smsId: uuid('sms_id'),
    paymentId: uuid('payment_id').references(() => payments.id),
    note: text('note'),
    expiresAt: ts('expires_at').notNull(),
    confirmedAt: ts('confirmed_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('momo_requests_status_idx').on(t.status, t.createdAt)],
);

/** Incoming "payment received" SMS forwarded by the venue's MoMo phone. */
export const momoSms = pgTable(
  'momo_sms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sender: text('sender').notNull(),
    body: text('body').notNull(),
    amount: money('amount'),
    txnId: text('txn_id'),
    reference: text('reference'),
    payerName: text('payer_name'),
    payerPhone: text('payer_phone'),
    /** unmatched | matched | ignored */
    status: text('status').notNull().default('unmatched'),
    requestId: uuid('request_id'),
    device: text('device'),
    receivedAt: ts('received_at').notNull().defaultNow(),
  },
  (t) => [index('momo_sms_txn_idx').on(t.txnId), index('momo_sms_received_idx').on(t.receivedAt)],
);

// ───────────────────────── News & announcements (customer portal) ─────────────────────────

export const posts = pgTable(
  'posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** news | event | promo | tournament | announcement */
    kind: text('kind').notNull().default('news'),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    /** JPEG/PNG/WebP data URL (resized in the browser before upload). */
    image: text('image'),
    linkUrl: text('link_url'),
    linkLabel: text('link_label'),
    /** For events and promos. */
    eventAt: ts('event_at'),
    pinned: boolean('pinned').notNull().default(false),
    published: boolean('published').notNull().default(true),
    publishAt: ts('publish_at'),
    expiresAt: ts('expires_at'),
    tournamentId: uuid('tournament_id'),
    createdBy: uuid('created_by').references(() => staff.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('posts_created_idx').on(t.createdAt)],
);

// ───────────────────────── Customer chat ─────────────────────────

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Increasing number: clients ask for "messages after N". */
    number: serial('number').notNull().unique(),
    /** "lobby" (everyone) or "dm:<customerId>:<customerId>" (ids sorted). */
    room: text('room').notNull(),
    /** Null when staff wrote it. */
    customerId: uuid('customer_id').references(() => customers.id),
    staffId: uuid('staff_id').references(() => staff.id),
    body: text('body').notNull(),
    deleted: boolean('deleted').notNull().default(false),
    reported: boolean('reported').notNull().default(false),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('chat_room_idx').on(t.room, t.number)],
);

// ───────────────────────── Rewards: follow us for a bonus, bonus codes ─────────────────────────

export const rewardOffers = pgTable('reward_offers', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** follow = follow/subscribe to a page; code = a bonus code customers type in. */
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  /** follow: youtube | tiktok | instagram | facebook | x | snapchat | whatsapp | website */
  platform: text('platform'),
  url: text('url'),
  /** code: stored upper-case. */
  code: text('code'),
  /** Wallet credit given (minor units). */
  bonusAmount: money('bonus_amount').notNull().default(0),
  /** Optional promo code revealed after the reward is given. */
  promoCode: text('promo_code'),
  /** follow: staff check the claim before the bonus is paid. */
  needsApproval: boolean('needs_approval').notNull().default(true),
  /** Null = unlimited. */
  maxClaims: integer('max_claims'),
  claimsCount: integer('claims_count').notNull().default(0),
  validTo: ts('valid_to'),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const rewardClaims = pgTable(
  'reward_claims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    offerId: uuid('offer_id')
      .notNull()
      .references(() => rewardOffers.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    /** pending | approved | rejected */
    status: text('status').notNull().default('pending'),
    /** The customer's name on that platform, so staff can check. */
    handle: text('handle'),
    amount: money('amount').notNull().default(0),
    decidedBy: uuid('decided_by').references(() => staff.id),
    decidedAt: ts('decided_at'),
    note: text('note'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('reward_claims_once_idx').on(t.offerId, t.customerId), index('reward_claims_status_idx').on(t.status, t.createdAt)],
);

/** Thank-you / receipt SMS to customers, sent by the venue's MoMo phone (ZENAA MoMo app). */
export const smsOutbox = pgTable(
  'sms_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    phone: text('phone').notNull(),
    body: text('body').notNull(),
    /** momo | topup | game | test */
    kind: text('kind').notNull(),
    /** queued | sending | sent | failed | expired */
    status: text('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    device: text('device'),
    error: text('error'),
    createdAt: ts('created_at').notNull().defaultNow(),
    claimedAt: ts('claimed_at'),
    sentAt: ts('sent_at'),
  },
  (t) => [index('sms_outbox_status_idx').on(t.status, t.createdAt)],
);

// ───────────────────────── Social (graphics and posts for the venue's social pages) ─────────────────────────

export const socialPosts = pgTable(
  'social_posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** idea (made from news, waiting) | draft | posted | dismissed */
    status: text('status').notNull().default('draft'),
    /** news | custom */
    source: text('source').notNull().default('custom'),
    /** news | breaking | quote | versus | leaderboard | promo | winner */
    template: text('template').notNull().default('news'),
    /** Text and pictures for the template (headline, subtitle, tag, image URL, …). */
    fields: jsonb('fields').$type<Record<string, unknown>>().notNull().default({}),
    caption: text('caption').notNull().default(''),
    /** News story this idea came from (one idea per story). */
    newsUrl: text('news_url'),
    /** Where it was posted: [{ platform, ok, url?, error?, at }] */
    results: jsonb('results').$type<{ platform: string; ok: boolean; url?: string | null; error?: string; at: string }[]>().notNull().default([]),
    createdBy: uuid('created_by').references(() => staff.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    postedAt: ts('posted_at'),
  },
  (t) => [index('social_posts_status_idx').on(t.status, t.createdAt), uniqueIndex('social_posts_news_url_idx').on(t.newsUrl)],
);

/** Finished graphics/videos that were posted (Instagram fetches them by URL; kept 30 days). */
export const socialMedia = pgTable(
  'social_media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id').references(() => socialPosts.id, { onDelete: 'cascade' }),
    mime: text('mime').notNull(),
    /** base64 */
    data: text('data').notNull(),
    /** Random key needed in the public URL. */
    key: text('key').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('social_media_created_idx').on(t.createdAt)],
);

/** Every change to a customer's saved playing time (bought, saved at end, used at start, corrections). */
export const customerTimeLog = pgTable(
  'customer_time_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    /** bought | saved | used | adjust */
    kind: text('kind').notNull(),
    seconds: integer('seconds').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    sessionId: uuid('session_id').references(() => sessions.id),
    planName: text('plan_name'),
    amount: money('amount'),
    note: text('note'),
    staffId: uuid('staff_id').references(() => staff.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('customer_time_log_customer_idx').on(t.customerId, t.createdAt)],
);
