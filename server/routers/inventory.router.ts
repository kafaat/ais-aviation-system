/**
 * Inventory Router
 *
 * tRPC endpoints for inventory management operations
 *
 * @module routers/inventory.router
 */

import { z } from "zod";
import {
  router,
  publicProcedure,
  protectedProcedure,
  adminProcedure,
} from "../_core/trpc";
import { InventoryService } from "../services/inventory/inventory.service";
import { TRPCError } from "@trpc/server";

// ============================================================================
// Input Schemas
// ============================================================================

const getInventoryStatusInput = z.object({
  flightId: z.number().int().positive(),
  cabinClass: z.enum(["economy", "business"]),
});

const allocateSeatsInput = z.object({
  flightId: z.number().int().positive(),
  cabinClass: z.enum(["economy", "business"]),
  seats: z.number().int().min(1).max(9),
  sessionId: z.string().min(1),
});

const releaseHoldInput = z.object({
  holdId: z.number().int().positive(),
});

const addToWaitlistInput = z.object({
  flightId: z.number().int().positive(),
  cabinClass: z.enum(["economy", "business"]),
  seats: z.number().int().min(1).max(9),
});

const removeFromWaitlistInput = z.object({
  waitlistId: z.number().int().positive(),
  reason: z.enum(["confirmed", "cancelled", "expired"]),
});

const forecastDemandInput = z.object({
  flightId: z.number().int().positive(),
  daysAhead: z.number().int().min(1).max(90).default(30),
});

// ============================================================================
// Router Definition
// ============================================================================

