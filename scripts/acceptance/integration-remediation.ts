/** Correct-behaviour regression gates against an EMPTY disposable MySQL database.
 * Provider HTTP is stubbed; no claim of external aviation/provider acceptance. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import * as s from "../../drizzle/schema";
import type { TrpcContext } from "../../server/_core/context";

if (
  process.env.AIS_DISPOSABLE_DATABASE !== "true" ||
  process.env.NODE_ENV !== "test" ||
  !process.env.DATABASE_URL ||
  !/\/[a-z0-9_]+_test$/i.test(new URL(process.env.DATABASE_URL).pathname)
)
  throw new Error("Use an empty disposable *_test database in NODE_ENV=test");
const reportPath = process.argv[2];
assert(reportPath, "Pass a JSON result path");
process.env.BUILT_IN_FORGE_API_URL = "https://audit.invalid";
process.env.BUILT_IN_FORGE_API_KEY = "synthetic-audit-not-a-provider-key";
delete process.env.RESEND_API_KEY;
delete process.env.EMAIL_FROM;
let stubbedHttpCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  stubbedHttpCalls++;
  return new Response("{}", { status: 200 });
};

const { getDb, closePool } = await import("../../server/db");
const { bookingsRouter } = await import("../../server/routers/bookings");
const { checkIn, selectSeat, undoCheckIn, getCheckInStatus } =
  await import("../../server/services/seat-map.service");
const { issueBoardingPass, verifyActiveBoardingPass } =
  await import("../../server/services/boarding-pass.service");
const { performCheckIn } = await import("../../server/services/kiosk.service");
const db = getDb();
assert(db, "Database required");
const id = 996000;
const hour = (h: number) => new Date(Date.now() + h * 3600000);
const results: { id: string; finding: string; observations: unknown }[] = [];
async function record(
  key: string,
  finding: string,
  run: () => Promise<unknown>
) {
  const observations = await run();
  results.push({ id: key, finding, observations });
  console.info(`PASS ${key}: ${finding}`);
}
async function booking(
  offset: number,
  flightOffset: number,
  count = 1,
  paid = true
) {
  await db!.insert(s.bookings).values({
    id: id + offset,
    tenantId: id,
    userId: id,
    flightId: id + flightOffset,
    bookingReference: `AU${String(offset).padStart(4, "0")}`,
    pnr: `AP${String(offset).padStart(4, "0")}`,
    status: paid ? "confirmed" : "pending",
    paymentStatus: paid ? "paid" : "pending",
    seatsReserved: paid,
    cabinClass: "economy",
    numberOfPassengers: count,
    totalAmount: count * 10000,
  });
  await db!.insert(s.passengers).values(
    Array.from({ length: count }, (_, i) => ({
      id: id + offset * 20 + i,
      tenantId: id,
      bookingId: id + offset,
      firstName: "Synthetic",
      lastName: `Traveler${offset}-${i}`,
      nationality: "SA",
      passportNumber: `AU${offset}P${i}`,
      passportExpiry: hour(24 * 365),
    }))
  );
}
try {
  for (const table of [
    s.users,
    s.airlines,
    s.airports,
    s.bookings,
    s.flights,
  ]) {
    assert.equal(
      (await db.select().from(table).limit(1)).length,
      0,
      "Refusing non-empty database"
    );
  }
  await db.insert(s.tenants).values({
    id,
    name: "Synthetic integration audit",
    slug: "integration-audit",
    status: "active",
  });
  await db
    .insert(s.users)
    .values({ id, openId: "integration-audit", tenantId: id, role: "user" });
  await db
    .insert(s.airlines)
    .values({ id, code: "ZY", name: "Synthetic audit" });
  await db.insert(s.airports).values([
    { id, code: "ZZA", name: "A", city: "A", country: "SA" },
    { id: id + 1, code: "ZZB", name: "B", city: "B", country: "SA" },
    { id: id + 2, code: "ZZC", name: "C", city: "C", country: "AE" },
  ]);
  await db.insert(s.flights).values(
    Array.from({ length: 14 }, (_, i) => ({
      id: id + i,
      tenantId: id,
      airlineId: id,
      flightNumber: i === 5 ? "ZY904" : `ZY90${i}`,
      originId: i === 3 ? id + 1 : id,
      destinationId: i <= 1 ? id + 2 : i === 3 ? id : id + 1,
      departureTime: hour(12 + i / 6),
      arrivalTime: hour(14 + i / 6),
      aircraftType: "A320",
      status: "scheduled" as const,
      economySeats: 10,
      economyAvailable: 10,
      businessSeats: 2,
      businessAvailable: 2,
      economyPrice: 10000,
      businessPrice: 20000,
    }))
  );
  for (const [b, f, n] of [
    [0, 0, 1],
    [1, 1, 2],
    [2, 2, 1],
    [9, 9, 1],
  ])
    await booking(b, f, n);
  const [user] = await db.select().from(s.users).where(eq(s.users.id, id));
  assert(user);
  const ctx = {
    user,
    tenantId: id,
    authMethod: "bearer",
    req: { ip: "127.0.0.1", headers: {} },
    res: { setHeader() {} },
  } as unknown as TrpcContext;
  const caller = bookingsRouter.createCaller(ctx);
  await db.insert(s.seatMaps).values({
    id,
    airlineId: id,
    aircraftType: "A320",
    configName: "Acceptance",
    totalSeats: 4,
    economySeats: 4,
    cabinLayout: JSON.stringify({ rows: [] }),
  });
  await db.insert(s.seatInventory).values(
    [2, 3, 4, 5].flatMap(f =>
      ["A", "B", "C", "D"].map(column => ({
        flightId: id + f,
        seatMapId: id,
        seatNumber: `1${column}`,
        row: 1,
        column,
        cabinClass: "economy" as const,
        seatType: "window" as const,
        seatPrice: 0,
      }))
    )
  );
  await record(
    "R01",
    "Every check-in channel enforces passenger coverage and document clearance",
    async () => {
      await assert.rejects(
        caller.checkIn({ bookingId: id, seatAssignments: [] })
      );
      await assert.rejects(
        caller.checkIn({
          bookingId: id,
          seatAssignments: [{ passengerId: id }],
        }),
        /clearance/
      );
      await assert.rejects(performCheckIn(id, id, {}), /clearance/);
      const [b] = await db
        .select()
        .from(s.bookings)
        .where(eq(s.bookings.id, id));
      assert.equal(b.checkedIn, false);
      return { emptyRejected: true, legacyAndKioskClearanceEnforced: true };
    }
  );
  await record(
    "R02",
    "Reject duplicate and non-existent physical seats",
    async () => {
      await assert.rejects(
        caller.checkIn({
          bookingId: id + 1,
          seatAssignments: [
            { passengerId: id + 20, seatNumber: "99Z" },
            { passengerId: id + 21, seatNumber: "99Z" },
          ],
        })
      );
      await assert.rejects(
        checkIn(id + 2, id + 2, id + 40, "99Z"),
        /real available seat/
      );
      assert.equal(
        (
          await db
            .select()
            .from(s.seatInventory)
            .where(eq(s.seatInventory.bookingId, id + 2))
        ).length,
        0
      );
      return { duplicateAndMissingRejected: true };
    }
  );
  await db.insert(s.bookingSegments).values(
    [2, 3].map((f, i) => ({
      bookingId: id + 2,
      flightId: id + f,
      segmentOrder: i + 1,
      seatsReserved: true,
      status: "confirmed" as const,
      departureDate: hour(12 + f / 6),
    }))
  );
  await record(
    "R03_R04",
    "Per-leg check-in and state-verified signed passes",
    async () => {
      await assert.rejects(
        issueBoardingPass(
          { bookingId: id + 2, passengerId: id + 40 },
          { userId: id }
        )
      );
      await selectSeat(id + 3, "1B", id + 2, id + 40);
      await caller.checkIn({
        bookingId: id + 2,
        flightId: id + 2,
        seatAssignments: [{ passengerId: id + 40, seatNumber: "1A" }],
      });
      await checkIn(id + 3, id + 2, id + 40, "1B");
      const first = await issueBoardingPass(
        { bookingId: id + 2, passengerId: id + 40, flightId: id + 2 },
        { userId: id }
      );
      const second = await issueBoardingPass(
        { bookingId: id + 2, passengerId: id + 40, flightId: id + 3 },
        { userId: id }
      );
      assert.equal((await verifyActiveBoardingPass(first.token)).valid, true);
      assert.equal((await verifyActiveBoardingPass(second.token)).valid, true);
      assert.equal(first.payload.seatNumber, "1A");
      assert.equal(second.payload.seatNumber, "1B");
      const [p] = await db
        .select()
        .from(s.passengers)
        .where(eq(s.passengers.id, id + 40));
      assert.equal(p.seatNumber, "1A");
      assert.equal((await getCheckInStatus(id + 3)).totalPassengers, 1);
      await undoCheckIn(id + 3, id + 2, id + 40);
      assert.equal((await verifyActiveBoardingPass(second.token)).valid, false);
      assert.equal((await verifyActiveBoardingPass(first.token)).valid, true);
      const [b] = await db
        .select()
        .from(s.bookings)
        .where(eq(s.bookings.id, id + 2));
      assert.equal(
        b.checkedIn,
        true,
        "Other checked-in leg still protects itinerary"
      );
      await checkIn(id + 3, id + 2, id + 40, "1B");
      assert.equal(
        (await verifyActiveBoardingPass(second.token)).valid,
        false,
        "Re-check-in must not resurrect revoked token"
      );
      await db
        .update(s.bookings)
        .set({ status: "cancelled" })
        .where(eq(s.bookings.id, id + 2));
      assert.equal((await verifyActiveBoardingPass(first.token)).valid, false);
      await assert.rejects(
        issueBoardingPass(
          { bookingId: id + 2, passengerId: id + 40 },
          { userId: id }
        )
      );
      await db
        .update(s.bookings)
        .set({ status: "confirmed" })
        .where(eq(s.bookings.id, id + 2));
      return { perLegSeats: ["1A", "1B"], revocationAndCancellation: true };
    }
  );
  await booking(20, 4);
  await booking(21, 4);
  await record(
    "C01",
    "Concurrent passengers cannot claim one physical seat",
    async () => {
      const attempts = await Promise.allSettled([
        checkIn(id + 4, id + 20, id + 400, "1A"),
        checkIn(id + 4, id + 21, id + 420, "1A"),
      ]);
      assert.equal(attempts.filter(r => r.status === "fulfilled").length, 1);
      return { accepted: 1, rejected: 1 };
    }
  );
  await record(
    "C02",
    "Check-in window and flight status fail closed",
    async () => {
      await db
        .update(s.flights)
        .set({ departureTime: hour(60) })
        .where(eq(s.flights.id, id + 4));
      await assert.rejects(checkIn(id + 4, id + 21, id + 420));
      await db
        .update(s.flights)
        .set({ departureTime: hour(12), status: "cancelled" })
        .where(eq(s.flights.id, id + 4));
      await assert.rejects(checkIn(id + 4, id + 21, id + 420));
      return { outsideWindow: true, cancelledFlight: true };
    }
  );
  await record(
    "C03",
    "Booking creation commits the requested physical seat",
    async () => {
      const { createBooking } =
        await import("../../server/services/bookings.service");
      const result = await createBooking({
        userId: id,
        tenantId: id,
        flightId: id + 5,
        cabinClass: "economy",
        sessionId: "physical-seat-regression",
        passengers: [
          {
            type: "adult",
            firstName: "Seat",
            lastName: "Request",
            seatNumber: "1A",
          },
        ],
      });
      const [seat] = await db
        .select()
        .from(s.seatInventory)
        .where(eq(s.seatInventory.bookingId, result.bookingId));
      assert.equal(seat.seatNumber, "1A");
      const [p] = await db
        .select()
        .from(s.passengers)
        .where(eq(s.passengers.id, seat.passengerId!));
      assert.equal(p.bookingId, result.bookingId);
      return { persistedPhysicalSeat: true };
    }
  );
  const { createInventoryLock, releaseInventoryLock, releaseExpiredLocks } =
    await import("../../server/services/inventory-lock.service");
  const { settleVerifiedPayment } =
    await import("../../server/services/payment-settlement.service");
  const { countActiveHolds } =
    await import("../../server/services/inventory-capacity.service");
  const { processWaitlist, declineOffer, acceptOffer, processExpiredOffers } =
    await import("../../server/services/waitlist.service");
  const {
    createGroupBookingRequest,
    approveGroupBooking,
    expireGroupAllocations,
  } = await import("../../server/services/group-booking.service");
  const { createBooking } =
    await import("../../server/services/bookings.service");
  await record(
    "R06",
    "Manual capacity cannot exceed aircraft capacity or erase funded reservations",
    async () => {
      const { updateFlightAvailability } = await import("../../server/db");
      await assert.rejects(
        updateFlightAvailability(id + 6, "economy", 11, id, id)
      );
      await booking(6, 6, 9, false);
      await db.transaction(tx =>
        settleVerifiedPayment(tx, {
          paymentIntentId: "pi_remediation_capacity",
          amount: 90000,
          currency: "sar",
          metadata: { bookingId: String(id + 6), userId: String(id) },
          eventId: "evt_remediation_capacity",
        })
      );
      await assert.rejects(
        updateFlightAvailability(id + 6, "economy", 2, id, id)
      );
      const [flight] = await db
        .select()
        .from(s.flights)
        .where(eq(s.flights.id, id + 6));
      assert.equal(flight.economyAvailable, 1);
      return { capacityProtected: true, reserved: 9, available: 1 };
    }
  );
  await record(
    "R10",
    "Waitlist decline, expiry and booking handoff preserve inventory",
    async () => {
      await db.insert(s.waitlist).values({
        id,
        userId: id,
        flightId: id + 10,
        seats: 1,
        cabinClass: "economy",
        priority: 1,
      });
      assert.equal((await processWaitlist(id + 10)).offeredCount, 1);
      assert.equal(await countActiveHolds(db, id + 10, "economy"), 1);
      await declineOffer(id, id);
      await declineOffer(id, id);
      assert.equal(await countActiveHolds(db, id + 10, "economy"), 0);
      const [flight] = await db
        .select()
        .from(s.flights)
        .where(eq(s.flights.id, id + 10));
      assert.equal(flight.economyAvailable, 10);
      await db.insert(s.waitlist).values({
        id: id + 1,
        userId: id,
        flightId: id + 10,
        seats: 1,
        cabinClass: "economy",
        priority: 2,
      });
      await processWaitlist(id + 10);
      await db
        .update(s.waitlist)
        .set({ offerExpiresAt: hour(-1) })
        .where(eq(s.waitlist.id, id + 1));
      assert.equal((await processExpiredOffers()).expiredCount, 1);
      assert.equal(await countActiveHolds(db, id + 10, "economy"), 0);
      await db.insert(s.waitlist).values({
        id: id + 2,
        userId: id,
        flightId: id + 10,
        seats: 1,
        cabinClass: "economy",
        priority: 3,
      });
      await processWaitlist(id + 10);
      await acceptOffer(id + 2, id);
      const result = await createBooking({
        userId: id,
        tenantId: id,
        flightId: id + 10,
        cabinClass: "economy",
        sessionId: "waitlist-handoff",
        waitlistId: id + 2,
        passengers: [
          { type: "adult", firstName: "Waitlist", lastName: "Traveler" },
        ],
      });
      assert.equal(await countActiveHolds(db, id + 10, "economy"), 1);
      await assert.rejects(
        createBooking({
          userId: id,
          tenantId: id,
          flightId: id + 10,
          cabinClass: "economy",
          sessionId: "waitlist-reuse",
          waitlistId: id + 2,
          passengers: [
            { type: "adult", firstName: "Waitlist", lastName: "Traveler" },
          ],
        })
      );
      await db.transaction(tx =>
        settleVerifiedPayment(tx, {
          paymentIntentId: "pi_remediation_waitlist",
          amount: result.totalAmount,
          currency: "sar",
          metadata: { bookingId: String(result.bookingId), userId: String(id) },
          eventId: "evt_remediation_waitlist",
        })
      );
      assert.equal(await countActiveHolds(db, id + 10, "economy"), 0);
      const [funded] = await db
        .select()
        .from(s.flights)
        .where(eq(s.flights.id, id + 10));
      assert.equal(funded.economyAvailable, 9);
      return {
        declinedOnce: true,
        expiredOnce: true,
        fundedSeats: 1,
        available: 9,
      };
    }
  );
  await record(
    "R11",
    "Group allocations respect checkout holds and settle through canonical bookings",
    async () => {
      const hold = await createInventoryLock(
        id + 11,
        1,
        "economy",
        "protected-checkout",
        id
      );
      const request = await createGroupBookingRequest({
        organizerUserId: id,
        organizerName: "Group",
        organizerEmail: "group@example.invalid",
        organizerPhone: "0000000000",
        flightId: id + 11,
        groupSize: 10,
      });
      await assert.rejects(approveGroupBooking(request.id, 5, id));
      await releaseInventoryLock(hold.lockId);
      const group = await approveGroupBooking(request.id, 5, id);
      assert.equal(await countActiveHolds(db, id + 11, "economy"), 10);
      const result = await createBooking({
        userId: id,
        tenantId: id,
        flightId: id + 11,
        cabinClass: "economy",
        sessionId: "group-handoff",
        groupBookingId: request.id,
        passengers: Array.from({ length: 10 }, (_, n) => ({
          type: "adult" as const,
          firstName: "Group",
          lastName: `Traveler${n}`,
        })),
      });
      assert.equal(result.totalAmount, group.totalPrice);
      await db.transaction(tx =>
        settleVerifiedPayment(tx, {
          paymentIntentId: "pi_remediation_group",
          amount: result.totalAmount,
          currency: "sar",
          metadata: { bookingId: String(result.bookingId), userId: String(id) },
          eventId: "evt_remediation_group",
        })
      );
      assert.equal(await countActiveHolds(db, id + 11, "economy"), 0);
      const [flight] = await db
        .select()
        .from(s.flights)
        .where(eq(s.flights.id, id + 11));
      assert.equal(flight.economyAvailable, 0);
      return {
        existingHoldProtected: true,
        invoice: result.totalAmount,
        fundedPassengers: 10,
      };
    }
  );
  await record(
    "C04",
    "Expired allocations release physical and group seats",
    async () => {
      const request = await createGroupBookingRequest({
        organizerUserId: id,
        organizerName: "Expiry",
        organizerEmail: "expiry@example.invalid",
        organizerPhone: "0000000000",
        flightId: id + 12,
        groupSize: 10,
      });
      await approveGroupBooking(request.id, 5, id);
      await db
        .update(s.groupBookings)
        .set({ allocationExpiresAt: hour(-1) })
        .where(eq(s.groupBookings.id, request.id));
      assert.equal(await expireGroupAllocations(), 1);
      assert.equal(await countActiveHolds(db, id + 12, "economy"), 0);
      const [pendingSeat] = await db
        .select()
        .from(s.seatInventory)
        .where(eq(s.seatInventory.flightId, id + 5));
      assert(pendingSeat.bookingId);
      const [pending] = await db
        .select()
        .from(s.bookings)
        .where(eq(s.bookings.id, pendingSeat.bookingId));
      assert(pending.inventoryLockId);
      await db
        .update(s.inventoryLocks)
        .set({ expiresAt: hour(-1) })
        .where(eq(s.inventoryLocks.id, pending.inventoryLockId));
      assert.equal(await releaseExpiredLocks(), 1);
      const [released] = await db
        .select()
        .from(s.seatInventory)
        .where(eq(s.seatInventory.id, pendingSeat.id));
      assert.equal(released.status, "available");
      assert.equal(released.bookingId, null);
      return { groupReleased: true, physicalSeatReleased: true };
    }
  );
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        result: "PASS",
        observations: results,
        outboundNetworkCalls: 0,
        stubbedHttpCalls,
      },
      null,
      2
    )
  );
} finally {
  globalThis.fetch = originalFetch;
  await closePool();
  const { cacheService } = await import("../../server/services/cache.service");
  await cacheService.disconnect();
  const { redisCacheService } =
    await import("../../server/services/redis-cache.service");
  await redisCacheService.shutdown();
}
