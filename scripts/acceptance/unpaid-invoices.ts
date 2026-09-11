import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import type { SettlementTx } from "../../server/services/booking-settlement.service";

/** Synthetic fixtures; invoked by the guarded disposable MySQL/Redis runner only. */
export async function verifyUnpaidInvoices(
  db: SettlementTx,
  ownerId: number,
  check: (name: string, run: () => Promise<void>) => Promise<void>
) {
  const { createOrder, changeOrder, addServices, getOwnedOrderHistory } =
    await import("../../server/services/ndc.service");
  const { reserveBookingCheckout } =
    await import("../../server/services/booking-checkout.service");
  const { initiateSplitPayment } =
    await import("../../server/services/split-payment.service");
  const { payFromWallet } =
    await import("../../server/services/wallet.service");
  const { removeAncillaryFromBooking, addAncillaryToBooking } =
    await import("../../server/services/ancillary-services.service");
  const base = ownerId + 40;
  const [template] = await db
    .select()
    .from(schema.flights)
    .where(eq(schema.flights.id, ownerId));
  await db.insert(schema.flights).values(
    [0, 1, 2, 3].map(n => ({
      ...template,
      id: base + n,
      flightNumber: `ZX8${n}`,
      economyAvailable: 10,
      businessAvailable: 10,
      departureTime: new Date("2035-01-01T10:00:00Z"),
      arrivalTime: new Date("2035-01-01T12:00:00Z"),
    }))
  );
  const otherOwner = ownerId + 301;
  await db.insert(schema.users).values({
    id: otherOwner,
    openId: `ci-invoice-${otherOwner}`,
    role: "user",
  });
  async function offer(
    ids: number[],
    totalPrice = 10000,
    cabinClass: "economy" | "business" = "economy"
  ) {
    const offerId = `OFF-${randomUUID()}`;
    await db.insert(schema.ndcOffers).values({
      offerId,
      responseId: "CI-INVOICE",
      originId: ownerId,
      destinationId: ownerId + 1,
      departureDate: new Date("2035-01-01T10:00:00Z"),
      airlineId: ownerId,
      cabinClass,
      totalPrice,
      basePrice: totalPrice,
      taxesAndFees: 0,
      segments: JSON.stringify(
        ids.map(id => ({ flightId: id, segmentKey: `SEG-${id}` }))
      ),
      offerPayload: JSON.stringify({ pricing: { passengerCount: 1 } }),
      expiresAt: new Date(Date.now() + 600000),
    });
    return offerId;
  }
  async function create(userId = ownerId) {
    return createOrder({
      userId,
      offerId: await offer([base, base + 1]),
      passengers: [
        { type: "adult", firstName: "Synthetic", lastName: "Invoice" },
      ],
      contactInfo: {
        emailAddress: "fixture@example.invalid",
        phoneNumber: "+966500000000",
      },
    });
  }
  const order = await create();
  assert(order.bookingId);
  const bookingId = order.bookingId;
  const getBooking = async () =>
    (
      await db
        .select()
        .from(schema.bookings)
        .where(eq(schema.bookings.id, bookingId))
    )[0];
  const getOrderRow = async () =>
    (
      await db
        .select()
        .from(schema.ndcOrders)
        .where(eq(schema.ndcOrders.orderId, order.orderId))
    )[0];
  await check(
    "owned NDC history excludes other passengers on the same airline",
    async () => {
      const foreign = await create(otherOwner);
      const mine = await getOwnedOrderHistory(ownerId);
      assert(mine.orders.some(o => o.orderId === order.orderId));
      assert(!mine.orders.some(o => o.orderId === foreign.orderId));
      const theirs = await getOwnedOrderHistory(otherOwner);
      assert.deepEqual(
        theirs.orders.map(o => o.orderId),
        [foreign.orderId]
      );
    }
  );
  await check(
    "concurrent NDC passenger amendments synchronize once with canonical rows",
    async () => {
      const [passenger] = await db
        .select()
        .from(schema.passengers)
        .where(eq(schema.passengers.bookingId, bookingId));
      const command = {
        orderId: order.orderId,
        userId: ownerId,
        idempotencyKey: "ci-passenger-change",
        changes: {
          passengerUpdates: [
            { passengerId: String(passenger.id), firstName: "Corrected" },
          ],
          contactInfoUpdate: { emailAddress: "corrected@example.invalid" },
        },
      };
      const [a, b] = await Promise.all([
        changeOrder(command),
        changeOrder(command),
      ]);
      assert.deepEqual(a, b);
      assert.equal(
        (
          await db
            .select()
            .from(schema.passengers)
            .where(eq(schema.passengers.id, passenger.id))
        )[0].firstName,
        "Corrected"
      );
      const ndc = await getOrderRow();
      assert.equal(
        JSON.parse(ndc.orderPayload!).passengers[0].firstName,
        "Corrected"
      );
      assert.equal(
        JSON.parse(ndc.contactInfo).emailAddress,
        "corrected@example.invalid"
      );
      await assert.rejects(changeOrder({ ...command, userId: otherOwner }));
    }
  );
  await check(
    "ancillary retries update booking NDC and segment totals once with no fake EMD",
    async () => {
      const [catalog] = await db.insert(schema.ancillaryServices).values({
        code: "CI_BAG_INVOICE",
        category: "baggage",
        name: "Synthetic bag request",
        price: 500,
        available: true,
        currency: "SAR",
      });
      const command = {
        orderId: order.orderId,
        userId: ownerId,
        idempotencyKey: "ci-ancillary-change",
        services: [
          {
            serviceCode: "CI_BAG_INVOICE",
            passengerIndex: 0,
            segmentId: `SEG-${base}`,
            quantity: 2,
          },
        ],
      };
      const [a, b] = await Promise.all([
        addServices(command),
        addServices(command),
      ]);
      assert.deepEqual(a, b);
      assert.equal(a.totalAmount, 11000);
      assert.deepEqual(a.emdNumbers, []);
      const ancillaries = await db
        .select()
        .from(schema.bookingAncillaries)
        .where(eq(schema.bookingAncillaries.bookingId, bookingId));
      assert.equal(ancillaries.length, 1);
      assert.equal(ancillaries[0].totalPrice, 1000);
      const legs = await db
        .select()
        .from(schema.bookingSegments)
        .where(eq(schema.bookingSegments.bookingId, bookingId));
      assert.equal(
        legs.reduce((sum, l) => sum + l.segmentAmount!, 0),
        11000
      );
      await removeAncillaryFromBooking(ancillaries[0].id, { userId: ownerId });
      await removeAncillaryFromBooking(ancillaries[0].id, { userId: ownerId });
      assert.equal((await getBooking()).totalAmount, 10000);
      assert.equal((await getOrderRow()).totalAmount, 10000);
      assert(catalog.insertId > 0);
    }
  );
  await check(
    "replacement last-leg failure restores old itinerary and holds and stays retryable",
    async () => {
      const offerId = await offer([base + 2, base + 3], 12000, "business");
      const command = {
        orderId: order.orderId,
        userId: ownerId,
        idempotencyKey: "ci-replace",
        changes: { replacementOfferId: offerId },
      };
      const old = await db
        .select()
        .from(schema.bookingSegments)
        .where(eq(schema.bookingSegments.bookingId, bookingId));
      await db
        .update(schema.flights)
        .set({ businessAvailable: 0 })
        .where(eq(schema.flights.id, base + 3));
      await assert.rejects(changeOrder(command), { code: "BAD_REQUEST" });
      assert.deepEqual(
        await db
          .select()
          .from(schema.bookingSegments)
          .where(eq(schema.bookingSegments.bookingId, bookingId)),
        old
      );
      for (const leg of old)
        assert.equal(
          (
            await db
              .select()
              .from(schema.inventoryLocks)
              .where(eq(schema.inventoryLocks.id, leg.inventoryLockId!))
          )[0].status,
          "active"
        );
      assert.equal((await getOrderRow()).offerId, order.offerId);
      await db
        .update(schema.flights)
        .set({ businessAvailable: 10 })
        .where(eq(schema.flights.id, base + 3));
      const result = await changeOrder(command);
      assert.equal(result.totalAmount, 12000);
      assert.deepEqual(await changeOrder(command), result);
      assert.equal((await getBooking()).cabinClass, "business");
      const replacement = await db
        .select()
        .from(schema.bookingSegments)
        .where(eq(schema.bookingSegments.bookingId, bookingId));
      assert.deepEqual(
        replacement.map(l => l.flightId),
        [base + 2, base + 3]
      );
      assert.equal(
        replacement.reduce((sum, l) => sum + l.segmentAmount!, 0),
        12000
      );
      for (const leg of old)
        assert.equal(
          (
            await db
              .select()
              .from(schema.inventoryLocks)
              .where(eq(schema.inventoryLocks.id, leg.inventoryLockId!))
          )[0].status,
          "released"
        );
    }
  );
  await check(
    "durable checkout claim serializes retries and blocks all competing invoice writers",
    async () => {
      const input = {
        bookingId,
        userId: ownerId,
        appBaseUrl: "https://example.invalid",
      };
      const claims = await Promise.all(
        Array.from({ length: 5 }, () => reserveBookingCheckout(input))
      );
      assert(claims.every(c => c.requestId === claims[0].requestId));
      assert.equal(
        (
          await db
            .select()
            .from(schema.bookingCheckoutRequests)
            .where(eq(schema.bookingCheckoutRequests.bookingId, bookingId))
        ).length,
        1
      );
      const events = await db
        .select()
        .from(schema.outbox)
        .where(
          and(
            eq(schema.outbox.aggregateId, String(bookingId)),
            eq(schema.outbox.eventType, "booking.checkout_requested")
          )
        );
      assert.equal(events.length, 1);
      await assert.rejects(
        changeOrder({
          orderId: order.orderId,
          userId: ownerId,
          idempotencyKey: "blocked-edit",
          changes: { passengerUpdates: [{ index: 0, firstName: "Blocked" }] },
        })
      );
      await assert.rejects(payFromWallet(ownerId, bookingId));
      const [catalog] = await db
        .select()
        .from(schema.ancillaryServices)
        .where(eq(schema.ancillaryServices.code, "CI_BAG_INVOICE"));
      await assert.rejects(
        addAncillaryToBooking(
          {
            bookingId,
            ancillaryServiceId: catalog.id,
            idempotencyKey: "blocked-ancillary",
          },
          { userId: ownerId }
        )
      );
      await assert.rejects(
        initiateSplitPayment({
          bookingId,
          userId: ownerId,
          splits: [
            { email: "a@example.invalid", name: "A", amount: 6000 },
            { email: "b@example.invalid", name: "B", amount: 6000 },
          ],
        })
      );
      assert.equal((await getBooking()).totalAmount, 12000);
    }
  );
  await check(
    "checkout and split plan contention admit exactly one payment rail on MySQL",
    async () => {
      const fresh = await create();
      assert(fresh.bookingId);
      const results = await Promise.allSettled([
        reserveBookingCheckout({
          bookingId: fresh.bookingId,
          userId: ownerId,
          appBaseUrl: "https://example.invalid",
        }),
        initiateSplitPayment({
          bookingId: fresh.bookingId,
          userId: ownerId,
          splits: [
            { email: "a@example.invalid", name: "A", amount: 5000 },
            { email: "b@example.invalid", name: "B", amount: 5000 },
          ],
        }),
      ]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      const claims = await db
        .select()
        .from(schema.bookingCheckoutRequests)
        .where(eq(schema.bookingCheckoutRequests.bookingId, fresh.bookingId));
      const splits = await db
        .select()
        .from(schema.paymentSplits)
        .where(eq(schema.paymentSplits.bookingId, fresh.bookingId));
      assert(
        (claims.length === 1 && splits.length === 0) ||
          (claims.length === 0 && splits.length === 2)
      );
      assert(splits.every(s => Number.isSafeInteger(s.id) && s.id > 0));
    }
  );
}
