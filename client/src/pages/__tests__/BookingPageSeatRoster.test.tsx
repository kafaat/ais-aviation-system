import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { Route, Router, Switch } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { TooltipProvider } from "@/components/ui/tooltip";
import BookingPage from "../BookingPage";

const calls = vi.hoisted(() => ({
  create: vi.fn(),
  offer: vi.fn(),
  allocation: undefined as
    | undefined
    | { passengers: number; totalAmount: number },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 1 }, isAuthenticated: true, loading: false }),
}));
vi.mock("@/components/SEO", () => ({ SEO: () => null }));
vi.mock("@/components/DisplayCurrencyEstimate", () => ({
  DisplayCurrencyEstimate: () => null,
}));
vi.mock("@/components/SavedPassengerSelect", () => ({
  SavedPassengerSelect: () => null,
}));
vi.mock("@/components/TravelRequirements", () => ({
  TravelRequirements: () => null,
}));
vi.mock("@/components/CarbonOffset", () => ({ CarbonOffset: () => null }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    ibePublic: {
      config: { useQuery: () => ({ data: { brandName: "Journey Air" } }) },
    },
    useUtils: () => ({
      ancillary: { getAvailable: { invalidate: vi.fn() } },
    }),
    bookings: {
      getAllocation: { useQuery: () => ({ data: calls.allocation }) },
      create: {
        useMutation: () => ({ mutateAsync: calls.create, isPending: false }),
      },
    },
    ancillary: {
      getAvailable: {
        useQuery: () => ({
          data: [
            {
              id: 11,
              name: "Extra bag",
              category: "baggage",
              weightGrams: 20000,
              available: true,
              currency: "SAR",
              price: 1500,
              applicableCabinClasses: null,
              applicableAirlines: null,
            },
          ],
        }),
      },
    },
    priceQuote: {
      createOffer: {
        useMutation: () => ({ mutateAsync: calls.offer, isPending: false }),
      },
    },
    priceLock: { checkLock: { useQuery: () => ({ data: { lock: null } }) } },
    savedPassengers: { add: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
    userPreferences: { getMyPreferences: { useQuery: () => ({}) } },
    rebooking: { getRebookData: { useQuery: () => ({}) } },
    favorites: {
      getAll: { useQuery: () => ({ data: [], refetch: vi.fn() }) },
      add: { useMutation: () => ({ mutate: vi.fn() }) },
    },
    flights: {
      getById: {
        useQuery: () => ({
          data: {
            id: 42,
            flightNumber: "SV42",
            departureTime: new Date("2027-01-15T12:00:00Z"),
            arrivalTime: new Date("2027-01-15T14:00:00Z"),
            economyPrice: 10000,
            businessPrice: 20000,
            aircraftType: "A320",
            airline: { id: 1, code: "SV", name: "Synthetic", logo: null },
            origin: {
              id: 1,
              code: "RUH",
              city: "Riyadh",
              timezone: "Asia/Riyadh",
            },
            destination: {
              id: 2,
              code: "JED",
              city: "Jeddah",
              timezone: "Asia/Riyadh",
            },
          },
          isLoading: false,
        }),
      },
    },
    seatMap: {
      getFlightSeatMap: {
        useQuery: () => ({
          data: {
            aircraftType: "A320",
            cabins: [
              {
                cabinClass: "economy",
                rows: [
                  {
                    row: 12,
                    seats: ["A", "B", "C"].map((column, index) => ({
                      id: index + 1,
                      seatNumber: `12${column}`,
                      row: 12,
                      column,
                      seatType: "standard",
                      status: "available",
                      seatPrice: 0,
                    })),
                  },
                ],
              },
            ],
          },
        }),
      },
    },
  },
}));

beforeEach(() => {
  calls.allocation = undefined;
  calls.create.mockReset().mockResolvedValue({ bookingId: 700 });
  calls.offer.mockReset().mockResolvedValue({
    offerId: "synthetic-offer",
    totalAmount: 10000,
    expiresAt: new Date("2030-01-01T00:00:00Z"),
  });
});

