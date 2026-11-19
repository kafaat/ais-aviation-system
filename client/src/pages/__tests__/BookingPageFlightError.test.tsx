import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { Route, Router, Switch } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { TooltipProvider } from "@/components/ui/tooltip";
import BookingPage from "../BookingPage";

const flightRead = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  refetch: vi.fn(),
}));
const calls = vi.hoisted(() => ({
  create: vi.fn(),
  offer: vi.fn(),
  allocation: undefined as
    undefined | { passengers: number; totalAmount: number },
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
      getById: { useQuery: () => flightRead.state },
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
function renderPage() {
  const { hook } = memoryLocation({ path: "/booking/42" });
  return render(
    <Router hook={hook}>
      <TooltipProvider>
        <Switch>
          <Route path="/booking/:id" component={BookingPage} />
        </Switch>
      </TooltipProvider>
    </Router>
  );
}

beforeEach(() => {
  flightRead.refetch.mockReset();
});

it("shows a load error with retry, not 'no flights', when the flight read fails", () => {
  flightRead.state = {
    data: undefined,
    isLoading: false,
    isError: true,
    error: {
      message: "Synthetic flight outage",
      data: { code: "INTERNAL_SERVER_ERROR" },
    },
    refetch: flightRead.refetch,
  };
  renderPage();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Synthetic flight outage"
  );
  expect(screen.queryByText("search.noFlights")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(flightRead.refetch).toHaveBeenCalledOnce();
});

it("still says the flight is missing for a verified NOT_FOUND", () => {
  flightRead.state = {
    data: undefined,
    isLoading: false,
    isError: true,
    error: { message: "Flight not found", data: { code: "NOT_FOUND" } },
    refetch: flightRead.refetch,
  };
  renderPage();
  expect(screen.getByText("search.noFlights")).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
