/**
 * Split Payment Service
 * Handles splitting booking payments among multiple payers
 */

import { TRPCError } from "@trpc/server";
import { eq, and, sql, inArray } from "drizzle-orm";
import { getDb } from "../db";
import {
  paymentSplits,
  paymentReceipts,
  bookingRefundItems,
  bookings,
  flights,
  airports,
  InsertPaymentSplit,
} from "../../drizzle/schema";
import {
  assertNoActiveCheckout,
  assertNoActiveSplitPayment,
} from "./booking-checkout.service";
import {
  createSplitCheckout,
  cancelPaymentSplits,
  type SplitActor,
} from "./split-checkout.service";
import { assertTenantOperational } from "./tenant.service";
import { recordEvent } from "./outbox.service";
import { sendSplitPaymentRequest } from "./email.service";
import { assertNoCollectionReview } from "./booking-settlement.service";
import * as crypto from "crypto";

// ============================================================================
// Types
// ============================================================================

export interface SplitPayerInput {
  email: string;
  name: string;
  amount: number; // Amount in SAR cents
}

export interface InitiateSplitPaymentInput {
  bookingId: number;
  userId: number;
  splits: SplitPayerInput[];
  expirationDays?: number; // Days until payment requests expire (default: 7)
}

export interface SplitPaymentStatus {
  bookingId: number;
  bookingReference: string;
  totalAmount: number;
  splits: Array<{
    id: number;
    payerEmail: string;
    payerName: string;
    amount: number;
    percentage: string;
    status: string;
    paidAt: Date | null;
  }>;
  allPaid: boolean;
  paidCount: number;
  totalSplits: number;
  paidAmount: number;
  pendingAmount: number;
}

export interface PayerPaymentDetails {
  splitId: number;
  bookingReference: string;
  flightNumber: string;
  route: string;
  departureTime: Date;
  payerName: string;
  payerEmail: string;
  amount: number;
  status: string;
  expiresAt: Date | null;
  cancellation: {
    status: typeof bookingRefundItems.$inferSelect.status;
    refundAmount: number;
    cancellationFee: number;
  } | null;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_EXPIRATION_DAYS = 7;
export const MIN_SPLIT_AMOUNT = 100; // Minimum 1 SAR (100 cents)

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique payment token for secure payer access
 */
function generatePaymentToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Calculate expiration date for payment requests
 */
function calculateExpirationDate(days: number): Date {
  const expirationDate = new Date();
  expirationDate.setDate(expirationDate.getDate() + days);
  return expirationDate;
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Initiate a split payment for a booking
 * Creates payment split records for each payer and optionally sends emails
 */
export async function initiateSplitPayment(
  input: InitiateSplitPaymentInput
): Promise<{ splitIds: number[]; totalAmount: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const { bookingId, splits, expirationDays = DEFAULT_EXPIRATION_DAYS } = input;

  return db.transaction(async tx => {
    // All payment rails and invoice editors serialize on the owned booking.
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1)
      .for("update");

    if (!booking || booking.userId !== input.userId) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Booking not found",
      });
    }

    if (
      booking.status !== "pending" ||
      booking.paymentStatus !== "pending" ||
      booking.seatsReserved
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Booking is already paid",
      });
    }

    await assertTenantOperational(tx, booking.tenantId);
    await assertNoCollectionReview(tx, bookingId);
    await assertNoActiveCheckout(tx, booking);
    if (
      !Number.isInteger(expirationDays) ||
      expirationDays < 1 ||
      expirationDays > 30
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Expiration must be 1 to 30 whole days",
      });

    await assertNoActiveSplitPayment(tx, bookingId);

    // Validate splits
    if (splits.length < 2 || splits.length > 20) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "At least 2 payers are required for split payment",
      });
    }

    // Validate total amount matches booking
    const totalSplitAmount = splits.reduce((sum, s) => sum + s.amount, 0);
    if (totalSplitAmount !== booking.totalAmount) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Split amounts (${totalSplitAmount}) must equal booking total (${booking.totalAmount})`,
      });
    }

    // Validate minimum amounts
    for (const split of splits) {
      if (
        !Number.isSafeInteger(split.amount) ||
        split.amount < MIN_SPLIT_AMOUNT
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Each split must be at least ${MIN_SPLIT_AMOUNT / 100} SAR`,
        });
      }
    }

    const expiresAt = calculateExpirationDate(expirationDays);
    const splitIds: number[] = [];

    // Create split records
    for (const split of splits) {
      const percentage = ((split.amount / booking.totalAmount) * 100).toFixed(
        2
      );
      const paymentToken = generatePaymentToken();

      const splitData: InsertPaymentSplit = {
        bookingId,
        payerEmail: split.email,
        payerName: split.name,
        amount: split.amount,
        percentage,
        status: "pending",
        paymentToken,
        expiresAt,
      };

      const result = await tx.insert(paymentSplits).values(splitData);
      const insertId = Number(result[0].insertId);
      splitIds.push(insertId);
    }

    await recordEvent(tx, {
      aggregateType: "booking",
      aggregateId: bookingId,
      tenantId: booking.tenantId,
      eventType: "booking.split_payment_created",
      payload: { bookingId, splitIds, totalAmount: booking.totalAmount },
    });
    return { splitIds, totalAmount: booking.totalAmount };
  });
}

