import { and, eq, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  bookings,
  flights,
  groupBookings,
  waitlist,
} from "../../drizzle/schema";
import { countActiveHolds } from "./inventory-capacity.service";
import { recordEvent } from "./outbox.service";

/** A manual adjustment cannot erase reservations or promises made by any channel. */
export async function adjustFlightAvailability(input: {
  flightId: number;
  cabinClass: "economy" | "business";
  seats: number;
  tenantId?: number;
  actorId?: number;
  reason: string;
}) {
  const db = getDb();
  if (!db) throw new Error("Database unavailable");
  if (
    !Number.isSafeInteger(input.seats) ||
    input.seats < 0 ||
    !input.reason.trim()
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid availability adjustment",
    });
  return await db.transaction(async tx => {
    const [flight] = await tx
      .select()
      .from(flights)
      .where(
        and(
          eq(flights.id, input.flightId),
          input.tenantId == null
            ? undefined
            : eq(flights.tenantId, input.tenantId)
        )
      )
      .for("update");
    if (!flight) return false;
    const cabin = input.cabinClass;
    const [reserved] = await tx
      .select({
        n: sql<number>`COALESCE(SUM(${bookings.numberOfPassengers}),0)`,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.cabinClass, cabin),
          sql`(EXISTS (SELECT 1 FROM booking_segments bs WHERE bs.bookingId = ${bookings.id} AND bs.flightId = ${flight.id} AND bs.seatsReserved = true) OR (${bookings.flightId} = ${flight.id} AND ${bookings.seatsReserved} = true AND NOT EXISTS (SELECT 1 FROM booking_segments bs WHERE bs.bookingId = ${bookings.id} AND bs.flightId = ${flight.id})))`
        )
      );
    const [legacyGroups] = await tx
      .select({ n: sql<number>`COALESCE(SUM(${groupBookings.groupSize}),0)` })
      .from(groupBookings)
      .where(
        and(
          eq(groupBookings.flightId, flight.id),
          eq(groupBookings.cabinClass, cabin),
          eq(groupBookings.status, "confirmed"),
          isNull(groupBookings.inventoryLockId),
          isNull(groupBookings.bookingId)
        )
      );
    const [legacyOffers] = await tx
      .select({ n: sql<number>`COALESCE(SUM(${waitlist.seats}),0)` })
      .from(waitlist)
      .where(
        and(
          eq(waitlist.flightId, flight.id),
          eq(waitlist.cabinClass, cabin),
          sql`${waitlist.status} IN ('offered','confirmed')`,
          isNull(waitlist.inventoryLockId),
          isNull(waitlist.bookingId)
        )
      );
    const reservedSeats =
      Number(reserved?.n ?? 0) +
      Number(legacyGroups?.n ?? 0) +
      Number(legacyOffers?.n ?? 0);
    const heldSeats = await countActiveHolds(tx, flight.id, cabin);
    const capacity =
      cabin === "economy" ? flight.economySeats : flight.businessSeats;
    const previous =
      cabin === "economy" ? flight.economyAvailable : flight.businessAvailable;
    if (input.seats > capacity - reservedSeats || input.seats < heldSeats)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Adjustment would exceed physical capacity or invalidate active reservations/holds",
      });
    await tx
      .update(flights)
      .set(
        cabin === "economy"
          ? { economyAvailable: input.seats }
          : { businessAvailable: input.seats }
      )
      .where(eq(flights.id, flight.id));
    await recordEvent(tx, {
      aggregateType: "flight",
      aggregateId: flight.id,
      tenantId: flight.tenantId,
      eventType: "inventory.adjusted",
      payload: {
        cabinClass: cabin,
        previous,
        available: input.seats,
        capacity,
        reservedSeats,
        heldSeats,
        actorId: input.actorId ?? null,
        reason: input.reason,
      },
    });
    return true;
  });
}
