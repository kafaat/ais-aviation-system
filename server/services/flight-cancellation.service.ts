import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  bookings,
  flights,
  flightCancellationJobs,
  orderServiceRefunds,
  paymentReceipts,
} from "../../drizzle/schema";
import {
  flightBookingCondition,
  transitionFlight,
} from "./flight-state.service";
import {
  planOrderRefund,
  processPendingOrderRefunds,
} from "./order-refunds.service";
import { cancelBookingResources } from "./booking-settlement.service";
import { recordEvent } from "./outbox.service";

/** Capture targets after the flight lock closes sales. Retry resumes the same jobs. */
export async function requestFlightCancellation(input: {
  flightId: number;
  reason: string;
  actorId?: number;
}) {
  const db = getDb();
  if (!db) throw new Error("Database unavailable");
  if (!input.reason.trim() || input.reason.length > 500)
    throw new Error("Cancellation reason required");
  await db.transaction(async tx => {
    await transitionFlight(tx, {
      flightId: input.flightId,
      status: "cancelled",
      reason: input.reason,
      adminUserId: input.actorId,
    });
    const targets = await tx
      .select()
      .from(bookings)
      .where(
        and(
          flightBookingCondition(input.flightId),
          inArray(bookings.status, ["pending", "confirmed"])
        )
      );
    for (const b of targets)
      await tx
        .insert(flightCancellationJobs)
        .values({
          flightId: input.flightId,
          bookingId: b.id,
          reason: input.reason,
          actorId: input.actorId,
        })
        .onDuplicateKeyUpdate({
          set: { bookingId: sql`${flightCancellationJobs.bookingId}` },
        });
  });
  return await getFlightCancellationStatus(input.flightId);
}
export async function getFlightCancellationStatus(flightId: number) {
  const db = getDb();
  if (!db) throw new Error("Database unavailable");
  const jobs = await db
    .select()
    .from(flightCancellationJobs)
    .where(eq(flightCancellationJobs.flightId, flightId));
  const items = await db
    .select({ bookingId: orderServiceRefunds.bookingId })
    .from(orderServiceRefunds)
    .where(
      and(
        eq(orderServiceRefunds.cancellationFlightId, flightId),
        eq(orderServiceRefunds.status, "succeeded")
      )
    );
  const refunded = new Set(items.map(i => i.bookingId));
  return {
    success: true,
    requestedBookings: jobs.length,
    completedBookings: jobs.filter(j => j.status === "completed").length,
    refundedBookings: jobs.filter(
      j => j.status === "completed" && refunded.has(j.bookingId)
    ).length,
    pendingBookings: jobs.filter(j => ["queued", "planned"].includes(j.status))
      .length,
    reviewRequiredBookings: jobs.filter(j => j.status === "review_required")
      .length,
  };
}
export async function processFlightCancellations() {
  const db = getDb();
  if (!db) throw new Error("Database unavailable");
  const jobs = await db
    .select()
    .from(flightCancellationJobs)
    .where(eq(flightCancellationJobs.status, "queued"))
    .limit(100);
  const failures: unknown[] = [];
  for (const hint of jobs) {
    try {
      await db.transaction(async tx => {
        const [booking] = await tx
          .select()
          .from(bookings)
          .where(eq(bookings.id, hint.bookingId))
          .for("update");
        const [job] = await tx
          .select()
          .from(flightCancellationJobs)
          .where(eq(flightCancellationJobs.id, hint.id))
          .for("update");
        if (!job || job.status !== "queued") return;
        const [flight] = await tx
          .select()
          .from(flights)
          .where(eq(flights.id, hint.flightId));
        if (!booking || flight?.status !== "cancelled")
          throw new Error("cancellation_owner_state_changed");
        const receipts = await tx
          .select()
          .from(paymentReceipts)
          .where(eq(paymentReceipts.bookingId, booking.id))
          .for("update");
        const balances = receipts.filter(r => r.amount > r.refundedAmount);
        if (
          balances.some(
            r => r.settlementStatus !== "applied" || r.currency !== "SAR"
          ) ||
          (booking.paymentStatus === "paid" && !receipts.length)
        )
          throw new Error("original_collection_requires_reconciliation");
        const amount = balances.reduce(
          (n, r) => n + r.amount - r.refundedAmount,
          0
        );
        if (amount > 0)
          await planOrderRefund(tx, booking, null, amount, hint.flightId);
        // Local offload and resource release are explicit. This is not an airport receipt.
        await cancelBookingResources(
          tx,
          booking,
          `Flight cancellation: ${job.reason}`,
          job.actorId ?? undefined
        );
        await tx
          .update(flightCancellationJobs)
          .set({
            status: amount > 0 ? "planned" : "completed",
            errorCode: null,
          })
          .where(eq(flightCancellationJobs.id, job.id));
        await recordEvent(tx, {
          aggregateType: "booking",
          aggregateId: booking.id,
          tenantId: booking.tenantId,
          eventType: "flight.refund_planned",
          payload: {
            flightId: hint.flightId,
            bookingId: booking.id,
            amount,
            jobId: job.id,
          },
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const review =
        /original_collection_requires_reconciliation|cancellation_owner_state_changed|refund liability|Cancellation refund plan|Original refundable payer|collection is awaiting|collected payment is awaiting/i.test(
          message
        );
      if (!review) failures.push(error);
      await db
        .update(flightCancellationJobs)
        .set({
          status: review ? "review_required" : "queued",
          errorCode:
            error instanceof Error &&
            [
              "original_collection_requires_reconciliation",
              "cancellation_owner_state_changed",
            ].includes(error.message)
              ? error.message
              : review
                ? "refund_plan_requires_reconciliation"
                : "transient_planning_failure",
        })
        .where(
          and(
            eq(flightCancellationJobs.id, hint.id),
            eq(flightCancellationJobs.status, "queued")
          )
        );
    }
  }
  await processPendingOrderRefunds();
  const pending = await db
    .select()
    .from(flightCancellationJobs)
    .where(eq(flightCancellationJobs.status, "planned"))
    .limit(100);
  for (const hint of pending)
    await db.transaction(async tx => {
      await tx
        .select()
        .from(bookings)
        .where(eq(bookings.id, hint.bookingId))
        .for("update");
      const items = await tx
        .select()
        .from(orderServiceRefunds)
        .where(
          and(
            eq(orderServiceRefunds.bookingId, hint.bookingId),
            eq(orderServiceRefunds.cancellationFlightId, hint.flightId)
          )
        )
        .for("update");
      const state =
        items.length && items.every(i => i.status === "succeeded")
          ? "completed"
          : items.some(i => ["failed", "review_required"].includes(i.status))
            ? "review_required"
            : "planned";
      await tx
        .update(flightCancellationJobs)
        .set({ status: state })
        .where(eq(flightCancellationJobs.id, hint.id));
    });
  if (failures.length)
    throw new AggregateError(
      failures,
      "Flight cancellation planning will retry"
    );
  return { scanned: jobs.length + pending.length };
}
