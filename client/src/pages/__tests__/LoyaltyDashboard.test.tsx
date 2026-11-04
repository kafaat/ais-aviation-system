import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import translations from "../../i18n/locales/en.json";
import LoyaltyDashboard from "../LoyaltyDashboard";

type Transaction = {
  id: number;
  userId: number;
  createdAt: Date;
  type: "earn" | "redeem";
  amount: number;
  balanceAfter: number;
  description: string;
};

const state = vi.hoisted(() => ({
  user: { id: 17, role: "user" } as { id: number; role: string } | null,
  pages: {} as Record<number, Transaction[]>,
  failed: new Set<number>(),
  loading: new Set<number>(),
  accountFailed: false,
  requests: [] as {
    input: { limit: number; offset?: number };
    enabled: boolean;
  }[],
  accountOptions: {} as { enabled: boolean },
  mfaOptions: {} as { enabled: boolean },
  retry: vi.fn(),
  accountRetry: vi.fn(),
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: state.user, loading: false }),
}));
vi.mock("@/components/FamilyPoolCard", () => ({ FamilyPoolCard: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string, options: Record<string, unknown> = {}) => {
      const value = key.split(".").reduce<unknown>((result, part) => {
        return result && typeof result === "object"
          ? (result as Record<string, unknown>)[part]
          : undefined;
      }, translations);
      return typeof value === "string"
        ? value.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
            String(options[name] ?? "")
          )
        : key;
    },
  }),
}));
vi.mock("framer-motion", async () => {
  const { createElement } = await import("react");
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    motion: new Proxy(
      {},
      {
        get:
          (_target, tag: string) =>
          ({
            children,
            initial: _initial,
            animate: _animate,
            transition: _transition,
            ...props
          }: {
            children?: React.ReactNode;
            initial?: unknown;
            animate?: unknown;
            transition?: unknown;
          }) =>
            createElement(tag, props, children),
      }
    ),
  };
});
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
    children,
  AreaChart: ({ data }: { data: unknown }) => (
    <output aria-label="recent miles chart">{JSON.stringify(data)}</output>
  ),
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      loyalty: {
        myAccount: { invalidate: vi.fn() },
        myTransactions: { invalidate: vi.fn() },
      },
    }),
    mfa: {
      getStatus: {
        useQuery: (_input: undefined, options: { enabled: boolean }) => {
          state.mfaOptions = options;
          return { data: { enabled: false }, isError: false };
        },
      },
    },
    loyalty: {
      myAccount: {
        useQuery: (_input: undefined, options: { enabled: boolean }) => {
          state.accountOptions = options;
          return {
            data: {
              id: 8,
              userId: 17,
              tier: "bronze",
              totalMilesEarned: 5000,
              currentMilesBalance: 3000,
              createdAt: new Date("2025-01-01T00:00:00Z"),
            },
            isLoading: false,
            isError: state.accountFailed,
            isFetching: false,
            refetch: state.accountRetry,
          };
        },
      },
      myTransactions: {
        useQuery: (
          input: { limit: number; offset?: number },
          options: { enabled: boolean }
        ) => {
          const offset = input.offset ?? 0;
          state.requests.push({ input, enabled: options.enabled });
          return {
            data: state.pages[offset] ?? [],
            isLoading: state.loading.has(offset),
            isError: state.failed.has(offset),
            isFetching: state.loading.has(offset),
            refetch: () => state.retry(offset),
          };
        },
      },
      redeemMiles: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
    },
  },
}));

beforeEach(() => {
  state.user = { id: 17, role: "user" };
  state.failed.clear();
  state.loading.clear();
  state.accountFailed = false;
  state.requests = [];
  state.retry.mockClear();
  state.accountRetry.mockClear();
  const transactions: Transaction[] = Array.from(
    { length: 105 },
    (_, index) => ({
      id: 105 - index,
      userId: 17,
      createdAt: new Date(),
      type: "earn",
      amount: index < 50 ? 10 : 1,
      balanceAfter: 1000 - index,
      description: `Transaction ${105 - index}`,
    })
  );
  state.pages = {
    0: transactions.slice(0, 50),
    50: transactions.slice(50, 100),
    100: transactions.slice(100),
  };
});

