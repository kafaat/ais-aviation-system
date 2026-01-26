import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import * as flightStatusService from "../services/flight-status.service";

/**
 * Admin-only procedure
 * Ensures only users with admin role can access these routes
 */
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Admin access required",
    });
  }
  return next({ ctx });
});

/**
 * Admin Router
 * Handles all admin-only operations
 */
export const adminRouter = router({
  /**
   * Create a new flight
   */
  createFlight: adminProcedure
    .input(
      z.object({
        flightNumber: z.string(),
        airlineId: z.number(),
        originId: z.number(),
        destinationId: z.number(),
        departureTime: z.date(),
        arrivalTime: z.date(),
        aircraftType: z.string().optional(),
        economySeats: z.number(),
        businessSeats: z.number(),
        economyPrice: z.number(),
        businessPrice: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await db.createFlight({
        ...input,
        aircraftType: input.aircraftType || null,
        status: "scheduled",
        economyAvailable: input.economySeats,
        businessAvailable: input.businessSeats,
      });

      return { success: true, flightId: Number(result[0].insertId) };
    }),

  /**
   * Update flight availability
   */
  updateFlightAvailability: adminProcedure
    .input(
      z.object({
        flightId: z.number(),
        cabinClass: z.enum(["economy", "business"]),
        seats: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      await db.updateFlightAvailability(
        input.flightId,
        input.cabinClass,
        input.seats
      );
      return { success: true };
    }),

  /**
   * Get all bookings (admin view)
   */
  getAllBookings: adminProcedure.query(async () => {
    const database = await db.getDb();
    if (!database) throw new Error("Database not available");

    const { bookings, flights, airports, users } = await import(
      "../../drizzle/schema"
    );
    const { eq, desc, sql } = await import("drizzle-orm");

    const result = await database
      .select({
        id: bookings.id,
        bookingReference: bookings.bookingReference,
        pnr: bookings.pnr,
        status: bookings.status,
        totalAmount: bookings.totalAmount,
        paymentStatus: bookings.paymentStatus,
        cabinClass: bookings.cabinClass,
        numberOfPassengers: bookings.numberOfPassengers,
        createdAt: bookings.createdAt,
        user: {
          name: users.name,
          email: users.email,
        },
        flight: {
          flightNumber: flights.flightNumber,
          departureTime: flights.departureTime,
          origin: airports.code,
          destination: sql<string>`dest.code`,
        },
      })
      .from(bookings)
      .innerJoin(users, eq(bookings.userId, users.id))
      .innerJoin(flights, eq(bookings.flightId, flights.id))
      .innerJoin(airports, eq(flights.originId, airports.id))
      .innerJoin(sql`airports as dest`, sql`${flights.destinationId} = dest.id`)
      .orderBy(desc(bookings.createdAt));

    return result;
  }),

  /**
   * Update booking status
   */
  updateBookingStatus: adminProcedure
    .input(
      z.object({
        bookingId: z.number(),
        status: z.enum(["pending", "confirmed", "cancelled", "completed"]),
      })
    )
    .mutation(async ({ input }) => {
      await db.updateBookingStatus(input.bookingId, input.status);
      return { success: true };
    }),

  /**
   * Update flight status
   */
  updateFlightStatus: adminProcedure
    .input(
      z.object({
        flightId: z.number(),
        status: z.enum(["scheduled", "delayed", "cancelled", "completed"]),
        delayMinutes: z.number().optional(),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      return await flightStatusService.updateFlightStatus(input);
    }),

  /**
   * Cancel flight and refund all bookings
   */
  cancelFlightAndRefund: adminProcedure
    .input(
      z.object({
        flightId: z.number(),
        reason: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      return await flightStatusService.cancelFlightAndRefund(input);
    }),
});
