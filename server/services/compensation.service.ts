import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  bookings,
  flights,
  airports,
  passengers,
  flightDisruptions,
} from "../../drizzle/schema";
import { eq, sql, desc, type SQL } from "drizzle-orm";

// ============================================================================
// Inline Schema Types (not persisted as Drizzle tables)
// ============================================================================

export interface CompensationClaim {
  id: number;
  bookingId: number;
  flightId: number;
  passengerId: number | null;
  regulationType: "eu261" | "dot" | "local";
  claimType: "delay" | "cancellation" | "denied_boarding" | "downgrade";
  flightDistance: number | null;
  delayMinutes: number | null;
  calculatedAmount: number; // SAR cents
  approvedAmount: number | null;
  currency: string;
  status:
    | "pending"
    | "under_review"
    | "approved"
    | "denied"
    | "paid"
    | "appealed";
  reason: string | null;
  denialReason: string | null;
  filedAt: Date;
  resolvedAt: Date | null;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CompensationRule {
  id: number;
  regulationType: "eu261" | "dot" | "local";
  claimType: "delay" | "cancellation" | "denied_boarding" | "downgrade";
  minDelay: number | null;
  maxDelay: number | null;
  distanceMin: number | null;
  distanceMax: number | null;
  compensationAmount: number; // in the rule's currency (EUR cents for EU261, USD cents for DOT)
  currency: string;
  conditions: Record<string, unknown> | null;
  isActive: boolean;
  createdAt: Date;
}

export interface CompensationStats {
  totalClaims: number;
  pendingClaims: number;
  approvedClaims: number;
  deniedClaims: number;
  paidClaims: number;
  appealedClaims: number;
  totalCalculated: number;
  totalApproved: number;
  totalPaid: number;
  avgProcessingDays: number;
}

// ============================================================================
// In-memory store for compensation claims and rules
// In production these would be database tables; here we use SQL raw queries
// against the tables described in the spec.
// ============================================================================

// We use raw SQL to interact with `compensation_claims` and `compensation_rules`
// tables. The service assumes these tables exist (created via migration).

const CLAIMS_TABLE = "compensation_claims";
const RULES_TABLE = "compensation_rules";

// ============================================================================
// EU261 Compensation Calculation
// ============================================================================

/**
 * EU261 compensation tiers based on flight distance:
 * - Short haul (<=1500 km): EUR 250
 * - Medium haul (1500-3500 km): EUR 400
 * - Long haul (>3500 km): EUR 600
 *
 * EUR amounts are converted to SAR cents at a fixed reference rate of 4.1 SAR/EUR.
 * The actual conversion rate should be configurable in production.
 */
const EUR_TO_SAR_RATE = 4.1;

// EU261 thresholds in EUR
const EU261_SHORT_HAUL_EUR = 25000; // 250 EUR in cents
const EU261_MEDIUM_HAUL_EUR = 40000; // 400 EUR in cents
const EU261_LONG_HAUL_EUR = 60000; // 600 EUR in cents

// Minimum delay (minutes) for EU261 eligibility
const EU261_DELAY_THRESHOLD_MINUTES = 180; // 3 hours

/**
 * Calculate EU261 compensation based on distance and delay
 * Returns amount in SAR cents
 */
export async function calculateEU261Compensation(
  flightId: number,
  delayMinutes: number,
  distance: number
): Promise<{
  eligible: boolean;
  amount: number;
  currency: string;
  eurAmount: number;
  reason: string;
  distanceBand: "short" | "medium" | "long";
}> {
  // Check minimum delay threshold
  if (delayMinutes < EU261_DELAY_THRESHOLD_MINUTES) {
    return {
      eligible: false,
      amount: 0,
      currency: "SAR",
      eurAmount: 0,
      reason: `Delay of ${delayMinutes} minutes is below the EU261 threshold of ${EU261_DELAY_THRESHOLD_MINUTES} minutes`,
      distanceBand: "short",
    };
  }

  let eurAmount: number;
  let distanceBand: "short" | "medium" | "long";

  if (distance <= 1500) {
    eurAmount = EU261_SHORT_HAUL_EUR;
    distanceBand = "short";
  } else if (distance <= 3500) {
    eurAmount = EU261_MEDIUM_HAUL_EUR;
    distanceBand = "medium";
  } else {
    eurAmount = EU261_LONG_HAUL_EUR;
    distanceBand = "long";
  }

  // 50% reduction for delays between 3-4 hours on long-haul with arrival delay < 4h
  if (distanceBand === "long" && delayMinutes >= 180 && delayMinutes < 240) {
    eurAmount = Math.round(eurAmount * 0.5);
  }

  // Convert EUR cents to SAR cents
  const sarAmount = Math.round(eurAmount * EUR_TO_SAR_RATE);

  // Verify flight exists
  const db = await getDb();
  if (db) {
    const [flight] = await db
      .select({ id: flights.id })
      .from(flights)
      .where(eq(flights.id, flightId))
      .limit(1);

    if (!flight) {
      return {
        eligible: false,
        amount: 0,
        currency: "SAR",
        eurAmount: 0,
        reason: "Flight not found",
        distanceBand,
      };
    }
  }

  return {
    eligible: true,
    amount: sarAmount,
    currency: "SAR",
    eurAmount,
    reason: `EU261: ${distanceBand} haul (${distance} km), ${delayMinutes} min delay`,
    distanceBand,
  };
}

// ============================================================================
// DOT Compensation Calculation
// ============================================================================

/**
 * US DOT compensation rules:
 * - Denied boarding (involuntary): 200-400% of one-way fare
 * - Tarmac delays > 3 hours (domestic) or > 4 hours (international): penalty-based
 *
 * Returns amount in SAR cents
 */
export async function calculateDOTCompensation(
  flightId: number,
  type: "denied_boarding" | "tarmac_delay"
): Promise<{
  eligible: boolean;
  amount: number;
  currency: string;
  reason: string;
  ruleApplied: string;
}> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const [flight] = await db
    .select({
      id: flights.id,
      economyPrice: flights.economyPrice,
      businessPrice: flights.businessPrice,
      flightNumber: flights.flightNumber,
    })
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);

  if (!flight) {
    return {
      eligible: false,
      amount: 0,
      currency: "SAR",
      reason: "Flight not found",
      ruleApplied: "none",
    };
  }

  if (type === "denied_boarding") {
    // DOT rule: 200% of one-way fare for delays 1-2 hours, 400% for >2 hours
    // We use economy price as the base fare; max $775 / $1,550 USD
    const baseFare = flight.economyPrice;
    const compensationAmount = baseFare * 4; // 400% for >2 hour alternative

    return {
      eligible: true,
      amount: compensationAmount,
      currency: "SAR",
      reason: `DOT denied boarding: 400% of base fare (${(baseFare / 100).toFixed(2)} SAR)`,
      ruleApplied: "dot_denied_boarding_400pct",
    };
  }

  if (type === "tarmac_delay") {
    // DOT tarmac delay rule: airlines face penalties for tarmac delays
    // exceeding 3 hours (domestic) or 4 hours (international)
    // Compensation is typically a fixed amount per passenger
    const fixedCompensation = 50000; // 500 SAR (fixed penalty equivalent)

    return {
      eligible: true,
      amount: fixedCompensation,
      currency: "SAR",
      reason: "DOT tarmac delay: fixed compensation per passenger",
      ruleApplied: "dot_tarmac_delay_fixed",
    };
  }

  return {
    eligible: false,
    amount: 0,
    currency: "SAR",
    reason: `Unknown DOT compensation type: ${type}`,
    ruleApplied: "none",
  };
}

