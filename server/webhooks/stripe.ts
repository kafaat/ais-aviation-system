/**
 * Stripe Webhook Handler - Production-Grade
 * 
 * Features:
 * - De-duplication via stripeEvents table (processed=true only prevents)
 * - Transaction safety (rollback on failure)
 * - Financial ledger entries
 * - Proper error handling with retry support
 * 
 * @version 2.0.0
 * @date 2026-01-26
 */

import type { Request, Response } from "express";
import Stripe from "stripe";
import { stripe } from "../stripe";
import { getDb } from "../db";
import { 
  bookings, 
  flights, 
  airports, 
  users, 
  passengers,
  stripeEvents,
  financialLedger,
  bookingStatusHistory
} from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { sendBookingConfirmation } from "../services/email.service";
import { awardMilesForBooking } from "../services/loyalty.service";
import { generateETicketForPassenger } from "../services/eticket.service";

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

// Fail fast in production if webhook secret is missing
if (!webhookSecret && process.env.NODE_ENV === "production") {
  throw new Error("STRIPE_WEBHOOK_SECRET is required in production");
}

/**
 * Main Webhook Handler
 * 
 * Response codes:
 * - 200: Event processed successfully (Stripe stops retrying)
 * - 400: Invalid signature (Stripe stops retrying)
 * - 500: Processing error (Stripe will retry)
 */
export async function handleStripeWebhook(req: Request, res: Response) {
  const sig = req.headers["stripe-signature"];

  if (!sig || !webhookSecret) {
    console.error("[Webhook] Missing signature or webhook secret");
    return res.status(400).json({ 
      error: "Missing signature",
      retryable: false 
    });
  }

  let event: Stripe.Event;

  // 1. Verify signature
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err: any) {
    console.error(`[Webhook] Signature verification failed:`, err.message);
    return res.status(400).json({ 
      error: `Signature verification failed: ${err.message}`,
      retryable: false 
    });
  }

  // Handle test events
  if (event.id.startsWith("evt_test_")) {
    console.log("[Webhook] Test event detected, returning verification response");
    return res.json({ verified: true });
  }

  console.log(`[Webhook] Processing event: ${event.type} (${event.id})`);

  const db = await getDb();
  if (!db) {
    console.error("[Webhook] Database not available");
    return res.status(500).json({ 
      error: "Database not available",
      retryable: true 
    });
  }

  // 2. De-duplication: Check if event already processed
  try {
    const existing = await db.query.stripeEvents.findFirst({
      where: (t, { eq }) => eq(t.id, event.id),
    });

    // If already processed successfully, return 200 (idempotent success)
    if (existing?.processed) {
      console.log(`[Webhook] Event ${event.id} already processed, skipping`);
      return res.json({ received: true, deduplicated: true });
    }

    // 3. Store event if not exists (for tracking)
    if (!existing) {
      try {
        await db.insert(stripeEvents).values({
          id: event.id,
          type: event.type,
          apiVersion: event.api_version || null,
          data: JSON.stringify(event.data.object),
          processed: false,
          retryCount: 0,
          createdAt: new Date(),
        });
      } catch (insertErr: any) {
        // Handle race condition (another process inserted)
        if (insertErr.code === "ER_DUP_ENTRY" || insertErr.code === "23505" || insertErr.code === "23000") {
          console.log(`[Webhook] Event ${event.id} already stored by another process`);
          // Re-check if processed
          const recheck = await db.query.stripeEvents.findFirst({
            where: (t, { eq }) => eq(t.id, event.id),
          });
          if (recheck?.processed) {
            return res.json({ received: true, deduplicated: true });
          }
        } else {
          throw insertErr;
        }
      }
    }

    // 4. Process event in transaction
    await db.transaction(async (tx) => {
      await processEvent(tx, event);

      // Mark as processed only on success
      await tx
        .update(stripeEvents)
        .set({
          processed: true,
          processedAt: new Date(),
          error: null,
        })
        .where(eq(stripeEvents.id, event.id));
    });

    console.log(`[Webhook] Event ${event.id} processed successfully`);
    return res.json({ received: true });

  } catch (error: any) {
    const errorMsg = error.message || "Unknown error";
    console.error(`[Webhook] Error processing event ${event.id}:`, errorMsg);

    // Update error info (processed=false allows retry)
    try {
      const existing = await db.query.stripeEvents.findFirst({
        where: (t, { eq }) => eq(t.id, event.id),
      });
      
      await db
        .update(stripeEvents)
        .set({
          processed: false, // Important: false allows retry
          retryCount: (existing?.retryCount ?? 0) + 1,
          error: errorMsg,
        })
        .where(eq(stripeEvents.id, event.id));
    } catch (updateErr) {
      console.error(`[Webhook] Failed to update error status:`, updateErr);
    }

    // Return 500 to trigger Stripe retry
    return res.status(500).json({ 
      error: "Webhook processing failed",
      retryable: true 
    });
  }
}

