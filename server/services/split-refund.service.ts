import { randomUUID } from "node:crypto";
import { and, eq, inArray, lte, desc, lt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type Stripe from "stripe";
import {
  bookings,
  bookingSegments,
  flights,
  paymentSplits,
  paymentReceipts,
  bookingRefundPlans,
  bookingRefundItems,
  bookingAncillaries,
  seatInventory,
} from "../../drizzle/schema";
import { getDb } from "../db";
import { stripe } from "../stripe";
import { calculateCancellationFee } from "./cancellation-fees.service";
import { calculateRequestHash } from "./idempotency-v2.service";
import {
  cancelBookingResources,
  type SettlementTx,
} from "./booking-settlement.service";
import { settleVerifiedRefund } from "./payment-settlement.service";
import { recordEvent } from "./outbox.service";

type Actor = { id: number; role: string };
type Booking = typeof bookings.$inferSelect;
type Item = typeof bookingRefundItems.$inferSelect;
const options = { timeout: 15000, maxNetworkRetries: 0 };
const unavailable = (message: string) =>
  new TRPCError({ code: "PRECONDITION_FAILED", message });
const dbOrThrow = () => {
  const db = getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  return db;
};
async function lockBooking(tx: SettlementTx, bookingId: number, actor?: Actor) {
  const [booking] = await tx
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .for("update");
  if (
    !booking ||
    (actor && actor.role !== "admin" && actor.id !== booking.userId)
  )
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
  return booking;
}
async function lockPlan(tx: SettlementTx, bookingId: number) {
  const [plan] = await tx
    .select()
    .from(bookingRefundPlans)
    .where(eq(bookingRefundPlans.bookingId, bookingId))
    .for("update");
  return plan;
}
async function lockItems(tx: SettlementTx, bookingId: number) {
  return tx
    .select()
    .from(bookingRefundItems)
    .where(eq(bookingRefundItems.bookingId, bookingId))
    .orderBy(bookingRefundItems.splitId)
    .for("update");
}

/** Largest-remainder allocation uses integer arithmetic, conserves every halala
 * and breaks equal remainders by stable split ID, independent of query order. */
export function allocateSplitRefund(
  shares: { splitId: number; amount: number }[],
  refundAmount: number
) {
  const total = shares.reduce((n, s) => n + s.amount, 0);
  if (
    shares.length < 2 ||
    shares.length > 20 ||
    new Set(shares.map(s => s.splitId)).size !== shares.length ||
    shares.some(s => !Number.isSafeInteger(s.amount) || s.amount <= 0) ||
    !Number.isSafeInteger(total) ||
    !Number.isSafeInteger(refundAmount) ||
    refundAmount <= 0 ||
    refundAmount > total
  )
    throw unavailable("Invalid refund allocation");
  const portions = shares.map(s => {
    const product = BigInt(s.amount) * BigInt(refundAmount);
    return {
      ...s,
      refundAmount: Number(product / BigInt(total)),
      remainder: product % BigInt(total),
    };
  });
  let left = refundAmount - portions.reduce((n, s) => n + s.refundAmount, 0);
  portions.sort((a, b) =>
    a.remainder === b.remainder
      ? a.splitId - b.splitId
      : a.remainder > b.remainder
        ? -1
        : 1
  );
  for (const s of portions) if (left-- > 0) s.refundAmount++;
  return portions
    .sort((a, b) => a.splitId - b.splitId)
    .map(({ remainder: _remainder, ...s }) => s);
}

async function quoteFor(tx: SettlementTx, booking: Booking) {
  if (
    booking.status !== "confirmed" ||
    booking.paymentStatus !== "paid" ||
    booking.checkedIn ||
    booking.deletedAt
  )
    throw unavailable(
      "Only confirmed, paid bookings before check-in can use split cancellation"
    );
  const shares = await tx
    .select()
    .from(paymentSplits)
    .where(eq(paymentSplits.bookingId, booking.id))
    .orderBy(paymentSplits.id)
    .for("update");
  const active = shares.filter(
    s => !["cancelled", "expired"].includes(s.status)
  );
  const receipts = await tx
    .select()
    .from(paymentReceipts)
    .where(eq(paymentReceipts.bookingId, booking.id))
    .for("update");
  const funding = receipts.filter(
    r => r.settlementStatus !== "review_refunded"
  );
  if (
    active.length < 2 ||
    active.length > 20 ||
    active.some(
      s =>
        s.status !== "paid" || !Number.isSafeInteger(s.amount) || s.amount < 100
    ) ||
    funding.length !== active.length ||
    funding.some(
      r =>
        r.kind !== "split_payment" ||
        r.settlementStatus !== "applied" ||
        r.refundedAmount !== 0
    ) ||
    active.some(
      s =>
        !funding.some(
          r =>
            r.paymentIntentId === s.stripePaymentIntentId &&
            r.targetId === s.id &&
            r.userId === booking.userId &&
            r.amount === s.amount &&
            r.currency.toLowerCase() === "sar"
        )
    ) ||
    active.reduce((n, s) => n + s.amount, 0) !== booking.totalAmount
  )
    throw unavailable(
      "Split funding must be fully reconciled and unrefunded before cancellation"
    );
  const segments = await tx
    .select()
    .from(bookingSegments)
    .where(eq(bookingSegments.bookingId, booking.id))
    .for("update");
  const flightIds = [
    ...new Set([booking.flightId, ...segments.map(s => s.flightId)]),
  ].sort((a, b) => a - b);
  const itinerary = await tx
    .select()
    .from(flights)
    .where(inArray(flights.id, flightIds))
    .orderBy(flights.id)
    .for("update");
  if (itinerary.length !== flightIds.length)
    throw unavailable("Itinerary is incomplete");
  const [checkedInPassenger] = await tx
    .select({ id: seatInventory.id })
    .from(seatInventory)
    .where(
      and(
        eq(seatInventory.bookingId, booking.id),
        eq(seatInventory.status, "checked_in")
      )
    )
    .limit(1)
    .for("update");
  if (checkedInPassenger)
    throw unavailable(
      "A passenger is checked in; airport offload is required before cancellation"
    );
  const departure = new Date(
    Math.min(...itinerary.map(f => f.departureTime.getTime()))
  );
  const fee = calculateCancellationFee(booking.totalAmount, departure);
  if (fee.refundAmount <= 0 || departure.getTime() <= Date.now())
    throw unavailable(
      "Self-service cancellation is unavailable after departure"
    );
  const allocated = allocateSplitRefund(
    active.map(s => ({ splitId: s.id, amount: s.amount })),
    fee.refundAmount
  );
  const items = allocated.map(a => {
    const s = active.find(s => s.id === a.splitId)!;
    return {
      splitId: s.id,
      payerName: s.payerName,
      paidAmount: s.amount,
      refundAmount: a.refundAmount,
      paymentIntentId: s.stripePaymentIntentId!,
    };
  });
  const quoteHash = calculateRequestHash({
    bookingId: booking.id,
    userId: booking.userId,
    tenantId: booking.tenantId,
    cabinClass: booking.cabinClass,
    numberOfPassengers: booking.numberOfPassengers,
    itinerary: itinerary.map(f => ({
      id: f.id,
      departureTime: f.departureTime,
    })),
    fee,
    items,
  });
  return { ...fee, quoteHash, items };
}

async function view(tx: SettlementTx, booking: Booking) {
  const plan = await lockPlan(tx, booking.id);
  if (plan) {
    const items = await lockItems(tx, booking.id);
    const shares = await tx
      .select()
      .from(paymentSplits)
      .where(eq(paymentSplits.bookingId, booking.id));
    return {
      splitFunded: true,
      quote: null,
      reason: null,
      plan: {
        id: plan.id,
        status: plan.status,
        totalAmount: plan.totalAmount,
        refundAmount: plan.refundAmount,
        cancellationFee: plan.cancellationFee,
        items: items.map(i => ({
          splitId: i.splitId,
          payerName:
            shares.find(s => s.id === i.splitId)?.payerName ??
            `Payer ${i.splitId}`,
          paidAmount: i.collectedAmount,
          refundAmount: i.refundAmount,
          status: i.status,
          refundedAmount: i.status === "succeeded" ? i.refundAmount : 0,
          refundId: i.refundId,
          errorCode: i.errorCode,
        })),
      },
    };
  }
  const shares = await tx
    .select()
    .from(paymentSplits)
    .where(eq(paymentSplits.bookingId, booking.id));
  if (!shares.some(s => s.stripePaymentIntentId))
    return { splitFunded: false, quote: null, plan: null, reason: null };
  try {
    const quote = await quoteFor(tx, booking);
    return {
      splitFunded: true,
      plan: null,
      reason: null,
      quote: {
        ...quote,
        items: quote.items.map(({ paymentIntentId: _id, ...i }) => i),
      },
    };
  } catch (error) {
    if (!(error instanceof TRPCError) || error.code !== "PRECONDITION_FAILED")
      throw error;
    return {
      splitFunded: true,
      quote: null,
      plan: null,
      reason: error.message,
    };
  }
}

/** Read/preview has no provider effects and never reserves a cancellation. */
export async function getSplitRefundCancellation(
  bookingId: number,
  actor: Actor
) {
  if (!actor) throw new TRPCError({ code: "UNAUTHORIZED" });
  return dbOrThrow().transaction(async tx =>
    view(tx, await lockBooking(tx, bookingId, actor))
  );
}

/** Booking lock serializes double clicks and collection/refund races. The plan,
 * each original payer request, all itinerary releases and audit events commit together. */
export async function reserveSplitRefundCancellation(
  input: {
    bookingId: number;
    quoteHash: string;
    reason: "requested_by_customer" | "duplicate";
    notes?: string;
  },
  actor: Actor
) {
  if (!actor) throw new TRPCError({ code: "UNAUTHORIZED" });
  if (
    !/^[a-f0-9]{64}$/.test(input.quoteHash) ||
    !["requested_by_customer", "duplicate"].includes(input.reason) ||
    (input.notes?.length ?? 0) > 500
  )
    throw new TRPCError({ code: "BAD_REQUEST" });
  return dbOrThrow().transaction(async tx => {
    const booking = await lockBooking(tx, input.bookingId, actor);
    const previous = await lockPlan(tx, booking.id);
    if (previous) {
      if (previous.quoteHash !== input.quoteHash)
        throw unavailable(
          "Cancellation is already reserved; refresh its status"
        );
      return view(tx, booking);
    }
    const quote = await quoteFor(tx, booking);
    if (quote.quoteHash !== input.quoteHash)
      throw unavailable(
        "Cancellation quote changed; review the new amounts before confirming"
      );
    const planId = randomUUID();
    await tx.insert(bookingRefundPlans).values({
      bookingId: booking.id,
      id: planId,
      actorId: actor.id,
      quoteHash: quote.quoteHash,
      totalAmount: quote.totalAmount,
      refundAmount: quote.refundAmount,
      cancellationFee: quote.cancellationFee,
      policyTier: quote.tier,
      reason: input.reason,
      notes: input.notes ?? null,
      status: "processing",
    });
    for (const allocation of quote.items) {
      const id = randomUUID();
      const request: Stripe.RefundCreateParams = {
        payment_intent: allocation.paymentIntentId,
        amount: allocation.refundAmount,
        reason: input.reason,
        metadata: {
          purpose: "split_cancellation",
          bookingId: String(booking.id),
          planId,
          refundRequestId: id,
          splitId: String(allocation.splitId),
        },
      };
      await tx.insert(bookingRefundItems).values({
        id,
        bookingId: booking.id,
        planId,
        splitId: allocation.splitId,
        paymentIntentId: allocation.paymentIntentId,
        collectedAmount: allocation.paidAmount,
        refundAmount: allocation.refundAmount,
        requestPayload: JSON.stringify(request),
        status: "queued",
        requestedAt: null,
        refundId: null,
        providerStatus: null,
        errorCode: null,
        nextAttemptAt: new Date(),
      });
    }
    await cancelBookingResources(
      tx,
      booking,
      "Split cancellation with reserved payer refunds",
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
      eventType: "booking.split_refund_reserved",
      payload: {
        bookingId: booking.id,
        planId,
        actorId: actor.id,
        refundAmount: quote.refundAmount,
        cancellationFee: quote.cancellationFee,
      },
    });
    return view(tx, booking);
  });
}

