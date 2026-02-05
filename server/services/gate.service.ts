import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  airportGates,
  gateAssignments,
  flights,
  airports,
  bookings,
  users,
} from "../../drizzle/schema";
import { eq, and, or, gte, lte, desc, asc, ne, sql, count } from "drizzle-orm";
import {
  createNotification,
  notifyFlightStatusUpdate,
} from "./notification.service";

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
  flightId: number;
  gateId: number;
  boardingStartTime?: Date;
  boardingEndTime?: Date;
  assignedBy?: number;
}

export interface UpdateGateAssignmentInput {
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

    const insertId = (result as any).insertId;
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
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    await database
      .update(airportGates)
      .set({
        status: input.status,
        updatedAt: new Date(),
      })
      .where(eq(airportGates.id, input.gateId));

    console.info(
      `[Gate] Updated gate ${input.gateId} status to ${input.status}`
    );
    return { success: true };
  } catch (error) {
    console.error("Error updating gate status:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to update gate status",
    });
  }
}

// ============================================================================
// Gate Assignment Functions
// ============================================================================

/**
 * Get available gates at an airport for a specific date/time
 * Considers gate type (domestic/international) and current assignments
 */
export async function getAvailableGates(input: GetAvailableGatesInput) {
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    // Get base conditions for gate type
    const typeConditions = [];
    if (input.flightType === "domestic") {
      typeConditions.push(
        or(eq(airportGates.type, "domestic"), eq(airportGates.type, "both"))
      );
    } else if (input.flightType === "international") {
      typeConditions.push(
        or(
          eq(airportGates.type, "international"),
          eq(airportGates.type, "both")
        )
      );
    }

    // Calculate time window for checking conflicts (2 hours before/after)
    const windowStart = new Date(input.dateTime.getTime() - 2 * 60 * 60 * 1000);
    const windowEnd = new Date(input.dateTime.getTime() + 2 * 60 * 60 * 1000);

    // Get all gates at this airport that are available (not in maintenance)
    const allGates = await database
      .select()
      .from(airportGates)
      .where(
        and(
          eq(airportGates.airportId, input.airportId),
          ne(airportGates.status, "maintenance"),
          ...(typeConditions.length > 0 ? typeConditions : [])
        )
      )
      .orderBy(asc(airportGates.terminal), asc(airportGates.gateNumber));

    // Get current assignments within the time window
    const activeAssignments = await database
      .select({
        gateId: gateAssignments.gateId,
      })
      .from(gateAssignments)
      .innerJoin(flights, eq(gateAssignments.flightId, flights.id))
      .where(
        and(
          or(
            eq(gateAssignments.status, "assigned"),
            eq(gateAssignments.status, "boarding")
          ),
          gte(flights.departureTime, windowStart),
          lte(flights.departureTime, windowEnd)
        )
      );

    const occupiedGateIds = new Set(activeAssignments.map(a => a.gateId));

    // Filter out occupied gates
    const availableGates = allGates.filter(
      gate => !occupiedGateIds.has(gate.id)
    );

    return availableGates.map(gate => ({
      ...gate,
      amenities: gate.amenities ? JSON.parse(gate.amenities) : [],
    }));
  } catch (error) {
    console.error("Error getting available gates:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get available gates",
    });
  }
}

/**
 * Assign a gate to a flight
 */
export async function assignGate(input: AssignGateInput) {
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    // Check if flight exists
    const [flight] = await database
      .select()
      .from(flights)
      .where(eq(flights.id, input.flightId))
      .limit(1);

    if (!flight) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Flight not found",
      });
    }

    // Check if gate exists and is available
    const [gate] = await database
      .select()
      .from(airportGates)
      .where(eq(airportGates.id, input.gateId))
      .limit(1);

    if (!gate) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Gate not found",
      });
    }

    if (gate.status === "maintenance") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Gate is currently under maintenance",
      });
    }

    // Check for existing active assignment for this flight
    const [existingAssignment] = await database
      .select()
      .from(gateAssignments)
      .where(
        and(
          eq(gateAssignments.flightId, input.flightId),
          or(
            eq(gateAssignments.status, "assigned"),
            eq(gateAssignments.status, "boarding")
          )
        )
      )
      .limit(1);

    if (existingAssignment) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "Flight already has an active gate assignment",
      });
    }

    // Create the assignment
    const [result] = await database.insert(gateAssignments).values({
      flightId: input.flightId,
      gateId: input.gateId,
      boardingStartTime: input.boardingStartTime || null,
      boardingEndTime: input.boardingEndTime || null,
      assignedBy: input.assignedBy || null,
      status: "assigned",
    });

    // Update gate status to occupied
    await database
      .update(airportGates)
      .set({ status: "occupied", updatedAt: new Date() })
      .where(eq(airportGates.id, input.gateId));

    const insertId = (result as any).insertId;
    console.info(
      `[Gate] Assigned gate ${gate.gateNumber} to flight ${flight.flightNumber}`
    );

    return {
      id: insertId,
      flightId: input.flightId,
      gateId: input.gateId,
      gateNumber: gate.gateNumber,
      terminal: gate.terminal,
    };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("Error assigning gate:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to assign gate",
    });
  }
}

