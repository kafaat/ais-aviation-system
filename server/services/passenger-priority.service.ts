import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  bookings,
  passengers,
  flights,
  loyaltyAccounts,
  specialServices,
  bookingSegments,
} from "../../drizzle/schema";
import { eq, and, desc, ne, inArray } from "drizzle-orm";

// ============================================================================
// Inline Schema Types
// ============================================================================

export interface PassengerPriorityScore {
  id: number;
  passengerId: number;
  bookingId: number;
  flightId: number;
  loyaltyScore: number;
  fareClassScore: number;
  connectionScore: number;
  specialNeedsScore: number;
  timeSensitivityScore: number;
  bookingValueScore: number;
  totalScore: number;
  tier: "critical" | "high" | "medium" | "low";
  calculatedAt: Date;
  createdAt: Date;
}

export interface PriorityRule {
  id: number;
  factorName: string;
  factorKey: string;
  value: string;
  score: number;
  isActive: boolean;
  createdAt: Date;
}

// ============================================================================
// Default Scoring Rules
// ============================================================================

const DEFAULT_RULES: Omit<PriorityRule, "id" | "createdAt">[] = [
  // Loyalty tier scores
  {
    factorName: "loyalty_tier",
    factorKey: "platinum",
    value: "platinum",
    score: 300,
    isActive: true,
  },
  {
    factorName: "loyalty_tier",
    factorKey: "gold",
    value: "gold",
    score: 200,
    isActive: true,
  },
  {
    factorName: "loyalty_tier",
    factorKey: "silver",
    value: "silver",
    score: 100,
    isActive: true,
  },
  {
    factorName: "loyalty_tier",
    factorKey: "bronze",
    value: "bronze",
    score: 0,
    isActive: true,
  },

  // Fare class scores
  {
    factorName: "fare_class",
    factorKey: "business",
    value: "business",
    score: 200,
    isActive: true,
  },
  {
    factorName: "fare_class",
    factorKey: "economy_full",
    value: "economy_full",
    score: 100,
    isActive: true,
  },
  {
    factorName: "fare_class",
    factorKey: "economy_discount",
    value: "economy_discount",
    score: 50,
    isActive: true,
  },

  // Connection risk scores
  {
    factorName: "connection_risk",
    factorKey: "tight_connection",
    value: "tight_connection",
    score: 150,
    isActive: true,
  },
  {
    factorName: "connection_risk",
    factorKey: "has_connection",
    value: "has_connection",
    score: 75,
    isActive: true,
  },
  {
    factorName: "connection_risk",
    factorKey: "direct",
    value: "direct",
    score: 0,
    isActive: true,
  },

  // Special needs scores
  {
    factorName: "special_needs",
    factorKey: "unaccompanied_minor",
    value: "unaccompanied_minor",
    score: 100,
    isActive: true,
  },
  {
    factorName: "special_needs",
    factorKey: "medical",
    value: "medical_assistance",
    score: 100,
    isActive: true,
  },
  {
    factorName: "special_needs",
    factorKey: "elderly",
    value: "elderly",
    score: 50,
    isActive: true,
  },

  // Time sensitivity scores
  {
    factorName: "time_sensitivity",
    factorKey: "same_day",
    value: "same_day",
    score: 100,
    isActive: true,
  },

  // Booking value scores
  {
    factorName: "booking_value",
    factorKey: "top_10_percent",
    value: "top_10_percent",
    score: 100,
    isActive: true,
  },
  {
    factorName: "booking_value",
    factorKey: "top_25_percent",
    value: "top_25_percent",
    score: 50,
    isActive: true,
  },
];

/**
 * In-memory rules store.
 * In a production system these would live in a database table;
 * here we keep them in memory so the service is self-contained
 * and does not require schema migration.
 */
const rulesStore: PriorityRule[] = DEFAULT_RULES.map((r, idx) => ({
  ...r,
  id: idx + 1,
  createdAt: new Date(),
}));

