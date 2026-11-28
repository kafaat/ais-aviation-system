import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../drizzle/schema";
import {
  inspectForensicData,
  type ForensicDataReport,
} from "../../scripts/ci/forensic-data-audit";
import { reconcileWalletFunding } from "../services/wallet-funding.service";

const nativeDescribe =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  process.env.DATABASE_URL
    ? describe
    : describe.skip;

// Only tables consumed by the audit and its focused fixtures. LIKE preserves
// native types/defaults/indexes; it does not prove foreign-key enforcement.
const tableNames = [
  "booking_ancillaries",
  "booking_modifications",
  "booking_refund_items",
  "booking_refund_plans",
  "booking_segments",
  "bookings",
  "family_group_members",
  "family_groups",
  "financial_ledger",
  "flights",
  "loyalty_accounts",
  "loyalty_credit_lots",
  "miles_transactions",
  "ndc_orders",
  "ordinary_booking_refund_parts",
  "ordinary_booking_refunds",
  "passengers",
  "payment_receipts",
  "payment_splits",
  "payments",
  "seat_holds",
  "seat_inventory",
  "ticket_coupons",
  "travel_agents",
  "users",
  "wallet_transactions",
  "wallets",
] as const;
const financialFindingIds = [
  "receipt_booking_identity_mismatch",
  "receipt_split_target_mismatch",
  "receipt_modification_target_mismatch",
  "receipt_wallet_target_mismatch",
  "wallet_transaction_owner_mismatch",
  "payment_history_duplicate_intent",
] as const;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

