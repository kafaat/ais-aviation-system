import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  bookings,
  bookingSegments,
  flights,
  passengers,
  seatInventory,
} from "../../drizzle/schema";
import { getDb } from "../db";
import type { SettlementTx } from "./booking-settlement.service";
import { assertTravelClearance } from "./travel-clearance.service";
import { recordEvent } from "./outbox.service";

/** Booking -> itinerary flights (ascending) -> passenger -> seat is the lock order. */
export async function lockDepartureContext(
  tx: SettlementTx,
  bookingId: number,
  requestedFlightId?: number
) {
  const [booking] = await tx
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), isNull(bookings.deletedAt)))
    .for("update");
  if (!booking)
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
  const legs = await tx
    .select()
    .from(bookingSegments)
    .where(eq(bookingSegments.bookingId, bookingId))
    .orderBy(asc(bookingSegments.segmentOrder))
    .for("update");
  const flightId = requestedFlightId ?? booking.flightId;
  const active = legs.filter(
    l => l.status === "confirmed" || l.status === "pending"
  );
  const member = legs.length ? active.find(l => l.flightId === flightId) : null;
  if (legs.length ? !member : flightId !== booking.flightId)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Booking not found for flight",
    });
  const ids = [
    ...new Set(legs.length ? active.map(l => l.flightId) : [booking.flightId]),
  ];
  const itinerary = await tx
    .select()
    .from(flights)
    .where(inArray(flights.id, ids))
    .orderBy(asc(flights.id))
    .for("update");
  const flight = itinerary.find(f => f.id === flightId);
  if (!flight || itinerary.length !== ids.length)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Itinerary is incomplete",
    });
  return {
    booking,
    flight,
    legs,
    reserved: member ? member.seatsReserved : booking.seatsReserved,
  };
}

export function assertDepartureOpen(
  c: Awaited<ReturnType<typeof lockDepartureContext>>,
  purpose: "check_in" | "boarding"
) {
  if (
    c.booking.status !== "confirmed" ||
    c.booking.paymentStatus !== "paid" ||
    !c.reserved
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "An active paid reservation is required",
    });
  const remaining = c.flight.departureTime.getTime() - Date.now();
  if (
    !["scheduled", "delayed"].includes(c.flight.status) ||
    remaining <= (purpose === "check_in" ? 3600000 : 0) ||
    remaining > 48 * 3600000
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        purpose === "check_in"
          ? "Check-in is open from 48 hours until 1 hour before departure"
          : "Flight is not open for boarding pass issuance or verification",
    });
}

export async function refreshBookingCheckIn(
  tx: SettlementTx,
  bookingId: number
) {
  const [active] = await tx
    .select({ id: seatInventory.id })
    .from(seatInventory)
    .where(
      and(
        eq(seatInventory.bookingId, bookingId),
        eq(seatInventory.status, "checked_in")
      )
    )
    .limit(1);
  // Compatibility flag means ANY passenger/leg checked in. It blocks itinerary
  // changes; passenger/flight state is exclusively held by seat_inventory.
  await tx
    .update(bookings)
    .set({ checkedIn: Boolean(active) })
    .where(eq(bookings.id, bookingId));
}

