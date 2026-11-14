import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "../__tests__/helpers/transaction-memory";

// An order-servicing downgrade lowers bookings.totalAmount to the new fare and
// refunds the difference on the original payment intent. The cancellation cap
// must not subtract that exchange refund a second time.
const provider = vi.hoisted(() => ({
  db: null as any,
  refunds: [] as any[],
  create: vi.fn(),
}));
vi.mock("../db", () => ({ getDb: () => provider.db }));
vi.mock("../stripe", () => ({
  stripe: {
    refunds: {
      create: provider.create,
      retrieve: async (id: string) => provider.refunds.find(r => r.id === id),
      list: () => ({
        async *[Symbol.asyncIterator]() {
          for (const refund of provider.refunds) yield refund;
        },
      }),
    },
  },
}));
vi.mock("./email.service", () => ({ sendRefundConfirmation: vi.fn() }));
vi.mock("./metrics.service", () => ({ trackRefundIssued: vi.fn() }));
vi.mock("./notification.service", () => ({
  notifyRefundProcessed: vi.fn(),
  createNotification: vi.fn(),
}));

import { createRefund, isBookingRefundable } from "./refunds.service";
import { recordVerifiedOrdinaryRefund } from "./ordinary-refund.service";

let fixture: ReturnType<typeof transactionMemory>;
const now = new Date("2030-11-04T12:00:00Z");
// Sixteen days before departure: the 100% ("full") cancellation tier.
const departureTime = new Date("2030-11-20T12:00:00Z");

function providerRefund(
  id: string,
  amount: number,
  metadata: Record<string, string> = {}
) {
  return {
    id,
    amount,
    status: "succeeded",
    currency: "sar",
    payment_intent: "pi_original",
    charge: "ch_original",
    metadata,
  };
}

/**
 * collected: captured on pi_original (the booking receipt).
 * totalAmount: the invoice after servicing.
 * exchangeRefund: the downgrade difference refunded on pi_original.
 * otherRefund: an unrelated refund on pi_original (no cancellation purpose).
 */
