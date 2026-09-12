import { randomUUID } from "node:crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { stripe } from "../stripe";
import {
  bookings,
  bookingModifications,
  flights,
  inventoryLocks,
} from "../../drizzle/schema";
import { planSchema } from "./order-servicing.service";
import { assertNoCollectionReview } from "./booking-settlement.service";
import { releaseInventoryLock } from "./inventory-lock.service";
import { recordEvent } from "./outbox.service";
const requestSchema = z.object({
  amount: z.number().int().positive(),
  bookingId: z.number().int().positive(),
  userId: z.number().int().positive(),
  expiresAt: z.number().int(),
  baseUrl: z.string().url(),
  requestedAt: z.iso.datetime(),
});
export async function createOrderServiceCheckout(
  modificationId: number,
  userId: number,
  baseUrl: string
) {
  const db = await getDb();
  if (!db) throw new Error("Checkout storage unavailable");
  const [hint] = await db
    .select()
    .from(bookingModifications)
    .where(eq(bookingModifications.id, modificationId))
    .limit(1);
  if (!hint || hint.userId !== userId)
    throw new Error("Owned modification not found");
  const claim = await db.transaction(async tx => {
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
      !change ||
      change.userId !== userId ||
      booking.status !== "confirmed" ||
      change.status !== "pending" ||
      change.totalCost <= 0
    )
      throw new Error("Modification is not payable");
    await assertNoCollectionReview(tx, booking.id);
    if (change.checkoutRequestId) {
      const request = requestSchema.parse(change.checkoutData);
      if (
        request.amount !== change.totalCost ||
        request.userId !== userId ||
        request.bookingId !== booking.id
      )
        throw new Error("Checkout request changed");
      return {
        request,
        requestId: change.checkoutRequestId,
        sessionId: change.checkoutSessionId,
        url: change.checkoutUrl,
      };
    }
    const plan = planSchema.parse(change.servicingPayload);
    if (Date.parse(plan.expiresAt) <= Date.now())
      throw new Error("Servicing quote expired");
    const base = new URL(baseUrl);
    if (
      !["http:", "https:"].includes(base.protocol) ||
      base.username ||
      base.password
    )
      throw new Error("Invalid application URL");
    const request = requestSchema.parse({
      amount: change.totalCost,
      bookingId: booking.id,
      userId,
      expiresAt: Math.floor(Date.now() / 1000) + 31 * 60,
      baseUrl: base.origin,
      requestedAt: new Date().toISOString(),
    });
    for (const leg of [...plan.segments].sort(
      (a, b) => a.flightId - b.flightId
    )) {
      if (!leg.holdId) continue;
      await tx
        .select()
        .from(flights)
        .where(eq(flights.id, leg.flightId))
        .for("update");
      const [hold] = await tx
        .select()
        .from(inventoryLocks)
        .where(eq(inventoryLocks.id, leg.holdId))
        .for("update");
      if (
        !hold ||
        hold.status !== "active" ||
        hold.expiresAt <= new Date() ||
        hold.userId !== userId
      )
        throw new Error("Replacement capacity hold expired");
      await tx
        .update(inventoryLocks)
        .set({ expiresAt: new Date((request.expiresAt + 60) * 1000) })
        .where(eq(inventoryLocks.id, hold.id));
    }
    plan.expiresAt = new Date((request.expiresAt + 60) * 1000).toISOString();
    const requestId = randomUUID();
    await tx
      .update(bookingModifications)
      .set({
        checkoutRequestId: requestId,
        checkoutData: request,
        servicingPayload: plan,
      })
      .where(eq(bookingModifications.id, modificationId));
    return { request, requestId, sessionId: null, url: null };
  });
  if (claim.sessionId && claim.url)
    return { provider: "stripe", sessionId: claim.sessionId, url: claim.url };
  if (Date.now() - Date.parse(claim.request.requestedAt) > 23 * 3600000)
    throw new Error(
      "Unknown checkout outcome requires provider reconciliation"
    );
  const metadata = {
    type: "modification",
    bookingId: String(claim.request.bookingId),
    modificationId: String(modificationId),
    userId: String(userId),
    checkoutRequestId: claim.requestId,
  };
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "sar",
            unit_amount: claim.request.amount,
            product_data: { name: `Order service #${modificationId}` },
          },
          quantity: 1,
        },
      ],
      metadata,
      payment_intent_data: { metadata },
      expires_at: claim.request.expiresAt,
      success_url: `${claim.request.baseUrl}/my-bookings?modification=success`,
      cancel_url: `${claim.request.baseUrl}/my-bookings?modification=cancelled`,
    },
    { idempotencyKey: `order-checkout:${claim.requestId}` }
  );
  if (!session.url) throw new Error("Provider checkout URL unavailable");
  await db
    .update(bookingModifications)
    .set({ checkoutSessionId: session.id, checkoutUrl: session.url })
    .where(eq(bookingModifications.id, modificationId));
  return { provider: "stripe", sessionId: session.id, url: session.url };
}
export async function cancelOrderServiceQuote(
  modificationId: number,
  userId: number
) {
  const db = await getDb();
  if (!db) throw new Error("Servicing storage unavailable");
  const [hint] = await db
    .select()
    .from(bookingModifications)
    .where(eq(bookingModifications.id, modificationId))
    .limit(1);
  if (!hint || hint.userId !== userId || !hint.servicingPayload)
    throw new Error("Owned servicing request not found");
  if (hint.checkoutRequestId && !hint.checkoutSessionId)
    throw new Error("Checkout outcome must be reconciled before cancellation");
  if (hint.checkoutSessionId) {
    const session = await stripe.checkout.sessions.retrieve(
      hint.checkoutSessionId
    );
    if (session.status === "complete")
      throw new Error("Payment must be reconciled before cancellation");
    if (session.status !== "expired")
      await stripe.checkout.sessions.expire(session.id);
  }
  return db.transaction(async tx => {
    await tx
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
      !change ||
      change.status === "completed" ||
      change.checkoutRequestId !== hint.checkoutRequestId
    )
      throw new Error("Servicing request changed");
    if (change.status === "rejected") return { cancelled: true };
    const plan = planSchema.parse(change.servicingPayload);
    for (const leg of [...plan.segments].sort(
      (a, b) => a.flightId - b.flightId
    )) {
      if (leg.holdId) {
        await tx
          .select()
          .from(flights)
          .where(eq(flights.id, leg.flightId))
          .for("update");
        await releaseInventoryLock(leg.holdId, tx);
      }
    }
    await tx
      .update(bookingModifications)
      .set({ status: "rejected" })
      .where(eq(bookingModifications.id, modificationId));
    await recordEvent(tx, {
      aggregateType: "booking",
      aggregateId: hint.bookingId,
      eventType: "order.servicing_cancelled",
      payload: { modificationId, userId },
    });
    return { cancelled: true };
  });
}
