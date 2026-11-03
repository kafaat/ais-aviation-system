import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import MultiCityCheckout from "../MultiCityCheckout";

const calls = vi.hoisted(() => ({
  create: vi.fn(),
  quote: vi.fn(),
  fareClasses: [] as string[],
  quoteFailed: false,
  navigate: vi.fn(),
  refresh: vi.fn(),
  invalidate: vi.fn(),
  fare: 12000,
  price: 550,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("wouter", async importOriginal => ({
  ...(await importOriginal<typeof import("wouter")>()),
  useLocation: () => ["/booking/multi-city", calls.navigate],
  useSearch: () =>
    new URLSearchParams({
      data: JSON.stringify({
        version: 1,
        sessionId: "a77d7683-25d4-4698-923f-fb5a900d80a3",
        passengerCount: 2,
        cabinClass: "economy",
        segments: [2, 4].map((flightId, index) => ({
          fareClassCode: calls.fareClasses[index],
          flightId,
          departureDate: "2027-01-05T12:00:00.000Z",
        })),
      }),
    }).toString(),
}));
vi.mock("@/lib/useRawSearch", async () => {
  const { useSearch } = await import("wouter");
  return { useRawSearch: useSearch };
});
vi.mock("@/lib/trpc", () => {
  const meal = {
    id: 5,
    name: "Meal",
    category: "meal",
    currency: "SAR",
    available: true,
    applicableAirlines: "[4]",
    applicableCabinClasses: '["economy"]',
  };
  return {
    trpc: {
      useUtils: () => ({
        ancillary: { getAvailable: { invalidate: calls.invalidate } },
      }),
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
                      seats: ["A", "B"].map((column, i) => ({
                        id: i + 1,
                        seatNumber: "12" + column,
                        row: 12,
                        column,
                        seatType: "window",
                        status: "available",
                        seatPrice: i * 500,
                      })),
                    },
                  ],
                },
              ],
            },
          }),
        },
      },
      flights: {
        getById: {
          useQuery: ({ id }: { id: number }) => ({
            data: {
              id,
              flightNumber: "SV" + id,
              airline: { id },
              origin: { code: "RUH" },
              destination: { code: "JED" },
            },
          }),
        },
      },
      ancillary: {
        getAvailable: {
          useQuery: () => ({
            data: [
              { ...meal, price: calls.price },
              {
                ...meal,
                id: 6,
                name: "Sports bag",
                category: "baggage",
                price: 100,
                weightGrams: null,
              },
              {
                ...meal,
                id: 7,
                name: "Lounge",
                category: "lounge",
                price: 8000,
              },
            ],
          }),
        },
      },
      multiCity: {
        calculatePrice: {
          useQuery: (input: unknown) => {
            calls.quote(input);
            return {
              data: { totalPrice: calls.fare },
              isError: calls.quoteFailed,
              error: calls.quoteFailed
                ? new Error("Booking class unavailable")
                : undefined,
              refetch: calls.refresh,
            };
          },
        },
        create: { useMutation: () => ({ mutateAsync: calls.create }) },
      },
    },
  };
});
beforeEach(() => {
  vi.clearAllMocks();
  calls.fareClasses = [];
  calls.quoteFailed = false;
  calls.price = 550;
  calls.fare = 12000;
});
const change = (field: HTMLElement, value: string) =>
  fireEvent.change(field, { target: { value } });
function prepare() {
  const view = render(<MultiCityCheckout />);
  for (const [i, name] of ["Yara", "Maha"].entries()) {
    change(screen.getAllByLabelText("booking.firstName")[i], name);
    change(screen.getAllByLabelText("booking.lastName")[i], "Omar");
  }
  expect(screen.queryByTestId("ancillary-product")).toBeNull();
  change(screen.getByTestId("ancillary-segment"), "1");
  expect(screen.getByText(/Sports bag · The carrier/)).toBeInTheDocument();
  expect(
    screen.getByText(/Lounge · Requires confirmation/)
  ).toBeInTheDocument();
  change(screen.getByTestId("ancillary-passenger"), "1");
  change(screen.getByTestId("ancillary-product"), "5");
  change(screen.getByTestId("ancillary-quantity"), "2");
  fireEvent.click(screen.getByTestId("ancillary-add"));
  const list = within(screen.getByTestId("ancillary-review"));
  expect(list.getByRole("listitem")).toHaveTextContent(
    /Maha Omar.*SV4.*Meal.*2 ×.*5.50.*11.00/
  );
  return view;
}
const submit = () =>
  fireEvent.click(screen.getByRole("button", { name: "search.bookNow" }));
