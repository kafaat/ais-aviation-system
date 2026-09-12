/** Audit reproductions against an EMPTY disposable MySQL database, never production.
 * These assertions document observed defects on 3a140729; PASS means reproduced,
 * not correct product behaviour. All outbound HTTP and Stripe refund calls are stubbed.
 */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
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
const { adminRouter } = await import("../../server/routers/admin");
const { checkIn, selectSeat } =
  await import("../../server/services/seat-map.service");
const { issueBoardingPass, verifyBoardingPass } =
  await import("../../server/services/boarding-pass.service");
const { getFlightTrackingById } =
  await import("../../server/services/flight-tracking.service");
const { updateFlightStatus, cancelFlightAndRefund } =
  await import("../../server/services/flight-status.service");
const { settleVerifiedPayment, settleVerifiedRefund } =
  await import("../../server/services/payment-settlement.service");
const { processWaitlist, declineOffer } =
  await import("../../server/services/waitlist.service");
const { createInventoryLock } =
  await import("../../server/services/inventory-lock.service");
const { createGroupBookingRequest, approveGroupBooking } =
  await import("../../server/services/group-booking.service");
const { createDisruption } =
  await import("../../server/services/disruption.service");
const { awardMilesForBooking } =
  await import("../../server/services/loyalty.service");
const { consumeLocalEvent } =
  await import("../../server/services/event-inbox.service");
