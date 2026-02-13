import { getDb } from "../db";
import { flights, airports } from "../../drizzle/schema";
import { eq, and, sql, gte, lte } from "drizzle-orm";
import {
  int,
  mysqlEnum,
  mysqlTable,
  varchar,
  timestamp,
  boolean,
  text,
  datetime,
  decimal,
  index,
} from "drizzle-orm/mysql-core";

// ---------------------------------------------------------------------------
// Inline Drizzle Table Schemas
// ---------------------------------------------------------------------------

/**
 * emergencyHotels: id, name, airportId, address, phone, email, starRating,
 * standardRate (int SAR cents), distanceKm, hasTransport, isActive, createdAt
 */
export const emergencyHotels = mysqlTable(
  "emergency_hotels",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    airportId: int("airportId").notNull(),
    address: varchar("address", { length: 500 }).notNull(),
    phone: varchar("phone", { length: 50 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    starRating: int("starRating").notNull(),
    /** Nightly standard rate in SAR cents (100 = 1 SAR) */
    standardRate: int("standardRate").notNull(),
    distanceKm: decimal("distanceKm", { precision: 6, scale: 2 }).notNull(),
    hasTransport: boolean("hasTransport").default(false).notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    airportIdx: index("eh_airport_idx").on(table.airportId),
    activeIdx: index("eh_active_idx").on(table.isActive),
  })
);

/**
 * emergencyHotelBookings: id, hotelId, bookingId, flightId, passengerId,
 * roomType(standard/suite), checkIn(datetime), checkOut(datetime),
 * nightlyRate(int SAR cents), totalCost, mealIncluded(bool),
 * transportIncluded(bool), status(reserved/checked_in/checked_out/cancelled/no_show),
 * confirmationNumber, notes, createdAt, updatedAt
 */
export const emergencyHotelBookings = mysqlTable(
  "emergency_hotel_bookings",
  {
    id: int("id").autoincrement().primaryKey(),
    hotelId: int("hotelId").notNull(),
    bookingId: int("bookingId").notNull(),
    flightId: int("flightId").notNull(),
    passengerId: int("passengerId").notNull(),
    roomType: mysqlEnum("roomType", ["standard", "suite"])
      .default("standard")
      .notNull(),
    checkIn: datetime("checkIn").notNull(),
    checkOut: datetime("checkOut").notNull(),
    /** SAR cents */
    nightlyRate: int("nightlyRate").notNull(),
    /** SAR cents */
    totalCost: int("totalCost").notNull(),
    mealIncluded: boolean("mealIncluded").default(true).notNull(),
    transportIncluded: boolean("transportIncluded").default(false).notNull(),
    status: mysqlEnum("status", [
      "reserved",
      "checked_in",
      "checked_out",
      "cancelled",
      "no_show",
    ])
      .default("reserved")
      .notNull(),
    confirmationNumber: varchar("confirmationNumber", { length: 20 }).notNull(),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    hotelIdx: index("ehb_hotel_idx").on(table.hotelId),
    bookingIdx: index("ehb_booking_idx").on(table.bookingId),
    flightIdx: index("ehb_flight_idx").on(table.flightId),
    passengerIdx: index("ehb_passenger_idx").on(table.passengerId),
    statusIdx: index("ehb_status_idx").on(table.status),
    confirmationIdx: index("ehb_confirmation_idx").on(table.confirmationNumber),
  })
);

