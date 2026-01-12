import { int, mysqlTable, timestamp, mysqlEnum, text, varchar, index } from "drizzle-orm/mysql-core";

/**
 * Booking Status History table
 * Tracks all status transitions for bookings
 * Implements state machine pattern with audit trail
 */
export const bookingStatusHistory = mysqlTable("booking_status_history", {
  id: int("id").autoincrement().primaryKey(),
  
  // Booking reference
  bookingId: int("bookingId").notNull(),
  
  // State transition
  oldStatus: mysqlEnum("oldStatus", [
    "initiated",
    "reserved", 
    "paid",
    "ticketed",
    "checked_in",
    "boarded",
    "flown",
    "expired",
    "payment_failed",
    "cancelled",
    "refunded",
    "no_show"
  ]),
  newStatus: mysqlEnum("newStatus", [
    "initiated",
    "reserved", 
    "paid",
    "ticketed",
    "checked_in",
    "boarded",
    "flown",
    "expired",
    "payment_failed",
    "cancelled",
    "refunded",
    "no_show"
  ]).notNull(),
  
  // Metadata
  reason: text("reason"), // Reason for transition
  notes: text("notes"), // Additional notes
  
  // Actor tracking
  actorId: int("actorId"), // User who made the change (null for system)
  actorType: mysqlEnum("actorType", ["user", "admin", "system"]).notNull().default("system"),
  actorRole: varchar("actorRole", { length: 50 }), // Role of the actor
  
  // IP and user agent for security
  ipAddress: varchar("ipAddress", { length: 45 }), // IPv6 max length
  userAgent: text("userAgent"),
  
  // Timestamp
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  bookingIdIdx: index("booking_id_idx").on(table.bookingId),
  newStatusIdx: index("new_status_idx").on(table.newStatus),
  actorIdIdx: index("actor_id_idx").on(table.actorId),
  createdAtIdx: index("created_at_idx").on(table.createdAt),
}));

export type BookingStatusHistory = typeof bookingStatusHistory.$inferSelect;
export type InsertBookingStatusHistory = typeof bookingStatusHistory.$inferInsert;

/**
 * Valid state transitions for booking state machine
 * This enforces business rules at the application level
 */
export const VALID_BOOKING_TRANSITIONS: Record<string, string[]> = {
  "initiated": ["reserved", "expired", "cancelled"],
  "reserved": ["paid", "expired", "cancelled"],
  "paid": ["ticketed", "payment_failed", "cancelled"],
  "ticketed": ["checked_in", "cancelled", "no_show"],
  "checked_in": ["boarded", "no_show"],
  "boarded": ["flown"],
  "flown": [], // Terminal state
  "expired": ["reserved"], // Can retry
  "payment_failed": ["reserved", "cancelled"], // Can retry payment
  "cancelled": ["refunded"], // Only if payment was made
  "refunded": [], // Terminal state
  "no_show": [], // Terminal state
};

/**
 * Validates if a status transition is allowed
 */
export function isValidTransition(from: string | null, to: string): boolean {
  // If no previous status (new booking), only "initiated" is valid
  if (!from) {
    return to === "initiated";
  }
  
  const validNextStates = VALID_BOOKING_TRANSITIONS[from] || [];
  return validNextStates.includes(to);
}
