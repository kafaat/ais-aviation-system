/**
 * Fare Rules Engine Service
 *
 * Comprehensive fare management engine implementing ATPCO-style fare rules
 * for an aviation PSS (Passenger Service System). Handles fare class (RBD)
 * management, fare rule CRUD, fare calculation with multi-layer rule
 * application, booking validation, and fare comparison.
 *
 * All monetary values are in SAR cents (100 = 1.00 SAR).
 *
 * Rule categories follow ATPCO numbering conventions:
 *   Cat 1  - Eligibility          Cat 8  - Stopovers
 *   Cat 2  - Day/Time             Cat 9  - Transfers
 *   Cat 3  - Seasonality          Cat 10 - Combinations
 *   Cat 5  - Advance Purchase     Cat 11 - Blackout Dates
 *   Cat 6  - Minimum Stay         Cat 12 - Surcharges (YQ/YR)
 *   Cat 7  - Maximum Stay         Cat 16 - Penalties
 *   Cat 4  - Flight Application   Cat 19 - Children Discount
 *                                 Cat 35 - Group Discount
 *
 * @module fare-rules.service
 */

import { and, eq, gte, lte, isNull, or, sql, desc, asc } from "drizzle-orm";
import { getDb } from "../db";
import {
  fareClasses,
  fareRules,
  flights,
  type InsertFareClass,
  type InsertFareRule,
  type FareClass,
  type FareRule,
} from "../../drizzle/schema";
import { createServiceLogger } from "../_core/logger";

const log = createServiceLogger("fare-rules");

// ============================================================================
// Type Definitions
// ============================================================================

/** Cabin class values in the schema */
type CabinClass = "first" | "business" | "premium_economy" | "economy";

/** Passenger types for fare calculation */
type PassengerType = "adult" | "child" | "infant";

/** ATPCO-style rule category type (mirrors the schema enum) */
type RuleCategory = FareRule["ruleCategory"];

// ---------------------------------------------------------------------------
// Condition schemas for each rule category.
// Stored as JSON text in the `conditions` column of fareRules.
// ---------------------------------------------------------------------------

/** Cat 1: Eligibility - who may purchase this fare */
export interface EligibilityConditions {
  /** Allowed passenger types */
  passengerTypes?: PassengerType[];
  /** Minimum age for the fare */
  minAge?: number;
  /** Maximum age for the fare */
  maxAge?: number;
  /** Residence countries (ISO 3166-1 alpha-2) */
  residenceCountries?: string[];
  /** Whether corporate ID is required */
  requireCorporateId?: boolean;
  /** Whether loyalty membership is required */
  requireLoyaltyMembership?: boolean;
  /** Minimum loyalty tier (e.g. "gold", "platinum") */
  minLoyaltyTier?: string;
}

/** Cat 2: Day/Time - travel day and time restrictions */
export interface DayTimeConditions {
  /** Permitted days of week (0=Sunday ... 6=Saturday) */
  allowedDaysOfWeek?: number[];
  /** Permitted departure time window start (HH:mm) */
  departureTimeFrom?: string;
  /** Permitted departure time window end (HH:mm) */
  departureTimeTo?: string;
}

/** Cat 3: Seasonality - seasonal pricing adjustments */
export interface SeasonalityConditions {
  /** Season identifier (e.g. "peak", "off_peak", "shoulder") */
  season: string;
  /** Start of the seasonal period (ISO date string) */
  periodStart: string;
  /** End of the seasonal period (ISO date string) */
  periodEnd: string;
  /** Multiplier applied during this season (e.g. 1.30 for +30%) */
  seasonMultiplier?: number;
}

/** Cat 4: Flight Application - which flights the fare applies to */
export interface FlightApplicationConditions {
  /** Specific flight numbers (e.g. ["SV101", "SV102"]) */
  flightNumbers?: string[];
  /** Specific aircraft types allowed */
  aircraftTypes?: string[];
  /** Whether fare applies to direct flights only */
  directOnly?: boolean;
}

/** Cat 5: Advance Purchase - minimum days before departure to purchase */
export interface AdvancePurchaseConditions {
  /** Minimum number of days before departure */
  minDaysBeforeDeparture: number;
  /** Maximum number of days before departure (optional cap) */
  maxDaysBeforeDeparture?: number;
}

/** Cat 6: Minimum Stay - minimum duration at destination */
export interface MinimumStayConditions {
  /** Minimum nights at destination */
  minNights?: number;
  /** Minimum days at destination */
  minDays?: number;
  /** Legacy alias: same as minDays */
  minStayDays?: number;
  /** Whether a Saturday night stay is required */
  requireSaturdayNight?: boolean;
}

/** Cat 7: Maximum Stay - maximum duration at destination */
export interface MaximumStayConditions {
  /** Maximum nights at destination */
  maxNights?: number;
  /** Maximum days at destination */
  maxDays?: number;
  /** Legacy alias: same as maxDays */
  maxStayDays?: number;
}

/** Cat 8: Stopover rules */
export interface StopoverConditions {
  /** Number of free stopovers allowed */
  freeStopoverCount: number;
  /** Fee per additional stopover (SAR cents) */
  additionalStopoverFee?: number;
  /** Maximum stopover duration in hours */
  maxStopoverHours?: number;
}

/** Cat 9: Transfer rules */
export interface TransferConditions {
  /** Whether transfers (connections) are permitted */
  transfersAllowed: boolean;
  /** Maximum number of connections */
  maxTransfers?: number;
  /** Minimum connection time in minutes */
  minConnectionMinutes?: number;
  /** Maximum connection time in minutes */
  maxConnectionMinutes?: number;
}

/** Cat 10: Combination rules */
export interface CombinationConditions {
  /** Whether this fare can be combined with other fare classes */
  combinable: boolean;
  /** Allowed fare class codes for combination */
  allowedFareClasses?: string[];
  /** Whether end-on-end combinations are allowed */
  endOnEndAllowed?: boolean;
}

/** Cat 11: Blackout Dates */
export interface BlackoutDatesConditions {
  /**
   * Blackout date ranges during which the fare is not available.
   * Supports both `{start, end}` and legacy `{from, to}` formats.
   */
  blackoutPeriods?: Array<{
    start?: string;
    end?: string;
    reason?: string;
  }>;
  /** Legacy format: `periods` with `{from, to}` keys */
  periods?: Array<{
    from: string;
    to: string;
    reason?: string;
  }>;
}

/** Cat 12: Surcharges (YQ carrier surcharge, YR ticketing surcharge) */
export interface SurchargeConditions {
  /** Surcharge type code */
  surchargeType: "YQ" | "YR" | "fuel" | "insurance" | "security";
  /** Fixed amount in SAR cents */
  fixedAmount?: number;
  /** Percentage of base fare (e.g. 5.0 = 5%) */
  percentage?: number;
}

/** Cat 16: Penalties - change and cancellation fees */
export interface PenaltyConditions {
  /** Type of penalty this rule applies to */
  penaltyType: "change" | "cancel" | "no_show";
  /** Fixed penalty fee in SAR cents */
  fixedFee?: number;
  /** Percentage of fare as penalty */
  percentageFee?: number;
  /** Hours before departure when penalty tier changes */
  hoursBeforeDeparture?: number;
  /** Whether the fare is non-refundable */
  nonRefundable?: boolean;
  /** Time-based change fee tiers (legacy format) */
  changeTiers?: Array<{
    withinHours: number;
    fee: number;
  }>;
}

/** Cat 19: Children/Infant Discount */
export interface ChildrenDiscountConditions {
  /** Passenger type this discount applies to */
  passengerType: "child" | "infant";
  /** Discount percentage off the adult fare (e.g. 25 = 25% off) */
  discountPercentage: number;
  /** Minimum age for this discount tier */
  minAge?: number;
  /** Maximum age for this discount tier */
  maxAge?: number;
  /** Whether a seat is included (infants may be lap-held) */
  seatIncluded?: boolean;
}

