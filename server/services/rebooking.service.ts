import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  bookings,
  passengers,
  flights,
  airports,
  bookingAncillaries,
  ancillaryServices,
} from "../../drizzle/schema";
import { eq, and, gte, sql } from "drizzle-orm";

/**
 * Rebooking Service
 * Handles retrieving previous booking data for quick rebooking
 */

export interface RebookPassenger {
  type: "adult" | "child" | "infant";
  title: string | null;
  firstName: string;
  lastName: string;
  dateOfBirth: Date | null;
  passportNumber: string | null;
  nationality: string | null;
}

export interface RebookAncillary {
  ancillaryServiceId: number;
  code: string;
  name: string;
  category: string;
  quantity: number;
}

export interface RebookData {
  originalBookingId: number;
  originalBookingRef: string;
  cabinClass: "economy" | "business";
  passengers: RebookPassenger[];
  ancillaries: RebookAncillary[];
  route: {
    originId: number;
    originCode: string;
    originCity: string;
    destinationId: number;
    destinationCode: string;
    destinationCity: string;
  };
}

/**
 * Get rebooking data from a previous booking
 * Returns passengers, route, cabin class, and ancillaries for pre-filling a new booking
 */
export async function getRebookData(
  bookingId: number,
  userId: number
): Promise<RebookData> {
  const database = await getDb();
  if (!database) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  // Get booking with ownership check
  const bookingResult = await database
    .select({
      id: bookings.id,
      bookingReference: bookings.bookingReference,
      userId: bookings.userId,
      flightId: bookings.flightId,
      cabinClass: bookings.cabinClass,
    })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (bookingResult.length === 0) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Booking not found",
    });
  }

  const booking = bookingResult[0];

  if (booking.userId !== userId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Access denied",
    });
  }

  // Get passengers
  const passengerResult = await database
    .select({
      type: passengers.type,
      title: passengers.title,
      firstName: passengers.firstName,
      lastName: passengers.lastName,
      dateOfBirth: passengers.dateOfBirth,
      passportNumber: passengers.passportNumber,
      nationality: passengers.nationality,
    })
    .from(passengers)
    .where(eq(passengers.bookingId, bookingId));

  // Get flight route info
  const flightResult = await database
    .select({
      originId: flights.originId,
      destinationId: flights.destinationId,
      originCode: airports.code,
      originCity: airports.city,
      destinationCode: sql<string>`dest.code`,
      destinationCity: sql<string>`dest.city`,
    })
    .from(flights)
    .innerJoin(airports, eq(flights.originId, airports.id))
    .innerJoin(sql`airports as dest`, sql`${flights.destinationId} = dest.id`)
    .where(eq(flights.id, booking.flightId))
    .limit(1);

  if (flightResult.length === 0) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Flight not found",
    });
  }

  const flight = flightResult[0];

  // Get ancillary services that were booked
  const ancillaryResult = await database
    .select({
      ancillaryServiceId: bookingAncillaries.ancillaryServiceId,
      quantity: bookingAncillaries.quantity,
      code: ancillaryServices.code,
      name: ancillaryServices.name,
      category: ancillaryServices.category,
    })
    .from(bookingAncillaries)
    .innerJoin(
      ancillaryServices,
      eq(bookingAncillaries.ancillaryServiceId, ancillaryServices.id)
    )
    .where(
      and(
        eq(bookingAncillaries.bookingId, bookingId),
        eq(bookingAncillaries.status, "active")
      )
    );

  return {
    originalBookingId: booking.id,
    originalBookingRef: booking.bookingReference,
    cabinClass: booking.cabinClass as "economy" | "business",
    passengers: passengerResult.map(p => ({
      type: p.type as "adult" | "child" | "infant",
      title: p.title,
      firstName: p.firstName,
      lastName: p.lastName,
      dateOfBirth: p.dateOfBirth,
      passportNumber: p.passportNumber,
      nationality: p.nationality,
    })),
    ancillaries: ancillaryResult.map(a => ({
      ancillaryServiceId: a.ancillaryServiceId,
      code: a.code,
      name: a.name,
      category: a.category,
      quantity: a.quantity,
    })),
    route: {
      originId: flight.originId,
      originCode: flight.originCode,
      originCity: flight.originCity,
      destinationId: flight.destinationId,
      destinationCode: flight.destinationCode,
      destinationCity: flight.destinationCity,
    },
  };
}

/**
 * Search for available flights on the same route as a previous booking
 */
export async function searchFlightsForRebook(
  originId: number,
  destinationId: number,
  cabinClass: "economy" | "business"
) {
  const database = await getDb();
  if (!database) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const now = new Date();

  const availableFlights = await database
    .select({
      id: flights.id,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      arrivalTime: flights.arrivalTime,
      economyPrice: flights.economyPrice,
      businessPrice: flights.businessPrice,
      economyAvailable: flights.economyAvailable,
      businessAvailable: flights.businessAvailable,
      status: flights.status,
      originCode: airports.code,
      originCity: airports.city,
      destinationCode: sql<string>`dest.code`,
      destinationCity: sql<string>`dest.city`,
    })
    .from(flights)
    .innerJoin(airports, eq(flights.originId, airports.id))
    .innerJoin(sql`airports as dest`, sql`${flights.destinationId} = dest.id`)
    .where(
      and(
        eq(flights.originId, originId),
        eq(flights.destinationId, destinationId),
        eq(flights.status, "scheduled"),
        gte(flights.departureTime, now)
      )
    )
    .orderBy(flights.departureTime)
    .limit(20);

  return availableFlights.filter(f => {
    if (cabinClass === "economy") return f.economyAvailable > 0;
    return f.businessAvailable > 0;
  });
}
