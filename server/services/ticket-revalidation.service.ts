import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  airports,
  baggageItems,
  bookingAncillaries,
  bookingFareComponents,
  bookingRefundPlans,
  dcsPassengerStates,
  deniedBoardingRecords,
  financialLedger,
  flights,
  ndcOrders,
  orderServiceRefunds,
  outbox,
  passengers,
  paymentReceipts,
  paymentSplits,
  retailOffers,
  seatInventory,
  specialServices,
  ticketCoupons,
  type Booking,
} from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";
import { civilDateInZone, isValidTimeZone } from "./civil-day";
import { calculateModificationFee } from "./modification-fee";
import {
  offerDigest,
  readRevalidationTerms,
  retailOfferPayloadSchema,
} from "./retail-offer.service";
import { saleFareRuleDigest } from "./sale-fare-rules";

const positive = z.number().int().positive();
export const revalidationEvidence = z.object({
  issuedEventId: z.string().uuid(),
  couponId: positive,
  couponNumber: positive,
  ticketNumber: z.string().regex(/^\d{13}$/),
  passengerId: positive,
  fromFlightId: positive,
  toFlightId: positive,
  fromDeparture: z.iso.datetime(),
  toDeparture: z.iso.datetime(),
  fareDigest: z.string().length(64),
  originalOfferId: z.string().uuid(),
  replacementOfferId: z.string().uuid(),
});

export const revalidationReceipt = revalidationEvidence.pick({
  ticketNumber: true,
  couponNumber: true,
  fromFlightId: true,
  toFlightId: true,
  fromDeparture: true,
  toDeparture: true,
});

function refuse(): never {
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      "Local ticket revalidation requires one locally issued open coupon, unchanged fare and service, and verified direct funding. Review exchange options.",
  });
}

/** Called under the booking and flight locks for both quoting and executing.
 * Missing source evidence, third-party orders and operational commitments are
 * deliberately ineligible for this local single-passenger, single-sector action. */
