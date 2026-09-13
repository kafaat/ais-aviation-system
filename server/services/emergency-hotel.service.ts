export { emergencyHotels, emergencyHotelBookings } from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  flights,
  airports,
  emergencyHotels,
  emergencyHotelBookings,
} from "../../drizzle/schema";
import { eq, and, sql, gte, lte } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Canonical Drizzle Table Schemas
// ---------------------------------------------------------------------------

/**
 * emergencyHotels: id, name, airportId, address, phone, email, starRating,
 * standardRate (int SAR cents), distanceKm, hasTransport, isActive, createdAt
 */

/**
 * emergencyHotelBookings: id, hotelId, bookingId, flightId, passengerId,
 * roomType(standard/suite), checkIn(datetime), checkOut(datetime),
 * nightlyRate(int SAR cents), totalCost, mealIncluded(bool),
 * transportIncluded(bool), status(reserved/checked_in/checked_out/cancelled/no_show),
 * confirmationNumber, notes, createdAt, updatedAt
 */

// Inferred types
export type EmergencyHotel = typeof emergencyHotels.$inferSelect;
export type InsertEmergencyHotel = typeof emergencyHotels.$inferInsert;
export type EmergencyHotelBooking = typeof emergencyHotelBookings.$inferSelect;
export type InsertEmergencyHotelBooking =
  typeof emergencyHotelBookings.$inferInsert;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export {
  requestHotelRoom as bookHotelRoom,
  requestHotelCancellation as cancelHotelBooking,
} from "./hotel-fulfillment.service";
import { nightsBetween } from "./hotel-fulfillment.service";

// ---------------------------------------------------------------------------
// Service Functions
// ---------------------------------------------------------------------------

/**
 * Find nearby hotels for a given airport that are active and available.
 */
export async function findNearbyHotels(
  airportId: number,
  checkIn: Date,
  checkOut: Date,
  _guests: number
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const hotels = await db
    .select()
    .from(emergencyHotels)
    .where(
      and(
        eq(emergencyHotels.airportId, airportId),
        eq(emergencyHotels.isActive, true)
      )
    )
    .orderBy(emergencyHotels.distanceKm);

  // Enrich each hotel with an estimated total cost for the stay
  const nights = nightsBetween(checkIn, checkOut);

  return hotels.map(hotel => ({
    ...hotel,
    estimatedNights: nights,
    estimatedTotalStandard: hotel.standardRate * nights,
    estimatedTotalSuite: Math.round(hotel.standardRate * 1.8) * nights,
  }));
}

/**
 * Get all hotel bookings for a disrupted flight.
 */
export async function getHotelBookingsByFlight(flightId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  return await db
    .select({
      id: emergencyHotelBookings.id,
      hotelId: emergencyHotelBookings.hotelId,
      bookingId: emergencyHotelBookings.bookingId,
      flightId: emergencyHotelBookings.flightId,
      passengerId: emergencyHotelBookings.passengerId,
      roomType: emergencyHotelBookings.roomType,
      checkIn: emergencyHotelBookings.checkIn,
      checkOut: emergencyHotelBookings.checkOut,
      nightlyRate: emergencyHotelBookings.nightlyRate,
      totalCost: emergencyHotelBookings.totalCost,
      mealIncluded: emergencyHotelBookings.mealIncluded,
      transportIncluded: emergencyHotelBookings.transportIncluded,
      status: emergencyHotelBookings.status,
      providerLastError: emergencyHotelBookings.providerLastError,
      confirmationNumber: emergencyHotelBookings.confirmationNumber,
      requestReference: emergencyHotelBookings.requestReference,
      notes: emergencyHotelBookings.notes,
      createdAt: emergencyHotelBookings.createdAt,
      hotelName: emergencyHotels.name,
      hotelAddress: emergencyHotels.address,
      hotelPhone: emergencyHotels.phone,
      hotelStarRating: emergencyHotels.starRating,
    })
    .from(emergencyHotelBookings)
    .innerJoin(
      emergencyHotels,
      eq(emergencyHotelBookings.hotelId, emergencyHotels.id)
    )
    .where(eq(emergencyHotelBookings.flightId, flightId))
    .orderBy(sql`${emergencyHotelBookings.createdAt} DESC`);
}

/**
 * Get hotel bookings for a specific passenger.
 */
