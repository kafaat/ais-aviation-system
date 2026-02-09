/**
 * Advanced Inventory Management Service
 *
 * Provides sophisticated seat inventory management:
 * - Real-time availability tracking with DB-backed seat holds
 * - Overbooking management with per-route configuration
 * - Waitlist handling with automatic seat offers
 * - Seat holds and releases with 15-minute expiration
 * - Inventory forecasting
 *
 * @module services/inventory/inventory.service
 */

import { getDb } from "../../db";
import {
  flights,
  bookings,
  seatHolds,
  waitlist,
  overbookingConfig as overbookingConfigTable,
  deniedBoardingRecords,
} from "../../../drizzle/schema";
import { eq, and, gte, sql, lt, desc, asc } from "drizzle-orm";

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface InventoryStatus {
  flightId: number;
  cabinClass: "economy" | "business";
  totalSeats: number;
  soldSeats: number;
  heldSeats: number;
  availableSeats: number;
  waitlistCount: number;
  overbookingLimit: number;
  effectiveAvailable: number;
  occupancyRate: number;
  status: "available" | "limited" | "waitlist_only" | "closed";
}

export interface SeatHoldData {
  id: number;
  flightId: number;
  cabinClass: "economy" | "business";
  seats: number;
  userId: number;
  sessionId: string;
  expiresAt: Date;
  status: "active" | "converted" | "expired" | "released";
}

export interface WaitlistEntry {
  id: number;
  flightId: number;
  cabinClass: "economy" | "business";
  userId: number;
  seats: number;
  priority: number;
  status: "waiting" | "offered" | "confirmed" | "expired" | "cancelled";
  createdAt: Date;
  offeredAt?: Date;
  expiresAt?: Date;
}

export interface OverbookingConfig {
  economyRate: number;
  businessRate: number;
  maxOverbooking: number;
  noShowRate: number;
}

export interface InventoryForecast {
  date: Date;
  predictedDemand: number;
  recommendedOverbooking: number;
  expectedNoShows: number;
  riskLevel: "low" | "medium" | "high";
}

export interface SeatAllocationResult {
  success: boolean;
  holdId?: number;
  seatsAllocated: number;
  expiresAt?: Date;
  waitlistPosition?: number;
  message: string;
}

// ============================================================================
// Constants
// ============================================================================

const HOLD_EXPIRATION_MINUTES = 15;
const WAITLIST_OFFER_HOURS = 24;

const DEFAULT_OVERBOOKING: OverbookingConfig = {
  economyRate: 0.05,
  businessRate: 0.02,
  maxOverbooking: 10,
  noShowRate: 0.08,
};

const THRESHOLDS = {
  limited: 0.85,
  waitlistOnly: 0.98,
  closed: 1.0,
};

// ============================================================================
// Main Inventory Service
// ============================================================================

/**
 * Get real-time inventory status for a flight
 */
export async function getInventoryStatus(
  flightId: number,
  cabinClass: "economy" | "business"
): Promise<InventoryStatus> {
  const database = await getDb();
  if (!database) {
    throw new Error("Database connection not available");
  }

  const flight = await database.query.flights.findFirst({
    where: eq(flights.id, flightId),
  });

  if (!flight) {
    throw new Error(`Flight ${flightId} not found`);
  }

  const totalSeats =
    cabinClass === "economy" ? flight.economySeats : flight.businessSeats;
  const baseAvailable =
    cabinClass === "economy"
      ? flight.economyAvailable
      : flight.businessAvailable;

  const soldSeats = totalSeats - baseAvailable;
  const activeHolds = await getActiveHoldsCount(flightId, cabinClass);
  const waitlistCount = await getWaitlistCount(flightId, cabinClass);

  const overbookingCfg = await getOverbookingConfig(flightId);
  const overbookingRate =
    cabinClass === "economy"
      ? overbookingCfg.economyRate
      : overbookingCfg.businessRate;
  const overbookingLimit = Math.min(
    Math.floor(totalSeats * overbookingRate),
    overbookingCfg.maxOverbooking
  );

  const availableSeats = baseAvailable - activeHolds;
  const effectiveAvailable = Math.max(0, availableSeats + overbookingLimit);
  const occupancyRate =
    totalSeats > 0 ? (soldSeats + activeHolds) / totalSeats : 0;

  let status: InventoryStatus["status"];
  if (effectiveAvailable <= 0) {
    status = waitlistCount > 0 ? "waitlist_only" : "closed";
  } else if (occupancyRate >= THRESHOLDS.waitlistOnly) {
    status = "waitlist_only";
  } else if (occupancyRate >= THRESHOLDS.limited) {
    status = "limited";
  } else {
    status = "available";
  }

  return {
    flightId,
    cabinClass,
    totalSeats,
    soldSeats,
    heldSeats: activeHolds,
    availableSeats,
    waitlistCount,
    overbookingLimit,
    effectiveAvailable,
    occupancyRate,
    status,
  };
}

