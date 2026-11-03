import { TRPCClientError } from "@trpc/client";
import { UNAUTHED_ERR_MSG } from "@shared/const";
import { isAuthenticationPath, loginPath } from "@shared/return-to";

export function currentReturnTo(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function redirectToLoginIfUnauthorized(error: unknown): void {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;
  if (error.data?.code !== "UNAUTHORIZED" && error.message !== UNAUTHED_ERR_MSG)
    return;
  if (isAuthenticationPath(window.location.pathname)) return;
  window.location.assign(loginPath(currentReturnTo()));
}
