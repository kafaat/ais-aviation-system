import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type mysql from "mysql2/promise";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as schema from "../../drizzle/schema";
import { closePool } from "../db";
import {
  createPaidBookingNativeFixture,
  type PaidBookingNativeFixture,
} from "./helpers/paid-booking-native-fixture";

/**
 * S-02 in the improvement plan, as decided by the owner: offer (quote) expiry
 * gates booking creation only, including expiry between the offer lock and its
 * consumption. Once a booking exists, the booking's own payment deadline (the
 * 30-minute unpaid-booking expiry) governs payment, not the offer's expiry.
 *
 * These cases run the real createBooking, checkout claim, unpaid-booking
 * sweeper and verified-payment settlement on native MySQL. Only BullMQ's
 * transport is stubbed: the sweeper is defined beside the queue objects.
 */
vi.mock("bullmq", () => {
  class Transport {
    async close() {}
  }
  return {
    Queue: Transport,
    Worker: Transport,
    Job: Transport,
    UnrecoverableError: Error,
  };
});

const nativeDescribe =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;

const observe = <T>(promise: Promise<T>) =>
  promise.then(
    value => ({ status: "fulfilled" as const, value }),
    reason => ({ status: "rejected" as const, reason: reason as unknown })
  );
const sleepUntil = (time: number) =>
  new Promise(resolve => setTimeout(resolve, Math.max(0, time - Date.now())));

