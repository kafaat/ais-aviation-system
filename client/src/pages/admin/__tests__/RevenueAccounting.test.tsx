import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RevenueAccounting } from "../RevenueAccounting";
import { responseContracts } from "../../../../../server/contracts/revenue-accounting";

const state = vi.hoisted(() => ({
  failed: new Set<string>(),
  data: {} as Record<string, unknown>,
  retry: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    revenueAccounting: new Proxy(
      {},
      {
        get(_target, method) {
          const name = String(method);
          return {
            useQuery: () => ({
              data: state.failed.has(name) ? undefined : state.data[name],
              isError: state.failed.has(name),
              isLoading: false,
              refetch: state.retry,
            }),
            useMutation: () => ({
              mutate: vi.fn(),
              isPending: false,
              isError: false,
            }),
          };
        },
      }
    ),
  },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));
beforeEach(() => {
  state.failed.clear();
  state.retry.mockClear();
  state.data = {
    getDashboard: responseContracts.getDashboard.parse({
      totalRevenue: 12345,
      deferredRevenue: 0,
      recognizedRevenue: 0,
      ancillaryRevenue: 0,
      refundTotal: 0,
      netRevenue: 12345,
      revenueGrowthPercent: 0,
      averageRevenuePerBooking: 12345,
      totalBookings: 1,
    }),
    getDeferredRevenue: responseContracts.getDeferredRevenue.parse({
      total: 0,
      items: [],
    }),
    getRevenueByRoute: [],
    getRevenueByClass: [],
    getRevenueByChannel: [],
    getAncillaryRevenue: { total: 0, breakdown: [] },
    getReports: [],
    getYieldAnalysis: [],
  };
});
afterEach(cleanup);
describe("Revenue consumer failures", () => {
  it.each(["getDashboard", "getDeferredRevenue", "getRevenueByRoute"])(
    "%s failure cannot be presented as zero revenue",
    method => {
      state.failed.add(method);
      render(<RevenueAccounting />);
      expect(screen.getByRole("alert").textContent).toContain(
        "Amounts are unavailable"
      );
      expect(screen.queryByText(/0.00 SAR/)).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(state.retry).toHaveBeenCalledTimes(3);
    }
  );
  it.each([
    ["class", "getRevenueByClass"],
    ["channel", "getRevenueByChannel"],
    ["ancillary", "getAncillaryRevenue"],
    ["yield", "getYieldAnalysis"],
    ["reports", "getReports"],
  ])("%s tab reports its own failed source", (tab, method) => {
    render(<RevenueAccounting />);
    state.failed.add(method);
    fireEvent.click(screen.getByRole("button", { name: tab }));
    expect(screen.getByRole("alert").textContent).toContain(
      "could not be loaded"
    );
  });
  it("valid zero data is distinguishable from source failure", () => {
    render(<RevenueAccounting />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getAllByText("123.45 SAR").length).toBeGreaterThan(0);
  });
  it("missing yield evidence renders null amounts without a synthetic distance", () => {
    state.data.getYieldAnalysis = responseContracts.getYieldAnalysis.parse([
      {
        flightId: 7,
        flightNumber: "SV007",
        originCode: "JED",
        destinationCode: "RUH",
        totalRevenue: null,
        passengerCount: 2,
        distanceKm: null,
        rpk: null,
        yield: null,
        loadFactor: 20,
        evidenceId: null,
        sourceId: null,
        coverage: "missing_evidence",
        passengerBasis: "funded_active_membership",
      },
    ]);
    render(<RevenueAccounting />);
    fireEvent.click(screen.getByRole("button", { name: "yield" }));
    expect(screen.getByText("missing_evidence")).toBeTruthy();
    expect(screen.getByText("SV007")).toBeTruthy();
    expect(screen.queryByText("1,000")).toBeNull();
  });
});
