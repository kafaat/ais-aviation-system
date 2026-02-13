/**
 * Crew Assignment Service
 *
 * Handles crew scheduling, assignment, availability, FTL compliance,
 * and replacement logic for the DCS module.
 */

import { getDb } from "../db";
import { crewMembers, crewAssignments, flights } from "../../drizzle/schema";
import { eq, and, sql, ne } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

// ============================================================================
// Types
// ============================================================================

export interface CrewFilters {
  airlineId?: number;
  role?: "captain" | "first_officer" | "purser" | "cabin_crew";
  status?: "active" | "on_leave" | "training" | "inactive";
  search?: string;
}

export interface CrewAssignmentInput {
  flightId: number;
  crewMemberId: number;
  role: "captain" | "first_officer" | "purser" | "cabin_crew";
  dutyStartTime?: Date;
  dutyEndTime?: Date;
  notes?: string;
  assignedBy: number;
}

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

/** Minimum crew requirements per flight (GACA / IATA simplified) */
const MIN_CREW_REQUIREMENTS = {
  captain: 1,
  first_officer: 1,
  purser: 1,
  cabin_crew: 2, // minimum for a narrow-body; wide-body may require more
};

/** Maximum duty hours in a 24-hour window (simplified FTL) */
const MAX_DUTY_HOURS_24H = 14;

/** Maximum flight duty period (hours) */
const MAX_FLIGHT_DUTY_PERIOD = 13;

/** Minimum rest period between duties (hours) */
const MIN_REST_PERIOD = 10;

/** Warning threshold as percentage of max duty hours */
const DUTY_WARNING_THRESHOLD = 0.8;

// ============================================================================
// Get Crew Members (with filters and search)
// ============================================================================

export async function getCrewMembers(filters?: CrewFilters) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const conditions = [];

  if (filters?.airlineId) {
    conditions.push(eq(crewMembers.airlineId, filters.airlineId));
  }
  if (filters?.role) {
    conditions.push(eq(crewMembers.role, filters.role));
  }
  if (filters?.status) {
    conditions.push(eq(crewMembers.status, filters.status));
  }
  if (filters?.search) {
    const term = `%${filters.search}%`;
    conditions.push(
      sql`(${crewMembers.firstName} LIKE ${term} OR ${crewMembers.lastName} LIKE ${term} OR ${crewMembers.employeeId} LIKE ${term})`
    );
  }

  const rows =
    conditions.length > 0
      ? await db
          .select({
            id: crewMembers.id,
            employeeId: crewMembers.employeeId,
            firstName: crewMembers.firstName,
            lastName: crewMembers.lastName,
            role: crewMembers.role,
            airlineId: crewMembers.airlineId,
            licenseNumber: crewMembers.licenseNumber,
            licenseExpiry: crewMembers.licenseExpiry,
            medicalExpiry: crewMembers.medicalExpiry,
            qualifiedAircraft: crewMembers.qualifiedAircraft,
            status: crewMembers.status,
            phone: crewMembers.phone,
            email: crewMembers.email,
            createdAt: crewMembers.createdAt,
            updatedAt: crewMembers.updatedAt,
          })
          .from(crewMembers)
          .where(and(...conditions))
      : await db
          .select({
            id: crewMembers.id,
            employeeId: crewMembers.employeeId,
            firstName: crewMembers.firstName,
            lastName: crewMembers.lastName,
            role: crewMembers.role,
            airlineId: crewMembers.airlineId,
            licenseNumber: crewMembers.licenseNumber,
            licenseExpiry: crewMembers.licenseExpiry,
            medicalExpiry: crewMembers.medicalExpiry,
            qualifiedAircraft: crewMembers.qualifiedAircraft,
            status: crewMembers.status,
            phone: crewMembers.phone,
            email: crewMembers.email,
            createdAt: crewMembers.createdAt,
            updatedAt: crewMembers.updatedAt,
          })
          .from(crewMembers);

  return rows.map(row => ({
    ...row,
    qualifiedAircraft: row.qualifiedAircraft
      ? (JSON.parse(row.qualifiedAircraft) as string[])
      : [],
  }));
}

