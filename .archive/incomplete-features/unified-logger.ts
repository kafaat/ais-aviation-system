import pino from "pino";
import { Request } from "express";
import { getRequestId } from "./request-id.middleware";

/**
 * Unified Logger with PII Masking
 * Provides structured logging with automatic PII (Personally Identifiable Information) masking
 */

// PII patterns to mask
const PII_PATTERNS = [
  // Email addresses
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: "[EMAIL]" },
  
  // Phone numbers (various formats)
  { pattern: /\b(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, replacement: "[PHONE]" },
  
  // Credit card numbers (basic pattern)
  { pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, replacement: "[CARD]" },
  
  // Passport numbers (basic pattern)
  { pattern: /\b[A-Z]{1,2}\d{6,9}\b/g, replacement: "[PASSPORT]" },
  
  // Saudi National ID (10 digits)
  { pattern: /\b[12]\d{9}\b/g, replacement: "[NATIONAL_ID]" },
];

// Fields to always mask in objects
const SENSITIVE_FIELDS = [
  "password",
  "passportNumber",
  "nationalId",
  "creditCard",
  "cvv",
  "pin",
  "ssn",
  "taxId",
];

/**
 * Mask PII in string
 */
function maskPII(text: string): string {
  let masked = text;
  
  for (const { pattern, replacement } of PII_PATTERNS) {
    masked = masked.replace(pattern, replacement);
  }
  
  return masked;
}

/**
 * Mask sensitive fields in object
 */
function maskSensitiveFields(obj: any): any {
  if (typeof obj !== "object" || obj === null) {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(maskSensitiveFields);
  }
  
  const masked: any = {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_FIELDS.includes(key.toLowerCase())) {
      masked[key] = "[REDACTED]";
    } else if (typeof value === "string") {
      masked[key] = maskPII(value);
    } else if (typeof value === "object" && value !== null) {
      masked[key] = maskSensitiveFields(value);
    } else {
      masked[key] = value;
    }
  }
  
  return masked;
}

/**
 * Create logger instance
 */
const baseLogger = pino({
  level: process.env.LOG_LEVEL || "info",
  formatters: {
    level: (label) => {
      return { level: label.toUpperCase() };
    },
  },
  transport: process.env.NODE_ENV === "development" ? {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:standard",
      ignore: "pid,hostname",
    },
  } : undefined,
});

/**
 * Logger class with PII masking
 */
class UnifiedLogger {
  private logger: pino.Logger;

  constructor() {
    this.logger = baseLogger;
  }

  /**
   * Create child logger with request context
   */
  forRequest(req: Request): pino.Logger {
    return this.logger.child({
      requestId: getRequestId(req),
      method: req.method,
      path: req.path,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
  }

  /**
   * Log with automatic PII masking
   */
  private logWithMasking(level: "debug" | "info" | "warn" | "error", message: string, data?: any) {
    const maskedMessage = maskPII(message);
    const maskedData = data ? maskSensitiveFields(data) : undefined;

    if (maskedData) {
      this.logger[level](maskedData, maskedMessage);
    } else {
      this.logger[level](maskedMessage);
    }
  }

  debug(message: string, data?: any) {
    this.logWithMasking("debug", message, data);
  }

  info(message: string, data?: any) {
    this.logWithMasking("info", message, data);
  }

  warn(message: string, data?: any) {
    this.logWithMasking("warn", message, data);
  }

  error(message: string, error?: Error | any) {
    const errorData = error instanceof Error ? {
      name: error.name,
      message: error.message,
      stack: error.stack,
    } : error;

    this.logWithMasking("error", message, errorData);
  }

  /**
   * Log HTTP request
   */
  logRequest(req: Request, res: Response, duration: number) {
    this.info("HTTP Request", {
      requestId: getRequestId(req),
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
    });
  }

  /**
   * Log database query
   */
  logQuery(query: string, params?: any[], duration?: number) {
    this.debug("Database Query", {
      query: maskPII(query),
      params: params ? maskSensitiveFields(params) : undefined,
      duration: duration ? `${duration}ms` : undefined,
    });
  }

  /**
   * Log external API call
   */
  logExternalAPI(service: string, endpoint: string, duration?: number, error?: Error) {
    if (error) {
      this.error(`External API Error: ${service}`, {
        service,
        endpoint,
        duration: duration ? `${duration}ms` : undefined,
        error: error.message,
      });
    } else {
      this.info(`External API Call: ${service}`, {
        service,
        endpoint,
        duration: duration ? `${duration}ms` : undefined,
      });
    }
  }

  /**
   * Log authentication event
   */
  logAuth(event: "login" | "logout" | "failed_login", userId?: number, details?: any) {
    this.info(`Auth Event: ${event}`, {
      event,
      userId,
      details: details ? maskSensitiveFields(details) : undefined,
    });
  }

  /**
   * Log payment event
   */
  logPayment(event: string, bookingId: number, amount: number, details?: any) {
    this.info(`Payment Event: ${event}`, {
      event,
      bookingId,
      amount,
      details: details ? maskSensitiveFields(details) : undefined,
    });
  }

  /**
   * Log security event
   */
  logSecurity(event: string, severity: "low" | "medium" | "high" | "critical", details?: any) {
    this.warn(`Security Event: ${event}`, {
      event,
      severity,
      details: details ? maskSensitiveFields(details) : undefined,
    });
  }
}

// Export singleton instance
export const logger = new UnifiedLogger();

// Export for testing
export { maskPII, maskSensitiveFields };
