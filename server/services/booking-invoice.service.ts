import { canServiceOrder, type NdcAction } from "./ndc-capabilities";
import {
  holdInvoiceSeat,
  allocatedAncillaryFeesBySegment,
} from "./seat-exchange.service";
import { TRPCError } from "@trpc/server";
import { and, eq, asc } from "drizzle-orm";
import {
  bookings,
  agentBookings,
  corporateBookings,
  bookingSegments,
  bookingAncillaries,
  bookingFareComponents,
  ancillaryServices,
  passengers,
  flights,
  ndcOrders,
  type Booking,
} from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";
import { assertInvoiceEditable } from "./booking-checkout.service";
import { assertTenantOperational } from "./tenant.service";
import { allocateProportional } from "./seat-economics.service";
import { recordEvent } from "./outbox.service";
export type InvoiceActor = {
  userId: number;
  admin?: boolean;
  tenantId?: number | null;
};
export const invoiceBlocked = (message: string) =>
  new TRPCError({ code: "PRECONDITION_FAILED", message });

export function storedJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    throw invoiceBlocked("Stored invoice data requires reconciliation");
  }
}
export async function hasPartnerBooking(tx: SettlementTx, bookingId: number) {
  // Agency sales and corporate approval records exist independently of NDC orders.
  const [agency] = await tx
    .select({ id: agentBookings.id })
    .from(agentBookings)
    .where(eq(agentBookings.bookingId, bookingId))
    .limit(1)
    .for("update");
  const [corporate] = await tx
    .select({ id: corporateBookings.id })
    .from(corporateBookings)
    .where(eq(corporateBookings.bookingId, bookingId))
    .limit(1)
    .for("update");
  return Boolean(agency || corporate);
}

/** Shared lock order: booking -> checkout -> NDC -> segments -> flights. */
export async function lockEditableInvoice(
  tx: SettlementTx,
  bookingId: number,
  actor: InvoiceActor,
  action?: NdcAction
) {
  const [booking] = await tx
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .for("update");
  if (
    !Number.isSafeInteger(actor.userId) ||
    actor.userId <= 0 ||
    !booking ||
    (actor.tenantId != null && booking.tenantId !== actor.tenantId) ||
    (!actor.admin && booking.userId !== actor.userId)
  )
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Owned booking not found",
    });
  await assertTenantOperational(tx, booking.tenantId);
  await assertInvoiceEditable(tx, booking);
  if (action && (await hasPartnerBooking(tx, booking.id)))
    throw invoiceBlocked("Issuing channel must service this booking");
  const orders = await tx
    .select()
    .from(ndcOrders)
    .where(eq(ndcOrders.bookingId, bookingId))
    .orderBy(asc(ndcOrders.id))
    .for("update");
  for (const order of orders) {
    if (action && !canServiceOrder(order, action))
      throw invoiceBlocked("Issuing channel must service this order");
    if (
      order.status !== "pending" ||
      order.currency !== "SAR" ||
      order.totalAmount !== booking.totalAmount ||
      storedJson<unknown[]>(order.ticketNumbers, []).length ||
      storedJson<unknown[]>(order.emdNumbers, []).length
    )
      throw invoiceBlocked(
        "Only a consistent unpaid unticketed NDC invoice is editable"
      );
  }
  return booking;
}

