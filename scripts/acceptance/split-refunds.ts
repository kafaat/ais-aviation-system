import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type Stripe from "stripe";
import * as schema from "../../drizzle/schema";
import type { SettlementTx } from "../../server/services/booking-settlement.service";

/** Real row-lock contention and rollback in the guarded disposable database.
 * All payment evidence is synthetic; no Stripe provider calls. */
export async function verifySplitRefunds(
  db: SettlementTx,
  ownerId: number,
  check: (name: string, run: () => Promise<void>) => Promise<void>
) {
  const {
    getSplitRefundCancellation,
    reserveSplitRefundCancellation,
    recordVerifiedSplitRefund,
  } = await import("../../server/services/split-refund.service");
  const { initiateSplitPayment, getPayerPaymentDetails } =
    await import("../../server/services/split-payment.service");
  const { settleVerifiedPayment, settleVerifiedRefund } =
    await import("../../server/services/payment-settlement.service");
  const { processStripeEvent } = await import("../../server/webhooks/stripe");
  const actor = { id: ownerId, role: "user" };
  const [template] = await db
    .select()
    .from(schema.flights)
    .where(eq(schema.flights.id, ownerId));
  const departureTime = new Date(Date.now() + 5 * 86400_000);
  const ids: number[] = [];
  for (const n of [1, 2]) {
    const [r] = await db.insert(schema.flights).values({
      ...template,
      id: undefined,
      flightNumber: `ZXRF${n}`,
      economyAvailable: 40,
      economySeats: 40,
      departureTime,
      arrivalTime: new Date(departureTime.getTime() + 7200_000),
    });
    ids.push(Number(r.insertId));
  }
  const inventory = async () =>
    (
      await db
        .select()
        .from(schema.flights)
        .where(inArray(schema.flights.id, ids))
        .orderBy(schema.flights.id)
    ).map(f => f.economyAvailable);
  async function funded() {
    const ref = randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
    const [r] = await db.insert(schema.bookings).values({
      userId: ownerId,
      flightId: ids[0],
      bookingReference: ref,
      pnr: ref,
      totalAmount: 10001,
      cabinClass: "economy",
      numberOfPassengers: 1,
    });
    const bookingId = Number(r.insertId);
    const [passengerRow] = await db
      .insert(schema.passengers)
      .values({ bookingId, firstName: "Refund", lastName: "Fixture" });
    const passengerId = Number(passengerRow.insertId);
    await db.insert(schema.bookingSegments).values(
      ids.map((flightId, i) => ({
        bookingId,
        flightId,
        segmentOrder: i + 1,
        departureDate: departureTime,
        segmentAmount: i ? 5000 : 5001,
      }))
    );
    await initiateSplitPayment({
      bookingId,
      userId: ownerId,
      splits: [
        { name: "Refund A", email: "refund-a@example.invalid", amount: 4001 },
        { name: "Refund B", email: "refund-b@example.invalid", amount: 6000 },
      ],
    });
    const shares = await db
      .select()
      .from(schema.paymentSplits)
      .where(eq(schema.paymentSplits.bookingId, bookingId))
      .orderBy(schema.paymentSplits.id);
    for (const share of shares)
      await db.transaction(tx =>
        settleVerifiedPayment(tx, {
          paymentIntentId: `pi_refund_acceptance_${share.id}`,
          amount: share.amount,
          currency: "sar",
          eventId: `evt_collect_${randomUUID()}`,
          metadata: {
            type: "split_payment",
            bookingId: String(bookingId),
            userId: String(ownerId),
            splitId: String(share.id),
          },
        })
      );
    const preview = () => getSplitRefundCancellation(bookingId, actor);
    const quote = (await preview()).quote!;
    assert(quote);
    const input = {
      bookingId,
      quoteHash: quote.quoteHash,
      reason: "requested_by_customer" as const,
    };
    const reserve = () => reserveSplitRefundCancellation(input, actor);
    const items = () =>
      db
        .select()
        .from(schema.bookingRefundItems)
        .where(eq(schema.bookingRefundItems.bookingId, bookingId))
        .orderBy(schema.bookingRefundItems.splitId);
    const receipt = () =>
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
    const refund = (
      i: typeof schema.bookingRefundItems.$inferSelect,
      status: NonNullable<Stripe.Refund["status"]> = "succeeded"
    ) =>
      ({
        id: `re_${i.id}`,
        object: "refund",
        payment_intent: i.paymentIntentId,
        charge: `ch_${i.splitId}`,
        amount: i.refundAmount,
        currency: "sar",
        metadata: JSON.parse(i.requestPayload).metadata,
        status,
      }) as Stripe.Refund;
    const event = (
      r: Stripe.Refund,
      type: Stripe.Event.Type = "refund.updated"
    ) =>
      db.transaction(tx =>
        processStripeEvent(tx, {
          id: `evt_${randomUUID()}`,
          type,
          data: { object: r },
        } as Stripe.Event)
      );
    return {
      bookingId,
      passengerId,
      shares,
      quote,
      input,
      preview,
      reserve,
      items,
      receipt,
      booking,
      refund,
      event,
    };
  }
  await check(
    "check-in and split cancellation serialize on the same booking owner on MySQL",
    async () => {
      const { performCheckIn } =
        await import("../../server/services/kiosk.service");
      const p = await funded();
      const results = await Promise.allSettled([
        p.reserve(),
        performCheckIn(p.bookingId, p.passengerId, {}),
      ]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      const current = await p.booking();
      if (current.status === "cancelled") {
        assert.equal(current.checkedIn, false);
        assert.equal(current.seatsReserved, false);
        await assert.rejects(performCheckIn(p.bookingId, p.passengerId, {}));
      } else {
        assert.equal(current.checkedIn, true);
        assert.equal(current.seatsReserved, true);
        assert.equal((await p.items()).length, 0);
        await assert.rejects(p.reserve());
      }
    }
  );
  await check(
    "concurrent split cancellations freeze one plan and release all itinerary seats once",
    async () => {
      const p = await funded();
      const before = await inventory();
      const results = await Promise.all(Array.from({ length: 6 }, p.reserve));
      assert(results.every(r => r.plan?.id === results[0].plan?.id));
      assert.equal((await p.items()).length, 2);
      assert.deepEqual(
        await inventory(),
        before.map(n => n + 1)
      );
      assert.equal((await p.booking()).status, "cancelled");
      assert.equal(
        (
          await db
            .select()
            .from(schema.bookingStatusHistory)
            .where(
              and(
                eq(schema.bookingStatusHistory.bookingId, p.bookingId),
                eq(schema.bookingStatusHistory.newStatus, "cancelled")
              )
            )
        ).length,
        1
      );
    }
  );
  await check(
    "concurrent refund webhooks conserve payer amounts and retained cancellation fees on MySQL",
    async () => {
      const p = await funded();
      await p.reserve();
      const before = await inventory();
      const items = await p.items();
      await Promise.all([
        p.event(p.refund(items[0])),
        p.event(p.refund(items[1])),
        p.event(p.refund(items[0])),
        p.event(p.refund(items[1])),
      ]);
      assert.equal((await p.preview()).plan!.status, "completed");
      assert.equal(
        (await p.receipt()).reduce((s, r) => s + r.refundedAmount, 0),
        7501
      );
      const ledger = await db
        .select()
        .from(schema.financialLedger)
        .where(
          and(
            eq(schema.financialLedger.bookingId, p.bookingId),
            eq(schema.financialLedger.type, "partial_refund")
          )
        );
      assert.equal(ledger.length, 2);
      assert.equal(
        ledger.reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0),
        7501
      );
      assert.equal((await p.booking()).paymentStatus, "paid");
      assert.deepEqual(await inventory(), before);
    }
  );
  await check(
    "pending and failed individual refunds cannot be completed by aggregate or stale events",
    async () => {
      const p = await funded();
      await p.reserve();
      const [item] = await p.items();
      await p.event(p.refund(item, "pending"), "refund.created");
      await db.transaction(tx =>
        settleVerifiedRefund(tx, {
          paymentIntentId: item.paymentIntentId,
          chargeId: `ch_${item.splitId}`,
          amount: item.collectedAmount,
          amountRefunded: item.refundAmount,
          currency: "sar",
          eventId: `evt_${randomUUID()}`,
        })
      );
      assert((await p.receipt()).every(r => r.refundedAmount === 0));
      await p.event(p.refund(item, "failed"), "refund.failed");
      await p.event(p.refund(item));
      assert.equal((await p.items())[0].status, "failed");
      assert.equal((await p.preview()).plan!.status, "review_required");
      assert((await p.receipt()).every(r => r.refundedAmount === 0));
    }
  );
  await check(
    "refund item, ledger, receipt and durable events roll back together on real MySQL",
    async () => {
      const p = await funded();
      await p.reserve();
      const [item] = await p.items();
      const before = await db
        .select()
        .from(schema.outbox)
        .where(eq(schema.outbox.aggregateId, String(p.bookingId)));
      await assert.rejects(
        db.transaction(async tx => {
          await recordVerifiedSplitRefund(
            tx,
            p.refund(item),
            `evt_${randomUUID()}`
          );
          throw new Error("synthetic downstream failure");
        }),
        /synthetic downstream failure/
      );
      assert.equal((await p.items())[0].status, "queued");
      assert((await p.receipt()).every(r => r.refundedAmount === 0));
      assert.deepEqual(
        await db
          .select()
          .from(schema.outbox)
          .where(eq(schema.outbox.aggregateId, String(p.bookingId))),
        before
      );
      await p.event(p.refund(item));
      assert.equal((await p.items())[0].status, "succeeded");
    }
  );
  await check(
    "unplanned provider refunds quarantine the affected share without issuing another operation",
    async () => {
      const p = await funded();
      await p.reserve();
      const [item] = await p.items();
      await p.event({ ...p.refund(item), metadata: {} });
      assert.equal((await p.items())[0].errorCode, "provider_refund_conflict");
      assert.equal((await p.preview()).plan!.status, "review_required");
    }
  );
  await check(
    "split refund reads preserve owner authority and disclose only each token holder's share",
    async () => {
      const p = await funded();
      await p.reserve();
      await assert.rejects(
        getSplitRefundCancellation(p.bookingId, {
          id: ownerId + 3000,
          role: "user",
        }),
        { code: "NOT_FOUND" }
      );
      await assert.rejects(
        reserveSplitRefundCancellation(p.input, {
          id: ownerId + 3000,
          role: "user",
        }),
        { code: "NOT_FOUND" }
      );
      const a = await getPayerPaymentDetails(p.shares[0].paymentToken);
      assert.equal(a!.cancellation!.refundAmount, 3001);
      assert.equal(a!.cancellation!.cancellationFee, 1000);
      assert(!JSON.stringify(a).includes("Refund B"));
      assert(!JSON.stringify(a).includes("pi_refund_acceptance"));
    }
  );
}
