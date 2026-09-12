import { TRPCError } from "@trpc/server";
import { and, eq, asc } from "drizzle-orm";
import {
  bookings,
  bookingSegments,
  bookingAncillaries,
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
export type InvoiceActor = { userId: number; admin?: boolean };
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
/** Shared lock order: booking -> checkout -> NDC -> segments -> flights. */
export async function lockEditableInvoice(
  tx: SettlementTx,
  bookingId: number,
  actor: InvoiceActor
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
    (!actor.admin && booking.userId !== actor.userId)
  )
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Owned booking not found",
    });
  await assertTenantOperational(tx, booking.tenantId);
  await assertInvoiceEditable(tx, booking);
  const orders = await tx
    .select()
    .from(ndcOrders)
    .where(eq(ndcOrders.bookingId, bookingId))
    .orderBy(asc(ndcOrders.id))
    .for("update");
  for (const order of orders) {
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
  totalAmount: number
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
        l.seatsReserved ||
        l.status !== "pending" ||
        l.segmentAmount == null ||
        l.segmentAmount < 0
    ) ||
      segmentAmounts.length !== legs.length ||
      segmentAmounts.reduce((sum, a) => sum + a, 0) !== booking.totalAmount)
  )
    throw invoiceBlocked("Segment invoice allocation requires reconciliation");
  const allocation = allocateProportional(totalAmount, segmentAmounts);
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
    passengerId?: number;
    quantity?: number;
    flightId?: number;
    metadata?: unknown;
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
  if (!["baggage", "meal", "priority_boarding"].includes(service.category))
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
    .where(eq(bookingSegments.bookingId, booking.id));
  const flightIds = legs.length
    ? legs.map(l => l.flightId)
    : [booking.flightId];
  if (data.flightId != null && !flightIds.includes(data.flightId))
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Invoice segment not found",
    });
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
  return { totalPrice, service, quantity };
}

export async function insertInvoiceAncillary(
  tx: SettlementTx,
  booking: Booking,
  data: Parameters<typeof quoteInvoiceAncillary>[2]
) {
  const { totalPrice, service, quantity } = await quoteInvoiceAncillary(
    tx,
    booking,
    data
  );
  const [result] = await tx.insert(bookingAncillaries).values({
    bookingId: booking.id,
    passengerId: data.passengerId,
    ancillaryServiceId: service.id,
    quantity,
    unitPrice: service.price,
    totalPrice,
    status: "active",
    metadata: JSON.stringify({
      preferences: data.metadata ?? null,
      flightId: data.flightId ?? null,
      fulfillment:
        booking.paymentStatus === "paid"
          ? "entitlement_created"
          : "pending_payment",
    }),
  });
  await setInvoiceTotal(tx, booking, booking.totalAmount + totalPrice);
  return { id: Number(result.insertId), totalPrice, service };
}