// Helper to look up an active rule score
function ruleScore(factorName: string, factorKey: string): number {
  const rule = rulesStore.find(
    r => r.factorName === factorName && r.factorKey === factorKey && r.isActive
  );
  return rule?.score ?? 0;
}

// ============================================================================
// Priority tier classification
// ============================================================================

function classifyTier(
  totalScore: number
): "critical" | "high" | "medium" | "low" {
  if (totalScore >= 600) return "critical";
  if (totalScore >= 400) return "high";
  if (totalScore >= 200) return "medium";
  return "low";
}

// ============================================================================
// Scoring Factor Calculators
// ============================================================================

/**
 * Calculate loyalty tier score for a passenger's associated user.
 */
async function calculateLoyaltyScore(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  userId: number
): Promise<number> {
  const [account] = await db
    .select({ tier: loyaltyAccounts.tier })
    .from(loyaltyAccounts)
    .where(eq(loyaltyAccounts.userId, userId))
    .limit(1);

  if (!account) return ruleScore("loyalty_tier", "bronze");
  return ruleScore("loyalty_tier", account.tier);
}

/**
 * Calculate fare class score based on cabin class and price.
 * Business cabin always gets business score.
 * Economy cabin is classified as full or discount based on the
 * average economy price on the same flight.
 */
async function calculateFareClassScore(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  bookingId: number,
  flightId: number
): Promise<number> {
  const [booking] = await db
    .select({
      cabinClass: bookings.cabinClass,
      totalAmount: bookings.totalAmount,
      numberOfPassengers: bookings.numberOfPassengers,
    })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!booking) return 0;

  if (booking.cabinClass === "business") {
    return ruleScore("fare_class", "business");
  }

  // For economy, compare per-passenger price to the flight's listed economy price
  const [flight] = await db
    .select({ economyPrice: flights.economyPrice })
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);

  if (!flight) return ruleScore("fare_class", "economy_full");

  const perPassengerPrice =
    booking.numberOfPassengers > 0
      ? booking.totalAmount / booking.numberOfPassengers
      : booking.totalAmount;

  // If the passenger paid >= 80% of the listed economy price, treat as full fare
  if (perPassengerPrice >= flight.economyPrice * 0.8) {
    return ruleScore("fare_class", "economy_full");
  }

  return ruleScore("fare_class", "economy_discount");
}

/**
 * Calculate connection risk score.
 * Checks whether the booking has multiple segments (multi-city / connecting)
 * and whether the layover between segments is tight (< 90 minutes).
 */
async function calculateConnectionScore(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  bookingId: number,
  flightId: number
): Promise<number> {
  // Check for multi-segment bookings
  const segments = await db
    .select({
      segmentOrder: bookingSegments.segmentOrder,
      flightId: bookingSegments.flightId,
      departureDate: bookingSegments.departureDate,
    })
    .from(bookingSegments)
    .where(eq(bookingSegments.bookingId, bookingId))
    .orderBy(bookingSegments.segmentOrder);

  if (segments.length <= 1) {
    return ruleScore("connection_risk", "direct");
  }

  // Find the index of the current disrupted flight within the segments
  const currentIdx = segments.findIndex(s => s.flightId === flightId);

  // If there is a subsequent segment, check if the connection is tight
  if (currentIdx >= 0 && currentIdx < segments.length - 1) {
    const currentSegment = segments[currentIdx];
    const nextSegment = segments[currentIdx + 1];

    // Get arrival time of the current flight
    const [currentFlight] = await db
      .select({ arrivalTime: flights.arrivalTime })
      .from(flights)
      .where(eq(flights.id, currentSegment.flightId))
      .limit(1);

    if (currentFlight) {
      const arrivalMs = new Date(currentFlight.arrivalTime).getTime();
      const nextDepartureMs = new Date(nextSegment.departureDate).getTime();
      const layoverMinutes = (nextDepartureMs - arrivalMs) / (1000 * 60);

      // Less than 90 minutes layover = tight connection
      if (layoverMinutes < 90) {
        return ruleScore("connection_risk", "tight_connection");
      }
    }
  }

  return ruleScore("connection_risk", "has_connection");
}

