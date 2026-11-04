import { beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/mysql-proxy";

const state = vi.hoisted(() => ({
  db: null as unknown,
  rows: [] as unknown[][][],
  queries: [] as { sql: string; params: unknown[] }[],
  days: vi.fn(),
  summary: vi.fn(),
}));
vi.mock("../db", () => ({ getDb: () => state.db }));
vi.mock("../services/financial-reporting.service", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../services/financial-reporting.service")
  >()),
  getFinancialDays: state.days,
  getFinancialSummary: state.summary,
}));

import {
  getKPIMetrics,
  getRevenueOverTime,
  getBookingTrends,
  getPopularDestinations,
  getFlightOccupancyDetails,
  getAncillaryMetrics,
  getAncillaryRevenueByCategory,
  getPopularAncillaries,
} from "../services/analytics.service";

const startDate = new Date("2026-11-01T00:00:00.000Z");
const endDate = new Date("2026-11-04T23:59:59.999Z");

beforeEach(() => {
  vi.clearAllMocks();
  state.rows = [];
  state.queries = [];
  state.db = drizzle(async (sql, params) => {
    state.queries.push({ sql, params });
    return { rows: state.rows.shift() ?? [] };
  });
  state.days.mockResolvedValue([]);
  state.summary.mockResolvedValue({ netCollectedAmount: 12300 });
});

describe("analytics reporting data boundaries", () => {
  it("counts capacity once per flight and includes authoritative onward segments", async () => {
    // MySQL aggregates may be strings. Two sold flights: 80 passengers / 300 seats.
    state.rows.push(
      [["4", "100"]],
      [["4", "1"]],
      [
        ["100", "30"],
        ["200", "50"],
      ]
    );
    const result = await getKPIMetrics(startDate);
    expect(result).toMatchObject({
      totalBookings: 4,
      totalPassengers: 100,
      averageOccupancyRate: 26.7,
      cancellationRate: 25,
      totalRevenue: 12300,
    });
    for (const query of state.queries) {
      expect(query.sql).toContain("`bookings`.`createdAt` >= ?");
      expect(query.params).toHaveLength(1);
    }
    const occupancy = state.queries[2].sql;
    expect(occupancy).toContain("from `flights` inner join `bookings`");
    expect(occupancy).toContain("group by `flights`.`id`");
    expect(occupancy).not.toContain("SUM(`flights`.`economySeats`");
    expect(occupancy).toContain("booking_segments bs");
    expect(occupancy).toContain("bs.status IN ('confirmed','completed')");
    expect(occupancy).toContain("`bookings`.`deletedAt` is null");
    expect(state.summary).toHaveBeenCalledWith({
      startDate,
      endDate: undefined,
    });
  });

  it("preserves explicit revenue boundaries and provides real all-time history", async () => {
    state.days.mockResolvedValue([
      { date: "2020-01-01", netCollectedAmount: 12345, bookings: 1 },
    ]);
    expect(await getRevenueOverTime(30, {})).toEqual([
      { date: "2020-01-01", revenue: 12345, bookings: 1 },
    ]);
    expect(state.days).toHaveBeenLastCalledWith({});
    await getRevenueOverTime(365, { startDate, endDate });
    expect(state.days).toHaveBeenLastCalledWith({ startDate, endDate });
    await getRevenueOverTime(30);
    expect(state.days).toHaveBeenLastCalledWith({
      startDate: expect.any(Date),
    });
  });

  it("filters series and rankings by independently supplied bounds", async () => {
    await getBookingTrends(365, { endDate });
    expect(state.queries[0].sql).toContain("`bookings`.`createdAt` <= ?");
    expect(state.queries[0].sql).not.toContain("`bookings`.`createdAt` >=");
    await getBookingTrends(30, {});
    expect(state.queries[1].sql).not.toContain(" where ");
    await getPopularDestinations(10, { startDate, endDate });
    expect(state.queries[2].sql).toContain("`bookings`.`createdAt` >= ?");
    expect(state.queries[2].sql).toContain("`bookings`.`createdAt` <= ?");
  });

  it("uses active funded items and the same booking cohort in ancillary ratios", async () => {
    state.rows.push([["10000", "4"]], [["4"]], [["2"]]);
    expect(await getAncillaryMetrics(startDate, endDate)).toEqual({
      totalAncillaryRevenue: 10000,
      totalAncillariesSold: 4,
      ancillaryAttachmentRate: 50,
      averageAncillaryRevenuePerBooking: 2500,
    });
    for (const query of state.queries) {
      expect(query.sql).toContain("`bookings`.`createdAt` >= ?");
      expect(query.sql).toContain("`bookings`.`createdAt` <= ?");
      expect(query.sql).not.toContain("`booking_ancillaries`.`createdAt`");
    }
    for (const query of [state.queries[0], state.queries[2]]) {
      expect(query.sql).toContain("inner join `bookings`");
      expect(query.sql).toContain(
        "`booking_ancillaries`.`fundedAt` is not null"
      );
      expect(query.sql).toContain("`booking_ancillaries`.`status` = ?");
      expect(query.params).toContain("active");
    }
  });

  it("sums decimal strings numerically for ancillary category percentages", async () => {
    state.rows.push([
      ["baggage", "6000", "3"],
      ["meal", "4000", "2"],
    ]);
    expect(await getAncillaryRevenueByCategory({ startDate })).toEqual([
      { category: "baggage", revenue: 6000, quantity: 3, percentage: 60 },
      { category: "meal", revenue: 4000, quantity: 2, percentage: 40 },
    ]);
    await getPopularAncillaries(5, { endDate });
    expect(state.queries[0].params).toContain("active");
    expect(state.queries[0].sql).toContain("`bookings`.`createdAt` >= ?");
    expect(state.queries[1].sql).toContain("`bookings`.`createdAt` <= ?");
    expect(state.queries[1].sql).toContain(
      "`booking_ancillaries`.`fundedAt` is not null"
    );
  });

  it("handles zero-capacity flights and onward membership in the occupancy query", async () => {
    await getFlightOccupancyDetails();
    expect(state.queries[0].sql).toContain(
      "NULLIF(`flights`.`economySeats` + `flights`.`businessSeats`, 0)"
    );
    expect(state.queries[0].sql).toContain("booking_segments bs");
    expect(state.queries[0].sql).toContain("('confirmed','completed')");
  });

  it("rejects a reversed report period before executing a data query", async () => {
    await expect(
      getAncillaryRevenueByCategory({ startDate: endDate, endDate: startDate })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.queries).toHaveLength(0);
  });
});
