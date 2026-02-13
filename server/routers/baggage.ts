import { z } from "zod";
import {
  publicProcedure,
  protectedProcedure,
  adminProcedure,
  router,
} from "../_core/trpc";
import * as baggageService from "../services/baggage.service";
import { TRPCError } from "@trpc/server";

// Baggage status enum for validation
const baggageStatusEnum = z.enum([
  "checked_in",
  "security_screening",
  "loading",
  "in_transit",
  "arrived",
  "customs",
  "ready_for_pickup",
  "claimed",
  "lost",
  "found",
  "damaged",
]);

/**
 * Baggage Router
 * Handles baggage registration, tracking, and management
 */
export const baggageRouter = router({
  /**
   * Track baggage by tag number (public - no auth required for passengers to track)
   */
  track: publicProcedure
    .input(
      z.object({
        tagNumber: z.string().min(1).max(20),
      })
    )
    .query(async ({ input }) => {
      try {
        const result = await baggageService.trackBaggage(input.tagNumber);
        return result;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to track baggage";
        throw new TRPCError({
          code: "NOT_FOUND",
          message,
        });
      }
    }),

  /**
   * Get baggage by tag number
   */
  getByTag: publicProcedure
    .input(
      z.object({
        tagNumber: z.string().min(1).max(20),
      })
    )
    .query(async ({ input }) => {
      const baggage = await baggageService.getBaggageByTag(input.tagNumber);
      if (!baggage) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Baggage not found",
        });
      }
      return baggage;
    }),

  /**
   * Register new baggage for a booking
   * Protected - requires authenticated user
   */
  register: protectedProcedure
    .input(
      z.object({
        bookingId: z.number(),
        passengerId: z.number(),
        weight: z.number().positive().max(32),
        description: z.string().max(500).optional(),
        specialHandling: z.string().max(255).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const baggage = await baggageService.registerBaggage({
          bookingId: input.bookingId,
          passengerId: input.passengerId,
          weight: input.weight,
          description: input.description,
          specialHandling: input.specialHandling,
        });

        return {
          success: true,
          baggage,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to register baggage";
        throw new TRPCError({
          code: "BAD_REQUEST",
          message,
        });
      }
    }),

  /**
   * Get all baggage for a booking
   * Protected - requires authenticated user
   */
  getBookingBaggage: protectedProcedure
    .input(
      z.object({
        bookingId: z.number(),
      })
    )
    .query(async ({ input }) => {
      try {
        const baggage = await baggageService.getBookingBaggage(input.bookingId);
        return baggage;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to get baggage";
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message,
        });
      }
    }),

  /**
   * Get all baggage for a passenger
   * Protected - requires authenticated user
   */
  getPassengerBaggage: protectedProcedure
    .input(
      z.object({
        passengerId: z.number(),
      })
    )
    .query(async ({ input }) => {
      try {
        const baggage = await baggageService.getPassengerBaggage(
          input.passengerId
        );
        return baggage;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to get baggage";
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message,
        });
      }
    }),

  /**
   * Report lost baggage
   * Protected - requires authenticated user
   */
  reportLost: protectedProcedure
    .input(
      z.object({
        tagNumber: z.string().min(1).max(20),
        description: z.string().min(10).max(1000),
        contactEmail: z.string().email().optional(),
        contactPhone: z.string().max(20).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await baggageService.reportLostBaggage({
          tagNumber: input.tagNumber,
          description: input.description,
          contactEmail: input.contactEmail,
          contactPhone: input.contactPhone,
        });

        return result;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to report lost baggage";
        throw new TRPCError({
          code: "BAD_REQUEST",
          message,
        });
      }
    }),

  /**
   * Get status labels
   * Public endpoint for UI
   */
  getStatusLabels: publicProcedure.query(() => {
    return baggageService.BAGGAGE_STATUS_LABELS;
  }),

  // =================== Admin Endpoints ===================

  /**
   * Admin: Update baggage status
   */
  adminUpdateStatus: adminProcedure
    .input(
      z.object({
        tagNumber: z.string().min(1).max(20),
        location: z.string().min(1).max(255),
        status: baggageStatusEnum,
        notes: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await baggageService.updateBaggageStatus({
          tagNumber: input.tagNumber,
          location: input.location,
          status: input.status,
          scannedBy: ctx.user.id,
          notes: input.notes,
        });

        return result;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to update baggage status";
        throw new TRPCError({
          code: "BAD_REQUEST",
          message,
        });
      }
    }),

  /**
   * Admin: Get all baggage with optional filters
   */
  adminGetAll: adminProcedure
    .input(
      z
        .object({
          status: baggageStatusEnum.optional(),
          bookingId: z.number().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      try {
        const baggage = await baggageService.getAllBaggage(input);
        return baggage;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to get baggage";
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message,
        });
      }
    }),

  /**
   * Admin: Get lost baggage
   */
  adminGetLost: adminProcedure.query(async () => {
    try {
      const baggage = await baggageService.getLostBaggage();
      return baggage;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to get lost baggage";
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message,
      });
    }
  }),

  /**
   * Admin: Mark baggage as found
   */
  adminMarkFound: adminProcedure
    .input(
      z.object({
        tagNumber: z.string().min(1).max(20),
        foundLocation: z.string().min(1).max(255),
        notes: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await baggageService.markBaggageFound({
          tagNumber: input.tagNumber,
          foundLocation: input.foundLocation,
          scannedBy: ctx.user.id,
          notes: input.notes,
        });

        return result;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to mark baggage as found";
        throw new TRPCError({
          code: "BAD_REQUEST",
          message,
        });
      }
    }),

  /**
   * Admin: Get baggage statistics
   */
  adminGetStats: adminProcedure.query(async () => {
    try {
      const stats = await baggageService.getBaggageStats();
      return stats;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to get baggage statistics";
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message,
      });
    }
  }),

  /**
   * Admin: Get baggage by status
   */
  adminGetByStatus: adminProcedure
    .input(
      z.object({
        status: baggageStatusEnum,
      })
    )
    .query(async ({ input }) => {
      try {
        const baggage = await baggageService.getBaggageByStatus(input.status);
        return baggage;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to get baggage";
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message,
        });
      }
    }),
});
