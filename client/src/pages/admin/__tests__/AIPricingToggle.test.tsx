import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import en from "@/i18n/locales/en.json";
import AIPricingDashboard from "../AIPricingDashboard";

/**
 * Review finding R5 (#355): the dashboard's power button sent `enabled: true`
 * on every click and never showed the current state, so an admin could not
 * switch the AI multiplier off from this page. The button now reads the state
 * from the dashboard query, sends the opposite value, and the dashboard is
 * re-read after the server confirms the change.
 */
const state = vi.hoisted(() => ({
  enabled: true as boolean | undefined,
  loading: false,
  mutate: vi.fn(),
  invalidate: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  onSuccess: undefined as ((r: { enabled: boolean }) => void) | undefined,
}));
vi.mock("sonner", () => ({
  toast: { success: state.success, error: state.error },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: "en" },
    t: (key: string) =>
      String(
        key
          .split(".")
          .reduce(
            (current: unknown, part) =>
              (current as Record<string, unknown> | undefined)?.[part],
            en
          ) ?? key
      ),
  }),
}));
vi.mock("@/lib/trpc", () => {
  const dashboard = () =>
    state.enabled === undefined
      ? undefined
      : {
          success: true,
          data: {
            enabled: state.enabled,
            demandForecasts: [],
            segmentDistribution: [],
            activeTests: [],
            revenueMetrics: {
              totalRevenue: 0,
              avgYield: 0,
              loadFactor: 0,
              optimizationImpact: 0,
            },
            recentOptimizations: [],
          },
        };
  const query = (data: unknown) => ({
    data,
    isLoading: state.loading,
    isError: false,
    refetch: vi.fn(),
  });
  return {
    trpc: {
      useUtils: () => ({
        aiPricing: { getDashboard: { invalidate: state.invalidate } },
      }),
      aiPricing: {
        getDashboard: { useQuery: () => query(dashboard()) },
        forecastDemand: { useQuery: () => query(undefined) },
        getSegments: { useQuery: () => query([]) },
        getABTests: { useQuery: () => query([]) },
        setEnabled: {
          useMutation: (options: {
            onSuccess?: (r: { enabled: boolean }) => void;
          }) => {
            state.onSuccess = options.onSuccess;
            return { mutate: state.mutate, isPending: false };
          },
        },
      },
    },
  };
});

beforeEach(() => {
  state.enabled = true;
  state.loading = false;
  state.mutate.mockClear();
  state.invalidate.mockClear();
  state.success.mockClear();
  state.error.mockClear();
});

it("shows that AI pricing is on and offers to turn it off", () => {
  render(<AIPricingDashboard />);
  expect(screen.getByText("AI pricing is on")).toBeVisible();
  const button = screen.getByRole("button", { name: "Turn AI pricing off" });
  expect(button).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(button);
  expect(state.mutate).toHaveBeenCalledExactlyOnceWith({ enabled: false });
});

it("shows that AI pricing is off and sends the opposite value", () => {
  state.enabled = false;
  render(<AIPricingDashboard />);
  expect(screen.getByText("AI pricing is off")).toBeVisible();
  const button = screen.getByRole("button", { name: "Turn AI pricing on" });
  expect(button).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(button);
  expect(state.mutate).toHaveBeenCalledExactlyOnceWith({ enabled: true });
});

it("does not offer a toggle before the current state is known", () => {
  state.enabled = undefined;
  state.loading = true;
  render(<AIPricingDashboard />);
  expect(screen.queryByText("AI pricing is on")).not.toBeInTheDocument();
  expect(screen.queryByText("AI pricing is off")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Turn AI pricing off" })
  ).toBeDisabled();
});

it("re-reads the dashboard and announces the confirmed state after a change", () => {
  render(<AIPricingDashboard />);
  act(() => state.onSuccess!({ enabled: false }));
  expect(state.invalidate).toHaveBeenCalledOnce();
  expect(state.success).toHaveBeenCalledWith(
    "AI pricing is off. New quotes use the base fare rules."
  );
  act(() => state.onSuccess!({ enabled: true }));
  expect(state.success).toHaveBeenCalledWith(
    "AI pricing is now applied to new quotes."
  );
  expect(state.error).not.toHaveBeenCalled();
});
