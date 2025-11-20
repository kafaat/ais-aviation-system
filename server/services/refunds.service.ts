import { TRPCError } from "@trpc/server";
import Stripe from "stripe";
import * as db from "../db";
import { getDb } from "../db";
import { bookings, payments } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

/**
 * Refunds Service
 * Business logic for refund-related operations
 */

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-11-17.clover",
});

export interface CreateRefundInput {
  bookingId: number;
  userId: number;
  reason?: string;
  amount?: number; // Optional: partial refund amount in cents
}

/**
 * Create a refund for a booking
 */
export async function createRefund(input: CreateRefundInput) {
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    // Get booking details
    const bookingResult = await database
      .select()
      .from(bookings)
      .where(eq(bookings.id, input.bookingId))
      .limit(1);

    const booking = bookingResult[0];
    if (!booking) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Booking not found",
      });
    }

    // Verify ownership (admin can refund any booking)
    if (booking.userId !== input.userId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Access denied",
      });
    }

    // Check if booking is paid
    if (booking.paymentStatus !== "paid") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot refund unpaid booking",
      });
    }

    // Check if already refunded
    const currentPaymentStatus = booking.paymentStatus as string;
    if (currentPaymentStatus === "refunded") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Booking is already refunded",
      });
    }

    // Get payment intent ID
    if (!booking.stripePaymentIntentId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No payment intent found for this booking",
      });
    }

    // Create refund in Stripe
    const refundParams: Stripe.RefundCreateParams = {
      payment_intent: booking.stripePaymentIntentId,
      reason: input.reason === "duplicate" ? "duplicate" : 
              input.reason === "fraudulent" ? "fraudulent" : 
              "requested_by_customer",
    };

    // Add amount if partial refund
    if (input.amount && input.amount < booking.totalAmount) {
      refundParams.amount = input.amount;
    }

    const refund = await stripe.refunds.create(refundParams);

    // Update booking status
    await database
      .update(bookings)
      .set({
        paymentStatus: refund.amount === booking.totalAmount ? "refunded" : "paid",
        status: refund.amount === booking.totalAmount ? "cancelled" : booking.status,
      })
      .where(eq(bookings.id, input.bookingId));

    // Update payment record
    const paymentResult = await database
      .select()
      .from(payments)
      .where(eq(payments.bookingId, input.bookingId))
      .limit(1);

    if (paymentResult[0]) {
      await database
        .update(payments)
        .set({
          status: refund.amount === booking.totalAmount ? "refunded" : "completed",
        })
        .where(eq(payments.id, paymentResult[0].id));
    }

    return {
      success: true,
      refundId: refund.id,
      amount: refund.amount,
      status: refund.status,
    };
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }
    if (error instanceof Stripe.errors.StripeError) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Stripe error: ${error.message}`,
      });
    }
    console.error("Error creating refund:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create refund",
    });
  }
}

/**
 * Get refund details
 */
export async function getRefundDetails(refundId: string) {
  try {
    const refund = await stripe.refunds.retrieve(refundId);
    return {
      id: refund.id,
      amount: refund.amount,
      status: refund.status,
      reason: refund.reason,
      created: refund.created,
    };
  } catch (error) {
    if (error instanceof Stripe.errors.StripeError) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Stripe error: ${error.message}`,
      });
    }
    console.error("Error getting refund details:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get refund details",
    });
  }
}

/**
 * Check if booking is refundable
 */
export async function isBookingRefundable(bookingId: number): Promise<{
  refundable: boolean;
  reason?: string;
}> {
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    const bookingResult = await database
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    const booking = bookingResult[0];
    if (!booking) {
      return { refundable: false, reason: "Booking not found" };
    }

    if (booking.paymentStatus !== "paid") {
      return { refundable: false, reason: "Booking is not paid" };
    }

    const currentPaymentStatus = booking.paymentStatus as string;
    if (currentPaymentStatus === "refunded") {
      return { refundable: false, reason: "Booking is already refunded" };
    }

    if (booking.status === "completed") {
      return { refundable: false, reason: "Cannot refund completed booking" };
    }

    return { refundable: true };
  } catch (error) {
    console.error("Error checking refundability:", error);
    return { refundable: false, reason: "Error checking refundability" };
  }
}
