import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  afterAll,
  afterEach,
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
// This suite starts at the verified-provider settlement boundary. It never
// creates a checkout or claims to verify an external provider signature.
vi.mock("../stripe", () => ({ stripe: {} }));
import { payFromWallet } from "../services/wallet.service";
import { settleVerifiedPayment } from "../services/payment-settlement.service";
import { refundInternalFunding } from "../services/internal-refund.service";

const enabled =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  Boolean(process.env.DATABASE_URL);
const nativeDescribe = enabled ? describe : describe.skip;
const observe = <T>(promise: Promise<T>) =>
  promise.then(
    value => ({ status: "fulfilled" as const, value }),
    reason => ({ status: "rejected" as const, reason })
  );

nativeDescribe("wallet funding crosses real native MySQL transactions", () => {
  let admin: mysql.Connection | null = null;
  let pool: mysql.Pool | null = null;
  let db: MySql2Database<typeof schema>;
  let databaseName = "";
  let created = false;
  let tableNames: string[] = [];

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    const source = url.pathname.slice(1);
    if (
      !/^[A-Za-z0-9_]+_test$/.test(source) ||
      !["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)
    )
      throw new Error(
        "Wallet acceptance requires a loopback disposable _test database"
      );
    const options = {
      host: url.hostname.replace(/^\[|\]$/g, ""),
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      timezone: "Z",
    };
    admin = await mysql.createConnection(options);
    const [tables] = await admin.query<mysql.RowDataPacket[]>(
      "SELECT TABLE_NAME AS name FROM information_schema.tables WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE'",
      [source]
    );
    tableNames = tables.map(row => String(row.name));
    if (
      !tableNames.length ||
      tableNames.some(name => !/^[A-Za-z0-9_]+$/.test(name))
    )
      throw new Error("Invalid migrated fixture table catalog");
    databaseName = `ais_wallet_${randomBytes(6).toString("hex")}`;
    await admin.query(`CREATE DATABASE \`${databaseName}\``);
    created = true;
    // Preserve real migrated column types, defaults and unique indexes. LIKE
    // omits foreign keys; migration replay separately verifies those constraints.
    for (const name of tableNames)
      await admin.query(
        `CREATE TABLE \`${databaseName}\`.\`${name}\` LIKE \`${source}\`.\`${name}\``
      );
    pool = mysql.createPool({
      ...options,
      database: databaseName,
      connectionLimit: 8,
    });
    db = drizzle(pool, { schema, mode: "default" });
    state.db = db;
    const [settings] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT @@SESSION.sql_mode AS mode"
    );
    expect(settings[0]?.mode).toContain("STRICT_TRANS_TABLES");
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

  // Truncating every table and dropping triggers is DDL on a shared CI MySQL;
  // under load it has exceeded the default 10 s hook budget, failing one case
  // on the timeout and the next on the fixtures it left behind. Give the hooks
  // the same budget as setup.
  afterEach(async () => {
    await pool?.query("DROP TRIGGER IF EXISTS ais_wallet_fail_confirmation");
    await pool?.query("DROP TRIGGER IF EXISTS ais_wallet_fail_topup");
  }, 60000);

  beforeEach(async () => {
    for (const name of tableNames)
      await pool!.query(`TRUNCATE TABLE \`${name}\``);
    await db.insert(schema.tenants).values({
      id: 3,
      slug: "synthetic-wallet",
      name: "Synthetic wallet tenant",
      status: "active",
    });
    await db.insert(schema.users).values([
      { id: 9, openId: "native-wallet-owner", role: "user", tenantId: 3 },
      { id: 10, openId: "native-wallet-finance", role: "finance", tenantId: 3 },
    ]);
    await db
      .insert(schema.airlines)
      .values({ id: 3, code: "NW", name: "Native wallet test airline" });
    await db.insert(schema.airports).values(
      [1, 2].map(id => ({
        id,
        code: id === 1 ? "NWA" : "NWB",
        name: `Native airport ${id}`,
        city: "Synthetic",
        country: "SA",
        timezone: "UTC",
      }))
    );
    await db.insert(schema.flights).values({
      id: 41,
      tenantId: 3,
      airlineId: 3,
      flightNumber: "NW041",
      originId: 1,
      destinationId: 2,
      departureTime: new Date("2030-06-10T12:00:00Z"),
      arrivalTime: new Date("2030-06-10T14:00:00Z"),
      economySeats: 8,
      economyAvailable: 8,
      economyPrice: 10000,
      businessSeats: 2,
      businessAvailable: 2,
      businessPrice: 20000,
    });
    await db.insert(schema.wallets).values({
      id: 1,
      userId: 9,
      balance: 20000,
      currency: "SAR",
      status: "active",
    });
    await db.insert(schema.bookings).values(
      [71, 72].map(id => ({
        id,
        tenantId: 3,
        userId: 9,
        flightId: 41,
        bookingReference: `NW00${id}`,
        pnr: `PN00${id}`,
        totalAmount: 10000,
        cabinClass: "economy" as const,
        numberOfPassengers: 1,
        status: "pending" as const,
        paymentStatus: "pending" as const,
      }))
    );
    await db.insert(schema.passengers).values(
      [71, 72].map(id => ({
        id: id + 10,
        tenantId: 3,
        bookingId: id,
        firstName: "Native",
        lastName: `Wallet${id}`,
        type: "adult" as const,
      }))
    );
  }, 60000);

  async function pendingTopUp(amount = 5000) {
    const [inserted] = await db.insert(schema.walletTransactions).values({
      walletId: 1,
      userId: 9,
      type: "top_up",
      amount,
      balanceAfter: 20000,
      description: "Synthetic pending provider top-up",
      status: "pending",
    });
    return {
      paymentIntentId: `pi_wallet_${inserted.insertId}`,
      eventId: `evt_wallet_${inserted.insertId}`,
      amount,
      currency: "SAR",
      metadata: {
        type: "wallet_topup",
        topUpId: String(inserted.insertId),
        userId: "9",
      },
    };
  }

  async function balance() {
    return (
      await db.select().from(schema.wallets).where(eq(schema.wallets.id, 1))
    )[0]!.balance;
  }

  async function snapshot() {
    return {
      wallet: await db.select().from(schema.wallets),
      movements: await db.select().from(schema.walletTransactions),
      bookings: await db.select().from(schema.bookings),
      flights: await db.select().from(schema.flights),
      ledger: await db.select().from(schema.financialLedger),
      receipts: await db.select().from(schema.paymentReceipts),
      outbox: await db.select().from(schema.outbox),
      history: await db.select().from(schema.bookingStatusHistory),
    };
  }

  async function waitForBlockedTransactions(count: number) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const [rows] = await admin!.query<mysql.RowDataPacket[]>(
        "SELECT COUNT(DISTINCT w.REQUESTING_ENGINE_TRANSACTION_ID) AS waiting FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE=w.ENGINE AND l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID WHERE l.OBJECT_SCHEMA=?",
        [databaseName]
      );
      if (Number(rows[0]?.waiting) >= count) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(
      `Expected ${count} real InnoDB transactions waiting on owned fixture locks`
    );
  }

  function expectBothSucceeded(
    results: Array<Awaited<ReturnType<typeof observe>>>
  ) {
    expect(
      results.map(result =>
        result.status === "fulfilled"
          ? "fulfilled"
          : String(result.reason?.cause ?? result.reason)
      )
    ).toEqual(["fulfilled", "fulfilled"]);
  }

  it.each(["payment-first", "topup-first"] as const)(
    "conserves balance with verified top-up and payment queued %s",
    async ordering => {
      const payment = await pendingTopUp();
      const blocker = await pool!.getConnection();
      const operations: Array<Promise<Awaited<ReturnType<typeof observe>>>> =
        [];
      let results: Array<Awaited<ReturnType<typeof observe>>> = [];
      const pay = () => payFromWallet(9, 71);
      const topup = () =>
        db.transaction(tx => settleVerifiedPayment(tx, payment));
      try {
        await blocker.beginTransaction();
        await blocker.query("SELECT id FROM wallets WHERE id=1 FOR UPDATE");
        operations.push(
          observe<unknown>(ordering === "payment-first" ? pay() : topup())
        );
        await waitForBlockedTransactions(1);
        operations.push(
          observe<unknown>(ordering === "payment-first" ? topup() : pay())
        );
        await waitForBlockedTransactions(2);
      } finally {
        await blocker.commit();
        blocker.release();
        results = await Promise.all(operations);
      }
      expectBothSucceeded(results);
      expect(await balance()).toBe(15000);
      expect(
        (await db.select().from(schema.walletTransactions))
          .map(row => [row.type, row.amount, row.status])
          .sort()
      ).toEqual([
        ["payment", -10000, "completed"],
        ["top_up", 5000, "completed"],
      ]);
      expect(await db.select().from(schema.paymentReceipts)).toHaveLength(1);
      expect(await db.select().from(schema.financialLedger)).toHaveLength(2);
      expect(await db.select().from(schema.outbox)).toMatchObject([
        { eventType: "booking.confirmed", aggregateId: "71" },
      ]);
      const beforeReplay = await snapshot();
      await Promise.all([pay(), topup()]);
      expect(await snapshot()).toEqual(beforeReplay);
    }
  );

  it("serializes competing spends and never overdraws the wallet", async () => {
    await db.update(schema.wallets).set({ balance: 10000 });
    const results = await Promise.allSettled([
      payFromWallet(9, 71),
      payFromWallet(9, 72),
    ]);
    expect(
      results.filter(result => result.status === "fulfilled")
    ).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(
      1
    );
    const rejected = results.find(
      result => result.status === "rejected"
    ) as PromiseRejectedResult;
    expect(String(rejected.reason)).toMatch(
      /Insufficient active wallet balance/
    );
    expect(await balance()).toBe(0);
    expect(await db.select().from(schema.financialLedger)).toHaveLength(1);
    expect(await db.select().from(schema.walletTransactions)).toHaveLength(1);
    expect(await db.select().from(schema.outbox)).toHaveLength(1);
    expect(
      (await db.select().from(schema.bookings)).filter(
        row => row.paymentStatus === "paid"
      )
    ).toHaveLength(1);
    expect((await db.select().from(schema.flights))[0]?.economyAvailable).toBe(
      7
    );
  });

  it("credits a duplicate verified top-up once and rejects a changed provider identity", async () => {
    const payment = await pendingTopUp();
    await Promise.all([
      db.transaction(tx => settleVerifiedPayment(tx, payment)),
      db.transaction(tx => settleVerifiedPayment(tx, payment)),
    ]);
    expect(await balance()).toBe(25000);
    expect(await db.select().from(schema.paymentReceipts)).toHaveLength(1);
    expect(await db.select().from(schema.financialLedger)).toHaveLength(1);
    const before = await snapshot();
    await expect(
      db.transaction(tx =>
        settleVerifiedPayment(tx, {
          ...payment,
          paymentIntentId: "pi_wallet_other",
        })
      )
    ).rejects.toThrow(/already funded/);
    expect(await snapshot()).toEqual(before);
  });

  it("rolls back wallet, invoice, capacity, ledger and outbox together after a native write failure, then replays once", async () => {
    const before = await snapshot();
    await pool!.query(
      "CREATE TRIGGER ais_wallet_fail_confirmation BEFORE INSERT ON outbox FOR EACH ROW BEGIN IF NEW.eventType='booking.confirmed' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic wallet confirmation failure'; END IF; END"
    );
    try {
      await expect(payFromWallet(9, 71)).rejects.toMatchObject({
        cause: {
          sqlState: "45000",
          sqlMessage: "synthetic wallet confirmation failure",
        },
      });
    } finally {
      await pool!.query("DROP TRIGGER ais_wallet_fail_confirmation");
    }
    expect(await snapshot()).toEqual(before);
    const paid = await payFromWallet(9, 71);
    expect(paid).toEqual({ balance: 10000, amountPaid: 10000 });
    const committed = await snapshot();
    expect(await payFromWallet(9, 71)).toEqual(paid);
    expect(await snapshot()).toEqual(committed);
  });

  it("rolls back a top-up receipt and balance after native failure, then settles once", async () => {
    const payment = await pendingTopUp();
    const before = await snapshot();
    await pool!.query(
      "CREATE TRIGGER ais_wallet_fail_topup BEFORE UPDATE ON wallet_transactions FOR EACH ROW BEGIN IF NEW.type='top_up' AND NEW.status='completed' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic wallet topup failure'; END IF; END"
    );
    try {
      await expect(
        db.transaction(tx => settleVerifiedPayment(tx, payment))
      ).rejects.toMatchObject({
        cause: {
          sqlState: "45000",
          sqlMessage: "synthetic wallet topup failure",
        },
      });
    } finally {
      await pool!.query("DROP TRIGGER ais_wallet_fail_topup");
    }
    expect(await snapshot()).toEqual(before);
    await db.transaction(tx => settleVerifiedPayment(tx, payment));
    const committed = await snapshot();
    expect(await balance()).toBe(25000);
    await db.transaction(tx => settleVerifiedPayment(tx, payment));
    expect(await snapshot()).toEqual(committed);
  });

  it("allows a refund and another wallet payment for the same owner and flight without a lock-order deadlock", async () => {
    await payFromWallet(9, 71);
    const request = {
      bookingId: 71,
      amount: 10000,
      requestId: randomUUID(),
      approvalReference: "native-finance-approval",
      reason: "Native approved wallet cancellation",
      cancelItinerary: true,
    };
    const blocker = await pool!.getConnection();
    const operations: Array<Promise<Awaited<ReturnType<typeof observe>>>> = [];
    let results: Array<Awaited<ReturnType<typeof observe>>> = [];
    try {
      await blocker.beginTransaction();
      await blocker.query("SELECT id FROM flights WHERE id=41 FOR UPDATE");
      // Refund queues for inventory first. The later payment must wait on the
      // shared owner before taking its wallet, rather than invert these locks.
      operations.push(observe(refundInternalFunding(request, 10)));
      await waitForBlockedTransactions(1);
      operations.push(observe(payFromWallet(9, 72)));
      await waitForBlockedTransactions(2);
    } finally {
      await blocker.commit();
      blocker.release();
      results = await Promise.all(operations);
    }
    expectBothSucceeded(results);
    expect(await balance()).toBe(10000);
    expect((await db.select().from(schema.flights))[0]?.economyAvailable).toBe(
      7
    );
    expect(
      (
        await db
          .select()
          .from(schema.bookings)
          .where(eq(schema.bookings.id, 71))
      )[0]
    ).toMatchObject({
      status: "cancelled",
      paymentStatus: "refunded",
      seatsReserved: false,
    });
    expect(
      (
        await db
          .select()
          .from(schema.bookings)
          .where(eq(schema.bookings.id, 72))
      )[0]
    ).toMatchObject({
      status: "confirmed",
      paymentStatus: "paid",
      seatsReserved: true,
    });
    expect(await db.select().from(schema.financialLedger)).toHaveLength(3);
    const committed = await snapshot();
    await refundInternalFunding(request, 10);
    await payFromWallet(9, 72);
    expect(await snapshot()).toEqual(committed);
  });
});
