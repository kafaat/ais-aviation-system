import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import AdminDashboard from "../AdminDashboard";

const reads = vi.hoisted(() => ({
  airlines: {} as Record<string, unknown>,
  airports: {} as Record<string, unknown>,
  retryAirlines: vi.fn(),
  retryAirports: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 1, role: "admin" },
    isAuthenticated: true,
    loading: false,
  }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    reference: {
      airlines: { useQuery: () => reads.airlines },
      airports: { useQuery: () => reads.airports },
    },
    admin: { createFlight: { useMutation: () => ({ mutate: vi.fn() }) } },
  },
}));

const LEAKS = [
  "/srv/tenant-7/internal/db.ts:42",
  "tok_SYNTHETIC_SECRET_123",
  "Failed to fetch",
  '[{"code":"invalid_type","path":["tenantId"],"message":"Required"}]',
];
const leakMessage = LEAKS.join(" | ");
function expectNoLeak() {
  const text = document.body.textContent ?? "";
  for (const leak of LEAKS) expect(text).not.toContain(leak);
}

const ok = { data: [], isError: false, error: null };
beforeEach(() => {
  reads.retryAirlines.mockReset();
  reads.retryAirports.mockReset();
  reads.airlines = { ...ok, refetch: reads.retryAirlines };
  reads.airports = { ...ok, refetch: reads.retryAirports };
});

it("reports a failed airports read and retries only that read", () => {
  reads.airports = {
    data: undefined,
    isError: true,
    error: {
      message: "Synthetic airports outage",
      data: { code: "INTERNAL_SERVER_ERROR" },
    },
    refetch: reads.retryAirports,
  };
  render(<AdminDashboard />);
  expect(screen.getByRole("alert")).toHaveTextContent("Source unavailable");
  expect(screen.getByRole("alert")).not.toHaveTextContent(
    "Synthetic airports outage"
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(reads.retryAirports).toHaveBeenCalledOnce();
  expect(reads.retryAirlines).not.toHaveBeenCalled();
});

it("reports a failed airlines read", () => {
  reads.airlines = {
    data: undefined,
    isError: true,
    error: {
      message: "Synthetic airlines outage",
      data: { code: "INTERNAL_SERVER_ERROR" },
    },
    refetch: reads.retryAirlines,
  };
  render(<AdminDashboard />);
  expect(screen.getByRole("alert")).toHaveTextContent("Source unavailable");
  expect(screen.getByRole("alert")).not.toHaveTextContent(
    "Synthetic airlines outage"
  );
});

it("does not alert when both reads succeeded with empty lists", () => {
  render(<AdminDashboard />);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it.each(["INTERNAL_SERVER_ERROR", "BAD_REQUEST"])(
  "never renders the raw message of a %s reference read, keeps Retry",
  code => {
    reads.airlines = {
      data: undefined,
      isError: true,
      error: { message: leakMessage, data: { code } },
      refetch: reads.retryAirlines,
    };
    render(<AdminDashboard />);
    expect(screen.getByRole("alert")).toHaveTextContent("Source unavailable");
    expectNoLeak();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(reads.retryAirlines).toHaveBeenCalledOnce();
  }
);

it("never renders a transport error message", () => {
  reads.airports = {
    data: undefined,
    isError: true,
    error: { message: "Failed to fetch", data: null },
    refetch: reads.retryAirports,
  };
  render(<AdminDashboard />);
  expectNoLeak();
  expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
});

it.each(["UNAUTHORIZED", "FORBIDDEN"])(
  "shows %s as access denied without raw reason or Retry",
  code => {
    reads.airlines = {
      data: undefined,
      isError: true,
      error: { message: leakMessage, data: { code } },
      refetch: reads.retryAirlines,
    };
    render(<AdminDashboard />);
    expect(screen.getByRole("alert")).toHaveTextContent("Access denied");
    expectNoLeak();
    expect(
      screen.queryByRole("button", { name: "Retry" })
    ).not.toBeInTheDocument();
  }
);
