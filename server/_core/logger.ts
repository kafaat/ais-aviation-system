import pino from "pino";
import { ENV } from "./env";

/**
 * Unified logging system using Pino
 * Provides structured logging with request context
 */
export const logger = pino({
  level: ENV.isProduction ? "info" : "debug",
  transport: ENV.isProduction
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss Z",
          ignore: "pid,hostname",
        },
      },
  formatters: {
    level: label => {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Create a child logger with request context
 */
export function createRequestLogger(
  requestId: string,
  method: string,
  path: string
) {
  return logger.child({
    requestId,
    method,
    path,
  });
}

/**
 * Log error with full context
 */
export function logError(
  error: Error,
  context?: {
    requestId?: string;
    userId?: number;
    operation?: string;
    [key: string]: any;
  }
) {
  logger.error(
    {
      err: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
      ...context,
    },
    "Error occurred"
  );
}

/**
 * Log info with context
 */
export function logInfo(message: string, context?: Record<string, any>) {
  logger.info(context, message);
}

/**
 * Log warning with context
 */
export function logWarning(message: string, context?: Record<string, any>) {
  logger.warn(context, message);
}

/**
 * Log debug with context (only in development)
 */
export function logDebug(message: string, context?: Record<string, any>) {
  logger.debug(context, message);
}
