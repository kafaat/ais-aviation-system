import { z } from "zod";
import {
  router,
  publicProcedure,
  protectedProcedure,
  adminProcedure,
} from "../_core/trpc";
import * as consentService from "../services/consent.service";

/**
 * Cookie Consent Router
 *
 * Handles cookie consent management for GDPR/ePrivacy compliance:
 * - recordConsent: public (works for both anonymous and authenticated users)
 * - getMyConsent: protected (returns current user's latest consent)
 * - updateConsent: protected (record updated preferences for authenticated user)
 * - getConsentStats: admin-only (aggregate consent statistics dashboard)
 */
export const consentRouter = router({
  /**
   * Record cookie consent preferences.
   * Public procedure so it works for anonymous visitors too.
   * Each call appends a new record for a full audit trail.
   */
  recordConsent: publicProcedure
    .input(
      z.object({
        essential: z.boolean().default(true),
        analytics: z.boolean(),
        marketing: z.boolean(),
        preferences: z.boolean(),
        consentVersion: z.string().max(20).default("1.0"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const requestContext = {
        ipAddress: ctx.req.ip || ctx.req.socket?.remoteAddress,
        userAgent: ctx.req.headers["user-agent"],
      };

      const userId = ctx.user?.id ?? null;

      return await consentService.recordConsent(
        {
          essential: true, // always true
          analytics: input.analytics,
          marketing: input.marketing,
          preferences: input.preferences,
          consentVersion: input.consentVersion,
        },
        userId,
        requestContext
      );
    }),

  /**
   * Get the current user's most recent consent record.
   * Also indicates whether re-consent is needed (policy version changed).
   */
  getMyConsent: protectedProcedure.query(async ({ ctx }) => {
    return await consentService.getMyConsent(ctx.user.id);
  }),

  /**
   * Update consent preferences for an authenticated user.
   * Creates a new audit-trail record rather than mutating in place.
   */
  updateConsent: protectedProcedure
    .input(
      z.object({
        essential: z.boolean().default(true),
        analytics: z.boolean(),
        marketing: z.boolean(),
        preferences: z.boolean(),
        consentVersion: z.string().max(20).default("1.0"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const requestContext = {
        ipAddress: ctx.req.ip || ctx.req.socket?.remoteAddress,
        userAgent: ctx.req.headers["user-agent"],
      };

      return await consentService.updateConsent(
        ctx.user.id,
        {
          essential: true,
          analytics: input.analytics,
          marketing: input.marketing,
          preferences: input.preferences,
          consentVersion: input.consentVersion,
        },
        requestContext
      );
    }),

  /**
   * Admin-only: get aggregate consent statistics.
   * Shows total records, unique users, and acceptance rates per category.
   */
  getConsentStats: adminProcedure.query(async () => {
    return await consentService.getConsentStats();
  }),
});
