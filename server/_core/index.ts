import "dotenv/config";
// Initialize Sentry first (before other imports that might throw)
import { initSentry, flushSentry } from "../services/sentry.service";

import express from "express";
import { createServer } from "http";
import net from "net";
import helmet from "helmet";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import swaggerUi from "swagger-ui-express";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { handleStripeWebhook } from "../webhooks/stripe";
import { webhookLimiter } from "./rateLimiter";
import {
  createUserRateLimitMiddleware,
  createStrictRateLimitMiddleware,
} from "./middleware/user-rate-limit.middleware";
import {
  sentryErrorMiddleware,
  errorResponseMiddleware,
} from "./middleware/sentry.middleware";
import {
  apmRequestMiddleware,
  startSystemMetricsCollection,
  stopSystemMetricsCollection,
} from "./middleware/apm.middleware";
import { getPrometheusMetrics } from "../services/apm.service";
import { createServiceLogger } from "./logger";
import { getOpenApiDocument } from "../openapi";

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
  // Initialize Sentry for error tracking
  initSentry();

  // Start APM system metrics collection
  startSystemMetricsCollection(15000);

  const app = express();
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
  app.get("/api/metrics", (_req, res) => {
    res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(getPrometheusMetrics());
  });

  // APM request timing middleware
  app.use(apmRequestMiddleware);

  // Security headers with Helmet
  const isDevelopment = process.env.NODE_ENV === "development";
  app.use(
    helmet({
      // Content Security Policy - disabled in development for Vite HMR compatibility
      contentSecurityPolicy: isDevelopment
        ? false
        : {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: [
                "'self'",
                "https://js.stripe.com",
                // Allow inline scripts for React hydration if needed
                "'unsafe-inline'",
              ],
              styleSrc: [
                "'self'",
                // Required for inline styles in React components and Tailwind
                "'unsafe-inline'",
              ],
              imgSrc: [
                "'self'",
                "data:",
                "blob:",
                "https://*.stripe.com",
                // Allow common CDNs for images
                "https://*.amazonaws.com",
              ],
              fontSrc: ["'self'", "data:"],
              connectSrc: [
                "'self'",
                "https://api.stripe.com",
                // WebSocket connections
                "wss:",
                "ws:",
              ],
              frameSrc: [
                "'self'",
                "https://js.stripe.com",
                "https://hooks.stripe.com",
              ],
              objectSrc: ["'none'"],
              baseUri: ["'self'"],
              formAction: ["'self'"],
              frameAncestors: ["'self'"],
              upgradeInsecureRequests: [],
            },
          },
      // Cross-Origin-Embedder-Policy - set to false to allow Stripe iframe embedding
      crossOriginEmbedderPolicy: false,
      // Cross-Origin-Opener-Policy - allow popups for Stripe payment flows
      crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
      // Cross-Origin-Resource-Policy - allow cross-origin for API responses
      crossOriginResourcePolicy: { policy: "cross-origin" },
      // DNS Prefetch Control - allow DNS prefetching for performance
      dnsPrefetchControl: { allow: true },
      // Expect-CT header (deprecated but still useful for some browsers)
      // Frameguard - X-Frame-Options: SAMEORIGIN (prevents clickjacking)
      frameguard: { action: "sameorigin" },
      // Hide X-Powered-By header
      hidePoweredBy: true,
      // HTTP Strict Transport Security (HSTS)
      hsts: {
        maxAge: 31536000, // 1 year in seconds
        includeSubDomains: true,
        preload: true,
      },
      // IE No Open - X-Download-Options for IE8+
      ieNoOpen: true,
      // No Sniff - X-Content-Type-Options: nosniff
      noSniff: true,
      // Origin Agent Cluster header
      originAgentCluster: true,
      // Permitted Cross-Domain Policies - X-Permitted-Cross-Domain-Policies
      permittedCrossDomainPolicies: { permittedPolicies: "none" },
      // Referrer Policy
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      // X-XSS-Protection (legacy but still useful)
      xssFilter: true,
    })
  );

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);

  // =========================================================================
  // API Documentation (Swagger UI)
  // =========================================================================

  // Serve OpenAPI specification as JSON (lazy generation)
  app.get("/api/openapi.json", async (_req, res) => {
    const doc = await getOpenApiDocument();
    res.setHeader("Content-Type", "application/json");
    res.json(doc);
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

  // OpenAPI REST endpoints - initialized lazily to avoid startup crash
  // from trpc-openapi "Unknown procedure type" error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let restMiddleware: any = null;
  app.use("/api/rest", async (req, res, next) => {
    try {
      if (!restMiddleware) {
        const { createOpenApiExpressMiddleware } = await import("trpc-openapi");
        restMiddleware = createOpenApiExpressMiddleware({
          router: appRouter,
          createContext,
          maxBodySize: 50 * 1024 * 1024,
          responseMeta: undefined,
          onError: ({ error, path }: { error: Error; path: string }) => {
            log.error({ error: error.message, path }, "OpenAPI REST error");
          },
        });
      }
      restMiddleware(req, res, next);
    } catch (error) {
      log.warn(
        { error: error instanceof Error ? error.message : error },
        "OpenAPI REST endpoint error"
      );
      res.status(503).json({
        error: "REST API temporarily unavailable. Use /api/trpc instead.",
      });
    }
  });

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
    })
  );

  // Auth endpoints get stricter rate limiting
  app.use("/api/trpc/auth", createStrictRateLimitMiddleware("auth"));

  // Payment endpoints get stricter rate limiting
  app.use("/api/trpc/payments", createStrictRateLimitMiddleware("payment"));

  // Booking creation gets stricter rate limiting
  app.use("/api/trpc/bookings", createStrictRateLimitMiddleware("booking"));
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

  // Graceful shutdown
  const gracefulShutdown = async (signal: string) => {
    log.info(
      { event: "shutdown_initiated", signal },
      `${signal} received. Starting graceful shutdown...`
    );

    server.close(async () => {
      log.info({ event: "http_server_closed" }, "HTTP server closed.");

      // Stop APM metrics collection
      stopSystemMetricsCollection();
      log.info({ event: "apm_stopped" }, "APM metrics collection stopped.");

      // Flush Sentry events before shutdown
      try {
        await flushSentry(2000);
        log.info({ event: "sentry_flushed" }, "Sentry events flushed.");
      } catch (error) {
        log.error(
          { event: "sentry_flush_error", error },
          "Error flushing Sentry"
        );
      }

      // Close database connections
      try {
        const { getDb } = await import("../db.js");
        const db = await getDb();
        if (db) {
          log.info(
            { event: "database_closed" },
            "Database connections closed."
          );
        }
      } catch (error) {
        log.error(
          { event: "database_close_error", error },
          "Error closing database"
        );
      }

      log.info({ event: "shutdown_completed" }, "Graceful shutdown completed.");
      process.exit(0);
    });

    // Force shutdown after 10 seconds
    setTimeout(() => {
      log.error(
        { event: "forced_shutdown" },
        "Forceful shutdown after timeout."
      );
      process.exit(1);
    }, 10000);
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

startServer().catch(error => {
  log.fatal(error, "Server startup failed");
  process.exit(1);
});