nativeDescribe.sequential(
  "S-02 offer expiry versus the booking payment deadline on native MySQL",
  () => {
    let fixture: PaidBookingNativeFixture;
    let offers: typeof import("../services/retail-offer.service");
    let booking: typeof import("../services/bookings.service");
    let checkout: typeof import("../services/booking-checkout.service");
    let settlement: typeof import("../services/payment-settlement.service");
    let sweeper: typeof import("../services/queue-v2.service");
    const owner = 9;
    const originalDatabaseUrl = process.env.DATABASE_URL;

    beforeAll(async () => {
      fixture = await createPaidBookingNativeFixture("ais_confirmation");
      // The application's lazy pool must open against the disposable schema;
      // the services are imported only after the variable points there.
      process.env.DATABASE_URL = fixture.databaseUrl;
      offers = await import("../services/retail-offer.service");
      booking = await import("../services/bookings.service");
      checkout = await import("../services/booking-checkout.service");
      settlement = await import("../services/payment-settlement.service");
      sweeper = await import("../services/queue-v2.service");
    }, 60000);

    afterAll(async () => {
      await closePool().catch(() => undefined);
      process.env.DATABASE_URL = originalDatabaseUrl;
      await fixture?.close();
    });

    beforeEach(async () => {
      await fixture.reset();
      await fixture.seed();
    });

    function createOffer() {
      return offers.createRetailOffer({
        flightId: 41,
        cabinClass: "economy",
        passengerTypes: ["adult"],
        userId: owner,
        sessionId: "s02-offer",
        channel: "direct",
      });
    }

    async function setOfferExpiry(id: string, expiresAt: Date) {
      // The digest covers the payload only, so moving the stored expiry
      // isolates the expiry rule from the tamper check.
      await fixture.db
        .update(schema.retailOffers)
        .set({ expiresAt })
        .where(eq(schema.retailOffers.id, id));
    }

    function book(offerId: string, lockId?: number) {
      return booking.createBooking({
        userId: owner,
        tenantId: 3,
        flightId: 41,
        cabinClass: "economy",
        passengers: [{ type: "adult", firstName: "Gamma", lastName: "Native" }],
        sessionId: "s02-booking",
        idempotencyKey: `s02-${randomUUID()}`,
        offerId,
        lockId,
      });
    }

    function pay(
      bookingId: number,
      amount: number,
      claim?: { requestId: string; invoiceHash: string }
    ) {
      return fixture.db.transaction(tx =>
        settlement.settleVerifiedPayment(tx, {
          paymentIntentId: `pi_s02_${bookingId}`,
          eventId: `evt_s02_${bookingId}`,
          amount,
          currency: "SAR",
          metadata: {
            type: "booking",
            bookingId: String(bookingId),
            userId: String(owner),
            ...(claim
              ? {
                  checkoutRequestId: claim.requestId,
                  invoiceHash: claim.invoiceHash,
                }
              : {}),
          },
        })
      );
    }

    async function bookingRow(id: number) {
      const [found] = await fixture.db
        .select()
        .from(schema.bookings)
        .where(eq(schema.bookings.id, id));
      return found;
    }

    async function offerRow(id: string) {
      const [found] = await fixture.db
        .select()
        .from(schema.retailOffers)
        .where(eq(schema.retailOffers.id, id));
      return found;
    }

    async function events(eventType: string, aggregateId: string | number) {
      return fixture.db
        .select()
        .from(schema.outbox)
        .where(
          and(
            eq(schema.outbox.eventType, eventType),
            eq(schema.outbox.aggregateId, String(aggregateId))
          )
        );
    }

    /** Every non-empty table in the owned schema, for nonmutation proofs. */
    async function everyTable() {
      const [tables] = await fixture.admin.query<mysql.RowDataPacket[]>(
        "SELECT TABLE_NAME AS name FROM information_schema.tables WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME",
        [fixture.databaseName]
      );
      const state: Record<string, unknown> = {};
      for (const { name } of tables) {
        const [rows] = await fixture.pool.query<mysql.RowDataPacket[]>(
          `SELECT * FROM \`${String(name)}\``
        );
        if (rows.length) state[String(name)] = rows;
      }
      return state;
    }

    it("refuses an offer that expires between createBooking's lock and its consumption, writing nothing", async () => {
      const offer = await createOffer();
      // Whole seconds: the stored expiry has no fractional part. The offer
      // must still be valid when createBooking locks it, about 0.3 s later.
      const expiresAt = new Date(Math.ceil(Date.now() / 1000) * 1000 + 3000);
      await setOfferExpiry(offer.id, expiresAt);
      await fixture.db.insert(schema.inventoryLocks).values({
        id: 520,
        flightId: 41,
        numberOfSeats: 1,
        cabinClass: "economy",
        userId: owner,
        sessionId: "s02-booking",
        status: "active",
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      const before = await everyTable();

      // Hold the customer's inventory hold. createBooking locks the flight
      // and then the offer (validating it) before it reads this row, so it
      // waits here with the offer locked and still valid.
      let release: () => void = () => undefined;
      const released = new Promise<void>(resolve => {
        release = resolve;
      });
      let holding: () => void = () => undefined;
      const held = new Promise<void>(resolve => {
        holding = resolve;
      });
      const blocker = fixture.db.transaction(async tx => {
        await tx
          .select({ id: schema.inventoryLocks.id })
          .from(schema.inventoryLocks)
          .where(eq(schema.inventoryLocks.id, 520))
          .for("update");
        holding();
        await released;
      });
      await Promise.race([held, blocker]);

      const attempt = observe(book(offer.id, 520));
      let offerLock: unknown;
      let lockedBeforeExpiry = false;
      try {
        await fixture.waitForBlockedTransactions(1);
        offerLock = await fixture.pool
          .query(
            "SELECT id FROM retail_offers WHERE id = ? FOR UPDATE NOWAIT",
            [offer.id]
          )
          .then(
            () => "free",
            (error: { code?: string }) => error.code
          );
        lockedBeforeExpiry = Date.now() < expiresAt.getTime();
        // Consumption may proceed only once the offer has expired.
        await sleepUntil(expiresAt.getTime() + 250);
      } finally {
        release();
      }
      await blocker;
      const outcome = await attempt;

      expect({ offerLock, lockedBeforeExpiry }).toEqual({
        offerLock: "ER_LOCK_NOWAIT",
        lockedBeforeExpiry: true,
      });
      expect(outcome).toMatchObject({
        status: "rejected",
        reason: {
          code: "PRECONDITION_FAILED",
          message: expect.stringMatching(/Offer expired, consumed or changed/),
        },
      });
      expect(await everyTable()).toEqual(before);
    });

    it("keeps a booking payable after its offer expires, before the booking deadline, and settles it normally", async () => {
      const offer = await createOffer();
      const created = await book(offer.id);
      expect(await offerRow(offer.id)).toMatchObject({
        consumedBookingId: created.bookingId,
      });
      // The quote has expired; the booking is well inside its own deadline.
      await setOfferExpiry(offer.id, new Date(Date.now() - 60_000));
      const claim = await checkout.reserveBookingCheckout({
        bookingId: created.bookingId,
        userId: owner,
        appBaseUrl: "https://ais.example.test",
      });
      await sweeper.cleanupExpiredBookings();
      expect(await bookingRow(created.bookingId)).toMatchObject({
        status: "pending",
        paymentStatus: "pending",
      });

      await pay(created.bookingId, created.totalAmount, claim);

      const paid = await bookingRow(created.bookingId);
      expect(paid).toMatchObject({
        status: "confirmed",
        paymentStatus: "paid",
        seatsReserved: true,
        totalAmount: created.totalAmount,
        stripePaymentIntentId: `pi_s02_${created.bookingId}`,
      });
      expect(
        await fixture.db
          .select()
          .from(schema.paymentReceipts)
          .where(eq(schema.paymentReceipts.bookingId, created.bookingId))
      ).toMatchObject([
        { amount: created.totalAmount, settlementStatus: "applied" },
      ]);
      const [flight] = await fixture.db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, 41));
      expect(flight.economyAvailable).toBe(7);
      const [hold] = await fixture.db
        .select()
        .from(schema.inventoryLocks)
        .where(eq(schema.inventoryLocks.id, paid!.inventoryLockId!));
      expect(hold.status).toBe("converted");
      expect(await events("booking.confirmed", created.bookingId)).toHaveLength(
        1
      );
      expect(
        await events(
          "payment.settlement_review_required",
          `pi_s02_${created.bookingId}`
        )
      ).toHaveLength(0);
      expect(await offerRow(offer.id)).toMatchObject({
        consumedBookingId: created.bookingId,
      });
    });

    it("control: a payment after the booking's deadline keeps today's expiry and review behaviour", async () => {
      const offer = await createOffer();
      const created = await book(offer.id);
      await setOfferExpiry(offer.id, new Date(Date.now() - 60_000));
      // Past the 30-minute unpaid-booking deadline, with no live checkout.
      await fixture.db
        .update(schema.bookings)
        .set({ createdAt: new Date(Date.now() - 31 * 60_000) })
        .where(eq(schema.bookings.id, created.bookingId));
      await sweeper.cleanupExpiredBookings();
      const expired = await bookingRow(created.bookingId);
      expect(expired).toMatchObject({
        status: "cancelled",
        seatsReserved: false,
      });
      const [flightBefore] = await fixture.db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, 41));

      await pay(created.bookingId, created.totalAmount);

      // The collected funds are retained for review; the booking stays expired.
      expect(await bookingRow(created.bookingId)).toEqual(expired);
      expect(
        await fixture.db
          .select()
          .from(schema.paymentReceipts)
          .where(eq(schema.paymentReceipts.bookingId, created.bookingId))
      ).toMatchObject([
        {
          amount: created.totalAmount,
          settlementStatus: "review_required",
          settlementError: "Booking is not awaiting settlement",
        },
      ]);
      const [flightAfter] = await fixture.db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, 41));
      expect(flightAfter).toEqual(flightBefore);
      expect(await events("booking.confirmed", created.bookingId)).toHaveLength(
        0
      );
      expect(
        await events(
          "payment.settlement_review_required",
          `pi_s02_${created.bookingId}`
        )
      ).toHaveLength(1);
    });
  }
);