async function updatePlanStatus(tx: SettlementTx, booking: Booking) {
  const plan = await lockPlan(tx, booking.id);
  if (!plan) throw new Error("Refund plan missing");
  const items = await lockItems(tx, booking.id);
  const status = items.some(i =>
    ["failed", "review_required"].includes(i.status)
  )
    ? "review_required"
    : items.length >= 2 && items.every(i => i.status === "succeeded")
      ? "completed"
      : "processing";
  if (status === plan.status) return;
  await tx
    .update(bookingRefundPlans)
    .set({ status })
    .where(eq(bookingRefundPlans.bookingId, booking.id));
  await recordEvent(tx, {
    aggregateType: "booking",
    aggregateId: booking.id,
    tenantId: booking.tenantId,
    eventType: `booking.split_refund_${status}`,
    payload: {
      bookingId: booking.id,
      planId: plan.id,
      refundAmount: plan.refundAmount,
      cancellationFee: plan.cancellationFee,
    },
  });
}
async function requireReview(
  tx: SettlementTx,
  booking: Booking,
  item: Item,
  code: string
) {
  if (item.status === "review_required" && item.errorCode === code) return;
  await tx
    .update(bookingRefundItems)
    .set({ status: "review_required", errorCode: code })
    .where(eq(bookingRefundItems.id, item.id));
  await recordEvent(tx, {
    aggregateType: "booking",
    aggregateId: booking.id,
    tenantId: booking.tenantId,
    eventType: "booking.split_refund_item_review",
    payload: {
      bookingId: booking.id,
      splitId: item.splitId,
      requestId: item.id,
      code,
    },
  });
  await updatePlanStatus(tx, booking);
}
const reference = (value: string | { id: string } | null) =>
  typeof value === "string" ? value : value?.id;
