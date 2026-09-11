import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import RevenueAccounting from "../RevenueAccounting";
const state = vi.hoisted(() => ({
  locale: "en",
  dashboard: {} as any,
  route: {} as any,
  preview: {} as any,
  retry: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: state.locale } }),
}));
vi.mock("@/components/ExportReportButton", () => ({
  ExportReportButton: () => <button>Export</button>,
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    revenueAccounting: {
      getDashboard: { useQuery: () => state.dashboard },
      getRevenueByRoute: { useQuery: () => state.route },
      getRevenueByClass: { useQuery: () => ({ data: [] }) },
      getRevenueByChannel: { useQuery: () => ({ data: [] }) },
      getAncillaryRevenue: {
        useQuery: () => ({ data: { total: 0, breakdown: [] } }),
      },
      getYieldAnalysis: { useQuery: () => ({ data: [] }) },
      getReports: { useQuery: () => ({ data: [] }) },
      generateReport: { useMutation: () => state.preview },
    },
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  state.locale = "en";
  state.dashboard = {
    refetch: state.retry,
    data: {
      totalRevenue: 10001,
      refundTotal: 7501,
      netRevenue: 2500,
      bookedAmount: 99999,
      totalBookings: 1,
      averageRevenuePerBooking: 10001,
      revenueGrowthPercent: null,
      unmatchedCollectionEntries: 2,
      unpostedPaidBookings: 1,
      reviewCollectionAmount: 0,
    },
  };
  state.route = { refetch: state.retry, data: [] };
  state.preview = { mutate: vi.fn(), reset: vi.fn() };
});
describe("financial reporting user truthfulness", () => {
  it("separates posted money and face values and discloses unsupported recognition", () => {
    render(<RevenueAccounting />);
    expect(screen.getAllByText("100.01 SAR").length).toBeGreaterThan(0);
    expect(screen.getByText("75.01 SAR")).toBeInTheDocument();
    expect(screen.getByText("25.00 SAR")).toBeInTheDocument();
    expect(screen.getByText("999.99 SAR")).toBeInTheDocument();
    expect(
      screen.getByText(/Unavailable: earned and deferred revenue/)
    ).toBeInTheDocument();
    expect(screen.getByText(/Not comparable/)).toBeInTheDocument();
    expect(
      screen.getByText(/Collections without matching receipt evidence/)
    ).toHaveTextContent("2");
  });
  it("hides stale dashboard amounts on failure and offers a retry", () => {
    state.dashboard.isError = true;
    render(<RevenueAccounting />);
    expect(screen.queryByText("75.01 SAR")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");
    fireEvent.click(screen.getByText("Retry"));
    expect(state.retry).toHaveBeenCalledOnce();
  });
  it("does not disguise a failed tab as a successful empty result", () => {
    state.route.isError = true;
    render(<RevenueAccounting />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(
      screen.queryByText("No posted entries in this period.")
    ).not.toBeInTheDocument();
  });
  it("does not present an old preview after generation fails", () => {
    state.preview = {
      isError: true,
      data: { periodStart: "STALE_REPORT" },
      mutate: vi.fn(),
      reset: vi.fn(),
    };
    render(<RevenueAccounting />);
    fireEvent.click(screen.getByRole("tab", { name: "Monthly previews" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Monthly preview failed"
    );
    expect(screen.queryByText(/STALE_REPORT/)).not.toBeInTheDocument();
  });
  it("explains the financial scope in Arabic", () => {
    state.locale = "ar";
    render(<RevenueAccounting />);
    expect(
      screen.getByText("تحصيل الحجوزات والتقارير المالية")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/غير متاح: الإيراد المكتسب والمؤجل/)
    ).toBeInTheDocument();
  });
});
