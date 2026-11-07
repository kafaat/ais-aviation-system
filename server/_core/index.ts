import { assertIntegrationConfiguration } from "../services/integration-config.service";
import { assertProviderBoundary } from "./provider-boundary";
import { timingSafeEqual } from "node:crypto";
import { initTracing, stopTracing } from "./telemetry";
import { privacyDownload } from "../routes/privacy-download";
import {
  observeApiResponse,
  startOperationalObservations,
  stopOperationalObservations,
} from "../services/operational-observations.service";
import { operationalIntegrations } from "../routes/operational-integrations";
import {
  recordMetric,
  startSLAMonitoring,
  stopSLAMonitoring,
} from "../services/sla-monitoring.service";
import "dotenv/config";
// Initialize Sentry first (before other imports that might throw)
import { initSentry, flushSentry } from "../services/sentry.service";

import express from "express";
import { createServer } from "http";
import net from "net";
import { createSecurityHeaders } from "./middleware/security-headers";
import { TRPC_BATCH_LIMIT } from "../../shared/const";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import swaggerUi from "swagger-ui-express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { handleStripeWebhook } from "../webhooks/stripe";
import { webhookLimiter } from "./rateLimiter";
import { createUserRateLimitMiddleware } from "./middleware/user-rate-limit.middleware";
import { blockedIpAdmission } from "./middleware/blocked-ip.middleware";
import {
  sentryErrorMiddleware,
  errorResponseMiddleware,
} from "./middleware/sentry.middleware";
import { requestIdMiddleware } from "./middleware/request-id.middleware";
import { traceMiddleware } from "./trace";
import { requestTimeoutMiddleware } from "./middleware/request-timeout.middleware";
import {
  apmRequestMiddleware,
  startSystemMetricsCollection,
  stopSystemMetricsCollection,
} from "./middleware/apm.middleware";
import { getPrometheusMetrics } from "../services/apm.service";
import { createServiceLogger } from "./logger";
import { getOpenApiDocument } from "../openapi";
import { createRestMiddleware } from "./rest";
import { createReportPreviewRouter } from "../routes/report-preview";
import { REPORT_PREVIEW_PATH } from "../../shared/report-preview";
import { closePool } from "../db";
import { createApiShutdown } from "./api-shutdown";

