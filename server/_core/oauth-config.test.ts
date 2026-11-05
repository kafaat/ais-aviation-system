import { beforeEach, describe, expect, it, vi } from "vitest";
import { getOAuthConfiguration } from "./oauth-config";

const configuration = vi.hoisted(() => ({
  oAuthPortalUrl: "https://auth.test/portal",
  oAuthRedirectUri: "https://ais.test/api/oauth/callback",
  isProduction: true,
}));
vi.mock("./env", () => ({ ENV: configuration }));
beforeEach(() => {
  configuration.oAuthPortalUrl = "https://auth.test/portal";
  configuration.oAuthRedirectUri = "https://ais.test/api/oauth/callback";
  configuration.isProduction = true;
});

describe("explicit OAuth redirect configuration", () => {
  it("preserves the configured portal path and exact canonical callback", () => {
    expect(getOAuthConfiguration()).toMatchObject({
      redirectUri: "https://ais.test/api/oauth/callback",
      portalLoginUrl: "https://auth.test/portal/app-auth",
      nonceCookieName: "__Host-ais_oauth_nonce",
      nonceCookieOptions: {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
      },
    });
  });

  it.each([
    "",
    "https://evil.test/api/oauth/callback?next=foo",
    "https://ais.test/api/oauth/callback#fragment",
    "https://ais.test/prefix/api/oauth/callback",
    "https://user:password@ais.test/api/oauth/callback",
    "http://ais.test/api/oauth/callback",
    "javascript:alert(1)",
  ])(
    "rejects missing or unsafe canonical callback configuration: %s",
    redirect => {
      configuration.oAuthRedirectUri = redirect;
      expect(() => getOAuthConfiguration()).toThrow();
    }
  );

  it("rejects an absent portal instead of deriving one from the request", () => {
    configuration.oAuthPortalUrl = "";
    expect(() => getOAuthConfiguration()).toThrow();
  });

  it("allows explicitly configured HTTP only outside production", () => {
    configuration.isProduction = false;
    configuration.oAuthRedirectUri = "http://localhost:3000/api/oauth/callback";
    configuration.oAuthPortalUrl = "http://localhost:8000/oauth";
    expect(getOAuthConfiguration()).toMatchObject({
      nonceCookieName: "ais_oauth_nonce",
      nonceCookieOptions: { secure: false },
    });
  });
});
