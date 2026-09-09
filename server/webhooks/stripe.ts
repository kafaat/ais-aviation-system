/**
 * Stripe Webhook Handler - Production-Grade
 *
 * Features:
 * - De-duplication via stripeEvents table (processed=true only prevents)
 * - Transaction safety (rollback on failure)
 * - Financial ledger entries
 * - Proper error handling with retry support
 * - Structured logging with correlation
 *
 * @version 2.1.0
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
  bookingStatusHistory,
} from "../../drizzle/schema";
import {
  settleVerifiedPayment,
  settleVerifiedRefund,
} from "../services/payment-settlement.service";
import { eq, and } from "drizzle-orm";
import { sendBookingConfirmation } from "../services/email.service";
import { awardMilesForBooking } from "../services/loyalty.service";
import { generateETicketForPassenger } from "../services/eticket.service";
import { createServiceLogger } from "../_core/logger";
import {
  notifyBookingConfirmed,
  notifyPaymentReceived,
  createNotification,
} from "../services/notification.service";

// Create service-specific logger
const log = createServiceLogger("webhook:stripe");

/** Database transaction type derived from getDb return type */
type DatabaseTransaction = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** Check if an error is a database duplicate entry error */
function isDuplicateEntryError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err.code === "ER_DUP_ENTRY" ||
      err.code === "23505" ||
      err.code === "23000")
  );
}

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
    log.error(
      { event: "webhook_error", reason: "missing_signature" },
      "Missing signature or webhook secret"
    );
    return res.status(400).json({
      error: "Missing signature",
      retryable: false,
    });
  }

  let event: Stripe.Event;

  // 1. Verify signature
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err: unknown) {
    const errMessage = err instanceof Error ? err.message : String(err);
    log.error(
      {
        event: "webhook_error",
        reason: "signature_verification_failed",
        error: errMessage,
      },
      `Signature verification failed: ${errMessage}`
    );
    return res.status(400).json({
      error: "Signature verification failed",
      retryable: false,
    });
  }

  // Handle test events
  if (event.id.startsWith("evt_test_")) {
    log.info(
      { event: "webhook_test", eventId: event.id },
      "Test event detected, returning verification response"
    );
    return res.json({ verified: true });
  }

  log.info(
    { event: "webhook_processing", eventType: event.type, eventId: event.id },
    `Processing event: ${event.type} (${event.id})`
  );

  const db = await getDb();
  if (!db) {
    log.error(
      {
        event: "webhook_error",
        reason: "database_unavailable",
        eventId: event.id,
      },
      "Database not available"
    );
    return res.status(500).json({
      error: "Database not available",
      retryable: true,
    });
  }

  // 2. De-duplication: Check if event already processed
  try {
    const existingResult = await db
      .select()
      .from(stripeEvents)
      .where(eq(stripeEvents.id, event.id))
      .limit(1);
    const existing = existingResult[0];

    // If already processed successfully, return 200 (idempotent success)
    if (existing?.processed) {
      log.info(
        { event: "webhook_deduplicated", eventId: event.id },
        `Event ${event.id} already processed, skipping`
      );
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
      } catch (insertErr: unknown) {
        // Handle race condition (another process inserted)
        if (isDuplicateEntryError(insertErr)) {
          log.info(
            { event: "webhook_race_condition", eventId: event.id },
            `Event ${event.id} already stored by another process`
          );
          // Re-check if processed
          const recheckResult = await db
            .select()
            .from(stripeEvents)
            .where(eq(stripeEvents.id, event.id))
            .limit(1);
          const recheck = recheckResult[0];
          if (recheck?.processed) {
            return res.json({ received: true, deduplicated: true });
          }
        } else {
          throw insertErr;
        }
      }
    }

    // 4. Process event in transaction
    await db.transaction(async tx => {
      const [claim] = await tx
        .select()
        .from(stripeEvents)
        .where(eq(stripeEvents.id, event.id))
        .limit(1)
        .for("update");
      if (claim?.processed) return;
      await processStripeEvent(tx, event);

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

    log.info(
      { event: "webhook_success", eventId: event.id, eventType: event.type },
      `Event ${event.id} processed successfully`
    );
    return res.json({ received: true });
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    const errorStack = error instanceof Error ? error.stack : undefined;
    log.error(
      {
        event: "webhook_error",
        eventId: event.id,
        error: errorMsg,
        stack: errorStack,
      },
      `Error processing event ${event.id}: ${errorMsg}`
    );

    // Update error info (processed=false allows retry)
    try {
      const existingResult2 = await db
        .select()
        .from(stripeEvents)
        .where(eq(stripeEvents.id, event.id))
        .limit(1);
      const existing2 = existingResult2[0];

      await db
        .update(stripeEvents)
        .set({
          processed: false, // Important: false allows retry
          retryCount: (existing2?.retryCount ?? 0) + 1,
          error: errorMsg,
        })
        .where(
          and(eq(stripeEvents.id, event.id), eq(stripeEvents.processed, false))
        );
    } catch (updateErr) {
      log.error(
        {
          event: "webhook_error",
          reason: "update_error_status_failed",
          eventId: event.id,
          error: updateErr,
        },
        "Failed to update error status"
      );
    }

    // Return 500 to trigger Stripe retry
    return res.status(500).json({
      error: "Webhook processing failed",
      retryable: true,
    });
  }
}

