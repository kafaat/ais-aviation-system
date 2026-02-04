import helmet from "helmet";
import { doubleCsrf } from "csrf-csrf";
import type { Express, Request, Response, NextFunction } from "express";
import { logger } from "../_core/logger";

// CSRF Protection configuration
const { invalidCsrfTokenError, generateToken, doubleCsrfProtection } =
  doubleCsrf({
    getSecret: () =>
      process.env.CSRF_SECRET || "default-csrf-secret-change-in-production",
    cookieName: "__Host-csrf",
    cookieOptions: {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    },
    size: 64,
    ignoredMethods: ["GET", "HEAD", "OPTIONS"],
    getCsrfTokenFromRequest: req => {
      return req.headers["x-csrf-token"] as string;
    },
  });

/**
 * Configure security headers using Helmet
 */
export function configureSecurityHeaders(app: Express): void {
  // Apply helmet with strict security policies
  app.use(
    helmet({
      // Content Security Policy
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: [
            "'self'",
            "'unsafe-inline'",
            "https://fonts.googleapis.com",
          ],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:", "https:", "blob:"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // Needed for React dev
          connectSrc: ["'self'", "https://api.stripe.com"],
          frameSrc: ["'self'", "https://js.stripe.com"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests:
            process.env.NODE_ENV === "production" ? [] : null,
        },
      },
      // Cross-Origin-Embedder-Policy
      crossOriginEmbedderPolicy: false, // Allow embedding for Stripe
      // Cross-Origin-Opener-Policy
      crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
      // Cross-Origin-Resource-Policy
      crossOriginResourcePolicy: { policy: "cross-origin" },
      // DNS Prefetch Control
      dnsPrefetchControl: { allow: false },
      // Frame Options
      frameguard: { action: "deny" },
      // Hide Powered By Header
      hidePoweredBy: true,
      // HTTP Strict Transport Security (HSTS)
      hsts: {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true,
      },
      // IE No Open
      ieNoOpen: true,
      // No Sniff
      noSniff: true,
      // Referrer Policy
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      // X-XSS-Protection
      xssFilter: true,
    })
  );

  logger.info({}, "Security headers configured with Helmet");
}

/**
 * Configure CSRF protection
 */
export function configureCsrfProtection(app: Express): void {
  // Skip CSRF for webhook endpoints
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/stripe/webhook")) {
      return next();
    }
    doubleCsrfProtection(req, res, next);
  });

  // CSRF token generation endpoint
  app.get("/api/csrf-token", (req, res) => {
    const csrfToken = generateToken(req, res);
    res.json({ csrfToken });
  });

  logger.info({}, "CSRF protection configured");
}

/**
 * Configure CORS with strict origin validation
 */
export function configureCORS(app: Express): void {
  const allowedOrigins = [
    process.env.FRONTEND_URL || "http://localhost:3000",
    "http://localhost:5173", // Vite dev server
    process.env.PRODUCTION_URL || "",
  ].filter(Boolean);

  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;

    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS, PATCH"
      );
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-CSRF-Token, X-Request-ID"
      );
      res.setHeader("Access-Control-Max-Age", "86400"); // 24 hours
    }

    // Handle preflight
    if (req.method === "OPTIONS") {
      return res.status(200).end();
    }

    next();
  });

  logger.info({ allowedOrigins }, "CORS configured with allowed origins");
}

/**
 * Configure secure cookie settings
 */
export function getSecureCookieOptions() {
  const isProduction = process.env.NODE_ENV === "production";

  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict" as const,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: "/",
    domain: process.env.COOKIE_DOMAIN || undefined,
  };
}

/**
 * Webhook signature verification for Stripe
 */
export function verifyStripeWebhookSignature(
  payload: string | Buffer,
  signature: string,
  secret: string
): boolean {
  try {
    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
    stripe.webhooks.constructEvent(payload, signature, secret);
    return true;
  } catch (error) {
    logger.error({ error }, "Stripe webhook signature verification failed");
    return false;
  }
}

/**
 * Input sanitization middleware
 */
export function sanitizeInput(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Basic XSS prevention - remove script tags and event handlers
  const sanitize = (obj: any): any => {
    if (typeof obj === "string") {
      return obj
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/on\w+\s*=/gi, "");
    }
    if (typeof obj === "object" && obj !== null) {
      for (const key in obj) {
        obj[key] = sanitize(obj[key]);
      }
    }
    return obj;
  };

  if (req.body) {
    req.body = sanitize(req.body);
  }
  if (req.query) {
    req.query = sanitize(req.query);
  }
  if (req.params) {
    req.params = sanitize(req.params);
  }

  next();
}

/**
 * Request timeout middleware
 */
export function requestTimeout(timeoutMs: number = 30000) {
  return (req: Request, res: Response, next: NextFunction) => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        logger.warn({ path: req.path, method: req.method }, "Request timeout");
        res.status(408).json({ error: "Request timeout" });
      }
    }, timeoutMs);

    res.on("finish", () => clearTimeout(timeout));
    res.on("close", () => clearTimeout(timeout));

    next();
  };
}

/**
 * Security best practices validator
 */
export function validateSecurityConfiguration(): void {
  const issues: string[] = [];

  // Check JWT secret
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    issues.push("JWT_SECRET must be at least 32 characters long");
  }

  // Check CSRF secret
  if (!process.env.CSRF_SECRET && process.env.NODE_ENV === "production") {
    issues.push("CSRF_SECRET must be set in production");
  }

  // Check Stripe webhook secret
  if (
    !process.env.STRIPE_WEBHOOK_SECRET &&
    process.env.NODE_ENV === "production"
  ) {
    issues.push("STRIPE_WEBHOOK_SECRET must be set in production");
  }

  // Check secure cookies
  if (
    process.env.NODE_ENV === "production" &&
    process.env.COOKIE_SECURE !== "true"
  ) {
    issues.push("COOKIE_SECURE should be true in production");
  }

  if (issues.length > 0) {
    logger.warn({ issues }, "Security configuration issues detected");
    if (process.env.NODE_ENV === "production") {
      throw new Error(`Security configuration errors: ${issues.join(", ")}`);
    }
  } else {
    logger.info({}, "Security configuration validated successfully");
  }
}

export { invalidCsrfTokenError, generateToken, doubleCsrfProtection };