function requestForItem(item: Item): Stripe.RefundCreateParams {
  const request = JSON.parse(item.requestPayload) as Stripe.RefundCreateParams;
  const metadata = {
    purpose: "split_cancellation",
    bookingId: String(item.bookingId),
    planId: item.planId,
    refundRequestId: item.id,
    splitId: String(item.splitId),
  };
  if (
    request.payment_intent !== item.paymentIntentId ||
    request.amount !== item.refundAmount ||
    !Number.isSafeInteger(item.refundAmount) ||
    item.refundAmount <= 0 ||
    item.refundAmount > item.collectedAmount ||
    !["requested_by_customer", "duplicate"].includes(request.reason ?? "") ||
    Object.keys(request).sort().join(",") !==
      "amount,metadata,payment_intent,reason" ||
    calculateRequestHash(request.metadata) !== calculateRequestHash(metadata)
  )
    throw unavailable("Invalid frozen refund request");
  return request;
}
function matches(item: Item, refund: Stripe.Refund) {
  const request = requestForItem(item);
  return (
    refund.id &&
    (!item.refundId || item.refundId === refund.id) &&
    reference(refund.payment_intent) === item.paymentIntentId &&
    reference(refund.charge) &&
    refund.amount === item.refundAmount &&
    refund.currency.toLowerCase() === "sar" &&
    Object.entries(request.metadata ?? {}).every(
      ([k, v]) => refund.metadata?.[k] === v
    )
  );
}