// Inferred types
export type EmergencyHotel = typeof emergencyHotels.$inferSelect;
export type InsertEmergencyHotel = typeof emergencyHotels.$inferInsert;
export type EmergencyHotelBooking = typeof emergencyHotelBookings.$inferSelect;
export type InsertEmergencyHotelBooking =
  typeof emergencyHotelBookings.$inferInsert;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateConfirmationNumber(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "EH-";
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function nightsBetween(checkIn: Date, checkOut: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  const diff = Math.abs(checkOut.getTime() - checkIn.getTime());
  return Math.max(1, Math.ceil(diff / msPerDay));
}

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
  if (!db) throw new Error("Database not available");

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
 * Book an emergency hotel room for a disrupted passenger.
 */
export async function bookHotelRoom(input: {
  hotelId: number;
  bookingId: number;
  flightId: number;
  passengerId: number;
  roomType: "standard" | "suite";
  checkIn: Date;
  checkOut: Date;
  mealIncluded?: boolean;
  transportIncluded?: boolean;
  notes?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Look up the hotel to get the rate
  const [hotel] = await db
    .select()
    .from(emergencyHotels)
    .where(eq(emergencyHotels.id, input.hotelId))
    .limit(1);

  if (!hotel) throw new Error("Hotel not found");
  if (!hotel.isActive) throw new Error("Hotel is not currently active");

  const nights = nightsBetween(input.checkIn, input.checkOut);
  const nightlyRate =
    input.roomType === "suite"
      ? Math.round(hotel.standardRate * 1.8)
      : hotel.standardRate;
  const totalCost = nightlyRate * nights;
  const confirmationNumber = generateConfirmationNumber();

  const [result] = await db.insert(emergencyHotelBookings).values({
    hotelId: input.hotelId,
    bookingId: input.bookingId,
    flightId: input.flightId,
    passengerId: input.passengerId,
    roomType: input.roomType,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    nightlyRate,
    totalCost,
    mealIncluded: input.mealIncluded ?? true,
    transportIncluded: input.transportIncluded ?? hotel.hasTransport,
    status: "reserved",
    confirmationNumber,
    notes: input.notes ?? null,
  });

  const [booking] = await db
    .select()
    .from(emergencyHotelBookings)
    .where(eq(emergencyHotelBookings.id, result.insertId))
    .limit(1);

  return {
    ...booking,
    hotelName: hotel.name,
    hotelAddress: hotel.address,
    hotelPhone: hotel.phone,
  };
}

/**
 * Cancel an emergency hotel booking.
 */
export async function cancelHotelBooking(hotelBookingId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [existing] = await db
    .select()
    .from(emergencyHotelBookings)
    .where(eq(emergencyHotelBookings.id, hotelBookingId))
    .limit(1);

  if (!existing) throw new Error("Hotel booking not found");

  if (existing.status === "cancelled") {
    throw new Error("Hotel booking is already cancelled");
  }

  if (existing.status === "checked_out") {
    throw new Error("Cannot cancel a completed hotel booking");
  }

  await db
    .update(emergencyHotelBookings)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(emergencyHotelBookings.id, hotelBookingId));

  return { success: true, confirmationNumber: existing.confirmationNumber };
}

/**
 * Get all hotel bookings for a disrupted flight.
 */
export async function getHotelBookingsByFlight(flightId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

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
  if (!db) throw new Error("Database not available");

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
  if (!db) throw new Error("Database not available");

  const costData = await db
    .select({
      totalCost: sql<number>`COALESCE(SUM(${emergencyHotelBookings.totalCost}), 0)`,
      totalBookings: sql<number>`COUNT(*)`,
      cancelledBookings: sql<number>`SUM(CASE WHEN ${emergencyHotelBookings.status} = 'cancelled' THEN 1 ELSE 0 END)`,
      activeBookings: sql<number>`SUM(CASE WHEN ${emergencyHotelBookings.status} != 'cancelled' THEN 1 ELSE 0 END)`,
    })
    .from(emergencyHotelBookings)
    .where(
      and(
        gte(emergencyHotelBookings.createdAt, dateRange.from),
        lte(emergencyHotelBookings.createdAt, dateRange.to)
      )
    );

  const activeCostData = await db
    .select({
      activeTotalCost: sql<number>`COALESCE(SUM(${emergencyHotelBookings.totalCost}), 0)`,
    })
    .from(emergencyHotelBookings)
    .where(
      and(
        gte(emergencyHotelBookings.createdAt, dateRange.from),
        lte(emergencyHotelBookings.createdAt, dateRange.to),
        sql`${emergencyHotelBookings.status} != 'cancelled'`
      )
    );

  const byHotel = await db
    .select({
      hotelId: emergencyHotelBookings.hotelId,
      hotelName: emergencyHotels.name,
      totalCost: sql<number>`COALESCE(SUM(${emergencyHotelBookings.totalCost}), 0)`,
      bookingCount: sql<number>`COUNT(*)`,
    })
    .from(emergencyHotelBookings)
    .innerJoin(
      emergencyHotels,
      eq(emergencyHotelBookings.hotelId, emergencyHotels.id)
    )
    .where(
      and(
        gte(emergencyHotelBookings.createdAt, dateRange.from),
        lte(emergencyHotelBookings.createdAt, dateRange.to),
        sql`${emergencyHotelBookings.status} != 'cancelled'`
      )
    )
    .groupBy(emergencyHotelBookings.hotelId, emergencyHotels.name);

  return {
    summary: {
      totalCost: costData[0]?.totalCost ?? 0,
      activeTotalCost: activeCostData[0]?.activeTotalCost ?? 0,
      totalBookings: costData[0]?.totalBookings ?? 0,
      cancelledBookings: costData[0]?.cancelledBookings ?? 0,
      activeBookings: costData[0]?.activeBookings ?? 0,
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
  if (!db) throw new Error("Database not available");

  const [existing] = await db
    .select()
    .from(emergencyHotelBookings)
    .where(eq(emergencyHotelBookings.id, hotelBookingId))
    .limit(1);

  if (!existing) throw new Error("Hotel booking not found");

  if (existing.status === "cancelled" || existing.status === "no_show") {
    throw new Error("Cannot assign transport to cancelled or no-show booking");
  }

  const transportNote = `Transport: ${type} arranged`;
  const existingNotes = existing.notes ? `${existing.notes}\n` : "";

  await db
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
}

/**
 * Get all emergency hotels (admin management).
 */
export async function getAllHotels() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

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
  if (!db) throw new Error("Database not available");

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
  if (!db) throw new Error("Database not available");

  const [existing] = await db
    .select()
    .from(emergencyHotels)
    .where(eq(emergencyHotels.id, hotelId))
    .limit(1);

  if (!existing) throw new Error("Hotel not found");

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