export async function checkInPassengersTx(
  tx: SettlementTx,
  input: {
    bookingId: number;
    flightId?: number;
    assignments: { passengerId: number; seatNumber?: string }[];
    requireAllPassengers?: boolean;
    owner?: { userId: number; tenantId: number | null };
  }
) {
  const c = await lockDepartureContext(tx, input.bookingId, input.flightId);
  if (
    input.owner &&
    (c.booking.userId !== input.owner.userId ||
      (input.owner.tenantId !== null &&
        c.booking.tenantId !== input.owner.tenantId))
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Booking access denied",
    });
  assertDepartureOpen(c, "check_in");
  const ps = await tx
    .select()
    .from(passengers)
    .where(eq(passengers.bookingId, input.bookingId))
    .orderBy(asc(passengers.id))
    .for("update");
  const ids = input.assignments.map(a => a.passengerId);
  const numbers = input.assignments.flatMap(a =>
    a.seatNumber ? [a.seatNumber] : []
  );
  if (
    !ids.length ||
    new Set(ids).size !== ids.length ||
    new Set(numbers).size !== numbers.length ||
    ids.some(id => !ps.some(p => p.id === id)) ||
    (input.requireAllPassengers && ps.length !== ids.length)
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Supply each passenger exactly once with distinct seats",
    });
  const results = [];
  for (const a of input.assignments) {
    await assertTravelClearance(tx, input.bookingId, a.passengerId);
    const previous = await tx
      .select()
      .from(seatInventory)
      .where(
        and(
          eq(seatInventory.flightId, c.flight.id),
          eq(seatInventory.passengerId, a.passengerId)
        )
      )
      .for("update");
    const checked = previous.find(s => s.status === "checked_in");
    if (checked) {
      if (
        checked.bookingId !== input.bookingId ||
        (a.seatNumber && a.seatNumber !== checked.seatNumber) ||
        !checked.boardingGroup ||
        !checked.boardingSequence ||
        !checked.checkInNonce
      )
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Undo check-in before changing seats or repairing a legacy check-in",
        });
      results.push({
        seat: checked,
        boardingGroup: checked.boardingGroup,
        boardingSequence: checked.boardingSequence,
      });
      continue;
    }
    const requested =
      a.seatNumber ??
      previous.find(
        s => s.bookingId === input.bookingId && s.status === "occupied"
      )?.seatNumber;
    const [seat] = await tx
      .select()
      .from(seatInventory)
      .where(
        and(
          eq(seatInventory.flightId, c.flight.id),
          requested
            ? eq(seatInventory.seatNumber, requested)
            : and(
                eq(seatInventory.cabinClass, c.booking.cabinClass),
                eq(seatInventory.status, "available"),
                eq(seatInventory.seatPrice, 0)
              )
        )
      )
      .orderBy(asc(seatInventory.row), asc(seatInventory.column))
      .limit(1)
      .for("update");
    if (!seat)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "No real available seat on this flight",
      });
    if (
      seat.cabinClass !== c.booking.cabinClass ||
      (seat.status === "available" && seat.seatPrice !== 0) ||
      !["available", "occupied"].includes(seat.status) ||
      (seat.passengerId !== null &&
        (seat.passengerId !== a.passengerId ||
          seat.bookingId !== input.bookingId)) ||
      (seat.status === "occupied" && seat.passengerId !== a.passengerId)
    )
      throw new TRPCError({
        code: "CONFLICT",
        message: "Seat unavailable in booked cabin",
      });
    const [seq] = await tx
      .select({
        n: sql<number>`COALESCE(MAX(${seatInventory.boardingSequence}),0)`,
      })
      .from(seatInventory)
      .where(eq(seatInventory.flightId, c.flight.id));
    const boardingSequence = Number(seq?.n ?? 0) + 1;
    const boardingGroup = seat.cabinClass === "business" ? "2" : "4";
    for (const old of previous.filter(s => s.id !== seat.id))
      await tx
        .update(seatInventory)
        .set({
          status: "available",
          bookingId: null,
          passengerId: null,
          assignedAt: null,
          checkedInAt: null,
          boardingPassIssued: false,
          checkInNonce: null,
          boardingGroup: null,
          boardingSequence: null,
        })
        .where(eq(seatInventory.id, old.id));
    const changed = {
      status: "checked_in" as const,
      bookingId: input.bookingId,
      passengerId: a.passengerId,
      assignedAt: seat.assignedAt ?? new Date(),
      checkedInAt: new Date(),
      boardingGroup,
      boardingSequence,
      checkInNonce: randomUUID(),
      boardingPassIssued: false,
    };
    await tx
      .update(seatInventory)
      .set(changed)
      .where(eq(seatInventory.id, seat.id));
    if (c.booking.flightId === c.flight.id)
      await tx
        .update(passengers)
        .set({ seatNumber: seat.seatNumber })
        .where(eq(passengers.id, a.passengerId));
    await recordEvent(tx, {
      eventType: "passenger.checked_in",
      aggregateType: "booking",
      aggregateId: input.bookingId,
      tenantId: c.booking.tenantId,
      payload: {
        bookingId: input.bookingId,
        flightId: c.flight.id,
        passengerId: a.passengerId,
        seatNumber: seat.seatNumber,
      },
    });
    results.push({
      seat: { ...seat, ...changed },
      boardingGroup,
      boardingSequence,
    });
  }
  await refreshBookingCheckIn(tx, input.bookingId);
  return results;
}

export async function checkInPassengers(
  input: Parameters<typeof checkInPassengersTx>[1]
) {
  const db = getDb();
  if (!db) throw new Error("Database unavailable");
  return await db.transaction(tx => checkInPassengersTx(tx, input));
}
