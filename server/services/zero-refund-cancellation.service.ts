import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import {
  bookings,
  bookingSegments,
  bookingAncillaries,
  bookingModifications,
  flights,
  ordinaryBookingRefunds,
  paymentReceipts,
  paymentSplits,
  seatInventory,
} from "../../drizzle/schema";
import { getDb } from "../db";
import {
  assertBookingDepartureReleasable,
  assertNoCollectionReview,
  cancelBookingResources,
  type SettlementTx,
} from "./booking-settlement.service";
import { assertNoFlownCouponForCancellation } from "./ticket-coupons.service";
import { assertNoOrderRefundPending } from "./order-refunds.service";
import { quoteCancellationPolicy } from "./cancellation-policy.service";
import { isAdmin } from "./rbac.service";
import { recordEvent } from "./outbox.service";

type Actor = { id: number; role: string; tenantId?: number | null };
const unavailable = (message: string) =>
  new TRPCError({ code: "PRECONDITION_FAILED", message });
export const zeroCancellationInput = z
  .object({
    bookingId: z.number().int().positive(),
    quoteHash: z.string().regex(/^[a-f0-9]{64}$/),
    confirmNoRefund: z.literal(true),
    reason: z.string().trim().min(1).max(200),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();
export const zeroCancellationReceipt = z.object({
  cancellationId: z.string(),
  bookingId: z.number().int().positive(),
  status: z.literal("cancelled_without_refund"),
  totalAmount: z.number().int().positive(),
  cancellationFee: z.number().int().nonnegative(),
  refundAmount: z.literal(0),
  currency: z.literal("SAR"),
  policyReason: z.enum(["nonrefundable_fare", "time_based"]),
  confirmedAt: z.date(),
});
const savedDecision = z.object({
  purpose: z.literal("cancellation_without_refund"),
  quoteHash: z.string(),
  policyReason: z.enum(["nonrefundable_fare", "time_based"]),
  totalAmount: z.number().int().positive(),
  cancellationFee: z.number().int().nonnegative(),
  refundAmount: z.literal(0),
  reason: z.string(),
  notes: z.string().nullable(),
});

async function lockOwnedBooking(
  tx: SettlementTx,
  bookingId: number,
  actor: Actor
) {
  if (!actor) throw new TRPCError({ code: "UNAUTHORIZED" });
  const [booking] = await tx
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .for("update");
  if (
    !booking ||
    (!isAdmin(actor.role) &&
      (booking.userId !== actor.id ||
        (actor.tenantId !== undefined && actor.tenantId !== booking.tenantId)))
  )
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
  return booking;
}

/** Shared by the preview and command. Zero cash does not remove operational or
 * original-funding safeguards. The command runs this again under the booking lock. */
export async function assertZeroCancellationAllowed(
  tx: SettlementTx,
  booking: typeof bookings.$inferSelect
) {
  if (
    booking.status !== "confirmed" ||
    booking.paymentStatus !== "paid" ||
    booking.deletedAt ||
    booking.checkedIn
  )
    throw unavailable(
      "Only a confirmed, paid booking before check-in can be cancelled without a refund"
    );
  await assertNoCollectionReview(tx, booking.id);
  await assertNoOrderRefundPending(tx, booking.id);
  await assertNoFlownCouponForCancellation(tx, booking.id);
  const segments = await tx
    .select()
    .from(bookingSegments)
    .where(eq(bookingSegments.bookingId, booking.id));
  if (segments.some(s => s.status === "completed"))
    throw unavailable("A completed sector requires departure reconciliation");
  const ids = [
    ...new Set([
      booking.flightId,
      ...segments.filter(s => s.status !== "cancelled").map(s => s.flightId),
    ]),
  ].sort((a, b) => a - b);
  const itinerary = await tx
    .select()
    .from(flights)
    .where(inArray(flights.id, ids))
    .orderBy(flights.id)
    .for("update");
  if (
    itinerary.length !== ids.length ||
    itinerary.some(
      f =>
        f.tenantId !== booking.tenantId ||
        f.status !== "scheduled" ||
        f.departureTime <= new Date()
    )
  )
    throw unavailable(
      "Departed, disrupted or inconsistent flights require servicing review"
    );
  await assertBookingDepartureReleasable(
    tx,
    booking,
    ids.map(flightId => ({ flightId }))
  );
  const [checkedIn] = await tx
    .select()
    .from(seatInventory)
    .where(
      and(
        eq(seatInventory.bookingId, booking.id),
        eq(seatInventory.status, "checked_in")
      )
    )
    .limit(1);
  if (checkedIn)
    throw unavailable("Airport offload is required before cancellation");
  const services = await tx
    .select()
    .from(bookingAncillaries)
    .where(
      and(
        eq(bookingAncillaries.bookingId, booking.id),
        eq(bookingAncillaries.status, "active")
      )
    );
  if (services.some(s => s.totalPrice > 0))
    throw unavailable(
      "Paid services require a separate cancellation and refund review"
    );
  const [modification] = await tx
    .select()
    .from(bookingModifications)
    .where(
      and(
        eq(bookingModifications.bookingId, booking.id),
        inArray(bookingModifications.status, ["pending", "approved"]),
        isNotNull(bookingModifications.checkoutRequestId)
      )
    )
    .limit(1);
  if (modification)
    throw unavailable(
      "An in-progress paid modification must be reconciled before cancellation"
    );
}

function receiptFor(intent: typeof ordinaryBookingRefunds.$inferSelect) {
  if (
    intent.amount !== 0 ||
    intent.providerStatus !== "not_required" ||
    intent.status !== "succeeded" ||
    !intent.completedAt
  )
    return null;
  const decision = savedDecision.parse(JSON.parse(intent.requestPayload));
  return zeroCancellationReceipt.parse({
    cancellationId: intent.operationId,
    bookingId: intent.bookingId,
    status: "cancelled_without_refund",
    totalAmount: decision.totalAmount,
    cancellationFee: decision.cancellationFee,
    refundAmount: 0,
    currency: "SAR",
    policyReason: decision.policyReason,
    confirmedAt: intent.completedAt,
  });
}

export async function getZeroCancellationReceipt(
  bookingId: number,
  actor: Actor
) {
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  return db.transaction(async tx => {
    const booking = await lockOwnedBooking(tx, bookingId, actor);
    const [intent] = await tx
      .select()
      .from(ordinaryBookingRefunds)
      .where(eq(ordinaryBookingRefunds.bookingId, booking.id))
      .for("update");
    return booking.status === "cancelled" && intent ? receiptFor(intent) : null;
  });
}

/** A local cancellation decision, not a zero-value provider refund. The saved
 * receipt and all resource effects commit together; replay returns that receipt. */
export async function cancelBookingWithoutRefund(
  raw: z.infer<typeof zeroCancellationInput>,
  actor: Actor
) {
  const input = zeroCancellationInput.parse(raw);
  const db = await getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  return db.transaction(async tx => {
    const booking = await lockOwnedBooking(tx, input.bookingId, actor);
    const [previous] = await tx
      .select()
      .from(ordinaryBookingRefunds)
      .where(eq(ordinaryBookingRefunds.bookingId, booking.id))
      .for("update");
    if (previous) {
      const receipt = receiptFor(previous);
      if (!receipt || booking.status !== "cancelled")
        throw unavailable(
          "An existing refund or cancellation must be reconciled first"
        );
      const decision = savedDecision.parse(JSON.parse(previous.requestPayload));
      if (decision.quoteHash !== input.quoteHash)
        throw unavailable(
          "Cancellation is already recorded; refresh its receipt"
        );
      return receipt;
    }
    const [split] = await tx
      .select()
      .from(paymentSplits)
      .where(
        and(
          eq(paymentSplits.bookingId, booking.id),
          isNotNull(paymentSplits.stripePaymentIntentId)
        )
      )
      .limit(1);
    if (split)
      throw unavailable(
        "Use the per-payer cancellation quote for split funding"
      );
    const receipts = await tx
      .select()
      .from(paymentReceipts)
      .where(eq(paymentReceipts.bookingId, booking.id))
      .for("update");
    const [collection] = receipts;
    if (
      receipts.length !== 1 ||
      !collection ||
      collection.kind !== "booking" ||
      collection.targetId !== booking.id ||
      collection.userId !== booking.userId ||
      collection.paymentIntentId !== booking.stripePaymentIntentId ||
      collection.amount !== booking.totalAmount ||
      collection.currency !== "SAR" ||
      collection.refundedAmount !== 0 ||
      collection.settlementStatus !== "applied"
    )
      throw unavailable(
        "Cancellation requires one reconciled, unrefunded original payment; internal or mixed funding needs servicing review"
      );
    await assertZeroCancellationAllowed(tx, booking);
    const quote = await quoteCancellationPolicy(tx, booking);
    if (quote.quoteHash !== input.quoteHash || quote.refundAmount !== 0)
      throw unavailable(
        "Cancellation quote changed; review the current fare and refund before confirming"
      );
    const operationId = `booking-${booking.id}-cancel-without-refund`;
    const now = new Date(Math.floor(Date.now() / 1000) * 1000);
    const decision = {
      purpose: "cancellation_without_refund" as const,
      quoteHash: quote.quoteHash,
      policyReason: quote.policyReason,
      totalAmount: quote.totalAmount,
      cancellationFee: quote.cancellationFee,
      refundAmount: 0 as const,
      reason: input.reason,
      notes: input.notes ?? null,
    };
    await tx.insert(ordinaryBookingRefunds).values({
      bookingId: booking.id,
      paymentIntentId: collection.paymentIntentId,
      operationId,
      actorId: actor.id,
      amount: 0,
      collectedAmount: collection.amount,
      baseRefundedAmount: 0,
      requestPayload: JSON.stringify(decision),
      status: "succeeded",
      providerStatus: "not_required",
      refundId: null,
      requestedAt: null,
      nextAttemptAt: now,
      completedAt: now,
    });
    await cancelBookingResources(
      tx,
      booking,
      "Customer confirmed cancellation without a refund",
      actor.id
    );
    await tx
      .update(bookingAncillaries)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(bookingAncillaries.bookingId, booking.id),
          eq(bookingAncillaries.status, "active")
        )
      );
    await recordEvent(tx, {
      aggregateType: "booking",
      aggregateId: booking.id,
      tenantId: booking.tenantId,
      eventType: "booking.cancelled_without_refund",
      payload: {
        ...decision,
        bookingId: booking.id,
        operationId,
        actorId: actor.id,
      },
    });
    return zeroCancellationReceipt.parse({
      cancellationId: operationId,
      bookingId: booking.id,
      status: "cancelled_without_refund",
      ...quote,
      currency: "SAR",
      confirmedAt: now,
    });
  });
}
