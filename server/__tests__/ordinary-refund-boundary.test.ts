import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";

const boundary = vi.hoisted(() => ({
  db: null as any,
  refundStatus: "pending",
  providerRefunds: [] as any[],
  refundCreate: vi.fn(),
  checkout: vi.fn(),
  beforeList: vi.fn(),
}));
vi.mock("../db", () => ({
  getDb: () => boundary.db,
  getBookingByIdWithDetails: async (bookingId: number) =>
    fixture.rows("bookings").find(row => row.id === bookingId),
}));
vi.mock("../stripe", () => ({
  stripe: {
    checkout: { sessions: { create: boundary.checkout } },
    refunds: {
      create: boundary.refundCreate,
      retrieve: async (id: string) =>
        boundary.providerRefunds.find(r => r.id === id),
      list: () => ({
        async *[Symbol.asyncIterator]() {
          await boundary.beforeList();
          for (const refund of boundary.providerRefunds) yield refund;
        },
      }),
    },
    charges: {
      retrieve: async () => ({
        id: "ch_original",
        amount: 10000,
        amount_refunded: boundary.providerRefunds
          .filter(r => r.status === "succeeded")
          .reduce((n, r) => n + r.amount, 0),
        currency: "sar",
      }),
    },
  },
}));
vi.mock("../services/email.service", () => ({
  sendRefundConfirmation: vi.fn(),
}));
vi.mock("../services/metrics.service", () => ({ trackRefundIssued: vi.fn() }));
vi.mock("../services/notification.service", () => ({
  notifyRefundProcessed: vi.fn(),
  createNotification: vi.fn(),
}));

import { sendRefundConfirmation } from "../services/email.service";
import { notifyRefundProcessed } from "../services/notification.service";
import { processStripeEvent } from "../webhooks/stripe";
import {
  createRefund,
  getCancellationQuote,
  isBookingRefundable,
} from "../services/refunds.service";
import {
  cancelBookingWithoutRefund,
  getZeroCancellationReceipt,
} from "../services/zero-refund-cancellation.service";
import {
  processPendingOrdinaryRefunds,
  processOrdinaryRefundCancellation,
} from "../services/ordinary-refund.service";
import { DepartureReleaseError } from "../services/booking-settlement.service";

