import type { Request, Response, NextFunction } from "express";
import * as Sentry from "@sentry/node";

/**
 * Sentry Error Handler Middleware
 * Captures unhandled errors and sends them to Sentry
 * Should be registered after all routes and before the final error handler
 */
export function sentryErrorMiddleware(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Skip if Sentry is not initialized
  if (!process.env.SENTRY_DSN) {
    next(err);
    return;
  }

  Sentry.withScope(scope => {
    // Set request context
    scope.setTag("transaction_id", req.id || "unknown");
    scope.setTag("path", req.path);
    scope.setTag("method", req.method);

    // Add request details
    // Query values may contain serialized tRPC input, including credentials.
    scope.setExtra("body", sanitizeBody(req.body));
    scope.setExtra("headers", sanitizeHeaders(req.headers));

    // Add user context if available
    const user = (
      req as Request & { user?: { id: string; email?: string; role?: string } }
    ).user;
    if (user) {
      scope.setUser({
        id: user.id,
        email: user.email,
      });
      scope.setTag("user_role", user.role || "user");
    }

    // Set error level based on status code
    const statusCode =
      (err as Error & { statusCode?: number }).statusCode || 500;
    if (statusCode >= 500) {
      scope.setLevel("error");
    } else if (statusCode >= 400) {
      scope.setLevel("warning");
    }

    // Capture the exception
    const eventId = Sentry.captureException(err);

    // Attach event ID to response for debugging
    res.setHeader("X-Sentry-Event-ID", eventId);
  });

  next(err);
}

/**
 * Final error response handler
 * Should be the last middleware in the chain
 */
export function errorResponseMiddleware(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const statusCode = (err as Error & { statusCode?: number }).statusCode || 500;
  const message =
    process.env.NODE_ENV === "production" && statusCode >= 500
      ? "Internal server error"
      : err.message;

  // Don't expose stack traces in production
  const errorResponse: Record<string, unknown> = {
    error: message,
    statusCode,
  };

  if (process.env.NODE_ENV !== "production") {
    errorResponse.stack = err.stack;
  }

  // Include Sentry event ID for support purposes
  const sentryEventId = res.getHeader("X-Sentry-Event-ID");
  if (sentryEventId) {
    errorResponse.eventId = sentryEventId;
  }

  res.status(statusCode).json(errorResponse);
}

/**
 * Sanitize request body to remove sensitive data
 */
function sanitizeBody(body: unknown, depth: number = 0): unknown {
  if (depth > 5) return "[REDACTED]";
  if (!body || typeof body !== "object") {
    return body;
  }

  if (Array.isArray(body)) {
    return body.map(item => sanitizeBody(item, depth + 1));
  }

  const sensitiveKeys = [
    "password",
    "token",
    "secret",
    "apikey",
    "apisecret",
    "authorization",
    "creditcard",
    "cardnumber",
    "mfacode",
    "backupcode",
    "totp",
    "cvv",
    "ssn",
  ];

  const sanitized = { ...body } as Record<string, unknown>;

  for (const key of Object.keys(sanitized)) {
    const lowerKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof sanitized[key] === "object" && sanitized[key] !== null) {
      sanitized[key] = sanitizeBody(sanitized[key], depth + 1);
    }
  }

  return sanitized;
}

/**
 * Sanitize headers to remove sensitive data
 */
function sanitizeHeaders(
  headers: Record<string, unknown>
): Record<string, unknown> {
  const sensitiveHeaders = [
    "authorization",
    "cookie",
    "x-api-key",
    "x-api-secret",
    "x-auth-token",
  ];

  const sanitized = { ...headers };

  for (const header of Object.keys(sanitized)) {
    if (sensitiveHeaders.includes(header.toLowerCase())) {
      sanitized[header] = "[REDACTED]";
    }
  }

  return sanitized;
}
