import { useAuth } from "@/_core/hooks/useAuth";
import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Redirect, useLocation } from "wouter";
import { loginPath } from "@shared/return-to";
import { useRawSearch } from "@/lib/useRawSearch";

interface ProtectedRouteProps {
  children: ReactNode;
}

/**
 * Route guard for account-scoped pages.
 *
 * Authorization for domain-specific resources remains server-side; this guard
 * only prevents unauthenticated users from rendering account UI before the API
 * can enforce its resource/tenant policies.
 */
export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading, isAuthenticated } = useAuth();
  const [pathname] = useLocation();
  const search = useRawSearch();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return (
      <Redirect to={loginPath(`${pathname}${search ? `?${search}` : ""}`)} />
    );
  }

  return <>{children}</>;
}
