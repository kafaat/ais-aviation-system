import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  eventInbox,
  eventDeliveries,
  bookings,
  notifications,
  waitlist,
  groupBookings,
  type OutboxEvent,
} from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";
import { calculateRequestHash } from "./idempotency-v2.service";
import { syncBookingMiles } from "./loyalty.service";
export type InboxEvent = Pick<
  OutboxEvent,
  | "eventId"
  | "eventType"
  | "aggregateId"
  | "aggregateType"
  | "tenantId"
  | "payload"
>;

async function persistEnvelope(tx: SettlementTx, event: InboxEvent) {
  const payload = z.record(z.string(), z.json()).parse(event.payload);
  await tx
    .insert(eventInbox)
    .values({ ...event, payload })
    .onDuplicateKeyUpdate({ set: { eventId: sql`${eventInbox.eventId}` } });
  const [saved] = await tx
    .select()
    .from(eventInbox)
    .where(eq(eventInbox.eventId, event.eventId))
    .for("update");
  if (
    !saved ||
    saved.eventType !== event.eventType ||
    saved.aggregateId !== event.aggregateId ||
    saved.aggregateType !== event.aggregateType ||
    saved.tenantId !== event.tenantId ||
    calculateRequestHash(saved.payload) !== calculateRequestHash(payload)
  )
    throw new Error("Event identity conflicts with its stored receipt");
  return saved;
}
async function localEffect(
  event: InboxEvent,
  consumer: string,
  effect: (tx: SettlementTx) => Promise<void>
) {
  const db = getDb();
  if (!db) throw new Error("Inbox database unavailable");
  try {
    return await db.transaction(async tx => {
      await persistEnvelope(tx, event);
      await tx
        .insert(eventDeliveries)
        .values({ eventId: event.eventId, consumer })
        .onDuplicateKeyUpdate({
          set: { eventId: sql`${eventDeliveries.eventId}` },
        });
      const [receipt] = await tx
        .select()
        .from(eventDeliveries)
        .where(
          and(
            eq(eventDeliveries.eventId, event.eventId),
            eq(eventDeliveries.consumer, consumer)
          )
        )
        .for("update");
      if (!receipt) throw new Error("Consumer receipt unavailable");
      if (receipt.status === "processed") return { duplicate: true };
      await effect(tx);
      await tx
        .update(eventDeliveries)
        .set({
          status: "processed",
          processedAt: new Date(),
          attempts: receipt.attempts + 1,
          lastError: null,
        })
        .where(eq(eventDeliveries.id, receipt.id));
      return { duplicate: false };
    });
  } catch (error) {
    await db.transaction(async tx => {
      await persistEnvelope(tx, event);
      await tx
        .insert(eventDeliveries)
        .values({ eventId: event.eventId, consumer })
        .onDuplicateKeyUpdate({
          set: { eventId: sql`${eventDeliveries.eventId}` },
        });
      await tx
        .update(eventDeliveries)
        .set({
          status: "failed",
          attempts: sql`${eventDeliveries.attempts} + 1`,
          lastError: "Local consumer transaction rolled back",
        })
        .where(
          and(
            eq(eventDeliveries.eventId, event.eventId),
            eq(eventDeliveries.consumer, consumer),
            sql`${eventDeliveries.status} <> 'processed'`
          )
        );
    });
    throw error;
  }
}
/** One receipt per external effect. Lease fencing and provider idempotency survive retries. */
export async function deliverExternalEffect(
  event: InboxEvent,
  consumer: string,
  effect: () => Promise<void>
) {
  const db = getDb();
  if (!db) throw new Error("Inbox database unavailable");
  const token = randomUUID();
  const claim = await db.transaction(async tx => {
    await persistEnvelope(tx, event);
    await tx
      .insert(eventDeliveries)
      .values({ eventId: event.eventId, consumer })
      .onDuplicateKeyUpdate({
        set: { eventId: sql`${eventDeliveries.eventId}` },
      });
    const [receipt] = await tx
      .select()
      .from(eventDeliveries)
      .where(
        and(
          eq(eventDeliveries.eventId, event.eventId),
          eq(eventDeliveries.consumer, consumer)
        )
      )
      .for("update");
    if (!receipt) throw new Error("Consumer receipt unavailable");
    if (receipt.status === "processed") return null;
    if (
      receipt.status === "processing" &&
      receipt.leaseUntil &&
      receipt.leaseUntil > new Date()
    )
      throw new Error("Consumer delivery is already in progress");
    await tx
      .update(eventDeliveries)
      .set({
        status: "processing",
        attempts: receipt.attempts + 1,
        leaseToken: token,
        leaseUntil: new Date(Date.now() + 300000),
        lastError: null,
      })
      .where(eq(eventDeliveries.id, receipt.id));
    return receipt;
  });
  if (!claim) return { duplicate: true };
  try {
    await effect();
    const [written] = await db
      .update(eventDeliveries)
      .set({
        status: "processed",
        processedAt: new Date(),
        leaseToken: null,
        leaseUntil: null,
      })
      .where(
        and(
          eq(eventDeliveries.id, claim.id),
          eq(eventDeliveries.leaseToken, token)
        )
      );
    if (written.affectedRows !== 1)
      throw new Error("Consumer lease changed during delivery");
    return { duplicate: false };
  } catch (error) {
    await db
      .update(eventDeliveries)
      .set({
        status: "failed",
        lastError:
          "External consumer failed; inspect its provider/transport status",
        leaseToken: null,
        leaseUntil: null,
      })
      .where(
        and(
          eq(eventDeliveries.id, claim.id),
          eq(eventDeliveries.leaseToken, token)
        )
      );
    throw error;
  }
}
const bookingMessages: Record<string, string> = {
  "booking.created": "Booking Created",
  "booking.confirmed": "Booking Confirmed",
  "booking.cancelled": "Booking Cancelled",
  "booking.split_refund_completed": "Payer Refunds Confirmed",
  "booking.split_refund_review_required": "Refund Review Required",
};
async function notificationEffect(tx: SettlementTx, event: InboxEvent) {
  const payload = z.record(z.string(), z.json()).parse(event.payload);
  if (Object.hasOwn(bookingMessages, event.eventType)) {
    if (event.aggregateType !== "booking")
      throw new Error("Booking event aggregate mismatch");
    const [b] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, Number(event.aggregateId)));
    if (!b || b.tenantId !== event.tenantId)
      throw new Error("Event tenant does not own booking");
    if (
      event.eventType === "booking.confirmed" &&
      (b.status !== "confirmed" || b.paymentStatus !== "paid")
    )
      return;
    await tx.insert(notifications).values({
      userId: b.userId,
      type: "booking",
      title: bookingMessages[event.eventType],
      message: `${bookingMessages[event.eventType]}: ${b.bookingReference}`,
      data: JSON.stringify({
        bookingId: b.id,
        eventId: event.eventId,
        link: "/my-bookings",
      }),
    });
  } else if (event.eventType === "flight.status_changed") {
    const ids = z.array(z.number().int().positive()).parse(payload.bookingIds);
    if (!ids.length) return;
    const rows = await tx
      .select()
      .from(bookings)
      .where(inArray(bookings.id, ids));
    for (const b of rows) {
      if (b.tenantId !== event.tenantId)
        throw new Error("Flight event tenant mismatch");
      await tx.insert(notifications).values({
        userId: b.userId,
        type: "flight",
        title: "Flight Status Update",
        message: `${String(payload.flightNumber)}: ${String(payload.newStatus)}`,
        data: JSON.stringify({
          flightId: Number(event.aggregateId),
          bookingId: b.id,
          eventId: event.eventId,
          link: "/my-bookings",
        }),
      });
    }
  } else {
    const [allocation] =
      event.eventType === "waitlist.offered"
        ? await tx
            .select({ userId: waitlist.userId })
            .from(waitlist)
            .where(eq(waitlist.id, Number(event.aggregateId)))
        : await tx
            .select({ userId: groupBookings.organizerUserId })
            .from(groupBookings)
            .where(eq(groupBookings.id, Number(event.aggregateId)));
    if (!allocation?.userId)
      throw new Error("Allocation recipient unavailable");
    await tx.insert(notifications).values({
      userId: allocation.userId,
      type: "booking",
      title: "Seats Allocated",
      message:
        "Complete passenger details and payment before the allocation expires.",
      data: JSON.stringify({
        eventId: event.eventId,
        link:
          event.eventType === "waitlist.offered" ? "/waitlist" : "/my-groups",
      }),
    });
  }
}
/** Archive every envelope, but mark domain handling only for registered effects. */
export async function consumeLocalEvent(event: InboxEvent) {
  const db = getDb();
  if (!db) throw new Error("Inbox database unavailable");
  const saved = await db.transaction(tx => persistEnvelope(tx, event));
  const tasks: Promise<{ duplicate: boolean }>[] = [];
  if (
    Object.hasOwn(bookingMessages, event.eventType) ||
    ["flight.status_changed", "waitlist.offered", "group.allocated"].includes(
      event.eventType
    )
  )
    tasks.push(
      localEffect(event, "notifications", tx => notificationEffect(tx, event))
    );
  if (
    [
      "booking.confirmed",
      "booking.cancelled",
      "payment.refunded",
      "booking.split_refund_completed",
    ].includes(event.eventType)
  ) {
    const payload = z.record(z.string(), z.json()).parse(event.payload);
    const bookingId =
      event.aggregateType === "booking"
        ? Number(event.aggregateId)
        : payload.bookingId;
    if (bookingId !== null && bookingId !== undefined)
      tasks.push(
        localEffect(event, "loyalty", async tx => {
          const id = z.number().int().positive().parse(bookingId);
          const [b] = await tx
            .select()
            .from(bookings)
            .where(eq(bookings.id, id));
          if (!b || b.tenantId !== event.tenantId)
            throw new Error("Loyalty event tenant mismatch");
          await syncBookingMiles(tx, id, b.userId);
        })
      );
  }
  const results = await Promise.allSettled(tasks);
  const failures = results.filter(r => r.status === "rejected");
  if (failures.length)
    throw new AggregateError(
      failures.map(f => f.reason),
      "Local event consumers failed"
    );
  if (tasks.length)
    await db
      .update(eventInbox)
      .set({ processedAt: new Date() })
      .where(eq(eventInbox.eventId, event.eventId));
  return {
    duplicate: Boolean(saved.processedAt),
    archivedOnly: tasks.length === 0,
  };
}
