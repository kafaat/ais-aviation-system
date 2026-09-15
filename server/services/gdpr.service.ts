import { writePrivacyConsent } from "./consent-authority.service";
import { createHash } from "node:crypto";
import type { SettlementTx } from "./booking-settlement.service";
import { TRPCError } from "@trpc/server";
import { eq, and, desc, inArray, lte, isNotNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../db";
import {
  users,
  refreshTokens,
  savedPassengers,
  wallets,
  walletTransactions,
  userCredits,
  creditUsage,
  consentRecords,
  privacyExportArtifacts,
  corporateInvitations,
  compensationClaims,
  userConsents,
  consentHistory,
  dataExportRequests,
  accountDeletionRequests,
  bookings,
  passengers,
  payments,
  loyaltyAccounts,
  milesTransactions,
  userPreferences,
  favoriteFlights,
  flightReviews,
  bookingModifications,
  type UserConsent,
  type InsertUserConsent,
  type InsertDataExportRequest,
  type InsertAccountDeletionRequest,
} from "../../drizzle/schema";
import { createAuditLog } from "./audit.service";
import { logger } from "../_core/logger";

// Current consent version - increment when consent policy changes
const CURRENT_CONSENT_VERSION = "1.0";

// Grace period for account deletion (in days)
const DELETION_GRACE_PERIOD_DAYS = 30;

// Data export link expiry (in hours)
const EXPORT_LINK_EXPIRY_HOURS = 24;

/**
 * Consent type keys for validation
 */
export const CONSENT_TYPES = [
  "marketingEmails",
  "marketingSms",
  "marketingPush",
  "analyticsTracking",
  "performanceCookies",
  "thirdPartySharing",
  "partnerOffers",
  "personalizedAds",
  "personalizedContent",
] as const;

export type ConsentType = (typeof CONSENT_TYPES)[number];

/**
 * Consent update input
 */
export interface ConsentUpdateInput {
  marketingEmails?: boolean;
  marketingSms?: boolean;
  marketingPush?: boolean;
  analyticsTracking?: boolean;
  performanceCookies?: boolean;
  thirdPartySharing?: boolean;
  partnerOffers?: boolean;
  personalizedAds?: boolean;
  personalizedContent?: boolean;
}

/**
 * Request context for audit logging
 */
export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Get or create user consent record
 */
export async function getOrCreateUserConsent(
  userId: number,
  context?: RequestContext
): Promise<UserConsent> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  // Try to find existing consent
  const existing = await db
    .select()
    .from(userConsents)
    .where(eq(userConsents.userId, userId))
    .limit(1);

  if (existing.length > 0) {
    return existing[0];
  }

  // Create default consent record
  const newConsent: InsertUserConsent = {
    userId,
    marketingEmails: false,
    marketingSms: false,
    marketingPush: false,
    analyticsTracking: false,
    performanceCookies: false,
    thirdPartySharing: false,
    partnerOffers: false,
    essentialCookies: true,
    personalizedAds: false,
    personalizedContent: false,
    consentVersion: CURRENT_CONSENT_VERSION,
    ipAddressAtConsent: context?.ipAddress || null,
    userAgentAtConsent: context?.userAgent || null,
  };

  await db.insert(userConsents).values(newConsent);

  // Fetch and return the created record
  const created = await db
    .select()
    .from(userConsents)
    .where(eq(userConsents.userId, userId))
    .limit(1);

  if (created.length === 0) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create consent record",
    });
  }

  // Log initial consent creation
  await createAuditLog({
    eventType: "USER_CREATED",
    eventCategory: "user_management",
    outcome: "success",
    severity: "low",
    userId,
    actorType: "user",
    sourceIp: context?.ipAddress,
    userAgent: context?.userAgent,
    resourceType: "consent",
    resourceId: String(userId),
    changeDescription: "Initial consent record created with default values",
  });

  return created[0];
}

/**
 * Get user consent status
 */
