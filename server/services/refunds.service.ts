import { TRPCError } from "@trpc/server";
import Stripe from "stripe";
import { getDb } from "../db";
import { bookings, payments, users, flights } from "../../drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { sendRefundConfirmation } from "./email.service";
import { calculateCancellationFee } from "./cancellation-fees.service";
import { trackRefundIssued } from "./metrics.service";
import { notifyRefundProcessed } from "./notification.service";
import { stripe } from "../stripe";

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

    // Get flight details to calculate cancellation fee
    const flightResult = await database
      .select()
      .from(flights)
      .where(eq(flights.id, booking.flightId))
      .limit(1);

    const flight = flightResult[0];
    if (!flight) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Flight not found",
      });
    }

    // Calculate cancellation fee based on time until departure
    const feeCalculation = calculateCancellationFee(
      booking.totalAmount,
      flight.departureTime
    );

    // Determine refund amount
    let refundAmount: number;
    if (input.amount) {
      // Admin override: use specified amount
      refundAmount = input.amount;
    } else {
      // Use calculated amount based on cancellation policy
      refundAmount = feeCalculation.refundAmount;
    }

    // Check if refund is possible
    if (refundAmount <= 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No refund available for this booking (flight has departed)",
      });
    }

    // Create refund in Stripe
    const refundParams: Stripe.RefundCreateParams = {
      payment_intent: booking.stripePaymentIntentId,
      amount: refundAmount,
      reason:
        input.reason === "duplicate"
          ? "duplicate"
          : input.reason === "fraudulent"
            ? "fraudulent"
            : "requested_by_customer",
    };

    const refund = await stripe.refunds.create(refundParams);

    const isFullRefund = refund.amount === booking.totalAmount;

    // Update booking status
    await database
      .update(bookings)
      .set({
        paymentStatus: isFullRefund ? "refunded" : "paid",
        status: isFullRefund ? "cancelled" : booking.status,
      })
      .where(eq(bookings.id, input.bookingId));

    // Restore seats to flight availability on full refund
    if (isFullRefund && booking.status === "confirmed") {
      if (booking.cabinClass === "business") {
        await database
          .update(flights)
          .set({
            businessAvailable: sql`${flights.businessAvailable} + ${booking.numberOfPassengers}`,
          })
          .where(eq(flights.id, booking.flightId));
      } else {
        await database
          .update(flights)
          .set({
            economyAvailable: sql`${flights.economyAvailable} + ${booking.numberOfPassengers}`,
          })
          .where(eq(flights.id, booking.flightId));
      }

      console.info(
        `[Refund] Restored ${booking.numberOfPassengers} ${booking.cabinClass} seat(s) to flight ${booking.flightId}`
      );
    }

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
          status: isFullRefund ? "refunded" : "completed",
        })
        .where(eq(payments.id, paymentResult[0].id));
    }

    // Track refund issued event for metrics
    trackRefundIssued({
      userId: input.userId,
      bookingId: input.bookingId,
      refundAmount: refund.amount || booking.totalAmount,
      originalAmount: booking.totalAmount,
      reason: input.reason,
    });

    // Send refund confirmation email
    try {
      const [bookingDetails] = await database
        .select({
          bookingReference: bookings.bookingReference,
          userName: users.name,
          userEmail: users.email,
          flightNumber: flights.flightNumber,
        })
        .from(bookings)
        .innerJoin(users, eq(bookings.userId, users.id))
        .innerJoin(flights, eq(bookings.flightId, flights.id))
        .where(eq(bookings.id, input.bookingId))
        .limit(1);

      if (bookingDetails && bookingDetails.userEmail) {
        await sendRefundConfirmation({
          passengerName: bookingDetails.userName || "Passenger",
          passengerEmail: bookingDetails.userEmail,
          bookingReference: bookingDetails.bookingReference,
          flightNumber: bookingDetails.flightNumber,
          refundAmount: refund.amount || booking.totalAmount,
          refundReason: input.reason,
          processingDays: 5,
        });

        console.info(
          `[Refund] Confirmation email sent to ${bookingDetails.userEmail}`
        );
      }
    } catch (emailError) {
      console.error("[Refund] Error sending confirmation email:", emailError);
      // Don't fail the refund if email fails
    }

    // Send in-app refund notification
    try {
      await notifyRefundProcessed(
        booking.userId,
        refund.amount || booking.totalAmount,
        booking.bookingReference || `#${input.bookingId}`
      );
    } catch (notifError) {
      console.error("[Refund] Error sending in-app notification:", notifError);
      // Don't fail the refund if notification fails
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