/** No charge, ticket or EMD is created here. Collection consumes this exact total later. */
export async function setInvoiceTotal(
  tx: SettlementTx,
  booking: Booking,
  totalAmount: number,
  mode: "editable_invoice" | "completed_servicing" = "editable_invoice",
  allocatedSegmentId?: number
) {
  if (
    !Number.isSafeInteger(totalAmount) ||
    totalAmount <= 0 ||
    totalAmount > 2147483647
  )
    throw invoiceBlocked(
      "Invoice amount is outside supported minor-unit bounds"
    );
  const legs = await tx
    .select()
    .from(bookingSegments)
    .where(eq(bookingSegments.bookingId, booking.id))
    .orderBy(asc(bookingSegments.segmentOrder))
    .for("update");
  const segmentAmounts = legs.flatMap(l =>
    l.segmentAmount == null ? [] : [l.segmentAmount]
  );
  if (
    legs.length &&
    (legs.some(
      l =>
        (mode === "editable_invoice"
          ? l.seatsReserved || l.status !== "pending"
          : !l.seatsReserved || l.status !== "confirmed") ||
        l.segmentAmount == null ||
        l.segmentAmount < 0
    ) ||
      segmentAmounts.length !== legs.length ||
      segmentAmounts.reduce((sum, a) => sum + a, 0) !== booking.totalAmount)
  )
    throw invoiceBlocked("Segment invoice allocation requires reconciliation");
  if (
    allocatedSegmentId !== undefined &&
    !legs.some(l => l.id === allocatedSegmentId)
  )
    throw invoiceBlocked("Ancillary segment is no longer on the invoice");
  let allocation: number[];
  if (allocatedSegmentId === undefined && legs.length) {
    const fees = await allocatedAncillaryFeesBySegment(tx, booking.id);
    if ([...fees.keys()].some(id => !legs.some(leg => leg.id === id)))
      throw invoiceBlocked("Ancillary segment is no longer on the invoice");
    const fareWeights = legs.map(
      (leg, i) => segmentAmounts[i] - (fees.get(leg.id) ?? 0)
    );
    const fareTotal =
      totalAmount - [...fees.values()].reduce((sum, n) => sum + n, 0);
    if (fareTotal < 0 || fareWeights.some(n => n < 0))
      throw invoiceBlocked("Ancillary fees exceed invoice allocation");
    allocation = allocateProportional(fareTotal, fareWeights).map(
      (n, i) => n + (fees.get(legs[i].id) ?? 0)
    );
  } else {
    allocation = legs.map(
      (l, index) =>
        segmentAmounts[index] +
        (l.id === allocatedSegmentId ? totalAmount - booking.totalAmount : 0)
    );
  }
  if (allocation.some(n => n < 0))
    throw invoiceBlocked("Invalid ancillary segment allocation");
  for (const [i, leg] of legs.entries())
    await tx
      .update(bookingSegments)
      .set({ segmentAmount: allocation[i] })
      .where(eq(bookingSegments.id, leg.id));
  await tx
    .update(bookings)
    .set({ totalAmount })
    .where(eq(bookings.id, booking.id));
  const orders = await tx
    .select()
    .from(ndcOrders)
    .where(eq(ndcOrders.bookingId, booking.id))
    .for("update");
  for (const order of orders) {
    const payload = storedJson<Record<string, unknown>>(order.orderPayload, {});
    const pricing =
      typeof payload.pricing === "object" && payload.pricing !== null
        ? (payload.pricing as Record<string, unknown>)
        : {};
    payload.pricing = { ...pricing, totalAmount };
    await tx
      .update(ndcOrders)
      .set({
        totalAmount,
        orderPayload: JSON.stringify(payload),
        updatedAt: new Date(),
      })
      .where(eq(ndcOrders.id, order.id));
  }
  await recordEvent(tx, {
    aggregateType: "booking",
    aggregateId: booking.id,
    tenantId: booking.tenantId,
    eventType: "booking.invoice_changed",
    payload: {
      bookingId: booking.id,
      previousTotal: booking.totalAmount,
      totalAmount,
    },
  });
}

