import { TRPCError } from "@trpc/server";
import Stripe from "stripe";
import { getDb } from "../db";
import { bookings, payments, users, flights } from "../../drizzle/schema";
import { and, eq, sql } from "drizzle-orm";
import { sendRefundConfirmation } from "./email.service";
import { calculateCancellationFee } from "./cancellation-fees.service";
import { trackRefundIssued } from "./metrics.service";
import { notifyRefundProcessed } from "./notification.service";
import { settleVerifiedRefund } from "./payment-settlement.service";
import { stripe } from "../stripe";

export interface CreateRefundInput {
  bookingId: number;
  userId: number;
  reason?: string;
  amount?: number; // Admin-only override in integer cents
}

export interface RefundActor {
  id: number;
  role: string;
}

function isActiveRefund(refund: Stripe.Refund): boolean {
  return refund.status !== "failed" && refund.status !== "canceled";
}

async function listActiveRefunds(
  paymentIntentId: string
): Promise<Stripe.Refund[]> {
  const activeRefunds: Stripe.Refund[] = [];

  for await (const refund of stripe.refunds.list({
    payment_intent: paymentIntentId,
    limit: 100,
  })) {
    if (isActiveRefund(refund)) {
      activeRefunds.push(refund);
    }
  }

  return activeRefunds;
}

function sumRefundAmounts(refunds: Stripe.Refund[]): number {
  return refunds.reduce((total, refund) => total + refund.amount, 0);
}

/**
 * Create a refund for a booking. Actor must come from the authenticated context,
 * never from request input; userId identifies the booking owner, not authority.
 */
export async function createRefund(
  input: CreateRefundInput,
  actor: RefundActor
) {
  try {
    if (!actor || (actor.role !== "admin" && actor.id !== input.userId)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
    }

    if (input.amount !== undefined) {
      if (actor.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only admins can override the refund amount",
        });
      }
      if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Refund amount must be a positive safe integer in cents",
        });
      }
    }

    const database = await getDb();
    if (!database) throw new Error("Database not available");

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

    if (booking.userId !== input.userId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Access denied",
      });
    }

    if (booking.paymentStatus !== "paid") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot refund unpaid booking",
      });
    }

    if (!booking.stripePaymentIntentId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No payment intent found for this booking",
      });
    }

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

    const feeCalculation = calculateCancellationFee(
      booking.totalAmount,
      flight.departureTime
    );

    const refundAmount = input.amount ?? feeCalculation.refundAmount;

    if (
      !Number.isSafeInteger(booking.totalAmount) ||
      !Number.isSafeInteger(refundAmount) ||
      refundAmount <= 0 ||
      refundAmount > booking.totalAmount
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Refund amount must be positive integer cents within the booking total",
      });
    }

    const existingRefunds = await listActiveRefunds(
      booking.stripePaymentIntentId
    );
    const alreadyRefundedAmount = sumRefundAmounts(existingRefunds);
    const remainingRefundableAmount =
      booking.totalAmount - alreadyRefundedAmount;

    // Same booking + same amount maps to one provider operation. Check this before
    // the remaining-balance guard so a provider-success/local-failure retry can
    // reconcile state without trying to issue money again.
    const refundOperationId = `booking-${input.bookingId}-refund-${refundAmount}`;
    const existingOperationRefund = existingRefunds.find(
      refund => refund.metadata?.refundOperationId === refundOperationId
    );

    let refund: Stripe.Refund;
    if (existingOperationRefund) {
      refund = existingOperationRefund;
    } else {
      if (remainingRefundableAmount <= 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Booking payment has already been fully refunded",
        });
      }

      if (refundAmount > remainingRefundableAmount) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Refund amount exceeds the remaining refundable balance of ${remainingRefundableAmount} cents`,
        });
      }

      const refundParams: Stripe.RefundCreateParams = {
        payment_intent: booking.stripePaymentIntentId,
        amount: refundAmount,
        reason:
          input.reason === "duplicate"
            ? "duplicate"
            : input.reason === "fraudulent"
              ? "fraudulent"
              : "requested_by_customer",
        metadata: {
          bookingId: input.bookingId.toString(),
          refundOperationId,
        },
      };

      refund = await stripe.refunds.create(refundParams, {
        idempotencyKey: refundOperationId,
      });
    }

    const refundsAfterOperation = await listActiveRefunds(
      booking.stripePaymentIntentId
    );
    const cumulativeRefundedAmount = sumRefundAmounts(refundsAfterOperation);
    const isFullRefund = cumulativeRefundedAmount >= booking.totalAmount;

    if (refund.status === "succeeded") {
      const chargeId =
        typeof refund.charge === "string" ? refund.charge : refund.charge?.id;
      if (!chargeId) throw new Error("Provider refund is missing its charge");
      const charge = await stripe.charges.retrieve(chargeId);
      await database.transaction(tx =>
        settleVerifiedRefund(tx, {
          paymentIntentId: booking.stripePaymentIntentId!,
          chargeId,
          amount: charge.amount,
          amountRefunded: charge.amount_refunded,
          currency: charge.currency,
          eventId: `refund-reconcile:${refund.id}`,
        })
      );
    }

    trackRefundIssued({
      userId: input.userId,
      bookingId: input.bookingId,
      refundAmount: refund.amount || booking.totalAmount,
      originalAmount: booking.totalAmount,
      reason: input.reason,
    });

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
    }

    try {
      await notifyRefundProcessed(
        booking.userId,
        refund.amount || booking.totalAmount,
        booking.bookingReference || `#${input.bookingId}`
      );
    } catch (notifError) {
      console.error("[Refund] Error sending in-app notification:", notifError);
    }

    return {
      success: true,
      refundId: refund.id,
      amount: refund.amount,
      status: refund.status,
      cumulativeRefundedAmount,
      remainingRefundableAmount: Math.max(
        0,
        booking.totalAmount - cumulativeRefundedAmount
      ),
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

export async function getRefundDetails(refundId: string, actor: RefundActor) {
  try {
    const refund = await stripe.refunds.retrieve(refundId);

    if (actor.role !== "admin") {
      const paymentIntentId =
        typeof refund.payment_intent === "string"
          ? refund.payment_intent
          : refund.payment_intent?.id;

      if (!paymentIntentId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Refund not found" });
      }

      const database = await getDb();
      if (!database) throw new Error("Database not available");

      const [ownedBooking] = await database
        .select({ id: bookings.id })
        .from(bookings)
        .where(
          and(
            eq(bookings.stripePaymentIntentId, paymentIntentId),
            eq(bookings.userId, actor.id)
          )
        )
        .limit(1);

      if (!ownedBooking) {
        // Do not disclose whether a refund exists for another account.
        throw new TRPCError({ code: "NOT_FOUND", message: "Refund not found" });
      }
    }

    return {
      id: refund.id,
      amount: refund.amount,
      status: refund.status,
      reason: refund.reason,
      created: refund.created,
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
    console.error("Error getting refund details:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get refund details",
    });
  }
}

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

    if (booking.status === "completed") {
      return { refundable: false, reason: "Cannot refund completed booking" };
    }

    if (!booking.stripePaymentIntentId) {
      return { refundable: false, reason: "No payment intent found" };
    }

    const activeRefunds = await listActiveRefunds(
      booking.stripePaymentIntentId
    );
    if (sumRefundAmounts(activeRefunds) >= booking.totalAmount) {
      return { refundable: false, reason: "Booking is already fully refunded" };
    }

    return { refundable: true };
  } catch (error) {
    console.error("Error checking refundability:", error);
    return { refundable: false, reason: "Error checking refundability" };
  }
}
