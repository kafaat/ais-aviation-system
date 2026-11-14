import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "../__tests__/helpers/transaction-memory";

const boundary = vi.hoisted(() => ({
  db: null as any,
  bookings: () => [] as any[],
  providerRefunds: [] as any[],
  refundCreate: vi.fn(),
  trackBookingCancelled: vi.fn(),
}));
vi.mock("../db", () => ({
  getDb: () => boundary.db,
  getBookingByIdWithDetails: async (bookingId: number) =>
    boundary.bookings().find(row => row.id === bookingId),
}));
vi.mock("../stripe", () => ({
  stripe: {
    refunds: {
      create: boundary.refundCreate,
      retrieve: async (id: string) =>
        boundary.providerRefunds.find(r => r.id === id),
      list: () => ({
        async *[Symbol.asyncIterator]() {
          for (const refund of boundary.providerRefunds) yield refund;
        },
      }),
    },
  },
}));
vi.mock("./metrics.service", () => ({
  trackBookingStarted: vi.fn(),
  trackBookingCancelled: boundary.trackBookingCancelled,
  trackRefundIssued: vi.fn(),
}));

import { cancelBooking } from "./bookings.service";
import { quoteCancellationPolicy } from "./cancellation-policy.service";
import { createRefund } from "./refunds.service";

let fixture: ReturnType<typeof transactionMemory>;
function seed(bookingOverrides: Record<string, unknown> = {}) {
  fixture = transactionMemory({
    tenants: [{ id: 3, status: "active" }],
    users: [{ id: 9, tenantId: 3, role: "user" }],
    bookings: [
      {
        id: 7,
        userId: 9,
        tenantId: 3,
        flightId: 4,
        bookingReference: "CANCEL7",
        pnr: "CANCEL7",
        status: "confirmed",
        paymentStatus: "paid",
        totalAmount: 10000,
        cabinClass: "economy",
        numberOfPassengers: 1,
        seatsReserved: true,
        stripePaymentIntentId: "pi_original",
        checkedIn: false,
        ...bookingOverrides,
      },
    ],
    flights: [
      {
        id: 4,
        tenantId: 3,
        airlineId: 2,
        status: "scheduled",
        economyAvailable: 4,
        businessAvailable: 5,
        departureTime: new Date("2030-11-06T12:00:00Z"),
        dcsClosedAt: null,
      },
    ],
    payment_receipts: [
      {
        paymentIntentId: "pi_original",
        bookingId: 7,
        targetId: 7,
        userId: 9,
        kind: "booking",
        amount: 10000,
        refundedAmount: 0,
        currency: "SAR",
        settlementStatus: "applied",
      },
    ],
    ticket_coupons: [
      {
        id: 1,
        bookingId: 7,
        passengerId: 1,
        ticketNumber: "TICKET7",
        flightId: 4,
        couponNumber: 1,
        status: "O",
      },
    ],
    passengers: [{ id: 1, bookingId: 7, seatNumber: "12A" }],
  });
  boundary.db = fixture.db;
  boundary.bookings = () => fixture.rows("bookings");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2030-11-04T12:00:00Z"));
  boundary.providerRefunds = [];
  boundary.refundCreate.mockReset().mockImplementation(async (p: any) => {
    const refund = {
      id: "re_cancel",
      status: "pending",
      amount: p.amount,
      currency: "sar",
      payment_intent: p.payment_intent,
      charge: "ch_original",
      metadata: p.metadata,
    };
    boundary.providerRefunds.push(refund);
    return refund;
  });
  seed();
});
afterEach(() => vi.useRealTimers());