/**
 * Calculate special needs score based on registered special services
 * and passenger demographics (age-based elderly detection).
 */
async function calculateSpecialNeedsScore(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  passengerId: number,
  bookingId: number
): Promise<number> {
  // Check special services for this passenger
  const services = await db
    .select({
      serviceType: specialServices.serviceType,
    })
    .from(specialServices)
    .where(
      and(
        eq(specialServices.passengerId, passengerId),
        eq(specialServices.bookingId, bookingId),
        ne(specialServices.status, "cancelled")
      )
    );

  let score = 0;

  for (const svc of services) {
    if (svc.serviceType === "unaccompanied_minor") {
      score = Math.max(
        score,
        ruleScore("special_needs", "unaccompanied_minor")
      );
    }
    if (
      svc.serviceType === "medical_assistance" ||
      svc.serviceType === "wheelchair"
    ) {
      score = Math.max(score, ruleScore("special_needs", "medical"));
    }
  }

  // Check if passenger is elderly (65+) based on date of birth
  const [passenger] = await db
    .select({ dateOfBirth: passengers.dateOfBirth })
    .from(passengers)
    .where(eq(passengers.id, passengerId))
    .limit(1);

  if (passenger?.dateOfBirth) {
    const now = new Date();
    const dob = new Date(passenger.dateOfBirth);
    const ageMs = now.getTime() - dob.getTime();
    const ageYears = ageMs / (1000 * 60 * 60 * 24 * 365.25);
    if (ageYears >= 65) {
      score = Math.max(score, ruleScore("special_needs", "elderly"));
    }
  }

  return score;
}

/**
 * Calculate time sensitivity score.
 * Awards points when the disrupted flight departs on the same calendar day,
 * meaning the passenger needs a same-day rebooking.
 */
async function calculateTimeSensitivityScore(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  flightId: number
): Promise<number> {
  const [flight] = await db
    .select({ departureTime: flights.departureTime })
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);

  if (!flight) return 0;

  const now = new Date();
  const departure = new Date(flight.departureTime);

  // Same calendar day check (UTC)
  const sameDay =
    now.getUTCFullYear() === departure.getUTCFullYear() &&
    now.getUTCMonth() === departure.getUTCMonth() &&
    now.getUTCDate() === departure.getUTCDate();

  if (sameDay) {
    return ruleScore("time_sensitivity", "same_day");
  }

  return 0;
}

/**
 * Calculate booking value score.
 * Compares the booking's total amount against all bookings on the same flight
 * to determine if it falls in the top 10% or top 25%.
 */
async function calculateBookingValueScore(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  bookingId: number,
  flightId: number
): Promise<number> {
  // Get all confirmed/pending booking amounts for the same flight
  const allBookings = await db
    .select({ totalAmount: bookings.totalAmount })
    .from(bookings)
    .where(
      and(eq(bookings.flightId, flightId), ne(bookings.status, "cancelled"))
    )
    .orderBy(desc(bookings.totalAmount));

  if (allBookings.length === 0) return 0;

  const [currentBooking] = await db
    .select({ totalAmount: bookings.totalAmount })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!currentBooking) return 0;

  const currentAmount = currentBooking.totalAmount;

  // Determine percentile rank (how many bookings have a lower or equal amount)
  const rank =
    allBookings.filter(b => b.totalAmount >= currentAmount).length /
    allBookings.length;

  // rank <= 0.10 means top 10%
  if (rank <= 0.1) {
    return ruleScore("booking_value", "top_10_percent");
  }
  // rank <= 0.25 means top 25%
  if (rank <= 0.25) {
    return ruleScore("booking_value", "top_25_percent");
  }

  return 0;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Calculate the overall priority score (0-1000) for a passenger on a booking.
 */
