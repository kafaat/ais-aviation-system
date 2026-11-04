import http, {
  type IncomingMessage,
  type RequestListener,
  type ServerResponse,
} from "node:http";
import https from "node:https";
import type { AddressInfo, Socket } from "node:net";
import express from "express";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  execute: vi.fn(),
  cacheHealth: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));
vi.mock("../db", () => ({
  getDb: () => ({ execute: dependencies.execute }),
}));
vi.mock("../services/redis-cache.service", () => ({
  redisCacheService: { healthCheck: dependencies.cacheHealth },
}));
// Health procedures have no sensitive-procedure quota. Prevent the unrelated
// rate-limit module's cache import from opening a real Redis connection.
vi.mock("../services/cache.service", () => ({
  cacheService: { isConnected: () => false },
}));
vi.mock("../_core/logger", () => ({
  logger: {
    warn: dependencies.warn,
    error: dependencies.error,
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import { checkStripe, isReady } from "../services/health.service";
import { healthRouter } from "../routers/health";
import { router } from "../_core/trpc";
import { createRestMiddleware } from "../_core/rest";
import type { TrpcContext } from "../_core/context";

const MOCK_KEY = "sk_test_health_fixture_private_credential";
const PRIVATE_MARKER = "PRIVATE_PROVIDER_DIAGNOSTIC_MUST_NOT_ESCAPE";
const validBalance = {
  object: "balance",
  livemode: false,
  available: [],
  pending: [],
};

interface LocalServer {
  url: string;
  requests: Array<{
    method: string | undefined;
    path: string | undefined;
    usesFixtureCredential: boolean;
  }>;
  abortedResponses: number;
  close(): Promise<void>;
}

const localServers: LocalServer[] = [];
const providerOrigins = new Set<string>();
let blockedOutboundRequests = 0;
let unsafeRedirectRequests = 0;
const originalHttpRequest = http.request;
const originalHttpsRequest = https.request;
const originalFetch = globalThis.fetch;

function localHost(value: string | null | undefined): boolean {
  return value === "127.0.0.1" || value === "localhost" || value === "[::1]";
}

function guardNodeRequest(args: unknown[]) {
  const first = args[0];
  const destination =
    typeof first === "string" || first instanceof URL
      ? new URL(first)
      : (first as http.RequestOptions);
  if (!localHost(destination.hostname ?? destination.host)) {
    blockedOutboundRequests++;
    throw new Error("Local readiness test blocked an external request");
  }
}

beforeEach(() => {
  dependencies.execute.mockReset().mockResolvedValue([]);
  dependencies.cacheHealth.mockReset().mockResolvedValue({
    status: "ok",
    redis: { connected: true, latency: 1 },
  });
  dependencies.warn.mockClear();
  dependencies.error.mockClear();
  blockedOutboundRequests = 0;
  unsafeRedirectRequests = 0;
  vi.stubEnv("AIS_PROVIDER_BOUNDARY", "isolated");
  vi.stubEnv("STRIPE_SECRET_KEY", MOCK_KEY);
  vi.stubEnv("STRIPE_MOCK_HOST", "");

  vi.spyOn(http, "request").mockImplementation(((...args: unknown[]) => {
    guardNodeRequest(args);
    return Reflect.apply(originalHttpRequest, http, args);
  }) as typeof http.request);
  vi.spyOn(https, "request").mockImplementation(((...args: unknown[]) => {
    guardNodeRequest(args);
    return Reflect.apply(originalHttpsRequest, https, args);
  }) as typeof https.request);
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const target = new URL(
      input instanceof Request ? input.url : String(input)
    );
    if (!localHost(target.hostname)) {
      blockedOutboundRequests++;
      throw new Error("Local readiness test blocked an external fetch");
    }
    const redirect =
      init?.redirect ?? (input instanceof Request ? input.redirect : undefined);
    if (
      providerOrigins.has(target.origin) &&
      redirect !== "error" &&
      redirect !== "manual"
    ) {
      // Native fetch follows redirects internally. Refuse an unsafe call before
      // it could leave loopback, then fail the test through the counter below.
      unsafeRedirectRequests++;
      throw new Error(
        "Local readiness test requires explicit redirect refusal"
      );
    }
    return originalFetch(input, init);
  });
});

afterEach(async () => {
  await Promise.all(localServers.splice(0).map(server => server.close()));
  providerOrigins.clear();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  expect(blockedOutboundRequests).toBe(0);
  expect(unsafeRedirectRequests).toBe(0);
});

async function serve(
  handler: RequestListener,
  provider = true
): Promise<LocalServer> {
  const sockets = new Set<Socket>();
  const record: LocalServer = {
    url: "",
    requests: [],
    abortedResponses: 0,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
      });
    },
  };
  const server = http.createServer((request, response) => {
    record.requests.push({
      method: request.method,
      path: request.url,
      usesFixtureCredential:
        request.headers.authorization === `Bearer ${MOCK_KEY}`,
    });
    response.once("close", () => {
      if (!response.writableEnded) record.abortedResponses++;
    });
    handler(request, response);
  });
  server.on("connection", socket => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  record.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  localServers.push(record);
  if (provider) providerOrigins.add(record.url);
  return record;
}

