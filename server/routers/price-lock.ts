import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createPriceLock,
  getUserPriceLocks,
  cancelPriceLock,
  getActiveLockForFlight,
} from "../services/price-lock.service";
import { TRPCError } from "@trpc/server";

/**
 * Price Lock Router
 * Allows users to freeze a flight price for 48 hours
 */
export const priceLockRouter = router({
  /**
   * Create a price lock for a flight
   */
  create: protectedProcedure
    .input(
      z.object({
        flightId: z.number(),
        cabinClass: z.enum(["economy", "business"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const result = await createPriceLock(
          ctx.user.id,
          input.flightId,
          input.cabinClass
        );

        if (result.alreadyExists) {
          return {
            lock: result.lock,
            message: "You already have an active price lock for this flight",
            isNew: false,
          };
        }

        return {
          lock: result.lock,
          message: "Price locked successfully for 48 hours",
          isNew: true,
        };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Failed to lock price",
        });
      }
    }),

  /**
   * Get all price locks for the current user
   */
  myLocks: protectedProcedure.query(async ({ ctx }) => {
    return await getUserPriceLocks(ctx.user.id);
  }),

  /**
   * Check if user has an active lock for a specific flight
   */
  checkLock: protectedProcedure
    .input(
      z.object({
        flightId: z.number(),
        cabinClass: z.enum(["economy", "business"]),
      })
    )
    .query(async ({ ctx, input }) => {
      const lock = await getActiveLockForFlight(
        ctx.user.id,
        input.flightId,
        input.cabinClass
      );
      return { lock };
    }),

  /**
   * Cancel an active price lock
   */
  cancel: protectedProcedure
    .input(z.object({ lockId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await cancelPriceLock(ctx.user.id, input.lockId);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Failed to cancel price lock",
        });
      }
    }),
});
