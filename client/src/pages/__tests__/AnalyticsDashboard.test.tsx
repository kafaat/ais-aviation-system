import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import AnalyticsDashboard from "../AnalyticsDashboard";

const state = vi.hoisted(() => ({
  failed: new Set<string>(),
  inputs: {} as Record<string, Record<string, unknown>>,
  data: {} as Record<string, unknown>,
  retry: vi.fn(),
}));
const methods = [
  "getKPIs",
  "getRevenueOverTime",
  "getPopularDestinations",
  "getBookingTrends",
  "getAncillaryMetrics",
  "getAncillaryRevenueByCategory",
  "getPopularAncillaries",
];
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { role: "admin" }, isAuthenticated: true }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    analytics: new Proxy(
      {},
      {
        get(_target, method) {
          const name = String(method);
          return {
            useQuery: (input: Record<string, unknown>) => {
              state.inputs[name] = input;
              return {
                data: state.data[name],
                isError: state.failed.has(name),
                isLoading: false,
                isFetching: false,
                refetch: () => state.retry(name),
              };
            },
          };
        },
      }
    ),
    reports: new Proxy({}, { get: () => ({ useMutation: () => ({}) }) }),
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
    children,
  LineChart: ({ data }: { data: unknown }) => (
    <output aria-label="daily collections">{JSON.stringify(data)}</output>
  ),
  BarChart: () => null,
  PieChart: () => null,
  Bar: () => null,
  Line: () => null,
  Pie: () => null,
  Cell: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));
beforeEach(() => {
  state.failed.clear();
  state.inputs = {};
  state.data = {
    getKPIs: {
      totalBookings: 0,
      totalRevenue: 0,
      totalPassengers: 0,
      averageOccupancyRate: 0,
      cancellationRate: 0,
    },
    getRevenueOverTime: [{ date: "2026-01-02", revenue: 12345, bookings: 1 }],
    getPopularDestinations: [],
    getBookingTrends: [],
    getAncillaryMetrics: {},
    getAncillaryRevenueByCategory: [],
    getPopularAncillaries: [],
  };
  state.retry.mockClear();
});

describe("routed analytics report", () => {
  it.each(methods)(
    "shows %s failure instead of zero or stale figures",
    method => {
      state.failed.add(method);
      render(<AnalyticsDashboard />);
      expect(screen.getByRole("alert")).toHaveTextContent(
        "admin.analytics.loadError"
      );
      expect(screen.queryByText("0 SAR")).not.toBeInTheDocument();
      expect(
        screen.queryByLabelText("daily collections")
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "common.retry" }));
      expect(state.retry).toHaveBeenCalledExactlyOnceWith(method);
    }
  );

  it("uses the same selected period for all seven sources and true all-time history", () => {
    render(<AnalyticsDashboard />);
    const period = state.inputs.getKPIs;
    expect(period.startDate).toBeInstanceOf(Date);
    expect(period.endDate).toBeInstanceOf(Date);
    for (const method of methods) {
      expect(state.inputs[method]).toMatchObject(period);
      expect(state.inputs[method]).not.toHaveProperty("days");
    }
    fireEvent.keyDown(
      screen.getByRole("combobox", { name: "admin.analytics.dateFilter" }),
      { key: "ArrowDown" }
    );
    fireEvent.click(
      screen.getByRole("option", { name: "admin.analytics.allTime" })
    );
    for (const method of methods) {
      expect(state.inputs[method]).toMatchObject({ allTime: true });
      expect(state.inputs[method]).not.toHaveProperty("startDate");
      expect(state.inputs[method]).not.toHaveProperty("endDate");
    }
  });

  it("converts ledger minor units to SAR for the daily chart and preserves valid zeros", () => {
    render(<AnalyticsDashboard />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getAllByText("0 SAR").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("daily collections")).toHaveTextContent(
      '"revenue":123.45'
    );
    expect(screen.getByText("admin.analytics.ancillaryBasis")).toBeVisible();
  });
});
