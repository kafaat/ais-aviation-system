import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../drizzle/schema";
import {
  createPaidBookingNativeFixture,
  type PaidBookingNativeFixture,
} from "./helpers/paid-booking-native-fixture";
import { closePool } from "../db";

/**
 * Scenarios S-01 and S-02 of docs/architecture/improvement-plan-2026-11.md.
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

  it("lets exactly one of two racing bookings consume the offer", async () => {
    const offer = await createOffer();
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

    await locked;
    const second = fixture.db.transaction(async tx => {
      const row = await offers.lockRetailOffer(tx, offer.id, input);
      await offers.consumeRetailOffer(tx, row, 71);
      return "consumed" as const;
    });

    const outcomes = await Promise.allSettled([first, second]);
    expect(outcomes[0]).toEqual({ status: "fulfilled", value: "consumed" });
    expect(outcomes[1].status).toBe("rejected");
    const loser = outcomes[1] as PromiseRejectedResult;
    expect(String(loser.reason)).toMatch(/Offer expired, consumed or changed/);

    const row = await offerRow(offer.id);
    expect(row?.consumedBookingId).toBe(71);
    expect(await consumedEvents(offer.id)).toHaveLength(1);
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