/**
 * Get the status of all payment splits for a booking
 */
export async function getSplitPaymentStatus(
  bookingId: number
): Promise<SplitPaymentStatus | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get booking info
  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!booking) {
    return null;
  }

  // Get all splits for this booking
  const splits = await db
    .select()
    .from(paymentSplits)
    .where(eq(paymentSplits.bookingId, bookingId));

  if (splits.length === 0) {
    return null;
  }

  const receipts = await db
    .select()
    .from(paymentReceipts)
    .where(
      and(
        eq(paymentReceipts.bookingId, bookingId),
        eq(paymentReceipts.kind, "split_payment")
      )
    );
  const active = splits.filter(
    s => !["cancelled", "expired"].includes(s.status)
  );
  const netFor = (split: typeof paymentSplits.$inferSelect) =>
    receipts
      .filter(
        r =>
          r.targetId === split.id &&
          r.paymentIntentId === split.stripePaymentIntentId &&
          r.settlementStatus === "applied"
      )
      .reduce((sum, r) => sum + Math.max(0, r.amount - r.refundedAmount), 0);
  const paidSplits = active.filter(
    s => s.status === "paid" && netFor(s) === s.amount
  );
  const paidAmount = active.reduce((sum, s) => sum + netFor(s), 0);
  const pendingAmount = Math.max(0, booking.totalAmount - paidAmount);

  return {
    bookingId,
    bookingReference: booking.bookingReference,
    totalAmount: booking.totalAmount,
    splits: splits.map(s => ({
      id: s.id,
      payerEmail: s.payerEmail,
      payerName: s.payerName,
      amount: s.amount,
      percentage: s.percentage,
      status: s.status,
      paidAt: s.paidAt,
    })),
    allPaid:
      booking.status === "confirmed" &&
      booking.paymentStatus === "paid" &&
      active.length >= 2 &&
      paidSplits.length === active.length &&
      paidAmount === booking.totalAmount,
    paidCount: paidSplits.length,
    totalSplits: splits.length,
    paidAmount,
    pendingAmount,
  };
}

/**
 * Send payment request email to a specific payer
 */
export async function sendPaymentRequest(splitId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get split with booking and flight details
  const [split] = await db
    .select()
    .from(paymentSplits)
    .where(eq(paymentSplits.id, splitId))
    .limit(1);

  if (!split) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Payment split not found",
    });
  }

  if (
    !["pending", "email_sent", "failed"].includes(split.status) ||
    (split.expiresAt && split.expiresAt.getTime() <= Date.now())
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Payment request is no longer payable",
    });
  }

  // Get booking and flight details for the email
  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, split.bookingId))
    .limit(1);

  if (!booking) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Booking not found",
    });
  }

  const [flight] = await db
    .select({
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      originCode: airports.code,
      originCity: airports.city,
      destinationCode: sql<string>`dest.code`,
      destinationCity: sql<string>`dest.city`,
    })
    .from(flights)
    .innerJoin(airports, eq(flights.originId, airports.id))
    .innerJoin(sql`airports as dest`, sql`${flights.destinationId} = dest.id`)
    .where(eq(flights.id, booking.flightId))
    .limit(1);

  // Generate payment URL
  const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";
  const paymentUrl = `${baseUrl}/pay/${split.paymentToken}`;

  // Send email
  const emailSent = await sendSplitPaymentRequest({
    payerName: split.payerName,
    payerEmail: split.payerEmail,
    bookingReference: booking.bookingReference,
    flightNumber: flight?.flightNumber || "N/A",
    route: flight
      ? `${flight.originCity} (${flight.originCode}) - ${flight.destinationCity} (${flight.destinationCode})`
      : "N/A",
    departureTime: flight?.departureTime || new Date(),
    amount: split.amount,
    paymentUrl,
    expiresAt: split.expiresAt || undefined,
  });

  if (emailSent) {
    await recordSplitEmailDelivery(splitId);
  }

  return emailSent;
}

/**
 * Get payment details for a payer using their token
 */