it("replays identical per-passenger, per-sector extras and total after an ambiguous connection failure", async () => {
  calls.create
    .mockRejectedValueOnce(new Error("Connection lost"))
    .mockResolvedValueOnce({ bookingId: 73 });
  const view = prepare();
  submit();
  await screen.findByText("Connection lost");
  expect(calls.create.mock.calls[0][0]).toMatchObject({
    expectedTotalMinor: 13100,
    ancillaries: [
      {
        passengerIndex: 1,
        segmentIndex: 1,
        ancillaryServiceId: 5,
        quantity: 2,
        unitPrice: 550,
        totalPrice: 1100,
      },
    ],
  });
  calls.fare = 14000;
  calls.price = 600;
  view.rerender(<MultiCityCheckout />);
  expect(screen.getByTestId("ancillary-add")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
  submit();
  expect(calls.create.mock.calls[1][0]).toEqual(calls.create.mock.calls[0][0]);
});
it("allows removal and review at the refreshed catalog price after a definite conflict", async () => {
  calls.create
    .mockRejectedValueOnce(
      Object.assign(new Error("Price changed"), { data: { code: "CONFLICT" } })
    )
    .mockResolvedValueOnce({ bookingId: 73 });
  const view = prepare();
  submit();
  await screen.findByText("Price changed");
  expect(calls.refresh).toHaveBeenCalled();
  expect(calls.invalidate).toHaveBeenCalled();
  calls.price = 600;
  view.rerender(<MultiCityCheckout />);
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  change(screen.getByTestId("ancillary-product"), "5");
  fireEvent.click(screen.getByTestId("ancillary-add"));
  submit();
  expect(calls.create.mock.calls[1][0]).toMatchObject({
    expectedTotalMinor: 12600,
    ancillaries: [{ quantity: 1, unitPrice: 600, totalPrice: 600 }],
  });
});

it("preserves a distinct seat assignment per sector and passenger through an ambiguous retry", async () => {
  calls.create
    .mockRejectedValueOnce(new Error("Seat reply lost"))
    .mockResolvedValueOnce({});
  prepare();
  const scope = within(
    screen.getByRole("region", { name: "checkIn.seatAssignments" })
  );
  fireEvent.click(scope.getByRole("button", { name: "checkIn.selectSeats" }));
  const seat = () => scope.getByRole("button", { name: "12A available" });
  expect(scope.getByRole("button", { name: "12B available" })).toBeDisabled();
  fireEvent.click(seat());
  change(scope.getByLabelText("manageAncillaries.passenger"), "1");
  expect(seat()).toBeDisabled();
  change(scope.getByLabelText("manageAncillaries.sector"), "1");
  fireEvent.click(seat());
  expect(scope.getAllByRole("listitem")).toHaveLength(2);
  submit();
  await screen.findByText("Seat reply lost");
  const [command] = calls.create.mock.calls[0];
  expect(command.segments.map((s: { seats: unknown }) => s.seats)).toEqual([
    [{ passengerIndex: 0, seatNumber: "12A" }],
    [{ passengerIndex: 1, seatNumber: "12A" }],
  ]);
  expect(seat()).toBeDisabled();
  submit();
  expect(calls.create.mock.calls[1][0]).toEqual(command);
});

it("quotes and submits the same normalized fare class on its selected sector", async () => {
  calls.fareClasses = ["y", "M"];
  calls.create.mockResolvedValue({});
  prepare();
  expect(calls.quote).toHaveBeenLastCalledWith({
    segments: [
      { flightId: 2, cabinClass: "economy", fareClassCode: "Y" },
      { flightId: 4, cabinClass: "economy", fareClassCode: "M" },
    ],
    passengerCount: 2,
    passengerTypes: ["adult", "adult"],
  });
  submit();
  expect(calls.create.mock.calls[0][0].segments).toMatchObject([
    { flightId: 2, fareClassCode: "Y" },
    { flightId: 4, fareClassCode: "M" },
  ]);
});

it("keeps legacy cabin-only links and blocks submission if a refreshed quote fails with cached data", () => {
  const view = prepare();
  expect(calls.quote.mock.lastCall?.[0].segments).toEqual([
    { flightId: 2, cabinClass: "economy" },
    { flightId: 4, cabinClass: "economy" },
  ]);
  calls.quoteFailed = true;
  view.rerender(<MultiCityCheckout />);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Booking class unavailable"
  );
  expect(screen.getByRole("button", { name: "search.bookNow" })).toBeDisabled();
  submit();
  expect(calls.create).not.toHaveBeenCalled();
});

it("rejects a malformed explicit class instead of silently replacing it with cabin-only inventory", () => {
  calls.fareClasses = ["1invalid", "M"];
  render(<MultiCityCheckout />);
  expect(screen.getByRole("alert")).toHaveTextContent(
    "multiCity.invalidItinerary"
  );
  expect(calls.quote).not.toHaveBeenCalled();
  expect(calls.create).not.toHaveBeenCalled();
});
