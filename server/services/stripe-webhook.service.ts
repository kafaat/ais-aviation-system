import Stripe from "stripe";
import { getDb } from "../db";
import {
  stripeEvents,
  financialLedger,
  bookings,
  payments,
  type InsertStripeEvent,
  type InsertFinancialLedger,
} from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { logger } from "./logger.service";
import { recordStatusChange } from "./booking-state-machine.service";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-12-15.clover",
});

/**
 * Verify Stripe webhook signature
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string
): Stripe.Event {
  try {
    const event = stripe.webhooks.constructEvent(
      payload,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
    return event;
  } catch (err) {
    logger.error("Webhook signature verification failed", { error: err });
    throw new Error("Invalid webhook signature");
  }
}

/**
 * Check if event has already been processed (de-duplication)
 */
export async function isEventProcessed(eventId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const existing = await db
    .select()
    .from(stripeEvents)
    .where(eq(stripeEvents.id, eventId))
    .limit(1);

  return existing.length > 0;
}

/**
 * Store Stripe event for audit and de-duplication
 */
export async function storeStripeEvent(event: Stripe.Event): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const eventData: InsertStripeEvent = {
    id: event.id,
    type: event.type,
    apiVersion: event.api_version || undefined,
    data: JSON.stringify(event.data),
    processed: false,
    createdAt: new Date(),
  };

  await db.insert(stripeEvents).values(eventData);

  logger.info("Stripe event stored", {
    eventId: event.id,
    type: event.type,
  });
}

/**
 * Mark event as processed
 */
export async function markEventProcessed(
  eventId: string,
  error?: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(stripeEvents)
    .set({
      processed: true,
      processedAt: new Date(),
      error: error || undefined,
    })
    .where(eq(stripeEvents.id, eventId));
}

/**
 * Record financial transaction in ledger
 */
export async function recordFinancialTransaction(
  data: InsertFinancialLedger
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.insert(financialLedger).values(data);

  logger.info("Financial transaction recorded", {
    type: data.type,
    amount: data.amount,
    bookingId: data.bookingId,
  });
}

/**
 * Process Stripe webhook event
 */
export async function processStripeEvent(event: Stripe.Event): Promise<void> {
  try {
    logger.info("Processing Stripe event", {
      eventId: event.id,
      type: event.type,
    });

    switch (event.type) {
      case "payment_intent.succeeded":
        await handlePaymentIntentSucceeded(event);
        break;

      case "payment_intent.payment_failed":
        await handlePaymentIntentFailed(event);
        break;

      case "charge.refunded":
        await handleChargeRefunded(event);
        break;

      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(event);
        break;

      case "checkout.session.expired":
        await handleCheckoutSessionExpired(event);
        break;

      default:
        logger.info("Unhandled event type", { type: event.type });
    }

    // Mark as processed
    await markEventProcessed(event.id);
  } catch (error) {
    logger.error("Error processing Stripe event", {
      eventId: event.id,
      error,
    });

    // Mark as processed with error
    await markEventProcessed(event.id, String(error));

    // Re-throw to trigger retry
    throw error;
  }
}

/**
 * Handle payment_intent.succeeded event
 */
async function handlePaymentIntentSucceeded(
  event: Stripe.Event
): Promise<void> {
  const paymentIntent = event.data.object as Stripe.PaymentIntent;

  logger.info("Payment intent succeeded", {
    paymentIntentId: paymentIntent.id,
    amount: paymentIntent.amount,
  });

  const db = await getDb();
  if (!db) {
    logger.error("Database not available");
    return;
  }

  // Find booking by payment intent ID
  const bookingResult = await db
    .select()
    .from(bookings)
    .where(eq(bookings.stripePaymentIntentId, paymentIntent.id))
    .limit(1);
  const booking = bookingResult[0];

  if (!booking) {
    logger.warn("Booking not found for payment intent", {
      paymentIntentId: paymentIntent.id,
    });
    return;
  }

  // Update booking status to confirmed
  await db
    .update(bookings)
    .set({ status: "confirmed", updatedAt: new Date() })
    .where(eq(bookings.id, booking.id));

  // Update payment status
  await db
    .update(payments)
    .set({
      status: "completed",
      transactionId: paymentIntent.id,
      updatedAt: new Date(),
    })
    .where(eq(payments.bookingId, booking.id));

  // Record status change
  await recordStatusChange({
    bookingId: booking.id,
    bookingReference: booking.bookingReference,
    previousStatus: booking.status as any,
    newStatus: "confirmed",
    transitionReason: "Payment succeeded via Stripe webhook",
    actorType: "payment_gateway",
    paymentIntentId: paymentIntent.id,
  });

  // Record in financial ledger
  await recordFinancialTransaction({
    bookingId: booking.id,
    userId: booking.userId,
    type: "charge",
    amount: (paymentIntent.amount / 100).toString(),
    currency: paymentIntent.currency.toUpperCase(),
    stripeEventId: event.id,
    stripePaymentIntentId: paymentIntent.id,
    stripeChargeId: paymentIntent.latest_charge as string,
    description: `Payment for booking ${booking.bookingReference}`,
    transactionDate: new Date(),
  });

  logger.info("Booking confirmed via webhook", {
    bookingId: booking.id,
    bookingReference: booking.bookingReference,
  });
}

/**
 * Handle payment_intent.payment_failed event
 */