function prepare(path = "/booking/42?adults=2", names = ["Aisha", "Yara"]) {
  const location = memoryLocation({ path, record: true });
  const workspace = () => (
    <Router hook={location.hook}>
      <TooltipProvider>
        <Switch>
          <Route path="/booking/:id">
            <BookingPage />
          </Route>
          <Route path="/checkout/:bookingId">
            <p>Owned checkout</p>
          </Route>
        </Switch>
      </TooltipProvider>
    </Router>
  );
  const view = render(workspace());
  fillPassengers(names);
  return Object.assign(location, {
    refresh: () => view.rerender(workspace()),
  });
}

function fillPassengers(names: string[]) {
  for (const [index, firstName] of names.entries()) {
    fireEvent.change(screen.getAllByLabelText(/booking.firstName/)[index], {
      target: { value: firstName },
    });
    fireEvent.change(screen.getAllByLabelText(/booking.lastName/)[index], {
      target: { value: "Journey" },
    });
  }
}

function addExtra(passengerIndex: number, quantity: number) {
  fireEvent.change(screen.getByTestId("ancillary-passenger"), {
    target: { value: String(passengerIndex) },
  });
  fireEvent.change(screen.getByTestId("ancillary-product"), {
    target: { value: "11" },
  });
  fireEvent.change(screen.getByTestId("ancillary-quantity"), {
    target: { value: String(quantity) },
  });
  fireEvent.click(screen.getByTestId("ancillary-add"));
}

const seat = (number: string) =>
  within(screen.getByTestId("seat-selection")).getByRole("button", {
    name: `${number} available`,
  });
const remove = (number: number) =>
  fireEvent.click(
    screen.getByRole("button", { name: `booking.removePassenger ${number}` })
  );

async function submit(refreshOffer = true) {
  if (refreshOffer)
    fireEvent.click(screen.getByRole("button", { name: "Refresh fare offer" }));
  const complete = screen.getByRole("button", {
    name: "booking.completeBooking",
  });
  await waitFor(() => expect(complete).not.toBeDisabled());
  fireEvent.click(complete);
  await screen.findByText("Owned checkout");
  expect(calls.create).toHaveBeenCalledTimes(1);
  return calls.create.mock.calls[0][0].passengers;
}

it("removes the deleted passenger's seat while preserving the remaining passenger's assignment", async () => {
  prepare();
  fireEvent.click(seat("12A"));
  fireEvent.click(seat("12B"));
  remove(1);
  expect(seat("12A")).toHaveAttribute("aria-pressed", "false");
  expect(seat("12B")).toHaveAttribute("aria-pressed", "true");
  expect(await submit()).toEqual([
    {
      type: "adult",
      firstName: "Yara",
      lastName: "Journey",
      seatNumber: "12B",
    },
  ]);
});

it("continues booking without promising an unimplemented per-booking SMS subscription", async () => {
  prepare();
  expect(
    screen.queryByLabelText("sms.receiveNotifications")
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText("sms.notificationDescription")
  ).not.toBeInTheDocument();
  expect(
    screen.queryByPlaceholderText("sms.phoneNumberPlaceholder")
  ).not.toBeInTheDocument();
  await submit();
  expect(calls.create.mock.calls[0][0]).not.toHaveProperty("smsNotification");
  expect(calls.create.mock.calls[0][0]).not.toHaveProperty("smsPhoneNumber");
});

it("clears a removed passenger's only selection and does not restore it when another seat is chosen", async () => {
  prepare();
  fireEvent.click(seat("12A"));
  remove(1);
  expect(seat("12A")).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(seat("12C"));
  expect(seat("12A")).toHaveAttribute("aria-pressed", "false");
  expect(seat("12C")).toHaveAttribute("aria-pressed", "true");
  expect(await submit()).toEqual([
    {
      type: "adult",
      firstName: "Yara",
      lastName: "Journey",
      seatNumber: "12C",
    },
  ]);
});

