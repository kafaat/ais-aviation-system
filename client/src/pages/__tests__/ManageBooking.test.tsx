import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import ManageBooking from "../ManageBooking";

const state = vi.hoisted(() => ({
  data: undefined as unknown,
  error: null as { data?: { code: string }; message: string } | null,
  isPending: false,
  mutate: vi.fn(),
  reset: vi.fn(),
  options: {} as { retry?: boolean; gcTime?: number; onSuccess?: () => void },
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    manageBooking: {
      lookup: {
        useMutation: (options: typeof state.options) => {
          state.options = options;
          return state;
        },
      },
    },
  },
}));
vi.mock("@/components/SEO", () => ({ SEO: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

beforeEach(() => {
  state.data = undefined;
  state.error = null;
  state.isPending = false;
  state.mutate.mockClear();
  state.reset.mockClear();
  window.history.replaceState({}, "", "/manage-booking");
});

it("submits the two lookup fields in a mutation without URL credentials, auto retry or retained mutation cache", () => {
  render(<ManageBooking />);
  fireEvent.change(screen.getByLabelText("manageBooking.reference"), {
    target: { value: "BOOK01" },
  });
  fireEvent.change(screen.getByLabelText("manageBooking.surname"), {
    target: { value: "Synthetic Surname" },
  });
  fireEvent.click(screen.getByRole("button", { name: "manageBooking.find" }));
  expect(state.mutate).toHaveBeenCalledWith({
    bookingReference: "BOOK01",
    surname: "Synthetic Surname",
  });
  expect(window.location.pathname).toBe("/manage-booking");
  expect(window.location.search).toBe("");
  expect(state.options).toMatchObject({ retry: false, gcTime: 0 });
  act(() => state.options.onSuccess?.());
  expect(screen.getByLabelText("manageBooking.surname")).toHaveValue("");
});

it("shows generic failure instead of server/validation detail", () => {
  state.error = {
    data: { code: "NOT_FOUND" },
    message: "Sensitive server detail",
  };
  render(<ManageBooking />);
  expect(screen.getByRole("alert")).toHaveTextContent("manageBooking.failure");
  expect(screen.queryByText("Sensitive server detail")).not.toBeInTheDocument();
});

it("shows rate-limit guidance and disables duplicate pending submissions", () => {
  state.error = {
    data: { code: "TOO_MANY_REQUESTS" },
    message: "Too many attempts",
  };
  state.isPending = true;
  render(<ManageBooking />);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "manageBooking.tooManyAttempts"
  );
  expect(
    screen.getByRole("button", { name: "manageBooking.searching" })
  ).toBeDisabled();
});

it("renders the limited itinerary with a protected account handoff and explicit clear action", () => {
  state.data = {
    bookingReference: "BOOK01",
    status: "confirmed",
    itinerary: [
      {
        flightNumber: "QA101",
        departureTime: "2030-01-01T09:00:00Z",
        arrivalTime: "2030-01-01T11:00:00Z",
        origin: { code: "JED", city: "Jeddah", timezone: "Asia/Riyadh" },
        destination: { code: "RUH", city: "Riyadh", timezone: null },
        flightStatus: "scheduled",
        segmentStatus: "confirmed",
      },
    ],
  };
  render(<ManageBooking />);
  expect(screen.getByText("QA101")).toBeVisible();
  expect(screen.getByText("UTC")).toBeVisible();
  expect(
    screen.getByRole("link", { name: "manageBooking.accountAction" })
  ).toHaveAttribute("href", "/my-bookings");
  fireEvent.click(screen.getByRole("button", { name: "manageBooking.clear" }));
  expect(state.reset).toHaveBeenCalledOnce();
});
