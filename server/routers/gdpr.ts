import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as gdprService from "../services/gdpr.service";

/**
 * GDPR Compliance Router
 * Handles all GDPR-related operations including:
 * - Consent management (Article 7)
 * - Data portability / export (Article 20)
 * - Right to erasure / account deletion (Article 17)
 */
export const gdprRouter = router({
  /**
   * Get user's current consent status
   * Returns all consent preferences and whether they need to be updated
   */
  getConsentStatus: protectedProcedure.query(async ({ ctx }) => {
    const requestContext = {
      ipAddress: ctx.req.ip || ctx.req.socket?.remoteAddress,
      userAgent: ctx.req.headers["user-agent"],
    };

    return await gdprService.getConsentStatus(ctx.user.id, requestContext);
  }),

  /**
   * Update user's consent preferences
   * Tracks all changes for compliance audit trail
   */
  updateConsent: protectedProcedure
    .input(
      z.object({
        marketingEmails: z.boolean().optional(),
        marketingSms: z.boolean().optional(),
        marketingPush: z.boolean().optional(),
        analyticsTracking: z.boolean().optional(),
        performanceCookies: z.boolean().optional(),
        thirdPartySharing: z.boolean().optional(),
        partnerOffers: z.boolean().optional(),
        personalizedAds: z.boolean().optional(),
        personalizedContent: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const requestContext = {
        ipAddress: ctx.req.ip || ctx.req.socket?.remoteAddress,
        userAgent: ctx.req.headers["user-agent"],
      };

      return await gdprService.updateConsent(
        ctx.user.id,
        input,
        requestContext
      );
    }),

  /**
   * Withdraw all consent (except essential cookies)
   * Useful for users who want to opt-out of everything at once
   */
  withdrawAllConsent: protectedProcedure.mutation(async ({ ctx }) => {
    const requestContext = {
      ipAddress: ctx.req.ip || ctx.req.socket?.remoteAddress,
      userAgent: ctx.req.headers["user-agent"],
    };

    return await gdprService.withdrawAllConsent(ctx.user.id, requestContext);
  }),

  /**
   * Get consent change history
   * Shows audit trail of all consent preference changes
   */
  getConsentHistory: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(100).default(50),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      return await gdprService.getConsentHistory(
        ctx.user.id,
        input?.limit ?? 50
      );
    }),

  /**
   * Request data export (GDPR Article 20 - Right to Data Portability)
   * Initiates async export of all user data
   */
  exportData: protectedProcedure
    .input(
      z
        .object({
          format: z.enum(["json", "csv"]).default("json"),
        })
        .optional()
    )
    .mutation(async ({ ctx, input }) => {
      const requestContext = {
        ipAddress: ctx.req.ip || ctx.req.socket?.remoteAddress,
        userAgent: ctx.req.headers["user-agent"],
      };

      return await gdprService.exportUserData(
        ctx.user.id,
        input?.format ?? "json",
        requestContext
      );
    }),

  /**
   * Get data export status
   * Check progress of a data export request
   */
  getExportStatus: protectedProcedure
    .input(
      z.object({
        requestId: z.number(),
      })
    )
    .query(async ({ ctx, input }) => {
      return await gdprService.getExportStatus(ctx.user.id, input.requestId);
    }),

  /**
   * Get export request history
   * Lists all previous data export requests
   */
  getExportHistory: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(50).default(10),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      return await gdprService.getExportHistory(
        ctx.user.id,
        input?.limit ?? 10
      );
    }),

  /**
   * Request account deletion (GDPR Article 17 - Right to Erasure)
   * Initiates the account deletion process with a grace period
   */
  deleteAccount: protectedProcedure
    .input(
      z.object({
        reason: z.string().max(1000).optional(),
        deletionType: z.enum(["full", "anonymize"]).default("anonymize"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const requestContext = {
        ipAddress: ctx.req.ip || ctx.req.socket?.remoteAddress,
        userAgent: ctx.req.headers["user-agent"],
      };

      return await gdprService.requestAccountDeletion(
        ctx.user.id,
        input.reason,
        input.deletionType,
        requestContext
      );
    }),

  /**
   * Confirm account deletion
   * User must confirm deletion using the token sent via email
   */
  confirmDeletion: protectedProcedure
    .input(
      z.object({
        confirmationToken: z.string().length(64),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const requestContext = {
        ipAddress: ctx.req.ip || ctx.req.socket?.remoteAddress,
        userAgent: ctx.req.headers["user-agent"],
      };

      return await gdprService.confirmAccountDeletion(
        ctx.user.id,
        input.confirmationToken,
        requestContext
      );
    }),

  /**
   * Cancel account deletion request
   * Allows user to cancel pending deletion during grace period
   */
  cancelDeletion: protectedProcedure.mutation(async ({ ctx }) => {
    const requestContext = {
      ipAddress: ctx.req.ip || ctx.req.socket?.remoteAddress,
      userAgent: ctx.req.headers["user-agent"],
    };

    return await gdprService.cancelAccountDeletion(ctx.user.id, requestContext);
  }),

  /**
   * Get account deletion status
   * Check if there's a pending deletion request
   */
  getDeletionStatus: protectedProcedure.query(async ({ ctx }) => {
    return await gdprService.getDeletionStatus(ctx.user.id);
  }),

  /**
   * Get privacy dashboard data
   * Aggregated view of all GDPR-related user data
   */
  getPrivacyDashboard: protectedProcedure.query(async ({ ctx }) => {
    const requestContext = {
      ipAddress: ctx.req.ip || ctx.req.socket?.remoteAddress,
      userAgent: ctx.req.headers["user-agent"],
    };

    const [consentStatus, deletionStatus, exportHistory, consentHistory] =
      await Promise.all([
        gdprService.getConsentStatus(ctx.user.id, requestContext),
        gdprService.getDeletionStatus(ctx.user.id),
        gdprService.getExportHistory(ctx.user.id, 5),
        gdprService.getConsentHistory(ctx.user.id, 10),
      ]);

    return {
      consent: consentStatus,
      deletion: deletionStatus,
      recentExports: exportHistory,
      recentConsentChanges: consentHistory,
    };
  }),
});
