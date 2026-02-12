import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  flightDisruptions,
  flights,
  bookings,
  airports,
} from "../../drizzle/schema";
import { eq, and, sql, ne, inArray } from "drizzle-orm";

/**
 * Report a flight disruption (admin)
 */
export async function createDisruption(input: {
  flightId: number;
  type: "delay" | "cancellation" | "diversion";
  reason: string;
  severity: "minor" | "moderate" | "severe";
  newDepartureTime?: Date;
  delayMinutes?: number;
  createdBy?: number;
}) {
  // Input validation
  const validTypes = ["delay", "cancellation", "diversion"];
  if (!validTypes.includes(input.type)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Invalid disruption type: ${input.type}. Must be one of: ${validTypes.join(", ")}`,
    });
  }

  if (input.delayMinutes !== undefined && input.delayMinutes < 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "delayMinutes must be >= 0",
    });
  }

  if (input.newDepartureTime && input.newDepartureTime < new Date()) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "newDepartureTime must not be in the past",
    });
  }

  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  // Wrap flight read + disruption insert + flight status update in a transaction
  const disruption = await db.transaction(async tx => {
    // Get original flight info
    const [flight] = await tx
      .select()
      .from(flights)
      .where(eq(flights.id, input.flightId))
      .limit(1);

    if (!flight) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Flight not found",
      });
    }

    const [result] = await tx.insert(flightDisruptions).values({
      flightId: input.flightId,
      type: input.type,
      reason: input.reason,
      severity: input.severity,
      originalDepartureTime: flight.departureTime,
      newDepartureTime: input.newDepartureTime || null,
      delayMinutes: input.delayMinutes || null,
      status: "active",
      createdBy: input.createdBy || null,
    });

    // Update flight status
    if (input.type === "cancellation") {
      await tx
        .update(flights)
        .set({ status: "cancelled" })
        .where(eq(flights.id, input.flightId));
    } else if (input.type === "delay" && input.newDepartureTime) {
      await tx
        .update(flights)
        .set({
          status: "delayed",
          departureTime: input.newDepartureTime,
        })
        .where(eq(flights.id, input.flightId));
    }

    const [insertedDisruption] = await tx
      .select()
      .from(flightDisruptions)
      .where(eq(flightDisruptions.id, result.insertId))
      .limit(1);

    return insertedDisruption;
  });

  return disruption;
}

/**
 * Get disruptions for a user's bookings
 */
export async function getUserDisruptions(userId: number) {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  // Get user's active bookings
  const userBookings = await db
    .select({
      bookingId: bookings.id,
      bookingReference: bookings.bookingReference,
      flightId: bookings.flightId,
      status: bookings.status,
    })
    .from(bookings)
    .where(and(eq(bookings.userId, userId), ne(bookings.status, "cancelled")));

  if (userBookings.length === 0) return [];

  const flightIds = userBookings.map(b => b.flightId);

  // Get disruptions for those flights using SQL WHERE IN for better performance
  const userFlightDisruptions = await db
    .select({
      id: flightDisruptions.id,
      flightId: flightDisruptions.flightId,
      type: flightDisruptions.type,
      reason: flightDisruptions.reason,
      severity: flightDisruptions.severity,
      originalDepartureTime: flightDisruptions.originalDepartureTime,
      newDepartureTime: flightDisruptions.newDepartureTime,
      delayMinutes: flightDisruptions.delayMinutes,
      status: flightDisruptions.status,
      createdAt: flightDisruptions.createdAt,
      flightNumber: flights.flightNumber,
      originId: flights.originId,
      destinationId: flights.destinationId,
    })
    .from(flightDisruptions)
    .innerJoin(flights, eq(flightDisruptions.flightId, flights.id))
    .where(
      and(
        eq(flightDisruptions.status, "active"),
        inArray(flightDisruptions.flightId, flightIds)
      )
    )
    .orderBy(sql`${flightDisruptions.createdAt} DESC`);

  // Enrich with booking references
  return userFlightDisruptions.map(d => {
    const booking = userBookings.find(b => b.flightId === d.flightId);
    return {
      ...d,
      bookingReference: booking?.bookingReference,
      bookingId: booking?.bookingId,
    };
  });
}

/**
 * Get alternative flights for rebooking after disruption
 */
export async function getAlternativeFlights(flightId: number, _userId: number) {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  // Get the original flight details
  const [originalFlight] = await db
    .select()
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);

  if (!originalFlight) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Flight not found",
    });
  }

  // Find alternative flights on the same route within 3 days
  const threeDaysLater = new Date(originalFlight.departureTime);
  threeDaysLater.setDate(threeDaysLater.getDate() + 3);

  const alternatives = await db
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
      airlineId: flights.airlineId,
    })
    .from(flights)
    .where(
      and(
        eq(flights.originId, originalFlight.originId),
        eq(flights.destinationId, originalFlight.destinationId),
        eq(flights.status, "scheduled"),
        ne(flights.id, flightId),
        sql`${flights.departureTime} >= NOW()`,
        sql`${flights.departureTime} <= ${threeDaysLater}`
      )
    )
    .orderBy(flights.departureTime)
    .limit(5);

  // Get airport names
  const [origin] = await db
    .select({ code: airports.code, city: airports.city })
    .from(airports)
    .where(eq(airports.id, originalFlight.originId))
    .limit(1);

  const [destination] = await db
    .select({ code: airports.code, city: airports.city })
    .from(airports)
    .where(eq(airports.id, originalFlight.destinationId))
    .limit(1);

  return {
    originalFlight: {
      id: originalFlight.id,
      flightNumber: originalFlight.flightNumber,
      departureTime: originalFlight.departureTime,
      origin: origin || { code: "???", city: "Unknown" },
      destination: destination || { code: "???", city: "Unknown" },
    },
    alternatives,
  };
}

/**
 * Get all active disruptions (admin)
 */
export async function getActiveDisruptions() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  return await db
    .select({
      id: flightDisruptions.id,
      flightId: flightDisruptions.flightId,
      type: flightDisruptions.type,
      reason: flightDisruptions.reason,
      severity: flightDisruptions.severity,
      originalDepartureTime: flightDisruptions.originalDepartureTime,
      newDepartureTime: flightDisruptions.newDepartureTime,
      delayMinutes: flightDisruptions.delayMinutes,
      status: flightDisruptions.status,
      createdAt: flightDisruptions.createdAt,
      flightNumber: flights.flightNumber,
    })
    .from(flightDisruptions)
    .innerJoin(flights, eq(flightDisruptions.flightId, flights.id))
    .where(eq(flightDisruptions.status, "active"))
    .orderBy(sql`${flightDisruptions.createdAt} DESC`);
}

/**
 * Resolve a disruption (admin)
 */
export async function resolveDisruption(disruptionId: number) {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  await db
    .update(flightDisruptions)
    .set({ status: "resolved", resolvedAt: new Date() })
    .where(eq(flightDisruptions.id, disruptionId));

  return { success: true };
}