describe("bookings.cancel on a paid booking that is owed a refund", () => {
  it("refuses instead of cancelling without the quoted refund, and names the refund flow", async () => {
    const quote = await quoteCancellationPolicy(
      fixture.db,
      fixture.rows("bookings")[0]
    );
    expect(quote.refundAmount).toBe(5000);

    const refusal = await cancelBooking(7, 9, 3).catch(error => error);
    expect(refusal).toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(refusal.message).toContain("refunds.create");
    expect(refusal.message).toContain("refunds.cancelSplitBooking");

    expect(fixture.rows("bookings")[0]).toMatchObject({
      status: "confirmed",
      paymentStatus: "paid",
      seatsReserved: true,
    });
    expect(fixture.rows("flights")[0].economyAvailable).toBe(4);
    expect(fixture.rows("ticket_coupons")[0].status).toBe("O");
    expect(fixture.rows("ordinary_booking_refunds")).toHaveLength(0);
    expect(boundary.refundCreate).not.toHaveBeenCalled();
    expect(boundary.trackBookingCancelled).not.toHaveBeenCalled();
  });

  it("leaves the quoted refund obtainable through the ordinary refund flow", async () => {
    await cancelBooking(7, 9, 3).catch(() => undefined);

    const result = await createRefund(
      { bookingId: 7, userId: 9 },
      { id: 9, role: "user", tenantId: 3 }
    );

    expect(result).toMatchObject({ success: true, amount: 5000 });
    expect(boundary.refundCreate).toHaveBeenCalledTimes(1);
    expect(boundary.refundCreate.mock.calls[0][0]).toMatchObject({
      payment_intent: "pi_original",
      amount: 5000,
    });
    expect(fixture.rows("ordinary_booking_refunds")).toEqual([
      expect.objectContaining({ bookingId: 7, amount: 5000 }),
    ]);
  });

  it("refuses a paid booking whose status is still pending", async () => {
    seed({ status: "pending" });
    const quote = await quoteCancellationPolicy(
      fixture.db,
      fixture.rows("bookings")[0]
    );
    expect(quote.refundAmount).toBe(5000);

    const refusal = await cancelBooking(7, 9, 3).catch(error => error);
    expect(refusal).toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(refusal.message).toContain("refunds.create");
    expect(refusal.message).toContain("refunds.cancelSplitBooking");

    expect(fixture.rows("bookings")[0]).toMatchObject({
      status: "pending",
      paymentStatus: "paid",
      seatsReserved: true,
    });
    expect(fixture.rows("flights")[0].economyAvailable).toBe(4);
    expect(fixture.rows("ticket_coupons")[0].status).toBe("O");
    expect(boundary.refundCreate).not.toHaveBeenCalled();
    expect(boundary.trackBookingCancelled).not.toHaveBeenCalled();
  });

  it("reports final DCS closure before the refund refusal", async () => {
    fixture.rows("flights")[0].dcsClosedAt = new Date("2030-11-06T11:00:00Z");

    const refusal = await cancelBooking(7, 9, 3).catch(error => error);
    expect(refusal).toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(refusal.message).toMatch(/^Final DCS closure/);
    expect(refusal.message).not.toContain("refunds.create");
    expect(fixture.rows("bookings")[0]).toMatchObject({
      status: "confirmed",
      seatsReserved: true,
    });
    expect(boundary.refundCreate).not.toHaveBeenCalled();
  });

  it("decides on the locked booking row, not the earlier unlocked read", async () => {
    // Payment can settle between the first read and the row lock.
    const settled = fixture.rows("bookings")[0];
    boundary.bookings = () => [{ ...settled, paymentStatus: "pending" }];

    const refusal = await cancelBooking(7, 9, 3).catch(error => error);
    expect(refusal).toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(refusal.message).toContain("refunds.create");
    expect(fixture.rows("bookings")[0]).toMatchObject({
      status: "confirmed",
      paymentStatus: "paid",
      seatsReserved: true,
    });
    expect(boundary.refundCreate).not.toHaveBeenCalled();
  });

  it("still cancels an unpaid booking directly", async () => {
    seed({ paymentStatus: "pending", stripePaymentIntentId: null });
    fixture.rows("payment_receipts").splice(0);

    await expect(cancelBooking(7, 9, 3)).resolves.toEqual({ success: true });

    expect(fixture.rows("bookings")[0].status).toBe("cancelled");
    expect(boundary.refundCreate).not.toHaveBeenCalled();
  });
});
