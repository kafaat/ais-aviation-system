import pino, { Logger, LoggerOptions, TransportTargetOptions } from "pino";
import { AsyncLocalStorage } from "async_hooks";

// ============================================================================
// Types and Interfaces
// ============================================================================

export interface LogContext {
  requestId?: string;
  correlationId?: string;
  userId?: number | string;
  userEmail?: string;
  operation?: string;
  service?: string;
  [key: string]: unknown;
}

export interface RequestLogContext {
  requestId: string;
  correlationId: string;
  userId?: number;
  method?: string;
  path?: string;
  ip?: string;
  userAgent?: string;
}

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

// ============================================================================
// Environment Configuration
// ============================================================================

const NODE_ENV = process.env.NODE_ENV || "development";
const LOG_LEVEL =
  (process.env.LOG_LEVEL as LogLevel) ||
  (NODE_ENV === "production" ? "info" : "debug");
const LOG_FORMAT =
  process.env.LOG_FORMAT || (NODE_ENV === "production" ? "json" : "pretty");
const LOG_FILE_PATH = process.env.LOG_FILE_PATH;
const LOG_SERVICE_NAME = process.env.LOG_SERVICE_NAME || "ais-aviation";
const LOG_VERSION = process.env.LOG_VERSION || "1.0.0";

// ============================================================================
// PII Redaction Configuration
// ============================================================================

/**
 * Fields that contain PII and should be redacted
 * Supports nested paths using dot notation
 */
const PII_FIELDS = [
  // Email fields
  "email",
  "userEmail",
  "passengerEmail",
  "contactEmail",
  "*.email",
  "user.email",
  "passenger.email",
  "passengers[*].email",

  // Phone fields
  "phone",
  "phoneNumber",
  "mobile",
  "contactPhone",
  "passengerPhone",
  "*.phone",
  "*.phoneNumber",
  "user.phone",
  "passenger.phone",
  "passengers[*].phone",

  // Card/Payment fields
  "cardNumber",
  "card_number",
  "creditCard",
  "credit_card",
  "cvv",
  "cvc",
  "cardCvv",
  "expiryDate",
  "expiry",
  "cardExpiry",
  "accountNumber",
  "account_number",
  "routingNumber",
  "routing_number",
  "iban",
  "bic",
  "swift",

  // Personal identification
  "ssn",
  "socialSecurityNumber",
  "passportNumber",
  "passport_number",
  "nationalId",
  "national_id",
  "driverLicense",
  "driver_license",
  "idNumber",
  "id_number",

  // Authentication
  "password",
  "passwordHash",
  "token",
  "accessToken",
  "refreshToken",
  "apiKey",
  "api_key",
  "secret",
  "privateKey",
  "private_key",

  // Address (partial redaction)
  "address",
  "streetAddress",
  "street_address",
  "homeAddress",
];

/**
 * Create a deep clone and redact PII from objects
 */
