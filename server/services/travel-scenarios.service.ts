import {
  sourcedCarbon,
  sourcedTravelRequirements,
} from "./travel-evidence.service";
import { checkIn } from "./seat-map.service";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  bookings,
  flights,
  airports,
  passengers,
  userPreferences,
} from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";

/**
 * Travel Scenarios Service
 * Handles auto check-in, itinerary sharing, carbon offset,
 * and travel document requirements
 */

// ============ Auto Check-In ============

/**
 * Opt-in/out for automatic check-in
 * Stores preference in user_preferences
 */
export async function setAutoCheckIn(userId: number, enabled: boolean) {
  const database = await getDb();
  if (!database) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  await database.transaction(async tx => {
    const existing = await tx
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);

    if (existing.length > 0) {
      await tx
        .update(userPreferences)
        .set({ autoCheckIn: enabled })
        .where(eq(userPreferences.userId, userId));
    } else {
      await tx.insert(userPreferences).values({
        userId,
        autoCheckIn: enabled,
      });
    }
  });

  return { autoCheckIn: enabled };
}

export async function getAutoCheckInStatus(userId: number) {
  const database = await getDb();
  if (!database) return { autoCheckIn: false };

  const result = await database
    .select({ autoCheckIn: userPreferences.autoCheckIn })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  return { autoCheckIn: result[0]?.autoCheckIn ?? false };
}

/**
 * Process auto check-in for eligible bookings
 * Called by a scheduled job 24 hours before departure
 */
export async function processAutoCheckIns() {
  const database = await getDb();
  if (!database) return { processed: 0 };

  const now = new Date();
  const checkInWindow = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours ahead

  // Find confirmed bookings with auto check-in enabled, departing within 24h
  const eligibleBookings = await database
    .select({
      bookingId: bookings.id,
      userId: bookings.userId,
      flightId: bookings.flightId,
      departureTime: flights.departureTime,
    })
    .from(bookings)
    .innerJoin(flights, eq(bookings.flightId, flights.id))
    .innerJoin(userPreferences, eq(bookings.userId, userPreferences.userId))
    .where(
      and(
        eq(bookings.status, "confirmed"),
        eq(bookings.paymentStatus, "paid"),
        eq(bookings.checkedIn, false),
        eq(userPreferences.autoCheckIn, true)
      )
    );

  let processed = 0;
  for (const booking of eligibleBookings) {
    const depTime = new Date(booking.departureTime);
    if (
      depTime.getTime() > now.getTime() + 3600000 &&
      depTime <= checkInWindow
    ) {
      const travelers = await database
        .select()
        .from(passengers)
        .where(eq(passengers.bookingId, booking.bookingId));
      try {
        for (const passenger of travelers)
          await checkIn(booking.flightId, booking.bookingId, passenger.id);
        if (travelers.length) processed++;
      } catch {
        // Document review, unavailable seats or a concurrent check-in remain pending.
      }
    }
  }

  return { processed };
}

// ============ Itinerary Sharing ============

/**
 * Generate a shareable itinerary summary (no payment/private info)
 */
export async function getShareableItinerary(bookingId: number, userId: number) {
  const database = await getDb();
  if (!database) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const bookingResult = await database
    .select({
      id: bookings.id,
      bookingReference: bookings.bookingReference,
      userId: bookings.userId,
      cabinClass: bookings.cabinClass,
      numberOfPassengers: bookings.numberOfPassengers,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      arrivalTime: flights.arrivalTime,
      originCode: airports.code,
      originCity: airports.city,
    })
    .from(bookings)
    .innerJoin(flights, eq(bookings.flightId, flights.id))
    .innerJoin(airports, eq(flights.originId, airports.id))
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (bookingResult.length === 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
  }

  const booking = bookingResult[0];
  if (booking.userId !== userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
  }

  // Get destination separately (SQL alias)
  const flightResult = await database
    .select({
      destinationId: flights.destinationId,
    })
    .from(flights)
    .innerJoin(bookings, eq(bookings.flightId, flights.id))
    .where(eq(bookings.id, bookingId))
    .limit(1);

  let destinationCode = "";
  let destinationCity = "";
  if (flightResult.length > 0) {
    const destResult = await database
      .select({ code: airports.code, city: airports.city })
      .from(airports)
      .where(eq(airports.id, flightResult[0].destinationId))
      .limit(1);
    if (destResult.length > 0) {
      destinationCode = destResult[0].code;
      destinationCity = destResult[0].city;
    }
  }

  // Get passenger first names only (privacy)
  const passengerList = await database
    .select({
      firstName: passengers.firstName,
      type: passengers.type,
    })
    .from(passengers)
    .where(eq(passengers.bookingId, bookingId));

  return {
    bookingReference: booking.bookingReference,
    flightNumber: booking.flightNumber,
    cabinClass: booking.cabinClass,
    departureTime: booking.departureTime,
    arrivalTime: booking.arrivalTime,
    origin: { code: booking.originCode, city: booking.originCity },
    destination: { code: destinationCode, city: destinationCity },
    passengers: passengerList.map(p => ({
      firstName: p.firstName,
      type: p.type,
    })),
    numberOfPassengers: booking.numberOfPassengers,
  };
}

export const calculateCarbonOffset = sourcedCarbon;
export const getTravelRequirements = sourcedTravelRequirements;
