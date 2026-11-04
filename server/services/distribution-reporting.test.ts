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
  milesTransactions,
} from "../../drizzle/schema";
import { getAgentBookings } from "./travel-agent.service";
import { getMessageLog, getStatistics } from "./gds.service";
import { router } from "../_core/trpc";
import type { TrpcContext } from "../_core/context";
import { gdsRouter } from "../routers/gds";
import { loyaltyRouter } from "../routers/loyalty";

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
    milesTransactions,
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

describe("loyalty transaction report pagination", () => {
  const api = router({ loyalty: loyaltyRouter });
  const context = {
    req: { ip: "198.51.100.32", headers: {} } as TrpcContext["req"],
    res: { setHeader: vi.fn() } as unknown as TrpcContext["res"],
    user: { id: 701, role: "admin", tenantId: null } as NonNullable<
      TrpcContext["user"]
    >,
    tenantId: null,
    authMethod: "cookie",
  } satisfies TrpcContext;

  beforeEach(() => {
    for (let id = 1; id <= 106; id++) {
      insert(milesTransactions, {
        id,
        userId: id === 106 ? 702 : 701,
        loyaltyAccountId: id === 106 ? 2 : 1,
        type: "earn",
        amount: 10,
        balanceAfter: id * 10,
        description: `Synthetic transaction ${id}`,
        createdAt: "2030-01-01 12:00:00.000",
      });
    }
  });

  it("retrieves all owned transactions across stable pages, including beyond the original 100-row cap", async () => {
    const caller = api.createCaller(context).loyalty;
    const first = await caller.myTransactions({});
    const second = await caller.myTransactions({ limit: 50, offset: 50 });
    const third = await caller.myTransactions({ limit: 50, offset: 100 });
    const empty = await caller.myTransactions({ limit: 50, offset: 150 });
    expect(first).toHaveLength(50);
    expect(second).toHaveLength(50);
    expect(third).toHaveLength(5);
    expect(empty).toEqual([]);
    expect(
      [...first, ...second, ...third].map(transaction => transaction.id)
    ).toEqual(Array.from({ length: 105 }, (_, index) => 105 - index));
    expect(
      [...first, ...second, ...third].every(
        transaction => transaction.userId === 701
      )
    ).toBe(true);
  });

  it("paginates a specified member through the existing admin endpoint", async () => {
    const caller = api.createCaller(context).loyalty;
    const memberPage = await caller.getUserTransactions({
      userId: 701,
      limit: 50,
      offset: 100,
    });
    expect(memberPage.map(transaction => transaction.id)).toEqual([
      5, 4, 3, 2, 1,
    ]);
    const otherMember = await caller.getUserTransactions({ userId: 702 });
    expect(otherMember.map(transaction => transaction.id)).toEqual([106]);
  });

  it("keeps specified-member transaction access restricted to admins", async () => {
    const caller = api.createCaller({
      ...context,
      user: { ...context.user, role: "user" },
    }).loyalty;
    store.getDb.mockClear();
    await expect(
      caller.getUserTransactions({ userId: 702, offset: 50 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(store.getDb).not.toHaveBeenCalled();
  });

  it.each([
    { limit: 1.5 },
    { limit: 101 },
    { offset: -1 },
    { offset: 1.5 },
    { offset: 1_000_001 },
  ])("rejects invalid pagination before querying: %j", async input => {
    const caller = api.createCaller(context).loyalty;
    store.getDb.mockClear();
    await expect(caller.myTransactions(input)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await expect(
      caller.getUserTransactions({ userId: 701, ...input })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(store.getDb).not.toHaveBeenCalled();
  });
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

describe("GDS message report filters and pagination", () => {
  const api = router({ gds: gdsRouter });
  const context = {
    req: { ip: "198.51.100.31", headers: {} } as TrpcContext["req"],
    res: { setHeader: vi.fn() } as unknown as TrpcContext["res"],
    user: { id: 701, role: "admin", tenantId: null } as NonNullable<
      TrpcContext["user"]
    >,
    tenantId: null,
    authMethod: "cookie",
  } satisfies TrpcContext;

  beforeEach(() => {
    insert(gdsConnections, { id: 1, provider: "amadeus" });
    for (const [id, connectionId, status, direction] of [
      [1, 1, "success", "inbound"],
      [2, 1, "pending", "outbound"],
      [3, 2, "success", "inbound"],
      [4, 1, "success", "inbound"],
      [5, 1, "timeout", "outbound"],
      [6, 1, "success", "inbound"],
    ] as const) {
      insert(gdsMessages, {
        id,
        connectionId,
        provider: "amadeus",
        status,
        direction,
        messageType: "booking_response",
        correlationId: `synthetic-report-${id}`,
        createdAt: "2030-01-01 12:00:00.000",
      });
    }
  });

  it("reads persisted success and pending statuses through the registered router", async () => {
    const caller = api.createCaller(context).gds;
    const successful = await caller.getMessageLog({
      connectionId: 1,
      status: "success",
    });
    expect(successful.data.total).toBe(3);
    expect(successful.data.messages.map(message => message.id)).toEqual([
      6, 4, 1,
    ]);
    const pending = await caller.getMessageLog({
      connectionId: 1,
      status: "pending",
    });
    expect(pending.data.total).toBe(1);
    expect(pending.data.messages.map(message => message.id)).toEqual([2]);
  });

  it("keeps newest-first message pages deterministic when timestamps are equal", async () => {
    const first = await getMessageLog(1, { status: "success", limit: 2 });
    const second = await getMessageLog(1, {
      status: "success",
      page: 2,
      limit: 2,
    });
    expect(first).toMatchObject({ total: 3, page: 1, totalPages: 2 });
    expect(second).toMatchObject({ total: 3, page: 2, totalPages: 2 });
    expect(first.messages.map(message => message.id)).toEqual([6, 4]);
    expect(second.messages.map(message => message.id)).toEqual([1]);
  });

  it.each(["sent", "received"])(
    "rejects the non-persisted status %s before querying the message log",
    async status => {
      store.getDb.mockClear();
      await expect(
        api.createCaller(context).gds.getMessageLog({
          connectionId: 1,
          status: status as never,
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(store.getDb).not.toHaveBeenCalled();
    }
  );
});
