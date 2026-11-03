import type { ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import DcsDesk from "../DcsDesk";

const api = vi.hoisted(() => ({
  role: "ops",
  flights: vi.fn(),
  desk: vi.fn(),
  flightMutation: vi.fn(),
  checkIn: vi.fn(),
  transition: vi.fn(),
  summary: vi.fn(),
  closeout: vi.fn(),
  register: vi.fn(),
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: 17, tenantId: 4, role: api.role },
    loading: false,
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" }, t: (key: string) => key }),
}));
vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("wouter", () => ({
  Redirect: ({ to }: { to: string }) => <p>Redirect to {to}</p>,
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    operations: { airlineFlights: { useQuery: api.flights } },
    dcsOperations: {
      getDesk: { useQuery: api.desk },
      changeFlightState: {
        useMutation: () => ({ mutate: api.flightMutation, isPending: false }),
      },
      checkIn: {
        useMutation: () => ({ mutate: api.checkIn, isPending: false }),
      },
      transition: {
        useMutation: () => ({ mutate: api.transition, isPending: false }),
      },
    },
    baggage: {
      flightCloseout: { useQuery: api.closeout },
      registrationSummary: { useQuery: api.summary },
      register: {
        useMutation: () => ({ mutate: api.register, isPending: false }),
      },
    },
  },
}));

const departureTime = new Date("2030-01-01T10:00:00Z");
function deskData() {
  return {
    flight: {
      id: 41,
      flightNumber: "ZZ0041",
      tenantId: 4,
      airlineId: 2,
      originId: 1,
      destinationId: 2,
      departureTime,
      status: "scheduled",
    },
    checkInState: "open",
    stateConfigured: true,
    checkInWindowOpen: true,
    passengers: [
      {
        bookingId: 82,
        passengerId: 92,
        segmentId: 102,
        name: "Synthetic Passenger",
        pnr: "XYZ123",
        bookingReference: "REF-82",
        cabinClass: "economy",
        seatNumber: "12A",
        departureState: "checked_in",
        attendanceState: "checked_in",
        boardingDenied: false,
        checkedIn: true,
      },
    ],
    history: [],
    historyHasMore: false,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  api.role = "ops";
  api.flights.mockReturnValue({
    data: [{ id: 41, flightNumber: "ZZ0041", departureTime }],
    isLoading: false,
    refetch: vi.fn(),
  });
  api.desk.mockReturnValue({
    data: deskData(),
    isLoading: false,
    refetch: vi.fn(),
  });
  api.summary.mockReturnValue({
    data: {
      allowanceWeightGrams: 23000,
      registeredWeightGrams: 0,
      remainingWeightGrams: 23000,
      requiresOperationalReview: false,
      bags: [],
    },
    isLoading: false,
    refetch: vi.fn(),
  });
  api.closeout.mockReturnValue({ refetch: vi.fn() });
});
function selectPassenger() {
  fireEvent.change(screen.getByLabelText("Flight"), {
    target: { value: "41" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Select Synthetic Passenger" })
  );
}

it.each(["Flight", "Passenger action"])(
  "keeps the %s label independent of its selectable options",
  name => {
    render(<DcsDesk />);
    if (name === "Passenger action") selectPassenger();
    const control = screen.getByRole<HTMLSelectElement>("combobox", {
      name,
    });
    // Browser label locators read the native label's full text. Option text
    // inside that label must not change the control's exact visible label.
    expect(
      Array.from(control.labels ?? [], label => label.textContent?.trim())
    ).toEqual([name]);
    expect(control).toHaveAccessibleName(name);
  }
);

it.each(["finance", "user"])("does not query operational data for %s", role => {
  api.role = role;
  render(<DcsDesk />);
  expect(screen.getByText("Redirect to /")).toBeInTheDocument();
  expect(api.flights).not.toHaveBeenCalled();
  expect(api.desk).not.toHaveBeenCalled();
});

it("binds manual boarding and optional scan to the selected passenger and keeps the retry key stable", () => {
  render(<DcsDesk />);
  expect(api.desk).not.toHaveBeenCalled();
  selectPassenger();
  expect(api.desk).toHaveBeenLastCalledWith({ flightId: 41 }, { retry: false });
  expect(api.summary).toHaveBeenLastCalledWith(
    { flightId: 41, bookingId: 82, passengerId: 92, segmentId: 102 },
    { retry: false }
  );
  const submit = screen.getByRole("button", { name: "Board passenger" });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Passenger action reason"), {
    target: { value: "Boarding at gate" },
  });
  fireEvent.change(screen.getByLabelText("Boarding pass token (optional)"), {
    target: { value: "current-pass-token" },
  });
  fireEvent.click(submit);
  const command = api.transition.mock.calls[0][0];
  expect(command).toEqual({
    flightId: 41,
    bookingId: 82,
    passengerId: 92,
    action: "board",
    reason: "Boarding at gate",
    boardingPassToken: "current-pass-token",
    idempotencyKey: expect.any(String),
  });
  // No acknowledgement arrived: the same operator retry recovers its result.
  fireEvent.click(submit);
  expect(api.transition.mock.calls[1][0].idempotencyKey).toBe(
    command.idempotencyKey
  );
  fireEvent.change(screen.getByLabelText("Passenger action reason"), {
    target: { value: "Different reviewed instruction" },
  });
  fireEvent.click(submit);
  expect(api.transition.mock.calls[2][0].idempotencyKey).not.toBe(
    command.idempotencyKey
  );
  expect(api.checkIn).not.toHaveBeenCalled();
});

