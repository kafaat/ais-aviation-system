import { render, screen, within, fireEvent } from "@testing-library/react";
import { expect, it, vi, beforeEach } from "vitest";
import { ManageAncillariesDialog } from "../ManageAncillariesDialog";
const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  remove: vi.fn(),
  price: 120,
  invalidate: vi.fn(),
  onMutation: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
vi.mock("@/lib/trpc", () => {
  const service = {
    id: 4,
    name: "Meal",
    category: "meal",
    price: 120,
    currency: "SAR",
    applicableAirlines: "[50]",
    applicableCabinClasses: '["economy"]',
  };
  const legs = [3, 6].map((flightId, i) => ({
    flightId,
    flightNumber: "AB" + flightId,
    departureTime: new Date(Date.now() + 86400000),
    status: "scheduled",
    passengers: [
      { passengerId: 2, seatNumber: "1A" },
      { passengerId: 8, seatNumber: i === 0 ? "2A" : null },
    ],
  }));
  return {
    trpc: {
      useUtils: () => ({
        ancillary: { getAvailable: { invalidate: mocks.invalidate } },
      }),
      ancillary: {
        getAvailable: {
          useQuery: () => ({
            data: [
              { ...service, price: mocks.price },
              { ...service, category: "baggage", id: 5, weightGrams: 23000 },
              {
                ...service,
                name: "Sports equipment",
                category: "baggage",
                id: 9,
                weightGrams: null,
              },
            ],
          }),
        },
        getBookingAncillaries: {
          useQuery: () => ({
            data: [
              {
                id: 21,
                service,
                quantity: 2,
                totalPrice: 240,
                passengerFirstName: "Maha",
                passengerLastName: "Omar",
                segmentOrder: 2,
                flightNumber: "AB6",
                scopeState: "specific_segment",
              },
            ],
          }),
        },
        addToBooking: {
          useMutation: (options: unknown) => {
            mocks.onMutation(options);
            return { mutate: mocks.add };
          },
        },
        removeFromBooking: { useMutation: () => ({ mutate: mocks.remove }) },
      },
      bookings: {
        getDepartureState: { useQuery: () => ({ data: legs }) },
        getPassengers: {
          useQuery: () => ({
            data: [
              { id: 2, firstName: "Fadi", lastName: "Kamel" },
              { id: 8, firstName: "Maha", lastName: "Omar" },
            ],
          }),
        },
      },
      seatMap: { getFlightSeatMap: { useQuery: () => ({}) } },
      flights: {
        getById: {
          useQuery: ({ id }: { id: number }) => ({
            data: { airline: { id: id === 3 ? 78 : 50 } },
          }),
        },
      },
    },
  };
});
const props = {
  bookingId: 20,
  numberOfPassengers: 2,
  cabinClass: "economy" as const,
  open: true,
  onOpenChange: () => {},
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.price = 120;
});
it.each([4, 5])(
  "adds product %s for a named passenger on an eligible sector and replays the same command after an ambiguous failure",
  id => {
    render(<ManageAncillariesDialog {...props} editable />);
    const offer = within(screen.getByTestId("extra-offer-" + id));
    const add = offer.getByText("common.add");
    const select = (label: string, value: string) =>
      fireEvent.change(offer.getByLabelText("manageAncillaries." + label), {
        target: { value },
      });
    expect(add).toBeDisabled();
    select("sector", "3");
    select("passenger", "2");
    expect(add).toBeDisabled();
    select("sector", "6");
    expect(add).toBeDisabled();
    select("passenger", "2");
    select("quantity", "11");
    expect(add).toBeDisabled();
    select("quantity", "2");
    fireEvent.click(add);
    fireEvent.click(add);
    const payload = mocks.add.mock.calls[0][0];
    expect(payload).toEqual({
      bookingId: 20,
      ancillaryServiceId: id,
      flightId: 6,
      passengerId: 2,
      quantity: 2,
      idempotencyKey: expect.any(String),
      expectedUnitPrice: 120,
    });
    expect(mocks.add.mock.calls[1][0]).toEqual(payload);
    expect(
      within(screen.getByTestId("extra-offer-9")).queryByRole("button")
    ).toBeNull();
    const line = within(screen.getByTestId("extra-line-21"));
    expect(line.getByText(/Maha Omar/)).toHaveTextContent("AB6");
    fireEvent.click(line.getByRole("button", { name: "Remove" }));
    expect(mocks.remove).toHaveBeenCalledWith({ ancillaryId: 21 });
  }
);
it("shows purchased assignments without add or removal actions on a settled booking", () => {
  render(<ManageAncillariesDialog {...props} editable={false} />);
  expect(screen.getByText(/Maha Omar/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "common.add" })).toBeNull();
  expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
});

it("retains the offered price on uncertain replay, then refreshes and uses a new command after a confirmed conflict", () => {
  const view = render(<ManageAncillariesDialog {...props} editable />);
  const meal = within(screen.getByTestId("extra-offer-4"));
  for (const [field, value] of [
    ["sector", "6"],
    ["passenger", "8"],
  ])
    fireEvent.change(meal.getByLabelText("manageAncillaries." + field), {
      target: { value },
    });
  const add = meal.getByRole("button", { name: "common.add" });
  fireEvent.click(add);
  const initial = mocks.add.mock.calls[0][0];
  mocks.price = 580;
  view.rerender(<ManageAncillariesDialog {...props} editable />);
  fireEvent.click(add);
  expect(mocks.add.mock.calls[1][0]).toEqual(initial);
  const conflict = { data: { code: "CONFLICT" }, message: "Price changed" };
  mocks.onMutation.mock.lastCall?.[0].onError(conflict);
  mocks.add.mock.lastCall?.[1].onError(conflict);
  expect(mocks.invalidate).toHaveBeenCalled();
  expect(meal.getByText(/5.80/)).toBeInTheDocument();
  fireEvent.click(add);
  expect(mocks.add.mock.lastCall?.[0]).toEqual({
    ...initial,
    expectedUnitPrice: 580,
    idempotencyKey: expect.not.stringMatching(initial.idempotencyKey),
  });
});
