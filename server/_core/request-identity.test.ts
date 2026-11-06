import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import type { User } from "../../drizzle/schema";
import { createContext } from "./context";
import { resolveRequestIdentity } from "./request-identity";
import {
  createStrictRateLimitMiddleware,
  createUserRateLimitMiddleware,
  rateLimitHeadersMiddleware,
} from "./middleware/user-rate-limit.middleware";

const mocks = vi.hoisted(() => ({
  cookie: vi.fn(),
  bearer: vi.fn(),
  active: vi.fn(),
  userLimit: vi.fn(),
  strictLimit: vi.fn(),
  status: vi.fn(),
}));
vi.mock("./sdk", () => ({ sdk: { authenticateRequest: mocks.cookie } }));
vi.mock("../services/mobile-auth-v2.service", () => ({
  mobileAuthServiceV2: { authenticateAccessToken: mocks.bearer },
}));
vi.mock("../services/tenant.service", () => ({ isTenantActive: mocks.active }));
vi.mock("../services/rate-limit.service", () => ({
  STRICT_RATE_LIMITS: { auth: {} },
  rateLimitService: {
    checkUserRateLimit: mocks.userLimit,
    checkStrictRateLimit: mocks.strictLimit,
    getRateLimitStatus: mocks.status,
    getRateLimitHeaders: () => ({ "X-RateLimit-Limit": "100" }),
  },
}));
vi.mock("./logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const user = { id: 42, role: "user", tenantId: 7 } as User;
function request(authorization?: string) {
  return {
    headers: { authorization, cookie: "valid-cookie" },
    ip: "198.51.100.9",
  } as Request;
}
function response() {
  return {
    setHeader: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cookie.mockResolvedValue(user);
  mocks.bearer.mockResolvedValue(user);
  mocks.active.mockResolvedValue(true);
  const allowed = {
    allowed: true,
    tier: "bronze",
    limit: 100,
    remaining: 99,
    resetAt: new Date(),
  };
  mocks.userLimit.mockResolvedValue(allowed);
  mocks.strictLimit.mockResolvedValue(allowed);
  mocks.status.mockResolvedValue(allowed);
});

describe("canonical request identity and rate-limit parity", () => {
  it.each([undefined, "Bearer valid-token"])(
    "uses the same user for context, general, strict and status quotas: %s",
    async authorization => {
      const req = request(authorization);
      const res = response();
      const next = vi.fn();
      await createUserRateLimitMiddleware({ skipInDevelopment: false })(
        req,
        res,
        next
      );
      await createStrictRateLimitMiddleware("auth")(req, res, next);
      await rateLimitHeadersMiddleware()(req, res, next);
      const ctx = await createContext({ req, res });
      expect(ctx).toMatchObject({
        user,
        tenantId: 7,
        authMethod: authorization ? "bearer" : "cookie",
      });
      expect(mocks.userLimit).toHaveBeenCalledWith(user, req.ip, "api");
      expect(mocks.strictLimit).toHaveBeenCalledWith("user:42", "auth");
      expect(mocks.status).toHaveBeenCalledWith(user, req.ip);
      expect(mocks.active).toHaveBeenCalledOnce();
      expect(
        authorization ? mocks.bearer : mocks.cookie
      ).toHaveBeenCalledOnce();
      expect(
        authorization ? mocks.cookie : mocks.bearer
      ).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(3);
    }
  );

  it.each(["Bearer invalid", "Bearer", "Bearer   ", "Bearer token extra"])(
    "never falls back to a valid cookie after a rejected Bearer attempt: %s",
    async authorization => {
      mocks.bearer.mockRejectedValue(
        new Error("Invalid or revoked credential")
      );
      const req = request(authorization);
      const res = response();
      await createUserRateLimitMiddleware({ skipInDevelopment: false })(
        req,
        res,
        vi.fn()
      );
      await createStrictRateLimitMiddleware("auth")(req, res, vi.fn());
      expect(await createContext({ req, res })).toMatchObject({
        user: null,
        tenantId: null,
        authMethod: null,
      });
      expect(mocks.cookie).not.toHaveBeenCalled();
      expect(mocks.userLimit).toHaveBeenCalledWith(null, req.ip, "api");
      expect(mocks.strictLimit).toHaveBeenCalledWith(`ip:${req.ip}`, "auth");
    }
  );

  it.each([undefined, "Bearer valid-token"])(
    "applies inactive-tenant admission equally to both credential forms: %s",
    async authorization => {
      mocks.active.mockResolvedValue(false);
      const req = request(authorization);
      const res = response();
      await createUserRateLimitMiddleware({ skipInDevelopment: false })(
        req,
        res,
        vi.fn()
      );
      expect(await createContext({ req, res })).toMatchObject({
        user: null,
        tenantId: null,
        authMethod: null,
      });
      expect(mocks.userLimit).toHaveBeenCalledWith(null, req.ip, "api");
    }
  );

  it.each([undefined, "Bearer valid-token"])(
    "uses anonymous quotas when the authoritative session is locked/revoked: %s",
    async authorization => {
      mocks.cookie.mockRejectedValue(
        new Error("Session revoked or user locked")
      );
      mocks.bearer.mockRejectedValue(
        new Error("Session revoked or user locked")
      );
      const req = request(authorization);
      const res = response();
      await rateLimitHeadersMiddleware()(req, res, vi.fn());
      expect((await createContext({ req, res })).user).toBeNull();
      expect(mocks.status).toHaveBeenCalledWith(null, req.ip);
    }
  );

  it("ignores injected req.user and caches concurrent authentication once", async () => {
    mocks.cookie.mockResolvedValue(null);
    const req = Object.assign(request(), {
      user: { id: 1, role: "super_admin" },
    });
    const [first, second] = await Promise.all([
      resolveRequestIdentity(req),
      resolveRequestIdentity(req),
    ]);
    expect(first).toBe(second);
    expect(first.user).toBeNull();
    expect(mocks.cookie).toHaveBeenCalledOnce();
  });

  it("fails tenant lookup closed without granting an authenticated quota", async () => {
    mocks.active.mockRejectedValue(new Error("Database unavailable"));
    expect((await resolveRequestIdentity(request())).user).toBeNull();
  });

  it("preserves platform-admin tenant exemption", async () => {
    mocks.cookie.mockResolvedValue({ ...user, role: "admin" });
    expect((await resolveRequestIdentity(request())).user?.id).toBe(42);
    expect(mocks.active).not.toHaveBeenCalled();
  });

  it("keeps an exceeded authenticated quota blocking", async () => {
    mocks.userLimit.mockResolvedValue({
      allowed: false,
      limit: 100,
      retryAfterSeconds: 30,
      resetAt: new Date(),
    });
    const res = response();
    const next = vi.fn();
    await createUserRateLimitMiddleware({ skipInDevelopment: false })(
      request("Bearer valid-token"),
      res,
      next
    );
    expect(res.status).toHaveBeenCalledWith(429);
    expect(next).not.toHaveBeenCalled();
  });
});
