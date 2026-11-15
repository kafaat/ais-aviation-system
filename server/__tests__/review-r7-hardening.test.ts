import { TRPCError } from "@trpc/server";
import type { Request } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { getSessionCookieOptions } from "../_core/cookies";
import { publicProcedure, router } from "../_core/trpc";
import { generateBookingReference } from "../db";
import { MAX_PRICE_RANGE_DAYS } from "../routers/pricing.router";
import { rateLimitService } from "../services/rate-limit.service";

/**
 * Review intake #355, item R7: small server hardenings, each pinned here.
 *  - the public price range window is bounded;
 *  - booking references come from the OS random source and the alphabet;
 *  - the session cookie is secure in production whatever the proxy forwarded;
 *  - resetting a rate limit reports whether a counter existed;
 *  - a plain Error inside a handler is masked in production.
 */
vi.mock("../services/cache.service", () => ({
  cacheService: {
    isConnected: () => false,
    checkRateLimit: async () => ({ allowed: true, remaining: 1 }),
    get: async () => null,
    set: async () => undefined,
    del: async () => 0,
  },
}));
vi.mock("../db", async importOriginal => ({
  ...(await importOriginal<typeof import("../db")>()),
  getDb: () => null,
}));

afterEach(() => vi.unstubAllEnvs());

describe("R7: public price range window", () => {
  const day = 86_400_000;
  const base = {
    originId: 1,
    destinationId: 2,
    cabinClass: "economy" as const,
    currency: "SAR",
  };
  const start = new Date("2027-01-01T00:00:00.000Z");

  it("refuses a window longer than the fare calendar horizon and a reversed window", async () => {
    const { pricingRouter } = await import("../routers/pricing.router");
    const caller = pricingRouter.createCaller({
      user: null,
      tenantId: null,
      authMethod: null,
      req: undefined,
      res: undefined,
    } as unknown as TrpcContext);
    await expect(
      caller.getPriceRange({
        ...base,
        startDate: start.toISOString(),
        endDate: new Date(
          start.getTime() + (MAX_PRICE_RANGE_DAYS + 1) * day
        ).toISOString(),
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.getPriceRange({
        ...base,
        startDate: start.toISOString(),
        endDate: new Date(start.getTime() - day).toISOString(),
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(MAX_PRICE_RANGE_DAYS).toBe(366);
  });
});

describe("R7: booking reference generation", () => {
  it("draws six characters from the confusion-free alphabet", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const reference = generateBookingReference();
      expect(reference).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
      seen.add(reference);
    }
    // 500 draws from a 32^6 space collide with negligible probability.
    expect(seen.size).toBeGreaterThan(495);
  });
});

describe("R7: session cookie security flag", () => {
  const plainRequest = { protocol: "http", headers: {} } as unknown as Request;

  it("is secure in production even when the proxy did not forward HTTPS", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(getSessionCookieOptions(plainRequest).secure).toBe(true);
  });

  it("still follows the request outside production", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(getSessionCookieOptions(plainRequest).secure).toBe(false);
    const forwarded = {
      protocol: "http",
      headers: { "x-forwarded-proto": "https" },
    } as unknown as Request;
    expect(getSessionCookieOptions(forwarded).secure).toBe(true);
  });
});

describe("R7: honest rate-limit reset", () => {
  it("reports no reset for an identifier that never had a counter, and a reset once it did", async () => {
    const identifier = `ip:198.51.100.${Math.floor(Math.random() * 250)}`;
    expect(await rateLimitService.resetRateLimit(identifier, "r7")).toEqual({
      reset: false,
    });
    await rateLimitService.checkRateLimit(
      identifier,
      { name: "r7", requestsPerWindow: 5, windowMs: 60_000 },
      "r7"
    );
    expect(await rateLimitService.resetRateLimit(identifier, "r7")).toEqual({
      reset: true,
    });
    expect(await rateLimitService.resetRateLimit(identifier, "r7")).toEqual({
      reset: false,
    });
  });
});

describe("R7: internal error masking", () => {
  const probe = router({
    explode: publicProcedure.query(() => {
      throw new Error("Document database unavailable at 10.0.0.7");
    }),
    refuse: publicProcedure.query(() => {
      throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
    }),
  });
  const ctx = {
    user: null,
    tenantId: null,
    authMethod: null,
    req: undefined,
    res: undefined,
  } as unknown as TrpcContext;

  it("replaces a plain error's message in production and keeps it elsewhere", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const masked = await probe
      .createCaller(ctx)
      .explode()
      .catch((error: TRPCError) => error);
    expect(masked).toBeInstanceOf(TRPCError);
    const shape = probe._def._config.errorFormatter({
      error: masked as TRPCError,
      type: "query",
      path: "explode",
      input: undefined,
      ctx,
      shape: {
        message: (masked as TRPCError).message,
        code: -32603,
        data: {
          code: "INTERNAL_SERVER_ERROR",
          httpStatus: 500,
          path: "explode",
        },
      },
    });
    expect(shape.message).toBe("Internal server error");

    const refused = await probe
      .createCaller(ctx)
      .refuse()
      .catch((error: TRPCError) => error);
    const refusedShape = probe._def._config.errorFormatter({
      error: refused as TRPCError,
      type: "query",
      path: "refuse",
      input: undefined,
      ctx,
      shape: {
        message: "Booking not found",
        code: -32004,
        data: { code: "NOT_FOUND", httpStatus: 404, path: "refuse" },
      },
    });
    expect(refusedShape.message).toBe("Booking not found");

    vi.stubEnv("NODE_ENV", "test");
    const visible = probe._def._config.errorFormatter({
      error: masked as TRPCError,
      type: "query",
      path: "explode",
      input: undefined,
      ctx,
      shape: {
        message: (masked as TRPCError).message,
        code: -32603,
        data: {
          code: "INTERNAL_SERVER_ERROR",
          httpStatus: 500,
          path: "explode",
        },
      },
    });
    expect(visible.message).toContain("Document database unavailable");
  });
});
