import { Request, Response, NextFunction } from "express";
import { nanoid } from "nanoid";
import {
  createRequestLogger,
  setLogContext,
  runWithLogContext,
  type LogContext,
} from "./logger";

/**
 * Request ID Middleware
 * Generates a unique request ID for each incoming request
 * and attaches it to the request object for logging and tracing
 */

declare global {
  namespace Express {
    interface Request {
      id?: string;
      correlationId?: string;
      log?: ReturnType<typeof createRequestLogger>;
    }
  }
}

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Check if request already has an ID (from load balancer or proxy)
  const existingId = req.headers["x-request-id"] as string;
  const existingCorrelationId = req.headers["x-correlation-id"] as string;

  // Generate new ID if not present
  const requestId = existingId || nanoid(16);
  const correlationId = existingCorrelationId || requestId;

  // Attach to request object
  req.id = requestId;
  req.correlationId = correlationId;

  // Add to response headers for client-side debugging
  res.setHeader("X-Request-ID", requestId);
  res.setHeader("X-Correlation-ID", correlationId);

  // Create request-scoped logger
  const requestLogger = createRequestLogger(requestId, req.method, req.path, {
    correlationId,
    ip: req.ip,
    userAgent: req.headers["user-agent"],
  });
  req.log = requestLogger;

  // Set up log context for this request
  const logContext: LogContext = {
    requestId,
    correlationId,
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.headers["user-agent"],
  };

  // Track request timing
  const startTime = process.hrtime.bigint();

  // Log incoming request
  requestLogger.info(
    {
      event: "request_received",
      query: req.query,
      contentLength: req.headers["content-length"],
    },
    `Incoming ${req.method} ${req.path}`
  );

  // Log response when finished
  res.on("finish", () => {
    const durationNs = Number(process.hrtime.bigint() - startTime);
    const durationMs = Math.round(durationNs / 1_000_000);

    const logData = {
      event: "request_completed",
      statusCode: res.statusCode,
      durationMs,
      contentLength: res.getHeader("content-length"),
    };

    // Use appropriate log level based on status code
    if (res.statusCode >= 500) {
      requestLogger.error(logData, `${req.method} ${req.path} - ${res.statusCode} (${durationMs}ms)`);
    } else if (res.statusCode >= 400) {
      requestLogger.warn(logData, `${req.method} ${req.path} - ${res.statusCode} (${durationMs}ms)`);
    } else {
      requestLogger.info(logData, `${req.method} ${req.path} - ${res.statusCode} (${durationMs}ms)`);
    }
  });

  // Run rest of middleware chain within log context
  runWithLogContext(logContext, () => next());
}

/**
 * Get request ID from request object
 */
export function getRequestId(req: Request): string {
  return req.id || "unknown";
}

/**
 * Get correlation ID from request object
 */
export function getCorrelationId(req: Request): string {
  return req.correlationId || req.id || "unknown";
}

/**
 * Get request logger from request object
 */
export function getRequestLogger(req: Request) {
  return req.log;
}
