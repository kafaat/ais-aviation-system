import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Express, Request, Response } from "express";
import { oauthLoginStates } from "../../drizzle/schema";
import { authorityRelationalFixture } from "../__tests__/helpers/authority-relational-fixture";
import {
  consumeOAuthLogin,
  OAUTH_STATE_MAX_AGE_MS,
} from "../services/oauth-login-state.service";
import { rateLimitService } from "../services/rate-limit.service";
import { OAUTH_START_RATE_LIMIT, registerOAuthRoutes } from "./oauth";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
// The real login-state service runs against relational SQL and the real
// limiter runs its in-memory path; Redis is held disconnected, never dialled.
vi.mock("../services/cache.service", () => ({
  cacheService: { isConnected: () => false },
}));
vi.mock("../db", () => ({
  getDb: mocks.getDb,
  upsertUser: vi.fn(),
  getUserByOpenId: vi.fn(),
}));
vi.mock("./oauth-config", () => ({
  getOAuthConfiguration: () => ({
    portalLoginUrl: "https://portal.test/app-auth",
    redirectUri: "https://ais.test/api/oauth/callback",
    nonceCookieName: "__Host-ais_oauth_nonce",
    nonceCookieOptions: {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    },
  }),
}));
vi.mock("./sdk", () => ({ sdk: {} }));
vi.mock("./cookies", () => ({ getSessionCookieOptions: () => ({}) }));
vi.mock("../services/mfa.service", () => ({
  getMfaSettings: vi.fn(),
  createMfaChallenge: vi.fn(),
}));
vi.mock("../services/mobile-auth-v2.service", () => ({
  SESSION_MAX_AGE_MS: 3600000,
}));

const scope = `strict:${OAUTH_START_RATE_LIMIT.name}`;
const ips = ["198.51.100.20", "198.51.100.21"];
let fixture: ReturnType<typeof authorityRelationalFixture>;
let handler: (req: Request, res: Response) => Promise<void>;

registerOAuthRoutes({
  get: (path: string, route: typeof handler) => {
    if (path === "/api/oauth/start") handler = route;
  },
} as unknown as Express);

async function start(ip: string) {
  const res = {
    headers: {} as Record<string, string>,
    setHeader: vi.fn((key: string, value: string) => {
      res.headers[key] = value;
    }),
    cookie: vi.fn(),
    redirect: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
  const req = { ip, query: { returnTo: "/" }, headers: {}, socket: {} };
  await handler(req as unknown as Request, res as unknown as Response);
  return res;
}

const storedRows = () => fixture.rows(oauthLoginStates).length;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
  fixture = authorityRelationalFixture([oauthLoginStates]);
  mocks.getDb.mockReset().mockReturnValue(fixture.db);
  for (const ip of ips)
    await rateLimitService.resetRateLimit(`ip:${ip}`, scope);
});
afterEach(() => {
  fixture.sqlite.close();
  vi.useRealTimers();
});

describe("anonymous OAuth start quota", () => {
  it("answers 429 over the per-IP quota without storing a row or a nonce", async () => {
    const quota = OAUTH_START_RATE_LIMIT.requestsPerWindow;
    for (let index = 0; index < quota; index++)
      expect((await start(ips[0])).redirect).toHaveBeenCalledOnce();
    expect(storedRows()).toBe(quota);

    const refused = await start(ips[0]);
    expect(refused.status).toHaveBeenCalledWith(429);
    expect(refused.redirect).not.toHaveBeenCalled();
    expect(refused.cookie).not.toHaveBeenCalled();
    expect(Number(refused.headers["Retry-After"])).toBeGreaterThan(0);
    expect(storedRows()).toBe(quota);

    // The quota is per client IP, not a site-wide login switch.
    const other = await start(ips[1]);
    expect(other.redirect).toHaveBeenCalledOnce();
    expect(storedRows()).toBe(quota + 1);
  });

  it("holds a sustained single-IP flood to one quota of rows, and starts stay consumable", async () => {
    const quota = OAUTH_START_RATE_LIMIT.requestsPerWindow;
    let last: Awaited<ReturnType<typeof start>> | undefined;
    for (let window = 0; window < 3; window++) {
      for (let index = 0; index < quota; index++) {
        last = await start(ips[0]);
        expect(last.redirect).toHaveBeenCalledOnce();
      }
      for (let index = 0; index < 5; index++)
        expect((await start(ips[0])).status).toHaveBeenCalledWith(429);
      // Earlier windows' rows have expired and were purged by later starts.
      expect(storedRows()).toBe(quota);
      if (window < 2) vi.setSystemTime(Date.now() + OAUTH_STATE_MAX_AGE_MS);
    }

    const location = new URL(last!.redirect.mock.calls[0][1] as string);
    const browserNonce = last!.cookie.mock.calls[0][1] as string;
    expect(
      await consumeOAuthLogin({
        state: location.searchParams.get("state")!,
        browserNonce,
        redirectUri: "https://ais.test/api/oauth/callback",
      })
    ).toEqual({
      redirectUri: "https://ais.test/api/oauth/callback",
      returnTo: "/",
    });
  });
});