it("offers deplane before any offload for a boarded passenger", () => {
  const data = deskData();
  Object.assign(data.passengers[0], {
    departureState: "boarded",
    attendanceState: "boarded",
  });
  api.desk.mockReturnValue({ data, refetch: vi.fn() });
  render(<DcsDesk />);
  selectPassenger();
  const actions = within(screen.getByLabelText("Passenger action"));
  expect(
    actions.getByRole("option", { name: "Deplane passenger" })
  ).toBeInTheDocument();
  expect(
    actions.queryByRole("option", { name: "Offload passenger" })
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Bag weight in kilograms"), {
    target: { value: "10" },
  });
  expect(
    screen.getByRole("button", { name: "Register received bag" })
  ).toBeDisabled();
});

it("retains the denial control after offload and cannot check the passenger in through it", () => {
  const data = deskData();
  Object.assign(data.passengers[0], {
    departureState: "boarding_denied",
    attendanceState: "offloaded",
    boardingDenied: true,
    checkedIn: false,
  });
  api.desk.mockReturnValue({ data, refetch: vi.fn() });
  render(<DcsDesk />);
  selectPassenger();
  const actions = within(screen.getByLabelText("Passenger action"));
  expect(
    actions.getByRole("option", { name: "Allow boarding" })
  ).toBeInTheDocument();
  expect(actions.getAllByRole("option")).toHaveLength(1);
  fireEvent.change(screen.getByLabelText("Passenger action reason"), {
    target: { value: "Supervisor cleared denial" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Allow boarding" }));
  expect(api.transition).toHaveBeenCalledWith(
    expect.objectContaining({ action: "allow", passengerId: 92 })
  );
  expect(api.checkIn).not.toHaveBeenCalled();
});

it("blocks check-in outside the time window even when the flight is marked open", () => {
  const data = deskData();
  data.checkInWindowOpen = false;
  Object.assign(data.passengers[0], {
    departureState: "not_checked_in",
    attendanceState: "not_checked_in",
    checkedIn: false,
  });
  api.desk.mockReturnValue({ data, refetch: vi.fn() });
  render(<DcsDesk />);
  selectPassenger();
  fireEvent.change(screen.getByLabelText("Passenger action reason"), {
    target: { value: "Desk check-in" },
  });
  expect(
    screen.getByRole("button", { name: "Check in passenger" })
  ).toBeDisabled();
  expect(screen.getByText("Outside check-in window")).toBeInTheDocument();
});

it("resets a denied passenger's offload action to allow after attendance changes", () => {
  const data = deskData();
  Object.assign(data.passengers[0], {
    departureState: "boarding_denied",
    boardingDenied: true,
  });
  api.desk.mockReturnValue({ data, refetch: vi.fn() });
  const view = render(<DcsDesk />);
  selectPassenger();
  fireEvent.change(screen.getByLabelText("Passenger action"), {
    target: { value: "offload" },
  });
  fireEvent.change(screen.getByLabelText("Passenger action reason"), {
    target: { value: "Counter offload while denial remains" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Offload passenger" }));
  Object.assign(data.passengers[0], {
    attendanceState: "offloaded",
    checkedIn: false,
  });
  view.rerender(<DcsDesk />);
  expect(screen.getByLabelText("Passenger action")).toHaveValue("allow");
  fireEvent.change(screen.getByLabelText("Passenger action reason"), {
    target: { value: "Supervisor removed the denial" },
  });
  const allow = screen.getByRole("button", { name: "Allow boarding" });
  expect(allow).toBeEnabled();
  fireEvent.click(allow);
  expect(api.transition).toHaveBeenLastCalledWith(
    expect.objectContaining({ action: "allow" })
  );
});

it("records a flight close command with a reason and does not submit while a desk read has failed", () => {
  const view = render(<DcsDesk />);
  selectPassenger();
  const close = screen.getByRole("button", { name: "Close check-in" });
  expect(close).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Check-in state reason"), {
    target: { value: "Counter closed by supervisor" },
  });
  fireEvent.click(close);
  expect(api.flightMutation).toHaveBeenCalledWith({
    flightId: 41,
    action: "close",
    reason: "Counter closed by supervisor",
    idempotencyKey: expect.any(String),
  });
  api.desk.mockReturnValue({
    data: deskData(),
    error: { message: "Operational source unavailable" },
    refetch: vi.fn(),
  });
  view.rerender(<DcsDesk />);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Operational source unavailable"
  );
  expect(
    screen.queryByRole("button", { name: "Board passenger" })
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Close check-in" })
  ).not.toBeInTheDocument();
});

it("refuses baggage input for a legacy booking without an exact segment", () => {
  const data = deskData();
  const passenger = { ...data.passengers[0], segmentId: null };
  api.desk.mockReturnValue({
    data: { ...data, passengers: [passenger] },
    refetch: vi.fn(),
  });
  render(<DcsDesk />);
  selectPassenger();
  expect(
    screen.getByText(/Baggage acceptance requires an exact booking segment/)
  ).toBeInTheDocument();
  expect(api.summary).not.toHaveBeenCalled();
  expect(
    screen.queryByLabelText("Bag weight in kilograms")
  ).not.toBeInTheDocument();
});

it("clears the selected passenger and pending form when the flight page changes", () => {
  const rows = Array.from({ length: 51 }, (_, i) => ({
    id: i + 1,
    flightNumber: `ZZ${i + 1}`,
    departureTime,
  }));
  api.flights.mockImplementation(({ after }) => ({
    data: after ? rows.slice(50) : rows,
  }));
  render(<DcsDesk />);
  selectPassenger();
  fireEvent.change(screen.getByLabelText("Passenger action reason"), {
    target: { value: "Old flight instruction" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Next flights" }));
  expect(api.flights).toHaveBeenLastCalledWith({
    after: { id: 50, departureTime },
    limit: 51,
  });
  expect(screen.getByLabelText("Flight")).toHaveValue("");
  expect(
    screen.queryByLabelText("Passenger action reason")
  ).not.toBeInTheDocument();
  expect(
    screen.queryByLabelText("Bag weight in kilograms")
  ).not.toBeInTheDocument();
});
