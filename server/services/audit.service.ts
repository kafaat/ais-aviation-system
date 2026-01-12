import { nanoid } from "nanoid";
import { db } from "../db";
import { auditLogs, type InsertAuditLog } from "../../drizzle/schema";
import { logger } from "./logger.service";

export type AuditEventType =
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILED"
  | "LOGOUT"
  | "BOOKING_CREATED"
  | "BOOKING_MODIFIED"
  | "BOOKING_CANCELLED"
  | "PAYMENT_INITIATED"
  | "PAYMENT_SUCCESS"
  | "PAYMENT_FAILED"
  | "REFUND_INITIATED"
  | "REFUND_COMPLETED"
  | "USER_ROLE_CHANGED"
  | "USER_CREATED"
  | "FLIGHT_CREATED"
  | "FLIGHT_UPDATED"
  | "FLIGHT_CANCELLED"
  | "PRICE_UPDATED"
  | "ADMIN_ACCESS"
  | "DATA_EXPORT"
  | "SENSITIVE_DATA_ACCESS";

export type AuditEventCategory = 
  | "auth"
  | "booking"
  | "payment"
  | "user_management"
  | "flight_management"
  | "refund"
  | "modification"
  | "access"
  | "system";

export type AuditOutcome = "success" | "failure" | "error";
export type AuditSeverity = "low" | "medium" | "high" | "critical";
export type ActorType = "user" | "admin" | "system" | "api";

export interface AuditLogData {
  eventType: AuditEventType;
  eventCategory: AuditEventCategory;
  outcome: AuditOutcome;
  severity?: AuditSeverity;
  userId?: number;
  userRole?: string;
  actorType?: ActorType;
  sourceIp?: string;
  userAgent?: string;
  requestId?: string;
  resourceType?: string;
  resourceId?: string;
  previousValue?: any;
  newValue?: any;
  changeDescription?: string;
  metadata?: any;
}

/**
 * Create an audit log entry
 */
export async function createAuditLog(data: AuditLogData): Promise<void> {
  try {
    const eventId = nanoid(32);
    
    const auditLogEntry: InsertAuditLog = {
      eventId,
      eventType: data.eventType,
      eventCategory: data.eventCategory,
      outcome: data.outcome,
      severity: data.severity || "low",
      userId: data.userId || null,
      userRole: data.userRole || null,
      actorType: data.actorType || "system",
      sourceIp: data.sourceIp || null,
      userAgent: data.userAgent || null,
      requestId: data.requestId || null,
      resourceType: data.resourceType || null,
      resourceId: data.resourceId || null,
      previousValue: data.previousValue ? JSON.stringify(data.previousValue) : null,
      newValue: data.newValue ? JSON.stringify(data.newValue) : null,
      changeDescription: data.changeDescription || null,
      metadata: data.metadata ? JSON.stringify(data.metadata) : null,
    };

    await db.insert(auditLogs).values(auditLogEntry);

    // Also log to structured logger for immediate monitoring
    logger.info({
      eventId,
      eventType: data.eventType,
      eventCategory: data.eventCategory,
      outcome: data.outcome,
      severity: data.severity || "low",
      userId: data.userId,
      resourceType: data.resourceType,
      resourceId: data.resourceId,
    }, `Audit: ${data.eventType}`);

  } catch (error) {
    // Critical: audit logging should never fail silently
    logger.error({ error, eventType: data.eventType }, "Failed to create audit log");
    // Don't throw - we don't want to break the main operation if audit logging fails
  }
}

/**
 * Helper function to audit login attempts
 */
export async function auditLogin(
  userId: number | null,
  email: string,
  outcome: AuditOutcome,
  sourceIp?: string,
  userAgent?: string,
  requestId?: string
): Promise<void> {
  await createAuditLog({
    eventType: outcome === "success" ? "LOGIN_SUCCESS" : "LOGIN_FAILED",
    eventCategory: "auth",
    outcome,
    severity: outcome === "failure" ? "medium" : "low",
    userId: userId || undefined,
    actorType: "user",
    sourceIp,
    userAgent,
    requestId,
    resourceType: "user",
    resourceId: email,
    changeDescription: outcome === "success" 
      ? `User ${email} logged in successfully`
      : `Failed login attempt for ${email}`,
  });
}