describe("loyalty reporting", () => {
  it("labels recent statistics as bounded and keeps them stable while paging through all 105 transactions", () => {
    render(<LoyaltyDashboard />);
    expect(
      screen.getByText("Earned in latest transactions")
    ).toBeInTheDocument();
    expect(screen.queryByText("Earned This Month")).not.toBeInTheDocument();
    expect(
      screen.getAllByText("Up to 50 latest transactions").length
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "Monthly activity from up to 50 latest transactions within the last 6 months."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("+500")).toBeInTheDocument();
    expect(screen.getByRole("table").querySelectorAll("tbody tr")).toHaveLength(
      10
    );
    expect(screen.queryByText("Transaction 55")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View All" }));
    expect(screen.getByRole("table").querySelectorAll("tbody tr")).toHaveLength(
      50
    );
    expect(
      screen.getByRole("button", { name: "Previous page" })
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(state.requests).toContainEqual({
      input: { limit: 50, offset: 50 },
      enabled: true,
    });
    expect(screen.getByText("Transaction 55")).toBeInTheDocument();
    expect(screen.queryByText("Transaction 105")).not.toBeInTheDocument();
    expect(screen.getByText("+500")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(state.requests).toContainEqual({
      input: { limit: 50, offset: 100 },
      enabled: true,
    });
    expect(screen.getByRole("table").querySelectorAll("tbody tr")).toHaveLength(
      5
    );
    expect(screen.getByText("Transaction 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(screen.getByText("Transaction 55")).toBeInTheDocument();
  });

  it("hides stale history on a failed page and preserves a path back to the latest records", () => {
    state.failed.add(50);
    render(<LoyaltyDashboard />);
    fireEvent.click(screen.getByRole("button", { name: "View All" }));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Transaction history could not be loaded."
    );
    expect(screen.queryByText("Transaction 55")).not.toBeInTheDocument();
    expect(screen.queryByText("No transactions yet")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    fireEvent.click(
      within(screen.getByRole("alert")).getByRole("button", { name: "Retry" })
    );
    expect(state.retry).toHaveBeenCalledWith(50);
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(screen.getByText("Transaction 105")).toBeInTheDocument();
  });

  it("withholds recent summary and chart data when the latest history fails", () => {
    state.failed.add(0);
    render(<LoyaltyDashboard />);
    expect(screen.queryByText("+500")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("recent miles chart")
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Transaction 105")).not.toBeInTheDocument();
    expect(
      screen.getAllByText("Transaction history could not be loaded.").length
    ).toBeGreaterThan(0);
  });

  it("shows loading and empty history separately", () => {
    state.loading.add(0);
    const { rerender } = render(<LoyaltyDashboard />);
    expect(screen.queryByText("No transactions yet")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("recent miles chart")
    ).not.toBeInTheDocument();
    state.loading.clear();
    state.pages[0] = [];
    rerender(<LoyaltyDashboard />);
    expect(screen.getAllByText("No transactions yet").length).toBeGreaterThan(
      0
    );
    expect(
      screen.queryByRole("button", { name: "View All" })
    ).not.toBeInTheDocument();
  });

  it("does not display a zero or stale balance after the account query fails", () => {
    state.accountFailed = true;
    render(<LoyaltyDashboard />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your loyalty account could not be loaded."
    );
    expect(screen.queryByText("3,000")).not.toBeInTheDocument();
    expect(screen.queryByText("Transaction 105")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(state.accountRetry).toHaveBeenCalledOnce();
  });

  it("does not request or display private history for an unauthenticated viewer", () => {
    state.user = null;
    render(<LoyaltyDashboard />);
    expect(screen.getByText("Login Required")).toBeInTheDocument();
    expect(screen.queryByText("Transaction 105")).not.toBeInTheDocument();
    expect(screen.queryByText("3,000")).not.toBeInTheDocument();
    expect(state.requests.every(request => !request.enabled)).toBe(true);
    expect(state.accountOptions.enabled).toBe(false);
    expect(state.mfaOptions.enabled).toBe(false);
  });
});