/**
 * Update gate assignment (change gate)
 */
export async function updateGateAssignment(input: UpdateGateAssignmentInput) {
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    // Get current assignment
    const [currentAssignment] = await database
      .select()
      .from(gateAssignments)
      .where(
        and(
          eq(gateAssignments.flightId, input.flightId),
          or(
            eq(gateAssignments.status, "assigned"),
            eq(gateAssignments.status, "boarding")
          )
        )
      )
      .limit(1);

    if (!currentAssignment) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "No active gate assignment found for this flight",
      });
    }

    // Check if new gate exists and is available
    const [newGate] = await database
      .select()
      .from(airportGates)
      .where(eq(airportGates.id, input.newGateId))
      .limit(1);

    if (!newGate) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "New gate not found",
      });
    }

    if (newGate.status === "maintenance") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "New gate is currently under maintenance",
      });
    }

    // Mark old assignment as changed
    await database
      .update(gateAssignments)
      .set({
        status: "changed",
        updatedAt: new Date(),
      })
      .where(eq(gateAssignments.id, currentAssignment.id));

    // Release old gate
    await database
      .update(airportGates)
      .set({ status: "available", updatedAt: new Date() })
      .where(eq(airportGates.id, currentAssignment.gateId));

    // Create new assignment
    const [result] = await database.insert(gateAssignments).values({
      flightId: input.flightId,
      gateId: input.newGateId,
      boardingStartTime: currentAssignment.boardingStartTime,
      boardingEndTime: currentAssignment.boardingEndTime,
      assignedBy: input.assignedBy || null,
      status: "assigned",
      previousGateId: currentAssignment.gateId,
      changeReason: input.changeReason || null,
    });

    // Update new gate status to occupied
    await database
      .update(airportGates)
      .set({ status: "occupied", updatedAt: new Date() })
      .where(eq(airportGates.id, input.newGateId));

    const insertId = (result as any).insertId;
    console.info(
      `[Gate] Changed gate for flight ${input.flightId} from gate ${currentAssignment.gateId} to gate ${input.newGateId}`
    );

    return {
      id: insertId,
      flightId: input.flightId,
      newGateId: input.newGateId,
      oldGateId: currentAssignment.gateId,
      newGateNumber: newGate.gateNumber,
      newTerminal: newGate.terminal,
    };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("Error updating gate assignment:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to update gate assignment",
    });
  }
}

/**
 * Release gate (when flight departs or is cancelled)
 */
export async function releaseGate(flightId: number) {
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    // Get current assignment
    const [currentAssignment] = await database
      .select()
      .from(gateAssignments)
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

    if (!currentAssignment) {
      return { success: true, message: "No active gate assignment to release" };
    }

    // Mark assignment as departed
    await database
      .update(gateAssignments)
      .set({
        status: "departed",
        updatedAt: new Date(),
      })
      .where(eq(gateAssignments.id, currentAssignment.id));

    // Release gate
    await database
      .update(airportGates)
      .set({ status: "available", updatedAt: new Date() })
      .where(eq(airportGates.id, currentAssignment.gateId));

    console.info(
      `[Gate] Released gate ${currentAssignment.gateId} from flight ${flightId}`
    );

    return { success: true };
  } catch (error) {
    console.error("Error releasing gate:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to release gate",
    });
  }
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
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    // Check if gate has active assignments
    const [activeAssignment] = await database
      .select()
      .from(gateAssignments)
      .where(
        and(
          eq(gateAssignments.gateId, gateId),
          or(
            eq(gateAssignments.status, "assigned"),
            eq(gateAssignments.status, "boarding")
          )
        )
      )
      .limit(1);

    if (activeAssignment) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot delete gate with active assignments",
      });
    }

    await database.delete(airportGates).where(eq(airportGates.id, gateId));

    console.info(`[Gate] Deleted gate ${gateId}`);
    return { success: true };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("Error deleting gate:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to delete gate",
    });
  }
}
