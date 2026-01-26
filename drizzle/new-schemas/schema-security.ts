import {
  mysqlTable,
  int,
  varchar,
  timestamp,
  boolean,
  text,
  index,
} from "drizzle-orm/mysql-core";

/**
 * Login Attempts table
 * Tracks failed login attempts for account security
 */
export const loginAttempts = mysqlTable(
  "login_attempts",
  {
    id: int("id").autoincrement().primaryKey(),

    // User identification
    email: varchar("email", { length: 320 }),
    openId: varchar("openId", { length: 64 }),

    // Attempt details
    ipAddress: varchar("ipAddress", { length: 45 }).notNull(), // IPv6 max length
    userAgent: text("userAgent"),

    // Result
    success: boolean("success").notNull(),
    failureReason: varchar("failureReason", { length: 255 }),

    // Timestamp
    attemptedAt: timestamp("attemptedAt").defaultNow().notNull(),
  },
  table => ({
    emailIdx: index("email_idx").on(table.email),
    openIdIdx: index("open_id_idx").on(table.openId),
    ipAddressIdx: index("ip_address_idx").on(table.ipAddress),
    attemptedAtIdx: index("attempted_at_idx").on(table.attemptedAt),
  })
);

export type LoginAttempt = typeof loginAttempts.$inferSelect;
export type InsertLoginAttempt = typeof loginAttempts.$inferInsert;

/**
 * Account Locks table
 * Tracks locked accounts due to suspicious activity
 */
export const accountLocks = mysqlTable(
  "account_locks",
  {
    id: int("id").autoincrement().primaryKey(),

    // User identification
    userId: int("userId").notNull().unique(),

    // Lock details
    reason: varchar("reason", { length: 255 }).notNull(),
    lockedBy: varchar("lockedBy", { length: 50 }).notNull(), // "system" or admin user ID

    // Lock status
    isActive: boolean("isActive").default(true).notNull(),

    // Unlock details
    unlockedAt: timestamp("unlockedAt"),
    unlockedBy: varchar("unlockedBy", { length: 50 }),

    // Auto-unlock
    autoUnlockAt: timestamp("autoUnlockAt"), // Automatic unlock time

    // Timestamps
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userIdIdx: index("user_id_idx").on(table.userId),
    isActiveIdx: index("is_active_idx").on(table.isActive),
  })
);

export type AccountLock = typeof accountLocks.$inferSelect;
export type InsertAccountLock = typeof accountLocks.$inferInsert;

/**
 * Security Events table
 * Logs security-related events for audit trail
 */
export const securityEvents = mysqlTable(
  "security_events",
  {
    id: int("id").autoincrement().primaryKey(),

    // Event details
    eventType: varchar("eventType", { length: 100 }).notNull(), // e.g., "account_locked", "suspicious_login"
    severity: varchar("severity", { length: 20 }).notNull(), // "low", "medium", "high", "critical"

    // User/IP details
    userId: int("userId"),
    ipAddress: varchar("ipAddress", { length: 45 }),
    userAgent: text("userAgent"),

    // Event data
    description: text("description"),
    metadata: text("metadata"), // JSON string for additional data

    // Action taken
    actionTaken: varchar("actionTaken", { length: 255 }),

    // Timestamp
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    eventTypeIdx: index("event_type_idx").on(table.eventType),
    severityIdx: index("severity_idx").on(table.severity),
    userIdIdx: index("user_id_idx").on(table.userId),
    ipAddressIdx: index("ip_address_idx").on(table.ipAddress),
    createdAtIdx: index("created_at_idx").on(table.createdAt),
  })
);

export type SecurityEvent = typeof securityEvents.$inferSelect;
export type InsertSecurityEvent = typeof securityEvents.$inferInsert;

/**
 * IP Blacklist table
 * Tracks blocked IP addresses
 */
export const ipBlacklist = mysqlTable(
  "ip_blacklist",
  {
    id: int("id").autoincrement().primaryKey(),

    // IP details
    ipAddress: varchar("ipAddress", { length: 45 }).notNull().unique(),

    // Block details
    reason: text("reason").notNull(),
    blockedBy: varchar("blockedBy", { length: 50 }).notNull(), // "system" or admin user ID

    // Block status
    isActive: boolean("isActive").default(true).notNull(),

    // Unblock details
    unblockedAt: timestamp("unblockedAt"),
    unblockedBy: varchar("unblockedBy", { length: 50 }),

    // Auto-unblock
    autoUnblockAt: timestamp("autoUnblockAt"),

    // Timestamps
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    ipAddressIdx: index("ip_address_idx").on(table.ipAddress),
    isActiveIdx: index("is_active_idx").on(table.isActive),
  })
);

export type IpBlacklist = typeof ipBlacklist.$inferSelect;
export type InsertIpBlacklist = typeof ipBlacklist.$inferInsert;