/**
 * Process event within transaction
 */
export async function processStripeEvent(
  tx: DatabaseTransaction,
  event: Stripe.Event
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await handleCheckoutSessionCompleted(
        tx,
        event.data.object as Stripe.Checkout.Session,
        event.id
      );
      return;

    case "payment_intent.succeeded":
      await handlePaymentIntentSucceeded(
        tx,
        event.data.object as Stripe.PaymentIntent,
        event.id
      );
      return;

    case "payment_intent.payment_failed":
      await handlePaymentFailed(
        tx,
        event.data.object as Stripe.PaymentIntent,
        event.id
      );
      return;

    case "charge.refunded":
      await handleChargeRefunded(
        tx,
        event.data.object as Stripe.Charge,
        event.id
      );
      return;

    default:
      log.info(
        { event: "webhook_unhandled", eventType: event.type },
        `Unhandled event type: ${event.type}`
      );
      return;
  }
}

/**
 * Handle checkout.session.completed
 */
async function handleCheckoutSessionCompleted(
  tx: DatabaseTransaction,
  session: Stripe.Checkout.Session,
  eventId: string
) {
  if (session.payment_status !== "paid") return;
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;
  await settleVerifiedPayment(tx, {
    paymentIntentId: paymentIntentId || "",
    amount: session.amount_total ?? 0,
    currency: session.currency || "",
    metadata: session.metadata || {},
    eventId,
  });
}

/** Both event orders enter the same atomic settlement path. */
async function handlePaymentIntentSucceeded(
  tx: DatabaseTransaction,
  pi: Stripe.PaymentIntent,
  eventId: string
) {
  if (!pi.metadata?.bookingId && !pi.metadata?.topUpId) return; // Legacy Checkout will supply its own metadata.
  if (pi.status !== "succeeded")
    throw new Error("PaymentIntent is not settled");
  await settleVerifiedPayment(tx, {
    paymentIntentId: pi.id,
    amount: pi.amount_received,
    currency: pi.currency,
    metadata: pi.metadata,
    eventId,
  });
}

/**
 * Handle payment_intent.payment_failed
 */
async function handlePaymentFailed(
  tx: DatabaseTransaction,
  paymentIntent: Stripe.PaymentIntent,
  _eventId: string
) {
  log.info(
    { event: "payment_failed", paymentIntentId: paymentIntent.id },
    `Payment failed: ${paymentIntent.id}`
  );

  // Find booking by payment intent ID or metadata
  if (paymentIntent.metadata?.type && paymentIntent.metadata.type !== "booking")
    return;
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
    log.info(
      { event: "booking_not_found", paymentIntentId: paymentIntent.id },
      `No booking found for payment intent ${paymentIntent.id}`
    );
    return;
  }

  // Only update if in pending state
  if (booking.status === "pending") {
    const previousStatus = booking.status;

    await tx
      .update(bookings)
      .set({
        paymentStatus: "failed",
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, booking.id));

    // Record status history
    await tx.insert(bookingStatusHistory).values({
      bookingId: booking.id,
      bookingReference: booking.bookingReference,
      previousStatus: previousStatus,
      newStatus: "payment_failed",
      transitionReason: `Payment failed: ${paymentIntent.last_payment_error?.message || "Unknown error"}`,
      changedBy: null,
      createdAt: new Date(),
    });

    log.info(
      { event: "booking_payment_failed", bookingId: booking.id },
      `Booking ${booking.id} marked as payment failed`
    );

    // Send in-app notification about payment failure
    try {
      await createNotification(
        booking.userId,
        "payment",
        "Payment Failed",
        `Your payment for booking ${booking.bookingReference || `#${booking.id}`} has failed. Please try again or use a different payment method.`,
        {
          bookingId: booking.id,
          bookingReference: booking.bookingReference,
          link: `/my-bookings`,
        }
      );
    } catch (notifError) {
      log.error(
        {
          event: "notification_failed",
          bookingId: booking.id,
          error: notifError,
        },
        "Failed to send payment failure notification"
      );
    }
  }
}

