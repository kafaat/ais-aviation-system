import { nanoid } from "nanoid";
import { getDb } from "../db";
import {
  auditLogs,
  type InsertAuditLog,
  type AuditLog,
} from "../../drizzle/schema";
import { logger } from "../_core/logger";
import { eq, and, gte, lte, like, desc, sql, or } from "drizzle-orm";

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
  previousValue?: unknown;
  newValue?: unknown;
  changeDescription?: string;
  metadata?: Record<string, unknown>;
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
      previousValue: data.previousValue
        ? JSON.stringify(data.previousValue)
        : null,
      newValue: data.newValue ? JSON.stringify(data.newValue) : null,
      changeDescription: data.changeDescription || null,
      metadata: data.metadata ? JSON.stringify(data.metadata) : null,
    };

    const database = await getDb();
    if (!database) {
      logger.error({}, "Database not available for audit log");
      return;
    }

    await database.insert(auditLogs).values(auditLogEntry);

    // Also log to structured logger for immediate monitoring
    logger.info(
      {
        eventId,
        eventType: data.eventType,
        eventCategory: data.eventCategory,
        outcome: data.outcome,
        severity: data.severity || "low",
        userId: data.userId,
        resourceType: data.resourceType,
        resourceId: data.resourceId,
      },
      `Audit: ${data.eventType}`
    );
  } catch (error) {
    // Critical: audit logging should never fail silently
    logger.error(
      {
        error,
        eventType: data.eventType,
      },
      "Failed to create audit log"
    );
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
    changeDescription:
      outcome === "success"
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
  previousValue?: unknown,
  newValue?: unknown,
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
    outcome:
      eventType === "PAYMENT_SUCCESS"
        ? "success"
        : eventType === "PAYMENT_FAILED"
          ? "failure"
          : "success",
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

/**
 * Helper function to audit refund events
 */
export async function auditRefund(
  bookingId: number,
  bookingReference: string,
  userId: number,
  userRole: string,
  eventType: "REFUND_INITIATED" | "REFUND_COMPLETED",
  amount: number,
  refundId?: string,
  reason?: string,
  sourceIp?: string,
  requestId?: string
): Promise<void> {
  await createAuditLog({
    eventType,
    eventCategory: "refund",
    outcome: "success",
    severity: "high",
    userId,
    userRole,
    actorType: userRole.includes("admin") ? "admin" : "user",
    sourceIp,
    requestId,
    resourceType: "refund",
    resourceId: refundId || bookingReference,
    newValue: { bookingId, bookingReference, amount, refundId, reason },
    changeDescription: `${eventType === "REFUND_INITIATED" ? "Refund initiated" : "Refund completed"} for booking ${bookingReference} - Amount: ${amount}`,
    metadata: { reason },
  });
}

/**
 * Helper function to audit data exports
 */
export async function auditDataExport(
  userId: number,
  userRole: string,
  exportType: string,
  recordCount: number,
  filters?: Record<string, unknown>,
  sourceIp?: string,
  requestId?: string
): Promise<void> {
  await createAuditLog({
    eventType: "DATA_EXPORT",
    eventCategory: "access",
    outcome: "success",
    severity: "medium",
    userId,
    userRole,
    actorType: userRole.includes("admin") ? "admin" : "user",
    sourceIp,
    requestId,
    resourceType: exportType,
    changeDescription: `Exported ${recordCount} ${exportType} records`,
    metadata: { filters, recordCount },
  });
}

/**
 * Helper function to audit flight changes
 */
export async function auditFlightChange(
  flightId: number,
  flightNumber: string,
  userId: number,
  userRole: string,
  changeType: "created" | "updated" | "cancelled",
  previousValue?: unknown,
  newValue?: unknown,
  sourceIp?: string,
  requestId?: string
): Promise<void> {
  const eventTypeMap = {
    created: "FLIGHT_CREATED" as AuditEventType,
    updated: "FLIGHT_UPDATED" as AuditEventType,
    cancelled: "FLIGHT_CANCELLED" as AuditEventType,
  };

  await createAuditLog({
    eventType: eventTypeMap[changeType],
    eventCategory: "flight_management",
    outcome: "success",
    severity: changeType === "cancelled" ? "high" : "medium",
    userId,
    userRole,
    actorType: "admin",
    sourceIp,
    requestId,
    resourceType: "flight",
    resourceId: flightNumber,
    previousValue,
    newValue,
    changeDescription: `Flight ${flightNumber} ${changeType}`,
    metadata: { flightId },
  });
}

/**
 * Helper function to audit user creation
 */
export async function auditUserCreation(
  userId: number,
  email: string,
  role: string,
  createdBy?: number,
  createdByRole?: string,
  sourceIp?: string,
  requestId?: string
): Promise<void> {
  await createAuditLog({
    eventType: "USER_CREATED",
    eventCategory: "user_management",
    outcome: "success",
    severity: "medium",
    userId: createdBy || userId,
    userRole: createdByRole || role,
    actorType: createdBy ? "admin" : "system",
    sourceIp,
    requestId,
    resourceType: "user",
    resourceId: email,
    newValue: { userId, email, role },
    changeDescription: `User ${email} created with role ${role}`,
  });
}

// ============================================================================
// Query Functions for Admin Interface
// ============================================================================

export interface AuditLogQueryParams {
  userId?: number;
  eventType?: string;
  eventCategory?: AuditEventCategory;
  outcome?: AuditOutcome;
  severity?: AuditSeverity;
  resourceType?: string;
  resourceId?: string;
  startDate?: Date;
  endDate?: Date;
  searchTerm?: string;
  limit?: number;
  offset?: number;
}

export interface AuditLogQueryResult {
  logs: AuditLog[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Query audit logs with filters
 */
export async function queryAuditLogs(
  params: AuditLogQueryParams
): Promise<AuditLogQueryResult> {
  const database = await getDb();
  if (!database) {
    throw new Error("Database not available");
  }

  const limit = params.limit || 50;
  const offset = params.offset || 0;

  // Build WHERE conditions
  const conditions = [];

  if (params.userId) {
    conditions.push(eq(auditLogs.userId, params.userId));
  }

  if (params.eventType) {
    conditions.push(eq(auditLogs.eventType, params.eventType));
  }

  if (params.eventCategory) {
    conditions.push(eq(auditLogs.eventCategory, params.eventCategory));
  }

  if (params.outcome) {
    conditions.push(eq(auditLogs.outcome, params.outcome));
  }

  if (params.severity) {
    conditions.push(eq(auditLogs.severity, params.severity));
  }

  if (params.resourceType) {
    conditions.push(eq(auditLogs.resourceType, params.resourceType));
  }

  if (params.resourceId) {
    conditions.push(eq(auditLogs.resourceId, params.resourceId));
  }

  if (params.startDate) {
    conditions.push(gte(auditLogs.timestamp, params.startDate));
  }

  if (params.endDate) {
    conditions.push(lte(auditLogs.timestamp, params.endDate));
  }

  if (params.searchTerm) {
    const searchPattern = `%${params.searchTerm}%`;
    conditions.push(
      or(
        like(auditLogs.eventType, searchPattern),
        like(auditLogs.resourceId, searchPattern),
        like(auditLogs.changeDescription, searchPattern)
      )
    );
  }

  // Execute query with conditions
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [logs, countResult] = await Promise.all([
    database
      .select()
      .from(auditLogs)
      .where(whereClause)
      .orderBy(desc(auditLogs.timestamp))
      .limit(limit)
      .offset(offset),
    database
      .select({ count: sql<number>`COUNT(*)` })
      .from(auditLogs)
      .where(whereClause),
  ]);

  return {
    logs,
    total: Number(countResult[0]?.count || 0),
    limit,
    offset,
  };
}

/**
 * Get audit log by ID
 */
export async function getAuditLogById(id: number): Promise<AuditLog | null> {
  const database = await getDb();
  if (!database) {
    throw new Error("Database not available");
  }

  const result = await database
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.id, id))
    .limit(1);

  return result[0] || null;
}

/**
 * Get audit log by event ID
 */
export async function getAuditLogByEventId(
  eventId: string
): Promise<AuditLog | null> {
  const database = await getDb();
  if (!database) {
    throw new Error("Database not available");
  }

  const result = await database
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.eventId, eventId))
    .limit(1);

  return result[0] || null;
}

