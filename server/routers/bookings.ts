import { checkInPassengers } from "../services/departure-control.service";
import { responseContracts } from "../contracts/bookings";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import * as bookingsService from "../services/bookings.service";
import * as db from "../db";
import { auditBookingChange } from "../services/audit.service";
import { createNotification } from "../services/notification.service";

function assertTenantMatch(
  rowTenantId: number | null,
  tenantId: number | null | undefined
) {
  if (tenantId != null && rowTenantId !== tenantId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
  }
}

/**
 * Bookings Router
 * Handles all booking-related operations
 */
export const bookingsRouter = router({
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
              type: z
                .enum(["adult", "child", "infant"])
                .describe("Passenger type"),
              title: z
                .string()
                .optional()
                .describe("Title (Mr, Mrs, Ms, etc.)"),
              firstName: z.string().describe("First name"),
              lastName: z.string().describe("Last name"),
              dateOfBirth: z.date().optional().describe("Date of birth"),
              passportNumber: z.string().optional().describe("Passport number"),
              passportExpiry: z
                .date()
                .optional()
                .describe("Passport expiry date"),
              nationality: z.string().optional().describe("Nationality code"),
              seatNumber: z
                .string()
                .regex(/^[1-9][0-9]{0,2}[A-Z]$/)
                .optional(),
            })
          )
          .describe("List of passengers"),
        sessionId: z.string().describe("Booking session ID for inventory lock"),
        lockId: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Inventory lock ID"),
        priceLockId: z.number().int().positive().optional(),
        offerId: z.string().uuid().optional(),
        idempotencyKey: z.string().min(1).max(255).optional(),
        ancillaries: z
          .array(
            z.object({
              ancillaryServiceId: z.number().describe("Ancillary service ID"),
              quantity: z.number().describe("Quantity"),
              unitPrice: z
                .number()
                .describe("Unit price in smallest currency unit"),
              totalPrice: z
                .number()
                .describe("Total price in smallest currency unit"),
              passengerId: z
                .number()
                .optional()
                .describe("Passenger ID if service is per-passenger"),
            })
          )
          .optional()
          .describe("Optional ancillary services"),
      })
    )
    .output(responseContracts["create"])
    .mutation(async ({ ctx, input }) => {
      const result = await bookingsService.createBooking({
        userId: ctx.user.id,
        tenantId: ctx.tenantId,
        flightId: input.flightId,
        cabinClass: input.cabinClass,
        passengers: input.passengers,
        sessionId: input.sessionId,
        lockId: input.lockId,
        priceLockId: input.priceLockId,
        offerId: input.offerId,
        idempotencyKey: input.idempotencyKey,
        ancillaries: input.ancillaries,
      });

      // The booking.created outbox record commits with the booking.

      return result;
    }),

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
    .output(responseContracts["myBookings"])
    .query(async ({ ctx }) => {
      return await bookingsService.getUserBookings(ctx.user.id, ctx.tenantId);
    }),

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
    .output(responseContracts["getByPNR"])
    .query(async ({ ctx, input }) => {
      const booking = await db.getBookingByPNR(input.pnr);
      if (!booking) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Booking not found",
        });
      }

      assertTenantMatch(booking.tenantId, ctx.tenantId);

      if (booking.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
      }

      return booking;
    }),

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
    .output(responseContracts["getPassengers"])
    .query(async ({ ctx, input }) => {
      const booking = await db.getBookingByIdWithDetails(input.bookingId);
      if (!booking) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Booking not found",
        });
      }

      assertTenantMatch(booking.tenantId, ctx.tenantId);

      if (booking.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
      }

      const passengerRows = await db.getPassengersByBookingId(input.bookingId);
      return ctx.tenantId == null
        ? passengerRows
        : passengerRows.filter(row => row.tenantId === ctx.tenantId);
    }),

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
      const booking = await db.getBookingByIdWithDetails(input.bookingId);
      if (booking) assertTenantMatch(booking.tenantId, ctx.tenantId);

      const result = await bookingsService.cancelBooking(
        input.bookingId,
        ctx.user.id,
        ctx.tenantId
      );

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

        try {
          await createNotification(
            ctx.user.id,
            "booking",
            "Booking Cancelled",
            `Your booking ${booking.bookingReference} has been cancelled. If you are eligible for a refund, it will be processed shortly.`,
            {
              bookingId: input.bookingId,
              bookingReference: booking.bookingReference,
              link: `/my-bookings`,
            }
          );
        } catch (_notifError) {
          console.error(
            "[Booking] Error sending cancellation notification:",
            _notifError
          );
        }
      }

      return result;
    }),

  getDepartureState: protectedProcedure
    .input(z.object({ bookingId: z.number().int().positive() }))
    .output(
      z.array(
        z.object({
          flightId: z.number(),
          flightNumber: z.string(),
          departureTime: z.date(),
          status: z.string(),
          open: z.boolean(),
          passengers: z.array(
            z.object({
              passengerId: z.number(),
              seatNumber: z.string().nullable(),
              checkedIn: z.boolean(),
            })
          ),
        })
      )
    )
    .query(async ({ input, ctx }) => {
      const booking = await db.getBookingByIdWithDetails(input.bookingId);
      if (!booking)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Booking not found",
        });
      assertTenantMatch(booking.tenantId, ctx.tenantId);
      if (booking.userId !== ctx.user.id)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Booking access denied",
        });
      const database = db.getDb();
      if (!database) throw new Error("Database unavailable");
      const { bookingSegments, flights, seatInventory, passengers } =
        await import("../../drizzle/schema");
      const { eq, inArray, asc } = await import("drizzle-orm");
      const segments = await database
        .select()
        .from(bookingSegments)
        .where(eq(bookingSegments.bookingId, booking.id))
        .orderBy(asc(bookingSegments.segmentOrder));
      const ids = segments.length
        ? segments
            .filter(l => l.status === "confirmed" || l.status === "pending")
            .map(l => l.flightId)
        : [booking.flightId];
      if (!ids.length) return [];
      const fs = await database
        .select()
        .from(flights)
        .where(inArray(flights.id, ids));
      const ps = await database
        .select()
        .from(passengers)
        .where(eq(passengers.bookingId, booking.id));
      const seats = await database
        .select()
        .from(seatInventory)
        .where(eq(seatInventory.bookingId, booking.id));
      return ids.flatMap(id => {
        const f = fs.find(f => f.id === id);
        if (!f) return [];
        const remaining = f.departureTime.getTime() - Date.now();
        return [
          {
            flightId: f.id,
            flightNumber: f.flightNumber,
            departureTime: f.departureTime,
            status: f.status,
            open:
              booking.status === "confirmed" &&
              booking.paymentStatus === "paid" &&
              ["scheduled", "delayed"].includes(f.status) &&
              remaining > 3600000 &&
              remaining <= 48 * 3600000,
            passengers: ps.map(p => {
              const seat = seats.find(
                s => s.flightId === f.id && s.passengerId === p.id
              );
              return {
                passengerId: p.id,
                seatNumber: seat?.seatNumber ?? null,
                checkedIn:
                  seat?.status === "checked_in" && Boolean(seat.checkInNonce),
              };
            }),
          },
        ];
      });
    }),

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
        bookingId: z.number().int().positive().describe("Booking ID"),
        flightId: z.number().int().positive().optional(),
        seatAssignments: z
          .array(
            z.object({
              passengerId: z.number().describe("Passenger ID"),
              seatNumber: z
                .string()
                .regex(/^[1-9][0-9]{0,2}[A-Z]$/)
                .optional(),
            })
          )
          .min(1)
          .max(600)
          .describe("Seat assignments for each passenger"),
      })
    )
    .output(z.object({ success: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const booking = await db.getBookingByIdWithDetails(input.bookingId);
      if (!booking) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Booking not found",
        });
      }

      assertTenantMatch(booking.tenantId, ctx.tenantId);

      if (booking.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
      }

      if (booking.paymentStatus !== "paid") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Payment required before check-in",
        });
      }

      await checkInPassengers({
        bookingId: input.bookingId,
        flightId: input.flightId,
        assignments: input.seatAssignments,
        requireAllPassengers: true,
        owner: { userId: ctx.user.id, tenantId: ctx.tenantId ?? null },
      });

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