// ============================================================================
// Flight Distance Calculation (Haversine)
// ============================================================================

/**
 * Calculate distance between two airports using the Haversine formula.
 * Falls back to a straight-line estimate if coordinates aren't available.
 */
export async function calculateFlightDistance(
  originId: number,
  destinationId: number
): Promise<number> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const [origin] = await db
    .select({
      id: airports.id,
      code: airports.code,
      city: airports.city,
      country: airports.country,
    })
    .from(airports)
    .where(eq(airports.id, originId))
    .limit(1);

  const [destination] = await db
    .select({
      id: airports.id,
      code: airports.code,
      city: airports.city,
      country: airports.country,
    })
    .from(airports)
    .where(eq(airports.id, destinationId))
    .limit(1);

  if (!origin || !destination) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Airport not found for distance calculation",
    });
  }

  // Well-known airport coordinate lookup for common routes
  // In production this would come from the database or an API
  const airportCoords: Record<string, { lat: number; lng: number }> = {
    JED: { lat: 21.6796, lng: 39.1565 },
    RUH: { lat: 24.9576, lng: 46.6988 },
    DMM: { lat: 26.4712, lng: 49.7979 },
    MED: { lat: 24.5534, lng: 39.705 },
    AHB: { lat: 18.2404, lng: 42.6567 },
    CAI: { lat: 30.1219, lng: 31.4056 },
    DXB: { lat: 25.2532, lng: 55.3657 },
    LHR: { lat: 51.47, lng: -0.4543 },
    CDG: { lat: 49.0097, lng: 2.5479 },
    JFK: { lat: 40.6413, lng: -73.7781 },
    IST: { lat: 41.2753, lng: 28.7519 },
    KUL: { lat: 2.7456, lng: 101.7099 },
    BOM: { lat: 19.0896, lng: 72.8656 },
    SIN: { lat: 1.3644, lng: 103.9915 },
    FRA: { lat: 50.0379, lng: 8.5622 },
    AMS: { lat: 52.3105, lng: 4.7683 },
  };

  const originCoords = airportCoords[origin.code];
  const destCoords = airportCoords[destination.code];

  if (originCoords && destCoords) {
    return haversineDistance(
      originCoords.lat,
      originCoords.lng,
      destCoords.lat,
      destCoords.lng
    );
  }

  // Fallback: return a default estimate based on whether domestic or international
  if (origin.country === destination.country) {
    return 800; // Default domestic distance in km
  }
  return 3000; // Default international distance in km
}