/**
 * Get audit logs for a specific resource
 */
export async function getAuditLogsForResource(
  resourceType: string,
  resourceId: string,
  limit = 100
): Promise<AuditLog[]> {
  const database = await getDb();
  if (!database) {
    throw new Error("Database not available");
  }

  return await database
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.resourceType, resourceType),
        eq(auditLogs.resourceId, resourceId)
      )
    )
    .orderBy(desc(auditLogs.timestamp))
    .limit(limit);
}

/**
 * Get audit logs for a specific user
 */
export async function getAuditLogsForUser(
  userId: number,
  limit = 100
): Promise<AuditLog[]> {
  const database = await getDb();
  if (!database) {
    throw new Error("Database not available");
  }

  return await database
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.userId, userId))
    .orderBy(desc(auditLogs.timestamp))
    .limit(limit);
}

/**
 * Get recent high severity audit events
 */
export async function getHighSeverityEvents(limit = 50): Promise<AuditLog[]> {
  const database = await getDb();
  if (!database) {
    throw new Error("Database not available");
  }

  return await database
    .select()
    .from(auditLogs)
    .where(
      or(eq(auditLogs.severity, "high"), eq(auditLogs.severity, "critical"))
    )
    .orderBy(desc(auditLogs.timestamp))
    .limit(limit);
}

