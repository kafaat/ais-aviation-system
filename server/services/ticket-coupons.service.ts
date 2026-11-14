import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
import {
  flights,
  passengers,
  seatInventory,
  ticketCoupons,
} from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";
import {
  bookingDisputeHold,
  type BookingDisputeHold,
} from "./payment-dispute.service";

type CouponStatus = typeof ticketCoupons.$inferSelect.status;
export type CouponTransition = {
  couponId: number;
  passengerId: number;
  flightId: number;
  couponNumber: number;
  previousStatus: CouponStatus;
  status: CouponStatus;
};

/** A coupon held by a payment dispute is not valid for travel or servicing.
 * S returns to its prior status if the merchant keeps the funds; V is final. */
export function couponHoldError(
  hold: Pick<BookingDisputeHold, "outcome"> & { disputeIds: string[] },
  action: string
) {
  const disputes = hold.disputeIds.length
    ? `payment dispute ${hold.disputeIds.join(", ")}`
    : "a payment dispute";
  return new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      hold.outcome === "void"
        ? `Ticket coupons were voided after ${disputes} was lost; ${action} requires servicing review`
        : `Ticket coupons are suspended while ${disputes} has withdrawn this booking's funds; ${action} is unavailable until the dispute is resolved`,
  });
}

/** Caller holds the booking lock. The dispute evidence is the authority; a
 * suspended coupon row alone also blocks, so a booking whose documents have not
 * been materialized yet cannot be serviced around its dispute either. */
export async function bookingCouponHold(
  tx: SettlementTx,
  bookingId: number
): Promise<BookingDisputeHold | null> {
  const hold = await bookingDisputeHold(tx, bookingId);
  if (hold) return hold;
  const [suspended] = await tx
    .select({ id: ticketCoupons.id })
    .from(ticketCoupons)
    .where(
      and(eq(ticketCoupons.bookingId, bookingId), eq(ticketCoupons.status, "S"))
    )
    .limit(1)
    .for("share");
  return suspended ? { outcome: "suspended", disputeIds: [] } : null;
}

export async function assertNoCouponHold(
  tx: SettlementTx,
  bookingId: number,
  action: string
) {
  const hold = await bookingCouponHold(tx, bookingId);
  if (hold) throw couponHoldError(hold, action);
}

/** Check-in and every boarding admission refuse a passenger whose coupon on
 * this flight is suspended or void. A passenger without a materialized coupon
 * is refused while the booking's dispute would issue it suspended or void.
 * Caller holds the booking and seat locks. */
