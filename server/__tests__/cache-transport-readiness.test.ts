import { once } from "node:events";
import { createServer, type Socket } from "node:net";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type Redis from "ioredis";
import type { RedisOptions } from "ioredis";

const state = vi.hoisted(() => ({ clients: [] as Redis[] }));
vi.mock("ioredis", async importOriginal => {
  const { default: RealRedis } =
    await importOriginal<typeof import("ioredis")>();
  return {
    default: class extends RealRedis {
      constructor(url: string, options: RedisOptions) {
        super(url, options);
        state.clients.push(this);
      }
    },
  };
});
vi.mock("../db", () => ({ getDb: vi.fn(() => null) }));
vi.mock("../_core/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const sockets = new Set<Socket>();
// Accept TCP but deliberately withhold Redis's protocol handshake. No real
// Redis or inherited endpoint is involved; the actual ioredis client is used.
const server = createServer(socket => {
  sockets.add(socket);
  socket.on("error", () => {});
  socket.on("close", () => sockets.delete(socket));
  socket.on("data", () => {});
});
let cache: typeof import("../services/cache.service").cacheService;
let rateLimits: typeof import("../services/rate-limit.service").rateLimitService;

beforeAll(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture port");
  vi.stubEnv("REDIS_URL", `redis://127.0.0.1:${address.port}`);
  ({ cacheService: cache } = await import("../services/cache.service"));
  ({ rateLimitService: rateLimits } =
    await import("../services/rate-limit.service"));
});

afterAll(async () => {
  for (const client of state.clients) client.disconnect();
  for (const socket of sockets) socket.destroy();
  if (server.listening)
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve()))
    );
  vi.unstubAllEnvs();
});

it("uses and enforces the memory rate limit while a real Redis TCP connection is not protocol-ready", async () => {
  await expect.poll(() => state.clients[0]?.status).toBe("connect");
  const tier = {
    name: "handshake-fixture",
    requestsPerWindow: 1,
    windowMs: 60_000,
  };
  let timer: NodeJS.Timeout | undefined;
  try {
    const outcome = await Promise.race([
      rateLimits
        .checkRateLimit("owned-handshake", tier)
        .then(result => ({ result })),
      new Promise<{ pending: true }>(resolve => {
        timer = setTimeout(() => resolve({ pending: true }), 250);
      }),
    ]);
    expect(outcome).toMatchObject({ result: { allowed: true, remaining: 0 } });
    expect(cache.isConnected()).toBe(false);
    expect(state.clients[0].offlineQueue.length).toBe(0);
    expect(
      await rateLimits.checkRateLimit("owned-handshake", tier)
    ).toMatchObject({
      allowed: false,
      remaining: 0,
    });
  } finally {
    clearTimeout(timer);
  }
});