function redactPII(obj: unknown, depth = 0): unknown {
  // Prevent infinite recursion
  if (depth > 10) return "[MAX_DEPTH_EXCEEDED]";

  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return obj;

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => redactPII(item, depth + 1));
  }

  // Handle objects
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();

    // Check if this field should be redacted.
    // Only match if the key exactly equals a PII field name, or if the key
    // contains a PII field name as a substring (e.g. "userEmail" contains "email").
    // We intentionally do NOT check if a PII field name contains the key,
    // because that causes false positives (e.g. key "id" would incorrectly
    // match PII field "idNumber", redacting harmless identifiers).
    const shouldRedact = PII_FIELDS.some(field => {
      const lowerField = field
        .toLowerCase()
        .replace(/\[\*\]/g, "")
        .replace(/\.\*/g, "");
      return lowerKey === lowerField || lowerKey.includes(lowerField);
    });

    if (shouldRedact && typeof value === "string" && value.length > 0) {
      result[key] = redactValue(key, value);
    } else if (typeof value === "object" && value !== null) {
      result[key] = redactPII(value, depth + 1);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Redact a value based on its type
 */
function redactValue(key: string, value: string): string {
  const lowerKey = key.toLowerCase();

  // Email: show first char and domain
  if (lowerKey.includes("email")) {
    const atIndex = value.indexOf("@");
    if (atIndex > 0) {
      return value[0] + "***@" + value.slice(atIndex + 1);
    }
    return "[REDACTED_EMAIL]";
  }

  // Phone: show last 4 digits
  if (lowerKey.includes("phone") || lowerKey.includes("mobile")) {
    const digits = value.replace(/\D/g, "");
    if (digits.length >= 4) {
      return "***" + digits.slice(-4);
    }
    return "[REDACTED_PHONE]";
  }

  // Card number: show last 4 digits
  if (
    lowerKey.includes("card") &&
    !lowerKey.includes("cvv") &&
    !lowerKey.includes("cvc")
  ) {
    const digits = value.replace(/\D/g, "");
    if (digits.length >= 4) {
      return "****-****-****-" + digits.slice(-4);
    }
    return "[REDACTED_CARD]";
  }

  // Default: show partial
  if (value.length > 4) {
    return value.slice(0, 2) + "***" + value.slice(-2);
  }

  return "[REDACTED]";
}

// ============================================================================
// Async Local Storage for Request Context
// ============================================================================

const logContextStorage = new AsyncLocalStorage<LogContext>();

/**
 * Get current log context from AsyncLocalStorage
 */
export function getLogContext(): LogContext {
  return logContextStorage.getStore() || {};
}

/**
 * Set log context for current async context
 */
export function setLogContext(context: LogContext): void {
  logContextStorage.enterWith(context);
}

/**
 * Run function with log context
 */
export function runWithLogContext<T>(context: LogContext, fn: () => T): T {
  return logContextStorage.run(context, fn);
}

/**
 * Merge additional context into current context
 */
export function mergeLogContext(additionalContext: Partial<LogContext>): void {
  const current = getLogContext();
  setLogContext({ ...current, ...additionalContext });
}

// ============================================================================
// Transport Configuration
// ============================================================================

function buildTransportTargets(): TransportTargetOptions[] {
  const targets: TransportTargetOptions[] = [];

  // Console/stdout transport
  if (LOG_FORMAT === "pretty") {
    targets.push({
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
        messageFormat: "{requestId} [{service}] {msg}",
      },
      level: LOG_LEVEL,
    });
  } else {
    // JSON format for production (ELK/CloudWatch compatible)
    targets.push({
      target: "pino/file",
      options: { destination: 1 }, // stdout
      level: LOG_LEVEL,
    });
  }

  // Optional file transport
  if (LOG_FILE_PATH) {
    targets.push({
      target: "pino/file",
      options: {
        destination: LOG_FILE_PATH,
        mkdir: true,
      },
      level: LOG_LEVEL,
    });
  }

  return targets;
}

// ============================================================================
// Logger Factory
// ============================================================================

/**
 * Build logger options for ELK/CloudWatch compatibility
 */
function buildLoggerOptions(): LoggerOptions {
  const targets = buildTransportTargets();

  const options: LoggerOptions = {
    level: LOG_LEVEL,

    // Base fields for every log entry (ELK/CloudWatch compatible)
    base: {
      service: LOG_SERVICE_NAME,
      version: LOG_VERSION,
      env: NODE_ENV,
      pid: process.pid,
    },

    // Format the level as string
    formatters: {
      level: label => ({ level: label }),
      bindings: bindings => ({
        ...bindings,
        hostname: bindings.hostname,
      }),
      log: object => {
        // Add context from AsyncLocalStorage
        const context = getLogContext();

        // Merge and redact PII
        const merged = {
          ...context,
          ...object,
        };

        return redactPII(merged) as Record<string, unknown>;
      },
    },

    // ISO timestamp for ELK compatibility
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,

    // Serializers for common objects
    serializers: {
      err: pino.stdSerializers.err,
      req: req => ({
        method: req.method,
        url: req.url,
        headers: {
          host: req.headers?.host,
          "user-agent": req.headers?.["user-agent"],
          "content-type": req.headers?.["content-type"],
          "x-request-id": req.headers?.["x-request-id"],
          "x-correlation-id": req.headers?.["x-correlation-id"],
        },
        remoteAddress: req.socket?.remoteAddress,
      }),
      res: res => ({
        statusCode: res.statusCode,
        headers: res.getHeaders?.(),
      }),
    },

    // Message key for ELK
    messageKey: "message",

    // Error key for better error handling
    errorKey: "error",
  };

  // Add transport configuration
  if (targets.length > 0) {
    options.transport = targets.length === 1 ? targets[0] : { targets };
  }

  return options;
}

