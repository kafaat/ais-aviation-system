import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  bookings,
  flights,
  airports,
  passengers,
  userPreferences,
} from "../../drizzle/schema";
import { eq, and, ne } from "drizzle-orm";
import type { MySql2Database } from "drizzle-orm/mysql2";
import type * as schema from "../../drizzle/schema";

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

  const existing = await database
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  if (existing.length > 0) {
    await database
      .update(userPreferences)
      .set({ autoCheckIn: enabled })
      .where(eq(userPreferences.userId, userId));
  } else {
    await database.insert(userPreferences).values({
      userId,
      autoCheckIn: enabled,
    });
  }

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
    if (depTime > now && depTime <= checkInWindow) {
      // Mark as checked in (seat assignment handled separately)
      await database
        .update(bookings)
        .set({ checkedIn: true })
        .where(eq(bookings.id, booking.bookingId));

      processed++;
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

// ============ Carbon Offset Calculator ============

/**
 * Airport coordinates for distance calculation (major airports)
 */
const AIRPORT_COORDINATES: Record<string, { lat: number; lon: number }> = {
  RUH: { lat: 24.9576, lon: 46.6988 },
  JED: { lat: 21.6796, lon: 39.1565 },
  DMM: { lat: 26.4712, lon: 49.7979 },
  MED: { lat: 24.5534, lon: 39.7051 },
  AHB: { lat: 18.2404, lon: 42.6567 },
  TIF: { lat: 21.4834, lon: 40.5443 },
  DXB: { lat: 25.2532, lon: 55.3657 },
  DOH: { lat: 25.2731, lon: 51.6081 },
  BAH: { lat: 26.2708, lon: 50.6336 },
  KWI: { lat: 29.2266, lon: 47.9689 },
  MCT: { lat: 23.5933, lon: 58.2844 },
  AMM: { lat: 31.7226, lon: 35.9932 },
  CAI: { lat: 30.1219, lon: 31.4056 },
  IST: { lat: 41.2753, lon: 28.7519 },
  LHR: { lat: 51.47, lon: -0.4543 },
  CDG: { lat: 49.0097, lon: 2.5479 },
  FRA: { lat: 50.0379, lon: 8.5622 },
  BOM: { lat: 19.0896, lon: 72.8656 },
  DEL: { lat: 28.5562, lon: 77.1 },
  KUL: { lat: 2.7456, lon: 101.7099 },
  SIN: { lat: 1.3644, lon: 103.9915 },
  JFK: { lat: 40.6413, lon: -73.7781 },
};

/**
 * Calculate distance between two points using Haversine formula (km)
 */
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Look up coordinates for an airport by querying the DB for other airports
 * in the same country and checking if any of them exist in the coordinates map.
 * This provides a reasonable proxy when the exact airport is not in the hardcoded map.
 */
async function findCoordsByCountryFromDb(
  database: MySql2Database<typeof schema>,
  country: string,
  excludeCode: string
): Promise<{ lat: number; lon: number } | undefined> {
  const sameCountryAirports = await database
    .select({ code: airports.code })
    .from(airports)
    .where(and(eq(airports.country, country), ne(airports.code, excludeCode)));

  for (const apt of sameCountryAirports) {
    const coords = AIRPORT_COORDINATES[apt.code];
    if (coords) {
      return coords;
    }
  }
  return undefined;
}

/**
 * CO2 emission factors (kg CO2 per passenger per km)
 * Based on ICAO Carbon Emissions Calculator methodology
 */
const CO2_FACTORS = {
  economy: 0.0895, // kg CO2 per km per passenger
  business: 0.2593, // ~2.9x economy (larger seat pitch)
};

/**
 * Calculate carbon footprint for a flight
 */
export async function calculateCarbonOffset(flightId: number): Promise<{
  distanceKm: number;
  co2Economy: number;
  co2Business: number;
  treesEquivalent: number;
  offsetCostSAR: number;
}> {
  const database = await getDb();
  if (!database) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const flightResult = await database
    .select({
      originId: flights.originId,
      destinationId: flights.destinationId,
    })
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);

  if (flightResult.length === 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
  }

  // Fetch airport data including city and country from the database
  const originResult = await database
    .select({
      code: airports.code,
      city: airports.city,
      country: airports.country,
    })
    .from(airports)
    .where(eq(airports.id, flightResult[0].originId))
    .limit(1);

  const destResult = await database
    .select({
      code: airports.code,
      city: airports.city,
      country: airports.country,
    })
    .from(airports)
    .where(eq(airports.id, flightResult[0].destinationId))
    .limit(1);

  const originCode = originResult[0]?.code ?? "";
  const destCode = destResult[0]?.code ?? "";

  // Try the hardcoded coordinates map first
  let originCoords: { lat: number; lon: number } | undefined =
    AIRPORT_COORDINATES[originCode];
  let destCoords: { lat: number; lon: number } | undefined =
    AIRPORT_COORDINATES[destCode];

  // If not found in the coordinates map, use DB airport data to find a
  // nearby airport in the same country as a proxy for distance estimation
  if (!originCoords && originResult[0]) {
    originCoords = await findCoordsByCountryFromDb(
      database,
      originResult[0].country,
      originResult[0].code
    );
  }
  if (!destCoords && destResult[0]) {
    destCoords = await findCoordsByCountryFromDb(
      database,
      destResult[0].country,
      destResult[0].code
    );
  }

  // Fall back to default distance of 1500km only if coordinates still unavailable
  const distanceKm =
    originCoords && destCoords
      ? haversineDistance(
          originCoords.lat,
          originCoords.lon,
          destCoords.lat,
          destCoords.lon
        )
      : 1500;

  const co2Economy = Math.round(distanceKm * CO2_FACTORS.economy);
  const co2Business = Math.round(distanceKm * CO2_FACTORS.business);

  // A mature tree absorbs ~22kg CO2/year
  const treesEquivalent = Math.ceil(co2Economy / 22);

  // Carbon offset cost: ~$15/ton CO2 ≈ 56 SAR/ton = 5.6 halalas/kg
  const offsetCostSAR = Math.round(co2Economy * 0.056 * 100); // in SAR cents

  return {
    distanceKm: Math.round(distanceKm),
    co2Economy,
    co2Business,
    treesEquivalent,
    offsetCostSAR,
  };
}

