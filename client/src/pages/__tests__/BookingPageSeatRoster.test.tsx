import {
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

const calls = vi.hoisted(() => ({ create: vi.fn(), offer: vi.fn() }));

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
vi.mock("@/components/AncillarySelection", () => ({
  default: () => null,
  ancillaryCommandLines: () => [],
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      ancillary: { getAvailable: { invalidate: vi.fn() } },
    }),
    bookings: {
      getAllocation: { useQuery: () => ({}) },
      create: {
        useMutation: () => ({ mutateAsync: calls.create, isPending: false }),
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
  calls.create.mockReset().mockResolvedValue({ bookingId: 700 });
  calls.offer.mockReset().mockResolvedValue({
    offerId: "synthetic-offer",
    totalAmount: 10000,
    expiresAt: new Date("2030-01-01T00:00:00Z"),
  });
});

function prepare() {
  const location = memoryLocation({ path: "/booking/42?adults=2" });
  render(
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
  for (const [index, firstName] of ["Aisha", "Yara"].entries()) {
    fireEvent.change(screen.getAllByLabelText(/booking.firstName/)[index], {
      target: { value: firstName },
    });
    fireEvent.change(screen.getAllByLabelText(/booking.lastName/)[index], {
      target: { value: "Journey" },
    });
  }
}

const seat = (number: string) =>
  within(screen.getByTestId("seat-selection")).getByRole("button", {
    name: `${number} available`,
  });
const remove = (number: number) =>
  fireEvent.click(
    screen.getByRole("button", { name: `booking.removePassenger ${number}` })
  );

async function submit() {
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
