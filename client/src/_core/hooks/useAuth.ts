import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { trpc } from "@/lib/trpc";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo } from "react";
import { currentReturnTo } from "@/lib/auth-navigation";
import {
  isAuthenticationPath,
  loginPath,
  safeReturnTo,
} from "@shared/return-to";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath } = options ?? {};
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Use logoutCookie for cookie-based web clients
  const logoutMutation = trpc.auth.logoutCookie.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
    },
  });

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch (error: unknown) {
      if (
        error instanceof TRPCClientError &&
        error.data?.code === "UNAUTHORIZED"
      ) {
        return;
      }
      throw error;
    } finally {
      await queryClient.cancelQueries();
      // Preserve the observed identity query so every mounted useAuth receives
      // the null update. Clearing it first leaves observers on the old user.
      const identityQuery = queryClient.getQueryCache().find({
        queryKey: getQueryKey(trpc.auth.me, undefined, "query"),
        exact: true,
      });
      queryClient.removeQueries({
        predicate: query => query !== identityQuery,
      });
      queryClient.getMutationCache().clear();
      localStorage.removeItem("manus-runtime-user-info");
      navigator.serviceWorker?.controller?.postMessage({
        type: "CLEAR_PRIVATE_DATA",
      });
      utils.auth.me.setData(undefined, null);
    }
  }, [logoutMutation, utils, queryClient]);

  const state = useMemo(() => {
    return {
      user: meQuery.data ?? null,
      loading: meQuery.isLoading || logoutMutation.isPending,
      error: meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(meQuery.data),
    };
  }, [
    meQuery.data,
    meQuery.error,
    meQuery.isLoading,
    logoutMutation.error,
    logoutMutation.isPending,
  ]);

  // Move localStorage side effect to useEffect
  useEffect(() => {
    localStorage.setItem(
      "manus-runtime-user-info",
      JSON.stringify(meQuery.data)
    );
  }, [meQuery.data]);

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (meQuery.isLoading || logoutMutation.isPending) return;
    if (state.user) return;
    if (typeof window === "undefined") return;
    if (isAuthenticationPath(window.location.pathname)) return;
    const target =
      !redirectPath || redirectPath === "/login"
        ? loginPath(currentReturnTo())
        : safeReturnTo(redirectPath);
    if (currentReturnTo() === target) return;
    window.location.assign(target);
  }, [
    redirectOnUnauthenticated,
    redirectPath,
    logoutMutation.isPending,
    meQuery.isLoading,
    state.user,
  ]);

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    logout,
  };
}
