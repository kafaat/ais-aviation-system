import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Flight Status History table
 * Tracks all status changes for flights
 */
export const flightStatusHistory = mysqlTable("flight_status_history", {
  id: int("id").autoincrement().primaryKey(),
  flightId: int("flightId").notNull(),
  oldStatus: mysqlEnum("oldStatus", ["scheduled", "delayed", "cancelled", "completed"]),
  newStatus: mysqlEnum("newStatus", ["scheduled", "delayed", "cancelled", "completed"]).notNull(),
  delayMinutes: int("delayMinutes"),
  reason: text("reason"),
  changedBy: int("changedBy"), // User ID who made the change (admin)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type FlightStatusHistory = typeof flightStatusHistory.$inferSelect;
export type InsertFlightStatusHistory = typeof flightStatusHistory.$inferInsert;
