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
} from "../../drizzle/schema";
import { generateTicketNumber, type TicketData } from "./eticket.service";
import { recordEvent } from "./outbox.service";

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
    const legs: TicketData[] = [];
    for (const id of ids) {
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
        baggageAllowance:
          booking.cabinClass === "business" ? "2 x 32kg" : "1 x 23kg",
        totalAmount: booking.totalAmount,
        currency: "SAR",
        issueDate: new Date(),
      });
    }
    const first = legs[0];
    if (!first) throw new Error("Empty ticket itinerary");
    return {
      booking,
      passenger,
      legs,
      data: { ...first, additionalLegs: legs.slice(1) },
    };
  });
}