function json(response: ServerResponse, body: unknown, status = 200) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function isolate(mock: LocalServer) {
  vi.stubEnv("AIS_PROVIDER_BOUNDARY", "isolated");
  vi.stubEnv("STRIPE_SECRET_KEY", MOCK_KEY);
  vi.stubEnv("STRIPE_MOCK_HOST", mock.url);
}

function expectPrivate(value: unknown, extra: string[] = []) {
  const serialized = JSON.stringify(value);
  for (const secret of [MOCK_KEY, PRIVATE_MARKER, ...extra])
    expect(serialized).not.toContain(secret);
}

type PrincipalRole = NonNullable<TrpcContext["user"]>["role"];
async function serveHealth(role: PrincipalRole | null = null) {
  const app = express();
  const root = router({ health: healthRouter });
  // This is an isolated HTTP-adapter principal fixture, not a minted session or
  // a replacement for application authentication in a running deployment.
  const context = ({ req, res }: Pick<TrpcContext, "req" | "res">) => ({
    req,
    res,
    user: role
      ? ({ id: 1, role, tenantId: null } as TrpcContext["user"])
      : null,
    authMethod: role ? ("cookie" as const) : null,
    tenantId: null,
  });
  app.use(
    "/api/rest",
    createRestMiddleware({ router: root, createContext: context })
  );
  app.use(
    "/api/trpc",
    createExpressMiddleware({ router: root, createContext: context })
  );
  return serve(app, false);
}

