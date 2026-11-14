import { assertBookingDepartureReleasable } from "./booking-settlement.service";
import { assertNoFlownCouponForCancellation } from "./ticket-coupons.service";
import { assertNoOrderRefundPending } from "./order-refunds.service";
import { TRPCError } from "@trpc/server";
import Stripe from "stripe";
import { getDb } from "../db";
import {
  bookings,
  flights,
  paymentSplits,
  paymentReceipts,
} from "../../drizzle/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { quoteCancellationPolicy } from "./cancellation-policy.service";
import { assertZeroCancellationAllowed } from "./zero-refund-cancellation.service";
import {
  getOrdinaryRefundCancellation,
  reserveOrdinaryRefundCancellation,
  processOrdinaryRefundCancellation,
} from "./ordinary-refund.service";
import { stripe } from "../stripe";
import { isAdmin } from "./rbac.service";

export interface CreateRefundInput {
  bookingId: number;
  userId: number;
  reason?: string;
  amount?: number; // Admin-only override in integer cents
  quoteHash?: string;
}

export interface RefundActor {
  id: number;
  role: string;
  tenantId?: number | null;
}

/** Retail refund previews use the same owner and exact tenant scope as the
 * cancellation command. A verified owner may service their null-tenant retail
 * booking; that exception does not grant staff access to unassigned resources. */
export async function assertRefundBookingOwnership(
  bookingId: number,
  actor: RefundActor & { tenantId: number | null }
) {
  const database = await getDb();
  if (!database)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  const [booking] = await database
    .select({ userId: bookings.userId, tenantId: bookings.tenantId })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!booking)
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
  if (
    !isAdmin(actor.role) &&
    (booking.userId !== actor.id || booking.tenantId !== actor.tenantId)
  )
    throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
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

type CollectionReceipt = {
  kind: string;
  bookingId: number | null;
  amount: number;
};

/** What the booking's payment intent can still return. An order-servicing
 * downgrade sets totalAmount to the new fare and refunds the difference on
 * this same intent, so totalAmount less the intent's refunds counts that
 * exchange refund twice. The collected receipt amount less those refunds is
 * what is still held. The receipt is used only when it is this booking's own
 * collection and records more than the invoice; otherwise (a legacy row with
 * no receipt, or an upgrade collected on a second intent) the invoice formula
 * stays, and the reservation still refuses anything this intent cannot return. */
function refundableBalance(
  booking: { id: number; totalAmount: number },
  receipt: CollectionReceipt | undefined,
  refundedAmount: number
): number {
  const collected =
    receipt?.kind === "booking" &&
    receipt.bookingId === booking.id &&
    Number.isSafeInteger(receipt.amount) &&
    receipt.amount > booking.totalAmount
      ? receipt.amount
      : booking.totalAmount;
  return collected - refundedAmount;
}

function collectionReceipt(
  database: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  paymentIntentId: string
) {
  return database
    .select({
      kind: paymentReceipts.kind,
      bookingId: paymentReceipts.bookingId,
      amount: paymentReceipts.amount,
    })
    .from(paymentReceipts)
    .where(eq(paymentReceipts.paymentIntentId, paymentIntentId))
    .limit(1);
}

const splitRefundReason =
  "Split-funded bookings require refunds to each original payer; single-payment refund is unavailable";
