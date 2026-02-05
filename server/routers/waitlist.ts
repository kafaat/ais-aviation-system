import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import * as waitlistService from "../services/waitlist.service";

/**
 * Waitlist Router
 * Handles waitlist operations for fully booked flights
 */
export const waitlistRouter = router({
  /**
   * Add user to waitlist for a flight
   */
  join: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/waitlist/join",
        tags: ["Waitlist"],
        summary: "Join flight waitlist",
        description:
          "Add the authenticated user to the waitlist for a fully booked flight.",
        protect: true,
      },
    })
    .input(
      z.object({
        flightId: z.number().describe("ID of the flight to join waitlist for"),
        passengers: z.number().min(1).max(9).describe("Number of passengers"),
        cabinClass: z
          .enum(["economy", "business"])
          .describe("Cabin class preference"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await waitlistService.addToWaitlist(
        ctx.user.id,
        input.flightId,
        input.passengers,
        input.cabinClass
      );
    }),

  /**
   * Get user's position on waitlist for a flight
   */
  getPosition: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/waitlist/position",
        tags: ["Waitlist"],
        summary: "Get waitlist position",
        description:
          "Get the authenticated user's position on the waitlist for a specific flight.",
        protect: true,
      },
    })
    .input(
      z.object({
        flightId: z.number().describe("ID of the flight"),
        cabinClass: z.enum(["economy", "business"]).describe("Cabin class"),
      })
    )
    .query(async ({ ctx, input }) => {
      return await waitlistService.getWaitlistPosition(
        ctx.user.id,
        input.flightId,
        input.cabinClass
      );
    }),

  /**
   * Get all waitlist entries for the authenticated user
   */
  myWaitlist: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/waitlist/my",
        tags: ["Waitlist"],
        summary: "Get my waitlist entries",
        description:
          "Get all waitlist entries for the authenticated user across all flights.",
        protect: true,
      },
    })
    .query(async ({ ctx }) => {
      return await waitlistService.getUserWaitlist(ctx.user.id);
    }),

  /**
   * Accept a waitlist offer
   */
  acceptOffer: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/waitlist/accept",
        tags: ["Waitlist"],
        summary: "Accept waitlist offer",
        description:
          "Accept an offer from the waitlist to book the flight. User must proceed to payment within the offer window.",
        protect: true,
      },
    })
    .input(
      z.object({
        waitlistId: z.number().describe("ID of the waitlist entry"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await waitlistService.acceptOffer(input.waitlistId, ctx.user.id);
    }),

  /**
   * Decline a waitlist offer
   */
  declineOffer: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/waitlist/decline",
        tags: ["Waitlist"],
        summary: "Decline waitlist offer",
        description:
          "Decline an offer from the waitlist. The seat will be offered to the next person in queue.",
        protect: true,
      },
    })
    .input(
      z.object({
        waitlistId: z.number().describe("ID of the waitlist entry"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await waitlistService.declineOffer(input.waitlistId, ctx.user.id);
    }),

  /**
   * Cancel waitlist entry
   */
  cancel: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/waitlist/cancel",
        tags: ["Waitlist"],
        summary: "Cancel waitlist entry",
        description: "Remove yourself from the waitlist for a flight.",
        protect: true,
      },
    })
    .input(
      z.object({
        waitlistId: z.number().describe("ID of the waitlist entry to cancel"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await waitlistService.cancelWaitlistEntry(
        input.waitlistId,
        ctx.user.id
      );
    }),

  /**
   * Update notification preferences
   */
  updateNotifications: protectedProcedure
    .meta({
      openapi: {
        method: "PUT",
        path: "/waitlist/notifications",
        tags: ["Waitlist"],
        summary: "Update notification preferences",
        description:
          "Update how you want to be notified when a seat becomes available.",
        protect: true,
      },
    })
    .input(
      z.object({
        waitlistId: z.number().describe("ID of the waitlist entry"),
        notifyByEmail: z.boolean().describe("Receive email notifications"),
        notifyBySms: z.boolean().describe("Receive SMS notifications"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await waitlistService.updateNotificationPreferences(
        input.waitlistId,
        ctx.user.id,
        input.notifyByEmail,
        input.notifyBySms
      );
    }),

  // ============================================================================
  // Admin Endpoints
  // ============================================================================

  /**
   * Get waitlist for a specific flight (admin only)
   */
  getFlightWaitlist: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/admin/waitlist/flight/{flightId}",
        tags: ["Waitlist", "Admin"],
        summary: "Get flight waitlist",
        description:
          "Admin endpoint to view the complete waitlist for a specific flight.",
        protect: true,
      },
    })
    .input(
      z.object({
        flightId: z.number().describe("ID of the flight"),
      })
    )
    .query(async ({ input }) => {
      return await waitlistService.getFlightWaitlist(input.flightId);
    }),

  /**
   * Manually offer seat to waitlist entry (admin only)
   */
  offerSeat: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/admin/waitlist/offer",
        tags: ["Waitlist", "Admin"],
        summary: "Offer seat to waitlist entry",
        description:
          "Admin endpoint to manually offer a seat to a specific waitlist entry.",
        protect: true,
      },
    })
    .input(
      z.object({
        waitlistId: z.number().describe("ID of the waitlist entry"),
      })
    )
    .mutation(async ({ input }) => {
      return await waitlistService.offerSeat(input.waitlistId);
    }),

  /**
   * Process waitlist for a flight (admin only)
   */
  processWaitlist: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/admin/waitlist/process",
        tags: ["Waitlist", "Admin"],
        summary: "Process flight waitlist",
        description:
          "Admin endpoint to manually trigger waitlist processing for a flight when seats become available.",
        protect: true,
      },
    })
    .input(
      z.object({
        flightId: z.number().describe("ID of the flight"),
      })
    )
    .mutation(async ({ input }) => {
      return await waitlistService.processWaitlist(input.flightId);
    }),

  /**
   * Process expired offers (admin only)
   */
  processExpiredOffers: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/admin/waitlist/process-expired",
        tags: ["Waitlist", "Admin"],
        summary: "Process expired offers",
        description:
          "Admin endpoint to manually trigger processing of expired waitlist offers.",
        protect: true,
      },
    })
    .mutation(async () => {
      return await waitlistService.processExpiredOffers();
    }),

  /**
   * Get waitlist statistics (admin only)
   */
  getStats: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/admin/waitlist/stats",
        tags: ["Waitlist", "Admin"],
        summary: "Get waitlist statistics",
        description:
          "Admin endpoint to get overall waitlist statistics for the dashboard.",
        protect: true,
      },
    })
    .query(async () => {
      return await waitlistService.getWaitlistStats();
    }),
});
