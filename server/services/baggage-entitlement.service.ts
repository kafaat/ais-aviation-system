import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import {
  ancillaryServices,
  bookingAncillaries,
  bookingModifications,
  bookingSegments,
  bookings,
  passengers,
  paymentReceipts,
} from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";

export const MAX_BAG_WEIGHT_GRAMS = 32000;

/** Read-only presentation path. It uses the same authority as bag-drop. */
export async function listOwnedBaggageEntitlements(
  tx: SettlementTx,
  bookingId: number,
  actor: { id: number; role: string; tenantId: number | null | undefined }
) {
  const [booking] = await tx
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (
    !booking ||
    (actor.tenantId != null && booking.tenantId !== actor.tenantId)
  )
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
  if (booking.userId !== actor.id && actor.role !== "admin")
    throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
  if (booking.status === "cancelled") return [];
  const people = await tx
    .select()
    .from(passengers)
    .where(eq(passengers.bookingId, bookingId));
  const legs = await tx
    .select()
    .from(bookingSegments)
    .where(eq(bookingSegments.bookingId, bookingId));
  const result = [];
  for (const leg of legs.filter(row => row.status !== "cancelled")) {
    for (const person of people.filter(
      row => actor.tenantId == null || row.tenantId === actor.tenantId
    )) {
      const value = await computeBaggageEntitlement(tx, {
        bookingId,
        passengerId: person.id,
        segmentId: leg.id,
      });
      // Financial references and ancillary identifiers are not presentation data.
      result.push({
        passengerId: person.id,
        segmentId: leg.id,
        segmentOrder: leg.segmentOrder,
        flightId: leg.flightId,
        totalWeightGrams: value.totalWeightGrams,
        maxBagWeightGrams: value.maxBagWeightGrams,
        requiresOperationalReview: value.requiresOperationalReview,
        warnings: [...new Set(value.warnings.map(warning => warning.code))],
      });
    }
  }
  return result;
}

const CABIN_ALLOWANCE_GRAMS: Record<string, number> = {
  economy: 23000,
  business: 32000,
};

export type BaggageEntitlementWarningCode =
  | "missing_passenger"
  | "missing_scope"
  | "unapproved_all_segments_scope"
  | "missing_weight_snapshot"
  | "missing_funding"
  | "invalid_funding_evidence";

export interface BaggageEntitlementWarning {
  code: BaggageEntitlementWarningCode;
  ancillaryId: number;
  message: string;
}

export interface BaggageEntitlement {
  bookingId: number;
  passengerId: number;
  segmentId: number;
  totalWeightGrams: number;
  maxBagWeightGrams: number;
  sources: Array<{
    type: "cabin" | "ancillary";
    weightGrams: number;
    referenceId: string;
    label: string;
  }>;
  warnings: BaggageEntitlementWarning[];
  requiresOperationalReview: boolean;
}

type FundingReference = NonNullable<
  typeof bookingAncillaries.$inferSelect.fundingReference
>;

async function hasValidFundingEvidence(
  tx: SettlementTx,
  bookingId: number,
  reference: FundingReference
) {
  if (reference.kind === "collected_booking") {
    if (reference.bookingId !== bookingId) return false;
    const [receipt] = await tx
      .select()
      .from(paymentReceipts)
      .where(eq(paymentReceipts.paymentIntentId, reference.paymentIntentId))
      .limit(1);
    const [fundedBooking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);
    return Boolean(
      receipt &&
      receipt.kind === "booking" &&
      receipt.bookingId === bookingId &&
      receipt.targetId === bookingId &&
      receipt.settlementStatus === "applied" &&
      fundedBooking?.paymentStatus === "paid" &&
      fundedBooking.stripePaymentIntentId === reference.paymentIntentId
    );
  }
  const [modification] = await tx
    .select()
    .from(bookingModifications)
    .where(
      and(
        eq(bookingModifications.id, reference.modificationId),
        eq(bookingModifications.bookingId, bookingId)
      )
    )
    .limit(1);
  if (
    !modification ||
    modification.status !== "completed" ||
    modification.paymentStatus !== "paid" ||
    modification.executionEventId !== reference.executionEventId
  )
    return false;
  if (reference.kind === "authorized_no_charge")
    return modification.totalCost <= 0;
  if (modification.stripePaymentIntentId !== reference.paymentIntentId)
    return false;
  const [receipt] = await tx
    .select()
    .from(paymentReceipts)
    .where(eq(paymentReceipts.paymentIntentId, reference.paymentIntentId))
    .limit(1);
  return Boolean(
    receipt &&
    receipt.kind === "modification" &&
    receipt.bookingId === bookingId &&
    receipt.targetId === reference.modificationId &&
    receipt.settlementStatus === "applied"
  );
}

/**
 * The single automatic baggage allowance authority.
 *
 * Phase 0 deliberately treats legacy, unpaid and ambiguous items as operator
 * review instead of granting weight or silently charging excess baggage.
 * `all_segments` remains unapproved by F30 and therefore never grants weight.
 */