// ============================================================================
// Get Single Crew Member
// ============================================================================

export async function getCrewMemberById(id: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const [member] = await db
    .select()
    .from(crewMembers)
    .where(eq(crewMembers.id, id))
    .limit(1);

  if (!member) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Crew member not found",
    });
  }

  return {
    ...member,
    qualifiedAircraft: member.qualifiedAircraft
      ? (JSON.parse(member.qualifiedAircraft) as string[])
      : [],
  };
}

// ============================================================================
// Assign Crew to Flight
// ============================================================================

export async function assignCrewToFlight(input: CrewAssignmentInput) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Verify the flight exists and is not completed/cancelled
  const [flight] = await db
    .select({
      id: flights.id,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      arrivalTime: flights.arrivalTime,
      status: flights.status,
      aircraftType: flights.aircraftType,
    })
    .from(flights)
    .where(eq(flights.id, input.flightId))
    .limit(1);

  if (!flight) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
  }

  if (flight.status === "completed" || flight.status === "cancelled") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Cannot assign crew to a ${flight.status} flight`,
    });
  }

  // Verify crew member exists and is active
  const [crew] = await db
    .select()
    .from(crewMembers)
    .where(eq(crewMembers.id, input.crewMemberId))
    .limit(1);

  if (!crew) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Crew member not found",
    });
  }

  if (crew.status !== "active") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Crew member is currently ${crew.status} and cannot be assigned`,
    });
  }

  // Check FTL compliance before assigning (read-only check, safe outside transaction)
  const ftlCheck = await checkFTLCompliance(input.crewMemberId, {
    departureTime: flight.departureTime,
    arrivalTime: flight.arrivalTime,
  });

  if (!ftlCheck.compliant) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `FTL violation: ${ftlCheck.violations.join("; ")}`,
    });
  }

  // Wrap duplicate check + conflict detection + insert in a transaction to prevent race conditions
  const result = await db.transaction(async tx => {
    // Check for duplicate active assignment
    const [existing] = await tx
      .select()
      .from(crewAssignments)
      .where(
        and(
          eq(crewAssignments.flightId, input.flightId),
          eq(crewAssignments.crewMemberId, input.crewMemberId),
          ne(crewAssignments.status, "removed")
        )
      )
      .limit(1);

    if (existing) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Crew member is already assigned to this flight",
      });
    }

    // Check for scheduling conflicts (overlapping flights)
    const conflictingAssignments = await tx
      .select({
        assignmentId: crewAssignments.id,
        flightId: crewAssignments.flightId,
        flightNumber: flights.flightNumber,
        departureTime: flights.departureTime,
        arrivalTime: flights.arrivalTime,
      })
      .from(crewAssignments)
      .innerJoin(flights, eq(crewAssignments.flightId, flights.id))
      .where(
        and(
          eq(crewAssignments.crewMemberId, input.crewMemberId),
          ne(crewAssignments.status, "removed"),
          // Overlap check: existing flight overlaps with proposed flight
          sql`${flights.departureTime} < ${flight.arrivalTime}`,
          sql`${flights.arrivalTime} > ${flight.departureTime}`
        )
      );

    if (conflictingAssignments.length > 0) {
      const conflicts = conflictingAssignments
        .map(c => c.flightNumber)
        .join(", ");
      throw new TRPCError({
        code: "CONFLICT",
        message: `Crew member has scheduling conflict with flight(s): ${conflicts}`,
      });
    }

    const [insertResult] = await tx.insert(crewAssignments).values({
      flightId: input.flightId,
      crewMemberId: input.crewMemberId,
      role: input.role,
      notes: input.notes ?? null,
      assignedBy: input.assignedBy,
    });

    return insertResult;
  });

  return {
    id: Number(result.insertId),
    flightNumber: flight.flightNumber,
    crewName: `${crew.firstName} ${crew.lastName}`,
    role: input.role,
    ftlWarnings: ftlCheck.warnings,
  };
}

// ============================================================================
// Remove Crew from Flight
// ============================================================================

