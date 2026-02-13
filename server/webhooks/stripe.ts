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
  financialLedger,
  bookingStatusHistory,
  inventoryLocks,
} from "../../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";
import { sendBookingConfirmation } from "../services/email.service";
import { awardMilesForBooking } from "../services/loyalty.service";
import { generateETicketForPassenger } from "../services/eticket.service";
import { createServiceLogger } from "../_core/logger";
import {
  notifyBookingConfirmed,
  notifyPaymentReceived,
  notifyRefundProcessed,
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
      error: `Signature verification failed: ${errMessage}`,
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
        .where(eq(stripeEvents.id, event.id));
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
async function processEvent(
  tx: DatabaseTransaction,
  event: Stripe.Event
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
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
  log.info(
    { event: "checkout_completed", sessionId: session.id },
    `Checkout session completed: ${session.id}`
  );

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
    log.info(
      { event: "booking_already_confirmed", bookingId },
      `Booking ${bookingId} already confirmed, skipping`
    );
    return;
  }

  // Only allow transition from pending states
  if (booking.status !== "pending" && booking.status !== "confirmed") {
    throw new Error(`Invalid state transition: ${booking.status} -> confirmed`);
  }

  const paymentIntentId = session.payment_intent as string;
  const amount = session.amount_total
    ? session.amount_total / 100
    : booking.totalAmount / 100;

  // 3. Create ledger entry (with uniqueness protection)
  try {
    await tx.insert(financialLedger).values({
      bookingId: parseInt(bookingId),
      userId: booking.userId,
      type: "charge",
      amount: amount.toString(),
      currency: session.currency?.toUpperCase() || "SAR",
      stripeEventId: eventId,
      stripePaymentIntentId: paymentIntentId,
      description: `Payment for booking #${bookingId}`,
      transactionDate: new Date(),
      createdAt: new Date(),
    });
  } catch (ledgerErr: unknown) {
    // Check if duplicate (unique constraint violation)
    if (isDuplicateEntryError(ledgerErr)) {
      log.info(
        { event: "ledger_entry_exists", paymentIntentId, bookingId },
        `Ledger entry already exists for ${paymentIntentId}, skipping`
      );
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
      bookingReference: booking.bookingReference,
      previousStatus: previousStatus,
      newStatus: "confirmed",
      transitionReason: "Payment completed via Stripe checkout",
      changedBy: null, // System
      createdAt: new Date(),
    });
  }

  // 6. Deduct seats from flight availability
  if (previousStatus !== "confirmed") {
    if (booking.cabinClass === "business") {
      await tx
        .update(flights)
        .set({
          businessAvailable: sql`GREATEST(${flights.businessAvailable} - ${booking.numberOfPassengers}, 0)`,
        })
        .where(eq(flights.id, booking.flightId));
    } else {
      await tx
        .update(flights)
        .set({
          economyAvailable: sql`GREATEST(${flights.economyAvailable} - ${booking.numberOfPassengers}, 0)`,
        })
        .where(eq(flights.id, booking.flightId));
    }

    log.info(
      {
        event: "seats_deducted",
        bookingId,
        flightId: booking.flightId,
        cabinClass: booking.cabinClass,
        seatsDeducted: booking.numberOfPassengers,
      },
      `Deducted ${booking.numberOfPassengers} ${booking.cabinClass} seat(s) from flight ${booking.flightId}`
    );

    // 6b. Convert inventory lock to booking (mark lock as converted)
    try {
      const [activeLock] = await tx
        .select({ id: inventoryLocks.id })
        .from(inventoryLocks)
        .where(
          and(
            eq(inventoryLocks.flightId, booking.flightId),
            eq(inventoryLocks.userId, booking.userId),
            eq(inventoryLocks.cabinClass, booking.cabinClass),
            eq(inventoryLocks.status, "active")
          )
        )
        .limit(1);

      if (activeLock) {
        await tx
          .update(inventoryLocks)
          .set({
            status: "converted",
            releasedAt: new Date(),
          })
          .where(eq(inventoryLocks.id, activeLock.id));

        log.info(
          {
            event: "inventory_lock_converted",
            lockId: activeLock.id,
            bookingId,
          },
          `Converted inventory lock ${activeLock.id} for booking ${bookingId}`
        );
      }
    } catch (lockErr) {
      // Lock conversion failure should not break payment confirmation
      log.warn(
        {
          event: "inventory_lock_conversion_failed",
          bookingId,
          error: lockErr,
        },
        `Failed to convert inventory lock for booking ${bookingId} - non-critical`
      );
    }
  }

  log.info(
    { event: "booking_confirmed", bookingId, paymentIntentId },
    `Booking ${bookingId} marked as paid and confirmed`
  );

  // 7. Post-transaction tasks (outside transaction to avoid blocking)
  // These are queued/executed after commit
  setImmediate(async () => {
    try {
      await sendConfirmationAndAwardMiles(parseInt(bookingId));
    } catch (postErr) {
      log.error(
        { event: "post_transaction_failed", bookingId, error: postErr },
        "Post-transaction tasks failed"
      );
      // Don't fail the webhook
    }
  });
}

/**
 * Handle payment_intent.succeeded
 */