export async function quoteInvoiceAncillary(
  tx: SettlementTx,
  booking: Booking,
  data: {
    ancillaryServiceId: number;
    expectedUnitPrice?: number;
    passengerId?: number;
    quantity?: number;
    flightId?: number;
    metadata?: unknown;
    seatNumber?: string;
  }
) {
  const quantity = data.quantity ?? 1;
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Quantity must be 1 to 10 whole units",
    });
  const [service] = await tx
    .select()
    .from(ancillaryServices)
    .where(eq(ancillaryServices.id, data.ancillaryServiceId))
    .for("share");
  if (
    !service?.available ||
    service.currency !== "SAR" ||
    !Number.isSafeInteger(service.price) ||
    service.price < 0
  )
    throw invoiceBlocked(
      "Ancillary catalog price or availability is unsupported"
    );
  if (
    data.expectedUnitPrice !== undefined &&
    service.price !== data.expectedUnitPrice
  )
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "The extra price has changed. Review the current price before adding it.",
    });
  if (data.seatNumber !== undefined && service.category !== "seat")
    throw invoiceBlocked("Seat selection requires a seat catalog item");
  if (
    service.category === "seat" &&
    (!data.seatNumber || !data.passengerId || !data.flightId || quantity !== 1)
  )
    throw invoiceBlocked(
      "Seat selection requires one named passenger, flight and seat"
    );
  if (
    !["baggage", "meal", "priority_boarding", "seat"].includes(service.category)
  )
    throw invoiceBlocked(
      "This ancillary requires a verified seat or external fulfillment workflow"
    );
  const cabins = storedJson<unknown>(service.applicableCabinClasses, null);
  const airlines = storedJson<unknown>(service.applicableAirlines, null);
  if (
    cabins !== null &&
    (!Array.isArray(cabins) || !cabins.includes(booking.cabinClass))
  )
    throw invoiceBlocked("Ancillary is unavailable in this cabin");
  if (airlines !== null && !Array.isArray(airlines))
    throw invoiceBlocked("Invalid airline applicability");
  if (data.passengerId != null) {
    const [passenger] = await tx
      .select()
      .from(passengers)
      .where(
        and(
          eq(passengers.id, data.passengerId),
          eq(passengers.bookingId, booking.id)
        )
      )
      .for("update");
    if (!passenger || passenger.tenantId !== booking.tenantId)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Owned invoice passenger not found",
      });
  }
  const legs = await tx
    .select()
    .from(bookingSegments)
    .where(eq(bookingSegments.bookingId, booking.id))
    .for("share");
  const flightIds = legs.length
    ? legs.map(l => l.flightId)
    : [booking.flightId];
  if (data.flightId != null && !flightIds.includes(data.flightId))
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Invoice segment not found",
    });
  // A named passenger and flight are an explicit assignment. A stale or
  // ambiguous selection must never become an unresolved, chargeable service.
  let scopedSegment;
  if (data.passengerId != null && data.flightId != null) {
    const matches = legs.filter(leg => leg.flightId === data.flightId);
    if (
      matches.length !== 1 ||
      !["pending", "confirmed"].includes(matches[0].status)
    )
      throw invoiceBlocked(
        "Ancillary assignment requires a unique active booked flight segment"
      );
    scopedSegment = matches[0];
  }
  for (const flightId of [
    ...new Set(data.flightId == null ? flightIds : [data.flightId]),
  ].sort((a, b) => a - b)) {
    const [flight] = await tx
      .select()
      .from(flights)
      .where(eq(flights.id, flightId))
      .for("share");
    if (
      !flight ||
      flight.tenantId !== booking.tenantId ||
      !["scheduled", "delayed"].includes(flight.status) ||
      flight.departureTime <= new Date() ||
      (Array.isArray(airlines) && !airlines.includes(flight.airlineId))
    )
      throw invoiceBlocked("Ancillary is unavailable for this flight");
  }
  const totalPrice = service.price * quantity;
  return { totalPrice, service, quantity, scopedSegment };
}

export async function insertInvoiceAncillary(
  tx: SettlementTx,
  booking: Booking,
  data: Parameters<typeof quoteInvoiceAncillary>[2],
  mode: "editable_invoice" | "completed_servicing" = "editable_invoice"
) {
  const { totalPrice, service, quantity, scopedSegment } =
    await quoteInvoiceAncillary(tx, booking, data);
  const weightSnapshotGrams =
    service.category === "baggage" &&
    service.weightGrams != null &&
    service.weightGrams > 0
      ? service.weightGrams * quantity
      : null;
  let paidSeat;
  if (service.category === "seat") {
    if (
      mode !== "editable_invoice" ||
      !scopedSegment ||
      !data.passengerId ||
      !data.flightId ||
      !data.seatNumber
    )
      throw invoiceBlocked(
        "Paid seats require an editable, sector-scoped invoice"
      );
    paidSeat = await holdInvoiceSeat(
      tx,
      booking,
      data.passengerId,
      data.flightId,
      data.seatNumber,
      service.code,
      service.price
    );
  }
  const [result] = await tx.insert(bookingAncillaries).values({
    bookingId: booking.id,
    passengerId: data.passengerId,
    ancillaryServiceId: service.id,
    quantity,
    unitPrice: service.price,
    totalPrice,
    weightSnapshotGrams,
    segmentId: scopedSegment?.id ?? null,
    scopeState: scopedSegment ? "specific_segment" : "unresolved",
    status: "active",
    metadata: JSON.stringify({
      ...(mode === "editable_invoice" && { source: "editable_invoice" }),
      ...(scopedSegment && { segmentAllocated: true }),
      ...(paidSeat && { paidSeat }),
      preferences: data.metadata ?? null,
      flightId: data.flightId ?? null,
      fulfillment:
        booking.paymentStatus === "paid"
          ? "entitlement_created"
          : "pending_payment",
    }),
  });
  await tx.insert(bookingFareComponents).values({
    bookingId: booking.id,
    tenantId: booking.tenantId,
    passengerId: data.passengerId,
    bookingSegmentId: scopedSegment?.id,
    flightId: data.flightId ?? booking.flightId,
    componentType: "ancillary",
    code: "ANCILLARY",
    amount: totalPrice,
    source: "ancillary_catalog",
    sourceReference: String(result.insertId),
  });
  await setInvoiceTotal(
    tx,
    booking,
    booking.totalAmount + totalPrice,
    mode,
    scopedSegment?.id
  );
  return { id: Number(result.insertId), totalPrice, service };
}
