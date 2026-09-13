import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  airportGates,
  gateAssignments,
  flights,
  airports,
  bookings,
} from "../../drizzle/schema";
import { eq, and, or, gte, lte, asc, ne, sql, count } from "drizzle-orm";
import { createNotification } from "./notification.service";
import {
  allocateGate,
  availableGates,
  changeGateStatus,
  configureGateCompatibility,
  releaseFlightGate,
  removeGate,
  type GateActor,
} from "./gate-allocation.service";

/**
 * Gate Service
 * Handles all gate assignment operations
 */

// ============================================================================
// Types
// ============================================================================

export interface GetAvailableGatesInput {
  airportId: number;
  dateTime: Date;
  flightType?: "domestic" | "international";
}

export interface AssignGateInput {
  actor: GateActor;
  occupiedFrom?: Date;
  occupiedUntil?: Date;
  flightId: number;
  gateId: number;
  boardingStartTime?: Date;
  boardingEndTime?: Date;
  assignedBy?: number;
}

export interface UpdateGateAssignmentInput {
  actor: GateActor;
  flightId: number;
  newGateId: number;
  changeReason?: string;
  assignedBy?: number;
}

export interface GateScheduleInput {
  airportId: number;
  date: Date;
}

export interface CreateGateInput {
  airportId: number;
  gateNumber: string;
  terminal?: string;
  type?: "domestic" | "international" | "both";
  capacity?: string;
  amenities?: string[];
}

export interface UpdateGateStatusInput {
  gateId: number;
  status: "available" | "occupied" | "maintenance";
}

// ============================================================================
// Gate Management Functions
// ============================================================================

/**
 * Create a new gate at an airport
 */
export async function createGate(input: CreateGateInput) {
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    // Check if gate number already exists at this airport
    const existing = await database
      .select()
      .from(airportGates)
      .where(
        and(
          eq(airportGates.airportId, input.airportId),
          eq(airportGates.gateNumber, input.gateNumber)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `Gate ${input.gateNumber} already exists at this airport`,
      });
    }

    const [result] = await database.insert(airportGates).values({
      airportId: input.airportId,
      gateNumber: input.gateNumber,
      terminal: input.terminal || null,
      type: input.type || "both",
      capacity: input.capacity || null,
      amenities: input.amenities ? JSON.stringify(input.amenities) : null,
    });

    const insertId = Number(result.insertId);
    console.info(
      `[Gate] Created gate ${input.gateNumber} at airport ${input.airportId}`
    );

    return { id: insertId, gateNumber: input.gateNumber };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("Error creating gate:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create gate",
    });
  }
}

/**
 * Get all gates for an airport
 */
export async function getAirportGates(airportId: number) {
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    const gates = await database
      .select()
      .from(airportGates)
      .where(eq(airportGates.airportId, airportId))
      .orderBy(asc(airportGates.terminal), asc(airportGates.gateNumber));

    return gates.map(gate => ({
      ...gate,
      amenities: gate.amenities ? JSON.parse(gate.amenities) : [],
    }));
  } catch (error) {
    console.error("Error getting airport gates:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get airport gates",
    });
  }
}

/**
 * Update gate status
 */
export async function updateGateStatus(input: UpdateGateStatusInput) {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  return await db.transaction(tx =>
    changeGateStatus(tx, input.gateId, input.status)
  );
}

export async function updateGateCompatibility(input: {
  gateId: number;
  aircraftTypes: string[];
  evidence: string;
}) {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  return await db.transaction(tx =>
    configureGateCompatibility(
      tx,
      input.gateId,
      input.aircraftTypes,
      input.evidence
    )
  );
}

// ============================================================================
// Gate Assignment Functions
// ============================================================================

/**
 * Get available gates at an airport for a specific date/time
 * Considers gate type (domestic/international) and current assignments
 */
export async function getAvailableGates(input: GetAvailableGatesInput) {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  return await availableGates(
    db,
    input.airportId,
    input.dateTime,
    input.flightType
  );
}

export async function assignGate(input: AssignGateInput) {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  return await db.transaction(tx => allocateGate(tx, input));
}

