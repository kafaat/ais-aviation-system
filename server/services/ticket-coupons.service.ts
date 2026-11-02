import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { passengers, ticketCoupons } from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";

type CouponStatus = typeof ticketCoupons.$inferSelect.status;

/** The owning booking row must be locked before issuing or changing a coupon. */
export async function localDocumentCoupons(
  tx: SettlementTx,
  bookingId: number,
  passengerId: number,
  ticketNumber: string,
  legs: Array<{ flightId: number; checkedIn: boolean; canOpen: boolean }>
) {
  const existing = await tx
    .select()
    .from(ticketCoupons)
    .where(eq(ticketCoupons.ticketNumber, ticketNumber))
    .for("update");
  if (existing.length) {
    if (
      existing.length !== legs.length ||
      existing.some(
        c =>
          c.bookingId !== bookingId ||
          c.passengerId !== passengerId ||
          legs[c.couponNumber - 1]?.flightId !== c.flightId ||
          ["E", "R", "V"].includes(c.status)
      )
    )
      throw new Error("Local ticket coupons require reconciliation");
    return [...existing].sort((a, b) => a.couponNumber - b.couponNumber);
  }
  const coupons = legs.map((leg, index) => ({
    bookingId,
    passengerId,
    ticketNumber,
    flightId: leg.flightId,
    couponNumber: index + 1,
    status: (!leg.canOpen
      ? "unverified"
      : leg.checkedIn
        ? "C"
        : "O") as CouponStatus,
  }));
  await tx.insert(ticketCoupons).values(coupons);
  return coupons;
}

/** Only local issued documents move; transactions never fabricate external ticket numbers. */
export async function setCouponCheckIn(
  tx: SettlementTx,
  bookingId: number,
  passengerId: number,
  flightId: number,
  checkedIn: boolean
) {
  await tx
    .update(ticketCoupons)
    .set({ status: checkedIn ? "C" : "O" })
    .where(
      and(
        eq(ticketCoupons.bookingId, bookingId),
        eq(ticketCoupons.passengerId, passengerId),
        eq(ticketCoupons.flightId, flightId),
        eq(ticketCoupons.status, checkedIn ? "O" : "C")
      )
    );
}

export async function closeLocalCoupons(
  tx: SettlementTx,
  bookingId: number,
  status: "E" | "V" | "R"
) {
  // A verified full refund can follow cancellation. Preserve exchanged and flown coupons.
  const from: CouponStatus[] = status === "R" ? ["O", "C", "V"] : ["O", "C"];
  await tx
    .update(ticketCoupons)
    .set({ status })
    .where(
      and(
        eq(ticketCoupons.bookingId, bookingId),
        inArray(ticketCoupons.status, from)
      )
    );
}

/** Exchange clears the passenger's old document number. Capture pre-migration
 * documents against the old itinerary before that identity disappears. */
export async function exchangeLocalCoupons(
  tx: SettlementTx,
  bookingId: number,
  oldFlightIds: number[]
) {
  const ticketed = await tx
    .select({ id: passengers.id, ticketNumber: passengers.ticketNumber })
    .from(passengers)
    .where(
      and(
        eq(passengers.bookingId, bookingId),
        isNotNull(passengers.ticketNumber)
      )
    )
    .for("update");
  if (ticketed.length) {
    const existing = await tx
      .select()
      .from(ticketCoupons)
      .where(eq(ticketCoupons.bookingId, bookingId))
      .for("update");
    const known = new Set(existing.map(c => c.ticketNumber));
    const missing = ticketed.flatMap(({ id, ticketNumber }) => {
      if (!ticketNumber || known.has(ticketNumber)) return [];
      return oldFlightIds.map((flightId, i) => ({
        bookingId,
        passengerId: id,
        flightId,
        ticketNumber,
        couponNumber: i + 1,
        status: "E" as const,
      }));
    });
    if (missing.length) await tx.insert(ticketCoupons).values(missing);
  }
  await closeLocalCoupons(tx, bookingId, "E");
}