/**
 * Attempt to allocate seats (with hold)
 */
export async function allocateSeats(
  flightId: number,
  cabinClass: "economy" | "business",
  seats: number,
  userId: number,
  sessionId: string
): Promise<SeatAllocationResult> {
  const inventory = await getInventoryStatus(flightId, cabinClass);

  if (inventory.effectiveAvailable >= seats) {
    const hold = await createSeatHold(
      flightId,
      cabinClass,
      seats,
      userId,
      sessionId
    );

    return {
      success: true,
      holdId: hold.id,
      seatsAllocated: seats,
      expiresAt: hold.expiresAt,
      message: `${seats} seat(s) held successfully`,
    };
  }

  if (inventory.effectiveAvailable > 0) {
    const availableSeats = inventory.effectiveAvailable;
    const hold = await createSeatHold(
      flightId,
      cabinClass,
      availableSeats,
      userId,
      sessionId
    );

    const remainingSeats = seats - availableSeats;
    const waitlistEntry = await addToWaitlist(
      flightId,
      cabinClass,
      remainingSeats,
      userId
    );

    return {
      success: true,
      holdId: hold.id,
      seatsAllocated: availableSeats,
      expiresAt: hold.expiresAt,
      waitlistPosition: waitlistEntry.priority,
      message: `${availableSeats} seat(s) held, ${remainingSeats} added to waitlist (position ${waitlistEntry.priority})`,
    };
  }

  if (inventory.status !== "closed") {
    const waitlistEntry = await addToWaitlist(
      flightId,
      cabinClass,
      seats,
      userId
    );

    return {
      success: false,
      seatsAllocated: 0,
      waitlistPosition: waitlistEntry.priority,
      message: `No seats available. Added to waitlist at position ${waitlistEntry.priority}`,
    };
  }

  return {
    success: false,
    seatsAllocated: 0,
    message: "Flight is fully booked and waitlist is closed",
  };
}

/**
 * Create a seat hold in the database
 */
async function createSeatHold(
  flightId: number,
  cabinClass: "economy" | "business",
  seats: number,
  userId: number,
  sessionId: string
): Promise<SeatHoldData> {
  const database = await getDb();
  if (!database) {
    throw new Error("Database connection not available");
  }

  const expiresAt = new Date(Date.now() + HOLD_EXPIRATION_MINUTES * 60 * 1000);

  const result = await database.insert(seatHolds).values({
    flightId,
    cabinClass,
    seats,
    userId,
    sessionId,
    status: "active",
    expiresAt,
  });

  const holdId = Number(result[0].insertId);

  console.info(
    `[Inventory] Seat hold created: id=${holdId}, flight=${flightId}, class=${cabinClass}, seats=${seats}, expires=${expiresAt.toISOString()}`
  );

  return {
    id: holdId,
    flightId,
    cabinClass,
    seats,
    userId,
    sessionId,
    expiresAt,
    status: "active",
  };
}

/**
 * Release a seat hold
 */
