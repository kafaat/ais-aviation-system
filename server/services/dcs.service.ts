import { manifestBaggageFlightCondition } from "./baggage-sector-scope";
import { assertFlightBaggageReconciled } from "./baggage-reconciliation.service";
import type { SettlementTx } from "./booking-settlement.service";
import { lockSimulatedLoadPlanFlight } from "./load-sheet-lifecycle.service";
import { manifestBookingCondition } from "./flight-state.service";
import { assignCrewWithRules } from "./crew-rule.service";
/**
 * Departure Control System (DCS) Service
 *
 * Handles flight manifest generation, weight & balance calculations,
 * load planning, and crew management.
 */

import {
  demoCapabilitiesEnabled,
  requireDemoCapability,
} from "./demo-capability";
import { getDb } from "../db";
import {
  flights,
  bookings,
  passengers,
  airlines,
  airports,
  aircraftTypes,
  crewMembers,
  crewAssignments,
  loadPlans,
  baggageItems,
  dcsPassengerStates,
} from "../../drizzle/schema";
import { eq, and, notExists, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

// ============================================================================
// Illustrative passenger weights for the development-only W&B simulation.
// ============================================================================
const STANDARD_WEIGHTS = {
  adult: 84, // kg (including hand baggage)
  child: 35, // kg
  infant: 10, // kg
  checkedBagPerPiece: 20, // kg average
};

// ============================================================================
// Aircraft Type Management
// ============================================================================

export async function getAircraftTypes() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  return await db
    .select()
    .from(aircraftTypes)
    .where(eq(aircraftTypes.active, true));
}

export async function getAircraftTypeById(id: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const [aircraft] = await db
    .select()
    .from(aircraftTypes)
    .where(eq(aircraftTypes.id, id))
    .limit(1);

  return aircraft ?? null;
}

