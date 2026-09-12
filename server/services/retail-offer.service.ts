import {
  premiumAdjustment,
  recordPremiumConversion,
} from "./premium-experiment.service";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb, getFlightById } from "../db";
import { retailOffers } from "../../drizzle/schema";
import { calculateFlightPrice } from "./flights.service";
import { recordEvent } from "./outbox.service";
import type { SettlementTx } from "./booking-settlement.service";

const passengerType = z.enum(["adult", "child", "infant"]);
const payloadSchema = z.object({
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
type OfferPayload = z.infer<typeof payloadSchema>;
export type RetailOffer = typeof retailOffers.$inferSelect;
export function offerDigest(payload: Record<string, unknown>) {
  return createHash("sha256")
    .update(JSON.stringify(payloadSchema.parse(payload)))
    .digest("hex");
}
/** Channel differences are explicit policies over the same dynamic fare authority. */
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
          taxRate: input.ndcPolicy?.taxRate ?? 0,
        }
      : { name: "direct:v1", fareMultiplier: 1, taxRate: 0 };
  const payload: OfferPayload = {
    version: 1,
    currency: "SAR",
    amountUnit: "minor",
    scope: "airfare",
    passengerTypes: types,
    policy,
    ...composeOfferPolicy(price.price, policy),
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
  const db = await getDb();
  if (!db && !transaction) throw new Error("Offer storage unavailable");
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
  return transaction ? persist(transaction) : db!.transaction(persist);
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
  },
  now = new Date()
) {
  const payload = payloadSchema.parse(offer.payload);
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
  if (
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
  validateRetailOffer(offer, input);
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
