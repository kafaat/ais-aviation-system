import { Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { createRequestLogger } from "./logger";

/**
 * Request ID middleware
 * Generates or extracts X-Request-ID header and attaches logger to request
 */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Get request ID from header or generate new one
  const requestId = (req.headers["x-request-id"] as string) || randomUUID();

  // Set request ID header in response
  res.setHeader("X-Request-ID", requestId);

  // Attach request ID to request object
  (req as any).requestId = requestId;

  // Create request-scoped logger
  const requestLogger = createRequestLogger(requestId, req.method, req.path);
  (req as any).logger = requestLogger;

  // Log incoming request
  requestLogger.info(
    {
      method: req.method,
      path: req.path,
      query: req.query,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    },
    "Incoming request"
  );

  // Log response when finished
  const startTime = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - startTime;
    requestLogger.info(
      {
        statusCode: res.statusCode,
        duration,
      },
      "Request completed"
    );
  });

  next();
}

/**
 * Get request ID from request object
 */
export function getRequestId(req: Request): string {
  return (req as any).requestId || "unknown";
}

/**
 * Get request logger from request object
 */
export function getRequestLogger(req: Request) {
  return (req as any).logger;
}
