import type { ReactNode } from "react";
import {
  act,
  fireEvent,
  render as renderElement,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { getMutationKey, getQueryKey } from "@trpc/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import superjson from "superjson";
import { trpc } from "@/lib/trpc";
import DcsDesk from "../DcsDesk";

const api = vi.hoisted(() => ({
  role: "ops",
  liveTransport: false,
  flights: vi.fn(),
  desk: vi.fn(),
  flightMutation: vi.fn(),
  checkIn: vi.fn(),
  transition: vi.fn(),
  transitionPending: false,
  transitionError: null as Error | null,
  transitionOptions: null as { onSuccess: () => void } | null,
  summary: vi.fn(),
  closeout: vi.fn(),
  register: vi.fn(),
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
vi.mock("wouter", () => ({
  Redirect: ({ to }: { to: string }) => <p>Redirect to {to}</p>,
}));
vi.mock("@/lib/trpc", async importOriginal => {
  const { trpc: original } =
    await importOriginal<typeof import("@/lib/trpc")>();
  function override<T extends object>(
    target: T,
    methods: Record<string, unknown>
  ) {
    return new Proxy(target, {
      get(target, property, receiver) {
        if (!api.liveTransport && property in methods)
          return Reflect.get(methods, property);
        return Reflect.get(target, property, receiver);
      },
    });
  }
  return {
    trpc: {
      Provider: original.Provider,
      createClient: original.createClient,
      operations: {
        airlineFlights: override(original.operations.airlineFlights, {
          useQuery: api.flights,
        }),
      },
      dcsOperations: {
        getDesk: override(original.dcsOperations.getDesk, {
          useQuery: api.desk,
        }),
        changeFlightState: override(original.dcsOperations.changeFlightState, {
          useMutation: () => ({ mutate: api.flightMutation, isPending: false }),
        }),
        checkIn: override(original.dcsOperations.checkIn, {
          useMutation: () => ({ mutate: api.checkIn, isPending: false }),
        }),
        transition: override(original.dcsOperations.transition, {
          useMutation: (options: { onSuccess: () => void }) => {
            api.transitionOptions = options;
            return {
              mutate: api.transition,
              isPending: api.transitionPending,
              error: api.transitionError,
            };
          },
        }),
      },
      baggage: {
        flightCloseout: override(original.baggage.flightCloseout, {
          useQuery: api.closeout,
        }),
        registrationSummary: override(original.baggage.registrationSummary, {
          useQuery: api.summary,
        }),
        register: override(original.baggage.register, {
          useMutation: () => ({ mutate: api.register, isPending: false }),
        }),
      },
    },
  };
});

function queryCache() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function render(element: ReactNode) {
  const cache = queryCache();
  return renderElement(element, {
    wrapper: ({ children }) => (
      <QueryClientProvider client={cache}>{children}</QueryClientProvider>
    ),
  });
}

const departureTime = new Date("2030-01-01T10:00:00Z");
const deskTime = new Date("2030-01-01T08:00:00Z").getTime();
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
  vi.spyOn(Date, "now").mockReturnValue(deskTime);
  api.role = "ops";
  api.liveTransport = false;
  api.transitionPending = false;
  api.transitionError = null;
  api.transitionOptions = null;
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
afterEach(() => {
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
});
function selectPassenger() {
  fireEvent.change(screen.getByLabelText("Flight"), {
    target: { value: "41" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Select Synthetic Passenger" })
  );
}

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

it.each([
  { status: "cancelled", minutesUntilDeparture: 120 },
  { status: "cancelled", minutesUntilDeparture: -10 },
  { status: "scheduled", minutesUntilDeparture: -10 },
  { status: "delayed", minutesUntilDeparture: -10 },
])(
  "lets staff deplane then offload the selected passenger on $status at $minutesUntilDeparture minutes from departure",
  async ({ status, minutesUntilDeparture }) => {
    const user = userEvent.setup();
    const data = deskData();
    data.flight.status = status;
    data.flight.departureTime = new Date(
      deskTime + minutesUntilDeparture * 60_000
    );
    data.checkInState = "closed";
    data.checkInWindowOpen = false;
    Object.assign(data.passengers[0], {
      departureState: "boarded",
      attendanceState: "boarded",
    });
    data.passengers.push({
      ...data.passengers[0],
      bookingId: 83,
      passengerId: 93,
      segmentId: 103,
      name: "Another Passenger",
      pnr: "OTH123",
      bookingReference: "REF-83",
    });
    const refetch = vi.fn();
    let query = { data, refetch, isFetching: false };
    api.desk.mockImplementation(() => query);
    const view = render(<DcsDesk />);
    await user.selectOptions(screen.getByLabelText("Flight"), "41");
    await user.click(
      screen.getByRole("button", { name: "Select Synthetic Passenger" })
    );

    const deplane = screen.getByRole("button", { name: "Deplane passenger" });
    expect(deplane).toBeDisabled();
    expect(
      within(screen.getByLabelText("Passenger action")).queryByRole("option", {
        name: "Offload passenger",
      })
    ).not.toBeInTheDocument();
    await user.type(
      screen.getByLabelText("Passenger action reason"),
      "Passenger left the aircraft"
    );
    expect(deplane).toBeEnabled();
    await user.click(deplane);
    expect(api.transition).toHaveBeenCalledWith({
      flightId: 41,
      bookingId: 82,
      passengerId: 92,
      action: "deplane",
      reason: "Passenger left the aircraft",
      boardingPassToken: undefined,
      idempotencyKey: expect.any(String),
    });
    const deplaneKey = api.transition.mock.calls[0][0].idempotencyKey;

    api.transitionPending = true;
    view.rerender(<DcsDesk />);
    expect(deplane).toBeDisabled();
    expect(screen.getByLabelText("Passenger action")).toBeDisabled();
    await user.click(deplane);
    expect(api.transition).toHaveBeenCalledTimes(1);

    api.transitionPending = false;
    await act(async () => api.transitionOptions?.onSuccess());
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Passenger action reason")).toHaveValue("");
    query = { ...query, isFetching: true };
    view.rerender(<DcsDesk />);
    expect(screen.getByLabelText("Passenger action")).toBeDisabled();
    expect(deplane).toBeDisabled();

    Object.assign(data.passengers[0], {
      departureState: "checked_in",
      attendanceState: "checked_in",
    });
    query = { data, refetch, isFetching: false };
    view.rerender(<DcsDesk />);
    expect(screen.getByLabelText("Passenger action")).toHaveValue("offload");
    const offload = screen.getByRole("button", { name: "Offload passenger" });
    expect(offload).toBeDisabled();
    const options = within(screen.getByLabelText("Passenger action"));
    expect(
      options.getByRole("option", { name: "Board passenger" })
    ).toBeDisabled();
    expect(
      options.getByRole("option", { name: "Deny boarding" })
    ).toBeDisabled();
    await user.type(
      screen.getByLabelText("Passenger action reason"),
      "Passenger and baggage recovery verified"
    );
    expect(offload).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Register received bag" })
    ).toBeDisabled();
    await user.click(offload);
    const offloadCommand = api.transition.mock.calls[1][0];
    expect(offloadCommand).toEqual({
      flightId: 41,
      bookingId: 82,
      passengerId: 92,
      action: "offload",
      reason: "Passenger and baggage recovery verified",
      boardingPassToken: undefined,
      idempotencyKey: expect.any(String),
    });
    expect(offloadCommand.idempotencyKey).not.toBe(deplaneKey);

    api.transitionError = new Error("Response unavailable; retry command");
    view.rerender(<DcsDesk />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Response unavailable; retry command"
    );
    await user.click(offload);
    expect(api.transition.mock.calls[2][0]).toEqual(offloadCommand);
    expect(api.checkIn).not.toHaveBeenCalled();
    expect(api.register).not.toHaveBeenCalled();

    api.transitionError = null;
    Object.assign(data.passengers[0], {
      departureState: "offloaded",
      attendanceState: "offloaded",
      checkedIn: false,
      seatNumber: null,
    });
    view.rerender(<DcsDesk />);
    const remainingActions = within(screen.getByLabelText("Passenger action"));
    expect(
      remainingActions.queryByRole("option", { name: "Offload passenger" })
    ).not.toBeInTheDocument();
    expect(
      remainingActions.getByRole("option", { name: "Check in passenger" })
    ).toBeDisabled();
    expect(
      remainingActions.getByRole("option", { name: "Deny boarding" })
    ).toBeDisabled();
  }
);

it.each([
  { action: "check_in", state: "not_checked_in", denied: false },
  { action: "board", state: "checked_in", denied: false },
  { action: "deny", state: "not_checked_in", denied: false },
  { action: "allow", state: "checked_in", denied: true },
])(
  "does not let staff choose $action on a cancelled flight",
  async ({ action, state, denied }) => {
    const user = userEvent.setup();
    const data = deskData();
    data.flight.status = "cancelled";
    Object.assign(data.passengers[0], {
      departureState: denied ? "boarding_denied" : state,
      attendanceState: state,
      boardingDenied: denied,
      checkedIn: state === "checked_in",
    });
    api.desk.mockReturnValue({ data, refetch: vi.fn() });
    render(<DcsDesk />);
    selectPassenger();
    const select = screen.getByLabelText("Passenger action");
    const option = within(select)
      .getAllByRole("option")
      .find(element => (element as HTMLOptionElement).value === action);
    expect(option).toBeDisabled();
    await user.selectOptions(select, action);
    expect(api.transition).not.toHaveBeenCalled();
    expect(api.checkIn).not.toHaveBeenCalled();
  }
);

it.each([
  { state: "not_checked_in", denied: false },
  { state: "checked_in", denied: false },
  { state: "boarded", denied: false },
  { state: "checked_in", denied: true },
])(
  "blocks every passenger action on a completed flight for $state, denial=$denied",
  async ({ state, denied }) => {
    const user = userEvent.setup();
    const data = deskData();
    data.flight.status = "completed";
    Object.assign(data.passengers[0], {
      departureState: denied ? "boarding_denied" : state,
      attendanceState: state,
      boardingDenied: denied,
      checkedIn: state !== "not_checked_in",
    });
    api.desk.mockReturnValue({ data, refetch: vi.fn() });
    render(<DcsDesk />);
    selectPassenger();
    const select = screen.getByLabelText("Passenger action");
    expect(select).toBeDisabled();
    for (const option of within(select).getAllByRole("option"))
      expect(option).toBeDisabled();
    const reason = screen.getByLabelText("Passenger action reason");
    await user.type(reason, "A reason cannot reopen completed operations");
    const form = reason.closest("form")!;
    const submit = within(form).getByRole("button");
    expect(submit).toBeDisabled();
    await user.click(submit);
    fireEvent.submit(form);
    expect(api.transition).not.toHaveBeenCalled();
    expect(api.checkIn).not.toHaveBeenCalled();
  }
);

it("requires deplane before offload even if a cancelled passenger also has a boarding denial", async () => {
  const user = userEvent.setup();
  const data = deskData();
  data.flight.status = "cancelled";
  Object.assign(data.passengers[0], {
    departureState: "boarding_denied",
    attendanceState: "boarded",
    boardingDenied: true,
  });
  api.desk.mockReturnValue({ data, refetch: vi.fn() });
  render(<DcsDesk />);
  selectPassenger();
  expect(screen.getByLabelText("Passenger action")).toHaveValue("deplane");
  expect(
    within(screen.getByLabelText("Passenger action")).queryByRole("option", {
      name: "Offload passenger",
    })
  ).not.toBeInTheDocument();
  await user.type(
    screen.getByLabelText("Passenger action reason"),
    "Physical deplane confirmed"
  );
  await user.click(screen.getByRole("button", { name: "Deplane passenger" }));
  expect(api.transition).toHaveBeenCalledWith(
    expect.objectContaining({ action: "deplane", passengerId: 92 })
  );
});

it("does not reinterpret a prepared boarding instruction as offload when the flight is cancelled", async () => {
  const user = userEvent.setup();
  const data = deskData();
  api.desk.mockReturnValue({ data, refetch: vi.fn() });
  const view = render(<DcsDesk />);
  selectPassenger();
  await user.type(
    screen.getByLabelText("Passenger action reason"),
    "Boarding at gate"
  );
  data.flight.status = "cancelled";
  view.rerender(<DcsDesk />);
  expect(screen.getByLabelText("Passenger action")).toHaveValue("board");
  const board = screen.getByRole("button", { name: "Board passenger" });
  expect(board).toBeDisabled();
  await user.click(board);
  expect(api.transition).not.toHaveBeenCalled();
  await user.selectOptions(
    screen.getByLabelText("Passenger action"),
    "offload"
  );
  expect(
    screen.getByRole("button", { name: "Offload passenger" })
  ).toBeEnabled();
  data.flight.status = "completed";
  view.rerender(<DcsDesk />);
  const offload = screen.getByRole("button", { name: "Offload passenger" });
  expect(offload).toBeDisabled();
  await user.click(offload);
  expect(api.transition).not.toHaveBeenCalled();
});

it("blocks recovery during a desk refresh and hides it after a failed read even with cached data", async () => {
  const user = userEvent.setup();
  const data = deskData();
  data.flight.status = "cancelled";
  const refetch = vi.fn();
  api.desk.mockReturnValue({ data, refetch });
  const view = render(<DcsDesk />);
  selectPassenger();
  await user.type(
    screen.getByLabelText("Passenger action reason"),
    "Recovery after cancellation"
  );
  const offload = screen.getByRole("button", { name: "Offload passenger" });
  expect(offload).toBeEnabled();
  api.desk.mockReturnValue({ data, refetch, isFetching: true });
  view.rerender(<DcsDesk />);
  expect(offload).toBeDisabled();
  await user.click(offload);
  expect(api.transition).not.toHaveBeenCalled();
  api.desk.mockReturnValue({
    data,
    refetch,
    error: new Error("Desk refresh failed"),
  });
  view.rerender(<DcsDesk />);
  expect(screen.getByRole("alert")).toHaveTextContent("Desk refresh failed");
  expect(screen.queryByLabelText("Passenger action")).not.toBeInTheDocument();
});

it.each([
  { action: "board", remainingMs: 0, allowed: false },
  { action: "deny", remainingMs: 0, allowed: false },
  { action: "allow", remainingMs: 0, allowed: false },
  { action: "board", remainingMs: 48 * 3_600_000 + 1, allowed: false },
  { action: "deny", remainingMs: 48 * 3_600_000 + 1, allowed: false },
  { action: "allow", remainingMs: 48 * 3_600_000 + 1, allowed: false },
  { action: "board", remainingMs: 48 * 3_600_000, allowed: true },
  { action: "deny", remainingMs: 48 * 3_600_000, allowed: true },
  { action: "allow", remainingMs: 48 * 3_600_000, allowed: true },
  { action: "board", remainingMs: 3_600_000, allowed: true },
  { action: "check_in", remainingMs: 3_600_000, allowed: false },
  { action: "check_in", remainingMs: 3_600_000 + 1, allowed: true },
])(
  "applies the operational clock for $action with $remainingMs ms remaining (available=$allowed)",
  async ({ action, remainingMs, allowed }) => {
    const user = userEvent.setup();
    const data = deskData();
    data.flight.departureTime = new Date(deskTime + remainingMs);
    if (action === "check_in" || action === "deny")
      Object.assign(data.passengers[0], {
        departureState: "not_checked_in",
        attendanceState: "not_checked_in",
        checkedIn: false,
      });
    if (action === "allow")
      Object.assign(data.passengers[0], {
        departureState: "boarding_denied",
        boardingDenied: true,
      });
    api.desk.mockReturnValue({ data, refetch: vi.fn() });
    render(<DcsDesk />);
    selectPassenger();
    const select = screen.getByLabelText("Passenger action");
    const option = within(select)
      .getAllByRole("option")
      .find(element => (element as HTMLOptionElement).value === action);
    if (!allowed) {
      expect(option).toBeDisabled();
      await user.selectOptions(select, action);
      expect(api.transition).not.toHaveBeenCalled();
      expect(api.checkIn).not.toHaveBeenCalled();
      return;
    }
    expect(option).toBeEnabled();
    await user.selectOptions(select, action);
    await user.type(
      screen.getByLabelText("Passenger action reason"),
      "Operator verified the action"
    );
    await user.click(
      within(
        screen.getByLabelText("Passenger action reason").closest("form")!
      ).getByRole("button")
    );
    if (action === "check_in")
      expect(api.checkIn).toHaveBeenCalledWith(
        expect.objectContaining({
          flightId: 41,
          bookingId: 82,
          passengerId: 92,
        })
      );
    else
      expect(api.transition).toHaveBeenCalledWith(
        expect.objectContaining({
          flightId: 41,
          bookingId: 82,
          passengerId: 92,
          action,
        })
      );
  }
);

it("rechecks the departure clock when submitting a form left open at the gate", async () => {
  const user = userEvent.setup();
  render(<DcsDesk />);
  selectPassenger();
  await user.type(
    screen.getByLabelText("Passenger action reason"),
    "Boarding at gate"
  );
  const board = screen.getByRole("button", { name: "Board passenger" });
  expect(board).toBeEnabled();
  vi.mocked(Date.now).mockReturnValue(departureTime.getTime());
  await user.click(board);
  expect(api.transition).not.toHaveBeenCalled();
});

type WireInput = Record<string, unknown>;
type WireReply = (input: WireInput) => unknown | Promise<unknown>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function visitNetworkDesk(replies: Record<string, WireReply>) {
  api.liveTransport = true;
  const calls: Array<{ method: string; input: WireInput }> = [];
  const client = trpc.createClient({
    links: [
      httpBatchLink({
        url: "https://local.test/api/trpc",
        transformer: superjson,
        fetch: async (url, init) => {
          const parsed = new URL(String(url));
          const methods = parsed.pathname.split("/").pop()!.split(",");
          const inputs = JSON.parse(
            typeof init?.body === "string"
              ? init.body
              : (parsed.searchParams.get("input") ?? "{}")
          );
          const results = await Promise.all(
            methods.map(async (method, index) => {
              const input = inputs[index]
                ? superjson.deserialize<WireInput>(inputs[index])
                : {};
              calls.push({ method, input });
              try {
                if (!replies[method])
                  throw new Error(`Unexpected endpoint: ${method}`);
                return {
                  result: {
                    data: superjson.serialize(await replies[method](input)),
                  },
                };
              } catch (error) {
                return {
                  error: superjson.serialize({
                    message:
                      error instanceof Error
                        ? error.message
                        : "Synthetic source unavailable",
                    code: -32603,
                    data: {
                      code: "INTERNAL_SERVER_ERROR",
                      httpStatus: 500,
                      path: method,
                    },
                  }),
                };
              }
            })
          );
          return new Response(JSON.stringify(results), {
            headers: { "content-type": "application/json" },
          });
        },
      }),
    ],
  });
  const cache = queryCache();
  const view = renderElement(<DcsDesk />, {
    wrapper: ({ children }) => (
      <trpc.Provider client={client} queryClient={cache}>
        <QueryClientProvider client={cache}>{children}</QueryClientProvider>
      </trpc.Provider>
    ),
  });
  return { ...view, calls, cache };
}

type DeskCommand = "passenger" | "checkIn" | "bag" | "flight";
const commandMethods: Record<DeskCommand, string> = {
  passenger: "dcsOperations.transition",
  checkIn: "dcsOperations.checkIn",
  bag: "baggage.register",
  flight: "dcsOperations.changeFlightState",
};

function navigationReplies(kind: DeskCommand) {
  const data = deskData();
  data.flight.id = 51;
  data.flight.flightNumber = "ZZ0051";
  if (kind === "checkIn")
    Object.assign(data.passengers[0], {
      departureState: "not_checked_in",
      attendanceState: "not_checked_in",
      checkedIn: false,
    });
  data.passengers.push({
    ...data.passengers[0],
    passengerId: 93,
    name: "Another Passenger",
  });
  const rows = Array.from({ length: 151 }, (_, index) => ({
    id: index + 1,
    flightNumber: `ZZ${String(index + 1).padStart(4, "0")}`,
    departureTime,
  }));
  const summary = {
    allowanceWeightGrams: 23000,
    registeredWeightGrams: 0,
    remainingWeightGrams: 23000,
    requiresOperationalReview: false,
    bags: [],
  };
  const replies: Record<string, WireReply> = {
    "operations.airlineFlights": input => {
      const after = input.after as { id: number } | undefined;
      return rows
        .filter(row => row.id > (after?.id ?? 0))
        .slice(0, Number(input.limit));
    },
    "dcsOperations.getDesk": input => ({
      ...data,
      flight: { ...data.flight, id: Number(input.flightId) },
    }),
    "baggage.registrationSummary": () => summary,
    "baggage.flightCloseout": input => ({
      flightId: input.flightId,
      readyToClose: true,
      loadedBags: 0,
      expectedBags: 0,
      unexpectedBags: 0,
      unresolvedRegistrations: [],
      missingEntry: [],
      missingLoading: [],
      duplicates: [],
    }),
  };
  return { data, replies };
}

async function selectMiddlePagePassenger(
  user: ReturnType<typeof userEvent.setup>
) {
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Next flights" })).toBeEnabled()
  );
  await user.click(screen.getByRole("button", { name: "Next flights" }));
  await screen.findByRole("option", { name: /ZZ0051/ });
  await user.selectOptions(screen.getByLabelText("Flight"), "51");
  await user.click(
    await screen.findByRole("button", { name: "Select Synthetic Passenger" })
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Previous flights" })
    ).toBeEnabled()
  );
  expect(screen.getByRole("button", { name: "Next flights" })).toBeEnabled();
  await screen.findByLabelText("Bag weight in kilograms");
}

async function submitDeskCommand(
  kind: DeskCommand,
  user: ReturnType<typeof userEvent.setup>
) {
  if (kind === "bag") {
    await user.type(screen.getByLabelText("Bag weight in kilograms"), "8");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Register received bag" })
      ).toBeEnabled()
    );
    await user.click(
      screen.getByRole("button", { name: "Register received bag" })
    );
  } else if (kind === "flight") {
    await user.type(
      screen.getByLabelText("Check-in state reason"),
      "Counter closed by supervisor"
    );
    await user.click(screen.getByRole("button", { name: "Close check-in" }));
  } else {
    await user.type(
      screen.getByLabelText("Passenger action reason"),
      "Verified selected passenger"
    );
    await user.click(
      screen.getByRole("button", {
        name: kind === "checkIn" ? "Check in passenger" : "Board passenger",
      })
    );
  }
}

async function attemptNavigation(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText("Flight"), "52");
  await user.click(screen.getByRole("button", { name: "Next flights" }));
  await user.click(screen.getByRole("button", { name: "Previous flights" }));
  const otherPassenger = screen.queryByRole("button", {
    name: "Select Another Passenger",
  });
  if (otherPassenger) await user.click(otherPassenger);
}