export async function releaseSeatHold(holdId: number): Promise<void> {
  const database = await getDb();
  if (!database) {
    throw new Error("Database connection not available");
  }

  // Get hold details before releasing
  const [hold] = await database
    .select()
    .from(seatHolds)
    .where(eq(seatHolds.id, holdId))
    .limit(1);

  if (!hold) {
    throw new Error(`Seat hold ${holdId} not found`);
  }

  if (hold.status !== "active") {
    throw new Error(
      `Seat hold ${holdId} is not active (status: ${hold.status})`
    );
  }

  await database
    .update(seatHolds)
    .set({ status: "released", updatedAt: new Date() })
    .where(eq(seatHolds.id, holdId));

  console.info(`[Inventory] Seat hold released: id=${holdId}`);

  // Process waitlist after releasing seats
  await processWaitlist(
    hold.flightId,
    hold.cabinClass as "economy" | "business"
  );
}

/**
 * Convert hold to booking
 */
export async function convertHoldToBooking(
  holdId: number,
  bookingId: number
): Promise<void> {
  const database = await getDb();
  if (!database) {
    throw new Error("Database connection not available");
  }

  const [hold] = await database
    .select()
    .from(seatHolds)
    .where(eq(seatHolds.id, holdId))
    .limit(1);

  if (!hold) {
    throw new Error(`Seat hold ${holdId} not found`);
  }

  await database
    .update(seatHolds)
    .set({
      status: "converted",
      bookingId,
      updatedAt: new Date(),
    })
    .where(eq(seatHolds.id, holdId));

  console.info(
    `[Inventory] Seat hold converted: id=${holdId}, bookingId=${bookingId}`
  );
}

/**
 * Get active holds count from database
 */
async function getActiveHoldsCount(
  flightId: number,
  cabinClass: "economy" | "business"
): Promise<number> {
  const database = await getDb();
  if (!database) return 0;

  const now = new Date();

  const result = await database
    .select({
      totalSeats: sql<number>`COALESCE(SUM(${seatHolds.seats}), 0)`,
    })
    .from(seatHolds)
    .where(
      and(
        eq(seatHolds.flightId, flightId),
        eq(seatHolds.cabinClass, cabinClass),
        eq(seatHolds.status, "active"),
        gte(seatHolds.expiresAt, now)
      )
    );

  return Number(result[0]?.totalSeats ?? 0);
}

// ============================================================================
// Waitlist Management
// ============================================================================

/**
 * Add user to waitlist
 */
export async function addToWaitlist(
  flightId: number,
  cabinClass: "economy" | "business",
  seats: number,
  userId: number
): Promise<WaitlistEntry> {
  const database = await getDb();
  if (!database) {
    throw new Error("Database connection not available");
  }

  const currentCount = await getWaitlistCount(flightId, cabinClass);
  const priority = currentCount + 1;

  const result = await database.insert(waitlist).values({
    flightId,
    cabinClass,
    userId,
    seats,
    priority,
    status: "waiting",
    notifyByEmail: true,
    notifyBySms: false,
  });

  const entryId = Number(result[0].insertId);

  console.info(
    `[Inventory] Waitlist entry created: id=${entryId}, flight=${flightId}, class=${cabinClass}, priority=${priority}`
  );

  return {
    id: entryId,
    flightId,
    cabinClass,
    userId,
    seats,
    priority,
    status: "waiting",
    createdAt: new Date(),
  };
}

/**
 * Get waitlist count from database
 */
async function getWaitlistCount(
  flightId: number,
  cabinClass: "economy" | "business"
): Promise<number> {
  const database = await getDb();
  if (!database) return 0;

  const result = await database
    .select({
      cnt: sql<number>`COUNT(*)`,
    })
    .from(waitlist)
    .where(
      and(
        eq(waitlist.flightId, flightId),
        eq(waitlist.cabinClass, cabinClass),
        eq(waitlist.status, "waiting")
      )
    );

  return Number(result[0]?.cnt ?? 0);
}

/**
 * Process waitlist when seats become available
 */
