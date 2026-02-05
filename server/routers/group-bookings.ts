import { z } from "zod";
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import * as groupBookingService from "../services/group-booking.service";

/**
 * Group Bookings Router
 * Handles all group booking-related operations (10+ passengers)
 */
export const groupBookingsRouter = router({
  /**
   * Submit a new group booking request (public - no auth required)
   */
  submitRequest: publicProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/group-bookings/request",
        tags: ["Group Bookings"],
        summary: "Submit a group booking request",
        description:
          "Submit a new group booking request for 10 or more passengers. The request will be reviewed by an admin who will apply the appropriate discount.",
      },
    })
    .input(
      z.object({
        organizerName: z
          .string()
          .min(1)
          .describe("Name of the group organizer"),
        organizerEmail: z.string().email().describe("Email of the organizer"),
        organizerPhone: z
          .string()
          .min(5)
          .describe("Phone number of the organizer"),
        groupSize: z
          .number()
          .min(10, "Group size must be at least 10 passengers")
          .describe("Number of passengers in the group"),
        flightId: z.number().describe("ID of the flight to book"),
        notes: z
          .string()
          .optional()
          .describe("Additional notes or special requests"),
      })
    )
    .output(
      z.object({
        id: z.number(),
        suggestedDiscount: z.number(),
        message: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await groupBookingService.createGroupBookingRequest(input);
      return {
        ...result,
        message: `Group booking request submitted successfully. You will receive an email at ${input.organizerEmail} once it's reviewed.`,
      };
    }),

  /**
   * Calculate expected discount based on group size (public)
   */
  calculateDiscount: publicProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/group-bookings/calculate-discount",
        tags: ["Group Bookings"],
        summary: "Calculate group discount",
        description:
          "Calculate the expected discount percentage based on group size. 10-19 passengers: 5%, 20-49: 10%, 50+: 15%",
      },
    })
    .input(
      z.object({
        groupSize: z
          .number()
          .min(1)
          .describe("Number of passengers in the group"),
      })
    )
    .output(
      z.object({
        groupSize: z.number(),
        discountPercent: z.number(),
        tier: z.string(),
        eligible: z.boolean(),
      })
    )
    .query(({ input }) => {
      const discount = groupBookingService.calculateGroupDiscount(
        input.groupSize
      );
      const eligible = input.groupSize >= groupBookingService.MIN_GROUP_SIZE;

      let tier = "Not eligible";
      if (input.groupSize >= 50) {
        tier = "Large (50+)";
      } else if (input.groupSize >= 20) {
        tier = "Medium (20-49)";
      } else if (input.groupSize >= 10) {
        tier = "Small (10-19)";
      }

      return {
        groupSize: input.groupSize,
        discountPercent: discount,
        tier,
        eligible,
      };
    }),

  /**
   * Get all group booking requests (admin only)
   */
  list: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/group-bookings",
        tags: ["Group Bookings"],
        summary: "List all group booking requests",
        description:
          "Get all group booking requests with optional status filter. Admin only.",
        protect: true,
      },
    })
    .input(
      z
        .object({
          status: z
            .enum(["pending", "confirmed", "cancelled"])
            .optional()
            .describe("Filter by status"),
          flightId: z.number().optional().describe("Filter by flight ID"),
        })
        .optional()
    )
    .query(async ({ input }) => {
      return await groupBookingService.getGroupBookingsWithFlightDetails(input);
    }),

  /**
   * Get group booking statistics (admin only)
   */
  getStats: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/group-bookings/stats",
        tags: ["Group Bookings"],
        summary: "Get group booking statistics",
        description: "Get statistics about group booking requests. Admin only.",
        protect: true,
      },
    })
    .query(async () => {
      return await groupBookingService.getGroupBookingStats();
    }),

  /**
   * Get a single group booking by ID (admin only)
   */
  getById: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/group-bookings/{id}",
        tags: ["Group Bookings"],
        summary: "Get group booking by ID",
        description:
          "Get details of a specific group booking request. Admin only.",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z.number().describe("Group booking ID"),
      })
    )
    .query(async ({ input }) => {
      const booking = await groupBookingService.getGroupBookingById(input.id);
      if (!booking) {
        throw new Error("Group booking not found");
      }
      return booking;
    }),

  /**
   * Approve a group booking request (admin only)
   */
  approve: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/group-bookings/{id}/approve",
        tags: ["Group Bookings"],
        summary: "Approve a group booking request",
        description:
          "Approve a pending group booking request with a specified discount percentage. Admin only.",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z.number().describe("Group booking ID"),
        discountPercent: z
          .number()
          .min(0)
          .max(50)
          .describe("Discount percentage to apply (0-50%)"),
      })
    )
    .output(
      z.object({
        success: z.boolean(),
        booking: z.any(),
        message: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const booking = await groupBookingService.approveGroupBooking(
        input.id,
        input.discountPercent,
        ctx.user.id
      );
      return {
        success: true,
        booking,
        message: `Group booking approved with ${input.discountPercent}% discount`,
      };
    }),

  /**
   * Reject a group booking request (admin only)
   */
  reject: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/group-bookings/{id}/reject",
        tags: ["Group Bookings"],
        summary: "Reject a group booking request",
        description:
          "Reject a pending group booking request with a reason. Admin only.",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z.number().describe("Group booking ID"),
        reason: z.string().min(1).describe("Reason for rejection"),
      })
    )
    .output(
      z.object({
        success: z.boolean(),
        booking: z.any(),
        message: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const booking = await groupBookingService.rejectGroupBooking(
        input.id,
        input.reason
      );
      return {
        success: true,
        booking,
        message: "Group booking request rejected",
      };
    }),

  /**
   * Get discount tiers information (public)
   */
  getDiscountTiers: publicProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/group-bookings/discount-tiers",
        tags: ["Group Bookings"],
        summary: "Get discount tiers information",
        description: "Get information about the group booking discount tiers.",
      },
    })
    .query(() => {
      return {
        minGroupSize: groupBookingService.MIN_GROUP_SIZE,
        tiers: [
          {
            name: "Small Group",
            minPassengers: 10,
            maxPassengers: 19,
            discountPercent: 5,
          },
          {
            name: "Medium Group",
            minPassengers: 20,
            maxPassengers: 49,
            discountPercent: 10,
          },
          {
            name: "Large Group",
            minPassengers: 50,
            maxPassengers: null,
            discountPercent: 15,
          },
        ],
      };
    }),
});
