import { mysqlTable, int, varchar, timestamp, boolean, text, index } from "drizzle-orm/mysql-core";

/**
 * Login Attempts table
 * Tracks all login attempts for security monitoring
 */
export const loginAttempts = mysqlTable("login_attempts", {
  id: int("id").autoincrement().primaryKey(),
  
  // User identification
  email: varchar("email", { length: 320 }),
  openId: varchar("open_id", { length: 64 }),
  
  // Attempt details
  ipAddress: varchar("ip_address", { length: 45 }).notNull(), // IPv6 max length
  userAgent: text("user_agent"),
  
  // Result
  success: boolean("success").notNull(),
  failureReason: varchar("failure_reason", { length: 255 }),
  
  // Timestamp
  attemptedAt: timestamp("attempted_at").defaultNow().notNull(),
}, (table) => ({
  emailIdx: index("login_email_idx").on(table.email),
  openIdIdx: index("login_open_id_idx").on(table.openId),
  ipAddressIdx: index("login_ip_address_idx").on(table.ipAddress),
  attemptedAtIdx: index("login_attempted_at_idx").on(table.attemptedAt),
}));

export type LoginAttempt = typeof loginAttempts.$inferSelect;
export type InsertLoginAttempt = typeof loginAttempts.$inferInsert;

/**
 * Account Locks table
 * Tracks locked accounts due to security violations
 */
export const accountLocks = mysqlTable("account_locks", {
  id: int("id").autoincrement().primaryKey(),
  
  // User identification
  userId: int("user_id").notNull(),
  
  // Lock details
  reason: varchar("reason", { length: 255 }).notNull(),
  lockedBy: varchar("locked_by", { length: 50 }).notNull(), // "system" or admin user ID
  
  // Lock status
  isActive: boolean("is_active").default(true).notNull(),
  
  // Unlock details
  unlockedAt: timestamp("unlocked_at"),
  unlockedBy: varchar("unlocked_by", { length: 50 }),
  
  // Auto-unlock
  autoUnlockAt: timestamp("auto_unlock_at"), // Automatic unlock time
  
  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  userIdIdx: index("lock_user_id_idx").on(table.userId),
  isActiveIdx: index("lock_is_active_idx").on(table.isActive),
}));

export type AccountLock = typeof accountLocks.$inferSelect;
export type InsertAccountLock = typeof accountLocks.$inferInsert;

/**
 * Security Events table
 * Audit trail for security-related events
 */
export const securityEvents = mysqlTable("security_events", {
  id: int("id").autoincrement().primaryKey(),
  
  // Event details
  eventType: varchar("event_type", { length: 100 }).notNull(), // e.g., "account_locked", "suspicious_login"
  severity: varchar("severity", { length: 20 }).notNull(), // "low", "medium", "high", "critical"
  
  // User/IP details
  userId: int("user_id"),
  ipAddress: varchar("ip_address", { length: 45 }),
  userAgent: text("user_agent"),
  
  // Event data
  description: text("description"),
  metadata: text("metadata"), // JSON string for additional data
  
  // Action taken
  actionTaken: varchar("action_taken", { length: 255 }),
  
  // Timestamp
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  eventTypeIdx: index("sec_event_type_idx").on(table.eventType),
  severityIdx: index("sec_severity_idx").on(table.severity),
  userIdIdx: index("sec_user_id_idx").on(table.userId),
  ipAddressIdx: index("sec_ip_address_idx").on(table.ipAddress),
  createdAtIdx: index("sec_created_at_idx").on(table.createdAt),
}));

export type SecurityEvent = typeof securityEvents.$inferSelect;
export type InsertSecurityEvent = typeof securityEvents.$inferInsert;

/**
 * IP Blacklist table
 * Tracks blocked IP addresses
 */
export const ipBlacklist = mysqlTable("ip_blacklist", {
  id: int("id").autoincrement().primaryKey(),
  
  // IP details
  ipAddress: varchar("ip_address", { length: 45 }).notNull().unique(),
  
  // Block details
  reason: text("reason").notNull(),
  blockedBy: varchar("blocked_by", { length: 50 }).notNull(), // "system" or admin user ID
  
  // Block status
  isActive: boolean("is_active").default(true).notNull(),
  
  // Unblock details
  unblockedAt: timestamp("unblocked_at"),
  unblockedBy: varchar("unblocked_by", { length: 50 }),
  
  // Auto-unblock
  autoUnblockAt: timestamp("auto_unblock_at"),
  
  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  ipAddressIdx: index("blacklist_ip_address_idx").on(table.ipAddress),
  isActiveIdx: index("blacklist_is_active_idx").on(table.isActive),
}));

export type IpBlacklist = typeof ipBlacklist.$inferSelect;
export type InsertIpBlacklist = typeof ipBlacklist.$inferInsert;