/**
 * Get audit log statistics
 */
export async function getAuditLogStats(days = 30): Promise<{
  totalEvents: number;
  eventsByCategory: Record<string, number>;
  eventsByOutcome: Record<string, number>;
  eventsBySeverity: Record<string, number>;
  recentHighSeverityCount: number;
}> {
  const database = await getDb();
  if (!database) {
    throw new Error("Database not available");
  }

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const [
    totalResult,
    categoryResult,
    outcomeResult,
    severityResult,
    highSeverityResult,
  ] = await Promise.all([
    // Total events
    database
      .select({ count: sql<number>`COUNT(*)` })
      .from(auditLogs)
      .where(gte(auditLogs.timestamp, startDate)),

    // Events by category
    database
      .select({
        category: auditLogs.eventCategory,
        count: sql<number>`COUNT(*)`,
      })
      .from(auditLogs)
      .where(gte(auditLogs.timestamp, startDate))
      .groupBy(auditLogs.eventCategory),

    // Events by outcome
    database
      .select({
        outcome: auditLogs.outcome,
        count: sql<number>`COUNT(*)`,
      })
      .from(auditLogs)
      .where(gte(auditLogs.timestamp, startDate))
      .groupBy(auditLogs.outcome),

    // Events by severity
    database
      .select({
        severity: auditLogs.severity,
        count: sql<number>`COUNT(*)`,
      })
      .from(auditLogs)
      .where(gte(auditLogs.timestamp, startDate))
      .groupBy(auditLogs.severity),

    // High severity count
    database
      .select({ count: sql<number>`COUNT(*)` })
      .from(auditLogs)
      .where(
        and(
          gte(auditLogs.timestamp, startDate),
          or(eq(auditLogs.severity, "high"), eq(auditLogs.severity, "critical"))
        )
      ),
  ]);

  const eventsByCategory: Record<string, number> = {};
  for (const row of categoryResult) {
    eventsByCategory[row.category] = Number(row.count);
  }

  const eventsByOutcome: Record<string, number> = {};
  for (const row of outcomeResult) {
    eventsByOutcome[row.outcome] = Number(row.count);
  }

  const eventsBySeverity: Record<string, number> = {};
  for (const row of severityResult) {
    eventsBySeverity[row.severity] = Number(row.count);
  }

  return {
    totalEvents: Number(totalResult[0]?.count || 0),
    eventsByCategory,
    eventsByOutcome,
    eventsBySeverity,
    recentHighSeverityCount: Number(highSeverityResult[0]?.count || 0),
  };
}
