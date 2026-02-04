import { db } from "../db";
import {
  bookingStatusHistory,
  type InsertBookingStatusHistory,
} from "../../drizzle/schema";
import { logger } from "../_core/logger";

// Define all possible booking states
export type BookingStatus =
  | "initiated"
  | "pending"
  | "reserved"
  | "paid"
  | "confirmed"
  | "checked_in"
  | "boarded"
  | "completed"
  | "cancelled"
  | "refunded"
  | "expired"
  | "payment_failed"
  | "no_show";

export type ActorType = "user" | "admin" | "system" | "payment_gateway";

// Define valid state transitions
const VALID_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  initiated: ["pending", "reserved", "expired", "cancelled"],
  pending: ["reserved", "paid", "expired", "cancelled", "payment_failed"],
  reserved: ["paid", "expired", "cancelled"],
  paid: ["confirmed", "cancelled", "refunded"],
  confirmed: ["checked_in", "cancelled", "refunded", "no_show"],
  checked_in: ["boarded", "cancelled", "no_show"],
  boarded: ["completed", "cancelled"],
  completed: ["refunded"],
  cancelled: ["refunded"],
  refunded: [], // Terminal state
  expired: [], // Terminal state
  payment_failed: ["pending", "cancelled"], // Can retry payment
  no_show: ["refunded"], // Can process refund for no-show
};

// Define state descriptions
export const STATUS_DESCRIPTIONS: Record<BookingStatus, string> = {
  initiated: "Booking process started",
  pending: "Awaiting payment",
  reserved: "Seats temporarily held",
  paid: "Payment received",
  confirmed: "Booking confirmed",
  checked_in: "Passenger checked in",
  boarded: "Passenger boarded",
  completed: "Flight completed",
  cancelled: "Booking cancelled",
  refunded: "Payment refunded",
  expired: "Booking expired (timeout)",
  payment_failed: "Payment failed",
  no_show: "Passenger no-show",
};

/**
 * Check if a state transition is valid
 */
export function isValidTransition(
  currentStatus: BookingStatus,
  newStatus: BookingStatus
): boolean {
  const allowedTransitions = VALID_TRANSITIONS[currentStatus];
  return allowedTransitions.includes(newStatus);
}

/**
 * Get all possible transitions from current status
 */
export function getValidTransitions(
  currentStatus: BookingStatus
): BookingStatus[] {
  return VALID_TRANSITIONS[currentStatus];
}

/**
 * Record a booking status change
 */
export async function recordStatusChange(data: {
  bookingId: number;
  bookingReference: string;
  previousStatus: BookingStatus | null;
  newStatus: BookingStatus;
  transitionReason?: string;
  changedBy?: number;
  changedByRole?: string;
  actorType?: ActorType;
  paymentIntentId?: string;
  metadata?: any;
}): Promise<void> {
  try {
    // Validate transition if there's a previous status
    const isValid = data.previousStatus
      ? isValidTransition(data.previousStatus, data.newStatus)
      : true; // First status is always valid

    if (!isValid) {
      logger.warn(
        {
          bookingId: data.bookingId,
          bookingReference: data.bookingReference,
          previousStatus: data.previousStatus,
          newStatus: data.newStatus,
        },
        "Invalid booking status transition attempted"
      );
    }

    const historyEntry: InsertBookingStatusHistory = {
      bookingId: data.bookingId,
      bookingReference: data.bookingReference,
      previousStatus: data.previousStatus || null,
      newStatus: data.newStatus,
      transitionReason: data.transitionReason || null,
      isValidTransition: isValid,
      changedBy: data.changedBy || null,
      changedByRole: data.changedByRole || null,
      actorType: data.actorType || "system",
      paymentIntentId: data.paymentIntentId || null,
      metadata: data.metadata ? JSON.stringify(data.metadata) : null,
    };

    await db.insert(bookingStatusHistory).values(historyEntry);

    logger.info(
      {
        bookingId: data.bookingId,
        bookingReference: data.bookingReference,
        previousStatus: data.previousStatus,
        newStatus: data.newStatus,
        isValid,
        actorType: data.actorType,
      },
      `Booking status changed: ${data.previousStatus || "none"} -> ${data.newStatus}`
    );
  } catch (error) {
    logger.error(
      {
        error,
        bookingId: data.bookingId,
        bookingReference: data.bookingReference,
      },
      "Failed to record booking status change"
    );
    // Don't throw - status history is important but shouldn't break the main operation
  }
}

/**
 * Get status history for a booking
 */
export async function getBookingStatusHistory(bookingId: number) {
  try {
    const history = await db
      .select()
      .from(bookingStatusHistory)
      .where(db.eq(bookingStatusHistory.bookingId, bookingId))
      .orderBy(db.desc(bookingStatusHistory.transitionedAt));

    return history.map(entry => ({
      ...entry,
      metadata: entry.metadata ? JSON.parse(entry.metadata) : null,
    }));
  } catch (error) {
    logger.error({ error, bookingId }, "Failed to get booking status history");
    throw error;
  }
}

/**
 * Helper function to transition booking status with validation
 */
export async function transitionBookingStatus(
  bookingId: number,
  bookingReference: string,
  currentStatus: BookingStatus,
  newStatus: BookingStatus,
  options: {
    reason?: string;
    changedBy?: number;
    changedByRole?: string;
    actorType?: ActorType;
    paymentIntentId?: string;
    metadata?: any;
  } = {}
): Promise<{ success: boolean; error?: string }> {
  // Validate transition
  if (!isValidTransition(currentStatus, newStatus)) {
    const error = `Invalid transition from ${currentStatus} to ${newStatus}`;
    logger.warn(
      { bookingId, bookingReference, currentStatus, newStatus },
      error
    );

    // Still record the attempted transition
    await recordStatusChange({
      bookingId,
      bookingReference,
      previousStatus: currentStatus,
      newStatus,
      transitionReason: `Invalid transition: ${options.reason || "No reason provided"}`,
      changedBy: options.changedBy,
      changedByRole: options.changedByRole,
      actorType: options.actorType,
      paymentIntentId: options.paymentIntentId,
      metadata: options.metadata,
    });

    return { success: false, error };
  }

  // Record the valid transition
  await recordStatusChange({
    bookingId,
    bookingReference,
    previousStatus: currentStatus,
    newStatus,
    transitionReason: options.reason,
    changedBy: options.changedBy,
    changedByRole: options.changedByRole,
    actorType: options.actorType,
    paymentIntentId: options.paymentIntentId,
    metadata: options.metadata,
  });

  return { success: true };
}

/**
 * Get booking state machine diagram (for documentation)
 */
export function getStateMachineDiagram(): string {
  return `
Booking State Machine:

INITIATED → PENDING → RESERVED → PAID → CONFIRMED → CHECKED_IN → BOARDED → COMPLETED
    ↓           ↓          ↓        ↓         ↓           ↓
 EXPIRED    EXPIRED    EXPIRED  CANCELLED  NO_SHOW   CANCELLED
                                   ↓           ↓
    PAYMENT_FAILED → PENDING    REFUNDED   REFUNDED
        ↓
    CANCELLED

States:
${Object.entries(STATUS_DESCRIPTIONS)
  .map(([status, desc]) => `  - ${status}: ${desc}`)
  .join("\n")}

Valid Transitions:
${Object.entries(VALID_TRANSITIONS)
  .map(([from, toList]) => `  ${from} → [${toList.join(", ")}]`)
  .join("\n")}
  `;
}
