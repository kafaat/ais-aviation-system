import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: state.getDb }));

import {
  createExportJob,
  exportBookingsData,
  exportCustomerData,
  exportFlightsData,
  exportOperationalData,
  exportRevenueData,
} from "../services/data-warehouse.service";

const dateRange = {
  startDate: new Date("2026-11-01T00:00:00Z"),
  endDate: new Date("2026-11-02T00:00:00Z"),
};
const options = { format: "csv" as const, dateRange, incremental: true };
beforeEach(() => state.getDb.mockReset());

it.each(["revenue", "customers", "operational"] as const)(
  "rejects unsupported %s increments before allocating a job",
  async type => {
    await expect(
      createExportJob(type, dateRange, "csv", 1, true, dateRange.startDate)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.getDb).not.toHaveBeenCalled();
  }
);

it.each([exportCustomerData, exportOperationalData, exportRevenueData])(
  "rejects incremental aggregate calls directly",
  async read => {
    await expect(
      read({ ...options, lastExportTimestamp: dateRange.startDate })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.getDb).not.toHaveBeenCalled();
  }
);

it.each([exportBookingsData, exportFlightsData])(
  "rejects missing and invalid timestamps in row increments",
  async read => {
    await expect(read(options)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      read({ ...options, lastExportTimestamp: new Date(NaN) })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(state.getDb).not.toHaveBeenCalled();
  }
);

function customerCohort(size: number) {
  const query = {
    from: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn((limit: number) =>
      Array.from({ length: Math.min(limit, size) }, (_, userId) => ({ userId }))
    ),
  };
  state.getDb.mockReturnValue({ select: () => query });
  return query;
}

it("exports exactly 50,000 complete customer rows within the existing byte ceiling", async () => {
  const query = customerCohort(50000);
  const result = await exportCustomerData({ dateRange, format: "csv" });
  expect(query.limit).toHaveBeenCalledWith(50001);
  expect(result.recordCount).toBe(50000);
  expect(result.data.split("\n")).toHaveLength(50001);
  expect(result.fileSize).toBeLessThan(8 * 1024 * 1024);
});

it("rejects a larger customer cohort without returning truncated data", async () => {
  customerCohort(50002);
  await expect(
    exportCustomerData({ dateRange, format: "csv" })
  ).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
    message: expect.stringContaining("includes all users"),
  });
});
