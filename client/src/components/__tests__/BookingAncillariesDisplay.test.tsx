import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { BookingAncillariesDisplay } from "../BookingAncillariesDisplay";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/trpc", () => ({
  trpc: { ancillary: { getBookingAncillaries: { useQuery: query } } },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));
it("labels each meal and bag by its own stored passenger and segment; unresolved historical assignments stay explicit", () => {
  const meal = {
    id: 1,
    quantity: 1,
    totalPrice: 100,
    service: { name: "Meal", category: "meal" },
    status: "active",
    passengerFirstName: "Ali",
    passengerLastName: "Saleh",
    scopeState: "specific_segment",
    segmentOrder: 2,
    flightNumber: "AB123",
  };
  query.mockReturnValue({
    data: [
      meal,
      {
        ...meal,
        id: 2,
        service: { name: "Bag", category: "baggage" },
        scopeState: "unresolved",
        passengerFirstName: null,
        passengerLastName: null,
      },
      { ...meal, id: 3, scopeState: "all_segments" },
    ],
  });
  render(<BookingAncillariesDisplay bookingId={17} />);
  expect(query).toHaveBeenCalledWith({ bookingId: 17 });
  expect(screen.getByText("Ali Saleh · Sector 2 · AB123")).toBeInTheDocument();
  expect(
    screen.getByText("Passenger not assigned · Sector not assigned")
  ).toBeInTheDocument();
  expect(screen.getByText("Ali Saleh · All sectors")).toBeInTheDocument();
});

it("distinguishes inactive lines across categories and excludes their historical prices from the active total", () => {
  query.mockReturnValue({
    data: [
      {
        id: 1,
        service: { name: "Meal", category: "meal" },
        totalPrice: 100,
        status: "active",
      },
      {
        id: 2,
        service: { name: "Seat", category: "seat" },
        totalPrice: 2300,
        status: "refunded",
      },
      { id: 3, service: null, totalPrice: 5100, status: "cancelled" },
    ],
  });
  render(<BookingAncillariesDisplay bookingId={2} />);
  expect(
    screen.getByText("Refunded").closest('[data-testid="booked-extra"]')
  ).toHaveTextContent("Seat");
  expect(
    screen.getByText("Cancelled").closest('[data-testid="booked-extra"]')
  ).toHaveTextContent("Unidentified service");
  expect(
    screen.getByText("Active services total").parentElement
  ).toHaveTextContent("1.00 common.sar");
});