let fixture: ReturnType<typeof transactionMemory>;
async function event(id: string, type: string, object: any) {
  await fixture.db.transaction((tx: any) =>
    processStripeEvent(tx, { id, type, data: { object } } as any)
  );
}
const now = new Date("2030-11-04T12:00:00Z");
function seed(bookingOverrides: any = {}, extra: any = {}) {
  fixture = transactionMemory({
    tenants: [{ id: 3, status: "active" }],
    users: [{ id: 9, tenantId: 3, role: "user" }],
    bookings: [
      {
        id: 7,
        userId: 9,
        tenantId: 3,
        flightId: 4,
        bookingReference: "AUDIT7",
        pnr: "AUDIT7",
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
    wallets: [
      { id: 1, userId: 9, balance: 0, status: "active", currency: "SAR" },
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
    payments: [
      {
        id: 1,
        bookingId: 7,
        stripePaymentIntentId: "pi_original",
        amount: 10000,
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
        status: "checked_in",
        checkInNonce: "old",
        boardingPassIssued: true,
      },
    ],
    ...extra,
  });
  boundary.db = fixture.db;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  boundary.beforeList.mockReset();
  boundary.refundStatus = "pending";
  boundary.providerRefunds = [];
  boundary.refundCreate.mockReset().mockImplementation(async (p: any) => {
    const refund = {
      id: "re_audit",
      status: boundary.refundStatus,
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

it("completes delayed fee-bearing cancellation after successful provider events", async () => {
  const result = await createRefund(
    { bookingId: 7, userId: 9 },
    { id: 9, role: "user" }
  );
  expect(result).toMatchObject({
    success: true,
    status: "pending",
    amount: 5000,
  });
  boundary.providerRefunds[0].status = "succeeded";
  await event(
    "evt_refund_updated",
    "refund.updated",
    boundary.providerRefunds[0]
  );
  await event("evt_charge_refunded", "charge.refunded", {
    id: "ch_original",
    payment_intent: "pi_original",
    amount: 10000,
    amount_refunded: 5000,
    currency: "sar",
  });
  expect(fixture.rows("payment_receipts")[0].refundedAmount).toBe(5000);
  expect(fixture.rows("bookings")[0]).toMatchObject({
    status: "cancelled",
    paymentStatus: "paid",
    seatsReserved: false,
  });
  expect(fixture.rows("ticket_coupons")[0].status).toBe("V");
  expect(fixture.rows("flights")[0].economyAvailable).toBe(5);
});

const cancel = () =>
  createRefund({ bookingId: 7, userId: 9 }, { id: 9, role: "user" });
const charge = (amount = 5000) =>
  event("evt_charge_" + amount, "charge.refunded", {
    id: "ch_original",
    payment_intent: "pi_original",
    amount: 10000,
    amount_refunded: amount,
    currency: "sar",
  });
const providerEvent = (status = "succeeded", id = "evt_" + status) => {
  boundary.providerRefunds[0].status = status;
  return event(
    id,
    status === "failed" ? "refund.failed" : "refund.updated",
    boundary.providerRefunds[0]
  );
};
function expectReleased() {
  expect(fixture.rows("bookings")[0]).toMatchObject({
    status: "cancelled",
    seatsReserved: false,
    checkedIn: false,
  });
  expect(fixture.rows("flights")[0].economyAvailable).toBe(5);
  expect(fixture.rows("seat_inventory")[0]).toMatchObject({
    status: "available",
    bookingId: null,
    passengerId: null,
    checkInNonce: null,
    boardingPassIssued: false,
  });
  expect(fixture.rows("passengers")[0].seatNumber).toBeNull();
  expect(
    fixture.rows("ordinary_booking_refunds")[0].completedAt
  ).toBeInstanceOf(Date);
}
it("waits for individual success when the charge aggregate precedes the pending refund, then releases exactly once", async () => {
  await cancel();
  await charge();
  expect(fixture.rows("payment_receipts")[0].refundedAmount).toBe(0);
  expect(fixture.rows("bookings")[0].status).toBe("confirmed");
  await providerEvent();
  await providerEvent("pending", "evt_late_pending");
  await providerEvent("succeeded", "evt_success_duplicate");
  await charge();
  expectReleased();
  expect(fixture.rows("ticket_coupons")[0].status).toBe("V");
  expect(fixture.rows("financial_ledger")).toHaveLength(1);
  expect(fixture.rows("booking_status_history")).toHaveLength(1);
  expect(
    fixture.rows("outbox").filter(r => r.eventType === "booking.cancelled")
  ).toHaveLength(1);
  expect(fixture.rows("ordinary_booking_refunds")[0]).toMatchObject({
    status: "succeeded",
    providerStatus: "succeeded",
  });
});
it("preserves immediate partial and delayed full cancellation outcomes", async () => {
  boundary.refundStatus = "succeeded";
  await cancel();
  expectReleased();
  expect(fixture.rows("ticket_coupons")[0].status).toBe("V");
  seed();
  boundary.providerRefunds = [];
  boundary.refundStatus = "pending";
  fixture.rows("flights")[0].departureTime = new Date("2030-11-20T12:00:00Z");
  expect(await cancel()).toMatchObject({ amount: 10000, status: "pending" });
  await providerEvent();
  await charge(10000);
  expectReleased();
  expect(fixture.rows("bookings")[0].paymentStatus).toBe("refunded");
  expect(fixture.rows("ticket_coupons")[0].status).toBe("R");
});
it("does not cancel a compensating partial refund without a saved cancellation", async () => {
  await charge();
  expect(fixture.rows("bookings")[0]).toMatchObject({
    status: "confirmed",
    seatsReserved: true,
    paymentStatus: "paid",
  });
  expect(fixture.rows("payment_receipts")[0].refundedAmount).toBe(5000);
  expect(fixture.rows("ticket_coupons")[0].status).toBe("O");
  expect(fixture.rows("flights")[0].economyAvailable).toBe(4);
});
it("keeps failed cancellations active and ignores an older pending event", async () => {
  await cancel();
  await providerEvent("failed");
  await providerEvent("pending");
  await charge();
  expect(fixture.rows("ordinary_booking_refunds")[0]).toMatchObject({
    status: "failed",
    providerStatus: "failed",
    errorCode: "provider_refund_failed",
  });
  expect(fixture.rows("bookings")[0]).toMatchObject({
    status: "confirmed",
    seatsReserved: true,
  });
  expect(fixture.rows("payment_receipts")[0].refundedAmount).toBe(0);
  expect(fixture.rows("financial_ledger")).toHaveLength(0);
});
it("finishes pending cancellations from the bounded worker when the webhook is missing", async () => {
  await cancel();
  boundary.providerRefunds[0].status = "succeeded";
  vi.setSystemTime(new Date(now.getTime() + 60_001));
  expect(await processPendingOrdinaryRefunds()).toEqual({
    scanned: 1,
    failed: 0,
  });
  expect(await processPendingOrdinaryRefunds()).toEqual({
    scanned: 0,
    failed: 0,
  });
  expectReleased();
  expect(boundary.refundCreate).toHaveBeenCalledTimes(1);
});
it("persists intent before provider handoff and recovers a lost response across a policy boundary without retrying money", async () => {
  boundary.refundCreate.mockImplementationOnce(async (p: any) => {
    expect(fixture.rows("ordinary_booking_refunds")[0]).toMatchObject({
      amount: 5000,
      status: "requesting",
      actorId: 9,
    });
    boundary.providerRefunds.push({
      id: "re_lost",
      status: "succeeded",
      amount: p.amount,
      currency: "sar",
      payment_intent: p.payment_intent,
      charge: "ch_original",
      metadata: p.metadata,
    });
    throw new Error("Provider response lost");
  });
  await expect(cancel()).rejects.toMatchObject({
    code: "INTERNAL_SERVER_ERROR",
  });
  vi.setSystemTime(new Date(now.getTime() + 25 * 3600_000));
  expect(await processPendingOrdinaryRefunds()).toEqual({
    scanned: 1,
    failed: 0,
  });
  expectReleased();
  expect(fixture.rows("payment_receipts")[0].refundedAmount).toBe(5000);
  expect(boundary.refundCreate).toHaveBeenCalledTimes(1);
});
it("quarantines an unknown old provider outcome instead of reissuing a refund", async () => {
  boundary.refundCreate.mockRejectedValueOnce(
    new Error("Provider outcome unknown")
  );
  await expect(cancel()).rejects.toMatchObject({
    code: "INTERNAL_SERVER_ERROR",
  });
  vi.setSystemTime(new Date(now.getTime() + 24 * 3600_000));
  expect(await processPendingOrdinaryRefunds()).toEqual({
    scanned: 1,
    failed: 1,
  });
  expect(fixture.rows("ordinary_booking_refunds")[0]).toMatchObject({
    status: "review_required",
    errorCode: "unknown_provider_outcome",
  });
  expect(boundary.refundCreate).toHaveBeenCalledTimes(1);
  expect(fixture.rows("bookings")[0].seatsReserved).toBe(true);
});
it("records succeeded money but preserves carriage for departure reconciliation after final DCS closure", async () => {
  await cancel();
  fixture.rows("flights")[0].dcsClosedAt = new Date();
  await providerEvent();
  await providerEvent("succeeded", "evt_duplicate_closed");
  expect(fixture.rows("payment_receipts")[0]).toMatchObject({
    refundedAmount: 5000,
    settlementStatus: "review_required",
    settlementError: DepartureReleaseError.reason,
  });
  expect(fixture.rows("ordinary_booking_refunds")[0]).toMatchObject({
    status: "review_required",
    providerStatus: "succeeded",
    errorCode: "cancellation_reconciliation_required",
  });
  expect(fixture.rows("bookings")[0]).toMatchObject({
    status: "confirmed",
    seatsReserved: true,
  });
  expect(fixture.rows("ticket_coupons")[0].status).toBe("O");
  expect(fixture.rows("flights")[0].economyAvailable).toBe(4);
  expect(fixture.rows("financial_ledger")).toHaveLength(1);
});
it("rolls back receipt, intent, entitlement and capacity together when the durable event fails, then replays safely", async () => {
  await cancel();
  fixture.failInsert("outbox");
  await expect(providerEvent()).rejects.toThrow("Injected insert failure");
  expect(fixture.rows("payment_receipts")[0].refundedAmount).toBe(0);
  expect(fixture.rows("ordinary_booking_refunds")[0].status).toBe("pending");
  expect(fixture.rows("bookings")[0].seatsReserved).toBe(true);
  expect(fixture.rows("ticket_coupons")[0].status).toBe("O");
  fixture.failInsert("");
  await providerEvent();
  expectReleased();
  expect(fixture.rows("financial_ledger")).toHaveLength(1);
});
it("requires exact provider identity and amount before closing the cancellation", async () => {
  await cancel();
  const wrong = {
    ...boundary.providerRefunds[0],
    amount: 4000,
    status: "succeeded",
  };
  await event("evt_wrong", "refund.updated", wrong);
  expect(fixture.rows("ordinary_booking_refunds")[0]).toMatchObject({
    status: "review_required",
    errorCode: "provider_refund_conflict",
  });
  expect(fixture.rows("payment_receipts")[0].refundedAmount).toBe(0);
  expect(fixture.rows("bookings")[0].seatsReserved).toBe(true);
});

it("flags contradictory failed-then-succeeded provider evidence for settlement review without silently completing carriage", async () => {
  await cancel();
  await providerEvent("failed");
  await providerEvent("succeeded");
  expect(fixture.rows("ordinary_booking_refunds")[0]).toMatchObject({
    status: "review_required",
    providerStatus: "succeeded",
    errorCode: "provider_terminal_conflict",
  });
  expect(fixture.rows("payment_receipts")[0]).toMatchObject({
    settlementStatus: "review_required",
  });
  expect(fixture.rows("bookings")[0].seatsReserved).toBe(true);
  expect(
    fixture
      .rows("outbox")
      .find(r => r.eventType === "payment.settlement_review_required").payload
  ).toMatchObject({
    reason: "provider_terminal_conflict",
    refundId: "re_audit",
    providerAmount: 5000,
    providerStatus: "succeeded",
  });
});
it.each([
  ["booking owner", "bookings", "userId", 55, "FORBIDDEN"],
  ["booking tenant", "bookings", "tenantId", 55, "FORBIDDEN"],
  [
    "booking lifecycle",
    "bookings",
    "status",
    "completed",
    "PRECONDITION_FAILED",
  ],
  [
    "booking funding",
    "bookings",
    "paymentStatus",
    "refunded",
    "PRECONDITION_FAILED",
  ],
  ["receipt owner", "payment_receipts", "userId", 55, "PRECONDITION_FAILED"],
  [
    "receipt purchase",
    "payment_receipts",
    "targetId",
    55,
    "PRECONDITION_FAILED",
  ],
] as const)(
  "rechecks %s under the reservation lock after preflight",
  async (_label, table, field, value, code) => {
    boundary.beforeList.mockImplementationOnce(() => {
      fixture.rows(table)[0][field] = value;
    });
    await expect(cancel()).rejects.toMatchObject({ code });
    expect(boundary.refundCreate).not.toHaveBeenCalled();
    expect(fixture.rows("ordinary_booking_refunds")).toHaveLength(0);
  }
);
it("can complete an adopted historical cancellation even when its money was already recorded", async () => {
  fixture.rows("payment_receipts")[0].refundedAmount = 5000;
  boundary.providerRefunds.push({
    id: "re_legacy",
    status: "succeeded",
    amount: 5000,
    currency: "sar",
    payment_intent: "pi_original",
    charge: "ch_original",
    metadata: {
      bookingId: "7",
      refundOperationId: "booking-7-cancel-pi_original",
    },
  });
  await cancel();
  expectReleased();
  expect(fixture.rows("financial_ledger")).toHaveLength(0);
  expect(boundary.refundCreate).not.toHaveBeenCalled();
});

it("quarantines an authenticated create response that does not match the saved command", async () => {
  boundary.refundCreate.mockResolvedValueOnce({
    id: "re_wrong_response",
    status: "succeeded",
    amount: 5000,
    currency: "sar",
    payment_intent: "pi_original",
    charge: "ch_original",
    metadata: { bookingId: "7", refundOperationId: "different-purpose" },
  });
  await expect(cancel()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(fixture.rows("ordinary_booking_refunds")[0]).toMatchObject({
    status: "review_required",
    errorCode: "provider_refund_conflict",
  });
  expect(fixture.rows("bookings")[0].seatsReserved).toBe(true);
  expect(fixture.rows("financial_ledger")).toHaveLength(0);
});

it("does not turn a nonrefundable fare into a time-based cash refund", async () => {
  seed(
    { fareClassId: 31 },
    {
      fare_classes: [
        { id: 31, airlineId: 2, code: "N", refundable: false, active: true },
      ],
    }
  );
  await expect(cancel()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  expect(boundary.refundCreate).not.toHaveBeenCalled();
  expect(fixture.rows("bookings")[0].status).toBe("confirmed");
});

function nonrefundable(extra: Record<string, any> = {}) {
  seed(
    { fareClassId: 31 },
    {
      fare_classes: [
        { id: 31, airlineId: 2, code: "N", refundable: false, active: true },
      ],
      flight_fare_class_inventory: [
        { id: 1, flightId: 4, fareClassId: 31, availableSeats: 4, capacity: 5 },
      ],
      booking_fare_components: [
        {
          id: 1,
          bookingId: 7,
          tenantId: 3,
          flightId: 4,
          componentType: "base_fare",
          amount: 10000,
          currency: "SAR",
        },
      ],
      seat_inventory: [
        {
          id: 1,
          flightId: 4,
          bookingId: 7,
          passengerId: 1,
          status: "occupied",
          checkInNonce: null,
          boardingPassIssued: false,
        },
      ],
      ...extra,
    }
  );
}
const confirmZero = (
  quoteHash: string,
  actor = { id: 9, role: "user", tenantId: 3 }
) =>
  cancelBookingWithoutRefund(
    {
      bookingId: 7,
      quoteHash,
      confirmNoRefund: true,
      reason: "requested_by_customer",
      notes: "No longer travelling",
    },
    actor
  );
it("quotes and records a nonrefundable cancellation, retaining paid cash truth and releasing resources with no provider refund", async () => {
  nonrefundable();
  expect(await isBookingRefundable(7)).toMatchObject({
    refundable: false,
    cancellable: true,
    requiresZeroRefundConfirmation: true,
  });
  const quote = await getCancellationQuote(7);
  expect(quote).toMatchObject({
    refundAmount: 0,
    cancellationFee: 10000,
    policyReason: "nonrefundable_fare",
  });
  const receipt = await confirmZero(quote.quoteHash);
  expect(receipt).toMatchObject({
    status: "cancelled_without_refund",
    totalAmount: 10000,
    cancellationFee: 10000,
    refundAmount: 0,
  });
  expectReleased();
  expect(fixture.rows("bookings")[0].paymentStatus).toBe("paid");
  expect(fixture.rows("payment_receipts")[0]).toMatchObject({
    amount: 10000,
    refundedAmount: 0,
    settlementStatus: "applied",
  });
  expect(fixture.rows("ticket_coupons")[0].status).toBe("V");
  expect(fixture.rows("ordinary_booking_refunds")[0]).toMatchObject({
    amount: 0,
    status: "succeeded",
    providerStatus: "not_required",
    refundId: null,
  });
  expect(fixture.rows("financial_ledger")).toHaveLength(0);
  expect(await processPendingOrdinaryRefunds()).toEqual({
    scanned: 0,
    failed: 0,
  });
  await expect(processOrdinaryRefundCancellation(7)).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
  });
  expect(boundary.refundCreate).not.toHaveBeenCalled();
  expect(boundary.beforeList).not.toHaveBeenCalled();
  expect(await confirmZero(quote.quoteHash)).toEqual(receipt);
  expect(
    await getZeroCancellationReceipt(7, { id: 9, role: "user", tenantId: 3 })
  ).toEqual(receipt);
  expect(fixture.rows("flights")[0].economyAvailable).toBe(5);
  expect(fixture.rows("flight_fare_class_inventory")[0].availableSeats).toBe(5);
  expect(fixture.rows("booking_status_history")).toHaveLength(1);
  expect(
    fixture
      .rows("outbox")
      .filter(r => r.eventType === "booking.cancelled_without_refund")
  ).toHaveLength(1);
});
it("requires explicit zero-refund consent and rejects a stale fare quote before cancellation", async () => {
  nonrefundable();
  const quote = await getCancellationQuote(7);
  await expect(
    cancelBookingWithoutRefund(
      {
        bookingId: 7,
        quoteHash: quote.quoteHash,
        confirmNoRefund: false,
        reason: "requested_by_customer",
      } as any,
      { id: 9, role: "user", tenantId: 3 }
    )
  ).rejects.toThrow();
  fixture.rows("fare_classes")[0].refundable = true;
  await expect(confirmZero(quote.quoteHash)).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
    message: expect.stringContaining("quote changed"),
  });
  expect(fixture.rows("bookings")[0].status).toBe("confirmed");
  expect(fixture.rows("ordinary_booking_refunds")).toHaveLength(0);
  expect(boundary.refundCreate).not.toHaveBeenCalled();
});
it("does not let the generic cancellation route bypass zero-refund consent", async () => {
  nonrefundable();
  const { cancelBooking } = await import("../services/bookings.service");
  await expect(cancelBooking(7, 9, 3)).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
    message: expect.stringContaining("explicitly confirm"),
  });
  expect(fixture.rows("bookings")[0].status).toBe("confirmed");
  expect(fixture.rows("ordinary_booking_refunds")).toHaveLength(0);
  expect(fixture.rows("flights")[0].economyAvailable).toBe(4);
  expect(boundary.refundCreate).not.toHaveBeenCalled();
});
it.each([
  ["tax", 1000],
  ["ancillary", 1000],
  ["booking_fee", 1000],
  ["unclassified", 10000],
] as const)(
  "does not treat separately recorded %s as a nonrefundable fare",
  async (componentType, amount) => {
    nonrefundable({
      booking_fare_components: [
        {
          id: 1,
          bookingId: 7,
          tenantId: 3,
          flightId: 4,
          componentType,
          amount,
          currency: "SAR",
        },
      ],
    });
    await expect(getCancellationQuote(7)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("taxes, fees or services"),
    });
    expect((await isBookingRefundable(7)).refundable).toBe(false);
    expect(boundary.refundCreate).not.toHaveBeenCalled();
  }
);
it.each([
  "departure",
  "checked_in",
  "flown",
  "service",
  "review",
  "owner",
  "tenant",
  "payment",
  "modification",
])(
  "refuses zero cancellation when %s eligibility changes after preview",
  async boundaryCase => {
    nonrefundable();
    const quote = await getCancellationQuote(7);
    if (boundaryCase === "departure")
      fixture.rows("flights")[0].dcsClosedAt = new Date();
    if (boundaryCase === "checked_in")
      fixture.rows("seat_inventory")[0].status = "checked_in";
    if (boundaryCase === "flown")
      fixture.rows("ticket_coupons")[0].status = "F";
    if (boundaryCase === "service") {
      await fixture.db
        .insert((await import("../../drizzle/schema")).bookingAncillaries)
        .values({ id: 1, bookingId: 7, totalPrice: 1000, status: "active" });
    }
    if (boundaryCase === "review")
      fixture.rows("payment_receipts")[0].settlementStatus = "review_required";
    if (boundaryCase === "owner") fixture.rows("bookings")[0].userId = 22;
    if (boundaryCase === "tenant") fixture.rows("bookings")[0].tenantId = 22;
    if (boundaryCase === "payment")
      fixture.rows("payment_receipts")[0].refundedAmount = 1;
    if (boundaryCase === "modification") {
      await fixture.db
        .insert((await import("../../drizzle/schema")).bookingModifications)
        .values({
          id: 1,
          bookingId: 7,
          status: "pending",
          checkoutRequestId: "request",
        });
    }
    await expect(confirmZero(quote.quoteHash)).rejects.toThrow();
    expect(fixture.rows("bookings")[0].status).toBe("confirmed");
    expect(fixture.rows("ordinary_booking_refunds")).toHaveLength(0);
    expect(boundary.refundCreate).not.toHaveBeenCalled();
  }
);
it("refuses zero cancellation while an original-payment refund is already pending", async () => {
  nonrefundable({
    ordinary_booking_refunds: [
      {
        bookingId: 7,
        amount: 5000,
        status: "pending",
        providerStatus: "pending",
        paymentIntentId: "pi_original",
      },
    ],
  });
  const quote = await getCancellationQuote(7);
  await expect(confirmZero(quote.quoteHash)).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
    message: expect.stringContaining("existing refund"),
  });
  expect(fixture.rows("bookings")[0].status).toBe("confirmed");
});
it("refuses zero cancellation for internal or mixed funding without manufacturing a refund", async () => {
  nonrefundable({ payment_receipts: [] });
  fixture.rows("bookings")[0].stripePaymentIntentId = null;
  const quote = await getCancellationQuote(7);
  await expect(confirmZero(quote.quoteHash)).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
    message: expect.stringContaining("internal or mixed funding"),
  });
  expect(fixture.rows("bookings")[0].status).toBe("confirmed");
  expect(fixture.rows("financial_ledger")).toHaveLength(0);
  expect(boundary.refundCreate).not.toHaveBeenCalled();
});
it("rolls back a zero cancellation and its receipt if its durable event cannot be recorded", async () => {
  nonrefundable();
  const quote = await getCancellationQuote(7);
  fixture.failInsert("outbox");
  await expect(confirmZero(quote.quoteHash)).rejects.toThrow(
    "Injected insert failure"
  );
  expect(fixture.rows("ordinary_booking_refunds")).toHaveLength(0);
  expect(fixture.rows("bookings")[0]).toMatchObject({
    status: "confirmed",
    paymentStatus: "paid",
    seatsReserved: true,
  });
  expect(fixture.rows("flights")[0].economyAvailable).toBe(4);
  expect(fixture.rows("ticket_coupons")[0].status).toBe("O");
});
it("honors an applicable nonRefundable cancellation penalty and excludes unrelated or expired rules", async () => {
  nonrefundable({
    fare_rules: [
      {
        id: 1,
        fareClassId: 31,
        airlineId: 2,
        ruleCategory: "penalties",
        active: true,
        validFrom: new Date("2030-01-01"),
        validUntil: null,
        conditions: JSON.stringify({
          penaltyType: "cancel",
          nonRefundable: true,
        }),
      },
    ],
  });
  fixture.rows("fare_classes")[0].refundable = true;
  expect(await getCancellationQuote(7)).toMatchObject({
    refundAmount: 0,
    policyReason: "nonrefundable_fare",
  });
  fixture.rows("fare_rules")[0].conditions = JSON.stringify({
    penaltyType: "change",
    nonRefundable: true,
  });
  expect((await getCancellationQuote(7)).refundAmount).toBe(5000);
  fixture.rows("fare_rules")[0].conditions = JSON.stringify({
    penaltyType: "cancel",
    nonRefundable: true,
  });
  fixture.rows("fare_rules")[0].validUntil = new Date("2030-01-02");
  expect((await getCancellationQuote(7)).refundAmount).toBe(5000);
});

