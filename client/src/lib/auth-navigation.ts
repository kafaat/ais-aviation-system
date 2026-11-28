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

export const BROWSER_IDENTITY_KEY = "manus-runtime-user-info";

function storedPrincipal(value: string | null): string | null {
  if (!value) return null;
  try {
    const user = JSON.parse(value);
    return user?.id == null
      ? null
      : JSON.stringify([user.id, user.tenantId ?? null, user.role]);
  } catch {
    // Older clients may have written "undefined" while loading.
    return null;
  }
}

/** A second tab shares our cookie, but owns a separate React tree and private cache. */
export function watchSessionChanges(root: HTMLElement) {
  function reload() {
    root.hidden = true;
    window.location.reload();
  }
  window.addEventListener("storage", event => {
    if (
      event.key === BROWSER_IDENTITY_KEY &&
      storedPrincipal(event.oldValue) !== storedPrincipal(event.newValue)
    )
      reload();
  });
  window.addEventListener("pageshow", event => {
    // A frozen document can miss storage events while another account signs in.
    if (event.persisted) reload();
  });
}