/** Accept only a signature-verified webhook or an authenticated Stripe response.
 * A charge aggregate alone cannot prove an individual refund succeeded. */
export async function recordVerifiedSplitRefund(
  tx: SettlementTx,
  refund: Stripe.Refund,
  eventId: string
) {
  const paymentIntentId = reference(refund.payment_intent);
  if (!paymentIntentId) return false;
  const [hint] = await tx
    .select()
    .from(bookingRefundItems)
    .where(eq(bookingRefundItems.paymentIntentId, paymentIntentId))
    .limit(1);
  if (!hint) return false;
  const booking = await lockBooking(tx, hint.bookingId);
  await lockPlan(tx, booking.id);
  const item = (await lockItems(tx, booking.id)).find(i => i.id === hint.id)!;
  if (!matches(item, refund)) {
    await requireReview(tx, booking, item, "provider_refund_conflict");
    return true;
  }
  const failed = refund.status === "failed" || refund.status === "canceled";
  // Terminal failure/review cannot be undone by an older success or pending event.
  if (["failed", "review_required"].includes(item.status)) return true;
  if (item.status === "succeeded") {
    if (failed || refund.status === "requires_action")
      await requireReview(tx, booking, item, "provider_reversed_refund");
    return true;
  }
  const status = failed
    ? "failed"
    : refund.status === "succeeded"
      ? "succeeded"
      : "pending";
  await tx
    .update(bookingRefundItems)
    .set({
      refundId: refund.id,
      status,
      providerStatus: refund.status,
      errorCode: failed
        ? "provider_refund_failed"
        : refund.status === "requires_action"
          ? "provider_action_required"
          : null,
      nextAttemptAt: new Date(Date.now() + 5 * 60_000),
    })
    .where(eq(bookingRefundItems.id, item.id));
  if (status === "succeeded") {
    // Reservation admitted exactly one untouched receipt per payer. This verified
    // individual refund is that receipt's confirmed cumulative refund; aggregate
    // charge events are deferred for these planned references (see settlement).
    await settleVerifiedRefund(tx, {
      paymentIntentId,
      chargeId: reference(refund.charge)!,
      amount: item.collectedAmount,
      amountRefunded: item.refundAmount,
      currency: refund.currency,
      eventId,
      refundId: refund.id,
    });
  }
  if (item.status !== status || item.providerStatus !== refund.status)
    await recordEvent(tx, {
      aggregateType: "booking",
      aggregateId: booking.id,
      tenantId: booking.tenantId,
      eventType: "booking.split_refund_item_updated",
      payload: {
        bookingId: booking.id,
        splitId: item.splitId,
        requestId: item.id,
        status,
      },
    });
  await updatePlanStatus(tx, booking);
  return true;
}

