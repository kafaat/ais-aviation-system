import { TRPCError } from "@trpc/server";
import { v4 as uuidv4 } from "uuid";

/**
 * Standard API Error Response
 * Used across all endpoints for consistent error handling
 */
export interface APIError {
  code: ErrorCode;
  message: string;
  correlationId: string;
  retryable: boolean;
  details?: any;
}

/**
 * Standard Error Codes (P0)
 * Machine-readable codes for client-side error handling
 */
export enum ErrorCode {
  // Validation errors
  VALIDATION_ERROR = "VALIDATION_ERROR",
  
  // Authentication & Authorization
  UNAUTHORIZED = "UNAUTHORIZED",
  FORBIDDEN = "FORBIDDEN",
  TOKEN_EXPIRED = "TOKEN_EXPIRED",
  
  // Resource errors
  NOT_FOUND = "NOT_FOUND",
  
  // Rate limiting
  RATE_LIMITED = "RATE_LIMITED",
  
  // Idempotency
  IDEMPOTENCY_IN_PROGRESS = "IDEMPOTENCY_IN_PROGRESS",
  IDEMPOTENCY_CONFLICT = "IDEMPOTENCY_CONFLICT",
  
  // Booking errors
  BOOKING_CONFLICT = "BOOKING_CONFLICT",
  SEATS_UNAVAILABLE = "SEATS_UNAVAILABLE",
  BOOKING_EXPIRED = "BOOKING_EXPIRED",
  INVALID_STATE_TRANSITION = "INVALID_STATE_TRANSITION",
  
  // Payment errors
  PAYMENT_FAILED = "PAYMENT_FAILED",
  PAYMENT_REQUIRED = "PAYMENT_REQUIRED",
  PAYMENT_PROCESSING = "PAYMENT_PROCESSING",
  
  // Provider errors
  PROVIDER_ERROR = "PROVIDER_ERROR",
  PROVIDER_TIMEOUT = "PROVIDER_TIMEOUT",
  
  // Generic errors
  INTERNAL_ERROR = "INTERNAL_ERROR",
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
}

/**
 * Error code to retryable mapping
 */
const RETRYABLE_ERRORS = new Set([
  ErrorCode.RATE_LIMITED,
  ErrorCode.PROVIDER_TIMEOUT,
  ErrorCode.SERVICE_UNAVAILABLE,
  ErrorCode.INTERNAL_ERROR,
]);

/**
 * Map TRPC error codes to our error codes
 */
function mapTRPCCodeToErrorCode(trpcCode: string): ErrorCode {
  switch (trpcCode) {
    case "BAD_REQUEST":
      return ErrorCode.VALIDATION_ERROR;
    case "UNAUTHORIZED":
      return ErrorCode.UNAUTHORIZED;
    case "FORBIDDEN":
      return ErrorCode.FORBIDDEN;
    case "NOT_FOUND":
      return ErrorCode.NOT_FOUND;
    case "TIMEOUT":
      return ErrorCode.PROVIDER_TIMEOUT;
    case "CONFLICT":
      return ErrorCode.BOOKING_CONFLICT;
    case "TOO_MANY_REQUESTS":
      return ErrorCode.RATE_LIMITED;
    case "INTERNAL_SERVER_ERROR":
    default:
      return ErrorCode.INTERNAL_ERROR;
  }
}

/**
 * Create standardized API error
 */
export function createAPIError(
  code: ErrorCode,
  message: string,
  correlationId?: string,
  details?: any
): APIError {
  return {
    code,
    message,
    correlationId: correlationId || uuidv4(),
    retryable: RETRYABLE_ERRORS.has(code),
    details,
  };
}

/**
 * Transform any error to standardized API error
 */
export function transformError(
  error: any,
  correlationId?: string
): APIError {
  const cid = correlationId || uuidv4();

  // Handle our custom API errors
  if (error.code && Object.values(ErrorCode).includes(error.code)) {
    return {
      code: error.code,
      message: error.message,
      correlationId: cid,
      retryable: RETRYABLE_ERRORS.has(error.code),
      details: error.details,
    };
  }

  // Handle TRPC errors
  if (error instanceof TRPCError) {
    const code = mapTRPCCodeToErrorCode(error.code);
    return {
      code,
      message: error.message,
      correlationId: cid,
      retryable: RETRYABLE_ERRORS.has(code),
      details: error.cause,
    };
  }

  // Handle unknown errors
  return {
    code: ErrorCode.INTERNAL_ERROR,
    message: "An unexpected error occurred",
    correlationId: cid,
    retryable: false,
    details: process.env.NODE_ENV === "development" ? error.message : undefined,
  };
}

