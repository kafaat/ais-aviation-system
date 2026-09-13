import assert from "node:assert/strict";
import { eq, and } from "drizzle-orm";
import {
  bookings,
  passengers,
  emergencyHotels,
  emergencyHotelBookings,
  outbox,
} from "../../drizzle/schema";
import type { SettlementTx } from "../../server/services/booking-settlement.service";
import {
  createHotelRequest,
  fulfillHotelRequest,
} from "../../server/services/hotel-fulfillment.service";
import type { HotelProvider } from "../../server/integrations/hotelbeds";
import type {
  HotelRequest,
  HotelReceipt,
} from "../../shared/hotel-fulfillment";

export async function verifyR2Hotels(
  db: SettlementTx,
  seed: number,
  check: (name: string, run: () => Promise<void>) => Promise<void>
) {
  const id = seed + 7000;
  const checkIn = new Date("2035-01-01T00:00:00Z");
  const checkOut = new Date("2035-01-02T00:00:00Z");
  await db.insert(bookings).values({
    id,
    userId: seed,
    flightId: seed + 6002,
    bookingReference: "R2H001",
    pnr: "R2H001",
    totalAmount: 10000,
    cabinClass: "economy",
  });
  await db.insert(passengers).values([
    { id, bookingId: id, firstName: "Synthetic", lastName: "Fixture" },
    {
      id: id + 1,
      bookingId: id + 1,
      firstName: "Foreign",
      lastName: "Fixture",
    },
  ]);
  await db.insert(emergencyHotels).values({
    id,
    airportId: seed + 6000,
    name: "Synthetic hotel",
    address: "Fixture address",
    phone: "000",
    email: "fixture@example.invalid",
    starRating: 3,
    standardRate: 10000,
    distanceKm: "1.00",
  });
  const intent = {
    hotelId: id,
    bookingId: id,
    passengerId: id,
    flightId: seed + 6002,
    roomType: "standard" as const,
    checkIn,
    checkOut,
    idempotencyKey: "r2-hotel-concurrent",
  };
  let hotelId = 0;
  await check(
    "R2 hotels: concurrent idempotent requests create one unconfirmed record",
    async () => {
      const results = await Promise.all(
        [1, 2].map(() =>
          db.transaction(tx => createHotelRequest(tx, intent, seed))
        )
      );
      assert.equal(results[0]?.id, results[1]?.id);
      assert(results[0]);
      hotelId = results[0].id;
      assert.equal(results[0].status, "requested");
      assert.equal(results[0].confirmationNumber, null);
      assert.equal(
        (
          await db
            .select()
            .from(outbox)
            .where(
              and(
                eq(outbox.aggregateType, "hotel_booking"),
                eq(outbox.aggregateId, String(hotelId))
              )
            )
        ).length,
        1
      );
    }
  );
  await check(
    "R2 hotels: foreign passenger, changed retry and transaction failure cannot create stays",
    async () => {
      await assert.rejects(
        db.transaction(tx =>
          createHotelRequest(tx, { ...intent, passengerId: id + 1 }, seed)
        ),
        /scope/
      );
      await assert.rejects(
        db.transaction(tx =>
          createHotelRequest(tx, { ...intent, roomType: "suite" }, seed)
        ),
        /idempotency/
      );
      const before = await db
        .select()
        .from(emergencyHotelBookings)
        .where(eq(emergencyHotelBookings.bookingId, id));
      await assert.rejects(
        db.transaction(async tx => {
          await createHotelRequest(
            tx,
            { ...intent, idempotencyKey: "r2-hotel-rollback" },
            seed
          );
          throw new Error("rollback after hotel and event");
        }),
        /rollback/
      );
      assert.equal(
        (
          await db
            .select()
            .from(emergencyHotelBookings)
            .where(eq(emergencyHotelBookings.bookingId, id))
        ).length,
        before.length
      );
    }
  );
  const request: HotelRequest = {
    quoteId: "11111111-1111-4111-8111-111111111111",
    mappingEvidence: "synthetic acceptance fixture",
    quotedBy: seed,
    approvedBy: seed,
    approvedAt: new Date().toISOString(),
    holder: { name: "Synthetic", surname: "Fixture" },
    maxCancellationCost: 0,
    quote: {
      provider: "hotelbeds",
      mode: "sandbox",
      account: "r2-fixture",
      hotelCode: 123,
      roomCode: "SGL.ST",
      boardCode: "RO",
      checkIn: "2035-01-01",
      checkOut: "2035-01-02",
      currency: "SAR",
      totalCost: 10000,
      rateKey: "synthetic-rate",
      terms: "Synthetic terms",
      cancellationPolicies: [],
      expiresAt: new Date(Date.now() + 300000).toISOString(),
    },
  };
  const [row] = await db
    .select()
    .from(emergencyHotelBookings)
    .where(eq(emergencyHotelBookings.id, hotelId));
  assert(row?.requestReference);
  const receipt: HotelReceipt = {
    reference: "123-R2FIXTURE",
    clientReference: row.requestReference,
    status: "CONFIRMED",
    currency: "SAR",
    totalCost: 10000,
    cancellationCost: null,
    cancellationReference: null,
  };
  let writes = 0;
  let reads = 0;
  const provider: HotelProvider = {
    mode: "sandbox",
    account: "r2-fixture",
    quote: () => Promise.resolve(request.quote),
    book: () => {
      writes++;
      return Promise.reject(new Error("lost reply after provider commit"));
    },
    lookup: () => {
      reads++;
      return Promise.resolve(receipt);
    },
    cancel: () => Promise.reject(new Error("not used")),
  };
  await check(
    "R2 hotels: MySQL claims serialize provider writes and recover an ambiguous response",
    async () => {
      await db
        .update(emergencyHotelBookings)
        .set({ status: "pending_provider", providerRequest: request })
        .where(eq(emergencyHotelBookings.id, hotelId));
      await Promise.allSettled([
        fulfillHotelRequest(db, hotelId, provider),
        fulfillHotelRequest(db, hotelId, provider),
      ]);
      assert.equal(writes, 1);
      await fulfillHotelRequest(db, hotelId, provider);
      const [confirmed] = await db
        .select()
        .from(emergencyHotelBookings)
        .where(eq(emergencyHotelBookings.id, hotelId));
      assert.equal(confirmed?.status, "sandbox_confirmed");
      assert.equal(confirmed?.confirmationNumber, receipt.reference);
      assert.equal(writes, 1);
      assert(reads >= 1);
      assert.equal(
        (
          await db
            .select()
            .from(outbox)
            .where(
              and(
                eq(outbox.eventType, "hotel.sandbox_confirmed"),
                eq(outbox.aggregateId, String(hotelId))
              )
            )
        ).length,
        1
      );
    }
  );
}