/** Cat 35: Group Discount */
export interface GroupDiscountConditions {
  /** Minimum passengers to qualify as a group */
  minPassengers: number;
  /** Maximum passengers for this tier */
  maxPassengers?: number;
  /** Discount percentage for the group (e.g. 10 = 10% off) */
  discountPercentage: number;
  /** Whether a deposit is required for group bookings */
  depositRequired?: boolean;
  /** Deposit percentage of total fare */
  depositPercentage?: number;
}

/** Union of all condition types, keyed by rule category */
export type RuleConditionsMap = {
  eligibility: EligibilityConditions;
  day_time: DayTimeConditions;
  seasonality: SeasonalityConditions;
  flight_application: FlightApplicationConditions;
  advance_purchase: AdvancePurchaseConditions;
  minimum_stay: MinimumStayConditions;
  maximum_stay: MaximumStayConditions;
  stopovers: StopoverConditions;
  transfers: TransferConditions;
  combinations: CombinationConditions;
  blackout_dates: BlackoutDatesConditions;
  surcharges: SurchargeConditions;
  penalties: PenaltyConditions;
  children_discount: ChildrenDiscountConditions;
  group_discount: GroupDiscountConditions;
};

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Ordered processing sequence for fare rule categories.
 * Rules are applied in this specific order to produce deterministic results.
 */
const RULE_CATEGORY_ORDER: RuleCategory[] = [
  "eligibility",
  "flight_application",
  "day_time",
  "advance_purchase",
  "seasonality",
  "blackout_dates",
  "minimum_stay",
  "maximum_stay",
  "stopovers",
  "transfers",
  "combinations",
  "surcharges",
  "penalties",
  "children_discount",
  "group_discount",
];

/**
 * Get the cabin class base price from a flight.
 * Falls back to economy price for premium_economy and business price
 * for first class (fare class multiplier handles the premium).
 *
 * @param flight - Flight data with pricing columns
 * @param cabinClass - Target cabin class
 * @returns Base price in SAR cents
 */
function getFlightBasePrice(
  flight: { economyPrice: number; businessPrice: number },
  cabinClass: CabinClass
): number {
  switch (cabinClass) {
    case "first":
      return flight.businessPrice;
    case "business":
      return flight.businessPrice;
    case "premium_economy":
      return flight.economyPrice;
    case "economy":
    default:
      return flight.economyPrice;
  }
}

/**
 * Get available seats for a cabin class from a flight.
 *
 * @param flight - Flight data with availability columns
 * @param cabinClass - Target cabin class
 * @returns Number of available seats
 */
function getFlightAvailableSeats(
  flight: { economyAvailable: number; businessAvailable: number },
  cabinClass: CabinClass
): number {
  switch (cabinClass) {
    case "first":
    case "business":
      return flight.businessAvailable;
    case "premium_economy":
    case "economy":
    default:
      return flight.economyAvailable;
  }
}

/**
 * Safely parse a JSON string from the conditions column.
 *
 * @param conditionsText - Raw JSON text from the database
 * @returns Parsed object or null on parse failure
 */
function parseConditions<T>(conditionsText: string): T | null {
  try {
    return JSON.parse(conditionsText) as T;
  } catch {
    log.warn("Failed to parse fare rule conditions JSON");
    return null;
  }
}

/**
 * Validate that a conditions object has the minimum required fields
 * for its rule category. Called when creating or updating rules.
 *
 * @param category - The rule category
 * @param conditions - The parsed conditions object
 * @throws Error if validation fails
 */
function validateConditionsSchema(
  category: RuleCategory,
  conditions: Record<string, unknown>
): void {
  switch (category) {
    case "advance_purchase": {
      if (
        typeof conditions.minDaysBeforeDeparture !== "number" ||
        conditions.minDaysBeforeDeparture < 0
      ) {
        throw new Error(
          "advance_purchase conditions must include a non-negative minDaysBeforeDeparture"
        );
      }
      break;
    }
    case "seasonality": {
      if (
        typeof conditions.season !== "string" ||
        !conditions.periodStart ||
        !conditions.periodEnd
      ) {
        throw new Error(
          "seasonality conditions must include season, periodStart, and periodEnd"
        );
      }
      break;
    }
    case "blackout_dates": {
      const hasNewFormat =
        Array.isArray(conditions.blackoutPeriods) &&
        conditions.blackoutPeriods.length > 0;
      const hasLegacyFormat =
        Array.isArray(conditions.periods) && conditions.periods.length > 0;

      if (!hasNewFormat && !hasLegacyFormat) {
        throw new Error(
          "blackout_dates conditions must include a non-empty blackoutPeriods or periods array"
        );
      }

      const periods = hasNewFormat
        ? (conditions.blackoutPeriods as Array<Record<string, unknown>>)
        : (conditions.periods as Array<Record<string, unknown>>);

      for (const period of periods) {
        const hasStart = period.start || period.from;
        const hasEnd = period.end || period.to;
        if (!hasStart || !hasEnd) {
          throw new Error(
            "Each blackout period must include start/end (or from/to) date strings"
          );
        }
      }
      break;
    }
    case "surcharges": {
      if (typeof conditions.surchargeType !== "string") {
        throw new Error("surcharges conditions must include a surchargeType");
      }
      if (
        conditions.fixedAmount === undefined &&
        conditions.percentage === undefined
      ) {
        throw new Error(
          "surcharges conditions must include fixedAmount or percentage (or both)"
        );
      }
      break;
    }
    case "children_discount": {
      if (typeof conditions.discountPercentage !== "number") {
        throw new Error(
          "children_discount conditions must include a numeric discountPercentage"
        );
      }
      if (typeof conditions.passengerType !== "string") {
        throw new Error(
          "children_discount conditions must include passengerType (child or infant)"
        );
      }
      break;
    }
    case "group_discount": {
      if (
        typeof conditions.minPassengers !== "number" ||
        conditions.minPassengers < 2
      ) {
        throw new Error(
          "group_discount conditions must include minPassengers >= 2"
        );
      }
      if (typeof conditions.discountPercentage !== "number") {
        throw new Error(
          "group_discount conditions must include a numeric discountPercentage"
        );
      }
      break;
    }
    case "minimum_stay": {
      if (
        conditions.minNights === undefined &&
        conditions.minDays === undefined &&
        conditions.minStayDays === undefined &&
        conditions.requireSaturdayNight === undefined
      ) {
        throw new Error(
          "minimum_stay conditions must include minNights, minDays, minStayDays, or requireSaturdayNight"
        );
      }
      break;
    }
    case "maximum_stay": {
      if (
        conditions.maxNights === undefined &&
        conditions.maxDays === undefined &&
        conditions.maxStayDays === undefined
      ) {
        throw new Error(
          "maximum_stay conditions must include maxNights, maxDays, or maxStayDays"
        );
      }
      break;
    }
    case "penalties": {
      if (typeof conditions.penaltyType !== "string") {
        throw new Error("penalties conditions must include a penaltyType");
      }
      break;
    }
    // eligibility, day_time, flight_application, stopovers, transfers, combinations
    // have flexible schemas - any valid JSON is acceptable
    default:
      break;
  }
}

/**
 * Calculate the number of nights between two dates.
 *
 * @param departure - Departure date
 * @param returnDate - Return date
 * @returns Number of nights, or 0 if return is before departure
 */
