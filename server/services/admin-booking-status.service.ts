import { TRPCError } from "@trpc/server";
import { asc, eq, inArray } from "drizzle-orm";
import { bookingSegments, bookings, flights } from "../../drizzle/schema";
import { getDb } from "../db";
import {
  auditBookingChange,
  bookingChangeAuditEvent,
  persistAuditLog,
} from "./audit.service";
import {
  BookingNotPendingError,
  cancelBookingResources,
} from "./booking-settlement.service";

/**
 * Administrative booking status changes (review finding R3, #355).
 *
 * The former command wrote the status column directly, so an administrator
 * could cancel a paid booking without a refund while its seats stayed
 * reserved, or mark an unpaid booking confirmed without any settlement. Every
 * transition now runs through the same rules as the product paths:
 *
 * - `cancelled`: only an unpaid booking is cancelled here, through the shared
 *   resource release (seats, holds, vouchers). A paid booking is refused with a
 *   pointer to the refund flow, which cancels and refunds together.
 * - `completed`: only a paid, confirmed booking whose every flight has
 *   completed; nothing else is "flown".
 * - `confirmed` and `pending`: refused. Confirmation is a settlement outcome
 *   and a booking never moves backwards.
 */
export type AdministeredBookingStatus =
  "pending" | "confirmed" | "cancelled" | "completed";

export type AdminActor = {
  id: number;
  role: string;
  sourceIp?: string;
  requestId?: string;
};

export async function administerBookingStatus(
  bookingId: number,
  status: AdministeredBookingStatus,
  actor: AdminActor
): Promise<{ success: true; previousStatus: string; status: string }> {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  if (status === "confirmed" || status === "pending")
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        status === "confirmed"
          ? "Confirmation is a settlement outcome; collect the payment through the checkout or reconciliation flow instead of setting the status"
          : "A booking never returns to pending",
    });

  const result = await db.transaction(async tx => {
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1)
      .for("update");
    if (!booking)
      throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
    const previousStatus = booking.status;
    if (previousStatus === status) return { previousStatus, changed: false };

    if (status === "cancelled") {
      if (booking.paymentStatus === "paid")
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "This booking is paid; cancel it through the refund flow (refunds.adminCreate), which refunds and cancels together and releases the seats",
        });
      try {
        await cancelBookingResources(
          tx,
          booking,
          "Administrator cancellation",
          actor.id
        );
      } catch (error) {
        if (error instanceof BookingNotPendingError)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: error.message,
          });
        throw error;
      }
      return { previousStatus, changed: true };
    }

    // status === "completed"
    if (previousStatus !== "confirmed" || booking.paymentStatus !== "paid")
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Only a paid, confirmed booking can be completed; it has not been flown",
      });
    const segments = await tx
      .select({ flightId: bookingSegments.flightId })
      .from(bookingSegments)
      .where(eq(bookingSegments.bookingId, booking.id))
      .orderBy(asc(bookingSegments.segmentOrder));
    const flightIds = segments.length
      ? segments.map(s => s.flightId)
      : [booking.flightId];
    const legs = await tx
      .select({ id: flights.id, status: flights.status })
      .from(flights)
      .where(inArray(flights.id, flightIds));
    if (
      legs.length !== new Set(flightIds).size ||
      legs.some(leg => leg.status !== "completed")
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Every flight of the itinerary must have completed before the booking is completed",
      });
    await tx
      .update(bookings)
      .set({ status: "completed", updatedAt: new Date() })
      .where(eq(bookings.id, booking.id));
    return {
      previousStatus,
      changed: true,
      announceCompletion: await persistAuditLog(
        tx,
        bookingChangeAuditEvent(
          booking.bookingReference,
          actor.id,
          actor.role,
          "modified",
          { status: previousStatus },
          { status },
          actor.sourceIp,
          actor.requestId
        )
      ),
    };
  });

  if (result.announceCompletion) result.announceCompletion();
  else if (result.changed && status === "cancelled")
    await auditBookingChange(
      bookingId,
      String(bookingId),
      actor.id,
      actor.role,
      "cancelled",
      { status: result.previousStatus },
      { status },
      actor.sourceIp,
      actor.requestId
    );

  return { success: true, previousStatus: result.previousStatus, status };
}
