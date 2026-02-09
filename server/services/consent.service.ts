import { TRPCError } from "@trpc/server";
import { eq, desc, sql, and } from "drizzle-orm";
import { getDb } from "../db";
import {
  int,
  mysqlTable,
  varchar,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/mysql-core";
import { createServiceLogger } from "../_core/logger";

const log = createServiceLogger("consent-service");

// ---------------------------------------------------------------------------
// Schema – defined inline as instructed (not modifying drizzle/schema.ts)
// ---------------------------------------------------------------------------

/**
 * Cookie consent records table.
 * Stores each user's current cookie consent preferences along with metadata
 * for GDPR compliance and audit trail.
 */
export const consentRecords = mysqlTable(
  "consent_records",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId"),
    consentVersion: varchar("consentVersion", { length: 20 }).notNull(),
    essential: boolean("essential").default(true).notNull(),
    analytics: boolean("analytics").default(false).notNull(),
    marketing: boolean("marketing").default(false).notNull(),
    preferences: boolean("preferences").default(false).notNull(),
    ipAddress: varchar("ipAddress", { length: 45 }),
    userAgent: varchar("userAgent", { length: 512 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    userIdIdx: index("consent_records_userId_idx").on(table.userId),
    versionIdx: index("consent_records_version_idx").on(table.consentVersion),
  })
);

export type ConsentRecord = typeof consentRecords.$inferSelect;
export type InsertConsentRecord = typeof consentRecords.$inferInsert;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Bump this value whenever the cookie/privacy policy changes to force re-consent. */
const CURRENT_CONSENT_VERSION = "1.0";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConsentInput {
  essential: boolean;
  analytics: boolean;
  marketing: boolean;
  preferences: boolean;
  consentVersion: string;
}

export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

/**
 * Record a new consent entry.
 * Works for both authenticated and anonymous users (userId may be null).
 * Each call creates a new row to maintain a full audit trail.
 */
export async function recordConsent(
  input: ConsentInput,
  userId: number | null,
  context: RequestContext
): Promise<ConsentRecord> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const record: InsertConsentRecord = {
    userId,
    consentVersion: input.consentVersion || CURRENT_CONSENT_VERSION,
    essential: true, // essential is always true regardless of input
    analytics: input.analytics,
    marketing: input.marketing,
    preferences: input.preferences,
    ipAddress: context.ipAddress || null,
    userAgent: context.userAgent || null,
  };

  await db.insert(consentRecords).values(record);

  // Fetch the just-inserted row
  const inserted = await db
    .select()
    .from(consentRecords)
    .where(
      and(
        userId !== null ? eq(consentRecords.userId, userId) : undefined,
        eq(consentRecords.ipAddress, context.ipAddress || "")
      )
    )
    .orderBy(desc(consentRecords.createdAt))
    .limit(1);

  log.info(
    { userId, consentVersion: input.consentVersion },
    "Consent recorded"
  );

  return inserted[0];
}

/**
 * Get the most recent consent record for an authenticated user.
 */
export async function getMyConsent(userId: number): Promise<{
  consent: ConsentRecord | null;
  needsReconsent: boolean;
  currentVersion: string;
}> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const records = await db
    .select()
    .from(consentRecords)
    .where(eq(consentRecords.userId, userId))
    .orderBy(desc(consentRecords.createdAt))
    .limit(1);

  const consent = records.length > 0 ? records[0] : null;
  const needsReconsent = consent
    ? consent.consentVersion !== CURRENT_CONSENT_VERSION
    : true;

  return {
    consent,
    needsReconsent,
    currentVersion: CURRENT_CONSENT_VERSION,
  };
}

/**
 * Update consent for an authenticated user.
 * This appends a new consent record (audit trail) rather than mutating the old one.
 */
export async function updateConsent(
  userId: number,
  input: ConsentInput,
  context: RequestContext
): Promise<ConsentRecord> {
  return await recordConsent(input, userId, context);
}

/**
 * Get the full consent change history for a user (audit trail).
 */
export async function getConsentHistory(
  userId: number,
  limit: number = 50
): Promise<ConsentRecord[]> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  return await db
    .select()
    .from(consentRecords)
    .where(eq(consentRecords.userId, userId))
    .orderBy(desc(consentRecords.createdAt))
    .limit(limit);
}

/**
 * Aggregate consent statistics for admins.
 * Returns total records and counts of users who have accepted each category.
 */
export async function getConsentStats(): Promise<{
  totalRecords: number;
  uniqueUsers: number;
  essentialCount: number;
  analyticsCount: number;
  marketingCount: number;
  preferencesCount: number;
  currentVersion: string;
  versionBreakdown: Array<{ version: string; count: number }>;
}> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  // Aggregate counts across all records
  const stats = await db
    .select({
      totalRecords: sql<number>`COUNT(*)`,
      uniqueUsers: sql<number>`COUNT(DISTINCT ${consentRecords.userId})`,
      essentialCount: sql<number>`SUM(CASE WHEN ${consentRecords.essential} = true THEN 1 ELSE 0 END)`,
      analyticsCount: sql<number>`SUM(CASE WHEN ${consentRecords.analytics} = true THEN 1 ELSE 0 END)`,
      marketingCount: sql<number>`SUM(CASE WHEN ${consentRecords.marketing} = true THEN 1 ELSE 0 END)`,
      preferencesCount: sql<number>`SUM(CASE WHEN ${consentRecords.preferences} = true THEN 1 ELSE 0 END)`,
    })
    .from(consentRecords);

  // Version breakdown
  const versions = await db
    .select({
      version: consentRecords.consentVersion,
      count: sql<number>`COUNT(*)`,
    })
    .from(consentRecords)
    .groupBy(consentRecords.consentVersion)
    .orderBy(desc(sql`COUNT(*)`));

  const row = stats[0] || {
    totalRecords: 0,
    uniqueUsers: 0,
    essentialCount: 0,
    analyticsCount: 0,
    marketingCount: 0,
    preferencesCount: 0,
  };

  return {
    totalRecords: Number(row.totalRecords),
    uniqueUsers: Number(row.uniqueUsers),
    essentialCount: Number(row.essentialCount),
    analyticsCount: Number(row.analyticsCount),
    marketingCount: Number(row.marketingCount),
    preferencesCount: Number(row.preferencesCount),
    currentVersion: CURRENT_CONSENT_VERSION,
    versionBreakdown: versions.map(v => ({
      version: v.version,
      count: Number(v.count),
    })),
  };
}
