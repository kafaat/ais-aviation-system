/**
 * Weight & Balance Service
 *
 * Comprehensive weight and balance calculations for flight operations.
 * Implements IATA standard load sheet generation, CG calculations,
 * trim settings, and weight limit verification.
 */

import { getDb } from "../db";
import {
  flights,
  bookings,
  passengers,
  aircraftTypes,
  loadPlans,
  baggageItems,
  airlines,
  airports,
} from "../../drizzle/schema";
import { eq, and, sql, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

// ============================================================================
// Safe JSON parse helper
// ============================================================================

function parseJsonSafe<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    console.warn("Failed to parse JSON value, using fallback");
    return fallback;
  }
}

// ============================================================================
// Inline Schema Types
// ============================================================================

/**
 * Aircraft weight limits configuration.
 * Weights stored in kg * 100 for precision (e.g. 35140000 = 351,400.00 kg).
 */
export interface AircraftWeightLimits {
  id: number;
  aircraftTypeId: number;
  maxTakeoffWeight: number; // kg * 100
  maxLandingWeight: number; // kg * 100
  maxZeroFuelWeight: number; // kg * 100
  operatingEmptyWeight: number; // kg * 100
  maxPayload: number; // kg * 100
  maxFuelCapacity: number; // kg * 100
  maxPassengers: number;
  standardMaleWeight: number; // kg
  standardFemaleWeight: number; // kg
  standardChildWeight: number; // kg
  standardInfantWeight: number; // kg
  standardBagWeight: number; // kg
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Flight weight & balance calculation record.
 */
export interface FlightWeightBalance {
  id: number;
  flightId: number;
  aircraftTypeId: number;
  operatingEmptyWeight: number;
  passengerWeight: number;
  baggageWeight: number;
  cargoWeight: number;
  fuelWeight: number;
  totalWeight: number;
  maxTakeoffWeight: number;
  cgPosition: number; // % MAC
  cgForwardLimit: number;
  cgAftLimit: number;
  isWithinLimits: boolean;
  trimSetting: number;
  status: "preliminary" | "final" | "amended";
  calculatedBy: number;
  calculatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// IATA Standard Passenger Weights (kg, including hand baggage)
// Per IATA AHM 515 / AHM 560
// ============================================================================

const DEFAULT_STANDARD_WEIGHTS = {
  male: 88, // kg (IATA standard male with hand baggage)
  female: 70, // kg (IATA standard female with hand baggage)
  child: 35, // kg (2-11 years)
  infant: 10, // kg (under 2 years)
  bag: 15, // kg average checked bag weight
};

// ============================================================================
// Aircraft Type Weight Limits Cache
// Maps aircraftTypeId to custom weight limits. Falls back to the
// aircraftTypes table values when no custom override exists.
// ============================================================================

const weightLimitsCache = new Map<number, AircraftWeightLimits>();

// ============================================================================
// Helper: get db or throw
// ============================================================================

async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }
  return db;
}

// ============================================================================
// Helper: get flight with aircraft type info
// ============================================================================

async function getFlightWithAircraft(flightId: number) {
  const db = await requireDb();

  const [flight] = await db
    .select({
      id: flights.id,
      flightNumber: flights.flightNumber,
      airlineId: flights.airlineId,
      originId: flights.originId,
      destinationId: flights.destinationId,
      departureTime: flights.departureTime,
      arrivalTime: flights.arrivalTime,
      aircraftType: flights.aircraftType,
      status: flights.status,
      economySeats: flights.economySeats,
      businessSeats: flights.businessSeats,
      economyAvailable: flights.economyAvailable,
      businessAvailable: flights.businessAvailable,
    })
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);

  if (!flight) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Flight ${flightId} not found`,
    });
  }

  return flight;
}

// ============================================================================
// getAircraftLimits
// ============================================================================

/**
 * Get aircraft weight limits for a given aircraft type.
 * Returns custom limits from cache if set, otherwise derives limits
 * from the aircraftTypes table data.
 */
export async function getAircraftLimits(
  aircraftTypeId: number
): Promise<AircraftWeightLimits> {
  // Check cache first
  const cached = weightLimitsCache.get(aircraftTypeId);
  if (cached) return cached;

  const db = await requireDb();

  const [aircraft] = await db
    .select()
    .from(aircraftTypes)
    .where(eq(aircraftTypes.id, aircraftTypeId))
    .limit(1);

  if (!aircraft) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Aircraft type ${aircraftTypeId} not found`,
    });
  }

  const limits: AircraftWeightLimits = {
    id: aircraft.id,
    aircraftTypeId: aircraft.id,
    maxTakeoffWeight: aircraft.maxTakeoffWeight * 100,
    maxLandingWeight: aircraft.maxLandingWeight * 100,
    maxZeroFuelWeight: aircraft.maxZeroFuelWeight * 100,
    operatingEmptyWeight: aircraft.operatingEmptyWeight * 100,
    maxPayload: aircraft.maxPayload * 100,
    maxFuelCapacity: aircraft.maxFuelCapacity * 100,
    maxPassengers: aircraft.totalSeats,
    standardMaleWeight: DEFAULT_STANDARD_WEIGHTS.male,
    standardFemaleWeight: DEFAULT_STANDARD_WEIGHTS.female,
    standardChildWeight: DEFAULT_STANDARD_WEIGHTS.child,
    standardInfantWeight: DEFAULT_STANDARD_WEIGHTS.infant,
    standardBagWeight: DEFAULT_STANDARD_WEIGHTS.bag,
    createdAt: aircraft.createdAt,
    updatedAt: aircraft.updatedAt,
  };

  weightLimitsCache.set(aircraftTypeId, limits);
  return limits;
}

/**
 * Update aircraft weight limits. Persists to cache and returns updated limits.
 */
