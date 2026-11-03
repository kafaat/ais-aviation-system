import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { dcsFlightOperations, dcsPassengerStates } from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";

export type DcsPassengerKey = {
  bookingId: number;
  passengerId: number;
  flightId: number;
};
export type DcsAttendanceState = typeof dcsPassengerStates.$inferSelect.state;
export type DcsDepartureState = DcsAttendanceState | "boarding_denied";
export type DcsPassengerState = typeof dcsPassengerStates.$inferSelect;

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
