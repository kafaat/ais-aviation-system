import { TRPCError } from "@trpc/server";
import { eq, and, desc } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../db";
import {
  users,
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
  type InsertConsentHistory,
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
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  // Get current consent
  const currentConsent = await getOrCreateUserConsent(userId, context);

  // Track changes for history
  const historyRecords: InsertConsentHistory[] = [];

  for (const key of CONSENT_TYPES) {
    const newValue = updates[key];
    if (newValue !== undefined && newValue !== currentConsent[key]) {
      historyRecords.push({
        userId,
        consentType: key,
        previousValue: currentConsent[key],
        newValue,
        ipAddress: context?.ipAddress || null,
        userAgent: context?.userAgent || null,
        consentVersion: CURRENT_CONSENT_VERSION,
        changeReason: "user_update",
      });
    }
  }

  // Only update if there are changes
  if (historyRecords.length === 0) {
    return currentConsent;
  }

  // Build update object
  const updateData: Partial<InsertUserConsent> = {
    ...updates,
    consentVersion: CURRENT_CONSENT_VERSION,
    ipAddressAtConsent: context?.ipAddress || null,
    userAgentAtConsent: context?.userAgent || null,
  };

  // Update consent
  await db
    .update(userConsents)
    .set(updateData)
    .where(eq(userConsents.userId, userId));

  // Record history
  await db.insert(consentHistory).values(historyRecords);

  // Log the update
  await createAuditLog({
    eventType: "SENSITIVE_DATA_ACCESS",
    eventCategory: "user_management",
    outcome: "success",
    severity: "medium",
    userId,
    actorType: "user",
    sourceIp: context?.ipAddress,
    userAgent: context?.userAgent,
    resourceType: "consent",
    resourceId: String(userId),
    previousValue: historyRecords.map(h => ({
      type: h.consentType,
      value: h.previousValue,
    })),
    newValue: historyRecords.map(h => ({
      type: h.consentType,
      value: h.newValue,
    })),
    changeDescription: `Updated ${historyRecords.length} consent preference(s)`,
  });

  // Fetch and return updated consent
  const updated = await db
    .select()
    .from(userConsents)
    .where(eq(userConsents.userId, userId))
    .limit(1);

  return updated[0];
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
  const requestId = (result as any).insertId || result[0]?.insertId;

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
    // Get export request
    const request = await db
      .select()
      .from(dataExportRequests)
      .where(eq(dataExportRequests.id, requestId))
      .limit(1);

    if (request.length === 0) {
      return { success: false, error: "Export request not found" };
    }

    const exportRequest = request[0];
    const userId = exportRequest.userId;

    // Update status to processing
    await db
      .update(dataExportRequests)
      .set({ status: "processing", processedAt: new Date() })
      .where(eq(dataExportRequests.id, requestId));

    // Collect all user data
    const userData = await collectUserData(userId);

    // Update status to completed
    const downloadExpiresAt = new Date();
    downloadExpiresAt.setHours(
      downloadExpiresAt.getHours() + EXPORT_LINK_EXPIRY_HOURS
    );

    await db
      .update(dataExportRequests)
      .set({
        status: "completed",
        completedAt: new Date(),
        downloadExpiresAt,
        // In production, you would upload to S3/GCS and store the signed URL
        downloadUrl: `/api/gdpr/download/${requestId}`,
        fileSizeBytes: JSON.stringify(userData).length,
      })
      .where(eq(dataExportRequests.id, requestId));

    logger.info({ requestId, userId }, "Data export completed successfully");

    return { success: true, data: userData };
  } catch (error) {
    logger.error({ error, requestId }, "Failed to generate data export");

    await db
      .update(dataExportRequests)
      .set({
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      })
      .where(eq(dataExportRequests.id, requestId));

    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Collect all user data for export
 */
async function collectUserData(
  userId: number
): Promise<Record<string, unknown>> {
  const db = await getDb();
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
          .where(
            bookingIds.length === 1
              ? eq(passengers.bookingId, bookingIds[0])
              : eq(passengers.bookingId, bookingIds[0])
          )
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
          .where(
            bookingIds.length === 1
              ? eq(payments.bookingId, bookingIds[0])
              : eq(payments.bookingId, bookingIds[0])
          )
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
    exportVersion: "1.0",
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
  const requestId = (result as any).insertId || result[0]?.insertId;

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
    scheduledDeletionAt: request[0].scheduledDeletionAt!,
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
  if (!db) {
    return { success: false, error: "Database not available" };
  }

  try {
    // Get deletion request
    const request = await db
      .select()
      .from(accountDeletionRequests)
      .where(
        and(
          eq(accountDeletionRequests.id, requestId),
          eq(accountDeletionRequests.status, "pending")
        )
      )
      .limit(1);

    if (request.length === 0) {
      return {
        success: false,
        error: "Deletion request not found or already processed",
      };
    }

    const deletionRequest = request[0];
    const userId = deletionRequest.userId;

    // Check if past scheduled deletion date and confirmed
    if (!deletionRequest.confirmedAt) {
      return {
        success: false,
        error: "Deletion request not confirmed by user",
      };
    }

    if (
      deletionRequest.scheduledDeletionAt &&
      new Date() < deletionRequest.scheduledDeletionAt
    ) {
      return {
        success: false,
        error: "Scheduled deletion date not yet reached",
      };
    }

    // Update status to processing
    await db
      .update(accountDeletionRequests)
      .set({ status: "processing", processedAt: new Date() })
      .where(eq(accountDeletionRequests.id, requestId));

    // Perform anonymization
    await anonymizeUserData(userId);

    // Update status to completed
    await db
      .update(accountDeletionRequests)
      .set({
        status: "completed",
        completedAt: new Date(),
        dataAnonymizedAt: new Date(),
      })
      .where(eq(accountDeletionRequests.id, requestId));

    logger.info(
      { requestId, userId },
      "Account deletion completed successfully"
    );

    return { success: true };
  } catch (error) {
    logger.error({ error, requestId }, "Failed to process account deletion");

    await db
      .update(accountDeletionRequests)
      .set({
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      })
      .where(eq(accountDeletionRequests.id, requestId));

    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Anonymize user data
 */
async function anonymizeUserData(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  const anonymizedEmail = `deleted_${nanoid(16)}@anonymized.local`;
  const anonymizedName = "Deleted User";

  // Anonymize user profile
  await db
    .update(users)
    .set({
      name: anonymizedName,
      email: anonymizedEmail,
      openId: `deleted_${nanoid(32)}`,
    })
    .where(eq(users.id, userId));

  // Anonymize user preferences (delete sensitive data but keep record)
  await db
    .update(userPreferences)
    .set({
      passportNumber: null,
      passportExpiry: null,
      phoneNumber: null,
      emergencyContact: null,
      emergencyPhone: null,
    })
    .where(eq(userPreferences.userId, userId));

  // Get all user bookings
  const userBookings = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(eq(bookings.userId, userId));

  const bookingIds = userBookings.map(b => b.id);

  // Anonymize passenger data (keep for legal/accounting but remove PII)
  if (bookingIds.length > 0) {
    for (const bookingId of bookingIds) {
      await db
        .update(passengers)
        .set({
          firstName: "REDACTED",
          lastName: "REDACTED",
          passportNumber: null,
          dateOfBirth: null,
        })
        .where(eq(passengers.bookingId, bookingId));
    }
  }

  // Delete favorites
  await db.delete(favoriteFlights).where(eq(favoriteFlights.userId, userId));

  // Anonymize reviews (keep for integrity but remove user association)
  await db
    .update(flightReviews)
    .set({ userId: 0 }) // Anonymous user
    .where(eq(flightReviews.userId, userId));

  // Delete consent records
  await db.delete(userConsents).where(eq(userConsents.userId, userId));

  // Keep consent history for compliance (but data is anonymized via user)
  // Keep booking and payment records for legal/accounting purposes

  logger.info({ userId }, "User data anonymized successfully");
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
        eq(accountDeletionRequests.status, "pending")
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
