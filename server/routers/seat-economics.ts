import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import {
  getBookingSeatEconomics,
  getFlightEconomics,
} from "../services/seat-economics.service";

/**
 * Seat Economics Router
 * Revenue/cost/contribution analysis per seat. Financial data → admin/ops only.
 */
export const seatEconomicsRouter = router({
  /**
   * Per-seat economics (revenue − cost = net contribution) for one booking.
   */
  getByBooking: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/seat-economics/booking/{bookingId}",
        tags: ["Seat Economics", "Admin"],
        summary: "Per-seat economics for a booking",
        description:
          "Compute revenue (base fare + ancillaries − discounts), cost (estimated payment fee + agent commission), and net contribution for every seat in a booking.",
        protect: true,
      },
    })
    .input(
      z.object({
        bookingId: z.number().int().positive(),
        paymentFeeRate: z.number().min(0).max(1).optional(),
        paymentFeeFixed: z.number().int().min(0).optional(),
      })
    )
    .query(async ({ input }) => {
      return await getBookingSeatEconomics(input.bookingId, {
        paymentFeeRate: input.paymentFeeRate,
        paymentFeeFixed: input.paymentFeeFixed,
      });
    }),

  /**
   * Aggregate seat economics across all revenue-bearing bookings on a flight.
   */
  getByFlight: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/seat-economics/flight/{flightId}",
        tags: ["Seat Economics", "Admin"],
        summary: "Aggregate seat economics for a flight",
        description:
          "Sum revenue, cost, and net contribution across all bookings on a flight whose payment has been captured (paymentStatus = paid; pending/failed/refunded bookings are excluded), including average net contribution per seat.",
        protect: true,
      },
    })
    .input(z.object({ flightId: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      return await getFlightEconomics(input.flightId, {
        tenantId: ctx.tenantId,
      });
    }),
});
