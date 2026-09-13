/** Correct-behaviour regression gates against an EMPTY disposable MySQL database.
 * Provider HTTP is stubbed; no claim of external aviation/provider acceptance. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { writeFile } from "node:fs/promises";
import { and, eq, sql } from "drizzle-orm";
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
  const { updateFlightStatus } =
    await import("../../server/services/flight-status.service");
  const { createDisruption } =
    await import("../../server/services/disruption.service");
  await record(
    "R05",
    "Flight tracking preserves the requested dated flight identity",
    async () => {
      const { getFlightTrackingById } =
        await import("../../server/services/flight-tracking.service");
      const data = await getFlightTrackingById(id + 4);
      assert(data);
      assert.equal(data.flight.id, id + 4);
      return { requestedAndReturnedId: id + 4 };
    }
  );
  await record(
    "R07_R08",
    "Flight state, history, disruption and outbox commit atomically for all legs",
    async () => {
      await db.execute(
        sql.raw(
          "CREATE TRIGGER remediation_fail_history BEFORE INSERT ON flight_status_history FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'synthetic history failure'"
        )
      );
      try {
        await assert.rejects(
          updateFlightStatus({
            flightId: id + 8,
            status: "delayed",
            adminUserId: id,
          })
        );
      } finally {
        await db.execute(sql.raw("DROP TRIGGER remediation_fail_history"));
      }
      const [unchanged] = await db
        .select()
        .from(s.flights)
        .where(eq(s.flights.id, id + 8));
      assert.equal(unchanged.status, "scheduled");
      assert.equal(
        (
          await db
            .select()
            .from(s.flightStatusHistory)
            .where(eq(s.flightStatusHistory.flightId, id + 8))
        ).length,
        0
      );
      const result = await updateFlightStatus({
        flightId: id + 3,
        status: "cancelled",
        adminUserId: id,
      });
      assert.equal(result.affectedBookings, 1);
      assert.equal(
        (
          await db
            .select()
            .from(s.flightDisruptions)
            .where(eq(s.flightDisruptions.flightId, id + 3))
        ).length,
        1
      );
      await updateFlightStatus({
        flightId: id + 3,
        status: "cancelled",
        adminUserId: id,
      });
      assert.equal(
        (
          await db
            .select()
            .from(s.flightStatusHistory)
            .where(eq(s.flightStatusHistory.flightId, id + 3))
        ).length,
        1
      );
      return {
        atomicRollback: true,
        secondLegAffected: true,
        idempotentCancellation: true,
      };
    }
  );
  await record(
    "R12",
    "Schedule changes preserve duration and invalidate crew/tail approval",
    async () => {
      const [before] = await db
        .select()
        .from(s.flights)
        .where(eq(s.flights.id, id + 12));
      await db.insert(s.crewAssignments).values({
        flightId: id + 12,
        crewMemberId: id,
        role: "captain",
        status: "confirmed",
      });
      await db.insert(s.aircraftRotations).values({
        flightId: id + 12,
        airlineId: id,
        tenantId: id,
        tailNumber: "ZZ-A",
        maintenanceEvidenceId: id,
        scheduleDigest: "a".repeat(64),
        assignedBy: id,
      });
      const departure = new Date(before.arrivalTime.getTime() + 3600000);
      await createDisruption({
        flightId: id + 12,
        type: "delay",
        severity: "moderate",
        reason: "Schedule revision",
        newDepartureTime: departure,
        createdBy: id,
      });
      const [after] = await db
        .select()
        .from(s.flights)
        .where(eq(s.flights.id, id + 12));
      assert.equal(
        after.arrivalTime.getTime() - after.departureTime.getTime(),
        before.arrivalTime.getTime() - before.departureTime.getTime()
      );
      assert(after.arrivalTime > after.departureTime);
      const [crew] = await db
        .select()
        .from(s.crewAssignments)
        .where(eq(s.crewAssignments.flightId, id + 12));
      assert.equal(crew.status, "removed");
      const [tail] = await db
        .select()
        .from(s.aircraftRotations)
        .where(eq(s.aircraftRotations.flightId, id + 12));
      assert.equal(tail.scheduleDigest, "invalidated");
      await assert.rejects(
        createDisruption({
          flightId: id + 12,
          type: "delay",
          severity: "moderate",
          reason: "Invalid schedule",
          newDepartureTime: departure,
          newArrivalTime: before.arrivalTime,
        })
      );
      return {
        positiveDuration: true,
        explicitInvalidArrivalRejected: true,
        operationalApprovalsInvalidated: true,
      };
    }
  );
  await record(
    "R09",
    "Cancellation resumes each original payer after an unknown provider outcome",
    async () => {
      const { requestFlightCancellation, processFlightCancellations } =
        await import("../../server/services/flight-cancellation.service");
      const { stripe } = await import("../../server/stripe");
      await booking(13, 13, 1, true);
      await booking(14, 13, 1, false);
      await db
        .update(s.flights)
        .set({ economyAvailable: 9 })
        .where(eq(s.flights.id, id + 13));
      for (const [part, amount] of [
        [1, 4000],
        [2, 6000],
      ]) {
        const intent = `pi_audit_cancel_${part}`;
        await db.insert(s.paymentSplits).values({
          id: id + part,
          bookingId: id + 13,
          payerEmail: `payer${part}@example.invalid`,
          payerName: `Payer ${part}`,
          amount,
          percentage: String(amount / 100),
          status: "paid",
          stripePaymentIntentId: intent,
          paymentToken: `audit-cancel-payer-${part}`,
        });
        await db.insert(s.paymentReceipts).values({
          paymentIntentId: intent,
          kind: "split_payment",
          bookingId: id + 13,
          userId: id,
          targetId: id + part,
          amount,
          currency: "SAR",
        });
      }
      const original = {
        create: stripe.refunds.create,
        list: stripe.refunds.list,
        retrieve: stripe.refunds.retrieve,
      };
      const provider = new Map<string, Stripe.Refund>();
      const keys: string[] = [];
      stripe.refunds.list = ((params: Stripe.RefundListParams) => ({
        async *[Symbol.asyncIterator]() {
          for (const r of provider.values())
            if (r.payment_intent === params.payment_intent) yield r;
        },
      })) as unknown as typeof stripe.refunds.list;
      stripe.refunds.create = (async (
        params: Stripe.RefundCreateParams,
        options: Stripe.RequestOptions
      ) => {
        keys.push(options.idempotencyKey ?? "");
        const intent = String(params.payment_intent);
        const refund = {
          id: `re_audit_${provider.size + 1}`,
          object: "refund",
          amount: params.amount,
          currency: "sar",
          payment_intent: intent,
          charge: `ch_${intent}`,
          status: "succeeded",
          metadata: params.metadata ?? {},
        } as Stripe.Refund;
        provider.set(intent, refund);
        if (intent.endsWith("_2"))
          throw new Error("Synthetic timeout AFTER provider committed");
        return refund;
      }) as typeof stripe.refunds.create;
      stripe.refunds.retrieve = (async (refundId: string) => {
        const r = [...provider.values()].find(r => r.id === refundId);
        assert(r);
        return r;
      }) as typeof stripe.refunds.retrieve;
      try {
        const requested = await requestFlightCancellation({
          flightId: id + 13,
          reason: "Synthetic cancellation",
          actorId: id,
        });
        assert.equal(requested.requestedBookings, 2);
        assert.equal(requested.refundedBookings, 0);
        await processFlightCancellations();
        let items = await db
          .select()
          .from(s.orderServiceRefunds)
          .where(eq(s.orderServiceRefunds.cancellationFlightId, id + 13));
        assert.equal(items.length, 2);
        assert.equal(
          items.filter(r => r.status === "succeeded").length,
          1,
          JSON.stringify(items)
        );
        let receipts = await db
          .select()
          .from(s.paymentReceipts)
          .where(eq(s.paymentReceipts.bookingId, id + 13));
        assert.equal(
          receipts.reduce((n, r) => n + r.refundedAmount, 0),
          4000
        );
        await db
          .update(s.orderServiceRefunds)
          .set({ nextAttemptAt: hour(-1) })
          .where(eq(s.orderServiceRefunds.cancellationFlightId, id + 13));
        await processFlightCancellations();
        const resumed = await requestFlightCancellation({
          flightId: id + 13,
          reason: "Same cancellation retry",
          actorId: id,
        });
        assert.equal(resumed.completedBookings, 2);
        assert.equal(
          resumed.refundedBookings,
          1,
          "Unpaid cancellation is not a refund"
        );
        assert.equal(resumed.pendingBookings, 0);
        assert.equal(resumed.reviewRequiredBookings, 0);
        await processFlightCancellations();
        items = await db
          .select()
          .from(s.orderServiceRefunds)
          .where(eq(s.orderServiceRefunds.cancellationFlightId, id + 13));
        assert(items.every(r => r.status === "succeeded"));
        receipts = await db
          .select()
          .from(s.paymentReceipts)
          .where(eq(s.paymentReceipts.bookingId, id + 13));
        assert.equal(
          receipts.reduce((n, r) => n + r.refundedAmount, 0),
          10000
        );
        assert.equal(
          keys.length,
          2,
          "List reconciliation must recover the unknown outcome without another create"
        );
        assert.equal(new Set(keys).size, 2);
        assert(keys.every(k => k.startsWith("order-refund:")));
        const ledger = await db
          .select()
          .from(s.financialLedger)
          .where(eq(s.financialLedger.bookingId, id + 13));
        assert.equal(ledger.length, 2);
        const [cancelled] = await db
          .select()
          .from(s.bookings)
          .where(eq(s.bookings.id, id + 13));
        assert.equal(cancelled.status, "cancelled");
        assert.equal(cancelled.paymentStatus, "refunded");
        return {
          originalPayers: 2,
          providerCreates: keys.length,
          refundedMinorUnits: 10000,
          duplicateLedgerWrites: 0,
          unpaidNotCountedAsRefund: true,
        };
      } finally {
        Object.assign(stripe.refunds, original);
      }
    }
  );
  await record(
    "R13",
    "Independent event receipts and net loyalty survive email failure, duplicates and reordered refunds",
    async () => {
      const { consumeLocalEvent, deliverExternalEffect } =
        await import("../../server/services/event-inbox.service");
      const { configuredPublisher } =
        await import("../../server/services/outbox.service");
      const { settleVerifiedRefund } =
        await import("../../server/services/payment-settlement.service");
      const { awardMilesForBooking } =
        await import("../../server/services/loyalty.service");
      await db.insert(s.paymentReceipts).values({
        paymentIntentId: "pi_audit_loyalty",
        kind: "booking",
        bookingId: id + 9,
        userId: id,
        targetId: id + 9,
        amount: 10000,
        currency: "SAR",
      });
      const [baseEvent] = await db.select().from(s.outbox).limit(1);
      assert(baseEvent);
      const event: s.OutboxEvent = {
        ...baseEvent,
        eventId: randomUUID(),
        eventType: "booking.confirmed",
        aggregateId: String(id + 9),
        aggregateType: "booking",
        tenantId: id,
        payload: { bookingId: id + 9 },
      };
      process.env.OUTBOX_PUBLISH_URL = "https://audit.invalid/events";
      process.env.OUTBOX_PUBLISH_TOKEN = "synthetic-event-transport";
      try {
        await assert.rejects(configuredPublisher(event), /delivery incomplete/);
        const [account] = await db
          .select()
          .from(s.loyaltyAccounts)
          .where(eq(s.loyaltyAccounts.userId, id));
        assert.equal(
          account.currentMilesBalance,
          100,
          "Missing email must not block miles"
        );
        const delivery = await db
          .select()
          .from(s.eventDeliveries)
          .where(eq(s.eventDeliveries.eventId, event.eventId));
        assert.equal(
          delivery.find(d => d.consumer === "booking-email")?.status,
          "failed"
        );
        assert.equal(
          delivery.find(d => d.consumer === "external-bus")?.status,
          "processed"
        );
        assert.equal(
          delivery.find(d => d.consumer === "notifications")?.status,
          "processed"
        );
        let retries = 0;
        await deliverExternalEffect(event, "booking-email", () => {
          retries++;
          return Promise.resolve();
        });
        await configuredPublisher(event);
        await configuredPublisher(event);
        assert.equal(retries, 1);
        const messages = await db
          .select()
          .from(s.notifications)
          .where(
            and(
              eq(s.notifications.userId, id),
              sql`${s.notifications.data} LIKE ${`%${event.eventId}%`}`
            )
          );
        assert.equal(messages.length, 1);
        const award = await awardMilesForBooking(id, id + 9, 999999999, id + 9);
        assert.equal(
          award.milesEarned,
          0,
          "Caller-supplied price cannot inflate ledger accrual"
        );
        await db.transaction(tx =>
          settleVerifiedRefund(tx, {
            paymentIntentId: "pi_audit_loyalty",
            chargeId: "ch_audit_loyalty",
            amount: 10000,
            amountRefunded: 4000,
            currency: "SAR",
            eventId: "audit_partial_refund",
          })
        );
        const partial = {
          ...event,
          eventId: randomUUID(),
          eventType: "payment.refunded",
          aggregateType: "payment",
          aggregateId: "pi_audit_loyalty",
        };
        await consumeLocalEvent(partial);
        const [afterPartial] = await db
          .select()
          .from(s.loyaltyAccounts)
          .where(eq(s.loyaltyAccounts.userId, id));
        assert.equal(afterPartial.currentMilesBalance, 60);
        assert.equal(afterPartial.tierPoints, 60);
        await db.transaction(tx =>
          settleVerifiedRefund(tx, {
            paymentIntentId: "pi_audit_loyalty",
            chargeId: "ch_audit_loyalty",
            amount: 10000,
            amountRefunded: 10000,
            currency: "SAR",
            eventId: "audit_full_refund",
          })
        );
        await consumeLocalEvent({ ...partial, eventId: randomUUID() });
        await consumeLocalEvent({ ...event, eventId: randomUUID() }); // late confirmation
        await consumeLocalEvent(partial); // old partial after full refund
        const [after] = await db
          .select()
          .from(s.loyaltyAccounts)
          .where(eq(s.loyaltyAccounts.userId, id));
        assert.equal(after.currentMilesBalance, 0);
        assert.equal(after.tierPoints, 0);
        assert.equal(after.milesRedeemed, 0, "Refund is not redemption");
        const unknown = {
          ...event,
          eventId: randomUUID(),
          eventType: "audit.unregistered",
        };
        assert.equal((await consumeLocalEvent(unknown)).archivedOnly, true);
        const [archive] = await db
          .select()
          .from(s.eventInbox)
          .where(eq(s.eventInbox.eventId, unknown.eventId));
        assert.equal(
          archive.processedAt,
          null,
          "Storage is not domain handling"
        );
        await assert.rejects(
          consumeLocalEvent({ ...event, tenantId: id + 1 }),
          /conflicts/
        );
        return {
          emailFailureIsolated: true,
          externalBusDelivered: true,
          duplicateNotifications: 0,
          partialRefundBalance: 60,
          fullRefundBalance: 0,
          archiveIsNotHandling: true,
        };
      } finally {
        delete process.env.OUTBOX_PUBLISH_URL;
        delete process.env.OUTBOX_PUBLISH_TOKEN;
      }
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