export async function updateAircraftLimits(
  aircraftTypeId: number,
  updates: Partial<
    Pick<
      AircraftWeightLimits,
      | "maxTakeoffWeight"
      | "maxLandingWeight"
      | "maxZeroFuelWeight"
      | "operatingEmptyWeight"
      | "maxPayload"
      | "maxFuelCapacity"
      | "maxPassengers"
      | "standardMaleWeight"
      | "standardFemaleWeight"
      | "standardChildWeight"
      | "standardInfantWeight"
      | "standardBagWeight"
    >
  >
): Promise<AircraftWeightLimits> {
  // Ensure the aircraft type exists
  const currentLimits = await getAircraftLimits(aircraftTypeId);

  const updatedLimits: AircraftWeightLimits = {
    ...currentLimits,
    ...updates,
    updatedAt: new Date(),
  };

  // Update the aircraftTypes table for weight fields that map to it
  const db = await requireDb();
  await db
    .update(aircraftTypes)
    .set({
      maxTakeoffWeight: Math.round(updatedLimits.maxTakeoffWeight / 100),
      maxLandingWeight: Math.round(updatedLimits.maxLandingWeight / 100),
      maxZeroFuelWeight: Math.round(updatedLimits.maxZeroFuelWeight / 100),
      operatingEmptyWeight: Math.round(
        updatedLimits.operatingEmptyWeight / 100
      ),
      maxPayload: Math.round(updatedLimits.maxPayload / 100),
      maxFuelCapacity: Math.round(updatedLimits.maxFuelCapacity / 100),
      totalSeats: updatedLimits.maxPassengers,
    })
    .where(eq(aircraftTypes.id, aircraftTypeId));

  weightLimitsCache.set(aircraftTypeId, updatedLimits);
  return updatedLimits;
}

// ============================================================================
// calculatePassengerWeight
// ============================================================================

/**
 * Calculate total passenger weight for a flight using IATA standard weights.
 * Queries confirmed/completed bookings and groups passengers by type and gender.
 */
export async function calculatePassengerWeight(flightId: number): Promise<{
  totalWeight: number;
  count: number;
  breakdown: {
    males: { count: number; weight: number };
    females: { count: number; weight: number };
    children: { count: number; weight: number };
    infants: { count: number; weight: number };
  };
}> {
  const db = await requireDb();

  const paxResult = await db
    .select({
      type: passengers.type,
      title: passengers.title,
      count: sql<number>`COUNT(*)`,
    })
    .from(passengers)
    .innerJoin(bookings, eq(passengers.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.flightId, flightId),
        sql`${bookings.status} IN ('confirmed', 'completed')`
      )
    )
    .groupBy(passengers.type, passengers.title);

  let males = 0;
  let females = 0;
  let children = 0;
  let infants = 0;

  for (const row of paxResult) {
    const cnt = Number(row.count);
    if (row.type === "child") {
      children += cnt;
    } else if (row.type === "infant") {
      infants += cnt;
    } else {
      // adult - determine gender by title
      const title = (row.title ?? "").toLowerCase();
      if (title === "mrs" || title === "ms" || title === "miss") {
        females += cnt;
      } else {
        males += cnt;
      }
    }
  }

  const maleWeight = males * DEFAULT_STANDARD_WEIGHTS.male;
  const femaleWeight = females * DEFAULT_STANDARD_WEIGHTS.female;
  const childWeight = children * DEFAULT_STANDARD_WEIGHTS.child;
  const infantWeight = infants * DEFAULT_STANDARD_WEIGHTS.infant;
  const totalWeight = maleWeight + femaleWeight + childWeight + infantWeight;

  return {
    totalWeight,
    count: males + females + children + infants,
    breakdown: {
      males: { count: males, weight: maleWeight },
      females: { count: females, weight: femaleWeight },
      children: { count: children, weight: childWeight },
      infants: { count: infants, weight: infantWeight },
    },
  };
}

// ============================================================================
// calculateBaggageWeight
// ============================================================================

/**
 * Calculate total baggage weight (checked + carry-on estimated) for a flight.
 */
