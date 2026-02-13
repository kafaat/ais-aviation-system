import { z } from "zod";
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import * as bagDropService from "../services/bag-drop.service";
import { TRPCError } from "@trpc/server";

/**
 * Bag Drop Router
 * Handles automated self-service bag drop kiosk operations:
 * weigh bags, pay excess fees, print tags, and confirm bag drop.
 */
export const bagDropRouter = router({
  /**
   * Initiate a bag drop session for a booking and passenger.
   * Public - kiosk terminals call this after boarding pass scan.
   */
  initiate: publicProcedure
    .input(
      z.object({
        bookingId: z.number().int().positive(),
        passengerId: z.number().int().positive(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const session = await bagDropService.initiateBagDrop(
          input.bookingId,
          input.passengerId
        );
        return { success: true, session };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        const message =
          error instanceof Error
            ? error.message
            : "Failed to initiate bag drop session";
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
      }
    }),

  /**
   * Scan a boarding pass barcode to identify the passenger.
   * Public - kiosk barcode scanner calls this.
   */
  scanPass: publicProcedure
    .input(
      z.object({
        barcode: z.string().min(1).max(100),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await bagDropService.scanBoardingPass(input.barcode);
        return { success: true, ...result };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        const message =
          error instanceof Error
            ? error.message
            : "Failed to scan boarding pass";
        throw new TRPCError({ code: "BAD_REQUEST", message });
      }
    }),

  /**
   * Record a bag weight for an active session.
   * Public - kiosk scale sends weight data.
   */
  weighBag: publicProcedure
    .input(
      z.object({
        sessionId: z.number().int().positive(),
        weight: z.number().int().positive(), // weight in grams
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await bagDropService.weighBag(
          input.sessionId,
          input.weight
        );
        return { success: true, ...result };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        const message =
          error instanceof Error ? error.message : "Failed to weigh bag";
        throw new TRPCError({ code: "BAD_REQUEST", message });
      }
    }),

  /**
   * Check baggage allowance for a booking and passenger.
   * Public - kiosk displays allowance info.
   */
  checkAllowance: publicProcedure
    .input(
      z.object({
        bookingId: z.number().int().positive(),
        passengerId: z.number().int().positive(),
      })
    )
    .query(async ({ input }) => {
      try {
        const result = await bagDropService.checkBagAllowance(
          input.bookingId,
          input.passengerId
        );
        return result;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        const message =
          error instanceof Error
            ? error.message
            : "Failed to check bag allowance";
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
      }
    }),

  /**
   * Calculate excess baggage fee for a given total weight.
   * Public - kiosk shows fee before payment.
   */
  calculateFee: publicProcedure
    .input(
      z.object({
        bookingId: z.number().int().positive(),
        totalWeight: z.number().int().positive(), // total weight in grams
      })
    )
    .query(async ({ input }) => {
      try {
        const result = await bagDropService.calculateExcessFee(
          input.bookingId,
          input.totalWeight
        );
        return result;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        const message =
          error instanceof Error
            ? error.message
            : "Failed to calculate excess fee";
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
      }
    }),

  /**
   * Process payment for excess baggage.
   * Public - kiosk payment terminal triggers this.
   */
  processPayment: publicProcedure
    .input(
      z.object({
        sessionId: z.number().int().positive(),
        amount: z.number().int().nonnegative(), // amount in SAR cents
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await bagDropService.processPayment(
          input.sessionId,
          input.amount
        );
        return { success: true, ...result };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        const message =
          error instanceof Error ? error.message : "Failed to process payment";
        throw new TRPCError({ code: "BAD_REQUEST", message });
      }
    }),

  /**
   * Print a bag tag for a specific bag in the session.
   * Public - kiosk printer triggers this.
   */
  printTag: publicProcedure
    .input(
      z.object({
        sessionId: z.number().int().positive(),
        bagNumber: z.number().int().positive(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const tag = await bagDropService.printBagTag(
          input.sessionId,
          input.bagNumber
        );
        return { success: true, tag };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        const message =
          error instanceof Error ? error.message : "Failed to print bag tag";
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
      }
    }),

  /**
   * Confirm that all bags have been dropped onto the belt.
   * Public - kiosk confirms bag acceptance.
   */
  confirm: publicProcedure
    .input(
      z.object({
        sessionId: z.number().int().positive(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const result = await bagDropService.confirmBagDrop(input.sessionId);
        return { success: true, ...result };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        const message =
          error instanceof Error ? error.message : "Failed to confirm bag drop";
        throw new TRPCError({ code: "BAD_REQUEST", message });
      }
    }),

  // =================== Admin Endpoints ===================

  /**
   * Admin: Get all bag drop units, optionally filtered by airport.
   */
  getUnits: adminProcedure
    .input(
      z
        .object({
          airportId: z.number().int().positive().optional(),
        })
        .optional()
    )
    .query(({ input }) => {
      try {
        const units = bagDropService.getAllBagDropUnits(input?.airportId);
        return { units };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        const message =
          error instanceof Error
            ? error.message
            : "Failed to get bag drop units";
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
      }
    }),

  /**
   * Admin: Get health/status of a specific bag drop unit.
   */
  getUnitStatus: adminProcedure
    .input(
      z.object({
        unitId: z.number().int().positive(),
      })
    )
    .query(async ({ input }) => {
      try {
        const result = await bagDropService.getBagDropStatus(input.unitId);
        return result;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        const message =
          error instanceof Error
            ? error.message
            : "Failed to get bag drop unit status";
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
      }
    }),

  /**
   * Admin: Get bag drop analytics for an airport within a date range.
   */
  getAnalytics: adminProcedure
    .input(
      z.object({
        airportId: z.number().int().positive(),
        startDate: z.string().datetime(),
        endDate: z.string().datetime(),
      })
    )
    .query(async ({ input }) => {
      try {
        const result = await bagDropService.getBagDropAnalytics(
          input.airportId,
          {
            start: new Date(input.startDate),
            end: new Date(input.endDate),
          }
        );
        return result;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        const message =
          error instanceof Error
            ? error.message
            : "Failed to get bag drop analytics";
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
      }
    }),
});
