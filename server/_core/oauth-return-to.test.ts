import { beforeEach, expect, it, vi } from "vitest";
import type { Express, Request, Response } from "express";
import { registerOAuthRoutes } from "./oauth";

const state = vi.hoisted(() => ({
  exchange: vi.fn(),
  userInfo: vi.fn(),
  session: vi.fn(),
  upsert: vi.fn(),
  mfa: vi.fn(),
  challenge: vi.fn(),
}));
vi.mock("./sdk", () => ({
  sdk: {
    exchangeCodeForToken: state.exchange,
    getUserInfo: state.userInfo,
    createSessionToken: state.session,
  },
}));
vi.mock("../db", () => ({
  upsertUser: state.upsert,
  getUserByOpenId: async () => ({ id: 1 }),
}));
vi.mock("./cookies", () => ({
  getSessionCookieOptions: () => ({ httpOnly: true, secure: true }),
}));
vi.mock("../services/mfa.service", () => ({
  getMfaSettings: state.mfa,
  createMfaChallenge: state.challenge,
}));
vi.mock("../services/mobile-auth-v2.service", () => ({
  SESSION_MAX_AGE_MS: 3600000,
}));

beforeEach(() => {
  vi.clearAllMocks();
  state.exchange.mockResolvedValue({ accessToken: "provider-token" });
  state.userInfo.mockResolvedValue({ openId: "user-1", name: "Test" });
  state.session.mockResolvedValue("session-token");
  state.mfa.mockResolvedValue(null);
  state.challenge.mockResolvedValue("mfa-challenge");
});

async function callback(returnTo?: string) {
  let handler: ((req: Request, res: Response) => Promise<void>) | undefined;
  registerOAuthRoutes({
    get: (_path: string, callback: typeof handler) => {
      handler = callback;
    },
  } as unknown as Express);
  const res = {
    redirect: vi.fn(),
    cookie: vi.fn(),
    status: vi.fn(),
    json: vi.fn(),
  };
  const req = {
    query: {
      code: "provider-code",
      state: "original-provider-state",
      returnTo,
    },
  };
  await handler?.(req as unknown as Request, res as unknown as Response);
  return res;
}

it("returns an OAuth login to the local journey without changing the provider state exchange", async () => {
  const target = "/checkout/700?canceled=true&currency=USD";
  const res = await callback(target);
  expect(state.exchange).toHaveBeenCalledWith(
    "provider-code",
    "original-provider-state"
  );
  expect(res.cookie).toHaveBeenCalledOnce();
  expect(res.redirect).toHaveBeenCalledWith(302, target);
});

it("carries the local target into MFA without issuing a pre-MFA session", async () => {
  state.mfa.mockResolvedValue({ isEnabled: true });
  const target = "/my-bookings?exchange=700";
  const res = await callback(target);
  expect(res.cookie).not.toHaveBeenCalled();
  expect(state.session).not.toHaveBeenCalled();
  const redirect = new URL(res.redirect.mock.calls[0][1], "https://ais.test");
  expect(redirect.pathname).toBe("/login");
  expect(redirect.searchParams.get("mfaChallenge")).toBe("mfa-challenge");
  expect(redirect.searchParams.get("returnTo")).toBe(target);
});

it.each([
  "//evil.test",
  "/%2fevil.test",
  "/%256cogin",
  "/api/oauth/callback",
  "/my-bookings?x=%250d",
])("rejects an unsafe OAuth return target: %s", async target => {
  const res = await callback(target);
  expect(res.redirect).toHaveBeenCalledWith(302, "/");
});
