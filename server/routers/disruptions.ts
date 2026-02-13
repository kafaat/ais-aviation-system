import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import {
  createDisruption,
  getUserDisruptions,
  getAlternativeFlights,
  getActiveDisruptions,
  resolveDisruption,
} from "../services/disruption.service";
import { TRPCError } from "@trpc/server";

/**
 * Disruptions Router
 * Manages flight disruptions, rebooking, and notifications
 */
export const disruptionsRouter = router({
  /**
   * Get disruptions affecting the user's bookings
   */
  myDisruptions: protectedProcedure.query(async ({ ctx }) => {
    return await getUserDisruptions(ctx.user.id);
  }),

  /**
   * Get alternative flights for rebooking after disruption
   */
  getAlternatives: protectedProcedure
    .input(z.object({ flightId: z.number() }))
    .query(async ({ ctx, input }) => {
      return await getAlternativeFlights(input.flightId, ctx.user.id);
    }),

  /**
   * Report a disruption (admin)
   */
  create: adminProcedure
    .input(
      z.object({
        flightId: z.number(),
        type: z.enum(["delay", "cancellation", "diversion"]),
        reason: z.string().min(5).max(500),
        severity: z.enum(["minor", "moderate", "severe"]),
        newDepartureTime: z.date().optional(),
        delayMinutes: z.number().min(0).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await createDisruption({
          ...input,
          createdBy: ctx.user.id,
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Failed to create disruption",
        });
      }
    }),

  /**
   * Get all active disruptions (admin)
   */
  activeDisruptions: adminProcedure.query(async () => {
    return await getActiveDisruptions();
  }),

  /**
   * Resolve a disruption (admin)
   */
  resolve: adminProcedure
    .input(z.object({ disruptionId: z.number() }))
    .mutation(async ({ input }) => {
      return await resolveDisruption(input.disruptionId);
    }),
});
