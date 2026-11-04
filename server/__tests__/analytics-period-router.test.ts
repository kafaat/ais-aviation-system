import { beforeEach, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));
vi.mock("../services/analytics.service", () => ({
  getKPIMetrics: vi.fn(),
  getRevenueOverTime: vi.fn().mockResolvedValue([]),
  getPopularDestinations: vi.fn().mockResolvedValue([]),
  getBookingTrends: vi.fn().mockResolvedValue([]),
  getFlightOccupancyDetails: vi.fn().mockResolvedValue([]),
  getAncillaryMetrics: vi.fn(),
  getAncillaryRevenueByCategory: vi.fn().mockResolvedValue([]),
  getPopularAncillaries: vi.fn().mockResolvedValue([]),
}));
import { analyticsRouter } from "../routers/analytics";
import * as service from "../services/analytics.service";

const caller = (role = "admin") =>
  analyticsRouter.createCaller({
    user: { id: 1, role, tenantId: null },
    tenantId: null,
    req: { headers: {} },
    res: {},
  } as TrpcContext);
const period = {
  startDate: new Date("2026-11-01T00:00:00Z"),
  endDate: new Date("2026-11-04T23:59:59Z"),
};
const endpoints = [
  "getKPIs",
  "getRevenueOverTime",
  "getPopularDestinations",
  "getBookingTrends",
  "getAncillaryMetrics",
  "getAncillaryRevenueByCategory",
  "getPopularAncillaries",
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(service.getKPIMetrics).mockResolvedValue({
    totalBookings: 0,
    totalRevenue: 0,
    billedAmount: 0,
    collectedAmount: 0,
    nonCashFundedAmount: 0,
    nonCashRefundedAmount: 0,
    refundedAmount: 0,
    netCollectedAmount: 0,
    earnedRevenue: null,
    unreconciledBookings: 0,
    unclassifiedEntries: 0,
    currency: "SAR",
    amountUnit: "minor",
    averageOccupancyRate: 0,
    cancellationRate: 0,
    totalPassengers: 0,
  });
  vi.mocked(service.getAncillaryMetrics).mockResolvedValue({
    totalAncillaryRevenue: 0,
    totalAncillariesSold: 0,
    ancillaryAttachmentRate: 0,
    averageAncillaryRevenuePerBooking: 0,
  });
});

it("passes the same explicit period to all seven dashboard queries", async () => {
  for (const endpoint of endpoints) await caller()[endpoint](period);
  expect(service.getKPIMetrics).toHaveBeenCalledWith(
    period.startDate,
    period.endDate
  );
  expect(service.getAncillaryMetrics).toHaveBeenCalledWith(
    period.startDate,
    period.endDate
  );
  expect(service.getRevenueOverTime).toHaveBeenCalledWith(30, period);
  expect(service.getBookingTrends).toHaveBeenCalledWith(30, period);
  expect(service.getPopularDestinations).toHaveBeenCalledWith(10, period);
  expect(service.getAncillaryRevenueByCategory).toHaveBeenCalledWith(period);
  expect(service.getPopularAncillaries).toHaveBeenCalledWith(10, period);
});

it("distinguishes all-time from legacy rolling series defaults", async () => {
  await caller().getRevenueOverTime({ allTime: true });
  expect(service.getRevenueOverTime).toHaveBeenLastCalledWith(30, {});
  await caller().getBookingTrends({ allTime: true, days: 365 });
  expect(service.getBookingTrends).toHaveBeenLastCalledWith(365, {});
  await caller().getRevenueOverTime();
  expect(service.getRevenueOverTime).toHaveBeenLastCalledWith(30, undefined);
  await caller().getBookingTrends({ endDate: period.endDate });
  expect(service.getBookingTrends).toHaveBeenLastCalledWith(30, {
    endDate: period.endDate,
    startDate: undefined,
  });
});

it.each(endpoints)(
  "%s rejects reversed or contradictory periods",
  async endpoint => {
    await expect(
      caller()[endpoint]({
        startDate: period.endDate,
        endDate: period.startDate,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller()[endpoint]({ allTime: true, startDate: period.startDate })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }
);

it.each(endpoints)(
  "%s remains restricted to global administrators",
  async endpoint => {
    await expect(
      caller("user")[endpoint]({ allTime: true })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  }
);
