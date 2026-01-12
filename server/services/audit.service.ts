import { nanoid } from "nanoid";
import { getDb } from "../db";
import { auditLogs, CRITICAL_AUDIT_EVENTS } from "../../drizzle/audit-log-schema";

/**
 * Audit Logging Service
 * Provides comprehensive audit trail for compliance and security
 */

export interface AuditLogInput {
  eventType: string;
  eventCategory: "authentication" | "booking" | "payment" | "refund" | "flight_management" | "user_management" | "admin_action" | "data_access";
  outcome: "success" | "failure";
  userId?: number;
  userRole?: string;
  actorType: "user" | "admin" | "system" | "anonymous";
  resourceType?: string;
  resourceId?: string;
  sourceIp?: string;
  userAgent?: string;
  requestPath?: string;
  requestMethod?: string;
  previousValue?: any;
  newValue?: any;
  description?: string;
  errorMessage?: string;
}

/**
 * Create an audit log entry
 */
export async function createAuditLog(input: AuditLogInput): Promise<void> {
  try {
    const eventId = nanoid(32);
    const db = await getDb();
    
    if (!db) {
      console.error("[AUDIT] Database not available, cannot create audit log");
      return;
    }
    
    await db.insert(auditLogs).values({
      eventId,
      eventType: input.eventType,
      eventCategory: input.eventCategory,
      outcome: input.outcome,
      userId: input.userId,
      userRole: input.userRole,
      actorType: input.actorType,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      sourceIp: input.sourceIp,
      userAgent: input.userAgent,
      requestPath: input.requestPath,
      requestMethod: input.requestMethod,
      previousValue: input.previousValue,
      newValue: input.newValue,
      description: input.description,
      errorMessage: input.errorMessage,
    });
    
    // Log critical events to console as well
    if (Object.values(CRITICAL_AUDIT_EVENTS).includes(input.eventType as any)) {
      console.log(`[AUDIT] ${input.eventType} - ${input.outcome} - User: ${input.userId || 'system'} - Resource: ${input.resourceType}:${input.resourceId}`);
    }
  } catch (error) {
    // Never throw on audit log failure - log and continue
    console.error("[AUDIT] Failed to create audit log:", error);
  }
}

/**
 * Log authentication event
 */
export async function logAuthEvent(
  eventType: "LOGIN_SUCCESS" | "LOGIN_FAILURE" | "LOGOUT",
  userId: number | undefined,
  sourceIp?: string,
  userAgent?: string,
  errorMessage?: string
): Promise<void> {
  await createAuditLog({
    eventType,
    eventCategory: "authentication",
    outcome: eventType === "LOGIN_FAILURE" ? "failure" : "success",
    userId,
    actorType: userId ? "user" : "anonymous",
    sourceIp,
    userAgent,
    errorMessage,
    description: `User ${eventType.toLowerCase().replace('_', ' ')}`,
  });
}

/**
 * Log booking event
 */
export async function logBookingEvent(
  eventType: "BOOKING_CREATED" | "BOOKING_MODIFIED" | "BOOKING_CANCELLED" | "BOOKING_STATUS_CHANGED",
  bookingId: number,
  userId: number,
  userRole: string,
  previousValue?: any,
  newValue?: any,
  sourceIp?: string,
  userAgent?: string
): Promise<void> {
  await createAuditLog({
    eventType,
    eventCategory: "booking",
    outcome: "success",
    userId,
    userRole,
    actorType: userRole === "user" ? "user" : "admin",
    resourceType: "booking",
    resourceId: bookingId.toString(),
    previousValue,
    newValue,
    sourceIp,
    userAgent,
    description: `Booking ${eventType.toLowerCase().replace('booking_', '')}`,
  });
}

/**
 * Log payment event
 */
export async function logPaymentEvent(
  eventType: "PAYMENT_INITIATED" | "PAYMENT_SUCCESS" | "PAYMENT_FAILED" | "REFUND_INITIATED" | "REFUND_COMPLETED",
  bookingId: number,
  userId: number,
  amount: number,
  currency: string = "SAR",
  sourceIp?: string,
  userAgent?: string,
  errorMessage?: string
): Promise<void> {
  await createAuditLog({
    eventType,
    eventCategory: eventType.includes("REFUND") ? "refund" : "payment",
    outcome: eventType.includes("FAILED") ? "failure" : "success",
    userId,
    actorType: "user",
    resourceType: "payment",
    resourceId: bookingId.toString(),
    newValue: { amount, currency },
    sourceIp,
    userAgent,
    errorMessage,
    description: `Payment of ${amount} ${currency} ${eventType.toLowerCase()}`,
  });
}

/**
 * Log flight management event
 */
export async function logFlightEvent(
  eventType: "FLIGHT_CREATED" | "FLIGHT_UPDATED" | "FLIGHT_CANCELLED" | "FLIGHT_STATUS_CHANGED" | "PRICE_CHANGED",
  flightId: number,
  userId: number,
  userRole: string,
  previousValue?: any,
  newValue?: any,
  sourceIp?: string,
  userAgent?: string
): Promise<void> {
  await createAuditLog({
    eventType,
    eventCategory: "flight_management",
    outcome: "success",
    userId,
    userRole,
    actorType: "admin",
    resourceType: "flight",
    resourceId: flightId.toString(),
    previousValue,
    newValue,
    sourceIp,
    userAgent,
    description: `Flight ${eventType.toLowerCase().replace('flight_', '')}`,
  });
}

/**
 * Log user management event
 */
export async function logUserEvent(
  eventType: "USER_ROLE_CHANGED" | "USER_DELETED",
  targetUserId: number,
  adminUserId: number,
  adminRole: string,
  previousValue?: any,
  newValue?: any,
  sourceIp?: string,
  userAgent?: string
): Promise<void> {
  await createAuditLog({
    eventType,
    eventCategory: "user_management",
    outcome: "success",
    userId: adminUserId,
    userRole: adminRole,
    actorType: "admin",
    resourceType: "user",
    resourceId: targetUserId.toString(),
    previousValue,
    newValue,
    sourceIp,
    userAgent,
    description: `User ${eventType.toLowerCase().replace('user_', '')}`,
  });
}

/**
 * Log PII access
 */
export async function logPIIAccess(
  userId: number,
  userRole: string,
  resourceType: string,
  resourceId: string,
  sourceIp?: string,
  userAgent?: string
): Promise<void> {
  await createAuditLog({
    eventType: "PII_ACCESSED",
    eventCategory: "data_access",
    outcome: "success",
    userId,
    userRole,
    actorType: "admin",
    resourceType,
    resourceId,
    sourceIp,
    userAgent,
    description: `PII data accessed for ${resourceType} ${resourceId}`,
  });
}
