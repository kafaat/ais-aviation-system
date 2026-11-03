import { and, eq, isNull, ne, or, sql } from "drizzle-orm";
import { baggageItems, bookingSegments, bookings } from "../../drizzle/schema";

type SectorBag = { flightId?: number | null; segmentId?: number | null };
type SectorLeg = { id: number; flightId: number; status: string };

/** A new counter receipt grants one sector, never an implicit through itinerary. */
export function baggageCustodyFlightIds(
  bag: SectorBag,
  legs: SectorLeg[],
  legacyFlightId: number
): number[] {
  if (bag.flightId == null && bag.segmentId == null) {
    return legs.length
      ? legs.filter(leg => leg.status !== "cancelled").map(leg => leg.flightId)
      : [legacyFlightId];
  }
  const leg = legs.find(value => value.id === bag.segmentId);
  if (
    bag.flightId == null ||
    bag.segmentId == null ||
    !leg ||
    leg.flightId !== bag.flightId
  )
    throw new Error("Baggage sector scope requires operator review");
  return ["confirmed", "completed"].includes(leg.status) ? [bag.flightId] : [];
}

/** Both nullable fields must be absent before any legacy attribution is allowed. */
function legacyBag() {
  return and(
    isNull(baggageItems.returnEvidenceId),
    isNull(baggageItems.returnEventId),
    isNull(baggageItems.flightId),
    isNull(baggageItems.segmentId)
  );
}

function exactSector(flightId: number) {
  return and(
    isNull(baggageItems.returnEvidenceId),
    eq(baggageItems.flightId, flightId),
    isNull(baggageItems.returnEventId),
    sql`EXISTS (SELECT 1 FROM booking_segments scoped_bag_leg
      WHERE scoped_bag_leg.id = ${baggageItems.segmentId}
        AND scoped_bag_leg.bookingId = ${baggageItems.bookingId}
        AND scoped_bag_leg.flightId = ${flightId}
        AND scoped_bag_leg.status IN ('confirmed', 'completed'))`
  );
}

/** Preserve the manifest's conservative legacy-sector attribution rules. */
export function manifestBaggageFlightCondition(flightId: number) {
  return or(
    exactSector(flightId),
    and(
      legacyBag(),
      sql`(EXISTS (SELECT 1 FROM baggage_custody_events bc
          WHERE bc.baggageId = ${baggageItems.id} AND bc.flightId = ${flightId})
        OR (${bookings.flightId} = ${flightId}
          AND NOT EXISTS (SELECT 1 FROM booking_segments bs
            WHERE bs.bookingId = ${bookings.id} AND bs.flightId <> ${flightId})
          AND NOT EXISTS (SELECT 1 FROM baggage_custody_events bc
            WHERE bc.baggageId = ${baggageItems.id})))`
    )
  );
}

/** Caller joins booking_segments on the booking and the requested flight. */
export function closeoutBaggageFlightCondition(flightId: number) {
  return or(
    exactSector(flightId),
    and(
      legacyBag(),
      or(
        and(
          eq(bookingSegments.flightId, flightId),
          ne(bookingSegments.status, "cancelled")
        ),
        and(
          eq(bookings.flightId, flightId),
          isNull(bookingSegments.id),
          sql`NOT EXISTS (SELECT 1 FROM booking_segments leg WHERE leg.bookingId = ${bookings.id})`
        )
      )
    )
  );
}

/**
 * A scoped counter receipt remains physical evidence after a refund or a scope
 * change. Never hide it by joining only currently eligible bookings. Unscoped
 * legacy bags retain their existing attribution policy; other flights are not
 * pulled into this flight's reconciliation.
 */
export function unresolvedCounterBaggageFlightCondition(flightId: number) {
  return and(
    isNull(baggageItems.returnEvidenceId),
    eq(baggageItems.flightId, flightId),
    isNull(baggageItems.returnEventId),
    sql`NOT EXISTS (
      SELECT 1 FROM bookings receipt_booking
      INNER JOIN passengers receipt_passenger
        ON receipt_passenger.id = ${baggageItems.passengerId}
        AND receipt_passenger.bookingId = receipt_booking.id
        AND receipt_passenger.tenantId = receipt_booking.tenantId
      INNER JOIN booking_segments receipt_segment
        ON receipt_segment.id = ${baggageItems.segmentId}
        AND receipt_segment.bookingId = receipt_booking.id
        AND receipt_segment.flightId = ${baggageItems.flightId}
      INNER JOIN flights receipt_flight
        ON receipt_flight.id = ${baggageItems.flightId}
        AND receipt_flight.tenantId = receipt_booking.tenantId
      WHERE receipt_booking.id = ${baggageItems.bookingId}
        AND receipt_booking.deletedAt IS NULL
        AND receipt_booking.status IN ('confirmed', 'completed')
        AND receipt_booking.paymentStatus = 'paid'
        AND receipt_segment.status IN ('confirmed', 'completed')
        AND (receipt_segment.status = 'completed' OR receipt_segment.seatsReserved = 1)
    )`
  );
}
