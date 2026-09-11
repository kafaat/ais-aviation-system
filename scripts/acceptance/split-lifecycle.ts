import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import type { SettlementTx } from "../../server/services/booking-settlement.service";

/** Real MySQL contention on synthetic data. No Stripe requests or real payment credentials. */
export async function verifySplitLifecycle(
  db: SettlementTx,
  ownerId: number,
  check: (name: string, run: () => Promise<void>) => Promise<void>
) {
  const {
    initiateSplitPayment,
    recordSplitEmailDelivery,
    getSplitPaymentStatus,
  } = await import("../../server/services/split-payment.service");
  const { reserveSplitCheckout, cancelPaymentSplits } =
    await import("../../server/services/split-checkout.service");
  const { settleVerifiedPayment, settleVerifiedRefund } =
    await import("../../server/services/payment-settlement.service");
  const [template] = await db
    .select()
    .from(schema.flights)
    .where(eq(schema.flights.id, ownerId));
  const [flightInsert] = await db.insert(schema.flights).values({
    ...template,
    id: undefined,
    flightNumber: "ZXSP01",
    economyAvailable: 20,
    economySeats: 20,
    departureTime: new Date("2035-01-01T10:00:00Z"),
    arrivalTime: new Date("2035-01-01T12:00:00Z"),
  });
  const flightId = Number(flightInsert.insertId);
  async function plan() {
    const ref = randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
    const [result] = await db.insert(schema.bookings).values({
      userId: ownerId,
      flightId,
      bookingReference: ref,
      pnr: ref,
      totalAmount: 10000,
      cabinClass: "economy",
      numberOfPassengers: 1,
    });
    const bookingId = Number(result.insertId);
    await initiateSplitPayment({
      bookingId,
      userId: ownerId,
      splits: [
        { name: "Synthetic A", email: "a@example.invalid", amount: 4000 },
        { name: "Synthetic B", email: "b@example.invalid", amount: 6000 },
      ],
    });
    const shares = await db
      .select()
      .from(schema.paymentSplits)
      .where(eq(schema.paymentSplits.bookingId, bookingId))
      .orderBy(schema.paymentSplits.id);
    const receipts = () =>
      db
        .select()
        .from(schema.paymentReceipts)
        .where(eq(schema.paymentReceipts.bookingId, bookingId));
    const booking = async () =>
      (
        await db
          .select()
          .from(schema.bookings)
          .where(eq(schema.bookings.id, bookingId))
      )[0];
    const collect = (index: number, suffix = "original") =>
      db.transaction(tx =>
        settleVerifiedPayment(tx, {
          paymentIntentId: `pi_split_${shares[index].id}_${suffix}`,
          eventId: `evt_split_${randomUUID()}`,
          amount: shares[index].amount,
          currency: "sar",
          metadata: {
            type: "split_payment",
            splitId: String(shares[index].id),
            bookingId: String(bookingId),
            userId: String(ownerId),
          },
        })
      );
    const refund = (index: number, amountRefunded: number) =>
      db.transaction(tx =>
        settleVerifiedRefund(tx, {
          paymentIntentId: `pi_split_${shares[index].id}_original`,
          chargeId: `ch_split_${shares[index].id}`,
          eventId: `evt_refund_${randomUUID()}`,
          amount: shares[index].amount,
          currency: "sar",
          amountRefunded,
        })
      );
    return { bookingId, shares, receipts, booking, collect, refund };
  }
  await check(
    "split checkout claims serialize to one frozen provider request on MySQL",
    async () => {
      const p = await plan();
      const claims = await Promise.all(
        Array.from({ length: 6 }, () =>
          reserveSplitCheckout(p.shares[0].paymentToken)
        )
      );
      assert(
        claims.every(
          c =>
            c.requestId === claims[0].requestId &&
            c.requestPayload === claims[0].requestPayload
        )
      );
      const events = await db
        .select()
        .from(schema.outbox)
        .where(
          and(
            eq(schema.outbox.aggregateId, String(p.bookingId)),
            eq(schema.outbox.eventType, "booking.split_checkout_requested")
          )
        );
      assert.equal(events.length, 1);
      assert.equal(
        JSON.parse(claims[0].requestPayload).line_items[0].price_data
          .unit_amount,
        4000
      );
      const [stored] = await db
        .select()
        .from(schema.paymentSplits)
        .where(eq(schema.paymentSplits.id, p.shares[0].id));
      assert.equal(stored.checkoutStatus, "creating");
      assert.equal(stored.checkoutRequestId, claims[0].requestId);
      assert.equal(stored.stripeCheckoutSessionId, null);
    }
  );
  await check(
    "split cancellation racing collection never erases collected money",
    async () => {
      const p = await plan();
      const results = await Promise.allSettled([
        cancelPaymentSplits(
          { bookingId: p.bookingId },
          { id: ownerId, role: "user" }
        ),
        p.collect(0),
      ]);
      assert.equal(results[1].status, "fulfilled");
      const receipts = await p.receipts();
      assert.equal(receipts.length, 1);
      const [split] = await db
        .select()
        .from(schema.paymentSplits)
        .where(eq(schema.paymentSplits.id, p.shares[0].id));
      if (receipts[0].settlementStatus === "applied") {
        assert.equal(split.status, "paid");
        assert.equal(results[0].status, "rejected");
      } else {
        assert.equal(receipts[0].settlementStatus, "review_required");
        assert.equal(split.status, "cancelled");
      }
      assert.equal((await p.booking()).status, "pending");
    }
  );
  await check(
    "competing split charge identities retain one applied receipt and one review receipt",
    async () => {
      const p = await plan();
      await Promise.all([p.collect(0, "one"), p.collect(0, "two")]);
      const receipts = await p.receipts();
      assert.equal(receipts.length, 2);
      assert.equal(
        receipts.filter(r => r.settlementStatus === "applied").length,
        1
      );
      assert.equal(
        receipts.filter(r => r.settlementStatus === "review_required").length,
        1
      );
      const [split] = await db
        .select()
        .from(schema.paymentSplits)
        .where(eq(schema.paymentSplits.id, p.shares[0].id));
      assert.equal(
        split.stripePaymentIntentId,
        receipts.find(r => r.settlementStatus === "applied")!.paymentIntentId
      );
    }
  );
  await check(
    "late email acknowledgement cannot overwrite a concurrently paid split",
    async () => {
      const p = await plan();
      await Promise.all([
        p.collect(0),
        recordSplitEmailDelivery(p.shares[0].id),
      ]);
      await recordSplitEmailDelivery(p.shares[0].id);
      const [split] = await db
        .select()
        .from(schema.paymentSplits)
        .where(eq(schema.paymentSplits.id, p.shares[0].id));
      assert.equal(split.status, "paid");
      assert.equal((await p.receipts()).length, 1);
    }
  );
  await check(
    "partial split refund blocks later booking confirmation on MySQL",
    async () => {
      const p = await plan();
      await p.collect(0);
      await p.refund(0, 1000);
      await p.collect(1);
      assert.equal((await p.booking()).status, "pending");
      assert.equal((await p.booking()).seatsReserved, false);
      assert(
        (await p.receipts()).every(
          r => r.settlementStatus === "review_required"
        )
      );
      assert.equal((await getSplitPaymentStatus(p.bookingId))!.allPaid, false);
    }
  );
  await check(
    "split funding and cumulative refund replay conserve net money and seats",
    async () => {
      const p = await plan();
      const before = (
        await db
          .select()
          .from(schema.flights)
          .where(eq(schema.flights.id, flightId))
      )[0].economyAvailable;
      await Promise.all([p.collect(0), p.collect(1)]);
      assert.equal((await p.booking()).status, "confirmed");
      assert.equal(
        (await getSplitPaymentStatus(p.bookingId))!.paidAmount,
        10000
      );
      await p.refund(0, 1000);
      assert.equal(
        (await getSplitPaymentStatus(p.bookingId))!.paidAmount,
        9000
      );
      await Promise.all([
        p.refund(0, 4000),
        p.refund(0, 4000),
        p.refund(1, 6000),
      ]);
      assert.equal((await p.booking()).paymentStatus, "refunded");
      assert.equal((await getSplitPaymentStatus(p.bookingId))!.paidAmount, 0);
      const after = (
        await db
          .select()
          .from(schema.flights)
          .where(eq(schema.flights.id, flightId))
      )[0].economyAvailable;
      assert.equal(after, before);
    }
  );
}