/**
 * Process event within transaction
 */
async function processEvent(tx: any, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      return handleCheckoutSessionCompleted(tx, event.data.object as Stripe.Checkout.Session, event.id);

    case "payment_intent.succeeded":
      return handlePaymentIntentSucceeded(tx, event.data.object as Stripe.PaymentIntent, event.id);

    case "payment_intent.payment_failed":
      return handlePaymentFailed(tx, event.data.object as Stripe.PaymentIntent, event.id);

    case "charge.refunded":
      return handleChargeRefunded(tx, event.data.object as Stripe.Charge, event.id);

    default:
      console.log(`[Webhook] Unhandled event type: ${event.type}`);
      return;
  }
}

/**
 * Handle checkout.session.completed
 */
async function handleCheckoutSessionCompleted(
  tx: any,
  session: Stripe.Checkout.Session,
  eventId: string
) {
  console.log(`[Webhook] Checkout session completed: ${session.id}`);

  const bookingId = session.metadata?.bookingId;
  if (!bookingId) {
    throw new Error("No bookingId in session metadata");
  }

  // 1. Load booking
  const [booking] = await tx
    .select()
    .from(bookings)
    .where(eq(bookings.id, parseInt(bookingId)))
    .limit(1);

  if (!booking) {
    throw new Error(`Booking ${bookingId} not found`);
  }

  // 2. Check state transition is valid (idempotent)
  if (booking.status === "confirmed" && booking.paymentStatus === "paid") {
    console.log(`[Webhook] Booking ${bookingId} already confirmed, skipping`);
    return;
  }

  // Only allow transition from pending states
  if (booking.status !== "pending_payment" && booking.status !== "pending" && booking.status !== "confirmed") {
    throw new Error(`Invalid state transition: ${booking.status} -> confirmed`);
  }

  const paymentIntentId = session.payment_intent as string;
  const amount = session.amount_total ? session.amount_total / 100 : booking.totalAmount;

  // 3. Create ledger entry (with uniqueness protection)
  try {
    await tx.insert(financialLedger).values({
      bookingId: parseInt(bookingId),
      userId: booking.userId,
      type: "charge",
      amount: amount.toString(),
      currency: session.currency?.toUpperCase() || booking.currency || "SAR",
      stripeEventId: eventId,
      stripePaymentIntentId: paymentIntentId,
      description: `Payment for booking #${bookingId}`,
      transactionDate: new Date(),
      createdAt: new Date(),
    });
  } catch (ledgerErr: any) {
    // Check if duplicate (unique constraint violation)
    if (ledgerErr.code === "ER_DUP_ENTRY" || ledgerErr.code === "23505" || ledgerErr.code === "23000") {
      console.log(`[Webhook] Ledger entry already exists for ${paymentIntentId}, skipping`);
      // Continue - this is OK (idempotent)
    } else {
      throw ledgerErr;
    }
  }

  // 4. Update booking status
  const previousStatus = booking.status;
  await tx
    .update(bookings)
    .set({
      paymentStatus: "paid",
      status: "confirmed",
      stripePaymentIntentId: paymentIntentId,
      updatedAt: new Date(),
    })
    .where(eq(bookings.id, parseInt(bookingId)));

  // 5. Record status history
  if (previousStatus !== "confirmed") {
    await tx.insert(bookingStatusHistory).values({
      bookingId: parseInt(bookingId),
      previousStatus: previousStatus,
      newStatus: "confirmed",
      reason: "Payment completed via Stripe checkout",
      changedBy: null, // System
      createdAt: new Date(),
    });
  }

  console.log(`[Webhook] Booking ${bookingId} marked as paid and confirmed`);

  // 6. Post-transaction tasks (outside transaction to avoid blocking)
  // These are queued/executed after commit
  setImmediate(async () => {
    try {
      await sendConfirmationAndAwardMiles(parseInt(bookingId));
    } catch (postErr) {
      console.error(`[Webhook] Post-transaction tasks failed:`, postErr);
      // Don't fail the webhook
    }
  });
}

