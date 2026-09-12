import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type Stripe from "stripe";
import { bookings, paymentReceipts, paymentSplits } from "../../drizzle/schema";
import { getDb } from "../db";
import { stripe } from "../stripe";
import { assertNoActiveCheckout } from "./booking-checkout.service";
import {
  assertNoCollectionReview,
  type SettlementTx,
} from "./booking-settlement.service";
import { assertTenantOperational } from "./tenant.service";
import { calculateRequestHash } from "./idempotency-v2.service";
import { recordEvent } from "./outbox.service";

type Split = typeof paymentSplits.$inferSelect;
type Booking = typeof bookings.$inferSelect;
export type SplitActor = { id: number; role: string };
export type SplitCheckoutClaim = {
  splitId: number;
  bookingId: number;
  requestId: string;
  requestPayload: string;
  requestedAt: Date;
  sessionId: string | null;
};
const unavailable = (message: string) =>
  new TRPCError({ code: "PRECONDITION_FAILED", message });
const notFound = () =>
  new TRPCError({ code: "NOT_FOUND", message: "Payment split not found" });
const payable = (split: Split) =>
  ["pending", "email_sent", "failed"].includes(split.status);
const options = { timeout: 15000, maxNetworkRetries: 0 };

async function lockBooking(tx: SettlementTx, bookingId: number) {
  const [booking] = await tx
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .for("update");
  if (!booking) throw notFound();
  return booking;
}
async function lockSplits(tx: SettlementTx, bookingId: number) {
  return await tx
    .select()
    .from(paymentSplits)
    .where(eq(paymentSplits.bookingId, bookingId))
    .orderBy(paymentSplits.id)
    .for("update");
}
function assertOwner(booking: Booking, actor: SplitActor) {
  if (!actor || (actor.role !== "admin" && actor.id !== booking.userId))
    throw notFound();
}
function claimFor(split: Split): SplitCheckoutClaim {
  if (
    !split.checkoutRequestId ||
    !split.checkoutRequestPayload ||
    !split.checkoutRequestedAt
  )
    throw unavailable(
      "Legacy or incomplete checkout requires provider reconciliation"
    );
  return {
    splitId: split.id,
    bookingId: split.bookingId,
    requestId: split.checkoutRequestId,
    requestPayload: split.checkoutRequestPayload,
    requestedAt: split.checkoutRequestedAt,
    sessionId: split.stripeCheckoutSessionId,
  };
}
function invoiceHash(booking: Booking, split: Split) {
  return calculateRequestHash({
    bookingId: booking.id,
    userId: booking.userId,
    tenantId: booking.tenantId,
    totalAmount: booking.totalAmount,
    flightId: booking.flightId,
    cabinClass: booking.cabinClass,
    numberOfPassengers: booking.numberOfPassengers,
    splitId: split.id,
    amount: split.amount,
    payerEmail: split.payerEmail,
    paymentToken: split.paymentToken,
  });
}
function requestFor(booking: Booking, split: Split, requestId: string) {
  const base = new URL(process.env.FRONTEND_URL || "http://localhost:3000");
  if (
    !["https:", "http:"].includes(base.protocol) ||
    base.username ||
    base.password
  )
    throw unavailable("Invalid application URL");
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = Math.min(
    now + 86400,
    split.expiresAt ? Math.floor(split.expiresAt.getTime() / 1000) : Infinity
  );
  // Stripe requires at least 30 minutes; keep a minute for the API request.
  if (expiresAt < now + 1860)
    throw unavailable("Payment link is too close to expiry for a new checkout");
  const metadata = {
    type: "split_payment",
    bookingId: String(booking.id),
    userId: String(booking.userId),
    splitId: String(split.id),
    checkoutRequestId: requestId,
    invoiceHash: invoiceHash(booking, split),
  };
  return {
    mode: "payment",
    payment_method_types: ["card"],
    allow_promotion_codes: false,
    expires_at: expiresAt,
    line_items: [
      {
        price_data: {
          currency: "sar",
          unit_amount: split.amount,
          product_data: {
            name: `Split Payment - Booking ${booking.bookingReference}`,
          },
        },
        quantity: 1,
      },
    ],
    customer_email: split.payerEmail,
    success_url: new URL(
      `/pay/${split.paymentToken}/success?session_id={CHECKOUT_SESSION_ID}`,
      base
    ).href.replace("%7BCHECKOUT_SESSION_ID%7D", "{CHECKOUT_SESSION_ID}"),
    cancel_url: new URL(`/pay/${split.paymentToken}?cancelled=true`, base).href,
    metadata,
    payment_intent_data: { metadata },
  } satisfies Stripe.Checkout.SessionCreateParams;
}

