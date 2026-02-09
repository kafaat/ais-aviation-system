import { Suspense, lazy, Component, ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { FlightCompareProvider } from "./contexts/FlightCompareContext";
import { AccessibilityProvider } from "./contexts/AccessibilityContext";
import { AdminRoute } from "./components/AdminRoute";
import { PageLoadingFallback } from "./components/PageLoadingFallback";
import { InstallPrompt } from "./components/InstallPrompt";
import { CookieConsent } from "./components/CookieConsent";
import { SkipNavigation } from "./components/SkipNavigation";
import i18next from "i18next";

// Lazy load pages for better performance and code splitting
// User-facing pages
const Home = lazy(() => import("./pages/Home"));
const Login = lazy(() => import("./pages/Login"));
const SearchResults = lazy(() => import("./pages/SearchResults"));
const BookingPage = lazy(() => import("./pages/BookingPage"));
const MyBookings = lazy(() => import("./pages/MyBookings"));
const CheckIn = lazy(() => import("./pages/CheckIn"));
const Profile = lazy(() => import("./pages/Profile"));
const LoyaltyDashboard = lazy(() => import("./pages/LoyaltyDashboard"));
const FavoritesPage = lazy(() => import("./pages/FavoritesPage"));
const PriceAlerts = lazy(() => import("./pages/PriceAlerts"));
const CompareFlights = lazy(() => import("./pages/CompareFlights"));
const SavedPassengers = lazy(() => import("./pages/SavedPassengers"));
const Notifications = lazy(() => import("./pages/Notifications"));
const MyWaitlist = lazy(() => import("./pages/MyWaitlist"));
const MultiCityResults = lazy(() => import("./pages/MultiCityResults"));
const LiveFlightTracking = lazy(() => import("./pages/LiveFlightTracking"));
const RebookPage = lazy(() => import("./pages/RebookPage"));
const PaymentHistory = lazy(() => import("./pages/PaymentHistory"));
const AiChat = lazy(() => import("./pages/AiChat"));

// Admin pages
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const AnalyticsDashboard = lazy(() => import("./pages/AnalyticsDashboard"));
const RefundsDashboard = lazy(() => import("./pages/admin/RefundsDashboard"));
const ReportsDashboard = lazy(() => import("./pages/admin/ReportsDashboard"));
const GroupBookingsManagement = lazy(
  () => import("./pages/admin/GroupBookingsManagement")
);
const VoucherManagement = lazy(() => import("./pages/admin/VoucherManagement"));
const GateManagement = lazy(() => import("./pages/admin/GateManagement"));
const DcsDashboard = lazy(() => import("./pages/admin/DcsDashboard"));
const DeletedBookings = lazy(() => import("./pages/admin/DeletedBookings"));

// Group booking pages
const GroupBookingRequest = lazy(() => import("./pages/GroupBookingRequest"));

// Split payment pages
const PayYourShare = lazy(() => import("./pages/PayYourShare"));

// Baggage pages
const BaggageStatus = lazy(() => import("./pages/BaggageStatus"));

// Admin additional pages
const BaggageManagement = lazy(() => import("./pages/admin/BaggageManagement"));
const CorporateManagement = lazy(
  () => import("./pages/admin/CorporateManagement")
);
const AIPricingDashboard = lazy(
  () => import("./pages/admin/AIPricingDashboard")
);
const TravelAgentManagement = lazy(
  () => import("./pages/admin/TravelAgentManagement")
);
const OverbookingManagement = lazy(
  () => import("./pages/admin/OverbookingManagement")
);

// Phase 4: Competitive gap closure admin pages
const BSPReporting = lazy(() => import("./pages/admin/BSPReporting"));
const CrewAssignment = lazy(() => import("./pages/admin/CrewAssignment"));
const DataWarehouse = lazy(() => import("./pages/admin/DataWarehouse"));
const IROPSCommandCenter = lazy(
  () => import("./pages/admin/IROPSCommandCenter")
);
const RevenueAccounting = lazy(() => import("./pages/admin/RevenueAccounting"));
const SLADashboard = lazy(() => import("./pages/admin/SLADashboard"));
const CompensationManagement = lazy(
  () => import("./pages/admin/CompensationManagement")
);
const WeightBalance = lazy(() => import("./pages/admin/WeightBalance"));
const DisasterRecovery = lazy(() => import("./pages/admin/DisasterRecovery"));
const LoadPlanning = lazy(() => import("./pages/admin/LoadPlanning"));

// Corporate pages
const CorporateDashboard = lazy(
  () => import("./pages/corporate/CorporateDashboard")
);
const CorporateBookings = lazy(
  () => import("./pages/corporate/CorporateBookings")
);

// Error/utility pages
const NotFound = lazy(() => import("./pages/NotFound"));

/**
 * Route-level Error Boundary
 * Handles errors specifically during route loading/rendering
 */
interface RouteErrorBoundaryProps {
  children: ReactNode;
}

interface RouteErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  constructor(props: RouteErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Route loading error:", error);
    console.error("Component stack:", errorInfo.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-indigo-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
          <div className="text-center p-8 max-w-md">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-destructive/10 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-destructive"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <h2 className="text-xl font-semibold mb-2">
              {i18next.t("errorBoundary.failedToLoad")}
            </h2>
            <p className="text-muted-foreground mb-6">
              {i18next.t("errorBoundary.errorMessage")}
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                {i18next.t("errorBoundary.tryAgain")}
              </button>
              <button
                onClick={() => (window.location.href = "/")}
                className="px-4 py-2 rounded-lg border border-border hover:bg-accent transition-colors"
              >
                {i18next.t("errorBoundary.goHome")}
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function Router() {
  return (
    <RouteErrorBoundary>
      <Suspense fallback={<PageLoadingFallback variant="default" />}>
        <Switch>
          {/* User-facing pages */}
          <Route path="/" component={Home} />
          <Route path="/login">
            <Suspense fallback={<PageLoadingFallback variant="default" />}>
              <Login />
            </Suspense>
          </Route>
          <Route path="/search">
            <Suspense fallback={<PageLoadingFallback variant="search" />}>
              <SearchResults />
            </Suspense>
          </Route>
          <Route path="/booking/:id">
            <Suspense fallback={<PageLoadingFallback variant="form" />}>
              <BookingPage />
            </Suspense>
          </Route>
          <Route path="/my-bookings">
            <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
              <MyBookings />
            </Suspense>
          </Route>
          <Route path="/check-in">
            <Suspense fallback={<PageLoadingFallback variant="form" />}>
              <CheckIn />
            </Suspense>
          </Route>
          <Route path="/profile">
            <Suspense fallback={<PageLoadingFallback variant="form" />}>
              <Profile />
            </Suspense>
          </Route>
          <Route path="/loyalty">
            <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
              <LoyaltyDashboard />
            </Suspense>
          </Route>
          <Route path="/favorites">
            <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
              <FavoritesPage />
            </Suspense>
          </Route>
          <Route path="/price-alerts">
            <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
              <PriceAlerts />
            </Suspense>
          </Route>
          <Route path="/compare">
            <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
              <CompareFlights />
            </Suspense>
          </Route>
          <Route path="/group-booking/:id">
            <Suspense fallback={<PageLoadingFallback variant="form" />}>
              <GroupBookingRequest />
            </Suspense>
          </Route>
          <Route path="/saved-passengers">
            <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
              <SavedPassengers />
            </Suspense>
          </Route>
          <Route path="/notifications">
            <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
              <Notifications />
            </Suspense>
          </Route>
          <Route path="/my-waitlist">
            <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
              <MyWaitlist />
            </Suspense>
          </Route>
          <Route path="/multi-city">
            <Suspense fallback={<PageLoadingFallback variant="search" />}>
              <MultiCityResults />
            </Suspense>
          </Route>
          <Route path="/track-flight">
            <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
              <LiveFlightTracking />
            </Suspense>
          </Route>
          <Route path="/rebook/:bookingId">
            <Suspense fallback={<PageLoadingFallback variant="form" />}>
              <RebookPage />
            </Suspense>
          </Route>
          <Route path="/payment-history">
            <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
              <PaymentHistory />
            </Suspense>
          </Route>

          <Route path="/ai-chat">
            <Suspense fallback={<PageLoadingFallback variant="default" />}>
              <AiChat />
            </Suspense>
          </Route>

          {/* Split payment pages (public - accessed via email link) */}
          <Route path="/pay/:token/:status?">
            <Suspense fallback={<PageLoadingFallback variant="form" />}>
              <PayYourShare />
            </Suspense>
          </Route>

          {/* Admin pages */}
          <Route path="/admin">
            <AdminRoute>
              <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
                <AdminDashboard />
              </Suspense>
            </AdminRoute>
          </Route>
          <Route path="/analytics">
            <AdminRoute>
              <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
                <AnalyticsDashboard />
              </Suspense>
            </AdminRoute>
          </Route>
          <Route path="/admin/refunds">
            <AdminRoute>
              <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
                <RefundsDashboard />
              </Suspense>
            </AdminRoute>
          </Route>
          <Route path="/admin/reports">
            <AdminRoute>
              <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
                <ReportsDashboard />
              </Suspense>
            </AdminRoute>
          </Route>
          <Route path="/admin/group-bookings">
            <AdminRoute>
              <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
                <GroupBookingsManagement />
              </Suspense>
            </AdminRoute>
          </Route>
          <Route path="/admin/vouchers">
            <AdminRoute>
              <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
                <VoucherManagement />
              </Suspense>
            </AdminRoute>
          </Route>
          <Route path="/admin/gates">
            <AdminRoute>
              <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
                <GateManagement />
              </Suspense>
            </AdminRoute>
          </Route>
          <Route path="/admin/dcs">
            <AdminRoute>
              <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
                <DcsDashboard />
              </Suspense>
            </AdminRoute>
          </Route>
          <Route path="/admin/deleted-bookings">
            <AdminRoute>
              <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
                <DeletedBookings />
              </Suspense>
            </AdminRoute>
          </Route>
          <Route path="/admin/baggage">
            <AdminRoute>
              <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
                <BaggageManagement />
              </Suspense>
            </AdminRoute>
          </Route>
          <Route path="/admin/corporate">
            <AdminRoute>
              <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
                <CorporateManagement />
              </Suspense>
            </AdminRoute>
          </Route>
          <Route path="/admin/ai-pricing">
            <AdminRoute>
              <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
                <AIPricingDashboard />
              </Suspense>
            </AdminRoute>
          </Route>
          <Route path="/admin/travel-agents">
            <AdminRoute>
              <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
                <TravelAgentManagement />
              </Suspense>
            </AdminRoute>
          </Route>
          <Route path="/admin/overbooking">
            <AdminRoute>
              <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
                <OverbookingManagement />
              </Suspense>
            </AdminRoute>
          </Route>

          {/* Phase 4: Competitive gap closure admin pages */}
          <Route path="/admin/bsp-reporting">
            <AdminRoute>
              <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
                <BSPReporting />
              </Suspense>
            </AdminRoute>
          </Route>
          <Route path="/admin/crew-assignment">
            <AdminRoute>
              <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
                <CrewAssignment />
              </Suspense>
            </AdminRoute>
          </Route>
          <Route path="/admin/data-warehouse">
            <AdminRoute>
              <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
                <DataWarehouse />
              </Suspense>
            </AdminRoute>
          </Route>
          <Route path="/admin/irops">
            <AdminRoute>
              <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
                <IROPSCommandCenter />
              </Suspense>
            </AdminRoute>
          </Route>
          <Route path="/admin/revenue-accounting">
            <AdminRoute>
              <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
                <RevenueAccounting />
              </Suspense>
            </AdminRoute>
          </Route>
          <Route path="/admin/sla">
            <AdminRoute>
              <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
                <SLADashboard />
              </Suspense>
            </AdminRoute>
          </Route>
          <Route path="/admin/compensation">
            <AdminRoute>
              <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
                <CompensationManagement />
              </Suspense>
            </AdminRoute>
          </Route>
          <Route path="/admin/weight-balance">
            <AdminRoute>
              <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
                <WeightBalance />
              </Suspense>
            </AdminRoute>
          </Route>
          <Route path="/admin/disaster-recovery">
            <AdminRoute>
              <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
                <DisasterRecovery />
              </Suspense>
            </AdminRoute>
          </Route>
          <Route path="/admin/load-planning">
            <AdminRoute>
              <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
                <LoadPlanning />
              </Suspense>
            </AdminRoute>
          </Route>

          {/* Baggage page */}
          <Route path="/baggage">
            <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
              <BaggageStatus />
            </Suspense>
          </Route>

          {/* Corporate pages */}
          <Route path="/corporate">
            <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
              <CorporateDashboard />
            </Suspense>
          </Route>
          <Route path="/corporate/bookings">
            <Suspense fallback={<PageLoadingFallback variant="dashboard" />}>
              <CorporateBookings />
            </Suspense>
          </Route>

          {/* Error/utility pages */}
          <Route path="/404" component={NotFound} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </RouteErrorBoundary>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable>
        <AccessibilityProvider>
          <FlightCompareProvider>
            <TooltipProvider>
              <Toaster />
              <SkipNavigation />
              <Router />
              <InstallPrompt />
              <CookieConsent />
            </TooltipProvider>
          </FlightCompareProvider>
        </AccessibilityProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
