import { randomBytes } from "node:crypto";
import { eq, getTableName } from "drizzle-orm";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
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

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => state.db }));
import { adjustFlightAvailability } from "../services/inventory-adjustment.service";
import {
  allocateSeats,
  getInventoryStatus,
} from "../services/inventory/inventory.service";

const tables = [
  schema.flights,
  schema.bookings,
  schema.bookingSegments,
  schema.groupBookings,
  schema.waitlist,
  schema.inventoryLocks,
  schema.seatHolds,
  schema.overbookingConfig,
  schema.outbox,
];
const allowed =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  Boolean(process.env.DATABASE_URL);
const nativeDescribe = allowed ? describe : describe.skip;

nativeDescribe("inventory promises on isolated native MySQL", () => {
  let admin: mysql.Connection | null = null;
  let pool: mysql.Pool | null = null;
  let db: MySql2Database<typeof schema>;
  let databaseName = "";
  let created = false;
  const departure = new Date("2030-11-20T12:00:00Z");
  const expiresAt = new Date(Date.now() + 3600000);
  const adjustment = (seats: number, overrides = {}) => ({
    flightId: 41,
    cabinClass: "economy" as const,
    seats,
    tenantId: 3,
    actorId: 9,
    reason: "Synthetic operator capacity reconciliation",
    ...overrides,
  });
  const booking = (
    id: number,
    overrides = {}
  ): typeof schema.bookings.$inferInsert => ({
    id,
    userId: 9,
    tenantId: 3,
    flightId: 41,
    cabinClass: "economy",
    numberOfPassengers: 1,
    totalAmount: 10000,
    bookingReference: "I" + String(id).padStart(5, "0"),
    pnr: "I" + String(id).padStart(5, "0"),
    status: "confirmed",
    paymentStatus: "paid",
    seatsReserved: true,
    ...overrides,
  });

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    const sourceDatabase = url.pathname.slice(1);
    if (
      !/^[A-Za-z0-9_]+_test$/.test(sourceDatabase) ||
      !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
    )
      throw new Error(
        "Native inventory fixtures require a loopback disposable _test database"
      );
    const options = {
      host: url.hostname.replace(/^\[|\]$/g, ""),
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      timezone: "Z",
    };
    databaseName = "ais_inventory_" + randomBytes(6).toString("hex");
    if (!/^ais_inventory_[0-9a-f]{12}$/.test(databaseName))
      throw new Error("Invalid disposable inventory identity");
    admin = await mysql.createConnection(options);
    await admin.query(`CREATE DATABASE \`${databaseName}\``);
    created = true;
    // Use migrated SQL types, defaults, primary/unique keys and indexes. LIKE
    // does not copy foreign keys; migration/catalog gates verify those separately.
    for (const table of tables) {
      const name = getTableName(table);
      if (!/^[a-z_]+$/.test(name))
        throw new Error("Invalid inventory fixture table");
      await admin.query(
        `CREATE TABLE \`${databaseName}\`.\`${name}\` LIKE \`${sourceDatabase}\`.\`${name}\``
      );
    }
    pool = mysql.createPool({
      ...options,
      database: databaseName,
      connectionLimit: 6,
    });
    db = drizzle(pool, { schema, mode: "default" });
    state.db = db;
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT @@SESSION.sql_mode AS sqlMode"
    );
    expect(String(rows[0]?.sqlMode)).toContain("STRICT_TRANS_TABLES");
    const [engines] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT ENGINE FROM information_schema.tables WHERE TABLE_SCHEMA=?",
      [databaseName]
    );
    expect(engines).toHaveLength(tables.length);
    expect(engines.every(row => row.ENGINE === "InnoDB")).toBe(true);
  }, 60000);

  afterAll(async () => {
    state.db = null;
    if (pool) await pool.end();
    if (admin) {
      try {
        if (created) await admin.query(`DROP DATABASE \`${databaseName}\``);
      } finally {
        await admin.end();
      }
    }
  });

  beforeEach(async () => {
    for (const table of tables)
      await pool!.query(`TRUNCATE TABLE \`${getTableName(table)}\``);
    await db.insert(schema.flights).values(
      [41, 42].map(id => ({
        id,
        tenantId: 3,
        airlineId: 3,
        originId: 1,
        destinationId: 2,
        flightNumber: "SYN" + id,
        departureTime: departure,
        arrivalTime: new Date("2030-11-20T14:00:00Z"),
        economySeats: 20,
        economyAvailable: 8,
        economyPrice: 10000,
        businessSeats: 5,
        businessAvailable: 5,
        businessPrice: 20000,
      }))
    );
  }, 30000);

  async function rejectInsert(
    table: (typeof tables)[number],
    run: () => Promise<void>
  ) {
    const name = getTableName(table);
    const trigger = "synthetic_inventory_failure";
    await pool!.query(
      `CREATE TRIGGER \`${trigger}\` BEFORE INSERT ON \`${name}\` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Synthetic inventory insert failure'`
    );
    try {
      await run();
    } finally {
      await pool!.query(`DROP TRIGGER \`${trigger}\``);
    }
  }

  it("preserves current segment reservations, legacy promises and every active hold without counting aliases twice", async () => {
    await db
      .insert(schema.bookings)
      .values([
        booking(71, { flightId: 42, numberOfPassengers: 2 }),
        booking(72),
        booking(73, { numberOfPassengers: 9 }),
        booking(74, { cabinClass: "business", numberOfPassengers: 3 }),
        booking(75, { flightId: 42, numberOfPassengers: 4 }),
      ]);
    await db.insert(schema.bookingSegments).values([
      {
        bookingId: 71,
        flightId: 41,
        segmentOrder: 2,
        departureDate: departure,
        status: "confirmed",
        seatsReserved: true,
      },
      {
        bookingId: 73,
        flightId: 41,
        segmentOrder: 1,
        departureDate: departure,
        status: "cancelled",
        seatsReserved: false,
      },
    ]);
    const group = {
      organizerName: "Synthetic organizer",
      organizerEmail: "group@example.test",
      organizerPhone: "0000000000",
      flightId: 41,
      cabinClass: "economy" as const,
      groupSize: 10,
      status: "confirmed" as const,
    };
    await db
      .insert(schema.groupBookings)
      .values([
        group,
        { ...group, inventoryLockId: 99 },
        { ...group, bookingId: 71 },
        { ...group, status: "cancelled" },
        { ...group, flightId: 42 },
      ]);
    const waiting = {
      flightId: 41,
      cabinClass: "economy" as const,
      userId: 9,
      seats: 1,
      priority: 1,
    };
    await db.insert(schema.waitlist).values([
      { ...waiting, status: "offered" },
      { ...waiting, priority: 2, status: "confirmed" },
      { ...waiting, priority: 3, seats: 10, status: "waiting" },
      {
        ...waiting,
        priority: 4,
        seats: 10,
        status: "offered",
        inventoryLockId: 99,
      },
      {
        ...waiting,
        priority: 5,
        seats: 10,
        status: "confirmed",
        bookingId: 71,
      },
    ]);
    const lock = {
      flightId: 41,
      cabinClass: "economy" as const,
      numberOfSeats: 1,
      sessionId: "native-active",
      expiresAt,
    };
    await db.insert(schema.inventoryLocks).values([
      { ...lock, id: 1 },
      {
        ...lock,
        id: 2,
        sessionId: "native-expired",
        numberOfSeats: 20,
        expiresAt: new Date(Date.now() - 1000),
      },
      { ...lock, id: 3, sessionId: "native-other-sector", flightId: 42 },
      {
        ...lock,
        id: 4,
        sessionId: "native-other-cabin",
        cabinClass: "business",
      },
    ]);
    const alias = {
      flightId: 41,
      cabinClass: "economy" as const,
      seats: 1,
      userId: 9,
      sessionId: "native-alias",
      expiresAt,
    };
    await db.insert(schema.seatHolds).values([
      { ...alias, inventoryLockId: 1 },
      { ...alias, sessionId: "native-legacy", inventoryLockId: null },
      {
        ...alias,
        sessionId: "native-released",
        seats: 20,
        inventoryLockId: null,
        status: "released",
      },
    ]);
    await expect(adjustFlightAvailability(adjustment(6))).rejects.toMatchObject(
      { code: "PRECONDITION_FAILED" }
    );
    await expect(adjustFlightAvailability(adjustment(1))).rejects.toMatchObject(
      { code: "PRECONDITION_FAILED" }
    );
    expect(await db.select().from(schema.outbox)).toEqual([]);
    expect(await adjustFlightAvailability(adjustment(5))).toBe(true);
    const [event] = await db.select().from(schema.outbox);
    expect(event).toMatchObject({
      tenantId: 3,
      aggregateId: "41",
      eventType: "inventory.adjusted",
      status: "pending",
    });
    expect(event.payload).toMatchObject({
      previous: 8,
      available: 5,
      capacity: 20,
      reservedSeats: 15,
      heldSeats: 2,
      actorId: 9,
    });
    expect(await getInventoryStatus(41, "economy")).toMatchObject({
      heldSeats: 2,
      effectiveAvailable: 3,
    });
    const [other] = await db
      .select()
      .from(schema.flights)
      .where(eq(schema.flights.id, 42));
    expect(other.economyAvailable).toBe(8);
  });

  it("does not adjust or emit an event for a missing or foreign-tenant flight", async () => {
    expect(await adjustFlightAvailability(adjustment(5, { tenantId: 4 }))).toBe(
      false
    );
    expect(
      await adjustFlightAvailability(adjustment(5, { flightId: 404 }))
    ).toBe(false);
    expect(await db.select().from(schema.outbox)).toEqual([]);
    const [flight] = await db
      .select()
      .from(schema.flights)
      .where(eq(schema.flights.id, 41));
    expect(flight.economyAvailable).toBe(8);
  });

  it("rolls back an adjustment when its native outbox insert fails and allows a clean retry", async () => {
    await rejectInsert(schema.outbox, async () => {
      await expect(adjustFlightAvailability(adjustment(5))).rejects.toThrow();
      const [flight] = await db
        .select()
        .from(schema.flights)
        .where(eq(schema.flights.id, 41));
      expect(flight.economyAvailable).toBe(8);
      expect(await db.select().from(schema.outbox)).toEqual([]);
    });
    expect(await adjustFlightAvailability(adjustment(5))).toBe(true);
    expect(await db.select().from(schema.outbox)).toHaveLength(1);
  });

  it("creates a canonical lock and alias atomically and reports their effective availability once", async () => {
    const result = await allocateSeats(41, "economy", 3, 9, "native-full");
    expect(result).toMatchObject({ success: true, seatsAllocated: 3 });
    const locks = await db.select().from(schema.inventoryLocks);
    const aliases = await db.select().from(schema.seatHolds);
    expect(locks).toHaveLength(1);
    expect(aliases).toHaveLength(1);
    expect(aliases[0]).toMatchObject({
      inventoryLockId: locks[0].id,
      seats: 3,
      userId: 9,
    });
    expect(aliases[0].expiresAt).toEqual(locks[0].expiresAt);
    expect(await getInventoryStatus(41, "economy")).toMatchObject({
      heldSeats: 3,
      effectiveAvailable: 5,
    });
  });

  it("rolls back the canonical lock when the linked hold insert fails", async () => {
    await rejectInsert(schema.seatHolds, async () => {
      await expect(
        allocateSeats(41, "economy", 3, 9, "native-alias-failure")
      ).rejects.toThrow();
      expect(await db.select().from(schema.inventoryLocks)).toEqual([]);
      expect(await db.select().from(schema.seatHolds)).toEqual([]);
    });
  });

  it("rolls back a partial hold when its waitlist remainder fails, then retries without orphaned capacity", async () => {
    await rejectInsert(schema.waitlist, async () => {
      await expect(
        allocateSeats(41, "economy", 9, 9, "native-partial-failure")
      ).rejects.toThrow();
      expect(await db.select().from(schema.inventoryLocks)).toEqual([]);
      expect(await db.select().from(schema.seatHolds)).toEqual([]);
      expect(await db.select().from(schema.waitlist)).toEqual([]);
    });
    expect(
      await allocateSeats(41, "economy", 9, 9, "native-partial-failure")
    ).toMatchObject({ success: true, seatsAllocated: 8, waitlistPosition: 1 });
    expect(await db.select().from(schema.inventoryLocks)).toHaveLength(1);
    expect(await db.select().from(schema.seatHolds)).toHaveLength(1);
    const [waiting] = await db.select().from(schema.waitlist);
    expect(waiting).toMatchObject({ seats: 1, userId: 9, flightId: 41 });
  });

  it("allows exactly one competing allocation to hold the last physical seat", async () => {
    await db
      .update(schema.flights)
      .set({ economySeats: 1, economyAvailable: 1 })
      .where(eq(schema.flights.id, 41));
    const results = await Promise.allSettled([
      allocateSeats(41, "economy", 1, 9, "native-last-a"),
      allocateSeats(41, "economy", 1, 10, "native-last-b"),
    ]);
    expect(
      results.filter(
        result => result.status === "fulfilled" && result.value.success
      )
    ).toHaveLength(1);
    for (const result of results)
      if (result.status === "rejected")
        expect(result.reason).toMatchObject({ code: "BAD_REQUEST" });
    expect(await db.select().from(schema.inventoryLocks)).toHaveLength(1);
    expect(await db.select().from(schema.seatHolds)).toHaveLength(1);
    expect(await getInventoryStatus(41, "economy")).toMatchObject({
      heldSeats: 1,
      effectiveAvailable: 0,
    });
  });

  it("serializes a concurrent reduction against a new hold so neither promise is invalidated", async () => {
    await db
      .update(schema.flights)
      .set({ economySeats: 2, economyAvailable: 2 })
      .where(eq(schema.flights.id, 41));
    const [allocation, adjustmentResult] = await Promise.allSettled([
      allocateSeats(41, "economy", 2, 9, "native-adjust-race"),
      adjustFlightAvailability(adjustment(0)),
    ]);
    const successes =
      Number(allocation.status === "fulfilled" && allocation.value.success) +
      Number(adjustmentResult.status === "fulfilled" && adjustmentResult.value);
    expect(successes).toBe(1);
    const [flight] = await db
      .select()
      .from(schema.flights)
      .where(eq(schema.flights.id, 41));
    const locks = await db.select().from(schema.inventoryLocks);
    expect(
      locks.reduce((sum, lock) => sum + lock.numberOfSeats, 0)
    ).toBeLessThanOrEqual(flight.economyAvailable);
  });
});
