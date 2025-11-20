import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Booking Modification Requests table
 * Tracks all modification requests for bookings
 */
export const bookingModifications = mysqlTable("booking_modifications", {
  id: int("id").autoincrement().primaryKey(),
  bookingId: int("bookingId").notNull(),
  userId: int("userId").notNull(),
  
  // Modification type
  modificationType: mysqlEnum("modificationType", [
    "change_date",
    "upgrade_cabin",
    "change_flight",
    "add_services"
  ]).notNull(),
  
  // Original values
  originalFlightId: int("originalFlightId"),
  originalCabinClass: mysqlEnum("originalCabinClass", ["economy", "business"]),
  originalAmount: int("originalAmount").notNull(), // in cents
  
  // New values
  newFlightId: int("newFlightId"),
  newCabinClass: mysqlEnum("newCabinClass", ["economy", "business"]),
  newAmount: int("newAmount").notNull(), // in cents
  
  // Price difference
  priceDifference: int("priceDifference").notNull(), // positive = pay more, negative = refund
  modificationFee: int("modificationFee").notNull().default(0), // in cents
  totalCost: int("totalCost").notNull(), // priceDifference + modificationFee
  
  // Status
  status: mysqlEnum("status", ["pending", "approved", "rejected", "completed"]).notNull().default("pending"),
  
  // Payment
  stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 255 }),
  paymentStatus: mysqlEnum("paymentStatus", ["pending", "paid", "refunded"]).default("pending"),
  
  // Metadata
  reason: text("reason"),
  adminNotes: text("adminNotes"),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export type BookingModification = typeof bookingModifications.$inferSelect;
export type InsertBookingModification = typeof bookingModifications.$inferInsert;