export async function getConsentStatus(
  userId: number,
  context?: RequestContext
): Promise<{
  consent: UserConsent;
  needsUpdate: boolean;
  currentVersion: string;
}> {
  const consent = await getOrCreateUserConsent(userId, context);

  // Check if consent version is outdated
  const needsUpdate = consent.consentVersion !== CURRENT_CONSENT_VERSION;

  return {
    consent,
    needsUpdate,
    currentVersion: CURRENT_CONSENT_VERSION,
  };
}

/**
 * Update user consent preferences
 */
export async function updateConsent(
  userId: number,
  updates: ConsentUpdateInput,
  context?: RequestContext
): Promise<UserConsent> {
  return (await writePrivacyConsent(userId, updates, context)).privacy;
}

/**
 * Withdraw all consent (except essential)
 */
export async function withdrawAllConsent(
  userId: number,
  context?: RequestContext
): Promise<UserConsent> {
  return await updateConsent(
    userId,
    {
      marketingEmails: false,
      marketingSms: false,
      marketingPush: false,
      analyticsTracking: false,
      performanceCookies: false,
      thirdPartySharing: false,
      partnerOffers: false,
      personalizedAds: false,
      personalizedContent: false,
    },
    context
  );
}

/**
 * Export all user data (GDPR Article 20 - Right to Data Portability)
 */
export async function exportUserData(
  userId: number,
  format: "json" | "csv" = "json",
  context?: RequestContext
): Promise<{
  requestId: number;
  status: string;
  estimatedCompletionTime: Date;
}> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  // Check for pending export requests (rate limiting)
  const pendingRequests = await db
    .select()
    .from(dataExportRequests)
    .where(
      and(
        eq(dataExportRequests.userId, userId),
        eq(dataExportRequests.status, "pending")
      )
    )
    .limit(1);

  if (pendingRequests.length > 0) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message:
        "You already have a pending data export request. Please wait for it to complete.",
    });
  }

  // Create export request
  const exportRequest: InsertDataExportRequest = {
    userId,
    status: "pending",
    format,
    ipAddress: context?.ipAddress || null,
    userAgent: context?.userAgent || null,
  };

  const result = await db.insert(dataExportRequests).values(exportRequest);
  const requestId = result[0].insertId;

  // Log the request
  await createAuditLog({
    eventType: "DATA_EXPORT",
    eventCategory: "user_management",
    outcome: "success",
    severity: "high",
    userId,
    actorType: "user",
    sourceIp: context?.ipAddress,
    userAgent: context?.userAgent,
    resourceType: "data_export",
    resourceId: String(requestId),
    changeDescription: `User requested data export in ${format} format`,
  });

  // Estimate completion time (1 hour for processing)
  const estimatedCompletionTime = new Date();
  estimatedCompletionTime.setHours(estimatedCompletionTime.getHours() + 1);

  return {
    requestId,
    status: "pending",
    estimatedCompletionTime,
  };
}

/**
 * Generate user data export (called by background job)
 */
export async function generateDataExport(requestId: number): Promise<{
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}> {
  const db = await getDb();
  if (!db) {
    return { success: false, error: "Database not available" };
  }

  try {
    return await db.transaction(async tx => {
      const [request] = await tx
        .select()
        .from(dataExportRequests)
        .where(eq(dataExportRequests.id, requestId))
        .for("update");
      if (!request)
        return { success: false, error: "Export request not found" };
      if (request.status === "completed") return { success: true };
      if (request.status === "expired")
        return { success: false, error: "Export expired; request a new copy" };
      const userData = await collectUserData(request.userId, tx);
      const content =
        request.format === "csv"
          ? "section,data\r\n" +
            Object.entries(userData)
              .map(
                ([key, value]) =>
                  `"${key}","${JSON.stringify(value).replaceAll('"', '""')}"`
              )
              .join("\r\n")
          : JSON.stringify(userData, null, 2);
      const size = Buffer.byteLength(content, "utf8");
      if (size > 16 * 1024 * 1024)
        throw new Error(
          "Export exceeds the supported download size; requires assisted export"
        );
      const expiresAt = new Date(
        Date.now() + EXPORT_LINK_EXPIRY_HOURS * 3600_000
      );
      await tx.insert(privacyExportArtifacts).values({
        requestId,
        userId: request.userId,
        content,
        contentType: request.format === "csv" ? "text/csv" : "application/json",
        sha256: createHash("sha256").update(content).digest("hex"),
        expiresAt,
      });
      await tx
        .update(dataExportRequests)
        .set({
          status: "completed",
          processedAt: new Date(),
          completedAt: new Date(),
          downloadExpiresAt: expiresAt,
          downloadUrl: `/api/gdpr/download/${requestId}`,
          fileSizeBytes: size,
          errorMessage: null,
        })
        .where(eq(dataExportRequests.id, requestId));
      return { success: true, data: userData };
    });
  } catch (error) {
    logger.error(
      { requestId, error },
      "Privacy export failed without publishing a download"
    );
    return {
      success: false,
      error: error instanceof Error ? error.message : "Export failed",
    };
  }
}