export async function createAircraftType(data: {
  code: string;
  name: string;
  manufacturer: string;
  maxTakeoffWeight: number;
  maxLandingWeight: number;
  maxZeroFuelWeight: number;
  operatingEmptyWeight: number;
  maxPayload: number;
  maxFuelCapacity: number;
  totalSeats: number;
  economySeats: number;
  businessSeats: number;
  cargoZones?: Array<{ zone: string; maxWeight: number }>;
  forwardCgLimit?: string;
  aftCgLimit?: string;
}) {
  // Validate that totalSeats can accommodate economy + business seats
  if (data.totalSeats < data.economySeats + data.businessSeats) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Total seats (${data.totalSeats}) must be greater than or equal to the sum of economy seats (${data.economySeats}) and business seats (${data.businessSeats})`,
    });
  }

  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const [result] = await db.insert(aircraftTypes).values({
    ...data,
    cargoZones: data.cargoZones ? JSON.stringify(data.cargoZones) : null,
    forwardCgLimit: data.forwardCgLimit ?? null,
    aftCgLimit: data.aftCgLimit ?? null,
  });

  return { id: Number(result.insertId), ...data };
}

// ============================================================================
// Crew Management
// ============================================================================

export async function getCrewMembers(filters?: {
  airlineId?: number;
  role?: string;
  status?: string;
}) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const conditions = [];
  if (filters?.airlineId)
    conditions.push(eq(crewMembers.airlineId, filters.airlineId));
  if (filters?.role)
    conditions.push(
      eq(
        crewMembers.role,
        filters.role as "captain" | "first_officer" | "purser" | "cabin_crew"
      )
    );
  if (filters?.status)
    conditions.push(
      eq(
        crewMembers.status,
        filters.status as "active" | "on_leave" | "training" | "inactive"
      )
    );

  if (conditions.length > 0) {
    return await db
      .select()
      .from(crewMembers)
      .where(and(...conditions));
  }
  return await db.select().from(crewMembers);
}

export async function createCrewMember(data: {
  employeeId: string;
  firstName: string;
  lastName: string;
  role: "captain" | "first_officer" | "purser" | "cabin_crew";
  airlineId: number;
  licenseNumber?: string;
  licenseExpiry?: Date;
  medicalExpiry?: Date;
  qualifiedAircraft?: string[];
  phone?: string;
  email?: string;
}) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const [result] = await db.insert(crewMembers).values({
    ...data,
    licenseExpiry: data.licenseExpiry ?? null,
    medicalExpiry: data.medicalExpiry ?? null,
    qualifiedAircraft: data.qualifiedAircraft
      ? JSON.stringify(data.qualifiedAircraft)
      : null,
  });

  return { id: Number(result.insertId) };
}

export async function assignCrewToFlight(data: {
  tenantId?: number | null;
  flightId: number;
  crewMemberId: number;
  role: "captain" | "first_officer" | "purser" | "cabin_crew";
  assignedBy: number;
  notes?: string;
}) {
  const result = await assignCrewWithRules(data);
  return { id: result.id };
}

export async function getFlightCrew(flightId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  return readFlightCrew(db, flightId);
}

async function readFlightCrew(db: SettlementTx, flightId: number) {
  return await db
    .select({
      assignmentId: crewAssignments.id,
      role: crewAssignments.role,
      status: crewAssignments.status,
      crewId: crewMembers.id,
      employeeId: crewMembers.employeeId,
      firstName: crewMembers.firstName,
      lastName: crewMembers.lastName,
      licenseNumber: crewMembers.licenseNumber,
    })
    .from(crewAssignments)
    .innerJoin(crewMembers, eq(crewAssignments.crewMemberId, crewMembers.id))
    .where(
      and(
        eq(crewAssignments.flightId, flightId),
        sql`${crewAssignments.status} != 'removed'`
      )
    );
}

export async function removeCrewFromFlight(assignmentId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  await db
    .update(crewAssignments)
    .set({ status: "removed" })
    .where(eq(crewAssignments.id, assignmentId));

  return { success: true };
}

// ============================================================================
// Flight Manifest
// ============================================================================

export async function generateFlightManifest(flightId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Financial reversals and physical inventory must describe one snapshot.
  // A separate preflight check could race a refund before the totals query.
  return db.transaction(tx => readFlightManifest(tx, flightId), {
    isolationLevel: "repeatable read",
  });
}

async function readFlightManifest(db: SettlementTx, flightId: number) {
  // Get flight details with airline and airports
  const [flight] = await db
    .select({
      id: flights.id,
      flightNumber: flights.flightNumber,
      aircraftType: flights.aircraftType,
      departureTime: flights.departureTime,
      arrivalTime: flights.arrivalTime,
      status: flights.status,
      economySeats: flights.economySeats,
      businessSeats: flights.businessSeats,
      economyAvailable: flights.economyAvailable,
      businessAvailable: flights.businessAvailable,
      airlineName: airlines.name,
      airlineCode: airlines.code,
      originCode: airports.code,
      originCity: airports.city,
    })
    .from(flights)
    .innerJoin(airlines, eq(flights.airlineId, airlines.id))
    .innerJoin(airports, eq(flights.originId, airports.id))
    .where(eq(flights.id, flightId))
    .limit(1);

  if (!flight)
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
  await assertFlightBaggageReconciled(db, flightId);

  // Get destination airport separately
  const [destFlight] = await db
    .select({
      destinationId: flights.destinationId,
    })
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);

  const [destAirport] = await db
    .select({ code: airports.code, city: airports.city })
    .from(airports)
    .where(eq(airports.id, destFlight.destinationId))
    .limit(1);

  const membership = manifestBookingCondition(flightId);
  // A financial reversal can remove someone from the reservation list while
  // their physical boarding is still recorded, even when they have no bags.
  const [unlistedBoarding] = await db
    .select({ passengerId: dcsPassengerStates.passengerId })
    .from(dcsPassengerStates)
    .where(
      and(
        eq(dcsPassengerStates.flightId, flightId),
        eq(dcsPassengerStates.state, "boarded"),
        notExists(
          db
            .select({ id: passengers.id })
            .from(bookings)
            .innerJoin(passengers, eq(passengers.bookingId, bookings.id))
            .where(
              and(
                membership,
                eq(bookings.id, dcsPassengerStates.bookingId),
                eq(passengers.id, dcsPassengerStates.passengerId)
              )
            )
        )
      )
    )
    .limit(1);
  if (unlistedBoarding)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "A boarded passenger is missing from the flight manifest; departure reconciliation is required",
    });
  // Only unsegmented legacy bookings can use a booking-wide seat. Multiple
  // competing active assignments cannot establish a reliable seat number.
  const confirmedBookings = await db
    .select({
      bookingId: bookings.id,
      bookingReference: bookings.bookingReference,
      pnr: bookings.pnr,
      cabinClass: bookings.cabinClass,
      passengerId: passengers.id,
      passengerType: passengers.type,
      title: passengers.title,
      firstName: passengers.firstName,
      lastName: passengers.lastName,
      seatNumber: sql<string | null>`(
        SELECT CASE COUNT(*)
          WHEN 0 THEN CASE WHEN NOT EXISTS (SELECT 1 FROM booking_segments bs
            WHERE bs.bookingId = ${bookings.id}) THEN ${passengers.seatNumber} END
          WHEN 1 THEN MAX(si.seatNumber)
        END FROM seat_inventory si
        WHERE si.flightId = ${flightId} AND si.bookingId = ${bookings.id}
          AND si.passengerId = ${passengers.id}
          AND si.status IN ('occupied', 'checked_in')
      )`,
    })
    .from(bookings)
    .innerJoin(passengers, eq(bookings.id, passengers.bookingId))
    .where(membership);

  // Get crew assignments
  const crew = await readFlightCrew(db, flightId);

  // Get baggage count
  const baggageResult = await db
    .select({
      count: sql<number>`COUNT(*)`,
      totalWeight: sql<number>`COALESCE(SUM(${baggageItems.weight}), 0)`,
    })
    .from(baggageItems)
    .innerJoin(bookings, eq(baggageItems.bookingId, bookings.id))
    .where(
      and(
        membership,
        // Exact registered sectors take precedence; legacy bags retain the
        // prior sole-flight/custody attribution rules.
        manifestBaggageFlightCondition(flightId)
      )
    );

  // Passenger counts by type
  const adultCount = confirmedBookings.filter(
    p => p.passengerType === "adult"
  ).length;
  const childCount = confirmedBookings.filter(
    p => p.passengerType === "child"
  ).length;
  const infantCount = confirmedBookings.filter(
    p => p.passengerType === "infant"
  ).length;

  const economyPassengers = confirmedBookings.filter(
    p => p.cabinClass === "economy"
  ).length;
  const businessPassengers = confirmedBookings.filter(
    p => p.cabinClass === "business"
  ).length;

  return {
    manifest: {
      generatedAt: new Date().toISOString(),
      flight: {
        id: flight.id,
        flightNumber: flight.flightNumber,
        airline: { name: flight.airlineName, code: flight.airlineCode },
        aircraftType: flight.aircraftType,
        origin: { code: flight.originCode, city: flight.originCity },
        destination: { code: destAirport?.code, city: destAirport?.city },
        departureTime: flight.departureTime,
        arrivalTime: flight.arrivalTime,
        status: flight.status,
      },
      passengers: {
        total: confirmedBookings.length,
        adults: adultCount,
        children: childCount,
        infants: infantCount,
        economy: economyPassengers,
        business: businessPassengers,
        list: confirmedBookings.map(p => ({
          id: p.passengerId,
          bookingRef: p.bookingReference,
          pnr: p.pnr,
          name: `${p.title ?? ""} ${p.firstName} ${p.lastName}`.trim(),
          type: p.passengerType,
          cabinClass: p.cabinClass,
          seat: p.seatNumber,
        })),
      },
      crew: {
        total: crew.length,
        cockpit: crew.filter(
          c => c.role === "captain" || c.role === "first_officer"
        ),
        cabin: crew.filter(c => c.role === "purser" || c.role === "cabin_crew"),
      },
      baggage: {
        pieces: Number(baggageResult[0]?.count ?? 0),
        totalWeight: Number(baggageResult[0]?.totalWeight ?? 0),
      },
      capacity: {
        economySeats: flight.economySeats,
        businessSeats: flight.businessSeats,
        economyAvailable: flight.economyAvailable,
        businessAvailable: flight.businessAvailable,
        loadFactor:
          flight.economySeats + flight.businessSeats > 0
            ? Math.round(
                (confirmedBookings.length /
                  (flight.economySeats + flight.businessSeats)) *
                  100
              )
            : 0,
      },
    },
  };
}

// ============================================================================
// Weight & Balance
// ============================================================================

export async function calculateWeightAndBalance(input: {
  flightId: number;
  aircraftTypeId: number;
  fuelWeight: number;
  cargoDistribution?: Array<{ zone: string; weight: number }>;
}) {
  requireDemoCapability("Weight and balance simulation");
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Get aircraft type
  const [aircraft] = await db
    .select()
    .from(aircraftTypes)
    .where(eq(aircraftTypes.id, input.aircraftTypeId))
    .limit(1);

  if (!aircraft)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Aircraft type not found",
    });

  // Get passenger info
  const paxResult = await db
    .select({
      type: passengers.type,
      count: sql<number>`COUNT(*)`,
    })
    .from(passengers)
    .innerJoin(bookings, eq(passengers.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.flightId, input.flightId),
        sql`${bookings.status} IN ('confirmed', 'completed')`
      )
    )
    .groupBy(passengers.type);

  // Calculate passenger weight
  let passengerWeight = 0;
  let passengerCount = 0;
  for (const row of paxResult) {
    const type = row.type as keyof typeof STANDARD_WEIGHTS;
    const weight = STANDARD_WEIGHTS[type] ?? STANDARD_WEIGHTS.adult;
    passengerWeight += weight * Number(row.count);
    passengerCount += Number(row.count);
  }

  // Get baggage weight
  const [bagResult] = await db
    .select({
      totalWeight: sql<number>`COALESCE(SUM(${baggageItems.weight}), 0)`,
      count: sql<number>`COUNT(*)`,
    })
    .from(baggageItems)
    .innerJoin(bookings, eq(baggageItems.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.flightId, input.flightId),
        sql`${bookings.status} IN ('confirmed', 'completed')`
      )
    );

  const baggageWeight = Number(bagResult?.totalWeight ?? 0);
  const baggageCount = Number(bagResult?.count ?? 0);

  // Calculate cargo weight
  const cargoDistribution = input.cargoDistribution ?? [];
  const totalCargoWeight = cargoDistribution.reduce(
    (sum, c) => sum + c.weight,
    0
  );

  // Calculate weights
  const oew = aircraft.operatingEmptyWeight;
  const payloadWeight = passengerWeight + baggageWeight + totalCargoWeight;
  const zeroFuelWeight = oew + payloadWeight;
  const takeoffWeight = zeroFuelWeight + input.fuelWeight;

  // Estimate landing weight (burn ~80% of fuel for simplicity)
  const estimatedFuelBurn = Math.round(input.fuelWeight * 0.8);
  const landingWeight = takeoffWeight - estimatedFuelBurn;

  // Simplified CG calculation (% MAC)
  // Uses weighted average of passenger, cargo, and fuel positions
  const forwardCg = parseFloat(aircraft.forwardCgLimit ?? "15");
  const aftCg = parseFloat(aircraft.aftCgLimit ?? "35");
  const midCg = (forwardCg + aftCg) / 2;

  // Approximate CG based on load distribution
  const cgPosition =
    midCg +
    (totalCargoWeight > 0 ? (totalCargoWeight / payloadWeight - 0.5) * 5 : 0);

  // Safety checks
  const warnings: string[] = [];
  let withinLimits = true;

  if (takeoffWeight > aircraft.maxTakeoffWeight) {
    warnings.push(
      `Takeoff weight (${takeoffWeight} kg) exceeds MTOW (${aircraft.maxTakeoffWeight} kg)`
    );
    withinLimits = false;
  }
  if (landingWeight > aircraft.maxLandingWeight) {
    warnings.push(
      `Landing weight (${landingWeight} kg) exceeds MLW (${aircraft.maxLandingWeight} kg)`
    );
    withinLimits = false;
  }
  if (zeroFuelWeight > aircraft.maxZeroFuelWeight) {
    warnings.push(
      `Zero fuel weight (${zeroFuelWeight} kg) exceeds MZFW (${aircraft.maxZeroFuelWeight} kg)`
    );
    withinLimits = false;
  }
  if (payloadWeight > aircraft.maxPayload) {
    warnings.push(
      `Payload (${payloadWeight} kg) exceeds max payload (${aircraft.maxPayload} kg)`
    );
    withinLimits = false;
  }
  if (input.fuelWeight > aircraft.maxFuelCapacity) {
    warnings.push(
      `Fuel (${input.fuelWeight} kg) exceeds max capacity (${aircraft.maxFuelCapacity} kg)`
    );
    withinLimits = false;
  }
  if (cgPosition < forwardCg || cgPosition > aftCg) {
    warnings.push(
      `CG position (${cgPosition.toFixed(2)}% MAC) is outside limits (${forwardCg}-${aftCg}% MAC)`
    );
    withinLimits = false;
  }

  // Check cargo zones
  if (aircraft.cargoZones && cargoDistribution.length > 0) {
    let zones: Array<{ zone: string; maxWeight: number }> = [];
    try {
      zones = JSON.parse(aircraft.cargoZones);
    } catch (_parseError) {
      console.warn(
        `Failed to parse cargoZones for aircraft type ${aircraft.code}: ${aircraft.cargoZones}`
      );
    }
    for (const cargo of cargoDistribution) {
      const zoneConfig = zones.find(z => z.zone === cargo.zone);
      if (zoneConfig && cargo.weight > zoneConfig.maxWeight) {
        warnings.push(
          `Cargo zone ${cargo.zone}: ${cargo.weight} kg exceeds max ${zoneConfig.maxWeight} kg`
        );
        withinLimits = false;
      }
    }
  }

  return {
    aircraft: {
      code: aircraft.code,
      name: aircraft.name,
      limits: {
        mtow: aircraft.maxTakeoffWeight,
        mlw: aircraft.maxLandingWeight,
        mzfw: aircraft.maxZeroFuelWeight,
        oew: aircraft.operatingEmptyWeight,
        maxPayload: aircraft.maxPayload,
        maxFuel: aircraft.maxFuelCapacity,
      },
    },
    weights: {
      operatingEmpty: oew,
      passengers: { count: passengerCount, weight: passengerWeight },
      baggage: { count: baggageCount, weight: baggageWeight },
      cargo: { zones: cargoDistribution, weight: totalCargoWeight },
      fuel: input.fuelWeight,
      payload: payloadWeight,
      zeroFuel: zeroFuelWeight,
      takeoff: takeoffWeight,
      landing: landingWeight,
    },
    balance: {
      cgPosition: parseFloat(cgPosition.toFixed(2)),
      forwardLimit: forwardCg,
      aftLimit: aftCg,
    },
    safety: {
      withinLimits,
      warnings,
    },
  };
}

// ============================================================================
// Load Plan Management
// ============================================================================

export async function createLoadPlan(input: {
  flightId: number;
  aircraftTypeId: number;
  fuelWeight: number;
  cargoDistribution?: Array<{ zone: string; weight: number }>;
}) {
  requireDemoCapability("Weight and balance simulation");
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Calculate weight and balance
  const wb = await calculateWeightAndBalance(input);

  const [result] = await db.insert(loadPlans).values({
    flightId: input.flightId,
    aircraftTypeId: input.aircraftTypeId,
    passengerCount: wb.weights.passengers.count,
    passengerWeight: wb.weights.passengers.weight,
    baggageCount: wb.weights.baggage.count,
    baggageWeight: wb.weights.baggage.weight,
    cargoDistribution: input.cargoDistribution
      ? JSON.stringify(input.cargoDistribution)
      : null,
    totalCargoWeight: wb.weights.cargo.weight,
    fuelWeight: input.fuelWeight,
    zeroFuelWeight: wb.weights.zeroFuel,
    takeoffWeight: wb.weights.takeoff,
    landingWeight: wb.weights.landing,
    cgPosition: wb.balance.cgPosition.toString(),
    status: "calculated",
    withinLimits: wb.safety.withinLimits,
    warnings:
      wb.safety.warnings.length > 0 ? JSON.stringify(wb.safety.warnings) : null,
  });

  return {
    id: Number(result.insertId),
    ...wb,
  };
}

export async function getLoadPlan(flightId: number) {
  requireDemoCapability("Weight and balance simulation");
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const [plan] = await db
    .select()
    .from(loadPlans)
    .where(eq(loadPlans.flightId, flightId))
    .orderBy(sql`${loadPlans.createdAt} DESC`)
    .limit(1);

  if (!plan) return null;

  let parsedCargoDistribution: Array<{ zone: string; weight: number }> = [];
  if (plan.cargoDistribution) {
    try {
      parsedCargoDistribution = JSON.parse(plan.cargoDistribution);
    } catch (_parseError) {
      console.warn(
        `Failed to parse cargoDistribution for load plan ${plan.id}: ${plan.cargoDistribution}`
      );
    }
  }

  let parsedWarnings: string[] = [];
  if (plan.warnings) {
    try {
      parsedWarnings = JSON.parse(plan.warnings);
    } catch (_parseError) {
      console.warn(
        `Failed to parse warnings for load plan ${plan.id}: ${plan.warnings}`
      );
    }
  }

  return {
    ...plan,
    cargoDistribution: parsedCargoDistribution,
    warnings: parsedWarnings,
  };
}

export function approveLoadPlan(loadPlanId: number, approvedBy: number) {
  return transitionSimulatedLoadPlan(loadPlanId, approvedBy, "approved");
}

export function finalizeLoadPlan(loadPlanId: number, finalizedBy: number) {
  return transitionSimulatedLoadPlan(loadPlanId, finalizedBy, "finalized");
}

async function transitionSimulatedLoadPlan(
  loadPlanId: number,
  actorId: number,
  status: "approved" | "finalized"
) {
  requireDemoCapability("Weight and balance simulation");
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  const [hint] = await db
    .select({ flightId: loadPlans.flightId })
    .from(loadPlans)
    .where(eq(loadPlans.id, loadPlanId))
    .limit(1);
  if (!hint)
    throw new TRPCError({ code: "NOT_FOUND", message: "Load plan not found" });
  return db.transaction(async tx => {
    await lockSimulatedLoadPlanFlight(tx, hint.flightId);
    const [plan] = await tx
      .select()
      .from(loadPlans)
      .where(
        and(eq(loadPlans.id, loadPlanId), eq(loadPlans.flightId, hint.flightId))
      )
      .limit(1)
      .for("update");
    if (!plan)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Load plan not found",
      });
    if (!plan.withinLimits)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot approve load plan with safety warnings",
      });
    if (status === "finalized" && plan.status !== "approved")
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Load plan must be approved before finalizing",
      });
    await tx
      .update(loadPlans)
      .set(
        status === "approved"
          ? { status, approvedBy: actorId, approvedAt: new Date() }
          : { status, finalizedBy: actorId, finalizedAt: new Date() }
      )
      .where(eq(loadPlans.id, loadPlanId));
    return { success: true };
  });
}

// ============================================================================
// DCS Dashboard Statistics
// ============================================================================

export async function getDcsStats() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Today's flights
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [flightStats] = await db
    .select({
      totalFlights: sql<number>`COUNT(*)`,
      scheduledFlights: sql<number>`SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END)`,
      delayedFlights: sql<number>`SUM(CASE WHEN status = 'delayed' THEN 1 ELSE 0 END)`,
      completedFlights: sql<number>`SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)`,
    })
    .from(flights)
    .where(
      and(
        sql`${flights.departureTime} >= ${today}`,
        sql`${flights.departureTime} < ${tomorrow}`
      )
    );

  const [crewStats] = await db
    .select({
      totalCrew: sql<number>`COUNT(*)`,
      activeCrew: sql<number>`SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END)`,
    })
    .from(crewMembers);

  const [loadPlanStats] = demoCapabilitiesEnabled()
    ? await db
        .select({
          totalPlans: sql<number>`COUNT(*)`,
          draftPlans: sql<number>`SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END)`,
          approvedPlans: sql<number>`SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END)`,
          finalizedPlans: sql<number>`SUM(CASE WHEN status = 'finalized' THEN 1 ELSE 0 END)`,
        })
        .from(loadPlans)
    : [];

  const [aircraftStats] = await db
    .select({
      totalTypes: sql<number>`COUNT(*)`,
    })
    .from(aircraftTypes)
    .where(eq(aircraftTypes.active, true));

  return {
    flights: {
      total: Number(flightStats?.totalFlights ?? 0),
      scheduled: Number(flightStats?.scheduledFlights ?? 0),
      delayed: Number(flightStats?.delayedFlights ?? 0),
      completed: Number(flightStats?.completedFlights ?? 0),
    },
    crew: {
      total: Number(crewStats?.totalCrew ?? 0),
      active: Number(crewStats?.activeCrew ?? 0),
    },
    loadPlans: loadPlanStats
      ? {
          total: Number(loadPlanStats.totalPlans ?? 0),
          draft: Number(loadPlanStats.draftPlans ?? 0),
          approved: Number(loadPlanStats.approvedPlans ?? 0),
          finalized: Number(loadPlanStats.finalizedPlans ?? 0),
        }
      : null,
    aircraftTypes: Number(aircraftStats?.totalTypes ?? 0),
  };
}
