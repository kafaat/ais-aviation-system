import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { bookings, bookingSegments } from "../../drizzle/schema";
import { getDb } from "../db";
/** Compensation can concern a historical cancelled leg too. Ownership is on
 * the booking; a replacement does not erase the traveller's earlier claim. */
export async function resolveClaimFlight(
  bookingId: number,
  userId: number,
  requestedFlightId?: number
) {
  const db = getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const [booking] = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.userId, userId)));
  if (!booking)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Owned booking not found",
    });
  const segments = await db
    .select({ flightId: bookingSegments.flightId })
    .from(bookingSegments)
    .where(eq(bookingSegments.bookingId, bookingId));
  const ids = [
    ...new Set(
      segments.length ? segments.map(s => s.flightId) : [booking.flightId]
    ),
  ];
  if (requestedFlightId !== undefined) {
    if (!ids.includes(requestedFlightId))
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Flight is not part of this booking",
      });
    return requestedFlightId;
  }
  if (ids.length !== 1)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Choose the disrupted flight for this multi-segment booking",
    });
  return ids[0];
}

export async function getClaimTargets(bookingId: number, userId: number) {
  const db = getDb();
  if (!db) throw new TRPCError({ code: "SERVICE_UNAVAILABLE" });
  const [booking] = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.userId, userId)));
  if (!booking) throw new TRPCError({ code: "NOT_FOUND" });
  const { flights, passengers } = await import("../../drizzle/schema");
  const { inArray } = await import("drizzle-orm");
  const segments = await db
    .select({ flightId: bookingSegments.flightId })
    .from(bookingSegments)
    .where(eq(bookingSegments.bookingId, bookingId));
  const ids = [
    ...new Set(
      segments.length ? segments.map(s => s.flightId) : [booking.flightId]
    ),
  ];
  return {
    flights: await db
      .select({ id: flights.id, flightNumber: flights.flightNumber })
      .from(flights)
      .where(inArray(flights.id, ids)),
    passengers: await db
      .select({
        id: passengers.id,
        firstName: passengers.firstName,
        lastName: passengers.lastName,
      })
      .from(passengers)
      .where(eq(passengers.bookingId, bookingId)),
  };
}