describe("isolated Stripe readiness against real local HTTP", () => {
  it("retains the open-mode format check without making a provider request", async () => {
    const mock = await serve((_request, response) =>
      json(response, validBalance)
    );
    vi.stubEnv("AIS_PROVIDER_BOUNDARY", "open");
    vi.stubEnv("STRIPE_MOCK_HOST", mock.url);
    for (const [key, status] of [
      ["", "fail"],
      ["sk_test_synthetic", "fail"],
      ["sk_test_" + "a".repeat(32), "pass"],
    ] as const) {
      vi.stubEnv("STRIPE_SECRET_KEY", key);
      expect(await checkStripe()).toMatchObject({
        status,
        mode: "configuration",
      });
    }
    expect(mock.requests).toEqual([]);
  });

  it("reads the validated private mock balance once using the configured test credential", async () => {
    const mock = await serve((_request, response) =>
      json(response, validBalance)
    );
    isolate(mock);
    const result = await checkStripe();
    expect(result).toMatchObject({ status: "pass", mode: "mock" });
    expect(mock.requests).toEqual([
      { method: "GET", path: "/v1/balance", usesFixtureCredential: true },
    ]);
    expectPrivate(result, [mock.url]);
  });

  it.each([429, 503])(
    "does not retry HTTP %i or expose the provider error",
    async status => {
      const mock = await serve((_request, response) => {
        response.setHeader("retry-after", "0");
        response.setHeader("stripe-should-retry", "true");
        json(
          response,
          { error: { message: PRIVATE_MARKER + MOCK_KEY } },
          status
        );
      });
      isolate(mock);
      const result = await checkStripe();
      expect(result).toMatchObject({ status: "fail", mode: "mock" });
      expect(mock.requests).toHaveLength(1);
      expectPrivate(result, [mock.url]);
    }
  );

  it("requires HTTP 200 even when another success status carries a valid balance", async () => {
    const mock = await serve((_request, response) =>
      json(response, validBalance, 201)
    );
    isolate(mock);
    expect(await checkStripe()).toMatchObject({
      status: "fail",
      mode: "mock",
      error: "STRIPE_MOCK_INVALID_RESPONSE",
    });
    expect(mock.requests).toHaveLength(1);
  });

  it.each([
    ["malformed JSON", PRIVATE_MARKER],
    ["unrelated object", { ...validBalance, object: "account" }],
    ["live response", { ...validBalance, livemode: true }],
    ["invalid balance arrays", { ...validBalance, pending: {} }],
  ])("rejects a 200 response with %s", async (_label, body) => {
    const mock = await serve((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(typeof body === "string" ? body : JSON.stringify(body));
    });
    isolate(mock);
    const result = await checkStripe();
    expect(result).toMatchObject({ status: "fail", mode: "mock" });
    expect(mock.requests).toHaveLength(1);
    expectPrivate(result, [mock.url]);
  });

  it("rejects an oversized successful balance body", async () => {
    const mock = await serve((_request, response) => {
      json(response, {
        ...validBalance,
        diagnostic: PRIVATE_MARKER + "x".repeat(70 * 1024),
      });
    });
    isolate(mock);
    const result = await checkStripe();
    expect(result).toMatchObject({ status: "fail", mode: "mock" });
    expect(mock.requests).toHaveLength(1);
    expectPrivate(result, [mock.url]);
  });

  it("bounds a mock that never sends headers and cancels its only request", async () => {
    const mock = await serve(() => {});
    isolate(mock);
    const started = performance.now();
    const result = await checkStripe();
    const elapsed = performance.now() - started;
    expect(result).toMatchObject({
      status: "fail",
      mode: "mock",
      error: "STRIPE_MOCK_TIMEOUT",
    });
    expect(elapsed).toBeGreaterThanOrEqual(1000);
    expect(elapsed).toBeLessThan(4000);
    expect(mock.requests).toHaveLength(1);
    await expect.poll(() => mock.abortedResponses).toBe(1);
    expectPrivate(result, [mock.url]);
  });

  it("enforces a total deadline while a partial body keeps sending data", async () => {
    const mock = await serve((_request: IncomingMessage, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.write(
        '{"object":"balance","livemode":false,"available":[],"pending":['
      );
      const timer = setInterval(() => response.write(" "), 50);
      response.once("close", () => clearInterval(timer));
    });
    isolate(mock);
    const started = performance.now();
    const result = await checkStripe();
    const elapsed = performance.now() - started;
    expect(result).toMatchObject({
      status: "fail",
      mode: "mock",
      error: "STRIPE_MOCK_TIMEOUT",
    });
    expect(elapsed).toBeGreaterThanOrEqual(1000);
    expect(elapsed).toBeLessThan(4000);
    expect(mock.requests).toHaveLength(1);
    await expect.poll(() => mock.abortedResponses).toBe(1);
    expectPrivate(result, [mock.url]);
  });

  it.each([302, 307])(
    "rejects HTTP %i even with a valid balance body and never follows Location",
    async status => {
      const canary = await serve((_request, response) =>
        json(response, validBalance)
      );
      let location = canary.url + "/must-not-be-requested";
      const mock = await serve((_request, response) => {
        response.setHeader("location", location);
        json(response, validBalance, status);
      });
      isolate(mock);
      expect(await checkStripe()).toMatchObject({
        status: "fail",
        mode: "mock",
      });
      location =
        "https://stripe-redirect.example.invalid/must-not-be-requested";
      expect(await checkStripe()).toMatchObject({
        status: "fail",
        mode: "mock",
      });
      expect(mock.requests).toHaveLength(2);
      expect(canary.requests).toEqual([]);
    }
  );

  it("rejects invalid isolated configuration before attempting any HTTP request", async () => {
    const mock = await serve((_request, response) =>
      json(response, validBalance)
    );
    for (const configuration of [
      { host: "", key: MOCK_KEY },
      { host: "https://api.stripe.com", key: MOCK_KEY },
      {
        host: mock.url.replace("http://", "http://user:secret@"),
        key: MOCK_KEY,
      },
      { host: mock.url, key: "sk_live_" + "a".repeat(32) },
      { host: mock.url, key: "rk_live_" + "a".repeat(32) },
    ]) {
      isolate(mock);
      vi.stubEnv("STRIPE_MOCK_HOST", configuration.host);
      vi.stubEnv("STRIPE_SECRET_KEY", configuration.key);
      const result = await checkStripe();
      expect(result).toMatchObject({ status: "fail", mode: "mock" });
      expectPrivate(result, [configuration.key, mock.url, "user:secret"]);
    }
    expect(mock.requests).toEqual([]);
  });

  it.each(["database", "cache"] as const)(
    "keeps readiness false when %s fails despite a healthy mock",
    async dependency => {
      const mock = await serve((_request, response) =>
        json(response, validBalance)
      );
      isolate(mock);
      expect(await isReady()).toBe(true);
      if (dependency === "database")
        dependencies.execute.mockRejectedValue(new Error(PRIVATE_MARKER));
      else
        dependencies.cacheHealth.mockResolvedValue({
          status: "error",
          redis: { connected: false, error: PRIVATE_MARKER },
        });
      expect(await isReady()).toBe(false);
      expect(dependencies.warn).toHaveBeenCalledWith(
        {
          dependencies: {
            database: dependency === "database" ? "fail" : "pass",
            stripe: "pass",
            cache: dependency === "cache" ? "fail" : "pass",
          },
        },
        "Readiness dependencies are not ready"
      );
      expectPrivate(dependencies.warn.mock.calls);
      expect(mock.requests).toHaveLength(2);
    }
  );

  it("keeps public health redacted through recovery and detailed health admin-only", async () => {
    let available = false;
    const mock = await serve((_request, response) =>
      json(
        response,
        available
          ? validBalance
          : { error: { message: PRIVATE_MARKER + MOCK_KEY } },
        available ? 200 : 503
      )
    );
    isolate(mock);
    const anonymous = await serveHealth();
    const regular = await serveHealth("user");
    const admin = await serveHealth("admin");

    const live = await fetch(anonymous.url + "/api/rest/health/live");
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ alive: true });
    const unavailable = await fetch(anonymous.url + "/api/rest/health/ready");
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({
      code: "SERVICE_UNAVAILABLE",
      message: "Service is not ready",
    });
    const denied = await fetch(anonymous.url + "/api/rest/health");
    expect(denied.status).toBe(401);
    expect(await denied.json()).not.toHaveProperty("checks");
    const forbidden = await fetch(regular.url + "/api/rest/health");
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).not.toHaveProperty("checks");
    const failedDetails = await fetch(admin.url + "/api/rest/health");
    expect(failedDetails.status).toBe(200);
    const failedBody = await failedDetails.json();
    expect(failedBody).toMatchObject({
      status: "unhealthy",
      checks: { stripe: { status: "fail", mode: "mock" } },
    });
    expectPrivate(failedBody, [mock.url]);

    const trpcUnavailable = await fetch(
      anonymous.url + "/api/trpc/health.ready"
    );
    expect(trpcUnavailable.status).toBe(503);
    expectPrivate(await trpcUnavailable.json(), [mock.url]);

    available = true;
    const ready = await fetch(anonymous.url + "/api/rest/health/ready");
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ ready: true });
    const trpcReady = await fetch(anonymous.url + "/api/trpc/health.ready");
    expect(trpcReady.status).toBe(200);
    expect(await trpcReady.json()).toEqual({
      result: { data: { json: { ready: true } } },
    });
    const detail = await fetch(admin.url + "/api/rest/health");
    expect(detail.status).toBe(200);
    const body = await detail.json();
    expect(body).toMatchObject({
      status: "healthy",
      checks: {
        database: { status: "pass" },
        stripe: { status: "pass", mode: "mock" },
        cache: { status: "pass" },
      },
    });
    expectPrivate(body, [mock.url]);
    expectPrivate(dependencies.warn.mock.calls, [mock.url]);
  });
});
