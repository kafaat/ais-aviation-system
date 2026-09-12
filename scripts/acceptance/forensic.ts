import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import type { SettlementTx } from "../../server/services/booking-settlement.service";

/** Invoked only by the guarded disposable-database acceptance runner. */
export async function verifyForensicWorkflows(
  db: SettlementTx,
  ownerId: number,
  check: (name: string, run: () => Promise<void>) => Promise<void>
) {
  const { createMultiCityBooking } =
    await import("../../server/services/multi-city.service");
  const { confirmFundedBooking, cancelBookingResources } =
    await import("../../server/services/booking-settlement.service");
  const { withTransactionalIdempotency } =
    await import("../../server/services/idempotency-v2.service");
  const { consumeLocalEvent } =
    await import("../../server/services/event-inbox.service");
  const { runScheduledTask } =
    await import("../../server/services/scheduled-task.service");
  const { initiateBagDrop, weighBag, printBagTag, confirmBagDrop } =
    await import("../../server/services/bag-drop.service");
  const { createExportJob, readExportContent } =
    await import("../../server/services/data-warehouse.service");
  const { settleVerifiedPayment, settleVerifiedRefund } =
    await import("../../server/services/payment-settlement.service");
  const { createOrder, cancelOrder } =
    await import("../../server/services/ndc.service");
  const base = ownerId + 20;
  const departure = new Date("2035-01-01T10:00:00Z");
  const [template] = await db
    .select()
    .from(schema.flights)
    .where(eq(schema.flights.id, ownerId));
  await db.insert(schema.flights).values(
    [0, 1, 2, 3].map(offset => ({
      ...template,
      id: base + offset,
      flightNumber: `ZX9${offset}`,
      economyAvailable: 10,
      departureTime: new Date(departure.getTime() + offset * 86400000),
      arrivalTime: new Date(departure.getTime() + offset * 86400000 + 7200000),
    }))
  );
  const pax = [
    { type: "adult" as const, firstName: "Synthetic", lastName: "Fixture" },
  ];
  let bookingId: number;
  const inventory = async (flightId: number) =>
    (
      await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, flightId))
    )[0].economyAvailable;
  await check(
    "multi-city retries retain one booking and all leg holds",
    async () => {
      const input = {
        userId: ownerId,
        cabinClass: "economy" as const,
        passengers: pax,
        sessionId: "ci-multi-command",
        segments: [0, 1].map(n => ({
          flightId: base + n,
          departureDate: departure,
        })),
      };
      const [first, retry] = await Promise.all([
        createMultiCityBooking(input),
        createMultiCityBooking(input),
      ]);
      assert.deepEqual(first, retry);
      bookingId = first.bookingId;
      const legs = await db
        .select()
        .from(schema.bookingSegments)
        .where(eq(schema.bookingSegments.bookingId, bookingId));
      assert.equal(legs.length, 2);
      assert(
        legs.every(leg => leg.inventoryLockId && leg.segmentAmount != null)
      );
      assert.equal(
        legs.reduce((sum, leg) => sum + leg.segmentAmount!, 0),
        first.totalAmount
      );
      assert.equal(
        (
          await db
            .select()
            .from(schema.passengers)
            .where(eq(schema.passengers.bookingId, bookingId))
        ).length,
        1
      );
    }
  );
  await check(
    "all-leg settlement and cancellation conserve both inventories",
    async () => {
      await db.transaction(async tx => {
        const [booking] = await tx
          .select()
          .from(schema.bookings)
          .where(eq(schema.bookings.id, bookingId))
          .for("update");
        await confirmFundedBooking(tx, booking);
      });
      assert.deepEqual(
        await Promise.all([inventory(base), inventory(base + 1)]),
        [9, 9]
      );
      await db.transaction(async tx => {
        const [booking] = await tx
          .select()
          .from(schema.bookings)
          .where(eq(schema.bookings.id, bookingId))
          .for("update");
        await cancelBookingResources(tx, booking, "CI cancellation", ownerId);
      });
      assert.deepEqual(
        await Promise.all([inventory(base), inventory(base + 1)]),
        [10, 10]
      );
    }
  );
  await check(
    "second-leg failure rolls back first-leg reservation",
    async () => {
      await db.insert(schema.bookings).values({
        id: base,
        userId: ownerId,
        flightId: base + 2,
        bookingReference: "CIROLL",
        pnr: "CIROLL",
        totalAmount: 20000,
        cabinClass: "economy",
        numberOfPassengers: 1,
      });
      await db.insert(schema.bookingSegments).values(
        [2, 3].map((n, index) => ({
          bookingId: base,
          flightId: base + n,
          segmentOrder: index + 1,
          departureDate: departure,
        }))
      );
      await db
        .update(schema.flights)
        .set({ economyAvailable: 0 })
        .where(eq(schema.flights.id, base + 3));
      await assert.rejects(
        db.transaction(async tx => {
          const [booking] = await tx
            .select()
            .from(schema.bookings)
            .where(eq(schema.bookings.id, base))
            .for("update");
          await confirmFundedBooking(tx, booking);
        })
      );
      assert.equal(await inventory(base + 2), 10);
      assert.equal(
        (
          await db
            .select()
            .from(schema.bookings)
            .where(eq(schema.bookings.id, base))
        )[0].paymentStatus,
        "pending"
      );
      // The outer payment transaction intentionally retains collected funds for review.
      // Its savepoint must undo every inventory mutation before that review is committed.
      await db.transaction(tx =>
        settleVerifiedPayment(tx, {
          paymentIntentId: "pi_ci_partial_leg",
          amount: 20000,
          currency: "sar",
          eventId: randomUUID(),
          metadata: { bookingId: String(base), userId: String(ownerId) },
        })
      );
      assert.equal(await inventory(base + 2), 10);
      assert.equal(
        (
          await db
            .select()
            .from(schema.paymentReceipts)
            .where(
              eq(schema.paymentReceipts.paymentIntentId, "pi_ci_partial_leg")
            )
        )[0].settlementStatus,
        "review_required"
      );
      await db
        .update(schema.flights)
        .set({ economyAvailable: 10 })
        .where(eq(schema.flights.id, base + 3));
    }
  );
  await check(
    "idempotency claim and business write share rollback and serialize concurrent retries",
    async () => {
      const command = {
        scope: "ci.command",
        key: "stable",
        userId: ownerId,
        request: { nested: { x: 1 } },
      };
      await assert.rejects(
        withTransactionalIdempotency({
          ...command,
          run: async tx => {
            await tx
              .update(schema.flights)
              .set({ economyAvailable: 0 })
              .where(eq(schema.flights.id, base + 2));
            throw new Error("Injected before commit");
          },
        })
      );
      assert.equal(await inventory(base + 2), 10);
      let calls = 0;
      const result = await Promise.all(
        Array.from({ length: 5 }, () =>
          withTransactionalIdempotency({
            ...command,
            run: async tx => {
              calls++;
              await tx
                .update(schema.flights)
                .set({
                  economyAvailable: sql`${schema.flights.economyAvailable} - 1`,
                })
                .where(eq(schema.flights.id, base + 2));
              return { identity: randomUUID() };
            },
          })
        )
      );
      assert.equal(calls, 1);
      assert(result.every(value => value.identity === result[0].identity));
      assert.equal(await inventory(base + 2), 9);
      await assert.rejects(
        withTransactionalIdempotency({
          ...command,
          request: { nested: { x: 2 } },
          run: () => Promise.resolve({ identity: "invalid" }),
        })
      );
    }
  );
  await check(
    "inbox concurrent replay commits one owned notification",
    async () => {
      const event = {
        eventId: randomUUID(),
        eventType: "booking.cancelled",
        aggregateType: "booking",
        aggregateId: String(bookingId),
        tenantId: null,
        payload: { bookingId },
      };
      const before = (await db.select().from(schema.notifications)).length;
      await Promise.all(
        Array.from({ length: 5 }, () => consumeLocalEvent(event))
      );
      assert.equal(
        (await db.select().from(schema.notifications)).length,
        before + 1
      );
      assert.equal(
        (
          await db
            .select()
            .from(schema.eventInbox)
            .where(eq(schema.eventInbox.eventId, event.eventId))
        ).length,
        1
      );
      await assert.rejects(consumeLocalEvent({ ...event, tenantId: 999 }));
    }
  );
  await check(
    "shared scheduler lease excludes concurrent replicas and retains failures",
    async () => {
      let release!: () => void;
      let entered!: () => void;
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });
      const started = new Promise<void>(resolve => {
        entered = resolve;
      });
      const first = runScheduledTask("ci-job", "tick-1", async () => {
        entered();
        await gate;
      });
      await started;
      try {
        assert.equal(
          await runScheduledTask("ci-job", "tick-1", () => {
            throw new Error("Duplicate execution");
          }),
          false
        );
      } finally {
        release();
      }
      assert.equal(await first, true);
      await assert.rejects(
        runScheduledTask("ci-job", "tick-2", () => {
          throw new Error("Provider unavailable");
        })
      );
      const [job] = await db
        .select()
        .from(schema.scheduledTasks)
        .where(eq(schema.scheduledTasks.name, "ci-job"));
      assert.equal(job.lastTick, "tick-1");
      assert.equal(job.lastError, "Provider unavailable");
      assert(job.lastSuccessAt);
    }
  );
  await check(
    "NDC order, passengers, segment holds and offer transition commit once",
    async () => {
      const offerId = `OFF-${randomUUID()}`;
      await db.insert(schema.ndcOffers).values({
        offerId,
        responseId: "CI-NDC",
        originId: ownerId,
        destinationId: ownerId + 1,
        departureDate: departure,
        airlineId: ownerId,
        cabinClass: "economy",
        totalPrice: 20000,
        basePrice: 20000,
        taxesAndFees: 0,
        segments: JSON.stringify(
          [2, 3].map(n => ({
            flightId: base + n,
            flightNumber: `ZX9${n}`,
            departureTime: departure.toISOString(),
            arrivalTime: new Date(departure.getTime() + 7200000).toISOString(),
            origin: "ZZZ",
            destination: "ZZY",
          }))
        ),
        offerPayload: JSON.stringify({ pricing: { passengerCount: 1 } }),
        expiresAt: new Date(Date.now() + 600000),
      });
      const input = {
        userId: ownerId,
        offerId,
        passengers: pax,
        contactInfo: {
          emailAddress: "fixture@example.invalid",
          phoneNumber: "+966500000000",
        },
      };
      const first = await createOrder(input);
      const retry = await createOrder(input);
      assert.deepEqual(first, retry);
      const [order] = await db
        .select()
        .from(schema.ndcOrders)
        .where(eq(schema.ndcOrders.offerId, offerId));
      assert(order.bookingId);
      assert.equal(
        (
          await db
            .select()
            .from(schema.bookingSegments)
            .where(eq(schema.bookingSegments.bookingId, order.bookingId))
        ).length,
        2
      );
      assert.equal(
        (
          await db
            .select()
            .from(schema.passengers)
            .where(eq(schema.passengers.bookingId, order.bookingId))
        ).length,
        1
      );
      const before = await Promise.all([
        inventory(base + 2),
        inventory(base + 3),
      ]);
      await db.transaction(tx =>
        settleVerifiedPayment(tx, {
          paymentIntentId: "pi_ci_ndc",
          amount: 20000,
          currency: "sar",
          eventId: randomUUID(),
          metadata: {
            bookingId: String(order.bookingId),
            userId: String(ownerId),
          },
        })
      );
      assert.equal(
        (
          await db
            .select()
            .from(schema.ndcOrders)
            .where(eq(schema.ndcOrders.id, order.id))
        )[0].status,
        "confirmed"
      );
      await assert.rejects(
        cancelOrder({ orderId: order.orderId, userId: ownerId + 1 })
      );
      await Promise.all([
        cancelOrder({ orderId: order.orderId, userId: ownerId }),
        cancelOrder({ orderId: order.orderId, userId: ownerId }),
      ]);
      assert.deepEqual(
        await Promise.all([inventory(base + 2), inventory(base + 3)]),
        before
      );
      assert.equal(
        (
          await db
            .select()
            .from(schema.bookings)
            .where(eq(schema.bookings.id, order.bookingId))
        )[0].paymentStatus,
        "paid"
      );
      await db.transaction(tx =>
        settleVerifiedRefund(tx, {
          paymentIntentId: "pi_ci_ndc",
          chargeId: "ch_ci_ndc",
          amount: 20000,
          amountRefunded: 20000,
          currency: "sar",
          eventId: randomUUID(),
        })
      );
      assert.deepEqual(
        await Promise.all([inventory(base + 2), inventory(base + 3)]),
        before
      );
      assert.equal(
        (
          await db
            .select()
            .from(schema.ndcOrders)
            .where(eq(schema.ndcOrders.id, order.id))
        )[0].status,
        "refunded"
      );
      assert(
        (
          await db
            .select()
            .from(schema.bookingSegments)
            .where(eq(schema.bookingSegments.bookingId, order.bookingId))
        ).every(leg => leg.status === "cancelled" && !leg.seatsReserved)
      );
    }
  );
  await check(
    "bag-drop admission and individual weights survive concurrent requests",
    async () => {
      await db
        .update(schema.bookings)
        .set({ status: "confirmed", paymentStatus: "paid" })
        .where(eq(schema.bookings.id, base));
      const [p] = await db.insert(schema.passengers).values({
        bookingId: base,
        type: "adult",
        firstName: "Synthetic",
        lastName: "Fixture",
      });
      const [first, retry] = await Promise.all([
        initiateBagDrop(base, p.insertId),
        initiateBagDrop(base, p.insertId),
      ]);
      assert.equal(first.id, retry.id);
      const priorDemo = process.env.AIS_ENABLE_DEMOS;
      process.env.AIS_ENABLE_DEMOS = "true";
      try {
        await weighBag(first.id, 8000, 1);
        await weighBag(first.id, 10000, 2);
        await Promise.all([
          weighBag(first.id, 8000, 1),
          weighBag(first.id, 10000, 2),
        ]);
        const [tag, duplicate] = await Promise.all([
          printBagTag(first.id, 1),
          printBagTag(first.id, 1),
        ]);
        assert.equal(tag.id, duplicate.id);
        assert.equal(tag.weight, 8000);
        assert.equal((await printBagTag(first.id, 2)).weight, 10000);
        await confirmBagDrop(first.id);
        await confirmBagDrop(first.id);
        const [session] = await db
          .select()
          .from(schema.bagDropSessions)
          .where(eq(schema.bagDropSessions.id, first.id));
        assert.equal(session.status, "complete");
        assert.equal(session.totalWeight, 18000);
        assert.equal(
          (
            await db
              .select()
              .from(schema.bagDropTags)
              .where(eq(schema.bagDropTags.sessionId, first.id))
          ).length,
          2
        );
      } finally {
        if (priorDemo === undefined) delete process.env.AIS_ENABLE_DEMOS;
        else process.env.AIS_ENABLE_DEMOS = priorDemo;
      }
    }
  );
  await check(
    "newly migrated APIS, consent, hotel and kiosk services read and write real tables",
    async () => {
      const apis = await import("../../server/services/apis.service");
      const consent = await import("../../server/services/consent.service");
      const hotel =
        await import("../../server/services/emergency-hotel.service");
      const kiosk = await import("../../server/services/kiosk.service");
      const [passenger] = await db
        .select()
        .from(schema.passengers)
        .where(eq(schema.passengers.bookingId, base));
      const saved = await apis.collectPassengerInfo(passenger.id, {
        documentType: "passport",
        documentNumber: "CI123456",
        issuingCountry: "ZZ",
        nationality: "ZZ",
        dateOfBirth: "1990-01-01",
        gender: "U",
        expiryDate: "2040-01-01",
        givenNames: "Synthetic",
        surname: "Fixture",
      });
      assert(saved.id > 0);
      assert.equal(
        (await apis.getPassengerAPISStatus(passenger.id)).hasData,
        true
      );
      await apis.getAPISRequirements("ZZ", "ZY");
      assert.equal((await apis.getFlightSubmissions(base + 2)).length, 0);
      const choices = {
        essential: true,
        analytics: false,
        marketing: false,
        preferences: false,
        consentVersion: "1.0",
      };
      const [one, two] = await Promise.all([
        consent.recordConsent(choices, null, {}),
        consent.recordConsent(choices, null, {}),
      ]);
      assert(one.id !== two.id);
      assert.equal(one.analytics, false);
      await consent.recordConsent(choices, ownerId, {});
      assert.equal((await consent.getMyConsent(ownerId)).needsReconsent, false);
      const accommodation = await hotel.addHotel({
        name: "CI fixture",
        airportId: ownerId,
        address: "Synthetic",
        phone: "000",
        email: "fixture@example.invalid",
        starRating: 3,
        standardRate: 10000,
        distanceKm: 1,
        hasTransport: false,
      });
      const room = await hotel.bookHotelRoom({
        hotelId: accommodation.id,
        bookingId: base,
        flightId: base + 2,
        passengerId: passenger.id,
        roomType: "standard",
        checkIn: departure,
        checkOut: new Date(departure.getTime() + 86400000),
      });
      assert.equal(
        (await hotel.getHotelBookingsByPassenger(passenger.id)).length,
        1
      );
      await hotel.cancelHotelBooking(room.id);
      const device = await kiosk.registerKiosk(ownerId, "T1", "CI fixture");
      assert.equal(device.status, "offline");
      await kiosk.getKioskStatus(device.id);
      await kiosk.getKioskDevices({ airportId: ownerId });
      assert.equal((await db.select().from(schema.kioskAnalytics)).length, 0);
    }
  );
  await check(
    "warehouse completion has persistent downloadable bytes and stable retry identity",
    async () => {
      const range = {
        startDate: new Date("2034-12-01"),
        endDate: new Date("2036-01-01"),
      };
      const first = await createExportJob(
        "flights",
        range,
        "json",
        ownerId,
        false,
        undefined,
        "ci-warehouse"
      );
      assert.equal(first.status, "completed");
      assert(first.fileSize > 0);
      assert(first.checksum);
      const content = await readExportContent(first.id);
      assert(Array.isArray(JSON.parse(content.content)));
      const retry = await createExportJob(
        "flights",
        range,
        "json",
        ownerId,
        false,
        undefined,
        "ci-warehouse"
      );
      assert.equal(first.id, retry.id);
      await db
        .update(schema.warehouseExports)
        .set({ content: "tampered" })
        .where(eq(schema.warehouseExports.id, first.id));
      await assert.rejects(readExportContent(first.id));
    }
  );
}
