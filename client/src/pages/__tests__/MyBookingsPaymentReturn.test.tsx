import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import MyBookings from "../MyBookings";

const state = vi.hoisted(() => ({
  failed: false,
  data: [] as Array<Record<string, unknown>> | undefined,
  retry: vi.fn(),
  options: undefined as undefined | { refetchInterval?: unknown },
  checkout: {
    data: undefined as Record<string, unknown> | undefined,
    error: null as Error | null,
  },
  checkoutCalls: [] as Array<{ input: unknown; options: any }>,
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    payments: {
      getCheckoutState: {
        useQuery: (input: unknown, options: any) => {
          state.checkoutCalls.push({ input, options });
          return {
            data: options?.enabled === false ? undefined : state.checkout.data,
            error: options?.enabled === false ? null : state.checkout.error,
            isLoading: false,
          };
        },
      },
    },
    bookings: {
      getDepartureState: { useQuery: () => ({ data: [] }) },
      myBookings: {
        useQuery: (
          _input: unknown,
          options?: { refetchInterval?: unknown }
        ) => {
          state.options = options;
          return {
            data: state.data,
            isLoading: false,
            error: state.failed ? new Error("Synthetic source failure") : null,
            refetch: state.retry,
          };
        },
      },
    },
    compensation: {
      claimTargets: { useQuery: () => ({ data: [] }) },
      getMyClaims: { useQuery: () => ({ data: [] }) },
      checkEligibility: { useQuery: () => ({ data: {} }) },
      fileClaim: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    specialServices: {
      getBookingServices: { useQuery: () => ({ data: [] }) },
      getAvailableServices: { useQuery: () => ({ data: {} }) },
      requestService: { useMutation: () => ({}) },
      cancelService: { useMutation: () => ({}) },
    },
    disruptions: { myDisruptions: { useQuery: () => ({ data: [] }) } },
    flights: {
      statusBatch: { useQuery: () => ({ data: [], isSuccess: true }) },
    },
  },
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1 }, isAuthenticated: true, loading: false }),
}));
vi.mock("@/components/BookingCreditPayment", () => ({
  BookingCreditPayment: () => null,
  default: () => null,
}));
vi.mock("@/components/ItineraryShare", () => ({
  ItineraryShare: () => null,
  default: () => null,
}));
vi.mock("@/components/WalletBookingPayment", () => ({
  WalletBookingPayment: () => null,
  default: () => null,
}));
vi.mock("@/components/BookingTimeline", () => ({
  BookingTimeline: () => null,
  default: () => null,
}));
vi.mock("@/components/BookingAncillariesDisplay", () => ({
  BookingAncillariesDisplay: () => null,
  default: () => null,
}));
vi.mock("@/components/CompensationClaim", () => ({
  CompensationClaim: () => null,
  default: () => null,
}));
vi.mock("@/components/DisruptionHub", () => ({
  DisruptionHub: () => null,
  default: () => null,
}));
vi.mock("@/components/SpecialServicesRequest", () => ({
  SpecialServicesRequest: () => null,
  default: () => null,
}));
vi.mock("@/components/BaggageEntitlement", () => ({
  BaggageEntitlement: () => null,
  default: () => null,
}));
vi.mock("@/components/ReviewForm", () => ({
  ReviewForm: () => null,
  default: () => null,
}));
vi.mock("@/components/ManageAncillariesDialog", () => ({
  ManageAncillariesDialog: () => null,
  default: () => null,
}));
vi.mock("@/components/ModifyBookingDialog", () => ({
  ModifyBookingDialog: () => null,
  default: () => null,
}));
vi.mock("@/components/CancelBookingDialog", () => ({
  CancelBookingDialog: () => null,
  default: () => null,
}));
vi.mock("@/components/DownloadTicketButtons", () => ({
  AddToCalendarButton: () => null,
  DownloadBoardingPassButton: () => null,
  DownloadTicketButton: () => null,
}));
vi.mock("@/components/SEO", () => ({ SEO: () => null }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

const booking = (id: number, paymentStatus: string) => ({
  id,
  bookingReference: `REF${id}`,
  status: "pending",
  paymentStatus,
  flightId: null,
  passengers: [],
  flight: {
    flightNumber: "SV1",
    origin: "RUH",
    destination: "JED",
    departureTime: "2099-01-15T12:00:00.000Z",
    arrivalTime: "2099-01-15T14:00:00.000Z",
  },
});
const checkout = (bookingId: number, st: string) => ({
  bookingId,
  bookingReference: `REF${bookingId}`,
  bookingStatus: "pending",
  state: st,
});

function returnFromProvider(
  query = "session_id=cs_test_1&success=true&booking_id=5"
) {
  window.history.pushState({}, "", `/my-bookings?${query}`);
}
const notice = () => screen.queryByTestId("payment-return-notice");
const lastCall = () => state.checkoutCalls[state.checkoutCalls.length - 1];

beforeEach(() => {
  state.failed = false;
  state.data = [];
  state.retry.mockReset();
  state.options = undefined;
  state.checkout = { data: undefined, error: null };
  state.checkoutCalls = [];
  returnFromProvider();
});
afterEach(() => window.history.pushState({}, "", "/"));

it("asks the server about exactly the returned booking, never another pending one", () => {
  // Booking 6 is pending too; only booking 5 is the one that was paid for.
  state.data = [booking(5, "paid"), booking(6, "pending")];
  state.checkout.data = checkout(5, "paid");
  render(<MyBookings />);
  expect(lastCall().input).toEqual({ bookingId: 5 });
  expect(notice()).toHaveAttribute("data-state", "paid");
  expect(notice()).toHaveTextContent("REF5");
});

it("keeps waiting for the returned booking even when other bookings are settled", () => {
  state.data = [booking(5, "pending"), booking(6, "paid")];
  state.checkout.data = checkout(5, "pending");
  render(<MyBookings />);
  expect(notice()).toHaveAttribute("data-state", "pending");
  expect(notice()).not.toHaveTextContent(/paid|confirmed|successful/i);
});

it("does not report the returned booking pending when only another booking is", () => {
  state.data = [booking(5, "paid"), booking(6, "pending")];
  state.checkout.data = checkout(5, "paid");
  render(<MyBookings />);
  expect(notice()).not.toHaveAttribute("data-state", "pending");
});

it("provider return before the webhook: pending, polls the checkout read, never announces payment", () => {
  state.checkout.data = checkout(5, "pending");
  render(<MyBookings />);
  expect(notice()).toHaveAttribute("data-state", "pending");
  const interval = lastCall().options.refetchInterval as (
    q: unknown
  ) => unknown;
  expect(interval({ state: { data: checkout(5, "pending") } })).toBe(5_000);
});

it("settled after the webhook: shows paid and stops polling", () => {
  state.checkout.data = checkout(5, "paid");
  render(<MyBookings />);
  expect(notice()).toHaveAttribute("data-state", "paid");
  const interval = lastCall().options.refetchInterval as (
    q: unknown
  ) => unknown;
  expect(interval({ state: { data: checkout(5, "paid") } })).toBe(false);
});

it("failed or action-required collection (server 'unavailable') is not called paid or pending", () => {
  state.checkout.data = checkout(5, "unavailable");
  render(<MyBookings />);
  expect(notice()).toHaveAttribute("data-state", "attention");
  expect(notice()).toHaveTextContent("not confirmed");
  expect(notice()).not.toHaveTextContent(/recorded the payment|successful/i);
  const interval = lastCall().options.refetchInterval as (
    q: unknown
  ) => unknown;
  expect(interval({ state: { data: checkout(5, "unavailable") } })).toBe(false);
});

it.each(["refunded", "cancelled"])("reports a %s booking as closed", st => {
  state.checkout.data = checkout(5, st);
  render(<MyBookings />);
  expect(notice()).toHaveAttribute("data-state", "closed");
});

it("forged or foreign booking id: the server refusal shows an unknown state with no booking details", () => {
  returnFromProvider("session_id=cs_test_1&success=true&booking_id=999");
  state.data = [booking(5, "paid")];
  state.checkout.error = new Error("NOT_FOUND");
  render(<MyBookings />);
  expect(lastCall().input).toEqual({ bookingId: 999 });
  expect(notice()).toHaveAttribute("data-state", "unknown");
  expect(notice()).not.toHaveTextContent(/paid|REF/i);
});

it.each(["abc", "0", "-3", "5.5", "5abc", "99999999999999999999", ""])(
  "tampered booking_id %j never reaches the server and yields unknown",
  bad => {
    returnFromProvider(`session_id=cs_test_1&success=true&booking_id=${bad}`);
    render(<MyBookings />);
    expect(lastCall().options.enabled).toBe(false);
    expect(notice()).toHaveAttribute("data-state", "unknown");
  }
);

it("a return without booking_id (older checkout link) is unknown, not an any-booking verdict", () => {
  returnFromProvider("session_id=cs_test_1&success=true");
  state.data = [booking(5, "pending")];
  render(<MyBookings />);
  expect(lastCall().options.enabled).toBe(false);
  expect(notice()).toHaveAttribute("data-state", "unknown");
});

it("shows no payment notice without the provider return flags", () => {
  window.history.pushState({}, "", "/my-bookings?booking_id=5");
  render(<MyBookings />);
  expect(notice()).not.toBeInTheDocument();
  expect(lastCall().options.enabled).toBe(false);
});

it("missing session_id is not a payment return", () => {
  returnFromProvider("success=true&booking_id=5");
  state.checkout.data = checkout(5, "paid");
  render(<MyBookings />);
  expect(notice()).not.toBeInTheDocument();
  expect(lastCall().options.enabled).toBe(false);
});

it("a failed checkout read shows unknown and leaves the bookings list source alert intact", () => {
  state.checkout.error = new Error("boom");
  state.data = [booking(5, "paid")];
  render(<MyBookings />);
  expect(notice()).toHaveAttribute("data-state", "unknown");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("keeps the source-failure alert, not a payment verdict, when the bookings read fails", () => {
  state.failed = true;
  state.data = undefined;
  render(<MyBookings />);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Synthetic source failure"
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(state.retry).toHaveBeenCalledOnce();
});

it("gives up polling with a still-waiting notice after the bounded window", () => {
  vi.useFakeTimers();
  try {
    state.checkout.data = checkout(5, "pending");
    render(<MyBookings />);
    act(() => {
      vi.advanceTimersByTime(125_000);
    });
    expect(notice()).toHaveAttribute("data-state", "timeout");
    const interval = lastCall().options.refetchInterval as (
      q: unknown
    ) => unknown;
    expect(interval({ state: { data: checkout(5, "pending") } })).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
