import { describe, expect, it, vi } from "vitest";
vi.mock("./standard-reports.service", () => ({}));
import {
  nextStandardReportRun,
  scheduledStandardReportFilters,
} from "./standard-report-schedules.service";

describe("report cadence and rolling dates", () => {
  it("selects the next UTC time and advances missed days without launching every missed report", () => {
    expect(nextStandardReportRun("manual", 0, 0)).toBeNull();
    expect(
      nextStandardReportRun(
        "daily",
        9,
        30,
        new Date("2026-11-04T08:00:00Z")
      )?.toISOString()
    ).toBe("2026-11-04T09:30:00.000Z");
    expect(
      nextStandardReportRun(
        "daily",
        9,
        30,
        new Date("2026-11-04T09:30:00Z")
      )?.toISOString()
    ).toBe("2026-11-05T09:30:00.000Z");
    expect(
      nextStandardReportRun(
        "weekly",
        9,
        0,
        new Date("2026-11-20T09:00:00Z"),
        new Date("2026-11-04T09:00:00Z")
      )?.toISOString()
    ).toBe("2026-11-25T09:00:00.000Z");
  });
  it("clamps monthly recurrence across short months and leap years", () => {
    expect(
      nextStandardReportRun(
        "monthly",
        3,
        0,
        new Date("2026-01-31T04:00:00Z"),
        new Date("2026-01-31T03:00:00Z")
      )?.toISOString()
    ).toBe("2026-02-28T03:00:00.000Z");
    expect(
      nextStandardReportRun(
        "monthly",
        3,
        0,
        new Date("2028-01-31T04:00:00Z"),
        new Date("2028-01-31T03:00:00Z")
      )?.toISOString()
    ).toBe("2028-02-29T03:00:00.000Z");
  });
  it("uses completed UTC days relative to the intended due time", () => {
    const template = { filters: { flightId: 42 }, lookbackDays: 7 };
    expect(
      scheduledStandardReportFilters(template, new Date("2026-11-04T23:00:00Z"))
    ).toEqual({ flightId: 42, startDate: "2026-10-28", endDate: "2026-11-03" });
    expect(
      scheduledStandardReportFilters(
        { ...template, lookbackDays: null },
        new Date()
      )
    ).toEqual({ flightId: 42 });
  });
});
