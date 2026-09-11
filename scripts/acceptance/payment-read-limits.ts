import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TrpcContext } from "../../server/_core/context";

/** Invoked only by the guarded disposable MySQL/Redis acceptance runner. */
export async function verifyPaymentReadLimits(
  check: (name: string, run: () => Promise<void>) => Promise<void>
) {
  const { cacheService } = await import("../../server/services/cache.service");
  const { publicProcedure, router } = await import("../../server/_core/trpc");
  const { rateLimitService } =
    await import("../../server/services/rate-limit.service");
  const app = router({
    refunds: router({
      status: publicProcedure.query(() => "pending"),
      request: publicProcedure.mutation(() => "accepted"),
    }),
  });
  await check(
    "Redis isolates concurrent financial reads from strict mutations through tRPC",
    async () => {
      assert.equal(cacheService.isConnected(), true);
      const ip = `acceptance-${randomUUID()}`;
      const identifier = `ip:${ip}`;
      const api = app.createCaller({
        user: null,
        authMethod: null,
        tenantId: null,
        req: { ip, headers: {} },
        res: { setHeader() {} },
      } as unknown as TrpcContext);
      try {
        const reads = await Promise.allSettled(
          Array.from({ length: 130 }, () => api.refunds.status())
        );
        assert.equal(reads.filter(r => r.status === "fulfilled").length, 120);
        const writes = await Promise.allSettled(
          Array.from({ length: 11 }, () => api.refunds.request())
        );
        assert.equal(writes.filter(r => r.status === "fulfilled").length, 10);
        for (const result of [...reads, ...writes])
          if (result.status === "rejected")
            assert.equal(result.reason.code, "TOO_MANY_REQUESTS");
        // Prove the actual Redis keys were used; memory fallback is not acceptance.
        const prefix = `${process.env.CACHE_PREFIX || "ais"}:ratelimit:strict:`;
        assert.equal(
          await cacheService.get<number>(`${prefix}paymentRead:${identifier}`),
          130
        );
        assert.equal(
          await cacheService.get<number>(`${prefix}payment:${identifier}`),
          11
        );
      } finally {
        await rateLimitService.resetRateLimit(identifier, "strict:paymentRead");
        await rateLimitService.resetRateLimit(identifier, "strict:payment");
      }
    }
  );
}