/** A single durable provider command, shared by the authenticated UI and worker.
 * Transport retries always use the saved payload and key. A missing outcome older
 * than 23h is quarantined; listing may still recover it without issuing money. */
async function processItem(bookingId: number, splitId: number, actor?: Actor) {
  const db = dbOrThrow();
  const item = await db.transaction(async tx => {
    await lockBooking(tx, bookingId, actor);
    if (!(await lockPlan(tx, bookingId)))
      throw unavailable("Cancellation plan not found");
    const item = (await lockItems(tx, bookingId)).find(
      i => i.splitId === splitId
    );
    if (!item)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Refund share not found",
      });
    try {
      requestForItem(item);
    } catch {
      const booking = await lockBooking(tx, bookingId, actor);
      await requireReview(tx, booking, item, "invalid_refund_request");
      return null;
    }
    if (
      item.status === "succeeded" ||
      item.status === "failed" ||
      (item.status === "review_required" &&
        item.errorCode !== "unknown_provider_outcome")
    )
      return null;
    const requestedAt = item.requestedAt ?? new Date();
    await tx
      .update(bookingRefundItems)
      .set({
        requestedAt,
        status: item.status === "queued" ? "requesting" : item.status,
        nextAttemptAt: new Date(Date.now() + 60_000),
      })
      .where(eq(bookingRefundItems.id, item.id));
    return { ...item, requestedAt };
  });
  if (!item) return;
  try {
    let refund: Stripe.Refund | undefined;
    if (item.refundId) {
      refund = await stripe.refunds.retrieve(item.refundId, options);
    } else {
      let scanned = 0;
      let conflict = false;
      for await (const existing of stripe.refunds.list(
        { payment_intent: item.paymentIntentId, limit: 100 },
        options
      )) {
        if (++scanned > 1000) {
          conflict = true;
          break;
        }
        if (existing.metadata?.refundRequestId === item.id) {
          if (refund) conflict = true;
          refund = existing;
        } else if (
          existing.status !== "failed" &&
          existing.status !== "canceled"
        )
          conflict = true;
      }
      if (conflict) {
        await db.transaction(async tx => {
          const booking = await lockBooking(tx, bookingId);
          const current = (await lockItems(tx, bookingId)).find(
            i => i.id === item.id
          )!;
          await requireReview(tx, booking, current, "provider_refund_conflict");
        });
        return;
      }
      if (!refund) {
        if (Date.now() - item.requestedAt.getTime() >= 23 * 3600_000) {
          await db.transaction(async tx => {
            const booking = await lockBooking(tx, bookingId);
            const current = (await lockItems(tx, bookingId)).find(
              i => i.id === item.id
            )!;
            if (!["succeeded", "pending", "failed"].includes(current.status))
              await requireReview(
                tx,
                booking,
                current,
                "unknown_provider_outcome"
              );
          });
          return;
        }
        refund = await stripe.refunds.create(requestForItem(item), {
          ...options,
          idempotencyKey: `split-refund:${item.id}`,
        });
      }
    }
    await db.transaction(async tx => {
      const booking = await lockBooking(tx, bookingId);
      const current = (await lockItems(tx, bookingId)).find(
        i => i.id === item.id
      )!;
      if (!matches(current, refund!)) {
        await requireReview(tx, booking, current, "provider_refund_conflict");
        return;
      }
      // A previously unknown result may now be safely recovered from Stripe.
      if (
        current.status === "review_required" &&
        current.errorCode === "unknown_provider_outcome"
      )
        await tx
          .update(bookingRefundItems)
          .set({ status: "requesting", errorCode: null })
          .where(eq(bookingRefundItems.id, item.id));
      await recordVerifiedSplitRefund(
        tx,
        refund!,
        `split-refund-reconcile:${refund!.id}`
      );
    });
  } catch {
    // Never infer failure/no charge from a transport error, including a successful
    // provider response followed by a local transaction failure.
    await db.transaction(async tx => {
      await lockBooking(tx, bookingId);
      const current = (await lockItems(tx, bookingId)).find(
        i => i.id === item.id
      )!;
      if (["queued", "requesting", "pending"].includes(current.status))
        await tx
          .update(bookingRefundItems)
          .set({
            errorCode: "provider_unavailable",
            nextAttemptAt: new Date(Date.now() + 60_000),
          })
          .where(eq(bookingRefundItems.id, item.id));
    });
  }
}

