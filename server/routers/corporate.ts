import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  publicProcedure,
  protectedProcedure,
  adminProcedure,
  router,
} from "../_core/trpc";
import * as corporateService from "../services/corporate.service";

/**
 * Corporate Travel Router
 * Handles all corporate travel account operations
 */
export const corporateRouter = router({
  // ============================================================================
  // Corporate Account Procedures
  // ============================================================================

  /**
   * Create a new corporate account request (public - will be pending approval)
   */
  createAccount: publicProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/corporate/accounts",
        tags: ["Corporate"],
        summary: "Create a corporate account request",
        description:
          "Submit a request for a new corporate travel account. The account will be pending until approved by an admin.",
      },
    })
    .input(
      z.object({
        companyName: z.string().min(1).describe("Company name"),
        taxId: z
          .string()
          .min(1)
          .describe("Company tax ID or registration number"),
        address: z.string().optional().describe("Company address"),
        contactName: z.string().min(1).describe("Primary contact name"),
        contactEmail: z.string().email().describe("Primary contact email"),
        contactPhone: z.string().optional().describe("Primary contact phone"),
      })
    )
    .output(
      z.object({
        success: z.boolean(),
        account: z.any(),
        message: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const account = await corporateService.createCorporateAccount(input);
      return {
        success: true,
        account,
        message:
          "Corporate account request submitted successfully. You will be notified once it is approved.",
      };
    }),

  /**
   * Get all corporate accounts (admin only)
   */
  listAccounts: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/corporate/accounts",
        tags: ["Corporate"],
        summary: "List all corporate accounts",
        description:
          "Get all corporate accounts with optional status filter. Admin only.",
        protect: true,
      },
    })
    .input(
      z
        .object({
          status: z
            .enum(["pending", "active", "suspended", "closed"])
            .optional()
            .describe("Filter by status"),
        })
        .optional()
    )
    .query(async ({ input }) => {
      return await corporateService.getCorporateAccounts(input);
    }),

  /**
   * Get a corporate account by ID (admin only)
   */
  getAccountById: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/corporate/accounts/{id}",
        tags: ["Corporate"],
        summary: "Get corporate account by ID",
        description: "Get details of a specific corporate account. Admin only.",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z.number().describe("Corporate account ID"),
      })
    )
    .query(async ({ input }) => {
      const account = await corporateService.getCorporateAccountById(input.id);
      if (!account) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Corporate account not found",
        });
      }
      return account;
    }),

  /**
   * Activate a corporate account (admin only)
   */
  activateAccount: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/corporate/accounts/{id}/activate",
        tags: ["Corporate"],
        summary: "Activate a corporate account",
        description: "Activate a pending corporate account. Admin only.",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z.number().describe("Corporate account ID"),
      })
    )
    .output(
      z.object({
        success: z.boolean(),
        account: z.any(),
        message: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const account = await corporateService.activateCorporateAccount(
        input.id,
        ctx.user.id
      );
      return {
        success: true,
        account,
        message: "Corporate account activated successfully",
      };
    }),

  /**
   * Suspend a corporate account (admin only)
   */
  suspendAccount: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/corporate/accounts/{id}/suspend",
        tags: ["Corporate"],
        summary: "Suspend a corporate account",
        description: "Suspend an active corporate account. Admin only.",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z.number().describe("Corporate account ID"),
      })
    )
    .output(
      z.object({
        success: z.boolean(),
        account: z.any(),
        message: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const account = await corporateService.suspendCorporateAccount(input.id);
      return {
        success: true,
        account,
        message: "Corporate account suspended",
      };
    }),

  /**
   * Update corporate account settings (admin only)
   */
  updateAccount: adminProcedure
    .meta({
      openapi: {
        method: "PUT",
        path: "/corporate/accounts/{id}",
        tags: ["Corporate"],
        summary: "Update corporate account",
        description: "Update corporate account settings. Admin only.",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z.number().describe("Corporate account ID"),
        companyName: z.string().optional(),
        address: z.string().optional(),
        contactName: z.string().optional(),
        contactEmail: z.string().email().optional(),
        contactPhone: z.string().optional(),
        creditLimit: z.number().min(0).optional(),
        discountPercent: z.number().min(0).max(100).optional(),
      })
    )
    .output(
      z.object({
        success: z.boolean(),
        account: z.any(),
        message: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      const account = await corporateService.updateCorporateAccount(id, data);
      return {
        success: true,
        account,
        message: "Corporate account updated successfully",
      };
    }),

  // ============================================================================
  // Corporate User Procedures
  // ============================================================================

  /**
   * Get the current user's corporate account
   */
  getMyAccount: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/corporate/my-account",
        tags: ["Corporate"],
        summary: "Get my corporate account",
        description:
          "Get the corporate account associated with the current user.",
        protect: true,
      },
    })
    .query(async ({ ctx }) => {
      return await corporateService.getUserCorporateAccount(ctx.user.id);
    }),

  /**
   * Add a user to a corporate account (admin or corporate admin)
   */
  addUser: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/corporate/accounts/{accountId}/users",
        tags: ["Corporate"],
        summary: "Add user to corporate account",
        description:
          "Add a user to a corporate account. Requires corporate admin role.",
        protect: true,
      },
    })
    .input(
      z.object({
        corporateAccountId: z.number().describe("Corporate account ID"),
        userId: z.number().describe("User ID to add"),
        role: z
          .enum(["admin", "booker", "traveler"])
          .describe("Role in the corporate account"),
      })
    )
    .output(
      z.object({
        success: z.boolean(),
        corporateUser: z.any(),
        message: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Check if current user is corporate admin or system admin
      const userAccount = await corporateService.getUserCorporateAccount(
        ctx.user.id
      );
      const isSystemAdmin = ctx.user.role === "admin";
      const isCorporateAdmin =
        userAccount?.id === input.corporateAccountId &&
        userAccount?.role === "admin";

      if (!isSystemAdmin && !isCorporateAdmin) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have permission to add users to this account",
        });
      }

      const corporateUser = await corporateService.addUserToCorporate(input);
      return {
        success: true,
        corporateUser,
        message: "User added to corporate account successfully",
      };
    }),

  /**
   * Get users in a corporate account
   */
  getUsers: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/corporate/accounts/{accountId}/users",
        tags: ["Corporate"],
        summary: "Get corporate account users",
        description: "Get all users in a corporate account.",
        protect: true,
      },
    })
    .input(
      z.object({
        corporateAccountId: z.number().describe("Corporate account ID"),
      })
    )
    .query(async ({ ctx, input }) => {
      // Check if current user is in the corporate account or is system admin
      const userAccount = await corporateService.getUserCorporateAccount(
        ctx.user.id
      );
      const isSystemAdmin = ctx.user.role === "admin";
      const isCorporateMember = userAccount?.id === input.corporateAccountId;

      if (!isSystemAdmin && !isCorporateMember) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You do not have access to this corporate account",
        });
      }

      return await corporateService.getCorporateUsers(input.corporateAccountId);
    }),

  /**
   * Remove a user from a corporate account
   */
  removeUser: protectedProcedure
    .meta({
      openapi: {
        method: "DELETE",
        path: "/corporate/users/{corporateUserId}",
        tags: ["Corporate"],
        summary: "Remove user from corporate account",
        description:
          "Remove a user from a corporate account. Requires corporate admin role.",
        protect: true,
      },
    })
    .input(
      z.object({
        corporateUserId: z.number().describe("Corporate user record ID"),
      })
    )
    .output(
      z.object({
        success: z.boolean(),
        message: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      await corporateService.removeUserFromCorporate(input.corporateUserId);
      return {
        success: true,
        message: "User removed from corporate account",
      };
    }),

  /**
   * Update a corporate user's role
   */
  updateUserRole: protectedProcedure
    .meta({
      openapi: {
        method: "PUT",
        path: "/corporate/users/{corporateUserId}/role",
        tags: ["Corporate"],
        summary: "Update corporate user role",
        description:
          "Update a user's role in a corporate account. Requires corporate admin role.",
        protect: true,
      },
    })
    .input(
      z.object({
        corporateUserId: z.number().describe("Corporate user record ID"),
        role: z.enum(["admin", "booker", "traveler"]).describe("New role"),
      })
    )
    .output(
      z.object({
        success: z.boolean(),
        corporateUser: z.any(),
        message: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const corporateUser = await corporateService.updateCorporateUserRole(
        input.corporateUserId,
        input.role
      );
      return {
        success: true,
        corporateUser,
        message: "User role updated successfully",
      };
    }),

  // ============================================================================
  // Corporate Booking Procedures
  // ============================================================================

  /**
   * Create a corporate booking
   */
  createBooking: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/corporate/bookings",
        tags: ["Corporate"],
        summary: "Create a corporate booking",
        description:
          "Create a corporate booking linked to the user's corporate account.",
        protect: true,
      },
    })
    .input(
      z.object({
        bookingId: z.number().describe("Booking ID to link"),
        costCenter: z.string().optional().describe("Cost center code"),
        projectCode: z.string().optional().describe("Project code"),
        travelPurpose: z
          .string()
          .optional()
          .describe("Business reason for travel"),
      })
    )
    .output(
      z.object({
        success: z.boolean(),
        corporateBooking: z.any(),
        message: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Get user's corporate account
      const userAccount = await corporateService.getUserCorporateAccount(
        ctx.user.id
      );
      if (!userAccount) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not a member of a corporate account",
        });
      }

      const corporateBooking = await corporateService.createCorporateBooking({
        corporateAccountId: userAccount.id,
        bookingId: input.bookingId,
        costCenter: input.costCenter,
        projectCode: input.projectCode,
        travelPurpose: input.travelPurpose,
        bookedByUserId: ctx.user.id,
      });

      return {
        success: true,
        corporateBooking,
        message: "Corporate booking created and pending approval",
      };
    }),

  /**
   * Approve a corporate booking
   */
  approveBooking: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/corporate/bookings/{id}/approve",
        tags: ["Corporate"],
        summary: "Approve a corporate booking",
        description:
          "Approve a pending corporate booking. Requires corporate admin role.",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z.number().describe("Corporate booking ID"),
      })
    )
    .output(
      z.object({
        success: z.boolean(),
        corporateBooking: z.any(),
        message: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const corporateBooking = await corporateService.approveCorporateBooking(
        input.id,
        ctx.user.id
      );
      return {
        success: true,
        corporateBooking,
        message: "Corporate booking approved",
      };
    }),

  /**
   * Reject a corporate booking
   */
  rejectBooking: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/corporate/bookings/{id}/reject",
        tags: ["Corporate"],
        summary: "Reject a corporate booking",
        description:
          "Reject a pending corporate booking. Requires corporate admin role.",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z.number().describe("Corporate booking ID"),
        reason: z.string().min(1).describe("Rejection reason"),
      })
    )
    .output(
      z.object({
        success: z.boolean(),
        corporateBooking: z.any(),
        message: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const corporateBooking = await corporateService.rejectCorporateBooking(
        input.id,
        ctx.user.id,
        input.reason
      );
      return {
        success: true,
        corporateBooking,
        message: "Corporate booking rejected",
      };
    }),

  /**
   * Get corporate bookings
   */
  getBookings: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/corporate/bookings",
        tags: ["Corporate"],
        summary: "Get corporate bookings",
        description: "Get all bookings for the user's corporate account.",
        protect: true,
      },
    })
    .input(
      z
        .object({
          approvalStatus: z
            .enum(["pending", "approved", "rejected"])
            .optional()
            .describe("Filter by approval status"),
          costCenter: z.string().optional().describe("Filter by cost center"),
          projectCode: z.string().optional().describe("Filter by project code"),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      // Get user's corporate account
      const userAccount = await corporateService.getUserCorporateAccount(
        ctx.user.id
      );
      if (!userAccount) {
        return [];
      }

      return await corporateService.getCorporateBookings(userAccount.id, input);
    }),

  /**
   * Get corporate account statistics
   */
  getStats: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/corporate/stats",
        tags: ["Corporate"],
        summary: "Get corporate account statistics",
        description: "Get statistics for the user's corporate account.",
        protect: true,
      },
    })
    .query(async ({ ctx }) => {
      // Get user's corporate account
      const userAccount = await corporateService.getUserCorporateAccount(
        ctx.user.id
      );
      if (!userAccount) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not a member of a corporate account",
        });
      }

      return await corporateService.getCorporateStats(userAccount.id);
    }),

  /**
   * Get statistics for a specific corporate account (admin only)
   */
  getAccountStats: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/corporate/accounts/{id}/stats",
        tags: ["Corporate"],
        summary: "Get corporate account statistics",
        description:
          "Get statistics for a specific corporate account. Admin only.",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z.number().describe("Corporate account ID"),
      })
    )
    .query(async ({ input }) => {
      return await corporateService.getCorporateStats(input.id);
    }),
});
