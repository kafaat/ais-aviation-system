import { useAuth } from "@/_core/hooks/useAuth";
import { Redirect, useLocation } from "wouter";
import { loginPath } from "@shared/return-to";
import { useRawSearch } from "@/lib/useRawSearch";
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
  const [pathname] = useLocation();
  const search = useRawSearch();

  // Show loading state while checking authentication
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated || !user) {
    return (
      <Redirect to={loginPath(`${pathname}${search ? `?${search}` : ""}`)} />
    );
  }

  // Redirect to home if not admin or super_admin
  if (user.role !== "admin" && user.role !== "super_admin") {
    return <Redirect to="/" />;
  }

  // Render children if user is admin or super_admin
  return <>{children}</>;
}