export async function processWaitlist(
  flightId: number,
  cabinClass: "economy" | "business"
): Promise<number> {
  const database = await getDb();
  if (!database) {
    throw new Error("Database connection not available");
  }

  const inventory = await getInventoryStatus(flightId, cabinClass);
  if (inventory.availableSeats <= 0) {
    return 0;
  }

  // Get waitlist entries in priority order
  const entries = await database
    .select()
    .from(waitlist)
    .where(
      and(
        eq(waitlist.flightId, flightId),
        eq(waitlist.cabinClass, cabinClass),
        eq(waitlist.status, "waiting")
      )
    )
    .orderBy(asc(waitlist.priority))
    .limit(10);

  let seatsOffered = 0;
  const offerExpiresAt = new Date(
    Date.now() + WAITLIST_OFFER_HOURS * 60 * 60 * 1000
  );

  for (const entry of entries) {
    if (seatsOffered + entry.seats > inventory.availableSeats) {
      break;
    }

    await database
      .update(waitlist)
      .set({
        status: "offered",
        offeredAt: new Date(),
        offerExpiresAt: offerExpiresAt,
        updatedAt: new Date(),
      })
      .where(eq(waitlist.id, entry.id));

    seatsOffered += entry.seats;

    console.info(
      `[Inventory] Waitlist offer sent: id=${entry.id}, user=${entry.userId}, seats=${entry.seats}`
    );
  }

  return seatsOffered;
}

/**
 * Remove from waitlist
 */
export async function removeFromWaitlist(
  waitlistId: number,
  reason: "confirmed" | "cancelled" | "expired"
): Promise<void> {
  const database = await getDb();
  if (!database) {
    throw new Error("Database connection not available");
  }

  await database
    .update(waitlist)
    .set({
      status: reason,
      updatedAt: new Date(),
    })
    .where(eq(waitlist.id, waitlistId));

  console.info(
    `[Inventory] Waitlist entry removed: id=${waitlistId}, reason=${reason}`
  );
}

// ============================================================================
// Overbooking Management
// ============================================================================

/**
 * Get overbooking configuration for a flight (checks per-route config first)
 */
async function getOverbookingConfig(
  flightId: number
): Promise<OverbookingConfig> {
  const database = await getDb();
  if (!database) return DEFAULT_OVERBOOKING;

  const flight = await database.query.flights.findFirst({
    where: eq(flights.id, flightId),
  });

  if (!flight) return DEFAULT_OVERBOOKING;

  // Check for route-specific config
  const routeConfig = await database
    .select()
    .from(overbookingConfigTable)
    .where(
      and(
        eq(overbookingConfigTable.originId, flight.originId),
        eq(overbookingConfigTable.destinationId, flight.destinationId),
        eq(overbookingConfigTable.isActive, true)
      )
    )
    .limit(1);

  if (routeConfig.length > 0) {
    const cfg = routeConfig[0];
    return {
      economyRate: Number(cfg.economyRate),
      businessRate: Number(cfg.businessRate),
      maxOverbooking: cfg.maxOverbooking,
      noShowRate: cfg.historicalNoShowRate
        ? Number(cfg.historicalNoShowRate)
        : DEFAULT_OVERBOOKING.noShowRate,
    };
  }

  // Check for airline-specific config
  const airlineConfig = await database
    .select()
    .from(overbookingConfigTable)
    .where(
      and(
        eq(overbookingConfigTable.airlineId, flight.airlineId),
        eq(overbookingConfigTable.isActive, true),
        sql`${overbookingConfigTable.originId} IS NULL`
      )
    )
    .limit(1);

  if (airlineConfig.length > 0) {
    const cfg = airlineConfig[0];
    return {
      economyRate: Number(cfg.economyRate),
      businessRate: Number(cfg.businessRate),
      maxOverbooking: cfg.maxOverbooking,
      noShowRate: cfg.historicalNoShowRate
        ? Number(cfg.historicalNoShowRate)
        : DEFAULT_OVERBOOKING.noShowRate,
    };
  }

  return DEFAULT_OVERBOOKING;
}

/**
 * Calculate recommended overbooking based on historical data
 */
