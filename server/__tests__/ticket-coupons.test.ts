import { beforeEach, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
const state = vi.hoisted(() => ({ db: undefined as any }));
vi.mock("../db", () => ({ getDb: () => state.db }));
vi.mock("../services/eticket.service", () => ({
  generateTicketNumber: () => "0010000000051",
}));
import { readTicketDocument } from "../services/ticket-documents.service";
import { checkInPassengers } from "../services/departure-control.service";
import { undoCheckIn } from "../services/seat-map.service";
import {
  closeLocalCoupons,
  setCouponCheckIn,
} from "../services/ticket-coupons.service";

let fixture: ReturnType<typeof transactionMemory>;
beforeEach(() => {
  fixture = transactionMemory({
    bookings: [
      {
        id: 2,
        userId: 3,
        tenantId: 1,
        status: "confirmed",
        cabinClass: "economy",
        paymentStatus: "paid",
        flightId: 4,
        totalAmount: 10000,
      },
    ],
    passengers: [{ id: 5, bookingId: 2, ticketNumber: null }],
    booking_segments: [
      {
        bookingId: 2,
        flightId: 4,
        segmentOrder: 1,
        seatsReserved: true,
        status: "confirmed",
      },
      {
        bookingId: 2,
        flightId: 8,
        segmentOrder: 2,
        seatsReserved: true,
        status: "confirmed",
      },
    ],
    flights: [4, 8].map(id => ({
      id,
      tenantId: 1,
      originId: 9,
      destinationId: 10,
      airlineId: 1,
      status: "scheduled",
      departureTime: new Date(Date.now() + 86400000),
    })),
    airports: [
      { id: 9, country: "SA" },
      { id: 10, country: "SA" },
    ],
    airlines: [{ id: 1 }],
    seat_inventory: [
      {
        id: 7,
        flightId: 4,
        cabinClass: "economy",
        seatNumber: "1A",
        status: "available",
        seatPrice: 0,
        bookingId: null,
        passengerId: null,
      },
      {
        id: 6,
        flightId: 8,
        bookingId: 2,
        passengerId: 5,
        status: "checked_in",
      },
    ],
  });
  state.db = fixture.db;
});

it("issues local coupons in itinerary order, supports legacy references and replays without duplicates", async () => {
  fixture.rows("passengers")[0].ticketNumber = "0010000000099";
  const issued = await readTicketDocument(2, 5, 3);
  expect(issued.legs.map(l => l.localCoupon)).toEqual([
    { number: 1, status: "O" },
    { number: 2, status: "C" },
  ]);
  await readTicketDocument(2, 5, 3);
  expect(
    fixture.rows("ticket_coupons").map(c => [c.ticketNumber, c.flightId])
  ).toEqual([
    ["0010000000099", 4],
    ["0010000000099", 8],
  ]);
});
it("rolls back local document identity and outbox if recording coupons fails", async () => {
  fixture.failInsert("ticket_coupons");
  await expect(readTicketDocument(2, 5, 3)).rejects.toThrow();
  expect(fixture.rows("passengers")[0].ticketNumber).toBeNull();
  expect(fixture.rows("outbox")).toEqual([]);
});
it("limits check-in and undo to the passenger and segment; void can progress to full refund", async () => {
  await readTicketDocument(2, 5, 3);
  await setCouponCheckIn(fixture.db, 2, 5, 4, true);
  await setCouponCheckIn(fixture.db, 2, 5, 8, false);
  await setCouponCheckIn(fixture.db, 2, 9, 4, false);
  expect(fixture.rows("ticket_coupons").map(c => c.status)).toEqual(["C", "O"]);
  await closeLocalCoupons(fixture.db, 2, "V");
  await closeLocalCoupons(fixture.db, 2, "R");
  await setCouponCheckIn(fixture.db, 2, 5, 4, true);
  expect(fixture.rows("ticket_coupons").map(c => c.status)).toEqual(["R", "R"]);
});

it("marks historical uplift unknown when no boarding evidence exists", async () => {
  fixture.rows("bookings")[0].status = "completed";
  for (const f of fixture.rows("flights")) f.status = "completed";
  const result = await readTicketDocument(2, 5, 3);
  expect(result.legs.map(l => l.localCoupon?.status)).toEqual([
    "unverified",
    "unverified",
  ]);
});

it("updates the issued coupon through passenger check-in and the seat-map undo command", async () => {
  await readTicketDocument(2, 5, 3);
  await checkInPassengers({
    bookingId: 2,
    flightId: 4,
    assignments: [{ passengerId: 5, seatNumber: "1A" }],
  });
  expect(fixture.rows("ticket_coupons")[0].status).toBe("C");
  await undoCheckIn(4, 2, 5);
  expect(fixture.rows("ticket_coupons")[0].status).toBe("O");
});