export async function downloadDataExport(userId: number, requestId: number) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const [artifact] = await db
    .select()
    .from(privacyExportArtifacts)
    .innerJoin(
      dataExportRequests,
      eq(dataExportRequests.id, privacyExportArtifacts.requestId)
    )
    .where(
      and(
        eq(privacyExportArtifacts.requestId, requestId),
        eq(privacyExportArtifacts.userId, userId),
        eq(dataExportRequests.userId, userId),
        eq(dataExportRequests.status, "completed")
      )
    );
  const file = artifact?.privacy_export_artifacts;
  if (!file || file.expiresAt <= new Date())
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Export not found or expired",
    });
  if (createHash("sha256").update(file.content).digest("hex") !== file.sha256)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Export integrity check failed",
    });
  return file;
}

export async function processPrivacyRequests() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.transaction(async tx => {
    const now = new Date();
    await tx
      .delete(privacyExportArtifacts)
      .where(lte(privacyExportArtifacts.expiresAt, now));
    await tx
      .update(dataExportRequests)
      .set({ status: "expired", downloadUrl: null })
      .where(
        and(
          eq(dataExportRequests.status, "completed"),
          lte(dataExportRequests.downloadExpiresAt, now)
        )
      );
  });
  const exports = await db
    .select({ id: dataExportRequests.id })
    .from(dataExportRequests)
    .where(inArray(dataExportRequests.status, ["pending", "failed"]))
    .orderBy(dataExportRequests.id)
    .limit(20);
  const deletions = await db
    .select({ id: accountDeletionRequests.id })
    .from(accountDeletionRequests)
    .where(
      and(
        inArray(accountDeletionRequests.status, ["pending", "processing"]),
        isNotNull(accountDeletionRequests.confirmedAt),
        lte(accountDeletionRequests.scheduledDeletionAt, new Date())
      )
    )
    .orderBy(accountDeletionRequests.id)
    .limit(20);
  const results = [];
  for (const request of exports)
    results.push(await generateDataExport(request.id));
  for (const request of deletions)
    results.push(await processAccountDeletion(request.id));
  const failed = results.filter(result => !result.success);
  if (failed.length)
    throw new Error(`Privacy processing failed for ${failed.length} requests`);
  return { processed: results.length };
}

/**
 * Collect all user data for export
 */
