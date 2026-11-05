import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  bookings,
  bookingSegments,
  bookingFareComponents,
  fareClasses,
  fareRules,
  flights,
} from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";
import { calculateCancellationFee } from "./cancellation-fees.service";
import { calculateRequestHash } from "./idempotency-v2.service";

const unavailable = (message: string) =>
  new TRPCError({ code: "PRECONDITION_FAILED", message });
const penalty = z
  .object({
    penaltyType: z.enum(["change", "cancel", "no_show"]),
    nonRefundable: z.boolean().optional(),
    fixedFee: z.number().int().nonnegative().optional(),
    percentageFee: z.number().finite().nonnegative().optional(),
    hoursBeforeDeparture: z.number().finite().nonnegative().optional(),
    changeTiers: z
      .array(z.object({ withinHours: z.number(), fee: z.number() }))
      .optional(),
  })
  .strict();

/** The quote identifies the persisted fare terms and invoice being cancelled.
 * Caller holds the booking lock when using this quote to commit an operation.
 * Unsupported component/rule combinations require review, never an invented
 * entitlement to refund (or retain) separately priced tax and services. */
export async function quoteCancellationPolicy(
  tx: SettlementTx,
  booking: typeof bookings.$inferSelect,
  knownItinerary?: Array<typeof flights.$inferSelect>
) {
  if (!Number.isSafeInteger(booking.totalAmount) || booking.totalAmount <= 0)
    throw unavailable(
      "Booking amount requires reconciliation before cancellation"
    );
  const segments = await tx
    .select()
    .from(bookingSegments)
    .where(eq(bookingSegments.bookingId, booking.id))
    .orderBy(bookingSegments.flightId);
  const currentSegments = segments.filter(s => s.status !== "cancelled");
  const flightIds = [
    ...new Set([booking.flightId, ...currentSegments.map(s => s.flightId)]),
  ].sort((a, b) => a - b);
  const itinerary =
    knownItinerary ??
    (await tx
      .select()
      .from(flights)
      .where(inArray(flights.id, flightIds))
      .orderBy(flights.id)
      .for("update"));
  if (
    itinerary.length !== flightIds.length ||
    flightIds.some(id => !itinerary.some(f => f.id === id))
  )
    throw unavailable("The cancellation itinerary requires reconciliation");
  const departure = new Date(
    Math.min(...itinerary.map(f => f.departureTime.getTime()))
  );
  const timedFee = calculateCancellationFee(booking.totalAmount, departure);
  const classIds = [
    ...new Set(
      [
        booking.fareClassId,
        ...currentSegments.map(s => s.fareClassId ?? booking.fareClassId),
      ].filter((id): id is number => id != null)
    ),
  ].sort((a, b) => a - b);
  const classes = classIds.length
    ? await tx
        .select()
        .from(fareClasses)
        .where(inArray(fareClasses.id, classIds))
        .orderBy(fareClasses.id)
        .for("update")
    : [];
  if (classes.length !== classIds.length)
    throw unavailable(
      "The booked fare terms are unavailable; cancellation requires review"
    );
  const rules = classIds.length
    ? await tx
        .select()
        .from(fareRules)
        .where(
          and(
            inArray(fareRules.fareClassId, classIds),
            eq(fareRules.ruleCategory, "penalties")
          )
        )
        .orderBy(fareRules.id)
        .for("update")
    : [];
  const terms: Array<{
    flightId: number;
    fareClassId: number | null;
    refundable: boolean;
    rules: Array<{ id: number; conditions: string }>;
  }> = [];
  for (const flight of itinerary) {
    const classId =
      currentSegments.find(s => s.flightId === flight.id)?.fareClassId ??
      booking.fareClassId ??
      null;
    const fareClass = classes.find(c => c.id === classId);
    if (fareClass && fareClass.airlineId !== flight.airlineId)
      throw unavailable(
        "The booked fare does not belong to this itinerary's airline"
      );
    // There is no versioned historical cancellation-term snapshot for legacy
    // fares. A changed class cannot retroactively establish a different refund.
    if (
      fareClass &&
      booking.createdAt &&
      fareClass.updatedAt &&
      fareClass.updatedAt > booking.createdAt
    )
      throw unavailable(
        "The booked fare terms have changed; historical cancellation terms require servicing review"
      );
    let refundable = fareClass?.refundable ?? true;
    const applied: Array<{ id: number; conditions: string }> = [];
    for (const rule of rules.filter(r => r.fareClassId === classId)) {
      const effectiveDate = booking.createdAt ?? new Date();
      if (
        rule.validFrom > effectiveDate ||
        (rule.validUntil && rule.validUntil < effectiveDate) ||
        (rule.originAirportId != null &&
          rule.originAirportId !== flight.originId) ||
        (rule.destinationAirportId != null &&
          rule.destinationAirportId !== flight.destinationId)
      )
        continue;
      if (rule.airlineId !== flight.airlineId)
        throw unavailable("Cancellation fare-rule ownership requires review");
      let raw: unknown;
      try {
        raw = JSON.parse(rule.conditions);
      } catch {
        throw unavailable("Cancellation fare-rule conditions require review");
      }
      const parsed = penalty.safeParse(raw);
      if (!parsed.success)
        throw unavailable("Cancellation fare-rule conditions require review");
      const condition = parsed.data;
      if (condition.penaltyType !== "cancel") continue;
      if (
        booking.createdAt &&
        rule.updatedAt &&
        rule.updatedAt > booking.createdAt
      )
        throw unavailable(
          "The booked cancellation rule has changed; historical terms require servicing review"
        );
      if (!rule.active) continue;
      const hours = (flight.departureTime.getTime() - Date.now()) / 3_600_000;
      if (
        condition.hoursBeforeDeparture !== undefined &&
        hours > condition.hoursBeforeDeparture
      )
        continue;
      // A non-refundable term is explicit. Other configured monetary penalty
      // formulas need their own supported precedence instead of the time tier.
      if (
        condition.nonRefundable !== true &&
        ((condition.fixedFee ?? 0) > 0 ||
          (condition.percentageFee ?? 0) > 0 ||
          (rule.priceAdjustment ?? 0) !== 0 ||
          Number(rule.priceMultiplier ?? 1) !== 1)
      )
        throw unavailable(
          "This fare's configured cancellation penalty requires servicing review"
        );
      if (fareClass?.refundable === false && condition.nonRefundable === false)
        throw unavailable(
          "Conflicting refundable fare terms require servicing review"
        );
      if (condition.nonRefundable) refundable = false;
      applied.push({ id: rule.id, conditions: rule.conditions });
    }
    terms.push({
      flightId: flight.id,
      fareClassId: classId,
      refundable,
      rules: applied,
    });
  }
  if (terms.some(t => t.refundable) && terms.some(t => !t.refundable))
    throw unavailable(
      "Mixed refundable and nonrefundable sectors require servicing review"
    );
  const nonrefundable = terms.some(t => !t.refundable);
  const fee = nonrefundable
    ? {
        totalAmount: booking.totalAmount,
        cancellationFee: booking.totalAmount,
        refundAmount: 0,
        refundPercentage: 0,
        tier: "none" as const,
      }
    : timedFee;
  const components =
    fee.refundAmount === 0
      ? await tx
          .select()
          .from(bookingFareComponents)
          .where(
            and(
              eq(bookingFareComponents.bookingId, booking.id),
              isNull(bookingFareComponents.reversedAt)
            )
          )
          .orderBy(bookingFareComponents.id)
          .for("update")
      : [];
  if (
    components.length &&
    (components.some(
      c =>
        c.tenantId !== booking.tenantId ||
        c.currency !== "SAR" ||
        !Number.isSafeInteger(c.amount) ||
        (c.amount !== 0 && !["base_fare", "discount"].includes(c.componentType))
    ) ||
      components.reduce((total, c) => total + c.amount, 0) !==
        booking.totalAmount)
  )
    throw unavailable(
      "Separately recorded taxes, fees or services require a cancellation review; their refund policy is not defined by the fare's refundable flag"
    );
  const policyReason = nonrefundable
    ? ("nonrefundable_fare" as const)
    : ("time_based" as const);
  const quoteHash = calculateRequestHash({
    version: 1,
    bookingId: booking.id,
    userId: booking.userId,
    tenantId: booking.tenantId,
    totalAmount: booking.totalAmount,
    paymentIntentId: booking.stripePaymentIntentId,
    itinerary: itinerary.map(f => ({
      id: f.id,
      departureTime: f.departureTime,
    })),
    terms,
    components: components.map(c => ({
      id: c.id,
      type: c.componentType,
      amount: c.amount,
      policyVersion: c.policyVersion,
    })),
    fee,
    policyReason,
  });
  return {
    ...fee,
    policyReason,
    quoteHash,
    requiresZeroRefundConfirmation: fee.refundAmount === 0,
  };
}