export async function assertCouponTravelable(
  tx: SettlementTx,
  key: { bookingId: number; passengerId: number; flightId: number },
  action: string
) {
  const coupons = await tx
    .select({ status: ticketCoupons.status })
    .from(ticketCoupons)
    .where(
      and(
        eq(ticketCoupons.bookingId, key.bookingId),
        eq(ticketCoupons.passengerId, key.passengerId),
        eq(ticketCoupons.flightId, key.flightId),
        ne(ticketCoupons.status, "E")
      )
    )
    .for("share");
  const blocked = coupons.find(c => c.status === "S" || c.status === "V");
  if (coupons.length && !blocked) return;
  const hold = await bookingDisputeHold(tx, key.bookingId);
  if (blocked?.status === "S")
    throw couponHoldError(
      {
        outcome: "suspended",
        disputeIds: hold?.outcome === "suspended" ? hold.disputeIds : [],
      },
      action
    );
  // A coupon is also void after a cancellation or another servicing change;
  // only a lost dispute's void names the dispute.
  if (blocked && hold?.outcome !== "void")
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Ticket coupon is void; ${action} requires servicing review`,
    });
  if (hold) throw couponHoldError(hold, action);
}

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
  const opened = legs.map(leg =>
    !leg.canOpen ? null : leg.checkedIn ? ("C" as const) : ("O" as const)
  );
  // A document first issued while a dispute holds the booking's funds starts
  // suspended, or void after a lost dispute, like the booking's other coupons.
  const hold = opened.some(Boolean)
    ? await bookingDisputeHold(tx, bookingId)
    : null;
  const coupons = legs.map((leg, index) => {
    const open = opened[index];
    const status: CouponStatus = !open
      ? "unverified"
      : hold?.outcome === "void"
        ? "V"
        : hold
          ? "S"
          : open;
    return {
      bookingId,
      passengerId,
      ticketNumber,
      flightId: leg.flightId,
      couponNumber: index + 1,
      status,
      suspendedFromStatus: status === "S" ? open : null,
    };
  });
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
  const coupon = and(
    eq(ticketCoupons.bookingId, bookingId),
    eq(ticketCoupons.passengerId, passengerId),
    eq(ticketCoupons.flightId, flightId)
  );
  await tx
    .update(ticketCoupons)
    .set({ status: checkedIn ? "C" : "O" })
    .where(and(coupon, eq(ticketCoupons.status, checkedIn ? "O" : "C")));
  // Check-in is refused while suspended, but offload and undo stay available.
  // The coupon then returns to O, not C, when the dispute is resolved.
  if (!checkedIn)
    await tx
      .update(ticketCoupons)
      .set({ suspendedFromStatus: "O" })
      .where(
        and(
          coupon,
          eq(ticketCoupons.status, "S"),
          eq(ticketCoupons.suspendedFromStatus, "C")
        )
      );
}

export async function closeLocalCoupons(
  tx: SettlementTx,
  bookingId: number,
  status: "V" | "R"
) {
  // A verified full refund can follow cancellation. Preserve exchanged and flown
  // coupons. A suspended coupon never outlives the itinerary it belonged to.
  const from: CouponStatus[] =
    status === "R" ? ["O", "C", "V", "S"] : ["O", "C", "S"];
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
    .set({ status, suspendedFromStatus: null })
    .where(eligible);
  if (updated.affectedRows !== rows.length)
    throw new Error("Coupon closure requires reconciliation");
  return rows.map(row => ({ ...row, status }));
}

function lockBookingCoupons(
  tx: SettlementTx,
  bookingId: number,
  from: CouponStatus[]
) {
  return tx
    .select({
      couponId: ticketCoupons.id,
      passengerId: ticketCoupons.passengerId,
      flightId: ticketCoupons.flightId,
      couponNumber: ticketCoupons.couponNumber,
      previousStatus: ticketCoupons.status,
      suspendedFromStatus: ticketCoupons.suspendedFromStatus,
    })
    .from(ticketCoupons)
    .where(
      and(
        eq(ticketCoupons.bookingId, bookingId),
        inArray(ticketCoupons.status, from)
      )
    )
    .orderBy(ticketCoupons.id)
    .for("update");
}

const transition = (
  row: Awaited<ReturnType<typeof lockBookingCoupons>>[number],
  status: CouponStatus
): CouponTransition => ({
  couponId: row.couponId,
  passengerId: row.passengerId,
  flightId: row.flightId,
  couponNumber: row.couponNumber,
  previousStatus: row.previousStatus,
  status,
});

/** Dispute funds withdrawn. Only open and checked-in coupons are suspended;
 * the prior status is kept for restoration. Caller holds the booking lock. */
export async function suspendBookingCoupons(
  tx: SettlementTx,
  bookingId: number
): Promise<CouponTransition[]> {
  const rows = await lockBookingCoupons(tx, bookingId, ["O", "C"]);
  let affected = 0;
  for (const from of ["O", "C"] as const) {
    if (!rows.some(row => row.previousStatus === from)) continue;
    const [updated] = await tx
      .update(ticketCoupons)
      .set({ status: "S", suspendedFromStatus: from })
      .where(
        and(
          eq(ticketCoupons.bookingId, bookingId),
          eq(ticketCoupons.status, from)
        )
      );
    affected += updated.affectedRows;
  }
  if (affected !== rows.length)
    throw new Error("Coupon suspension requires reconciliation");
  return rows.map(row => transition(row, "S"));
}

/** Dispute lost. Suspended coupons, and open ones a late or reordered delivery
 * never suspended, become void. Caller holds the booking lock. */
export async function voidDisputedCoupons(
  tx: SettlementTx,
  bookingId: number
): Promise<CouponTransition[]> {
  const from: CouponStatus[] = ["O", "C", "S"];
  const rows = await lockBookingCoupons(tx, bookingId, from);
  if (!rows.length) return [];
  const [updated] = await tx
    .update(ticketCoupons)
    .set({ status: "V", suspendedFromStatus: null })
    .where(
      and(
        eq(ticketCoupons.bookingId, bookingId),
        inArray(ticketCoupons.status, from)
      )
    );
  if (updated.affectedRows !== rows.length)
    throw new Error("Coupon void requires reconciliation");
  return rows.map(row => transition(row, "V"));
}

/** Dispute won or funds reinstated, with no other dispute still holding the
 * booking's funds. Caller holds the booking lock. */
export async function restoreSuspendedCoupons(
  tx: SettlementTx,
  bookingId: number
): Promise<CouponTransition[]> {
  const rows = await lockBookingCoupons(tx, bookingId, ["S"]);
  let affected = 0;
  for (const to of ["O", "C"] as const) {
    if (!rows.some(row => row.suspendedFromStatus === to)) continue;
    const [updated] = await tx
      .update(ticketCoupons)
      .set({ status: to, suspendedFromStatus: null })
      .where(
        and(
          eq(ticketCoupons.bookingId, bookingId),
          eq(ticketCoupons.status, "S"),
          eq(ticketCoupons.suspendedFromStatus, to)
        )
      );
    affected += updated.affectedRows;
  }
  if (affected !== rows.length)
    throw new Error("Coupon restoration requires reconciliation");
  return rows.map(row =>
    transition(row, row.suspendedFromStatus as CouponStatus)
  );
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
    if (coupons.some(coupon => coupon.status === "S"))
      throw couponHoldError(
        (await bookingDisputeHold(tx, bookingId)) ?? {
          outcome: "suspended",
          disputeIds: [],
        },
        "exchange"
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