async function handlePaymentIntentSucceeded(
  tx: DatabaseTransaction,
  pi: Stripe.PaymentIntent,
  _eventId: string
) {
  const bookingId = pi.metadata?.bookingId;
  if (!bookingId) {
    log.info(
      { event: "payment_intent_no_booking", paymentIntentId: pi.id },
      `No bookingId in PaymentIntent ${pi.id} metadata`
    );
    return;
  }

  log.info(
    { event: "payment_intent_succeeded", bookingId, paymentIntentId: pi.id },
    `PaymentIntent succeeded for booking ${bookingId}`
  );

  // Check if already handled by checkout event
  const [booking] = await tx
    .select()
    .from(bookings)
    .where(eq(bookings.id, parseInt(bookingId)))
    .limit(1);

  if (!booking) {
    log.info(
      { event: "booking_not_found", bookingId, paymentIntentId: pi.id },
      `Booking ${bookingId} not found`
    );
    return;
  }

  // If already confirmed, skip (handled by checkout event)
  if (booking.status === "confirmed" && booking.paymentStatus === "paid") {
    log.info(
      { event: "booking_already_confirmed", bookingId },
      `Booking ${bookingId} already confirmed`
    );
    return;
  }

  // Update booking status if still pending (fallback for checkout.session.completed).
  // IMPORTANT: Seat deduction is handled EXCLUSIVELY by handleCheckoutSessionCompleted
  // to prevent double-deduction race conditions when both events arrive simultaneously.
  // This handler only updates booking status as a safety net.
  if (booking.status === "pending") {
    await tx
      .update(bookings)
      .set({
        status: "confirmed",
        paymentStatus: "paid",
        stripePaymentIntentId: pi.id,
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, parseInt(bookingId)));

    log.info(
      {
        event: "booking_confirmed_via_pi",
        bookingId,
        paymentIntentId: pi.id,
      },
      `Booking ${bookingId} confirmed via payment_intent (seats deducted by checkout handler)`
    );
  }
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
  const bookingId = charge.metadata?.bookingId;
  if (!bookingId) {
    log.info(
      { event: "charge_no_booking", chargeId: charge.id },
      `No bookingId in Charge ${charge.id} metadata`
    );
    return;
  }

  log.info(
    { event: "charge_refunded", bookingId, chargeId: charge.id },
    `Charge refunded for booking ${bookingId}`
  );

  const [booking] = await tx
    .select()
    .from(bookings)
    .where(eq(bookings.id, parseInt(bookingId)))
    .limit(1);

  if (!booking) {
    log.info(
      { event: "booking_not_found", bookingId },
      `Booking ${bookingId} not found`
    );
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
  } catch (ledgerErr: unknown) {
    if (isDuplicateEntryError(ledgerErr)) {
      log.info(
        { event: "refund_entry_exists", bookingId, chargeId: charge.id },
        "Refund entry already exists, skipping"
      );
      return; // Idempotent
    }
    throw ledgerErr;
  }

  // Update booking status
  // bookings.status enum only allows: pending, confirmed, cancelled, completed
  // bookings.paymentStatus enum only allows: pending, paid, refunded, failed
  const bookingNewStatus = isFullRefund ? "cancelled" : booking.status;
  const previousStatus = booking.status;

  await tx
    .update(bookings)
    .set({
      status: bookingNewStatus,
      paymentStatus: "refunded",
      updatedAt: new Date(),
    })
    .where(eq(bookings.id, parseInt(bookingId)));

  // Restore seats to flight availability when a full refund cancels the booking
  if (
    isFullRefund &&
    (previousStatus === "confirmed" || booking.paymentStatus === "paid")
  ) {
    if (booking.cabinClass === "business") {
      await tx
        .update(flights)
        .set({
          businessAvailable: sql`${flights.businessAvailable} + ${booking.numberOfPassengers}`,
        })
        .where(eq(flights.id, booking.flightId));
    } else {
      await tx
        .update(flights)
        .set({
          economyAvailable: sql`${flights.economyAvailable} + ${booking.numberOfPassengers}`,
        })
        .where(eq(flights.id, booking.flightId));
    }

    log.info(
      {
        event: "seats_restored",
        bookingId,
        flightId: booking.flightId,
        cabinClass: booking.cabinClass,
        seatsRestored: booking.numberOfPassengers,
      },
      `Restored ${booking.numberOfPassengers} ${booking.cabinClass} seat(s) to flight ${booking.flightId} after full refund`
    );
  }

  // Record status history (bookingStatusHistory has the full enum including "refunded")
  await tx.insert(bookingStatusHistory).values({
    bookingId: parseInt(bookingId),
    bookingReference: booking.bookingReference,
    previousStatus,
    newStatus: "refunded",
    transitionReason: isFullRefund
      ? "Full refund processed"
      : `Partial refund of ${refundAmount} ${charge.currency.toUpperCase()}`,
    changedBy: null,
    createdAt: new Date(),
  });

  log.info(
    {
      event: "booking_refunded",
      bookingId,
      status: bookingNewStatus,
      refundAmount,
    },
    `Booking ${bookingId} ${bookingNewStatus}`
  );

  // Send in-app refund notification (outside transaction scope via own connection)
  try {
    await notifyRefundProcessed(
      booking.userId,
      refundAmount * 100, // notifyRefundProcessed expects cents
      booking.bookingReference || `#${bookingId}`
    );
  } catch (notifError) {
    log.error(
      { event: "notification_failed", bookingId, error: notifError },
      "Failed to send refund notification"
    );
  }
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
      attachments:
        eticketAttachments.length > 0 ? eticketAttachments : undefined,
    });

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
  }
}
