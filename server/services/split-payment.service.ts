/**
 * Split Payment Service
 * Handles splitting booking payments among multiple payers
 */

import { TRPCError } from "@trpc/server";
import { eq, and, sql } from "drizzle-orm";
import { getDb } from "../db";
import { stripe } from "../stripe";
import {
  paymentSplits,
  bookings,
  flights,
  airports,
  InsertPaymentSplit,
} from "../../drizzle/schema";
import { sendSplitPaymentRequest } from "./email.service";
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

  // Validate booking exists and is pending payment
  const [booking] = await db
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!booking) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Booking not found",
    });
  }

  if (booking.paymentStatus === "paid") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Booking is already paid",
    });
  }

  // Check if split payment already exists for this booking
  const existingSplits = await db
    .select()
    .from(paymentSplits)
    .where(
      and(
        eq(paymentSplits.bookingId, bookingId),
        sql`${paymentSplits.status} NOT IN ('cancelled', 'expired')`
      )
    );

  if (existingSplits.length > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Split payment already exists for this booking. Cancel existing splits first.",
    });
  }

  // Validate splits
  if (splits.length < 2) {
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
    if (split.amount < MIN_SPLIT_AMOUNT) {
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
    const percentage = ((split.amount / booking.totalAmount) * 100).toFixed(2);
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

    const result = await db.insert(paymentSplits).values(splitData);
    const insertId = Number(
      (result as unknown as { insertId: number }).insertId
    );
    splitIds.push(insertId);
  }

  return { splitIds, totalAmount: booking.totalAmount };
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

  const paidSplits = splits.filter(s => s.status === "paid");
  const paidAmount = paidSplits.reduce((sum, s) => sum + s.amount, 0);
  const pendingAmount = booking.totalAmount - paidAmount;

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
    allPaid: paidSplits.length === splits.length,
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

  if (split.status === "paid") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This split is already paid",
    });
  }

  if (split.status === "cancelled") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This split has been cancelled",
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
    // Update split status to email_sent
    await db
      .update(paymentSplits)
      .set({
        status: "email_sent",
        emailSentAt: new Date(),
      })
      .where(eq(paymentSplits.id, splitId));
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

  // Check if expired
  if (split.expiresAt && new Date() > split.expiresAt) {
    // Update status to expired
    await db
      .update(paymentSplits)
      .set({ status: "expired" })
      .where(eq(paymentSplits.id, split.id));

    return null;
  }

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
  };
}

/**
 * Process payment for a split using Stripe checkout
 */
export async function processPayerPayment(
  paymentToken: string
): Promise<{ sessionId: string; url: string | null }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [split] = await db
    .select()
    .from(paymentSplits)
    .where(eq(paymentSplits.paymentToken, paymentToken))
    .limit(1);

  if (!split) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Payment not found",
    });
  }

  if (split.status === "paid") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This payment has already been completed",
    });
  }

  if (split.status === "cancelled" || split.status === "expired") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This payment request has been cancelled or expired",
    });
  }

  // Check expiration
  if (split.expiresAt && new Date() > split.expiresAt) {
    await db
      .update(paymentSplits)
      .set({ status: "expired" })
      .where(eq(paymentSplits.id, split.id));

    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This payment request has expired",
    });
  }

  // Get booking details
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

  // Create Stripe checkout session
  const baseUrl = process.env.FRONTEND_URL || "http://localhost:3000";

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "sar",
          product_data: {
            name: `Split Payment - Booking ${booking.bookingReference}`,
            description: `Your share of flight booking ${booking.bookingReference}`,
          },
          unit_amount: split.amount,
        },
        quantity: 1,
      },
    ],
    mode: "payment",
    success_url: `${baseUrl}/pay/${paymentToken}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/pay/${paymentToken}?cancelled=true`,
    customer_email: split.payerEmail,
    metadata: {
      splitId: split.id.toString(),
      bookingId: split.bookingId.toString(),
      paymentToken,
      type: "split_payment",
    },
  });

  // Update split with checkout session ID
  await db
    .update(paymentSplits)
    .set({ stripeCheckoutSessionId: session.id })
    .where(eq(paymentSplits.id, split.id));

  return {
    sessionId: session.id,
    url: session.url,
  };
}

/**
 * Mark a split payment as paid (called from webhook)
 * Uses a transaction to atomically mark the split as paid, check if all splits
 * are paid, and update the booking status if so.
 */
export async function markSplitPaid(
  splitId: number,
  paymentIntentId: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.transaction(async tx => {
    // Mark this split as paid
    await tx
      .update(paymentSplits)
      .set({
        status: "paid",
        stripePaymentIntentId: paymentIntentId,
        paidAt: new Date(),
      })
      .where(eq(paymentSplits.id, splitId));

    // Re-fetch the split to get its bookingId
    const [split] = await tx
      .select()
      .from(paymentSplits)
      .where(eq(paymentSplits.id, splitId))
      .limit(1);

    if (split) {
      // Check if all active splits for this booking are now paid
      const activeSplits = await tx
        .select()
        .from(paymentSplits)
        .where(
          and(
            eq(paymentSplits.bookingId, split.bookingId),
            sql`${paymentSplits.status} NOT IN ('cancelled', 'expired')`
          )
        );

      const allPaid =
        activeSplits.length > 0 && activeSplits.every(s => s.status === "paid");

      if (allPaid) {
        // Update booking status to confirmed
        await tx
          .update(bookings)
          .set({
            paymentStatus: "paid",
            status: "confirmed",
          })
          .where(eq(bookings.id, split.bookingId));
      }
    }
  });
}

/**
 * Cancel a specific split payment
 */
export async function cancelSplit(splitId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

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

  if (split.status === "paid") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cannot cancel a paid split",
    });
  }

  await db
    .update(paymentSplits)
    .set({ status: "cancelled" })
    .where(eq(paymentSplits.id, splitId));
}

/**
 * Cancel all splits for a booking
 */
export async function cancelAllSplits(bookingId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Check if any splits are already paid
  const paidSplits = await db
    .select()
    .from(paymentSplits)
    .where(
      and(
        eq(paymentSplits.bookingId, bookingId),
        eq(paymentSplits.status, "paid")
      )
    );

  if (paidSplits.length > 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Cannot cancel split payment - some payments have already been made",
    });
  }

  await db
    .update(paymentSplits)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(paymentSplits.bookingId, bookingId),
        sql`${paymentSplits.status} NOT IN ('paid', 'cancelled')`
      )
    );
}

/**
 * Check if all splits for a booking are paid
 */
export async function checkAllPaid(bookingId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const splits = await db
    .select()
    .from(paymentSplits)
    .where(
      and(
        eq(paymentSplits.bookingId, bookingId),
        sql`${paymentSplits.status} NOT IN ('cancelled', 'expired')`
      )
    );

  if (splits.length === 0) {
    return false;
  }

  return splits.every(s => s.status === "paid");
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
  const db = await getDb();
  if (!db) throw new Error("Database not available");

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

  if (split.status === "paid") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This split is already paid",
    });
  }

  if (split.status === "cancelled" || split.status === "expired") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This split has been cancelled or expired",
    });
  }

  // Reset status to pending so sendPaymentRequest will work
  if (split.status === "email_sent" || split.status === "failed") {
    await db
      .update(paymentSplits)
      .set({ status: "pending" })
      .where(eq(paymentSplits.id, splitId));
  }

  return await sendPaymentRequest(splitId);
}
