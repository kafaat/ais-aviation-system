import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as bookingsService from "../services/bookings.service";
import * as db from "../db";
import { auditBookingChange } from "../services/audit.service";

/**
 * Bookings Router
 * Handles all booking-related operations
 */
export const bookingsRouter = router({
  /**
   * Create a new booking
   */
  create: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/bookings",
        tags: ["Bookings"],
        summary: "Create a new booking",
        description:
          "Create a new flight booking with passenger details and optional ancillary services. Requires authentication. The booking will be created in pending status until payment is completed.",
        protect: true,
      },
    })
    .input(
      z.object({
        flightId: z.number().describe("Flight ID to book"),
        cabinClass: z.enum(["economy", "business"]).describe("Cabin class"),
        passengers: z
          .array(
            z.object({
              type: z.enum(["adult", "child", "infant"]).describe("Passenger type"),
              title: z.string().optional().describe("Title (Mr, Mrs, Ms, etc.)"),
              firstName: z.string().describe("First name"),
              lastName: z.string().describe("Last name"),
              dateOfBirth: z.date().optional().describe("Date of birth"),
              passportNumber: z.string().optional().describe("Passport number"),
              nationality: z.string().optional().describe("Nationality code"),
            })
          )
          .describe("List of passengers"),
        sessionId: z.string().describe("Booking session ID for inventory lock"),
        lockId: z.number().optional().describe("Inventory lock ID"),
        ancillaries: z
          .array(
            z.object({
              ancillaryServiceId: z.number().describe("Ancillary service ID"),
              quantity: z.number().describe("Quantity"),
              unitPrice: z.number().describe("Unit price in smallest currency unit"),
              totalPrice: z.number().describe("Total price in smallest currency unit"),
              passengerId: z.number().optional().describe("Passenger ID if service is per-passenger"),
            })
          )
          .optional()
          .describe("Optional ancillary services"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await bookingsService.createBooking({
        userId: ctx.user.id,
        flightId: input.flightId,
        cabinClass: input.cabinClass,
        passengers: input.passengers,
        sessionId: input.sessionId,
        lockId: input.lockId,
        ancillaries: input.ancillaries,
      });

      // Audit log: Booking created
      await auditBookingChange(
        result.bookingId,
        result.bookingReference,
        ctx.user.id,
        ctx.user.role,
        "created",
        undefined,
        {
          flightId: input.flightId,
          cabinClass: input.cabinClass,
          passengerCount: input.passengers.length,
          totalAmount: result.totalAmount,
        },
        ctx.req.ip,
        ctx.req.headers["x-request-id"] as string
      );

      return result;
    }),

  /**
   * Get user's bookings
   */
  myBookings: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/bookings/my",
        tags: ["Bookings"],
        summary: "Get my bookings",
        description:
          "Retrieve all bookings for the authenticated user. Returns bookings sorted by creation date with flight details and status information.",
        protect: true,
      },
    })
    .query(async ({ ctx }) => {
      return await bookingsService.getUserBookings(ctx.user.id);
    }),

  /**
   * Get booking by PNR
   */
  getByPNR: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/bookings/pnr/{pnr}",
        tags: ["Bookings"],
        summary: "Get booking by PNR",
        description:
          "Retrieve a booking using its Passenger Name Record (PNR) code. Only the booking owner or an admin can access this information.",
        protect: true,
      },
    })
    .input(z.object({ pnr: z.string().describe("6-character PNR code") }))
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
    .meta({
      openapi: {
        method: "GET",
        path: "/bookings/{bookingId}/passengers",
        tags: ["Bookings"],
        summary: "Get booking passengers",
        description:
          "Retrieve all passengers for a specific booking. Includes passenger details like name, document information, and seat assignments.",
        protect: true,
      },
    })
    .input(z.object({ bookingId: z.number().describe("Booking ID") }))
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
    .meta({
      openapi: {
        method: "POST",
        path: "/bookings/{bookingId}/cancel",
        tags: ["Bookings"],
        summary: "Cancel a booking",
        description:
          "Cancel a booking. Cancellation fees may apply based on the cancellation policy and time until departure. Refunds are processed according to the original payment method.",
        protect: true,
      },
    })
    .input(z.object({ bookingId: z.number().describe("Booking ID to cancel") }))
    .output(z.object({ success: z.boolean(), message: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      // Get booking details before cancellation for audit
      const booking = await db.getBookingByIdWithDetails(input.bookingId);

      const result = await bookingsService.cancelBooking(
        input.bookingId,
        ctx.user.id
      );

      // Audit log: Booking cancelled
      if (booking) {
        await auditBookingChange(
          input.bookingId,
          booking.bookingReference,
          ctx.user.id,
          ctx.user.role,
          "cancelled",
          { status: booking.status, paymentStatus: booking.paymentStatus },
          { status: "cancelled" },
          ctx.req.ip,
          ctx.req.headers["x-request-id"] as string
        );
      }

      return result;
    }),

  /**
   * Check-in for a flight
   */
  checkIn: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/bookings/{bookingId}/check-in",
        tags: ["Bookings"],
        summary: "Check-in for a flight",
        description:
          "Perform online check-in for a booking. Allows seat selection for all passengers. Check-in is typically available 24-48 hours before departure. Booking must be paid to check-in.",
        protect: true,
      },
    })
    .input(
      z.object({
        bookingId: z.number().describe("Booking ID"),
        seatAssignments: z
          .array(
            z.object({
              passengerId: z.number().describe("Passenger ID"),
              seatNumber: z.string().describe("Seat number (e.g., 12A)"),
            })
          )
          .describe("Seat assignments for each passenger"),
      })
    )
    .output(z.object({ success: z.boolean() }))
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

      // Audit log: Booking checked in
      await auditBookingChange(
        input.bookingId,
        booking.bookingReference,
        ctx.user.id,
        ctx.user.role,
        "modified",
        { checkedIn: false },
        { checkedIn: true, seatAssignments: input.seatAssignments },
        ctx.req.ip,
        ctx.req.headers["x-request-id"] as string
      );

      return { success: true };
    }),
});