export async function computeBaggageEntitlement(
  tx: SettlementTx,
  args: { bookingId: number; passengerId: number; segmentId: number }
): Promise<BaggageEntitlement> {
  const [booking] = await tx
    .select()
    .from(bookings)
    .where(eq(bookings.id, args.bookingId))
    .limit(1);
  const [passenger] = await tx
    .select()
    .from(passengers)
    .where(
      and(
        eq(passengers.id, args.passengerId),
        eq(passengers.bookingId, args.bookingId)
      )
    )
    .limit(1);
  const [segment] = await tx
    .select()
    .from(bookingSegments)
    .where(
      and(
        eq(bookingSegments.id, args.segmentId),
        eq(bookingSegments.bookingId, args.bookingId)
      )
    )
    .limit(1);
  if (!booking || !passenger || !segment)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Baggage entitlement scope is not part of this booking",
    });

  const cabinWeight =
    CABIN_ALLOWANCE_GRAMS[booking.cabinClass] ?? CABIN_ALLOWANCE_GRAMS.economy;
  const sources: BaggageEntitlement["sources"] = [
    {
      type: "cabin",
      weightGrams: cabinWeight,
      referenceId: `booking:${booking.id}:cabin`,
      label: `${booking.cabinClass} cabin allowance`,
    },
  ];
  const warnings: BaggageEntitlementWarning[] = [];
  const items = await tx
    .select()
    .from(bookingAncillaries)
    .where(
      and(
        eq(bookingAncillaries.bookingId, args.bookingId),
        eq(bookingAncillaries.status, "active")
      )
    );

  for (const ancillary of items) {
    const [service] = await tx
      .select()
      .from(ancillaryServices)
      .where(eq(ancillaryServices.id, ancillary.ancillaryServiceId))
      .limit(1);
    if (!service || service.category !== "baggage") continue;
    if (ancillary.passengerId == null) {
      warnings.push({
        code: "missing_passenger",
        ancillaryId: ancillary.id,
        message: "Baggage item has no passenger scope",
      });
      continue;
    }
    if (ancillary.passengerId !== args.passengerId) continue;
    if (ancillary.scopeState === "unresolved" || ancillary.segmentId == null) {
      warnings.push({
        code: "missing_scope",
        ancillaryId: ancillary.id,
        message: "Baggage item has no approved segment scope",
      });
      continue;
    }
    if (ancillary.scopeState === "all_segments") {
      warnings.push({
        code: "unapproved_all_segments_scope",
        ancillaryId: ancillary.id,
        message: "All-segments baggage policy awaits F30 approval",
      });
      continue;
    }
    if (ancillary.segmentId !== args.segmentId) continue;
    if (
      ancillary.weightSnapshotGrams == null ||
      ancillary.weightSnapshotGrams <= 0
    ) {
      warnings.push({
        code: "missing_weight_snapshot",
        ancillaryId: ancillary.id,
        message: "Baggage item has no structured purchase weight snapshot",
      });
      continue;
    }
    if (!ancillary.fundedAt || !ancillary.fundingReference) {
      warnings.push({
        code: "missing_funding",
        ancillaryId: ancillary.id,
        message: "Baggage item has no completed funding evidence",
      });
      continue;
    }
    let metadata: Record<string, unknown> = {};
    try {
      metadata = ancillary.metadata ? JSON.parse(ancillary.metadata) : {};
    } catch {
      metadata = {};
    }
    const storedModification =
      typeof metadata.modificationId === "number"
        ? metadata.modificationId
        : typeof metadata.preferences === "object" &&
            metadata.preferences !== null &&
            typeof (metadata.preferences as Record<string, unknown>)
              .modificationId === "number"
          ? ((metadata.preferences as Record<string, unknown>)
              .modificationId as number)
          : null;
    if (
      (ancillary.fundingReference.kind !== "collected_booking" &&
        storedModification !== ancillary.fundingReference.modificationId) ||
      !(await hasValidFundingEvidence(
        tx,
        args.bookingId,
        ancillary.fundingReference
      ))
    ) {
      warnings.push({
        code: "invalid_funding_evidence",
        ancillaryId: ancillary.id,
        message: "Baggage funding evidence does not match financial authority",
      });
      continue;
    }
    sources.push({
      type: "ancillary",
      weightGrams: ancillary.weightSnapshotGrams,
      referenceId: `booking-ancillary:${ancillary.id}`,
      label: service.name,
    });
  }

  return {
    bookingId: args.bookingId,
    passengerId: args.passengerId,
    segmentId: args.segmentId,
    totalWeightGrams: sources.reduce(
      (total, source) => total + source.weightGrams,
      0
    ),
    maxBagWeightGrams: MAX_BAG_WEIGHT_GRAMS,
    sources,
    warnings,
    requiresOperationalReview: warnings.length > 0,
  };
}

export function baggageEntitlementSnapshot(entitlement: BaggageEntitlement) {
  return {
    totalWeightGrams: entitlement.totalWeightGrams,
    maxBagWeightGrams: entitlement.maxBagWeightGrams,
    sourceReferences: entitlement.sources.map(source => source.referenceId),
  };
}
