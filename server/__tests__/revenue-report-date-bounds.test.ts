import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/mysql-proxy";

const state = vi.hoisted(() => ({
  db: null as unknown,
  cash: vi.fn(),
  query: vi.fn(),
}));
vi.mock("../db", () => ({ getDb: () => state.db }));
vi.mock("../services/financial-reporting.service", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../services/financial-reporting.service")
  >()),
  getFinancialSummary: state.cash,
}));

import {
  getAncillaryRevenue,
  getRevenueByChannel,
  getRevenueByClass,
  getRevenueByRoute,
  getRevenueDashboard,
} from "../services/revenue-accounting.service";

let database: DatabaseSync;
beforeEach(() => {
  database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE bookings(id INTEGER, flightId INTEGER, status TEXT,
      paymentStatus TEXT, totalAmount INTEGER, numberOfPassengers INTEGER,
      cabinClass TEXT, createdAt TEXT);
    CREATE TABLE flights(id INTEGER, originId INTEGER, destinationId INTEGER);
    CREATE TABLE airports(id INTEGER, code TEXT, city TEXT);
    CREATE TABLE corporate_bookings(id INTEGER PRIMARY KEY,
      bookingId INTEGER NOT NULL UNIQUE);
    CREATE TABLE agent_bookings(id INTEGER PRIMARY KEY,
      bookingId INTEGER NOT NULL UNIQUE);
    CREATE TABLE ancillary_services(id INTEGER, category TEXT);
    CREATE TABLE booking_ancillaries(ancillaryServiceId INTEGER, totalPrice INTEGER,
      quantity INTEGER, status TEXT, createdAt TEXT);
    INSERT INTO flights VALUES(1,1,2);
    INSERT INTO airports VALUES(1,'JED','Jeddah'),(2,'RUH','Riyadh');
    INSERT INTO bookings VALUES
      (1,1,'confirmed','paid',10000,1,'economy','2026-09-30 00:00:00.000'),
      (2,1,'confirmed','paid',20000,1,'business','2026-10-01 00:00:00.000'),
      (3,1,'confirmed','paid',30000,1,'economy','2026-10-15 00:00:00.000'),
      (4,1,'confirmed','paid',40000,1,'business','2026-11-01 00:00:00.000'),
      (5,1,'cancelled','paid',90000,1,'economy','2026-10-10 00:00:00.000'),
      (6,1,'confirmed','pending',90000,1,'economy','2026-10-10 00:00:00.000');
    -- Link row IDs are independent of booking IDs, as in the production schema.
    INSERT INTO agent_bookings VALUES(101,2);
    INSERT INTO corporate_bookings VALUES(202,3);
    INSERT INTO ancillary_services VALUES(1,'baggage');
    INSERT INTO booking_ancillaries VALUES
      (1,1000,1,'active','2026-09-30 00:00:00.000'),
      (1,2000,1,'active','2026-10-01 00:00:00.000'),
      (1,3000,1,'active','2026-10-15 00:00:00.000'),
      (1,4000,1,'active','2026-11-01 00:00:00.000'),
      (1,9000,1,'cancelled','2026-10-10 00:00:00.000');
  `);
  // Execute the services' actual Drizzle SQL over relational fixtures. These
  // portable SELECTs exercise date selection and joins, not MySQL concurrency.
  state.query.mockReset();
  state.query.mockImplementation(async (sql: string, params: unknown[]) => {
    const statement = database.prepare(sql);
    statement.setReturnArrays(true);
    return { rows: statement.all(...(params as Array<string | number>)) };
  });
  state.db = drizzle(state.query);
  state.cash.mockReset();
  state.cash.mockResolvedValue({
    collectedAmount: 24000,
    refundedAmount: 0,
    earnedRevenue: null,
  });
});
afterEach(() => database.close());

const start = new Date("2026-10-01T00:00:00.000Z");
const end = new Date("2026-10-15T00:00:00.000Z");
const cases = [
  {
    name: "start only",
    startDate: start,
    endDate: undefined,
    total: 90000,
    count: 3,
    direct: 40000,
  },
  {
    name: "end only",
    startDate: undefined,
    endDate: end,
    total: 60000,
    count: 3,
    direct: 10000,
  },
  {
    name: "both inclusive bounds",
    startDate: start,
    endDate: end,
    total: 50000,
    count: 2,
    direct: 0,
  },
  {
    name: "no bounds",
    startDate: undefined,
    endDate: undefined,
    total: 100000,
    count: 4,
    direct: 50000,
  },
];

describe("revenue report date bounds", () => {
  it("counts a corporate booking made by an agent once, without negative direct sales", async () => {
    database.exec("INSERT INTO agent_bookings VALUES(303,3)");

    const channels = await getRevenueByChannel(start, end);

    expect(channels).toEqual([
      {
        channel: "direct",
        totalRevenue: 0,
        bookingCount: 0,
        averageRevenue: 0,
        percentageOfTotal: 0,
      },
      {
        channel: "agent",
        totalRevenue: 20000,
        bookingCount: 1,
        averageRevenue: 20000,
        percentageOfTotal: 40,
      },
      {
        channel: "corporate",
        totalRevenue: 30000,
        bookingCount: 1,
        averageRevenue: 30000,
        percentageOfTotal: 60,
      },
    ]);
  });

  it("returns all channel buckets as zero for a period without paid bookings", async () => {
    const channels = await getRevenueByChannel(
      new Date("2026-12-01T00:00:00.000Z")
    );

    expect(channels.map(row => row.channel)).toEqual([
      "direct",
      "agent",
      "corporate",
    ]);
    for (const row of channels) {
      expect(row).toMatchObject({
        totalRevenue: 0,
        bookingCount: 0,
        averageRevenue: 0,
        percentageOfTotal: 0,
      });
    }
  });

  it.each(cases)(
    "keeps route, class, channel and add-on cohorts consistent: $name",
    async ({ startDate, endDate, total, count, direct }) => {
      const routes = await getRevenueByRoute(startDate, endDate);
      expect(routes).toHaveLength(1);
      expect(routes[0]).toMatchObject({
        totalRevenue: total,
        bookingCount: count,
      });
      const classes = await getRevenueByClass(startDate, endDate);
      expect(classes.reduce((sum, row) => sum + row.totalRevenue, 0)).toBe(
        total
      );
      expect(classes.reduce((sum, row) => sum + row.bookingCount, 0)).toBe(
        count
      );
      const channels = await getRevenueByChannel(startDate, endDate);
      expect(channels.map(row => [row.channel, row.totalRevenue])).toEqual([
        ["direct", direct],
        ["agent", 20000],
        ["corporate", 30000],
      ]);
      expect(channels.reduce((sum, row) => sum + row.bookingCount, 0)).toBe(
        count
      );
      expect(await getAncillaryRevenue(startDate, endDate)).toMatchObject({
        total: total / 10,
      });
    }
  );

  it.each(cases)(
    "uses the same supplied bounds for the dashboard count and cash reader: $name",
    async ({ startDate, endDate, count }) => {
      expect(await getRevenueDashboard(startDate, endDate)).toMatchObject({
        totalBookings: count,
        totalRevenue: 24000,
        averageRevenuePerBooking: 24000 / count,
        recognizedRevenue: null,
        deferredRevenue: null,
      });
      expect(state.cash).toHaveBeenNthCalledWith(1, { startDate, endDate });
    }
  );

  it.each([
    { name: "route", read: getRevenueByRoute },
    { name: "class", read: getRevenueByClass },
    { name: "channel", read: getRevenueByChannel },
    { name: "ancillary", read: getAncillaryRevenue },
    { name: "dashboard", read: getRevenueDashboard },
  ])(
    "rejects invalid and reversed dates before reading report data: $name",
    async ({ read }) => {
      await expect(read(new Date("invalid"))).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      await expect(read(undefined, new Date("invalid"))).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      await expect(read(end, start)).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect(state.query).not.toHaveBeenCalled();
      expect(state.cash).not.toHaveBeenCalled();
    }
  );
});