export async function calculatePriorityScore(
  passengerId: number,
  bookingId: number
): Promise<PassengerPriorityScore> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  // Resolve the booking to get flightId and userId
  const [booking] = await db
    .select({
      id: bookings.id,
      flightId: bookings.flightId,
      userId: bookings.userId,
    })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!booking) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
  }

  // Verify the passenger belongs to this booking
  const [passenger] = await db
    .select({ id: passengers.id })
    .from(passengers)
    .where(
      and(eq(passengers.id, passengerId), eq(passengers.bookingId, bookingId))
    )
    .limit(1);

  if (!passenger) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Passenger not found in the specified booking",
    });
  }

  const flightId = booking.flightId;

  // Calculate each factor in parallel
  const [
    loyaltyScore,
    fareClassScore,
    connectionScore,
    specialNeedsScore,
    timeSensitivityScore,
    bookingValueScore,
  ] = await Promise.all([
    calculateLoyaltyScore(db, booking.userId),
    calculateFareClassScore(db, bookingId, flightId),
    calculateConnectionScore(db, bookingId, flightId),
    calculateSpecialNeedsScore(db, passengerId, bookingId),
    calculateTimeSensitivityScore(db, flightId),
    calculateBookingValueScore(db, bookingId, flightId),
  ]);

  const totalScore =
    loyaltyScore +
    fareClassScore +
    connectionScore +
    specialNeedsScore +
    timeSensitivityScore +
    bookingValueScore;

  const now = new Date();

  return {
    id: 0, // Computed on the fly, not persisted
    passengerId,
    bookingId,
    flightId,
    loyaltyScore,
    fareClassScore,
    connectionScore,
    specialNeedsScore,
    timeSensitivityScore,
    bookingValueScore,
    totalScore,
    tier: classifyTier(totalScore),
    calculatedAt: now,
    createdAt: now,
  };
}

/**
 * Rank all passengers on a disrupted flight by priority score (descending).
 */
export async function rankPassengers(
  flightId: number
): Promise<PassengerPriorityScore[]> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  // Verify flight exists
  const [flight] = await db
    .select({ id: flights.id })
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);

  if (!flight) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
  }

  // Get all non-cancelled bookings for this flight
  const flightBookings = await db
    .select({
      bookingId: bookings.id,
    })
    .from(bookings)
    .where(
      and(eq(bookings.flightId, flightId), ne(bookings.status, "cancelled"))
    );

  if (flightBookings.length === 0) return [];

  const bookingIds = flightBookings.map(b => b.bookingId);

  // Get all passengers across those bookings
  const flightPassengers = await db
    .select({
      id: passengers.id,
      bookingId: passengers.bookingId,
    })
    .from(passengers)
    .where(inArray(passengers.bookingId, bookingIds));

  // Score each passenger
  const scores: PassengerPriorityScore[] = [];
  for (const pax of flightPassengers) {
    try {
      const score = await calculatePriorityScore(pax.id, pax.bookingId);
      scores.push(score);
    } catch {
      // Skip passengers that cannot be scored (edge cases)
      continue;
    }
  }

  // Sort by totalScore descending
  scores.sort((a, b) => b.totalScore - a.totalScore);

  return scores;
}

/**
 * Get the complete priority profile for a passenger, including
 * name, booking, loyalty, special services, and computed scores.
 */
