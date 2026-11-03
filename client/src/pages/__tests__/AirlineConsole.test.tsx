import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import AirlineConsole from "../AirlineConsole";

const api = vi.hoisted(() => ({
  role: "ops",
  closeout: vi.fn(),
  coupons: vi.fn(),
  flights: vi.fn(),
  changeStatus: vi.fn(),
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { role: api.role }, loading: false }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" }, t: (key: string) => key }),
}));
vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/InternalFundingRefund", () => ({
  InternalFundingRefund: () => null,
}));
vi.mock("@/components/SettlementLedgerDraft", () => ({
  SettlementLedgerDraft: () => null,
}));
vi.mock("@/components/SupplierFinanceControl", () => ({
  SupplierFinanceControl: () => null,
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    operations: { airlineFlights: { useQuery: api.flights } },
    admin: {
      updateFlightStatus: { useMutation: () => ({ mutate: api.changeStatus }) },
    },
    baggage: { flightCloseout: { useQuery: api.closeout } },
    revenueAccounting: { couponMonthReview: { useQuery: api.coupons } },
  },
}));

it("allows finance to review the requested booking and month without querying ops", () => {
  api.role = "finance";
  const refetch = vi.fn();
  api.coupons.mockReturnValue({ refetch });
  render(<AirlineConsole />);
  const review = screen.getByRole("button", { name: "Review coupon evidence" });
  expect(review).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Booking ID"), {
    target: { value: "82" },
  });
  fireEvent.change(screen.getByLabelText("UTC reporting month"), {
    target: { value: "2026-10" },
  });
  fireEvent.click(review);
  expect(api.coupons).toHaveBeenLastCalledWith(
    { bookingId: 82, month: "2026-10" },
    { enabled: false, retry: false }
  );
  expect(refetch).toHaveBeenCalledOnce();
  expect(api.flights).not.toHaveBeenCalled();
  expect(api.closeout).not.toHaveBeenCalled();
});

it("lets ops inspect the selected company flight without submitting a transition or querying finance", () => {
  api.role = "ops";
  const refetch = vi.fn();
  api.flights.mockReturnValue({
    data: [41, 42].map(id => ({
      id,
      flightNumber: "ZZ" + id,
      status: "scheduled",
      departureTime: new Date(),
    })),
  });
  api.closeout.mockReturnValue({
    refetch,
    data: {
      flightId: 41,
      readyToClose: false,
      missingEntry: ["SYNTHETIC-TAG"],
      missingLoading: [],
      duplicates: [],
      loadedBags: 0,
      expectedBags: 1,
      unexpectedBags: 0,
    },
  });
  render(<AirlineConsole />);
  expect(api.closeout).not.toHaveBeenCalled();
  const flight = screen.getByLabelText("Flight", { selector: "select" });
  fireEvent.change(flight, { target: { value: "41" } });
  expect(api.closeout).toHaveBeenLastCalledWith(
    { flightId: 41 },
    { enabled: false, retry: false }
  );
  fireEvent.click(
    screen.getByRole("button", { name: "dcs.manifest.checkBaggage" })
  );
  expect(refetch).toHaveBeenCalledOnce();
  expect(api.changeStatus).not.toHaveBeenCalled();
  expect(screen.getByText("SYNTHETIC-TAG")).toBeInTheDocument();
  fireEvent.change(flight, { target: { value: "42" } });
  expect(screen.queryByText("SYNTHETIC-TAG")).not.toBeInTheDocument();
  expect(api.coupons).not.toHaveBeenCalled();
});

it("reaches a later flight, clears stale commands and can return to the first page", () => {
  api.role = "ops";
  const departureTime = new Date("2030-01-01T00:00:00Z");
  const rows = Array.from({ length: 51 }, (_, n) => ({
    id: n + 1,
    flightNumber: "ZZ" + (n + 1),
    status: "scheduled",
    departureTime,
  }));
  api.flights.mockImplementation(({ after }) => ({
    data: after ? rows.slice(50) : rows,
  }));
  render(<AirlineConsole />);
  const selector = screen.getByLabelText("Flight", { selector: "select" });
  fireEvent.change(selector, { target: { value: "1" } });
  fireEvent.change(screen.getByLabelText("Transition reason"), {
    target: { value: "Previous flight" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Next flights" }));
  expect(api.flights).toHaveBeenLastCalledWith({
    after: { id: 50, departureTime },
    limit: 51,
  });
  expect(selector).toHaveValue("");
  expect(screen.getByLabelText("Transition reason")).toHaveValue("");
  expect(
    screen.getByRole("button", { name: "Apply transition" })
  ).toBeDisabled();
  expect(screen.getByRole("option", { name: "ZZ51 (51)" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next flights" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Previous flights" }));
  expect(api.flights).toHaveBeenLastCalledWith({ after: undefined, limit: 51 });
  expect(
    screen.queryByRole("option", { name: "ZZ51 (51)" })
  ).not.toBeInTheDocument();
});
