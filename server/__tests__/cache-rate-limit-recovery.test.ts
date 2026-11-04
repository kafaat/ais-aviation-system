import { once } from "node:events";
import { createServer, type Socket } from "node:net";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
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

// This fixture controls real TCP/RESP acknowledgements to the pinned ioredis
// client. It models the counter commands, not Redis's Lua engine; the native
// Redis acceptance test separately verifies the actual script and expiry.
const sockets = new Set<Socket>();
const counters = new Map<string, { count: number; expiresAt: number }>();
const mutations: { command: string; key: string }[] = [];
let nextFault: "stall" | "drip" | "close" | "close-and-recover" | undefined;
let holdHandshake = false;
let cache: typeof import("../services/cache.service").cacheService;
let rateLimits: typeof import("../services/rate-limit.service").rateLimitService;

function readCommand(buffer: Buffer): { args: string[]; bytes: number } | null {
  const firstEnd = buffer.indexOf("\r\n");
  if (firstEnd < 0) return null;
  if (buffer[0] !== 42) throw new Error("Expected a RESP array");
  const length = Number(buffer.subarray(1, firstEnd));
  const args: string[] = [];
  let offset = firstEnd + 2;
  for (let index = 0; index < length; index++) {
    const end = buffer.indexOf("\r\n", offset);
    if (end < 0) return null;
    if (buffer[offset] !== 36) throw new Error("Expected a RESP bulk string");
    const size = Number(buffer.subarray(offset + 1, end));
    const start = end + 2;
    if (buffer.length < start + size + 2) return null;
    args.push(buffer.subarray(start, start + size).toString());
    offset = start + size + 2;
  }
  return { args, bytes: offset };
}

function currentCounter(key: string) {
  const counter = counters.get(key);
  if (counter && counter.expiresAt <= Date.now()) {
    counters.delete(key);
    return undefined;
  }
  return counter;
}

const server = createServer(socket => {
  sockets.add(socket);
  socket.on("error", () => {});
  socket.on("close", () => sockets.delete(socket));
  let buffer = Buffer.alloc(0);
  let stalled = false;
  socket.on("data", chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    let frame: ReturnType<typeof readCommand>;
    while ((frame = readCommand(buffer))) {
      buffer = buffer.subarray(frame.bytes);
      const [verb, ...args] = frame.args;
      const command = verb.toLowerCase();
      if (stalled || holdHandshake) continue;
      let reply: string;
      if (command === "client" || command === "select") {
        reply = "+OK\r\n";
      } else if (command === "info") {
        const info = "redis_version:7.4.5\r\nloading:0\r\n";
        reply = `$${Buffer.byteLength(info)}\r\n${info}\r\n`;
      } else if (command === "set") {
        const key = args[0];
        mutations.push({ command, key });
        if (!currentCounter(key)) {
          counters.set(key, {
            count: Number(args[1]),
            expiresAt: Date.now() + Number(args[3]) * 1000,
          });
          reply = "+OK\r\n";
        } else {
          reply = "$-1\r\n";
        }
      } else if (command === "incr" || command === "eval") {
        const key = command === "eval" ? args[2] : args[0];
        const counter = currentCounter(key) ?? {
          count: 0,
          expiresAt: Infinity,
        };
        counter.count++;
        if (command === "eval" && counter.expiresAt === Infinity)
          counter.expiresAt = Date.now() + Number(args[3]);
        counters.set(key, counter);
        mutations.push({ command, key });
        reply =
          command === "eval"
            ? `*2\r\n:${counter.count}\r\n:${counter.expiresAt - Date.now()}\r\n`
            : `:${counter.count}\r\n`;
        const fault = nextFault;
        nextFault = undefined;
        if (fault) {
          stalled = true;
          if (fault === "drip") {
            // Keep delivering a valid but incomplete response. Socket-idle
            // timeouts alone cannot bound a command on a trickling transport.
            let offset = 0;
            const drip = setInterval(() => {
              if (offset < reply.length) socket.write(reply[offset++]);
            }, 120);
            socket.once("close", () => clearInterval(drip));
          }
          if (fault === "close" || fault === "close-and-recover") {
            holdHandshake = fault === "close";
            socket.destroy();
          }
          continue;
        }
      } else if (command === "ttl") {
        const counter = currentCounter(args[0]);
        const ttl = !counter
          ? -2
          : counter.expiresAt === Infinity
            ? -1
            : Math.ceil((counter.expiresAt - Date.now()) / 1000);
        reply = `:${ttl}\r\n`;
      } else if (command === "expire") {
        const counter = currentCounter(args[0]);
        if (counter) counter.expiresAt = Date.now() + Number(args[1]) * 1000;
        reply = `:${counter ? 1 : 0}\r\n`;
      } else if (command === "ping") {
        reply = "+PONG\r\n";
      } else if (command === "quit") {
        socket.end("+OK\r\n");
        continue;
      } else {
        reply = `-ERR unsupported fixture command ${command}\r\n`;
      }
      socket.write(reply);
    }
  });
});

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