export const inventoryRouter = router({
  /**
   * Get real-time inventory status for a flight
   */
  getStatus: publicProcedure
    .input(getInventoryStatusInput)
    .query(async ({ input }) => {
      try {
        const status = await InventoryService.getInventoryStatus(
          input.flightId,
          input.cabinClass
        );

        return {
          success: true,
          data: {
            ...status,
            statusLabel: getStatusLabel(status.status),
            statusLabelAr: getStatusLabelAr(status.status),
          },
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to get inventory status",
        });
      }
    }),

  /**
   * Allocate seats (create hold)
   */
  allocateSeats: protectedProcedure
    .input(allocateSeatsInput)
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await InventoryService.allocateSeats(
          input.flightId,
          input.cabinClass,
          input.seats,
          ctx.user.id,
          input.sessionId
        );

        return {
          success: result.success,
          data: result,
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Failed to allocate seats",
        });
      }
    }),

  /**
   * Release a seat hold
   */
  releaseHold: protectedProcedure
    .input(releaseHoldInput)
    .mutation(async ({ input }) => {
      try {
        await InventoryService.releaseSeatHold(input.holdId);

        return {
          success: true,
          message: "Seat hold released successfully",
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Failed to release hold",
        });
      }
    }),

  /**
   * Add to waitlist
   */
  addToWaitlist: protectedProcedure
    .input(addToWaitlistInput)
    .mutation(async ({ input, ctx }) => {
      try {
        const entry = await InventoryService.addToWaitlist(
          input.flightId,
          input.cabinClass,
          input.seats,
          ctx.user.id
        );

        return {
          success: true,
          data: {
            ...entry,
            message: `Added to waitlist at position ${entry.priority}`,
            messageAr: `تمت الإضافة إلى قائمة الانتظار في المركز ${entry.priority}`,
          },
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to add to waitlist",
        });
      }
    }),

  /**
   * Remove from waitlist
   */
  removeFromWaitlist: protectedProcedure
    .input(removeFromWaitlistInput)
    .mutation(async ({ input }) => {
      try {
        await InventoryService.removeFromWaitlist(
          input.waitlistId,
          input.reason
        );

        return {
          success: true,
          message: "Removed from waitlist successfully",
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to remove from waitlist",
        });
      }
    }),

  /**
   * Get demand forecast
   */
  getForecast: adminProcedure
    .input(forecastDemandInput)
    .query(async ({ input }) => {
      try {
        const forecast = await InventoryService.forecastDemand(
          input.flightId,
          input.daysAhead
        );

        return {
          success: true,
          data: forecast,
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Failed to get forecast",
        });
      }
    }),

  /**
   * Get recommended overbooking
   */
  getRecommendedOverbooking: adminProcedure
    .input(z.object({ flightId: z.number().int().positive() }))
    .query(async ({ input }) => {
      try {
        const recommendation =
          await InventoryService.calculateRecommendedOverbooking(
            input.flightId
          );

        return {
          success: true,
          data: recommendation,
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to get recommendation",
        });
      }
    }),

  /**
   * Handle denied boarding
   */
  handleDeniedBoarding: adminProcedure
    .input(
      z.object({
        flightId: z.number().int().positive(),
        cabinClass: z.enum(["economy", "business"]),
        seatsNeeded: z.number().int().min(1),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await InventoryService.handleDeniedBoarding(
          input.flightId,
          input.cabinClass,
          input.seatsNeeded
        );

        return {
          success: true,
          data: result,
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to handle denied boarding",
        });
      }
    }),

  /**
   * Record denied boarding incident
   */
  recordDeniedBoarding: adminProcedure
    .input(
      z.object({
        flightId: z.number().int().positive(),
        bookingId: z.number().int().positive(),
        userId: z.number().int().positive(),
        type: z.enum(["voluntary", "involuntary"]),
        compensationAmount: z.number().int().min(0),
        compensationType: z.enum(["cash", "voucher", "miles"]),
        alternativeFlightId: z.number().int().positive().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await InventoryService.recordDeniedBoarding(input);
        return { success: true, data: result };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to record denied boarding",
        });
      }
    }),

  /**
   * Get denied boarding records for a flight
   */
  getDeniedBoardingRecords: adminProcedure
    .input(z.object({ flightId: z.number().int().positive() }))
    .query(async ({ input }) => {
      try {
        const records = await InventoryService.getDeniedBoardingRecords(
          input.flightId
        );
        return { success: true, data: records };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to get denied boarding records",
        });
      }
    }),

  /**
   * Update denied boarding record status
   */
  updateDeniedBoardingStatus: adminProcedure
    .input(
      z.object({
        recordId: z.number().int().positive(),
        status: z.enum(["accepted", "rejected", "completed"]),
      })
    )
    .mutation(async ({ input }) => {
      try {
        await InventoryService.updateDeniedBoardingStatus(
          input.recordId,
          input.status
        );
        return { success: true };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to update denied boarding status",
        });
      }
    }),

  /**
   * Get all overbooking configurations
   */
  getOverbookingConfigs: adminProcedure.query(async () => {
    try {
      const configs = await InventoryService.getOverbookingConfigs();
      return { success: true, data: configs };
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error
            ? error.message
            : "Failed to get overbooking configs",
      });
    }
  }),

  /**
   * Create overbooking configuration
   */
  createOverbookingConfig: adminProcedure
    .input(
      z.object({
        airlineId: z.number().int().positive().optional(),
        originId: z.number().int().positive().optional(),
        destinationId: z.number().int().positive().optional(),
        economyRate: z.string(),
        businessRate: z.string(),
        maxOverbooking: z.number().int().min(0).max(50),
        historicalNoShowRate: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await InventoryService.upsertOverbookingConfig(input);
        return { success: true, data: result };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to create overbooking config",
        });
      }
    }),

  /**
   * Expire old holds (admin/system)
   */
  expireOldHolds: adminProcedure.mutation(async () => {
    try {
      const count = await InventoryService.expireOldHolds();

      return {
        success: true,
        data: {
          expiredCount: count,
          message: `Expired ${count} old seat holds`,
        },
      };
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Failed to expire holds",
      });
    }
  }),

  /**
   * Process waitlist (admin/system)
   */
  processWaitlist: adminProcedure
    .input(getInventoryStatusInput)
    .mutation(async ({ input }) => {
      try {
        const seatsOffered = await InventoryService.processWaitlist(
          input.flightId,
          input.cabinClass
        );

        return {
          success: true,
          data: { seatsOffered },
          message: `Waitlist processed, ${seatsOffered} seats offered`,
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to process waitlist",
        });
      }
    }),
});

// ============================================================================
// Helper Functions
// ============================================================================

function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    available: "Available",
    limited: "Limited Availability",
    waitlist_only: "Waitlist Only",
    closed: "Sold Out",
  };
  return labels[status] || status;
}

function getStatusLabelAr(status: string): string {
  const labels: Record<string, string> = {
    available: "متاح",
    limited: "توفر محدود",
    waitlist_only: "قائمة انتظار فقط",
    closed: "نفذت الكمية",
  };
  return labels[status] || status;
}

export type InventoryRouter = typeof inventoryRouter;