async function collectUserData(
  userId: number,
  db: SettlementTx
): Promise<Record<string, unknown>> {
  if (!db) {
    throw new Error("Database not available");
  }

  // Get user profile
  const userProfile = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
      lastSignedIn: users.lastSignedIn,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  // Get user preferences
  const preferences = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  // Get consent settings
  const consent = await db
    .select()
    .from(userConsents)
    .where(eq(userConsents.userId, userId))
    .limit(1);

  // Get all bookings with passengers
  const userBookings = await db
    .select()
    .from(bookings)
    .where(eq(bookings.userId, userId))
    .orderBy(desc(bookings.createdAt));

  const bookingIds = userBookings.map(b => b.id);

  // Get passengers for all bookings
  const bookingPassengers =
    bookingIds.length > 0
      ? await db
          .select()
          .from(passengers)
          .where(inArray(passengers.bookingId, bookingIds))
      : [];

  // Get all payments
  const userPayments =
    bookingIds.length > 0
      ? await db
          .select({
            id: payments.id,
            bookingId: payments.bookingId,
            amount: payments.amount,
            currency: payments.currency,
            method: payments.method,
            status: payments.status,
            createdAt: payments.createdAt,
          })
          .from(payments)
          .where(inArray(payments.bookingId, bookingIds))
      : [];

  // Get loyalty account
  const loyalty = await db
    .select()
    .from(loyaltyAccounts)
    .where(eq(loyaltyAccounts.userId, userId))
    .limit(1);

  // Get miles transactions
  const miles =
    loyalty.length > 0
      ? await db
          .select()
          .from(milesTransactions)
          .where(eq(milesTransactions.userId, userId))
          .orderBy(desc(milesTransactions.createdAt))
      : [];

  // Get favorite flights
  const favorites = await db
    .select()
    .from(favoriteFlights)
    .where(eq(favoriteFlights.userId, userId));

  // Get reviews
  const reviews = await db
    .select()
    .from(flightReviews)
    .where(eq(flightReviews.userId, userId));

  // Get booking modifications
  const modifications =
    bookingIds.length > 0
      ? await db
          .select()
          .from(bookingModifications)
          .where(eq(bookingModifications.userId, userId))
      : [];

  // Get consent history
  const consentHistoryRecords = await db
    .select()
    .from(consentHistory)
    .where(eq(consentHistory.userId, userId))
    .orderBy(desc(consentHistory.createdAt));

  return {
    exportedAt: new Date().toISOString(),
    exportVersion: "2.0",
    savedPassengers: await db
      .select()
      .from(savedPassengers)
      .where(eq(savedPassengers.userId, userId)),
    wallet: await db.select().from(wallets).where(eq(wallets.userId, userId)),
    walletTransactions: await db
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.userId, userId)),
    credits: await db
      .select()
      .from(userCredits)
      .where(eq(userCredits.userId, userId)),
    creditUsage: await db
      .select()
      .from(creditUsage)
      .where(eq(creditUsage.userId, userId)),
    corporateInvitations: await db
      .select()
      .from(corporateInvitations)
      .where(eq(corporateInvitations.recipientUserId, userId)),
    compensationClaims: bookingIds.length
      ? await db
          .select()
          .from(compensationClaims)
          .where(inArray(compensationClaims.bookingId, bookingIds))
      : [],
    cookieConsentHistory: await db
      .select()
      .from(consentRecords)
      .where(eq(consentRecords.userId, userId)),
    profile: userProfile[0] || null,
    preferences: preferences[0] || null,
    consent: consent[0] || null,
    consentHistory: consentHistoryRecords,
    bookings: userBookings.map(booking => ({
      ...booking,
      passengers: bookingPassengers.filter(p => p.bookingId === booking.id),
    })),
    payments: userPayments,
    loyalty: loyalty[0] || null,
    milesTransactions: miles,
    favorites,
    reviews,
    bookingModifications: modifications,
  };
}

/**
 * Get data export status
 */
export async function getExportStatus(
  userId: number,
  requestId: number
): Promise<{
  status: string;
  downloadUrl?: string | null;
  downloadExpiresAt?: Date | null;
  errorMessage?: string | null;
}> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const request = await db
    .select()
    .from(dataExportRequests)
    .where(
      and(
        eq(dataExportRequests.id, requestId),
        eq(dataExportRequests.userId, userId)
      )
    )
    .limit(1);

  if (request.length === 0) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Export request not found",
    });
  }

  return {
    status: request[0].status,
    downloadUrl: request[0].downloadUrl,
    downloadExpiresAt: request[0].downloadExpiresAt,
    errorMessage: request[0].errorMessage,
  };
}

/**
 * Request account deletion (GDPR Article 17 - Right to Erasure)
 */
