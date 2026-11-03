import {
  exchangeContextOutput,
  getExchangeContext,
} from "../services/order-exchange-context.service";
import { responseContracts } from "../contracts/modifications";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as modificationService from "../services/booking-modification.service";
import { assertModificationOwnership } from "../services/access-control.service";

/**
 * Booking Modifications Router
 * Handles booking modification requests
 */
export const modificationsRouter = router({
  exchangeContext: protectedProcedure
    .input(z.object({ bookingId: z.number().int().positive() }))
    .output(exchangeContextOutput)
    .query(({ ctx, input }) =>
      getExchangeContext(input.bookingId, ctx.user.id, ctx.tenantId)
    ),
  /**
   * Request to change flight date
   */
  requestChangeDate: protectedProcedure
    .input(
      z.object({
        bookingId: z.number(),
        newFlightId: z.number(),
        replaceFlightId: z.number().int().positive().optional(),
        reason: z.string().max(1000).optional(),
        idempotencyKey: z.string().min(8).max(100).optional(),
      })
    )
    .output(responseContracts["requestChangeDate"])
    .mutation(async ({ input, ctx }) => {
      return await modificationService.requestChangeFlightDate({
        bookingId: input.bookingId,
        userId: ctx.user.id,
        tenantId: ctx.tenantId,
        newFlightId: input.newFlightId,
        replaceFlightId: input.replaceFlightId,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
      });
    }),

  /**
   * Request to upgrade cabin class
   */
  requestUpgrade: protectedProcedure
    .input(
      z.object({
        bookingId: z.number(),
        reason: z.string().max(1000).optional(),
        idempotencyKey: z.string().min(8).max(100).optional(),
      })
    )
    .output(responseContracts["requestUpgrade"])
    .mutation(async ({ input, ctx }) => {
      return await modificationService.requestUpgradeCabin({
        bookingId: input.bookingId,
        userId: ctx.user.id,
        tenantId: ctx.tenantId,
        newCabinClass: "business",
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
      });
    }),

  /**
   * Get modification details
   */
  getDetails: protectedProcedure
    .input(z.object({ modificationId: z.number() }))
    .output(responseContracts["getDetails"])
    .query(async ({ input, ctx }) => {
      // Ownership check: prevent reading another user's modification (IDOR)
      await assertModificationOwnership(
        input.modificationId,
        ctx.user.id,
        ctx.user.role
      );
      return await modificationService.getModificationDetails(
        input.modificationId
      );
    }),

  /**
   * Get user's modification requests
   */
  myModifications: protectedProcedure
    .output(responseContracts["myModifications"])
    .query(async ({ ctx }) => {
      return await modificationService.getUserModifications(ctx.user.id);
    }),
});
