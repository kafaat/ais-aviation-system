import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  bookings,
  bookingSegments,
  bookingAncillaries,
  ancillaryServices,
  ndcOrders,
  ndcOffers,
  passengers,
  flights,
  inventoryLocks,
  seatInventory,
} from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";
import {
  getOrder,
  type ChangeOrderInput,
  type ServiceOrderInput,
  type NdcPassengerInfo,
  type NdcSegment,
  type NdcServicingAction,
} from "./ndc.service";
import {
  lockEditableInvoice,
  insertInvoiceAncillary,
  setInvoiceTotal,
  storedJson,
  invoiceBlocked,
} from "./booking-invoice.service";
import {
  withTransactionalIdempotency,
  calculateRequestHash,
} from "./idempotency-v2.service";
import {
  createInventoryLock,
  releaseInventoryLock,
} from "./inventory-lock.service";
import { allocateProportional } from "./seat-economics.service";
import { recordEvent } from "./outbox.service";

type Command = { orderId: string; userId: number; idempotencyKey: string };
async function lockOrder(tx: SettlementTx, input: Command) {
  const [identity] = await tx
    .select()
    .from(ndcOrders)
    .where(eq(ndcOrders.orderId, input.orderId));
  if (!identity?.bookingId)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Owned NDC booking not found",
    });
  const booking = await lockEditableInvoice(tx, identity.bookingId, {
    userId: input.userId,
  });
  const [order] = await tx
    .select()
    .from(ndcOrders)
    .where(eq(ndcOrders.id, identity.id))
    .for("update");
  if (!order || order.bookingId !== booking.id)
    throw invoiceBlocked("NDC booking association changed");
  const canonical = await tx
    .select()
    .from(passengers)
    .where(eq(passengers.bookingId, booking.id))
    .orderBy(asc(passengers.id))
    .for("update");
  const ndcPassengers = storedJson<NdcPassengerInfo[]>(order.passengers, []);
  if (
    canonical.length !== booking.numberOfPassengers ||
    canonical.length !== ndcPassengers.length ||
    canonical.some(
      (p, i) =>
        p.tenantId !== booking.tenantId ||
        p.type !== ndcPassengers[i].type ||
        p.firstName !== ndcPassengers[i].firstName ||
        p.lastName !== ndcPassengers[i].lastName ||
        (p.passportNumber ?? "") !== (ndcPassengers[i].passportNumber ?? "")
    )
  )
    throw invoiceBlocked("NDC passenger mapping requires reconciliation");
  return { booking, order, canonical, ndcPassengers };
}
function passengerIndex(
  input: { index?: number; passengerIndex?: number; passengerId?: string },
  canonical: (typeof passengers.$inferSelect)[]
) {
  const index = input.index ?? input.passengerIndex;
  const found =
    input.passengerId == null
      ? index
      : canonical.findIndex(p => String(p.id) === input.passengerId);
  if (
    found == null ||
    !Number.isSafeInteger(found) ||
    found < 0 ||
    found >= canonical.length ||
    (index != null && index !== found)
  )
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Owned passenger mapping not found",
    });
  return found;
}
async function history(
  tx: SettlementTx,
  orderId: string,
  booking: typeof bookings.$inferSelect,
  action: string,
  details: string,
  actor: number
) {
  const [order] = await tx
    .select()
    .from(ndcOrders)
    .where(eq(ndcOrders.orderId, orderId))
    .for("update");
  const entries = storedJson<NdcServicingAction[]>(order.servicingHistory, []);
  entries.push({
    action,
    timestamp: new Date().toISOString(),
    details,
    performedBy: String(actor),
  });
  await tx
    .update(ndcOrders)
    .set({
      lastServicingAction: action,
      servicingHistory: JSON.stringify(entries),
      updatedAt: new Date(),
    })
    .where(eq(ndcOrders.id, order.id));
  await recordEvent(tx, {
    aggregateType: "ndcOrder",
    aggregateId: orderId,
    tenantId: booking.tenantId,
    eventType: action,
    payload: { orderId, bookingId: booking.id, actorId: actor },
  });
}

