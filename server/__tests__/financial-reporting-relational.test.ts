import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/mysql-proxy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => state.db }));

import { getFinancialDays } from "../services/financial-reporting.service";

let database: DatabaseSync;
beforeEach(() => {
  database = new DatabaseSync(":memory:");
  database.function("UNIX_TIMESTAMP", value =>
    value === null
      ? null
      : Date.parse(String(value).replace(" ", "T") + "Z") / 1000
  );
  // SQLite's JSON_EXTRACT already returns an unquoted scalar string.
  database.function("JSON_UNQUOTE", value =>
    value === null ? null : String(value)
  );
  database.exec(`
    CREATE TABLE bookings(id INTEGER PRIMARY KEY, tenantId INTEGER,
      createdAt TEXT, totalAmount INTEGER, paymentStatus TEXT);
    CREATE TABLE financial_ledger(id INTEGER PRIMARY KEY, bookingId INTEGER,
      type TEXT, amount REAL, currency TEXT, metadata TEXT, transactionDate TEXT);
    INSERT INTO bookings VALUES
      (1,101,'2026-10-01 12:00:00',12345,'paid');
    INSERT INTO financial_ledger VALUES
      (1001,1,'charge',123.45,'SAR','{}','2026-10-01 13:00:00'),
      (1002,1,'partial_refund',23.45,'SAR','{}','2026-10-01 14:00:00');
  `);

  const queryDb = drizzle(async (query, params) => {
    const statement = database.prepare(query);
    statement.setReturnArrays(true);
    return { rows: statement.all(...(params as Array<string | number>)) };
  });
  // The proxy driver has no transaction support. This adapter executes the
  // service's actual SELECTs in one SQLite transaction; native MySQL remains
  // responsible for verifying its own isolation and strict SQL modes.
  state.db = {
    async transaction<T>(read: (tx: typeof queryDb) => Promise<T>) {
      database.exec("BEGIN");
      try {
        const result = await read(queryDb);
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
});
afterEach(() => {
  state.db = null;
  database.close();
});

const octoberSecond = {
  startDate: new Date("2026-10-02T00:00:00.000Z"),
  endDate: new Date("2026-10-02T23:59:59.999Z"),
};

describe("financial ledger correlation over relational rows", () => {
  it("reconciles a funded booking when ledger IDs differ from booking IDs", async () => {
    expect(await getFinancialDays({ tenantId: 101 })).toMatchObject([
      {
        date: "2026-10-01",
        billedAmount: 12345,
        bookings: 1,
        collectedAmount: 12345,
        refundedAmount: 2345,
        netCollectedAmount: 10000,
        unreconciledBookings: 0,
        earnedRevenue: null,
      },
    ]);
  });

  it("cannot reconcile a missing charge using another booking's coincident ledger ID", async () => {
    database.exec(`
      INSERT INTO bookings VALUES
        (2,101,'2026-10-02 12:00:00',20000,'paid'),
        (3,202,'2026-10-02 12:00:00',99900,'paid'),
        (4,202,'2026-10-02 12:00:00',100,'paid');
      INSERT INTO financial_ledger VALUES
        (2,3,'charge',999,'SAR','{}','2026-10-02 13:00:00'),
        (4,4,'charge',1,'SAR','{}','2026-10-02 13:00:00');
    `);

    expect(
      await getFinancialDays({ tenantId: 101, ...octoberSecond })
    ).toMatchObject([
      {
        date: "2026-10-02",
        billedAmount: 20000,
        bookings: 1,
        collectedAmount: 0,
        refundedAmount: 0,
        unreconciledBookings: 1,
      },
    ]);
    expect(await getFinancialDays(octoberSecond)).toMatchObject([
      {
        date: "2026-10-02",
        billedAmount: 120000,
        bookings: 3,
        collectedAmount: 100000,
        unreconciledBookings: 1,
      },
    ]);
  });

  it("requires a SAR charge and does not mark pending invoices as unreconciled", async () => {
    database.exec(`
      INSERT INTO bookings VALUES
        (2,101,'2026-10-02 12:00:00',20000,'paid'),
        (3,101,'2026-10-02 12:00:00',20000,'refunded'),
        (4,101,'2026-10-02 12:00:00',10000,'pending');
      INSERT INTO financial_ledger VALUES
        (1003,2,'charge',200,'USD','{}','2026-10-02 13:00:00'),
        (1004,3,'refund',200,'SAR','{}','2026-10-02 13:00:00');
    `);

    expect(
      await getFinancialDays({ tenantId: 101, ...octoberSecond })
    ).toMatchObject([
      {
        date: "2026-10-02",
        billedAmount: 50000,
        bookings: 3,
        collectedAmount: 0,
        refundedAmount: 20000,
        netCollectedAmount: -20000,
        unreconciledBookings: 2,
      },
    ]);
  });
});
