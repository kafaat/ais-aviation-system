import { and, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  bookings,
  dcsPassengerStates,
  flights,
  ordinaryBookingRefunds,
  paymentReceipts,
} from "../../drizzle/schema";
import {
  DepartureReleaseError,
  type SettlementTx,
} from "./booking-settlement.service";

/** Shared cash authority for passenger admission and flight finalization. A
 * failed provider command restores permission only against its original clean
 * collection and unchanged pre-refund balance. */
export function ordinaryRefundRequiresReconciliation(
  booking: typeof bookings.$inferSelect,
  intent: typeof ordinaryBookingRefunds.$inferSelect,
  receipt?: typeof paymentReceipts.$inferSelect
) {
  return (
    intent.status !== "failed" ||
    !["failed", "canceled"].includes(intent.providerStatus ?? "") ||
    !intent.refundId ||
    Boolean(intent.completedAt) ||
    intent.paymentIntentId !== booking.stripePaymentIntentId ||
    !Number.isSafeInteger(intent.amount) ||
    intent.amount <= 0 ||
    !Number.isSafeInteger(intent.baseRefundedAmount) ||
    intent.baseRefundedAmount < 0 ||
    !Number.isSafeInteger(intent.collectedAmount) ||
    intent.baseRefundedAmount + intent.amount > intent.collectedAmount ||
    !receipt ||
    receipt.bookingId !== booking.id ||
    receipt.userId !== booking.userId ||
    receipt.kind !== "booking" ||
    receipt.targetId !== booking.id ||
    receipt.amount !== intent.collectedAmount ||
    receipt.currency.toUpperCase() !== "SAR" ||
    receipt.refundedAmount !== intent.baseRefundedAmount ||
    receipt.settlementStatus !== "applied" ||
    Boolean(receipt.settlementError)
  );
}

function hold(): never {
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      "Departure reconciliation is required before final DCS closure or OUT",
  });
}

/** Fresh flight-level commands call this under the flight lock in a READ
 * COMMITTED transaction. Refund settlement takes that same flight lock before
 * committing a departure quarantine. These bounded, nonlocking reads see its
 * committed result after a wait without reversing booking -> receipt -> flight
 * lock order. Ordinary desk/manifest reads and physical recovery stay separate. */
export async function assertFlightDepartureFinanciallyReconciled(
  tx: SettlementTx,
  flight: Pick<typeof flights.$inferSelect, "id" | "tenantId">
) {
  const maxBoarded = 2000;
  const boarded = await tx
    .select({ bookingId: dcsPassengerStates.bookingId })
    .from(dcsPassengerStates)
    .where(
      and(
        eq(dcsPassengerStates.flightId, flight.id),
        eq(dcsPassengerStates.state, "boarded")
      )
    )
    .limit(maxBoarded + 1);
  if (boarded.length > maxBoarded) hold();
  if (!boarded.length) return;
  const ids = [...new Set(boarded.map(row => row.bookingId))];
  const reservations = await tx
    .select()
    .from(bookings)
    .where(inArray(bookings.id, ids))
    .limit(ids.length);
  if (
    reservations.length !== ids.length ||
    reservations.some(booking => booking.tenantId !== flight.tenantId)
  )
    hold();
  const [review] = await tx
    .select({ id: paymentReceipts.paymentIntentId })
    .from(paymentReceipts)
    .where(
      and(
        inArray(paymentReceipts.bookingId, ids),
        eq(paymentReceipts.settlementStatus, "review_required"),
        inArray(paymentReceipts.settlementError, DepartureReleaseError.reasons)
      )
    )
    .limit(1);
  if (review) hold();
  const intents = await tx
    .select()
    .from(ordinaryBookingRefunds)
    .where(inArray(ordinaryBookingRefunds.bookingId, ids))
    .limit(ids.length);
  if (!intents.length) return;
  const failed = intents.filter(intent => intent.status === "failed");
  const receipts = failed.length
    ? await tx
        .select()
        .from(paymentReceipts)
        .where(
          inArray(
            paymentReceipts.paymentIntentId,
            failed.map(intent => intent.paymentIntentId)
          )
        )
        .limit(failed.length)
    : [];
  const byBooking = new Map(reservations.map(booking => [booking.id, booking]));
  const byPayment = new Map(
    receipts.map(receipt => [receipt.paymentIntentId, receipt])
  );
  for (const intent of intents) {
    const booking = byBooking.get(intent.bookingId);
    if (
      !booking ||
      ordinaryRefundRequiresReconciliation(
        booking,
        intent,
        byPayment.get(intent.paymentIntentId)
      )
    )
      hold();
  }
}