async function replaceItinerary(
  tx: SettlementTx,
  context: Awaited<ReturnType<typeof lockOrder>>,
  changes: ChangeOrderInput,
  input: Command
) {
  const { booking, order } = context;
  const [offer] = await tx
    .select()
    .from(ndcOffers)
    .where(eq(ndcOffers.offerId, changes.replacementOfferId!))
    .for("update");
  const segments = storedJson<NdcSegment[]>(offer?.segments ?? null, []);
  if (
    !offer ||
    !["active", "selected"].includes(offer.status) ||
    offer.expiresAt <= new Date() ||
    offer.airlineId !== order.airlineId ||
    offer.currency !== "SAR" ||
    !["economy", "business"].includes(offer.cabinClass) ||
    !segments.length ||
    segments.length > 6 ||
    segments.some(s => !Number.isSafeInteger(s.flightId) || s.flightId <= 0) ||
    new Set(segments.map(s => s.flightId)).size !== segments.length ||
    storedJson<{ pricing?: { passengerCount?: number } }>(
      offer.offerPayload,
      {}
    ).pricing?.passengerCount !== booking.numberOfPassengers
  )
    throw invoiceBlocked(
      "Replacement offer is unavailable or outside local inventory scope"
    );
  if (
    (changes.newCabinClass && changes.newCabinClass !== offer.cabinClass) ||
    (changes.cabinClassUpgrade &&
      changes.cabinClassUpgrade !== offer.cabinClass) ||
    (changes.newDepartureDate &&
      new Date(changes.newDepartureDate).toISOString().slice(0, 10) !==
        offer.departureDate.toISOString().slice(0, 10))
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Requested itinerary differs from the replacement offer",
    });
  const activeAncillaries = await tx
    .select()
    .from(bookingAncillaries)
    .where(
      and(
        eq(bookingAncillaries.bookingId, booking.id),
        eq(bookingAncillaries.status, "active")
      )
    )
    .limit(1);
  const physicalSeats = await tx
    .select()
    .from(seatInventory)
    .where(eq(seatInventory.bookingId, booking.id))
    .limit(1);
  if (
    activeAncillaries.length ||
    physicalSeats.length ||
    context.canonical.some(p => p.seatNumber || p.ticketNumber)
  )
    throw invoiceBlocked(
      "Remove unpaid ancillary or seat assignments before replacing the itinerary"
    );
  const oldLegs = await tx
    .select()
    .from(bookingSegments)
    .where(eq(bookingSegments.bookingId, booking.id))
    .orderBy(asc(bookingSegments.flightId))
    .for("update");
  const old = oldLegs.length
    ? oldLegs
    : [
        {
          flightId: booking.flightId,
          inventoryLockId: booking.inventoryLockId,
          seatsReserved: false,
          status: "pending",
        },
      ];
  if (old.some(l => l.seatsReserved || l.status !== "pending"))
    throw invoiceBlocked("Existing inventory requires reconciliation");
  const allFlights = new Map<number, typeof flights.$inferSelect>();
  for (const id of [
    ...new Set([...old.map(l => l.flightId), ...segments.map(s => s.flightId)]),
  ].sort((a, b) => a - b)) {
    const [flight] = await tx
      .select()
      .from(flights)
      .where(eq(flights.id, id))
      .for("update");
    if (!flight || flight.tenantId !== booking.tenantId)
      throw invoiceBlocked(
        "Replacement itinerary crosses an unsupported tenant boundary"
      );
    allFlights.set(id, flight);
  }
  for (const segment of segments) {
    const flight = allFlights.get(segment.flightId)!;
    if (
      !["scheduled", "delayed"].includes(flight.status) ||
      flight.departureTime <= new Date() ||
      flight.airlineId !== order.airlineId
    )
      throw invoiceBlocked("Replacement flight is unavailable");
    if (
      (segment.departureTime &&
        new Date(segment.departureTime).getTime() !==
          flight.departureTime.getTime()) ||
      (segment.arrivalTime &&
        new Date(segment.arrivalTime).getTime() !==
          flight.arrivalTime.getTime())
    )
      throw invoiceBlocked(
        "Replacement flight schedule changed; request a new offer"
      );
  }
  for (const leg of old) {
    if (allFlights.get(leg.flightId)!.departureTime <= new Date())
      throw invoiceBlocked(
        "A historical departed itinerary requires reconciliation"
      );
    if (!leg.inventoryLockId)
      throw invoiceBlocked("Unlinked historical hold requires reconciliation");
    const [hold] = await tx
      .select()
      .from(inventoryLocks)
      .where(eq(inventoryLocks.id, leg.inventoryLockId))
      .for("update");
    if (
      !hold ||
      hold.flightId !== leg.flightId ||
      hold.userId !== booking.userId ||
      hold.cabinClass !== booking.cabinClass ||
      hold.numberOfSeats !== booking.numberOfPassengers ||
      hold.status === "converted"
    )
      throw invoiceBlocked("Hold identity requires reconciliation");
    await releaseInventoryLock(hold.id, tx);
  }
  const held = new Map<number, number>();
  for (const s of [...segments].sort((a, b) => a.flightId - b.flightId)) {
    const result = await createInventoryLock(
      s.flightId,
      booking.numberOfPassengers,
      offer.cabinClass as "economy" | "business",
      calculateRequestHash({ scope: "ndc.order.change", request: input }),
      input.userId,
      tx
    );
    held.set(s.flightId, result.lockId);
  }
  await setInvoiceTotal(tx, booking, offer.totalPrice);
  await tx
    .delete(bookingSegments)
    .where(eq(bookingSegments.bookingId, booking.id));
  const allocations = allocateProportional(
    offer.totalPrice,
    segments.map(() => 1)
  );
  await tx.insert(bookingSegments).values(
    segments.map((s, i) => ({
      bookingId: booking.id,
      segmentOrder: i + 1,
      flightId: s.flightId,
      inventoryLockId: held.get(s.flightId)!,
      segmentAmount: allocations[i],
      departureDate: allFlights.get(s.flightId)!.departureTime,
      status: "pending" as const,
    }))
  );
  await tx
    .update(bookings)
    .set({
      flightId: segments[0].flightId,
      inventoryLockId: held.get(segments[0].flightId)!,
      cabinClass: offer.cabinClass as "economy" | "business",
    })
    .where(eq(bookings.id, booking.id));
  const payload = storedJson<Record<string, any>>(order.orderPayload, {});
  payload.offerId = offer.offerId;
  payload.segments = segments;
  payload.pricing = {
    totalAmount: offer.totalPrice,
    basePrice: offer.basePrice,
    taxesAndFees: offer.taxesAndFees,
    currency: "SAR",
  };
  await tx
    .update(ndcOrders)
    .set({ offerId: offer.offerId, orderPayload: JSON.stringify(payload) })
    .where(eq(ndcOrders.id, order.id));
  await tx
    .update(ndcOffers)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(eq(ndcOffers.offerId, order.offerId), eq(ndcOffers.status, "ordered"))
    );
  await tx
    .update(ndcOffers)
    .set({ status: "ordered", updatedAt: new Date() })
    .where(eq(ndcOffers.id, offer.id));
}