export async function removeCrewFromFlight(
  flightId: number,
  crewMemberId: number
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const [assignment] = await db
    .select()
    .from(crewAssignments)
    .where(
      and(
        eq(crewAssignments.flightId, flightId),
        eq(crewAssignments.crewMemberId, crewMemberId),
        ne(crewAssignments.status, "removed")
      )
    )
    .limit(1);

  if (!assignment) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Active crew assignment not found for this flight",
    });
  }

  await db
    .update(crewAssignments)
    .set({ status: "removed" })
    .where(eq(crewAssignments.id, assignment.id));

  return { success: true, assignmentId: assignment.id };
}

// ============================================================================
// Get Flight Crew (with full details)
// ============================================================================

export async function getFlightCrew(flightId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Verify flight
  const [flight] = await db
    .select({
      id: flights.id,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      arrivalTime: flights.arrivalTime,
      aircraftType: flights.aircraftType,
      status: flights.status,
    })
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);

  if (!flight) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
  }

  const assignments = await db
    .select({
      assignmentId: crewAssignments.id,
      assignmentRole: crewAssignments.role,
      assignmentStatus: crewAssignments.status,
      notes: crewAssignments.notes,
      assignedBy: crewAssignments.assignedBy,
      assignedAt: crewAssignments.createdAt,
      crewId: crewMembers.id,
      employeeId: crewMembers.employeeId,
      firstName: crewMembers.firstName,
      lastName: crewMembers.lastName,
      crewRole: crewMembers.role,
      licenseNumber: crewMembers.licenseNumber,
      licenseExpiry: crewMembers.licenseExpiry,
      medicalExpiry: crewMembers.medicalExpiry,
      qualifiedAircraft: crewMembers.qualifiedAircraft,
      status: crewMembers.status,
      phone: crewMembers.phone,
      email: crewMembers.email,
    })
    .from(crewAssignments)
    .innerJoin(crewMembers, eq(crewAssignments.crewMemberId, crewMembers.id))
    .where(
      and(
        eq(crewAssignments.flightId, flightId),
        ne(crewAssignments.status, "removed")
      )
    );

  // Separate cockpit and cabin crew
  const cockpitRoles = ["captain", "first_officer"];
  const cockpitCrew = assignments.filter(a =>
    cockpitRoles.includes(a.assignmentRole)
  );
  const cabinCrew = assignments.filter(
    a => !cockpitRoles.includes(a.assignmentRole)
  );

  return {
    flight: {
      id: flight.id,
      flightNumber: flight.flightNumber,
      departureTime: flight.departureTime,
      arrivalTime: flight.arrivalTime,
      aircraftType: flight.aircraftType,
      status: flight.status,
    },
    crew: {
      total: assignments.length,
      cockpit: cockpitCrew.map(formatCrewAssignment),
      cabin: cabinCrew.map(formatCrewAssignment),
      all: assignments.map(formatCrewAssignment),
    },
  };
}

function formatCrewAssignment(a: {
  assignmentId: number;
  assignmentRole: string;
  assignmentStatus: string;
  notes: string | null;
  assignedBy: number | null;
  assignedAt: Date;
  crewId: number;
  employeeId: string;
  firstName: string;
  lastName: string;
  crewRole: string;
  licenseNumber: string | null;
  licenseExpiry: Date | null;
  medicalExpiry: Date | null;
  qualifiedAircraft: string | null;
  status: string;
  phone: string | null;
  email: string | null;
}) {
  return {
    assignmentId: a.assignmentId,
    role: a.assignmentRole,
    assignmentStatus: a.assignmentStatus,
    notes: a.notes,
    assignedAt: a.assignedAt,
    crew: {
      id: a.crewId,
      employeeId: a.employeeId,
      firstName: a.firstName,
      lastName: a.lastName,
      baseRole: a.crewRole,
      licenseNumber: a.licenseNumber,
      licenseExpiry: a.licenseExpiry,
      medicalExpiry: a.medicalExpiry,
      qualifiedAircraft: a.qualifiedAircraft
        ? (JSON.parse(a.qualifiedAircraft) as string[])
        : [],
      status: a.status,
      phone: a.phone,
      email: a.email,
    },
  };
}