export async function calculateBaggageWeight(flightId: number): Promise<{
  totalWeight: number;
  checkedWeight: number;
  checkedCount: number;
  estimatedCarryOnWeight: number;
  carryOnCount: number;
}> {
  const db = await requireDb();

  // Get checked baggage from baggage_items
  const [checkedResult] = await db
    .select({
      totalWeight: sql<number>`COALESCE(SUM(${baggageItems.weight}), 0)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(baggageItems)
    .innerJoin(bookings, eq(baggageItems.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.flightId, flightId),
        sql`${bookings.status} IN ('confirmed', 'completed')`
      )
    );

  const checkedWeight = Number(checkedResult?.totalWeight ?? 0);
  const checkedCount = Number(checkedResult?.count ?? 0);

  // Estimate carry-on: each passenger typically carries ~7 kg hand baggage
  // (already accounted for in standard passenger weights, but tracked separately)
  const [paxCount] = await db
    .select({
      count: sql<number>`COUNT(*)`,
    })
    .from(passengers)
    .innerJoin(bookings, eq(passengers.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.flightId, flightId),
        sql`${bookings.status} IN ('confirmed', 'completed')`,
        sql`${passengers.type} != 'infant'`
      )
    );

  const carryOnCount = Number(paxCount?.count ?? 0);
  // Carry-on weight is included in standard passenger weights per IATA,
  // so we track it as 0 additional weight to avoid double-counting
  const estimatedCarryOnWeight = 0;

  return {
    totalWeight: checkedWeight + estimatedCarryOnWeight,
    checkedWeight,
    checkedCount,
    estimatedCarryOnWeight,
    carryOnCount,
  };
}

// ============================================================================
// calculateCargoWeight
// ============================================================================

/**
 * Calculate cargo and mail weight for a flight.
 * Uses load plan cargo distribution data if available.
 */
export async function calculateCargoWeight(flightId: number): Promise<{
  totalWeight: number;
  zones: Array<{ zone: string; weight: number; maxWeight: number }>;
}> {
  const db = await requireDb();

  // Get latest load plan for this flight to extract cargo distribution
  const [plan] = await db
    .select()
    .from(loadPlans)
    .where(eq(loadPlans.flightId, flightId))
    .orderBy(desc(loadPlans.createdAt))
    .limit(1);

  if (!plan || !plan.cargoDistribution) {
    return { totalWeight: 0, zones: [] };
  }

  let distribution: Array<{ zone: string; weight: number }>;
  try {
    distribution = JSON.parse(plan.cargoDistribution);
  } catch {
    console.warn(
      `Invalid cargoDistribution JSON for flight ${flightId}, defaulting to empty`
    );
    return { totalWeight: 0, zones: [] };
  }

  // Get aircraft cargo zone limits
  const zoneMaxWeights: Record<string, number> = {};
  if (plan.aircraftTypeId) {
    const [aircraft] = await db
      .select({ cargoZones: aircraftTypes.cargoZones })
      .from(aircraftTypes)
      .where(eq(aircraftTypes.id, plan.aircraftTypeId))
      .limit(1);

    if (aircraft?.cargoZones) {
      try {
        const parsedZones: Array<{ zone: string; maxWeight: number }> =
          JSON.parse(aircraft.cargoZones);
        for (const z of parsedZones) {
          zoneMaxWeights[z.zone] = z.maxWeight;
        }
      } catch {
        console.warn(
          `Invalid cargoZones JSON for aircraft type ${plan.aircraftTypeId}`
        );
      }
    }
  }

  const zones = distribution.map(d => ({
    zone: d.zone,
    weight: d.weight,
    maxWeight: zoneMaxWeights[d.zone] ?? 0,
  }));

  const totalWeight = distribution.reduce((sum, d) => sum + d.weight, 0);

  return { totalWeight, zones };
}

// ============================================================================
// calculateFuelWeight
// ============================================================================

/**
 * Calculate fuel weight breakdown.
 * Separates fuel into taxi, trip, contingency, alternate, final reserve, and extra.
 */
export function calculateFuelWeight(
  _flightId: number,
  fuelLoad: number
): {
  totalFuelWeight: number;
  breakdown: {
    taxiFuel: number;
    tripFuel: number;
    contingency: number;
    alternateFuel: number;
    finalReserve: number;
    extraFuel: number;
  };
  fuelDensity: number;
} {
  // Standard Jet A-1 fuel density: approximately 0.8 kg/L
  const fuelDensity = 0.8;

  // ICAO fuel planning breakdown (simplified percentages)
  const taxiFuel = Math.round(fuelLoad * 0.02); // ~2% for taxi
  const contingency = Math.round(fuelLoad * 0.05); // 5% contingency (ICAO standard)
  const finalReserve = Math.round(fuelLoad * 0.04); // ~30 min holding fuel
  const alternateFuel = Math.round(fuelLoad * 0.08); // diversion fuel
  const extraFuel = Math.round(fuelLoad * 0.01); // captain's extra
  const tripFuel =
    fuelLoad -
    taxiFuel -
    contingency -
    finalReserve -
    alternateFuel -
    extraFuel;

  return {
    totalFuelWeight: fuelLoad,
    breakdown: {
      taxiFuel,
      tripFuel: Math.max(tripFuel, 0),
      contingency,
      alternateFuel,
      finalReserve,
      extraFuel,
    },
    fuelDensity,
  };
}

// ============================================================================
// calculateCenterOfGravity
// ============================================================================

/**
 * Calculate the Center of Gravity (CG) position as a percentage of
 * Mean Aerodynamic Chord (% MAC).
 *
 * Uses weighted moment arms for OEW, passengers, baggage, cargo, and fuel.
 */
export async function calculateCenterOfGravity(flightId: number): Promise<{
  cgPosition: number; // % MAC
  cgForwardLimit: number;
  cgAftLimit: number;
  isWithinEnvelope: boolean;
  moments: {
    oew: { weight: number; arm: number; moment: number };
    passengers: { weight: number; arm: number; moment: number };
    baggage: { weight: number; arm: number; moment: number };
    cargo: { weight: number; arm: number; moment: number };
    fuel: { weight: number; arm: number; moment: number };
    total: { weight: number; moment: number };
  };
}> {
  const db = await requireDb();

  // Get load plan to extract weights
  const [plan] = await db
    .select()
    .from(loadPlans)
    .where(eq(loadPlans.flightId, flightId))
    .orderBy(desc(loadPlans.createdAt))
    .limit(1);

  // Get aircraft type limits
  let forwardCg = 15.0;
  let aftCg = 35.0;
  let oew = 0;

  if (plan?.aircraftTypeId) {
    const [aircraft] = await db
      .select()
      .from(aircraftTypes)
      .where(eq(aircraftTypes.id, plan.aircraftTypeId))
      .limit(1);

    if (aircraft) {
      forwardCg = parseFloat(aircraft.forwardCgLimit ?? "15");
      aftCg = parseFloat(aircraft.aftCgLimit ?? "35");
      oew = aircraft.operatingEmptyWeight;
    }
  }

  const passengerWeight = plan?.passengerWeight ?? 0;
  const baggageWeight = plan?.baggageWeight ?? 0;
  const cargoWeight = plan?.totalCargoWeight ?? 0;
  const fuelWeight = plan?.fuelWeight ?? 0;

  // Standard moment arm positions (% MAC reference)
  // These are simplified reference positions. Real implementations
  // would use aircraft-specific datum references.
  const oewArm = 25.0; // OEW CG typically near 25% MAC
  const passengerArm = 27.0; // Average passenger CG position
  const baggageArm = 20.0; // Forward cargo hold
  const cargoArm = 32.0; // Aft cargo hold
  const fuelArm = 26.0; // Wing fuel tanks near 26% MAC

  // Calculate moments
  const oewMoment = oew * oewArm;
  const passengerMoment = passengerWeight * passengerArm;
  const baggageMoment = baggageWeight * baggageArm;
  const cargoMoment = cargoWeight * cargoArm;
  const fuelMoment = fuelWeight * fuelArm;

  const totalWeight =
    oew + passengerWeight + baggageWeight + cargoWeight + fuelWeight;
  const totalMoment =
    oewMoment + passengerMoment + baggageMoment + cargoMoment + fuelMoment;

  const cgPosition = totalWeight > 0 ? totalMoment / totalWeight : 0;
  const isWithinEnvelope = cgPosition >= forwardCg && cgPosition <= aftCg;

  return {
    cgPosition: parseFloat(cgPosition.toFixed(2)),
    cgForwardLimit: forwardCg,
    cgAftLimit: aftCg,
    isWithinEnvelope,
    moments: {
      oew: {
        weight: oew,
        arm: oewArm,
        moment: parseFloat(oewMoment.toFixed(2)),
      },
      passengers: {
        weight: passengerWeight,
        arm: passengerArm,
        moment: parseFloat(passengerMoment.toFixed(2)),
      },
      baggage: {
        weight: baggageWeight,
        arm: baggageArm,
        moment: parseFloat(baggageMoment.toFixed(2)),
      },
      cargo: {
        weight: cargoWeight,
        arm: cargoArm,
        moment: parseFloat(cargoMoment.toFixed(2)),
      },
      fuel: {
        weight: fuelWeight,
        arm: fuelArm,
        moment: parseFloat(fuelMoment.toFixed(2)),
      },
      total: {
        weight: totalWeight,
        moment: parseFloat(totalMoment.toFixed(2)),
      },
    },
  };
}

// ============================================================================
// checkWeightLimits
// ============================================================================

/**
 * Verify all weight limits for a flight.
 * Checks MTOW, MLW, MZFW, max payload, max fuel, and CG envelope.
 */
export async function checkWeightLimits(flightId: number): Promise<{
  isWithinAllLimits: boolean;
  checks: Array<{
    name: string;
    actual: number;
    limit: number;
    unit: string;
    passed: boolean;
    margin: number; // kg remaining
  }>;
  warnings: string[];
  errors: string[];
}> {
  const db = await requireDb();

  const [plan] = await db
    .select()
    .from(loadPlans)
    .where(eq(loadPlans.flightId, flightId))
    .orderBy(desc(loadPlans.createdAt))
    .limit(1);

  if (!plan) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `No load plan found for flight ${flightId}. Calculate weight & balance first.`,
    });
  }

  const [aircraft] = await db
    .select()
    .from(aircraftTypes)
    .where(eq(aircraftTypes.id, plan.aircraftTypeId))
    .limit(1);

  if (!aircraft) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Aircraft type ${plan.aircraftTypeId} not found`,
    });
  }

  const checks: Array<{
    name: string;
    actual: number;
    limit: number;
    unit: string;
    passed: boolean;
    margin: number;
  }> = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  // Check Max Takeoff Weight
  const mtowCheck = {
    name: "Max Takeoff Weight (MTOW)",
    actual: plan.takeoffWeight,
    limit: aircraft.maxTakeoffWeight,
    unit: "kg",
    passed: plan.takeoffWeight <= aircraft.maxTakeoffWeight,
    margin: aircraft.maxTakeoffWeight - plan.takeoffWeight,
  };
  checks.push(mtowCheck);
  if (!mtowCheck.passed) {
    errors.push(
      `Takeoff weight (${plan.takeoffWeight.toLocaleString()} kg) exceeds MTOW (${aircraft.maxTakeoffWeight.toLocaleString()} kg) by ${Math.abs(mtowCheck.margin).toLocaleString()} kg`
    );
  } else if (mtowCheck.margin < aircraft.maxTakeoffWeight * 0.02) {
    warnings.push(
      `Takeoff weight within 2% of MTOW limit (${mtowCheck.margin.toLocaleString()} kg margin)`
    );
  }

  // Check Max Landing Weight
  const mlwCheck = {
    name: "Max Landing Weight (MLW)",
    actual: plan.landingWeight,
    limit: aircraft.maxLandingWeight,
    unit: "kg",
    passed: plan.landingWeight <= aircraft.maxLandingWeight,
    margin: aircraft.maxLandingWeight - plan.landingWeight,
  };
  checks.push(mlwCheck);
  if (!mlwCheck.passed) {
    errors.push(
      `Landing weight (${plan.landingWeight.toLocaleString()} kg) exceeds MLW (${aircraft.maxLandingWeight.toLocaleString()} kg) by ${Math.abs(mlwCheck.margin).toLocaleString()} kg`
    );
  }

  // Check Max Zero Fuel Weight
  const mzfwCheck = {
    name: "Max Zero Fuel Weight (MZFW)",
    actual: plan.zeroFuelWeight,
    limit: aircraft.maxZeroFuelWeight,
    unit: "kg",
    passed: plan.zeroFuelWeight <= aircraft.maxZeroFuelWeight,
    margin: aircraft.maxZeroFuelWeight - plan.zeroFuelWeight,
  };
  checks.push(mzfwCheck);
  if (!mzfwCheck.passed) {
    errors.push(
      `Zero fuel weight (${plan.zeroFuelWeight.toLocaleString()} kg) exceeds MZFW (${aircraft.maxZeroFuelWeight.toLocaleString()} kg) by ${Math.abs(mzfwCheck.margin).toLocaleString()} kg`
    );
  }

  // Check Max Payload
  const payloadWeight =
    plan.passengerWeight + plan.baggageWeight + plan.totalCargoWeight;
  const payloadCheck = {
    name: "Max Payload",
    actual: payloadWeight,
    limit: aircraft.maxPayload,
    unit: "kg",
    passed: payloadWeight <= aircraft.maxPayload,
    margin: aircraft.maxPayload - payloadWeight,
  };
  checks.push(payloadCheck);
  if (!payloadCheck.passed) {
    errors.push(
      `Payload (${payloadWeight.toLocaleString()} kg) exceeds max payload (${aircraft.maxPayload.toLocaleString()} kg) by ${Math.abs(payloadCheck.margin).toLocaleString()} kg`
    );
  }

  // Check Max Fuel
  const fuelCheck = {
    name: "Max Fuel Capacity",
    actual: plan.fuelWeight,
    limit: aircraft.maxFuelCapacity,
    unit: "kg",
    passed: plan.fuelWeight <= aircraft.maxFuelCapacity,
    margin: aircraft.maxFuelCapacity - plan.fuelWeight,
  };
  checks.push(fuelCheck);
  if (!fuelCheck.passed) {
    errors.push(
      `Fuel load (${plan.fuelWeight.toLocaleString()} kg) exceeds max capacity (${aircraft.maxFuelCapacity.toLocaleString()} kg) by ${Math.abs(fuelCheck.margin).toLocaleString()} kg`
    );
  }

  // Check CG envelope
  const forwardCg = parseFloat(aircraft.forwardCgLimit ?? "15");
  const aftCg = parseFloat(aircraft.aftCgLimit ?? "35");
  const cgPos = parseFloat(plan.cgPosition ?? "25");

  const cgCheck = {
    name: "CG Envelope",
    actual: cgPos,
    limit: aftCg, // Nominal limit reference
    unit: "% MAC",
    passed: cgPos >= forwardCg && cgPos <= aftCg,
    margin: Math.min(cgPos - forwardCg, aftCg - cgPos),
  };
  checks.push(cgCheck);
  if (!cgCheck.passed) {
    errors.push(
      `CG position (${cgPos.toFixed(2)}% MAC) is outside envelope (${forwardCg}-${aftCg}% MAC)`
    );
  }

  // Check cargo zone limits
  if (plan.cargoDistribution && aircraft.cargoZones) {
    try {
      const cargoZones: Array<{ zone: string; weight: number }> = JSON.parse(
        plan.cargoDistribution
      );
      const zoneConfig: Array<{ zone: string; maxWeight: number }> = JSON.parse(
        aircraft.cargoZones
      );

      for (const cargo of cargoZones) {
        const config = zoneConfig.find(z => z.zone === cargo.zone);
        if (config && cargo.weight > config.maxWeight) {
          errors.push(
            `Cargo zone ${cargo.zone}: ${cargo.weight.toLocaleString()} kg exceeds max ${config.maxWeight.toLocaleString()} kg`
          );
        }
      }
    } catch {
      warnings.push(
        "Could not parse cargo distribution or zone configuration data"
      );
    }
  }

  const isWithinAllLimits = checks.every(c => c.passed) && errors.length === 0;

  return { isWithinAllLimits, checks, warnings, errors };
}

