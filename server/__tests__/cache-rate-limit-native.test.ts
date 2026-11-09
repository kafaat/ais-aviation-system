import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startNativeRedis } from "./helpers/native-redis";

vi.mock("../_core/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Native acceptance is explicit and self-contained. An inherited REDIS_URL
// cannot select production/shared Redis or satisfy this fixture's opt-in.
describe.skipIf(!process.env.AIS_TEST_REDIS_SERVER_BIN)(
  "atomic rate quota on disposable native Redis",
  () => {
    let fixture: Awaited<ReturnType<typeof startNativeRedis>> | undefined;
    let reference: Redis | undefined;
    let cache:
      typeof import("../services/cache.service").cacheService | undefined;
    const prefix = `ais-rate-native-${randomUUID()}`;

    beforeAll(async () => {
      fixture = await startNativeRedis();
      vi.stubEnv("REDIS_URL", fixture.url);
      vi.stubEnv("CACHE_PREFIX", prefix);
      reference = new Redis(fixture.url, { lazyConnect: true });
      await reference.connect();
      ({ cacheService: cache } = await import("../services/cache.service"));
      await vi.waitFor(() => {
        if (!cache?.isConnected())
          throw new Error("Cache is not protocol-ready");
      });
    });

    afterAll(async () => {
      try {
        await cache?.disconnect();
        await reference?.quit();
      } finally {
        reference?.disconnect();
        await fixture?.stop();
        vi.unstubAllEnvs();
      }
    });

    it("accepts exactly five of twenty simultaneous requests with an expiring integer counter", async () => {
      const key = "concurrent";
      const replies = await Promise.all(
        Array.from({ length: 20 }, () => cache!.checkRateLimit(key, 5, 60))
      );
      expect(replies.filter(reply => reply.allowed)).toHaveLength(5);
      expect(await reference!.get(`${prefix}:ratelimit:${key}`)).toBe("20");
      expect(
        await reference!.pttl(`${prefix}:ratelimit:${key}`)
      ).toBeGreaterThan(0);
      expect(await cache!.checkRateLimit(key, 5, 60)).toMatchObject({
        allowed: false,
        remaining: 0,
      });
    });

    it("repairs a legacy counter without expiry without resetting the consumed quota", async () => {
      const key = "legacy";
      const fullKey = `${prefix}:ratelimit:${key}`;
      await reference!.set(fullKey, "4");
      expect(await reference!.pttl(fullKey)).toBe(-1);
      expect(await cache!.checkRateLimit(key, 5, 60)).toMatchObject({
        allowed: true,
        remaining: 0,
        ttlMs: 60_000,
      });
      expect(await reference!.pttl(fullKey)).toBeGreaterThan(0);
      expect(await cache!.checkRateLimit(key, 5, 60)).toMatchObject({
        allowed: false,
        remaining: 0,
      });
    });

    it("starts a fresh quota only when the actual Redis window expires", async () => {
      const key = "expiry";
      expect(await cache!.checkRateLimit(key, 1, 1)).toMatchObject({
        allowed: true,
      });
      expect(await cache!.checkRateLimit(key, 1, 1)).toMatchObject({
        allowed: false,
      });
      await expect
        .poll(() => reference!.exists(`${prefix}:ratelimit:${key}`), {
          timeout: 2000,
        })
        .toBe(0);
      expect(await cache!.checkRateLimit(key, 1, 1)).toMatchObject({
        allowed: true,
        remaining: 0,
      });
    });

    it("rejects invalid expiry before any counter mutation", async () => {
      await expect(cache!.checkRateLimit("invalid", 1, 0)).rejects.toThrow(
        "Invalid Redis rate limit window"
      );
      expect(await reference!.exists(`${prefix}:ratelimit:invalid`)).toBe(0);
    });
  }
);
