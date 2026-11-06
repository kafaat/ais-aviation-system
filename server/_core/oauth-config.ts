import type { CookieOptions } from "express";
import { ENV } from "./env";

export function getOAuthConfiguration() {
  if (!ENV.oAuthPortalUrl || !ENV.oAuthRedirectUri) {
    throw new Error("OAuth requires OAUTH_PORTAL_URL and OAUTH_REDIRECT_URI");
  }
  const callback = new URL(ENV.oAuthRedirectUri);
  const portal = new URL(ENV.oAuthPortalUrl);
  for (const url of [callback, portal]) {
    if (
      !["http:", "https:"].includes(url.protocol) ||
      (ENV.isProduction && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error("Invalid OAuth URL configuration");
    }
  }
  if (callback.pathname !== "/api/oauth/callback") {
    throw new Error("OAUTH_REDIRECT_URI must use /api/oauth/callback");
  }

  const secure = callback.protocol === "https:";
  return {
    redirectUri: callback.toString(),
    portalLoginUrl: `${portal.toString().replace(/\/+$/, "")}/app-auth`,
    // The __Host prefix prevents sibling domains from injecting the binding
    // cookie. Plain HTTP is supported only outside production for local use.
    nonceCookieName: secure ? "__Host-ais_oauth_nonce" : "ais_oauth_nonce",
    nonceCookieOptions: {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
    } satisfies CookieOptions,
  };
}
