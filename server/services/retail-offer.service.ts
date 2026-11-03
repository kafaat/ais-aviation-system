import {
  premiumAdjustment,
  recordPremiumConversion,
} from "./premium-experiment.service";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb, getFlightById } from "../db";
import { fareClasses, flights, retailOffers } from "../../drizzle/schema";
import { resolveFlightFareClass } from "./rbd-inventory.service";
import { saleFareRuleDigest } from "./sale-fare-rules";
import { calculateFlightPrice } from "./flights.service";
import { recordEvent } from "./outbox.service";
import type { SettlementTx } from "./booking-settlement.service";
const passengerType = z.enum(["adult", "child", "infant"]);
export const offerFareLineSchema = z.object({
  type: passengerType,
  baseFare: z.number().int().nonnegative(),
  tax: z.number().int().nonnegative(),
  bookingFee: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
const revalidationTerms = z.object({
  code: z.string(),
  family: z.string().nullable(),
  changeable: z.boolean(),
  changeFee: z.number().int().nonnegative().nullable(),
});
export async function readRevalidationTerms(
  tx: SettlementTx,
  fareClassId: number
) {
  const [row] = await tx
    .select({
      code: fareClasses.code,
      family: fareClasses.fareFamily,
      changeable: fareClasses.changeable,
      changeFee: fareClasses.changeFee,
      active: fareClasses.active,
    })
    .from(fareClasses)
    .where(eq(fareClasses.id, fareClassId))
    .limit(1);
  return row?.active ? revalidationTerms.parse(row) : undefined;
}
export const retailOfferPayloadSchema = z.object({
  experiment: z
    .object({
      policyId: z.string().uuid(),
      assignmentId: z.string().uuid(),
      variant: z.enum(["control", "treatment"]),
      protectedSeats: z.number().int().nonnegative(),
    })
    .optional(),
  version: z.literal(1),
  currency: z.literal("SAR"),
  amountUnit: z.literal("minor"),
  scope: z.literal("airfare"),
  fareClassId: z.number().int().positive().optional(),
  revalidationTerms: revalidationTerms.optional(),
  fareRuleDigest: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  fareLines: z.array(offerFareLineSchema).min(1).max(100).optional(),
  passengerTypes: z.array(passengerType).min(1).max(100),
  policy: z.object({
    name: z.string(),
    fareMultiplier: z.number().finite().positive(),
    taxRate: z.number().finite().min(0).max(1),
  }),
  baseAmount: z.number().int().nonnegative(),
  taxesAndFees: z.number().int().nonnegative(),
  totalAmount: z.number().int().nonnegative(),
});
export type OfferPayload = z.infer<typeof retailOfferPayloadSchema>;
export type RetailOffer = typeof retailOffers.$inferSelect;
export function offerDigest(payload: Record<string, unknown>) {
  return createHash("sha256")
    .update(JSON.stringify(retailOfferPayloadSchema.parse(payload)))
    .digest("hex");
}
/** Channel differences are explicit policies over the same dynamic fare authority. */
/** Statutory VAT applied by the NDC channel when a fare class declares no
 * rate of its own. Shared with the NDC service so both channels agree. */
export const DEFAULT_TAX_RATE = 0.15;

export function composeOfferPolicy(
  baseAmount: number,
  policy: OfferPayload["policy"]
) {
  if (
    !Number.isSafeInteger(baseAmount) ||
    baseAmount < 0 ||
    !Number.isFinite(policy.fareMultiplier) ||
    policy.fareMultiplier <= 0 ||
    !Number.isFinite(policy.taxRate) ||
    policy.taxRate < 0 ||
    policy.taxRate > 1
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Invalid offer price policy",
    });
  const base = Math.round(baseAmount * policy.fareMultiplier);
  const taxesAndFees = Math.round(base * policy.taxRate);
  const totalAmount = base + taxesAndFees;
  if (!Number.isSafeInteger(totalAmount) || totalAmount > 2147483647)
    throw new Error("Offer exceeds monetary storage range");
  return { baseAmount: base, taxesAndFees, totalAmount };
}
export function priceOfferLines(
  price: { price: number; fareLines?: z.infer<typeof offerFareLineSchema>[] },
  policy: OfferPayload["policy"],
  channel: "direct" | "ndc"
) {
  const fareLines = price.fareLines?.map(line => {
    if (channel === "direct" && policy.fareMultiplier === 1) return line;
    // Apply the channel's price and tax policy to the fare before tax.
    const adjusted = composeOfferPolicy(line.baseFare, policy);
    return {
      ...line,
      baseFare: adjusted.baseAmount,
      tax: adjusted.taxesAndFees,
      total: adjusted.totalAmount + line.bookingFee,
    };
  });
  const amounts = fareLines
    ? {
        fareLines,
        baseAmount: fareLines.reduce((sum, line) => sum + line.baseFare, 0),
        taxesAndFees: fareLines.reduce(
          (sum, line) => sum + line.tax + line.bookingFee,
          0
        ),
        totalAmount: fareLines.reduce((sum, line) => sum + line.total, 0),
      }
    : composeOfferPolicy(price.price, policy);
  if (
    !Number.isSafeInteger(amounts.totalAmount) ||
    amounts.totalAmount > 2147483647
  )
    throw new Error("Offer exceeds monetary storage range");
  return amounts;
}

export async function createRetailOffer(
  input: {
    flightId: number;
    cabinClass: "economy" | "business";
    passengerTypes: Array<z.infer<typeof passengerType>>;
    userId?: number;
    sessionId?: string;
    channel: "direct" | "ndc";
    ndcPolicy?: {
      fareMultiplier: number;
      taxRate: number;
      fareClassId?: number;
    };
    fareClassCode?: string;
    fareClass?: {
      fareClassId: number;
      fareMultiplier: number;
    };
    expiresAt?: Date;
  },
  transaction?: SettlementTx
): Promise<RetailOffer> {
  const types = z
    .array(passengerType)
    .min(1)
    .max(100)
    .parse(input.passengerTypes);
  const flight = await getFlightById(input.flightId);
  if (
    !flight ||
    !["scheduled", "delayed"].includes(flight.status) ||
    flight.departureTime <= new Date()
  )
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Flight is not available for an offer",
    });
  const db = transaction ?? (await getDb());
  if (!db) throw new Error("Offer storage unavailable");
  let fareClass = input.fareClass;
  if (input.fareClassCode) {
    const selected = await resolveFlightFareClass(
      db,
      flight.id,
      flight.airline.id,
      input.cabinClass,
      input.fareClassCode
    );
    if (!selected)
      throw new TRPCError({
        code: "CONFLICT",
        message: "Requested booking class is unavailable",
      });
    fareClass = {
      fareClassId: selected.fareClass.id,
      fareMultiplier: Number(selected.fareClass.basePriceMultiplier),
    };
  }
  const fareRuleDigest = fareClass
    ? await saleFareRuleDigest(
        db,
        {
          ...flight,
          originId: flight.origin.id,
          destinationId: flight.destination.id,
        },
        fareClass.fareClassId,
        types,
        1
      )
    : undefined;
  const price = await calculateFlightPrice(
    flight,
    input.cabinClass,
    types.length,
    types.map(type => ({ type })),
    input.userId,
    input.sessionId
  );
  const policy =
    input.channel === "ndc"
      ? {
          name: `ndc:${input.ndcPolicy?.fareClassId ?? "default"}:v1`,
          fareMultiplier: input.ndcPolicy?.fareMultiplier ?? 1,
          taxRate: input.ndcPolicy?.taxRate ?? DEFAULT_TAX_RATE,
        }
      : fareClass
        ? {
            name: `direct:rbd:${fareClass.fareClassId}:v1`,
            fareMultiplier: fareClass.fareMultiplier,
            taxRate: price.fareLines ? DEFAULT_TAX_RATE : 0,
          }
        : { name: "direct:v1", fareMultiplier: 1, taxRate: 0 };
  const amounts = priceOfferLines(price, policy, input.channel);
  const ticketTerms =
    fareClass && input.channel === "direct"
      ? await readRevalidationTerms(db, fareClass.fareClassId)
      : undefined;
  const payload: OfferPayload = {
    version: 1,
    currency: "SAR",
    amountUnit: "minor",
    scope: "airfare",
    ...(fareClass ? { fareClassId: fareClass.fareClassId } : {}),
    ...(ticketTerms ? { revalidationTerms: ticketTerms } : {}),
    ...(fareRuleDigest ? { fareRuleDigest } : {}),
    passengerTypes: types,
    policy,
    ...amounts,
  };
  const now = new Date();
  const expiresAt = new Date(
    Math.min(
      now.getTime() + 5 * 60000,
      input.expiresAt?.getTime() ?? Infinity,
      flight.departureTime.getTime()
    )
  );
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now)
    throw new Error("Invalid offer expiry");
  const offer: RetailOffer = {
    id: randomUUID(),
    flightId: flight.id,
    tenantId: flight.tenantId,
    userId: input.userId ?? null,
    channel: input.channel,
    cabinClass: input.cabinClass,
    payload,
    digest: offerDigest(payload),
    totalAmount: payload.totalAmount,
    expiresAt,
    consumedBookingId: null,
    createdAt: now,
  };
  const persist = async (tx: SettlementTx) => {
    if (
      input.channel === "direct" &&
      input.cabinClass === "business" &&
      input.userId
    ) {
      const adjustment = await premiumAdjustment(
        tx,
        flight.id,
        input.userId,
        types.length,
        offer.totalAmount
      );
      if (adjustment) {
        offer.payload = {
          ...payload,
          fareLines: undefined,
          experiment: adjustment.experiment,
          policy: {
            ...policy,
            name: `premium:${adjustment.experiment.policyId}:${adjustment.experiment.variant}`,
            fareMultiplier: offer.totalAmount
              ? adjustment.totalAmount / offer.totalAmount
              : 1,
          },
          baseAmount: adjustment.totalAmount,
          taxesAndFees: 0,
          totalAmount: adjustment.totalAmount,
        };
        offer.totalAmount = adjustment.totalAmount;
        offer.expiresAt = new Date(
          Math.min(offer.expiresAt.getTime(), adjustment.expiresAt.getTime())
        );
        offer.digest = offerDigest(offer.payload);
      }
    }
    await tx.insert(retailOffers).values(offer);
    return offer;
  };
  return transaction ? persist(transaction) : db.transaction(persist);
}
export function validateRetailOffer(
  offer: RetailOffer,
  input: {
    flightId: number;
    tenantId?: number | null;
    userId: number;
    channel: "direct" | "ndc";
    cabinClass: string;
    passengerTypes: string[];
    fareClassId?: number;
    ruleSegmentCount?: number;
  },
  now = new Date()
) {
  const payload = retailOfferPayloadSchema.parse(offer.payload);
  if (
    offer.flightId !== input.flightId ||
    offer.cabinClass !== input.cabinClass ||
    offer.channel !== input.channel ||
    (input.tenantId != null && offer.tenantId !== input.tenantId) ||
    (offer.userId !== null && offer.userId !== input.userId) ||
    (input.channel === "direct" && offer.userId === null)
  )
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Offer does not belong to this booking",
    });
  const lines = payload.fareLines;
  if (
    payload.fareClassId !== input.fareClassId ||
    (lines &&
      (lines.length !== payload.passengerTypes.length ||
        lines.some(
          (line, i) =>
            line.type !== payload.passengerTypes[i] ||
            line.baseFare + line.tax + line.bookingFee !== line.total
        ) ||
        lines.reduce((sum, line) => sum + line.baseFare, 0) !==
          payload.baseAmount ||
        lines.reduce((sum, line) => sum + line.total, 0) !==
          payload.totalAmount)) ||
    offer.consumedBookingId !== null ||
    offer.expiresAt <= now ||
    offer.digest !== offerDigest(offer.payload) ||
    (offer.channel === "ndc"
      ? payload.passengerTypes.length !== input.passengerTypes.length
      : JSON.stringify([...payload.passengerTypes].sort()) !==
        JSON.stringify([...input.passengerTypes].sort())) ||
    payload.baseAmount + payload.taxesAndFees !== offer.totalAmount ||
    payload.totalAmount !== offer.totalAmount
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Offer expired, consumed or changed; request a new offer",
    });
  return payload;
}
/** Call after acquiring the flight lock, before creating inventory or an invoice. */
export async function lockRetailOffer(
  tx: SettlementTx,
  offerId: string,
  input: Parameters<typeof validateRetailOffer>[1]
) {
  const [offer] = await tx
    .select()
    .from(retailOffers)
    .where(eq(retailOffers.id, offerId))
    .for("update");
  if (!offer)
    throw new TRPCError({ code: "NOT_FOUND", message: "Offer not found" });
  const payload = validateRetailOffer(offer, input);
  if (input.fareClassId !== undefined) {
    const [flight] = await tx
      .select()
      .from(flights)
      .where(eq(flights.id, input.flightId))
      .limit(1);
    if (!flight)
      throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
    const digest = await saleFareRuleDigest(
      tx,
      flight,
      input.fareClassId,
      input.passengerTypes,
      input.ruleSegmentCount ?? 1
    );
    if (digest !== payload.fareRuleDigest)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Fare conditions changed; request a new offer",
      });
  }
  return offer;
}
export async function consumeRetailOffer(
  tx: SettlementTx,
  offer: RetailOffer,
  bookingId: number
) {
  await recordPremiumConversion(tx, offer, bookingId);
  await tx
    .update(retailOffers)
    .set({ consumedBookingId: bookingId })
    .where(eq(retailOffers.id, offer.id));
  await recordEvent(tx, {
    aggregateType: "offer",
    aggregateId: offer.id,
    tenantId: offer.tenantId,
    eventType: "retail.offer_consumed",
    payload: {
      bookingId,
      digest: offer.digest,
      channel: offer.channel,
      totalAmount: offer.totalAmount,
    },
  });
}