/**
 * Helper function to audit booking changes
 */
export async function auditBookingChange(
  bookingId: number,
  bookingReference: string,
  userId: number,
  userRole: string,
  changeType: "created" | "modified" | "cancelled",
  previousValue?: any,
  newValue?: any,
  sourceIp?: string,
  requestId?: string
): Promise<void> {
  const eventTypeMap = {
    created: "BOOKING_CREATED" as AuditEventType,
    modified: "BOOKING_MODIFIED" as AuditEventType,
    cancelled: "BOOKING_CANCELLED" as AuditEventType,
  };

  await createAuditLog({
    eventType: eventTypeMap[changeType],
    eventCategory: "booking",
    outcome: "success",
    severity: changeType === "cancelled" ? "medium" : "low",
    userId,
    userRole,
    actorType: "user",
    sourceIp,
    requestId,
    resourceType: "booking",
    resourceId: bookingReference,
    previousValue,
    newValue,
    changeDescription: `Booking ${bookingReference} ${changeType}`,
  });
}

/**
 * Helper function to audit payment events
 */
export async function auditPayment(
  bookingId: number,
  bookingReference: string,
  amount: number,
  eventType: "PAYMENT_INITIATED" | "PAYMENT_SUCCESS" | "PAYMENT_FAILED",
  userId: number,
  paymentIntentId?: string,
  sourceIp?: string,
  requestId?: string
): Promise<void> {
  await createAuditLog({
    eventType,
    eventCategory: "payment",
    outcome: eventType === "PAYMENT_SUCCESS" ? "success" : 
             eventType === "PAYMENT_FAILED" ? "failure" : "success",
    severity: eventType === "PAYMENT_FAILED" ? "high" : "medium",
    userId,
    actorType: "user",
    sourceIp,
    requestId,
    resourceType: "payment",
    resourceId: paymentIntentId || bookingReference,
    newValue: { bookingId, bookingReference, amount, paymentIntentId },
    changeDescription: `Payment ${eventType} for booking ${bookingReference}`,
  });
}

/**
 * Helper function to audit role changes
 */
export async function auditRoleChange(
  targetUserId: number,
  targetUserEmail: string,
  adminUserId: number,
  adminRole: string,
  previousRole: string,
  newRole: string,
  sourceIp?: string,
  requestId?: string
): Promise<void> {
  await createAuditLog({
    eventType: "USER_ROLE_CHANGED",
    eventCategory: "user_management",
    outcome: "success",
    severity: "high",
    userId: adminUserId,
    userRole: adminRole,
    actorType: "admin",
    sourceIp,
    requestId,
    resourceType: "user",
    resourceId: targetUserEmail,
    previousValue: { role: previousRole },
    newValue: { role: newRole },
    changeDescription: `User ${targetUserEmail} role changed from ${previousRole} to ${newRole}`,
    metadata: { targetUserId, performedBy: adminUserId },
  });
}

/**
 * Helper function to audit admin access
 */
export async function auditAdminAccess(
  userId: number,
  userRole: string,
  action: string,
  resourceType: string,
  resourceId?: string,
  sourceIp?: string,
  requestId?: string
): Promise<void> {
  await createAuditLog({
    eventType: "ADMIN_ACCESS",
    eventCategory: "access",
    outcome: "success",
    severity: "medium",
    userId,
    userRole,
    actorType: "admin",
    sourceIp,
    requestId,
    resourceType,
    resourceId,
    changeDescription: `Admin ${action} on ${resourceType}${resourceId ? ` (${resourceId})` : ""}`,
  });
}

/**
 * Helper function to audit sensitive data access
 */
export async function auditSensitiveDataAccess(
  userId: number,
  userRole: string,
  dataType: string,
  dataId: string,
  reason: string,
  sourceIp?: string,
  requestId?: string
): Promise<void> {
  await createAuditLog({
    eventType: "SENSITIVE_DATA_ACCESS",
    eventCategory: "access",
    outcome: "success",
    severity: "high",
    userId,
    userRole,
    actorType: userRole.includes("admin") ? "admin" : "user",
    sourceIp,
    requestId,
    resourceType: dataType,
    resourceId: dataId,
    changeDescription: `Accessed ${dataType} (${dataId}): ${reason}`,
  });
}
