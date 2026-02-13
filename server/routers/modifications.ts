import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as modificationService from "../services/booking-modification.service";

/**
 * Booking Modifications Router
 * Handles booking modification requests
 */
export const modificationsRouter = router({
  /**
   * Request to change flight date
   */
  requestChangeDate: protectedProcedure
    .input(
      z.object({
        bookingId: z.number(),
        newFlightId: z.number(),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return await modificationService.requestChangeFlightDate({
        bookingId: input.bookingId,
        userId: ctx.user.id,
        newFlightId: input.newFlightId,
        reason: input.reason,
      });
    }),

  /**
   * Request to upgrade cabin class
   */
  requestUpgrade: protectedProcedure
    .input(
      z.object({
        bookingId: z.number(),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return await modificationService.requestUpgradeCabin({
        bookingId: input.bookingId,
        userId: ctx.user.id,
        newCabinClass: "business",
        reason: input.reason,
      });
    }),

  /**
   * Get modification details
   */
  getDetails: protectedProcedure
    .input(z.object({ modificationId: z.number() }))
    .query(async ({ input }) => {
      return await modificationService.getModificationDetails(input.modificationId);
    }),

  /**
   * Get user's modification requests
   */
  myModifications: protectedProcedure.query(async ({ ctx }) => {
    return await modificationService.getUserModifications(ctx.user.id);
  }),
});
