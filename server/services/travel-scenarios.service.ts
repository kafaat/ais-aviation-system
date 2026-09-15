import { flightBookingCondition } from "./flight-state.service";
import {
  sourcedCarbon,
  sourcedTravelRequirements,
} from "./travel-evidence.service";
import { checkIn } from "./seat-map.service";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  bookings,
  bookingSegments,
  flights,
  airports,
  passengers,
  userPreferences,
} from "../../drizzle/schema";
import { eq, and, inArray } from "drizzle-orm";

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
      flightId: flights.id,
      departureTime: flights.departureTime,
    })
    .from(bookings)
    .innerJoin(flights, flightBookingCondition(flights.id))
    .innerJoin(userPreferences, eq(bookings.userId, userPreferences.userId))
    .where(
      and(
        eq(bookings.status, "confirmed"),
        eq(bookings.paymentStatus, "paid"),
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

  const [booking] = await database
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.userId, userId)));
  if (!booking)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Owned booking not found",
    });
  const all = await database
    .select()
    .from(bookingSegments)
    .where(eq(bookingSegments.bookingId, bookingId))
    .orderBy(bookingSegments.segmentOrder);
  const active = all.length
    ? all
        .filter(s => ["pending", "confirmed"].includes(s.status))
        .map(s => ({ id: s.id, flightId: s.flightId, order: s.segmentOrder }))
    : [{ id: null, flightId: booking.flightId, order: 1 }];
  if (!active.length || booking.status === "cancelled")
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No active itinerary",
    });
  const selected = await database
    .select()
    .from(flights)
    .where(
      inArray(
        flights.id,
        active.map(s => s.flightId)
      )
    );
  const fields = await database
    .select()
    .from(airports)
    .where(
      inArray(airports.id, [
        ...new Set(selected.flatMap(f => [f.originId, f.destinationId])),
      ])
    );
  const segments = active.map(s => {
    const flight = selected.find(f => f.id === s.flightId);
    const origin = fields.find(f => f.id === flight?.originId),
      destination = fields.find(f => f.id === flight?.destinationId);
    if (!flight || !origin || !destination)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Incomplete itinerary source",
      });
    return {
      segmentId: s.id,
      flightId: flight.id,
      segmentOrder: s.order,
      flightNumber: flight.flightNumber,
      departureTime: flight.departureTime,
      arrivalTime: flight.arrivalTime,
      origin: { code: origin.code, city: origin.city },
      destination: { code: destination.code, city: destination.city },
    };
  });
  const passengerList = await database
    .select({ firstName: passengers.firstName, type: passengers.type })
    .from(passengers)
    .where(eq(passengers.bookingId, bookingId));
  return {
    bookingReference: booking.bookingReference,
    cabinClass: booking.cabinClass,
    ...segments[0],
    segments,
    passengers: passengerList,
    numberOfPassengers: booking.numberOfPassengers,
  };
}

export const calculateCarbonOffset = sourcedCarbon;
export const getTravelRequirements = sourcedTravelRequirements;