export async function getHotelBookingsByPassenger(passengerId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  return await db
    .select({
      id: emergencyHotelBookings.id,
      hotelId: emergencyHotelBookings.hotelId,
      bookingId: emergencyHotelBookings.bookingId,
      flightId: emergencyHotelBookings.flightId,
      passengerId: emergencyHotelBookings.passengerId,
      roomType: emergencyHotelBookings.roomType,
      checkIn: emergencyHotelBookings.checkIn,
      checkOut: emergencyHotelBookings.checkOut,
      nightlyRate: emergencyHotelBookings.nightlyRate,
      totalCost: emergencyHotelBookings.totalCost,
      mealIncluded: emergencyHotelBookings.mealIncluded,
      transportIncluded: emergencyHotelBookings.transportIncluded,
      status: emergencyHotelBookings.status,
      confirmationNumber: emergencyHotelBookings.confirmationNumber,
      requestReference: emergencyHotelBookings.requestReference,
      notes: emergencyHotelBookings.notes,
      createdAt: emergencyHotelBookings.createdAt,
      hotelName: emergencyHotels.name,
      hotelAddress: emergencyHotels.address,
      hotelPhone: emergencyHotels.phone,
      hotelStarRating: emergencyHotels.starRating,
      flightNumber: flights.flightNumber,
    })
    .from(emergencyHotelBookings)
    .innerJoin(
      emergencyHotels,
      eq(emergencyHotelBookings.hotelId, emergencyHotels.id)
    )
    .innerJoin(flights, eq(emergencyHotelBookings.flightId, flights.id))
    .where(eq(emergencyHotelBookings.passengerId, passengerId))
    .orderBy(sql`${emergencyHotelBookings.createdAt} DESC`);
}

/**
 * Calculate whether a disrupted passenger is entitled to hotel accommodation.
 *
 * Entitlement rules:
 * - Cancellation: always entitled
 * - Diversion: always entitled
 * - Delay >= 6 hours: entitled to hotel
 * - Delay >= 4 hours: entitled to meals only
 * - Delay < 4 hours: not entitled
 */
export function calculateHotelEntitlement(
  disruptionType: "delay" | "cancellation" | "diversion",
  delayHours: number
): {
  entitled: boolean;
  hotelIncluded: boolean;
  mealsIncluded: boolean;
  transportIncluded: boolean;
  reason: string;
} {
  if (disruptionType === "cancellation") {
    return {
      entitled: true,
      hotelIncluded: true,
      mealsIncluded: true,
      transportIncluded: true,
      reason:
        "Flight cancelled - full hotel accommodation with meals and transport provided",
    };
  }

  if (disruptionType === "diversion") {
    return {
      entitled: true,
      hotelIncluded: true,
      mealsIncluded: true,
      transportIncluded: true,
      reason:
        "Flight diverted - full hotel accommodation with meals and transport provided",
    };
  }

  // Delay
  if (delayHours >= 6) {
    return {
      entitled: true,
      hotelIncluded: true,
      mealsIncluded: true,
      transportIncluded: true,
      reason: `Delay of ${delayHours} hours - hotel accommodation with meals and transport provided`,
    };
  }

  if (delayHours >= 4) {
    return {
      entitled: true,
      hotelIncluded: false,
      mealsIncluded: true,
      transportIncluded: false,
      reason: `Delay of ${delayHours} hours - meals provided (hotel accommodation requires 6+ hour delay)`,
    };
  }

  return {
    entitled: false,
    hotelIncluded: false,
    mealsIncluded: false,
    transportIncluded: false,
    reason: `Delay of ${delayHours} hours - does not meet minimum threshold for accommodation (4+ hours)`,
  };
}

/**
 * Get total hotel costs for disruptions within a date range.
 */
export async function getHotelCosts(dateRange: { from: Date; to: Date }) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const liveReceipt = sql`${emergencyHotelBookings.providerReceipt} IS NOT NULL AND JSON_UNQUOTE(JSON_EXTRACT(${emergencyHotelBookings.providerRequest}, '$.quote.mode')) = 'live'`;
  const range = and(
    gte(emergencyHotelBookings.createdAt, dateRange.from),
    lte(emergencyHotelBookings.createdAt, dateRange.to)
  );
  const active = sql`${liveReceipt} AND ${emergencyHotelBookings.status} IN ('confirmed','checked_in')`;
  const [totals] = await db
    .select({
      totalCost: sql<number>`COALESCE(SUM(CASE WHEN ${liveReceipt} THEN ${emergencyHotelBookings.totalCost} ELSE 0 END),0)`,
      activeTotalCost: sql<number>`COALESCE(SUM(CASE WHEN ${active} THEN ${emergencyHotelBookings.totalCost} ELSE 0 END),0)`,
      cancellationCost: sql<number>`COALESCE(SUM(CASE WHEN ${liveReceipt} AND ${emergencyHotelBookings.status} = 'cancelled' THEN ${emergencyHotelBookings.totalCost} ELSE 0 END),0)`,
      totalBookings: sql<number>`COUNT(*)`,
      activeBookings: sql<number>`COALESCE(SUM(CASE WHEN ${active} THEN 1 ELSE 0 END),0)`,
      cancelledBookings: sql<number>`COALESCE(SUM(CASE WHEN ${emergencyHotelBookings.status} = 'cancelled' THEN 1 ELSE 0 END),0)`,
      pendingBookings: sql<number>`COALESCE(SUM(CASE WHEN ${emergencyHotelBookings.status} IN ('reserved','requested','pending_provider','outcome_unknown','cancellation_pending','cancellation_unknown','rejected') THEN 1 ELSE 0 END),0)`,
    })
    .from(emergencyHotelBookings)
    .where(range);
  const byHotel = await db
    .select({
      hotelId: emergencyHotelBookings.hotelId,
      hotelName: emergencyHotels.name,
      totalCost: sql<number>`COALESCE(SUM(${emergencyHotelBookings.totalCost}),0)`,
      bookingCount: sql<number>`COUNT(*)`,
    })
    .from(emergencyHotelBookings)
    .innerJoin(
      emergencyHotels,
      eq(emergencyHotelBookings.hotelId, emergencyHotels.id)
    )
    .where(and(range, liveReceipt))
    .groupBy(emergencyHotelBookings.hotelId, emergencyHotels.name);
  return {
    summary: {
      totalCost: Number(totals?.totalCost ?? 0),
      activeTotalCost: Number(totals?.activeTotalCost ?? 0),
      cancellationCost: Number(totals?.cancellationCost ?? 0),
      totalBookings: Number(totals?.totalBookings ?? 0),
      activeBookings: Number(totals?.activeBookings ?? 0),
      cancelledBookings: Number(totals?.cancelledBookings ?? 0),
      pendingBookings: Number(totals?.pendingBookings ?? 0),
    },
    byHotel,
    dateRange,
  };
}