function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

// ============================================================================
// Claim CRUD Operations
// ============================================================================

/**
 * Create a new compensation claim
 */
export async function createClaim(input: {
  bookingId: number;
  regulationType: "eu261" | "dot" | "local";
  claimType: "delay" | "cancellation" | "denied_boarding" | "downgrade";
  reason?: string;
  userId: number;
}): Promise<CompensationClaim> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Get the booking with ownership check
  const [booking] = await db
    .select({
      id: bookings.id,
      userId: bookings.userId,
      flightId: bookings.flightId,
      status: bookings.status,
      cabinClass: bookings.cabinClass,
      totalAmount: bookings.totalAmount,
    })
    .from(bookings)
    .where(eq(bookings.id, input.bookingId))
    .limit(1);

  if (!booking) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Booking not found",
    });
  }

  if (booking.userId !== input.userId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Access denied: you do not own this booking",
    });
  }

  // Get flight info
  const [flight] = await db
    .select({
      id: flights.id,
      originId: flights.originId,
      destinationId: flights.destinationId,
      status: flights.status,
      flightNumber: flights.flightNumber,
    })
    .from(flights)
    .where(eq(flights.id, booking.flightId))
    .limit(1);

  if (!flight) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Flight not found",
    });
  }

  // Calculate distance
  const distance = await calculateFlightDistance(
    flight.originId,
    flight.destinationId
  );

  // Get disruption info for delay minutes
  const disruptions = await db
    .select({
      id: flightDisruptions.id,
      type: flightDisruptions.type,
      delayMinutes: flightDisruptions.delayMinutes,
    })
    .from(flightDisruptions)
    .where(eq(flightDisruptions.flightId, flight.id))
    .orderBy(desc(flightDisruptions.createdAt))
    .limit(1);

  const disruption = disruptions.length > 0 ? disruptions[0] : null;
  const delayMinutes = disruption?.delayMinutes ?? 0;

  // Calculate compensation amount
  let calculatedAmount = 0;
  if (input.regulationType === "eu261") {
    const eu261 = await calculateEU261Compensation(
      flight.id,
      delayMinutes,
      distance
    );
    calculatedAmount = eu261.amount;
  } else if (input.regulationType === "dot") {
    const dotType =
      input.claimType === "denied_boarding"
        ? "denied_boarding"
        : "tarmac_delay";
    const dot = await calculateDOTCompensation(flight.id, dotType);
    calculatedAmount = dot.amount;
  } else {
    // Local regulation: 50% of ticket price as default
    calculatedAmount = Math.round(booking.totalAmount * 0.5);
  }

  // Get first passenger for the booking
  const bookingPassengers = await db
    .select({ id: passengers.id })
    .from(passengers)
    .where(eq(passengers.bookingId, booking.id))
    .limit(1);

  const passengerId =
    bookingPassengers.length > 0 ? bookingPassengers[0].id : null;

  const now = new Date();

  // Insert into compensation_claims table via raw SQL
  const result = await db.execute(
    sql`INSERT INTO ${sql.raw(CLAIMS_TABLE)} (
      bookingId, flightId, passengerId, regulationType, claimType,
      flightDistance, delayMinutes, calculatedAmount, approvedAmount,
      currency, status, reason, denialReason, filedAt, resolvedAt, paidAt,
      createdAt, updatedAt
    ) VALUES (
      ${booking.id}, ${flight.id}, ${passengerId}, ${input.regulationType},
      ${input.claimType}, ${distance}, ${delayMinutes}, ${calculatedAmount},
      NULL, 'SAR', 'pending', ${input.reason || null}, NULL, ${now}, NULL, NULL,
      ${now}, ${now}
    )`
  );

  const insertId = (result as unknown as [{ insertId: number }])[0]?.insertId;

  return {
    id: insertId,
    bookingId: booking.id,
    flightId: flight.id,
    passengerId,
    regulationType: input.regulationType,
    claimType: input.claimType,
    flightDistance: distance,
    delayMinutes,
    calculatedAmount,
    approvedAmount: null,
    currency: "SAR",
    status: "pending",
    reason: input.reason || null,
    denialReason: null,
    filedAt: now,
    resolvedAt: null,
    paidAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Process (approve/deny) a compensation claim (admin)
 */
export async function processClaim(input: {
  claimId: number;
  decision: "approved" | "denied" | "partial";
  approvedAmount?: number;
  denialReason?: string;
}): Promise<CompensationClaim> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Get existing claim
  const rows = await db.execute(
    sql`SELECT * FROM ${sql.raw(CLAIMS_TABLE)} WHERE id = ${input.claimId} LIMIT 1`
  );
  const claimRows = rows as unknown as Array<Array<Record<string, unknown>>>;
  const existing = claimRows[0]?.[0];

  if (!existing) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Compensation claim not found",
    });
  }

  const currentStatus = existing.status as string;
  if (currentStatus === "paid") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cannot modify a paid claim",
    });
  }

  const now = new Date();
  let newStatus: string;
  let approvedAmount: number | null = null;

  if (input.decision === "approved") {
    newStatus = "approved";
    approvedAmount =
      input.approvedAmount ?? (existing.calculatedAmount as number);
  } else if (input.decision === "partial") {
    newStatus = "approved";
    if (!input.approvedAmount) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Partial approval requires an approvedAmount",
      });
    }
    approvedAmount = input.approvedAmount;
  } else {
    newStatus = "denied";
    if (!input.denialReason) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Denial requires a reason",
      });
    }
  }

  await db.execute(
    sql`UPDATE ${sql.raw(CLAIMS_TABLE)}
        SET status = ${newStatus},
            approvedAmount = ${approvedAmount},
            denialReason = ${input.denialReason || null},
            resolvedAt = ${now},
            updatedAt = ${now}
        WHERE id = ${input.claimId}`
  );

  // Re-fetch the updated claim
  const updatedRows = await db.execute(
    sql`SELECT * FROM ${sql.raw(CLAIMS_TABLE)} WHERE id = ${input.claimId} LIMIT 1`
  );
  const updatedClaimRows = updatedRows as unknown as Array<
    Array<Record<string, unknown>>
  >;
  const updated = updatedClaimRows[0]?.[0];

  return mapRowToClaim(updated as Record<string, unknown>);
}

