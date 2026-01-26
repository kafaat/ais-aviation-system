import { v4 as uuidv4 } from "uuid";
import { AsyncLocalStorage } from "async_hooks";

/**
 * Correlation ID context storage
 * Uses AsyncLocalStorage to maintain correlation ID across async operations
 */
const correlationStorage = new AsyncLocalStorage<string>();

/**
 * Get current correlation ID from context
 */
export function getCorrelationId(): string {
  return correlationStorage.getStore() || "unknown";
}

/**
 * Set correlation ID for current context
 */
export function setCorrelationId(correlationId: string): void {
  correlationStorage.enterWith(correlationId);
}

/**
 * Run function with correlation ID context
 */
export function runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
  return correlationStorage.run(correlationId, fn);
}

/**
 * Middleware to inject correlation ID
 * For Express/HTTP endpoints
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
}) {
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