/**
 * Throw standardized API error
 */
export function throwAPIError(
  code: ErrorCode,
  message: string,
  details?: any
): never {
  const error: any = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

/**
 * Common error creators
 */
export const Errors = {
  validationError: (message: string, details?: any) =>
    throwAPIError(ErrorCode.VALIDATION_ERROR, message, details),

  unauthorized: (message: string = "Unauthorized") =>
    throwAPIError(ErrorCode.UNAUTHORIZED, message),

  forbidden: (message: string = "Access denied") =>
    throwAPIError(ErrorCode.FORBIDDEN, message),

  notFound: (resource: string) =>
    throwAPIError(ErrorCode.NOT_FOUND, `${resource} not found`),

  rateLimited: (message: string = "Too many requests") =>
    throwAPIError(ErrorCode.RATE_LIMITED, message),

  idempotencyInProgress: (message: string = "Request is already being processed") =>
    throwAPIError(ErrorCode.IDEMPOTENCY_IN_PROGRESS, message),

  idempotencyConflict: (message: string = "Idempotency key already used with different payload") =>
    throwAPIError(ErrorCode.IDEMPOTENCY_CONFLICT, message),

  bookingConflict: (message: string) =>
    throwAPIError(ErrorCode.BOOKING_CONFLICT, message),

  seatsUnavailable: (message: string = "No seats available") =>
    throwAPIError(ErrorCode.SEATS_UNAVAILABLE, message),

  bookingExpired: (message: string = "Booking has expired") =>
    throwAPIError(ErrorCode.BOOKING_EXPIRED, message),

  invalidStateTransition: (from: string, to: string) =>
    throwAPIError(
      ErrorCode.INVALID_STATE_TRANSITION,
      `Cannot transition from ${from} to ${to}`
    ),

  paymentFailed: (message: string) =>
    throwAPIError(ErrorCode.PAYMENT_FAILED, message),

  paymentRequired: (message: string = "Payment is required") =>
    throwAPIError(ErrorCode.PAYMENT_REQUIRED, message),

  paymentProcessing: (message: string = "Payment is being processed") =>
    throwAPIError(ErrorCode.PAYMENT_PROCESSING, message),

  providerError: (message: string, details?: any) =>
    throwAPIError(ErrorCode.PROVIDER_ERROR, message, details),

  providerTimeout: (message: string = "Provider request timed out") =>
    throwAPIError(ErrorCode.PROVIDER_TIMEOUT, message),

  internalError: (message: string = "Internal server error") =>
    throwAPIError(ErrorCode.INTERNAL_ERROR, message),

  serviceUnavailable: (message: string = "Service temporarily unavailable") =>
    throwAPIError(ErrorCode.SERVICE_UNAVAILABLE, message),
};

/**
 * Error response formatter for HTTP/REST endpoints
 */
export function formatErrorResponse(error: any, correlationId?: string) {
  const apiError = transformError(error, correlationId);
  
  return {
    error: apiError,
  };
}

/**
 * Get HTTP status code from error code
 */
export function getHTTPStatusFromErrorCode(code: ErrorCode): number {
  switch (code) {
    case ErrorCode.VALIDATION_ERROR:
      return 400;
    case ErrorCode.UNAUTHORIZED:
    case ErrorCode.TOKEN_EXPIRED:
      return 401;
    case ErrorCode.FORBIDDEN:
      return 403;
    case ErrorCode.NOT_FOUND:
      return 404;
    case ErrorCode.BOOKING_CONFLICT:
    case ErrorCode.IDEMPOTENCY_CONFLICT:
      return 409;
    case ErrorCode.RATE_LIMITED:
      return 429;
    case ErrorCode.INTERNAL_ERROR:
    case ErrorCode.PROVIDER_ERROR:
      return 500;
    case ErrorCode.SERVICE_UNAVAILABLE:
    case ErrorCode.PROVIDER_TIMEOUT:
      return 503;
    default:
      return 500;
  }
}
