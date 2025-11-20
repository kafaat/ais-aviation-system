import { int, mysqlTable, timestamp, varchar, mysqlEnum } from "drizzle-orm/mysql-core";

/**
 * Inventory Locks table
 * Prevents double booking by temporarily locking seats during checkout
 */
export const inventoryLocks = mysqlTable("inventory_locks", {
  id: int("id").autoincrement().primaryKey(),
  
  // Flight and seat info
  flightId: int("flightId").notNull(),
  numberOfSeats: int("numberOfSeats").notNull(),
  cabinClass: mysqlEnum("cabinClass", ["economy", "business"]).notNull(),
  
  // User and session info
  userId: int("userId"),
  sessionId: varchar("sessionId", { length: 64 }).notNull(), // For anonymous users
  
  // Lock status
  status: mysqlEnum("status", ["active", "released", "expired", "converted"]).notNull().default("active"),
  
  // Timing
  lockedAt: timestamp("lockedAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt").notNull(), // Auto-release after 15 minutes
  releasedAt: timestamp("releasedAt"),
  
  // Metadata
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type InventoryLock = typeof inventoryLocks.$inferSelect;
export type InsertInventoryLock = typeof inventoryLocks.$inferInsert;
