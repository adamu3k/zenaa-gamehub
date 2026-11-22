import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { useApp } from './lib/app-context';
import { AuditPage } from './pages/Audit';
import { RemoteViewPage } from './pages/RemoteView';
import { BookingsPage } from './pages/Bookings';
import { PortalApp } from './portal/PortalApp';
import { CustomersPage } from './pages/Customers';
import { DashboardPage } from './pages/Dashboard';
import { LoginPage } from './pages/Login';
import { PaymentsPage } from './pages/Payments';
import { PricingPage } from './pages/Pricing';
import { PromotionsPage } from './pages/Promotions';
import { ReceiptPage } from './pages/Receipt';
import { ShiftsPage } from './pages/Shifts';
import { SessionsPage } from './pages/Sessions';
import { SettingsPage } from './pages/Settings';
import { StaffPage } from './pages/Staff';
import { StationsPage } from './pages/Stations';
import { FindMatchPage } from './pages/FindMatch';
import { HelpPage } from './pages/Help';
import { IntegrationsPage } from './pages/Integrations';
import { LeaderboardPage } from './pages/Leaderboard';
import { TournamentDetailPage, TournamentsPage } from './pages/Tournaments';
import { TvBoard } from './portal/TvBoard';
import { FinancePage } from './pages/Finance';
import { MomoPage } from './pages/Momo';
import { ChatPage } from './pages/Chat';
import { RewardsPage } from './pages/Rewards';
import { NewsPage } from './pages/News';
import { SystemPage } from './pages/System';
import { SocialPage } from './pages/Social';

export function App() {
  const { me, loading } = useApp();
  const loc = useLocation();
  // The customer portal has its own sign-in and never needs a staff account.
  if (loc.pathname === '/portal' || loc.pathname.startsWith('/portal/')) return <PortalApp />;
  // Venue TV: public leaderboard + live tournament, no sign-in.
  if (loc.pathname === '/board') return <TvBoard />;
  if (loading) return <div className="login-wrap muted">Loading…</div>;
  if (!me) return <LoginPage />;
  return (
    <Routes>
      <Route path="receipt/:type/:id" element={<ReceiptPage />} />
      <Route path="remote/:id" element={<RemoteViewPage />} />
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