// ============================================================================
// Check Crew Availability
// ============================================================================

export async function checkCrewAvailability(crewMemberId: number, date: Date) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Check crew member exists
  const [crew] = await db
    .select()
    .from(crewMembers)
    .where(eq(crewMembers.id, crewMemberId))
    .limit(1);

  if (!crew) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Crew member not found",
    });
  }

  // If crew member is not active, they are unavailable
  if (crew.status !== "active") {
    return {
      available: false,
      reason: `Crew member is ${crew.status}`,
      crewMember: {
        id: crew.id,
        name: `${crew.firstName} ${crew.lastName}`,
        status: crew.status,
      },
      assignmentsOnDate: [],
    };
  }

  // Check license and medical expiry
  const warnings: string[] = [];
  if (crew.licenseExpiry && crew.licenseExpiry < date) {
    warnings.push("License expired");
  }
  if (crew.medicalExpiry && crew.medicalExpiry < date) {
    warnings.push("Medical certificate expired");
  }

  if (warnings.length > 0) {
    return {
      available: false,
      reason: warnings.join(", "),
      crewMember: {
        id: crew.id,
        name: `${crew.firstName} ${crew.lastName}`,
        status: crew.status,
      },
      assignmentsOnDate: [],
    };
  }

  // Check for existing assignments on that date
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);

  const existingAssignments = await db
    .select({
      assignmentId: crewAssignments.id,
      flightId: crewAssignments.flightId,
      role: crewAssignments.role,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      arrivalTime: flights.arrivalTime,
    })
    .from(crewAssignments)
    .innerJoin(flights, eq(crewAssignments.flightId, flights.id))
    .where(
      and(
        eq(crewAssignments.crewMemberId, crewMemberId),
        ne(crewAssignments.status, "removed"),
        sql`${flights.departureTime} < ${dayEnd}`,
        sql`${flights.arrivalTime} > ${dayStart}`
      )
    );

  // Calculate total duty hours on that day
  const dutyHours = calculateDutyHoursFromAssignments(
    existingAssignments.map(a => ({
      departureTime: a.departureTime,
      arrivalTime: a.arrivalTime,
    }))
  );

  return {
    available: true,
    dutyHoursOnDate: Math.round(dutyHours * 100) / 100,
    remainingDutyHours:
      Math.round((MAX_DUTY_HOURS_24H - dutyHours) * 100) / 100,
    crewMember: {
      id: crew.id,
      name: `${crew.firstName} ${crew.lastName}`,
      status: crew.status,
    },
    assignmentsOnDate: existingAssignments.map(a => ({
      assignmentId: a.assignmentId,
      flightId: a.flightId,
      flightNumber: a.flightNumber,
      role: a.role,
      departureTime: a.departureTime,
      arrivalTime: a.arrivalTime,
    })),
  };
}

// ============================================================================
// Validate Crew Requirements
// ============================================================================

