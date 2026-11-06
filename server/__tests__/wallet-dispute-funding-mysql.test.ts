import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
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
import { forensicFindings } from "../../scripts/ci/forensic-data-audit";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => state.db }));
// Synthetic verified-provider inputs only. No provider client or credentials.
vi.mock("../stripe", () => ({ stripe: {} }));
import { payFromWallet } from "../services/wallet.service";
import {
  recordVerifiedDispute,
  type DisputeEventType,
} from "../services/payment-dispute.service";
import {
  settleVerifiedPayment,
  settleVerifiedRefund,
} from "../services/payment-settlement.service";

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

nativeDescribe("wallet dispute funding on native MySQL", () => {
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
        "Dispute acceptance requires a loopback disposable _test database"
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
    databaseName = `ais_dispute_${randomBytes(6).toString("hex")}`;
    await admin.query(`CREATE DATABASE \`${databaseName}\``);
    created = true;
    // Real migrated types/defaults/indexes. LIKE omits foreign keys; migration
    // replay owns those separately. Only this newly owned schema is mutated.
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

  beforeEach(async () => {
    for (const name of tableNames)
      await pool!.query(`TRUNCATE TABLE \`${name}\``);
    await db.insert(schema.tenants).values({
      id: 3,
      slug: "synthetic-dispute",
      name: "Synthetic dispute tenant",
      status: "active",
    });
    await db.insert(schema.users).values({
      id: 9,
      openId: "native-dispute-owner",
      role: "user",
      tenantId: 3,
    });
    await db
      .insert(schema.airlines)
      .values({ id: 3, code: "ND", name: "Native dispute test airline" });
    await db.insert(schema.airports).values(
      [1, 2].map(id => ({
        id,
        code: id === 1 ? "NDA" : "NDB",
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
      flightNumber: "ND041",
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
      balance: 0,
      currency: "SAR",
      status: "active",
    });
    await db.insert(schema.bookings).values(
      [71, 72].map(id => ({
        id,
        tenantId: 3,
        userId: 9,
        flightId: 41,
        bookingReference: `ND00${id}`,
        pnr: `PD00${id}`,
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
        lastName: `Dispute${id}`,
        type: "adult" as const,
      }))
    );
    await db.insert(schema.walletTransactions).values({
      id: 10,
      walletId: 1,
      userId: 9,
      type: "top_up",
      amount: 10000,
      balanceAfter: 0,
      description: "Synthetic disputed top-up",
      status: "pending",
    });
    await db.transaction(tx =>
      settleVerifiedPayment(tx, {
        paymentIntentId: "pi_dispute",
        eventId: "evt_topup",
        amount: 10000,
        currency: "SAR",
        metadata: { type: "wallet_topup", topUpId: "10", userId: "9" },
      })
    );
  });

  const withdrawal = (
    eventId = "evt_withdrawn",
    eventType: DisputeEventType = "charge.dispute.funds_withdrawn"
  ) =>
    db.transaction(tx =>
      recordVerifiedDispute(tx, {
        eventId,
        eventType,
        disputeId: "dp_dispute",
        chargeId: "ch_dispute",
        paymentIntentId: "pi_dispute",
        amount: 10000,
        currency: "SAR",
        status: eventType.endsWith("reinstated") ? "won" : "under_review",
        reason: "fraudulent",
      })
    );
  const refund = (amountRefunded = 10000, eventId = "evt_refund") =>
    db.transaction(tx =>
      settleVerifiedRefund(tx, {
        paymentIntentId: "pi_dispute",
        chargeId: "ch_dispute",
        amount: 10000,
        amountRefunded,
        currency: "SAR",
        eventId,
      })
    );
  const wallet = async () =>
    (
      await db.select().from(schema.wallets).where(eq(schema.wallets.id, 1))
    )[0]!;
  const adjustments = async () =>
    (await db.select().from(schema.walletTransactions)).filter(
      row => row.type !== "top_up"
    );

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

  async function cross(
    first: () => Promise<unknown>,
    second: () => Promise<unknown>
  ) {
    const blocker = await pool!.getConnection();
    const operations: Array<Promise<Awaited<ReturnType<typeof observe>>>> = [];
    let results: Array<Awaited<ReturnType<typeof observe>>> = [];
    try {
      await blocker.beginTransaction();
      await blocker.query("SELECT id FROM wallets WHERE id=1 FOR UPDATE");
      operations.push(observe(first()));
      await waitForBlockedTransactions(1);
      operations.push(observe(second()));
      await waitForBlockedTransactions(2);
    } finally {
      await blocker.commit();
      blocker.release();
      results = await Promise.all(operations);
    }
    return results;
  }

  it("blocks new spending after withdrawal and permits a single reinstatement", async () => {
    await withdrawal();
    expect(await wallet()).toMatchObject({ balance: 0, status: "active" });
    await expect(payFromWallet(9, 71, 10000)).rejects.toThrow(
      "Insufficient active wallet balance"
    );
    await withdrawal("evt_reinstated", "charge.dispute.funds_reinstated");
    await withdrawal("evt_reinstated", "charge.dispute.funds_reinstated");
    await withdrawal(
      "evt_duplicate_reinstatement",
      "charge.dispute.funds_reinstated"
    );
    await withdrawal("evt_delayed_withdrawal");
    expect((await wallet()).balance).toBe(10000);
    await expect(payFromWallet(9, 71, 10000)).resolves.toMatchObject({
      amountPaid: 10000,
      balance: 0,
    });
    expect((await adjustments()).map(row => row.amount)).toEqual([
      -10000, 10000, -10000,
    ]);
  });

  it("deduplicates concurrent retries and distinct events for the same cash movement", async () => {
    await Promise.all([
      withdrawal(),
      withdrawal(),
      withdrawal("evt_equivalent"),
    ]);
    expect((await wallet()).balance).toBe(0);
    expect(await adjustments()).toHaveLength(1);
    const rows = (await db.select().from(schema.financialLedger)).filter(
      row => row.type === "adjustment"
    );
    expect(rows).toHaveLength(2);
    expect(
      rows.map(row => JSON.parse(row.metadata!).walletFunding.adjustment).sort()
    ).toEqual([-10000, 0]);
    expect(
      (await db.select().from(schema.outbox)).filter(
        row => row.eventType === "payment.disputed"
      )
    ).toHaveLength(2);
  });

  it.each(["refund-first", "dispute-first"] as const)(
    "reconciles actual overlapping refund and dispute boundaries (%s)",
    async ordering => {
      const first =
        ordering === "refund-first" ? () => refund() : () => withdrawal();
      const second =
        ordering === "refund-first" ? () => withdrawal() : () => refund();
      const results = await cross(first, second);
      expect(
        results.map(result =>
          result.status === "fulfilled" ? "fulfilled" : String(result.reason)
        )
      ).toEqual(["fulfilled", "fulfilled"]);
      expect(await wallet()).toMatchObject({ balance: 0, status: "active" });
      expect(await adjustments()).toHaveLength(1);
      await refund();
      await withdrawal();
      await withdrawal("evt_restored", "charge.dispute.funds_reinstated");
      expect((await wallet()).balance).toBe(0);
      expect(await adjustments()).toHaveLength(1);
      await expect(payFromWallet(9, 71, 10000)).rejects.toThrow(
        "Insufficient active wallet balance"
      );
    }
  );

  it("restores only the unrefunded principal after an actual partial refund", async () => {
    await withdrawal();
    await refund(4000);
    expect((await wallet()).balance).toBe(0);
    await withdrawal("evt_restored", "charge.dispute.funds_reinstated");
    expect((await wallet()).balance).toBe(6000);
    expect((await adjustments()).map(row => row.amount)).toEqual([
      -10000, 6000,
    ]);
  });

  it.each(["withdrawal-first", "payment-first"] as const)(
    "serializes withdrawal against actual wallet spending (%s)",
    async ordering => {
      const pay = () => payFromWallet(9, 71, 10000);
      const first = ordering === "withdrawal-first" ? () => withdrawal() : pay;
      const second = ordering === "withdrawal-first" ? pay : () => withdrawal();
      const results = await cross(first, second);
      expect(results[0]?.status).toBe("fulfilled");
      if (ordering === "withdrawal-first") {
        expect(results[1]).toMatchObject({
          status: "rejected",
          reason: expect.objectContaining({
            message: "Insufficient active wallet balance",
          }),
        });
        expect(await wallet()).toMatchObject({ balance: 0, status: "active" });
        expect((await db.select().from(schema.bookings))[0]).toMatchObject({
          status: "pending",
          paymentStatus: "pending",
          seatsReserved: false,
        });
        expect(
          (await db.select().from(schema.flights))[0]?.economyAvailable
        ).toBe(8);
      } else {
        expect(results[1]?.status).toBe("fulfilled");
        expect(await wallet()).toMatchObject({
          balance: -10000,
          status: "frozen",
        });
        expect((await db.select().from(schema.bookings))[0]).toMatchObject({
          status: "confirmed",
          paymentStatus: "paid",
          seatsReserved: true,
        });
        expect(
          (await db.select().from(schema.flights))[0]?.economyAvailable
        ).toBe(7);
        await expect(payFromWallet(9, 72, 10000)).rejects.toThrow(
          "Insufficient active wallet balance"
        );
        await expect(payFromWallet(9, 71, 10000)).resolves.toMatchObject({
          amountPaid: 10000,
        });
      }
    }
  );

  it("blocks historical evidence without a wallet debit and repairs only with explicit reconciliation", async () => {
    const auditSql = forensicFindings.find(
      finding => finding.id === "wallet_dispute_projection_review"
    )!.sql;
    await db.insert(schema.financialLedger).values({
      bookingId: null,
      userId: 9,
      type: "adjustment",
      amount: "-100.00",
      currency: "SAR",
      stripePaymentIntentId: "pi_dispute",
      stripeEventId: "evt_legacy",
      description: "Provider dispute funds_withdrawn",
      metadata: JSON.stringify({
        disputeId: "dp_dispute",
        eventType: "charge.dispute.funds_withdrawn",
        status: "under_review",
        reason: "fraudulent",
      }),
    });
    const [beforeReview] = await db.execute(sql.raw(auditSql));
    expect(beforeReview).toHaveLength(1);
    expect(JSON.stringify(beforeReview)).not.toContain("pi_dispute");
    await expect(payFromWallet(9, 71, 10000)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("requires reconciliation"),
    });
    expect((await wallet()).balance).toBe(10000);
    expect(await adjustments()).toHaveLength(0);
    await withdrawal("evt_legacy");
    const [afterReview] = await db.execute(sql.raw(auditSql));
    expect(afterReview).toHaveLength(0);
    expect((await wallet()).balance).toBe(0);
    expect(await adjustments()).toHaveLength(1);
    expect(
      (await db.select().from(schema.outbox)).filter(
        row => row.eventType === "payment.disputed"
      )
    ).toHaveLength(0);
  });
});