it.each<DeskCommand>(["passenger", "checkIn", "bag", "flight"])(
  "retains the selected flight, page and passenger through a pending %s command and its refresh",
  async kind => {
    const user = userEvent.setup();
    const fixture = navigationReplies(kind);
    const command = deferred<unknown>();
    const refresh = deferred<void>();
    const method = commandMethods[kind];
    const refreshMethod =
      kind === "bag" ? "baggage.registrationSummary" : "dcsOperations.getDesk";
    const originalRead = fixture.replies[refreshMethod];
    let committed = false;
    fixture.replies[method] = async () => {
      const result = await command.promise;
      committed = true;
      if (kind === "passenger")
        Object.assign(fixture.data.passengers[0], {
          departureState: "boarded",
          attendanceState: "boarded",
        });
      if (kind === "checkIn")
        Object.assign(fixture.data.passengers[0], {
          departureState: "checked_in",
          attendanceState: "checked_in",
          checkedIn: true,
        });
      if (kind === "flight") fixture.data.checkInState = "closed";
      return result;
    };
    fixture.replies[refreshMethod] = async input => {
      if (committed) await refresh.promise;
      return originalRead(input);
    };
    const { calls } = visitNetworkDesk(fixture.replies);
    try {
      await selectMiddlePagePassenger(user);
      await submitDeskCommand(kind, user);
      await waitFor(() =>
        expect(calls.filter(call => call.method === method)).toHaveLength(1)
      );
      const sent = calls.find(call => call.method === method)!.input;
      expect(sent).toMatchObject({
        flightId: 51,
        idempotencyKey: expect.any(String),
      });
      if (kind !== "flight")
        expect(sent).toMatchObject({ bookingId: 82, passengerId: 92 });
      if (kind === "bag")
        expect(sent).toMatchObject({ segmentId: 102, weight: 8 });

      await attemptNavigation(user);
      expect(screen.getByLabelText("Flight")).toHaveValue("51");
      expect(
        screen.getByRole("button", { name: "Select Synthetic Passenger" })
      ).toHaveAttribute("aria-pressed", "true");
      expect(
        screen.getByRole("button", { name: "Previous flights" })
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Next flights" })
      ).toBeDisabled();
      expect(
        calls.filter(call => call.method === "operations.airlineFlights")
      ).toHaveLength(2);
      expect(
        calls
          .filter(call => call.method === "dcsOperations.getDesk")
          .every(call => call.input.flightId === 51)
      ).toBe(true);

      await act(async () =>
        command.resolve({
          eventId: 901,
          baggage: { tagNumber: "SYNTHETIC-001" },
        })
      );
      await waitFor(() =>
        expect(
          calls.filter(call => call.method === refreshMethod)
        ).toHaveLength(2)
      );
      await attemptNavigation(user);
      expect(screen.getByLabelText("Flight")).toHaveValue("51");
      expect(
        screen.getByRole("button", { name: "Select Synthetic Passenger" })
      ).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByLabelText("Flight")).toBeDisabled();
      await act(async () => refresh.resolve());
      await waitFor(() =>
        expect(screen.getByLabelText("Flight")).toBeEnabled()
      );
      await user.selectOptions(screen.getByLabelText("Flight"), "52");
      await waitFor(() =>
        expect(calls).toContainEqual({
          method: "dcsOperations.getDesk",
          input: { flightId: 52 },
        })
      );
      expect(calls.filter(call => call.method === method)).toHaveLength(1);
    } finally {
      command.resolve({
        eventId: 901,
        baggage: { tagNumber: "SYNTHETIC-001" },
      });
      refresh.resolve();
    }
  }
);

