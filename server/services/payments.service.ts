import { TRPCError } from "@trpc/server";
import * as db from "../db";
import Stripe from "stripe";

/**
 * Payments Service
 * Business logic for payment-related operations
 */

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-11-17.clover",
});

export interface CreateCheckoutSessionInput {
  bookingId: number;
  userId: number;
  amount: number;
  currency?: string;
}

/**
 * Create Stripe checkout session
 */
export async function createCheckoutSession(input: CreateCheckoutSessionInput) {
  try {
    // Verify booking ownership
    const booking = await db.getBookingByIdWithDetails(input.bookingId);
    
    if (!booking) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Booking not found",
      });
    }
    
    if (booking.userId !== input.userId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Access denied",
      });
    }
    
    if (booking.paymentStatus === "paid") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Booking is already paid",
      });
    }
    
    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: input.currency || "usd",
            product_data: {
              name: `Flight Booking - ${booking.bookingReference}`,
              description: `PNR: ${booking.pnr}`,
            },
            unit_amount: Math.round(input.amount * 100), // Convert to cents
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.VITE_APP_URL || 'http://localhost:3000'}/booking-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.VITE_APP_URL || 'http://localhost:3000'}/booking-cancelled`,
      metadata: {
        bookingId: input.bookingId.toString(),
        userId: input.userId.toString(),
      },
    });
    
    // Create payment record
    await db.createPayment({
      bookingId: input.bookingId,
      amount: input.amount,
      currency: input.currency || "SAR",
      status: "pending",
      method: "card",
      transactionId: session.id,
    });
    
    return {
      sessionId: session.id,
      url: session.url,
    };
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }
    console.error("Error creating checkout session:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create checkout session",
    });
  }
}

/**
 * Handle successful payment
 */
export async function handlePaymentSuccess(
  sessionId: string,
  paymentIntentId: string
) {
  try {
    // Retrieve session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    if (!session.metadata?.bookingId) {
      throw new Error("Booking ID not found in session metadata");
    }
    
    const bookingId = parseInt(session.metadata.bookingId);
    
    // Update payment status
    await db.updatePaymentStatus(bookingId, "completed", paymentIntentId);
    
    // Update booking status
    await db.updateBookingStatus(bookingId, "confirmed");
    
    return { success: true };
  } catch (error) {
    console.error("Error handling payment success:", error);
    throw error;
  }
}

/**
 * Handle failed payment
 */
export async function handlePaymentFailure(sessionId: string) {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    if (!session.metadata?.bookingId) {
      throw new Error("Booking ID not found in session metadata");
    }
    
    const bookingId = parseInt(session.metadata.bookingId);
    
    // Update payment status
    await db.updatePaymentStatus(bookingId, "failed");
    
    return { success: true };
  } catch (error) {
    console.error("Error handling payment failure:", error);
    throw error;
  }
}