// Create the base logger instance
const baseLogger: Logger = pino(buildLoggerOptions());

// ============================================================================
// Logger Class with Context Support
// ============================================================================

class StructuredLogger {
  private logger: Logger;
  private context: LogContext;

  constructor(logger: Logger, context: LogContext = {}) {
    this.logger = logger;
    this.context = context;
  }

  /**
   * Create a child logger with additional context
   */
  child(context: LogContext): StructuredLogger {
    return new StructuredLogger(this.logger.child(context), {
      ...this.context,
      ...context,
    });
  }

  /**
   * Log at trace level
   */
  trace(msgOrObj: string | Record<string, unknown>, msg?: string): void {
    this.log("trace", msgOrObj, msg);
  }

  /**
   * Log at debug level
   */
  debug(msgOrObj: string | Record<string, unknown>, msg?: string): void {
    this.log("debug", msgOrObj, msg);
  }

  /**
   * Log at info level
   */
  info(msgOrObj: string | Record<string, unknown>, msg?: string): void {
    this.log("info", msgOrObj, msg);
  }

  /**
   * Log at warn level
   */
  warn(msgOrObj: string | Record<string, unknown>, msg?: string): void {
    this.log("warn", msgOrObj, msg);
  }

  /**
   * Log at error level
   */
  error(
    msgOrObj: string | Record<string, unknown> | Error,
    msg?: string
  ): void {
    if (msgOrObj instanceof Error) {
      this.logger.error(
        {
          ...this.context,
          ...getLogContext(),
          error: {
            name: msgOrObj.name,
            message: msgOrObj.message,
            stack: msgOrObj.stack,
          },
        },
        msg || msgOrObj.message
      );
    } else {
      this.log("error", msgOrObj, msg);
    }
  }

  /**
   * Log at fatal level
   */
  fatal(
    msgOrObj: string | Record<string, unknown> | Error,
    msg?: string
  ): void {
    if (msgOrObj instanceof Error) {
      this.logger.fatal(
        {
          ...this.context,
          ...getLogContext(),
          error: {
            name: msgOrObj.name,
            message: msgOrObj.message,
            stack: msgOrObj.stack,
          },
        },
        msg || msgOrObj.message
      );
    } else {
      this.log("fatal", msgOrObj, msg);
    }
  }

  /**
   * Internal log method
   */
  private log(
    level: LogLevel,
    msgOrObj: string | Record<string, unknown>,
    msg?: string
  ): void {
    const asyncContext = getLogContext();

    if (typeof msgOrObj === "string") {
      this.logger[level]({ ...this.context, ...asyncContext }, msgOrObj);
    } else {
      const merged = { ...this.context, ...asyncContext, ...msgOrObj };
      this.logger[level](merged, msg || "");
    }
  }

  /**
   * Flush any buffered logs
   */
  flush(): void {
    this.logger.flush();
  }
}

// ============================================================================
// Main Logger Instance and Factory Functions
// ============================================================================

/**
 * Main logger instance
 */
export const logger = new StructuredLogger(baseLogger);

/**
 * Create a child logger for a specific service/module
 */
export function createServiceLogger(
  service: string,
  context?: LogContext
): StructuredLogger {
  return logger.child({ service, ...context });
}

/**
 * Create a request-scoped logger
 */
export function createRequestLogger(
  requestId: string,
  method: string,
  path: string,
  additionalContext?: Partial<RequestLogContext>
): StructuredLogger {
  return logger.child({
    requestId,
    method,
    path,
    ...additionalContext,
  });
}

/**
 * Create a logger for background jobs
 */
export function createJobLogger(
  jobName: string,
  jobId?: string
): StructuredLogger {
  return logger.child({
    service: "job",
    jobName,
    jobId,
  });
}

/**
 * Create a logger for queue workers
 */
export function createWorkerLogger(
  workerName: string,
  queueName: string
): StructuredLogger {
  return logger.child({
    service: "worker",
    workerName,
    queueName,
  });
}

