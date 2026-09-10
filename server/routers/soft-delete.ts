import { responseContracts } from "../contracts/soft-delete";
import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import * as softDeleteService from "../services/soft-delete.service";

export const softDeleteRouter = router({
  /**
   * Soft delete a booking (user can delete their cancelled bookings)
   */
  deleteBooking: protectedProcedure
    .input(
      z.object({
        bookingId: z.number().int().positive(),
      })
    )
    .output(responseContracts["deleteBooking"])
    .mutation(async ({ ctx, input }) => {
      const isAdmin =
        ctx.user.role === "admin" || ctx.user.role === "super_admin";
      return await softDeleteService.softDeleteBooking(
        input.bookingId,
        ctx.user.id,
        isAdmin
      );
    }),

  /**
   * Admin: Restore a soft-deleted booking
   */
  restoreBooking: adminProcedure
    .input(
      z.object({
        bookingId: z.number().int().positive(),
      })
    )
    .output(responseContracts["restoreBooking"])
    .mutation(async ({ input }) => {
      return await softDeleteService.restoreBooking(input.bookingId);
    }),

  /**
   * Admin: Get all soft-deleted bookings
   */
  getDeletedBookings: adminProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      })
    )
    .output(responseContracts["getDeletedBookings"])
    .query(async ({ input }) => {
      return await softDeleteService.getDeletedBookings(input);
    }),

  /**
   * Admin: Get count of deleted bookings
   */
  getDeletedCount: adminProcedure
    .output(responseContracts["getDeletedCount"])
    .query(async () => {
      return await softDeleteService.getDeletedBookingsCount();
    }),

  /**
   * Admin: Purge old soft-deleted bookings permanently
   */
  purgeDeleted: adminProcedure
    .input(
      z.object({
        retentionDays: z.number().int().min(30).max(365).optional(),
      })
    )
    .output(responseContracts["purgeDeleted"])
    .mutation(async ({ input }) => {
      return await softDeleteService.purgeDeletedBookings(
        input.retentionDays || 90
      );
    }),
});