export async function calculateRecommendedOverbooking(
  flightId: number
): Promise<{ economy: number; business: number }> {
  const database = await getDb();
  if (!database) {
    throw new Error("Database connection not available");
  }

  const flight = await database.query.flights.findFirst({
    where: eq(flights.id, flightId),
  });

  if (!flight) {
    throw new Error(`Flight ${flightId} not found`);
  }

  const noShowRate = await getHistoricalNoShowRate(
    flight.originId,
    flight.destinationId
  );

  const economyOverbooking = Math.floor(flight.economySeats * noShowRate * 0.8);
  const businessOverbooking = Math.floor(
    flight.businessSeats * noShowRate * 0.5
  );

  return {
    economy: Math.min(economyOverbooking, DEFAULT_OVERBOOKING.maxOverbooking),
    business: Math.min(
      businessOverbooking,
      Math.floor(DEFAULT_OVERBOOKING.maxOverbooking / 2)
    ),
  };
}

/**
 * Get historical no-show rate for a route
 */
async function getHistoricalNoShowRate(
  originId: number,
  destinationId: number
): Promise<number> {
  const database = await getDb();
  if (!database) return DEFAULT_OVERBOOKING.noShowRate;

  // Check overbooking config for stored historical rate
  const config = await database
    .select()
    .from(overbookingConfigTable)
    .where(
      and(
        eq(overbookingConfigTable.originId, originId),
        eq(overbookingConfigTable.destinationId, destinationId),
        eq(overbookingConfigTable.isActive, true)
      )
    )
    .limit(1);

  if (config.length > 0 && config[0].historicalNoShowRate) {
    return Number(config[0].historicalNoShowRate);
  }

  // Calculate from completed flights on this route
  const completedFlights = await database
    .select({
      flightId: flights.id,
      totalPassengers: sql<number>`(${flights.economySeats} + ${flights.businessSeats})`,
    })
    .from(flights)
    .where(
      and(
        eq(flights.originId, originId),
        eq(flights.destinationId, destinationId),
        eq(flights.status, "completed")
      )
    )
    .limit(50);

  if (completedFlights.length === 0) {
    return DEFAULT_OVERBOOKING.noShowRate;
  }

  // Count no-shows from bookings
  let totalBookings = 0;
  let noShows = 0;

  for (const flight of completedFlights) {
    const bookingResults = await database
      .select({
        cnt: sql<number>`COUNT(*)`,
        noShowCnt: sql<number>`SUM(CASE WHEN ${bookings.status} = 'confirmed' AND ${bookings.checkedIn} = false THEN 1 ELSE 0 END)`,
      })
      .from(bookings)
      .where(eq(bookings.flightId, flight.flightId));

    if (bookingResults.length > 0) {
      totalBookings += Number(bookingResults[0].cnt);
      noShows += Number(bookingResults[0].noShowCnt ?? 0);
    }
  }

  return totalBookings > 0
    ? noShows / totalBookings
    : DEFAULT_OVERBOOKING.noShowRate;
}

/**
 * Handle denied boarding (overbooking resolution)
 */
export async function handleDeniedBoarding(
  flightId: number,
  cabinClass: "economy" | "business",
  seatsNeeded: number
): Promise<{
  volunteersNeeded: number;
  compensationOffer: number;
  alternativeFlights: Array<{
    id: number;
    flightNumber: string;
    departureTime: Date;
    availableSeats: number;
  }>;
}> {
  const database = await getDb();
  if (!database) {
    throw new Error("Database connection not available");
  }

  // Get the flight info for route-based alternative search
  const flight = await database.query.flights.findFirst({
    where: eq(flights.id, flightId),
  });

  if (!flight) {
    throw new Error(`Flight ${flightId} not found`);
  }

  // Calculate compensation based on cabin class
  const compensation = cabinClass === "economy" ? 150000 : 300000;

  // Find alternative flights on the same route
  const availableCol =
    cabinClass === "economy"
      ? flights.economyAvailable
      : flights.businessAvailable;

  const alternatives = await database
    .select({
      id: flights.id,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      availableSeats: availableCol,
    })
    .from(flights)
    .where(
      and(
        eq(flights.originId, flight.originId),
        eq(flights.destinationId, flight.destinationId),
        eq(flights.status, "scheduled"),
        gte(flights.departureTime, flight.departureTime),
        sql`${flights.id} != ${flightId}`
      )
    )
    .orderBy(flights.departureTime)
    .limit(5);

  return {
    volunteersNeeded: seatsNeeded,
    compensationOffer: compensation,
    alternativeFlights: alternatives.filter(
      f => f.availableSeats >= seatsNeeded
    ),
  };
}

