import { DatabaseSync } from "node:sqlite";
import { getTableColumns, getTableName } from "drizzle-orm";
import type { MySqlTable } from "drizzle-orm/mysql-core";
import { drizzle } from "drizzle-orm/mysql-proxy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  airports,
  bookings,
  flights,
  payments,
  financialLedger,
} from "../../drizzle/schema";
import {
  getAdminPaymentHistory,
  getUserPaymentHistory,
  getUserPaymentStats,
  getAdminPaymentStats,
} from "./payment-history.service";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => state.db }));

let database: DatabaseSync;

function insert(table: MySqlTable, values: Record<string, string | number>) {
  const names = Object.keys(values);
  database
    .prepare(
      `INSERT INTO \`${getTableName(table)}\` (${names.map(name => `\`${name}\``).join(",")}) VALUES (${names.map(() => "?").join(",")})`
    )
    .run(...Object.values(values));
}

beforeEach(() => {
  database = new DatabaseSync(":memory:");
  for (const table of [
    airports,
    bookings,
    flights,
    payments,
    financialLedger,
  ]) {
    database.exec(
      `CREATE TABLE \`${getTableName(table)}\` (${Object.values(
        getTableColumns(table)
      )
        .map(
          column =>
            `\`${column.name}\` ${column.dataType === "number" || column.dataType === "boolean" ? "INTEGER" : "TEXT"}`
        )
        .join(",")})`
    );
  }
  // Execute the real Drizzle joins, filters, ordering and pagination over rows.
  // This portable regression does not claim native MySQL acceptance.
  state.db = drizzle(async (query, params) => {
    const statement = database.prepare(query);
    statement.setReturnArrays(true);
    return { rows: statement.all(...params) };
  });
  insert(airports, { id: 1, code: "AAA" });
  insert(airports, { id: 2, code: "BBB" });
  insert(flights, {
    id: 1,
    originId: 1,
    destinationId: 2,
    flightNumber: "TEST01",
    departureTime: "2030-01-02 12:00:00.000",
  });
  for (const [id, userId] of [
    [1, 701],
    [2, 702],
  ]) {
    insert(bookings, {
      id,
      userId,
      flightId: 1,
      bookingReference: `REF${id}`,
      pnr: `PNR${id}`,
      cabinClass: "economy",
      numberOfPassengers: 1,
    });
  }
  for (let id = 1; id <= 106; id++) {
    insert(payments, {
      id,
      bookingId: id === 106 ? 2 : 1,
      amount: 1000,
      currency: "SAR",
      status: "completed",
      method: "wallet",
      transactionId: `TX${id}`,
      createdAt: "2030-01-01 12:00:00.000",
    });
  }
});

afterEach(() => {
  database.close();
  state.db = null;
});

describe("payment report pagination", () => {
  it("returns every administrative payment exactly once across equal-time pages", async () => {
    const pages = await Promise.all(
      [0, 50, 100].map(offset => getAdminPaymentHistory({ limit: 50, offset }))
    );
    expect(pages.map(page => page.length)).toEqual([50, 50, 6]);
    expect(pages.flat().map(row => row.id)).toEqual(
      Array.from({ length: 106 }, (_, index) => 106 - index)
    );
    expect(await getAdminPaymentHistory({ offset: 150 })).toEqual([]);
  });

  it("keeps all owned payments accessible without including another user's payment", async () => {
    const pages = await Promise.all(
      [0, 50, 100].map(offset =>
        getUserPaymentHistory(701, { limit: 50, offset })
      )
    );
    expect(pages.map(page => page.length)).toEqual([50, 50, 5]);
    expect(pages.flat().map(row => row.id)).toEqual(
      Array.from({ length: 105 }, (_, index) => 105 - index)
    );
    expect(pages.flat().every(row => row.bookingReference === "REF1")).toBe(
      true
    );
    expect((await getUserPaymentHistory(702)).map(row => row.id)).toEqual([
      106,
    ]);
  });

  it("applies date, method and status filters before paging the joined rows", async () => {
    for (const [id, createdAt, method, status, bookingId] of [
      [201, "2030-01-01 00:00:00.000", "card", "refunded", 1],
      [202, "2030-01-01 23:59:59.999", "card", "refunded", 1],
      [203, "2030-01-02 00:00:00.000", "card", "refunded", 1],
      [204, "2030-01-01 12:00:00.000", "wallet", "refunded", 1],
      [205, "2030-01-01 12:00:00.000", "card", "completed", 1],
      [206, "2030-01-01 12:00:00.000", "card", "refunded", 999],
    ] as const) {
      insert(payments, {
        id,
        bookingId,
        createdAt,
        method,
        status,
        amount: 1000,
        currency: "SAR",
      });
    }
    const filters = {
      dateFrom: new Date("2030-01-01T00:00:00.000Z"),
      dateTo: new Date("2030-01-01T23:59:59.999Z"),
      method: "card",
      status: "refunded",
      limit: 1,
    };
    for (const read of [
      getAdminPaymentHistory,
      (input: typeof filters & { offset: number }) =>
        getUserPaymentHistory(701, input),
    ]) {
      const first = await read({ ...filters, offset: 0 });
      const second = await read({ ...filters, offset: 1 });
      const empty = await read({ ...filters, offset: 2 });
      expect(first.map(row => row.id)).toEqual([202]);
      expect(second.map(row => row.id)).toEqual([201]);
      expect(empty).toEqual([]);
      expect(first[0]).toMatchObject({ origin: "AAA", destination: "BBB" });
    }
  });
});

describe("settled refund statistics", () => {
  it("includes partial posted deltas once and keeps booking ownership", async () => {
    for (const [id, bookingId, amount, type] of [
      [1, 1, "25.00", "partial_refund"],
      [2, 1, "10.00", "partial_refund"],
      [3, 2, "50.00", "refund"],
    ] as const)
      insert(financialLedger, { id, bookingId, amount, type, currency: "SAR" });
    expect((await getUserPaymentStats(701)).refundedAmount).toBe(3500);
    expect((await getUserPaymentStats(702)).refundedAmount).toBe(5000);
    expect((await getAdminPaymentStats()).refundedAmount).toBe(8500);
    // A pending/failed provider command has no posted financial delta.
    insert(payments, {
      id: 107,
      bookingId: 1,
      status: "refunded",
      amount: 999,
      currency: "SAR",
    });
    expect((await getUserPaymentStats(701)).refundedAmount).toBe(3500);
  });
});