function expectFinding(
  report: ForensicDataReport,
  id: string,
  recordIds: Array<number | string>,
  count = recordIds.length
) {
  const finding = report.findings.find(row => row.id === id);
  expect(finding, `Missing forensic finding: ${id}`).toBeDefined();
  expect(finding).toMatchObject({
    count,
    recordIds: [...recordIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    truncated: count > recordIds.length,
    error: null,
  });
}

nativeDescribe.sequential(
  "forensic financial integrity on native MySQL",
  () => {
    let admin: mysql.Connection | undefined;
    let connection: mysql.Connection;
    let db: MySql2Database<typeof schema>;
    let databaseName = "";
    let created = false;

    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL!);
      const source = url.pathname.slice(1);
      if (
        url.protocol !== "mysql:" ||
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        !/^ais_[a-z0-9_]*test$/.test(source)
      )
        throw new Error("Requires explicit loopback ais_*test source schema");
      const options = {
        host: url.hostname.replace(/^\[|\]$/g, ""),
        port: Number(url.port || 3306),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        timezone: "Z",
        multipleStatements: false,
      };
      admin = await mysql.createConnection(options);
      databaseName = `ais_forensic_${randomBytes(6).toString("hex")}`;
      await admin.query(`CREATE DATABASE \`${databaseName}\``);
      created = true;
      for (const name of tableNames)
        await admin.query(
          `CREATE TABLE \`${databaseName}\`.\`${name}\` LIKE \`${source}\`.\`${name}\``
        );
      connection = await mysql.createConnection({
        ...options,
        database: databaseName,
      });
      db = drizzle(connection, { schema, mode: "default" });
      const [settings] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT @@SESSION.sql_mode AS mode"
      );
      expect(settings[0].mode).toContain("STRICT_TRANS_TABLES");
      expect(settings[0].mode).toContain("ONLY_FULL_GROUP_BY");
    }, 30000);

    afterAll(async () => {
      try {
        await connection?.end();
      } finally {
        try {
          if (created) await admin?.query(`DROP DATABASE \`${databaseName}\``);
        } finally {
          await admin?.end();
        }
      }
    });

    beforeEach(async () => {
      for (const name of [...tableNames].reverse())
        await connection.query(`DELETE FROM \`${name}\``);
      await db.insert(schema.users).values([
        // A later tenant reassignment does not rewrite historical purchases.
        { id: 1, openId: "audit-owner", tenantId: 8 },
        { id: 2, openId: "audit-other", tenantId: 8 },
        { id: 3, openId: "audit-legacy", tenantId: null },
      ]);
      await db.insert(schema.flights).values(
        [7, 8, null].map((tenantId, index) => ({
          id: (index + 1) * 10,
          tenantId,
          flightNumber: `AUDIT${index}`,
          airlineId: 1,
          originId: 1,
          destinationId: 2,
          departureTime: new Date("2030-01-01T00:00:00Z"),
          arrivalTime: new Date("2030-01-01T02:00:00Z"),
          economySeats: 20,
          businessSeats: 2,
          economyPrice: 1000,
          businessPrice: 2000,
          economyAvailable: 20,
          businessAvailable: 2,
        }))
      );
      await db.insert(schema.bookings).values(
        [7, 8, null].map((tenantId, index) => ({
          id: (index + 1) * 100,
          userId: index + 1,
          tenantId,
          flightId: (index + 1) * 10,
          bookingReference: `AUD00${index}`,
          pnr: `AUD00${index}`,
          totalAmount: 1000,
          cabinClass: "economy" as const,
          numberOfPassengers: 1,
        }))
      );
      await db.insert(schema.passengers).values(
        [7, 8, null].map((tenantId, index) => ({
          id: (index + 1) * 100,
          bookingId: (index + 1) * 100,
          tenantId,
          firstName: "SENSITIVE_SYNTHETIC",
          lastName: "Passenger",
          passportNumber: "PRIVATE_FIXTURE",
        }))
      );
      await db.insert(schema.paymentSplits).values(
        [100, 200].map(id => ({
          id,
          bookingId: id,
          amount: 500,
          percentage: "50.00",
          payerEmail: `payer${id}@example.invalid`,
          payerName: "Synthetic other payer",
          paymentToken: `synthetic-token-${id}`,
        }))
      );
      await db.insert(schema.bookingModifications).values(
        [100, 200].map(id => ({
          id,
          bookingId: id,
          userId: id / 100,
          modificationType: "upgrade_cabin" as const,
          originalAmount: 900,
          newAmount: 1000,
          priceDifference: 100,
          totalCost: 100,
        }))
      );
      await db.insert(schema.wallets).values([
        { id: 100, userId: 1, balance: 1000 },
        { id: 200, userId: 2, balance: 0 },
      ]);
      await db.insert(schema.walletTransactions).values([
        {
          id: 100,
          walletId: 100,
          userId: 1,
          type: "top_up",
          amount: 1000,
          balanceAfter: 1000,
          status: "completed",
          stripePaymentIntentId: "pi_wallet_original",
          description: "Synthetic original collection",
        },
        {
          id: 101,
          walletId: 100,
          userId: 1,
          type: "top_up",
          amount: 1000,
          balanceAfter: 1000,
          status: "pending",
          description: "Uncollected request legitimately has no receipt",
        },
      ]);
      await db.insert(schema.paymentReceipts).values([
        {
          paymentIntentId: "pi_booking_original",
          kind: "booking",
          bookingId: 100,
          targetId: 100,
          userId: 1,
          // The original amount can differ from the current modified invoice.
          amount: 900,
          currency: "SAR",
        },
        {
          paymentIntentId: "pi_split_original",
          kind: "split_payment",
          bookingId: 100,
          targetId: 100,
          userId: 1,
          amount: 500,
          currency: "SAR",
        },
        {
          // Another actual collection for the same target remains evidence.
          paymentIntentId: "pi_split_extra_refunded",
          kind: "split_payment",
          bookingId: 100,
          targetId: 100,
          userId: 1,
          amount: 500,
          refundedAmount: 500,
          settlementStatus: "review_refunded",
          currency: "SAR",
        },
        {
          paymentIntentId: "pi_modification_original",
          kind: "modification",
          bookingId: 100,
          targetId: 100,
          userId: 1,
          amount: 100,
          currency: "SAR",
        },
        {
          paymentIntentId: "pi_wallet_original",
          kind: "wallet_topup",
          bookingId: null,
          targetId: 100,
          userId: 1,
          amount: 1000,
          currency: "SAR",
        },
        {
          paymentIntentId: "pi_legacy_tenant",
          kind: "booking",
          bookingId: 300,
          targetId: 300,
          userId: 3,
          amount: 1000,
          currency: "SAR",
        },
      ]);
      await db.insert(schema.financialLedger).values({
        id: 100,
        userId: 1,
        type: "charge",
        amount: "10.00",
        currency: "SAR",
        stripePaymentIntentId: "pi_wallet_original",
        stripeEventId: "evt_wallet_original",
      });
    });

    async function inspect(sampleLimit = 50) {
      const report = await inspectForensicData(connection, sampleLimit);
      expect(report.findings.filter(row => row.error !== null)).toEqual([]);
      return report;
    }

    async function snapshot() {
      const result: Record<string, string[]> = {};
      for (const table of tableNames) {
        const [rows] = await connection.query<mysql.RowDataPacket[]>(
          `SELECT * FROM \`${table}\``
        );
        result[table] = rows.map(row => JSON.stringify(row)).sort();
      }
      return result;
    }

    async function receipt(
      values: Pick<
        typeof schema.paymentReceipts.$inferInsert,
        "paymentIntentId"
      > &
        Partial<typeof schema.paymentReceipts.$inferInsert>
    ) {
      await db.insert(schema.paymentReceipts).values({
        kind: "booking",
        bookingId: 100,
        targetId: 100,
        userId: 1,
        amount: 900,
        currency: "SAR",
        ...values,
      });
    }

    it("retains valid historical owners, nullable tenants and distinct collections without writes or disclosure", async () => {
      const before = await snapshot();
      const query = connection.query.bind(connection);
      const originalQuery = connection.query;
      let enforced = false;
      connection.query = (async (sql: string) => {
        const result = await query(sql);
        if (sql === "START TRANSACTION READ ONLY") {
          await expect(
            query("UPDATE wallets SET balance = balance + 1 WHERE id = 100")
          ).rejects.toMatchObject({
            code: "ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION",
          });
          enforced = true;
        }
        return result;
      }) as typeof connection.query;
      let report: ForensicDataReport;
      try {
        report = await inspect();
      } finally {
        connection.query = originalQuery;
      }
      expect(enforced).toBe(true);
      expect(await snapshot()).toEqual(before);
      for (const id of financialFindingIds) expectFinding(report, id, []);
      expectFinding(report, "booking_flight_tenant_mismatch", []);
      expectFinding(report, "passenger_tenant_mismatch", []);
      expectFinding(report, "legacy_tenant_unassigned", [300]);
      expect(JSON.stringify(report)).not.toMatch(
        /pi_|SENSITIVE_SYNTHETIC|PRIVATE_FIXTURE|example\.invalid|synthetic-token/
      );
    });

    it("finds orphan, null and foreign purchaser links for every booking receipt kind", async () => {
      const expected: string[] = [];
      for (const kind of [
        "booking",
        "split_payment",
        "modification",
      ] as const) {
        for (const [suffix, values] of [
          ["orphan", { bookingId: 999 }],
          ["null", { bookingId: null }],
          ["owner", { userId: 2 }],
        ] as const) {
          const paymentIntentId = `pi_${kind}_${suffix}`;
          await receipt({ paymentIntentId, kind, ...values });
          expected.push(hash(paymentIntentId));
        }
      }
      await receipt({ paymentIntentId: "pi_booking_target", targetId: 200 });
      expected.push(hash("pi_booking_target"));
      const report = await inspect();
      expectFinding(report, "receipt_booking_identity_mismatch", expected);
    });

    it("finds missing and foreign split targets without equating payer email to purchaser identity", async () => {
      await receipt({
        paymentIntentId: "pi_split_missing",
        kind: "split_payment",
        targetId: 999,
      });
      await receipt({
        paymentIntentId: "pi_split_foreign",
        kind: "split_payment",
        targetId: 200,
      });
      await receipt({
        paymentIntentId: "pi_split_null",
        kind: "split_payment",
        bookingId: null,
      });
      expectFinding(await inspect(), "receipt_split_target_mismatch", [
        hash("pi_split_missing"),
        hash("pi_split_foreign"),
        hash("pi_split_null"),
      ]);
    });

    it("finds missing, foreign-booking and foreign-owner modification targets", async () => {
      await receipt({
        paymentIntentId: "pi_modification_missing",
        kind: "modification",
        targetId: 999,
      });
      await receipt({
        paymentIntentId: "pi_modification_foreign",
        kind: "modification",
        targetId: 200,
      });
      await receipt({
        paymentIntentId: "pi_modification_owner",
        kind: "modification",
        userId: 2,
      });
      await receipt({
        paymentIntentId: "pi_modification_null",
        kind: "modification",
        bookingId: null,
      });
      expectFinding(await inspect(), "receipt_modification_target_mismatch", [
        hash("pi_modification_missing"),
        hash("pi_modification_foreign"),
        hash("pi_modification_owner"),
        hash("pi_modification_null"),
      ]);
    });

    it.each([
      [
        "booking attached",
        "UPDATE payment_receipts SET bookingId = 100 WHERE kind = 'wallet_topup'",
      ],
      ["missing request", "DELETE FROM wallet_transactions WHERE id = 100"],
      ["missing wallet", "DELETE FROM wallets WHERE id = 100"],
      [
        "wrong request kind",
        "UPDATE wallet_transactions SET type = 'payment' WHERE id = 100",
      ],
      [
        "pending request",
        "UPDATE wallet_transactions SET status = 'pending' WHERE id = 100",
      ],
      [
        "failed request",
        "UPDATE wallet_transactions SET status = 'failed' WHERE id = 100",
      ],
      [
        "foreign request owner",
        "UPDATE wallet_transactions SET userId = 2 WHERE id = 100",
      ],
      [
        "foreign wallet owner",
        "UPDATE wallets SET userId = 999 WHERE id = 100",
      ],
      [
        "wrong collected amount",
        "UPDATE wallet_transactions SET amount = 999 WHERE id = 100",
      ],
      [
        "missing request intent",
        "UPDATE wallet_transactions SET stripePaymentIntentId = NULL WHERE id = 100",
      ],
      [
        "foreign request intent",
        "UPDATE wallet_transactions SET stripePaymentIntentId = 'pi_wrong' WHERE id = 100",
      ],
    ])("finds a wallet receipt with %s", async (_name, mutation) => {
      await connection.query(mutation);
      expectFinding(await inspect(), "receipt_wallet_target_mismatch", [
        hash("pi_wallet_original"),
      ]);
    });

    it("finds orphan and foreign-owner wallet movements even without provider receipts", async () => {
      await db.insert(schema.walletTransactions).values([
        {
          id: 901,
          walletId: 999,
          userId: 1,
          type: "payment",
          amount: -100,
          balanceAfter: 900,
          description: "Synthetic orphan",
        },
        {
          id: 902,
          walletId: 100,
          userId: 2,
          type: "refund",
          amount: 100,
          balanceAfter: 1100,
          description: "Synthetic foreign owner",
        },
      ]);
      expectFinding(
        await inspect(),
        "wallet_transaction_owner_mismatch",
        [901, 902]
      );
    });

    it("counts duplicate provider-intent groups with bounded hashes and excludes null identities", async () => {
      await db.insert(schema.payments).values(
        [
          "pi_duplicate_a",
          "pi_duplicate_a",
          "pi_duplicate_b",
          "pi_duplicate_b",
          "pi_duplicate_b",
          null,
          null,
          "pi_unique",
        ].map(stripePaymentIntentId => ({
          bookingId: 100,
          amount: 100,
          method: "card" as const,
          stripePaymentIntentId,
        }))
      );
      const before = await snapshot();
      const report = await inspect(1);
      const hashes = [hash("pi_duplicate_a"), hash("pi_duplicate_b")].sort();
      expectFinding(
        report,
        "payment_history_duplicate_intent",
        hashes.slice(0, 1),
        2
      );
      expect(JSON.stringify(report)).not.toContain("pi_duplicate");
      expect(await snapshot()).toEqual(before);
    });

    it("detects stored tenant mismatches and orphans while treating two null tenants as equal", async () => {
      await db
        .update(schema.bookings)
        .set({ flightId: 10 })
        .where(eq(schema.bookings.id, 200));
      await db
        .update(schema.bookings)
        .set({ flightId: 999 })
        .where(eq(schema.bookings.id, 100));
      await db
        .update(schema.passengers)
        .set({ tenantId: null })
        .where(eq(schema.passengers.id, 200));
      await db
        .update(schema.passengers)
        .set({ tenantId: 7 })
        .where(eq(schema.passengers.id, 300));
      await db.insert(schema.bookingSegments).values(
        [
          { id: 1, bookingId: 200, flightId: 10 },
          { id: 2, bookingId: 300, flightId: 10 },
          { id: 3, bookingId: 100, flightId: 30 },
          { id: 4, bookingId: 999, flightId: 10 },
          { id: 5, bookingId: 100, flightId: 999 },
          { id: 6, bookingId: 300, flightId: 30 },
          { id: 7, bookingId: 200, flightId: 20 },
        ].map(row => ({
          ...row,
          segmentOrder: row.id,
          segmentAmount: 1000,
          departureDate: new Date("2030-01-01T00:00:00Z"),
        }))
      );
      const report = await inspect();
      expectFinding(report, "booking_flight_tenant_mismatch", [100, 200]);
      expectFinding(report, "passenger_tenant_mismatch", [200, 300]);
      expectFinding(report, "segment_identity_mismatch", [1, 2, 3, 4, 5]);
    });

    it.each(["frozen", "closed"] as const)(
      "accepts an unmarked historical refund after its wallet becomes %s",
      async status => {
        await db
          .update(schema.wallets)
          .set({ status, balance: 0 })
          .where(eq(schema.wallets.id, 100));
        await db
          .update(schema.paymentReceipts)
          .set({ refundedAmount: 1000 })
          .where(
            eq(schema.paymentReceipts.paymentIntentId, "pi_wallet_original")
          );
        await db.insert(schema.financialLedger).values({
          userId: 1,
          type: "refund",
          amount: "10.00",
          currency: "SAR",
          stripePaymentIntentId: "pi_wallet_original",
          stripeEventId: "evt_historical_refund",
          // Historical refund rows can predate walletFunding metadata.
          metadata: null,
        });
        await db.insert(schema.walletTransactions).values({
          walletId: 100,
          userId: 1,
          type: "withdrawal",
          amount: -1000,
          balanceAfter: 0,
          description: "Synthetic historical refund reversal",
          stripePaymentIntentId: "pi_wallet_original",
          status: "completed",
        });
        const report = await inspect();
        expectFinding(report, "receipt_wallet_target_mismatch", []);
        expectFinding(report, "wallet_transaction_owner_mismatch", []);
      }
    );

    it("accepts the original completed top-up after a refund, dispute withdrawal and reinstatement", async () => {
      // The canonical projection appends reversals; it never changes the
      // original request into a withdrawal/refund or resets its completed state.
      async function reconcile(eventId: string) {
        await db.transaction(async tx => {
          const [source] = await tx
            .select()
            .from(schema.paymentReceipts)
            .where(
              eq(schema.paymentReceipts.paymentIntentId, "pi_wallet_original")
            );
          const [wallet] = await tx
            .select()
            .from(schema.wallets)
            .where(eq(schema.wallets.id, 100));
          await reconcileWalletFunding(tx, {
            receipt: source,
            wallet,
            eventId,
          });
        });
        const [original] = await db
          .select()
          .from(schema.walletTransactions)
          .where(eq(schema.walletTransactions.id, 100));
        expect(original).toMatchObject({
          type: "top_up",
          status: "completed",
          amount: 1000,
          stripePaymentIntentId: "pi_wallet_original",
        });
        const report = await inspect();
        expectFinding(report, "receipt_wallet_target_mismatch", []);
        expectFinding(report, "wallet_transaction_owner_mismatch", []);
      }
      // Some funds were already spent before a real provider withdrawal.
      await db
        .update(schema.wallets)
        .set({ balance: 100 })
        .where(eq(schema.wallets.id, 100));
      await db.insert(schema.financialLedger).values({
        userId: 1,
        type: "adjustment",
        amount: "-10.00",
        currency: "SAR",
        stripePaymentIntentId: "pi_wallet_original",
        stripeEventId: "evt_withdrawn",
        metadata: JSON.stringify({
          disputeId: "dp_fixture",
          eventType: "charge.dispute.funds_withdrawn",
        }),
      });
      await reconcile("evt_withdrawn");
      expect(
        (
          await db
            .select()
            .from(schema.wallets)
            .where(eq(schema.wallets.id, 100))
        )[0]
      ).toMatchObject({ balance: -900, status: "frozen" });
      await db.insert(schema.financialLedger).values({
        userId: 1,
        type: "adjustment",
        amount: "10.00",
        currency: "SAR",
        stripePaymentIntentId: "pi_wallet_original",
        stripeEventId: "evt_reinstated",
        metadata: JSON.stringify({
          disputeId: "dp_fixture",
          eventType: "charge.dispute.funds_reinstated",
        }),
      });
      await reconcile("evt_reinstated");
      await db
        .update(schema.paymentReceipts)
        .set({ refundedAmount: 1000 })
        .where(
          eq(schema.paymentReceipts.paymentIntentId, "pi_wallet_original")
        );
      await db.insert(schema.financialLedger).values({
        userId: 1,
        type: "refund",
        amount: "10.00",
        currency: "SAR",
        stripePaymentIntentId: "pi_wallet_original",
        stripeEventId: "evt_refunded",
      });
      await reconcile("evt_refunded");
      const movements = await db.select().from(schema.walletTransactions);
      expect(movements.filter(row => row.type === "withdrawal")).toHaveLength(
        2
      );
      expect(movements.filter(row => row.type === "refund")).toHaveLength(1);
    });
  }
);
