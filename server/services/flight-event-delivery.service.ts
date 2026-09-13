import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db";
import { bookings, users, flights, airports } from "../../drizzle/schema";
import { deliverExternalEffect, type InboxEvent } from "./event-inbox.service";
import { sendFlightStatusChange } from "./email.service";
export async function deliverFlightStatusEmails(event: InboxEvent) {
  const db = getDb();
  if (!db) throw new Error("Database unavailable");
  const p = z
    .object({
      bookingIds: z.array(z.number().int().positive()),
      flightId: z.number().int().positive(),
      flightNumber: z.string(),
      oldStatus: z.string(),
      newStatus: z.string(),
      departureTime: z.iso.datetime(),
      delayMinutes: z.number().nullable(),
      reason: z.string().nullable(),
    })
    .parse(event.payload);
  const outcomes = await Promise.allSettled(
    p.bookingIds.map(bookingId =>
      deliverExternalEffect(event, `flight-email:${bookingId}`, async () => {
        const [b] = await db
          .select({
            reference: bookings.bookingReference,
            email: users.email,
            name: users.name,
          })
          .from(bookings)
          .innerJoin(users, eq(users.id, bookings.userId))
          .where(and(eq(bookings.id, bookingId), sqlTenant(event.tenantId)));
        if (!b?.email)
          throw new Error("Flight notification recipient unavailable");
        const [f] = await db
          .select()
          .from(flights)
          .where(eq(flights.id, p.flightId));
        if (!f) throw new Error("Flight notification source unavailable");
        const [origin] = await db
          .select()
          .from(airports)
          .where(eq(airports.id, f.originId));
        const [destination] = await db
          .select()
          .from(airports)
          .where(eq(airports.id, f.destinationId));
        if (!origin || !destination)
          throw new Error("Flight route unavailable");
        const accepted = await sendFlightStatusChange({
          idempotencyKey: `${event.eventId}:flight-email:${bookingId}`,
          passengerName: b.name ?? "Passenger",
          passengerEmail: b.email,
          bookingReference: b.reference,
          flightNumber: p.flightNumber,
          origin: origin.code,
          destination: destination.code,
          departureTime: new Date(p.departureTime),
          oldStatus: p.oldStatus,
          newStatus: p.newStatus,
          delayMinutes: p.delayMinutes ?? undefined,
          reason: p.reason ?? undefined,
        });
        if (!accepted) throw new Error("Flight status email was not accepted");
      })
    )
  );
  const failures = outcomes.filter(r => r.status === "rejected");
  if (failures.length)
    throw new AggregateError(
      failures.map(f => f.reason),
      "Flight email delivery incomplete"
    );
}
function sqlTenant(tenantId: number | null) {
  return tenantId === null
    ? isNull(bookings.tenantId)
    : eq(bookings.tenantId, tenantId);
}