export async function resumeSplitRefundCancellation(
  input: { bookingId: number; splitId: number },
  actor: Actor
) {
  if (!actor) throw new TRPCError({ code: "UNAUTHORIZED" });
  await processItem(input.bookingId, input.splitId, actor);
  return getSplitRefundCancellation(input.bookingId, actor);
}

/** Runs only in the worker cron catalog, bounded to five independent shares per
 * minute. Due-time ordering prevents one pending bank refund starving the queue. */
export async function processPendingSplitRefunds() {
  const due = await dbOrThrow()
    .select()
    .from(bookingRefundItems)
    .where(
      and(
        inArray(bookingRefundItems.status, ["queued", "requesting", "pending"]),
        lte(bookingRefundItems.nextAttemptAt, new Date())
      )
    )
    .orderBy(bookingRefundItems.nextAttemptAt, bookingRefundItems.id)
    .limit(5);
  for (const item of due) await processItem(item.bookingId, item.splitId);
  return { scanned: due.length };
}

/** Admin queue exposes booked amounts and plan status; payer details remain in
 * the same owned detail endpoint used by the customer. */
export async function listSplitRefundCancellations(
  input: {
    beforeBookingId?: number;
    status?: "processing" | "completed" | "review_required";
  },
  actor: Actor
) {
  if (actor?.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
  const plans = await dbOrThrow()
    .select({
      bookingId: bookingRefundPlans.bookingId,
      status: bookingRefundPlans.status,
      refundAmount: bookingRefundPlans.refundAmount,
      cancellationFee: bookingRefundPlans.cancellationFee,
    })
    .from(bookingRefundPlans)
    .where(
      and(
        input.beforeBookingId
          ? lt(bookingRefundPlans.bookingId, input.beforeBookingId)
          : undefined,
        input.status ? eq(bookingRefundPlans.status, input.status) : undefined
      )
    )
    .orderBy(desc(bookingRefundPlans.bookingId))
    .limit(21);
  const items = plans.slice(0, 20);
  return {
    items,
    nextCursor: plans.length > 20 ? items.at(-1)!.bookingId : null,
  };
}
