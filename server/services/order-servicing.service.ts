import { persistInitialFareComponents } from "./fare-components.service";
import { canServiceOrder, type NdcAction } from "./ndc-capabilities";
import { withInventoryTransaction } from "./inventory-capacity.service";
import {
  quoteSeatExchange,
  transferExchangeSeats,
  seatExchangeSchema,
} from "./seat-exchange.service";
import {
  checkTicketRevalidation,
  revalidationEvidence,
} from "./ticket-revalidation.service";
import { exchangeLocalCoupons } from "./ticket-coupons.service";
import { assertBaggageNotInCustody } from "./baggage-custody.service";
import { calculateModificationFee } from "./modification-fee";
import { allocateProportional } from "./seat-economics.service";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { getDb, getFlightById } from "../db";
import {
  bookings,
  bookingSegments,
  bookingModifications,
  bookingFareComponents,
  bookingAncillaries,
  flights,
  inventoryLocks,
  ndcOrders,
  passengers,
  seatInventory,
  retailOffers,
  ticketCoupons,
  type Booking,
} from "../../drizzle/schema";
import {
  offerFareLineSchema,
  retailOfferPayloadSchema,
  lockRetailOffer,
  consumeRetailOffer,
} from "./retail-offer.service";
import { createInventoryLock } from "./inventory-lock.service";
import {
  reserveSeats,
  restoreSeats,
  assertNoCollectionReview,
  type SettlementTx,
} from "./booking-settlement.service";
import {
  calculateRequestHash,
  withTransactionalIdempotency,
} from "./idempotency-v2.service";
import {
  issuerMustService,
  quoteInvoiceAncillary,
  insertInvoiceAncillary,
  storedJson,
} from "./booking-invoice.service";
import { assertTenantOperational } from "./tenant.service";
import { recordEvent } from "./outbox.service";
import { planOrderRefund } from "./order-refunds.service";

const ancillaryInput = z.object({
  ancillaryServiceId: z.number().int().positive(),
  passengerId: z.number().int().positive().optional(),
  flightId: z.number().int().positive().optional(),
  quantity: z.number().int().min(1).max(10),
});
export const paidServiceInput = z
  .object({
    bookingId: z.number().int().positive(),
    idempotencyKey: z.string().min(8).max(128),
    intent: z.literal("revalidate").optional(),
    replaceFlightId: z.number().int().positive().optional(),
    offerIds: z.array(z.string().uuid()).min(1).max(6).optional(),
    ancillaries: z.array(ancillaryInput).min(1).max(20).optional(),
  })
  .refine(
    i => Boolean(i.offerIds) !== Boolean(i.ancillaries),
    "Choose an itinerary exchange or additional services"
  )
  .refine(
    i =>
      (i.replaceFlightId === undefined || i.offerIds?.length === 1) &&
      (!i.intent || i.replaceFlightId !== undefined),
    "A sector exchange requires exactly one replacement offer"
  );
const segment = z.object({
  flightId: z.number().int().positive(),
  cabinClass: z.enum(["economy", "business"]),
  amount: z.number().int().nonnegative(),
  fareClassId: z.number().int().positive().optional(),
  holdId: z.number().int().positive().nullable(),
  departureTime: z.iso.datetime(),
  arrivalTime: z.iso.datetime(),
  offerId: z.string().uuid().nullable(),
  commercialQuote: z
    .object({
      amount: z.number().int().nonnegative(),
      lines: z.array(offerFareLineSchema).optional(),
      policy: z.string(),
      changeFee: z.number().int().nonnegative(),
    })
    .optional(),
  airlineId: z.number().int().optional(),
  originId: z.number().int().optional(),
  destinationId: z.number().int().optional(),
  ndc: z.record(z.string(), z.unknown()),
});
export const planSchema = z.object({
  version: z.literal(1),
  fingerprint: z.string(),
  revalidation: revalidationEvidence.optional(),
  seatExchange: seatExchangeSchema.optional(),
  termsHash: z.string().optional(),
  partyHash: z.string().optional(),
  scheduleHash: z.string().optional(),
  replaceFlightId: z.number().int().positive().optional(),
  expiresAt: z.iso.datetime(),
  segments: z.array(segment),
  ancillaries: z.array(
    ancillaryInput.extend({ unitTotal: z.number().int().nonnegative() })
  ),
});
export class OrderServicingUnavailable extends Error {}
const unavailable = (message: string) => new OrderServicingUnavailable(message);
async function itinerary(tx: SettlementTx, booking: Booking) {
  const legs = await tx
    .select()
    .from(bookingSegments)
    .where(eq(bookingSegments.bookingId, booking.id))
    .orderBy(asc(bookingSegments.segmentOrder))
    .for("update");
  return legs.length
    ? legs.map(l => ({
        id: l.id,
        flightId: l.flightId,
        amount: l.segmentAmount,
        fareClassId: l.fareClassId ?? null,
        reserved: l.seatsReserved,
        status: l.status,
      }))
    : [
        {
          id: null,
          flightId: booking.flightId,
          amount: booking.totalAmount,
          fareClassId: booking.fareClassId ?? null,
          reserved: booking.seatsReserved,
          status: booking.status,
        },
      ];
}
function fingerprint(
  booking: Booking,
  legs: Awaited<ReturnType<typeof itinerary>>
) {
  return calculateRequestHash({
    flightId: booking.flightId,
    cabinClass: booking.cabinClass,
    totalAmount: booking.totalAmount,
    checkedIn: booking.checkedIn,
    status: booking.status,
    legs: legs.map(l => ({
      flightId: l.flightId,
      amount: l.amount,
      ...(l.fareClassId != null ? { fareClassId: l.fareClassId } : {}),
      reserved: l.reserved,
      status: l.status,
    })),
  });
}
async function assertIssuingChannel(
  tx: SettlementTx,
  booking: Booking,
  action: NdcAction
) {
  if (await issuerMustService(tx, booking, action))
    throw unavailable("Issuing channel must service this booking");
  const orders = await tx
    .select()
    .from(ndcOrders)
    .where(eq(ndcOrders.bookingId, booking.id))
    .for("update");
  if (orders.some(order => !canServiceOrder(order, action)))
    throw unavailable("Issuing channel must service this booking");
}

