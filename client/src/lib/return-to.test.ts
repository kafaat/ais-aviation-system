import { afterEach, describe, expect, it, vi } from "vitest";
import { TRPCClientError } from "@trpc/client";
import { UNAUTHED_ERR_MSG } from "@shared/const";
import { loginPath, safeReturnTo } from "@shared/return-to";
import { getLoginUrl } from "@/const";
import { redirectToLoginIfUnauthorized } from "./auth-navigation";
import { flightSearchPath } from "./search-context";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("local authentication destinations", () => {
  it.each([
    "/my-bookings?exchange=700",
    "/checkout/700?canceled=true&currency=USD",
    "/manage-booking?tab=services",
    "/booking/42?class=business&search=origin%3D1%26destination%3D2%26date%3D2030-11-15",
    "/booking/multi-city?data=%7B%22segments%22%3A%5B1%2C2%5D%7D",
    "/search?origin=1&destination=2&date=2030-11-15#results",
    "/search?label=50%25",
  ])("preserves a local destination and its query: %s", target => {
    expect(safeReturnTo(target)).toBe(target);
    expect(
      new URL(loginPath(target), "https://ais.test").searchParams.get(
        "returnTo"
      )
    ).toBe(target);
  });

  it.each([
    "https://evil.test/",
    "https://navigation.invalid/my-bookings",
    "javascript:alert(1)",
    "//evil.test/",
    "///evil.test/",
    "%2F%2Fevil.test",
    "/%2Fevil.test",
    "/%252Fevil.test",
    "/\\evil.test",
    "/%5Cevil.test",
    "/%255Cevil.test",
    "/my-bookings?x=%0d%0aLocation%3Aevil",
    "/my-bookings?x=%250a",
    "/my-bookings?x=%255c",
    "/my-bookings?x=%C2%85",
    "/my-bookings?x=%25E2%2580%25A8",
    "/my-bookings\n",
    "/login",
    "/login?returnTo=%2Fbooking%2F42",
    "/%6Cogin",
    "/%256cogin",
    "/safe/../login",
    "/safe/%252e%252e/login",
    "/auth/mfa",
    "/api/oauth/callback?code=secret",
    "/logout",
    "/register",
    "/login%3freturnTo=//evil.test",
    "/broken%ZZ",
    " /my-bookings",
    "",
    undefined,
  ])("rejects an unsafe target or authentication loop: %s", target => {
    expect(safeReturnTo(target)).toBe("/");
    expect(loginPath(target)).toBe("/login");
  });
});

describe("session expiry navigation", () => {
  it("returns to the full current route after an unauthorized API response", () => {
    const assign = vi.fn();
    vi.stubGlobal("window", {
      location: {
        pathname: "/checkout/700",
        search: "?canceled=true",
        hash: "#payment",
        assign,
      },
    });
    redirectToLoginIfUnauthorized(new TRPCClientError(UNAUTHED_ERR_MSG));
    expect(assign).toHaveBeenCalledWith(
      loginPath("/checkout/700?canceled=true#payment")
    );
  });

  it("does not restart login while MFA is being verified or redirect on a permission error", () => {
    const assign = vi.fn();
    vi.stubGlobal("window", {
      location: {
        pathname: "/login",
        search: "?returnTo=%2Fcheckout%2F700",
        hash: "",
        assign,
      },
    });
    redirectToLoginIfUnauthorized(new TRPCClientError(UNAUTHED_ERR_MSG));
    expect(assign).not.toHaveBeenCalled();
    window.location.pathname = "/my-bookings";
    redirectToLoginIfUnauthorized(new TRPCClientError("FORBIDDEN"));
    expect(assign).not.toHaveBeenCalled();
  });
});

describe("OAuth return destination", () => {
  it("preserves the existing callback-as-state contract with a validated return query", () => {
    vi.stubEnv("VITE_OAUTH_PORTAL_URL", "https://auth.example.test");
    const target = "/checkout/700?canceled=true&currency=USD";
    const portal = new URL(getLoginUrl(target));
    const redirectUri = portal.searchParams.get("redirectUri")!;
    const callback = new URL(redirectUri);
    expect(callback.origin).toBe(window.location.origin);
    expect(callback.pathname).toBe("/api/oauth/callback");
    expect(callback.searchParams.get("returnTo")).toBe(target);
    expect(atob(portal.searchParams.get("state")!)).toBe(redirectUri);
    expect(portal.searchParams.get("type")).toBe("signIn");
  });

  it("does not send an external return target to the OAuth callback", () => {
    vi.stubEnv("VITE_OAUTH_PORTAL_URL", "https://auth.example.test");
    const portal = new URL(getLoginUrl("//evil.test"));
    const callback = new URL(portal.searchParams.get("redirectUri")!);
    expect(callback.searchParams.has("returnTo")).toBe(false);
  });
});

describe("booking back to search", () => {
  it("retains all valid search options without a browser storage draft", () => {
    const query = new URLSearchParams({
      origin: "1",
      destination: "2",
      date: "2030-11-15",
      currency: "USD",
      country: "us",
      adults: "2",
      children: "1",
      fareClassCode: "Y",
      returnDate: "2030-11-20",
      airline: "Example Air",
    });
    const booking = new URL(
      `/booking/42?class=business&search=${encodeURIComponent(query.toString())}`,
      "https://ais.test"
    );
    const back = new URL(
      flightSearchPath(booking.searchParams.get("search"))!,
      "https://ais.test"
    );
    expect(back.pathname).toBe("/search");
    expect([...back.searchParams]).toEqual([...query]);
  });

  it.each([
    "",
    "origin=1&destination=2",
    "origin=0&destination=2&date=2030-11-15",
    "origin=1&destination=1&date=2030-11-15",
    "origin=1&destination=2&date=2030-02-31",
    "origin=1&destination=2&date=2030-99-15",
    "origin=1&destination=2&date=garbage",
    "origin=1e2&destination=2&date=2030-11-15",
    "origin=9007199254740992&destination=2&date=2030-11-15",
  ])("rejects an incomplete or invalid search context: %s", query => {
    expect(flightSearchPath(query)).toBeNull();
  });
});