it.each<DeskCommand>(["passenger", "bag"])(
  "preserves the %s command and retry key after a failed response and blocked navigation",
  async kind => {
    const user = userEvent.setup();
    const fixture = navigationReplies(kind);
    const first = deferred<unknown>();
    const retry = deferred<unknown>();
    const method = commandMethods[kind];
    let attempts = 0;
    fixture.replies[method] = () =>
      ++attempts === 1 ? first.promise : retry.promise;
    const { calls } = visitNetworkDesk(fixture.replies);
    try {
      await selectMiddlePagePassenger(user);
      await submitDeskCommand(kind, user);
      await waitFor(() =>
        expect(calls.filter(call => call.method === method)).toHaveLength(1)
      );
      const sent = calls.find(call => call.method === method)!.input;
      await attemptNavigation(user);
      expect(screen.getByLabelText("Flight")).toHaveValue("51");
      await act(async () =>
        first.reject(new Error("Command response was lost"))
      );
      await screen.findByText("Command response was lost");
      // The operator keeps this form open and retries the unchanged command.
      const retryButton = screen.getByRole("button", {
        name: kind === "bag" ? "Register received bag" : "Board passenger",
      });
      expect(retryButton).toBeEnabled();
      await user.click(retryButton);
      await waitFor(() =>
        expect(calls.filter(call => call.method === method)).toHaveLength(2)
      );
      expect(calls.filter(call => call.method === method)[1].input).toEqual(
        sent
      );
      await attemptNavigation(user);
      expect(screen.getByLabelText("Flight")).toHaveValue("51");
    } finally {
      first.resolve({ baggage: { tagNumber: "SYNTHETIC-RETRY" } });
      await act(async () =>
        retry.resolve({ baggage: { tagNumber: "SYNTHETIC-RETRY" } })
      );
    }
  }
);