/** The public bearer token selects a split; the owner/amount come from locked rows. */
export async function reserveSplitCheckout(
  paymentToken: string
): Promise<SplitCheckoutClaim> {
  const db = getDb();
  if (!db) throw unavailable("Database unavailable");
  if (!/^[a-f0-9]{64}$/i.test(paymentToken)) throw notFound();
  const [hint] = await db
    .select()
    .from(paymentSplits)
    .where(eq(paymentSplits.paymentToken, paymentToken))
    .limit(1);
  if (!hint) throw notFound();
  return db.transaction(async tx => {
    const booking = await lockBooking(tx, hint.bookingId);
    if (
      booking.status !== "pending" ||
      booking.paymentStatus !== "pending" ||
      booking.seatsReserved
    )
      throw unavailable("Booking is not an unpaid pending invoice");
    await assertTenantOperational(tx, booking.tenantId);
    await assertNoCollectionReview(tx, booking.id);
    await assertNoActiveCheckout(tx, booking);
    const splits = await lockSplits(tx, booking.id);
    const split = splits.find(
      s => s.id === hint.id && s.paymentToken === paymentToken
    );
    if (!split) throw notFound();
    if (
      !payable(split) ||
      split.stripePaymentIntentId ||
      (split.expiresAt && split.expiresAt.getTime() <= Date.now())
    )
      throw unavailable("Payment request is no longer payable");
    const active = splits.filter(s => payable(s) || s.status === "paid");
    if (
      active.length < 2 ||
      active.some(s => !Number.isSafeInteger(s.amount) || s.amount < 100) ||
      active.reduce((sum, s) => sum + s.amount, 0) !== booking.totalAmount
    )
      throw unavailable("Split plan no longer matches the booking invoice");
    const collections = await tx
      .select()
      .from(paymentReceipts)
      .where(eq(paymentReceipts.bookingId, booking.id));
    if (
      collections.some(
        r => r.refundedAmount > 0 && r.settlementStatus !== "review_refunded"
      )
    )
      throw unavailable(
        "Refunded split funding requires reconciliation before further collection"
      );
    if (split.checkoutRequestId && split.checkoutStatus !== "expired") {
      const claim = claimFor(split);
      if (
        JSON.parse(claim.requestPayload).metadata?.invoiceHash !==
        invoiceHash(booking, split)
      )
        throw unavailable(
          "Frozen split invoice differs from booking; reconciliation required"
        );
      return claim;
    }
    if (split.stripeCheckoutSessionId && split.checkoutStatus !== "expired")
      throw unavailable("Legacy checkout requires provider reconciliation");
    const requestId = randomUUID();
    const values = {
      checkoutRequestId: requestId,
      checkoutRequestPayload: JSON.stringify(
        requestFor(booking, split, requestId)
      ),
      checkoutRequestedAt: new Date(),
      checkoutStatus: "creating" as const,
      stripeCheckoutSessionId: null,
    };
    await tx
      .update(paymentSplits)
      .set(values)
      .where(eq(paymentSplits.id, split.id));
    await recordEvent(tx, {
      aggregateType: "booking",
      aggregateId: booking.id,
      tenantId: booking.tenantId,
      eventType: "booking.split_checkout_requested",
      payload: { bookingId: booking.id, splitId: split.id, requestId },
    });
    return claimFor({ ...split, ...values });
  });
}

function verifySession(
  claim: SplitCheckoutClaim,
  session: Stripe.Checkout.Session
) {
  const request = JSON.parse(
    claim.requestPayload
  ) as Stripe.Checkout.SessionCreateParams;
  if (
    !session.id.startsWith("cs_") ||
    (claim.sessionId && session.id !== claim.sessionId) ||
    session.mode !== "payment" ||
    session.currency !== "sar" ||
    session.amount_total !== request.line_items?.[0].price_data?.unit_amount ||
    !request.metadata ||
    !Object.entries(request.metadata).every(
      ([key, value]) => session.metadata?.[key] === value
    )
  )
    throw unavailable("Provider split checkout identity or invoice mismatch");
}
async function resolveSession(claim: SplitCheckoutClaim) {
  let session: Stripe.Checkout.Session;
  if (claim.sessionId)
    session = await stripe.checkout.sessions.retrieve(
      claim.sessionId,
      {},
      options
    );
  else {
    const age = Date.now() - new Date(claim.requestedAt).getTime();
    if (!Number.isFinite(age) || age < 0 || age >= 23 * 3600_000)
      throw unavailable(
        "Unresolved split checkout exceeded safe retry window; reconciliation required"
      );
    session = await stripe.checkout.sessions.create(
      JSON.parse(claim.requestPayload),
      {
        ...options,
        idempotencyKey: `split-checkout:${claim.requestId}`,
      }
    );
  }
  verifySession(claim, session);
  return session;
}
function sameClaim(split: Split, claim: SplitCheckoutClaim) {
  if (
    split.checkoutRequestId !== claim.requestId ||
    split.checkoutRequestPayload !== claim.requestPayload ||
    (split.stripeCheckoutSessionId &&
      claim.sessionId &&
      split.stripeCheckoutSessionId !== claim.sessionId)
  )
    throw unavailable("Split checkout changed before provider acknowledgement");
}

