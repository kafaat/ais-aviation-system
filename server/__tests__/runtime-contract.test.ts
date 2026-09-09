import { describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer } from "node:http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { redisConnectionOptions } from "../queue/redis-config";
const health = vi.hoisted(() => ({ ready: false }));
vi.mock("../services/health.service", () => ({
  isReady: async () => health.ready,
  isAlive: () => true,
  performHealthChecks: vi.fn(),
}));
import { healthRouter } from "../routers/health";
import { router } from "../_core/trpc";

describe("runtime contracts", () => {
  it("returns HTTP 503 on dependency failure and 200 after recovery", async () => {
    const app = express();
    app.use(
      "/api/trpc",
      createExpressMiddleware({
        router: router({ health: healthRouter }),
        createContext: () => ({ user: null }) as never,
      })
    );
    const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      health.ready = false;
      expect(
        (await fetch(`http://127.0.0.1:${port}/api/trpc/health.ready`)).status
      ).toBe(503);
      expect(
        (await fetch(`http://127.0.0.1:${port}/api/trpc/health.live`)).status
      ).toBe(200);
      health.ready = true;
      expect(
        (await fetch(`http://127.0.0.1:${port}/api/trpc/health.ready`)).status
      ).toBe(200);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
  it("uses the deployment Redis URL including credentials, DB and TLS", () => {
    expect(
      redisConnectionOptions({
        NODE_ENV: "production",
        REDIS_URL: "rediss://worker:p%40ss@redis.internal:6380/2",
        REDIS_HOST: "wrong-host",
      })
    ).toMatchObject({
      host: "redis.internal",
      port: 6380,
      username: "worker",
      password: "p@ss",
      db: 2,
      tls: { rejectUnauthorized: true },
    });
    expect(() => redisConnectionOptions({ NODE_ENV: "production" })).toThrow(
      "REDIS_URL"
    );
  });
});