/**
 * Assign or update transportation for a hotel booking.
 */
export async function assignTransportation(
  hotelBookingId: number,
  type: "shuttle" | "taxi" | "private_car"
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  return await db.transaction(async tx => {
    const [existing] = await tx
      .select()
      .from(emergencyHotelBookings)
      .where(eq(emergencyHotelBookings.id, hotelBookingId))
      .limit(1);

    if (!existing)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Hotel booking not found",
      });

    if (existing.status === "cancelled" || existing.status === "no_show") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot assign transport to cancelled or no-show booking",
      });
    }

    const transportNote = `Transport requested: ${type}; provider confirmation required`;
    const existingNotes = existing.notes ? `${existing.notes}\n` : "";

    await tx
      .update(emergencyHotelBookings)
      .set({
        transportIncluded: true,
        notes: `${existingNotes}${transportNote}`,
        updatedAt: new Date(),
      })
      .where(eq(emergencyHotelBookings.id, hotelBookingId));

    return {
      success: true,
      transportType: type,
      confirmationNumber: existing.confirmationNumber,
    };
  });
}

/**
 * Get all emergency hotels (admin management).
 */
export async function getAllHotels() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  return await db
    .select({
      id: emergencyHotels.id,
      name: emergencyHotels.name,
      airportId: emergencyHotels.airportId,
      address: emergencyHotels.address,
      phone: emergencyHotels.phone,
      email: emergencyHotels.email,
      starRating: emergencyHotels.starRating,
      standardRate: emergencyHotels.standardRate,
      distanceKm: emergencyHotels.distanceKm,
      hasTransport: emergencyHotels.hasTransport,
      isActive: emergencyHotels.isActive,
      createdAt: emergencyHotels.createdAt,
      airportCode: airports.code,
      airportCity: airports.city,
    })
    .from(emergencyHotels)
    .leftJoin(airports, eq(emergencyHotels.airportId, airports.id))
    .orderBy(emergencyHotels.name);
}

/**
 * Add a new emergency hotel.
 */
export async function addHotel(input: {
  name: string;
  airportId: number;
  address: string;
  phone: string;
  email: string;
  starRating: number;
  standardRate: number;
  distanceKm: number;
  hasTransport: boolean;
}) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const [result] = await db.insert(emergencyHotels).values({
    ...input,
    distanceKm: String(input.distanceKm),
    isActive: true,
  });

  const [hotel] = await db
    .select()
    .from(emergencyHotels)
    .where(eq(emergencyHotels.id, result.insertId))
    .limit(1);

  return hotel;
}

/**
 * Update an existing emergency hotel.
 */
export async function updateHotel(
  hotelId: number,
  input: {
    name?: string;
    address?: string;
    phone?: string;
    email?: string;
    starRating?: number;
    standardRate?: number;
    distanceKm?: number;
    hasTransport?: boolean;
    isActive?: boolean;
  }
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const [existing] = await db
    .select()
    .from(emergencyHotels)
    .where(eq(emergencyHotels.id, hotelId))
    .limit(1);

  if (!existing)
    throw new TRPCError({ code: "NOT_FOUND", message: "Hotel not found" });

  // Build the update payload, converting distanceKm to string for decimal column
  const updatePayload: Record<string, unknown> = { ...input };
  if (input.distanceKm !== undefined) {
    updatePayload.distanceKm = String(input.distanceKm);
  }

  await db
    .update(emergencyHotels)
    .set(updatePayload)
    .where(eq(emergencyHotels.id, hotelId));

  const [updated] = await db
    .select()
    .from(emergencyHotels)
    .where(eq(emergencyHotels.id, hotelId))
    .limit(1);

  return updated;
}