const passengerPatch = z
  .object({
    firstName: z.string().trim().min(1).max(100).optional(),
    lastName: z.string().trim().min(1).max(100).optional(),
    passportNumber: z.string().trim().min(1).max(20).optional(),
  })
  .strict();
export async function changeUnpaidOrder(
  input: Command & { changes: ChangeOrderInput }
) {
  const { changes } = input;
  if (
    (changes.newDepartureDate ||
      changes.newCabinClass ||
      changes.cabinClassUpgrade) &&
    !changes.replacementOfferId
  )
    throw invoiceBlocked(
      "Date and cabin changes require a fresh replacement offer"
    );
  if (
    !changes.replacementOfferId &&
    !changes.passengerUpdates?.length &&
    !changes.contactInfoUpdate
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "No changes requested",
    });
  return await withTransactionalIdempotency({
    scope: "ndc.order.change",
    key: input.idempotencyKey,
    userId: input.userId,
    request: input,
    run: async tx => {
      const context = await lockOrder(tx, input);
      if (changes.replacementOfferId)
        await replaceItinerary(tx, context, changes, input);
      const updatedIndices = new Set<number>();
      for (const patch of changes.passengerUpdates ?? []) {
        const index = passengerIndex(patch, context.canonical);
        if (updatedIndices.has(index))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Duplicate passenger update",
          });
        updatedIndices.add(index);
        if (patch.passportExpiry != null)
          throw invoiceBlocked(
            "Passport expiry changes require the canonical travel-document workflow"
          );
        const fields = passengerPatch.parse(
          patch.updates ??
            Object.fromEntries(
              Object.entries(patch).filter(
                ([k]) => !["index", "passengerId"].includes(k)
              )
            )
        );
        if (!Object.keys(fields).length)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Empty passenger update",
          });
        context.ndcPassengers[index] = {
          ...context.ndcPassengers[index],
          ...fields,
        };
        await tx
          .update(passengers)
          .set(fields)
          .where(eq(passengers.id, context.canonical[index].id));
      }
      const [current] = await tx
        .select()
        .from(ndcOrders)
        .where(eq(ndcOrders.id, context.order.id));
      const contact = storedJson<Record<string, unknown>>(
        current.contactInfo,
        {}
      );
      if (changes.contactInfoUpdate)
        Object.assign(
          contact,
          z
            .object({
              emailAddress: z.string().email().max(254).optional(),
              phoneNumber: z.string().min(1).max(32).optional(),
              address: z.string().max(500).optional(),
            })
            .strict()
            .parse(changes.contactInfoUpdate)
        );
      const payload = storedJson<Record<string, any>>(current.orderPayload, {});
      payload.passengers = context.ndcPassengers;
      payload.contactInfo = contact;
      await tx
        .update(ndcOrders)
        .set({
          passengers: JSON.stringify(context.ndcPassengers),
          contactInfo: JSON.stringify(contact),
          orderPayload: JSON.stringify(payload),
        })
        .where(eq(ndcOrders.id, current.id));
      await history(
        tx,
        input.orderId,
        context.booking,
        "NdcUnpaidOrderChanged",
        `Unpaid invoice amended; ${updatedIndices.size} passenger updates`,
        input.userId
      );
      return getOrder(input.orderId, tx);
    },
  });
}