const { stripe } = await import("../../server/stripe");
const db = getDb();
assert(db, "Database required");
const id = 996000;
const hour = (h: number) => new Date(Date.now() + h * 3600000);
const results: { id: string; finding: string; observations: unknown }[] = [];
async function rejected(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("Expected operation to reject");
}
async function record(
  key: string,
  finding: string,
  run: () => Promise<unknown>
) {
  const observations = await run();
  results.push({ id: key, finding, observations });
  console.info(`REPRODUCED ${key}: ${finding}`);
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
      destinationId: i <= 1 ? id + 2 : i === 3 ? id + 2 : id + 1,
      departureTime: hour(12 + i * 24),
      arrivalTime: hour(14 + i * 24),
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
  await record(
    "R01",
    "Legacy check-in bypasses international clearance and accepts zero passengers",
    async () => {
      const canonicalError = await rejected(() => checkIn(id, id, id));
      assert.match(canonicalError, /clearance|evidence|travel/i);
      const response = await caller.checkIn({
        bookingId: id,
        seatAssignments: [],
      });
      const [b] = await db
        .select()
        .from(s.bookings)
        .where(eq(s.bookings.id, id));
      assert.equal(response.success, true);
      assert.equal(b.checkedIn, true);
      const assigned = await db
        .select()
        .from(s.seatInventory)
        .where(eq(s.seatInventory.bookingId, id));
      assert.equal(assigned.length, 0);
      return {
        canonicalError,
        legacySuccess: response.success,
        checkedIn: b.checkedIn,
        assignedSeats: assigned.length,
      };
    }
  );
  await record(
    "R02",
    "Legacy check-in writes duplicate non-existent seats without inventory claims",
    async () => {
      await caller.checkIn({
        bookingId: id + 1,
        seatAssignments: [
          { passengerId: id + 20, seatNumber: "99Z" },
          { passengerId: id + 21, seatNumber: "99Z" },
        ],
      });
      const ps = await db
        .select()
        .from(s.passengers)
        .where(eq(s.passengers.bookingId, id + 1));
      assert.deepEqual(
        ps.map(p => p.seatNumber),
        ["99Z", "99Z"]
      );
      const assigned = await db
        .select()
        .from(s.seatInventory)
        .where(eq(s.seatInventory.bookingId, id + 1));
      assert.equal(assigned.length, 0);
      return {
        seatNumbers: ps.map(p => p.seatNumber),
        inventoryClaims: assigned.length,
      };
    }
  );
  await record(
    "R03",
    "Signed boarding pass can be issued before check-in and after cancellation",
    async () => {
      const before = await issueBoardingPass(
        { bookingId: id + 2, passengerId: id + 40 },
        { userId: id }
      );
      assert.equal(verifyBoardingPass(before.token).valid, true);
      await db
        .update(s.bookings)
        .set({ status: "cancelled", seatsReserved: false })
        .where(eq(s.bookings.id, id + 2));
      const after = await issueBoardingPass(
        { bookingId: id + 2, passengerId: id + 40 },
        { userId: id }
      );
      assert.equal(verifyBoardingPass(after.token).valid, true);
      return {
        uncheckedInPassValid: true,
        cancelledPaidPassValid: true,
        seatNumber: after.payload.seatNumber,
      };
    }
  );
  await db
    .update(s.bookings)
    .set({ status: "confirmed", seatsReserved: true })
    .where(eq(s.bookings.id, id + 2));
  await db.insert(s.bookingSegments).values(
    [2, 3].map((f, i) => ({
      bookingId: id + 2,
      flightId: id + f,
      segmentOrder: i + 1,
      seatsReserved: true,
      status: "confirmed" as const,
      departureDate: hour(12 + f * 24),
    }))
  );
  await record(
    "R04",
    "Second itinerary leg is rejected by seat selection",
    async () => {
      const error = await rejected(() =>
        selectSeat(id + 3, "12A", id + 2, id + 40)
      );
      assert.match(error, /Booking not found for flight/);
      return { validSegmentFlightId: id + 3, error };
    }
  );
  await record(
    "R05",
    "Tracking by flight ID returns a different dated flight",
    async () => {
      const tracking = await getFlightTrackingById(id + 4);
      assert(tracking);
      assert.equal(tracking.flight.id, id + 5);
      return {
        requestedId: id + 4,
        returnedId: tracking.flight.id,
        sharedFlightNumber: tracking.flight.flightNumber,
      };
    }
  );
  await record(
    "R06",
    "Admin availability override permits 11 paid reservations on capacity 10",
    async () => {
      const admin = adminRouter.createCaller({
        ...ctx,
        user: { ...user, role: "airline_admin" },
      });
      await admin.updateFlightAvailability({
        flightId: id + 6,
        cabinClass: "economy",
        seats: 11,
      });
      for (const [offset, count] of [
        [6, 9],
        [7, 2],
      ]) {
        await booking(offset, 6, count, false);
        await db.transaction(tx =>
          settleVerifiedPayment(tx, {
            paymentIntentId: `pi_synthetic_audit_${offset}`,
            amount: count * 10000,
            currency: "sar",
            metadata: { bookingId: String(id + offset), userId: String(id) },
            eventId: `evt_synthetic_audit_${offset}`,
          })
        );
      }
      const [f] = await db
        .select()
        .from(s.flights)
        .where(eq(s.flights.id, id + 6));
      const bs = await db
        .select()
        .from(s.bookings)
        .where(eq(s.bookings.flightId, id + 6));
      const reserved = bs
        .filter(b => b.seatsReserved)
        .reduce((n, b) => n + b.numberOfPassengers, 0);
      assert.equal(reserved, 11);
      assert.equal(f.economySeats, 10);
      assert.equal(f.economyAvailable, 0);
      return {
        physicalCapacity: f.economySeats,
        fundedReservedPassengers: reserved,
        remaining: f.economyAvailable,
      };
    }
  );
  await record(
    "R07",
    "Flight cancellation omits secondary-leg bookings and creates no IROPS event",
    async () => {
      const result = await updateFlightStatus({
        flightId: id + 3,
        status: "cancelled",
        adminUserId: id,
      });
      assert.equal(result.affectedBookings, 0);
      const events = await db
        .select()
        .from(s.flightDisruptions)
        .where(eq(s.flightDisruptions.flightId, id + 3));
      assert.equal(events.length, 0);
      return {
        affectedBookings: result.affectedBookings,
        actualConfirmedItineraries: 1,
        disruptionRecords: events.length,
      };
    }
  );
  await record(
    "R08",
    "Failed status-history write leaves flight status committed",
    async () => {
      await db.execute(
        sql.raw(
          `CREATE TRIGGER audit_fail_history BEFORE INSERT ON flight_status_history FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic audit history failure'`
        )
      );
      try {
        const error = await rejected(() =>
          updateFlightStatus({
            flightId: id + 8,
            status: "delayed",
            adminUserId: id,
          })
        );
        const [flight] = await db
          .select()
          .from(s.flights)
          .where(eq(s.flights.id, id + 8));
        const history = await db
          .select()
          .from(s.flightStatusHistory)
          .where(eq(s.flightStatusHistory.flightId, id + 8));
        assert.equal(flight.status, "delayed");
        assert.equal(history.length, 0);
        return {
          rejected: Boolean(error),
          committedStatus: flight.status,
          historyRows: history.length,
        };
      } finally {
        await db.execute(sql.raw("DROP TRIGGER audit_fail_history"));
      }
    }
  );
  await record(
    "R09",
    "Flight refund command cannot retry after its first provider failure",
    async () => {
      await db
        .update(s.bookings)
        .set({ stripePaymentIntentId: "pi_synthetic_refund_retry" })
        .where(eq(s.bookings.id, id + 9));
      let refundAttempts = 0;
      const originalCreate = stripe.refunds.create;
      stripe.refunds.create = async () => {
        refundAttempts++;
        throw new Error("synthetic provider outage");
      };
      try {
        const firstError = await rejected(() =>
          cancelFlightAndRefund({ flightId: id + 9, reason: "synthetic audit" })
        );
        const retryError = await rejected(() =>
          cancelFlightAndRefund({ flightId: id + 9, reason: "synthetic audit" })
        );
        assert.match(firstError, /synthetic provider outage/);
        assert.match(retryError, /Invalid status transition/);
        assert.equal(refundAttempts, 1);
        return {
          firstError,
          retryError,
          providerCallsAfterTwoAttempts: refundAttempts,
        };
      } finally {
        stripe.refunds.create = originalCreate;
      }
    }
  );
  await record(
    "R10",
    "Declining a waitlist offer does not restore its reserved capacity",
    async () => {
      await db.insert(s.waitlist).values({
        id,
        userId: id,
        flightId: id + 10,
        cabinClass: "economy",
        seats: 1,
        priority: 1,
      });
      assert.equal((await processWaitlist(id + 10)).offeredCount, 1);
      await declineOffer(id, id);
      const [flight] = await db
        .select()
        .from(s.flights)
        .where(eq(s.flights.id, id + 10));
      const [entry] = await db
        .select()
        .from(s.waitlist)
        .where(eq(s.waitlist.id, id));
      assert.equal(entry.status, "cancelled");
      assert.equal(flight.economyAvailable, 9);
      return {
        capacityBeforeOffer: 10,
        availableAfterDecline: flight.economyAvailable,
        activeBookings: 0,
        entryStatus: entry.status,
      };
    }
  );
  await record(
    "R11",
    "Group approval consumes inventory already protected by an active checkout hold",
    async () => {
      const hold = await createInventoryLock(
        id + 11,
        1,
        "economy",
        "synthetic-group-audit",
        id
      );
      const group = await createGroupBookingRequest({
        organizerName: "Synthetic",
        organizerEmail: "audit@example.invalid",
        organizerPhone: "+966500000000",
        groupSize: 10,
        flightId: id + 11,
        cabinClass: "economy",
      });
      const approved = await approveGroupBooking(group.id, 5, id);
      const [flight] = await db
        .select()
        .from(s.flights)
        .where(eq(s.flights.id, id + 11));
      const [lock] = await db
        .select()
        .from(s.inventoryLocks)
        .where(eq(s.inventoryLocks.id, hold.lockId));
      assert.equal(approved.status, "confirmed");
      assert.equal(flight.economyAvailable, 0);
      assert.equal(lock.status, "active");
      return {
        physicalCapacity: 10,
        confirmedGroupSeats: 10,
        stillActiveCheckoutHold: lock.numberOfSeats,
        available: flight.economyAvailable,
      };
    }
  );
  await record(
    "R12",
    "Disruption rescheduling can set departure after arrival",
    async () => {
      const [before] = await db
        .select()
        .from(s.flights)
        .where(eq(s.flights.id, id + 12));
      await createDisruption({
        flightId: id + 12,
        type: "delay",
        reason: "synthetic",
        severity: "minor",
        newDepartureTime: new Date(before.arrivalTime.getTime() + 3600000),
        createdBy: id,
      });
      const [after] = await db
        .select()
        .from(s.flights)
        .where(eq(s.flights.id, id + 12));
      assert(after.departureTime > after.arrivalTime);
      return {
        status: after.status,
        departureAfterArrivalMinutes:
          (after.departureTime.getTime() - after.arrivalTime.getTime()) / 60000,
      };
    }
  );
  await record(
    "R13",
    "A full settled refund and local event consumption retain earned loyalty miles",
    async () => {
      await booking(13, 13, 1, false);
      await db.transaction(tx =>
        settleVerifiedPayment(tx, {
          paymentIntentId: "pi_synthetic_loyalty_audit",
          amount: 10000,
          currency: "sar",
          metadata: { bookingId: String(id + 13), userId: String(id) },
          eventId: "evt_synthetic_loyalty_collect",
        })
      );
      await awardMilesForBooking(id, id + 13, id + 13, 10000);
      const [before] = await db
        .select()
        .from(s.loyaltyAccounts)
        .where(eq(s.loyaltyAccounts.userId, id));
      await db.transaction(tx =>
        settleVerifiedRefund(tx, {
          paymentIntentId: "pi_synthetic_loyalty_audit",
          chargeId: "ch_synthetic_loyalty_audit",
          amount: 10000,
          amountRefunded: 10000,
          currency: "sar",
          eventId: "evt_synthetic_loyalty_refund",
        })
      );
      const refundEvents = await db
        .select()
        .from(s.outbox)
        .where(eq(s.outbox.eventType, "payment.refunded"));
      assert.equal(refundEvents.length, 1);
      for (const event of refundEvents) await consumeLocalEvent(event);
      const [after] = await db
        .select()
        .from(s.loyaltyAccounts)
        .where(eq(s.loyaltyAccounts.userId, id));
      const [refunded] = await db
        .select()
        .from(s.bookings)
        .where(eq(s.bookings.id, id + 13));
      assert.equal(refunded.paymentStatus, "refunded");
      assert.equal(after.currentMilesBalance, before.currentMilesBalance);
      assert.equal(after.currentMilesBalance, 100);
      return {
        bookingPaymentStatus: refunded.paymentStatus,
        earnedMilesBefore: before.currentMilesBalance,
        milesAfterFullRefundAndInbox: after.currentMilesBalance,
      };
    }
  );
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        reviewedCommit: "3a140729b7ff68ab8bf917c8031b09a2af5383d2",
        generatedAt: new Date().toISOString(),
        meaning:
          "PASS = observed defect reproduced; not a healthy-product test result",
        environment:
          "Empty disposable MySQL 8 with real transactions; outbound HTTP and refund provider stubbed",
        result: "REPRODUCED",
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
