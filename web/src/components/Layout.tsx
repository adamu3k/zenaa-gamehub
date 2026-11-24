import { BadgePercent, CalendarDays, CircleHelp, DatabaseBackup, ExternalLink, Gamepad2, Gift, KeyRound, Landmark, LayoutDashboard, ListChecks, LogOut, Medal, Megaphone, Menu, MessagesSquare, Plug, Receipt, Settings2, ShieldCheck, Smartphone, Swords, Tags, Trophy, UserCog, Users, Wallet, Zap, Share2 } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { get } from '../lib/api';
import { MyPinModal, PinPromptHost } from './pin';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { PageFrame } from '../lib/lazy';
import { useApp } from '../lib/app-context';
import { ThemeToggle } from '../lib/theme';
import { AnnouncerToggle } from '../lib/announcer';
import { useCurrentShift } from '../pages/Shifts';
import { setupPwa } from '../lib/pwa';

/** Top-bar reminder of the signed-in person's cash-drawer shift. */
function ShiftChip() {
  const { money } = useApp();
  const q = useCurrentShift();
  if (q.isLoading) return null;
  return (
    <Link to="/shifts" className={`badge ${q.data ? 'badge-success' : 'badge-warning'}`} style={{ textDecoration: 'none' }} title="Shift & cash drawer">
      {q.data ? `Shift open · drawer ${money(q.data.expectedCash)}` : 'No shift open'}
    </Link>
  );
}

export function Layout() {
  const { me, logout, can, connected, settings } = useApp();
  const [open, setOpen] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const loc = useLocation();
  const momoQ = useQuery({
    queryKey: ['momo', 'pending-count'],
    queryFn: () => get<any[]>('/api/momo/requests?status=pending&limit=50'),
    enabled: can('momo.confirm'),
    refetchInterval: 60_000,
  });
  const momoPending = momoQ.data?.length ?? 0;
  const rewardsQ = useQuery({ queryKey: ['rewards', 'list'], queryFn: () => get<any>('/api/rewards'), enabled: can('rewards.manage'), refetchInterval: 60_000 });
  const rewardsPending = rewardsQ.data?.pending ?? 0;
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => setupPwa('staff'), []);

  const nav = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, show: true },
    { to: '/stations', label: 'Stations', icon: Gamepad2, show: can('stations.view') },
    { to: '/bookings', label: 'Bookings', icon: CalendarDays, show: can('stations.view') },
    { to: '/sessions', label: 'Session history', icon: ListChecks, show: can('stations.view') },
    { to: '/customers', label: 'Customers', icon: Users, show: can('customers.view') },
    { to: '/leaderboard', label: 'Leaderboard', icon: Medal, show: true, group: 'Competitions' },
    { to: '/tournaments', label: 'Tournaments', icon: Trophy, show: true },
    { to: '/find-match', label: 'Find match', icon: Swords, show: true },
    { to: '/shifts', label: 'Shift & cash drawer', icon: Landmark, show: true, group: 'Money' },
    { to: '/momo', label: momoPending ? `MoMo inbox (${momoPending})` : 'MoMo inbox', icon: Smartphone, show: can('momo.confirm') },
    { to: '/finance', label: 'Finance', icon: Wallet, show: can('finance.view') },
    { to: '/payments', label: 'Payments & tabs', icon: Receipt, show: can('reports.view') || can('customers.view') },
    { to: '/pricing', label: 'Pricing & tiers', icon: Tags, show: can('pricing.manage') || can('stations.manage') },
    { to: '/promotions', label: 'Promotions', icon: BadgePercent, show: can('pricing.manage') },
    { to: '/social', label: 'Social', icon: Share2, show: can('social.manage'), group: 'Customers' },
    { to: '/news', label: 'News & posters', icon: Megaphone, show: can('content.manage') },
    { to: '/chat', label: 'Chat', icon: MessagesSquare, show: can('chat.moderate') },
    { to: '/rewards', label: rewardsPending ? `Rewards (${rewardsPending})` : 'Rewards', icon: Gift, show: can('rewards.manage') },
    { to: '/staff', label: 'Users & roles', icon: UserCog, show: can('staff.manage'), group: 'Admin' },
    { to: '/audit', label: 'Audit trail', icon: ShieldCheck, show: can('audit.view') },
    { to: '/integrations', label: 'Integrations', icon: Plug, show: can('stations.manage') || can('settings.manage'), group: 'System' },
    { to: '/settings', label: 'Settings', icon: Settings2, show: can('settings.manage') },
    { to: '/system', label: 'Backup & updates', icon: DatabaseBackup, show: can('system.backup') || can('system.update') },
    { to: '/help', label: 'Help & guides', icon: CircleHelp, show: true },
  ];

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">
            <Zap size={18} />
          </div>
          <div>
            ZENAA GAMEHUB
            <small>{settings.centerName}</small>
          </div>
        </div>
        {nav
          .filter((n) => n.show)
          .map((n) => (
            <div key={n.to} style={{ display: 'contents' }}>
              {'group' in n && n.group && <div className="nav-group">{n.group}</div>}
              <NavLink to={n.to} end={n.to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <n.icon size={18} />
                {n.label}
              </NavLink>
            </div>
          ))}
        <div className="sidebar-foot">
          <div className="user-chip">
            <div className="avatar">{me?.fullName.slice(0, 2).toUpperCase()}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{me?.fullName}</div>
              <div className="dim" style={{ fontSize: 12 }}>{me?.roleName ?? me?.role}</div>
            </div>
          </div>
          <button className="nav-link" style={{ border: 0, background: 'none', cursor: 'pointer' }} onClick={() => setPinOpen(true)}>
            <KeyRound size={18} /> {me?.hasPin ? 'My PIN' : 'Set my PIN'}
            {!me?.hasPin && <span className="badge badge-warning">new</span>}
          </button>
          <a className="nav-link" href="/portal" target="_blank" rel="noreferrer">
            <ExternalLink size={18} /> Customer portal
          </a>
          <button className="nav-link" style={{ border: 0, background: 'none', cursor: 'pointer' }} onClick={logout}>
            <LogOut size={18} /> Sign out
          </button>
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <button className="btn btn-ghost btn-icon mobile-toggle" onClick={() => setOpen((o) => !o)} aria-label="Menu">
            <Menu size={20} />
          </button>
          <div className="spacer" />
          <AnnouncerToggle />
          <ThemeToggle />
          <ShiftChip />
          <span className="muted" style={{ fontSize: 13 }}>
            <span className="conn-dot" style={{ background: connected ? 'var(--success)' : 'var(--danger)' }} />
            {connected ? 'Live' : 'Reconnecting…'}
          </span>
        </div>
        <div className="content">
          <PageFrame resetKey={loc.pathname}>
            <Outlet />
          </PageFrame>
        </div>
        <PinPromptHost />
        {pinOpen && <MyPinModal onClose={() => setPinOpen(false)} />}
      </div>
    </div>
  );
}
