import {
  transitionFlight,
  flightBookingCondition,
} from "./flight-state.service";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { flights, bookings, flightStatusHistory } from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";

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
}): Promise<{ success: boolean; refundedBookings: number }> {
  try {
    const database = await getDb();
    if (!database)
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Database not available",
      });

    const { flightId, reason } = params;

    // Get flight details first (before updating status)
    const [flight] = await database
      .select()
      .from(flights)
      .where(eq(flights.id, flightId))
      .limit(1);

    if (!flight) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
    }

    // Update flight status to cancelled (this will send status change emails)
    await updateFlightStatus({
      flightId,
      status: "cancelled",
      reason,
    });

    // Get all paid bookings for this flight
    const paidBookings = await database
      .select()
      .from(bookings)
      .where(
        and(
          flightBookingCondition(flightId),
          eq(bookings.paymentStatus, "paid")
        )
      );

    // Request actual provider refunds. Webhooks settle money and release inventory.
    // A missing payment reference or provider failure remains visible to the caller.
    const { stripe } = await import("../stripe");
    let refundedCount = 0;
    for (const booking of paidBookings) {
      if (!booking.stripePaymentIntentId)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Booking ${booking.id} needs refund reconciliation for its original payment method`,
        });
      const refund = await stripe.refunds.create(
        {
          payment_intent: booking.stripePaymentIntentId,
          reason: "requested_by_customer",
          metadata: {
            bookingId: String(booking.id),
            flightId: String(flightId),
          },
        },
        { idempotencyKey: `flight-cancel:${flightId}:booking:${booking.id}` }
      );
      if (refund.status === "succeeded") refundedCount++;
      else
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Refund ${refund.id} is ${refund.status}; completion is pending provider confirmation`,
        });
    }

    return {
      success: true,
      refundedBookings: refundedCount,
    };
  } catch (error) {
    console.error("Error cancelling flight and processing refunds:", error);
    throw error;
  }
}