function calculateNights(departure: Date, returnDate: Date): number {
  const diffMs = returnDate.getTime() - departure.getTime();
  if (diffMs <= 0) return 0;
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Check whether a Saturday night falls between two dates.
 *
 * @param departure - Departure date
 * @param returnDate - Return date
 * @returns True if at least one Saturday night is included
 */
function includesSaturdayNight(departure: Date, returnDate: Date): boolean {
  const current = new Date(departure);
  while (current < returnDate) {
    if (current.getDay() === 6) {
      return true;
    }
    current.setDate(current.getDate() + 1);
  }
  return false;
}

/**
 * Normalize blackout periods from either new or legacy format into
 * a consistent `{start, end, reason}` array.
 *
 * @param cond - Parsed blackout date conditions
 * @returns Normalized array of blackout periods
 */
function normalizeBlackoutPeriods(
  cond: BlackoutDatesConditions
): Array<{ start: string; end: string; reason?: string }> {
  const result: Array<{ start: string; end: string; reason?: string }> = [];

  if (cond.blackoutPeriods) {
    for (const p of cond.blackoutPeriods) {
      if (p.start && p.end) {
        result.push({ start: p.start, end: p.end, reason: p.reason });
      }
    }
  }

  if (cond.periods) {
    for (const p of cond.periods) {
      result.push({ start: p.from, end: p.to, reason: p.reason });
    }
  }

  return result;
}

/**
 * Resolve the effective minimum stay days from a MinimumStayConditions,
 * supporting both `minDays` and legacy `minStayDays` keys.
 */
function resolveMinStayDays(cond: MinimumStayConditions): number | undefined {
  return cond.minDays ?? cond.minStayDays;
}

/**
 * Resolve the effective maximum stay days from a MaximumStayConditions,
 * supporting both `maxDays` and legacy `maxStayDays` keys.
 */
function resolveMaxStayDays(cond: MaximumStayConditions): number | undefined {
  return cond.maxDays ?? cond.maxStayDays;
}

// ============================================================================
// Fare Class Management
// ============================================================================

/**
 * Create a new fare class (RBD - Reservation Booking Designator).
 *
 * Validates that the fare class code is unique per airline before inserting.
 * Codes are normalized to uppercase.
 *
 * @param data - Fare class creation data (all InsertFareClass fields except auto-generated ones)
 * @returns Object containing the new fare class ID
 * @throws Error if the code already exists for the airline or DB is unavailable
 */
export async function createFareClass(
  data: Omit<InsertFareClass, "id" | "createdAt" | "updatedAt">
): Promise<{ id: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const normalizedCode = (data.code ?? "").toUpperCase().trim();
  if (normalizedCode.length === 0 || normalizedCode.length > 2) {
    throw new Error("Fare class code must be 1-2 characters");
  }

  // Validate uniqueness: same code + same airline must not already exist
  const [existing] = await db
    .select({ id: fareClasses.id })
    .from(fareClasses)
    .where(
      and(
        eq(fareClasses.airlineId, data.airlineId),
        eq(fareClasses.code, normalizedCode)
      )
    )
    .limit(1);

  if (existing) {
    throw new Error(
      `Fare class code "${normalizedCode}" already exists for airline ${data.airlineId}`
    );
  }

  const result = await db.insert(fareClasses).values({
    ...data,
    code: normalizedCode,
    active: true,
  });

  const insertId = result[0].insertId;
  log.info(
    { id: insertId },
    `Created fare class ${normalizedCode} for airline ${data.airlineId}`
  );
  return { id: insertId };
}

/**
 * Update an existing fare class.
 *
 * Only fields present in `data` are modified; others remain unchanged.
 * If the code is being changed, validates uniqueness for the airline.
 *
 * @param id - Fare class ID
 * @param data - Partial fare class fields to update
 * @returns `{ success: true }` on success
 * @throws Error if the fare class is not found or DB is unavailable
 */
export async function updateFareClass(
  id: number,
  data: Partial<Omit<InsertFareClass, "id" | "createdAt" | "updatedAt">>
): Promise<{ success: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db
    .select()
    .from(fareClasses)
    .where(eq(fareClasses.id, id))
    .limit(1);

  if (existing.length === 0) {
    throw new Error(`Fare class with id ${id} not found`);
  }

  // If code is being changed, validate uniqueness for the airline
  if (data.code !== undefined) {
    const normalizedCode = data.code.toUpperCase().trim();
    const airlineId = data.airlineId ?? existing[0].airlineId;

    const [duplicate] = await db
      .select({ id: fareClasses.id })
      .from(fareClasses)
      .where(
        and(
          eq(fareClasses.airlineId, airlineId),
          eq(fareClasses.code, normalizedCode),
          sql`${fareClasses.id} != ${id}`
        )
      )
      .limit(1);

    if (duplicate) {
      throw new Error(
        `Fare class code "${normalizedCode}" already exists for airline ${airlineId}`
      );
    }

    data = { ...data, code: normalizedCode };
  }

  await db.update(fareClasses).set(data).where(eq(fareClasses.id, id));

  log.info(`Updated fare class ${id}`);
  return { success: true };
}

/**
 * Get a single fare class by ID.
 *
 * @param id - Fare class ID
 * @returns The fare class record, or null if not found
 */
export async function getFareClass(id: number): Promise<FareClass | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .select()
    .from(fareClasses)
    .where(eq(fareClasses.id, id))
    .limit(1);

  return result[0] ?? null;
}

/**
 * List fare classes for an airline, optionally filtered by cabin class.
 * Results are ordered by priority ascending. Only active fare classes
 * are returned.
 *
 * @param airlineId - The airline ID to filter by
 * @param cabinClass - Optional cabin class filter
 * @returns Array of fare class records
 */
export async function listFareClasses(
  airlineId: number,
  cabinClass?: "first" | "business" | "premium_economy" | "economy"
): Promise<FareClass[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const conditions = [
    eq(fareClasses.airlineId, airlineId),
    eq(fareClasses.active, true),
  ];

  if (cabinClass) {
    conditions.push(eq(fareClasses.cabinClass, cabinClass));
  }

  return await db
    .select()
    .from(fareClasses)
    .where(and(...conditions))
    .orderBy(asc(fareClasses.priority));
}

/**
 * Get fare class availability for a specific flight with nested availability.
 *
 * **Nested availability (cascade logic):** Fare classes within each cabin are
 * listed in priority order (descending). Higher-priority classes claim their
 * allocated seats first from the cabin pool. When a higher-priority class
 * consumes some of the pool, fewer seats remain for lower-priority classes.
 * Any remaining unallocated seats cascade to the lowest-priority class.
 *
 * @param flightId - The flight to check availability for
 * @returns Object with flight ID and array of fare classes with availability info
 * @throws Error if the flight is not found or DB is unavailable
 */
export async function getFareClassAvailability(flightId: number): Promise<{
  flightId: number;
  fareClasses: Array<
    FareClass & {
      availableSeats: number;
      totalAllocated: number;
    }
  >;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get the flight to find its airline and cabin availability
  const flightResult = await db
    .select()
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);

  if (flightResult.length === 0) {
    throw new Error(`Flight with id ${flightId} not found`);
  }

  const flight = flightResult[0];

  // Get all active fare classes for this airline, ordered by cabin
  // then priority descending (highest priority first within each cabin)
  const classes = await db
    .select()
    .from(fareClasses)
    .where(
      and(
        eq(fareClasses.airlineId, flight.airlineId),
        eq(fareClasses.active, true)
      )
    )
    .orderBy(asc(fareClasses.cabinClass), desc(fareClasses.priority));

  if (classes.length === 0) {
    return { flightId, fareClasses: [] };
  }

  // Group fare classes by cabin class for nested availability
  const cabinGroups: Record<string, FareClass[]> = {};
  for (const fc of classes) {
    const cabin = fc.cabinClass;
    if (!cabinGroups[cabin]) {
      cabinGroups[cabin] = [];
    }
    cabinGroups[cabin].push(fc);
  }

  const resultClasses: Array<
    FareClass & { availableSeats: number; totalAllocated: number }
  > = [];

  // Process each cabin group with nested availability cascade
  for (const [cabin, cabinClasses] of Object.entries(cabinGroups)) {
    const totalCabinSeats = getFlightAvailableSeats(
      flight,
      cabin as CabinClass
    );

    // Within each cabin, distribute seats top-down by priority.
    // Higher-priority classes claim their allocated seats first.
    let remainingSeats = totalCabinSeats;

    for (let i = 0; i < cabinClasses.length; i++) {
      const fc = cabinClasses[i];
      const allocated = fc.seatsAllocated ?? 0;
      const isLastInCabin = i === cabinClasses.length - 1;

      let effectiveAvailable: number;
      if (isLastInCabin) {
        // The lowest-priority class absorbs all remaining unallocated seats
        effectiveAvailable = Math.max(0, remainingSeats);
      } else {
        effectiveAvailable = Math.min(allocated, Math.max(0, remainingSeats));
      }

      resultClasses.push({
        ...fc,
        totalAllocated: allocated,
        availableSeats: effectiveAvailable,
      });

      remainingSeats = Math.max(0, remainingSeats - allocated);
    }
  }

  return {
    flightId,
    fareClasses: resultClasses,
  };
}

