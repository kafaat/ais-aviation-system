import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { generateETicketPDF, generateBoardingPassPDF, generateTicketNumber } from "../services/eticket.service";
import { getDb } from "../db";
import { bookings, flights, airports, passengers, airlines } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

/**
 * E-Ticket Router
 * Handles e-ticket and boarding pass generation
 */
export const eticketRouter = router({
  /**
   * Generate e-ticket PDF for a booking
   */
  generateETicket: protectedProcedure
    .input(
      z.object({
        bookingId: z.number(),
        passengerId: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database not available");

      // Get booking details
      const [booking] = await database
        .select({
          bookingId: bookings.id,
          bookingReference: bookings.bookingReference,
          pnr: bookings.pnr,
          userId: bookings.userId,
          cabinClass: bookings.cabinClass,
          totalAmount: bookings.totalAmount,
          flightNumber: flights.flightNumber,
          airlineId: flights.airlineId,
          departureTime: flights.departureTime,
          arrivalTime: flights.arrivalTime,
          originId: flights.originId,
          destinationId: flights.destinationId,
        })
        .from(bookings)
        .innerJoin(flights, eq(bookings.flightId, flights.id))
        .where(eq(bookings.id, input.bookingId))
        .limit(1);

      if (!booking || booking.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Booking not found",
        });
      }

      // Get passenger details
      const [passenger] = await database
        .select()
        .from(passengers)
        .where(eq(passengers.id, input.passengerId))
        .limit(1);

      if (!passenger || passenger.bookingId !== input.bookingId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Passenger not found",
        });
      }

      // Get airport details
      const [origin] = await database
        .select()
        .from(airports)
        .where(eq(airports.id, booking.originId))
        .limit(1);

      const [destination] = await database
        .select()
        .from(airports)
        .where(eq(airports.id, booking.destinationId))
        .limit(1);

      if (!origin || !destination) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Airport not found",
        });
      }

      // Get airline details
      const [airline] = await database
        .select()
        .from(airlines)
        .where(eq(airlines.id, booking.airlineId))
        .limit(1);

      const airlineName = airline?.name || "Unknown Airline";

      // Generate ticket number if not exists
      const ticketNumber = passenger.ticketNumber || generateTicketNumber();

      // Update passenger with ticket number
      if (!passenger.ticketNumber) {
        await database
          .update(passengers)
          .set({ ticketNumber })
          .where(eq(passengers.id, passenger.id));
      }

      // Generate PDF
      const pdfBuffer = await generateETicketPDF({
        passengerName: `${passenger.firstName} ${passenger.lastName}`,
        passengerType: passenger.type,
        ticketNumber,
        bookingReference: booking.bookingReference,
        pnr: booking.pnr,
        flightNumber: booking.flightNumber,
        airline: airlineName,
        origin: origin.city,
        originCode: origin.code,
        destination: destination.city,
        destinationCode: destination.code,
        departureTime: booking.departureTime,
        arrivalTime: booking.arrivalTime,
        cabinClass: booking.cabinClass,
        seatNumber: passenger.seatNumber || undefined,
        baggageAllowance: booking.cabinClass === "business" ? "2 × 32kg" : "1 × 23kg",
        totalAmount: booking.totalAmount,
        currency: "SAR",
        issueDate: new Date(),
      });

      // Return PDF as base64
      return {
        pdf: pdfBuffer.toString("base64"),
        ticketNumber,
        filename: `eticket_${booking.bookingReference}_${passenger.firstName}_${passenger.lastName}.pdf`,
      };
    }),

  /**
   * Generate boarding pass PDF
   */
  generateBoardingPass: protectedProcedure
    .input(
      z.object({
        bookingId: z.number(),
        passengerId: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database not available");

      // Get booking details
      const [booking] = await database
        .select({
          bookingId: bookings.id,
          bookingReference: bookings.bookingReference,
          pnr: bookings.pnr,
          userId: bookings.userId,
          cabinClass: bookings.cabinClass,
          totalAmount: bookings.totalAmount,
          status: bookings.status,
          flightNumber: flights.flightNumber,
          airlineId: flights.airlineId,
          departureTime: flights.departureTime,
          arrivalTime: flights.arrivalTime,
          originId: flights.originId,
          destinationId: flights.destinationId,
        })
        .from(bookings)
        .innerJoin(flights, eq(bookings.flightId, flights.id))
        .where(eq(bookings.id, input.bookingId))
        .limit(1);

      if (!booking || booking.userId !== ctx.user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Booking not found",
        });
      }

      // Check if confirmed or completed
      if (booking.status !== "confirmed" && booking.status !== "completed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Please confirm booking first to get boarding pass",
        });
      }

      // Get passenger details
      const [passenger] = await database
        .select()
        .from(passengers)
        .where(eq(passengers.id, input.passengerId))
        .limit(1);

      if (!passenger || passenger.bookingId !== input.bookingId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Passenger not found",
        });
      }

      // Get airport details
      const [origin] = await database
        .select()
        .from(airports)
        .where(eq(airports.id, booking.originId))
        .limit(1);

      const [destination] = await database
        .select()
        .from(airports)
        .where(eq(airports.id, booking.destinationId))
        .limit(1);

      if (!origin || !destination) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Airport not found",
        });
      }

      // Get airline details
      const [airline] = await database
        .select()
        .from(airlines)
        .where(eq(airlines.id, booking.airlineId))
        .limit(1);

      const airlineName = airline?.name || "Unknown Airline";

      // Generate ticket number if not exists
      const ticketNumber = passenger.ticketNumber || generateTicketNumber();

      // Generate PDF
      const pdfBuffer = await generateBoardingPassPDF({
        passengerName: `${passenger.firstName} ${passenger.lastName}`,
        passengerType: passenger.type,
        ticketNumber,
        bookingReference: booking.bookingReference,
        pnr: booking.pnr,
        flightNumber: booking.flightNumber,
        airline: airlineName,
        origin: origin.city,
        originCode: origin.code,
        destination: destination.city,
        destinationCode: destination.code,
        departureTime: booking.departureTime,
        arrivalTime: booking.arrivalTime,
        cabinClass: booking.cabinClass,
        seatNumber: passenger.seatNumber || undefined,
        baggageAllowance: booking.cabinClass === "business" ? "2 × 32kg" : "1 × 23kg",
        totalAmount: booking.totalAmount,
        currency: "SAR",
        issueDate: new Date(),
        gate: "TBA", // Would come from DCS in real system
        boardingTime: new Date(booking.departureTime.getTime() - 30 * 60000), // 30 min before
        sequence: "001",
      });

      // Return PDF as base64
      return {
        pdf: pdfBuffer.toString("base64"),
        ticketNumber,
        filename: `boarding_pass_${booking.bookingReference}_${passenger.firstName}_${passenger.lastName}.pdf`,
      };
    }),
});