export async function checkTicketRevalidation(
  tx: SettlementTx,
  booking: Booking,
  segment: {
    id: number | null;
    flightId: number;
    fareClassId: number | null;
    amount: number | null;
  },
  instances: (typeof flights.$inferSelect)[],
  replacementOfferId: string
) {
  const from = instances.find(f => f.id === booking.flightId);
  const to = instances.find(f => f.id !== booking.flightId);
  if (
    !from ||
    !to ||
    instances.length !== 2 ||
    !segment.id ||
    booking.deletedAt ||
    segment.flightId !== from.id ||
    segment.amount !== booking.totalAmount ||
    !booking.fareClassId ||
    segment.fareClassId !== booking.fareClassId ||
    booking.numberOfPassengers !== 1 ||
    booking.paymentStatus !== "paid" ||
    booking.status !== "confirmed" ||
    booking.checkedIn ||
    !booking.seatsReserved ||
    booking.stripePaymentIntentId ||
    booking.stripeCheckoutSessionId ||
    from.status !== "scheduled" ||
    to.status !== "scheduled" ||
    from.flightNumber !== to.flightNumber ||
    from.airlineId !== to.airlineId ||
    from.originId !== to.originId ||
    from.destinationId !== to.destinationId ||
    calculateModificationFee(booking.totalAmount, from.departureTime) !== 0
  )
    refuse();

  const [origin] = await tx
    .select({ zone: airports.timezone })
    .from(airports)
    .where(eq(airports.id, from.originId));
  if (
    !isValidTimeZone(origin?.zone) ||
    civilDateInZone(from.departureTime, origin.zone) ===
      civilDateInZone(to.departureTime, origin.zone)
  )
    refuse();

  const [destination] = await tx
    .select({ zone: airports.timezone })
    .from(airports)
    .where(eq(airports.id, from.destinationId));
  if (!isValidTimeZone(destination?.zone)) refuse();
  const clock = (date: Date, zone: string) =>
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: zone,
    }).format(date);
  if (
    clock(from.departureTime, origin.zone) !==
      clock(to.departureTime, origin.zone) ||
    clock(from.arrivalTime, destination.zone) !==
      clock(to.arrivalTime, destination.zone) ||
    from.arrivalTime.getTime() - from.departureTime.getTime() !==
      to.arrivalTime.getTime() - to.departureTime.getTime()
  )
    refuse();
  for (const table of [
    ndcOrders,
    baggageItems,
    bookingAncillaries,
    specialServices,
    dcsPassengerStates,
    deniedBoardingRecords,
    seatInventory,
    bookingRefundPlans,
    orderServiceRefunds,
    paymentReceipts,
    paymentSplits,
  ] as const) {
    const [linked] = await tx
      .select({ bookingId: table.bookingId })
      .from(table)
      .where(eq(table.bookingId, booking.id))
      .limit(1)
      .for("update");
    if (linked) refuse();
  }
  const ledger = await tx
    .select()
    .from(financialLedger)
    .where(eq(financialLedger.bookingId, booking.id))
    .for("update");
  const funding = ledger[0];
  if (
    ledger.length !== 1 ||
    funding.type !== "charge" ||
    funding.currency !== "SAR" ||
    funding.userId !== booking.userId ||
    funding.stripePaymentIntentId ||
    ![`internal-credit:${booking.id}`, `wallet-credit:${booking.id}`].includes(
      funding.stripeEventId ?? ""
    ) ||
    Math.round(Number(funding.amount) * 100) !== booking.totalAmount
  )
    refuse();

  const party = await tx
    .select()
    .from(passengers)
    .where(eq(passengers.bookingId, booking.id))
    .for("update");
  const pax = party[0];
  if (
    party.length !== 1 ||
    !pax.ticketNumber ||
    !/^\d{13}$/.test(pax.ticketNumber) ||
    pax.seatNumber
  )
    refuse();
  const coupons = await tx
    .select()
    .from(ticketCoupons)
    .where(eq(ticketCoupons.bookingId, booking.id))
    .for("update");
  const coupon = coupons[0];
  if (
    coupons.length !== 1 ||
    coupon.status !== "O" ||
    coupon.passengerId !== pax.id ||
    coupon.ticketNumber !== pax.ticketNumber ||
    coupon.flightId !== from.id
  )
    refuse();
  const issuance = await tx
    .select()
    .from(outbox)
    .where(
      and(
        eq(outbox.aggregateType, "booking"),
        eq(outbox.aggregateId, String(booking.id)),
        eq(outbox.eventType, "ETicketIssued")
      )
    );
  const issuePayload = z.object({
    bookingId: z.literal(booking.id),
    passengerId: z.literal(pax.id),
    ticketNumber: z.literal(pax.ticketNumber),
    acceptance: z.literal("local_document_external_ticket_acceptance_required"),
  });
  if (
    issuance.length !== 1 ||
    issuance[0].tenantId !== booking.tenantId ||
    !issuePayload.safeParse(issuance[0].payload).success
  )
    refuse();

  const components = await tx
    .select()
    .from(bookingFareComponents)
    .where(
      and(
        eq(bookingFareComponents.bookingId, booking.id),
        isNull(bookingFareComponents.reversedAt)
      )
    )
    .for("update");
  const originalOfferId = components[0]?.sourceReference;
  if (
    !originalOfferId ||
    components.length !== 3 ||
    components.some(
      c =>
        c.flightId !== from.id ||
        c.tenantId !== booking.tenantId ||
        c.passengerId !== pax.id ||
        c.bookingSegmentId !== segment.id ||
        c.currency !== "SAR" ||
        c.source !== "retail_offer" ||
        c.sourceReference !== originalOfferId
    )
  )
    refuse();
  const offers = await tx
    .select()
    .from(retailOffers)
    .where(inArray(retailOffers.id, [originalOfferId, replacementOfferId]))
    .for("update");
  const source = offers.find(o => o.id === originalOfferId);
  const target = offers.find(o => o.id === replacementOfferId);
  if (
    !source ||
    !target ||
    source.id === target.id ||
    target.flightId !== to.id ||
    offers.some(
      o =>
        o.channel !== "direct" ||
        o.cabinClass !== booking.cabinClass ||
        o.consumedBookingId !== booking.id ||
        o.tenantId !== booking.tenantId ||
        (o.userId != null && o.userId !== booking.userId) ||
        o.totalAmount !== booking.totalAmount ||
        o.digest !== offerDigest(o.payload)
    ) ||
    source.digest !== target.digest
  )
    refuse();
  const fare = retailOfferPayloadSchema.parse(source.payload);
  const currentTerms = await readRevalidationTerms(tx, booking.fareClassId);
  const line = fare.fareLines?.[0];
  if (
    !line ||
    fare.fareLines?.length !== 1 ||
    line.type !== pax.type ||
    !fare.revalidationTerms?.changeable ||
    !fare.revalidationTerms.code ||
    fare.revalidationTerms.changeFee !== 0 ||
    JSON.stringify(fare.revalidationTerms) !== JSON.stringify(currentTerms) ||
    fare.experiment ||
    fare.fareClassId !== booking.fareClassId ||
    fare.policy.name !== `direct:rbd:${booking.fareClassId}:v1` ||
    fare.totalAmount !== booking.totalAmount ||
    fare.fareRuleDigest !==
      (await saleFareRuleDigest(tx, to, booking.fareClassId, [pax.type], 1))
  )
    refuse();
  for (const [kind, code, amount] of [
    ["base_fare", "AIR_FARE", line.baseFare],
    ["tax", "OFFER_TAX_ESTIMATE", line.tax],
    ["booking_fee", "BOOKING_FEE", line.bookingFee],
  ] as const) {
    if (
      !components.some(
        c =>
          c.componentType === kind &&
          c.code === code &&
          c.amount === amount &&
          c.policyVersion === fare.policy.name
      )
    )
      refuse();
  }
  return revalidationEvidence.parse({
    issuedEventId: issuance[0].eventId,
    couponId: coupon.id,
    couponNumber: coupon.couponNumber,
    ticketNumber: pax.ticketNumber,
    passengerId: pax.id,
    fromFlightId: from.id,
    toFlightId: to.id,
    fromDeparture: from.departureTime.toISOString(),
    toDeparture: to.departureTime.toISOString(),
    originalOfferId,
    replacementOfferId,
    fareDigest: source.digest,
  });
}
