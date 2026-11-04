import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "../../drizzle/schema";
import {
  baseFinanceRows,
  financeFixtureTables,
  financeScope,
  fixtureInsert,
  fixtureTableDdl,
  october,
  payment,
  voidEvent,
} from "./helpers/standard-finance-fixture";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => state.db }));
import { getFinanceStandardReport } from "../services/standard-reports-finance.service";

const allowed =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  Boolean(process.env.DATABASE_URL);
const nativeDescribe = allowed ? describe : describe.skip;

nativeDescribe(
  "standard finance report native MySQL joins and JSON receipts",
  () => {
    let admin: mysql.Connection | null = null;
    let connection: mysql.Connection | null = null;
    let databaseName = "";
    let created = false;
    beforeAll(async () => {
      const url = new URL(process.env.DATABASE_URL!);
      const options = {
        host: url.hostname,
        port: Number(url.port || 3306),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        timezone: "Z",
      };
      databaseName = "ais_report_finance_" + randomBytes(6).toString("hex");
      if (!/^ais_report_finance_[0-9a-f]{12}$/.test(databaseName))
        throw new Error("Invalid disposable schema identity");
      admin = await mysql.createConnection(options);
      await admin.query("CREATE DATABASE " + databaseName);
      created = true;
      connection = await mysql.createConnection({
        ...options,
        database: databaseName,
      });
      await connection.query("SET SESSION time_zone = '+00:00'");
      // Preserve the runner's strict SQL settings; no compatibility relaxation.
      for (const table of financeFixtureTables)
        await connection.query(fixtureTableDdl(table, true));
      for (const [table, values] of baseFinanceRows) {
        const entry = fixtureInsert(table, values);
        await connection.execute(entry.sql, entry.params);
      }
      state.db = drizzle(connection, { schema, mode: "default" });
    }, 30000);

    afterAll(async () => {
      state.db = null;
      if (connection) await connection.end();
      if (admin) {
        try {
          if (created) await admin.query("DROP DATABASE " + databaseName);
        } finally {
          await admin.end();
        }
      }
    });

    it("applies the actual UTC day and tenant predicates to payment records", async () => {
      for (const values of [
        payment(3, { createdAt: "2026-10-01 23:59:59" }),
        payment(4, { createdAt: "2026-10-02 00:00:00" }),
        payment(5, { tenantId: 202, bookingId: 1 }),
      ]) {
        const entry = fixtureInsert(schema.payments, values);
        await connection!.execute(entry.sql, entry.params);
      }
      const report = await getFinanceStandardReport(
        55,
        { startDate: "2026-10-01", endDate: "2026-10-01" },
        financeScope
      );
      expect(report!.rows.map(row => [row.paymentId, row.amountMinor])).toEqual(
        [
          [1, 12000],
          [3, 12000],
        ]
      );
      const global = await getFinanceStandardReport(55, october, {
        userId: 9001,
      });
      expect(global!.rows.map(row => row.paymentId)).toEqual([1, 2, 3, 4]);
    });

    it("reads native JSON uplift mappings and conservative component totals", async () => {
      const values = await getFinanceStandardReport(
        9,
        { bookingReference: "PNR001" },
        financeScope
      );
      expect(values!.rows.map(row => row.componentId)).toEqual([1, 2, 3, 4]);
      expect(
        values!.rows.reduce((sum, row) => sum + Number(row.amountMinor), 0)
      ).toBe(25000);
      // Handler receipts keep the signed document payload separate from the
      // internal financial mapping; exercise both JSON columns on native MySQL.
      await connection!.execute(
        "UPDATE aviation_evidence SET payload=?, ingestSnapshot=? WHERE id=1",
        [
          JSON.stringify({ ticketNumber: "0010000000001", couponNumber: 1 }),
          JSON.stringify({ couponId: 100, bookingId: 1, passengerId: 1 }),
        ]
      );
      const lifted = await getFinanceStandardReport(
        43,
        { startDate: "2026-10-10", endDate: "2026-10-10" },
        financeScope
      );
      expect(
        lifted!.rows.map(row => [row.couponId, row.upliftEvidenceId])
      ).toEqual([[100, 1]]);
      const daily = await getFinanceStandardReport(
        76,
        { startDate: "2026-10-10", endDate: "2026-10-10" },
        financeScope
      );
      expect(daily!.rows).toHaveLength(1);
      expect(daily!.rows[0]).toMatchObject({
        basis: "recorded_uplift",
        amountMinor: 11000,
        recognizedRevenueMinor: null,
      });
    });

    it("preserves recorded void history after a later coupon refund", async () => {
      await connection!.execute(
        "UPDATE ticket_coupons SET status='R', updatedAt='2026-10-09 10:00:00' WHERE id=100"
      );
      const entry = fixtureInsert(schema.outbox, voidEvent(1));
      await connection!.execute(entry.sql, entry.params);
      const report = await getFinanceStandardReport(
        96,
        { startDate: "2026-10-07", endDate: "2026-10-07" },
        financeScope
      );
      expect(report!.rows).toHaveLength(1);
      expect(report!.rows[0]).toMatchObject({
        couponId: 100,
        status: "R",
        voidStatus: "V",
        voidEventId: "synthetic-void-1",
      });
    });
  }
);
