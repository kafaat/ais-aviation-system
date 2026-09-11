import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { TrpcContext } from "../context";
import {
  adminProcedure,
  protectedProcedure,
  publicProcedure,
  router,
} from "../trpc";

// Exercise the real middleware and counters with the bounded memory fallback.
vi.mock("../../services/cache.service", () => ({
  cacheService: { isConnected: () => false },
}));
vi.mock("../../db", () => ({ getDb: () => null }));

const input = z.object({ type: z.string().optional() }).optional();
function financialRouter() {
  return router({
    status: protectedProcedure.query(() => "pending"),
    write: protectedProcedure.input(input).mutation(() => "accepted"),
  });
}
// Nested routers are essential: a bare router caller loses the scope prefix.
const app = router({
  payments: financialRouter(),
  wallet: financialRouter(),
  refunds: router({
    ...financialRouter()._def.record,
    stats: adminProcedure.query(() => "stats"),
  }),
  splitPayments: router({
    ...financialRouter()._def.record,
    payerStatus: publicProcedure.input(z.string()).query(() => "pending"),
    payerCheckout: publicProcedure.mutation(() => "accepted"),
  }),
  auth: router({
    login: publicProcedure.mutation(() => "attempted"),
    forgotPassword: publicProcedure.mutation(() => "attempted"),
  }),
  bookings: router({ create: protectedProcedure.mutation(() => "created") }),
});
let nextId = 800000;
function context(role: "user" | "admin" | null = "user", ip?: string) {
  const id = ++nextId;
  return {
    user: role ? { id, role } : null,
    authMethod: role ? "cookie" : null,
    tenantId: null,
    req: { ip: ip ?? `198.51.100.${id}`, headers: {}, method: "POST" },
    res: { setHeader: vi.fn() },
  } as unknown as TrpcContext;
}
const limited = { code: "TOO_MANY_REQUESTS" };

describe("financial procedure limits through tRPC", () => {
  it("allows status polling without consuming the shared financial write quota", async () => {
    const api = app.createCaller(context());
    const scopes = [api.payments, api.wallet, api.refunds, api.splitPayments];
    for (let i = 0; i < 40; i++)
      await expect(scopes[i % 4].status()).resolves.toBe("pending");
    for (let i = 0; i < 10; i++)
      await expect(scopes[i % 4].write()).resolves.toBe("accepted");
    await expect(api.refunds.write()).rejects.toMatchObject(limited);
    await expect(api.payments.status()).resolves.toBe("pending");
  });

  it("bounds all financial reads together and isolates identities and writes", async () => {
    const ctx = context();
    const api = app.createCaller(ctx);
    const scopes = [api.payments, api.wallet, api.refunds, api.splitPayments];
    const results = await Promise.allSettled(
      Array.from({ length: 130 }, (_, i) => scopes[i % 4].status())
    );
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(120);
    for (const result of results)
      if (result.status === "rejected")
        expect(result.reason).toMatchObject(limited);
    await expect(api.refunds.status()).rejects.toMatchObject(limited);
    expect(ctx.res.setHeader).toHaveBeenCalledWith("X-RateLimit-Limit", "120");
    expect(ctx.res.setHeader).toHaveBeenCalledWith(
      "X-RateLimit-Remaining",
      "0"
    );
    expect(ctx.res.setHeader).toHaveBeenCalledWith(
      "Retry-After",
      expect.any(String)
    );
    await expect(api.refunds.write()).resolves.toBe("accepted");
    const another = app.createCaller(context("user", ctx.req.ip));
    await expect(another.refunds.status()).resolves.toBe("pending");
  });

  it("uses the registered procedure type despite an input or HTTP method claiming a read", async () => {
    const ctx = context();
    ctx.req.method = "GET";
    const api = app.createCaller(ctx);
    for (let i = 0; i < 10; i++)
      await expect(api.refunds.write({ type: "query" })).resolves.toBe(
        "accepted"
      );
    await expect(api.refunds.write({ type: "query" })).rejects.toMatchObject(
      limited
    );
    await expect(api.refunds.status()).resolves.toBe("pending");
  });

  it("keeps public payer reads bounded by IP regardless of payment token", async () => {
    const ctx = context(null);
    const api = app.createCaller(ctx);
    for (let i = 0; i < 120; i++)
      await api.splitPayments.payerStatus(`fixture-token-${i}`);
    const sameIp = app.createCaller(context(null, ctx.req.ip));
    await expect(
      sameIp.splitPayments.payerStatus("new-token")
    ).rejects.toMatchObject(limited);
    await expect(api.splitPayments.payerCheckout()).resolves.toBe("accepted");
    const otherIp = app.createCaller(context(null));
    await expect(otherIp.splitPayments.payerStatus("new-token")).resolves.toBe(
      "pending"
    );
  });

  it("preserves authentication, password recovery and booking creation limits", async () => {
    const ctx = context();
    const api = app.createCaller(ctx);
    for (let i = 0; i < 5; i++) await api.auth.login();
    const sameIp = app.createCaller(context("user", ctx.req.ip));
    await expect(sameIp.auth.login()).rejects.toMatchObject(limited);
    for (let i = 0; i < 3; i++) await api.auth.forgotPassword();
    await expect(api.auth.forgotPassword()).rejects.toMatchObject(limited);
    for (let i = 0; i < 20; i++) await api.bookings.create();
    await expect(api.bookings.create()).rejects.toMatchObject(limited);
    await expect(api.refunds.status()).resolves.toBe("pending");
    await expect(api.refunds.write()).resolves.toBe("accepted");
  });

  it("keeps admin authorization and financial write limits during dashboard refreshes", async () => {
    const admin = app.createCaller(context("admin"));
    for (let i = 0; i < 30; i++) await admin.refunds.stats();
    for (let i = 0; i < 10; i++) await admin.refunds.write();
    await expect(admin.refunds.write()).rejects.toMatchObject(limited);
    await expect(
      app.createCaller(context()).refunds.stats()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      app.createCaller(context(null)).refunds.status()
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
