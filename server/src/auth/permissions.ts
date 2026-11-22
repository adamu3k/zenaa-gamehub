import type { PermissionOverrides } from '../db/schema.js';

export const PERMISSIONS = {
  'stations.view': 'View stations and live sessions',
  'stations.manage': 'Add, edit and archive stations and categories',
  'stations.power': 'Switch station power (smart plugs) on and off by hand',
  'stations.bypass': 'Turn a station on with no charge (staff unlock) and unlock station screens with a PIN',
  'stations.remote': 'See and control station screens remotely (VNC)',
  'sessions.operate': 'Start, pause, resume, extend and end sessions',
  'sessions.calculator': 'Use the amount → time calculator (how long a customer can play for an amount)',
  'pricing.manage': 'Manage pricing plans and membership tiers',
  'customers.view': 'View customers',
  'customers.manage': 'Register and edit customers, suspend accounts, issue portal activation codes',
  'customers.time': "Sell time onto customers' accounts and correct their saved time",
  'bookings.manage': 'Create, confirm, cancel and check in bookings',
  'competitions.manage': 'Record match results, run tournaments and pair players in Find match',
  'wallet.deposit': 'Top up customer wallets',
  'wallet.withdraw': 'Withdraw from customer wallets',
  'wallet.adjust': 'Make manual wallet adjustments',
  'momo.confirm': "Confirm customers' mobile money payments (MoMo inbox)",
  'payments.refund': 'Refund and void payments',
  'payments.discount': 'Give manual discounts at checkout',
  'payments.tab': 'Let customers pay later (tabs) and set credit limits',
  'shifts.manage': "View and close other staff members' shifts; record cash in/out",
  'reports.view': 'View dashboard revenue and reports',
  'finance.view': 'View the Finance page: takings, expenses, cash and MoMo reconciliation, exports',
  'content.manage': 'Post news, events and promotions on the customer portal',
  'social.manage': 'Social page: make graphics, connect social accounts and post to them',
  'chat.moderate': 'Read the customer chat, post as the venue, delete messages and mute players',
  'rewards.manage': 'Set follow-us bonuses and bonus codes, and approve reward claims',
  'audit.view': 'View the audit trail',
  'staff.manage': 'Manage staff accounts and permissions',
  'settings.manage': 'Change system settings',
  'system.backup': 'Download and restore backups, set automatic backups',
  'system.update': 'Check for and install updates',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const ROLE_DEFAULTS: Record<'admin' | 'manager' | 'cashier', Permission[]> = {
  admin: ALL_PERMISSIONS,
  manager: ALL_PERMISSIONS.filter((p) => !['staff.manage', 'settings.manage', 'system.backup', 'system.update', 'sessions.calculator', 'social.manage'].includes(p)),
  cashier: ['stations.view', 'sessions.operate', 'customers.view', 'customers.manage', 'wallet.deposit', 'bookings.manage', 'competitions.manage', 'momo.confirm', 'chat.moderate'],
};

/**
 * Permissions of a staff member: their built-in role's defaults (or their custom user type's set),
 * plus per-person grants, minus per-person revokes.
 */
export function effectivePermissions(
  role: keyof typeof ROLE_DEFAULTS,
  overrides?: PermissionOverrides | null,
  customRolePermissions?: readonly string[] | null,
): Permission[] {
  const base = customRolePermissions ? (customRolePermissions.filter((p) => p in PERMISSIONS) as Permission[]) : ROLE_DEFAULTS[role];
  const set = new Set<Permission>(base);
  for (const p of overrides?.grant ?? []) if (p in PERMISSIONS) set.add(p as Permission);
  // Admins can never lose staff.manage — prevents locking everyone out.
  for (const p of overrides?.revoke ?? []) if (!(role === 'admin' && p === 'staff.manage')) set.delete(p as Permission);
  return ALL_PERMISSIONS.filter((p) => set.has(p));
}