it("does not retroactively apply a changed fare class to a previously booked fare", async () => {
  nonrefundable();
  fixture.rows("bookings")[0].createdAt = new Date("2030-10-01");
  fixture.rows("fare_classes")[0].updatedAt = new Date("2030-10-02");
  await expect(getCancellationQuote(7)).rejects.toMatchObject({
    code: "PRECONDITION_FAILED",
    message: expect.stringContaining("historical cancellation terms"),
  });
  expect(boundary.refundCreate).not.toHaveBeenCalled();
});
it("records a genuine rounded zero time-tier quote without manufacturing a one-cent refund", async () => {
  nonrefundable();
  fixture.rows("fare_classes")[0].refundable = true;
  fixture.rows("bookings")[0].totalAmount = 1;
  fixture.rows("payment_receipts")[0].amount = 1;
  fixture.rows("booking_fare_components")[0].amount = 1;
  const quote = await getCancellationQuote(7);
  expect(quote).toMatchObject({
    cancellationFee: 1,
    refundAmount: 0,
    policyReason: "time_based",
  });
  expect(await confirmZero(quote.quoteHash)).toMatchObject({
    totalAmount: 1,
    cancellationFee: 1,
    refundAmount: 0,
  });
  expect(fixture.rows("payment_receipts")[0].refundedAmount).toBe(0);
  expect(boundary.refundCreate).not.toHaveBeenCalled();
});

it.each(["pending", "failed", "requires_action"])(
  "never announces completion for provider %s",
  async status => {
    boundary.refundStatus = status;
    const result = await cancel();
    expect(result.status).toBe(status);
    expect(sendRefundConfirmation).not.toHaveBeenCalled();
    expect(notifyRefundProcessed).not.toHaveBeenCalled();
    expect(
      fixture
        .rows("outbox")
        .filter(r => r.eventType === "booking.ordinary_refund_completed")
    ).toHaveLength(0);
  }
);
it("records a durable completion once when an asynchronous refund succeeds", async () => {
  await cancel();
  boundary.providerRefunds[0].status = "succeeded";
  await event("evt_completed", "refund.updated", boundary.providerRefunds[0]);
  await event(
    "evt_completed_again",
    "refund.updated",
    boundary.providerRefunds[0]
  );
  const completed = fixture
    .rows("outbox")
    .filter(r => r.eventType === "booking.ordinary_refund_completed");
  expect(completed).toHaveLength(1);
  expect(completed[0].payload).toMatchObject({
    bookingId: 7,
    userId: 9,
    amount: 5000,
    refundId: "re_audit",
  });
});
