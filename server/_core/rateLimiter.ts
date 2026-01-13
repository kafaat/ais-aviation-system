import rateLimit from "express-rate-limit";

/**
 * Rate Limiter Configuration
 * Protects API endpoints from abuse and DDoS attacks
 */

/**
 * General API rate limiter
 * Limits: 100 requests per 15 minutes per IP
 */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  // Skip rate limiting for local development
  skip: req => {
    const isDevelopment = process.env.NODE_ENV !== "production";
    const isLocalhost = req.ip === "127.0.0.1" || req.ip === "::1";
    return isDevelopment && isLocalhost;
  },
});

/**
 * Strict rate limiter for sensitive endpoints
 * Limits: 5 requests per 15 minutes per IP
 * Used for: Login, payment webhooks, etc.
 */
export const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: "Too many attempts from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  skip: req => {
    const isDevelopment = process.env.NODE_ENV !== "production";
    const isLocalhost = req.ip === "127.0.0.1" || req.ip === "::1";
    return isDevelopment && isLocalhost;
  },
});

/**
 * Webhook rate limiter
 * Limits: 50 requests per minute per IP
 * Used for: Stripe webhooks, payment callbacks
 */
export const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 50, // Limit each IP to 50 requests per minute
  message: "Too many webhook requests, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  skip: req => {
    const isDevelopment = process.env.NODE_ENV !== "production";
    const isLocalhost = req.ip === "127.0.0.1" || req.ip === "::1";
    return isDevelopment && isLocalhost;
  },
});

/**
 * Auth rate limiter
 * Limits: 10 login attempts per 15 minutes per IP
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 login attempts per windowMs
  message: "Too many login attempts from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
  skip: req => {
    const isDevelopment = process.env.NODE_ENV !== "production";
    const isLocalhost = req.ip === "127.0.0.1" || req.ip === "::1";
    return isDevelopment && isLocalhost;
  },
});