// ============================================================================
// Convenience Functions (for backward compatibility and ease of use)
// ============================================================================

/**
 * Log an error with full context
 */
export function logError(error: Error, context?: LogContext): void {
  const combinedContext = { ...getLogContext(), ...context };
  logger.error(
    {
      ...combinedContext,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
    },
    error.message
  );
}

/**
 * Log info with context
 */
export function logInfo(message: string, context?: LogContext): void {
  logger.info({ ...getLogContext(), ...context }, message);
}

/**
 * Log warning with context
 */
export function logWarning(message: string, context?: LogContext): void {
  logger.warn({ ...getLogContext(), ...context }, message);
}

/**
 * Log debug with context
 */
export function logDebug(message: string, context?: LogContext): void {
  logger.debug({ ...getLogContext(), ...context }, message);
}

// ============================================================================
// Express Middleware
// ============================================================================

/**
 * Express middleware for request logging and context
 */
export function loggerMiddleware(req: any, res: any, next: any): void {
  const requestId =
    (req.headers["x-request-id"] as string) || req.id || generateRequestId();

  const correlationId =
    (req.headers["x-correlation-id"] as string) ||
    req.correlationId ||
    requestId;

  // Set context for this request
  const context: LogContext = {
    requestId,
    correlationId,
    method: req.method,
    path: req.path || req.url,
    ip: req.ip || req.connection?.remoteAddress,
    userAgent: req.headers["user-agent"],
  };

  // Create request-scoped logger
  const requestLogger = createRequestLogger(
    requestId,
    req.method,
    req.path || req.url,
    {
      correlationId,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    }
  );

  // Attach to request object
  req.requestId = requestId;
  req.correlationId = correlationId;
  req.log = requestLogger;

  // Set response headers
  res.setHeader("X-Request-ID", requestId);
  res.setHeader("X-Correlation-ID", correlationId);

  // Track request timing
  const startTime = process.hrtime.bigint();

  // Log request start
  requestLogger.info(
    {
      event: "request_start",
      query: req.query,
      contentLength: req.headers["content-length"],
    },
    `${req.method} ${req.path || req.url} - Request started`
  );

  // Run rest of request within log context
  runWithLogContext(context, () => {
    // Log response when finished
    res.on("finish", () => {
      const durationNs = Number(process.hrtime.bigint() - startTime);
      const durationMs = Math.round(durationNs / 1_000_000);

      const logData = {
        event: "request_end",
        statusCode: res.statusCode,
        durationMs,
        contentLength: res.getHeader("content-length"),
      };

      // Use appropriate log level based on status code
      if (res.statusCode >= 500) {
        requestLogger.error(
          logData,
          `${req.method} ${req.path || req.url} - ${res.statusCode} (${durationMs}ms)`
        );
      } else if (res.statusCode >= 400) {
        requestLogger.warn(
          logData,
          `${req.method} ${req.path || req.url} - ${res.statusCode} (${durationMs}ms)`
        );
      } else {
        requestLogger.info(
          logData,
          `${req.method} ${req.path || req.url} - ${res.statusCode} (${durationMs}ms)`
        );
      }
    });

    next();
  });
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${randomPart}`;
}

/**
 * Redact PII from a string message
 */
export function redactFromString(message: string): string {
  // Email pattern
  message = message.replace(
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    match => match[0] + "***@" + match.split("@")[1]
  );

  // Phone pattern (various formats) - preserve last 4 digits for identification
  message = message.replace(
    /\b(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?(\d{4})\b/g,
    (_match, _countryCode, last4) => `***-***-${last4}`
  );

  // Card number pattern (16 digits with optional separators) - preserve last 4 digits
  message = message.replace(
    /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?(\d{4})\b/g,
    (_match, last4) => `****-****-****-${last4}`
  );

  return message;
}

/**
 * Create a sanitized object safe for logging
 */
export function sanitize<T extends object>(obj: T): T {
  return redactPII(obj) as T;
}

// ============================================================================
// Exports for Legacy Compatibility
// ============================================================================

// Re-export the base pino logger for advanced use cases
export { baseLogger as pinoLogger };

// Export types
export type { Logger };
