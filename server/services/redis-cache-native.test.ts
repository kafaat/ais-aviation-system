import crypto from "node:crypto";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startNativeRedis } from "../__tests__/helpers/native-redis";
import { startRedisFaultProxy } from "../__tests__/helpers/redis-fault-proxy";

// This local transport acceptance uses an explicit authority fixture. The
// companion cache-recovery-mysql acceptance exercises the production SQL
// authority across independent processes; this file does not claim SQL proof.
vi.mock("./cache-generation-authority", () => {
  const generations = new Map<string, number>();
  return {
    readCacheGeneration: async (prefix: string, namespace: string) =>
      `${generations.get(`${prefix}:global`) ?? 0}.${generations.get(`${prefix}:${namespace}`) ?? 0}`,
    advanceCacheGeneration: async (
      prefix: string,
      namespace: string | null
    ) => {
      const key = `${prefix}:${namespace ?? "global"}`;
      generations.set(key, (generations.get(key) ?? 0) + 1);
    },
  };
});

const nativeDescribe = process.env.AIS_TEST_REDIS_SERVER_BIN
  ? describe
  : describe.skip;
nativeDescribe(
  "cache invalidation through native Redis and a real TCP partition",
  () => {
    const prefix = `ais_native_cache_${crypto.randomBytes(6).toString("hex")}`;
    let native: Awaited<ReturnType<typeof startNativeRedis>> | undefined;
    let proxy: Awaited<ReturnType<typeof startRedisFaultProxy>> | undefined;
    let probe: Redis | undefined;
    let cache:
      (typeof import("./redis-cache.service"))["redisCacheService"] | undefined;
    beforeAll(async () => {
      native = await startNativeRedis();
      proxy = await startRedisFaultProxy(native.url);
      probe = new Redis(native.url, { commandTimeout: 1000 });
      vi.stubEnv("REDIS_URL", proxy.url);
      vi.stubEnv("CACHE_PREFIX", prefix);
      cache = (await import("./redis-cache.service")).redisCacheService;
      await vi.waitFor(() => expect(cache!.isConnected()).toBe(true), {
        timeout: 5000,
      });
    }, 15000);
    afterAll(async () => {
      await cache?.shutdown();
      await probe?.quit();
      await proxy?.close();
      await native?.stop();
      vi.unstubAllEnvs();
    });

    it("leaves the old Redis bytes intact but makes them unreachable after offline invalidation and reconnect", async () => {
      await cache!.set("search", { id: 1 }, "before outage", 300);
      const keys = await probe!.keys(`${prefix}:search:*`);
      expect(keys).toHaveLength(1);
      const old = await cache!.captureGeneration("search");
      proxy!.disconnect();
      await vi.waitFor(() => expect(cache!.isConnected()).toBe(false));
      await cache!.invalidateNamespace("search");
      expect(await probe!.get(keys[0])).toBe(JSON.stringify("before outage"));
      expect(await probe!.get(`${prefix}:version:search`)).toBeNull();
      proxy!.reconnect();
      await vi.waitFor(() => expect(cache!.isConnected()).toBe(true), {
        timeout: 5000,
      });
      expect(await cache!.get("search", { id: 1 })).toBeNull();
      await cache!.set("search", { id: 1 }, "after outage", 300);
      await cache!.set("search", { id: 1 }, "late source result", 300, old);
      expect(await cache!.get("search", { id: 1 })).toBe("after outage");
    }, 10000);

    it("reports partial clear while offline and confirms raw cleanup only after reconnect", async () => {
      await cache!.setRaw("raw-key", "raw record", 300);
      proxy!.disconnect();
      await vi.waitFor(() => expect(cache!.isConnected()).toBe(false));
      await expect(cache!.clearAll()).rejects.toThrow(
        "raw Redis cleanup is unconfirmed"
      );
      expect(await probe!.get(`${prefix}:raw-key`)).toBe(
        JSON.stringify("raw record")
      );
      proxy!.reconnect();
      await vi.waitFor(() => expect(cache!.isConnected()).toBe(true), {
        timeout: 5000,
      });
      expect(await cache!.get("search", { id: 1 })).toBeNull();
      await cache!.clearAll();
      expect(await probe!.get(`${prefix}:raw-key`)).toBeNull();
    }, 10000);
  }
);