export async function validateCrewRequirements(
  flightId: number,
  _assignments?: Array<{
    crewMemberId: number;
    role: "captain" | "first_officer" | "purser" | "cabin_crew";
  }>
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Get current assignments from DB
  const currentAssignments = await db
    .select({
      id: crewAssignments.id,
      role: crewAssignments.role,
      crewMemberId: crewAssignments.crewMemberId,
      firstName: crewMembers.firstName,
      lastName: crewMembers.lastName,
    })
    .from(crewAssignments)
    .innerJoin(crewMembers, eq(crewAssignments.crewMemberId, crewMembers.id))
    .where(
      and(
        eq(crewAssignments.flightId, flightId),
        ne(crewAssignments.status, "removed")
      )
    );

  // Merge with proposed additional assignments if provided
  const allRoles = currentAssignments.map(a => a.role);
  if (_assignments) {
    for (const proposed of _assignments) {
      // Only add if not already assigned
      const alreadyAssigned = currentAssignments.some(
        c => c.crewMemberId === proposed.crewMemberId
      );
      if (!alreadyAssigned) {
        allRoles.push(proposed.role);
      }
    }
  }

  // Count roles
  const roleCounts: Record<string, number> = {};
  for (const role of allRoles) {
    roleCounts[role] = (roleCounts[role] ?? 0) + 1;
  }

  const issues: Array<{
    role: string;
    required: number;
    assigned: number;
    severity: "error" | "warning";
    message: string;
  }> = [];

  // Check minimum requirements
  for (const [role, required] of Object.entries(MIN_CREW_REQUIREMENTS)) {
    const assigned = roleCounts[role] ?? 0;
    if (assigned < required) {
      issues.push({
        role,
        required,
        assigned,
        severity: "error",
        message: `Requires at least ${required} ${role.replace("_", " ")}(s), only ${assigned} assigned`,
      });
    }
  }

  const meetsMinimum = issues.filter(i => i.severity === "error").length === 0;

  return {
    flightId,
    meetsMinimum,
    totalCrew: allRoles.length,
    roleCounts,
    requirements: MIN_CREW_REQUIREMENTS,
    issues,
    currentAssignments: currentAssignments.map(a => ({
      id: a.id,
      role: a.role,
      crewMemberId: a.crewMemberId,
      name: `${a.firstName} ${a.lastName}`,
    })),
  };
}

// ============================================================================
// Get Crew Schedule
// ============================================================================

export async function getCrewSchedule(
  crewMemberId: number,
  dateRange: DateRange
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Verify crew member
  const [crew] = await db
    .select()
    .from(crewMembers)
    .where(eq(crewMembers.id, crewMemberId))
    .limit(1);

  if (!crew) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Crew member not found",
    });
  }

  // Get all assignments within the date range
  const assignments = await db
    .select({
      assignmentId: crewAssignments.id,
      role: crewAssignments.role,
      assignmentStatus: crewAssignments.status,
      notes: crewAssignments.notes,
      flightId: flights.id,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      arrivalTime: flights.arrivalTime,
      flightStatus: flights.status,
      aircraftType: flights.aircraftType,
      originId: flights.originId,
      destinationId: flights.destinationId,
    })
    .from(crewAssignments)
    .innerJoin(flights, eq(crewAssignments.flightId, flights.id))
    .where(
      and(
        eq(crewAssignments.crewMemberId, crewMemberId),
        ne(crewAssignments.status, "removed"),
        sql`${flights.departureTime} >= ${dateRange.startDate}`,
        sql`${flights.departureTime} <= ${dateRange.endDate}`
      )
    )
    .orderBy(flights.departureTime);

  // Build a day-by-day schedule summary
  const schedule: Array<{
    date: string;
    assignments: typeof assignments;
    totalDutyHours: number;
    ftlStatus: "green" | "yellow" | "red";
  }> = [];

  const current = new Date(dateRange.startDate);
  current.setHours(0, 0, 0, 0);
  const end = new Date(dateRange.endDate);
  end.setHours(23, 59, 59, 999);

  while (current <= end) {
    const dayStart = new Date(current);
    const dayEnd = new Date(current);
    dayEnd.setHours(23, 59, 59, 999);

    const dayAssignments = assignments.filter(a => {
      const dep = new Date(a.departureTime);
      return dep >= dayStart && dep <= dayEnd;
    });

    const dutyHours = calculateDutyHoursFromAssignments(
      dayAssignments.map(a => ({
        departureTime: a.departureTime,
        arrivalTime: a.arrivalTime,
      }))
    );

    let ftlStatus: "green" | "yellow" | "red" = "green";
    if (dutyHours >= MAX_DUTY_HOURS_24H) {
      ftlStatus = "red";
    } else if (dutyHours >= MAX_DUTY_HOURS_24H * DUTY_WARNING_THRESHOLD) {
      ftlStatus = "yellow";
    }

    schedule.push({
      date: dayStart.toISOString().split("T")[0],
      assignments: dayAssignments,
      totalDutyHours: Math.round(dutyHours * 100) / 100,
      ftlStatus,
    });

    current.setDate(current.getDate() + 1);
  }

  return {
    crewMember: {
      id: crew.id,
      employeeId: crew.employeeId,
      name: `${crew.firstName} ${crew.lastName}`,
      role: crew.role,
      status: crew.status,
    },
    dateRange: {
      startDate: dateRange.startDate.toISOString(),
      endDate: dateRange.endDate.toISOString(),
    },
    totalAssignments: assignments.length,
    schedule,
  };
}