// ============================================================================
// calculateTrimSettings
// ============================================================================

/**
 * Calculate stabilizer trim settings based on CG position and aircraft load.
 *
 * The trim setting is the horizontal stabilizer position required for
 * takeoff, expressed in units of nose-up trim.
 */
export async function calculateTrimSettings(flightId: number): Promise<{
  trimSetting: number; // degrees
  trimUnit: string;
  stabilizerPosition: number; // units
  flapsConfig: string;
  cgPosition: number;
  macPercent: number;
  notes: string[];
}> {
  const cg = await calculateCenterOfGravity(flightId);

  // Simplified trim calculation based on CG position
  // Real aircraft have specific trim tables based on CG and flap setting
  // For a typical narrow-body: trim range is approximately 0.5 to 8.0 units

  const cgMid = (cg.cgForwardLimit + cg.cgAftLimit) / 2;
  const cgRange = cg.cgAftLimit - cg.cgForwardLimit;
  const cgDeviation = cg.cgPosition - cgMid;
  const normalizedDeviation = cgRange > 0 ? cgDeviation / (cgRange / 2) : 0;

  // Trim setting: forward CG = more nose-up trim, aft CG = less
  // Baseline: 4.0 units at mid CG
  const baseTrim = 4.0;
  const trimRange = 3.5;
  const trimSetting = parseFloat(
    (baseTrim - normalizedDeviation * trimRange).toFixed(1)
  );

  // Determine flaps configuration based on weight
  const db = await requireDb();
  const [plan] = await db
    .select()
    .from(loadPlans)
    .where(eq(loadPlans.flightId, flightId))
    .orderBy(desc(loadPlans.createdAt))
    .limit(1);

  let flapsConfig = "5";
  const notes: string[] = [];

  if (plan) {
    const [aircraft] = await db
      .select()
      .from(aircraftTypes)
      .where(eq(aircraftTypes.id, plan.aircraftTypeId))
      .limit(1);

    if (aircraft) {
      const weightRatio = plan.takeoffWeight / aircraft.maxTakeoffWeight;
      if (weightRatio > 0.9) {
        flapsConfig = "5";
        notes.push("Heavy takeoff: Flaps 5 recommended");
      } else if (weightRatio > 0.75) {
        flapsConfig = "5";
        notes.push("Normal takeoff: Flaps 5");
      } else {
        flapsConfig = "1";
        notes.push("Light takeoff: Flaps 1 acceptable");
      }
    }
  }

  // Stabilizer position (in stabilizer units, typically 0-17 for Boeing)
  const stabilizerPosition = parseFloat((trimSetting + 0.5).toFixed(1));

  if (!cg.isWithinEnvelope) {
    notes.push("WARNING: CG outside acceptable envelope - verify trim");
  }

  if (trimSetting < 1.0 || trimSetting > 7.5) {
    notes.push("WARNING: Trim setting at extreme range - check calculations");
  }

  return {
    trimSetting,
    trimUnit: "units",
    stabilizerPosition,
    flapsConfig: `Flaps ${flapsConfig}`,
    cgPosition: cg.cgPosition,
    macPercent: cg.cgPosition,
    notes,
  };
}

