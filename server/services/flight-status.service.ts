import { getDb } from "../db";
import {
  flights,
  bookings,
  users,
  airports,
  flightStatusHistory,
} from "../../drizzle/schema";
import { eq, and, desc } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";
import { sendFlightStatusChange } from "./email.service";

/**
 * Flight Status Update Service
 * Handles flight status changes and notifications
 */

export interface FlightStatusUpdate {
  flightId: number;
  status: "scheduled" | "delayed" | "cancelled" | "completed";
  delayMinutes?: number;
  reason?: string;
}

/**
 * Update flight status and notify affected passengers
 */
export async function updateFlightStatus(
  update: FlightStatusUpdate
): Promise<{ success: boolean; affectedBookings: number }> {
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    const { flightId, status, delayMinutes, reason } = update;

    // Get flight details first
    const [flight] = await database
      .select()
      .from(flights)
      .where(eq(flights.id, flightId))
      .limit(1);

    if (!flight) {
      throw new Error("Flight not found");
    }

    // Get current status before updating
    const oldStatus = flight.status;

    // Update flight status
    await database
      .update(flights)
      .set({ status, updatedAt: new Date() })
      .where(eq(flights.id, flightId));

    // Record status change in history
    await database.insert(flightStatusHistory).values({
      flightId,
      oldStatus,
      newStatus: status,
      delayMinutes,
      reason,
      changedBy: null, // TODO: Add admin user ID when available
    });

    // Get all bookings for this flight with flight and airport details
    const affectedBookings = await database
      .select({
        id: bookings.id,
        userId: bookings.userId,
        bookingReference: bookings.bookingReference,
        userEmail: users.email,
        userName: users.name,
      })
      .from(bookings)
      .innerJoin(users, eq(bookings.userId, users.id))
      .where(
        and(eq(bookings.flightId, flightId), eq(bookings.status, "confirmed"))
      );

    // Get origin and destination airports for email
    const [originAirport] = await database
      .select({ code: airports.code, city: airports.city })
      .from(airports)
      .where(eq(airports.id, flight.originId))
      .limit(1);

    const [destAirport] = await database
      .select({ code: airports.code, city: airports.city })
      .from(airports)
      .where(eq(airports.id, flight.destinationId))
      .limit(1);

    // Send notifications based on status change
    if (status === "delayed" || status === "cancelled") {
      const statusText = status === "delayed" ? "تأخرت" : "ألغيت";
      const delayText = delayMinutes ? ` لمدة ${delayMinutes} دقيقة` : "";
      const reasonText = reason ? `\nالسبب: ${reason}` : "";

      // Notify owner about the status change
      await notifyOwner({
        title: `تحديث حالة الرحلة ${flight.flightNumber}`,
        content: `الرحلة ${flight.flightNumber} ${statusText}${delayText}.\nعدد الحجوزات المتأثرة: ${affectedBookings.length}${reasonText}`,
      });

      // Send email notifications to all affected passengers
      for (const booking of affectedBookings) {
        if (booking.userEmail) {
          try {
            await sendFlightStatusChange({
              passengerName: booking.userName || "Passenger",
              passengerEmail: booking.userEmail,
              bookingReference: booking.bookingReference,
              flightNumber: flight.flightNumber,
              origin: `${originAirport?.city ?? "Unknown"} (${originAirport?.code ?? "?"})`,
              destination: `${destAirport?.city ?? "Unknown"} (${destAirport?.code ?? "?"})`,
              departureTime: flight.departureTime,
              oldStatus: "scheduled",
              newStatus: status,
              delayMinutes,
              reason,
            });
          } catch (emailError) {
            console.error(
              `[Flight Status] Error sending email to ${booking.userEmail}:`,
              emailError
            );
            // Continue with other emails even if one fails
          }
        }
      }

      console.log(
        `[Flight Status] ${affectedBookings.length} passengers notified about ${status} for flight ${flight.flightNumber}`
      );
    }

    return {
      success: true,
      affectedBookings: affectedBookings.length,
    };
  } catch (error) {
    console.error("Error updating flight status:", error);
    throw error;
  }
}

/**
 * Get flight status history with all changes
 */
export async function getFlightStatusHistory(flightId: number) {
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    const [flight] = await database
      .select()
      .from(flights)
      .where(eq(flights.id, flightId))
      .limit(1);

    if (!flight) {
      throw new Error("Flight not found");
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
    if (!database) throw new Error("Database not available");

    const { flightId, reason } = params;

    // Get flight details first (before updating status)
    const [flight] = await database
      .select()
      .from(flights)
      .where(eq(flights.id, flightId))
      .limit(1);

    if (!flight) {
      throw new Error("Flight not found");
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
        and(eq(bookings.flightId, flightId), eq(bookings.paymentStatus, "paid"))
      );

    // Update all bookings to cancelled and refunded
    let refundedCount = 0;
    for (const booking of paidBookings) {
      await database
        .update(bookings)
        .set({
          status: "cancelled",
          paymentStatus: "refunded",
          updatedAt: new Date(),
        })
        .where(eq(bookings.id, booking.id));

      refundedCount++;
    }

    // Notify owner
    await notifyOwner({
      title: `إلغاء الرحلة وإرجاع المبالغ`,
      content: `تم إلغاء الرحلة ${flightId} وإرجاع المبالغ لـ ${refundedCount} حجز.\nالسبب: ${reason}`,
    });

    return {
      success: true,
      refundedBookings: refundedCount,
    };
  } catch (error) {
    console.error("Error cancelling flight and processing refunds:", error);
    throw error;
  }
}
