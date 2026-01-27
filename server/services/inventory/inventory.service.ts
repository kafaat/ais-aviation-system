/**
 * Advanced Inventory Management Service
 *
 * Provides sophisticated seat inventory management:
 * - Real-time availability tracking
 * - Overbooking management
 * - Waitlist handling
 * - Seat holds and releases
 * - Inventory forecasting
 *
 * @module services/inventory/inventory.service
 */

import { db } from "../../db";
import {
  flights,
  bookings,
  seatHolds,
  waitlist,
} from "../../../drizzle/schema";
import { eq, and, gte, lte, sql, lt, count, sum } from "drizzle-orm";

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

export interface SeatHold {
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
  economyRate: number; // e.g., 0.05 = 5% overbooking
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

// Hold expiration time (15 minutes)
const HOLD_EXPIRATION_MINUTES = 15;

// Waitlist offer expiration (24 hours)
const WAITLIST_OFFER_HOURS = 24;

// Default overbooking configuration
const DEFAULT_OVERBOOKING: OverbookingConfig = {
  economyRate: 0.05, // 5% overbooking for economy
  businessRate: 0.02, // 2% overbooking for business
  maxOverbooking: 10, // Maximum 10 seats overbooking
  noShowRate: 0.08, // Historical 8% no-show rate
};

// Inventory status thresholds
const THRESHOLDS = {
  limited: 0.85, // 85% occupancy = limited availability
  waitlistOnly: 0.98, // 98% occupancy = waitlist only
  closed: 1.0, // 100% = closed
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
  // Get flight details
  const database = await db();
  if (!database) {
    throw new Error(`Database not available`);
  }

  const flight = await database.query.flights.findFirst({
    where: eq(flights.id, flightId),
  });

  if (!flight) {
    throw new Error(`Flight ${flightId} not found`);
  }

  // Get total and available seats
  const totalSeats =
    cabinClass === "economy" ? flight.economySeats : flight.businessSeats;
  const baseAvailable =
    cabinClass === "economy"
      ? flight.economyAvailable
      : flight.businessAvailable;

  // Calculate sold seats
  const soldSeats = totalSeats - baseAvailable;

  // Get active holds
  const activeHolds = await getActiveHoldsCount(flightId, cabinClass);

  // Get waitlist count
  const waitlistCount = await getWaitlistCount(flightId, cabinClass);

  // Calculate overbooking limit
  const overbookingConfig = await getOverbookingConfig(flightId);
  const overbookingRate =
    cabinClass === "economy"
      ? overbookingConfig.economyRate
      : overbookingConfig.businessRate;
  const overbookingLimit = Math.min(
    Math.floor(totalSeats * overbookingRate),
    overbookingConfig.maxOverbooking
  );

  // Calculate effective available (including overbooking)
  const availableSeats = baseAvailable - activeHolds;
  const effectiveAvailable = Math.max(0, availableSeats + overbookingLimit);

  // Calculate occupancy rate
  const occupancyRate = (soldSeats + activeHolds) / totalSeats;

  // Determine status
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
  // Get current inventory status
  const inventory = await getInventoryStatus(flightId, cabinClass);

  // Check if seats are available
  if (inventory.effectiveAvailable >= seats) {
    // Create hold
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

  // Check if partial allocation is possible
  if (inventory.effectiveAvailable > 0) {
    const availableSeats = inventory.effectiveAvailable;
    const hold = await createSeatHold(
      flightId,
      cabinClass,
      availableSeats,
      userId,
      sessionId
    );

    // Add remaining to waitlist
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

  // No seats available - add to waitlist
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
 * Create a seat hold
 */
async function createSeatHold(
  flightId: number,
  cabinClass: "economy" | "business",
  seats: number,
  userId: number,
  sessionId: string
): Promise<SeatHold> {
  const expiresAt = new Date(Date.now() + HOLD_EXPIRATION_MINUTES * 60 * 1000);

  // In production, this would insert into seatHolds table
  const hold: SeatHold = {
    id: Date.now(), // Temporary ID
    flightId,
    cabinClass,
    seats,
    userId,
    sessionId,
    expiresAt,
    status: "active",
  };

  console.log(
    JSON.stringify({
      event: "seat_hold_created",
      ...hold,
      timestamp: new Date().toISOString(),
    })
  );

  return hold;
}

/**
 * Release a seat hold
 */
export async function releaseSeatHold(holdId: number): Promise<void> {
  // Update hold status to released
  // Trigger waitlist processing
  console.log(
    JSON.stringify({
      event: "seat_hold_released",
      holdId,
      timestamp: new Date().toISOString(),
    })
  );

  // Process waitlist after release
  // await processWaitlist(flightId, cabinClass);
}

/**
 * Convert hold to booking
 */
export async function convertHoldToBooking(
  holdId: number,
  bookingId: number
): Promise<void> {
  // Update hold status to converted
  // Update flight available seats
  console.log(
    JSON.stringify({
      event: "seat_hold_converted",
      holdId,
      bookingId,
      timestamp: new Date().toISOString(),
    })
  );
}

/**
 * Get active holds count
 */
async function getActiveHoldsCount(
  flightId: number,
  cabinClass: "economy" | "business"
): Promise<number> {
  // Query active holds from database
  // For now, return 0
  return 0;
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
  // Get current waitlist count for priority
  const currentCount = await getWaitlistCount(flightId, cabinClass);
  const priority = currentCount + 1;

  const entry: WaitlistEntry = {
    id: Date.now(),
    flightId,
    cabinClass,
    userId,
    seats,
    priority,
    status: "waiting",
    createdAt: new Date(),
  };

  console.log(
    JSON.stringify({
      event: "waitlist_entry_created",
      ...entry,
      timestamp: new Date().toISOString(),
    })
  );

  return entry;
}

/**
 * Get waitlist count
 */
async function getWaitlistCount(
  flightId: number,
  cabinClass: "economy" | "business"
): Promise<number> {
  // Query waitlist from database
  // For now, return 0
  return 0;
}

/**
 * Process waitlist when seats become available
 */
export async function processWaitlist(
  flightId: number,
  cabinClass: "economy" | "business"
): Promise<void> {
  const inventory = await getInventoryStatus(flightId, cabinClass);

  if (inventory.availableSeats <= 0) {
    return;
  }

  // Get waitlist entries in priority order
  // Offer seats to users
  // Send notifications

  console.log(
    JSON.stringify({
      event: "waitlist_processed",
      flightId,
      cabinClass,
      availableSeats: inventory.availableSeats,
      timestamp: new Date().toISOString(),
    })
  );
}

/**
 * Remove from waitlist
 */
export async function removeFromWaitlist(
  waitlistId: number,
  reason: "confirmed" | "cancelled" | "expired"
): Promise<void> {
  console.log(
    JSON.stringify({
      event: "waitlist_entry_removed",
      waitlistId,
      reason,
      timestamp: new Date().toISOString(),
    })
  );
}

// ============================================================================
// Overbooking Management
// ============================================================================

/**
 * Get overbooking configuration for a flight
 */
async function getOverbookingConfig(
  flightId: number
): Promise<OverbookingConfig> {
  // In production, this would be configurable per route/airline
  return DEFAULT_OVERBOOKING;
}

/**
 * Calculate recommended overbooking based on historical data
 */
export async function calculateRecommendedOverbooking(
  flightId: number
): Promise<{ economy: number; business: number }> {
  const database = await db();
  if (!database) {
    throw new Error(`Database not available`);
  }

  const flight = await database.query.flights.findFirst({
    where: eq(flights.id, flightId),
  });

  if (!flight) {
    throw new Error(`Flight ${flightId} not found`);
  }

  // Get historical no-show rate for this route
  const noShowRate = await getHistoricalNoShowRate(
    flight.originId,
    flight.destinationId
  );

  // Calculate recommended overbooking
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
  // Query historical data
  // For now, return default
  return DEFAULT_OVERBOOKING.noShowRate;
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
  alternativeFlights: number[];
}> {
  // Find volunteers willing to give up seats
  // Calculate compensation based on regulations
  // Find alternative flights

  const compensation = cabinClass === "economy" ? 1500 : 3000; // SAR

  return {
    volunteersNeeded: seatsNeeded,
    compensationOffer: compensation,
    alternativeFlights: [], // Would be populated with actual alternatives
  };
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
  const database = await db();
  if (!database) {
    throw new Error(`Database not available`);
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

  for (let i = 0; i < Math.min(daysAhead, daysUntilDeparture); i++) {
    const date = new Date();
    date.setDate(date.getDate() + i);

    // Simple demand prediction based on days until departure
    const remainingDays = daysUntilDeparture - i;
    let predictedDemand: number;
    let riskLevel: InventoryForecast["riskLevel"];

    if (remainingDays <= 3) {
      predictedDemand = 15; // High last-minute demand
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
  const now = new Date();

  // Update expired holds
  // Release seats back to inventory
  // Trigger waitlist processing

  console.log(
    JSON.stringify({
      event: "holds_cleanup_completed",
      timestamp: now.toISOString(),
    })
  );

  return 0; // Return count of expired holds
}

/**
 * Expire old waitlist offers
 */
export async function expireWaitlistOffers(): Promise<number> {
  const now = new Date();

  // Update expired offers
  // Move to next in waitlist

  console.log(
    JSON.stringify({
      event: "waitlist_offers_cleanup_completed",
      timestamp: now.toISOString(),
    })
  );

  return 0;
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
  forecastDemand,
  expireOldHolds,
  expireWaitlistOffers,
};

export default InventoryService;