// Create server-specific logger
const log = createServiceLogger("server");

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  assertIntegrationConfiguration();
  const providerBoundary = assertProviderBoundary();
  log.info(
    { event: "provider_boundary_verified", providerBoundary },
    "Web provider boundary verified"
  );
  initTracing("api");
  // Initialize Sentry for error tracking
  initSentry();

  // Start APM system metrics collection
  startSystemMetricsCollection(15000);

  const app = express();
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  // Configure trusted proxy addresses/CIDRs explicitly; never trust arbitrary headers.
  // Behind a reverse proxy with this unset every client shares the proxy's
  // address, so the per-IP login limiter (5 per 15 min) becomes site-wide.
  if (!process.env.TRUSTED_PROXIES && process.env.NODE_ENV === "production")
    console.warn(
      "[security] TRUSTED_PROXIES is not set: if a reverse proxy fronts this process, every client shares one rate-limit bucket. Set it to the proxy address, CIDR or 'uniquelocal'."
    );
  if (process.env.TRUSTED_PROXIES) {
    app.set(
      "trust proxy",
      process.env.TRUSTED_PROXIES.split(",")
        .map(value => value.trim())
        .filter(Boolean)
    );
  }
  // Admission precedes every API route and development rate-limit bypass.
  app.use("/api", blockedIpAdmission);
  const server = createServer(app);

  // Stripe webhook MUST be registered BEFORE express.json() to preserve raw body
  // Apply rate limiting to webhook endpoint
  app.post(
    "/api/stripe/webhook",
    webhookLimiter,
    express.raw({ type: "application/json" }),
    handleStripeWebhook
  );

  // Prometheus metrics endpoint (before APM middleware to avoid self-tracking)
  // Route labels, memory, CPU and error rates are operational detail;
  // production requires a usable scraper token; local modes may omit it.
  const metricsTokenPattern = /^[A-Za-z0-9._~+/-]+=*$/;
  const usableMetricsToken = (value: string | undefined) =>
    Boolean(
      value &&
        metricsTokenPattern.test(value) &&
        (process.env.NODE_ENV !== "production" || value.length >= 32)
    );
  if (
    process.env.NODE_ENV === "production" &&
    !usableMetricsToken(process.env.METRICS_TOKEN)
  )
    console.warn(
      "[security] METRICS_TOKEN is absent or invalid: /api/metrics is disabled."
    );
  app.get("/api/metrics", (req, res) => {
    const expected = process.env.METRICS_TOKEN;
    if (
      (process.env.NODE_ENV === "production" || expected) &&
      !usableMetricsToken(expected)
    ) {
      res
        .status(503)
        .set("Cache-Control", "no-store")
        .send("Metrics unavailable");
      return;
    }
    if (expected) {
      const presented = /^Bearer[ ]+([A-Za-z0-9._~+/-]+=*)$/i.exec(
        req.headers.authorization ?? ""
      )?.[1];
      if (!presented) {
        res.status(401).set("Cache-Control", "no-store").send("Unauthorized");
        return;
      }
      const a = Buffer.from(presented);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        res.status(401).set("Cache-Control", "no-store").send("Unauthorized");
        return;
      }
    }
    res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(getPrometheusMetrics());
  });

  // APM request timing middleware
  startSLAMonitoring();
  startOperationalObservations();
  app.use((req, res, next) => {
    const start = performance.now();
    res.once("finish", () => {
      if (req.path.startsWith("/api/"))
        observeApiResponse(performance.now() - start, res.statusCode);
      // Local diagnostics; durable fleet observations are exposed through operations.
      recordMetric("api", "uptime", res.statusCode < 500 ? 100 : 0);
      recordMetric("api", "response_time", performance.now() - start);
      recordMetric("api", "error_rate", res.statusCode >= 500 ? 100 : 0);
      recordMetric("api", "throughput", 1);
    });
    next();
  });
  app.use(apmRequestMiddleware);

  // Request ID middleware - generates unique ID for each request
  app.use(requestIdMiddleware);

  // W3C trace context. Mounted before the routers so every handler, service
  // and outbox write below it runs inside the request's trace.
  app.use(traceMiddleware);

  // Request timeout middleware - 30s default for API requests
  app.use("/api", requestTimeoutMiddleware(30_000));

  // Public search has an explicit, optional frame-ancestor policy.
  app.use(createSecurityHeaders());

  // The QUERY pilot keeps the existing API limiter and protected report caller.
  // Register before the general parser so invalid/oversized JSON also receives
  // the endpoint's format-discovery headers and bounded JSON error response.
  app.use(
    "/api/rest",
    createReportPreviewRouter({
      createContext,
      rateLimit: createUserRateLimitMiddleware({
        scope: "api",
        skipInDevelopment: true,
        authenticateUser: true,
      }),
      runReport: (input, ctx) =>
        appRouter.createCaller(ctx).standardReports.run(input),
      onError: error =>
        log.error({ error, path: REPORT_PREVIEW_PATH }, "Report preview error"),
    })
  );

  // No route accepts uploads through these parsers (documents are returned
  // base64, never received), and they run before any rate limiter, so a
  // 50 MB limit let an anonymous client cost a 50 MB JSON parse per request.
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ limit: "1mb", extended: true }));
  app.use("/api", operationalIntegrations);
  // OAuth callback under /api/oauth/callback
  app.get("/api/gdpr/download/:requestId", privacyDownload);
  registerOAuthRoutes(app);

  // =========================================================================
  // API Documentation (Swagger UI)
  // =========================================================================

  // Serve OpenAPI specification as JSON (lazy generation)
  app.get("/api/openapi.json", async (_req, res) => {
    try {
      res.json(await getOpenApiDocument());
    } catch (error) {
      log.error({ error }, "OpenAPI generation failed");
      res.status(503).json({ error: "OpenAPI documentation unavailable" });
    }
  });

  // Swagger UI options
  const swaggerUiOptions: swaggerUi.SwaggerUiOptions = {
    customCss: `
      .swagger-ui .topbar { display: none }
      .swagger-ui .info .title { font-size: 2rem; }
    `,
    customSiteTitle: "AIS Aviation API Documentation",
    customfavIcon: "/favicon.ico",
    swaggerOptions: {
      url: "/api/openapi.json",
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      showExtensions: true,
      showCommonExtensions: true,
      tryItOutEnabled: true,
      defaultModelsExpandDepth: 3,
      defaultModelExpandDepth: 3,
    },
  };

  // Serve Swagger UI at /api/docs (uses url option to fetch spec lazily)
  app.use(
    "/api/docs",
    swaggerUi.serve,
    swaggerUi.setup(null, swaggerUiOptions)
  );

  app.use(
    "/api/rest",
    createUserRateLimitMiddleware({
      scope: "api",
      skipInDevelopment: true,
      authenticateUser: true,
    }),
    createRestMiddleware({
      router: appRouter,
      createContext,
      onError: (error, path) => log.error({ error, path }, "REST error"),
    })
  );

  // Sensitive procedure limits run inside tRPC, including every batch member.

  // tRPC API with per-user rate limiting
  // Uses user ID for authenticated users, IP for anonymous users
  // Different limits based on loyalty tier (bronze, silver, gold, platinum)
  app.use(
    "/api/trpc",
    createUserRateLimitMiddleware({
      scope: "api",
      skipInDevelopment: true,
      authenticateUser: true,
      errorMessage: "Rate limit exceeded. Please try again later.",
    }),
    createExpressMiddleware({
      router: appRouter,
      createContext,
      // The per-user limiter counts one HTTP request; without a cap a single
      // batched request carried hundreds of procedure calls for one unit.
      maxBatchSize: TRPC_BATCH_LIMIT,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // Sentry error handling middleware (must be after routes, before error handler)
  app.use(sentryErrorMiddleware);

  // Final error response handler
  app.use(errorResponseMiddleware);

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    log.info(
      { event: "port_fallback", preferredPort, actualPort: port },
      `Port ${preferredPort} is busy, using port ${port} instead`
    );
  }

  server.listen(port, () => {
    log.info(
      { event: "server_started", port, env: process.env.NODE_ENV },
      `Server running on http://localhost:${port}/`
    );
  });

  const gracefulShutdown = createApiShutdown({
    server,
    log,
    stopSLAMonitoring,
    stopOperationalObservations,
    stopSystemMetricsCollection,
    flushSentry: () => flushSentry(2000),
    stopTracing,
    closePool,
    exit: code => process.exit(code),
  });
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

startServer().catch(error => {
  log.fatal(error, "Server startup failed");
  process.exit(1);
});