it("keeps the same flight selected until a manually requested baggage closeout read settles", async () => {
  const user = userEvent.setup();
  const fixture = navigationReplies("passenger");
  const closeout = deferred<unknown>();
  const read = fixture.replies["baggage.flightCloseout"];
  fixture.replies["baggage.flightCloseout"] = () => closeout.promise;
  const { calls } = visitNetworkDesk(fixture.replies);
  try {
    await selectMiddlePagePassenger(user);
    await user.click(
      screen.getByRole("button", { name: "dcs.manifest.checkBaggage" })
    );
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "baggage.flightCloseout",
        input: { flightId: 51 },
      })
    );
    await attemptNavigation(user);
    expect(screen.getByLabelText("Flight")).toHaveValue("51");
    expect(screen.getByLabelText("Flight")).toBeDisabled();
    await act(async () => closeout.resolve(read({ flightId: 51 })));
    await waitFor(() => expect(screen.getByLabelText("Flight")).toBeEnabled());
  } finally {
    closeout.resolve(read({ flightId: 51 }));
  }
});

it("does not discard a pending bag form when refreshing the flight list fails", async () => {
  const user = userEvent.setup();
  const fixture = navigationReplies("bag");
  const first = deferred<unknown>();
  const retry = deferred<unknown>();
  let attempts = 0;
  fixture.replies["baggage.register"] = () =>
    ++attempts === 1 ? first.promise : retry.promise;
  const { calls, cache } = visitNetworkDesk(fixture.replies);
  try {
    await selectMiddlePagePassenger(user);
    await submitDeskCommand("bag", user);
    await waitFor(() =>
      expect(
        calls.filter(call => call.method === "baggage.register")
      ).toHaveLength(1)
    );
    const sent = calls.find(call => call.method === "baggage.register")!.input;
    fixture.replies["operations.airlineFlights"] = () => {
      throw new Error("Flight list unavailable");
    };
    await act(async () =>
      cache.invalidateQueries({
        queryKey: getQueryKey(trpc.operations.airlineFlights),
      })
    );
    await screen.findByText(/Flight list unavailable/);
    expect(screen.getByLabelText("Bag weight in kilograms")).toHaveValue(8);
    expect(
      screen.getByRole("button", { name: "Select Synthetic Passenger" })
    ).toHaveAttribute("aria-pressed", "true");
    await act(async () =>
      first.reject(new Error("Bag command response was lost"))
    );
    await screen.findByText("Bag command response was lost");
    await user.click(
      screen.getByRole("button", { name: "Register received bag" })
    );
    await waitFor(() =>
      expect(
        calls.filter(call => call.method === "baggage.register")
      ).toHaveLength(2)
    );
    expect(
      calls.filter(call => call.method === "baggage.register")[1].input
    ).toEqual(sent);
  } finally {
    first.resolve({ baggage: { tagNumber: "SYNTHETIC-RETRY" } });
    await act(async () =>
      retry.resolve({ baggage: { tagNumber: "SYNTHETIC-RETRY" } })
    );
  }
});

