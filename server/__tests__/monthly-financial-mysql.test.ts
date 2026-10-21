import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "../../drizzle/schema";

// Never create a database unless the runner explicitly advertises disposal.
const databaseState = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => databaseState.db }));

import { getFinancialDays } from "../services/financial-reporting.service";
import {
  generateRevenueReport,
  getReports,
} from "../services/revenue-accounting.service";

const allowed =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  Boolean(process.env.DATABASE_URL);
const nativeDescribe = allowed ? describe : describe.skip;

nativeDescribe("native MySQL monthly cash report (isolated disposable schema)", () => {
  let admin: mysql.Connection | null = null;
  let connection: mysql.Connection | null = null;
  let databaseName = "";

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    const options = {
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      timezone: "Z",
    };
    databaseName = "ais_monthly_" + randomBytes(6).toString("hex");
    if (!/^ais_monthly_[0-9a-f]{12}$/.test(databaseName)) {
      throw new Error("Invalid isolated database identity");
    }
    admin = await mysql.createConnection(options);
    await admin.query("CREATE DATABASE " + databaseName);
    connection = await mysql.createConnection({
      ...options,
      database: databaseName,
    });
    await connection.query("SET SESSION time_zone = '+00:00'");
    await connection.query(
      "CREATE TABLE bookings (id INT PRIMARY KEY, tenantId INT, createdAt TIMESTAMP NOT NULL, totalAmount INT NOT NULL, paymentStatus VARCHAR(20) NOT NULL)"
    );
    await connection.query(
      "CREATE TABLE financial_ledger (id INT AUTO_INCREMENT PRIMARY KEY, bookingId INT, type VARCHAR(30) NOT NULL, amount DECIMAL(10,2) NOT NULL, currency VARCHAR(3) NOT NULL, metadata TEXT, transactionDate TIMESTAMP NOT NULL)"
    );
    await connection.execute(
      "INSERT INTO bookings (id,tenantId,createdAt,totalAmount,paymentStatus) VALUES (1,101,'2026-09-30 12:00:00',10000,'paid'),(2,101,'2026-10-10 12:00:00',10000,'paid')"
    );
    const ledger: Array<[number, string, string, string, string]> = [
      [1, "charge", "100.00", "{}", "2026-10-01 09:00:00"],
      [2, "charge", "100.00", "{}", "2026-10-10 09:00:00"],
      [2, "partial_refund", "40.00", "{}", "2026-10-12 09:00:00"],
      [2, "charge", "15.00", '{"tender":"corporate_credit"}', "2026-10-12 09:00:00"],
      [2, "partial_refund", "5.00", '{"tender":"corporate_credit"}', "2026-10-12 09:00:00"],
      [2, "refund", "25.00", "{}", "2026-11-02 09:00:00"],
    ];
    for (const row of ledger) {
      await connection.execute(
        "INSERT INTO financial_ledger (bookingId,type,amount,currency,metadata,transactionDate) VALUES (?,?,?,'SAR',?,?)",
        row
      );
    }
    databaseState.db = drizzle(connection, { schema, mode: "default" });
  }, 30000);

  afterAll(async () => {
    databaseState.db = null;
    if (connection) await connection.end();
    if (admin) {
      try {
        if (databaseName) await admin.query("DROP DATABASE " + databaseName);
      } finally {
        await admin.end();
      }
    }
  });

  it("derives generated and listed cash totals from the same ledger and includes refund-only months", async () => {
    const list = await getReports(12);
    expect(list.map(row => row.id)).toEqual([
      "REV-2026-11",
      "REV-2026-10",
      "REV-2026-09",
    ]);
    const oct = list.find(row => row.id === "REV-2026-10");
    const generated = await generateRevenueReport(10, 2026, 42);
    expect(oct).toMatchObject({
      totalRevenue: 20000,
      billedAmount: 10000,
      collectedAmount: 20000,
      refundAmount: 4000,
      nonCashFundedAmount: 1500,
      nonCashRefundedAmount: 500,
      netCollectedAmount: 16000,
      persisted: false,
      recognizedRevenue: null,
      deferredRevenue: null,
      ancillaryRevenue: null,
    });
    expect(generated).toMatchObject({
      id: oct?.id,
      totalRevenue: oct?.totalRevenue,
      billedAmount: oct?.billedAmount,
      collectedAmount: oct?.collectedAmount,
      refundAmount: oct?.refundAmount,
      nonCashFundedAmount: oct?.nonCashFundedAmount,
      nonCashRefundedAmount: oct?.nonCashRefundedAmount,
      netCollectedAmount: oct?.netCollectedAmount,
    });
    expect(list[0]).toMatchObject({
      totalRevenue: 0,
      refundAmount: 2500,
      netCollectedAmount: -2500,
    });
    const days = await getFinancialDays({ tenantId: 101 });
    expect(days).toHaveLength(5);
  });
});
