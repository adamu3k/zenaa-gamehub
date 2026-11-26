import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { useApp } from './lib/app-context';
import { page, PageFrame, PageLoading } from './lib/lazy';
import { isStandalone } from './lib/pwa';

const AuditPage = page(() => import('./pages/Audit'), 'AuditPage');
const RemoteViewPage = page(() => import('./pages/RemoteView'), 'RemoteViewPage');
const BookingsPage = page(() => import('./pages/Bookings'), 'BookingsPage');
const PortalApp = page(() => import('./portal/PortalApp'), 'PortalApp');
const CustomersPage = page(() => import('./pages/Customers'), 'CustomersPage');
const DashboardPage = page(() => import('./pages/Dashboard'), 'DashboardPage');
const LoginPage = page(() => import('./pages/Login'), 'LoginPage');
const LandingPage = page(() => import('./pages/Landing'), 'LandingPage');
const PaymentsPage = page(() => import('./pages/Payments'), 'PaymentsPage');
const PricingPage = page(() => import('./pages/Pricing'), 'PricingPage');
const PromotionsPage = page(() => import('./pages/Promotions'), 'PromotionsPage');
const ReceiptPage = page(() => import('./pages/Receipt'), 'ReceiptPage');
const ShiftsPage = page(() => import('./pages/Shifts'), 'ShiftsPage');
const SessionsPage = page(() => import('./pages/Sessions'), 'SessionsPage');
const SettingsPage = page(() => import('./pages/Settings'), 'SettingsPage');
const StaffPage = page(() => import('./pages/Staff'), 'StaffPage');
const StationsPage = page(() => import('./pages/Stations'), 'StationsPage');
const FindMatchPage = page(() => import('./pages/FindMatch'), 'FindMatchPage');
const HelpPage = page(() => import('./pages/Help'), 'HelpPage');
const IntegrationsPage = page(() => import('./pages/Integrations'), 'IntegrationsPage');
const LeaderboardPage = page(() => import('./pages/Leaderboard'), 'LeaderboardPage');
const TournamentDetailPage = page(() => import('./pages/Tournaments'), 'TournamentDetailPage');
const TournamentsPage = page(() => import('./pages/Tournaments'), 'TournamentsPage');
const TvBoard = page(() => import('./portal/TvBoard'), 'TvBoard');
const FinancePage = page(() => import('./pages/Finance'), 'FinancePage');
const MomoPage = page(() => import('./pages/Momo'), 'MomoPage');
const ChatPage = page(() => import('./pages/Chat'), 'ChatPage');
const RewardsPage = page(() => import('./pages/Rewards'), 'RewardsPage');
const NewsPage = page(() => import('./pages/News'), 'NewsPage');
const SystemPage = page(() => import('./pages/System'), 'SystemPage');
const SocialPage = page(() => import('./pages/Social'), 'SocialPage');

/** After the first screen is up, quietly download the main staff pages so opening them is instant. */
let warmed = false;
function warmUp() {
  if (warmed) return;
  warmed = true;
  const pages: (() => Promise<unknown>)[] = [
    () => import('./pages/Stations'),
    () => import('./pages/Chat'),
    () => import('./pages/Customers'),
    () => import('./pages/Sessions'),
    () => import('./pages/Dashboard'),
  ];
  const go = async () => {
    for (const f of pages) {
      await f().catch(() => undefined);
      await new Promise((r) => setTimeout(r, 150));
    }
  };
  const idle = (window as any).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 1500));
  idle(go);
}

/** Devices where staff have signed in keep opening on the staff sign-in at "/", not the public home page. */
const STAFF_DEVICE = 'zenaa.staffDevice';
function isStaffDevice() {
  try {
    return localStorage.getItem(STAFF_DEVICE) === '1';
  } catch {
    return false;
  }
}
function markStaffDevice() {
  try {
    localStorage.setItem(STAFF_DEVICE, '1');
  } catch {
    /* storage unavailable */
  }
}

export function App() {
  const { me, loading } = useApp();
  const loc = useLocation();
  // The customer portal has its own sign-in and never needs a staff account.
  if (loc.pathname === '/portal' || loc.pathname.startsWith('/portal/'))
    return (
      <PageFrame>
        <PortalApp />
      </PageFrame>
    );
  // Public home page: /home always; / for visitors who aren't signed in as staff (not inside the installed staff app).
  if (loc.pathname === '/home' || (loc.pathname === '/' && !me && !loading && !isStandalone() && !isStaffDevice()))
    return (
      <PageFrame>
        <LandingPage />
      </PageFrame>
    );
  // Venue TV: public leaderboard + live tournament, no sign-in.
  if (loc.pathname === '/board')
    return (
      <PageFrame>
        <TvBoard />
      </PageFrame>
    );
  if (loading)
    return (
      <div className="login-wrap">
        <PageLoading />
      </div>
    );
  if (me) {
    warmUp();
    markStaffDevice();
  }
  if (!me)
    return (
      <PageFrame>
        <LoginPage />
      </PageFrame>
    );
  return (
    <Routes>
      <Route
        path="receipt/:type/:id"
        element={
          <PageFrame>
            <ReceiptPage />
          </PageFrame>
        }
      />
      <Route
        path="remote/:id"
        element={
          <PageFrame>
            <RemoteViewPage />
          </PageFrame>
        }
      />
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="stations" element={<StationsPage />} />
        <Route path="bookings" element={<BookingsPage />} />
        <Route path="sessions" element={<SessionsPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="shifts" element={<ShiftsPage />} />
        <Route path="payments" element={<PaymentsPage />} />
        <Route path="pricing" element={<PricingPage />} />
        <Route path="promotions" element={<PromotionsPage />} />
        <Route path="staff" element={<StaffPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="leaderboard" element={<LeaderboardPage />} />
        <Route path="tournaments" element={<TournamentsPage />} />
        <Route path="tournaments/:id" element={<TournamentDetailPage />} />
        <Route path="find-match" element={<FindMatchPage />} />
        <Route path="integrations" element={<IntegrationsPage />} />
        <Route path="help" element={<HelpPage />} />
        <Route path="finance" element={<FinancePage />} />
        <Route path="momo" element={<MomoPage />} />
        <Route path="news" element={<NewsPage />} />
        <Route path="chat" element={<ChatPage />} />
        <Route path="rewards" element={<RewardsPage />} />
        <Route path="system" element={<SystemPage />} />
        <Route path="social" element={<SocialPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
