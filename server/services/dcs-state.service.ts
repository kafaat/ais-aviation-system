import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import {
  bookings,
  bookingSegments,
  passengers,
  seatInventory,
  dcsFlightOperations,
  dcsPassengerStates,
} from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";

export type DcsPassengerKey = {
  bookingId: number;
  passengerId: number;
  flightId: number;
};
export type DcsAttendanceState = typeof dcsPassengerStates.$inferSelect.state;
export type DcsDepartureState = DcsAttendanceState | "boarding_denied";
export type DcsPassengerState = typeof dcsPassengerStates.$inferSelect;

/** Read on the same snapshot as the report that will display the passengers. */
export async function readReconciledBoardings(
  tx: SettlementTx,
  flight: { id: number; tenantId: number | null },
  historicalManifest = false
) {
  const maxBoarded = 2000;
  const boarded = await tx
    .select({
      bookingId: dcsPassengerStates.bookingId,
      passengerId: dcsPassengerStates.passengerId,
    })
    .from(dcsPassengerStates)
    .where(
      and(
        eq(dcsPassengerStates.flightId, flight.id),
        eq(dcsPassengerStates.state, "boarded")
      )
    )
    .limit(maxBoarded + 1);
  if (boarded.length > maxBoarded)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Departure reconciliation is required: too many boarded records to verify safely",
    });
  // A completed flight can release inventory. Its manifest still verifies
  // that every boarded passenger is represented by the historical reservation.
  if (!boarded.length || historicalManifest) return boarded;
  const bookingIds = [...new Set(boarded.map(b => b.bookingId))];
  const passengerIds = boarded.map(b => b.passengerId);
  const reservations = await tx
    .select()
    .from(bookings)
    .where(inArray(bookings.id, bookingIds));
  const people = await tx
    .select()
    .from(passengers)
    .where(inArray(passengers.id, passengerIds));
  const legs = await tx
    .select()
    .from(bookingSegments)
    .where(inArray(bookingSegments.bookingId, bookingIds))
    .limit(20001);
  const seats = await tx
    .select()
    .from(seatInventory)
    .where(
      and(
        eq(seatInventory.flightId, flight.id),
        inArray(seatInventory.passengerId, passengerIds),
        inArray(seatInventory.bookingId, bookingIds)
      )
    )
    .limit(maxBoarded + 1);
  if (legs.length > 20000 || seats.length > maxBoarded)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Departure reconciliation is required: passenger evidence exceeds the safe read limit",
    });
  for (const state of boarded) {
    const booking = reservations.find(b => b.id === state.bookingId);
    const person = people.find(
      p => p.id === state.passengerId && p.bookingId === state.bookingId
    );
    const itinerary = legs.filter(l => l.bookingId === state.bookingId);
    const active = itinerary.filter(
      l =>
        l.flightId === flight.id && ["pending", "confirmed"].includes(l.status)
    );
    const reserved = itinerary.length
      ? active.length === 1 && active[0].seatsReserved
      : booking?.flightId === flight.id && booking.seatsReserved;
    const assigned = seats.filter(
      s =>
        s.bookingId === state.bookingId && s.passengerId === state.passengerId
    );
    const seat = assigned[0];
    if (
      !booking ||
      booking.deletedAt != null ||
      booking.tenantId !== flight.tenantId ||
      booking.status !== "confirmed" ||
      booking.paymentStatus !== "paid" ||
      !reserved ||
      !person ||
      (person.tenantId != null && person.tenantId !== flight.tenantId) ||
      assigned.length !== 1 ||
      seat?.status !== "checked_in" ||
      !seat.checkInNonce ||
      !seat.checkedInAt ||
      !seat.boardingSequence ||
      seat.cabinClass !== booking.cabinClass
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Departure reconciliation is required: a boarded passenger cannot be matched to an active paid reservation with a current checked-in seat",
      });
  }
  return boarded;
}

/** Call under the canonical booking -> flight locks, before passenger writes. */
export async function assertDcsCheckInOpen(tx: SettlementTx, flightId: number) {
  const [state] = await tx
    .select()
    .from(dcsFlightOperations)
    .where(eq(dcsFlightOperations.flightId, flightId))
    .for("update");
  // An unconfigured legacy flight retains the existing time-window rules.
  if (state?.checkInState === "closed")
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Flight check-in is closed by departure control",
    });
}

/** The caller must already hold the booking and flight locks, in that order. */
export async function readDcsPassengerState(
  tx: SettlementTx,
  key: DcsPassengerKey
): Promise<DcsPassengerState | null> {
  const [state] = await tx
    .select()
    .from(dcsPassengerStates)
    .where(
      and(
        eq(dcsPassengerStates.bookingId, key.bookingId),
        eq(dcsPassengerStates.passengerId, key.passengerId),
        eq(dcsPassengerStates.flightId, key.flightId)
      )
    )
    .for("update");
  return state ?? null;
}

export function departureState(
  state: Pick<DcsPassengerState, "state" | "boardingDenied"> | null | undefined,
  checkedIn: boolean
): DcsDepartureState {
  if (state?.boardingDenied) return "boarding_denied";
  if (state?.state === "boarded") return "boarded";
  if (state?.state === "offloaded" && !checkedIn) return "offloaded";
  return checkedIn ? "checked_in" : "not_checked_in";
}

/** Checked-in seats remain the authority for seat/nonce and coupon identity. */
export async function assertDcsPassengerMutable(
  tx: SettlementTx,
  key: DcsPassengerKey
) {
  const state = await readDcsPassengerState(tx, key);
  if (state?.boardingDenied)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Boarding is denied; an authorized allow decision is required",
    });
  if (state?.state === "boarded")
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Passenger has boarded; deplane before changing departure state",
    });
  return state;
}

export async function assertDcsPassengerCanBoard(
  tx: SettlementTx,
  key: DcsPassengerKey
) {
  const state = await assertDcsPassengerMutable(tx, key);
  if (state?.state === "offloaded" || state?.state === "not_checked_in")
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Passenger must check in again before boarding",
    });
  return state;
}

/** In addition, baggage callers must validate the locked checked-in seat. */
export async function assertDcsPassengerCanAcceptBaggage(
  tx: SettlementTx,
  key: DcsPassengerKey
) {
  await assertDcsCheckInOpen(tx, key.flightId);
  return assertDcsPassengerCanBoard(tx, key);
}

/** All writers hold the same flight lock, including a first insert. */
export async function writeDcsPassengerState(
  tx: SettlementTx,
  key: DcsPassengerKey,
  state: DcsAttendanceState,
  boardingDenied?: boolean
) {
  const current = await readDcsPassengerState(tx, key);
  const values = {
    state,
    boardingDenied: boardingDenied ?? current?.boardingDenied ?? false,
    updatedAt: new Date(),
  };
  if (current)
    await tx
      .update(dcsPassengerStates)
      .set(values)
      .where(eq(dcsPassengerStates.id, current.id));
  else await tx.insert(dcsPassengerStates).values({ ...key, ...values });
  return values;
}
