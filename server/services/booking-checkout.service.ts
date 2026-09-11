import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type Stripe from "stripe";
import { getDb } from "../db";
import { stripe } from "../stripe";
import {
  bookings,
  bookingCheckoutRequests,
  bookingSegments,
  bookingAncillaries,
  payments,
  paymentReceipts,
  paymentSplits,
  bookingModifications,
} from "../../drizzle/schema";
import {
  assertNoCollectionReview,
  type SettlementTx,
} from "./booking-settlement.service";
import { assertTenantOperational } from "./tenant.service";
import { calculateRequestHash } from "./idempotency-v2.service";
import { recordEvent } from "./outbox.service";

type Booking = typeof bookings.$inferSelect;
type Claim = typeof bookingCheckoutRequests.$inferSelect;
export type CheckoutOwner = {
  bookingId: number;
  userId: number;
  email?: string | null;
  name?: string | null;
  appBaseUrl: string;
};
const unavailable = (message: string) =>
  new TRPCError({ code: "PRECONDITION_FAILED", message });
/** Call under the booking row lock before choosing a different payment rail. */
export async function assertNoActiveCheckout(
  tx: SettlementTx,
  booking: Booking
) {
  const [claim] = await tx
    .select()
    .from(bookingCheckoutRequests)
    .where(eq(bookingCheckoutRequests.bookingId, booking.id))
    .for("update");
  if (
    booking.stripeCheckoutSessionId ||
    booking.stripePaymentIntentId ||
    (claim && claim.status !== "expired")
  )
    throw unavailable(
      "Expire or reconcile the active checkout before another payment workflow"
    );
}
async function ownedPending(
  tx: SettlementTx,
  bookingId: number,
  userId: number
) {
  const [booking] = await tx
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .for("update");
  if (!booking || booking.userId !== userId)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Owned booking not found",
    });
  if (
    booking.status !== "pending" ||
    booking.paymentStatus !== "pending" ||
    booking.seatsReserved
  )
    throw unavailable("Booking is not an unpaid pending invoice");
  await assertTenantOperational(tx, booking.tenantId);
  await assertNoCollectionReview(tx, booking.id);
  return booking;
}
/** All invoice editors call this under the booking lock, including the initial checkout claim. */
export async function assertInvoiceEditable(
  tx: SettlementTx,
  booking: Booking
) {
  if (
    booking.status !== "pending" ||
    booking.paymentStatus !== "pending" ||
    booking.seatsReserved ||
    booking.stripePaymentIntentId ||
    booking.stripeCheckoutSessionId
  )
    throw unavailable("Invoice is already in a payment workflow");
  await assertNoActiveCheckout(tx, booking);
  for (const [table, column] of [
    [payments, payments.bookingId],
    [paymentReceipts, paymentReceipts.bookingId],
    [paymentSplits, paymentSplits.bookingId],
    [bookingModifications, bookingModifications.bookingId],
  ] as const) {
    const rows = await tx
      .select()
      .from(table)
      .where(eq(column, booking.id))
      .limit(1);
    if (rows.length)
      throw unavailable(
        "Invoice has a financial workflow requiring reconciliation"
      );
  }
}
async function invoiceHash(tx: SettlementTx, booking: Booking) {
  const segments = await tx
    .select()
    .from(bookingSegments)
    .where(eq(bookingSegments.bookingId, booking.id))
    .orderBy(bookingSegments.segmentOrder);
  const ancillaries = await tx
    .select()
    .from(bookingAncillaries)
    .where(
      and(
        eq(bookingAncillaries.bookingId, booking.id),
        eq(bookingAncillaries.status, "active")
      )
    )
    .orderBy(bookingAncillaries.id);
  return calculateRequestHash({
    bookingId: booking.id,
    userId: booking.userId,
    tenantId: booking.tenantId,
    totalAmount: booking.totalAmount,
    flightId: booking.flightId,
    cabinClass: booking.cabinClass,
    numberOfPassengers: booking.numberOfPassengers,
    segments: segments.map(s => ({
      flightId: s.flightId,
      segmentOrder: s.segmentOrder,
      amount: s.segmentAmount,
    })),
    ancillaries: ancillaries.map(a => ({
      id: a.id,
      amount: a.totalPrice,
      quantity: a.quantity,
    })),
  });
}
function requestFor(
  booking: Booking,
  owner: CheckoutOwner,
  requestId: string,
  hash: string
): Stripe.Checkout.SessionCreateParams {
  const base = new URL(owner.appBaseUrl);
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password
  )
    throw unavailable("Invalid application URL");
  if (!Number.isSafeInteger(booking.totalAmount) || booking.totalAmount <= 0)
    throw unavailable("Invalid invoice amount");
  const metadata = {
    type: "booking",
    bookingId: String(booking.id),
    userId: String(owner.userId),
    bookingReference: booking.bookingReference,
    checkoutRequestId: requestId,
    invoiceHash: hash,
  };
  return {
    payment_method_types: ["card"],
    mode: "payment",
    allow_promotion_codes: false,
    line_items: [
      {
        price_data: {
          currency: "sar",
          product_data: {
            name: `Flight Booking - ${booking.bookingReference}`,
            description: `PNR: ${booking.pnr}`,
          },
          unit_amount: booking.totalAmount,
        },
        quantity: 1,
      },
    ],
    success_url: new URL(
      "/my-bookings?session_id={CHECKOUT_SESSION_ID}&success=true",
      base
    ).href.replace("%7BCHECKOUT_SESSION_ID%7D", "{CHECKOUT_SESSION_ID}"),
    cancel_url: new URL(`/booking/${booking.id}?canceled=true`, base).href,
    customer_email: owner.email || undefined,
    client_reference_id: String(owner.userId),
    metadata,
    payment_intent_data: { metadata },
  };
}
export async function reserveBookingCheckout(
  owner: CheckoutOwner
): Promise<Claim> {
  const db = getDb();
  if (!db) throw unavailable("Database unavailable");
  return db.transaction(async tx => {
    const booking = await ownedPending(tx, owner.bookingId, owner.userId);
    const [existing] = await tx
      .select()
      .from(bookingCheckoutRequests)
      .where(eq(bookingCheckoutRequests.bookingId, booking.id))
      .for("update");
    const hash = await invoiceHash(tx, booking);
    if (existing && existing.status !== "expired") {
      if (existing.userId !== owner.userId || existing.invoiceHash !== hash)
        throw unavailable(
          "Frozen invoice differs from booking; reconciliation required"
        );
      return existing;
    }
    await assertInvoiceEditable(tx, booking);
    const requestId = randomUUID();
    const values = {
      bookingId: booking.id,
      userId: owner.userId,
      requestId,
      invoiceHash: hash,
      requestPayload: JSON.stringify(
        requestFor(booking, owner, requestId, hash)
      ),
      status: "creating" as const,
      sessionId: null,
      checkoutUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    if (existing)
      await tx
        .update(bookingCheckoutRequests)
        .set(values)
        .where(eq(bookingCheckoutRequests.bookingId, booking.id));
    else await tx.insert(bookingCheckoutRequests).values(values);
    await recordEvent(tx, {
      aggregateType: "booking",
      aggregateId: booking.id,
      tenantId: booking.tenantId,
      eventType: "booking.checkout_requested",
      payload: { bookingId: booking.id, requestId, invoiceHash: hash },
    });
    return values;
  });
}
function verifySession(claim: Claim, session: Stripe.Checkout.Session) {
  const request = JSON.parse(
    claim.requestPayload
  ) as Stripe.Checkout.SessionCreateParams;
  if (
    !session.id.startsWith("cs_") ||
    session.amount_total !== request.line_items?.[0].price_data?.unit_amount ||
    session.currency !== "sar" ||
    session.metadata?.bookingId !== String(claim.bookingId) ||
    session.metadata?.userId !== String(claim.userId) ||
    session.metadata?.checkoutRequestId !== claim.requestId ||
    session.metadata?.invoiceHash !== claim.invoiceHash
  )
    throw unavailable("Provider checkout identity or invoice mismatch");
}
async function persistSession(claim: Claim, session: Stripe.Checkout.Session) {
  const db = getDb();
  if (!db) throw unavailable("Database unavailable");
  await db.transaction(async tx => {
    const booking = await ownedPending(tx, claim.bookingId, claim.userId);
    const [current] = await tx
      .select()
      .from(bookingCheckoutRequests)
      .where(eq(bookingCheckoutRequests.bookingId, claim.bookingId))
      .for("update");
    if (
      !current ||
      current.requestId !== claim.requestId ||
      current.status === "expired" ||
      (await invoiceHash(tx, booking)) !== claim.invoiceHash
    )
      throw unavailable("Checkout changed before provider acknowledgement");
    if (current.sessionId && current.sessionId !== session.id)
      throw unavailable("Conflicting checkout session");
    await tx
      .update(bookingCheckoutRequests)
      .set({
        status: "ready",
        sessionId: session.id,
        checkoutUrl: session.url,
        updatedAt: new Date(),
      })
      .where(eq(bookingCheckoutRequests.bookingId, claim.bookingId));
    await tx
      .update(bookings)
      .set({ stripeCheckoutSessionId: session.id })
      .where(eq(bookings.id, claim.bookingId));
  });
}
async function markExpired(claim: Claim, session: Stripe.Checkout.Session) {
  verifySession(claim, session);
  if (session.status !== "expired" || session.payment_status !== "unpaid")
    throw unavailable("Provider has not confirmed an unpaid expired checkout");
  const db = getDb();
  if (!db) throw unavailable("Database unavailable");
  await db.transaction(async tx => {
    const booking = await ownedPending(tx, claim.bookingId, claim.userId);
    const [current] = await tx
      .select()
      .from(bookingCheckoutRequests)
      .where(eq(bookingCheckoutRequests.bookingId, claim.bookingId))
      .for("update");
    if (
      !current ||
      current.requestId !== claim.requestId ||
      current.sessionId !== session.id
    )
      throw unavailable("Checkout identity changed");
    if (current.status === "expired") return;
    await tx
      .update(bookingCheckoutRequests)
      .set({ status: "expired", checkoutUrl: null, updatedAt: new Date() })
      .where(eq(bookingCheckoutRequests.bookingId, claim.bookingId));
    await tx
      .update(bookings)
      .set({ stripeCheckoutSessionId: null })
      .where(eq(bookings.id, claim.bookingId));
    await recordEvent(tx, {
      aggregateType: "booking",
      aggregateId: booking.id,
      tenantId: booking.tenantId,
      eventType: "booking.checkout_expired",
      payload: {
        bookingId: booking.id,
        requestId: claim.requestId,
        sessionId: session.id,
      },
    });
  });
}
export async function createBookingCheckout(owner: CheckoutOwner) {
  const claim = await reserveBookingCheckout(owner);
  let session: Stripe.Checkout.Session;
  if (claim.sessionId)
    session = await stripe.checkout.sessions.retrieve(claim.sessionId);
  else {
    // Stripe may prune API v1 idempotency keys after 24h. An unresolved old claim
    // requires reconciliation; silently creating another session would be unsafe.
    if (Date.now() - new Date(claim.createdAt).getTime() >= 23 * 3600_000)
      throw unavailable(
        "Unresolved checkout exceeded safe retry window; reconciliation required"
      );
    session = await stripe.checkout.sessions.create(
      JSON.parse(claim.requestPayload),
      {
        idempotencyKey: `booking-checkout:${claim.requestId}`,
        timeout: 15000,
        maxNetworkRetries: 0,
      }
    );
  }
  verifySession(claim, session);
  await persistSession(claim, session);
  if (session.status === "expired" && session.payment_status === "unpaid") {
    await markExpired({ ...claim, sessionId: session.id }, session);
    throw unavailable(
      "Previous checkout expired; retry to create a new session"
    );
  }
  if (
    session.status !== "open" ||
    session.payment_status !== "unpaid" ||
    !session.url
  )
    throw unavailable("Checkout is awaiting verified payment settlement");
  return {
    provider: "stripe" as const,
    sessionId: session.id,
    url: session.url,
  };
}
export async function expireBookingCheckout(bookingId: number, userId: number) {
  const db = getDb();
  if (!db) throw unavailable("Database unavailable");
  const claim = await db.transaction(async tx => {
    await ownedPending(tx, bookingId, userId);
    const [claim] = await tx
      .select()
      .from(bookingCheckoutRequests)
      .where(eq(bookingCheckoutRequests.bookingId, bookingId))
      .for("update");
    if (!claim?.sessionId)
      throw unavailable("Recover the unresolved checkout before expiring it");
    return claim;
  });
  if (claim.status === "expired") return { status: "expired" as const };
  let session = await stripe.checkout.sessions.retrieve(claim.sessionId!);
  // Verify before mutating the provider session, even if a stored ID is corrupt.
  verifySession(claim, session);
  if (session.status === "open")
    session = await stripe.checkout.sessions.expire(
      session.id,
      {},
      {
        idempotencyKey: `expire-checkout:${claim.requestId}`,
        timeout: 15000,
        maxNetworkRetries: 0,
      }
    );
  await markExpired(claim, session);
  return { status: "expired" as const };
}