/**
 * Get all claims for a booking
 */
export async function getClaimsByBooking(
  bookingId: number,
  userId?: number
): Promise<CompensationClaim[]> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // If userId is provided, check booking ownership
  if (userId) {
    const [booking] = await db
      .select({ id: bookings.id, userId: bookings.userId })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!booking) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
    }

    if (booking.userId !== userId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Access denied",
      });
    }
  }

  const rows = await db.execute(
    sql`SELECT * FROM ${sql.raw(CLAIMS_TABLE)}
        WHERE bookingId = ${bookingId}
        ORDER BY createdAt DESC`
  );
  const claimRows = rows as unknown as Array<Array<Record<string, unknown>>>;
  return (claimRows[0] ?? []).map(mapRowToClaim);
}

/**
 * Get all claims for a flight (admin)
 */
export async function getClaimsByFlight(
  flightId: number
): Promise<CompensationClaim[]> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const rows = await db.execute(
    sql`SELECT * FROM ${sql.raw(CLAIMS_TABLE)}
        WHERE flightId = ${flightId}
        ORDER BY createdAt DESC`
  );
  const claimRows = rows as unknown as Array<Array<Record<string, unknown>>>;
  return (claimRows[0] ?? []).map(mapRowToClaim);
}

/**
 * Get a single claim by ID
 */