function seed(options: {
  collected: number;
  totalAmount: number;
  exchangeRefund?: number;
  otherRefund?: number;
  receipt?: boolean;
  extra?: Record<string, any[]>;
}) {
  const exchangeRefund = options.exchangeRefund ?? 0;
  const otherRefund = options.otherRefund ?? 0;
  provider.refunds = [];
  if (exchangeRefund)
    provider.refunds.push(
      providerRefund("re_exchange", exchangeRefund, {
        orderServiceRefundId: "osr_downgrade",
      })
    );
  if (otherRefund)
    provider.refunds.push(providerRefund("re_other", otherRefund));
  fixture = transactionMemory({
    tenants: [{ id: 3, status: "active" }],
    users: [{ id: 9, tenantId: 3, role: "user" }],
    bookings: [
      {
        id: 7,
        userId: 9,
        tenantId: 3,
        flightId: 4,
        bookingReference: "DOWN07",
        pnr: "DOWN07",
        status: "confirmed",
        paymentStatus: "paid",
        totalAmount: options.totalAmount,
        cabinClass: "economy",
        numberOfPassengers: 1,
        seatsReserved: true,
        stripePaymentIntentId: "pi_original",
        checkedIn: false,
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
        departureTime,
        dcsClosedAt: null,
      },
    ],
    payment_receipts:
      options.receipt === false
        ? []
        : [
            {
              paymentIntentId: "pi_original",
              bookingId: 7,
              targetId: 7,
              userId: 9,
              kind: "booking",
              amount: options.collected,
              refundedAmount: exchangeRefund + otherRefund,
              currency: "SAR",
              settlementStatus: "applied",
            },
          ],
    order_service_refunds: exchangeRefund
      ? [
          {
            id: "osr_downgrade",
            bookingId: 7,
            modificationId: 1,
            cancellationFlightId: null,
            paymentIntentId: "pi_original",
            amount: exchangeRefund,
            baseRefundedAmount: 0,
            refundId: "re_exchange",
            status: "succeeded",
          },
        ]
      : [],
    payments: [
      {
        id: 1,
        bookingId: 7,
        stripePaymentIntentId: "pi_original",
        amount: options.collected,
        status: "completed",
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
    seat_inventory: [
      {
        id: 1,
        flightId: 4,
        bookingId: 7,
        passengerId: 1,
        status: "occupied",
        boardingPassIssued: false,
      },
    ],
    ...options.extra,
  });
  provider.db = fixture.db;
}

const owner = { id: 9, role: "user", tenantId: 3 };
const admin = { id: 1, role: "admin" };
const cancel = () => createRefund({ bookingId: 7, userId: 9 }, owner);
const override = (amount: number) =>
  createRefund({ bookingId: 7, userId: 9, amount }, admin);

function expectNoMoneyMoved() {
  expect(provider.create).not.toHaveBeenCalled();
  expect(fixture.rows("ordinary_booking_refunds")).toHaveLength(0);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  provider.create.mockReset().mockImplementation(async (params: any) => {
    const refund = {
      ...providerRefund("re_cancel", params.amount, params.metadata),
      status: "pending",
      payment_intent: params.payment_intent,
    };
    provider.refunds.push(refund);
    return refund;
  });
});
afterEach(() => vi.useRealTimers());

describe("cancellation refund cap after a downgrade exchange", () => {
  it("accepts the full-tier refund of the downgraded fare and completes it through the ordinary cancellation flow", async () => {
    seed({ collected: 100000, totalAmount: 80000, exchangeRefund: 20000 });

    const result = await cancel();

    expect(result).toMatchObject({
      success: true,
      refundId: "re_cancel",
      amount: 80000,
      status: "pending",
      cumulativeRefundedAmount: 100000,
      remainingRefundableAmount: 0,
    });
    expect(provider.create).toHaveBeenCalledTimes(1);
    expect(provider.create).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_intent: "pi_original",
        amount: 80000,
        metadata: {
          bookingId: "7",
          refundOperationId: "booking-7-cancel-pi_original",
        },
      }),
      { idempotencyKey: "booking-7-cancel-pi_original" }
    );
    expect(fixture.rows("ordinary_booking_refunds")).toEqual([
      expect.objectContaining({
        bookingId: 7,
        paymentIntentId: "pi_original",
        amount: 80000,
        collectedAmount: 100000,
        baseRefundedAmount: 20000,
        status: "pending",
      }),
    ]);

    const cancellation = provider.refunds.find(r => r.id === "re_cancel");
    cancellation.status = "succeeded";
    await fixture.db.transaction((tx: any) =>
      recordVerifiedOrdinaryRefund(tx, cancellation, "evt_cancel_succeeded")
    );
    expect(fixture.rows("ordinary_booking_refunds")[0]).toMatchObject({
      status: "succeeded",
      refundId: "re_cancel",
    });
    expect(fixture.rows("payment_receipts")[0].refundedAmount).toBe(100000);
    expect(fixture.rows("bookings")[0]).toMatchObject({
      status: "cancelled",
      paymentStatus: "refunded",
      seatsReserved: false,
    });
  });

  it("accepts the remaining fare instead of reporting a full refund when the exchange refund exceeds the new fare", async () => {
    seed({ collected: 1000, totalAmount: 400, exchangeRefund: 600 });

    const result = await cancel();

    expect(result).toMatchObject({
      success: true,
      amount: 400,
      cumulativeRefundedAmount: 1000,
      remainingRefundableAmount: 0,
    });
    expect(provider.create).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_original", amount: 400 }),
      { idempotencyKey: "booking-7-cancel-pi_original" }
    );
    expect(fixture.rows("ordinary_booking_refunds")[0]).toMatchObject({
      amount: 400,
      collectedAmount: 1000,
      baseRefundedAmount: 600,
    });
  });

  it("reports the downgraded booking as refundable while the original intent still holds the new fare", async () => {
    seed({ collected: 1000, totalAmount: 400, exchangeRefund: 600 });

    expect(await isBookingRefundable(7)).toEqual({ refundable: true });
    expect(provider.create).not.toHaveBeenCalled();
  });

  it("lets an administrator refund up to what the original intent still holds after a downgrade", async () => {
    seed({ collected: 1000, totalAmount: 400, exchangeRefund: 600 });

    const result = await override(400);

    expect(result).toMatchObject({ success: true, amount: 400 });
    expect(fixture.rows("ordinary_booking_refunds")[0]).toMatchObject({
      amount: 400,
      collectedAmount: 1000,
      baseRefundedAmount: 600,
    });
  });

  it("reports the held balance, not the invoice balance, after a partial cancellation of a downgraded booking", async () => {
    seed({ collected: 1000, totalAmount: 800, exchangeRefund: 200 });
    // Five days before departure: the 75% tier refunds 600 of the 800 fare.
    vi.setSystemTime(new Date("2030-11-15T12:00:00Z"));

    const result = await cancel();

    expect(result).toMatchObject({
      amount: 600,
      cumulativeRefundedAmount: 800,
      // pi_original collected 1000 and has returned 800 so far.
      remainingRefundableAmount: 200,
    });
  });
});

