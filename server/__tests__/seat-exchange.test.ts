import { beforeEach, describe, expect, it } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
import { insertInvoiceAncillary } from "../services/booking-invoice.service";
import { confirmFundedBooking } from "../services/booking-settlement.service";
import {
  quoteSeatExchange,
  removeInvoiceSeat,
  transferExchangeSeats,
} from "../services/seat-exchange.service";

const base = {
  id: 7,
  userId: 1,
  tenantId: 3,
  flightId: 10,
  bookingReference: "INVOICE7",
  cabinClass: "economy",
  numberOfPassengers: 1,
  totalAmount: 10000,
  status: "pending",
  paymentStatus: "pending",
  seatsReserved: false,
  checkedIn: false,
};
const seat = {
  seatNumber: "12A",
  row: 12,
  cabinClass: "economy",
  seatType: "window",
  priceTier: "extra_legroom",
  hasExtraLegroom: true,
  seatPrice: 2000,
  status: "available",
  bookingId: null,
  passengerId: null,
};
const request = {
  ancillaryServiceId: 8,
  passengerId: 33,
  flightId: 20,
  seatNumber: "12A",
  quantity: 1,
};
let db: ReturnType<typeof transactionMemory>;
const booking = () => db.rows("bookings")[0];

beforeEach(() => {
  db = transactionMemory({
    payment_receipts: [],
    bookings: [base],
    passengers: [{ id: 33, bookingId: 7, tenantId: 3 }],
    booking_segments: [
      {
        id: 101,
        bookingId: 7,
        segmentOrder: 1,
        flightId: 10,
        segmentAmount: 5000,
        status: "pending",
        seatsReserved: false,
      },
      {
        id: 102,
        bookingId: 7,
        segmentOrder: 2,
        flightId: 20,
        segmentAmount: 5000,
        status: "pending",
        seatsReserved: false,
      },
    ],
    flights: [10, 20, 30].map(id => ({
      id,
      tenantId: 3,
      airlineId: 1,
      status: "scheduled",
      economyAvailable: 4,
      departureTime: new Date(Date.now() + 86400000),
    })),
    ancillary_services: [
      {
        id: 8,
        code: "SEAT_EXTRA_LEG",
        category: "seat",
        available: true,
        price: 2000,
        currency: "SAR",
        applicableAirlines: null,
        applicableCabinClasses: null,
      },
    ],
    seat_inventory: [
      { ...seat, id: 200, flightId: 20 },
      { ...seat, id: 300, flightId: 30 },
    ],
  });
});
async function buy() {
  await db.db.transaction((tx: any) =>
    insertInvoiceAncillary(tx, booking(), request)
  );
}
async function fund() {
  await db.db.transaction((tx: any) => confirmFundedBooking(tx, booking()));
}
const quote = () =>
  quoteSeatExchange(db.db, booking(), [10, 20], [10, 30], "economy");
describe("sector paid-seat contract", () => {
  it("preserves a funded fee through a same-seat exchange without writing a second charge", async () => {
    await buy();
    expect(db.rows("booking_segments").map(s => s.segmentAmount)).toEqual([
      5000, 7000,
    ]);
    expect(booking().totalAmount).toBe(12000);
    expect(db.rows("seat_inventory")[0].status).toBe("held");
    await expect(quote()).rejects.toThrow("must be reconciled");
    await fund();
    const q = await quote();
    expect(q.retainedAmount).toBe(2000);
    expect(q.seats).toMatchObject([
      { fromSeatId: 200, toSeatId: 300, amount: 2000 },
    ]);
    await db.db.transaction((tx: any) =>
      transferExchangeSeats(tx, booking(), q)
    );
    expect(db.rows("seat_inventory").map(s => s.status)).toEqual([
      "available",
      "occupied",
    ]);
    expect(db.rows("booking_ancillaries")).toHaveLength(1);
    expect(db.rows("booking_ancillaries")[0]).toMatchObject({
      totalPrice: 2000,
      segmentId: 102,
      passengerId: 33,
    });
    expect(booking().totalAmount).toBe(12000);
  });
  it("rejects a weaker replacement, price mismatch or lost funding receipt before any mutation", async () => {
    await buy();
    await fund();
    const target = db.rows("seat_inventory")[1];
    target.seatPrice = 2500;
    await expect(quote()).rejects.toThrow("Equivalent paid seat unavailable");
    target.seatPrice = 2000;
    target.hasExtraLegroom = false;
    await expect(quote()).rejects.toThrow("Equivalent paid seat unavailable");
    target.hasExtraLegroom = true;
    db.rows("outbox").splice(0);
    await expect(quote()).rejects.toThrow("needs reconciliation");
    expect(db.rows("seat_inventory").map(s => s.status)).toEqual([
      "occupied",
      "available",
    ]);
  });
  it("requires manual attribution after a booking-level refund", async () => {
    await buy();
    await fund();
    db.rows("payment_receipts").push({
      paymentIntentId: "pi-7",
      kind: "booking",
      bookingId: 7,
      refundedAmount: 2000,
    });
    await expect(quote()).rejects.toThrow("after a booking refund");
    expect(db.rows("seat_inventory").map(s => s.status)).toEqual([
      "occupied",
      "available",
    ]);
  });
  it("rolls back a transfer when the quoted replacement is taken", async () => {
    await buy();
    await fund();
    const plan = await quote();
    Object.assign(db.rows("seat_inventory")[1], {
      status: "occupied",
      bookingId: 999,
      passengerId: 444,
    });
    await expect(
      db.db.transaction((tx: any) => transferExchangeSeats(tx, booking(), plan))
    ).rejects.toThrow("no longer available");
    expect(db.rows("seat_inventory")[0]).toMatchObject({
      bookingId: 7,
      passengerId: 33,
      status: "occupied",
    });
    expect(db.rows("booking_ancillaries")[0]).toMatchObject({
      status: "active",
      totalPrice: 2000,
    });
  });
  it("allows removing an expired unpaid fee without releasing the new occupant's seat", async () => {
    await buy();
    const reassigned = db.rows("seat_inventory")[0];
    Object.assign(reassigned, {
      status: "occupied",
      passengerId: 23,
      bookingId: 55,
    });
    const item = db.rows("booking_ancillaries")[0];
    expect(await removeInvoiceSeat(db.db, item)).toBe(102);
    expect(reassigned).toMatchObject({
      status: "occupied",
      passengerId: 23,
      bookingId: 55,
    });
  });
  it("rejects a pre-existing claim and releases an unpaid seat only while holding its owning invoice", async () => {
    await buy();
    await expect(buy()).rejects.toThrow("already has a seat");
    expect(db.rows("booking_ancillaries")).toHaveLength(1);
    expect(
      await removeInvoiceSeat(db.db, db.rows("booking_ancillaries")[0])
    ).toBe(102);
    expect(db.rows("seat_inventory")[0].status).toBe("available");
  });
});