export async function getClaimById(
  claimId: number,
  userId?: number
): Promise<CompensationClaim> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const rows = await db.execute(
    sql`SELECT * FROM ${sql.raw(CLAIMS_TABLE)}
        WHERE id = ${claimId}
        LIMIT 1`
  );
  const claimRows = rows as unknown as Array<Array<Record<string, unknown>>>;
  const claim = claimRows[0]?.[0];

  if (!claim) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Compensation claim not found",
    });
  }

  // If userId provided, verify ownership through booking
  if (userId) {
    const [booking] = await db
      .select({ userId: bookings.userId })
      .from(bookings)
      .where(eq(bookings.id, claim.bookingId as number))
      .limit(1);

    if (!booking || booking.userId !== userId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
    }
  }

  return mapRowToClaim(claim as Record<string, unknown>);
}

/**
 * Calculate total compensation liability for a disrupted flight
 */
export async function calculateTotalLiability(flightId: number): Promise<{
  flightId: number;
  flightNumber: string;
  totalClaims: number;
  totalCalculated: number;
  totalApproved: number;
  totalPaid: number;
  statusBreakdown: Record<string, number>;
}> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Get flight info
  const [flight] = await db
    .select({
      id: flights.id,
      flightNumber: flights.flightNumber,
    })
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);

  if (!flight) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
  }

  const rows = await db.execute(
    sql`SELECT
          COUNT(*) as totalClaims,
          COALESCE(SUM(calculatedAmount), 0) as totalCalculated,
          COALESCE(SUM(CASE WHEN status IN ('approved', 'paid') THEN COALESCE(approvedAmount, calculatedAmount) ELSE 0 END), 0) as totalApproved,
          COALESCE(SUM(CASE WHEN status = 'paid' THEN COALESCE(approvedAmount, calculatedAmount) ELSE 0 END), 0) as totalPaid
        FROM ${sql.raw(CLAIMS_TABLE)}
        WHERE flightId = ${flightId}`
  );
  const aggregateRows = rows as unknown as Array<
    Array<{
      totalClaims: number | bigint;
      totalCalculated: number | bigint;
      totalApproved: number | bigint;
      totalPaid: number | bigint;
    }>
  >;
  const agg = aggregateRows[0]?.[0];

  // Status breakdown
  const statusRows = await db.execute(
    sql`SELECT status, COUNT(*) as cnt
        FROM ${sql.raw(CLAIMS_TABLE)}
        WHERE flightId = ${flightId}
        GROUP BY status`
  );
  const statusData = statusRows as unknown as Array<
    Array<{ status: string; cnt: number | bigint }>
  >;
  const statusBreakdown: Record<string, number> = {};
  for (const row of statusData[0] ?? []) {
    statusBreakdown[row.status] = Number(row.cnt);
  }

  return {
    flightId,
    flightNumber: flight.flightNumber,
    totalClaims: Number(agg?.totalClaims ?? 0),
    totalCalculated: Number(agg?.totalCalculated ?? 0),
    totalApproved: Number(agg?.totalApproved ?? 0),
    totalPaid: Number(agg?.totalPaid ?? 0),
    statusBreakdown,
  };
}

/**
 * Auto-assess eligibility for compensation based on booking and disruption info
 */
