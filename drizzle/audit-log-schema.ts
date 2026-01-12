import { int, mysqlTable, timestamp, varchar, text, mysqlEnum, json, index } from "drizzle-orm/mysql-core";

/**
 * Audit Log table
 * Comprehensive audit trail for all sensitive operations
 * Implements security best practices for compliance
 */
export const auditLogs = mysqlTable("audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  
  // Event identification
  eventId: varchar("eventId", { length: 64 }).notNull().unique(), // UUID for event tracking
  eventType: varchar("eventType", { length: 100 }).notNull(), // e.g., "BOOKING_CREATED", "PAYMENT_PROCESSED"
  eventCategory: mysqlEnum("eventCategory", [
    "authentication",
    "booking",
    "payment",
    "refund",
    "flight_management",
    "user_management",
    "admin_action",
    "data_access"
  ]).notNull(),
  
  // Outcome
  outcome: mysqlEnum("outcome", ["success", "failure"]).notNull(),
  
  // Actor information
  userId: int("userId"), // null for anonymous/system actions
  userRole: varchar("userRole", { length: 50 }),
  actorType: mysqlEnum("actorType", ["user", "admin", "system", "anonymous"]).notNull(),
  
  // Resource information
  resourceType: varchar("resourceType", { length: 50 }), // e.g., "booking", "flight", "user"
  resourceId: varchar("resourceId", { length: 100 }), // ID of the resource affected
  
  // Request context
  sourceIp: varchar("sourceIp", { length: 45 }), // IPv6 max length
  userAgent: text("userAgent"),
  requestPath: varchar("requestPath", { length: 255 }),
  requestMethod: varchar("requestMethod", { length: 10 }),
  
  // Data changes (for update operations)
  previousValue: json("previousValue"), // State before change
  newValue: json("newValue"), // State after change
  
  // Additional context
  description: text("description"),
  errorMessage: text("errorMessage"), // If outcome is failure
  
  // Timestamp
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  eventTypeIdx: index("event_type_idx").on(table.eventType),
  eventCategoryIdx: index("event_category_idx").on(table.eventCategory),
  userIdIdx: index("user_id_idx").on(table.userId),
  resourceTypeIdx: index("resource_type_idx").on(table.resourceType),
  outcomeIdx: index("outcome_idx").on(table.outcome),
  createdAtIdx: index("created_at_idx").on(table.createdAt),
  // Composite index for common queries
  categoryOutcomeIdx: index("category_outcome_idx").on(table.eventCategory, table.outcome, table.createdAt),
}));

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;

/**
 * Events that must be audited
 */
export const CRITICAL_AUDIT_EVENTS = {
  // Authentication
  LOGIN_SUCCESS: "LOGIN_SUCCESS",
  LOGIN_FAILURE: "LOGIN_FAILURE",
  LOGOUT: "LOGOUT",
  
  // Bookings
  BOOKING_CREATED: "BOOKING_CREATED",
  BOOKING_MODIFIED: "BOOKING_MODIFIED",
  BOOKING_CANCELLED: "BOOKING_CANCELLED",
  BOOKING_STATUS_CHANGED: "BOOKING_STATUS_CHANGED",
  
  // Payments
  PAYMENT_INITIATED: "PAYMENT_INITIATED",
  PAYMENT_SUCCESS: "PAYMENT_SUCCESS",
  PAYMENT_FAILED: "PAYMENT_FAILED",
  REFUND_INITIATED: "REFUND_INITIATED",
  REFUND_COMPLETED: "REFUND_COMPLETED",
  
  // Flight Management
  FLIGHT_CREATED: "FLIGHT_CREATED",
  FLIGHT_UPDATED: "FLIGHT_UPDATED",
  FLIGHT_CANCELLED: "FLIGHT_CANCELLED",
  FLIGHT_STATUS_CHANGED: "FLIGHT_STATUS_CHANGED",
  PRICE_CHANGED: "PRICE_CHANGED",
  
  // Admin Actions
  USER_ROLE_CHANGED: "USER_ROLE_CHANGED",
  USER_DELETED: "USER_DELETED",
  ADMIN_ACCESS: "ADMIN_ACCESS",
  
  // Data Access
  PII_ACCESSED: "PII_ACCESSED", // Personally Identifiable Information
  SENSITIVE_DATA_EXPORT: "SENSITIVE_DATA_EXPORT",
} as const;
