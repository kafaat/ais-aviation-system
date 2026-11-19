import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import MyBookings from "../MyBookings";

const state = vi.hoisted(() => ({
  failed: false,
  data: [] as Array<Record<string, unknown>> | undefined,
  retry: vi.fn(),
  options: undefined as undefined | { refetchInterval?: unknown },
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
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

const booking = (paymentStatus: string) => ({
  id: 5,
  bookingReference: "ABC123",
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

function returnFromProvider() {
  window.history.pushState(
    {},
    "",
    "/my-bookings?session_id=cs_test_1&success=true"
  );
}

beforeEach(() => {
  state.failed = false;
  state.data = [];
  state.retry.mockReset();
  state.options = undefined;
  returnFromProvider();
});
afterEach(() => window.history.pushState({}, "", "/"));

it("never announces payment from the return URL while the server still says pending", () => {
  state.data = [booking("pending")];
  render(<MyBookings />);
  const notice = screen.getByTestId("payment-return-notice");
  expect(notice).toHaveAttribute("data-state", "pending");
  expect(notice).not.toHaveTextContent(/paid|confirmed/i);
  expect(typeof state.options?.refetchInterval).toBe("function");
});

it("stops polling and says nothing is awaiting once no booking is pending", () => {
  state.data = [booking("paid")];
  render(<MyBookings />);
  expect(screen.getByTestId("payment-return-notice")).toHaveAttribute(
    "data-state",
    "settled"
  );
  const interval = state.options?.refetchInterval as (q: unknown) => unknown;
  expect(interval({ state: { data: [booking("paid")] } })).toBe(false);
});

it("shows no payment notice without the provider return flags", () => {
  window.history.pushState({}, "", "/my-bookings");
  state.data = [booking("pending")];
  render(<MyBookings />);
  expect(screen.queryByTestId("payment-return-notice")).not.toBeInTheDocument();
});

it("does not treat success=true without a session_id as a payment return", () => {
  window.history.pushState({}, "", "/my-bookings?success=true");
  state.data = [booking("pending")];
  render(<MyBookings />);
  expect(screen.queryByTestId("payment-return-notice")).not.toBeInTheDocument();
});

it("keeps the source-failure alert, not a payment verdict, when the read fails", () => {
  state.failed = true;
  state.data = undefined;
  render(<MyBookings />);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Synthetic source failure"
  );
  expect(screen.queryByTestId("payment-return-notice")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(state.retry).toHaveBeenCalledOnce();
});

it("gives up polling with a still-waiting notice after the bounded window", () => {
  vi.useFakeTimers();
  try {
    state.data = [booking("pending")];
    render(<MyBookings />);
    act(() => {
      vi.advanceTimersByTime(125_000);
    });
    expect(screen.getByTestId("payment-return-notice")).toHaveAttribute(
      "data-state",
      "timeout"
    );
    const interval = state.options?.refetchInterval as (q: unknown) => unknown;
    expect(interval({ state: { data: [booking("pending")] } })).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});