export async function autoAssessEligibility(
  bookingId: number,
  disruptionType: "delay" | "cancellation" | "denied_boarding" | "downgrade",
  userId: number
): Promise<{
  eligible: boolean;
  regulationType: "eu261" | "dot" | "local";
  estimatedAmount: number;
  currency: string;
  reason: string;
  flightDistance: number;
  delayMinutes: number;
}> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Get booking
  const [booking] = await db
    .select({
      id: bookings.id,
      userId: bookings.userId,
      flightId: bookings.flightId,
      status: bookings.status,
      totalAmount: bookings.totalAmount,
    })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!booking) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
  }

  if (booking.userId !== userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
  }

  // Get flight details
  const [flight] = await db
    .select({
      id: flights.id,
      originId: flights.originId,
      destinationId: flights.destinationId,
      status: flights.status,
    })
    .from(flights)
    .where(eq(flights.id, booking.flightId))
    .limit(1);

  if (!flight) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
  }

  // Get origin and destination airports for regulation detection
  const [origin] = await db
    .select({ country: airports.country, code: airports.code })
    .from(airports)
    .where(eq(airports.id, flight.originId))
    .limit(1);

  const [destination] = await db
    .select({ country: airports.country, code: airports.code })
    .from(airports)
    .where(eq(airports.id, flight.destinationId))
    .limit(1);

  // Calculate distance
  const distance = await calculateFlightDistance(
    flight.originId,
    flight.destinationId
  );

  // Get disruption delay
  const disruptions = await db
    .select({ delayMinutes: flightDisruptions.delayMinutes })
    .from(flightDisruptions)
    .where(eq(flightDisruptions.flightId, flight.id))
    .orderBy(desc(flightDisruptions.createdAt))
    .limit(1);

  const delayMinutes = disruptions[0]?.delayMinutes ?? 0;

  // Determine applicable regulation
  const euCountries = [
    "United Kingdom",
    "Germany",
    "France",
    "Italy",
    "Spain",
    "Netherlands",
    "Belgium",
    "Austria",
    "Switzerland",
    "Portugal",
    "Greece",
    "Ireland",
    "Sweden",
    "Norway",
    "Denmark",
    "Finland",
    "Poland",
    "Czech Republic",
    "Romania",
    "Hungary",
    "Croatia",
    "Bulgaria",
    "Slovakia",
    "Slovenia",
    "Lithuania",
    "Latvia",
    "Estonia",
    "Luxembourg",
    "Malta",
    "Cyprus",
    "Iceland",
  ];

  const isEUOrigin = euCountries.includes(origin?.country ?? "");
  const isUSRoute =
    (origin?.country ?? "") === "United States" ||
    (destination?.country ?? "") === "United States";

  let regulationType: "eu261" | "dot" | "local";
  let estimatedAmount = 0;
  let reason = "";
  let eligible = false;

  if (isEUOrigin) {
    regulationType = "eu261";
    const eu261Result = await calculateEU261Compensation(
      flight.id,
      delayMinutes,
      distance
    );
    eligible = eu261Result.eligible;
    estimatedAmount = eu261Result.amount;
    reason = eu261Result.reason;
  } else if (isUSRoute) {
    regulationType = "dot";
    const dotType =
      disruptionType === "denied_boarding" ? "denied_boarding" : "tarmac_delay";
    const dotResult = await calculateDOTCompensation(flight.id, dotType);
    eligible = dotResult.eligible;
    estimatedAmount = dotResult.amount;
    reason = dotResult.reason;
  } else {
    regulationType = "local";
    // Local regulations: eligible for cancellations and significant delays
    if (
      disruptionType === "cancellation" ||
      disruptionType === "denied_boarding"
    ) {
      eligible = true;
      estimatedAmount = Math.round(booking.totalAmount * 0.5);
      reason =
        "Local regulation: 50% of ticket price for cancellation/denied boarding";
    } else if (disruptionType === "delay" && delayMinutes >= 120) {
      eligible = true;
      estimatedAmount = Math.round(booking.totalAmount * 0.25);
      reason = `Local regulation: 25% of ticket price for delay exceeding 2 hours (${delayMinutes} min)`;
    } else if (disruptionType === "downgrade") {
      eligible = true;
      estimatedAmount = Math.round(booking.totalAmount * 0.3);
      reason = "Local regulation: 30% refund for cabin downgrade";
    } else {
      eligible = false;
      reason = `Delay of ${delayMinutes} minutes does not meet minimum threshold of 120 minutes`;
    }
  }

  return {
    eligible,
    regulationType,
    estimatedAmount,
    currency: "SAR",
    reason,
    flightDistance: distance,
    delayMinutes,
  };
}

/**
 * Get all claims with filters and pagination (admin)
 */
