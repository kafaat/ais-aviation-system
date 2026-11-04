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
  calculateDeferredRevenue,
  getRevenueDashboard,
  getAncillaryRevenue,
  getRevenueByChannel,
  getRevenueByClass,
  getReports,
} from "../services/revenue-accounting.service";

const allowed =
  process.env.AIS_DISPOSABLE_DATABASE === "true" &&
  process.env.NODE_ENV === "test" &&
  Boolean(process.env.DATABASE_URL);
const nativeDescribe = allowed ? describe : describe.skip;

nativeDescribe(
  "native MySQL monthly cash report (isolated disposable schema)",
  () => {
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
        "CREATE TABLE bookings (id INT PRIMARY KEY, tenantId INT, flightId INT NOT NULL DEFAULT 1, status VARCHAR(20) NOT NULL DEFAULT 'confirmed', bookingReference VARCHAR(6) NOT NULL DEFAULT 'TEST', cabinClass VARCHAR(20) NOT NULL DEFAULT 'economy', numberOfPassengers INT NOT NULL DEFAULT 1, createdAt TIMESTAMP NOT NULL, totalAmount INT NOT NULL, paymentStatus VARCHAR(20) NOT NULL)"
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
        [
          2,
          "charge",
          "15.00",
          '{"tender":"corporate_credit"}',
          "2026-10-12 09:00:00",
        ],
        [
          2,
          "partial_refund",
          "5.00",
          '{"tender":"corporate_credit"}',
          "2026-10-12 09:00:00",
        ],
        [2, "refund", "25.00", "{}", "2026-11-02 09:00:00"],
      ];
      for (const row of ledger) {
        await connection.execute(
          "INSERT INTO financial_ledger (bookingId,type,amount,currency,metadata,transactionDate) VALUES (?,?,?,'SAR',?,?)",
          row
        );
      }
      await connection.query(
        "CREATE TABLE flights (id INT PRIMARY KEY, flightNumber VARCHAR(10), departureTime TIMESTAMP, status VARCHAR(20))"
      );
      await connection.query(
        "INSERT INTO flights VALUES (1,'NO-SHOW','2026-09-30 23:59:59','scheduled'),(2,'EXCHANGED',DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 YEAR),'scheduled')"
      );
      await connection.query(
        "UPDATE bookings SET flightId=2, cabinClass='business' WHERE id=2"
      );
      await connection.query(
        "CREATE TABLE ticket_coupons (ticketNumber VARCHAR(13), bookingId INT, flightId INT, status CHAR(1))"
      );
      await connection.query(
        "INSERT INTO ticket_coupons VALUES ('1111111111111',1,1,'O'),('2222222222222',2,1,'E'),('3333333333333',2,2,'O')"
      );
      await connection.query(
        "CREATE TABLE ancillary_services (id INT PRIMARY KEY, category VARCHAR(20))"
      );
      await connection.query(
        "CREATE TABLE booking_ancillaries (ancillaryServiceId INT, totalPrice INT, quantity INT, status VARCHAR(20))"
      );
      await connection.query(
        "INSERT INTO ancillary_services VALUES (1,'seat'),(2,'meal')"
      );
      await connection.query(
        "INSERT INTO booking_ancillaries VALUES (1,1200,1,'active'),(2,350,2,'active'),(2,450,1,'refunded')"
      );
      await connection.query(
        "CREATE TABLE corporate_bookings (id INT PRIMARY KEY, bookingId INT NOT NULL UNIQUE)"
      );
      await connection.query(
        "CREATE TABLE agent_bookings (id INT PRIMARY KEY, bookingId INT NOT NULL UNIQUE)"
      );
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

    it("does not recognize no-shows or exchanged coupons when the recorded flight completes twice", async () => {
      const from = new Date("2026-10-01T00:00:00Z");
      const until = new Date("2026-10-31T23:59:59Z");
      const expected = {
        totalRevenue: 20000,
        refundTotal: 4000,
        netRevenue: 16000,
        recognizedRevenue: null,
        deferredRevenue: null,
        ancillaryRevenue: null,
      };
      await expect(getRevenueDashboard(from, until)).resolves.toMatchObject(
        expected
      );
      for (let n = 0; n < 2; n++) {
        await connection!.query(
          "UPDATE flights SET status='completed' WHERE id=1"
        );
        await expect(getRevenueDashboard(from, until)).resolves.toMatchObject(
          expected
        );
      }
      const deferred = await calculateDeferredRevenue();
      const cabins = await getRevenueByClass();
      expect(cabins.map(row => row.percentageOfTotal)).toEqual([50, 50]);
      const channels = await getRevenueByChannel();
      expect(channels.find(row => row.channel === "direct")).toMatchObject({
        totalRevenue: 20000,
        percentageOfTotal: 100,
      });
      const addOns = await getAncillaryRevenue();
      expect(addOns.total).toBe(1550);
      expect(addOns.breakdown.map(row => row.totalRevenue)).toEqual([
        1200, 350,
      ]);
      expect(deferred.total).toBeNull();
      expect(deferred.upcomingBookingGross).toBe(10000);
      expect(deferred.items.map(row => row.bookingId)).toEqual([2]);
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

    it("counts overlapping agency and corporate links once in the native channel report", async () => {
      await connection!.beginTransaction();
      try {
        // A link's primary key must never be mistaken for its booking foreign key.
        await connection!.query(
          "INSERT INTO agent_bookings VALUES (101, 1), (202, 2)"
        );
        await connection!.query(
          "INSERT INTO corporate_bookings VALUES (303, 2)"
        );

        const channels = await getRevenueByChannel();
        expect(
          channels.map(row => [
            row.channel,
            row.totalRevenue,
            row.bookingCount,
            row.percentageOfTotal,
          ])
        ).toEqual([
          ["direct", 0, 0, 0],
          ["agent", 10000, 1, 50],
          ["corporate", 10000, 1, 50],
        ]);
      } finally {
        await connection!.rollback();
      }
    });
  }
);