// ============================================================================
// Calculate Duty Time
// ============================================================================

export async function calculateDutyTime(crewMemberId: number, date: Date) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(date);
  dayEnd.setHours(23, 59, 59, 999);

  const assignments = await db
    .select({
      departureTime: flights.departureTime,
      arrivalTime: flights.arrivalTime,
      flightNumber: flights.flightNumber,
    })
    .from(crewAssignments)
    .innerJoin(flights, eq(crewAssignments.flightId, flights.id))
    .where(
      and(
        eq(crewAssignments.crewMemberId, crewMemberId),
        ne(crewAssignments.status, "removed"),
        sql`${flights.departureTime} < ${dayEnd}`,
        sql`${flights.arrivalTime} > ${dayStart}`
      )
    )
    .orderBy(flights.departureTime);

  const dutyHours = calculateDutyHoursFromAssignments(
    assignments.map(a => ({
      departureTime: a.departureTime,
      arrivalTime: a.arrivalTime,
    }))
  );

  const maxHours = MAX_DUTY_HOURS_24H;
  const remaining = Math.max(0, maxHours - dutyHours);
  const utilizationPercent =
    maxHours > 0 ? Math.round((dutyHours / maxHours) * 100) : 0;

  let ftlStatus: "green" | "yellow" | "red" = "green";
  if (dutyHours >= maxHours) {
    ftlStatus = "red";
  } else if (dutyHours >= maxHours * DUTY_WARNING_THRESHOLD) {
    ftlStatus = "yellow";
  }

  return {
    crewMemberId,
    date: date.toISOString().split("T")[0],
    dutyHours: Math.round(dutyHours * 100) / 100,
    maxDutyHours: maxHours,
    remainingHours: Math.round(remaining * 100) / 100,
    utilizationPercent,
    ftlStatus,
    flights: assignments.map(a => ({
      flightNumber: a.flightNumber,
      departureTime: a.departureTime,
      arrivalTime: a.arrivalTime,
    })),
  };
}

// ============================================================================
// Check FTL (Flight Time Limitations) Compliance
// ============================================================================

