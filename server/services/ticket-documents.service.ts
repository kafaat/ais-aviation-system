import { localDocumentCoupons } from "./ticket-coupons.service";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db";
import {
  bookings,
  bookingSegments,
  flights,
  passengers,
  airports,
  airlines,
  seatInventory,
  ticketCoupons,
} from "../../drizzle/schema";
import { generateTicketNumber, type TicketData } from "./eticket.service";
import {
  computeBaggageEntitlement,
  type BaggageEntitlement,
} from "./baggage-entitlement.service";
import { recordEvent } from "./outbox.service";

function describeBaggageAllowance(entitlement: BaggageEntitlement) {
  const purchased = entitlement.sources.reduce(
    (grams, source) =>
      grams + (source.type === "ancillary" ? source.weightGrams : 0),
    0
  );
  const extra = purchased ? ` (includes ${purchased / 1000} kg extra)` : "";
  const review = entitlement.requiresOperationalReview
    ? ". Contact staff before bag drop."
    : "";
  return `${entitlement.totalWeightGrams / 1000} kg total${extra}, max ${entitlement.maxBagWeightGrams / 1000} kg per bag${review}`;
}

/** A document snapshot covers the actual itinerary and locks its local identity. */
export async function readTicketDocument(
  bookingId: number,
  passengerId: number,
  userId?: number
) {
  const db = getDb();
  if (!db) throw new Error("Document database unavailable");
  return await db.transaction(async tx => {
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .for("update");
    if (!booking || (userId !== undefined && booking.userId !== userId))
      throw new Error("Booking not found");
    if (
      !["confirmed", "completed"].includes(booking.status) ||
      booking.paymentStatus !== "paid"
    )
      throw new Error("Paid active itinerary required for ticket documents");
    const segments = await tx
      .select()
      .from(bookingSegments)
      .where(eq(bookingSegments.bookingId, bookingId))
      .orderBy(asc(bookingSegments.segmentOrder))
      .for("update");
    if (segments.some(s => !["confirmed", "completed"].includes(s.status)))
      throw new Error("Itinerary is not active");
    const ids = segments.length
      ? segments.map(s => s.flightId)
      : [booking.flightId];
    const locked = await tx
      .select()
      .from(flights)
      .where(inArray(flights.id, ids))
      .orderBy(asc(flights.id))
      .for("update");
    if (
      locked.length !== new Set(ids).size ||
      locked.some(
        f => f.status === "cancelled" || f.tenantId !== booking.tenantId
      )
    )
      throw new Error("Itinerary flight is unavailable");
    const [passenger] = await tx
      .select()
      .from(passengers)
      .where(
        and(eq(passengers.id, passengerId), eq(passengers.bookingId, bookingId))
      )
      .for("update");
    if (!passenger) throw new Error("Passenger not found");
    const ticketNumber = passenger.ticketNumber ?? generateTicketNumber();
    if (!passenger.ticketNumber) {
      await tx
        .update(passengers)
        .set({ ticketNumber })
        .where(eq(passengers.id, passengerId));
      await recordEvent(tx, {
        aggregateType: "booking",
        aggregateId: bookingId,
        tenantId: booking.tenantId,
        eventType: "ETicketIssued",
        payload: {
          bookingId,
          passengerId,
          ticketNumber,
          flightIds: ids,
          acceptance: "local_document_external_ticket_acceptance_required",
        },
      });
    }
    const couponLegs = [];
    const legs: Array<Omit<TicketData, "issueDate">> = [];
    for (const [index, id] of ids.entries()) {
      const segment = segments[index];
      const f = locked.find(f => f.id === id);
      if (!f) throw new Error("Itinerary flight missing");
      const [origin] = await tx
        .select()
        .from(airports)
        .where(eq(airports.id, f.originId));
      const [destination] = await tx
        .select()
        .from(airports)
        .where(eq(airports.id, f.destinationId));
      const [airline] = await tx
        .select()
        .from(airlines)
        .where(eq(airlines.id, f.airlineId));
      if (!origin || !destination || !airline)
        throw new Error("Itinerary reference data missing");
      const [seat] = await tx
        .select()
        .from(seatInventory)
        .where(
          and(
            eq(seatInventory.flightId, id),
            eq(seatInventory.bookingId, bookingId),
            eq(seatInventory.passengerId, passengerId)
          )
        );
      couponLegs.push({
        flightId: id,
        checkedIn: seat?.status === "checked_in",
        canOpen:
          booking.status === "confirmed" &&
          f.departureTime > new Date() &&
          ["scheduled", "delayed"].includes(f.status),
      });
      legs.push({
        flightId: id,
        passengerName: `${passenger.firstName} ${passenger.lastName}`,
        passengerType: passenger.type,
        ticketNumber,
        bookingReference: booking.bookingReference,
        pnr: booking.pnr,
        flightNumber: f.flightNumber,
        airline: airline.name,
        origin: origin.city,
        originCode: origin.code,
        destination: destination.city,
        destinationCode: destination.code,
        departureTime: f.departureTime,
        arrivalTime: f.arrivalTime,
        cabinClass: booking.cabinClass,
        seatNumber: seat?.seatNumber,
        baggageAllowance: segment
          ? describeBaggageAllowance(
              await computeBaggageEntitlement(tx, {
                bookingId,
                passengerId,
                segmentId: segment.id,
              })
            )
          : "Unverified. Contact airline staff.",
        totalAmount: booking.totalAmount,
        currency: "SAR",
      });
    }
    const coupons = await localDocumentCoupons(
      tx,
      bookingId,
      passengerId,
      ticketNumber,
      couponLegs
    );
    // Read after localDocumentCoupons: newly inserted coupons receive their
    // creation time from the database. Include exchanged history so retaining
    // a document across a partial exchange does not invent a new issue date.
    const [issuance] = await tx
      .select({ createdAt: ticketCoupons.createdAt })
      .from(ticketCoupons)
      .where(
        and(
          eq(ticketCoupons.bookingId, bookingId),
          eq(ticketCoupons.passengerId, passengerId),
          eq(ticketCoupons.ticketNumber, ticketNumber)
        )
      )
      .orderBy(asc(ticketCoupons.createdAt), asc(ticketCoupons.couponNumber))
      .limit(1);
    if (!issuance || !Number.isFinite(issuance.createdAt.getTime()))
      throw new Error("Local ticket issue time unavailable");
    for (const [i, coupon] of coupons.entries()) {
      legs[i].localCoupon = {
        number: coupon.couponNumber,
        status: coupon.status,
      };
    }
    const issuedLegs = legs.map(leg => ({
      ...leg,
      issueDate: issuance.createdAt,
    }));
    const first = issuedLegs[0];
    if (!first) throw new Error("Empty ticket itinerary");
    return {
      booking,
      passenger,
      legs: issuedLegs,
      data: { ...first, additionalLegs: issuedLegs.slice(1) },
    };
  });
}