async function handlePaymentIntentFailed(event: Stripe.Event): Promise<void> {
  const paymentIntent = event.data.object as Stripe.PaymentIntent;

  logger.warn("Payment intent failed", {
    paymentIntentId: paymentIntent.id,
    error: paymentIntent.last_payment_error?.message,
  });

  const db = await getDb();
  if (!db) {
    logger.error("Database not available");
    return;
  }

  // Find booking
  const bookingResult = await db
    .select()
    .from(bookings)
    .where(eq(bookings.stripePaymentIntentId, paymentIntent.id))
    .limit(1);
  const booking = bookingResult[0];

  if (!booking) {
    logger.warn("Booking not found for failed payment", {
      paymentIntentId: paymentIntent.id,
    });
    return;
  }

  // Update payment status
  await db
    .update(payments)
    .set({
      status: "failed",
      transactionId: paymentIntent.id,
      updatedAt: new Date(),
    })
    .where(eq(payments.bookingId, booking.id));

  // Record status change
  await recordStatusChange({
    bookingId: booking.id,
    bookingReference: booking.bookingReference,
    previousStatus: booking.status as any,
    newStatus: "payment_failed",
    transitionReason: `Payment failed: ${paymentIntent.last_payment_error?.message}`,
    actorType: "payment_gateway",
    paymentIntentId: paymentIntent.id,
  });

  logger.info("Booking marked as payment failed", {
    bookingId: booking.id,
    bookingReference: booking.bookingReference,
  });
}

/**
 * Handle charge.refunded event
 */
async function handleChargeRefunded(event: Stripe.Event): Promise<void> {
  const charge = event.data.object as Stripe.Charge;

  logger.info("Charge refunded", {
    chargeId: charge.id,
    amount: charge.amount_refunded,
  });

  const db = await getDb();
  if (!db) {
    logger.error("Database not available");
    return;
  }

  // Find booking by payment intent
  const bookingResult = await db
    .select()
    .from(bookings)
    .where(eq(bookings.stripePaymentIntentId, charge.payment_intent as string))
    .limit(1);
  const booking = bookingResult[0];

  if (!booking) {
    logger.warn("Booking not found for refund", {
      chargeId: charge.id,
    });
    return;
  }

  // Determine refund type
  const isFullRefund = charge.amount_refunded === charge.amount;
  const refundType = isFullRefund ? "refund" : "partial_refund";

  // Update payment status
  await db
    .update(payments)
    .set({
      status: "refunded",
      updatedAt: new Date(),
    })
    .where(eq(payments.bookingId, booking.id));

  // Record status change
  await recordStatusChange({
    bookingId: booking.id,
    bookingReference: booking.bookingReference,
    previousStatus: booking.status as any,
    newStatus: "refunded",
    transitionReason: `${isFullRefund ? "Full" : "Partial"} refund processed`,
    actorType: "payment_gateway",
    paymentIntentId: charge.payment_intent as string,
  });

  // Record in financial ledger
  await recordFinancialTransaction({
    bookingId: booking.id,
    userId: booking.userId,
    type: refundType,
    amount: (charge.amount_refunded / 100).toString(),
    currency: charge.currency.toUpperCase(),
    stripeEventId: event.id,
    stripePaymentIntentId: charge.payment_intent as string,
    stripeChargeId: charge.id,
    stripeRefundId: charge.refunds?.data[0]?.id,
    description: `${isFullRefund ? "Full" : "Partial"} refund for booking ${booking.bookingReference}`,
    transactionDate: new Date(),
  });

  logger.info("Refund processed via webhook", {
    bookingId: booking.id,
    bookingReference: booking.bookingReference,
    refundType,
  });
}

/**
 * Handle checkout.session.completed event
 */
async function handleCheckoutSessionCompleted(
  event: Stripe.Event
): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;

  logger.info("Checkout session completed", {
    sessionId: session.id,
    paymentIntentId: session.payment_intent,
  });

  // Payment intent succeeded event will handle the actual confirmation
  // This is just for logging and tracking
}

/**
 * Handle checkout.session.expired event
 */
async function handleCheckoutSessionExpired(
  event: Stripe.Event
): Promise<void> {
  const session = event.data.object as Stripe.Checkout.Session;

  logger.info("Checkout session expired", {
    sessionId: session.id,
  });

  const db = await getDb();
  if (!db) {
    logger.error("Database not available");
    return;
  }

  // Find booking by session ID
  const bookingResult = await db
    .select()
    .from(bookings)
    .where(eq(bookings.stripeCheckoutSessionId, session.id))
    .limit(1);
  const booking = bookingResult[0];

  if (!booking) {
    logger.warn("Booking not found for expired session", {
      sessionId: session.id,
    });
    return;
  }

  // Mark booking as expired if still pending
  if (booking.status === "pending") {
    await db
      .update(bookings)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(bookings.id, booking.id));

    await recordStatusChange({
      bookingId: booking.id,
      bookingReference: booking.bookingReference,
      previousStatus: "pending",
      newStatus: "expired",
      transitionReason: "Checkout session expired",
      actorType: "system",
    });

    logger.info("Booking marked as expired", {
      bookingId: booking.id,
      bookingReference: booking.bookingReference,
    });
  }
}

/**
 * Retry failed events
 */
export async function retryFailedEvents(): Promise<void> {
  const db = await getDb();
  if (!db) {
    logger.error("Database not available for retry");
    return;
  }

  const failedEvents = await db
    .select()
    .from(stripeEvents)
    .where(eq(stripeEvents.processed, false))
    .limit(10);

  for (const eventRecord of failedEvents) {
    try {
      const event = JSON.parse(eventRecord.data) as Stripe.Event;
      await processStripeEvent(event);

      logger.info("Retry succeeded for event", {
        eventId: eventRecord.id,
      });
    } catch (error) {
      logger.error("Retry failed for event", {
        eventId: eventRecord.id,
        error,
      });

      // Increment retry count
      await db
        .update(stripeEvents)
        .set({
          retryCount: eventRecord.retryCount + 1,
        })
        .where(eq(stripeEvents.id, eventRecord.id));
    }
  }
}