export async function checkFTLCompliance(
  crewMemberId: number,
  proposedFlight: { departureTime: Date; arrivalTime: Date }
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const violations: string[] = [];
  const warnings: string[] = [];

  // 1. Calculate the proposed flight duration
  const proposedDuration =
    (proposedFlight.arrivalTime.getTime() -
      proposedFlight.departureTime.getTime()) /
    (1000 * 60 * 60);

  if (proposedDuration > MAX_FLIGHT_DUTY_PERIOD) {
    violations.push(
      `Proposed flight duration (${proposedDuration.toFixed(1)}h) exceeds maximum flight duty period (${MAX_FLIGHT_DUTY_PERIOD}h)`
    );
  }

  // 2. Check 24-hour duty time window
  const windowStart = new Date(proposedFlight.departureTime);
  windowStart.setHours(windowStart.getHours() - 24);
  const windowEnd = new Date(proposedFlight.arrivalTime);

  const recentAssignments = await db
    .select({
      departureTime: flights.departureTime,
      arrivalTime: flights.arrivalTime,
      flightNumber: flights.flightNumber,
    })
    .from(crewAssignments)
    .innerJoin(flights, eq(crewAssignments.flightId, flights.id))
    .where(
      and(
        eq(crewAssignments.crewMemberId, crewMemberId),
        ne(crewAssignments.status, "removed"),
        sql`${flights.departureTime} < ${windowEnd}`,
        sql`${flights.arrivalTime} > ${windowStart}`
      )
    )
    .orderBy(flights.departureTime);

  // Include proposed flight
  const allFlights = [
    ...recentAssignments.map(a => ({
      departureTime: a.departureTime,
      arrivalTime: a.arrivalTime,
    })),
    {
      departureTime: proposedFlight.departureTime,
      arrivalTime: proposedFlight.arrivalTime,
    },
  ];

  const totalDutyHours = calculateDutyHoursFromAssignments(allFlights);

  if (totalDutyHours > MAX_DUTY_HOURS_24H) {
    violations.push(
      `Total duty time (${totalDutyHours.toFixed(1)}h) would exceed maximum ${MAX_DUTY_HOURS_24H}h in 24-hour window`
    );
  } else if (totalDutyHours > MAX_DUTY_HOURS_24H * DUTY_WARNING_THRESHOLD) {
    warnings.push(
      `Duty time approaching limit: ${totalDutyHours.toFixed(1)}h of ${MAX_DUTY_HOURS_24H}h maximum`
    );
  }

  // 3. Check minimum rest period from last flight
  if (recentAssignments.length > 0) {
    // Get the most recent flight ending before proposed departure
    const previousFlights = recentAssignments.filter(
      a => a.arrivalTime <= proposedFlight.departureTime
    );

    if (previousFlights.length > 0) {
      const lastFlight = previousFlights[previousFlights.length - 1];
      const restHours =
        (proposedFlight.departureTime.getTime() -
          lastFlight.arrivalTime.getTime()) /
        (1000 * 60 * 60);

      if (restHours < MIN_REST_PERIOD) {
        violations.push(
          `Rest period (${restHours.toFixed(1)}h) is below minimum ${MIN_REST_PERIOD}h between duties`
        );
      }
    }
  }

  // 4. Check crew member qualifications
  const [crew] = await db
    .select()
    .from(crewMembers)
    .where(eq(crewMembers.id, crewMemberId))
    .limit(1);

  if (crew) {
    if (
      crew.licenseExpiry &&
      crew.licenseExpiry < proposedFlight.departureTime
    ) {
      violations.push("Crew member's license will be expired at departure");
    }
    if (
      crew.medicalExpiry &&
      crew.medicalExpiry < proposedFlight.departureTime
    ) {
      violations.push(
        "Crew member's medical certificate will be expired at departure"
      );
    }
  }

  return {
    crewMemberId,
    compliant: violations.length === 0,
    totalDutyHours: Math.round(totalDutyHours * 100) / 100,
    maxDutyHours: MAX_DUTY_HOURS_24H,
    proposedFlightDuration: Math.round(proposedDuration * 100) / 100,
    violations,
    warnings,
  };
}

// ============================================================================
// Find Replacement Crew
// ============================================================================

