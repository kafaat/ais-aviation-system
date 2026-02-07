import { z } from "zod";
import {
  publicProcedure,
  protectedProcedure,
  adminProcedure,
  router,
} from "../_core/trpc";
import * as voucherService from "../services/voucher.service";

/**
 * Vouchers Router
 * Handles voucher and credit operations
 */
export const vouchersRouter = router({
  // ============================================================================
  // Public Endpoints
  // ============================================================================

  /**
   * Validate a voucher code
   * Can be used by anyone to check if a voucher is valid
   */
  validate: publicProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/vouchers/validate",
        tags: ["Vouchers"],
        summary: "Validate voucher code",
        description:
          "Check if a voucher code is valid and get the discount amount for a given purchase amount.",
      },
    })
    .input(
      z.object({
        code: z.string().min(1).max(50).describe("Voucher code to validate"),
        amount: z
          .number()
          .min(0)
          .describe("Purchase amount in cents to calculate discount"),
      })
    )
    .mutation(async ({ input }) => {
      return await voucherService.validateVoucher(input.code, input.amount);
    }),

  // ============================================================================
  // Protected Endpoints (Authenticated Users)
  // ============================================================================

  /**
   * Apply a voucher to a booking
   */
  applyVoucher: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/vouchers/apply",
        tags: ["Vouchers"],
        summary: "Apply voucher to booking",
        description:
          "Apply a voucher code to a booking and record the usage. Returns the discount amount.",
        protect: true,
      },
    })
    .input(
      z.object({
        code: z.string().min(1).max(50).describe("Voucher code to apply"),
        bookingId: z.number().describe("Booking ID to apply voucher to"),
        amount: z.number().min(0).describe("Booking amount in cents"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await voucherService.applyVoucher(
        input.code,
        input.bookingId,
        ctx.user.id,
        input.amount
      );
    }),

  /**
   * Get user's available credit balance
   */
  myCredits: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/credits/balance",
        tags: ["Credits"],
        summary: "Get my credit balance",
        description:
          "Get the authenticated user's available credit balance and breakdown.",
        protect: true,
      },
    })
    .query(async ({ ctx }) => {
      return await voucherService.getAvailableBalance(ctx.user.id);
    }),

  /**
   * Get user's credit history
   */
  myCreditHistory: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/credits/history",
        tags: ["Credits"],
        summary: "Get my credit history",
        description: "Get the authenticated user's credit records.",
        protect: true,
      },
    })
    .query(async ({ ctx }) => {
      return await voucherService.getUserCredits(ctx.user.id);
    }),

  /**
   * Get user's credit usage history
   */
  myCreditUsage: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/credits/usage",
        tags: ["Credits"],
        summary: "Get my credit usage",
        description: "Get the authenticated user's credit usage history.",
        protect: true,
      },
    })
    .query(async ({ ctx }) => {
      return await voucherService.getCreditUsageHistory(ctx.user.id);
    }),

  /**
   * Use credits for a booking
   */
  useCredits: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/credits/use",
        tags: ["Credits"],
        summary: "Use credits for booking",
        description:
          "Use available credits to pay for a booking. Deducts from oldest credits first.",
        protect: true,
      },
    })
    .input(
      z.object({
        amount: z.number().min(1).describe("Amount of credits to use in cents"),
        bookingId: z.number().describe("Booking ID to apply credits to"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await voucherService.useCredit(
        ctx.user.id,
        input.amount,
        input.bookingId
      );
    }),

  // ============================================================================
  // Admin Endpoints
  // ============================================================================

  /**
   * Create a new voucher (admin only)
   */
  create: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/admin/vouchers",
        tags: ["Vouchers", "Admin"],
        summary: "Create voucher",
        description: "Admin endpoint to create a new voucher code.",
        protect: true,
      },
    })
    .input(
      z.object({
        code: z
          .string()
          .min(3)
          .max(50)
          .describe("Unique voucher code (will be uppercased)"),
        type: z.enum(["fixed", "percentage"]).describe("Type of discount"),
        value: z
          .number()
          .min(1)
          .describe("Discount value (cents for fixed, percentage for %)"),
        minPurchase: z
          .number()
          .min(0)
          .default(0)
          .describe("Minimum purchase amount in cents"),
        maxDiscount: z
          .number()
          .optional()
          .describe("Maximum discount amount in cents (for percentage)"),
        maxUses: z
          .number()
          .optional()
          .describe("Maximum number of uses (null = unlimited)"),
        validFrom: z.date().describe("Start date"),
        validUntil: z.date().describe("Expiration date"),
        description: z.string().optional().describe("Admin notes"),
        isActive: z.boolean().default(true).describe("Active status"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await voucherService.createVoucher(input, ctx.user.id);
    }),

  /**
   * Get all vouchers (admin only)
   */
  getAll: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/admin/vouchers",
        tags: ["Vouchers", "Admin"],
        summary: "Get all vouchers",
        description: "Admin endpoint to get all vouchers.",
        protect: true,
      },
    })
    .input(
      z.object({
        includeInactive: z
          .boolean()
          .default(true)
          .describe("Include inactive vouchers"),
      })
    )
    .query(async ({ input }) => {
      return await voucherService.getAllVouchers(input.includeInactive);
    }),

  /**
   * Get voucher by ID (admin only)
   */
  getById: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/admin/vouchers/{id}",
        tags: ["Vouchers", "Admin"],
        summary: "Get voucher by ID",
        description: "Admin endpoint to get a specific voucher.",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z.number().describe("Voucher ID"),
      })
    )
    .query(async ({ input }) => {
      return await voucherService.getVoucherById(input.id);
    }),

  /**
   * Update voucher (admin only)
   */
  update: adminProcedure
    .meta({
      openapi: {
        method: "PUT",
        path: "/admin/vouchers/{id}",
        tags: ["Vouchers", "Admin"],
        summary: "Update voucher",
        description: "Admin endpoint to update a voucher.",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z.number().describe("Voucher ID"),
        type: z.enum(["fixed", "percentage"]).optional(),
        value: z.number().min(1).optional(),
        minPurchase: z.number().min(0).optional(),
        maxDiscount: z.number().optional().nullable(),
        maxUses: z.number().optional().nullable(),
        validFrom: z.date().optional(),
        validUntil: z.date().optional(),
        description: z.string().optional().nullable(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      return await voucherService.updateVoucher(id, data);
    }),

  /**
   * Deactivate voucher (admin only)
   */
  deactivate: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/admin/vouchers/{id}/deactivate",
        tags: ["Vouchers", "Admin"],
        summary: "Deactivate voucher",
        description: "Admin endpoint to deactivate a voucher.",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z.number().describe("Voucher ID"),
      })
    )
    .mutation(async ({ input }) => {
      return await voucherService.deactivateVoucher(input.id);
    }),

  /**
   * Get voucher usage history (admin only)
   */
  getUsageHistory: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/admin/vouchers/{id}/usage",
        tags: ["Vouchers", "Admin"],
        summary: "Get voucher usage history",
        description: "Admin endpoint to get voucher usage history.",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z.number().describe("Voucher ID"),
      })
    )
    .query(async ({ input }) => {
      return await voucherService.getVoucherUsageHistory(input.id);
    }),

  /**
   * Add credit to a user (admin only)
   */
  addCredit: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/admin/credits",
        tags: ["Credits", "Admin"],
        summary: "Add credit to user",
        description: "Admin endpoint to add credit to a user's account.",
        protect: true,
      },
    })
    .input(
      z.object({
        userId: z.number().describe("User ID to add credit to"),
        amount: z.number().min(1).describe("Credit amount in cents"),
        source: z
          .enum(["refund", "promo", "compensation", "bonus"])
          .describe("Source of credit"),
        description: z.string().describe("Description of credit"),
        expiresAt: z.date().optional().describe("Expiration date"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await voucherService.addCredit(
        input.userId,
        input.amount,
        input.source,
        input.description,
        {
          expiresAt: input.expiresAt,
          createdBy: ctx.user.id,
        }
      );
    }),

  /**
   * Get user credits (admin only)
   */
  getUserCredits: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/admin/credits/user/{userId}",
        tags: ["Credits", "Admin"],
        summary: "Get user credits",
        description: "Admin endpoint to get a user's credit balance.",
        protect: true,
      },
    })
    .input(
      z.object({
        userId: z.number().describe("User ID"),
      })
    )
    .query(async ({ input }) => {
      return await voucherService.getAvailableBalance(input.userId);
    }),

  /**
   * Get all credits (admin only)
   */
  getAllCredits: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/admin/credits",
        tags: ["Credits", "Admin"],
        summary: "Get all credits",
        description: "Admin endpoint to get all credit records.",
        protect: true,
      },
    })
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50).describe("Limit"),
        offset: z.number().min(0).default(0).describe("Offset"),
      })
    )
    .query(async ({ input }) => {
      return await voucherService.getAllCredits(input.limit, input.offset);
    }),

  /**
   * Process expired credits (admin only)
   */
  processExpiredCredits: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/admin/credits/process-expired",
        tags: ["Credits", "Admin"],
        summary: "Process expired credits",
        description:
          "Admin endpoint to manually trigger expired credits processing.",
        protect: true,
      },
    })
    .mutation(async () => {
      return await voucherService.processExpiredCredits();
    }),
});