export async function updateGateAssignment(input: UpdateGateAssignmentInput) {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  return await db.transaction(tx =>
    allocateGate(tx, { ...input, gateId: input.newGateId, replace: true })
  );
}

export async function releaseGate(flightId: number, actor: GateActor) {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  return await db.transaction(tx => releaseFlightGate(tx, flightId, actor));
}

/**
 * Get gate assignment for a flight
 */
export async function getFlightGate(flightId: number) {
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    const result = await database
      .select({
        id: gateAssignments.id,
        flightId: gateAssignments.flightId,
        gateId: gateAssignments.gateId,
        gateNumber: airportGates.gateNumber,
        terminal: airportGates.terminal,
        gateType: airportGates.type,
        boardingStartTime: gateAssignments.boardingStartTime,
        boardingEndTime: gateAssignments.boardingEndTime,
        occupiedFrom: gateAssignments.occupiedFrom,
        occupiedUntil: gateAssignments.occupiedUntil,
        status: gateAssignments.status,
        assignedAt: gateAssignments.assignedAt,
        previousGateId: gateAssignments.previousGateId,
        changeReason: gateAssignments.changeReason,
      })
      .from(gateAssignments)
      .innerJoin(airportGates, eq(gateAssignments.gateId, airportGates.id))
      .where(
        and(
          eq(gateAssignments.flightId, flightId),
          or(
            eq(gateAssignments.status, "assigned"),
            eq(gateAssignments.status, "boarding")
          )
        )
      )
      .limit(1);

    return result.length > 0 ? result[0] : null;
  } catch (error) {
    console.error("Error getting flight gate:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get flight gate",
    });
  }
}

/**
 * Get gate schedule for an airport on a specific date
 */
export async function getGateSchedule(input: GateScheduleInput) {
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    // Get start and end of the day
    const startOfDay = new Date(input.date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(input.date);
    endOfDay.setHours(23, 59, 59, 999);

    // Get all gates at this airport with their assignments for the day
    const gates = await database
      .select()
      .from(airportGates)
      .where(eq(airportGates.airportId, input.airportId))
      .orderBy(asc(airportGates.terminal), asc(airportGates.gateNumber));

    // Get assignments for the day
    const assignments = await database
      .select({
        id: gateAssignments.id,
        gateId: gateAssignments.gateId,
        flightId: gateAssignments.flightId,
        flightNumber: flights.flightNumber,
        departureTime: flights.departureTime,
        arrivalTime: flights.arrivalTime,
        flightStatus: flights.status,
        boardingStartTime: gateAssignments.boardingStartTime,
        boardingEndTime: gateAssignments.boardingEndTime,
        occupiedFrom: gateAssignments.occupiedFrom,
        occupiedUntil: gateAssignments.occupiedUntil,
        assignmentStatus: gateAssignments.status,
        assignedAt: gateAssignments.assignedAt,
      })
      .from(gateAssignments)
      .innerJoin(flights, eq(gateAssignments.flightId, flights.id))
      .where(
        and(
          gte(flights.departureTime, startOfDay),
          lte(flights.departureTime, endOfDay),
          ne(gateAssignments.status, "cancelled"),
          ne(gateAssignments.status, "changed")
        )
      )
      .orderBy(asc(flights.departureTime));

    // Get origin airport info
    const [airport] = await database
      .select()
      .from(airports)
      .where(eq(airports.id, input.airportId))
      .limit(1);

    // Group assignments by gate
    const gateSchedule = gates.map(gate => {
      const gateAssignmentsList = assignments.filter(a => a.gateId === gate.id);
      return {
        ...gate,
        amenities: gate.amenities ? JSON.parse(gate.amenities) : [],
        assignments: gateAssignmentsList,
      };
    });

    return {
      airport,
      date: input.date,
      gates: gateSchedule,
    };
  } catch (error) {
    console.error("Error getting gate schedule:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get gate schedule",
    });
  }
}

/**
 * Send notifications for gate change
 */
