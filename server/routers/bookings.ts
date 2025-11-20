import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as bookingsService from "../services/bookings.service";
import * as db from "../db";

/**
 * Bookings Router
 * Handles all booking-related operations
 */
export const bookingsRouter = router({
  /**
   * Create a new booking
   */
  create: protectedProcedure
    .input(
      z.object({
        flightId: z.number(),
        cabinClass: z.enum(["economy", "business"]),
        passengers: z.array(
          z.object({
            type: z.enum(["adult", "child", "infant"]),
            title: z.string().optional(),
            firstName: z.string(),
            lastName: z.string(),
            dateOfBirth: z.date().optional(),
            passportNumber: z.string().optional(),
            nationality: z.string().optional(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await bookingsService.createBooking({
        userId: ctx.user.id,
        flightId: input.flightId,
        cabinClass: input.cabinClass,
        passengers: input.passengers,
      });
    }),

  /**
   * Get user's bookings
   */
  myBookings: protectedProcedure.query(async ({ ctx }) => {
    return await bookingsService.getUserBookings(ctx.user.id);
  }),

  /**
   * Get booking by PNR
   */
  getByPNR: protectedProcedure
    .input(z.object({ pnr: z.string() }))
    .query(async ({ ctx, input }) => {
      const booking = await db.getBookingByPNR(input.pnr);
      if (!booking) {
        throw new Error("Booking not found");
      }
      
      // Verify ownership
      if (booking.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new Error("Access denied");
      }
      
      return booking;
    }),

  /**
   * Get booking passengers
   */
  getPassengers: protectedProcedure
    .input(z.object({ bookingId: z.number() }))
    .query(async ({ ctx, input }) => {
      // First verify booking ownership
      const booking = await db.getBookingByIdWithDetails(input.bookingId);
      if (!booking) {
        throw new Error("Booking not found");
      }
      
      if (booking.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new Error("Access denied");
      }
      
      return await db.getPassengersByBookingId(input.bookingId);
    }),

  /**
   * Cancel booking
   */
  cancel: protectedProcedure
    .input(z.object({ bookingId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      return await bookingsService.cancelBooking(input.bookingId, ctx.user.id);
    }),

  /**
   * Check-in for a flight
   */
  checkIn: protectedProcedure
    .input(
      z.object({
        bookingId: z.number(),
        seatAssignments: z.array(
          z.object({
            passengerId: z.number(),
            seatNumber: z.string(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Verify booking ownership
      const booking = await db.getBookingByIdWithDetails(input.bookingId);
      if (!booking) {
        throw new Error("Booking not found");
      }
      
      if (booking.userId !== ctx.user.id) {
        throw new Error("Access denied");
      }
      
      if (booking.paymentStatus !== "paid") {
        throw new Error("Payment required before check-in");
      }
      
      // Update seat assignments
      const database = await db.getDb();
      if (!database) throw new Error("Database not available");
      
      const { passengers, bookings } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      
      for (const assignment of input.seatAssignments) {
        await database
          .update(passengers)
          .set({ seatNumber: assignment.seatNumber })
          .where(eq(passengers.id, assignment.passengerId));
      }
      
      // Mark booking as checked in
      await database
          .update(bookings)
          .set({ checkedIn: true })
          .where(eq(bookings.id, input.bookingId));
      
      return { success: true };
    }),
});