it("keeps the first passenger's seat when an unassigned passenger is removed", async () => {
  prepare();
  fireEvent.click(seat("12A"));
  remove(2);
  expect(seat("12A")).toHaveAttribute("aria-pressed", "true");
  expect(await submit()).toEqual([
    {
      type: "adult",
      firstName: "Aisha",
      lastName: "Journey",
      seatNumber: "12A",
    },
  ]);
});

it("reuses the booking intent after a lost response and changes it when the passenger changes", async () => {
  calls.create
    .mockRejectedValueOnce(new Error("Lost response"))
    .mockRejectedValueOnce(new Error("Still unknown"));
  prepare();
  fireEvent.click(screen.getByRole("button", { name: "Refresh fare offer" }));
  const complete = screen.getByRole("button", {
    name: "booking.completeBooking",
  });
  await waitFor(() => expect(complete).not.toBeDisabled());
  fireEvent.click(complete);
  await waitFor(() => expect(calls.create).toHaveBeenCalledTimes(1));
  fireEvent.click(complete);
  await waitFor(() => expect(calls.create).toHaveBeenCalledTimes(2));
  const first = calls.create.mock.calls[0][0];
  const retry = calls.create.mock.calls[1][0];
  expect(first.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  expect(retry).toEqual(first);
  fireEvent.change(screen.getAllByLabelText(/booking.firstName/)[0], {
    target: { value: "Sara" },
  });
  fireEvent.click(complete);
  await screen.findByText("Owned checkout");
  const amended = calls.create.mock.calls[2][0];
  expect(amended.idempotencyKey).not.toBe(first.idempotencyKey);
  expect(amended.sessionId).toBe(amended.idempotencyKey);
  expect(amended.passengers[0].firstName).toBe("Sara");
  expect(amended.offerId).toBe(first.offerId);
});

it.each([
  ["wallet", "Pay with wallet"],
  ["split", "splitPayment.splitWithOthers"],
])(
  "prepares one booking before handing the %s choice to owned checkout",
  async (method, button) => {
    const route = prepare();
    fireEvent.click(screen.getByRole("button", { name: "Refresh fare offer" }));
    const payment = screen.getByRole("button", { name: button });
    await waitFor(() => expect(payment).not.toBeDisabled());
    fireEvent.click(payment);
    await screen.findByText("Owned checkout");
    expect(calls.create).toHaveBeenCalledTimes(1);
    expect(calls.create.mock.calls[0][0]).toMatchObject({
      flightId: 42,
      cabinClass: "economy",
      offerId: "synthetic-offer",
    });
    const destination = new URL(route.history.at(-1)!, "https://fixture.test");
    expect(destination.pathname).toBe("/checkout/700");
    expect(destination.searchParams.get("method")).toBe(method);
    expect(destination.searchParams.get("adults")).toBe("2");
  }
);

it("removes a deleted passenger's extras and reindexes the remaining purchased quantities", async () => {
  prepare();
  for (const passengerIndex of [0, 1]) {
    fireEvent.change(screen.getByTestId("ancillary-passenger"), {
      target: { value: String(passengerIndex) },
    });
    fireEvent.change(screen.getByTestId("ancillary-product"), {
      target: { value: "11" },
    });
    fireEvent.change(screen.getByTestId("ancillary-quantity"), {
      target: { value: String(passengerIndex + 1) },
    });
    fireEvent.click(screen.getByTestId("ancillary-add"));
  }
  expect(
    within(screen.getByTestId("ancillary-review")).getAllByRole("listitem")
  ).toHaveLength(2);
  remove(1);
  expect(screen.getByTestId("ancillary-review")).toHaveTextContent(
    "Yara Journey"
  );
  expect(screen.getByTestId("ancillary-review")).not.toHaveTextContent("Aisha");
  await submit();
  expect(calls.create.mock.calls[0][0].ancillaries).toEqual([
    {
      passengerIndex: 0,
      segmentIndex: 0,
      ancillaryServiceId: 11,
      quantity: 2,
      unitPrice: 1500,
      totalPrice: 3000,
    },
  ]);
});

it.each(["waitlistId", "groupBookingId"])(
  "loads the server allocated roster for %s and keeps the allocation in the booking command",
  async allocation => {
    calls.allocation = { passengers: 3, totalAmount: 18000 };
    prepare(`/booking/42?adults=1&${allocation}=5`, ["Aisha", "Yara", "Sara"]);
    expect(screen.getAllByLabelText(/booking.firstName/)).toHaveLength(3);
    fireEvent.click(
      screen.getByRole("button", { name: "booking.addPassenger" })
    );
    expect(screen.getAllByLabelText(/booking.firstName/)).toHaveLength(3);
    if (allocation === "waitlistId")
      fireEvent.click(
        screen.getByRole("button", { name: "Refresh fare offer" })
      );
    const complete = screen.getByRole("button", {
      name: "booking.completeBooking",
    });
    await waitFor(() => expect(complete).not.toBeDisabled());
    fireEvent.click(complete);
    await screen.findByText("Owned checkout");
    const command = calls.create.mock.calls[0][0];
    expect(command[allocation]).toBe(5);
    expect(command.passengers).toHaveLength(3);
    if (allocation === "groupBookingId") {
      expect(command.offerId).toBeUndefined();
      expect(command.priceLockId).toBeUndefined();
    }
  }
);

it("removes the middle of three passengers without moving another passenger's seat or extras", async () => {
  prepare("/booking/42?adults=3", ["Aisha", "Yara", "Sara"]);
  for (const [index, number] of ["12A", "12B", "12C"].entries()) {
    fireEvent.click(seat(number));
    addExtra(index, index + 1);
  }
  remove(2);
  expect(seat("12A")).toHaveAttribute("aria-pressed", "true");
  expect(seat("12B")).toHaveAttribute("aria-pressed", "false");
  expect(seat("12C")).toHaveAttribute("aria-pressed", "true");
  const extras = within(screen.getByTestId("ancillary-review"));
  expect(extras.getAllByRole("listitem")).toHaveLength(2);
  expect(extras.getByText(/Aisha Journey/)).toHaveTextContent("1 ×");
  expect(extras.getByText(/Sara Journey/)).toHaveTextContent("3 ×");
  expect(extras.queryByText(/Yara/)).not.toBeInTheDocument();
  expect(await submit()).toEqual([
    {
      type: "adult",
      firstName: "Aisha",
      lastName: "Journey",
      seatNumber: "12A",
    },
    {
      type: "adult",
      firstName: "Sara",
      lastName: "Journey",
      seatNumber: "12C",
    },
  ]);
  expect(calls.create.mock.calls[0][0].ancillaries).toEqual([
    {
      passengerIndex: 0,
      segmentIndex: 0,
      ancillaryServiceId: 11,
      quantity: 1,
      unitPrice: 1500,
      totalPrice: 1500,
    },
    {
      passengerIndex: 1,
      segmentIndex: 0,
      ancillaryServiceId: 11,
      quantity: 3,
      unitPrice: 1500,
      totalPrice: 4500,
    },
  ]);
});

it("keeps an unknown booking key for an unchanged retry and replaces it when only extras change", async () => {
  calls.create
    .mockRejectedValueOnce(new Error("Response lost"))
    .mockRejectedValueOnce(new Error("Still unknown"));
  prepare();
  fireEvent.click(seat("12A"));
  addExtra(0, 1);
  fireEvent.click(screen.getByRole("button", { name: "Refresh fare offer" }));
  const complete = screen.getByRole("button", {
    name: "booking.completeBooking",
  });
  await waitFor(() => expect(complete).toBeEnabled());
  fireEvent.click(complete);
  await waitFor(() => expect(calls.create).toHaveBeenCalledTimes(1));
  fireEvent.click(complete);
  await waitFor(() => expect(calls.create).toHaveBeenCalledTimes(2));
  const original = calls.create.mock.calls[0][0];
  expect(calls.create.mock.calls[1][0]).toEqual(original);
  fireEvent.click(
    within(screen.getByTestId("ancillary-review")).getByRole("button", {
      name: "Remove",
    })
  );
  addExtra(0, 2);
  fireEvent.click(complete);
  await screen.findByText("Owned checkout");
  const changed = calls.create.mock.calls[2][0];
  expect(changed.idempotencyKey).not.toBe(original.idempotencyKey);
  expect(changed.sessionId).toBe(changed.idempotencyKey);
  expect(changed.passengers).toEqual(original.passengers);
  expect(changed.offerId).toBe(original.offerId);
  expect(changed.ancillaries).toEqual([
    { ...original.ancillaries[0], quantity: 2, totalPrice: 3000 },
  ]);
});

it.each(["waitlistId", "groupBookingId"])(
  "clears the prior roster's seats and extras when a delayed %s allocation arrives",
  async allocation => {
    const route = prepare(`/booking/42?adults=2&${allocation}=5`);
    fireEvent.click(seat("12A"));
    fireEvent.click(seat("12B"));
    addExtra(1, 2);
    expect(screen.getByTestId("ancillary-review")).toHaveTextContent("Yara");
    calls.allocation = { passengers: 3, totalAmount: 18000 };
    route.refresh();
    expect(screen.getAllByLabelText(/booking.firstName/)).toHaveLength(3);
    for (const input of screen.getAllByLabelText(/booking.firstName/))
      expect(input).toHaveValue("");
    expect(screen.queryByTestId("ancillary-review")).not.toBeInTheDocument();
    expect(seat("12A")).toHaveAttribute("aria-pressed", "false");
    expect(seat("12B")).toHaveAttribute("aria-pressed", "false");
    fillPassengers(["New One", "New Two", "New Three"]);
    fireEvent.click(
      screen.getByRole("button", { name: "booking.addPassenger" })
    );
    remove(2);
    expect(screen.getAllByLabelText(/booking.firstName/)).toHaveLength(3);
    await submit(allocation !== "groupBookingId");
    expect(calls.create.mock.calls[0][0]).toMatchObject({
      [allocation]: 5,
      passengers: [
        { firstName: "New One", seatNumber: undefined },
        { firstName: "New Two", seatNumber: undefined },
        { firstName: "New Three", seatNumber: undefined },
      ],
      ancillaries: undefined,
    });
  }
);

it.each(["waitlistId", "groupBookingId"])(
  "starts a clean roster when navigating from one %s allocation to another",
  async allocation => {
    calls.allocation = { passengers: 3, totalAmount: 18000 };
    const route = prepare(`/booking/42?${allocation}=5`, [
      "Aisha",
      "Yara",
      "Sara",
    ]);
    fireEvent.click(seat("12A"));
    addExtra(1, 2);
    calls.allocation = { passengers: 2, totalAmount: 14000 };
    act(() => route.navigate(`/booking/42?${allocation}=6`));
    expect(screen.getAllByLabelText(/booking.firstName/)).toHaveLength(2);
    expect(screen.queryByTestId("ancillary-review")).not.toBeInTheDocument();
    expect(seat("12A")).toHaveAttribute("aria-pressed", "false");
    fillPassengers(["New One", "New Two"]);
    addExtra(1, 1);
    await submit(allocation !== "groupBookingId");
    expect(calls.create.mock.calls[0][0]).toMatchObject({
      [allocation]: 6,
      passengers: [{ firstName: "New One" }, { firstName: "New Two" }],
      ancillaries: [
        { passengerIndex: 1, quantity: 1, unitPrice: 1500, totalPrice: 1500 },
      ],
    });
  }
);
