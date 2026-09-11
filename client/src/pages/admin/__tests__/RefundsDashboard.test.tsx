import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import RefundsDashboard from "../RefundsDashboard";
const state = vi.hoisted(() => ({
  stats: {} as any,
  history: {} as any,
  trends: {} as any,
  retry: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("@/components/ExportReportButton", () => ({
  ExportReportButton: () => <button>Export</button>,
}));
vi.mock("@/components/SplitRefundCancellation", () => ({
  SplitRefundCancellation: () => null,
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    refunds: {
      getStats: { useQuery: () => state.stats },
      getHistory: { useQuery: () => state.history },
      getTrends: { useQuery: () => state.trends },
      splitCancellationQueue: { useQuery: () => ({ data: { items: [] } }) },
      splitCancellation: { useQuery: () => ({}) },
    },
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  state.stats = {
    data: {
      totalRefunds: 2,
      refundedBookings: 1,
      totalRefundedAmount: 7501,
      refundRate: 25,
      pendingRefunds: 3,
      pendingRefundAmount: 3001,
      reviewRequiredRefunds: 1,
      reviewRequiredAmount: 4500,
      retainedCancellationFees: 2500,
    },
    refetch: state.retry,
  };
  state.history = {
    data: [
      {
        id: 20,
        bookingId: 7,
        bookingReference: "ABCDEF",
        pnr: "REF123",
        userId: 9,
        amount: 3001,
        status: "settled",
        refundedAt: new Date("2026-09-11T12:00:00Z"),
      },
    ],
    refetch: state.retry,
  };
  state.trends = { data: [], refetch: state.retry };
});
describe("refund dashboard financial disclosure", () => {
  it("shows partial settled money separately from pending amounts and retained fees", () => {
    render(<RefundsDashboard />);
    expect(screen.getByText("75.01")).toBeInTheDocument();
    expect(screen.getByText("admin.refunds.pendingPayers")).toBeInTheDocument();
    expect(screen.getByText("admin.refunds.retainedFees")).toBeInTheDocument();
    expect(screen.getByText("admin.refunds.statusSettled")).toBeInTheDocument();
    expect(
      screen.queryByText("cancelBooking.split.fullRefundStats")
    ).not.toBeInTheDocument();
  });
  it("hides stale totals on read failure and provides a retry", () => {
    state.stats.isError = true;
    render(<RefundsDashboard />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "admin.refunds.loadError"
    );
    expect(screen.queryByText("75.01")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("admin.refunds.retry"));
    expect(state.retry).toHaveBeenCalledOnce();
  });
  it("distinguishes failed history and trends from successful empty results", () => {
    state.history = { isError: true, refetch: state.retry };
    state.trends = { isError: true, refetch: state.retry };
    render(<RefundsDashboard />);
    expect(screen.getByText("admin.refunds.historyError")).toBeInTheDocument();
    expect(screen.getByText("admin.refunds.trendsError")).toBeInTheDocument();
    expect(screen.queryByText("ABCDEF")).not.toBeInTheDocument();
  });
});