export async function getPayerPaymentDetails(
  paymentToken: string
): Promise<PayerPaymentDetails | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [split] = await db
    .select()
    .from(paymentSplits)
    .where(eq(paymentSplits.paymentToken, paymentToken))
    .limit(1);

  if (!split) {
    return null;
  }

  // Reading an expired link must never overwrite a concurrent paid state.
  if (split.expiresAt && new Date() > split.expiresAt) return null;

  // Get booking and flight details
  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, split.bookingId))
    .limit(1);

  if (!booking) {
    return null;
  }

  const [flight] = await db
    .select({
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      originCode: airports.code,
      originCity: airports.city,
      destinationCode: sql<string>`dest.code`,
      destinationCity: sql<string>`dest.city`,
    })
    .from(flights)
    .innerJoin(airports, eq(flights.originId, airports.id))
    .innerJoin(sql`airports as dest`, sql`${flights.destinationId} = dest.id`)
    .where(eq(flights.id, booking.flightId))
    .limit(1);

  const [refund] = await db
    .select()
    .from(bookingRefundItems)
    .where(
      and(
        eq(bookingRefundItems.splitId, split.id),
        eq(bookingRefundItems.bookingId, split.bookingId)
      )
    )
    .limit(1);
  return {
    splitId: split.id,
    bookingReference: booking.bookingReference,
    flightNumber: flight?.flightNumber || "N/A",
    route: flight
      ? `${flight.originCity} (${flight.originCode}) - ${flight.destinationCity} (${flight.destinationCode})`
      : "N/A",
    departureTime: flight?.departureTime || new Date(),
    payerName: split.payerName,
    payerEmail: split.payerEmail,
    amount: split.amount,
    status: split.status,
    expiresAt: split.expiresAt,
    cancellation: refund
      ? {
          status: refund.status,
          refundAmount: refund.refundAmount,
          cancellationFee: refund.collectedAmount - refund.refundAmount,
        }
      : null,
  };
}

/**
 * Process payment for a split using Stripe checkout
 */
export async function processPayerPayment(paymentToken: string) {
  return createSplitCheckout(paymentToken);
}

/**
 * Mark a split payment as paid (called from webhook)
 * Uses a transaction to atomically mark the split as paid, check if all splits
 * are paid, and update the booking status if so.
 */
export async function markSplitPaid(
  _splitId: number,
  _paymentIntentId: string
): Promise<never> {
  throw new Error("Use the provider-verified canonical settlement processor");
}

/**
 * Cancel a specific split payment
 */
export async function cancelSplit(
  splitId: number,
  actor: SplitActor
): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  const [split] = await db
    .select()
    .from(paymentSplits)
    .where(eq(paymentSplits.id, splitId))
    .limit(1);
  if (!split)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Payment split not found",
    });
  await cancelPaymentSplits({ bookingId: split.bookingId, splitId }, actor);
}

export async function cancelAllSplits(
  bookingId: number,
  actor: SplitActor
): Promise<void> {
  await cancelPaymentSplits({ bookingId }, actor);
}

export async function checkAllPaid(bookingId: number): Promise<boolean> {
  return (await getSplitPaymentStatus(bookingId))?.allPaid ?? false;
}

/** Email acknowledgement may update only a still-payable share. */
export async function recordSplitEmailDelivery(splitId: number) {
  const db = getDb();
  if (!db) throw new Error("Database not available");
  await db
    .update(paymentSplits)
    .set({ status: "email_sent", emailSentAt: new Date() })
    .where(
      and(
        eq(paymentSplits.id, splitId),
        inArray(paymentSplits.status, ["pending", "email_sent", "failed"])
      )
    );
}

/**
 * Get split payment by checkout session ID (for webhook processing)
 */
export async function getSplitByCheckoutSession(
  sessionId: string
): Promise<typeof paymentSplits.$inferSelect | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [split] = await db
    .select()
    .from(paymentSplits)
    .where(eq(paymentSplits.stripeCheckoutSessionId, sessionId))
    .limit(1);

  return split || null;
}

/**
 * Send payment requests to all pending payers
 */
export async function sendAllPaymentRequests(
  bookingId: number
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const pendingSplits = await db
    .select()
    .from(paymentSplits)
    .where(
      and(
        eq(paymentSplits.bookingId, bookingId),
        eq(paymentSplits.status, "pending")
      )
    );

  let sentCount = 0;
  for (const split of pendingSplits) {
    try {
      const sent = await sendPaymentRequest(split.id);
      if (sent) sentCount++;
    } catch (error) {
      console.error(
        `Failed to send payment request for split ${split.id}:`,
        error
      );
    }
  }

  return sentCount;
}

/**
 * Resend payment request email
 */
export async function resendPaymentRequest(splitId: number): Promise<boolean> {
  return sendPaymentRequest(splitId);
}