/**
 * Handle payment_intent.succeeded
 */
async function handlePaymentIntentSucceeded(
  tx: any,
  pi: Stripe.PaymentIntent,
  eventId: string
) {
  const bookingId = pi.metadata?.bookingId;
  if (!bookingId) {
    console.log(`[Webhook] No bookingId in PaymentIntent ${pi.id} metadata`);
    return;
  }

  console.log(`[Webhook] PaymentIntent succeeded for booking ${bookingId}`);

  // Check if already handled by checkout event
  const [booking] = await tx
    .select()
    .from(bookings)
    .where(eq(bookings.id, parseInt(bookingId)))
    .limit(1);

  if (!booking) {
    console.log(`[Webhook] Booking ${bookingId} not found`);
    return;
  }

  // If already confirmed, skip (handled by checkout event)
  if (booking.status === "confirmed" && booking.paymentStatus === "paid") {
    console.log(`[Webhook] Booking ${bookingId} already confirmed`);
    return;
  }

  // Update if still pending
  if (booking.status === "pending_payment" || booking.status === "pending") {
    await tx
      .update(bookings)
      .set({
        status: "confirmed",
        paymentStatus: "paid",
        stripePaymentIntentId: pi.id,
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, parseInt(bookingId)));

    console.log(`[Webhook] Booking ${bookingId} confirmed via payment_intent`);
  }
}

/**
 * Handle payment_intent.payment_failed
 */
async function handlePaymentFailed(
  tx: any,
  paymentIntent: Stripe.PaymentIntent,
  eventId: string
) {
  console.log(`[Webhook] Payment failed: ${paymentIntent.id}`);

  // Find booking by payment intent ID or metadata
  const bookingId = paymentIntent.metadata?.bookingId;
  
  let booking;
  if (bookingId) {
    [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, parseInt(bookingId)))
      .limit(1);
  } else {
    [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.stripePaymentIntentId, paymentIntent.id))
      .limit(1);
  }

  if (!booking) {
    console.log(`[Webhook] No booking found for payment intent ${paymentIntent.id}`);
    return;
  }

  // Only update if in pending state
  if (booking.status === "pending_payment" || booking.status === "pending") {
    const previousStatus = booking.status;

    await tx
      .update(bookings)
      .set({ 
        paymentStatus: "failed",
        status: "failed",
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, booking.id));

    // Record status history
    await tx.insert(bookingStatusHistory).values({
      bookingId: booking.id,
      previousStatus: previousStatus,
      newStatus: "failed",
      reason: `Payment failed: ${paymentIntent.last_payment_error?.message || "Unknown error"}`,
      changedBy: null,
      createdAt: new Date(),
    });

    console.log(`[Webhook] Booking ${booking.id} marked as payment failed`);
  }
}

/**
 * Handle charge.refunded
 */
async function handleChargeRefunded(
  tx: any,
  charge: Stripe.Charge,
  eventId: string
) {
  const bookingId = charge.metadata?.bookingId;
  if (!bookingId) {
    console.log(`[Webhook] No bookingId in Charge ${charge.id} metadata`);
    return;
  }

  console.log(`[Webhook] Charge refunded for booking ${bookingId}`);

  const [booking] = await tx
    .select()
    .from(bookings)
    .where(eq(bookings.id, parseInt(bookingId)))
    .limit(1);

  if (!booking) {
    console.log(`[Webhook] Booking ${bookingId} not found`);
    return;
  }

  // Get refund details
  const refund = charge.refunds?.data[0];
  const refundAmount = charge.amount_refunded / 100;
  const isFullRefund = charge.amount_refunded === charge.amount;

  // Create refund ledger entry (with uniqueness protection)
  try {
    await tx.insert(financialLedger).values({
      bookingId: parseInt(bookingId),
      userId: booking.userId,
      type: isFullRefund ? "refund" : "partial_refund",
      amount: refundAmount.toString(),
      currency: charge.currency.toUpperCase(),
      stripeEventId: eventId,
      stripeChargeId: charge.id,
      stripeRefundId: refund?.id || null,
      description: isFullRefund
        ? `Full refund for booking #${bookingId}`
        : `Partial refund for booking #${bookingId}`,
      transactionDate: new Date(),
      createdAt: new Date(),
    });
  } catch (ledgerErr: any) {
    if (ledgerErr.code === "ER_DUP_ENTRY" || ledgerErr.code === "23505" || ledgerErr.code === "23000") {
      console.log(`[Webhook] Refund entry already exists, skipping`);
      return; // Idempotent
    }
    throw ledgerErr;
  }

  // Update booking status
  const newStatus = isFullRefund ? "refunded" : "partially_refunded";
  const previousStatus = booking.status;

  await tx
    .update(bookings)
    .set({
      status: newStatus,
      paymentStatus: isFullRefund ? "refunded" : "partially_refunded",
      updatedAt: new Date(),
    })
    .where(eq(bookings.id, parseInt(bookingId)));

  // Record status history
  await tx.insert(bookingStatusHistory).values({
    bookingId: parseInt(bookingId),
    previousStatus,
    newStatus,
    reason: isFullRefund
      ? "Full refund processed"
      : `Partial refund of ${refundAmount} ${charge.currency.toUpperCase()}`,
    changedBy: null,
    createdAt: new Date(),
  });

  console.log(`[Webhook] Booking ${bookingId} ${newStatus}`);
}