it("keeps navigation available for the selected flight when only another flight has pending work", async () => {
  const user = userEvent.setup();
  const fixture = navigationReplies("passenger");
  const { cache } = visitNetworkDesk(fixture.replies);
  await selectMiddlePagePassenger(user);
  const unrelated = deferred<unknown>();
  let command!: Promise<unknown>;
  let read!: Promise<unknown>;
  await act(async () => {
    command = cache
      .getMutationCache()
      .build(cache, {
        mutationKey: getMutationKey(trpc.baggage.register),
        mutationFn: (_input: { flightId: number }) => unrelated.promise,
      })
      .execute({ flightId: 99 });
    read = cache.fetchQuery({
      queryKey: getQueryKey(
        trpc.dcsOperations.getDesk,
        { flightId: 99 },
        "query"
      ),
      queryFn: () => unrelated.promise,
    });
  });
  try {
    expect(screen.getByLabelText("Flight")).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Previous flights" })
    ).toBeEnabled();
    expect(screen.getByRole("button", { name: "Next flights" })).toBeEnabled();
    await user.selectOptions(screen.getByLabelText("Flight"), "52");
    expect(screen.getByLabelText("Flight")).toHaveValue("52");
  } finally {
    await act(async () => {
      unrelated.resolve({});
      await Promise.all([command, read]);
    });
  }
});

