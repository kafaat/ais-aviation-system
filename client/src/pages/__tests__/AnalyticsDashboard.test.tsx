import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import AnalyticsDashboard from "../AnalyticsDashboard";

const state = vi.hoisted(() => ({
  failed: new Set<string>(),
  loading: new Set<string>(),
  inputs: {} as Record<string, Record<string, unknown> | undefined>,
  options: {} as Record<string, { enabled: boolean }>,
  data: {} as Record<string, unknown>,
  role: "admin" as string | null,
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
  useAuth: () => ({
    user: state.role ? { role: state.role } : null,
    isAuthenticated: state.role !== null,
  }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    analytics: new Proxy(
      {},
      {
        get(_target, method) {
          const name = String(method);
          return {
            useQuery: (
              input: Record<string, unknown> | undefined,
              options: { enabled: boolean }
            ) => {
              state.inputs[name] = input;
              state.options[name] = options;
              return {
                data: state.data[name],
                isError: state.failed.has(name),
                isLoading: state.loading.has(name),
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
  state.loading.clear();
  state.inputs = {};
  state.options = {};
  state.role = "admin";
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
    getFlightOccupancy: [],
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
    const period = state.inputs.getKPIs!;
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

  it("connects upcoming occupancy independently of the selected historical period and marks zero capacity unavailable", () => {
    state.data.getFlightOccupancy = [
      {
        flightId: 12,
        flightNumber: "ZZ120",
        departureTime: new Date("2030-04-05T10:15:00Z"),
        totalSeats: 20,
        bookedSeats: 15,
        occupancyRate: 75,
      },
      {
        flightId: 13,
        flightNumber: "ZZ130",
        departureTime: new Date("2030-04-06T13:00:00Z"),
        totalSeats: 0,
        bookedSeats: 0,
        occupancyRate: 0,
      },
    ];
    render(<AnalyticsDashboard />);
    expect(state.inputs).toHaveProperty("getFlightOccupancy", undefined);
    expect(state.options.getFlightOccupancy).toEqual({ enabled: true });
    expect(
      screen.getByText("admin.analytics.upcomingOccupancyScope")
    ).toBeVisible();
    const row = screen.getByText("ZZ120").closest("tr")!;
    expect(within(row).getByText("75%")).toBeVisible();
    expect(within(row).getByText("15 / 20")).toBeVisible();
    expect(within(row).getByText("2030-04-05 10:15 UTC")).toBeVisible();
    const zeroCapacityRow = screen.getByText("ZZ130").closest("tr")!;
    expect(
      within(zeroCapacityRow).getByText("admin.analytics.occupancyUnavailable")
    ).toBeVisible();
    expect(within(zeroCapacityRow).queryByText("0%")).not.toBeInTheDocument();
    fireEvent.keyDown(
      screen.getByRole("combobox", { name: "admin.analytics.dateFilter" }),
      { key: "ArrowDown" }
    );
    fireEvent.click(
      screen.getByRole("option", { name: "admin.analytics.allTime" })
    );
    expect(state.inputs.getFlightOccupancy).toBeUndefined();
    expect(within(row).getByText("75%")).toBeVisible();
  });

  it("hides stale occupancy rows on failure and retries that source", () => {
    state.data.getFlightOccupancy = [
      {
        flightId: 12,
        flightNumber: "STALE",
        departureTime: new Date(),
        totalSeats: 20,
        bookedSeats: 15,
        occupancyRate: 75,
      },
    ];
    state.failed.add("getFlightOccupancy");
    render(<AnalyticsDashboard />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "admin.analytics.occupancyLoadError"
    );
    expect(screen.queryByText("STALE")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "common.retry" }));
    expect(state.retry).toHaveBeenCalledExactlyOnceWith("getFlightOccupancy");
  });

  it("distinguishes loading occupancy from an empty upcoming-flight list", () => {
    state.loading.add("getFlightOccupancy");
    const { rerender } = render(<AnalyticsDashboard />);
    expect(
      screen.queryByText("admin.analytics.noUpcomingFlights")
    ).not.toBeInTheDocument();
    state.loading.clear();
    rerender(<AnalyticsDashboard />);
    expect(screen.getByText("admin.analytics.noUpcomingFlights")).toBeVisible();
  });

  it.each([null, "user"])(
    "disables report queries for an unauthorized viewer (%s)",
    role => {
      state.role = role;
      render(<AnalyticsDashboard />);
      for (const method of [...methods, "getFlightOccupancy"]) {
        expect(state.options[method]).toEqual({ enabled: false });
      }
      expect(
        screen.queryByLabelText("daily collections")
      ).not.toBeInTheDocument();
    }
  );
});
