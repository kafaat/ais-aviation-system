import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import MyBookings from "../MyBookings";

const state = vi.hoisted(() => ({
  failed: false,
  data: [] as [] | undefined,
  retry: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    bookings: {
      myBookings: {
        useQuery: () => ({
          data: state.data,
          isLoading: false,
          error: state.failed ? new Error("Synthetic source failure") : null,
          refetch: state.retry,
        }),
      },
    },
    flights: {
      statusBatch: {
        useQuery: () => ({ data: [], isSuccess: true }),
      },
    },
  },
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1 }, isAuthenticated: true, loading: false }),
}));
vi.mock("@/components/SEO", () => ({ SEO: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
beforeEach(() => {
  state.failed = false;
  state.data = [];
  state.retry.mockClear();
});

it.each([undefined, []] as const)(
  "does not present a failed booking read as empty (data=%j)",
  data => {
    state.failed = true;
    state.data = data === undefined ? undefined : [];
    render(<MyBookings />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Synthetic source failure"
    );
    expect(screen.queryByText("myBookings.noBookings")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(state.retry).toHaveBeenCalledOnce();
  }
);

it("distinguishes a successful empty response from a source failure", () => {
  render(<MyBookings />);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByText("myBookings.noBookings")).toBeVisible();
});