/**
 * Record a denied boarding incident
 */
export async function recordDeniedBoarding(data: {
  flightId: number;
  bookingId: number;
  userId: number;
  type: "voluntary" | "involuntary";
  compensationAmount: number;
  compensationType: "cash" | "voucher" | "miles";
  alternativeFlightId?: number;
  notes?: string;
}): Promise<{ id: number }> {
  const database = await getDb();
  if (!database) {
    throw new Error("Database connection not available");
  }

  const result = await database.insert(deniedBoardingRecords).values({
    flightId: data.flightId,
    bookingId: data.bookingId,
    userId: data.userId,
    type: data.type,
    compensationAmount: data.compensationAmount,
    compensationCurrency: "SAR",
    compensationType: data.compensationType,
    alternativeFlightId: data.alternativeFlightId ?? null,
    status: "pending",
    notes: data.notes ?? null,
  });

  return { id: Number(result[0].insertId) };
}

/**
 * Get denied boarding records for a flight
 */
export async function getDeniedBoardingRecords(flightId: number) {
  const database = await getDb();
  if (!database) {
    throw new Error("Database connection not available");
  }

  return database
    .select()
    .from(deniedBoardingRecords)
    .where(eq(deniedBoardingRecords.flightId, flightId))
    .orderBy(desc(deniedBoardingRecords.createdAt));
}

/**
 * Update denied boarding record status
 */
export async function updateDeniedBoardingStatus(
  recordId: number,
  status: "accepted" | "rejected" | "completed"
): Promise<void> {
  const database = await getDb();
  if (!database) {
    throw new Error("Database connection not available");
  }

  await database
    .update(deniedBoardingRecords)
    .set({ status, updatedAt: new Date() })
    .where(eq(deniedBoardingRecords.id, recordId));
}

/**
 * Get all overbooking configurations
 */
export async function getOverbookingConfigs() {
  const database = await getDb();
  if (!database) {
    throw new Error("Database connection not available");
  }

  return database
    .select()
    .from(overbookingConfigTable)
    .orderBy(desc(overbookingConfigTable.createdAt));
}

/**
 * Create or update overbooking configuration
 */
export async function upsertOverbookingConfig(data: {
  airlineId?: number;
  originId?: number;
  destinationId?: number;
  economyRate: string;
  businessRate: string;
  maxOverbooking: number;
  historicalNoShowRate?: string;
}): Promise<{ id: number }> {
  const database = await getDb();
  if (!database) {
    throw new Error("Database connection not available");
  }

  const result = await database.insert(overbookingConfigTable).values({
    airlineId: data.airlineId ?? null,
    originId: data.originId ?? null,
    destinationId: data.destinationId ?? null,
    economyRate: data.economyRate,
    businessRate: data.businessRate,
    maxOverbooking: data.maxOverbooking,
    historicalNoShowRate: data.historicalNoShowRate ?? null,
    isActive: true,
  });

  return { id: Number(result[0].insertId) };
}

// ============================================================================
// Inventory Forecasting
// ============================================================================

/**
 * Forecast inventory demand
 */
