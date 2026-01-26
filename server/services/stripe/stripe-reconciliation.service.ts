/**
 * Stripe Reconciliation Service
 * 
 * Reconciles pending payments in DB with actual Stripe status.
 * Fixes: payment status, booking status, and ledger entries.
 * 
 * This is a P0.5 critical service for financial integrity.
 */

import Stripe from "stripe";
import { db } from "../../db";
import { bookings, payments, financialLedger, stripeEvents } from "../../../drizzle/schema";
import { eq, and, inArray, isNotNull, sql } from "drizzle-orm";

// ============================================================================
// Configuration
// ============================================================================

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const stripe = new Stripe(mustEnv("STRIPE_SECRET_KEY"), {
  apiVersion: "2024-06-20",
});

// ============================================================================
// Types
// ============================================================================

export interface ReconciliationResult {
  scanned: number;
  fixed: number;
  errors: number;
  details: Array<{
    bookingId: number;
    paymentIntentId: string | null;
    action: string;
    error?: string;
  }>;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
}

// ============================================================================
// Main Reconciliation Function
// ============================================================================

/**
 * Runs Stripe reconciliation for pending payments.
 * 
 * @param params.limit - Maximum number of records to process (default: 200)
 * @returns ReconciliationResult with details of all actions taken
 */