export async function requestAccountDeletion(
  userId: number,
  reason?: string,
  deletionType: "full" | "anonymize" = "anonymize",
  context?: RequestContext
): Promise<{
  requestId: number;
  confirmationToken: string;
  scheduledDeletionAt: Date;
}> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  // Check for existing pending deletion request
  const pendingDeletion = await db
    .select()
    .from(accountDeletionRequests)
    .where(
      and(
        eq(accountDeletionRequests.userId, userId),
        eq(accountDeletionRequests.status, "pending")
      )
    )
    .limit(1);

  if (pendingDeletion.length > 0) {
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "You already have a pending account deletion request. Please confirm or cancel it first.",
    });
  }

  // Generate confirmation token
  const confirmationToken = nanoid(64);

  // Calculate scheduled deletion date (grace period)
  const scheduledDeletionAt = new Date();
  scheduledDeletionAt.setDate(
    scheduledDeletionAt.getDate() + DELETION_GRACE_PERIOD_DAYS
  );

  // Create deletion request
  const deletionRequest: InsertAccountDeletionRequest = {
    userId,
    status: "pending",
    deletionType,
    reason: reason || null,
    ipAddress: context?.ipAddress || null,
    userAgent: context?.userAgent || null,
    confirmationToken,
    scheduledDeletionAt,
  };

  const result = await db
    .insert(accountDeletionRequests)
    .values(deletionRequest);
  const requestId = result[0].insertId;

  // Log the request
  await createAuditLog({
    eventType: "SENSITIVE_DATA_ACCESS",
    eventCategory: "user_management",
    outcome: "success",
    severity: "critical",
    userId,
    actorType: "user",
    sourceIp: context?.ipAddress,
    userAgent: context?.userAgent,
    resourceType: "account_deletion",
    resourceId: String(requestId),
    changeDescription: `User requested account deletion (${deletionType})`,
    metadata: { reason, scheduledDeletionAt },
  });

  return {
    requestId,
    confirmationToken,
    scheduledDeletionAt,
  };
}

/**
 * Confirm account deletion
 */
export async function confirmAccountDeletion(
  userId: number,
  confirmationToken: string,
  context?: RequestContext
): Promise<{ success: boolean; scheduledDeletionAt: Date }> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  // Find the deletion request
  const request = await db
    .select()
    .from(accountDeletionRequests)
    .where(
      and(
        eq(accountDeletionRequests.userId, userId),
        eq(accountDeletionRequests.confirmationToken, confirmationToken),
        eq(accountDeletionRequests.status, "pending")
      )
    )
    .limit(1);

  if (request.length === 0) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Invalid or expired confirmation token",
    });
  }

  // Update request as confirmed
  await db
    .update(accountDeletionRequests)
    .set({ confirmedAt: new Date() })
    .where(eq(accountDeletionRequests.id, request[0].id));

  // Log confirmation
  await createAuditLog({
    eventType: "SENSITIVE_DATA_ACCESS",
    eventCategory: "user_management",
    outcome: "success",
    severity: "critical",
    userId,
    actorType: "user",
    sourceIp: context?.ipAddress,
    userAgent: context?.userAgent,
    resourceType: "account_deletion",
    resourceId: String(request[0].id),
    changeDescription: "User confirmed account deletion request",
  });

  // Withdraw all consent
  await withdrawAllConsent(userId, context);

  return {
    success: true,
    scheduledDeletionAt: request[0].scheduledDeletionAt ?? new Date(),
  };
}

/**
 * Cancel account deletion request
 */
export async function cancelAccountDeletion(
  userId: number,
  context?: RequestContext
): Promise<{ success: boolean }> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  // Find pending deletion request
  const request = await db
    .select()
    .from(accountDeletionRequests)
    .where(
      and(
        eq(accountDeletionRequests.userId, userId),
        eq(accountDeletionRequests.status, "pending")
      )
    )
    .limit(1);

  if (request.length === 0) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "No pending deletion request found",
    });
  }

  // Update request as cancelled
  await db
    .update(accountDeletionRequests)
    .set({ status: "cancelled" })
    .where(eq(accountDeletionRequests.id, request[0].id));

  // Log cancellation
  await createAuditLog({
    eventType: "SENSITIVE_DATA_ACCESS",
    eventCategory: "user_management",
    outcome: "success",
    severity: "medium",
    userId,
    actorType: "user",
    sourceIp: context?.ipAddress,
    userAgent: context?.userAgent,
    resourceType: "account_deletion",
    resourceId: String(request[0].id),
    changeDescription: "User cancelled account deletion request",
  });

  return { success: true };
}