it("keeps navigation locked while a post-command refresh is paused offline, then resumes it before unlocking", async () => {
  const user = userEvent.setup();
  const fixture = navigationReplies("passenger");
  const command = deferred<unknown>();
  const refresh = deferred<void>();
  let acknowledged = false;
  const read = fixture.replies["dcsOperations.getDesk"];
  fixture.replies["dcsOperations.transition"] = async () => {
    const result = await command.promise;
    acknowledged = true;
    return result;
  };
  fixture.replies["dcsOperations.getDesk"] = async input => {
    if (acknowledged) await refresh.promise;
    return read(input);
  };
  const { cache, calls } = visitNetworkDesk(fixture.replies);
  const deskKey = getQueryKey(
    trpc.dcsOperations.getDesk,
    { flightId: 51 },
    "query"
  );
  try {
    await selectMiddlePagePassenger(user);
    await submitDeskCommand("passenger", user);
    await waitFor(() =>
      expect(
        calls.filter(call => call.method === "dcsOperations.transition")
      ).toHaveLength(1)
    );
    await act(async () => {
      onlineManager.setOnline(false);
      command.resolve({ eventId: 902 });
    });
    await waitFor(() =>
      expect(
        cache.getQueryCache().find({ queryKey: deskKey })?.state.fetchStatus
      ).toBe("paused")
    );
    await waitFor(() => expect(cache.isMutating()).toBe(0));
    expect(
      calls.filter(call => call.method === "dcsOperations.getDesk")
    ).toHaveLength(1);
    await attemptNavigation(user);
    expect(screen.getByLabelText("Flight")).toHaveValue("51");
    expect(screen.getByLabelText("Flight")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Select Synthetic Passenger" })
    ).toHaveAttribute("aria-pressed", "true");

    await act(async () => onlineManager.setOnline(true));
    await waitFor(() =>
      expect(
        calls.filter(call => call.method === "dcsOperations.getDesk")
      ).toHaveLength(2)
    );
    expect(screen.getByLabelText("Flight")).toBeDisabled();
    await attemptNavigation(user);
    expect(screen.getByLabelText("Flight")).toHaveValue("51");
    await act(async () => refresh.resolve());
    await waitFor(() => expect(screen.getByLabelText("Flight")).toBeEnabled());
    await user.selectOptions(screen.getByLabelText("Flight"), "52");
    expect(screen.getByLabelText("Flight")).toHaveValue("52");
  } finally {
    await act(async () => {
      onlineManager.setOnline(true);
      command.resolve({ eventId: 902 });
      refresh.resolve();
    });
  }
});
