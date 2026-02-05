/**
 * Unified Logging System
 *
 * This module re-exports the structured logger from logger.service.ts
 * and provides backward-compatible exports for existing code.
 *
 * Features:
 * - Structured JSON logging (ELK/CloudWatch compatible)
 * - PII redaction for sensitive fields
 * - Request context via AsyncLocalStorage
 * - Log correlation across services
 * - Multiple transports (console, file)
 */

// Re-export everything from the main logger service
export {
  // Main logger instance
  logger,

  // Logger factory functions
  createServiceLogger,
  createRequestLogger,
  createJobLogger,
  createWorkerLogger,

  // Context management
  getLogContext,
  setLogContext,
  runWithLogContext,
  mergeLogContext,

  // Convenience functions (backward compatibility)
  logError,
  logInfo,
  logWarning,
  logDebug,

  // Middleware
  loggerMiddleware,

  // Utility functions
  redactFromString,
  sanitize,

  // Advanced/internal
  pinoLogger,

  // Types
  type LogContext,
  type RequestLogContext,
  type LogLevel,
  type Logger,
} from "../services/logger.service";

// ============================================================================
// Legacy Exports (for backward compatibility with existing code)
// ============================================================================

import {
  logger,
  createRequestLogger as createRequestLoggerNew,
  logError as logErrorNew,
  logInfo as logInfoNew,
  logWarning as logWarningNew,
  logDebug as logDebugNew,
} from "../services/logger.service";

/**
 * @deprecated Use createRequestLogger from logger.service instead
 * Legacy function for backward compatibility
 */
export function createRequestLoggerLegacy(
  requestId: string,
  method: string,
  path: string
) {
  return createRequestLoggerNew(requestId, method, path);
}

/**
 * Get the raw pino logger for advanced use cases
 * @deprecated Use logger.child() or createServiceLogger instead
 */
export function getRawLogger() {
  return logger;
}

// Default export for convenience
export default logger;
