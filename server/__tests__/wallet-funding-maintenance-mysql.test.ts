import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { eq, getTableName } from "drizzle-orm";
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
} from "vitest";
import * as schema from "../../drizzle/schema";
import {
  applyWalletFundingMaintenance,
  previewWalletFundingMaintenance,
} from "../services/wallet-funding-maintenance.service";

const enabled =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  Boolean(process.env.DATABASE_URL);
const nativeDescribe = enabled ? describe : describe.skip;
const run = promisify(execFile);
const scope = { actorId: 10, userId: 9, paymentIntentIds: ["pi_maintenance"] };
const tables = [
  schema.users,
  schema.wallets,
  schema.walletTransactions,
  schema.paymentReceipts,
  schema.financialLedger,
  schema.stripeEvents,
  schema.auditLogs,
  schema.accountLocks,
  schema.accountDeletionRequests,
];
const observed = <T>(promise: Promise<T>) =>
  promise.then(
    value => ({ status: "fulfilled" as const, value }),
    reason => ({ status: "rejected" as const, reason })
  );

nativeDescribe("scoped wallet maintenance on owned native MySQL", () => {
  let admin: mysql.Connection | null = null;
  let pool: mysql.Pool | null = null;
  let db: MySql2Database<typeof schema>;
  let databaseName = "";
  let databaseUrl = "";
  let created = false;
  let scratch = "";
  let scopePath = "";

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    const source = url.pathname.slice(1);
    if (
      !/^[A-Za-z0-9_]+_test$/.test(source) ||
      !["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)
    )
      throw new Error(
        "Wallet maintenance acceptance requires a loopback disposable _test database"
      );
    const options = {
      host: url.hostname.replace(/^\[|\]$/g, ""),
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      timezone: "Z",
    };
    admin = await mysql.createConnection(options);
    databaseName = `ais_wallet_maintenance_${randomBytes(6).toString("hex")}`;
    await admin.query(`CREATE DATABASE \`${databaseName}\``);
    created = true;
    // LIKE preserves actual migrated defaults/types/indexes but omits foreign keys.
    // Only this newly owned schema is changed; migrations are tested separately.
    for (const table of tables) {
      const name = getTableName(table);
      await admin.query(
        `CREATE TABLE \`${databaseName}\`.\`${name}\` LIKE \`${source}\`.\`${name}\``
      );
    }
    pool = mysql.createPool({
      ...options,
      database: databaseName,
      connectionLimit: 8,
    });
    db = drizzle(pool, { schema, mode: "default" });
    url.pathname = `/${databaseName}`;
    databaseUrl = url.toString();
    scratch = await mkdtemp(join(tmpdir(), "ais-wallet-maintenance-"));
    scopePath = join(scratch, "scope.json");
    await writeFile(scopePath, JSON.stringify(scope), { mode: 0o600 });
    const [settings] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT @@SESSION.sql_mode AS mode"
    );
    expect(settings[0]?.mode).toContain("STRICT_TRANS_TABLES");
  }, 60000);

  afterEach(async () => {
    await pool?.query("DROP TRIGGER IF EXISTS ais_maintenance_fail_audit");
  });
  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) {
      try {
        if (created) await admin.query(`DROP DATABASE \`${databaseName}\``);
      } finally {
        await admin.end();
      }
    }
    if (scratch) await rm(scratch, { recursive: true, force: true });
  });

  beforeEach(async () => {
    for (const table of tables)
      await pool!.query(`TRUNCATE TABLE \`${getTableName(table)}\``);
    await db.insert(schema.users).values([
      {
        id: 9,
        openId: "synthetic-maintenance-owner",
        role: "user",
        tenantId: 3,
      },
      {
        id: 10,
        openId: "synthetic-maintenance-finance",
        role: "finance",
        tenantId: 3,
      },
    ]);
    await db.insert(schema.wallets).values({
      id: 1,
      userId: 9,
      balance: 10000,
      currency: "SAR",
      status: "active",
    });
    await db.insert(schema.walletTransactions).values({
      id: 100,
      walletId: 1,
      userId: 9,
      type: "top_up",
      amount: 10000,
      balanceAfter: 10000,
      status: "completed",
      stripePaymentIntentId: "pi_maintenance",
      description: "Synthetic legacy funding",
    });
    await db.insert(schema.paymentReceipts).values({
      paymentIntentId: "pi_maintenance",
      kind: "wallet_topup",
      targetId: 100,
      userId: 9,
      bookingId: null,
      amount: 10000,
      refundedAmount: 0,
      currency: "SAR",
      settlementStatus: "applied",
    });
    await db.insert(schema.financialLedger).values([
      {
        id: 1,
        userId: 9,
        bookingId: null,
        type: "charge",
        amount: "100.00",
        currency: "SAR",
        stripePaymentIntentId: "pi_maintenance",
        stripeEventId: "evt_maintenance_topup",
        description: "wallet_topup payment 100",
      },
      {
        id: 2,
        userId: 9,
        bookingId: null,
        type: "adjustment",
        amount: "-100.00",
        currency: "SAR",
        stripePaymentIntentId: "pi_maintenance",
        stripeEventId: "evt_maintenance_legacy",
        stripeChargeId: "ch_maintenance",
        description: "Provider dispute funds_withdrawn",
        metadata: JSON.stringify({
          disputeId: "dp_maintenance",
          eventType: "charge.dispute.funds_withdrawn",
          status: "under_review",
          reason: "fraudulent",
          providerExtra: "retain original metadata",
        }),
      },
    ]);
    // Synthetic persisted verification authority, deliberately stopping before
    // a wallet debit to model the historical evidence-only implementation.
    await db.insert(schema.stripeEvents).values({
      id: "evt_maintenance_legacy",
      type: "charge.dispute.funds_withdrawn",
      processed: true,
      processedAt: new Date("2026-10-01T12:00:00Z"),
      error: null,
      data: JSON.stringify({
        object: "dispute",
        id: "dp_maintenance",
        charge: "ch_maintenance",
        payment_intent: "pi_maintenance",
        amount: 10000,
        currency: "sar",
        status: "under_review",
        reason: "fraudulent",
      }),
    });
  });

  async function snapshot() {
    return {
      wallet: await db.select().from(schema.wallets),
      movements: await db.select().from(schema.walletTransactions),
      ledger: await db.select().from(schema.financialLedger),
      receipts: await db.select().from(schema.paymentReceipts),
      providerEvents: await db.select().from(schema.stripeEvents),
      audit: await db.select().from(schema.auditLogs),
    };
  }
  const preview = () => previewWalletFundingMaintenance(db, scope);
  const apply = (approvedDigest: string) =>
    applyWalletFundingMaintenance(db, scope, {
      approvedDigest,
      approvalReference: "NATIVE-MAINTENANCE-APPROVAL",
    });

  async function cli(options: string[] = []) {
    const result = await run(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve("scripts/db/reconcile-wallet-funding.ts"),
        scopePath,
        ...options,
      ],
      {
        cwd: process.cwd(),
        timeout: 20000,
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "test",
          // The CLI pins MySQL timestamps to UTC regardless of operator locale.
          TZ: "Pacific/Honolulu",
          DATABASE_URL: databaseUrl,
          AIS_PROVIDER_BOUNDARY: "isolated",
        },
      }
    );
    return JSON.parse(result.stdout);
  }

  it("runs the real CLI as read-only by default, then applies and replays an exact approval", async () => {
    const before = await snapshot();
    const planned = await cli();
    expect(planned).toMatchObject({
      mode: "preview",
      sourceCounts: { receipts: 1, ledgerRows: 2, providerEvents: 1 },
      wallet: { balanceBefore: 10000, projectedBalance: 0 },
    });
    expect(await snapshot()).toEqual(before);
    expect(planned.digest).toBe((await preview()).digest);
    const args = [
      `--apply=${planned.digest}`,
      "--approval-reference=NATIVE-CLI-APPROVAL",
    ];
    const applied = await cli(args);
    expect(applied.mode).toBe("applied");
    const after = await snapshot();
    expect(after.wallet[0]).toMatchObject({ balance: 0, status: "active" });
    expect(after.movements).toHaveLength(2);
    expect(after.ledger).toHaveLength(2);
    expect(after.providerEvents).toEqual(before.providerEvents);
    expect(JSON.parse(after.ledger[1]!.metadata!)).toMatchObject({
      providerExtra: "retain original metadata",
      walletFunding: { adjustment: -10000 },
    });
    expect(after.audit).toHaveLength(1);
    expect(await cli(args)).toEqual(applied);
    expect(await snapshot()).toEqual(after);
  });

  it("commits concurrent approved retries once with one audit receipt", async () => {
    const planned = await preview();
    const [first, second] = await Promise.all([
      apply(planned.digest),
      apply(planned.digest),
    ]);
    expect(second).toEqual(first);
    const after = await snapshot();
    expect(after.wallet[0]?.balance).toBe(0);
    expect(after.movements).toHaveLength(2);
    expect(after.audit).toHaveLength(1);
  });

  it("rolls back wallet, movement and marker when the atomic audit insert fails", async () => {
    const planned = await preview();
    const before = await snapshot();
    await pool!.query(
      "CREATE TRIGGER ais_maintenance_fail_audit BEFORE INSERT ON audit_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Synthetic maintenance audit failure'"
    );
    await expect(apply(planned.digest)).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });

  it("rechecks source balance after a real wallet lock wait instead of accepting the discovery snapshot", async () => {
    const planned = await preview();
    const blocker = await pool!.getConnection();
    await blocker.beginTransaction();
    await blocker.query("SELECT id FROM wallets WHERE id=1 FOR UPDATE");
    const running = observed(apply(planned.digest));
    try {
      let waiting = false;
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        const [rows] = await admin!.query<mysql.RowDataPacket[]>(
          "SELECT COUNT(*) AS waiting FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE=w.ENGINE AND l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID WHERE l.OBJECT_SCHEMA=?",
          [databaseName]
        );
        if (Number(rows[0]?.waiting) > 0) {
          waiting = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      await blocker.query("UPDATE wallets SET balance=9000 WHERE id=1");
    } finally {
      await blocker.commit();
      blocker.release();
    }
    const result = await running;
    expect(result).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({
        message: expect.stringContaining("source digest changed"),
      }),
    });
    const after = await snapshot();
    expect(after.wallet[0]?.balance).toBe(9000);
    expect(after.movements).toHaveLength(1);
    expect(after.audit).toHaveLength(0);
    expect(
      JSON.parse(after.ledger[1]!.metadata!).walletFunding
    ).toBeUndefined();
  });

  it("denies an actor lock or revoked finance role even on approved replay", async () => {
    const planned = await preview();
    await db.insert(schema.accountLocks).values({
      userId: 10,
      reason: "Synthetic active lock",
      lockedBy: "system",
      isActive: true,
    });
    await expect(apply(planned.digest)).rejects.toThrow("actor is locked");
    await db
      .update(schema.accountLocks)
      .set({ isActive: false })
      .where(eq(schema.accountLocks.userId, 10));
    const current = await preview();
    await apply(current.digest);
    await db
      .update(schema.users)
      .set({ role: "user" })
      .where(eq(schema.users.id, 10));
    const before = await snapshot();
    await expect(apply(current.digest)).rejects.toThrow(
      "current finance actor"
    );
    expect(await snapshot()).toEqual(before);
  });

  it("refuses a cash ledger row without processed verified-event authority", async () => {
    await db
      .update(schema.stripeEvents)
      .set({ processed: false })
      .where(eq(schema.stripeEvents.id, "evt_maintenance_legacy"));
    const before = await snapshot();
    await expect(preview()).rejects.toThrow(
      "processed verified provider event"
    );
    expect(await snapshot()).toEqual(before);
  });
});
