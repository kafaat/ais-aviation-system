import { responseContracts } from "../contracts/loyalty";
import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import * as loyaltyService from "../services/loyalty.service";
import { getDb } from "../db";
import { TRPCError } from "@trpc/server";
import {
  approveValuation,
  createValuation,
  getLoyaltyAccountingSummary,
  listValuations,
} from "../services/loyalty-accounting.service";
import {
  getActiveProgramRule,
  setProgramRule,
} from "../services/loyalty-rules.service";
import {
  countPendingNotices,
  runLoyaltyLifecycle,
} from "../services/loyalty-lifecycle.service";
import { redemptionContextFromRequest } from "../services/loyalty-security.service";

function requireDb() {
  const db = getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  return db;
}

/**
 * Loyalty Router
 * Handles loyalty program operations
 */
export const loyaltyRouter = router({
  /**
   * Get user's loyalty account details
   */
  myAccount: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/loyalty/account",
        tags: ["Loyalty"],
        summary: "Get my loyalty account",
        description:
          "Retrieve the authenticated user's loyalty account details including current miles balance, tier status, and tier benefits.",
        protect: true,
      },
    })
    .output(responseContracts["myAccount"])
    .query(async ({ ctx }) => {
      return await loyaltyService.getLoyaltyAccountDetails(ctx.user.id);
    }),

  /**
   * Get miles transactions history
   */
  myTransactions: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/loyalty/transactions",
        tags: ["Loyalty"],
        summary: "Get miles transactions",
        description:
          "Retrieve the authenticated user's miles transaction history including earnings, redemptions, and expirations.",
        protect: true,
      },
    })
    .input(
      z.object({
        limit: z
          .number()
          .min(1)
          .max(100)
          .optional()
          .default(50)
          .describe("Maximum transactions to return"),
      })
    )
    .output(responseContracts["myTransactions"])
    .query(async ({ ctx, input }) => {
      return await loyaltyService.getMilesTransactions(
        ctx.user.id,
        input.limit
      );
    }),

  /**
   * Redeem miles for discount
   */
  redeemMiles: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/loyalty/redeem",
        tags: ["Loyalty"],
        summary: "Redeem miles",
        description:
          "Redeem miles for a discount on a booking. Minimum 100 miles, maximum 100,000 miles per redemption. Returns the discount value in SAR.",
        protect: true,
      },
    })
    .input(
      z.object({
        mfaToken: z
          .string()
          .regex(/^\d{6}$/)
          .optional(),
        milesToRedeem: z
          .number()
          .min(100)
          .max(100000)
          .describe("Number of miles to redeem"),
        bookingId: z
          .number()
          .optional()
          .describe("Booking ID to apply discount to"),
      })
    )
    .output(responseContracts["redeemMiles"])
    .mutation(async ({ ctx, input }) => {
      return await loyaltyService.redeemMiles(
        ctx.user.id,
        input.milesToRedeem,
        input.bookingId,
        input.mfaToken,
        redemptionContextFromRequest(ctx.req)
      );
    }),

  // ============================================================================
  // Admin Endpoints
  // ============================================================================

  /**
   * Award bonus miles to a user (admin only)
   */
  awardBonusMiles: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/admin/loyalty/award",
        tags: ["Loyalty", "Admin"],
        summary: "Award bonus miles",
        description:
          "Admin endpoint to award bonus miles to a user for promotions, compensation, or other reasons.",
        protect: true,
      },
    })
    .input(
      z.object({
        userId: z.number().describe("User ID to award miles to"),
        miles: z
          .number()
          .min(1)
          .max(1000000)
          .describe("Number of miles to award"),
        reason: z.string().min(1).max(500).describe("Reason for bonus miles"),
      })
    )
    .output(responseContracts["awardBonusMiles"])
    .mutation(async ({ input }) => {
      return await loyaltyService.awardBonusMiles(
        input.userId,
        input.miles,
        input.reason
      );
    }),

  /**
   * Reverse miles for a cancelled booking (admin only)
   */
  reverseMilesForBooking: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/admin/loyalty/reverse",
        tags: ["Loyalty", "Admin"],
        summary: "Reverse miles for booking",
        description:
          "Admin endpoint to reverse miles that were earned from a cancelled or refunded booking.",
        protect: true,
      },
    })
    .input(
      z.object({
        userId: z.number().describe("User ID"),
        bookingId: z.number().describe("Booking ID to reverse miles for"),
        reason: z.string().optional().describe("Reason for reversal"),
      })
    )
    .output(responseContracts["reverseMilesForBooking"])
    .mutation(async ({ input }) => {
      return await loyaltyService.reverseMilesForBooking(
        input.userId,
        input.bookingId,
        input.reason
      );
    }),

  /**
   * Process expired miles - runs cleanup job (admin only)
   */
  processExpiredMiles: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/admin/loyalty/process-expired",
        tags: ["Loyalty", "Admin"],
        summary: "Process expired miles",
        description:
          "Admin endpoint to manually trigger the expired miles cleanup job. Normally runs automatically on schedule.",
        protect: true,
      },
    })
    .output(responseContracts["processExpiredMiles"])
    .mutation(async () => {
      return await loyaltyService.processExpiredMiles();
    }),

  /**
   * Get loyalty account for a specific user (admin only)
   */
  getUserAccount: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/admin/loyalty/users/{userId}",
        tags: ["Loyalty", "Admin"],
        summary: "Get user loyalty account",
        description:
          "Admin endpoint to retrieve loyalty account details for any user.",
        protect: true,
      },
    })
    .input(
      z.object({
        userId: z.number().describe("User ID"),
      })
    )
    .output(responseContracts["getUserAccount"])
    .query(async ({ input }) => {
      return await loyaltyService.getLoyaltyAccountDetails(input.userId);
    }),

  /**
   * Get transactions for a specific user (admin only)
   */
  getUserTransactions: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/admin/loyalty/users/{userId}/transactions",
        tags: ["Loyalty", "Admin"],
        summary: "Get user transactions",
        description:
          "Admin endpoint to retrieve miles transaction history for any user.",
        protect: true,
      },
    })
    .input(
      z.object({
        userId: z.number().describe("User ID"),
        limit: z
          .number()
          .min(1)
          .max(100)
          .optional()
          .default(50)
          .describe("Maximum transactions to return"),
      })
    )
    .output(responseContracts["getUserTransactions"])
    .query(async ({ input }) => {
      return await loyaltyService.getMilesTransactions(
        input.userId,
        input.limit
      );
    }),

  // ============================================================================
  // Programme accounting (IFRS 15) and lifecycle — admin
  // ============================================================================

  accountingSummary: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/admin/loyalty/accounting",
        tags: ["Loyalty", "Admin"],
        summary: "Loyalty contract liability summary",
        description:
          "Outstanding miles, deferred-revenue (contract liability) balance, breakage estimate and miles expiring within 90 days. SSP and breakage approval remain a finance control outside this system.",
        protect: true,
      },
    })
    .output(responseContracts["accountingSummary"])
    .query(async () => {
      const db = requireDb();
      const [summary, pendingNotices] = await Promise.all([
        getLoyaltyAccountingSummary(db),
        countPendingNotices(db),
      ]);
      return { ...summary, pendingNotices };
    }),

  listValuations: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/admin/loyalty/valuations",
        tags: ["Loyalty", "Admin"],
        summary: "List SSP/breakage valuations",
        protect: true,
      },
    })
    .output(responseContracts["listValuations"])
    .query(async () => await listValuations(requireDb())),

  createValuation: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/admin/loyalty/valuations",
        tags: ["Loyalty", "Admin"],
        summary: "Propose a valuation (draft)",
        protect: true,
      },
    })
    .input(
      z.object({
        sspMinorPerMile: z.number().positive().max(100000),
        breakageRatePercent: z.number().min(0).max(99.99),
        effectiveFrom: z.date(),
        notes: z.string().max(1000).optional(),
      })
    )
    .output(responseContracts["createValuation"])
    .mutation(
      async ({ ctx, input }) =>
        await createValuation(requireDb(), input, ctx.user.id)
    ),

  approveValuation: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/admin/loyalty/valuations/{id}/approve",
        tags: ["Loyalty", "Admin"],
        summary: "Record valuation approval (placeholder for finance sign-off)",
        protect: true,
      },
    })
    .input(z.object({ id: z.number().int().positive() }))
    .output(responseContracts["approveValuation"])
    .mutation(
      async ({ ctx, input }) =>
        await approveValuation(requireDb(), input.id, ctx.user.id)
    ),

  getProgramRule: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/admin/loyalty/rules/active",
        tags: ["Loyalty", "Admin"],
        summary: "Active programme rule set",
        protect: true,
      },
    })
    .output(responseContracts["getProgramRule"])
    .query(async () => await getActiveProgramRule(requireDb())),

  setProgramRule: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/admin/loyalty/rules",
        tags: ["Loyalty", "Admin"],
        summary: "Activate a programme rule set from an effective date",
        protect: true,
      },
    })
    .input(
      z.object({
        name: z.string().min(1).max(100),
        effectiveFrom: z.date(),
        earningBasis: z.enum(["legacy_spend", "revenue_base_fare"]),
        milesPerSar: z.number().min(0).max(100),
        baseFareShareBps: z.number().int().min(0).max(10000),
        expiryMode: z.enum(["fixed_from_earn", "activity"]),
        expiryMonths: z.number().int().min(1).max(120),
        expiryNoticeDays: z.array(z.number().int().min(1).max(365)).max(6),
        tierQualificationMonths: z.number().int().min(1).max(36).nullable(),
        redemptionCoolingOffHours: z.number().int().min(0).max(720),
        redemptionVelocityPerDay: z.number().int().min(1).max(1000),
        profileChangeVelocityPerDay: z.number().int().min(1).max(100),
        notes: z.string().max(1000).optional(),
      })
    )
    .output(responseContracts["setProgramRule"])
    .mutation(
      async ({ ctx, input }) =>
        await setProgramRule(requireDb(), input, ctx.user.id)
    ),

  runLifecycle: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/admin/loyalty/lifecycle/run",
        tags: ["Loyalty", "Admin"],
        summary: "Run the expiry and notice lifecycle now",
        protect: true,
      },
    })
    .output(responseContracts["runLifecycle"])
    .mutation(async () => await runLoyaltyLifecycle()),
});