// ============================================================================
// calculateFlightWeightBalance
// ============================================================================

/**
 * Full Weight & Balance calculation for a flight.
 * This is the primary function that orchestrates all sub-calculations
 * and persists the result as a load plan record.
 */
export async function calculateFlightWeightBalance(
  flightId: number,
  input: {
    aircraftTypeId: number;
    fuelWeight: number;
    cargoDistribution?: Array<{ zone: string; weight: number }>;
    calculatedBy: number;
    status?: "preliminary" | "final" | "amended";
  }
): Promise<FlightWeightBalance & { details: ReturnType<typeof buildDetails> }> {
  const db = await requireDb();

  // Validate flight exists
  await getFlightWithAircraft(flightId);

  // Get aircraft limits
  const [aircraft] = await db
    .select()
    .from(aircraftTypes)
    .where(eq(aircraftTypes.id, input.aircraftTypeId))
    .limit(1);

  if (!aircraft) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Aircraft type ${input.aircraftTypeId} not found`,
    });
  }

  // Calculate passenger weight
  const paxWeight = await calculatePassengerWeight(flightId);

  // Calculate baggage weight
  const bagWeight = await calculateBaggageWeight(flightId);

  // Calculate cargo weight from input distribution
  const cargoDistribution = input.cargoDistribution ?? [];
  const totalCargoWeight = cargoDistribution.reduce(
    (sum, c) => sum + c.weight,
    0
  );

  // Calculate fuel weight
  const fuelData = await calculateFuelWeight(flightId, input.fuelWeight);

  // Weight calculations
  const oew = aircraft.operatingEmptyWeight;
  const passengerWeight = paxWeight.totalWeight;
  const baggageWeight = bagWeight.totalWeight;
  const cargoWeight = totalCargoWeight;
  const fuelWeight = input.fuelWeight;
  const payloadWeight = passengerWeight + baggageWeight + cargoWeight;
  const zeroFuelWeight = oew + payloadWeight;
  const takeoffWeight = zeroFuelWeight + fuelWeight;

  // Estimate landing weight (consume ~80% of trip fuel)
  const estimatedFuelBurn = Math.round(fuelData.breakdown.tripFuel * 0.95);
  const landingWeight = takeoffWeight - estimatedFuelBurn;

  // CG calculation
  const forwardCg = parseFloat(aircraft.forwardCgLimit ?? "15");
  const aftCg = parseFloat(aircraft.aftCgLimit ?? "35");

  // Weighted moment arm CG calculation
  const oewArm = 25.0;
  const passengerArm = 27.0;
  const baggageArm = 20.0;
  const cargoArm = 32.0;
  const fuelArm = 26.0;

  const totalMoment =
    oew * oewArm +
    passengerWeight * passengerArm +
    baggageWeight * baggageArm +
    cargoWeight * cargoArm +
    fuelWeight * fuelArm;

  const totalWeight = oew + payloadWeight + fuelWeight;
  const cgPosition = totalWeight > 0 ? totalMoment / totalWeight : 0;
  const isWithinCg = cgPosition >= forwardCg && cgPosition <= aftCg;

  // Weight limit checks
  const isWithinMTOW = takeoffWeight <= aircraft.maxTakeoffWeight;
  const isWithinMLW = landingWeight <= aircraft.maxLandingWeight;
  const isWithinMZFW = zeroFuelWeight <= aircraft.maxZeroFuelWeight;
  const isWithinPayload = payloadWeight <= aircraft.maxPayload;
  const isWithinFuel = fuelWeight <= aircraft.maxFuelCapacity;

  const isWithinLimits =
    isWithinMTOW &&
    isWithinMLW &&
    isWithinMZFW &&
    isWithinPayload &&
    isWithinFuel &&
    isWithinCg;

  // Trim calculation
  const cgMid = (forwardCg + aftCg) / 2;
  const cgRange = aftCg - forwardCg;
  const cgDeviation = cgPosition - cgMid;
  const normalizedDeviation = cgRange > 0 ? cgDeviation / (cgRange / 2) : 0;
  const trimSetting = parseFloat((4.0 - normalizedDeviation * 3.5).toFixed(1));

  // Persist as load plan
  const [result] = await db.insert(loadPlans).values({
    flightId,
    aircraftTypeId: input.aircraftTypeId,
    passengerCount: paxWeight.count,
    passengerWeight,
    baggageCount: bagWeight.checkedCount,
    baggageWeight,
    cargoDistribution:
      cargoDistribution.length > 0 ? JSON.stringify(cargoDistribution) : null,
    totalCargoWeight: cargoWeight,
    fuelWeight,
    zeroFuelWeight,
    takeoffWeight,
    landingWeight,
    cgPosition: cgPosition.toFixed(2),
    status: "calculated",
    withinLimits: isWithinLimits,
    warnings: buildWarnings({
      takeoffWeight,
      landingWeight,
      zeroFuelWeight,
      payloadWeight,
      fuelWeight,
      cgPosition,
      aircraft,
      forwardCg,
      aftCg,
    }),
  });

  const calculatedAt = new Date();

  const wb: FlightWeightBalance = {
    id: Number(result.insertId),
    flightId,
    aircraftTypeId: input.aircraftTypeId,
    operatingEmptyWeight: oew,
    passengerWeight,
    baggageWeight,
    cargoWeight,
    fuelWeight,
    totalWeight: takeoffWeight,
    maxTakeoffWeight: aircraft.maxTakeoffWeight,
    cgPosition: parseFloat(cgPosition.toFixed(2)),
    cgForwardLimit: forwardCg,
    cgAftLimit: aftCg,
    isWithinLimits,
    trimSetting,
    status: input.status ?? "preliminary",
    calculatedBy: input.calculatedBy,
    calculatedAt,
    createdAt: calculatedAt,
    updatedAt: calculatedAt,
  };

  const details = buildDetails({
    aircraft,
    paxWeight,
    bagWeight,
    cargoDistribution,
    totalCargoWeight: cargoWeight,
    fuelData,
    oew,
    zeroFuelWeight,
    takeoffWeight,
    landingWeight,
    cgPosition: parseFloat(cgPosition.toFixed(2)),
    forwardCg,
    aftCg,
    trimSetting,
    isWithinLimits,
  });

  return { ...wb, details };
}

// ============================================================================
// Build helpers
// ============================================================================

function buildWarnings(data: {
  takeoffWeight: number;
  landingWeight: number;
  zeroFuelWeight: number;
  payloadWeight: number;
  fuelWeight: number;
  cgPosition: number;
  aircraft: {
    maxTakeoffWeight: number;
    maxLandingWeight: number;
    maxZeroFuelWeight: number;
    maxPayload: number;
    maxFuelCapacity: number;
  };
  forwardCg: number;
  aftCg: number;
}): string | null {
  const warnings: string[] = [];

  if (data.takeoffWeight > data.aircraft.maxTakeoffWeight) {
    warnings.push(
      `TOW ${data.takeoffWeight.toLocaleString()} kg > MTOW ${data.aircraft.maxTakeoffWeight.toLocaleString()} kg`
    );
  }
  if (data.landingWeight > data.aircraft.maxLandingWeight) {
    warnings.push(
      `LW ${data.landingWeight.toLocaleString()} kg > MLW ${data.aircraft.maxLandingWeight.toLocaleString()} kg`
    );
  }
  if (data.zeroFuelWeight > data.aircraft.maxZeroFuelWeight) {
    warnings.push(
      `ZFW ${data.zeroFuelWeight.toLocaleString()} kg > MZFW ${data.aircraft.maxZeroFuelWeight.toLocaleString()} kg`
    );
  }
  if (data.payloadWeight > data.aircraft.maxPayload) {
    warnings.push(
      `Payload ${data.payloadWeight.toLocaleString()} kg > Max ${data.aircraft.maxPayload.toLocaleString()} kg`
    );
  }
  if (data.fuelWeight > data.aircraft.maxFuelCapacity) {
    warnings.push(
      `Fuel ${data.fuelWeight.toLocaleString()} kg > Max ${data.aircraft.maxFuelCapacity.toLocaleString()} kg`
    );
  }
  if (data.cgPosition < data.forwardCg || data.cgPosition > data.aftCg) {
    warnings.push(
      `CG ${data.cgPosition.toFixed(2)}% MAC outside ${data.forwardCg}-${data.aftCg}% MAC`
    );
  }

  return warnings.length > 0 ? JSON.stringify(warnings) : null;
}

function buildDetails(data: {
  aircraft: {
    code: string;
    name: string;
    maxTakeoffWeight: number;
    maxLandingWeight: number;
    maxZeroFuelWeight: number;
    operatingEmptyWeight: number;
    maxPayload: number;
    maxFuelCapacity: number;
  };
  paxWeight: Awaited<ReturnType<typeof calculatePassengerWeight>>;
  bagWeight: Awaited<ReturnType<typeof calculateBaggageWeight>>;
  cargoDistribution: Array<{ zone: string; weight: number }>;
  totalCargoWeight: number;
  fuelData: Awaited<ReturnType<typeof calculateFuelWeight>>;
  oew: number;
  zeroFuelWeight: number;
  takeoffWeight: number;
  landingWeight: number;
  cgPosition: number;
  forwardCg: number;
  aftCg: number;
  trimSetting: number;
  isWithinLimits: boolean;
}) {
  return {
    aircraft: {
      code: data.aircraft.code,
      name: data.aircraft.name,
      limits: {
        mtow: data.aircraft.maxTakeoffWeight,
        mlw: data.aircraft.maxLandingWeight,
        mzfw: data.aircraft.maxZeroFuelWeight,
        oew: data.aircraft.operatingEmptyWeight,
        maxPayload: data.aircraft.maxPayload,
        maxFuel: data.aircraft.maxFuelCapacity,
      },
    },
    weights: {
      operatingEmpty: data.oew,
      passengers: {
        count: data.paxWeight.count,
        weight: data.paxWeight.totalWeight,
        breakdown: data.paxWeight.breakdown,
      },
      baggage: {
        checkedCount: data.bagWeight.checkedCount,
        checkedWeight: data.bagWeight.checkedWeight,
        carryOnCount: data.bagWeight.carryOnCount,
        totalWeight: data.bagWeight.totalWeight,
      },
      cargo: {
        zones: data.cargoDistribution,
        totalWeight: data.totalCargoWeight,
      },
      fuel: data.fuelData,
      zeroFuel: data.zeroFuelWeight,
      takeoff: data.takeoffWeight,
      landing: data.landingWeight,
    },
    balance: {
      cgPosition: data.cgPosition,
      forwardLimit: data.forwardCg,
      aftLimit: data.aftCg,
      trimSetting: data.trimSetting,
    },
    isWithinLimits: data.isWithinLimits,
  };
}

// ============================================================================
// generateLoadSheet
// ============================================================================

/**
 * Generate an IATA-standard load sheet for a flight.
 *
 * The load sheet includes all required data per IATA AHM 515:
 * - Flight identification
 * - Passenger counts by category
 * - Weight summary (OEW, payload, fuel, TOW, LW)
 * - CG position and trim setting
 * - Cargo distribution
 * - Limit checks
 */
export async function generateLoadSheet(flightId: number): Promise<{
  loadSheetNumber: string;
  edition: string;
  generatedAt: string;
  flight: {
    id: number;
    flightNumber: string;
    date: string;
    origin: string;
    destination: string;
    aircraftType: string;
    registration: string;
  };
  crew: {
    cockpit: number;
    cabin: number;
    total: number;
  };
  passengers: {
    males: number;
    females: number;
    children: number;
    infants: number;
    totalExcludingInfants: number;
    total: number;
  };
  weights: {
    operatingEmptyWeight: number;
    passengerWeight: number;
    baggageWeight: number;
    cargoMailWeight: number;
    totalTrafficLoad: number;
    dryOperatingWeight: number;
    zeroFuelWeightActual: number;
    zeroFuelWeightMax: number;
    takeoffFuel: number;
    takeoffWeightActual: number;
    takeoffWeightMax: number;
    tripFuel: number;
    landingWeightActual: number;
    landingWeightMax: number;
  };
  balance: {
    cgPercent: number;
    cgForwardLimit: number;
    cgAftLimit: number;
    trimSetting: number;
    stabilizerSetting: number;
  };
  cargoByZone: Array<{ zone: string; weight: number; maxWeight: number }>;
  limitations: {
    isWithinAllLimits: boolean;
    items: string[];
  };
  remarks: string[];
}> {
  const db = await requireDb();

  // Get flight details
  const flight = await getFlightWithAircraft(flightId);

  // Get airline info
  const [airline] = await db
    .select({ code: airlines.code })
    .from(airlines)
    .where(eq(airlines.id, flight.airlineId))
    .limit(1);

  // Get origin/destination airports
  const [origin] = await db
    .select({ code: airports.code })
    .from(airports)
    .where(eq(airports.id, flight.originId))
    .limit(1);

  const [destination] = await db
    .select({ code: airports.code })
    .from(airports)
    .where(eq(airports.id, flight.destinationId))
    .limit(1);

  // Get latest load plan
  const [plan] = await db
    .select()
    .from(loadPlans)
    .where(eq(loadPlans.flightId, flightId))
    .orderBy(desc(loadPlans.createdAt))
    .limit(1);

  if (!plan) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `No load plan found for flight ${flightId}. Calculate weight & balance first.`,
    });
  }

  // Get aircraft type
  const [aircraft] = await db
    .select()
    .from(aircraftTypes)
    .where(eq(aircraftTypes.id, plan.aircraftTypeId))
    .limit(1);

  if (!aircraft) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Aircraft type ${plan.aircraftTypeId} not found`,
    });
  }

  // Calculate passenger breakdown
  const paxWeight = await calculatePassengerWeight(flightId);

  // Get cargo distribution
  let cargoDistribution: Array<{ zone: string; weight: number }> = [];
  if (plan.cargoDistribution) {
    try {
      cargoDistribution = JSON.parse(plan.cargoDistribution);
    } catch {
      console.warn(
        `Invalid cargoDistribution JSON in load plan for flight ${flightId}`
      );
    }
  }

  // Get cargo zone limits
  let zoneConfigs: Array<{ zone: string; maxWeight: number }> = [];
  if (aircraft.cargoZones) {
    try {
      zoneConfigs = JSON.parse(aircraft.cargoZones);
    } catch {
      console.warn(
        `Invalid cargoZones JSON for aircraft type ${plan.aircraftTypeId}`
      );
    }
  }

  const cargoByZone = cargoDistribution.map(c => ({
    zone: c.zone,
    weight: c.weight,
    maxWeight: zoneConfigs.find(z => z.zone === c.zone)?.maxWeight ?? 0,
  }));

  // CG and trim
  const forwardCg = parseFloat(aircraft.forwardCgLimit ?? "15");
  const aftCg = parseFloat(aircraft.aftCgLimit ?? "35");
  const cgPos = parseFloat(plan.cgPosition ?? "25");

  const cgMid = (forwardCg + aftCg) / 2;
  const cgRange = aftCg - forwardCg;
  const cgDeviation = cgPos - cgMid;
  const normalizedDeviation = cgRange > 0 ? cgDeviation / (cgRange / 2) : 0;
  const trimSetting = parseFloat((4.0 - normalizedDeviation * 3.5).toFixed(1));

  // Trip fuel estimate
  const tripFuel = Math.round(plan.fuelWeight * 0.8);
  const totalTrafficLoad =
    plan.passengerWeight + plan.baggageWeight + plan.totalCargoWeight;

  // Limitations
  const limitations: string[] = [];
  if (plan.takeoffWeight > aircraft.maxTakeoffWeight) {
    limitations.push(
      `TOW exceeds MTOW by ${(plan.takeoffWeight - aircraft.maxTakeoffWeight).toLocaleString()} kg`
    );
  }
  if (plan.landingWeight > aircraft.maxLandingWeight) {
    limitations.push(
      `LW exceeds MLW by ${(plan.landingWeight - aircraft.maxLandingWeight).toLocaleString()} kg`
    );
  }
  if (plan.zeroFuelWeight > aircraft.maxZeroFuelWeight) {
    limitations.push(
      `ZFW exceeds MZFW by ${(plan.zeroFuelWeight - aircraft.maxZeroFuelWeight).toLocaleString()} kg`
    );
  }
  if (cgPos < forwardCg || cgPos > aftCg) {
    limitations.push(
      `CG ${cgPos.toFixed(2)}% MAC outside limits ${forwardCg}-${aftCg}%`
    );
  }

  // Remarks
  const remarks: string[] = [];
  const weightRatio = plan.takeoffWeight / aircraft.maxTakeoffWeight;
  if (weightRatio > 0.95) {
    remarks.push("Heavy takeoff - performance check required");
  }
  if (!plan.withinLimits) {
    remarks.push("LOAD SHEET INVALID - Weight/balance limits exceeded");
  }

  const loadSheetNumber = `LS-${flightId}-${Date.now().toString(36).toUpperCase()}`;

  return {
    loadSheetNumber,
    edition: plan.withinLimits ? "FINAL" : "DRAFT",
    generatedAt: new Date().toISOString(),
    flight: {
      id: flight.id,
      flightNumber: `${airline?.code ?? "XX"}${flight.flightNumber}`,
      date: flight.departureTime
        ? new Date(flight.departureTime).toISOString().split("T")[0]
        : "",
      origin: origin?.code ?? "???",
      destination: destination?.code ?? "???",
      aircraftType: aircraft.code,
      registration: `HZ-${aircraft.code}-${flightId}`, // Placeholder registration
    },
    crew: {
      cockpit: 2,
      cabin: Math.max(2, Math.floor(aircraft.totalSeats / 50)),
      total: 2 + Math.max(2, Math.floor(aircraft.totalSeats / 50)),
    },
    passengers: {
      males: paxWeight.breakdown.males.count,
      females: paxWeight.breakdown.females.count,
      children: paxWeight.breakdown.children.count,
      infants: paxWeight.breakdown.infants.count,
      totalExcludingInfants:
        paxWeight.count - paxWeight.breakdown.infants.count,
      total: paxWeight.count,
    },
    weights: {
      operatingEmptyWeight: aircraft.operatingEmptyWeight,
      passengerWeight: plan.passengerWeight,
      baggageWeight: plan.baggageWeight,
      cargoMailWeight: plan.totalCargoWeight,
      totalTrafficLoad,
      dryOperatingWeight: aircraft.operatingEmptyWeight,
      zeroFuelWeightActual: plan.zeroFuelWeight,
      zeroFuelWeightMax: aircraft.maxZeroFuelWeight,
      takeoffFuel: plan.fuelWeight,
      takeoffWeightActual: plan.takeoffWeight,
      takeoffWeightMax: aircraft.maxTakeoffWeight,
      tripFuel,
      landingWeightActual: plan.landingWeight,
      landingWeightMax: aircraft.maxLandingWeight,
    },
    balance: {
      cgPercent: cgPos,
      cgForwardLimit: forwardCg,
      cgAftLimit: aftCg,
      trimSetting,
      stabilizerSetting: parseFloat((trimSetting + 0.5).toFixed(1)),
    },
    cargoByZone,
    limitations: {
      isWithinAllLimits: plan.withinLimits,
      items: limitations,
    },
    remarks,
  };
}

