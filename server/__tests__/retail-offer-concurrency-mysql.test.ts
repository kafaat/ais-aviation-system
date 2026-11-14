import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../drizzle/schema";
import {
  createPaidBookingNativeFixture,
  type PaidBookingNativeFixture,
} from "./helpers/paid-booking-native-fixture";
import { closePool } from "../db";

/**
 * Native service-boundary coverage for S-01 and S-29 in the improvement plan.
 * The expiry case covers rejection before locking only: S-02 expiry between
 * lock and consumption, and payment after offer expiry, are covered through
 * createBooking in offer-expiry-booking-deadline-mysql.test.ts. These tests do
 * not execute booking creation, inventory reservation or payment collection.
 *
 * A retail offer is a purchasable quote. The booking command locks its row
 * FOR UPDATE, validates it (owner, flight, cabin, passenger types, expiry,
 * digest, not yet consumed) and marks it consumed inside the same
 * transaction. Until now that guard was exercised only on an in-memory
 * fixture. These cases run it on native MySQL with a deterministic
 * interleaving: the second transaction is observed waiting on the InnoDB row
 * lock before the first consumes and commits.
 */
const nativeDescribe =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;

type OfferModule = typeof import("../services/retail-offer.service");

nativeDescribe.sequential("retail offer consumption on native MySQL", () => {
  let fixture: PaidBookingNativeFixture;
  let offers: OfferModule;
  const owner = 9;
  const input = {
    flightId: 41,
    tenantId: 3,
    userId: owner,
    channel: "direct" as const,
    cabinClass: "economy",
    passengerTypes: ["adult"],
  };

  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    fixture = await createPaidBookingNativeFixture("ais_confirmation");
    // The application's lazy connection must open against the disposable
    // schema; the services are imported only after the variable points there.
    process.env.DATABASE_URL = fixture.databaseUrl;
    offers = await import("../services/retail-offer.service");
  }, 60000);

  afterAll(async () => {
    // Close the application's own pool before the disposable schema is
    // dropped, and leave the environment as it was found.
    await closePool().catch(() => undefined);
    process.env.DATABASE_URL = originalDatabaseUrl;
    await fixture?.close();
  });

  beforeEach(async () => {
    await fixture.reset();
    await fixture.seed();
  });

  async function offerRow(id: string) {
    const [row] = await fixture.db
      .select()
      .from(schema.retailOffers)
      .where(eq(schema.retailOffers.id, id));
    return row;
  }

  async function consumedEvents(id: string) {
    return fixture.db
      .select()
      .from(schema.outbox)
      .where(
        and(
          eq(schema.outbox.eventType, "retail.offer_consumed"),
          eq(schema.outbox.aggregateId, id)
        )
      );
  }

  async function createOffer(expiresAt?: Date) {
    return offers.createRetailOffer({
      flightId: 41,
      cabinClass: "economy",
      passengerTypes: ["adult"],
      userId: owner,
      sessionId: "native-offer-race",
      channel: "direct",
      expiresAt,
    });
  }

  it("assigns the offer to exactly one of two distinct booking contenders", async () => {
    const [firstBooking] = await fixture.db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, 71));
    await fixture.db.insert(schema.bookings).values({
      ...firstBooking,
      id: 72,
      bookingReference: "NM0072",
      pnr: "PN0072",
    });
    const offer = await createOffer();
    // This is the offer service boundary, not a simulated booking command.
    // Neither contender is permitted to change inventory or collect money here.
    const financialBefore = await fixture.financialSnapshot();
    let firstHoldsLock: () => void = () => undefined;
    const locked = new Promise<void>(resolve => {
      firstHoldsLock = resolve;
    });

    const first = fixture.db.transaction(async tx => {
      const row = await offers.lockRetailOffer(tx, offer.id, input);
      firstHoldsLock();
      // Do not consume until the competitor is actually waiting on the row.
      await fixture.waitForBlockedTransactions(1);
      await offers.consumeRetailOffer(tx, row, 71);
      return "consumed" as const;
    });

    await Promise.race([locked, first]);
    const second = fixture.db.transaction(async tx => {
      const row = await offers.lockRetailOffer(tx, offer.id, input);
      await offers.consumeRetailOffer(tx, row, 72);
      return "consumed" as const;
    });

    const outcomes = await Promise.allSettled([first, second]);
    expect(outcomes[0]).toEqual({ status: "fulfilled", value: "consumed" });
    expect(outcomes[1].status).toBe("rejected");
    const loser = outcomes[1] as PromiseRejectedResult;
    expect(String(loser.reason)).toMatch(/Offer expired, consumed or changed/);

    const row = await offerRow(offer.id);
    expect(row?.consumedBookingId).toBe(71);
    const events = await consumedEvents(offer.id);
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ bookingId: 71 });
    expect(await fixture.financialSnapshot()).toEqual(financialBefore);
  });

  it("refuses a later attempt against a consumed offer without a second event", async () => {
    const offer = await createOffer();
    await fixture.db.transaction(async tx => {
      const row = await offers.lockRetailOffer(tx, offer.id, input);
      await offers.consumeRetailOffer(tx, row, 71);
    });
    await expect(
      fixture.db.transaction(tx => offers.lockRetailOffer(tx, offer.id, input))
    ).rejects.toThrow(/Offer expired, consumed or changed/);
    expect(await consumedEvents(offer.id)).toHaveLength(1);
  });

  it("refuses an expired offer before any consumption and leaves it unconsumed", async () => {
    // createRetailOffer refuses to mint an already-expired offer, so expiry
    // is moved into the past on the stored row; the payload digest is
    // untouched, which isolates the expiry check from the tamper check.
    const offer = await createOffer();
    await fixture.db
      .update(schema.retailOffers)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(schema.retailOffers.id, offer.id));
    await expect(
      fixture.db.transaction(tx => offers.lockRetailOffer(tx, offer.id, input))
    ).rejects.toThrow(/Offer expired, consumed or changed/);
    const row = await offerRow(offer.id);
    expect(row?.consumedBookingId).toBeNull();
    expect(await consumedEvents(offer.id)).toHaveLength(0);
  });

  it("rejects a same-count passenger permutation without writes and accepts the quoted order", async () => {
    const offer = await offers.createRetailOffer({
      flightId: 41,
      cabinClass: "economy",
      passengerTypes: ["adult", "child"],
      userId: owner,
      sessionId: "native-offer-passenger-order",
      channel: "direct",
    });
    const before = await offerRow(offer.id);
    const financialBefore = await fixture.financialSnapshot();

    await expect(
      fixture.db.transaction(async tx => {
        const row = await offers.lockRetailOffer(tx, offer.id, {
          ...input,
          passengerTypes: ["child", "adult"],
        });
        // Keep the real mutation behind the guard: an erroneously accepted
        // permutation must fail this test through its persisted effects too.
        await offers.consumeRetailOffer(tx, row, 71);
      })
    ).rejects.toThrow(/Offer expired, consumed or changed/);
    expect(await offerRow(offer.id)).toEqual(before);
    expect(await consumedEvents(offer.id)).toHaveLength(0);
    expect(await fixture.financialSnapshot()).toEqual(financialBefore);

    await fixture.db.transaction(async tx => {
      const row = await offers.lockRetailOffer(tx, offer.id, {
        ...input,
        passengerTypes: ["adult", "child"],
      });
      await offers.consumeRetailOffer(tx, row, 71);
    });
    expect((await offerRow(offer.id))?.consumedBookingId).toBe(71);
    expect(await consumedEvents(offer.id)).toHaveLength(1);
  });

  it("refuses another owner and another passenger mix without touching the row", async () => {
    const offer = await createOffer();
    await expect(
      fixture.db.transaction(tx =>
        offers.lockRetailOffer(tx, offer.id, { ...input, userId: 10 })
      )
    ).rejects.toThrow(/Offer does not belong to this booking/);
    await expect(
      fixture.db.transaction(tx =>
        offers.lockRetailOffer(tx, offer.id, {
          ...input,
          passengerTypes: ["adult", "child"],
        })
      )
    ).rejects.toThrow(/Offer expired, consumed or changed/);
    const row = await offerRow(offer.id);
    expect(row?.consumedBookingId).toBeNull();
  });
});
