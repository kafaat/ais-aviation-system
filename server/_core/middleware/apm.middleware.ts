/**
 * APM Middleware
 * Express middleware for Application Performance Monitoring
 */

import { Request, Response, NextFunction } from "express";
import {
  apmRequestMiddleware,
  startSystemMetricsCollection,
  stopSystemMetricsCollection,
  recordTrpcTiming,
  startTimer,
  type Timer,
} from "../../services/apm.service";

// Re-export the main request middleware
export { apmRequestMiddleware };

// Export system metrics collection controls
export { startSystemMetricsCollection, stopSystemMetricsCollection };

/**
 * Response time header middleware
 * Lightweight alternative to full APM middleware
 * Only adds X-Response-Time header without recording metrics
 */
export function responseTimeMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const start = process.hrtime.bigint();

  // Override res.end to add timing header
  const originalEnd = res.end.bind(res);

  res.end = function(this: Response, ...args: Parameters<Response["end"]>): Response {
    const duration = Number(process.hrtime.bigint() - start) / 1e9;

    if (!res.headersSent) {
      res.setHeader("X-Response-Time", `${(duration * 1000).toFixed(3)}ms`);
    }

    return originalEnd(...args);
  } as Response["end"];

  next();
}

/**
 * tRPC timing wrapper
 * Creates a timing context for tRPC procedures
 */
export interface TrpcTimingContext {
  timer: Timer;
  procedure: string;
  type: "query" | "mutation" | "subscription";
}

/**
 * Start timing a tRPC procedure
 */
export function startTrpcTiming(
  procedure: string,
  type: "query" | "mutation" | "subscription"
): TrpcTimingContext {
  return {
    timer: startTimer(),
    procedure,
    type,
  };
}

/**
 * End timing a tRPC procedure and record metrics
 */
export function endTrpcTiming(context: TrpcTimingContext, success: boolean): void {
  const duration = context.timer.end();
  recordTrpcTiming(context.procedure, context.type, duration, success);
}

/**
 * Express error handler with APM integration
 * Logs errors and records error metrics
 */
export function apmErrorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Log the error
  console.error("[APM Error]", {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    requestId: req.id,
  });

  // Continue to next error handler
  next(err);
}

/**
 * Health check bypass middleware
 * Skips APM for health check endpoints to reduce noise
 */
export function skipApmForHealthChecks(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const healthPaths = ["/health", "/healthz", "/ready", "/live", "/api/health"];

  if (healthPaths.some(path => req.path.startsWith(path))) {
    // Add response time header without full APM
    const start = process.hrtime.bigint();
    const originalEnd = res.end.bind(res);

    res.end = function(this: Response, ...args: Parameters<Response["end"]>): Response {
      const duration = Number(process.hrtime.bigint() - start) / 1e9;
      if (!res.headersSent) {
        res.setHeader("X-Response-Time", `${(duration * 1000).toFixed(3)}ms`);
      }
      return originalEnd(...args);
    } as Response["end"];

    return next();
  }

  // Apply full APM middleware
  apmRequestMiddleware(req, res, next);
}