// ============================================================================
// getWeightHistory
// ============================================================================

/**
 * Track weight changes over time for a flight.
 * Returns all load plan calculations ordered by creation time.
 */
export async function getWeightHistory(flightId: number): Promise<
  Array<{
    id: number;
    status: string;
    passengerCount: number;
    passengerWeight: number;
    baggageWeight: number;
    cargoWeight: number;
    fuelWeight: number;
    zeroFuelWeight: number;
    takeoffWeight: number;
    landingWeight: number;
    cgPosition: string | null;
    withinLimits: boolean;
    warnings: string[];
    createdAt: Date;
  }>
> {
  const db = await requireDb();

  const history = await db
    .select()
    .from(loadPlans)
    .where(eq(loadPlans.flightId, flightId))
    .orderBy(desc(loadPlans.createdAt));

  return history.map(plan => ({
    id: plan.id,
    status: plan.status,
    passengerCount: plan.passengerCount,
    passengerWeight: plan.passengerWeight,
    baggageWeight: plan.baggageWeight,
    cargoWeight: plan.totalCargoWeight,
    fuelWeight: plan.fuelWeight,
    zeroFuelWeight: plan.zeroFuelWeight,
    takeoffWeight: plan.takeoffWeight,
    landingWeight: plan.landingWeight,
    cgPosition: plan.cgPosition,
    withinLimits: plan.withinLimits,
    warnings: parseJsonSafe<string[]>(plan.warnings, []),
    createdAt: plan.createdAt,
  }));
}

