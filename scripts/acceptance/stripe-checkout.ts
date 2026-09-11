/** Explicit provider acceptance. Never part of offline tests; never accepts a live key. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import * as schema from "../../drizzle/schema";

if (
  process.env.AIS_DISPOSABLE_DATABASE !== "true" ||
  process.env.NODE_ENV === "production" ||
  !process.env.DATABASE_URL ||
  !/\/_?[a-z0-9_]+_test$/i.test(new URL(process.env.DATABASE_URL).pathname) ||
  !process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")
)
  throw new Error(
    "Stripe acceptance requires a disposable *_test database and STRIPE_TEST_SECRET_KEY (sk_test_), never production credentials"
  );
const { getDb, closePool } = await import("../../server/db");
const { stripe } = await import("../../server/stripe");
const { createBookingCheckout, expireBookingCheckout } =
  await import("../../server/services/booking-checkout.service");
const db = getDb();
assert(db);
const checks: string[] = [];
let passed = false;
let bookingId: number | undefined;
const id = 993001;
try {
  for (const table of [
    schema.users,
    schema.bookings,
    schema.bookingCheckoutRequests,
  ])
    assert.equal(
      (await db.select().from(table).limit(1)).length,
      0,
      "Use an empty disposable acceptance database"
    );
  await db
    .insert(schema.users)
    .values({ id, openId: `stripe-acceptance-${randomUUID()}`, role: "user" });
  await db
    .insert(schema.airlines)
    .values({ id, code: "ZT", name: "Synthetic acceptance" });
  await db.insert(schema.airports).values([
    { id, code: "ZTA", name: "Synthetic A", city: "Test", country: "Test" },
    {
      id: id + 1,
      code: "ZTB",
      name: "Synthetic B",
      city: "Test",
      country: "Test",
    },
  ]);
  await db.insert(schema.flights).values({
    id,
    airlineId: id,
    flightNumber: "ZT100",
    originId: id,
    destinationId: id + 1,
    departureTime: new Date("2035-01-01T10:00:00Z"),
    arrivalTime: new Date("2035-01-01T12:00:00Z"),
    economyAvailable: 10,
    economySeats: 100,
    businessSeats: 10,
    businessAvailable: 10,
    economyPrice: 10000,
    businessPrice: 20000,
  });
  const [created] = await db.insert(schema.bookings).values({
    userId: id,
    flightId: id,
    bookingReference: "STEST1",
    pnr: "STEST2",
    totalAmount: 10000,
    numberOfPassengers: 1,
    cabinClass: "economy",
    status: "pending",
  });
  bookingId = created.insertId;
  const owner = {
    bookingId,
    userId: id,
    appBaseUrl: "https://example.invalid",
  };
  const first = await createBookingCheckout(owner);
  const [claim] = await db
    .select()
    .from(schema.bookingCheckoutRequests)
    .where(eq(schema.bookingCheckoutRequests.bookingId, bookingId));
  const session = await stripe.checkout.sessions.retrieve(first.sessionId);
  assert.equal(session.livemode, false);
  assert.equal(session.amount_total, 10000);
  assert.equal(session.currency, "sar");
  assert.equal(session.metadata?.checkoutRequestId, claim.requestId);
  assert.equal(session.metadata?.invoiceHash, claim.invoiceHash);
  checks.push(
    "Stripe test session binds stored invoice amount currency owner and request identity"
  );
  const retry = await createBookingCheckout(owner);
  assert.deepEqual(retry, first);
  checks.push("Retry returns the existing provider session");
  await assert.rejects(createBookingCheckout({ ...owner, userId: id + 1 }));
  checks.push("Foreign user cannot recover a checkout session");
  await expireBookingCheckout(bookingId, id);
  const expired = await stripe.checkout.sessions.retrieve(first.sessionId);
  assert.equal(expired.status, "expired");
  assert.equal(expired.payment_status, "unpaid");
  assert.equal(
    (
      await db
        .select()
        .from(schema.bookingCheckoutRequests)
        .where(eq(schema.bookingCheckoutRequests.bookingId, bookingId))
    )[0].status,
    "expired"
  );
  checks.push("Provider-confirmed unpaid expiry unlocks the durable claim");
  passed = true;
} finally {
  // Keep the isolated database intact on failure so an unknown provider result remains reconcilable.
  const evidence = {
    sourceSha: process.env.GITHUB_SHA ?? null,
    passed,
    checks,
    scope:
      "Real Stripe test-mode session creation/retrieval/expiry only; no captured payment, signed webhook, refund or production certification",
  };
  try {
    if (process.argv[2])
      await writeFile(process.argv[2], JSON.stringify(evidence, null, 2), {
        mode: 0o600,
      });
    console.info(JSON.stringify(evidence));
  } finally {
    await closePool();
  }
}
