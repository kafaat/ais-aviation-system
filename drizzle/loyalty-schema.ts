import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Loyalty Accounts table
 * Tracks user loyalty program membership and tier
 */
export const loyaltyAccounts = mysqlTable("loyalty_accounts", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),

  // Miles balance
  totalMilesEarned: int("totalMilesEarned").notNull().default(0),
  currentMilesBalance: int("currentMilesBalance").notNull().default(0),
  milesRedeemed: int("milesRedeemed").notNull().default(0),

  // Tier system
  tier: mysqlEnum("tier", ["bronze", "silver", "gold", "platinum"])
    .notNull()
    .default("bronze"),
  tierPoints: int("tierPoints").notNull().default(0), // Points for tier qualification

  // Metadata
  memberSince: timestamp("memberSince").defaultNow().notNull(),
  lastActivityAt: timestamp("lastActivityAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type LoyaltyAccount = typeof loyaltyAccounts.$inferSelect;
export type InsertLoyaltyAccount = typeof loyaltyAccounts.$inferInsert;

/**
 * Miles Transactions table
 * Tracks all miles earning and redemption transactions
 */
export const milesTransactions = mysqlTable("miles_transactions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  loyaltyAccountId: int("loyaltyAccountId").notNull(),

  // Transaction details
  type: mysqlEnum("type", [
    "earn",
    "redeem",
    "expire",
    "bonus",
    "adjustment",
  ]).notNull(),
  amount: int("amount").notNull(), // Positive for earn, negative for redeem
  balanceAfter: int("balanceAfter").notNull(),

  // Related entities
  bookingId: int("bookingId"),
  flightId: int("flightId"),

  // Description
  description: text("description").notNull(),
  reason: text("reason"),

  // Expiry
  expiresAt: timestamp("expiresAt"),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type MilesTransaction = typeof milesTransactions.$inferSelect;
export type InsertMilesTransaction = typeof milesTransactions.$inferInsert;