export async function getAllClaims(input: {
  status?: string;
  regulationType?: string;
  page: number;
  limit: number;
}): Promise<{
  claims: CompensationClaim[];
  total: number;
  page: number;
  totalPages: number;
}> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const offset = (input.page - 1) * input.limit;

  // Build WHERE conditions using parameterized queries
  const conditions: SQL[] = [];
  if (input.status) {
    conditions.push(sql`status = ${input.status}`);
  }
  if (input.regulationType) {
    conditions.push(sql`regulationType = ${input.regulationType}`);
  }

  const whereClause =
    conditions.length > 0
      ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
      : sql``;

  // Get total count
  const countRows = await db.execute(
    sql`SELECT COUNT(*) as total FROM ${sql.raw(CLAIMS_TABLE)} ${whereClause}`
  );
  const countData = countRows as unknown as Array<
    Array<{ total: number | bigint }>
  >;
  const total = Number(countData[0]?.[0]?.total ?? 0);

  // Get paginated claims
  const dataRows = await db.execute(
    sql`SELECT * FROM ${sql.raw(CLAIMS_TABLE)} ${whereClause} ORDER BY createdAt DESC LIMIT ${input.limit} OFFSET ${offset}`
  );
  const claimData = dataRows as unknown as Array<
    Array<Record<string, unknown>>
  >;
  const claims = (claimData[0] ?? []).map(mapRowToClaim);

  return {
    claims,
    total,
    page: input.page,
    totalPages: Math.ceil(total / input.limit),
  };
}

/**
 * Get claims filed by a specific user
 */
export async function getClaimsByUser(
  userId: number
): Promise<CompensationClaim[]> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Get user's booking IDs
  const userBookings = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(eq(bookings.userId, userId));

  if (userBookings.length === 0) return [];

  const bookingIds = userBookings.map(b => b.id);

  // Fetch claims for those bookings using parameterized IN clause
  const rows = await db.execute(
    sql`SELECT * FROM ${sql.raw(CLAIMS_TABLE)} WHERE bookingId IN (${sql.join(
      bookingIds.map(id => sql`${id}`),
      sql`, `
    )}) ORDER BY createdAt DESC`
  );
  const claimRows = rows as unknown as Array<Array<Record<string, unknown>>>;
  return (claimRows[0] ?? []).map(mapRowToClaim);
}

/**
 * Get aggregate compensation statistics (admin)
 */
export async function getCompensationStats(dateRange?: {
  from: Date;
  to: Date;
}): Promise<CompensationStats> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const dateFilter = dateRange
    ? sql`WHERE createdAt >= ${dateRange.from} AND createdAt <= ${dateRange.to}`
    : sql``;

  const rows = await db.execute(
    sql`SELECT
        COUNT(*) as totalClaims,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pendingClaims,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approvedClaims,
        SUM(CASE WHEN status = 'denied' THEN 1 ELSE 0 END) as deniedClaims,
        SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paidClaims,
        SUM(CASE WHEN status = 'appealed' THEN 1 ELSE 0 END) as appealedClaims,
        COALESCE(SUM(calculatedAmount), 0) as totalCalculated,
        COALESCE(SUM(CASE WHEN status IN ('approved', 'paid') THEN COALESCE(approvedAmount, calculatedAmount) ELSE 0 END), 0) as totalApproved,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN COALESCE(approvedAmount, calculatedAmount) ELSE 0 END), 0) as totalPaid,
        COALESCE(AVG(CASE WHEN resolvedAt IS NOT NULL THEN DATEDIFF(resolvedAt, filedAt) END), 0) as avgProcessingDays
      FROM ${sql.raw(CLAIMS_TABLE)} ${dateFilter}`
  );

  const statsRows = rows as unknown as Array<
    Array<Record<string, number | bigint | null>>
  >;
  const s = statsRows[0]?.[0];

  return {
    totalClaims: Number(s?.totalClaims ?? 0),
    pendingClaims: Number(s?.pendingClaims ?? 0),
    approvedClaims: Number(s?.approvedClaims ?? 0),
    deniedClaims: Number(s?.deniedClaims ?? 0),
    paidClaims: Number(s?.paidClaims ?? 0),
    appealedClaims: Number(s?.appealedClaims ?? 0),
    totalCalculated: Number(s?.totalCalculated ?? 0),
    totalApproved: Number(s?.totalApproved ?? 0),
    totalPaid: Number(s?.totalPaid ?? 0),
    avgProcessingDays: Number(s?.avgProcessingDays ?? 0),
  };
}

/**
 * Get compensation rules (admin)
 */
export async function getCompensationRules(): Promise<CompensationRule[]> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const rows = await db.execute(
    sql.raw(`SELECT * FROM ${RULES_TABLE} ORDER BY regulationType, distanceMin`)
  );
  const ruleRows = rows as unknown as Array<Array<Record<string, unknown>>>;
  return (ruleRows[0] ?? []).map(mapRowToRule);
}

/**
 * Update a compensation rule (admin)
 */