// ============================================================================
// Fare Rule Management
// ============================================================================

/**
 * Create a new fare rule.
 *
 * Validates that the referenced fare class exists. Parses and validates
 * the conditions JSON against the rule category schema before persisting.
 *
 * @param data - Fare rule creation data (all InsertFareRule fields except auto-generated ones)
 * @returns Object containing the new fare rule ID
 * @throws Error on validation failure or DB unavailability
 */
export async function createFareRule(
  data: Omit<InsertFareRule, "id" | "createdAt" | "updatedAt">
): Promise<{ id: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Validate that the fare class exists
  const fareClass = await db
    .select()
    .from(fareClasses)
    .where(eq(fareClasses.id, data.fareClassId))
    .limit(1);

  if (fareClass.length === 0) {
    throw new Error(`Fare class with id ${data.fareClassId} not found`);
  }

  // Parse and validate conditions JSON
  let conditionsObj: Record<string, unknown>;
  try {
    conditionsObj = JSON.parse(data.conditions);
  } catch {
    throw new Error("conditions must be a valid JSON string");
  }

  validateConditionsSchema(data.ruleCategory, conditionsObj);

  const result = await db.insert(fareRules).values({
    ...data,
    active: true,
  });

  const insertId = result[0].insertId;
  log.info(
    { id: insertId },
    `Created fare rule "${data.ruleName}" for fare class ${data.fareClassId}`
  );
  return { id: insertId };
}

/**
 * Update an existing fare rule.
 *
 * If conditions are provided, they are re-validated against the rule category.
 * Only fields present in `data` are modified.
 *
 * @param id - Fare rule ID
 * @param data - Partial fare rule fields to update
 * @returns `{ success: true }` on success
 * @throws Error if the rule is not found or validation fails
 */
export async function updateFareRule(
  id: number,
  data: Partial<Omit<InsertFareRule, "id" | "createdAt" | "updatedAt">>
): Promise<{ success: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db
    .select()
    .from(fareRules)
    .where(eq(fareRules.id, id))
    .limit(1);

  if (existing.length === 0) {
    throw new Error(`Fare rule with id ${id} not found`);
  }

  // If conditions are being updated, validate them
  if (data.conditions !== undefined) {
    let conditionsObj: Record<string, unknown>;
    try {
      conditionsObj = JSON.parse(data.conditions);
    } catch {
      throw new Error("conditions must be a valid JSON string");
    }

    const category = data.ruleCategory ?? existing[0].ruleCategory;
    validateConditionsSchema(category, conditionsObj);
  }

  await db.update(fareRules).set(data).where(eq(fareRules.id, id));

  log.info(`Updated fare rule ${id}`);
  return { success: true };
}

/**
 * Get a single fare rule by ID, including its associated fare class details.
 *
 * @param id - Fare rule ID
 * @returns The fare rule record (with nested fareClass when available),
 *          or null if not found
 */
export async function getFareRule(
  id: number
): Promise<(FareRule & { fareClass?: FareClass }) | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .select({
      rule: fareRules,
      fareClass: fareClasses,
    })
    .from(fareRules)
    .leftJoin(fareClasses, eq(fareRules.fareClassId, fareClasses.id))
    .where(eq(fareRules.id, id))
    .limit(1);

  if (result.length === 0) {
    return null;
  }

  const row = result[0];
  if (row.fareClass) {
    return { ...row.rule, fareClass: row.fareClass };
  }
  return row.rule;
}

/**
 * List fare rules with optional filters and pagination.
 *
 * Results are ordered by rule category ascending, then by creation date
 * descending (newest first within each category).
 *
 * @param params - Filter and pagination parameters
 * @returns Object with rules array and total count for the filter
 */
export async function listFareRules(params: {
  fareClassId?: number;
  airlineId?: number;
  category?: FareRule["ruleCategory"];
  active?: boolean;
  page: number;
  limit: number;
}): Promise<{ rules: FareRule[]; total: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const conditions: ReturnType<typeof eq>[] = [];

  if (params.fareClassId !== undefined) {
    conditions.push(eq(fareRules.fareClassId, params.fareClassId));
  }
  if (params.airlineId !== undefined) {
    conditions.push(eq(fareRules.airlineId, params.airlineId));
  }
  if (params.category !== undefined) {
    conditions.push(eq(fareRules.ruleCategory, params.category));
  }
  if (params.active !== undefined) {
    conditions.push(eq(fareRules.active, params.active));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rules, countResult] = await Promise.all([
    db
      .select()
      .from(fareRules)
      .where(whereClause)
      .orderBy(asc(fareRules.ruleCategory), desc(fareRules.createdAt))
      .limit(params.limit)
      .offset((params.page - 1) * params.limit),
    db
      .select({ count: sql<number>`count(*)` })
      .from(fareRules)
      .where(whereClause),
  ]);

  return {
    rules,
    total: countResult[0]?.count ?? 0,
  };
}

/**
 * Soft-delete a fare rule by setting active = false.
 *
 * This preserves the rule record for audit purposes while preventing
 * it from being applied to any future fare calculations.
 *
 * @param id - Fare rule ID
 * @throws Error if the rule is not found
 */
export async function deleteFareRule(id: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [existing] = await db
    .select({ id: fareRules.id })
    .from(fareRules)
    .where(eq(fareRules.id, id))
    .limit(1);

  if (!existing) {
    throw new Error(`Fare rule with id ${id} not found`);
  }

  await db.update(fareRules).set({ active: false }).where(eq(fareRules.id, id));

  log.info(`Soft-deleted fare rule ${id} (set active=false)`);
}

// ============================================================================
// Rule Retrieval
// ============================================================================

/**
 * Get all applicable fare rules for a fare class and optional route/date context.
 *
 * A rule is considered applicable when:
 * - It belongs to the specified fare class
 * - It is active
 * - The reference date falls within its validity window
 *   (validFrom <= date, and validUntil is either null or >= date)
 * - Its route restriction matches (null origin/destination = all routes)
 *
 * @param fareClassId - The fare class ID
 * @param originId - Optional origin airport ID (for route filtering)
 * @param destinationId - Optional destination airport ID (for route filtering)
 * @param date - Optional date for validity filtering (defaults to now)
 * @returns Array of applicable fare rules, ordered by category then ID
 */
export async function getApplicableRules(
  fareClassId: number,
  originId?: number,
  destinationId?: number,
  date?: Date
): Promise<FareRule[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const referenceDate = date ?? new Date();

  const baseConditions = [
    eq(fareRules.fareClassId, fareClassId),
    eq(fareRules.active, true),
    lte(fareRules.validFrom, referenceDate),
    or(isNull(fareRules.validUntil), gte(fareRules.validUntil, referenceDate)),
  ];

  // Route conditions: rule applies if its origin/dest is null (global) or matches
  if (originId !== undefined) {
    const originCondition = or(
      isNull(fareRules.originAirportId),
      eq(fareRules.originAirportId, originId)
    );
    if (originCondition) {
      baseConditions.push(originCondition);
    }
  }
  if (destinationId !== undefined) {
    const destCondition = or(
      isNull(fareRules.destinationAirportId),
      eq(fareRules.destinationAirportId, destinationId)
    );
    if (destCondition) {
      baseConditions.push(destCondition);
    }
  }

  return await db
    .select()
    .from(fareRules)
    .where(and(...baseConditions))
    .orderBy(asc(fareRules.ruleCategory), asc(fareRules.id));
}