/**
 * Send confirmation email and award miles (post-transaction)
 */
async function sendConfirmationAndAwardMiles(bookingId: number) {
  const db = await getDb();
  if (!db) return;

  try {
    const [booking] = await db
      .select({
        bookingReference: bookings.bookingReference,
        pnr: bookings.pnr,
        totalAmount: bookings.totalAmount,
        cabinClass: bookings.cabinClass,
        numberOfPassengers: bookings.numberOfPassengers,
        userId: bookings.userId,
        flightId: bookings.flightId,
        userName: users.name,
        userEmail: users.email,
        flightNumber: flights.flightNumber,
        departureTime: flights.departureTime,
        arrivalTime: flights.arrivalTime,
        originCode: airports.code,
        originCity: airports.city,
      })
      .from(bookings)
      .innerJoin(users, eq(bookings.userId, users.id))
      .innerJoin(flights, eq(bookings.flightId, flights.id))
      .innerJoin(airports, eq(flights.originId, airports.id))
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!booking || !booking.userEmail) return;

    // Get destination airport
    const [flight] = await db
      .select({ destinationId: flights.destinationId })
      .from(flights)
      .innerJoin(bookings, eq(bookings.flightId, flights.id))
      .where(eq(bookings.id, bookingId))
      .limit(1);

    const [destAirport] = await db
      .select({ code: airports.code, city: airports.city })
      .from(airports)
      .where(eq(airports.id, flight.destinationId))
      .limit(1);

    // Generate e-tickets
    let eticketAttachments: Array<{
      filename: string;
      content: string;
      contentType?: string;
    }> = [];

    try {
      const bookingPassengers = await db
        .select()
        .from(passengers)
        .where(eq(passengers.bookingId, bookingId));

      if (bookingPassengers.length > 0) {
        eticketAttachments = await Promise.all(
          bookingPassengers.map(async (passenger) => {
            const pdf = await generateETicketForPassenger(bookingId, passenger.id);
            return {
              filename: `eticket-${booking.bookingReference}-${passenger.firstName}.pdf`,
              content: pdf,
              contentType: "application/pdf",
            };
          })
        );
        console.log(`[Webhook] Generated ${eticketAttachments.length} e-ticket PDFs`);
      }
    } catch (eticketError) {
      console.error("[Webhook] Failed to generate e-tickets:", eticketError);
    }

    // Send email
    await sendBookingConfirmation({
      passengerName: booking.userName || "Passenger",
      passengerEmail: booking.userEmail,
      bookingReference: booking.bookingReference,
      pnr: booking.pnr,
      flightNumber: booking.flightNumber,
      origin: `${booking.originCity} (${booking.originCode})`,
      destination: `${destAirport.city} (${destAirport.code})`,
      departureTime: booking.departureTime,
      arrivalTime: booking.arrivalTime,
      cabinClass: booking.cabinClass,
      numberOfPassengers: booking.numberOfPassengers,
      totalAmount: booking.totalAmount,
      attachments: eticketAttachments.length > 0 ? eticketAttachments : undefined,
    });

    console.log(`[Webhook] Sent booking confirmation to ${booking.userEmail}`);

    // Award loyalty miles
    const result = await awardMilesForBooking(
      booking.userId,
      bookingId,
      booking.flightId,
      booking.totalAmount
    );

    console.log(
      `[Webhook] Awarded ${result.milesEarned} miles to user ${booking.userId}`
    );

  } catch (error) {
    console.error("[Webhook] Post-transaction tasks failed:", error);
  }
}
