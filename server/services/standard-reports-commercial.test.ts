import { DatabaseSync } from "node:sqlite";
import { getTableColumns, getTableName } from "drizzle-orm";
import type { MySqlTable } from "drizzle-orm/mysql-core";
import { drizzle } from "drizzle-orm/mysql-proxy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  airlines,
  airports,
  ancillaryServices,
  auditLogs,
  bookingAncillaries,
  bookingFareComponents,
  bookingModifications,
  bookings,
  bookingSegments,
  bookingStatusHistory,
  currencies,
  exchangeRates,
  fareClasses,
  fareRules,
  financialLedger,
  flights,
  loyaltyAccounts,
  milesTransactions,
  passengers,
  paymentHistory,
  payments,
  ticketCoupons,
  users,
} from "../../drizzle/schema";
import {
  operationalMessageRoutes,
  operationalMessageTransmissions,
} from "../../drizzle/operations-schema";
import {
  commercialReportDefinitions,
  getCommercialStandardReport,
} from "./standard-reports-commercial.service";
import {
  renderStandardReport,
  runStandardReport,
} from "./standard-reports.service";
import type {
  StandardReportFilters,
  StandardReportScope,
} from "../../shared/standard-reports";

const state = vi.hoisted(() => ({
  db: null as unknown,
  queries: [] as string[],
}));
vi.mock("../db", () => ({ getDb: () => state.db }));

let database: DatabaseSync;
const ownScope = { tenantId: 101, userId: 7 };
const globalScope = { userId: 1 };
const day = { startDate: "2030-01-02", endDate: "2030-01-02" };
const tables = [
  airlines,
  airports,
  ancillaryServices,
  auditLogs,
  bookingAncillaries,
  bookingFareComponents,
  bookingModifications,
  bookings,
  bookingSegments,
  bookingStatusHistory,
  currencies,
  exchangeRates,
  fareClasses,
  fareRules,
  financialLedger,
  flights,
  loyaltyAccounts,
  milesTransactions,
  passengers,
  paymentHistory,
  payments,
  ticketCoupons,
  users,
  operationalMessageRoutes,
  operationalMessageTransmissions,
];

