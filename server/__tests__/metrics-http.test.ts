import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Express, RequestHandler } from "express";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as apm from "../services/apm.service";

const fixture = vi.hoisted(() => ({
  middleware: ((_req, _res, next) => next()) as RequestHandler,
  server: undefined as Server | undefined,
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), fatal: vi.fn() },
}));

// Keep the entry point's Express route and metrics implementation real while
// isolating unrelated providers, background jobs and application routers.
vi.mock("http", async () => {
  const { createServer } =
    await vi.importActual<typeof import("node:http")>("node:http");
  return {
    createServer: (app: Express) => {
      fixture.server = createServer(app);
      return fixture.server;
    },
  };
});
vi.mock("../db", () => ({ closePool: async () => {} }));
vi.mock("../_core/logger", () => ({ createServiceLogger: () => fixture.log }));
vi.mock("../services/integration-config.service", () => ({
  assertIntegrationConfiguration: () => {},
}));
vi.mock("../_core/provider-boundary", () => ({
  assertProviderBoundary: () => ({ boundary: "isolated", findings: [] }),
}));
vi.mock("../_core/telemetry", () => ({
  initTracing: () => {},
  stopTracing: async () => {},
}));
vi.mock("../services/sentry.service", () => ({
  initSentry: () => {},
  flushSentry: async () => {},
}));
vi.mock("../services/operational-observations.service", () => ({
  observeApiResponse: () => {},
  startOperationalObservations: () => {},
  stopOperationalObservations: () => {},
}));
vi.mock("../services/sla-monitoring.service", () => ({
  recordMetric: () => {},
  startSLAMonitoring: () => {},
  stopSLAMonitoring: () => {},
}));
vi.mock("../routes/privacy-download", () => ({
  privacyDownload: fixture.middleware,
}));
vi.mock("../routes/operational-integrations", () => ({
  operationalIntegrations: fixture.middleware,
}));
vi.mock("../routes/report-preview", () => ({
  createReportPreviewRouter: () => fixture.middleware,
}));
vi.mock("../_core/middleware/blocked-ip.middleware", () => ({
  blockedIpAdmission: fixture.middleware,
}));
vi.mock("../_core/middleware/security-headers", () => ({
  createSecurityHeaders: () => fixture.middleware,
}));
vi.mock("@trpc/server/adapters/express", () => ({
  createExpressMiddleware: () => fixture.middleware,
}));
vi.mock("swagger-ui-express", () => ({
  default: { serve: fixture.middleware, setup: () => fixture.middleware },
}));
vi.mock("../_core/oauth", () => ({ registerOAuthRoutes: () => {} }));
vi.mock("../routers", () => ({ appRouter: {} }));
vi.mock("../_core/context", () => ({ createContext: () => ({}) }));
vi.mock("../_core/vite", () => ({
  serveStatic: () => {},
  setupVite: () => {},
}));
vi.mock("../webhooks/stripe", () => ({
  handleStripeWebhook: fixture.middleware,
}));
vi.mock("../_core/rateLimiter", () => ({ webhookLimiter: fixture.middleware }));
vi.mock("../_core/middleware/user-rate-limit.middleware", () => ({
  createUserRateLimitMiddleware: () => fixture.middleware,
}));
vi.mock("../_core/middleware/sentry.middleware", () => ({
  sentryErrorMiddleware: fixture.middleware,
  errorResponseMiddleware: fixture.middleware,
}));
vi.mock("../_core/middleware/request-id.middleware", () => ({
  requestIdMiddleware: fixture.middleware,
}));
vi.mock("../_core/trace", () => ({ traceMiddleware: fixture.middleware }));
vi.mock("../_core/middleware/request-timeout.middleware", () => ({
  requestTimeoutMiddleware: () => fixture.middleware,
}));
vi.mock("../_core/middleware/apm.middleware", () => ({
  apmRequestMiddleware: fixture.middleware,
  startSystemMetricsCollection: () => {},
  stopSystemMetricsCollection: () => {},
}));
vi.mock("../openapi", () => ({ getOpenApiDocument: () => ({}) }));
vi.mock("../_core/rest", () => ({
  createRestMiddleware: () => fixture.middleware,
}));

const token = "ais-metrics-http-fixture-token-2026-secure";
let origin = "";
let metrics: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("METRICS_TOKEN", token);
  vi.stubEnv("TRUSTED_PROXIES", "loopback");
  vi.stubEnv("PORT", "0");
  const on = process.on.bind(process);
  vi.spyOn(process, "on").mockImplementation((event, listener) =>
    event === "SIGTERM" || event === "SIGINT" ? process : on(event, listener)
  );
  metrics = vi.spyOn(apm, "getPrometheusMetrics");
  await import("../_core/index");
  await vi.waitFor(() => expect(fixture.server?.listening).toBe(true));
  origin = `http://127.0.0.1:${(fixture.server!.address() as AddressInfo).port}`;
});
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("METRICS_TOKEN", token);
  metrics.mockClear();
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    fixture.server?.close(error => (error ? reject(error) : resolve()))
  );
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function scrape(authorization?: string) {
  return fetch(`${origin}/api/metrics`, {
    headers: authorization === undefined ? {} : { authorization },
  });
}
function bearer(value: string) {
  return ["Bearer", value].join(" ");
}
async function expectDenied(response: Response, status: number, body: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.text()).toBe(body);
  expect(metrics).not.toHaveBeenCalled();
}
async function expectMetrics(response: Response) {
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe(
    "text/plain; charset=utf-8; version=0.0.4"
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.text()).toContain("# HELP");
  expect(metrics).toHaveBeenCalledOnce();
}

describe("entry point /api/metrics over HTTP", () => {
  it.each([undefined, "", "   ", "invalid token", '"quoted"', "token\n", "A", "a".repeat(31)])(
    "disables production scrapes with unusable configuration %j",
    async configured => {
      vi.stubEnv("METRICS_TOKEN", configured);
      await expectDenied(await scrape(), 503, "Metrics unavailable");
      await expectDenied(
        await scrape(bearer(token)),
        503,
        "Metrics unavailable"
      );
    }
  );

  it.each([
    undefined,
    "",
    token,
    `Basic ${token}`,
    "Bearer",
    `Bearer\t${token}`,
    bearer(`"${token}"`),
    bearer(`${token} extra`),
    bearer("wrong"),
    bearer("metrics-http-fixture-wrong"),
  ])("rejects missing, malformed or wrong authorization %j", async header => {
    await expectDenied(await scrape(header), 401, "Unauthorized");
  });

  it.each(["Bearer", "bearer", "BEARER"])(
    "returns real metrics for a valid %s token",
    async scheme => {
      await expectMetrics(await scrape(`${scheme} ${token}`));
    }
  );

  it("accepts the supported bearer token alphabet and padding", async () => {
    const configured = "AZaz09-._~+/AZaz09-._~+/AZaz09-._~+/==";
    vi.stubEnv("METRICS_TOKEN", configured);
    await expectMetrics(await scrape(bearer(configured)));
  });

  it.each(["development", "test"])(
    "keeps %s convenient without a token but protects configured scrapes",
    async mode => {
      vi.stubEnv("NODE_ENV", mode);
      vi.stubEnv("METRICS_TOKEN", undefined);
      await expectMetrics(await scrape());
      metrics.mockClear();
      vi.stubEnv("METRICS_TOKEN", token);
      await expectDenied(await scrape(), 401, "Unauthorized");
      await expectMetrics(await scrape(bearer(token)));
    }
  );
});
