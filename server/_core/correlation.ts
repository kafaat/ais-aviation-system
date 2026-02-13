import { v4 as uuidv4 } from "uuid";
import {
  getLogContext,
  runWithLogContext,
  mergeLogContext,
  type LogContext,
} from "./logger";

/**
 * Correlation ID context management
 *
 * This module provides correlation ID handling that integrates with
 * the unified logging system. Correlation IDs are used to track
 * requests across services and async operations.
 *
 * The correlation ID is stored in the log context (AsyncLocalStorage)
 * and automatically included in all log entries.
 */

/**
 * Get current correlation ID from context
 */
export function getCorrelationId(): string {
  const context = getLogContext();
  return (
    (context.correlationId as string) ||
    (context.requestId as string) ||
    "unknown"
  );
}

/**
 * Set correlation ID for current context
 */
export function setCorrelationId(correlationId: string): void {
  mergeLogContext({ correlationId });
}

/**
 * Run function with correlation ID context
 */
export function runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
  const existingContext = getLogContext();
  return runWithLogContext({ ...existingContext, correlationId }, fn);
}

/**
 * Middleware to inject correlation ID
 * For Express/HTTP endpoints
 *
 * Note: This middleware is typically used together with requestIdMiddleware.
 * The requestIdMiddleware already handles correlation ID, so this
 * middleware is mainly for standalone use or backward compatibility.
 */
export function correlationMiddleware(req: any, res: any, next: any) {
  // Try to get correlation ID from header, or generate new one
  const correlationId =
    req.headers["x-correlation-id"] || req.headers["x-request-id"] || uuidv4();

  // Add to response headers
  res.setHeader("x-correlation-id", correlationId);

  // Add to request object for easy access
  req.correlationId = correlationId;

  // Run the rest of the request within correlation context
  runWithCorrelationId(correlationId, () => next());
}

/**
 * TRPC context with correlation ID
 */
export function createCorrelationContext(opts: {
  req?: any;
  headers?: Record<string, string | string[] | undefined>;
}): { correlationId: string } {
  // Try to get from headers
  const correlationId =
    opts.headers?.["x-correlation-id"] ||
    opts.headers?.["x-request-id"] ||
    opts.req?.headers?.["x-correlation-id"] ||
    opts.req?.headers?.["x-request-id"] ||
    uuidv4();

  // Set in context
  setCorrelationId(correlationId as string);

  return {
    correlationId: correlationId as string,
  };
}

/**
 * Generate a new correlation ID
 */
export function generateCorrelationId(): string {
  return uuidv4();
}

/**
 * Wrap an async function to propagate correlation ID
 */
export function withCorrelation<T extends (...args: any[]) => Promise<any>>(
  fn: T
): T {
  return (async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    const correlationId = getCorrelationId();
    return runWithCorrelationId(correlationId, () => fn(...args));
  }) as T;
}

/**
 * Create a child context with additional data while preserving correlation
 */
export function createChildContext(
  additionalContext: Partial<LogContext>
): LogContext {
  const parentContext = getLogContext();
  return {
    ...parentContext,
    ...additionalContext,
    correlationId: parentContext.correlationId, // Always preserve correlation ID
  };
}

/**
 * Get headers with correlation ID for outgoing HTTP requests
 */
export function getCorrelationHeaders(): Record<string, string> {
  const context = getLogContext();
  return {
    "x-correlation-id": (context.correlationId as string) || getCorrelationId(),
    "x-request-id": (context.requestId as string) || "unknown",
  };
}