export async function updateCompensationRule(input: {
  id: number;
  compensationAmount?: number;
  minDelay?: number;
  maxDelay?: number;
  distanceMin?: number;
  distanceMax?: number;
  isActive?: boolean;
  conditions?: Record<string, unknown>;
}): Promise<CompensationRule> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const setClauses: SQL[] = [];
  if (input.compensationAmount !== undefined) {
    setClauses.push(sql`compensationAmount = ${input.compensationAmount}`);
  }
  if (input.minDelay !== undefined) {
    setClauses.push(sql`minDelay = ${input.minDelay}`);
  }
  if (input.maxDelay !== undefined) {
    setClauses.push(sql`maxDelay = ${input.maxDelay}`);
  }
  if (input.distanceMin !== undefined) {
    setClauses.push(sql`distanceMin = ${input.distanceMin}`);
  }
  if (input.distanceMax !== undefined) {
    setClauses.push(sql`distanceMax = ${input.distanceMax}`);
  }
  if (input.isActive !== undefined) {
    setClauses.push(sql`isActive = ${input.isActive ? 1 : 0}`);
  }
  if (input.conditions !== undefined) {
    setClauses.push(sql`\`conditions\` = ${JSON.stringify(input.conditions)}`);
  }

  if (setClauses.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "No fields to update",
    });
  }

  await db.execute(
    sql`UPDATE ${sql.raw(RULES_TABLE)} SET ${sql.join(setClauses, sql`, `)} WHERE id = ${input.id}`
  );

  // Re-fetch
  const rows = await db.execute(
    sql`SELECT * FROM ${sql.raw(RULES_TABLE)} WHERE id = ${input.id} LIMIT 1`
  );
  const ruleRows = rows as unknown as Array<Array<Record<string, unknown>>>;
  const updated = ruleRows[0]?.[0];

  if (!updated) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Compensation rule not found",
    });
  }

  return mapRowToRule(updated);
}

// ============================================================================
// Helper: Map raw database row to typed objects
// ============================================================================

function mapRowToClaim(row: Record<string, unknown>): CompensationClaim {
  return {
    id: Number(row.id),
    bookingId: Number(row.bookingId),
    flightId: Number(row.flightId),
    passengerId: row.passengerId ? Number(row.passengerId) : null,
    regulationType: row.regulationType as CompensationClaim["regulationType"],
    claimType: row.claimType as CompensationClaim["claimType"],
    flightDistance: row.flightDistance ? Number(row.flightDistance) : null,
    delayMinutes: row.delayMinutes ? Number(row.delayMinutes) : null,
    calculatedAmount: Number(row.calculatedAmount ?? 0),
    approvedAmount: row.approvedAmount ? Number(row.approvedAmount) : null,
    currency: (row.currency as string) ?? "SAR",
    status: row.status as CompensationClaim["status"],
    reason: (row.reason as string) ?? null,
    denialReason: (row.denialReason as string) ?? null,
    filedAt: row.filedAt ? new Date(row.filedAt as string) : new Date(),
    resolvedAt: row.resolvedAt ? new Date(row.resolvedAt as string) : null,
    paidAt: row.paidAt ? new Date(row.paidAt as string) : null,
    createdAt: row.createdAt ? new Date(row.createdAt as string) : new Date(),
    updatedAt: row.updatedAt ? new Date(row.updatedAt as string) : new Date(),
  };
}

function mapRowToRule(row: Record<string, unknown>): CompensationRule {
  let conditions: Record<string, unknown> | null = null;
  if (row.conditions) {
    try {
      conditions =
        typeof row.conditions === "string"
          ? JSON.parse(row.conditions)
          : (row.conditions as Record<string, unknown>);
    } catch {
      conditions = null;
    }
  }

  return {
    id: Number(row.id),
    regulationType: row.regulationType as CompensationRule["regulationType"],
    claimType: row.claimType as CompensationRule["claimType"],
    minDelay: row.minDelay ? Number(row.minDelay) : null,
    maxDelay: row.maxDelay ? Number(row.maxDelay) : null,
    distanceMin: row.distanceMin ? Number(row.distanceMin) : null,
    distanceMax: row.distanceMax ? Number(row.distanceMax) : null,
    compensationAmount: Number(row.compensationAmount ?? 0),
    currency: (row.currency as string) ?? "EUR",
    conditions,
    isActive: Boolean(row.isActive),
    createdAt: row.createdAt ? new Date(row.createdAt as string) : new Date(),
  };
}
