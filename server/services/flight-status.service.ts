import { getDb } from "../db";
import { flights, bookings, users } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { notifyOwner } from "../_core/notification";

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

    // Update flight status
    await database
      .update(flights)
      .set({ status, updatedAt: new Date() })
      .where(eq(flights.id, flightId));

    // Get flight details
    const [flight] = await database
      .select()
      .from(flights)
      .where(eq(flights.id, flightId))
      .limit(1);

    if (!flight) {
      throw new Error("Flight not found");
    }

    // Get all bookings for this flight
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
        and(
          eq(bookings.flightId, flightId),
          eq(bookings.status, "confirmed")
        )
      );

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

      // In a real application, you would send emails/SMS to affected passengers here
      // For now, we'll just log it
      console.log(`[Flight Status] ${affectedBookings.length} passengers notified about ${status} for flight ${flight.flightNumber}`);
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
 * Get flight status history
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

    return {
      flightNumber: flight.flightNumber,
      currentStatus: flight.status,
      lastUpdated: flight.updatedAt,
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

    // Update flight status to cancelled
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
          eq(bookings.flightId, flightId),
          eq(bookings.paymentStatus, "paid")
        )
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