export async function getPassengerProfile(passengerId: number): Promise<{
  passenger: {
    id: number;
    firstName: string;
    lastName: string;
    type: string;
    dateOfBirth: Date | null;
    bookingId: number;
  };
  booking: {
    id: number;
    bookingReference: string;
    cabinClass: string;
    totalAmount: number;
    status: string;
    flightId: number;
  };
  loyalty: {
    tier: string;
    tierPoints: number;
    currentMilesBalance: number;
  } | null;
  specialServices: {
    serviceType: string;
    serviceCode: string;
    status: string;
  }[];
  priorityScore: PassengerPriorityScore;
}> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  // Get passenger
  const [pax] = await db
    .select({
      id: passengers.id,
      firstName: passengers.firstName,
      lastName: passengers.lastName,
      type: passengers.type,
      dateOfBirth: passengers.dateOfBirth,
      bookingId: passengers.bookingId,
    })
    .from(passengers)
    .where(eq(passengers.id, passengerId))
    .limit(1);

  if (!pax) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Passenger not found",
    });
  }

  // Get booking
  const [booking] = await db
    .select({
      id: bookings.id,
      bookingReference: bookings.bookingReference,
      cabinClass: bookings.cabinClass,
      totalAmount: bookings.totalAmount,
      status: bookings.status,
      flightId: bookings.flightId,
      userId: bookings.userId,
    })
    .from(bookings)
    .where(eq(bookings.id, pax.bookingId))
    .limit(1);

  if (!booking) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Booking not found for passenger",
    });
  }

  // Get loyalty account for the booking owner
  const [loyalty] = await db
    .select({
      tier: loyaltyAccounts.tier,
      tierPoints: loyaltyAccounts.tierPoints,
      currentMilesBalance: loyaltyAccounts.currentMilesBalance,
    })
    .from(loyaltyAccounts)
    .where(eq(loyaltyAccounts.userId, booking.userId))
    .limit(1);

  // Get special services for this passenger & booking
  const services = await db
    .select({
      serviceType: specialServices.serviceType,
      serviceCode: specialServices.serviceCode,
      status: specialServices.status,
    })
    .from(specialServices)
    .where(
      and(
        eq(specialServices.passengerId, passengerId),
        eq(specialServices.bookingId, pax.bookingId)
      )
    );

  // Compute priority score
  const priorityScore = await calculatePriorityScore(
    passengerId,
    pax.bookingId
  );

  return {
    passenger: {
      id: pax.id,
      firstName: pax.firstName,
      lastName: pax.lastName,
      type: pax.type,
      dateOfBirth: pax.dateOfBirth,
      bookingId: pax.bookingId,
    },
    booking: {
      id: booking.id,
      bookingReference: booking.bookingReference,
      cabinClass: booking.cabinClass,
      totalAmount: booking.totalAmount,
      status: booking.status,
      flightId: booking.flightId,
    },
    loyalty: loyalty
      ? {
          tier: loyalty.tier,
          tierPoints: loyalty.tierPoints,
          currentMilesBalance: loyalty.currentMilesBalance,
        }
      : null,
    specialServices: services,
    priorityScore,
  };
}

/**
 * Produce an ordered list of passengers for rebooking priority on a disrupted flight.
 * Returns passengers sorted by descending priority with their name, score, and tier.
 */
export async function suggestRebookingOrder(flightId: number): Promise<
  {
    passengerId: number;
    firstName: string;
    lastName: string;
    bookingId: number;
    bookingReference: string;
    totalScore: number;
    tier: "critical" | "high" | "medium" | "low";
    loyaltyTier: string | null;
    cabinClass: string;
  }[]
> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  // Get ranked scores
  const ranked = await rankPassengers(flightId);

  if (ranked.length === 0) return [];

  // Collect unique booking IDs and passenger IDs for batch lookup
  const bookingIds = [...new Set(ranked.map(r => r.bookingId))];
  const passengerIds = ranked.map(r => r.passengerId);

  // Batch-fetch passenger names
  const paxRows = await db
    .select({
      id: passengers.id,
      firstName: passengers.firstName,
      lastName: passengers.lastName,
    })
    .from(passengers)
    .where(inArray(passengers.id, passengerIds));

  const paxMap = new Map(paxRows.map(p => [p.id, p]));

  // Batch-fetch booking details
  const bookingRows = await db
    .select({
      id: bookings.id,
      bookingReference: bookings.bookingReference,
      cabinClass: bookings.cabinClass,
      userId: bookings.userId,
    })
    .from(bookings)
    .where(inArray(bookings.id, bookingIds));

  const bookingMap = new Map(bookingRows.map(b => [b.id, b]));

  // Batch-fetch loyalty tiers for all booking owners
  const userIds = [...new Set(bookingRows.map(b => b.userId))];
  const loyaltyRows =
    userIds.length > 0
      ? await db
          .select({
            userId: loyaltyAccounts.userId,
            tier: loyaltyAccounts.tier,
          })
          .from(loyaltyAccounts)
          .where(inArray(loyaltyAccounts.userId, userIds))
      : [];

  const loyaltyMap = new Map(loyaltyRows.map(l => [l.userId, l.tier]));

  return ranked.map(r => {
    const pax = paxMap.get(r.passengerId);
    const bk = bookingMap.get(r.bookingId);
    return {
      passengerId: r.passengerId,
      firstName: pax?.firstName ?? "Unknown",
      lastName: pax?.lastName ?? "Unknown",
      bookingId: r.bookingId,
      bookingReference: bk?.bookingReference ?? "------",
      totalScore: r.totalScore,
      tier: r.tier,
      loyaltyTier: bk ? (loyaltyMap.get(bk.userId) ?? null) : null,
      cabinClass: bk?.cabinClass ?? "economy",
    };
  });
}