export async function serviceUnpaidOrder(
  input: Command & { services: ServiceOrderInput[] }
) {
  if (!input.services.length || input.services.length > 20)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Request 1 to 20 ancillary items",
    });
  return await withTransactionalIdempotency({
    scope: "ndc.order.services",
    key: input.idempotencyKey,
    userId: input.userId,
    request: input,
    run: async tx => {
      const context = await lockOrder(tx, input);
      const segments =
        storedJson<{ segments?: NdcSegment[] }>(context.order.orderPayload, {})
          .segments ?? [];
      let booking = context.booking;
      for (const item of [...input.services].sort((a, b) =>
        a.serviceCode.localeCompare(b.serviceCode)
      )) {
        const [service] = await tx
          .select()
          .from(ancillaryServices)
          .where(eq(ancillaryServices.code, item.serviceCode))
          .for("share");
        if (!service)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Ancillary service not found",
          });
        const index =
          item.passengerId != null || item.passengerIndex != null
            ? passengerIndex(item, context.canonical)
            : undefined;
        const segment =
          item.segmentId == null
            ? undefined
            : segments.find(s => s.segmentKey === item.segmentId);
        if (item.segmentId != null && !segment)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Order segment not found",
          });
        await insertInvoiceAncillary(tx, booking, {
          ancillaryServiceId: service.id,
          passengerId: index == null ? undefined : context.canonical[index].id,
          flightId: segment?.flightId,
          quantity: item.quantity,
        });
        [booking] = await tx
          .select()
          .from(bookings)
          .where(eq(bookings.id, booking.id));
      }
      await history(
        tx,
        input.orderId,
        booking,
        "NdcUnpaidServicesAdded",
        "Local ancillary invoice updated; awaiting payment",
        input.userId
      );
      return getOrder(input.orderId, tx);
    },
  });
}
