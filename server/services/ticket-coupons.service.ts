import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import {
  flights,
  passengers,
  seatInventory,
  ticketCoupons,
} from "../../drizzle/schema";
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
    // Exchange history stays on the document. The remaining coupon number is
    // its immutable identity and need not equal the current itinerary position.
    const active = existing.filter(c => c.status !== "E");
    if (
      existing.some(
        c => c.bookingId !== bookingId || c.passengerId !== passengerId
      ) ||
      active.length !== legs.length ||
      new Set(legs.map(l => l.flightId)).size !== legs.length
    )
      throw new Error("Local ticket coupons require reconciliation");
    return legs.map(leg => {
      const coupon = active.find(c => c.flightId === leg.flightId);
      if (!coupon || coupon.status === "R" || coupon.status === "V")
        throw new Error("Local ticket coupons require reconciliation");
      return coupon;
    });
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

/** A voluntary cancellation releases the entire itinerary. A used coupon
 * requires review of the remaining sectors. The booking lock serializes this
 * check with operator uplift and cancellation in local write transactions. */
export async function assertNoFlownCouponForCancellation(
  tx: SettlementTx,
  bookingId: number
) {
  const [flown] = await tx
    .select({ id: ticketCoupons.id })
    .from(ticketCoupons)
    .where(
      and(eq(ticketCoupons.bookingId, bookingId), eq(ticketCoupons.status, "F"))
    )
    .limit(1)
    .for("update");
  if (flown)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "A flown coupon prevents whole-itinerary cancellation; the remaining sectors require review",
    });
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
  status: "V" | "R"
) {
  // A verified full refund can follow cancellation. Preserve exchanged and flown coupons.
  const from: CouponStatus[] = status === "R" ? ["O", "C", "V"] : ["O", "C"];
  const eligible = and(
    eq(ticketCoupons.bookingId, bookingId),
    inArray(ticketCoupons.status, from)
  );
  const rows = await tx
    .select({
      couponId: ticketCoupons.id,
      passengerId: ticketCoupons.passengerId,
      flightId: ticketCoupons.flightId,
      couponNumber: ticketCoupons.couponNumber,
      previousStatus: ticketCoupons.status,
    })
    .from(ticketCoupons)
    .where(eligible)
    .orderBy(ticketCoupons.id)
    .for("update");
  if (!rows.length) return [];
  const [updated] = await tx
    .update(ticketCoupons)
    .set({ status })
    .where(eligible);
  if (updated.affectedRows !== rows.length)
    throw new Error("Coupon closure requires reconciliation");
  return rows.map(row => ({ ...row, status }));
}

/** A partial exchange retains the local document and its unchanged coupons.
 * A full replacement retires the document; the caller clears its number. */
export async function exchangeLocalCoupons(
  tx: SettlementTx,
  bookingId: number,
  oldFlightIds: number[],
  newFlightIds: number[] = [],
  sameCabin = true
) {
  const retain =
    sameCabin && oldFlightIds.some(id => newFlightIds.includes(id));
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
  if (!ticketed.length) return retain;
  const oldFlights = await tx
    .select()
    .from(flights)
    .where(inArray(flights.id, oldFlightIds));
  const checkedSeats = await tx
    .select()
    .from(seatInventory)
    .where(
      and(
        eq(seatInventory.bookingId, bookingId),
        eq(seatInventory.status, "checked_in")
      )
    );
  for (const passenger of ticketed) {
    const ticketNumber = passenger.ticketNumber;
    if (!ticketNumber) continue;
    // Materialize a legacy document using the old itinerary before changing it.
    const coupons = await localDocumentCoupons(
      tx,
      bookingId,
      passenger.id,
      ticketNumber,
      oldFlightIds.map(flightId => {
        const old = oldFlights.find(f => f.id === flightId);
        if (!old) throw new Error("Original ticket flight missing");
        return {
          flightId,
          checkedIn: checkedSeats.some(
            s => s.flightId === flightId && s.passengerId === passenger.id
          ),
          canOpen: old.status !== "completed" && old.departureTime > new Date(),
        };
      })
    );
    for (const coupon of coupons) {
      if (retain && newFlightIds.includes(coupon.flightId)) continue;
      if (
        coupon.status !== "O" ||
        checkedSeats.some(
          s => s.flightId === coupon.flightId && s.passengerId === passenger.id
        )
      )
        throw new Error("Only open, unchecked coupons may be exchanged");
      await tx
        .update(ticketCoupons)
        .set({ status: "E" })
        .where(
          and(
            eq(ticketCoupons.ticketNumber, ticketNumber),
            eq(ticketCoupons.couponNumber, coupon.couponNumber)
          )
        );
    }
    if (retain) {
      const additions = newFlightIds.filter(id => !oldFlightIds.includes(id));
      if (!additions.length) continue;
      // Include previously exchanged numbers when allocating replacements.
      const history = await tx
        .select({ number: ticketCoupons.couponNumber })
        .from(ticketCoupons)
        .where(eq(ticketCoupons.ticketNumber, ticketNumber));
      const next =
        history.reduce((max, row) => Math.max(max, row.number), 0) + 1;
      await tx.insert(ticketCoupons).values(
        additions.map((flightId, index) => ({
          bookingId,
          passengerId: passenger.id,
          ticketNumber,
          flightId,
          couponNumber: next + index,
          status: "O" as const,
        }))
      );
    }
  }
  return retain;
}
