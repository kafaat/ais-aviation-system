import * as Sentry from "@sentry/node";
import type { Express, Request, Response, NextFunction } from "express";

/**
 * Sentry Configuration and Service
 * Handles server-side error tracking and performance monitoring
 */

interface SentryConfig {
  dsn: string | undefined;
  environment: string;
  release?: string;
  tracesSampleRate?: number;
  profilesSampleRate?: number;
}

/**
 * Initialize Sentry for the server
 * Must be called before any other imports in the main entry point
 */
export function initSentry(app?: Express): void {
  const dsn = process.env.SENTRY_DSN;

  if (!dsn || dsn.includes("your-key") || dsn.includes("your-project")) {
    if (dsn) {
      console.warn(
        "[Sentry] SENTRY_DSN contains a placeholder value. Error tracking is disabled."
      );
    }
    return;
  }

  try {
    const config: SentryConfig = {
      dsn,
      environment: process.env.NODE_ENV || "development",
      release:
        process.env.SENTRY_RELEASE ||
        `ais-aviation-system@${process.env.npm_package_version || "1.0.0"}`,
      tracesSampleRate: parseFloat(
        process.env.SENTRY_TRACES_SAMPLE_RATE || "0.1"
      ),
      profilesSampleRate: parseFloat(
        process.env.SENTRY_PROFILES_SAMPLE_RATE || "0.1"
      ),
    };

    Sentry.init({
      dsn: config.dsn,
      environment: config.environment,
      release: config.release,
      tracesSampleRate: config.tracesSampleRate,
      profilesSampleRate: config.profilesSampleRate,
      // Enable integration for Express
      integrations: [
        // Capture errors from async handlers
        Sentry.captureConsoleIntegration({
          levels: ["error"],
        }),
      ],
      // Filter out certain errors
      beforeSend(event, hint) {
        const error = hint.originalException;

        // Don't send expected errors
        if (error instanceof Error) {
          // Filter out 4xx errors that are expected user errors
          if (
            error.message.includes("UNAUTHORIZED") ||
            error.message.includes("NOT_FOUND")
          ) {
            return null;
          }
        }

        return event;
      },
      // Sanitize sensitive data
      beforeSendTransaction(event) {
        // Remove sensitive headers
        if (event.request?.headers) {
          delete event.request.headers["authorization"];
          delete event.request.headers["cookie"];
        }
        return event;
      },
    });

    console.info(`[Sentry] Initialized for environment: ${config.environment}`);
  } catch (error) {
    console.warn("[Sentry] Failed to initialize:", error);
  }
}

/**
 * Setup Sentry Express error handler
 * Should be called after all routes are registered
 */
export function setupExpressErrorHandler(app: Express): void {
  Sentry.setupExpressErrorHandler(app);
}

/**
 * Sentry error handler middleware
 * Should be added after all other middleware and routes
 */
export function sentryErrorHandler(): (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => void {
  return (err: Error, req: Request, res: Response, next: NextFunction) => {
    // Add request context to the error
    Sentry.withScope(scope => {
      // Add request information
      scope.setExtra("requestId", req.id);
      scope.setExtra("path", req.path);
      scope.setExtra("method", req.method);
      scope.setExtra("query", req.query);

      // Add user information if available
      if ((req as Request & { user?: { id: string; email?: string } }).user) {
        const user = (req as Request & { user: { id: string; email?: string } })
          .user;
        scope.setUser({
          id: user.id,
          email: user.email,
        });
      }

      // Capture the error
      Sentry.captureException(err);
    });

    next(err);
  };
}

/**
 * Capture a custom error manually
 */
export function captureError(
  error: Error,
  context?: Record<string, unknown>
): string {
  return Sentry.captureException(error, {
    extra: context,
  });
}

/**
 * Capture a custom message
 */
export function captureMessage(
  message: string,
  level: Sentry.SeverityLevel = "info",
  context?: Record<string, unknown>
): string {
  return Sentry.captureMessage(message, {
    level,
    extra: context,
  });
}

/**
 * Set user information for error tracking
 */
export function setUser(
  user: { id: string; email?: string; username?: string } | null
): void {
  Sentry.setUser(user);
}

/**
 * Add breadcrumb for debugging
 */
export function addBreadcrumb(breadcrumb: Sentry.Breadcrumb): void {
  Sentry.addBreadcrumb(breadcrumb);
}

/**
 * Create a transaction for performance monitoring
 */
export function startTransaction(
  name: string,
  op: string
): Sentry.Span | undefined {
  return Sentry.startInactiveSpan({
    name,
    op,
  });
}

/**
 * Flush all pending events before shutdown
 */
export async function flushSentry(timeout: number = 2000): Promise<boolean> {
  return Sentry.flush(timeout);
}

/**
 * Check if Sentry is initialized
 */
export function isSentryInitialized(): boolean {
  return !!process.env.SENTRY_DSN;
}

export { Sentry };
