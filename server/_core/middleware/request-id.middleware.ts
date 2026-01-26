import { Request, Response, NextFunction } from "express";
import { nanoid } from "nanoid";

/**
 * Request ID Middleware
 * Generates a unique request ID for each incoming request
 * and attaches it to the request object for logging and tracing
 */

declare global {
  namespace Express {
    interface Request {
      id?: string;
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

  // Generate new ID if not present
  const requestId = existingId || nanoid(16);

  // Attach to request object
  req.id = requestId;

  // Add to response headers for client-side debugging
  res.setHeader("X-Request-ID", requestId);

  next();
}

/**
 * Get request ID from request object
 */
export function getRequestId(req: Request): string {
  return req.id || "unknown";
}