describe("controls: caps that do not depend on the exchange refund", () => {
  it("control: a booking with no exchange keeps the invoice cap exactly", async () => {
    seed({ collected: 10000, totalAmount: 10000, otherRefund: 3000 });

    await expect(cancel()).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message:
        "Refund amount exceeds the remaining refundable balance of 7000 cents",
    });
    await expect(override(7001)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message:
        "Refund amount exceeds the remaining refundable balance of 7000 cents",
    });
    expectNoMoneyMoved();

    await expect(override(7000)).resolves.toMatchObject({
      success: true,
      amount: 7000,
      cumulativeRefundedAmount: 10000,
      remainingRefundableAmount: 0,
    });
  });

  it("control: a refund larger than what the original intent still holds is refused", async () => {
    // Held on pi_original: 1000 - 200 (exchange) - 300 (other) = 500.
    seed({
      collected: 1000,
      totalAmount: 800,
      exchangeRefund: 200,
      otherRefund: 300,
    });

    await expect(cancel()).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining(
        "exceeds the remaining refundable balance"
      ),
    });
    await expect(override(501)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expectNoMoneyMoved();
  });

  it.each([
    [
      "after a downgrade",
      {
        collected: 1000,
        totalAmount: 400,
        exchangeRefund: 600,
        otherRefund: 400,
      },
    ],
    [
      "without an exchange",
      { collected: 10000, totalAmount: 10000, otherRefund: 10000 },
    ],
  ])(
    "control: a fully refunded booking is refused %s",
    async (_label, options) => {
      seed(options);

      await expect(cancel()).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Booking payment has already been fully refunded",
      });
      await expect(override(1)).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "Booking payment has already been fully refunded",
      });
      expect(await isBookingRefundable(7)).toEqual({
        refundable: false,
        reason: "Booking is already fully refunded",
      });
      expectNoMoneyMoved();
    }
  );

  it("control: a legacy booking without a receipt keeps the invoice formula for refundability", async () => {
    seed({
      collected: 1000,
      totalAmount: 400,
      exchangeRefund: 600,
      receipt: false,
    });

    expect(await isBookingRefundable(7)).toEqual({
      refundable: false,
      reason: "Booking is already fully refunded",
    });
    await expect(cancel()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("not reconciled"),
    });
    expectNoMoneyMoved();
  });

  it("control: an upgrade collected on a second intent keeps today's behavior", async () => {
    // 800 collected on pi_original, 200 on the modification intent; the full
    // tier quotes 1000 against the invoice and pi_original cannot return it.
    seed({
      collected: 800,
      totalAmount: 1000,
      extra: {
        payment_receipts: [
          {
            paymentIntentId: "pi_original",
            bookingId: 7,
            targetId: 7,
            userId: 9,
            kind: "booking",
            amount: 800,
            refundedAmount: 0,
            currency: "SAR",
            settlementStatus: "applied",
          },
          {
            paymentIntentId: "pi_upgrade",
            bookingId: 7,
            targetId: 1,
            userId: 9,
            kind: "modification",
            amount: 200,
            refundedAmount: 0,
            currency: "SAR",
            settlementStatus: "applied",
          },
        ],
      },
    });

    expect(await isBookingRefundable(7)).toEqual({ refundable: true });
    await expect(cancel()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Refund does not match the original collected balance",
    });
    expectNoMoneyMoved();
  });
});