function partyHash(booking: Booking, party: { id: number; type: string }[]) {
  return calculateRequestHash({
    count: booking.numberOfPassengers,
    tenantId: booking.tenantId,
    passengers: party.map(({ id, type }) => ({ id, type })),
  });
}

function scheduleHash(instances: (typeof flights.$inferSelect)[]) {
  return calculateRequestHash(
    instances.map(f => ({
      id: f.id,
      airlineId: f.airlineId,
      originId: f.originId,
      destinationId: f.destinationId,
      departure: f.departureTime,
      arrival: f.arrivalTime,
    }))
  );
}

function quoteTermsHash(
  originalAmount: number,
  newAmount: number,
  modificationFee: number,
  priceDifference: number
) {
  return calculateRequestHash({
    originalAmount,
    newAmount,
    modificationFee,
    priceDifference,
    currency: "SAR",
  });
}

export async function quotePaidOrderService(
  raw: z.infer<typeof paidServiceInput>,
  userId: number,
  tenantId: number | null,
  transaction?: SettlementTx
) {
  const input = paidServiceInput.parse(raw);
  const db = await getDb();
  if (!db) throw new Error("Servicing storage unavailable");
  const quoteInTransaction = async (tx: SettlementTx) => {
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, input.bookingId))
      .for("update");
    if (
      !booking ||
      booking.userId !== userId ||
      (tenantId !== null && booking.tenantId !== tenantId)
    )
      throw unavailable("Owned booking not found");
    await assertTenantOperational(tx, booking.tenantId);
    return withTransactionalIdempotency(
      {
        scope: "order.paid.service",
        key: input.idempotencyKey,
        userId,
        request: input,
        run: async tx => {
          await assertNoCollectionReview(tx, booking.id);
          if (
            booking.status !== "confirmed" ||
            booking.paymentStatus !== "paid" ||
            !booking.seatsReserved ||
            booking.checkedIn
          )
            throw unavailable(
              "A paid, confirmed booking before check-in is required"
            );
          const [pending] = await tx
            .select()
            .from(bookingModifications)
            .where(
              and(
                eq(bookingModifications.bookingId, booking.id),
                eq(bookingModifications.status, "pending")
              )
            )
            .limit(1);
          if (pending)
            throw unavailable("Resolve the existing servicing request first");
          await assertIssuingChannel(
            tx,
            booking,
            input.offerIds ? "exchange" : "addAncillary"
          );
          const old = await itinerary(tx, booking);
          if (old.some(l => !l.reserved || l.status !== "confirmed"))
            throw unavailable(
              "Existing itinerary reservation needs reconciliation"
            );
          const pax = await tx
            .select()
            .from(passengers)
            .where(eq(passengers.bookingId, booking.id))
            .orderBy(asc(passengers.id));
          if (pax.length !== booking.numberOfPassengers)
            throw unavailable("Passenger mapping needs reconciliation");
          const segments: z.infer<typeof segment>[] = [];
          const additions: z.infer<typeof planSchema>["ancillaries"] = [];
          let revalidation: z.infer<typeof revalidationEvidence> | undefined;
          let acceptedScheduleHash: string | undefined;
          let seatExchange: z.infer<typeof seatExchangeSchema> | undefined;
          let newAmount = booking.totalAmount;
          let modificationFee = 0;
          let fareDifference = 0;
          const expiry = new Date(Date.now() + 10 * 60000);
          if (input.offerIds) {
            if (
              old.some(leg => leg.fareClassId != null) &&
              input.replaceFlightId === undefined &&
              input.offerIds.length !== old.length
            )
              throw unavailable(
                "A changed RBD itinerary requires a class mapping for each sector"
              );
            await assertBaggageNotInCustody(tx, booking.id);
            const offers = await tx
              .select()
              .from(retailOffers)
              .where(inArray(retailOffers.id, input.offerIds));
            if (
              offers.length !== input.offerIds.length ||
              new Set(offers.map(o => o.flightId)).size !== offers.length ||
              new Set(offers.map(o => o.cabinClass)).size !== 1
            )
              throw unavailable(
                "Distinct flight offers in one cabin are required"
              );
            const cabin = offers[0].cabinClass;
            const replacedIndex = old.findIndex(
              l => l.flightId === input.replaceFlightId
            );
            if (
              input.replaceFlightId !== undefined &&
              (replacedIndex < 0 ||
                cabin !== booking.cabinClass ||
                old.some(
                  l => l.flightId === offers[0].flightId || l.amount == null
                ) ||
                old.reduce((sum, l) => sum + (l.amount ?? 0), 0) !==
                  booking.totalAmount)
            )
              throw unavailable(
                "Sector exchange requires a distinct replacement and verified segment amounts in the same cabin"
              );
            const targets =
              input.replaceFlightId === undefined
                ? input.offerIds.map(id => {
                    const offer = offers.find(o => o.id === id);
                    if (!offer) throw unavailable("Replacement offer missing");
                    return {
                      flightId: offer.flightId,
                      offerId: id,
                      retainedAmount: null,
                    };
                  })
                : old.map((l, index) =>
                    index === replacedIndex
                      ? {
                          flightId: offers[0].flightId,
                          offerId: offers[0].id,
                          retainedAmount: null,
                        }
                      : {
                          flightId: l.flightId,
                          offerId: null,
                          retainedAmount: l.amount,
                        }
                  );
            const heldFlights = new Map<number, typeof flights.$inferSelect>();
            for (const id of [
              ...new Set([
                ...old.map(l => l.flightId),
                ...offers.map(o => o.flightId),
              ]),
            ].sort((a, b) => a - b)) {
              const [flight] = await tx
                .select()
                .from(flights)
                .where(eq(flights.id, id))
                .for("update");
              if (
                !flight ||
                flight.tenantId !== booking.tenantId ||
                !["scheduled", "delayed"].includes(flight.status) ||
                flight.departureTime <= new Date()
              )
                throw unavailable("Flight instance is unavailable");
              heldFlights.set(id, flight);
            }
            acceptedScheduleHash = scheduleHash([...heldFlights.values()]);
            const original = heldFlights.get(booking.flightId);
            if (!original) throw unavailable("Original flight missing");
            seatExchange = await quoteSeatExchange(
              tx,
              booking,
              old.map(l => l.flightId),
              targets.map(t => t.flightId),
              cabin
            );
            for (const [index, target] of targets.entries()) {
              const fareClassId = old[index]?.fareClassId ?? undefined;
              const retained = old.find(l => l.flightId === target.flightId);
              if (retained && retained.fareClassId !== (fareClassId ?? null))
                throw unavailable(
                  "Reordering different booking classes requires a new class mapping"
                );
              const offer = target.offerId
                ? await lockRetailOffer(tx, target.offerId, {
                    flightId: target.flightId,
                    cabinClass: cabin,
                    tenantId: booking.tenantId,
                    userId,
                    channel: "direct",
                    fareClassId,
                    ruleSegmentCount: targets.length,
                    passengerTypes: pax.map(p => p.type),
                  })
                : null;
              const flight = heldFlights.get(target.flightId);
              if (!flight || flight.airlineId !== original.airlineId)
                throw unavailable(
                  "Cross-airline settlement requires a contracted partner"
                );
              const full = await getFlightById(flight.id);
              if (
                !full ||
                full.departureTime.getTime() !== flight.departureTime.getTime()
              )
                throw unavailable("Schedule changed");
              const unchanged =
                old.some(l => l.flightId === flight.id) &&
                booking.cabinClass === cabin;
              const hold = unchanged
                ? null
                : await createInventoryLock(
                    flight.id,
                    booking.numberOfPassengers,
                    cabin,
                    calculateRequestHash({
                      scope: "order.service.hold",
                      bookingId: booking.id,
                      key: input.idempotencyKey,
                    }),
                    userId,
                    tx,
                    undefined,
                    fareClassId
                  );
              const amount = offer?.totalAmount ?? target.retainedAmount;
              if (amount == null) throw unavailable("Unverified sector amount");
              const accepted = offer
                ? retailOfferPayloadSchema.parse(offer.payload)
                : null;
              const unmatched = accepted?.fareLines?.slice();
              const orderedLines = unmatched
                ? pax.map(p => {
                    const index = unmatched.findIndex(
                      line => line.type === p.type
                    );
                    if (index < 0)
                      throw unavailable(
                        "Offer passenger fares differ from booked party"
                      );
                    return unmatched.splice(index, 1)[0];
                  })
                : undefined;
              segments.push({
                flightId: flight.id,
                cabinClass: cabin,
                amount,
                fareClassId,
                holdId: hold?.lockId ?? null,
                offerId: target.offerId,
                commercialQuote: accepted
                  ? {
                      amount: accepted.totalAmount,
                      lines: orderedLines,
                      policy: accepted.policy.name,
                      changeFee: 0,
                    }
                  : undefined,
                originId: flight.originId,
                destinationId: flight.destinationId,
                airlineId: flight.airlineId,
                departureTime: flight.departureTime.toISOString(),
                arrivalTime: flight.arrivalTime.toISOString(),
                ndc: {
                  segmentKey: `SEG${segments.length + 1}`,
                  flightId: flight.id,
                  flightNumber: flight.flightNumber,
                  airlineCode: full.airline.code,
                  airlineName: full.airline.name,
                  origin: full.origin,
                  destination: full.destination,
                  departureTime: flight.departureTime.toISOString(),
                  arrivalTime: flight.arrivalTime.toISOString(),
                  aircraftType: flight.aircraftType,
                  cabinClass: cabin,
                },
              });
              if (offer) await consumeRetailOffer(tx, offer, booking.id);
            }
            for (let i = 1; i < segments.length; i++) {
              const a = heldFlights.get(segments[i - 1].flightId);
              const b = heldFlights.get(segments[i].flightId);
              if (
                !a ||
                !b ||
                a.destinationId !== b.originId ||
                b.departureTime.getTime() - a.arrivalTime.getTime() < 45 * 60000
              )
                throw unavailable(
                  "Replacement itinerary needs a valid connection of at least 45 minutes"
                );
            }
            const first = heldFlights.get(segments[0].flightId);
            const last = heldFlights.get(
              segments[segments.length - 1].flightId
            );
            const oldLast = heldFlights.get(old[old.length - 1].flightId);
            if (
              !first ||
              !last ||
              !oldLast ||
              first.originId !== original.originId ||
              last.destinationId !== oldLast.destinationId
            )
              throw unavailable("Replacement must preserve journey endpoints");
            // Retained sector amounts already contain their original seat charges.
            // For exchanged sectors, the retail offer is fare-only.
            for (const leg of segments) {
              if (leg.offerId)
                leg.amount += seatExchange.seats
                  .filter(seat => seat.toFlightId === leg.flightId)
                  .reduce((sum, seat) => sum + seat.amount, 0);
            }
            const fareAmount = segments.reduce(
              (sum, leg) => sum + leg.amount,
              0
            );
            fareDifference = fareAmount - booking.totalAmount;
            const originalChanged =
              input.replaceFlightId === undefined
                ? original
                : heldFlights.get(input.replaceFlightId);
            if (!originalChanged)
              throw unavailable("Original sector not found");
            modificationFee = calculateModificationFee(
              booking.totalAmount,
              originalChanged.departureTime
            );
            if (input.intent === "revalidate") {
              if (
                old.length !== 1 ||
                replacedIndex !== 0 ||
                modificationFee ||
                fareDifference
              )
                throw unavailable(
                  "Local revalidation requires one sector with no fare difference or fee"
                );
              revalidation = await checkTicketRevalidation(
                tx,
                booking,
                old[0],
                [...heldFlights.values()],
                input.offerIds[0]
              );
            }
            newAmount = fareAmount + modificationFee;
            if (replacedIndex >= 0) {
              segments[replacedIndex].amount += modificationFee;
              const quote = segments[replacedIndex].commercialQuote;
              if (quote) quote.changeFee = modificationFee;
            } else {
              const fees = allocateProportional(
                modificationFee,
                segments.map(s => s.amount)
              );
              for (const [i, leg] of segments.entries()) {
                leg.amount += fees[i];
                if (leg.commercialQuote)
                  leg.commercialQuote.changeFee = fees[i];
              }
            }
          } else
            for (const item of input.ancillaries ?? []) {
              const quote = await quoteInvoiceAncillary(tx, booking, item);
              additions.push({ ...item, unitTotal: quote.totalPrice });
              newAmount += quote.totalPrice;
            }
          if (
            !Number.isSafeInteger(newAmount) ||
            newAmount <= 0 ||
            newAmount > 2147483647
          )
            throw unavailable("Invalid replacement total");
          const plan: z.infer<typeof planSchema> = {
            version: 1,
            revalidation,
            partyHash: partyHash(booking, pax),
            scheduleHash: acceptedScheduleHash,
            termsHash: quoteTermsHash(
              booking.totalAmount,
              newAmount,
              modificationFee,
              input.offerIds ? fareDifference : newAmount - booking.totalAmount
            ),
            fingerprint: fingerprint(booking, old),
            seatExchange,
            replaceFlightId: input.replaceFlightId,
            expiresAt: expiry.toISOString(),
            segments,
            ancillaries: additions,
          };
          const [insert] = await tx.insert(bookingModifications).values({
            bookingId: booking.id,
            userId,
            modificationType: revalidation
              ? "change_date"
              : segments.length
                ? "change_flight"
                : "add_services",
            originalFlightId: input.replaceFlightId ?? booking.flightId,
            originalCabinClass: booking.cabinClass,
            originalAmount: booking.totalAmount,
            newFlightId:
              (input.replaceFlightId
                ? segments.find(s => s.offerId)
                : segments[0]
              )?.flightId ?? booking.flightId,
            newCabinClass: segments[0]?.cabinClass ?? booking.cabinClass,
            newAmount,
            priceDifference: input.offerIds
              ? fareDifference
              : newAmount - booking.totalAmount,
            modificationFee,
            totalCost: newAmount - booking.totalAmount,
            status: "pending",
            paymentStatus: "pending",
            servicingPayload: plan,
          });
          const modificationId = Number(insert.insertId);
          if (!modificationId)
            throw new Error("Modification identity unavailable");
          await recordEvent(tx, {
            aggregateType: "booking",
            aggregateId: booking.id,
            tenantId: booking.tenantId,
            eventType: "order.servicing_quoted",
            payload: {
              modificationId,
              totalCost: newAmount - booking.totalAmount,
              expiresAt: expiry.toISOString(),
            },
          });
          return {
            bookingId: booking.id,
            modificationId,
            totalCost: newAmount - booking.totalAmount,
            newAmount,
            modificationFee,
            priceDifference: input.offerIds
              ? fareDifference
              : newAmount - booking.totalAmount,
            originalAmount: booking.totalAmount,
            expiresAt: expiry,
            currency: "SAR" as const,
            seatExchange,
            requiresPayment: newAmount > booking.totalAmount,
            refundDue: Math.max(0, booking.totalAmount - newAmount),
          };
        },
      },
      tx
    );
  };
  return transaction
    ? quoteInTransaction(transaction)
    : withInventoryTransaction(db, quoteInTransaction);
}
/** Lock and validate the same version before creating checkout and again after verified collection. */
export async function validatePaidServiceQuote(
  tx: SettlementTx,
  booking: Booking,
  change: typeof bookingModifications.$inferSelect
) {
  const plan = planSchema.parse(change.servicingPayload);
  if (
    booking.paymentStatus !== "paid" ||
    !booking.seatsReserved ||
    booking.checkedIn
  )
    throw unavailable("Booking is no longer serviceable");
  const old = await itinerary(tx, booking);
  if (
    change.status !== "pending" ||
    change.bookingId !== booking.id ||
    change.originalAmount !== booking.totalAmount ||
    change.totalCost !== change.newAmount - change.originalAmount ||
    (plan.termsHash &&
      plan.termsHash !==
        quoteTermsHash(
          change.originalAmount,
          change.newAmount,
          change.modificationFee,
          change.priceDifference
        )) ||
    change.userId !== booking.userId ||
    fingerprint(booking, old) !== plan.fingerprint ||
    Date.parse(plan.expiresAt) <= Date.now()
  )
    throw unavailable("Servicing quote expired or booking changed");
  if (plan.partyHash) {
    const party = await tx
      .select({ id: passengers.id, type: passengers.type })
      .from(passengers)
      .where(eq(passengers.bookingId, booking.id))
      .orderBy(asc(passengers.id))
      .for("update");
    if (partyHash(booking, party) !== plan.partyHash)
      throw unavailable("Passenger composition changed after quote");
  }
  await assertTenantOperational(tx, booking.tenantId);
  await assertIssuingChannel(
    tx,
    booking,
    plan.segments.length ? "exchange" : "addAncillary"
  );
  if (plan.segments.length) {
    await assertBaggageNotInCustody(tx, booking.id);
    const cabin = plan.segments[0].cabinClass;
    const instances: (typeof flights.$inferSelect)[] = [];
    for (const id of [
      ...new Set([
        ...old.map(l => l.flightId),
        ...plan.segments.map(l => l.flightId),
      ]),
    ].sort((a, b) => a - b)) {
      const [flight] = await tx
        .select()
        .from(flights)
        .where(eq(flights.id, id))
        .for("update");
      const target = plan.segments.find(s => s.flightId === id);
      if (
        !flight ||
        flight.tenantId !== booking.tenantId ||
        !["scheduled", "delayed"].includes(flight.status) ||
        flight.departureTime <= new Date() ||
        (target &&
          ((target.airlineId !== undefined &&
            target.airlineId !== flight.airlineId) ||
            (target.originId !== undefined &&
              target.originId !== flight.originId) ||
            (target.destinationId !== undefined &&
              target.destinationId !== flight.destinationId) ||
            flight.departureTime.toISOString() !== target.departureTime ||
            flight.arrivalTime.toISOString() !== target.arrivalTime))
      )
        throw unavailable("Itinerary schedule changed");
      instances.push(flight);
    }
    if (plan.scheduleHash && scheduleHash(instances) !== plan.scheduleHash)
      throw unavailable("Itinerary schedule changed");
    if (change.modificationType === "change_date" || plan.revalidation) {
      const offerId = plan.segments[0]?.offerId;
      if (
        !plan.revalidation ||
        change.modificationType !== "change_date" ||
        change.totalCost ||
        change.priceDifference ||
        change.modificationFee ||
        old.length !== 1 ||
        plan.segments.length !== 1 ||
        plan.replaceFlightId !== old[0].flightId ||
        !offerId
      )
        throw unavailable("Invalid local ticket revalidation quote");
      const current = await checkTicketRevalidation(
        tx,
        booking,
        old[0],
        instances,
        offerId
      );
      if (
        calculateRequestHash(current) !==
        calculateRequestHash(plan.revalidation)
      )
        throw unavailable("Local ticket or fare evidence changed after quote");
    }
    const current = await quoteSeatExchange(
      tx,
      booking,
      old.map(l => l.flightId),
      plan.segments.map(s => s.flightId),
      cabin
    ).catch(error => {
      if (error instanceof TRPCError && error.code === "PRECONDITION_FAILED")
        throw unavailable(error.message);
      throw error;
    });
    if (
      calculateRequestHash(current) !==
      calculateRequestHash(
        plan.seatExchange ?? { seats: [], retainedAmount: 0 }
      )
    ) {
      throw unavailable("Paid seat disposition changed after quote");
    }
  }
  return { plan, old };
}
/** Only settlement or the authenticated no-charge confirmation calls this inside a booking transaction. */
export async function applyPaidOrderModification(
  tx: SettlementTx,
  booking: Booking,
  change: typeof bookingModifications.$inferSelect,
  funding:
    | { kind: "collected_modification"; paymentIntentId: string }
    | { kind: "authorized_no_charge" }
) {
  const { plan, old } = await validatePaidServiceQuote(tx, booking, change);
  const createdAncillaryIds: number[] = [];
  if (plan.segments.length) {
    const cabin = plan.segments[0].cabinClass;
    for (const leg of plan.segments) {
      if (
        old.some(l => l.flightId === leg.flightId) &&
        booking.cabinClass === cabin
      )
        continue;
      const [hold] = leg.holdId
        ? await tx
            .select()
            .from(inventoryLocks)
            .where(eq(inventoryLocks.id, leg.holdId))
            .for("update")
        : [];
      if (
        !hold ||
        hold.status !== "active" ||
        hold.expiresAt <= new Date() ||
        hold.userId !== booking.userId ||
        hold.flightId !== leg.flightId ||
        (hold.fareClassId ?? null) !== (leg.fareClassId ?? null) ||
        hold.cabinClass !== cabin ||
        hold.numberOfSeats !== booking.numberOfPassengers
      )
        throw unavailable("Replacement capacity hold expired");
      await reserveSeats(
        tx,
        leg.flightId,
        cabin,
        booking.numberOfPassengers,
        hold.id,
        leg.fareClassId
      );
      await tx
        .update(inventoryLocks)
        .set({ status: "converted", releasedAt: new Date() })
        .where(eq(inventoryLocks.id, hold.id));
    }
    for (const leg of old)
      if (
        !plan.segments.some(s => s.flightId === leg.flightId) ||
        booking.cabinClass !== cabin
      )
        await restoreSeats(
          tx,
          leg.flightId,
          booking.cabinClass,
          booking.numberOfPassengers,
          leg.fareClassId
        );
    if (plan.revalidation) {
      const evidence = plan.revalidation;
      const [updated] = await tx
        .update(ticketCoupons)
        .set({ flightId: evidence.toFlightId })
        .where(
          and(
            eq(ticketCoupons.id, evidence.couponId),
            eq(ticketCoupons.bookingId, booking.id),
            eq(ticketCoupons.flightId, evidence.fromFlightId),
            eq(ticketCoupons.status, "O")
          )
        );
      if (updated.affectedRows !== 1)
        throw unavailable("Open coupon changed after quote");
      await tx
        .update(bookingFareComponents)
        .set({ flightId: evidence.toFlightId })
        .where(
          and(
            eq(bookingFareComponents.bookingId, booking.id),
            eq(bookingFareComponents.flightId, evidence.fromFlightId),
            isNull(bookingFareComponents.reversedAt)
          )
        );
    }
    let retainedDocuments = Boolean(plan.revalidation);
    if (!retainedDocuments) {
      retainedDocuments = await exchangeLocalCoupons(
        tx,
        booking.id,
        old.map(l => l.flightId),
        plan.segments.map(l => l.flightId),
        booking.cabinClass === cabin
      );
    }
    if (plan.seatExchange)
      await transferExchangeSeats(tx, booking, plan.seatExchange).catch(
        error => {
          if (
            error instanceof TRPCError &&
            error.code === "PRECONDITION_FAILED"
          )
            throw unavailable(error.message);
          throw error;
        }
      );
    // A sector change must retain segment IDs used by ancillary entitlements.
    // For a full re-route, preserve a row for each unchanged flight where possible.
    const replacedFares = old
      .filter(
        l =>
          !plan.segments.some(
            newLeg => newLeg.flightId === l.flightId && !newLeg.offerId
          )
      )
      .map(l => l.flightId);
    if (!plan.revalidation && replacedFares.length)
      await tx
        .update(bookingFareComponents)
        .set({ reversedAt: sql`CURRENT_TIMESTAMP(0)` })
        .where(
          and(
            eq(bookingFareComponents.bookingId, booking.id),
            inArray(bookingFareComponents.flightId, replacedFares),
            isNull(bookingFareComponents.reversedAt)
          )
        );
    const party = await tx
      .select({ id: passengers.id })
      .from(passengers)
      .where(eq(passengers.bookingId, booking.id))
      .orderBy(asc(passengers.id));
    const retainedIds = new Set<number>();
    for (const [index, leg] of plan.segments.entries()) {
      const previous =
        plan.replaceFlightId !== undefined || plan.seatExchange?.seats.length
          ? old[index]
          : old.find(l => l.flightId === leg.flightId);
      const record = {
        bookingId: booking.id,
        segmentOrder: index + 1,
        flightId: leg.flightId,
        segmentAmount: leg.amount,
        fareClassId: leg.fareClassId ?? null,
        departureDate: new Date(leg.departureTime),
        seatsReserved: true,
        status: "confirmed" as const,
      };
      let segmentId = previous?.id;
      if (previous?.id != null) {
        retainedIds.add(previous.id);
        if (
          plan.replaceFlightId !== undefined &&
          previous.flightId === leg.flightId &&
          !leg.offerId
        )
          continue;
        await tx
          .update(bookingSegments)
          .set({
            ...record,
            ...(previous.flightId !== leg.flightId ||
            booking.cabinClass !== cabin
              ? { inventoryLockId: leg.holdId }
              : {}),
          })
          .where(eq(bookingSegments.id, previous.id));
      } else {
        const [inserted] = await tx
          .insert(bookingSegments)
          .values({ ...record, inventoryLockId: leg.holdId });
        segmentId = inserted.insertId;
      }
      if (!plan.revalidation && leg.offerId && segmentId) {
        const quote = leg.commercialQuote;
        const seats =
          plan.seatExchange?.seats.filter(
            seat => seat.toFlightId === leg.flightId
          ) ?? [];
        const seatTotal = seats.reduce((sum, seat) => sum + seat.amount, 0);
        if (quote && leg.amount !== quote.amount + quote.changeFee + seatTotal)
          throw unavailable(
            "Sector fare evidence differs from accepted servicing terms"
          );
        await persistInitialFareComponents(tx, {
          bookingId: booking.id,
          tenantId: booking.tenantId,
          flightId: leg.flightId,
          bookingSegmentId: segmentId,
          passengerIds: party.map(p => p.id),
          totalAmount: quote?.amount ?? leg.amount,
          source: "servicing",
          sourceReference: leg.offerId,
          sectorQuote: quote
            ? { fareLines: quote.lines, policy: { name: quote.policy } }
            : undefined,
        });
        if (quote) {
          const common = {
            bookingId: booking.id,
            tenantId: booking.tenantId,
            flightId: leg.flightId,
            bookingSegmentId: segmentId,
            currency: "SAR",
          } as const;
          for (const seat of seats)
            await tx.insert(bookingFareComponents).values({
              ...common,
              passengerId: seat.passengerId,
              componentType: "ancillary",
              amount: seat.amount,
              code: "PAID_SEAT",
              source: "ancillary_catalog",
              sourceReference: String(seat.ancillaryId),
            });
          if (quote.changeFee)
            await tx.insert(bookingFareComponents).values({
              ...common,
              componentType: "booking_fee",
              amount: quote.changeFee,
              code: "CHANGE_FEE",
              source: "servicing",
              sourceReference: leg.offerId,
            });
        }
      }
    }
    const removedIds = old.flatMap(l =>
      l.id !== null && !retainedIds.has(l.id) ? [l.id] : []
    );
    if (removedIds.length)
      await tx
        .delete(bookingSegments)
        .where(inArray(bookingSegments.id, removedIds));
    const removedFlights = old
      .filter(
        l =>
          booking.cabinClass !== cabin ||
          !plan.segments.some(s => s.flightId === l.flightId)
      )
      .map(l => l.flightId);
    if (removedFlights.length)
      await tx
        .update(seatInventory)
        .set({
          bookingId: null,
          passengerId: null,
          status: "available",
          assignedAt: null,
          checkedInAt: null,
          boardingPassIssued: false,
        })
        .where(
          and(
            eq(seatInventory.bookingId, booking.id),
            inArray(seatInventory.flightId, removedFlights),
            inArray(seatInventory.status, ["held", "occupied"])
          )
        );
    const anchorChanged =
      booking.flightId !== plan.segments[0].flightId ||
      booking.cabinClass !== cabin;
    if (anchorChanged || !retainedDocuments)
      await tx
        .update(passengers)
        .set({
          ...(anchorChanged ? { seatNumber: null } : {}),
          ...(!retainedDocuments ? { ticketNumber: null } : {}),
        })
        .where(eq(passengers.bookingId, booking.id));
    await tx
      .update(bookings)
      .set({
        flightId: plan.segments[0].flightId,
        fareClassId: plan.segments[0].fareClassId ?? null,
        cabinClass: cabin,
        inventoryLockId: anchorChanged ? null : booking.inventoryLockId,
        totalAmount: change.newAmount,
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, booking.id));
    const orders = await tx
      .select()
      .from(ndcOrders)
      .where(eq(ndcOrders.bookingId, booking.id))
      .for("update");
    for (const order of orders) {
      const payload = storedJson<Record<string, unknown>>(
        order.orderPayload,
        {}
      );
      payload.segments = plan.segments.map(s => s.ndc);
      payload.pricing = { totalAmount: change.newAmount, currency: "SAR" };
      payload.fulfillment = "awaiting_ticket_reissue";
      await tx
        .update(ndcOrders)
        .set({
          status: "confirmed",
          totalAmount: change.newAmount,
          orderPayload: JSON.stringify(payload),
          lastServicingAction: "PaidItineraryExchanged",
          updatedAt: new Date(),
        })
        .where(eq(ndcOrders.id, order.id));
    }
  } else {
    let current = booking;
    let custodyChecked = false;
    for (const item of plan.ancillaries) {
      const quote = await quoteInvoiceAncillary(tx, current, item);
      if (quote.totalPrice !== item.unitTotal)
        throw unavailable("Ancillary catalog changed");
      if (quote.service.category === "baggage" && !custodyChecked) {
        await assertBaggageNotInCustody(tx, booking.id);
        custodyChecked = true;
      }
      const created = await insertInvoiceAncillary(
        tx,
        current,
        {
          ...item,
          metadata: {
            fulfillment: "entitlement_created",
            modificationId: change.id,
          },
        },
        "completed_servicing"
      );
      createdAncillaryIds.push(created.id);
      current = {
        ...current,
        totalAmount: current.totalAmount + item.unitTotal,
      };
    }
    if (current.totalAmount !== change.newAmount)
      throw unavailable("Servicing invoice mismatch");
  }
  if (change.totalCost < 0)
    await planOrderRefund(tx, booking, change.id, -change.totalCost);
  const receipt = await recordEvent(tx, {
    aggregateType: "booking",
    aggregateId: booking.id,
    tenantId: booking.tenantId,
    eventType: "order.servicing_applied",
    payload: {
      modificationId: change.id,
      currency: "SAR",
      quoteTermsHash: plan.termsHash,
      previousTotal: booking.totalAmount,
      totalAmount: change.newAmount,
      refundDue: Math.max(0, -change.totalCost),
      ...(plan.revalidation ? { revalidation: plan.revalidation } : {}),
      fulfillment: plan.revalidation
        ? "local_ticket_revalidated"
        : plan.segments.length
          ? "awaiting_ticket_reissue"
          : "entitlement_created",
    },
  });
  await tx
    .update(bookingModifications)
    .set({
      status: "completed",
      paymentStatus: "paid",
      executionEventId: receipt,
      completedAt: new Date(),
    })
    .where(eq(bookingModifications.id, change.id));
  if (createdAncillaryIds.length) {
    const fundingReference =
      funding.kind === "collected_modification"
        ? {
            kind: funding.kind,
            modificationId: change.id,
            paymentIntentId: funding.paymentIntentId,
            executionEventId: receipt,
          }
        : {
            kind: funding.kind,
            modificationId: change.id,
            executionEventId: receipt,
          };
    await tx
      .update(bookingAncillaries)
      .set({ fundedAt: new Date(), fundingReference })
      .where(
        and(
          inArray(bookingAncillaries.id, createdAncillaryIds),
          eq(bookingAncillaries.scopeState, "specific_segment"),
          isNotNull(bookingAncillaries.passengerId),
          isNotNull(bookingAncillaries.segmentId),
          isNotNull(bookingAncillaries.weightSnapshotGrams)
        )
      );
  }
  return { receiptId: receipt, refundDue: Math.max(0, -change.totalCost) };
}
export async function confirmNoChargeService(
  modificationId: number,
  userId: number,
  tenantId: number | null = null,
  transaction?: SettlementTx
) {
  const db = await getDb();
  if (!db) throw new Error("Servicing storage unavailable");
  const [hint] = await (transaction ?? db)
    .select()
    .from(bookingModifications)
    .where(eq(bookingModifications.id, modificationId))
    .limit(1);
  if (!hint || hint.userId !== userId)
    throw unavailable("Owned modification not found");
  const confirm = async (tx: SettlementTx) => {
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, hint.bookingId))
      .for("update");
    const [change] = await tx
      .select()
      .from(bookingModifications)
      .where(eq(bookingModifications.id, modificationId))
      .for("update");
    if (
      !booking ||
      booking.userId !== userId ||
      (tenantId !== null && booking.tenantId !== tenantId) ||
      !change ||
      change.bookingId !== booking.id ||
      change.userId !== userId ||
      change.totalCost > 0
    )
      throw unavailable("Verified payment is required");
    if (change.status === "completed" && change.executionEventId)
      return {
        receiptId: change.executionEventId,
        refundDue: Math.max(0, -change.totalCost),
      };
    await assertNoCollectionReview(tx, booking.id);
    return applyPaidOrderModification(tx, booking, change, {
      kind: "authorized_no_charge",
    });
  };
  return transaction ? confirm(transaction) : db.transaction(confirm);
}
