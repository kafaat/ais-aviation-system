import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import MultiCityCheckout from "../MultiCityCheckout";

const calls = vi.hoisted(() => ({
  create: vi.fn(),
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
        segments: [2, 4].map(flightId => ({
          flightId,
          departureDate: "2027-01-05T12:00:00.000Z",
        })),
      }),
    }).toString(),
}));
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
          useQuery: () => ({
            data: { totalPrice: calls.fare },
            refetch: calls.refresh,
          }),
        },
        create: { useMutation: () => ({ mutateAsync: calls.create }) },
      },
    },
  };
});
beforeEach(() => {
  vi.clearAllMocks();
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
    .mockResolvedValueOnce({});
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
    .mockResolvedValueOnce({});
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
