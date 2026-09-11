import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  eventInbox,
  bookings,
  notifications,
  type OutboxEvent,
} from "../../drizzle/schema";
import { calculateRequestHash } from "./idempotency-v2.service";

export type InboxEvent = Pick<
  OutboxEvent,
  | "eventId"
  | "eventType"
  | "aggregateId"
  | "aggregateType"
  | "tenantId"
  | "payload"
>;

/** Stable event identity, receipt and local effects commit in one transaction.
 * Other event types are retained as integration records for registered consumers. */
export async function consumeLocalEvent(event: InboxEvent) {
  const database = await getDb();
  if (!database) throw new Error("Inbox database unavailable");
  const payload = z.record(z.string(), z.json()).parse(event.payload);
  return database.transaction(async tx => {
    await tx
      .insert(eventInbox)
      .values({ ...event, payload })
      .onDuplicateKeyUpdate({ set: { eventId: sql`${eventInbox.eventId}` } });
    const [receipt] = await tx
      .select()
      .from(eventInbox)
      .where(eq(eventInbox.eventId, event.eventId))
      .limit(1)
      .for("update");
    if (
      !receipt ||
      receipt.eventType !== event.eventType ||
      receipt.aggregateId !== event.aggregateId ||
      receipt.aggregateType !== event.aggregateType ||
      receipt.tenantId !== event.tenantId ||
      calculateRequestHash(receipt.payload) !==
        calculateRequestHash(event.payload)
    )
      throw new Error("Event identity conflicts with its stored receipt");
    if (receipt.processedAt) return { duplicate: true };
    const bookingMessages: Record<
      string,
      { title: string; message: (reference: string) => string }
    > = {
      "booking.created": {
        title: "Booking Created",
        message: ref => `Booking ${ref} was created.`,
      },
      "booking.cancelled": {
        title: "Booking Cancelled",
        message: ref => `Booking ${ref} has been cancelled.`,
      },
      "booking.split_refund_completed": {
        title: "Payer Refunds Confirmed",
        message: ref =>
          `All planned payer refunds for booking ${ref} are confirmed. Any agreed cancellation fee is retained.`,
      },
      "booking.split_refund_review_required": {
        title: "Refund Review Required",
        message: ref =>
          `A payer refund for booking ${ref} needs support review. Check the cancellation details in My Bookings.`,
      },
    };
    const notification = Object.hasOwn(bookingMessages, event.eventType)
      ? bookingMessages[event.eventType]
      : undefined;
    if (notification) {
      if (event.aggregateType !== "booking")
        throw new Error("Booking event aggregate type mismatch");
      const [booking] = await tx
        .select()
        .from(bookings)
        .where(and(eq(bookings.id, Number(event.aggregateId))))
        .limit(1);
      if (!booking) throw new Error("Booking event aggregate is unavailable");
      if (booking.tenantId !== event.tenantId)
        throw new Error("Event tenant does not own booking");
      if (booking)
        await tx.insert(notifications).values({
          userId: booking.userId,
          type: "booking",
          title: notification.title,
          message: notification.message(booking.bookingReference),
          data: JSON.stringify({
            bookingId: booking.id,
            eventId: event.eventId,
            link: "/my-bookings",
          }),
        });
    }
    await tx
      .update(eventInbox)
      .set({ processedAt: new Date() })
      .where(eq(eventInbox.eventId, event.eventId));
    return { duplicate: false };
  });
}