export async function forecastDemand(
  flightId: number,
  daysAhead: number = 30
): Promise<InventoryForecast[]> {
  const database = await getDb();
  if (!database) {
    throw new Error("Database connection not available");
  }

  const flight = await database.query.flights.findFirst({
    where: eq(flights.id, flightId),
  });

  if (!flight) {
    throw new Error(`Flight ${flightId} not found`);
  }

  const forecasts: InventoryForecast[] = [];
  const daysUntilDeparture = Math.floor(
    (flight.departureTime.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );

  for (
    let i = 0;
    i < Math.min(daysAhead, Math.max(daysUntilDeparture, 0));
    i++
  ) {
    const date = new Date();
    date.setDate(date.getDate() + i);

    const remainingDays = daysUntilDeparture - i;
    let predictedDemand: number;
    let riskLevel: InventoryForecast["riskLevel"];

    if (remainingDays <= 3) {
      predictedDemand = 15;
      riskLevel = "high";
    } else if (remainingDays <= 7) {
      predictedDemand = 10;
      riskLevel = "medium";
    } else if (remainingDays <= 14) {
      predictedDemand = 5;
      riskLevel = "low";
    } else {
      predictedDemand = 3;
      riskLevel = "low";
    }

    const expectedNoShows = Math.floor(
      (flight.economySeats + flight.businessSeats) *
        DEFAULT_OVERBOOKING.noShowRate
    );

    forecasts.push({
      date,
      predictedDemand,
      recommendedOverbooking: Math.floor(expectedNoShows * 0.8),
      expectedNoShows,
      riskLevel,
    });
  }

  return forecasts;
}

// ============================================================================
// Cleanup & Maintenance
// ============================================================================

/**
 * Expire old seat holds
 */
export async function expireOldHolds(): Promise<number> {
  const database = await getDb();
  if (!database) {
    throw new Error("Database connection not available");
  }

  const now = new Date();

  // Find expired holds
  const expiredHolds = await database
    .select({
      id: seatHolds.id,
      flightId: seatHolds.flightId,
      cabinClass: seatHolds.cabinClass,
      seats: seatHolds.seats,
    })
    .from(seatHolds)
    .where(and(eq(seatHolds.status, "active"), lt(seatHolds.expiresAt, now)));

  if (expiredHolds.length === 0) {
    return 0;
  }

  // Update all expired holds
  await database
    .update(seatHolds)
    .set({ status: "expired", updatedAt: now })
    .where(and(eq(seatHolds.status, "active"), lt(seatHolds.expiresAt, now)));

  console.info(`[Inventory] Expired ${expiredHolds.length} seat holds`);

  // Process waitlist for each affected flight/class combination
  const flightClassPairs = new Set<string>();
  for (const hold of expiredHolds) {
    flightClassPairs.add(`${hold.flightId}:${hold.cabinClass}`);
  }

  for (const pair of flightClassPairs) {
    const [flightIdStr, cabinClass] = pair.split(":");
    await processWaitlist(
      Number(flightIdStr),
      cabinClass as "economy" | "business"
    );
  }

  return expiredHolds.length;
}

/**
 * Expire old waitlist offers
 */
export async function expireWaitlistOffers(): Promise<number> {
  const database = await getDb();
  if (!database) {
    throw new Error("Database connection not available");
  }

  const now = new Date();

  // Find expired offers
  const expiredOffers = await database
    .select({ id: waitlist.id })
    .from(waitlist)
    .where(
      and(eq(waitlist.status, "offered"), lt(waitlist.offerExpiresAt, now))
    );

  if (expiredOffers.length === 0) {
    return 0;
  }

  // Update expired offers
  await database
    .update(waitlist)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(eq(waitlist.status, "offered"), lt(waitlist.offerExpiresAt, now))
    );

  console.info(`[Inventory] Expired ${expiredOffers.length} waitlist offers`);

  return expiredOffers.length;
}

// ============================================================================
// Exports
// ============================================================================

export const InventoryService = {
  getInventoryStatus,
  allocateSeats,
  releaseSeatHold,
  convertHoldToBooking,
  addToWaitlist,
  processWaitlist,
  removeFromWaitlist,
  calculateRecommendedOverbooking,
  handleDeniedBoarding,
  recordDeniedBoarding,
  getDeniedBoardingRecords,
  updateDeniedBoardingStatus,
  getOverbookingConfigs,
  upsertOverbookingConfig,
  forecastDemand,
  expireOldHolds,
  expireWaitlistOffers,
};

export default InventoryService;
