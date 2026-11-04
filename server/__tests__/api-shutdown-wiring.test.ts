import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => {
  const middleware = () => {};
  return {
    middleware,
    getDb: vi.fn(() => ({})),
    closePool: vi.fn<() => Promise<void>>(),
    stopSla: vi.fn(),
    stopObservations: vi.fn(),
    stopMetrics: vi.fn(),
    stopTracing: vi.fn(),
    flushSentry: vi.fn(),
    log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), fatal: vi.fn() },
    server: {
      listen: vi.fn((_port: number, ready: () => void) => ready()),
      close: vi.fn((done: (error?: Error) => void) => done()),
    },
  };
});
vi.mock("../db", () => ({
  getDb: fixture.getDb,
  closePool: fixture.closePool,
}));
vi.mock("http", () => ({ createServer: () => fixture.server }));
vi.mock("net", () => ({
  default: {
    createServer: () => ({
      listen: (_port: number, ready: () => void) => ready(),
      close: (done: () => void) => done(),
      on: () => {},
    }),
  },
}));
vi.mock("../_core/logger", () => ({ createServiceLogger: () => fixture.log }));
vi.mock("../services/integration-config.service", () => ({
  assertIntegrationConfiguration: () => {},
}));
vi.mock("../_core/provider-boundary", () => ({
  assertProviderBoundary: () => ({ boundary: "isolated", findings: [] }),
}));
vi.mock("../_core/telemetry", () => ({
  initTracing: () => {},
  stopTracing: fixture.stopTracing,
}));
vi.mock("../services/sentry.service", () => ({
  initSentry: () => {},
  flushSentry: fixture.flushSentry,
}));
vi.mock("../services/operational-observations.service", () => ({
  observeApiResponse: () => {},
  startOperationalObservations: () => {},
  stopOperationalObservations: fixture.stopObservations,
}));
vi.mock("../services/sla-monitoring.service", () => ({
  recordMetric: () => {},
  startSLAMonitoring: () => {},
  stopSLAMonitoring: fixture.stopSla,
}));
vi.mock("../routes/privacy-download", () => ({
  privacyDownload: fixture.middleware,
}));
vi.mock("../routes/operational-integrations", () => ({
  operationalIntegrations: fixture.middleware,
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
  stopSystemMetricsCollection: fixture.stopMetrics,
}));
vi.mock("../services/apm.service", () => ({ getPrometheusMetrics: () => "" }));
vi.mock("../openapi", () => ({ getOpenApiDocument: () => ({}) }));
vi.mock("../_core/rest", () => ({
  createRestMiddleware: () => fixture.middleware,
}));

const signals = new Map<string, () => void>();
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("PORT", "0");
  signals.clear();
  const on = process.on.bind(process);
  vi.spyOn(process, "on").mockImplementation((event, listener) => {
    if (event === "SIGTERM" || event === "SIGINT") {
      signals.set(event, listener);
      return process;
    }
    return on(event, listener);
  });
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("API entry point shutdown wiring", () => {
  it.each(["SIGTERM", "SIGINT"])(
    "%s closes the existing pool exactly once before successful exit",
    async signal => {
      let release!: () => void;
      fixture.closePool.mockImplementation(
        () =>
          new Promise(resolve => {
            release = resolve;
          })
      );
      await import("../_core/index");
      await vi.waitFor(() => expect(signals.size).toBe(2));
      signals.get(signal)!();
      signals.get(signal === "SIGTERM" ? "SIGINT" : "SIGTERM")!();
      await vi.waitFor(() =>
        expect(fixture.closePool).toHaveBeenCalledTimes(1)
      );
      expect(fixture.getDb).not.toHaveBeenCalled();
      expect(fixture.server.close).toHaveBeenCalledTimes(1);
      expect(fixture.stopSla).toHaveBeenCalledTimes(1);
      expect(fixture.stopObservations).toHaveBeenCalledTimes(1);
      expect(process.exit).not.toHaveBeenCalled();
      release();
      await vi.waitFor(() =>
        expect(process.exit).toHaveBeenCalledExactlyOnceWith(0)
      );
      expect(fixture.log.info).toHaveBeenCalledWith(
        { event: "database_closed" },
        expect.any(String)
      );
      expect(vi.getTimerCount()).toBe(0);
    }
  );
});
