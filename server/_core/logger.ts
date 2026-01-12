import pino from "pino";
import { ENV } from "./env";

/**
 * Unified logging system using Pino with PII Masking
 * Provides structured logging with request context and automatic PII protection
 */

// PII patterns to mask (order matters - more specific patterns first)
const PII_PATTERNS = [
  // Saudi National ID (10 digits starting with 1 or 2) - must come before phone number
  { pattern: /\b[12]\d{9}\b/g, replacement: "[NATIONAL_ID]" },
  
  // Email addresses
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: "[EMAIL]" },
  
  // Phone numbers (various formats) - after National ID to avoid conflicts
  { pattern: /\b(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, replacement: "[PHONE]" },
  
  // Credit card numbers (basic pattern)
  { pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, replacement: "[CARD]" },
  
  // Passport numbers (basic pattern)
  { pattern: /\b[A-Z]{1,2}\d{6,9}\b/g, replacement: "[PASSPORT]" },
];

// Fields to always mask in objects
const SENSITIVE_FIELDS = [
  "password",
  "passportnumber",
  "nationalid",
  "creditcard",
  "cvv",
  "pin",
  "ssn",
  "taxid",
  "cardnumber",
  "securitycode",
];

/**
 * Mask PII in string
 */
export function maskPII(text: string): string {
  let masked = text;
  
  for (const { pattern, replacement } of PII_PATTERNS) {
    masked = masked.replace(pattern, replacement);
  }
  
  return masked;
}

/**
 * Mask sensitive fields in object
 */
export function maskSensitiveFields(obj: any): any {
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
    level: (label) => {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Create a child logger with request context
 */
export function createRequestLogger(requestId: string, method: string, path: string) {
  return logger.child({
    requestId,
    method,
    path,
  });
}

/**
 * Log error with full context and PII masking
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
  const maskedContext = context ? maskSensitiveFields(context) : {};
  logger.error(
    {
      err: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
      ...maskedContext,
    },
    "Error occurred"
  );
}

/**
 * Log info with context and PII masking
 */
export function logInfo(message: string, context?: Record<string, any>) {
  const maskedMessage = maskPII(message);
  const maskedContext = context ? maskSensitiveFields(context) : undefined;
  logger.info(maskedContext, maskedMessage);
}

/**
 * Log warning with context and PII masking
 */
export function logWarning(message: string, context?: Record<string, any>) {
  const maskedMessage = maskPII(message);
  const maskedContext = context ? maskSensitiveFields(context) : undefined;
  logger.warn(maskedContext, maskedMessage);
}

/**
 * Log debug with context and PII masking (only in development)
 */
export function logDebug(message: string, context?: Record<string, any>) {
  const maskedMessage = maskPII(message);
  const maskedContext = context ? maskSensitiveFields(context) : undefined;
  logger.debug(maskedContext, maskedMessage);
}

/**
 * Log authentication event
 */
export function logAuth(event: "login" | "logout" | "failed_login", userId?: number, details?: any) {
  const maskedDetails = details ? maskSensitiveFields(details) : undefined;
  logger.info({
    event,
    userId,
    details: maskedDetails,
  }, `Auth Event: ${event}`);
}

/**
 * Log payment event
 */
export function logPayment(event: string, bookingId: number, amount: number, details?: any) {
  const maskedDetails = details ? maskSensitiveFields(details) : undefined;
  logger.info({
    event,
    bookingId,
    amount,
    details: maskedDetails,
  }, `Payment Event: ${event}`);
}

/**
 * Log security event
 */
export function logSecurity(event: string, severity: "low" | "medium" | "high" | "critical", details?: any) {
  const maskedDetails = details ? maskSensitiveFields(details) : undefined;
  logger.warn({
    event,
    severity,
    details: maskedDetails,
  }, `Security Event: ${event}`);
}