// ============ Travel Document Requirements ============

/**
 * Travel document requirements by destination country
 * In production, this would come from a database or API (e.g., Timatic)
 */
const TRAVEL_REQUIREMENTS: Record<
  string,
  {
    visaRequired: boolean;
    visaOnArrival: boolean;
    passportValidityMonths: number;
    covidTestRequired: boolean;
    notes: string[];
  }
> = {
  SA: {
    visaRequired: false,
    visaOnArrival: false,
    passportValidityMonths: 6,
    covidTestRequired: false,
    notes: ["GCC citizens: National ID accepted"],
  },
  AE: {
    visaRequired: false,
    visaOnArrival: false,
    passportValidityMonths: 6,
    covidTestRequired: false,
    notes: [
      "GCC citizens: National ID accepted",
      "Free 30-day visa for many nationalities",
    ],
  },
  QA: {
    visaRequired: false,
    visaOnArrival: false,
    passportValidityMonths: 6,
    covidTestRequired: false,
    notes: ["GCC citizens: National ID accepted"],
  },
  BH: {
    visaRequired: false,
    visaOnArrival: false,
    passportValidityMonths: 6,
    covidTestRequired: false,
    notes: ["GCC citizens: National ID accepted"],
  },
  KW: {
    visaRequired: false,
    visaOnArrival: false,
    passportValidityMonths: 6,
    covidTestRequired: false,
    notes: ["GCC citizens: National ID accepted"],
  },
  OM: {
    visaRequired: false,
    visaOnArrival: false,
    passportValidityMonths: 6,
    covidTestRequired: false,
    notes: ["GCC citizens: National ID accepted"],
  },
  EG: {
    visaRequired: true,
    visaOnArrival: true,
    passportValidityMonths: 6,
    covidTestRequired: false,
    notes: [
      "Visa on arrival available for most nationalities",
      "e-Visa also available",
    ],
  },
  TR: {
    visaRequired: true,
    visaOnArrival: false,
    passportValidityMonths: 6,
    covidTestRequired: false,
    notes: ["e-Visa required before travel", "Saudi citizens may apply online"],
  },
  GB: {
    visaRequired: true,
    visaOnArrival: false,
    passportValidityMonths: 6,
    covidTestRequired: false,
    notes: [
      "Visa required for most nationalities",
      "Apply via UK Visas and Immigration",
    ],
  },
  FR: {
    visaRequired: true,
    visaOnArrival: false,
    passportValidityMonths: 3,
    covidTestRequired: false,
    notes: ["Schengen visa required", "Apply at French embassy/consulate"],
  },
  DE: {
    visaRequired: true,
    visaOnArrival: false,
    passportValidityMonths: 3,
    covidTestRequired: false,
    notes: ["Schengen visa required", "Apply at German embassy/consulate"],
  },
  IN: {
    visaRequired: true,
    visaOnArrival: false,
    passportValidityMonths: 6,
    covidTestRequired: false,
    notes: [
      "e-Visa available for many nationalities",
      "Apply online at indianvisaonline.gov.in",
    ],
  },
  MY: {
    visaRequired: false,
    visaOnArrival: false,
    passportValidityMonths: 6,
    covidTestRequired: false,
    notes: [
      "Visa-free for Saudi citizens (up to 30 days)",
      "eNTRI or eVisa for other nationals",
    ],
  },
  US: {
    visaRequired: true,
    visaOnArrival: false,
    passportValidityMonths: 6,
    covidTestRequired: false,
    notes: [
      "B1/B2 visa required for Saudi citizens",
      "Apply via US embassy appointment",
      "ESTA for eligible nationalities",
    ],
  },
  JO: {
    visaRequired: false,
    visaOnArrival: true,
    passportValidityMonths: 6,
    covidTestRequired: false,
    notes: [
      "Visa on arrival for Saudi citizens",
      "Jordan Pass recommended for tourists",
    ],
  },
};

/**
 * Get travel document requirements for a destination
 */
export async function getTravelRequirements(flightId: number) {
  const database = await getDb();
  if (!database) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const flightResult = await database
    .select({
      destinationId: flights.destinationId,
    })
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);

  if (flightResult.length === 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
  }

  const destResult = await database
    .select({
      code: airports.code,
      country: airports.country,
      city: airports.city,
    })
    .from(airports)
    .where(eq(airports.id, flightResult[0].destinationId))
    .limit(1);

  if (destResult.length === 0) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Destination not found",
    });
  }

  const dest = destResult[0];
  const requirements = TRAVEL_REQUIREMENTS[dest.country] ?? {
    visaRequired: true,
    visaOnArrival: false,
    passportValidityMonths: 6,
    covidTestRequired: false,
    notes: ["Please check with the embassy for entry requirements"],
  };

  return {
    destination: {
      code: dest.code,
      city: dest.city,
      country: dest.country,
    },
    requirements,
  };
}
