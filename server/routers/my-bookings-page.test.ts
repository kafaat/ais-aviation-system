import { afterEach, expect, it, vi } from "vitest";
import * as db from "../db";
import type { TrpcContext } from "../_core/context";
import { bookingsRouter } from "./bookings";

const caller = bookingsRouter.createCaller({
  user: { id: 11, role: "user" },
  tenantId: 5,
} as TrpcContext);
const date = new Date("2026-03-01T03:04:05Z");
const row = (id: number) => ({
  id,
  seatsReserved: true,
  canExchange: false,
  passengers: [],
  bookingReference: "abc",
  pnr: "ABC123",
  status: "confirmed" as const,
  totalAmount: 350,
  paymentStatus: "paid" as const,
  cabinClass: "economy" as const,
  numberOfPassengers: 1,
  checkedIn: false,
  createdAt: date,
  flightId: 10,
  marketingFlightNumber: null,
  flight: {
    id: 10,
    flightNumber: "AIS1",
    departureTime: date,
    arrivalTime: date,
    status: "scheduled" as const,
    origin: "RUH",
    destination: "JED",
    originTimezone: null,
    destinationTimezone: null,
  },
});
afterEach(() => vi.restoreAllMocks());

it.each(["dateDesc", "dateAsc", "priceDesc", "priceAsc"] as const)(
  "uses the final visible ID to break tied %s values",
  async sort => {
    const read = vi
      .spyOn(db, "getBookingsByUserId")
      .mockResolvedValue([row(7), row(6), row(5)]);
    const page = await caller.myBookingsPage({ limit: 2, sort });
    expect(page.items.map(r => r.id)).toEqual([7, 6]);
    expect(page.nextCursor).toEqual({
      id: 6,
      value: sort.startsWith("price") ? 350 : date.getTime(),
    });
    expect(read).toHaveBeenCalledWith(11, 5, { limit: 2, sort });
  }
);
it("looks up an exchanged booking using the authenticated account and tenant", async () => {
  const read = vi.spyOn(db, "getBookingsByUserId").mockResolvedValue([]);
  expect(await caller.myBookingsPage({ bookingId: 123, limit: 1 })).toEqual({
    items: [],
    nextCursor: null,
  });
  expect(read).toHaveBeenCalledWith(11, 5, {
    bookingId: 123,
    limit: 1,
    sort: "dateDesc",
  });
});
it("rejects excessive page sizes before reading", async () => {
  const read = vi.spyOn(db, "getBookingsByUserId");
  await expect(caller.myBookingsPage({ limit: 101 })).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  expect(read).not.toHaveBeenCalled();
});
