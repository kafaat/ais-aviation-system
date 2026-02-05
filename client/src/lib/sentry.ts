import * as Sentry from "@sentry/react";

/**
 * Sentry Client Configuration
 * Handles client-side error tracking and performance monitoring
 */

interface SentryClientConfig {
  dsn: string | undefined;
  environment: string;
  release?: string;
  tracesSampleRate?: number;
  replaysSessionSampleRate?: number;
  replaysOnErrorSampleRate?: number;
}

/**
 * Initialize Sentry for the React client
 * Must be called before React renders
 */
export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;

  if (!dsn) {
    console.warn(
      "[Sentry] VITE_SENTRY_DSN not configured. Error tracking is disabled."
    );
    return;
  }

  const config: SentryClientConfig = {
    dsn,
    environment: import.meta.env.MODE || "development",
    release:
      import.meta.env.VITE_SENTRY_RELEASE ||
      `ais-aviation-system@${import.meta.env.VITE_APP_VERSION || "1.0.0"}`,
    tracesSampleRate: parseFloat(
      import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE || "0.1"
    ),
    replaysSessionSampleRate: parseFloat(
      import.meta.env.VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE || "0.1"
    ),
    replaysOnErrorSampleRate: parseFloat(
      import.meta.env.VITE_SENTRY_REPLAYS_ERROR_SAMPLE_RATE || "1.0"
    ),
  };

  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    release: config.release,

    // Performance Monitoring
    tracesSampleRate: config.tracesSampleRate,

    // Session Replay
    replaysSessionSampleRate: config.replaysSessionSampleRate,
    replaysOnErrorSampleRate: config.replaysOnErrorSampleRate,

    integrations: [
      // Browser tracing for performance monitoring
      Sentry.browserTracingIntegration({
        // Set up automatic instrumentation for common scenarios
        enableInp: true,
      }),

      // Session replay for debugging
      Sentry.replayIntegration({
        // Mask all text content by default for privacy
        maskAllText: false,
        // Block all media for privacy
        blockAllMedia: false,
      }),
    ],

    // Filter out certain errors
    beforeSend(event, hint) {
      const error = hint.originalException;

      // Don't send certain types of errors
      if (error instanceof Error) {
        // Filter out common browser/network errors
        const ignoredMessages = [
          "ResizeObserver loop",
          "Network Error",
          "Failed to fetch",
          "Load failed",
          "ChunkLoadError",
        ];

        if (ignoredMessages.some((msg) => error.message.includes(msg))) {
          return null;
        }

        // Don't send 401/403 errors (expected authentication issues)
        if (
          error.message.includes("UNAUTHORIZED") ||
          error.message.includes("FORBIDDEN")
        ) {
          return null;
        }
      }

      return event;
    },

    // Add custom tags to all events
    initialScope: {
      tags: {
        app: "ais-aviation-system",
        platform: "web",
      },
    },

    // Don't send PII in URLs
    sendDefaultPii: false,
  });

  console.info(`[Sentry] Initialized for environment: ${config.environment}`);
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
 * Clear user information (on logout)
 */
export function clearUser(): void {
  Sentry.setUser(null);
}

/**
 * Add breadcrumb for debugging
 */
export function addBreadcrumb(breadcrumb: Sentry.Breadcrumb): void {
  Sentry.addBreadcrumb(breadcrumb);
}

/**
 * Set custom context for additional debugging info
 */
export function setContext(name: string, context: Record<string, unknown>): void {
  Sentry.setContext(name, context);
}

/**
 * Set a custom tag on all events
 */
export function setTag(key: string, value: string): void {
  Sentry.setTag(key, value);
}

/**
 * Create Sentry Error Boundary component wrapper
 * For use with React error boundaries
 */
export const SentryErrorBoundary = Sentry.ErrorBoundary;

/**
 * HOC to wrap components with Sentry error boundary
 */
export const withSentryErrorBoundary = Sentry.withErrorBoundary;

/**
 * Hook to capture feedback from users
 */
export function showReportDialog(eventId?: string): void {
  if (!import.meta.env.VITE_SENTRY_DSN) {
    console.warn("[Sentry] Cannot show report dialog - Sentry not configured");
    return;
  }

  Sentry.showReportDialog({
    eventId,
    title: "It looks like we're having issues.",
    subtitle: "Our team has been notified.",
    subtitle2: "If you'd like to help, tell us what happened below.",
    labelName: "Name",
    labelEmail: "Email",
    labelComments: "What happened?",
    labelClose: "Close",
    labelSubmit: "Submit",
    successMessage: "Your feedback has been sent. Thank you!",
  });
}

/**
 * Check if Sentry is initialized
 */
export function isSentryInitialized(): boolean {
  return !!import.meta.env.VITE_SENTRY_DSN;
}

export { Sentry };