export async function runStripeReconciliation(params?: {
  limit?: number;
}): Promise<ReconciliationResult> {
  const limit = params?.limit ?? 200;
  const startedAt = new Date();

  const result: ReconciliationResult = {
    scanned: 0,
    fixed: 0,
    errors: 0,
    details: [],
    startedAt,
    completedAt: new Date(),
    durationMs: 0,
  };

  try {
    // 1) Fetch pending bookings with Stripe payment intent
    const pendingBookings = await db
      .select({
        id: bookings.id,
        userId: bookings.userId,
        status: bookings.status,
        paymentStatus: bookings.paymentStatus,
        stripePaymentIntentId: bookings.stripePaymentIntentId,
        totalAmount: bookings.totalAmount,
      })
      .from(bookings)
      .where(
        and(
          inArray(bookings.paymentStatus, ["pending"]),
          isNotNull(bookings.stripePaymentIntentId)
        )
      )
      .orderBy(bookings.updatedAt)
      .limit(limit);

    result.scanned = pendingBookings.length;

    // 2) Process each pending booking
    for (const booking of pendingBookings) {
      const piId = booking.stripePaymentIntentId!;

      try {
        // Fetch PaymentIntent from Stripe
        const pi = await stripe.paymentIntents.retrieve(piId, {
          expand: ["latest_charge"],
        });

        // Apply reconciliation logic based on Stripe status
        await reconcileBooking(booking, pi, result);
      } catch (error) {
        result.errors += 1;
        result.details.push({
          bookingId: booking.id,
          paymentIntentId: piId,
          action: "ERROR",
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  } catch (error) {
    console.error("[Reconciliation] Fatal error:", error);
    throw error;
  }

  result.completedAt = new Date();
  result.durationMs = result.completedAt.getTime() - startedAt.getTime();

  return result;
}

// ============================================================================
// Reconciliation Logic
// ============================================================================

async function reconcileBooking(
  booking: {
    id: number;
    userId: number;
    status: string;
    paymentStatus: string;
    stripePaymentIntentId: string | null;
    totalAmount: number;
  },
  pi: Stripe.PaymentIntent,
  result: ReconciliationResult
): Promise<void> {
  const piId = pi.id;

  switch (pi.status) {
    case "succeeded":
      await handleSucceeded(booking, pi, result);
      break;

    case "canceled":
      await handleCanceled(booking, pi, result);
      break;

    case "requires_payment_method":
      await handleFailed(booking, pi, result);
      break;

    case "processing":
    case "requires_action":
    case "requires_confirmation":
      // Still in progress, no action needed
      result.details.push({
        bookingId: booking.id,
        paymentIntentId: piId,
        action: `NO_CHANGE (Stripe status: ${pi.status})`,
      });
      break;

    default:
      result.details.push({
        bookingId: booking.id,
        paymentIntentId: piId,
        action: `UNKNOWN_STATUS (${pi.status})`,
      });
  }
}

/**
 * Handle succeeded payment - update booking to confirmed and create ledger entry
 */
async function handleSucceeded(
  booking: { id: number; userId: number; totalAmount: number; stripePaymentIntentId: string | null },
  pi: Stripe.PaymentIntent,
  result: ReconciliationResult
): Promise<void> {
  const chargeId = typeof pi.latest_charge === "object" ? pi.latest_charge?.id : pi.latest_charge;

  await db.transaction(async (tx) => {
    // 1) Update booking status
    await tx
      .update(bookings)
      .set({
        status: "confirmed",
        paymentStatus: "paid",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(bookings.id, booking.id),
          inArray(bookings.status, ["pending"]),
          inArray(bookings.paymentStatus, ["pending"])
        )
      );

    // 2) Get last balance for this booking
    const lastEntry = await tx
      .select({ balanceAfter: financialLedger.balanceAfter })
      .from(financialLedger)
      .where(eq(financialLedger.bookingId, booking.id))
      .orderBy(sql`${financialLedger.createdAt} DESC`)
      .limit(1);

    const balanceBefore = lastEntry[0]?.balanceAfter ?? "0.00";
    const amount = (booking.totalAmount / 100).toFixed(2);
    const balanceAfter = (parseFloat(balanceBefore) + parseFloat(amount)).toFixed(2);

    // 3) Create ledger entry (with uniqueness check)
    const existingLedger = await tx
      .select({ id: financialLedger.id })
      .from(financialLedger)
      .where(
        and(
          eq(financialLedger.bookingId, booking.id),
          eq(financialLedger.type, "charge"),
          eq(financialLedger.stripePaymentIntentId, pi.id)
        )
      )
      .limit(1);

    if (existingLedger.length === 0) {
      await tx.insert(financialLedger).values({
        bookingId: booking.id,
        userId: booking.userId,
        type: "charge",
        amount: amount,
        currency: pi.currency.toUpperCase(),
        stripePaymentIntentId: pi.id,
        stripeChargeId: chargeId ?? null,
        description: `Payment for booking #${booking.id} (Reconciliation)`,
        balanceBefore: balanceBefore,
        balanceAfter: balanceAfter,
        transactionDate: new Date(),
      });
    }

    // 4) Update payment record if exists
    await tx
      .update(payments)
      .set({
        status: "completed",
        updatedAt: new Date(),
      })
      .where(eq(payments.bookingId, booking.id));
  });

  result.fixed += 1;
  result.details.push({
    bookingId: booking.id,
    paymentIntentId: pi.id,
    action: "MARK_SUCCEEDED + LEDGER + CONFIRM_BOOKING",
  });
}

/**
 * Handle canceled payment - update booking to cancelled
 */
async function handleCanceled(
  booking: { id: number; stripePaymentIntentId: string | null },
  pi: Stripe.PaymentIntent,
  result: ReconciliationResult
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(bookings)
      .set({
        status: "cancelled",
        paymentStatus: "failed",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(bookings.id, booking.id),
          inArray(bookings.status, ["pending"])
        )
      );

    await tx
      .update(payments)
      .set({
        status: "failed",
        updatedAt: new Date(),
      })
      .where(eq(payments.bookingId, booking.id));
  });

  result.fixed += 1;
  result.details.push({
    bookingId: booking.id,
    paymentIntentId: pi.id,
    action: "MARK_CANCELLED",
  });
}

/**
 * Handle failed payment - update booking and payment to failed
 */
async function handleFailed(
  booking: { id: number; stripePaymentIntentId: string | null },
  pi: Stripe.PaymentIntent,
  result: ReconciliationResult
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(bookings)
      .set({
        status: "cancelled",
        paymentStatus: "failed",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(bookings.id, booking.id),
          inArray(bookings.status, ["pending"])
        )
      );

    await tx
      .update(payments)
      .set({
        status: "failed",
        updatedAt: new Date(),
      })
      .where(eq(payments.bookingId, booking.id));
  });

  result.fixed += 1;
  result.details.push({
    bookingId: booking.id,
    paymentIntentId: pi.id,
    action: "MARK_FAILED + BOOKING_FAILED",
  });
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get reconciliation statistics for monitoring
 */
export async function getReconciliationStats(): Promise<{
  pendingPayments: number;
  lastReconciliationAt: Date | null;
}> {
  const pending = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(bookings)
    .where(
      and(
        eq(bookings.paymentStatus, "pending"),
        isNotNull(bookings.stripePaymentIntentId)
      )
    );

  return {
    pendingPayments: pending[0]?.count ?? 0,
    lastReconciliationAt: null, // TODO: Store in a settings table
  };
}