function insert(
  table: MySqlTable,
  row: Record<string, string | number | null>
) {
  const columns = Object.keys(row);
  const schemaColumns = Object.values(getTableColumns(table));
  // SQLite compares our text timestamps lexically; normalize precision to the
  // timestamp driver's .000 parameters so midnight has MySQL's date semantics.
  const values = columns.map(name => {
    const value = row[name];
    return schemaColumns.find(column => column.name === name)?.dataType ===
      "date" &&
      typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
      ? value + ".000"
      : value;
  });
  database
    .prepare(
      `INSERT INTO \`${getTableName(table)}\` (${columns.map(column => `\`${column}\``).join(",")}) VALUES (${columns.map(() => "?").join(",")})`
    )
    .run(...values);
}

function user(id: number, tenantId = 101) {
  insert(users, {
    id,
    tenantId,
    role: "user",
    name: `Member ${id}`,
    email: `synthetic-${id}@example.test`,
    passwordHash: "never-export-password",
    openId: `never-export-openid-${id}`,
    createdAt: "2030-01-01 00:00:00",
    lastSignedIn: "2030-01-01 00:00:00",
  });
}

function booking(
  id: number,
  tenantId = 101,
  extra: Record<string, string | number | null> = {}
) {
  insert(bookings, {
    id,
    tenantId,
    userId: tenantId === 101 ? 7 : 8,
    flightId: 10,
    bookingReference: `B${String(id).padStart(5, "0")}`,
    pnr: `P${String(id).padStart(5, "0")}`,
    status: "confirmed",
    paymentStatus: "paid",
    numberOfPassengers: 1,
    cabinClass: "economy",
    totalAmount: 50000,
    createdAt: "2030-01-02 12:00:00",
    deletedAt: null,
    ...extra,
  });
}

function flight(
  id: number,
  tenantId = 101,
  extra: Record<string, string | number | null> = {}
) {
  insert(flights, {
    id,
    tenantId,
    airlineId: 1,
    flightNumber: `ZZ${id}`,
    originId: 1,
    destinationId: 2,
    departureTime: "2030-01-10 12:00:00",
    arrivalTime: "2030-01-10 14:00:00",
    ...extra,
  });
}

async function run(
  id: number,
  filters: StandardReportFilters = {},
  scope: StandardReportScope = ownScope
) {
  const result = await getCommercialStandardReport(id, filters, scope);
  expect(result).toBeDefined();
  return result!;
}

beforeEach(() => {
  database = new DatabaseSync(":memory:");
  for (const table of tables) {
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
  state.queries = [];
  const queryDb = drizzle(async (query, params) => {
    state.queries.push(query);
    const statement = database.prepare(query);
    statement.setReturnArrays(true);
    return { rows: statement.all(...params) };
  });
  // Execute the production MySQL-dialect SELECTs on relational data, including
  // real joins, filters, ordering and limits. MySQL CI verifies its dialect and
  // isolation separately; this adapter provides one stable read snapshot here.
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
  user(7);
  user(8, 202);
  insert(airports, { id: 1, code: "AAA", city: "Alpha" });
  insert(airports, { id: 2, code: "BBB", city: "Beta" });
  insert(airports, { id: 3, code: "CCC", city: "Gamma" });
  insert(airlines, { id: 1, code: "ZZ" });
  insert(airlines, { id: 2, code: "XY" });
  flight(10);
  flight(20, 202, { airlineId: 2 });
});

afterEach(() => {
  state.db = null;
  database.close();
  vi.useRealTimers();
});

describe("commercial report capability boundaries", () => {
  it("covers the 27 assigned reference IDs without pretending source workflows exist", async () => {
    expect(new Set(commercialReportDefinitions.map(row => row.id)).size).toBe(
      27
    );
    expect(
      commercialReportDefinitions.find(row => row.id === 64)
    ).toBeUndefined();
    for (const id of [32, 33, 34, 35, 36, 37, 41, 47, 51, 52, 61, 65]) {
      await expect(run(id)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
    }
    expect(state.queries).toHaveLength(0);
    expect(await getCommercialStandardReport(3, {}, ownScope)).toBeUndefined();
  });

  it("rejects unsupported filters instead of silently ignoring them", async () => {
    await expect(run(42, { startDate: "2030-01-02" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(run(29, { flightId: 10 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      run(29, { status: "not-a-transaction" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.queries).toHaveLength(0);
  });

  it("requires a member, reference or flight for reports with mandatory identifiers", async () => {
    for (const id of [31, 59, 60, 62]) {
      await expect(run(id)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });

  it("fails closed when the database is unavailable", async () => {
    state.db = null;
    await expect(run(42)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
    });
  });
});

describe("identity and currency configuration reports", () => {
  it("includes database-configured currencies and preserves their recorded name and disabled state", async () => {
    insert(currencies, {
      id: 1,
      code: "USD",
      name: "Recorded dollar name",
      isActive: 0,
      isBaseCurrency: 0,
    });
    insert(currencies, {
      id: 2,
      code: "JPY",
      name: "Recorded Japanese yen",
      isActive: 1,
      isBaseCurrency: 0,
    });
    const result = await run(4);
    expect(result.rows.find(row => row.toCurrency === "USD")).toMatchObject({
      currencyId: 1,
      currencyName: "Recorded dollar name",
      catalogActive: false,
      configurationSource: "currencies",
      rate: null,
    });
    expect(result.rows.find(row => row.toCurrency === "JPY")).toMatchObject({
      currencyId: 2,
      currencyName: "Recorded Japanese yen",
      catalogActive: true,
      configurationSource: "currencies",
      rate: null,
      status: "missing_current_rate",
    });
    expect(result.rows.find(row => row.toCurrency === "GBP")).toMatchObject({
      currencyId: null,
      configurationSource: "application_currency_catalog",
    });
    expect(result.rows.find(row => row.toCurrency === "YER")).toMatchObject({
      currencyId: null,
      catalogActive: null,
      configurationSource: "application_display_catalog",
    });
  });
  it("exports scoped users and role descriptions without authentication fields or invented offices", async () => {
    const own = await run(1);
    expect(own.rows).toHaveLength(1);
    expect(own.rows[0]).toMatchObject({
      userId: 7,
      name: "Member 7",
      role: "user",
      salesOffice: null,
    });
    expect(JSON.stringify(own)).not.toContain("never-export");
    expect(await run(1, { status: "finance" })).toMatchObject({ rows: [] });
    expect((await run(1, {}, globalScope)).rows).toHaveLength(2);
  });

  it("retains exact configured rate versions and records absent current prices without fallback", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-02T12:00:00Z"));
    insert(exchangeRates, {
      id: 1,
      fromCurrency: "SAR",
      toCurrency: "USD",
      rate: "0.26666667",
      source: "bank",
      validFrom: "2030-01-01 00:00:00",
      validTo: "2030-01-03 00:00:00",
    });
    insert(exchangeRates, {
      id: 2,
      fromCurrency: "SAR",
      toCurrency: "EUR",
      rate: "0.24000000",
      source: "manual",
      validFrom: "2029-01-01 00:00:00",
      validTo: "2030-01-02 12:00:00",
    });
    insert(exchangeRates, {
      id: 3,
      fromCurrency: "USD",
      toCurrency: "ZZZ",
      rate: "12.34567890",
      source: "operator",
      validFrom: "2030-01-04 00:00:00",
      validTo: null,
    });
    const result = await run(4);
    expect(result.rows.find(row => row.rateId === 1)).toMatchObject({
      fromCurrency: "SAR",
      toCurrency: "USD",
      rate: "0.26666667",
      source: "bank",
      status: "current",
    });
    expect(result.rows.find(row => row.rateId === 2)?.status).toBe("expired");
    expect(result.rows.find(row => row.rateId === 3)?.status).toBe("future");
    expect(
      result.rows.find(row => row.toCurrency === "EUR" && row.rateId === null)
    ).toMatchObject({
      rate: null,
      source: null,
      status: "missing_current_rate",
    });
    expect(
      result.rows.find(row => row.toCurrency === "SAR" && row.rateId === null)
    ).toMatchObject({ rate: "1", source: "identity", status: "identity" });
    expect(JSON.stringify(result.rows)).not.toContain("fallback");
    expect(result.rows.find(row => row.toCurrency === "YER")).toMatchObject({
      rate: null,
      status: "missing_current_rate",
    });
  });
});

describe("membership and miles reports", () => {
  beforeEach(() => {
    insert(loyaltyAccounts, {
      id: 100,
      userId: 7,
      tier: "gold",
      memberSince: "2030-01-02 00:00:00",
      lastActivityAt: "2030-01-02 23:59:59",
      currentMilesBalance: 120,
      totalMilesEarned: 130,
    });
    insert(loyaltyAccounts, {
      id: 200,
      userId: 8,
      tier: "silver",
      memberSince: "2030-01-02 00:00:00",
      lastActivityAt: "2030-01-02 12:00:00",
    });
    user(9);
    insert(loyaltyAccounts, {
      id: 300,
      userId: 9,
      tier: "bronze",
      memberSince: "2030-01-03 00:00:00",
      lastActivityAt: "2030-01-03 00:00:00",
    });
    for (const [id, time, memberId, accountId, type] of [
      [1, "2030-01-01 23:59:59", 7, 100, "earn"],
      [2, "2030-01-02 00:00:00", 7, 100, "earn"],
      [3, "2030-01-02 23:59:59", 7, 100, "redeem"],
      [4, "2030-01-03 00:00:00", 7, 100, "earn"],
      [5, "2030-01-02 12:00:00", 8, 200, "earn"],
      [6, "2030-01-02 12:00:00", 7, 200, "earn"],
    ] as const)
      insert(milesTransactions, {
        id,
        userId: memberId,
        loyaltyAccountId: accountId,
        type,
        amount: type === "redeem" ? -10 : 20,
        balanceAfter: 120,
        createdAt: time,
      });
  });

  it("lists new members by membership start and tenant, with an inclusive end day", async () => {
    expect((await run(30, day)).rows.map(row => row.memberId)).toEqual([7]);
    expect((await run(30, { ...day, status: "silver" })).rows).toEqual([]);
    expect(
      (await run(30, day, globalScope)).rows.map(row => row.memberId)
    ).toEqual([8, 7]);
  });

  it("covers all period transactions and excludes a mismatched loyalty-account owner", async () => {
    const result = await run(29, day);
    expect(result.rows.map(row => row.transactionId)).toEqual([3, 2]);
    expect(result.rows.map(row => row.miles)).toEqual([-10, 20]);
    expect(
      (await run(29, { ...day, status: "earn" })).rows.map(
        row => row.transactionId
      )
    ).toEqual([2]);
    expect(
      (await run(29, day, globalScope)).rows.map(row => row.transactionId)
    ).toEqual([3, 5, 2]);
  });

  it("does not expose another tenant's member transactions", async () => {
    expect((await run(31, { memberId: 8 })).rows).toEqual([]);
    expect(
      (await run(31, { memberId: 8 }, globalScope)).rows.map(
        row => row.transactionId
      )
    ).toEqual([5]);
  });

  it("returns every member transaction beyond the old 100-row cap, in stable order", async () => {
    database.exec("DELETE FROM miles_transactions");
    for (let id = 1; id <= 151; id++)
      insert(milesTransactions, {
        id,
        userId: 7,
        loyaltyAccountId: 100,
        type: "earn",
        amount: 1,
        balanceAfter: id,
        createdAt: "2030-01-02 12:00:00",
      });
    const result = await run(31, { memberId: 7 });
    expect(result.rows.map(row => row.transactionId)).toEqual(
      Array.from({ length: 151 }, (_, i) => 151 - i)
    );
  });

  it("rejects more than 10000 matching rows instead of presenting a truncated export", async () => {
    database.exec("DELETE FROM miles_transactions");
    database.exec(`WITH RECURSIVE seq(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM seq WHERE x < 10001)
      INSERT INTO miles_transactions (id,userId,loyaltyAccountId,type,amount,balanceAfter,createdAt)
      SELECT x,7,100,'earn',1,x,'2030-01-02 12:00:00' FROM seq`);
    await expect(run(31, { memberId: 7 })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("10000"),
    });
  });
});

describe("latest record locator and PNR 50", () => {
  it.each([0, 49, 50, 51])(
    "returns the correct stable latest slice from %i bookings",
    async count => {
      for (let id = 1; id <= count; id++) booking(id);
      booking(999, 202, { createdAt: "2031-01-01 00:00:00" });
      booking(1000, 101, {
        createdAt: "2031-01-01 00:00:00",
        deletedAt: "2031-01-02 00:00:00",
      });
      expect((await run(58)).rows.map(row => row.bookingId)).toEqual(
        Array.from({ length: Math.min(count, 50) }, (_, i) => count - i)
      );
      expect((await run(42)).rows.map(row => row.bookingId)).toEqual(
        count ? [count] : []
      );
      expect((await run(42, {}, globalScope)).rows[0]?.bookingId).toBe(999);
    }
  );

  it("keeps cancelled bookings in the defined latest-record universe", async () => {
    booking(1);
    booking(2, 101, { status: "cancelled" });
    expect((await run(42)).rows[0]).toMatchObject({
      bookingId: 2,
      status: "cancelled",
    });
  });
});

describe("directional filed fare configuration", () => {
  beforeEach(() => {
    for (const [id, airlineId] of [
      [1, 1],
      [2, 2],
    ])
      insert(fareClasses, {
        id,
        airlineId,
        code: "Y",
        name: "Economy full",
        cabinClass: "economy",
        basePriceMultiplier: "1.250",
        active: 1,
      });
    for (const [id, originId, destinationId, airlineId, from, until] of [
      [1, null, null, 1, "2030-01-01 00:00:00", null],
      [2, 1, 2, 1, "2030-01-02 00:00:00", null],
      [3, 2, 1, 1, "2030-01-01 00:00:00", null],
      [4, 1, 3, 1, "2030-01-01 00:00:00", null],
      [5, 1, 2, 2, "2030-01-01 00:00:00", null],
      [6, 1, 2, 1, "2030-01-03 00:00:00", null],
      [7, 1, 2, 1, "2029-01-01 00:00:00", "2030-01-01 23:59:59"],
    ] as const)
      insert(fareRules, {
        id,
        fareClassId: airlineId,
        airlineId,
        ruleName: `Rule ${id}`,
        ruleCategory: "advance_purchase",
        originAirportId: originId,
        destinationAirportId: destinationId,
        validFrom: from,
        validUntil: until,
        priceAdjustment: 100,
        priceMultiplier: "1.100",
        active: 1,
      });
  });

  it("includes general and directional rules, excluding reverse, foreign and nonoverlapping rules", async () => {
    expect(
      (await run(12, { ...day, origin: "AAA", destination: "BBB" })).rows.map(
        row => row.ruleId
      )
    ).toEqual([1, 2]);
    expect(
      (await run(11, { ...day, origin: "AAA" })).rows.map(row => row.ruleId)
    ).toEqual([1, 2, 4]);
    expect(
      (
        await run(
          12,
          { ...day, origin: "AAA", destination: "BBB" },
          globalScope
        )
      ).rows.map(row => row.ruleId)
    ).toEqual([5, 1, 2]);
  });

  it("requires both ends for a pair and reports unknown airports", async () => {
    await expect(run(12, { origin: "AAA" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      run(12, { origin: "AAA", destination: "ZZZ" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("unified local PNR snapshots and timelines", () => {
  beforeEach(() => {
    booking(1);
    booking(2, 202, { flightId: 20 });
    insert(passengers, {
      id: 101,
      tenantId: 101,
      bookingId: 1,
      firstName: "Synthetic",
      lastName: "Traveller",
      type: "adult",
      seatNumber: "1A",
      ticketNumber: "9990000000001",
      createdAt: "2030-01-02 12:00:00",
      passportNumber: "NEVER-EXPORT-DOCUMENT",
    });
    insert(passengers, {
      id: 102,
      tenantId: 202,
      bookingId: 1,
      firstName: "Foreign",
      lastName: "Mismatch",
      type: "adult",
      createdAt: "2030-01-02 12:00:00",
    });
    insert(ticketCoupons, {
      id: 1,
      bookingId: 1,
      passengerId: 101,
      flightId: 10,
      ticketNumber: "9990000000001",
      couponNumber: 1,
      status: "O",
      createdAt: "2030-01-02 12:00:00",
    });
    insert(payments, {
      id: 1,
      tenantId: 101,
      bookingId: 1,
      amount: 50000,
      currency: "SAR",
      method: "card",
      status: "completed",
      createdAt: "2030-01-02 12:01:00",
      providerMetadata: "NEVER-EXPORT-PROVIDER-PAYLOAD",
    });
    insert(payments, {
      id: 2,
      tenantId: 202,
      bookingId: 2,
      amount: 12300,
      currency: "SAR",
      method: "card",
      status: "completed",
      createdAt: "2030-01-02 12:01:00",
    });
    insert(paymentHistory, {
      id: 1,
      paymentId: 1,
      bookingId: 1,
      event: "completed",
      fromStatus: "pending",
      toStatus: "completed",
      amount: 50000,
      currency: "SAR",
      createdAt: "2030-01-02 12:01:00",
      metadata: "NEVER-EXPORT-PROVIDER-PAYLOAD",
    });
    insert(paymentHistory, {
      id: 2,
      paymentId: 2,
      bookingId: 1,
      event: "completed",
      fromStatus: "pending",
      toStatus: "completed",
      amount: 12300,
      currency: "SAR",
      createdAt: "2030-01-02 12:01:00",
    });
    insert(bookingStatusHistory, {
      id: 1,
      bookingId: 1,
      bookingReference: "B00001",
      previousStatus: "pending",
      newStatus: "confirmed",
      transitionedAt: "2030-01-02 12:01:00",
      changedBy: 7,
    });
    insert(bookingModifications, {
      id: 1,
      bookingId: 1,
      userId: 7,
      modificationType: "upgrade_cabin",
      status: "completed",
      totalCost: 10000,
      newFlightId: 10,
      createdAt: "2030-01-03 00:00:00",
      checkoutData: "NEVER-EXPORT-CHECKOUT-PAYLOAD",
    });
    insert(financialLedger, {
      id: 1001,
      bookingId: 1,
      type: "charge",
      amount: "500.00",
      currency: "SAR",
      transactionDate: "2030-01-02 12:01:00",
      metadata: "NEVER-EXPORT-LEDGER-PAYLOAD",
    });
    insert(auditLogs, {
      id: 1,
      resourceType: "booking",
      resourceId: "1",
      eventType: "BOOKING_CONFIRMED",
      outcome: "success",
      userId: 7,
      timestamp: "2030-01-02 12:01:00",
      metadata: "NEVER-EXPORT-AUDIT-PAYLOAD",
      newValue: "NEVER-EXPORT-CREDENTIAL",
    });
    insert(auditLogs, {
      id: 2,
      resourceType: "user",
      resourceId: "1",
      eventType: "USER_CHANGED",
      outcome: "success",
      timestamp: "2030-01-02 12:01:00",
    });
    insert(bookingFareComponents, {
      id: 1,
      tenantId: 101,
      bookingId: 1,
      passengerId: 101,
      flightId: 10,
      componentType: "base_fare",
      code: "BASE",
      amount: 50000,
      currency: "SAR",
      createdAt: "2030-01-02 12:00:00",
      reversedAt: null,
    });
    insert(ancillaryServices, {
      id: 1,
      code: "BAG",
      name: "Baggage",
      category: "baggage",
      currency: "SAR",
    });
    insert(bookingAncillaries, {
      id: 1,
      bookingId: 1,
      passengerId: 101,
      ancillaryServiceId: 1,
      quantity: 2,
      unitPrice: 5000,
      totalPrice: 10000,
      status: "active",
      createdAt: "2030-01-02 12:00:00",
    });
  });

  it("returns record types without multiplying payments by passengers or exposing sensitive payloads", async () => {
    const result = await run(59, { bookingReference: "P00001" });
    expect(
      result.rows.filter(row => row.recordType === "payment")
    ).toHaveLength(1);
    expect(
      result.rows.filter(row => row.recordType === "passenger")
    ).toHaveLength(1);
    expect(
      result.rows.find(row => row.recordType === "passenger")
    ).toMatchObject({
      name: "Synthetic Traveller",
      documentNumber: "9990000000001",
    });
    expect(
      result.rows.find(row => row.recordType === "legacy_sector")
    ).toMatchObject({ origin: "AAA", destination: "BBB", flightId: 10 });
    expect(
      result.rows.find(row => row.recordType === "local_coupon")
    ).toMatchObject({ couponNumber: 1, status: "O" });
    expect(
      result.rows.find(row => row.recordType === "fare_component")
    ).toMatchObject({ amountMinor: 50000, currency: "SAR" });
    expect(
      result.rows.find(row => row.recordType === "ancillary_purchase")?.currency
    ).toBeNull();
    expect(result.rows.every(row => row.bookingId === 1)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("NEVER-EXPORT");
  });

  it("retains legacy nullable-tenant children through their owning booking in snapshots and history", async () => {
    database.exec("UPDATE passengers SET tenantId=NULL WHERE id=101");
    database.exec("UPDATE payments SET tenantId=NULL WHERE id=1");
    database.exec(
      "UPDATE booking_fare_components SET tenantId=NULL WHERE id=1"
    );

    const result = await run(59, { bookingReference: "B00001" });
    for (const recordType of [
      "passenger",
      "local_coupon",
      "payment",
      "payment_event",
      "fare_component",
    ]) {
      expect(
        result.rows.filter(row => row.recordType === recordType),
        recordType
      ).toHaveLength(1);
    }
    expect(
      (await run(60, { ...day, bookingReference: "B00001" })).rows.filter(
        row => row.recordType === "payment_event"
      )
    ).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("Foreign Mismatch");
    expect(JSON.stringify(result)).not.toContain("NEVER-EXPORT");
  });

  it.each([
    ["tenant", ownScope],
    ["global", globalScope],
  ] as const)(
    "validates each PNR child's booking relationships in %s scope",
    async (_label, scope) => {
      booking(3);
      insert(passengers, {
        id: 103,
        tenantId: 101,
        bookingId: 3,
        firstName: "Different",
        lastName: "Booking",
        createdAt: "2030-01-02 12:00:00",
      });
      insert(payments, {
        id: 3,
        tenantId: 202,
        bookingId: 1,
        amount: 99000,
        currency: "USD",
        status: "completed",
        createdAt: "2030-01-02 12:01:00",
      });
      insert(paymentHistory, {
        id: 3,
        paymentId: 3,
        bookingId: 1,
        event: "completed",
        amount: 99000,
        currency: "USD",
        createdAt: "2030-01-02 12:01:00",
      });
      insert(bookingSegments, {
        id: 100,
        bookingId: 1,
        flightId: 20,
        segmentOrder: 1,
        status: "confirmed",
        createdAt: "2030-01-02 12:00:00",
      });
      for (const [id, passengerId, flightId] of [
        [2, 102, 10],
        [3, 101, 20],
        [4, 103, 10],
      ]) {
        insert(ticketCoupons, {
          id,
          bookingId: 1,
          passengerId,
          flightId,
          ticketNumber: `999000000000${id}`,
          couponNumber: 1,
          status: "O",
          createdAt: "2030-01-02 12:00:00",
        });
      }
      for (const [id, tenantId, passengerId, flightId] of [
        [2, 202, 101, 10],
        [3, 101, 102, 10],
        [4, 101, 101, 20],
        [5, 101, 999, 10],
        [6, 101, 103, 10],
      ]) {
        insert(bookingFareComponents, {
          id,
          tenantId,
          bookingId: 1,
          passengerId,
          flightId,
          componentType: "base_fare",
          code: "INVALID_RELATIONSHIP",
          amount: 99000,
          currency: "USD",
          createdAt: "2030-01-02 12:00:00",
          reversedAt: null,
        });
      }
      insert(bookingAncillaries, {
        id: 2,
        bookingId: 1,
        passengerId: 102,
        ancillaryServiceId: 1,
        quantity: 1,
        totalPrice: 99000,
        status: "active",
        createdAt: "2030-01-02 12:00:00",
      });
      insert(bookingAncillaries, {
        id: 3,
        bookingId: 1,
        passengerId: 103,
        ancillaryServiceId: 1,
        quantity: 1,
        totalPrice: 99000,
        status: "active",
        createdAt: "2030-01-02 12:00:00",
      });

      const result = await run(59, { bookingReference: "B00001" }, scope);
      for (const recordType of [
        "passenger",
        "local_coupon",
        "payment",
        "payment_event",
        "fare_component",
        "ancillary_purchase",
      ]) {
        expect(
          result.rows.filter(row => row.recordType === recordType),
          recordType
        ).toHaveLength(1);
      }
      expect(result.rows.some(row => row.recordType === "segment")).toBe(false);
      expect(JSON.stringify(result)).not.toContain("Foreign Mismatch");
      expect(JSON.stringify(result)).not.toContain("Different Booking");
      expect(JSON.stringify(result)).not.toContain("INVALID_RELATIONSHIP");
      expect(
        (await run(60, { ...day, bookingReference: "B00001" }, scope)).rows
          .filter(row => row.recordType === "payment_event")
          .map(row => row.recordId)
      ).toEqual([1]);
    }
  );

  it("does not attribute a different tenant's PNR to a flight in global scope", async () => {
    insert(bookingSegments, {
      id: 100,
      bookingId: 1,
      flightId: 20,
      segmentOrder: 1,
      status: "confirmed",
      createdAt: "2030-01-02 12:00:00",
    });
    booking(3, 101, { flightId: 20 });
    const result = await run(62, { flightId: 20 }, globalScope);
    expect([...new Set(result.rows.map(row => row.bookingId))]).toEqual([2]);
  });

  it("excludes malformed children before the source cap and retains preview/export record counts", async () => {
    const request = {
      reportId: 59,
      filters: { bookingReference: "B00001" },
    };
    const before = await runStandardReport(request, globalScope);
    database.exec("BEGIN");
    for (let id = 10; id < 10015; id++) {
      insert(bookingFareComponents, {
        id,
        tenantId: 101,
        bookingId: 1,
        passengerId: 102,
        flightId: 10,
        amount: 99000,
        currency: "USD",
        code: "INVALID_RELATIONSHIP",
        createdAt: "2030-01-02 12:00:00",
      });
      insert(payments, {
        id,
        tenantId: 202,
        bookingId: 1,
        amount: 99000,
        currency: "USD",
        createdAt: "2030-01-02 12:00:00",
      });
    }
    database.exec("COMMIT");

    const after = await runStandardReport(request, globalScope);
    expect(after.rows).toEqual(before.rows);
    expect(after.total).toBe(before.total);
    expect(renderStandardReport(after, "csv").recordCount).toBe(before.total);
    expect(renderStandardReport(after, "html").recordCount).toBe(before.total);
    expect(renderStandardReport(after, "xml").recordCount).toBe(before.total);
  });

  it("filters the timeline by event time and retains distinguishable sources and exact ledger units", async () => {
    const result = await run(60, { ...day, bookingReference: "B00001" });
    expect(result.rows.map(row => row.recordType).sort()).toEqual(
      [
        "audit_event",
        "booking_created",
        "booking_state",
        "financial_ledger",
        "payment_event",
      ].sort()
    );
    expect(
      result.rows.find(row => row.recordType === "financial_ledger")
    ).toMatchObject({
      recordId: 1001,
      amountMajor: "500.00",
      amountMinor: null,
    });
    expect(
      result.rows.every(
        row => row.bookingReference === "B00001" && row.pnr === "P00001"
      )
    ).toBe(true);
    expect(JSON.stringify(result)).not.toContain("NEVER-EXPORT");
    const tomorrow = await run(60, {
      startDate: "2030-01-03",
      endDate: "2030-01-03",
      bookingReference: "B00001",
    });
    expect(tomorrow.rows.map(row => row.recordType)).toEqual([
      "servicing_request",
    ]);
  });

  it("does not resolve another tenant's PNR or flight", async () => {
    expect((await run(59, { bookingReference: "P00002" })).rows).toEqual([]);
    expect((await run(60, { bookingReference: "B00002" })).rows).toEqual([]);
    await expect(run(62, { flightId: 20 })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("uses current segment membership and includes legacy bookings only without any segment rows", async () => {
    flight(11);
    booking(3, 101, { flightId: 11 });
    booking(4);
    booking(5, 202);
    booking(6, 101, { flightId: 11 });
    insert(bookingSegments, {
      id: 100,
      bookingId: 1,
      flightId: 11,
      segmentOrder: 1,
      status: "confirmed",
      createdAt: "2030-01-02 12:00:00",
    });
    insert(bookingSegments, {
      id: 101,
      bookingId: 3,
      flightId: 10,
      segmentOrder: 1,
      status: "confirmed",
      createdAt: "2030-01-02 12:00:00",
    });
    insert(bookingSegments, {
      id: 102,
      bookingId: 6,
      flightId: 10,
      segmentOrder: 1,
      status: "cancelled",
      createdAt: "2030-01-02 12:00:00",
    });
    const result = await run(62, { flightId: 10 });
    expect([...new Set(result.rows.map(row => row.bookingId))]).toEqual([3, 4]);
    expect(
      result.rows
        .filter(row => row.recordType === "segment")
        .map(row => row.bookingId)
    ).toEqual([3]);
    expect(
      result.rows
        .filter(row => row.recordType === "legacy_sector")
        .map(row => row.bookingId)
    ).toEqual([4]);
  });
});

describe("product purchase detail and generated messages", () => {
  it("lists all funded products by funding date, retaining cancellations and explicit missing currency snapshots", async () => {
    booking(1, 101, { createdAt: "2029-01-01 00:00:00" });
    booking(2, 202);
    for (let id = 1; id <= 7; id++) {
      insert(ancillaryServices, {
        id,
        code: `PRD${id}`,
        name: `Product ${id}`,
        category: "baggage",
        currency: "SAR",
      });
      insert(bookingAncillaries, {
        id,
        bookingId: 1,
        ancillaryServiceId: id,
        quantity: 2,
        unitPrice: 500,
        totalPrice: 1000,
        status: id === 7 ? "refunded" : "active",
        createdAt: "2029-01-01 00:00:00",
        fundedAt: "2030-01-02 12:00:00",
        fundingReference: JSON.stringify({
          kind: "authorized_no_charge",
          paymentIntentId: "NEVER-EXPORT-FUNDING",
        }),
      });
    }
    insert(bookingAncillaries, {
      id: 8,
      bookingId: 1,
      ancillaryServiceId: 1,
      fundedAt: "2030-01-03 00:00:00",
      createdAt: "2030-01-02 12:00:00",
    });
    insert(bookingAncillaries, {
      id: 9,
      bookingId: 2,
      ancillaryServiceId: 1,
      fundedAt: "2030-01-02 12:00:00",
      createdAt: "2030-01-02 12:00:00",
    });
    insert(bookingAncillaries, {
      id: 10,
      bookingId: 1,
      ancillaryServiceId: 1,
      fundedAt: null,
      createdAt: "2030-01-02 12:00:00",
    });
    const result = await run(63, day);
    expect(result.rows.map(row => row.purchaseId)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(result.rows[6]).toMatchObject({
      status: "refunded",
      fundingKind: "authorized_no_charge",
      saleCurrency: null,
      catalogCurrency: "SAR",
      totalPriceMinor: 1000,
    });
    expect(JSON.stringify(result)).not.toContain("NEVER-EXPORT");
    expect(
      (await run(63, { ...day, status: "refunded" })).rows.map(
        row => row.purchaseId
      )
    ).toEqual([7]);
    expect(
      (await run(63, { ...day, bookingReference: "unknown" })).rows
    ).toEqual([]);
  });

  it("reports Type-B configuration and defined SMS templates without claiming delivery acceptance", async () => {
    for (const [id, tenantId] of [
      [1, 101],
      [2, 202],
    ])
      insert(operationalMessageRoutes, {
        id,
        tenant_id: tenantId,
        station_code: "AAA",
        message_type: "PNL",
        origin_address: "AAAAAAA",
        destination_address: "BBBBBBB",
        transport_profile: "synthetic-profile",
        enabled: 0,
        accepted_at: null,
      });
    const result = await run(46);
    expect(result.rows.filter(row => row.channel === "type_b")).toHaveLength(1);
    expect(result.rows.find(row => row.channel === "type_b")).toMatchObject({
      id: 1,
      tenantId: 101,
      enabled: false,
      acceptedAt: null,
    });
    expect(
      result.rows.filter(row => row.channel === "sms").length
    ).toBeGreaterThan(0);
    expect(
      result.rows
        .filter(row => row.channel === "sms")
        .every(
          row =>
            row.enabled === null &&
            row.configurationState === "template_defined"
        )
    ).toBe(true);
  });

  it("keeps generated, sent and acknowledged states separate and excludes foreign, inbound and next-day messages", async () => {
    for (const [id, tenantId, status, direction, createdAt] of [
      [1, 101, "draft", "outbound", "2030-01-02 00:00:00"],
      [2, 101, "sent", "outbound", "2030-01-02 12:00:00"],
      [3, 101, "acknowledged", "outbound", "2030-01-02 23:59:59"],
      [4, 202, "draft", "outbound", "2030-01-02 12:00:00"],
      [5, 101, "received", "inbound", "2030-01-02 12:00:00"],
      [6, 101, "draft", "outbound", "2030-01-03 00:00:00"],
    ] as const)
      insert(operationalMessageTransmissions, {
        id,
        tenant_id: tenantId,
        flight_id: 10,
        message_type: "PNL",
        status,
        direction,
        created_at: createdAt,
        attempt_count: id - 1,
        message_content: "NEVER-EXPORT-MESSAGE-BODY",
        message_digest: `digest-${id}`,
        sent_at: status === "draft" ? null : "2030-01-02 12:00:00",
        acknowledged_at:
          status === "acknowledged" ? "2030-01-02 23:59:59" : null,
      });
    const result = await run(97, day);
    expect(result.rows.map(row => row.transmissionId)).toEqual([1, 2, 3]);
    expect(result.rows[0]).toMatchObject({
      status: "draft",
      sentAt: null,
      acknowledgedAt: null,
    });
    expect(result.rows[1]).toMatchObject({
      status: "sent",
      acknowledgedAt: null,
    });
    expect(result.rows[2].acknowledgedAt).toBe("2030-01-02T23:59:59.000Z");
    expect(JSON.stringify(result)).not.toContain("NEVER-EXPORT");
    expect(
      (await run(97, { ...day, status: "draft" })).rows.map(
        row => row.transmissionId
      )
    ).toEqual([1]);
  });
});