async function hasSplitFunding(
  database: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  bookingId: number
) {
  const [split] = await database
    .select({ id: paymentSplits.id })
    .from(paymentSplits)
    .where(
      and(
        eq(paymentSplits.bookingId, bookingId),
        isNotNull(paymentSplits.stripePaymentIntentId)
      )
    )
    .limit(1);
  return Boolean(split);
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
    if (!actor || (!isAdmin(actor.role) && actor.id !== input.userId)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
    }

    if (input.amount !== undefined) {
      if (!isAdmin(actor.role)) {
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

    if (
      booking.userId !== input.userId ||
      (!isAdmin(actor.role) &&
        actor.tenantId !== undefined &&
        actor.tenantId !== booking.tenantId)
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Access denied",
      });
    }

    if (!["paid", "refunded"].includes(booking.paymentStatus)) {
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

    if (await hasSplitFunding(database, booking.id)) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: splitRefundReason,
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

    const savedCancellation = await getOrdinaryRefundCancellation(
      database,
      booking.id
    );
    if (savedCancellation?.amount === 0)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Cancellation without a refund is already recorded; open its cancellation receipt",
      });
    const feeCalculation =
      savedCancellation || input.amount !== undefined
        ? null
        : await quoteCancellationPolicy(database, booking);
    if (
      input.quoteHash &&
      feeCalculation &&
      input.quoteHash !== feeCalculation.quoteHash
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Cancellation quote changed; review the current amounts before confirming",
      });
    if (
      savedCancellation &&
      input.amount !== undefined &&
      input.amount !== savedCancellation.amount
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "An existing cancellation must be reconciled before changing its amount",
      });
    const refundAmount =
      savedCancellation?.amount ??
      input.amount ??
      feeCalculation?.refundAmount ??
      0;

    await assertNoOrderRefundPending(database, booking.id);
    // A refund is applied against the receipt that recorded the collection.
    // Legacy paid rows without one used to get the provider refund and then
    // fail locally forever (and every charge.refunded delivery with them),
    // so refuse before any money moves.
    const [receipt] = await collectionReceipt(
      database,
      booking.stripePaymentIntentId
    );
    if (!receipt)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Payment collection is not reconciled yet; the refund can be issued once the receipt is recorded",
      });
    const existingRefunds = await listActiveRefunds(
      booking.stripePaymentIntentId
    );
    const alreadyRefundedAmount = sumRefundAmounts(existingRefunds);
    const remainingRefundableAmount = refundableBalance(
      booking,
      receipt,
      alreadyRefundedAmount
    );

    // A customer cancels a given collection once. Keying that operation by its
    // recalculated fee would issue another refund after a cancellation tier changes.
    const legacyRefundId = `booking-${input.bookingId}-refund-${refundAmount}`;
    const cancellationId = `booking-${input.bookingId}-cancel-${booking.stripePaymentIntentId}`;
    const refundOperationId =
      savedCancellation?.operationId ??
      (input.amount === undefined ? cancellationId : legacyRefundId);
    const priorCancellation = existingRefunds.find(
      refund =>
        refund.metadata?.bookingId === String(input.bookingId) &&
        refund.metadata.refundOperationId === cancellationId &&
        (input.amount === undefined || input.amount === refund.amount)
    );
    const existingOperationRefund =
      priorCancellation ??
      existingRefunds.find(
        refund =>
          refund.metadata?.bookingId === String(input.bookingId) &&
          refund.metadata.refundOperationId === legacyRefundId &&
          refund.amount === refundAmount
      );

    if (!existingOperationRefund && !savedCancellation) {
      if (refundAmount === 0)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "This fare has no refund. Confirm the zero-refund cancellation quote to cancel the itinerary",
        });
      // Old releases used the amount alone for both policy cancellations and
      // manual overrides. A different historic amount has no proof of intent.
      if (
        input.amount === undefined &&
        existingRefunds.some(
          refund =>
            refund.metadata?.refundOperationId ===
            `booking-${input.bookingId}-refund-${refund.amount}`
        )
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "An earlier refund must be reconciled before this cancellation",
        });
      }
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

      if (
        booking.paymentStatus === "refunded" ||
        remainingRefundableAmount <= 0
      ) {
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

      // A new operation on this endpoint cancels the whole itinerary, including
      // a fee-bearing partial refund. Prior provider outcomes still reconcile.
      await assertBookingDepartureReleasable(database, booking);
      await assertNoFlownCouponForCancellation(database, booking.id);
    }
    const selectedAmount = existingOperationRefund?.amount ?? refundAmount;
    const selectedOperation =
      existingOperationRefund?.metadata?.refundOperationId ?? refundOperationId;
    const request: Stripe.RefundCreateParams = savedCancellation
      ? JSON.parse(savedCancellation.requestPayload)
      : {
          payment_intent: booking.stripePaymentIntentId,
          amount: selectedAmount,
          reason:
            input.reason === "duplicate"
              ? "duplicate"
              : input.reason === "fraudulent"
                ? "fraudulent"
                : "requested_by_customer",
          metadata: {
            bookingId: String(input.bookingId),
            refundOperationId: selectedOperation,
          },
        };
    const otherRefunds = existingRefunds.filter(
      r => r.id !== existingOperationRefund?.id
    );
    if (!savedCancellation && otherRefunds.some(r => r.status !== "succeeded"))
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "An earlier pending refund must be reconciled before this cancellation",
      });
    await reserveOrdinaryRefundCancellation(database, {
      bookingId: booking.id,
      actor,
      userId: input.userId,
      tenantId: booking.tenantId,
      request,
      baseRefundedAmount: sumRefundAmounts(otherRefunds),
      existingRefund: existingOperationRefund,
      policyQuoteHash: existingOperationRefund
        ? undefined
        : feeCalculation?.quoteHash,
    });
    const refund = await processOrdinaryRefundCancellation(
      booking.id,
      existingOperationRefund
    );
    const refundsAfterOperation = await listActiveRefunds(
      booking.stripePaymentIntentId
    );
    const cumulativeRefundedAmount = sumRefundAmounts(refundsAfterOperation);

    // Completion effects are delivered from the verified transition's outbox
    // event, including asynchronous success. A returned request is not success.
    return {
      success: true,
      refundId: refund.id,
      amount: refund.amount,
      status: refund.status,
      cumulativeRefundedAmount,
      remainingRefundableAmount: Math.max(
        0,
        refundableBalance(booking, receipt, cumulativeRefundedAmount)
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

    if (!isAdmin(actor.role)) {
      const paymentIntentId =
        typeof refund.payment_intent === "string"
          ? refund.payment_intent
          : refund.payment_intent?.id;

      if (!paymentIntentId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Refund not found" });
      }

      const database = await getDb();
      if (!database) throw new Error("Database not available");

      const [receipt] = await database
        .select()
        .from(paymentReceipts)
        .where(
          and(
            eq(paymentReceipts.paymentIntentId, paymentIntentId),
            eq(paymentReceipts.userId, actor.id)
          )
        )
        .limit(1);
      const [ownedBooking] = await database
        .select({ id: bookings.id })
        .from(bookings)
        .where(
          and(
            receipt?.bookingId
              ? eq(bookings.id, receipt.bookingId)
              : eq(bookings.stripePaymentIntentId, paymentIntentId),
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
  cancellable?: boolean;
  requiresZeroRefundConfirmation?: boolean;
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

    if (await hasSplitFunding(database, booking.id)) {
      return { refundable: false, reason: splitRefundReason };
    }

    await assertBookingDepartureReleasable(database, booking);
    await assertNoFlownCouponForCancellation(database, bookingId);
    const quote = await quoteCancellationPolicy(database, booking);
    if (quote.refundAmount === 0) {
      await assertZeroCancellationAllowed(database, booking);
      return {
        refundable: false,
        cancellable: true,
        requiresZeroRefundConfirmation: true,
        reason:
          "This fare can be cancelled only after confirming that no money will be refunded",
      };
    }
    const [receipt] = await collectionReceipt(
      database,
      booking.stripePaymentIntentId
    );
    const activeRefunds = await listActiveRefunds(
      booking.stripePaymentIntentId
    );
    if (
      refundableBalance(booking, receipt, sumRefundAmounts(activeRefunds)) <= 0
    ) {
      return { refundable: false, reason: "Booking is already fully refunded" };
    }

    return { refundable: true };
  } catch (error) {
    if (error instanceof TRPCError && error.code === "PRECONDITION_FAILED")
      return { refundable: false, reason: error.message };
    console.error("Error checking refundability:", error);
    return { refundable: false, reason: "Error checking refundability" };
  }
}

/** Quote only; the cancellation command validates the same identity under lock. */
export async function getCancellationQuote(bookingId: number) {
  const database = await getDb();
  if (!database) throw new Error("Database not available");
  return await database.transaction(async tx => {
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .for("update");
    if (!booking)
      throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
    return quoteCancellationPolicy(tx, booking);
  });
}
