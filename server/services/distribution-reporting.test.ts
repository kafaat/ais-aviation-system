import { DatabaseSync } from "node:sqlite";
import { getTableColumns, getTableName } from "drizzle-orm";
import { type MySqlTable } from "drizzle-orm/mysql-core";
import { drizzle } from "drizzle-orm/mysql-proxy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentBookings,
  bookings,
  flights,
  gdsConnections,
  gdsMessages,
} from "../../drizzle/schema";
import { getAgentBookings } from "./travel-agent.service";
import { getStatistics } from "./gds.service";

const store = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: store.getDb }));

let database: DatabaseSync;

function insert(table: MySqlTable, values: Record<string, string | number>) {
  const columns = Object.keys(values);
  database
    .prepare(
      `INSERT INTO \`${getTableName(table)}\` (${columns.map(column => `\`${column}\``).join(",")}) VALUES (${columns.map(() => "?").join(",")})`
    )
    .run(...Object.values(values));
}

beforeEach(() => {
  database = new DatabaseSync(":memory:");
  for (const table of [
    agentBookings,
    bookings,
    flights,
    gdsConnections,
    gdsMessages,
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
  // Execute real MySQL-dialect SELECTs on relational rows, including predicates,
  // joins, aggregation, ordering and LIMIT. This is not an external GDS test.
  store.getDb.mockReturnValue(
    drizzle(async (query, params) => {
      const statement = database.prepare(query);
      statement.setReturnArrays(true);
      return { rows: statement.all(...params) };
    })
  );
});

afterEach(() => {
  database.close();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("agent booking report", () => {
  beforeEach(() => {
    insert(flights, { id: 10, flightNumber: "ZZ100" });
    for (const [id, status, agentId, flightId] of [
      [1, "confirmed", 11, 10],
      [2, "pending", 11, 10],
      [3, "confirmed", 11, 10],
      [4, "cancelled", 11, 10],
      [5, "confirmed", 11, 10],
      [6, "confirmed", 12, 10],
      [7, "confirmed", 11, 999],
    ] as const) {
      insert(bookings, { id, status, flightId, bookingReference: `BK${id}` });
      insert(agentBookings, {
        id,
        bookingId: id,
        agentId,
        createdAt: "2030-01-01 00:00:00.000",
      });
    }
    // A dangling association must not inflate the total of joined booking rows.
    insert(agentBookings, {
      id: 8,
      bookingId: 999,
      agentId: 11,
      createdAt: "2030-01-01 00:00:00.000",
    });
  });

  it("filters by status before counting and paging, with deterministic equal-time ordering", async () => {
    const first = await getAgentBookings(11, { status: "confirmed", limit: 2 });
    const second = await getAgentBookings(11, {
      status: "confirmed",
      limit: 2,
      page: 2,
    });
    expect(first.total).toBe(3);
    expect(second.total).toBe(3);
    expect(first.bookings.map(booking => booking.bookingId)).toEqual([5, 3]);
    expect(second.bookings.map(booking => booking.bookingId)).toEqual([1]);
  });

  it("uses the same joined universe for unfiltered totals and returned rows", async () => {
    const result = await getAgentBookings(11);
    expect(result.total).toBe(5);
    expect(result.bookings).toHaveLength(5);
    expect(result.bookings.map(booking => booking.bookingId)).toEqual([
      5, 4, 3, 2, 1,
    ]);
  });

  it("combines dates, status and agent ownership without inventing empty-page totals", async () => {
    const result = await getAgentBookings(11, {
      status: "confirmed",
      startDate: new Date("2030-01-02T00:00:00Z"),
    });
    expect(result.total).toBe(0);
    expect(result.bookings).toEqual([]);
  });
});

describe("GDS diagnostic report periods", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-03-05T12:00:00Z"));
    insert(gdsConnections, { id: 1, provider: "amadeus" });
    for (const [
      id,
      connectionId,
      createdAt,
      status,
      messageType,
      responseTimeMs,
    ] of [
      [1, 1, "2029-12-31 23:59:59.999", "success", "booking_response", 900],
      [
        2,
        1,
        "2030-01-01 00:00:00.000",
        "success",
        "availability_response",
        100,
      ],
      [3, 1, "2030-01-01 23:59:59.999", "timeout", "booking_request", null],
      [4, 1, "2030-01-02 00:00:00.000", "error", "ticketing_request", 700],
      [5, 2, "2030-01-01 12:00:00.000", "success", "availability_response", 1],
      [6, 1, "2030-03-05 11:00:00.000", "pending", "schedule_request", null],
    ] as const) {
      insert(gdsMessages, {
        id,
        connectionId,
        createdAt,
        status,
        messageType,
        ...(responseTimeMs === null ? {} : { responseTimeMs }),
      });
    }
  });

  it("applies inclusive UTC days to counts, latency and types while preserving live 24h metrics", async () => {
    const report = await getStatistics({
      connectionId: 1,
      dateFrom: "2030-01-01",
      dateTo: "2030-01-01",
    });
    expect(report).toMatchObject({
      totalMessages: 2,
      successCount: 1,
      errorCount: 0,
      timeoutCount: 1,
      successRate: 50,
      avgResponseTimeMs: 100,
      minResponseTimeMs: 100,
      maxResponseTimeMs: 100,
      messagesByType: { availability_response: 1, booking_request: 1 },
      last24hVolume: 1,
      last24hErrorRate: 0,
    });
  });

  it("keeps existing all-time defaults and supports either open date boundary", async () => {
    expect((await getStatistics({ connectionId: 1 })).totalMessages).toBe(5);
    expect(
      (await getStatistics({ connectionId: 1, dateFrom: "2030-01-01" }))
        .totalMessages
    ).toBe(4);
    expect(
      (await getStatistics({ connectionId: 1, dateTo: "2030-01-01" }))
        .totalMessages
    ).toBe(3);
  });

  it("returns zero aggregate totals for a valid empty period, not all-time data", async () => {
    const report = await getStatistics({
      connectionId: 1,
      dateFrom: "2028-02-29",
      dateTo: "2028-02-29",
    });
    expect(report).toMatchObject({
      totalMessages: 0,
      successRate: 0,
      avgResponseTimeMs: 0,
      messagesByType: {},
    });
  });

  it.each([
    { dateFrom: "2030-02-30" },
    { dateTo: "2030-02-29" },
    { dateFrom: "2030-01-01T00:00:00+03:00" },
    { dateFrom: "" },
    { dateFrom: "2030-01-02", dateTo: "2030-01-01" },
  ])(
    "rejects invalid, timestamp or reversed civil-day inputs before reading data: %j",
    async period => {
      store.getDb.mockClear();
      await expect(
        getStatistics({ connectionId: 1, ...period })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(store.getDb).not.toHaveBeenCalled();
    }
  );
});