export async function createSplitCheckout(paymentToken: string) {
  const claim = await reserveSplitCheckout(paymentToken);
  const session = await resolveSession(claim);
  const expired =
    session.status === "expired" && session.payment_status === "unpaid";
  const db = getDb();
  if (!db) throw unavailable("Database unavailable");
  await db.transaction(async tx => {
    const booking = await lockBooking(tx, claim.bookingId);
    await assertTenantOperational(tx, booking.tenantId);
    await assertNoCollectionReview(tx, booking.id);
    const split = (await lockSplits(tx, booking.id)).find(
      s => s.id === claim.splitId
    );
    if (
      !split ||
      !payable(split) ||
      split.stripePaymentIntentId ||
      (split.expiresAt && split.expiresAt.getTime() <= Date.now()) ||
      booking.status !== "pending" ||
      booking.paymentStatus !== "pending"
    )
      throw unavailable("Split is no longer awaiting checkout");
    sameClaim(split, { ...claim, sessionId: session.id });
    if (
      split.checkoutStatus === "expired" ||
      JSON.parse(claim.requestPayload).metadata.invoiceHash !==
        invoiceHash(booking, split)
    )
      throw unavailable(
        "Split invoice or checkout changed before acknowledgement"
      );
    await tx
      .update(paymentSplits)
      .set({
        stripeCheckoutSessionId: session.id,
        checkoutStatus: expired ? "expired" : "ready",
      })
      .where(eq(paymentSplits.id, split.id));
  });
  if (expired)
    throw unavailable(
      "Previous checkout expired; retry to create a new session"
    );
  if (
    session.status !== "open" ||
    session.payment_status !== "unpaid" ||
    !session.url
  )
    throw unavailable("Split checkout is awaiting verified payment settlement");
  return { sessionId: session.id, url: session.url };
}

/** Expire provider sessions outside the transaction, then recheck every identity under owner locks. */
export async function cancelPaymentSplits(
  target: { bookingId: number; splitId?: number },
  actor: SplitActor
) {
  const db = getDb();
  if (!db) throw unavailable("Database unavailable");
  async function snapshot(tx: SettlementTx) {
    const booking = await lockBooking(tx, target.bookingId);
    assertOwner(booking, actor);
    await assertNoCollectionReview(tx, booking.id);
    const all = await lockSplits(tx, booking.id);
    if (all.some(s => s.status === "paid" || s.stripePaymentIntentId))
      throw unavailable(
        "Collected split payments require reconciliation before cancellation"
      );
    const receipts = await tx
      .select()
      .from(paymentReceipts)
      .where(
        and(
          eq(paymentReceipts.bookingId, booking.id),
          eq(paymentReceipts.kind, "split_payment")
        )
      );
    if (receipts.some(r => r.amount > r.refundedAmount))
      throw unavailable("Unreturned split collections prevent cancellation");
    const selected =
      target.splitId === undefined
        ? all
        : all.filter(s => s.id === target.splitId);
    if (target.splitId !== undefined && !selected.length) throw notFound();
    return { booking, selected };
  }
  const initial = await db.transaction(snapshot);
  const expired = new Map<number, Stripe.Checkout.Session>();
  for (const split of initial.selected) {
    if (!split.checkoutRequestId && !split.stripeCheckoutSessionId) continue;
    const claim = claimFor(split);
    let session = await resolveSession(claim);
    // Never expire a session before verifying it belongs to the exact saved request.
    if (session.status === "open" && session.payment_status === "unpaid") {
      const sessionId = session.id;
      session = await stripe.checkout.sessions.expire(
        sessionId,
        {},
        {
          ...options,
          idempotencyKey: `expire-split-checkout:${claim.requestId}`,
        }
      );
      verifySession({ ...claim, sessionId }, session);
    }
    if (session.status !== "expired" || session.payment_status !== "unpaid")
      throw unavailable(
        "Provider has not confirmed an unpaid expired split checkout"
      );
    expired.set(split.id, session);
  }
  await db.transaction(async tx => {
    const current = await snapshot(tx);
    if (current.selected.length !== initial.selected.length)
      throw unavailable("Split plan changed during cancellation");
    for (const split of current.selected) {
      const original = initial.selected.find(s => s.id === split.id);
      if (
        !original ||
        split.checkoutRequestId !== original.checkoutRequestId ||
        split.checkoutRequestPayload !== original.checkoutRequestPayload
      )
        throw unavailable("Split checkout changed during cancellation; retry");
      const session = expired.get(split.id);
      if (
        split.stripeCheckoutSessionId &&
        split.stripeCheckoutSessionId !==
          (session?.id ?? original.stripeCheckoutSessionId)
      )
        throw unavailable("Split session changed during cancellation");
      if (
        split.status === "cancelled" &&
        (!session || split.checkoutStatus === "expired")
      )
        continue;
      await tx
        .update(paymentSplits)
        .set({
          status: "cancelled",
          ...(session
            ? {
                checkoutStatus: "expired" as const,
                stripeCheckoutSessionId: session.id,
              }
            : {}),
        })
        .where(eq(paymentSplits.id, split.id));
      await recordEvent(tx, {
        aggregateType: "booking",
        aggregateId: current.booking.id,
        tenantId: current.booking.tenantId,
        eventType: "booking.split_payment_cancelled",
        payload: { bookingId: current.booking.id, splitId: split.id },
      });
    }
  });
}