beforeEach(async () => {
  holdHandshake = false;
  nextFault = undefined;
  await expect.poll(() => cache.isConnected()).toBe(true);
});

afterEach(async () => {
  holdHandshake = false;
  nextFault = undefined;
  const client = state.clients[0];
  const closed =
    client?.status === "ready"
      ? new Promise<void>(resolve => client.once("close", () => resolve()))
      : undefined;
  for (const socket of sockets) socket.destroy();
  await closed;
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

async function withinBudget<T>(operation: Promise<T>) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation.then(
        result => ({ result }),
        error => ({ error })
      ),
      new Promise<{ pending: true }>(resolve => {
        timer = setTimeout(() => resolve({ pending: true }), 400);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

it("does not let a closed connection's timeout destroy the recovered ready transport", async () => {
  nextFault = "close-and-recover";
  expect(
    await withinBudget(cache.checkRateLimit("immediate-drop", 1, 60))
  ).toHaveProperty("error");
  await expect.poll(() => cache.isConnected(), { interval: 5 }).toBe(true);
  const recoveredTransport = state.clients[0].stream;
  expect(
    await cache.checkRateLimit("after-immediate-drop", 1, 60)
  ).toMatchObject({
    allowed: true,
  });
  // Reconnect happens at ~100ms, before the old 250ms socket timer would fire.
  // A healthy, idle recovered connection must survive that old deadline.
  await new Promise<void>(resolve => setTimeout(resolve, 300));
  expect(recoveredTransport.destroyed).toBe(false);
  expect(cache.isConnected()).toBe(true);
});

it("bounds a lost acknowledgement after ready and retains the spent quota on fallback", async () => {
  const tier = { name: "lost-ack", requestsPerWindow: 2, windowMs: 60_000 };
  expect(await rateLimits.checkRateLimit("lost-ack", tier)).toMatchObject({
    allowed: true,
    remaining: 1,
  });
  const failedTransport = state.clients[0].stream;
  nextFault = "drip";
  expect(
    await withinBudget(rateLimits.checkRateLimit("lost-ack", tier))
  ).toMatchObject({ result: { allowed: true, remaining: 0 } });
  expect(failedTransport.destroyed).toBe(true);
  expect(await rateLimits.checkRateLimit("lost-ack", tier)).toMatchObject({
    allowed: false,
    remaining: 0,
  });
  await expect.poll(() => cache.isConnected()).toBe(true);
  expect(await rateLimits.checkRateLimit("lost-ack", tier)).toMatchObject({
    allowed: false,
    remaining: 0,
  });
});

it("does not grant a new local quota after a previously acknowledged Redis allowance", async () => {
  const tier = { name: "spent", requestsPerWindow: 1, windowMs: 60_000 };
  expect(await rateLimits.checkRateLimit("spent", tier)).toMatchObject({
    allowed: true,
    remaining: 0,
  });
  holdHandshake = true;
  for (const socket of sockets) socket.destroy();
  await expect.poll(() => cache.isConnected()).toBe(false);
  expect(await rateLimits.checkRateLimit("spent", tier)).toMatchObject({
    allowed: false,
    remaining: 0,
  });
});

it("fails closed on a dropped quota reply and never replays that mutation into a later window", async () => {
  const key = "ack-drop-later-window";
  const fullKey = `${process.env.CACHE_PREFIX || "ais"}:ratelimit:${key}`;
  nextFault = "close";
  const outcome = await withinBudget(cache.checkRateLimit(key, 1, 1));
  expect(outcome).toHaveProperty("error");
  await expect
    .poll(() => currentCounter(fullKey), { timeout: 2000 })
    .toBeUndefined();
  // Hold reconnect until the actual wall-clock window expires. No queued
  // mutation may be sent when the connection becomes ready in the next window.
  holdHandshake = false;
  for (const socket of sockets) socket.destroy();
  await expect.poll(() => cache.isConnected()).toBe(true);
  expect(
    mutations.filter(item => item.key === fullKey && item.command !== "set")
  ).toHaveLength(1);
  expect(currentCounter(fullKey)).toBeUndefined();
  expect(await cache.checkRateLimit(key, 1, 1)).toMatchObject({
    allowed: true,
    remaining: 0,
  });
  expect(
    mutations.filter(item => item.key === fullKey && item.command !== "set")
  ).toHaveLength(2);
});
