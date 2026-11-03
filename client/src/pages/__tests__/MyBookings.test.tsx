import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import MyBookings from "../MyBookings";

const state = vi.hoisted(() => ({
  failed: false,
  data: [] as Array<Record<string, unknown>> | undefined,
  targets: vi.fn(),
  fileClaim: vi.fn(),
  services: vi.fn(),
  disruptions: vi.fn(),
  retry: vi.fn(),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    bookings: {
      getDepartureState: { useQuery: () => ({ data: [] }) },
      myBookings: {
        useQuery: () => ({
          data: state.data,
          isLoading: false,
          error: state.failed ? new Error("Synthetic source failure") : null,
          refetch: state.retry,
        }),
      },
    },
    compensation: {
      claimTargets: { useQuery: state.targets },
      getMyClaims: { useQuery: () => ({ data: [] }) },
      checkEligibility: { useQuery: () => ({ data: {} }) },
      fileClaim: { useMutation: () => ({ mutate: state.fileClaim }) },
    },
    specialServices: {
      getBookingServices: { useQuery: state.services },
      getAvailableServices: { useQuery: () => ({ data: {} }) },
      requestService: { useMutation: () => ({}) },
      cancelService: { useMutation: () => ({}) },
    },
    disruptions: { myDisruptions: { useQuery: state.disruptions } },
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

it("opens assistance for the chosen booking and keeps disruption outages distinct from empty results", () => {
  const base = {
    flight: {
      flightNumber: "QA71",
      departureTime: new Date("2030-01-01T08:00:00Z"),
      arrivalTime: new Date("2030-01-01T10:00:00Z"),
      origin: "ADE",
      destination: "JED",
      originTimezone: "Asia/Aden",
    },
    passengers: [
      { id: 12, firstName: "Test", lastName: "Passenger", type: "adult" },
    ],
    createdAt: new Date(),
    numberOfPassengers: 1,
    totalAmount: 12000,
    paymentStatus: "refunded",
  };
  state.data = [
    { ...base, id: 71, bookingReference: "BOOK71", status: "confirmed" },
    { ...base, id: 72, bookingReference: "BOOK72", status: "cancelled" },
  ];
  state.targets.mockReturnValue({
    data: {
      flights: [{ id: 81, flightNumber: "QA81" }],
      passengers: base.passengers,
    },
  });
  state.services.mockReturnValue({ data: [] });
  state.disruptions.mockReturnValue({
    error: new Error("Disruption feed unavailable"),
    refetch: state.retry,
  });

  render(<MyBookings />);
  expect(state.targets).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getAllByRole("button", { name: "Compensation claims" })[1]
  );
  expect(state.targets).toHaveBeenCalledWith({ bookingId: 72 });
  fireEvent.change(screen.getByLabelText(/Requested policy basis/), {
    target: { value: "local" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
  expect(state.fileClaim).toHaveBeenCalledWith(
    expect.objectContaining({ bookingId: 72, flightId: 81, passengerId: 12 })
  );

  fireEvent.click(
    screen.getByRole("button", { name: "specialServices.title" })
  );
  expect(state.services).toHaveBeenCalledWith({ bookingId: 71 });
  fireEvent.click(screen.getByRole("button", { name: "disruptions.title" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Disruption feed unavailable"
  );
  expect(
    screen.queryByText("disruptions.noDisruptions")
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(state.retry).toHaveBeenCalledOnce();
});

it("shows the recorded booking date without assigning it to a later cancellation", () => {
  const createdAt = new Date("2001-06-01T00:00:00Z");
  state.data = [
    {
      id: 92,
      bookingReference: "CANCEL92",
      status: "cancelled",
      paymentStatus: "refunded",
      passengers: [],
      createdAt,
      totalAmount: 10000,
      numberOfPassengers: 1,
      flight: {
        flightNumber: "QA92",
        departureTime: new Date("2001-07-01T08:00:00Z"),
        originTimezone: "Asia/Aden",
      },
    },
  ];
  render(<MyBookings />);
  fireEvent.click(
    screen.getByRole("button", { name: "bookingTimeline.title" })
  );
  expect(screen.getByText("bookingTimeline.bookingCancelled")).toBeVisible();
  expect(screen.getAllByText(/ago$/)).toHaveLength(1);
});
