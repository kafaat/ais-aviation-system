// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  getConsentStatus: z.object({
    consent: z.object({
      id: outputNumber,
      createdAt: z.date(),
      userId: outputNumber,
      marketingEmails: z.boolean(),
      marketingSms: z.boolean(),
      marketingPush: z.boolean(),
      analyticsTracking: z.boolean(),
      performanceCookies: z.boolean(),
      thirdPartySharing: z.boolean(),
      partnerOffers: z.boolean(),
      personalizedAds: z.boolean(),
      personalizedContent: z.boolean(),
      essentialCookies: z.boolean(),
      consentVersion: z.string(),
      ipAddressAtConsent: z.union([z.null(), z.string()]),
      userAgentAtConsent: z.union([z.null(), z.string()]),
      consentGivenAt: z.date(),
      lastUpdatedAt: z.date(),
    }),
    needsUpdate: z.boolean(),
    currentVersion: z.string(),
  }),
  updateConsent: z.object({
    id: outputNumber,
    createdAt: z.date(),
    userId: outputNumber,
    marketingEmails: z.boolean(),
    marketingSms: z.boolean(),
    marketingPush: z.boolean(),
    analyticsTracking: z.boolean(),
    performanceCookies: z.boolean(),
    thirdPartySharing: z.boolean(),
    partnerOffers: z.boolean(),
    personalizedAds: z.boolean(),
    personalizedContent: z.boolean(),
    essentialCookies: z.boolean(),
    consentVersion: z.string(),
    ipAddressAtConsent: z.union([z.null(), z.string()]),
    userAgentAtConsent: z.union([z.null(), z.string()]),
    consentGivenAt: z.date(),
    lastUpdatedAt: z.date(),
  }),
  withdrawAllConsent: z.object({
    id: outputNumber,
    createdAt: z.date(),
    userId: outputNumber,
    marketingEmails: z.boolean(),
    marketingSms: z.boolean(),
    marketingPush: z.boolean(),
    analyticsTracking: z.boolean(),
    performanceCookies: z.boolean(),
    thirdPartySharing: z.boolean(),
    partnerOffers: z.boolean(),
    personalizedAds: z.boolean(),
    personalizedContent: z.boolean(),
    essentialCookies: z.boolean(),
    consentVersion: z.string(),
    ipAddressAtConsent: z.union([z.null(), z.string()]),
    userAgentAtConsent: z.union([z.null(), z.string()]),
    consentGivenAt: z.date(),
    lastUpdatedAt: z.date(),
  }),
  getConsentHistory: z.array(
    z.object({
      consentType: z.string(),
      previousValue: z.union([z.null(), z.literal(false), z.literal(true)]),
      newValue: z.boolean(),
      changeReason: z.string(),
      createdAt: z.date(),
    })
  ),
  exportData: z.object({
    requestId: outputNumber,
    status: z.string(),
    estimatedCompletionTime: z.date(),
  }),
  getExportStatus: z.object({
    status: z.string(),
    downloadUrl: z.union([z.undefined(), z.null(), z.string()]).optional(),
    downloadExpiresAt: z.union([z.undefined(), z.null(), z.date()]).optional(),
    errorMessage: z.union([z.undefined(), z.null(), z.string()]).optional(),
  }),
  getExportHistory: z.array(
    z.object({
      id: outputNumber,
      status: z.string(),
      format: z.string(),
      requestedAt: z.date(),
      completedAt: z.union([z.null(), z.date()]),
    })
  ),
  deleteAccount: z.object({
    requestId: outputNumber,
    confirmationToken: z.string(),
    scheduledDeletionAt: z.date(),
  }),
  confirmDeletion: z.object({
    success: z.boolean(),
    scheduledDeletionAt: z.date(),
  }),
  cancelDeletion: z.object({ success: z.boolean() }),
  getDeletionStatus: z.object({
    hasPendingRequest: z.boolean(),
    request: z
      .union([
        z.undefined(),
        z.object({
          id: outputNumber,
          status: z.string(),
          deletionType: z.string(),
          scheduledDeletionAt: z.union([z.null(), z.date()]),
          confirmedAt: z.union([z.null(), z.date()]),
        }),
      ])
      .optional(),
  }),
  getPrivacyDashboard: z.object({
    consent: z.object({
      consent: z.object({
        id: outputNumber,
        createdAt: z.date(),
        userId: outputNumber,
        marketingEmails: z.boolean(),
        marketingSms: z.boolean(),
        marketingPush: z.boolean(),
        analyticsTracking: z.boolean(),
        performanceCookies: z.boolean(),
        thirdPartySharing: z.boolean(),
        partnerOffers: z.boolean(),
        personalizedAds: z.boolean(),
        personalizedContent: z.boolean(),
        essentialCookies: z.boolean(),
        consentVersion: z.string(),
        ipAddressAtConsent: z.union([z.null(), z.string()]),
        userAgentAtConsent: z.union([z.null(), z.string()]),
        consentGivenAt: z.date(),
        lastUpdatedAt: z.date(),
      }),
      needsUpdate: z.boolean(),
      currentVersion: z.string(),
    }),
    deletion: z.object({
      hasPendingRequest: z.boolean(),
      request: z
        .union([
          z.undefined(),
          z.object({
            id: outputNumber,
            status: z.string(),
            deletionType: z.string(),
            scheduledDeletionAt: z.union([z.null(), z.date()]),
            confirmedAt: z.union([z.null(), z.date()]),
          }),
        ])
        .optional(),
    }),
    recentExports: z.array(
      z.object({
        id: outputNumber,
        status: z.string(),
        format: z.string(),
        requestedAt: z.date(),
        completedAt: z.union([z.null(), z.date()]),
      })
    ),
    recentConsentChanges: z.array(
      z.object({
        consentType: z.string(),
        previousValue: z.union([z.null(), z.literal(false), z.literal(true)]),
        newValue: z.boolean(),
        changeReason: z.string(),
        createdAt: z.date(),
      })
    ),
  }),
};
