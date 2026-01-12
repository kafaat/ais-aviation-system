import { TRPCError } from "@trpc/server";
import { db } from "../db";
import { bookingStatusHistory, isValidTransition } from "../../drizzle/booking-status-history-schema";
import { logBookingEvent } from "./audit.service";

/**
 * Booking State Machine Service
 * Manages booking status transitions with validation and audit trail
 */

export type BookingStatus = 
  | "initiated"
  | "reserved"
  | "paid"
  | "ticketed"
  | "checked_in"
  | "boarded"
  | "flown"
  | "expired"
  | "payment_failed"
  | "cancelled"
  | "refunded"
  | "no_show";

export interface StatusTransitionInput {
  bookingId: number;
  newStatus: BookingStatus;
  reason?: string;
  notes?: string;
  actorId?: number;
  actorType: "user" | "admin" | "system";
  actorRole?: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Get current status of a booking
 */
export async function getCurrentBookingStatus(bookingId: number): Promise<BookingStatus | null> {
  const history = await db
    .select()
    .from(bookingStatusHistory)
    .where(eq(bookingStatusHistory.bookingId, bookingId))
    .orderBy(desc(bookingStatusHistory.createdAt))
    .limit(1);
  
  if (history.length === 0) {
    return null;
  }
  
  return history[0].newStatus as BookingStatus;
}

/**
 * Get status history for a booking
 */
export async function getBookingStatusHistory(bookingId: number) {
  return await db
    .select()
    .from(bookingStatusHistory)
    .where(eq(bookingStatusHistory.bookingId, bookingId))
    .orderBy(desc(bookingStatusHistory.createdAt));
}

/**
 * Transition booking to a new status
 * Validates transition and creates audit trail
 */
export async function transitionBookingStatus(input: StatusTransitionInput): Promise<void> {
  try {
    // Get current status
    const currentStatus = await getCurrentBookingStatus(input.bookingId);
    
    // Validate transition
    if (!isValidTransition(currentStatus, input.newStatus)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Invalid status transition from ${currentStatus || 'null'} to ${input.newStatus}`,
      });
    }
    
    // Create status history record
    await db.insert(bookingStatusHistory).values({
      bookingId: input.bookingId,
      oldStatus: currentStatus,
      newStatus: input.newStatus,
      reason: input.reason,
      notes: input.notes,
      actorId: input.actorId,
      actorType: input.actorType,
      actorRole: input.actorRole,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    });
    
    // Log to audit trail
    await logBookingEvent(
      "BOOKING_STATUS_CHANGED",
      input.bookingId,
      input.actorId || 0,
      input.actorRole || "system",
      { status: currentStatus },
      { status: input.newStatus, reason: input.reason },
      input.ipAddress,
      input.userAgent
    );
    
    console.log(`[State Machine] Booking ${input.bookingId} transitioned from ${currentStatus} to ${input.newStatus}`);
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to transition booking status",
    });
  }
}

/**
 * Initialize booking status (first transition)
 */
export async function initializeBookingStatus(
  bookingId: number,
  actorId: number,
  actorType: "user" | "admin" | "system" = "user",
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  await transitionBookingStatus({
    bookingId,
    newStatus: "initiated",
    reason: "Booking created",
    actorId,
    actorType,
    ipAddress,
    userAgent,
  });
}

/**
 * Mark booking as reserved (seats held)
 */
export async function reserveBooking(
  bookingId: number,
  actorId: number,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  await transitionBookingStatus({
    bookingId,
    newStatus: "reserved",
    reason: "Seats reserved, pending payment",
    actorId,
    actorType: "user",
    ipAddress,
    userAgent,
  });
}

/**
 * Mark booking as paid
 */
export async function markBookingPaid(
  bookingId: number,
  paymentIntentId: string,
  actorId: number,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  await transitionBookingStatus({
    bookingId,
    newStatus: "paid",
    reason: "Payment successful",
    notes: `Payment Intent: ${paymentIntentId}`,
    actorId,
    actorType: "user",
    ipAddress,
    userAgent,
  });
}

/**
 * Mark booking payment as failed
 */
export async function markBookingPaymentFailed(
  bookingId: number,
  errorMessage: string,
  actorId: number,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  await transitionBookingStatus({
    bookingId,
    newStatus: "payment_failed",
    reason: "Payment failed",
    notes: errorMessage,
    actorId,
    actorType: "system",
    ipAddress,
    userAgent,
  });
}

/**
 * Cancel booking
 */
export async function cancelBooking(
  bookingId: number,
  reason: string,
  actorId: number,
  actorType: "user" | "admin" = "user",
  actorRole?: string,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  await transitionBookingStatus({
    bookingId,
    newStatus: "cancelled",
    reason,
    actorId,
    actorType,
    actorRole,
    ipAddress,
    userAgent,
  });
}

/**
 * Mark booking as expired (reservation timeout)
 */
export async function expireBooking(
  bookingId: number,
  reason: string = "Reservation expired"
): Promise<void> {
  await transitionBookingStatus({
    bookingId,
    newStatus: "expired",
    reason,
    actorType: "system",
  });
}

// Import statements for db operations
import { eq, desc } from "drizzle-orm";
