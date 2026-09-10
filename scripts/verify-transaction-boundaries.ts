/** Destructive fixtures ONLY in an empty, disposable *_test database.
 * No mocks, test skipping, provider calls or production credentials. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import * as schema from "../drizzle/schema";

if (
  process.env.AIS_DISPOSABLE_DATABASE !== "true" ||
  !process.env.DATABASE_URL ||
  !process.env.REDIS_URL ||
  !/\/_?[a-z0-9_]+_test$/i.test(new URL(process.env.DATABASE_URL).pathname) ||
  process.env.NODE_ENV === "production"
) {
  throw new Error(
    "Acceptance requires AIS_DISPOSABLE_DATABASE=true, an empty *_test DATABASE_URL, REDIS_URL, and a non-production environment"
  );
}
const deadline = setTimeout(() => {
  console.error("Live acceptance exceeded 90 seconds");
  process.exit(1);
}, 90_000);
deadline.unref();
const { getDb, closePool } = await import("../server/db");
const { cacheService } = await import("../server/services/cache.service");
const { redisCacheService } =
  await import("../server/services/redis-cache.service");
const { settleVerifiedPayment, settleVerifiedRefund } =
  await import("../server/services/payment-settlement.service");
const { payFromWallet } = await import("../server/services/wallet.service");
const { mobileAuthServiceV2 } =
  await import("../server/services/mobile-auth-v2.service");
const { claimPendingEvents, markPublished, markFailed, recordEvent } =
  await import("../server/services/outbox.service");
const { reserveSeats, InventoryUnavailableError } =
  await import("../server/services/booking-settlement.service");
const { createInventoryLock, releaseExpiredLocks } =
  await import("../server/services/inventory-lock.service");
const { upsertUserPreferences } =
  await import("../server/services/user-preferences.service");
const db = getDb();
assert(db, "MySQL is required");
const checks: string[] = [];
let activeCheck: string | null = null;
let completed = false;
async function check(name: string, run: () => Promise<void>) {
  activeCheck = name;
  await run();
  checks.push(name);
  activeCheck = null;
  console.info(`PASS ${name}`);
}
const id = 984001;
const payment = (
  bookingId: number,
  paymentIntentId = `pi_live_${bookingId}`
) => ({
  paymentIntentId,
  amount: 10000,
  currency: "sar",
  metadata: { bookingId: String(bookingId), userId: String(id) },
  eventId: `evt_live_${randomUUID()}`,
});
try {
  await check("live services and empty database", async () => {
    await db.execute(sql`SELECT 1`);
    for (const table of [
      schema.users,
      schema.airlines,
      schema.airports,
      schema.flights,
      schema.bookings,
      schema.paymentReceipts,
      schema.outbox,
      schema.wallets,
      schema.userPreferences,
    ]) {
      assert.equal(
        (await db.select().from(table).limit(1)).length,
        0,
        "Use a fresh disposable database; fixtures will not overwrite existing data"
      );
    }
    for (
      let attempt = 0;
      attempt < 50 && !cacheService.isConnected();
      attempt++
    )
      await delay(100);
    assert.equal(
      (await cacheService.healthCheck()).status,
      "ok",
      "Real Redis is required; fallback is not acceptance"
    );
  });
  await db.insert(schema.users).values({
    id,
    openId: "live-acceptance",
    name: "Acceptance",
    role: "user",
  });
  await check(
    "partial preferences retain database boolean defaults",
    async () => {
      const preferences = await upsertUserPreferences(id, {
        preferredSeatType: "window",
      });
      assert.equal(preferences.wheelchairAssistance, false);
      assert.equal(preferences.extraLegroom, false);
      assert.equal(preferences.smsNotifications, false);
      assert.equal(preferences.emailNotifications, true);
      assert.equal(preferences.autoCheckIn, false);
      const updated = await upsertUserPreferences(id, {
        smsNotifications: true,
      });
      assert.equal(updated.smsNotifications, true);
      assert.equal(updated.preferredSeatType, "window");
    }
  );
  await db
    .insert(schema.airlines)
    .values({ id, code: "ZX", name: "Acceptance" });
  await db.insert(schema.airports).values([
    { id, code: "ZZZ", name: "Origin", city: "Test", country: "Test" },
    {
      id: id + 1,
      code: "ZZY",
      name: "Destination",
      city: "Test",
      country: "Test",
    },
  ]);
  await db.insert(schema.flights).values(
    [0, 1].map(offset => ({
      id: id + offset,
      flightNumber: `ZX90${offset}`,
      airlineId: id,
      originId: id,
      destinationId: id + 1,
      departureTime: new Date("2030-01-01T10:00:00Z"),
      arrivalTime: new Date("2030-01-01T12:00:00Z"),
      economyPrice: 10000,
      businessPrice: 20000,
      economySeats: 10,
      businessSeats: 5,
      economyAvailable: offset ? 1 : 10,
      businessAvailable: 5,
    }))
  );
  await db.insert(schema.bookings).values(
    [0, 1, 2, 3, 4].map(offset => ({
      id: id + offset,
      userId: id,
      flightId: [1, 2].includes(offset) ? id + 1 : id,
      bookingReference: `CI000${offset}`,
      pnr: `PN000${offset}`,
      totalAmount: 10000,
      cabinClass: "economy" as const,
      numberOfPassengers: 1,
    }))
  );
  await check("concurrent duplicate collection settles once", async () => {
    await Promise.all(
      Array.from({ length: 6 }, () =>
        db.transaction(tx => settleVerifiedPayment(tx, payment(id)))
      )
    );
    assert.equal((await db.select().from(schema.paymentReceipts)).length, 1);
    assert.equal((await db.select().from(schema.financialLedger)).length, 1);
    assert.equal((await db.select().from(schema.outbox)).length, 1);
    const [flight] = await db
      .select()
      .from(schema.flights)
      .where(eq(schema.flights.id, id));
    assert.equal(flight.economyAvailable, 9);
  });
  await check(
    "concurrent refund deltas and collection replay conserve seats",
    async () => {
      await Promise.all([
        db.transaction(tx => settleVerifiedPayment(tx, payment(id))),
        ...[4000, 10000, 10000].map(amountRefunded =>
          db.transaction(tx =>
            settleVerifiedRefund(tx, {
              paymentIntentId: `pi_live_${id}`,
              chargeId: "ch_live",
              amount: 10000,
              amountRefunded,
              currency: "sar",
              eventId: `evt_refund_${randomUUID()}`,
            })
          )
        ),
      ]);
      const [receipt] = await db
        .select()
        .from(schema.paymentReceipts)
        .where(eq(schema.paymentReceipts.paymentIntentId, `pi_live_${id}`));
      assert.equal(receipt.refundedAmount, 10000);
      const [flight] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, id));
      assert.equal(flight.economyAvailable, 10);
      const [booking] = await db
        .select()
        .from(schema.bookings)
        .where(eq(schema.bookings.id, id));
      assert.equal(booking.seatsReserved, false);
      const entries = await db
        .select()
        .from(schema.financialLedger)
        .where(eq(schema.financialLedger.bookingId, id));
      assert.equal(
        entries
          .filter(row => row.type !== "charge")
          .reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0),
        10000
      );
    }
  );
  await check(
    "a stale transaction snapshot cannot ignore a newly committed hold",
    async () => {
      await db.transaction(
        async tx => {
          await tx.select().from(schema.inventoryLocks); // Establish an old RR snapshot.
          const hold = await createInventoryLock(
            id + 1,
            1,
            "economy",
            "live-new-hold",
            id
          );
          await assert.rejects(
            () => reserveSeats(tx, id + 1, "economy", 1),
            InventoryUnavailableError
          );
          assert(hold.lockId);
        },
        { isolationLevel: "repeatable read" }
      );
      await db
        .update(schema.inventoryLocks)
        .set({ expiresAt: new Date("2000-01-01T00:00:00Z") });
      assert.equal(await releaseExpiredLocks(), 1);
    }
  );
  await check(
    "last-seat contention preserves both collections and one reservation",
    async () => {
      await Promise.all(
        [id + 1, id + 2].map(bookingId =>
          db.transaction(tx => settleVerifiedPayment(tx, payment(bookingId)))
        )
      );
      const bookings = await db
        .select()
        .from(schema.bookings)
        .where(inArray(schema.bookings.id, [id + 1, id + 2]));
      assert.equal(bookings.filter(row => row.seatsReserved).length, 1);
      const receipts = await db
        .select()
        .from(schema.paymentReceipts)
        .where(inArray(schema.paymentReceipts.bookingId, [id + 1, id + 2]));
      assert.equal(receipts.length, 2);
      assert.equal(
        receipts.filter(row => row.settlementStatus === "review_required")
          .length,
        1
      );
      const [flight] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, id + 1));
      assert.equal(flight.economyAvailable, 0);
    }
  );
  await check("concurrent wallet spending cannot overdraw", async () => {
    await db.insert(schema.wallets).values({
      userId: id,
      balance: 10000,
      currency: "SAR",
      status: "active",
    });
    const results = await Promise.allSettled(
      [id + 3, id + 4].map(bookingId => payFromWallet(id, bookingId))
    );
    assert.equal(
      results.filter(result => result.status === "fulfilled").length,
      1
    );
    const rejected = results.find(result => result.status === "rejected");
    assert(
      rejected?.status === "rejected" &&
        /Insufficient/.test(rejected.reason.message)
    );
    const [wallet] = await db
      .select()
      .from(schema.wallets)
      .where(eq(schema.wallets.userId, id));
    assert.equal(wallet.balance, 0);
  });
  await check(
    "refresh rotation has one winner and family revocation persists",
    async () => {
      const login = await mobileAuthServiceV2.login(id);
      const results = await Promise.allSettled(
        [0, 1].map(() => mobileAuthServiceV2.refreshTokens(login.refreshToken))
      );
      assert.equal(
        results.filter(result => result.status === "fulfilled").length,
        1
      );
      const loser = results.find(result => result.status === "rejected");
      assert(
        loser?.status === "rejected" && loser.reason.code === "UNAUTHORIZED"
      );
      const active = await db
        .select()
        .from(schema.refreshTokens)
        .where(
          and(
            eq(schema.refreshTokens.familyId, login.sessionId),
            isNull(schema.refreshTokens.revokedAt)
          )
        );
      assert.equal(active.length, 1);
      assert.equal(
        (await mobileAuthServiceV2.authenticateAccessToken(login.accessToken))
          .id,
        id
      );
      await mobileAuthServiceV2.revokeFamily(login.sessionId);
      await assert.rejects(() =>
        mobileAuthServiceV2.authenticateAccessToken(login.accessToken)
      );
    }
  );
  await check("outbox leases fence stale writers on MySQL", async () => {
    // Close prior fixture events without external delivery, then isolate one lease.
    await markPublished(await claimPendingEvents(100));
    await recordEvent(db, {
      aggregateType: "acceptance",
      aggregateId: id,
      eventType: "acceptance.lease",
      payload: {},
    });
    const [old] = await claimPendingEvents(1);
    assert(old?.leaseToken);
    await db
      .update(schema.outbox)
      .set({ lockedAt: new Date("2000-01-01T00:00:00Z") })
      .where(eq(schema.outbox.id, old.id));
    const [current] = await claimPendingEvents(1);
    assert.equal(current.id, old.id);
    assert.notEqual(current.leaseToken, old.leaseToken);
    assert.equal(await markPublished([old]), 0);
    assert.equal(await markPublished([current]), 1);
    await markFailed(old.id, "stale failure", old.leaseToken);
    const [stored] = await db
      .select()
      .from(schema.outbox)
      .where(eq(schema.outbox.id, old.id));
    assert.equal(stored.status, "published");
  });
  await check(
    "Redis concurrent quota counts exactly five accepted requests",
    async () => {
      const key = `acceptance:${randomUUID()}`;
      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          cacheService.checkRateLimit(key, 5, 60)
        )
      );
      assert.equal(results.filter(result => result.allowed).length, 5);
      assert.equal(
        (await cacheService.checkRateLimit(key, 5, 60)).allowed,
        false
      );
    }
  );
  const { verifyForensicWorkflows } = await import("./acceptance/forensic");
  await verifyForensicWorkflows(db, id, check);
  const { verifyDataAudit } = await import("./acceptance/data-audit");
  await verifyDataAudit(db, id, check);
  completed = true;
} finally {
  const report = {
    completed,
    passed: checks.length,
    skipped: 0,
    checks,
    failedCheck: activeCheck,
    database: checks.includes("live services and empty database")
      ? "real MySQL"
      : "not verified",
    cache: checks.includes("live services and empty database")
      ? "real Redis"
      : "not verified",
    providerCalls: 0,
  };
  try {
    if (process.argv[2])
      await writeFile(process.argv[2], JSON.stringify(report, null, 2));
    console.info(JSON.stringify(report));
  } finally {
    // Multi-city pricing also loads the flight cache, which owns a Redis client
    // and cleanup interval. Close both caches so successful checks can exit.
    await Promise.allSettled([
      cacheService.disconnect(),
      redisCacheService.shutdown(),
      closePool(),
    ]);
    clearTimeout(deadline);
  }
}