// ============================================================================
// Fare Calculation Engine
// ============================================================================

/**
 * **CORE FUNCTION** - Calculate the total fare for a flight + fare class + route.
 *
 * Processing pipeline:
 *   1. Fetch the base flight price for the relevant cabin class
 *   2. Apply the fare class basePriceMultiplier
 *   3. Retrieve all applicable fare rules for the fare class, route, and date
 *   4. Apply rules in ATPCO category order:
 *      a. Eligibility (validation only, no price impact)
 *      b. Flight Application (validation only)
 *      c. Day/Time (validation only)
 *      d. Advance Purchase (priceAdjustment/priceMultiplier from rule record)
 *      e. Seasonality (seasonal multiplier from conditions or rule record)
 *      f. Blackout Dates (throws if departure falls in blackout)
 *      g. Min/Max Stay (validation only for round-trips)
 *      h. Stopovers, Transfers, Combinations (informational only)
 *      i. Surcharges (additive: YQ, YR, fuel, etc.)
 *      j. Penalties (recorded but not applied to fare)
 *      k. Children/Infant discount (percentage from conditions)
 *      l. Group discount (percentage from conditions)
 *   5. Apply default passenger type discounts if no rules matched
 *   6. Calculate taxes (15% VAT)
 *   7. Return full breakdown
 *
 * @param params - Fare calculation parameters
 * @returns Complete fare breakdown with per-passenger and total amounts
 * @throws Error if flight or fare class not found, or rule validation fails
 */