// ============================================================================
// getFlightWeightBalance
// ============================================================================

/**
 * Get the current weight & balance data for a flight.
 * Returns the latest load plan with full detail breakdown.
 */
export async function getFlightWeightBalance(
  flightId: number
): Promise<FlightWeightBalance | null> {
  const db = await requireDb();

  const [plan] = await db
    .select()
    .from(loadPlans)
    .where(eq(loadPlans.flightId, flightId))
    .orderBy(desc(loadPlans.createdAt))
    .limit(1);

  if (!plan) return null;

  const [aircraft] = await db
    .select()
    .from(aircraftTypes)
    .where(eq(aircraftTypes.id, plan.aircraftTypeId))
    .limit(1);

  const forwardCg = parseFloat(aircraft?.forwardCgLimit ?? "15");
  const aftCg = parseFloat(aircraft?.aftCgLimit ?? "35");
  const cgPos = parseFloat(plan.cgPosition ?? "25");
  const cgMid = (forwardCg + aftCg) / 2;
  const cgRange = aftCg - forwardCg;
  const cgDeviation = cgPos - cgMid;
  const normalizedDeviation = cgRange > 0 ? cgDeviation / (cgRange / 2) : 0;
  const trimSetting = parseFloat((4.0 - normalizedDeviation * 3.5).toFixed(1));

  return {
    id: plan.id,
    flightId: plan.flightId,
    aircraftTypeId: plan.aircraftTypeId,
    operatingEmptyWeight: aircraft?.operatingEmptyWeight ?? 0,
    passengerWeight: plan.passengerWeight,
    baggageWeight: plan.baggageWeight,
    cargoWeight: plan.totalCargoWeight,
    fuelWeight: plan.fuelWeight,
    totalWeight: plan.takeoffWeight,
    maxTakeoffWeight: aircraft?.maxTakeoffWeight ?? 0,
    cgPosition: cgPos,
    cgForwardLimit: forwardCg,
    cgAftLimit: aftCg,
    isWithinLimits: plan.withinLimits,
    trimSetting,
    status: plan.status as "preliminary" | "final" | "amended",
    calculatedBy: plan.approvedBy ?? 0,
    calculatedAt: plan.createdAt,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
}