export async function notifyGateChange(
  flightId: number,
  oldGateNumber: string,
  newGateNumber: string,
  newTerminal: string | null
) {
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    // Get flight info
    const [flight] = await database
      .select()
      .from(flights)
      .where(eq(flights.id, flightId))
      .limit(1);

    if (!flight) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Flight not found",
      });
    }

    // Get all bookings for this flight
    const flightBookings = await database
      .select({
        bookingId: bookings.id,
        userId: bookings.userId,
        bookingReference: bookings.bookingReference,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.flightId, flightId),
          or(eq(bookings.status, "confirmed"), eq(bookings.status, "pending"))
        )
      );

    // Send notifications to each user
    const notifications = [];
    for (const booking of flightBookings) {
      const terminalInfo = newTerminal ? ` Terminal ${newTerminal}` : "";
      const notification = await createNotification(
        booking.userId,
        "flight",
        "Gate Change Alert",
        `Your flight ${flight.flightNumber} gate has changed from ${oldGateNumber} to ${newGateNumber}${terminalInfo}. Please proceed to the new gate.`,
        {
          flightId,
          flightNumber: flight.flightNumber,
          oldGate: oldGateNumber,
          newGate: newGateNumber,
          terminal: newTerminal,
          bookingReference: booking.bookingReference,
          link: `/my-bookings`,
        }
      );
      notifications.push(notification);
    }

    // Update notification sent timestamp
    await database
      .update(gateAssignments)
      .set({ notificationSentAt: new Date() })
      .where(
        and(
          eq(gateAssignments.flightId, flightId),
          eq(gateAssignments.status, "assigned")
        )
      );

    console.info(
      `[Gate] Sent gate change notifications to ${notifications.length} users for flight ${flight.flightNumber}`
    );

    return { notificationsSent: notifications.length };
  } catch (error) {
    console.error("Error sending gate change notifications:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to send gate change notifications",
    });
  }
}

// ============================================================================
// Admin Statistics Functions
// ============================================================================

/**
 * Get gate statistics for admin dashboard
 */
export async function getGateStats(airportId?: number) {
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    // Build base condition
    const baseCondition = airportId
      ? eq(airportGates.airportId, airportId)
      : sql`1=1`;

    // Get total gates
    const [totalResult] = await database
      .select({ count: count() })
      .from(airportGates)
      .where(baseCondition);

    // Get available gates
    const [availableResult] = await database
      .select({ count: count() })
      .from(airportGates)
      .where(and(baseCondition, eq(airportGates.status, "available")));

    // Get occupied gates
    const [occupiedResult] = await database
      .select({ count: count() })
      .from(airportGates)
      .where(and(baseCondition, eq(airportGates.status, "occupied")));

    // Get gates under maintenance
    const [maintenanceResult] = await database
      .select({ count: count() })
      .from(airportGates)
      .where(and(baseCondition, eq(airportGates.status, "maintenance")));

    // Get today's assignments count
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [todayAssignmentsResult] = await database
      .select({ count: count() })
      .from(gateAssignments)
      .where(
        and(
          gte(gateAssignments.assignedAt, today),
          lte(gateAssignments.assignedAt, tomorrow)
        )
      );

    // Get gate change count today
    const [gateChangesResult] = await database
      .select({ count: count() })
      .from(gateAssignments)
      .where(
        and(
          eq(gateAssignments.status, "changed"),
          gte(gateAssignments.updatedAt, today),
          lte(gateAssignments.updatedAt, tomorrow)
        )
      );

    return {
      totalGates: totalResult?.count ?? 0,
      availableGates: availableResult?.count ?? 0,
      occupiedGates: occupiedResult?.count ?? 0,
      maintenanceGates: maintenanceResult?.count ?? 0,
      todayAssignments: todayAssignmentsResult?.count ?? 0,
      todayGateChanges: gateChangesResult?.count ?? 0,
    };
  } catch (error) {
    console.error("Error getting gate stats:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get gate statistics",
    });
  }
}

/**
 * Delete a gate (admin only)
 */
export async function deleteGate(gateId: number) {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  return await db.transaction(tx => removeGate(tx, gateId));
}
