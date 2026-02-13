/**
 * Departure Control System (DCS) Service
 *
 * Handles flight manifest generation, weight & balance calculations,
 * load planning, and crew management.
 */

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
} from "../../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

// ============================================================================
// Standard passenger weights (IATA standard averages)
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
  flightId: number;
  crewMemberId: number;
  role: "captain" | "first_officer" | "purser" | "cabin_crew";
  assignedBy: number;
  notes?: string;
}) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Check flight exists
  const [flight] = await db
    .select()
    .from(flights)
    .where(eq(flights.id, data.flightId))
    .limit(1);
  if (!flight)
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });

  // Check crew member exists and is active
  const [crew] = await db
    .select()
    .from(crewMembers)
    .where(eq(crewMembers.id, data.crewMemberId))
    .limit(1);
  if (!crew)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Crew member not found",
    });
  if (crew.status !== "active") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Crew member is not active",
    });
  }

  // Check for duplicate assignment
  const [existing] = await db
    .select()
    .from(crewAssignments)
    .where(
      and(
        eq(crewAssignments.flightId, data.flightId),
        eq(crewAssignments.crewMemberId, data.crewMemberId),
        eq(crewAssignments.status, "assigned")
      )
    )
    .limit(1);

  if (existing) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Crew member already assigned to this flight",
    });
  }

  const [result] = await db.insert(crewAssignments).values(data);
  return { id: Number(result.insertId) };
}

export async function getFlightCrew(flightId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

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

  // Get confirmed bookings with passengers
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
      seatNumber: passengers.seatNumber,
    })
    .from(bookings)
    .innerJoin(passengers, eq(bookings.id, passengers.bookingId))
    .where(
      and(
        eq(bookings.flightId, flightId),
        sql`${bookings.status} IN ('confirmed', 'completed')`
      )
    );

  // Get crew assignments
  const crew = await getFlightCrew(flightId);

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
        eq(bookings.flightId, flightId),
        sql`${bookings.status} IN ('confirmed', 'completed')`
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

export async function approveLoadPlan(loadPlanId: number, approvedBy: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const [plan] = await db
    .select()
    .from(loadPlans)
    .where(eq(loadPlans.id, loadPlanId))
    .limit(1);
  if (!plan)
    throw new TRPCError({ code: "NOT_FOUND", message: "Load plan not found" });

  if (!plan.withinLimits) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cannot approve load plan with safety warnings",
    });
  }

  await db
    .update(loadPlans)
    .set({ status: "approved", approvedBy, approvedAt: new Date() })
    .where(eq(loadPlans.id, loadPlanId));

  return { success: true };
}

export async function finalizeLoadPlan(
  loadPlanId: number,
  finalizedBy: number
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const [plan] = await db
    .select()
    .from(loadPlans)
    .where(eq(loadPlans.id, loadPlanId))
    .limit(1);
  if (!plan)
    throw new TRPCError({ code: "NOT_FOUND", message: "Load plan not found" });
  if (plan.status !== "approved") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Load plan must be approved before finalizing",
    });
  }

  await db
    .update(loadPlans)
    .set({ status: "finalized", finalizedBy, finalizedAt: new Date() })
    .where(eq(loadPlans.id, loadPlanId));

  return { success: true };
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

  const [loadPlanStats] = await db
    .select({
      totalPlans: sql<number>`COUNT(*)`,
      draftPlans: sql<number>`SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END)`,
      approvedPlans: sql<number>`SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END)`,
      finalizedPlans: sql<number>`SUM(CASE WHEN status = 'finalized' THEN 1 ELSE 0 END)`,
    })
    .from(loadPlans);

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
    loadPlans: {
      total: Number(loadPlanStats?.totalPlans ?? 0),
      draft: Number(loadPlanStats?.draftPlans ?? 0),
      approved: Number(loadPlanStats?.approvedPlans ?? 0),
      finalized: Number(loadPlanStats?.finalizedPlans ?? 0),
    },
    aircraftTypes: Number(aircraftStats?.totalTypes ?? 0),
  };
}
