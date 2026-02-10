/**
 * Stripe Webhook V2 Service - Production-Grade
 *
 * Features:
 * - De-duplication via stripeEvents table (processed=true only prevents)
 * - Retry handling (processed=false allows retry)
 * - Transaction safety
 * - Proper error handling
 * - Ledger uniqueness
 *
 * @version 2.0.0
 * @date 2026-01-26
 */

import Stripe from "stripe";
import { getDb } from "../db";
import {
  stripeEvents,
  financialLedger,
  bookings,
  bookingStatusHistory,
} from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { stripe } from "../stripe";
import { queueBookingConfirmationEmail } from "./queue-v2.service";

// Fail fast if webhook secret is missing
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
if (!webhookSecret && process.env.NODE_ENV === "production") {
  throw new Error("STRIPE_WEBHOOK_SECRET is required in production");
}

/**
 * Production-Grade Stripe Webhook Handler
 */
export const stripeWebhookServiceV2 = {
  /**
   * Handle raw webhook from Express
   *
   * @param opts.rawBody - Raw request body (Buffer)
   * @param opts.signature - Stripe-Signature header
   * @throws Error if signature verification fails or processing fails
   */
  async handleRawWebhook(opts: {
    rawBody: Buffer;
    signature: string;
  }): Promise<void> {
    if (!webhookSecret) {
      throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
    }

    // 1. Verify signature
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        opts.rawBody,
        opts.signature,
        webhookSecret
      );
    } catch (err: any) {
      console.error(`[Webhook] Signature verification failed:`, err.message);
      throw new Error(`Signature verification failed: ${err.message}`);
    }

    const db = await getDb();
    if (!db) {
      throw new Error("Database not available");
    }

    console.info(`[Webhook] Processing event: ${event.type} (${event.id})`);

    // 2. Check if event already processed (de-duplication)
    const existingResults = await db
      .select()
      .from(stripeEvents)
      .where(eq(stripeEvents.id, event.id))
      .limit(1);

    const existing = existingResults[0];

    // If already processed successfully, return (idempotent success)
    if (existing?.processed) {
      console.info(`[Webhook] Event ${event.id} already processed, skipping`);
      return;
    }

    // 3. Store event if not exists
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
      } catch (err: any) {
        // Handle race condition (another process inserted)
        if (err.code === "ER_DUP_ENTRY" || err.code === "23505") {
          console.info(
            `[Webhook] Event ${event.id} already stored by another process`
          );
        } else {
          throw err;
        }
      }
    }

    // 4. Process event in transaction
    try {
      await db.transaction(async tx => {
        await this.processEvent(tx, event);

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

      console.info(`[Webhook] Event ${event.id} processed successfully`);
    } catch (err: any) {
      const errorMsg = err.message || "Unknown error";
      console.error(`[Webhook] Error processing event ${event.id}:`, errorMsg);

      // Update error info (processed=false allows retry)
      await db
        .update(stripeEvents)
        .set({
          processed: false,
          retryCount: (existing?.retryCount ?? 0) + 1,
          error: errorMsg,
        })
        .where(eq(stripeEvents.id, event.id));

      throw err; // Re-throw to return 500 to Stripe (triggers retry)
    }
  },

  /**
   * Process event within transaction
   */
  async processEvent(tx: any, event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case "checkout.session.completed":
        return this.onCheckoutSessionCompleted(
          tx,
          event.data.object as Stripe.Checkout.Session,
          event.id
        );

      case "payment_intent.succeeded":
        return this.onPaymentIntentSucceeded(
          tx,
          event.data.object as Stripe.PaymentIntent,
          event.id
        );

      case "payment_intent.payment_failed":
        return this.onPaymentIntentFailed(
          tx,
          event.data.object as Stripe.PaymentIntent,
          event.id
        );

      case "charge.refunded":
        return this.onChargeRefunded(
          tx,
          event.data.object as Stripe.Charge,
          event.id
        );

      case "charge.dispute.created":
        return this.onDisputeCreated(
          tx,
          event.data.object as Stripe.Dispute,
          event.id
        );

      default:
        console.info(`[Webhook] Unhandled event type: ${event.type}`);
        return; // Ignore unknown events safely
    }
  },

  /**
   * Handle checkout.session.completed
   */
  async onCheckoutSessionCompleted(
    tx: any,
    session: Stripe.Checkout.Session,
    eventId: string
  ): Promise<void> {
    const bookingId = session.metadata?.bookingId;
    if (!bookingId) {
      throw new Error("No bookingId in session metadata");
    }

    console.info(`[Webhook] Processing checkout for booking ${bookingId}`);

    // 1. Load booking
    const booking = await tx.query.bookings.findFirst({
      where: (t: any, { eq }: any) => eq(t.id, parseInt(bookingId)),
    });

    if (!booking) {
      throw new Error(`Booking ${bookingId} not found`);
    }

    // 2. Check state transition is valid (idempotent)
    if (booking.status === "confirmed") {
      console.info(
        `[Webhook] Booking ${bookingId} already confirmed, skipping`
      );
      return;
    }

    if (booking.status !== "pending") {
      throw new Error(
        `Invalid state transition: ${booking.status} -> confirmed`
      );
    }

    // 3. Create ledger entry (with uniqueness protection)
    const paymentIntentId = session.payment_intent as string;
    try {
      await tx.insert(financialLedger).values({
        bookingId: parseInt(bookingId),
        userId: booking.userId,
        type: "charge",
        amount: (booking.totalAmount / 100).toFixed(2), // totalAmount is stored in cents, convert to dollars
        currency: "SAR",
        stripeEventId: eventId,
        stripePaymentIntentId: paymentIntentId,
        description: `Payment for booking #${bookingId}`,
        transactionDate: new Date(),
        createdAt: new Date(),
      });
    } catch (err: any) {
      // Check if duplicate (unique constraint violation)
      if (err.code === "ER_DUP_ENTRY" || err.code === "23505") {
        console.info(
          `[Webhook] Ledger entry already exists for ${paymentIntentId}, skipping`
        );
        // Continue - this is OK (idempotent)
      } else {
        throw err;
      }
    }

    // 4. Update booking status
    await tx
      .update(bookings)
      .set({
        status: "confirmed",
        paymentStatus: "paid",
        stripePaymentIntentId: paymentIntentId,
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, parseInt(bookingId)));

    // 5. Record status history
    await tx.insert(bookingStatusHistory).values({
      bookingId: parseInt(bookingId),
      previousStatus: booking.status,
      newStatus: "confirmed",
      reason: "Payment completed via Stripe checkout",
      changedBy: null, // System
      createdAt: new Date(),
    });

    console.info(`[Webhook] Booking ${bookingId} confirmed successfully`);

    // 6. Queue background jobs (email, loyalty, etc.)
    // Note: This is outside transaction to avoid blocking
    try {
      const user = await tx.query.users.findFirst({
        where: (t: any, { eq }: any) => eq(t.id, booking.userId),
      });

      if (user?.email) {
        await queueBookingConfirmationEmail({
          userId: booking.userId,
          bookingId: parseInt(bookingId),
          email: user.email,
        });
      }
    } catch (queueErr) {
      // Don't fail the webhook if queue fails
      console.error(`[Webhook] Failed to queue email:`, queueErr);
    }
  },

  /**
   * Handle payment_intent.succeeded
   */
  async onPaymentIntentSucceeded(
    tx: any,
    pi: Stripe.PaymentIntent,
    eventId: string
  ): Promise<void> {
    const bookingId = pi.metadata?.bookingId;
    if (!bookingId) {
      console.info(`[Webhook] No bookingId in PaymentIntent ${pi.id} metadata`);
      return;
    }

    console.info(`[Webhook] PaymentIntent succeeded for booking ${bookingId}`);

    // Similar logic to checkout.session.completed
    // but we check if already handled by checkout event
    const booking = await tx.query.bookings.findFirst({
      where: (t: any, { eq }: any) => eq(t.id, parseInt(bookingId)),
    });

    if (!booking) {
      console.info(`[Webhook] Booking ${bookingId} not found`);
      return;
    }

    // If already confirmed, skip (handled by checkout event)
    if (booking.status === "confirmed") {
      console.info(`[Webhook] Booking ${bookingId} already confirmed`);
      return;
    }

    // Update if still pending
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

      console.info(
        `[Webhook] Booking ${bookingId} confirmed via payment_intent`
      );
    }
  },

  /**
   * Handle payment_intent.payment_failed
   */
  async onPaymentIntentFailed(
    tx: any,
    pi: Stripe.PaymentIntent,
    eventId: string
  ): Promise<void> {
    const bookingId = pi.metadata?.bookingId;
    if (!bookingId) {
      console.info(`[Webhook] No bookingId in PaymentIntent ${pi.id} metadata`);
      return;
    }

    console.info(`[Webhook] PaymentIntent failed for booking ${bookingId}`);

    const booking = await tx.query.bookings.findFirst({
      where: (t: any, { eq }: any) => eq(t.id, parseInt(bookingId)),
    });

    if (!booking) {
      console.info(`[Webhook] Booking ${bookingId} not found`);
      return;
    }

    // Only update if in pending state
    if (booking.status === "pending") {
      await tx
        .update(bookings)
        .set({
          status: "failed",
          paymentStatus: "failed",
          updatedAt: new Date(),
        })
        .where(eq(bookings.id, parseInt(bookingId)));

      // Record status history
      await tx.insert(bookingStatusHistory).values({
        bookingId: parseInt(bookingId),
        previousStatus: booking.status,
        newStatus: "failed",
        reason: `Payment failed: ${pi.last_payment_error?.message || "Unknown error"}`,
        changedBy: null,
        createdAt: new Date(),
      });

      console.info(`[Webhook] Booking ${bookingId} marked as failed`);
    }
  },

  /**
   * Handle charge.refunded
   */
  async onChargeRefunded(
    tx: any,
    charge: Stripe.Charge,
    eventId: string
  ): Promise<void> {
    const bookingId = charge.metadata?.bookingId;
    if (!bookingId) {
      console.info(`[Webhook] No bookingId in Charge ${charge.id} metadata`);
      return;
    }

    console.info(`[Webhook] Charge refunded for booking ${bookingId}`);

    const booking = await tx.query.bookings.findFirst({
      where: (t: any, { eq }: any) => eq(t.id, parseInt(bookingId)),
    });

    if (!booking) {
      console.info(`[Webhook] Booking ${bookingId} not found`);
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
    } catch (err: any) {
      if (err.code === "ER_DUP_ENTRY" || err.code === "23505") {
        console.info(`[Webhook] Refund entry already exists, skipping`);
        return; // Idempotent
      }
      throw err;
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

    console.info(`[Webhook] Booking ${bookingId} ${newStatus}`);
  },

  /**
   * Handle charge.dispute.created
   */
  async onDisputeCreated(
    tx: any,
    dispute: Stripe.Dispute,
    eventId: string
  ): Promise<void> {
    const bookingId = dispute.metadata?.bookingId;
    if (!bookingId) {
      console.info(`[Webhook] No bookingId in Dispute ${dispute.id} metadata`);
      return;
    }

    console.info(`[Webhook] Dispute created for booking ${bookingId}`);

    // Update booking status to disputed
    await tx
      .update(bookings)
      .set({
        status: "disputed",
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, parseInt(bookingId)));

    // Record in ledger
    await tx.insert(financialLedger).values({
      bookingId: parseInt(bookingId),
      type: "adjustment",
      amount: (dispute.amount / 100).toString(),
      currency: dispute.currency.toUpperCase(),
      stripeEventId: eventId,
      description: `Dispute created: ${dispute.reason}`,
      transactionDate: new Date(),
      createdAt: new Date(),
    });

    console.info(`[Webhook] Booking ${bookingId} marked as disputed`);
  },
};

export default stripeWebhookServiceV2;