export async function findReplacementCrew(
  flightId: number,
  role: "captain" | "first_officer" | "purser" | "cabin_crew"
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Get flight details
  const [flight] = await db
    .select({
      id: flights.id,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      arrivalTime: flights.arrivalTime,
      aircraftType: flights.aircraftType,
      airlineId: flights.airlineId,
    })
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);

  if (!flight) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
  }

  // Get all active crew members with the required role from the same airline
  const candidates = await db
    .select()
    .from(crewMembers)
    .where(
      and(
        eq(crewMembers.role, role),
        eq(crewMembers.status, "active"),
        eq(crewMembers.airlineId, flight.airlineId)
      )
    );

  // Get crew already assigned to this flight
  const alreadyAssigned = await db
    .select({ crewMemberId: crewAssignments.crewMemberId })
    .from(crewAssignments)
    .where(
      and(
        eq(crewAssignments.flightId, flightId),
        ne(crewAssignments.status, "removed")
      )
    );

  const assignedIds = new Set(alreadyAssigned.map(a => a.crewMemberId));

  // TODO: N+1 query pattern - each candidate triggers individual queries for conflicts,
  // FTL compliance, and duty time. This should be batched into bulk queries
  // (e.g., fetch all assignments for all candidate IDs in one query) to avoid
  // O(N) database round-trips when the candidate pool is large.
  const results: Array<{
    crewMember: {
      id: number;
      employeeId: string;
      name: string;
      role: string;
      qualifiedAircraft: string[];
      licenseExpiry: Date | null;
      medicalExpiry: Date | null;
    };
    available: boolean;
    ftlCompliant: boolean;
    dutyHoursOnDate: number;
    conflicts: string[];
    score: number;
  }> = [];

  for (const candidate of candidates) {
    // Skip if already assigned to this flight
    if (assignedIds.has(candidate.id)) continue;

    // Check for scheduling conflicts
    const conflicting = await db
      .select({
        flightNumber: flights.flightNumber,
      })
      .from(crewAssignments)
      .innerJoin(flights, eq(crewAssignments.flightId, flights.id))
      .where(
        and(
          eq(crewAssignments.crewMemberId, candidate.id),
          ne(crewAssignments.status, "removed"),
          sql`${flights.departureTime} < ${flight.arrivalTime}`,
          sql`${flights.arrivalTime} > ${flight.departureTime}`
        )
      );

    const hasConflicts = conflicting.length > 0;
    const conflicts = conflicting.map(c => c.flightNumber);

    // FTL check
    const ftl = await checkFTLCompliance(candidate.id, {
      departureTime: flight.departureTime,
      arrivalTime: flight.arrivalTime,
    });

    // Calculate duty hours on that date for ranking
    const dutyTime = await calculateDutyTime(
      candidate.id,
      flight.departureTime
    );

    // Qualification check for aircraft type
    const qualifiedAircraft = candidate.qualifiedAircraft
      ? (JSON.parse(candidate.qualifiedAircraft) as string[])
      : [];

    const isQualified =
      !flight.aircraftType ||
      qualifiedAircraft.length === 0 ||
      qualifiedAircraft.some(ac =>
        flight.aircraftType?.toLowerCase().includes(ac.toLowerCase())
      );

    // Score: higher is better
    let score = 0;
    if (!hasConflicts) score += 50;
    if (ftl.compliant) score += 30;
    if (isQualified) score += 15;
    // Prefer crew with less duty time (more rested)
    score += Math.max(0, 5 - dutyTime.dutyHours);

    // Check license/medical validity
    const licenseValid =
      !candidate.licenseExpiry ||
      candidate.licenseExpiry >= flight.departureTime;
    const medicalValid =
      !candidate.medicalExpiry ||
      candidate.medicalExpiry >= flight.departureTime;
    if (!licenseValid) score -= 100;
    if (!medicalValid) score -= 100;

    results.push({
      crewMember: {
        id: candidate.id,
        employeeId: candidate.employeeId,
        name: `${candidate.firstName} ${candidate.lastName}`,
        role: candidate.role,
        qualifiedAircraft,
        licenseExpiry: candidate.licenseExpiry,
        medicalExpiry: candidate.medicalExpiry,
      },
      available: !hasConflicts && ftl.compliant && licenseValid && medicalValid,
      ftlCompliant: ftl.compliant,
      dutyHoursOnDate: dutyTime.dutyHours,
      conflicts,
      score,
    });
  }

  // Sort by score descending (best candidates first)
  results.sort((a, b) => b.score - a.score);

  return {
    flightId,
    flightNumber: flight.flightNumber,
    role,
    candidates: results,
    availableCount: results.filter(r => r.available).length,
    totalCandidates: results.length,
  };
}

// ============================================================================
// Helper: Calculate total duty hours from a set of flight assignments
// ============================================================================

function calculateDutyHoursFromAssignments(
  flights: Array<{ departureTime: Date; arrivalTime: Date }>
): number {
  if (flights.length === 0) return 0;

  // Sum up individual flight durations
  // In real FTL, duty includes pre-flight and post-flight time,
  // but here we use flight time as a proxy
  let totalMs = 0;
  for (const f of flights) {
    const dep = new Date(f.departureTime).getTime();
    const arr = new Date(f.arrivalTime).getTime();
    totalMs += arr - dep;
  }

  return totalMs / (1000 * 60 * 60);
}