/**
 * Get protection options available to a passenger based on their priority level.
 * Higher-priority passengers receive more favorable rebooking and compensation options.
 */
export async function getProtectionOptions(
  passengerId: number,
  bookingId: number
): Promise<{
  priorityScore: PassengerPriorityScore;
  options: {
    key: string;
    label: string;
    description: string;
    available: boolean;
  }[];
}> {
  const score = await calculatePriorityScore(passengerId, bookingId);
  const tier = score.tier;

  const options: {
    key: string;
    label: string;
    description: string;
    available: boolean;
  }[] = [
    {
      key: "next_available_flight",
      label: "Next Available Flight",
      description: "Rebook on the next available flight on the same route",
      available: true, // Available to all tiers
    },
    {
      key: "cabin_upgrade",
      label: "Complimentary Cabin Upgrade",
      description:
        "Upgrade to business class if economy is unavailable on the next flight",
      available: tier === "critical" || tier === "high",
    },
    {
      key: "partner_airline",
      label: "Partner Airline Rebooking",
      description:
        "Rebook on a partner airline flight if own-airline options are exhausted",
      available: tier === "critical" || tier === "high",
    },
    {
      key: "hotel_accommodation",
      label: "Hotel Accommodation",
      description:
        "Complimentary hotel stay if the next available flight is the following day",
      available: tier === "critical" || tier === "high" || tier === "medium",
    },
    {
      key: "meal_voucher",
      label: "Meal Voucher",
      description: "Complimentary meal voucher during the wait",
      available: true, // Available to all tiers
    },
    {
      key: "lounge_access",
      label: "Airport Lounge Access",
      description: "Complimentary lounge access while waiting for rebooking",
      available: tier === "critical",
    },
    {
      key: "ground_transport",
      label: "Ground Transportation",
      description:
        "Complimentary ground transportation to/from hotel or alternative airport",
      available: tier === "critical" || tier === "high",
    },
    {
      key: "full_refund",
      label: "Full Refund",
      description:
        "Full refund of the ticket price if no suitable alternative is available",
      available: true, // Available to all tiers
    },
    {
      key: "bonus_miles",
      label: "Bonus Miles Compensation",
      description:
        "Additional loyalty miles credited as compensation for the disruption",
      available: tier === "critical" || tier === "high" || tier === "medium",
    },
    {
      key: "priority_rebooking",
      label: "Priority Rebooking Queue",
      description:
        "Placed at the front of the rebooking queue ahead of lower-priority passengers",
      available: tier === "critical",
    },
  ];

  return { priorityScore: score, options };
}

/**
 * Get all priority rules.
 */
export function getRules(): PriorityRule[] {
  return [...rulesStore];
}

/**
 * Update an existing priority rule's score or active status.
 */
export function updateRule(
  ruleId: number,
  updates: { score?: number; isActive?: boolean }
): PriorityRule {
  const idx = rulesStore.findIndex(r => r.id === ruleId);
  if (idx === -1) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Priority rule with id ${ruleId} not found`,
    });
  }

  const rule = rulesStore[idx];
  const updated: PriorityRule = {
    ...rule,
    score: updates.score !== undefined ? updates.score : rule.score,
    isActive: updates.isActive !== undefined ? updates.isActive : rule.isActive,
  };

  rulesStore[idx] = updated;
  return updated;
}