/**
 * Handle charge.refunded
 */
async function handleChargeRefunded(
  tx: DatabaseTransaction,
  charge: Stripe.Charge,
  eventId: string
) {
  const paymentIntentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id;
  if (!paymentIntentId) throw new Error("Refund is missing its payment intent");
  await settleVerifiedRefund(tx, {
    paymentIntentId,
    chargeId: charge.id,
    amount: charge.amount,
    amountRefunded: charge.amount_refunded,
    currency: charge.currency,
    eventId,
  });
}

/**
 * Send confirmation email and award miles (post-transaction)
 */
export async function sendConfirmationAndAwardMiles(bookingId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

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

    if (!booking || !booking.userEmail)
      throw new Error("Booking confirmation recipient is unavailable");

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
    const eticketAttachments: Array<{
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
        const results = await Promise.allSettled(
          bookingPassengers.map(async passenger => {
            const pdf = await generateETicketForPassenger(
              bookingId,
              passenger.id
            );
            return {
              filename: `eticket-${booking.bookingReference}-${passenger.firstName}.pdf`,
              content: pdf,
              contentType: "application/pdf",
            };
          })
        );
        for (const r of results) {
          if (r.status === "fulfilled") {
            eticketAttachments.push(r.value);
          }
        }
        const failures = results.filter(r => r.status === "rejected");
        if (failures.length > 0) {
          log.warn(
            {
              event: "eticket_partial_failure",
              bookingId,
              failed: failures.length,
              succeeded: eticketAttachments.length,
            },
            `Failed to generate ${failures.length}/${results.length} e-tickets`
          );
        }
        log.info(
          {
            event: "etickets_generated",
            bookingId,
            count: eticketAttachments.length,
          },
          `Generated ${eticketAttachments.length} e-ticket PDFs`
        );
      }
    } catch (eticketError) {
      log.error(
        { event: "eticket_generation_failed", bookingId, error: eticketError },
        "Failed to generate e-tickets"
      );
    }

    // Send email
    const accepted = await sendBookingConfirmation({
      idempotencyKey: `booking-confirmed:${bookingId}`,
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
      attachments:
        eticketAttachments.length > 0 ? eticketAttachments : undefined,
    });

    if (!accepted)
      throw new Error("Booking confirmation email was not accepted");

    log.info(
      { event: "confirmation_sent", bookingId, email: booking.userEmail },
      `Sent booking confirmation to ${booking.userEmail}`
    );

    // Send in-app notifications
    try {
      await notifyBookingConfirmed(
        booking.userId,
        booking.bookingReference,
        booking.flightNumber,
        bookingId
      );
      await notifyPaymentReceived(
        booking.userId,
        booking.totalAmount,
        booking.bookingReference
      );
    } catch (notifError) {
      log.error(
        { event: "notification_failed", bookingId, error: notifError },
        "Failed to send in-app notifications"
      );
    }

    // Award loyalty miles
    const result = await awardMilesForBooking(
      booking.userId,
      bookingId,
      booking.flightId,
      booking.totalAmount
    );

    log.info(
      {
        event: "miles_awarded",
        bookingId,
        userId: booking.userId,
        milesEarned: result.milesEarned,
      },
      `Awarded ${result.milesEarned} miles to user ${booking.userId}`
    );
  } catch (error) {
    log.error(
      { event: "post_transaction_failed", bookingId, error },
      "Post-transaction tasks failed"
    );
    throw error;
  }
}
