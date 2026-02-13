import { useAuth } from "@/_core/hooks/useAuth";
import { Redirect } from "wouter";
import { Loader2 } from "lucide-react";

interface AdminRouteProps {
  children: React.ReactNode;
}

/**
 * Admin Route Guard
 * Protects routes that should only be accessible by admin users
 * Redirects non-admin users to home page
 */
export function AdminRoute({ children }: AdminRouteProps) {
  const { user, loading, isAuthenticated } = useAuth();

  // Show loading state while checking authentication
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Redirect to home if not authenticated
  if (!isAuthenticated || !user) {
    return <Redirect to="/" />;
  }

  // Redirect to home if not admin
  if (user.role !== "admin") {
    return <Redirect to="/" />;
  }

  // Render children if user is admin
  return <>{children}</>;
}
