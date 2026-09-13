import {
  transitionFlight,
  flightBookingCondition,
} from "./flight-state.service";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { flights, bookings, flightStatusHistory } from "../../drizzle/schema";
import { eq, desc } from "drizzle-orm";

/**
 * Flight Status Update Service
 * Handles flight status changes and notifications
 */

export type FlightStatus = "scheduled" | "delayed" | "cancelled" | "completed";

export interface FlightStatusUpdate {
  flightId: number;
  status: FlightStatus;
  delayMinutes?: number;
  reason?: string;
  adminUserId?: number;
}

/**
 * Update flight status and notify affected passengers
 */
export async function updateFlightStatus(
  update: FlightStatusUpdate
): Promise<{ success: boolean; affectedBookings: number }> {
  const db = getDb();
  if (!db) throw new Error("Database unavailable");
  return await db.transaction(tx => transitionFlight(tx, update));
}

/**
 * Get flight status history with all changes
 */
export async function getFlightStatusHistory(flightId: number) {
  try {
    const database = await getDb();
    if (!database)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Database not available",
      });

    const [flight] = await database
      .select()
      .from(flights)
      .where(eq(flights.id, flightId))
      .limit(1);

    if (!flight) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
    }

    // Get all status changes
    const history = await database
      .select()
      .from(flightStatusHistory)
      .where(eq(flightStatusHistory.flightId, flightId))
      .orderBy(desc(flightStatusHistory.createdAt));

    return {
      flightNumber: flight.flightNumber,
      currentStatus: flight.status,
      lastUpdated: flight.updatedAt,
      history,
    };
  } catch (error) {
    console.error("Error getting flight status history:", error);
    throw error;
  }
}

/**
 * Cancel flight and process refunds for all bookings
 */
export async function cancelFlightAndRefund(params: {
  flightId: number;
  reason: string;
  actorId?: number;
}) {
  const { requestFlightCancellation } =
    await import("./flight-cancellation.service");
  return await requestFlightCancellation(params);
}
