import { Suspense, lazy, Component, ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AdminRoute } from "./components/AdminRoute";
import { PageLoadingFallback } from "./components/PageLoadingFallback";
import { InstallPrompt } from "./components/InstallPrompt";

// Lazy load pages for better performance and code splitting
// User-facing pages
const Home = lazy(() => import("./pages/Home"));
const SearchResults = lazy(() => import("./pages/SearchResults"));
const BookingPage = lazy(() => import("./pages/BookingPage"));
const MyBookings = lazy(() => import("./pages/MyBookings"));
const CheckIn = lazy(() => import("./pages/CheckIn"));
const Profile = lazy(() => import("./pages/Profile"));
const LoyaltyDashboard = lazy(() => import("./pages/LoyaltyDashboard"));
const FavoritesPage = lazy(() => import("./pages/FavoritesPage"));

// Admin pages
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const AnalyticsDashboard = lazy(() => import("./pages/AnalyticsDashboard"));
const RefundsDashboard = lazy(() => import("./pages/admin/RefundsDashboard"));
const ReportsDashboard = lazy(() => import("./pages/admin/ReportsDashboard"));

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
              Failed to load this page
            </h2>
            <p className="text-muted-foreground mb-6">
              There was an error loading the requested page. This might be due
              to a network issue or the page might not exist.
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Try Again
              </button>
              <button
                onClick={() => (window.location.href = "/")}
                className="px-4 py-2 rounded-lg border border-border hover:bg-accent transition-colors"
              >
                Go Home
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
        <TooltipProvider>
          <Toaster />
          <Router />
          <InstallPrompt />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