/**
 * Process account deletion (called by background job)
 */
export async function processAccountDeletion(
  requestId: number
): Promise<{ success: boolean; error?: string }> {
  const db = await getDb();
  if (!db) return { success: false, error: "Database unavailable" };
  // Freeze and revoke first, durably. An erasure failure must never restore
  // access. Login/refresh take the same user lock and reject processed requests.
  return db.transaction(async tx => {
    const [reference] = await tx
      .select()
      .from(accountDeletionRequests)
      .where(eq(accountDeletionRequests.id, requestId));
    if (!reference)
      return { success: false, error: "Deletion request not found" };
    await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, reference.userId))
      .for("update");
    const [request] = await tx
      .select()
      .from(accountDeletionRequests)
      .where(eq(accountDeletionRequests.id, requestId))
      .for("update");
    if (
      request.status === "cancelled" ||
      !request.confirmedAt ||
      !request.scheduledDeletionAt ||
      request.scheduledDeletionAt > new Date()
    )
      return { success: false, error: "Deletion is not due and confirmed" };
    if (request.status === "completed") return { success: true };
    await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.userId, request.userId));
    // Booking passengers need subject attribution, and financial/audit records
    // need an approved retention scope. Neither exists yet. Do not erase other
    // travellers or invent a legal retention policy, nor certify completion.
    const error =
      "RETENTION_REVIEW_REQUIRED: access revoked; erasure awaits an approved data-subject and retention inventory";
    await tx
      .update(accountDeletionRequests)
      .set({
        status: "failed",
        processedAt: request.processedAt ?? new Date(),
        completedAt: null,
        errorMessage: error,
        confirmationToken: null,
      })
      .where(eq(accountDeletionRequests.id, requestId));
    return { success: false, error };
  });
}

/**
 * Get deletion request status
 */
export async function getDeletionStatus(userId: number): Promise<{
  hasPendingRequest: boolean;
  request?: {
    id: number;
    status: string;
    deletionType: string;
    scheduledDeletionAt: Date | null;
    confirmedAt: Date | null;
  };
}> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const request = await db
    .select()
    .from(accountDeletionRequests)
    .where(
      and(
        eq(accountDeletionRequests.userId, userId),
        inArray(accountDeletionRequests.status, [
          "pending",
          "processing",
          "failed",
        ])
      )
    )
    .limit(1);

  if (request.length === 0) {
    return { hasPendingRequest: false };
  }

  return {
    hasPendingRequest: true,
    request: {
      id: request[0].id,
      status: request[0].status,
      deletionType: request[0].deletionType,
      scheduledDeletionAt: request[0].scheduledDeletionAt,
      confirmedAt: request[0].confirmedAt,
    },
  };
}

/**
 * Get consent history for a user
 */
export async function getConsentHistory(
  userId: number,
  limit: number = 50
): Promise<
  Array<{
    consentType: string;
    previousValue: boolean | null;
    newValue: boolean;
    changeReason: string;
    createdAt: Date;
  }>
> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const history = await db
    .select()
    .from(consentHistory)
    .where(eq(consentHistory.userId, userId))
    .orderBy(desc(consentHistory.createdAt))
    .limit(limit);

  return history.map(h => ({
    consentType: h.consentType,
    previousValue: h.previousValue,
    newValue: h.newValue,
    changeReason: h.changeReason,
    createdAt: h.createdAt,
  }));
}

/**
 * Get export history for a user
 */
export async function getExportHistory(
  userId: number,
  limit: number = 10
): Promise<
  Array<{
    id: number;
    status: string;
    format: string;
    requestedAt: Date;
    completedAt: Date | null;
  }>
> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const exports = await db
    .select()
    .from(dataExportRequests)
    .where(eq(dataExportRequests.userId, userId))
    .orderBy(desc(dataExportRequests.requestedAt))
    .limit(limit);

  return exports.map(e => ({
    id: e.id,
    status: e.status,
    format: e.format,
    requestedAt: e.requestedAt,
    completedAt: e.completedAt,
  }));
}