export async function calculateFare(params: {
  flightId: number;
  fareClassId: number;
  originId: number;
  destinationId: number;
  departureDate: string;
  returnDate?: string;
  passengerType: "adult" | "child" | "infant";
  passengerCount: number;
}): Promise<{
  baseFare: number;
  fareClassMultiplier: string;
  adjustedFare: number;
  surcharges: number;
  taxes: number;
  totalPerPassenger: number;
  totalAmount: number;
  currency: string;
  appliedRules: Array<{
    ruleId: number;
    ruleName: string;
    category: string;
    adjustment: number;
    multiplier: string;
  }>;
  passengerType: string;
  passengerCount: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Step 1: Get flight details for base price
  const flightResult = await db
    .select()
    .from(flights)
    .where(eq(flights.id, params.flightId))
    .limit(1);

  if (flightResult.length === 0) {
    throw new Error(`Flight with id ${params.flightId} not found`);
  }

  const flight = flightResult[0];

  // Step 2: Get fare class for multiplier and cabin class
  const fareClassResult = await db
    .select()
    .from(fareClasses)
    .where(
      and(eq(fareClasses.id, params.fareClassId), eq(fareClasses.active, true))
    )
    .limit(1);

  if (fareClassResult.length === 0) {
    throw new Error(`Fare class with id ${params.fareClassId} not found`);
  }

  const fc = fareClassResult[0];

  // Step 3: Calculate base fare using cabin-appropriate price
  const baseFare = getFlightBasePrice(flight, fc.cabinClass);
  const fareClassMultiplier = fc.basePriceMultiplier ?? "1.000";
  let adjustedFare = Math.round(baseFare * parseFloat(fareClassMultiplier));

  // Step 4: Retrieve all applicable fare rules
  const departureDate = new Date(params.departureDate);
  const returnDate = params.returnDate
    ? new Date(params.returnDate)
    : undefined;

  const applicableRules = await getApplicableRules(
    params.fareClassId,
    params.originId,
    params.destinationId,
    departureDate
  );

  // Group rules by category for ordered processing
  const rulesByCategory: Partial<Record<RuleCategory, FareRule[]>> = {};
  for (const rule of applicableRules) {
    if (!rulesByCategory[rule.ruleCategory]) {
      rulesByCategory[rule.ruleCategory] = [];
    }
    const categoryRules = rulesByCategory[rule.ruleCategory];
    if (categoryRules) {
      categoryRules.push(rule);
    }
  }

  // Step 5: Apply rules in defined category order
  const appliedRules: Array<{
    ruleId: number;
    ruleName: string;
    category: string;
    adjustment: number;
    multiplier: string;
  }> = [];
  let totalSurcharges = 0;
  let childDiscountApplied = false;

  for (const category of RULE_CATEGORY_ORDER) {
    const rulesInCategory = rulesByCategory[category];
    if (!rulesInCategory || rulesInCategory.length === 0) {
      continue;
    }

    for (const rule of rulesInCategory) {
      const conditions = parseConditions<Record<string, unknown>>(
        rule.conditions
      );
      if (!conditions) continue;

      const ruleMultiplierStr = rule.priceMultiplier ?? "1.000";
      const ruleMultiplier = parseFloat(ruleMultiplierStr);
      const ruleAdjustment = rule.priceAdjustment ?? 0;

      switch (category) {
        // ---- Eligibility (Cat 1): Validation only ----
        case "eligibility": {
          const cond = conditions as unknown as EligibilityConditions;
          if (
            cond.passengerTypes &&
            cond.passengerTypes.length > 0 &&
            !cond.passengerTypes.includes(params.passengerType)
          ) {
            throw new Error(
              `Passenger type "${params.passengerType}" is not eligible for fare class ${fc.code} (rule: ${rule.ruleName})`
            );
          }
          appliedRules.push({
            ruleId: rule.id,
            ruleName: rule.ruleName,
            category: rule.ruleCategory,
            adjustment: 0,
            multiplier: "1.000",
          });
          break;
        }

        // ---- Flight Application (Cat 4): Validation only ----
        case "flight_application": {
          const cond = conditions as unknown as FlightApplicationConditions;
          if (
            cond.flightNumbers &&
            cond.flightNumbers.length > 0 &&
            !cond.flightNumbers.includes(flight.flightNumber)
          ) {
            throw new Error(
              `Flight ${flight.flightNumber} is not eligible for fare class ${fc.code} (rule: ${rule.ruleName})`
            );
          }
          appliedRules.push({
            ruleId: rule.id,
            ruleName: rule.ruleName,
            category: rule.ruleCategory,
            adjustment: 0,
            multiplier: "1.000",
          });
          break;
        }

        // ---- Day/Time (Cat 2): Validation only ----
        case "day_time": {
          const cond = conditions as unknown as DayTimeConditions;
          if (
            cond.allowedDaysOfWeek &&
            cond.allowedDaysOfWeek.length > 0 &&
            !cond.allowedDaysOfWeek.includes(departureDate.getDay())
          ) {
            throw new Error(
              `Departure day is not permitted for this fare (rule: ${rule.ruleName})`
            );
          }
          appliedRules.push({
            ruleId: rule.id,
            ruleName: rule.ruleName,
            category: rule.ruleCategory,
            adjustment: 0,
            multiplier: "1.000",
          });
          break;
        }

        // ---- Advance Purchase (Cat 5): Validation + pricing ----
        case "advance_purchase": {
          const cond = conditions as unknown as AdvancePurchaseConditions;
          const now = new Date();
          const daysBeforeDeparture = Math.floor(
            (departureDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
          );

          if (daysBeforeDeparture < cond.minDaysBeforeDeparture) {
            throw new Error(
              `Advance purchase requires at least ${cond.minDaysBeforeDeparture} days before departure; only ${daysBeforeDeparture} days remain (rule: ${rule.ruleName})`
            );
          }

          if (
            cond.maxDaysBeforeDeparture !== undefined &&
            daysBeforeDeparture > cond.maxDaysBeforeDeparture
          ) {
            // Too early to purchase under this rule - skip (not an error)
            continue;
          }

          // Apply pricing from the rule record
          const preFare = adjustedFare;
          adjustedFare = Math.round(adjustedFare * ruleMultiplier);
          adjustedFare += ruleAdjustment;
          const totalRuleAdjustment = adjustedFare - preFare;

          appliedRules.push({
            ruleId: rule.id,
            ruleName: rule.ruleName,
            category: rule.ruleCategory,
            adjustment: totalRuleAdjustment,
            multiplier: ruleMultiplierStr,
          });
          break;
        }

        // ---- Seasonality (Cat 3): Conditional pricing ----
        case "seasonality": {
          const cond = conditions as unknown as SeasonalityConditions;
          const depTime = departureDate.getTime();
          const periodStart = new Date(cond.periodStart).getTime();
          const periodEnd = new Date(cond.periodEnd).getTime();

          if (depTime >= periodStart && depTime <= periodEnd) {
            // Apply seasonal multiplier from conditions, falling back to
            // rule-level multiplier
            const seasonMult = cond.seasonMultiplier ?? ruleMultiplier;
            const preFare = adjustedFare;
            adjustedFare = Math.round(adjustedFare * seasonMult);
            adjustedFare += ruleAdjustment;
            const totalRuleAdjustment = adjustedFare - preFare;

            appliedRules.push({
              ruleId: rule.id,
              ruleName: rule.ruleName,
              category: rule.ruleCategory,
              adjustment: totalRuleAdjustment,
              multiplier: seasonMult.toFixed(3),
            });
          }
          break;
        }

        // ---- Blackout Dates (Cat 11): Validation ----
        case "blackout_dates": {
          const cond = conditions as unknown as BlackoutDatesConditions;
          const periods = normalizeBlackoutPeriods(cond);
          const depTime = departureDate.getTime();

          for (const period of periods) {
            const blackoutStart = new Date(period.start).getTime();
            const blackoutEnd = new Date(period.end).getTime();
            if (depTime >= blackoutStart && depTime <= blackoutEnd) {
              throw new Error(
                `Departure date falls within a blackout period${period.reason ? ` (${period.reason})` : ""} for fare class ${fc.code} (rule: ${rule.ruleName})`
              );
            }
          }
          appliedRules.push({
            ruleId: rule.id,
            ruleName: rule.ruleName,
            category: rule.ruleCategory,
            adjustment: 0,
            multiplier: "1.000",
          });
          break;
        }

        // ---- Minimum Stay (Cat 6): Validation only ----
        case "minimum_stay": {
          if (returnDate) {
            const cond = conditions as unknown as MinimumStayConditions;
            const nights = calculateNights(departureDate, returnDate);

            if (cond.minNights !== undefined && nights < cond.minNights) {
              throw new Error(
                `Minimum stay requirement of ${cond.minNights} night(s) not met; trip is ${nights} night(s) (rule: ${rule.ruleName})`
              );
            }
            const minDays = resolveMinStayDays(cond);
            if (minDays !== undefined && nights < minDays) {
              throw new Error(
                `Minimum stay requirement of ${minDays} day(s) not met (rule: ${rule.ruleName})`
              );
            }
            if (
              cond.requireSaturdayNight &&
              !includesSaturdayNight(departureDate, returnDate)
            ) {
              throw new Error(
                `Saturday night stay is required for this fare (rule: ${rule.ruleName})`
              );
            }
          }
          appliedRules.push({
            ruleId: rule.id,
            ruleName: rule.ruleName,
            category: rule.ruleCategory,
            adjustment: 0,
            multiplier: "1.000",
          });
          break;
        }

        // ---- Maximum Stay (Cat 7): Validation only ----
        case "maximum_stay": {
          if (returnDate) {
            const cond = conditions as unknown as MaximumStayConditions;
            const nights = calculateNights(departureDate, returnDate);

            if (cond.maxNights !== undefined && nights > cond.maxNights) {
              throw new Error(
                `Maximum stay of ${cond.maxNights} night(s) exceeded; trip is ${nights} night(s) (rule: ${rule.ruleName})`
              );
            }
            const maxDays = resolveMaxStayDays(cond);
            if (maxDays !== undefined && nights > maxDays) {
              throw new Error(
                `Maximum stay of ${maxDays} day(s) exceeded (rule: ${rule.ruleName})`
              );
            }
          }
          appliedRules.push({
            ruleId: rule.id,
            ruleName: rule.ruleName,
            category: rule.ruleCategory,
            adjustment: 0,
            multiplier: "1.000",
          });
          break;
        }

        // ---- Stopovers (Cat 8), Transfers (Cat 9), Combinations (Cat 10) ----
        // Informational in fare calculation; enforced during itinerary building
        case "stopovers":
        case "transfers":
        case "combinations": {
          appliedRules.push({
            ruleId: rule.id,
            ruleName: rule.ruleName,
            category: rule.ruleCategory,
            adjustment: 0,
            multiplier: "1.000",
          });
          break;
        }

        // ---- Surcharges (Cat 12): Additive pricing ----
        case "surcharges": {
          const cond = conditions as unknown as SurchargeConditions;
          let surchargeAmount = 0;

          if (cond.fixedAmount) {
            surchargeAmount += cond.fixedAmount;
          }
          if (cond.percentage) {
            surchargeAmount += Math.round(
              adjustedFare * (cond.percentage / 100)
            );
          }
          surchargeAmount += ruleAdjustment;

          if (surchargeAmount !== 0) {
            totalSurcharges += surchargeAmount;
            appliedRules.push({
              ruleId: rule.id,
              ruleName: rule.ruleName,
              category: rule.ruleCategory,
              adjustment: surchargeAmount,
              multiplier: "1.000",
            });
          }
          break;
        }

        // ---- Penalties (Cat 16): Recorded only ----
        case "penalties": {
          appliedRules.push({
            ruleId: rule.id,
            ruleName: rule.ruleName,
            category: rule.ruleCategory,
            adjustment: 0,
            multiplier: "1.000",
          });
          break;
        }

        // ---- Children/Infant Discount (Cat 19): Percentage discount ----
        case "children_discount": {
          const cond = conditions as unknown as ChildrenDiscountConditions;
          // cond.passengerType is "child" | "infant", so matching implies non-adult
          if (cond.passengerType === params.passengerType) {
            const discountMultiplier = 1 - cond.discountPercentage / 100;
            const preFare = adjustedFare;
            adjustedFare = Math.round(adjustedFare * discountMultiplier);
            // Also apply rule-level pricing
            adjustedFare = Math.round(adjustedFare * ruleMultiplier);
            adjustedFare += ruleAdjustment;
            const totalRuleAdjustment = adjustedFare - preFare;

            appliedRules.push({
              ruleId: rule.id,
              ruleName: rule.ruleName,
              category: rule.ruleCategory,
              adjustment: totalRuleAdjustment,
              multiplier: discountMultiplier.toFixed(3),
            });
            childDiscountApplied = true;
          }
          break;
        }

        // ---- Group Discount (Cat 35): Percentage discount ----
        case "group_discount": {
          const cond = conditions as unknown as GroupDiscountConditions;
          const meetsMin = params.passengerCount >= cond.minPassengers;
          const meetsMax =
            cond.maxPassengers === undefined ||
            params.passengerCount <= cond.maxPassengers;

          if (meetsMin && meetsMax) {
            const discountMultiplier = 1 - cond.discountPercentage / 100;
            const preFare = adjustedFare;
            adjustedFare = Math.round(adjustedFare * discountMultiplier);
            adjustedFare = Math.round(adjustedFare * ruleMultiplier);
            adjustedFare += ruleAdjustment;
            const totalRuleAdjustment = adjustedFare - preFare;

            appliedRules.push({
              ruleId: rule.id,
              ruleName: rule.ruleName,
              category: rule.ruleCategory,
              adjustment: totalRuleAdjustment,
              multiplier: discountMultiplier.toFixed(3),
            });
          }
          break;
        }

        default:
          break;
      }
    }
  }

  // Step 6: Apply default passenger type discounts if no specific rules matched
  if (params.passengerType === "child" && !childDiscountApplied) {
    adjustedFare = Math.round(adjustedFare * 0.75); // 25% discount
  } else if (params.passengerType === "infant" && !childDiscountApplied) {
    adjustedFare = Math.round(adjustedFare * 0.1); // 90% discount
  }

  // Step 7: Ensure fare does not go below zero
  adjustedFare = Math.max(0, adjustedFare);

  // Step 8: Calculate taxes (15% VAT on fare + surcharges)
  const taxableAmount = adjustedFare + totalSurcharges;
  const taxes = Math.round(taxableAmount * 0.15);

  // Step 9: Compute totals
  const totalPerPassenger = adjustedFare + totalSurcharges + taxes;
  const totalAmount = totalPerPassenger * params.passengerCount;

  return {
    baseFare,
    fareClassMultiplier,
    adjustedFare,
    surcharges: totalSurcharges,
    taxes,
    totalPerPassenger,
    totalAmount,
    currency: "SAR",
    appliedRules,
    passengerType: params.passengerType,
    passengerCount: params.passengerCount,
  };
}

// ============================================================================
// Booking Rule Validation
// ============================================================================

/**
 * Validate that a booking meets all applicable fare rules.
 *
 * Checks each applicable rule category without modifying prices, collecting
 * all violations rather than failing on the first one. This is designed for
 * pre-booking validation where you want to show the user all issues at once.
 *
 * @param params - Validation parameters (supports both string and Date types)
 * @returns Validation result with pass/fail and list of violations
 */
export async function validateBookingRules(params: {
  fareClassId: number;
  departureDate: string | Date;
  returnDate?: string | Date;
  bookingDate: string | Date;
  originId: number;
  destinationId: number;
  passengerCount: number;
}): Promise<{
  valid: boolean;
  violations: Array<{
    ruleId: number;
    ruleName: string;
    category: string;
    message: string;
  }>;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const departureDate =
    params.departureDate instanceof Date
      ? params.departureDate
      : new Date(params.departureDate);
  const bookingDate =
    params.bookingDate instanceof Date
      ? params.bookingDate
      : new Date(params.bookingDate);
  const returnDate = params.returnDate
    ? params.returnDate instanceof Date
      ? params.returnDate
      : new Date(params.returnDate)
    : undefined;

  // Fetch all applicable rules
  const applicableRules = await getApplicableRules(
    params.fareClassId,
    params.originId,
    params.destinationId,
    departureDate
  );

  const violations: Array<{
    ruleId: number;
    ruleName: string;
    category: string;
    message: string;
  }> = [];

  for (const rule of applicableRules) {
    const conditions = parseConditions<Record<string, unknown>>(
      rule.conditions
    );
    if (!conditions) continue;

    switch (rule.ruleCategory) {
      // ---- Advance Purchase (Cat 5) ----
      case "advance_purchase": {
        const minDays = (conditions.minDaysBeforeDeparture as number) ?? 0;
        const daysDiff = Math.floor(
          (departureDate.getTime() - bookingDate.getTime()) /
            (1000 * 60 * 60 * 24)
        );
        if (daysDiff < minDays) {
          violations.push({
            ruleId: rule.id,
            ruleName: rule.ruleName,
            category: rule.ruleCategory,
            message: `Must be booked at least ${minDays} days before departure (currently ${daysDiff} days)`,
          });
        }
        break;
      }

      // ---- Minimum Stay (Cat 6) ----
      case "minimum_stay": {
        if (returnDate) {
          const cond = conditions as unknown as MinimumStayConditions;
          const nights = calculateNights(departureDate, returnDate);

          if (cond.minNights !== undefined && nights < cond.minNights) {
            violations.push({
              ruleId: rule.id,
              ruleName: rule.ruleName,
              category: rule.ruleCategory,
              message: `Minimum stay of ${cond.minNights} night(s) required (currently ${nights} night(s))`,
            });
          }

          const minDays = resolveMinStayDays(cond);
          if (minDays !== undefined && nights < minDays) {
            violations.push({
              ruleId: rule.id,
              ruleName: rule.ruleName,
              category: rule.ruleCategory,
              message: `Minimum stay of ${minDays} days required (currently ${nights} days)`,
            });
          }

          if (
            cond.requireSaturdayNight &&
            !includesSaturdayNight(departureDate, returnDate)
          ) {
            violations.push({
              ruleId: rule.id,
              ruleName: rule.ruleName,
              category: rule.ruleCategory,
              message: "Saturday night stay is required",
            });
          }
        }
        break;
      }

      // ---- Maximum Stay (Cat 7) ----
      case "maximum_stay": {
        if (returnDate) {
          const cond = conditions as unknown as MaximumStayConditions;
          const nights = calculateNights(departureDate, returnDate);

          if (cond.maxNights !== undefined && nights > cond.maxNights) {
            violations.push({
              ruleId: rule.id,
              ruleName: rule.ruleName,
              category: rule.ruleCategory,
              message: `Maximum stay of ${cond.maxNights} night(s) exceeded (currently ${nights} night(s))`,
            });
          }

          const maxDays = resolveMaxStayDays(cond);
          if (maxDays !== undefined && nights > maxDays) {
            violations.push({
              ruleId: rule.id,
              ruleName: rule.ruleName,
              category: rule.ruleCategory,
              message: `Maximum stay of ${maxDays} days exceeded (currently ${nights} days)`,
            });
          }
        }
        break;
      }

      // ---- Blackout Dates (Cat 11) ----
      case "blackout_dates": {
        const cond = conditions as unknown as BlackoutDatesConditions;
        const periods = normalizeBlackoutPeriods(cond);
        const depTime = departureDate.getTime();

        for (const period of periods) {
          const periodStart = new Date(period.start).getTime();
          const periodEnd = new Date(period.end).getTime();
          if (depTime >= periodStart && depTime <= periodEnd) {
            violations.push({
              ruleId: rule.id,
              ruleName: rule.ruleName,
              category: rule.ruleCategory,
              message: `Departure date falls within blackout period (${period.start} to ${period.end})${period.reason ? ` - ${period.reason}` : ""}`,
            });
          }
        }
        break;
      }

      // ---- Day/Time (Cat 2) ----
      case "day_time": {
        const cond = conditions as unknown as DayTimeConditions;
        if (cond.allowedDaysOfWeek && cond.allowedDaysOfWeek.length > 0) {
          const dayOfWeek = departureDate.getDay();
          if (!cond.allowedDaysOfWeek.includes(dayOfWeek)) {
            violations.push({
              ruleId: rule.id,
              ruleName: rule.ruleName,
              category: rule.ruleCategory,
              message: "Departure day not allowed for this fare class",
            });
          }
        }
        break;
      }

      // ---- Eligibility (Cat 1) ----
      case "eligibility": {
        const cond = conditions as unknown as EligibilityConditions;
        if (cond.requireCorporateId) {
          violations.push({
            ruleId: rule.id,
            ruleName: rule.ruleName,
            category: rule.ruleCategory,
            message: "Corporate ID required for this fare class",
          });
        }
        break;
      }

      // ---- Group Discount (Cat 35): Validate group size ----
      case "group_discount": {
        const cond = conditions as unknown as GroupDiscountConditions;
        const minPassengers = cond.minPassengers ?? 10;
        const maxPassengers = cond.maxPassengers ?? 50;
        if (
          params.passengerCount < minPassengers ||
          params.passengerCount > maxPassengers
        ) {
          violations.push({
            ruleId: rule.id,
            ruleName: rule.ruleName,
            category: rule.ruleCategory,
            message: `Group size must be between ${minPassengers} and ${maxPassengers} passengers`,
          });
        }
        break;
      }

      // Other categories are informational and do not produce violations
      default:
        break;
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Validate fare rules against booking parameters.
 *
 * This is an alias for `validateBookingRules` that maintains backward
 * compatibility with the router's `validateRules` call signature.
 *
 * @param params - Validation parameters with string dates
 * @returns Validation result with pass/fail and list of violations
 */
export async function validateRules(params: {
  fareClassId: number;
  departureDate: string;
  returnDate?: string;
  bookingDate: string;
  originId: number;
  destinationId: number;
  passengerCount: number;
}): Promise<{
  valid: boolean;
  violations: Array<{
    ruleId: number;
    ruleName: string;
    category: string;
    message: string;
  }>;
}> {
  return await validateBookingRules(params);
}

// ============================================================================
// Change Fee Calculation
// ============================================================================

/**
 * Calculate the change/cancellation fee for a fare class.
 *
 * Combines the base change fee from the fare class definition with any
 * additional penalty rules (Cat 16) that apply. Penalty rules may define
 * time-based fee tiers (changeTiers) and/or fixed fees from conditions.
 *
 * @param params - Change fee calculation parameters
 * @returns Detailed change fee breakdown including whether changes are allowed
 */
export async function calculateChangeFee(params: {
  fareClassId: number;
  bookingDate: string;
  changeDate: string;
}): Promise<{
  fareClassId: number;
  changeable: boolean;
  baseFee: number;
  additionalFees: number;
  totalFee: number;
  currency: string;
  rules: Array<{
    ruleId: number;
    ruleName: string;
    feeContribution: number;
  }>;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get fare class
  const fareClassResult = await db
    .select()
    .from(fareClasses)
    .where(eq(fareClasses.id, params.fareClassId))
    .limit(1);

  if (fareClassResult.length === 0) {
    throw new Error(`Fare class with id ${params.fareClassId} not found`);
  }

  const fc = fareClassResult[0];

  // If the fare is not changeable, return immediately
  if (!fc.changeable) {
    return {
      fareClassId: params.fareClassId,
      changeable: false,
      baseFee: 0,
      additionalFees: 0,
      totalFee: 0,
      currency: "SAR",
      rules: [],
    };
  }

  const baseFee = fc.changeFee ?? 0;
  let additionalFees = 0;
  const appliedRules: Array<{
    ruleId: number;
    ruleName: string;
    feeContribution: number;
  }> = [];

  // Get penalty rules for this fare class
  const changeDate = new Date(params.changeDate);
  const penaltyRules = await db
    .select()
    .from(fareRules)
    .where(
      and(
        eq(fareRules.fareClassId, params.fareClassId),
        eq(fareRules.ruleCategory, "penalties"),
        eq(fareRules.active, true),
        lte(fareRules.validFrom, changeDate),
        or(isNull(fareRules.validUntil), gte(fareRules.validUntil, changeDate))
      )
    )
    .orderBy(asc(fareRules.id));

  for (const rule of penaltyRules) {
    const conditions = parseConditions<PenaltyConditions>(rule.conditions);
    if (!conditions) continue;

    // Only process "change" penalties for change fee calculation
    if (conditions.penaltyType !== "change") continue;

    let ruleFeeContribution = 0;

    // Check time-based fee tiers
    const bookingDate = new Date(params.bookingDate);
    const hoursUntilChange = Math.floor(
      (changeDate.getTime() - bookingDate.getTime()) / (1000 * 60 * 60)
    );

    if (conditions.changeTiers && conditions.changeTiers.length > 0) {
      for (const tier of conditions.changeTiers) {
        if (hoursUntilChange <= tier.withinHours) {
          ruleFeeContribution += tier.fee;
          break; // Use first matching tier
        }
      }
    }

    // Apply fixed fee from conditions
    if (conditions.fixedFee !== undefined && conditions.fixedFee > 0) {
      ruleFeeContribution += conditions.fixedFee;
    }

    // Also apply flat adjustment from the rule record
    if (rule.priceAdjustment && rule.priceAdjustment > 0) {
      ruleFeeContribution += rule.priceAdjustment;
    }

    if (ruleFeeContribution > 0) {
      additionalFees += ruleFeeContribution;
      appliedRules.push({
        ruleId: rule.id,
        ruleName: rule.ruleName,
        feeContribution: ruleFeeContribution,
      });
    }
  }

  return {
    fareClassId: params.fareClassId,
    changeable: true,
    baseFee,
    additionalFees,
    totalFee: baseFee + additionalFees,
    currency: "SAR",
    rules: appliedRules,
  };
}

// ============================================================================
// Fare Comparison
// ============================================================================

/**
 * Compare all available fare classes for a flight, showing prices, features,
 * and availability side by side.
 *
 * For each active fare class on the flight's airline, calculates the adult
 * fare using `calculateFare` and includes feature details. Fare classes that
 * fail validation (e.g. blackout dates, eligibility restrictions) are silently
 * excluded from the comparison.
 *
 * Results include nested availability data showing actual bookable seats
 * per fare class.
 *
 * @param params - Flight, route, and date parameters
 * @returns Object with flight ID and array of fare comparisons sorted by
 *          total fare ascending (cheapest first)
 */
export async function compareFareClasses(params: {
  flightId: number;
  originId: number;
  destinationId: number;
  departureDate: string;
}): Promise<{
  flightId: number;
  comparisons: Array<{
    fareClass: FareClass;
    estimatedFare: number;
    surcharges: number;
    taxes: number;
    total: number;
    rulesApplied: number;
    features: {
      refundable: boolean;
      changeable: boolean;
      changeFee: number | null;
      upgradeable: boolean;
      baggageAllowance: number | null;
      baggagePieces: number | null;
      carryOnAllowance: number | null;
      seatSelection: string | null;
      loungeAccess: boolean;
      priorityBoarding: boolean;
      mealIncluded: boolean;
      mileageEarningRate: string | null;
    };
    availableSeats: number;
    isAvailable: boolean;
  }>;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get flight
  const flightResult = await db
    .select()
    .from(flights)
    .where(eq(flights.id, params.flightId))
    .limit(1);

  if (flightResult.length === 0) {
    throw new Error(`Flight with id ${params.flightId} not found`);
  }

  const flight = flightResult[0];

  // Get availability data for nested availability
  const availData = await getFareClassAvailability(params.flightId);
  const availMap = new Map<
    number,
    { availableSeats: number; totalAllocated: number }
  >();
  for (const item of availData.fareClasses) {
    availMap.set(item.id, {
      availableSeats: item.availableSeats,
      totalAllocated: item.totalAllocated,
    });
  }

  // Get all active fare classes
  const classes = await db
    .select()
    .from(fareClasses)
    .where(
      and(
        eq(fareClasses.airlineId, flight.airlineId),
        eq(fareClasses.active, true)
      )
    )
    .orderBy(asc(fareClasses.cabinClass), desc(fareClasses.priority));

  const comparisons = [];
  for (const fc of classes) {
    let fareResult;
    try {
      fareResult = await calculateFare({
        flightId: params.flightId,
        fareClassId: fc.id,
        originId: params.originId,
        destinationId: params.destinationId,
        departureDate: params.departureDate,
        passengerType: "adult",
        passengerCount: 1,
      });
    } catch {
      // Fare classes that fail validation (blackout, eligibility, etc.)
      // are excluded from comparison
      continue;
    }

    const availability = availMap.get(fc.id);
    const availableSeats = availability?.availableSeats ?? 0;

    comparisons.push({
      fareClass: fc,
      estimatedFare: fareResult.adjustedFare,
      surcharges: fareResult.surcharges,
      taxes: fareResult.taxes,
      total: fareResult.totalPerPassenger,
      rulesApplied: fareResult.appliedRules.length,
      features: {
        refundable: fc.refundable,
        changeable: fc.changeable,
        changeFee: fc.changeFee,
        upgradeable: fc.upgradeable,
        baggageAllowance: fc.baggageAllowance,
        baggagePieces: fc.baggagePieces,
        carryOnAllowance: fc.carryOnAllowance,
        seatSelection: fc.seatSelection,
        loungeAccess: fc.loungeAccess,
        priorityBoarding: fc.priorityBoarding,
        mealIncluded: fc.mealIncluded,
        mileageEarningRate: fc.mileageEarningRate,
      },
      availableSeats,
      isAvailable: availableSeats > 0,
    });
  }

  // Sort by total fare ascending (cheapest first)
  comparisons.sort((a, b) => a.total - b.total);

  return {
    flightId: params.flightId,
    comparisons,
  };
}
