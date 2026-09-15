import { beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
const boundary = vi.hoisted(() => ({
  db: null as any,
  getFlight: vi.fn(),
  checkout: vi.fn(),
  refundCreate: vi.fn(),
  refundList: vi.fn(),
}));
vi.mock("../db", () => ({
  getDb: () => boundary.db,
  getFlightById: boundary.getFlight,
}));
vi.mock("../stripe", () => ({
  stripe: {
    checkout: { sessions: { create: boundary.checkout } },
    refunds: { create: boundary.refundCreate, list: boundary.refundList },
  },
}));
vi.mock("../services/flights.service", () => ({
  calculateFlightPrice: async (f: any) => ({ price: f.economyPrice }),
}));
import { createRetailOffer } from "../services/retail-offer.service";
import {
  quotePaidOrderService,
  confirmNoChargeService,
} from "../services/order-servicing.service";
import {
  createOrderServiceCheckout,
  cancelOrderServiceQuote,
} from "../services/order-service-checkout.service";
import { settleVerifiedPayment } from "../services/payment-settlement.service";
import { processPendingOrderRefunds } from "../services/order-refunds.service";
import { requestChangeFlightDate } from "../services/booking-modification.service";
let fixture: ReturnType<typeof transactionMemory>;
const at = (h: number) => new Date(Date.now() + (240 + h) * 3600000);
beforeEach(() => {
  fixture = transactionMemory({
    tenants: [{ id: 3, status: "active" }],
    bookings: [
      {
        id: 7,
        userId: 1,
        tenantId: 3,
        flightId: 11,
        cabinClass: "economy",
        totalAmount: 10000,
        numberOfPassengers: 1,
        status: "confirmed",
        paymentStatus: "paid",
        seatsReserved: true,
        checkedIn: false,
      },
    ],
    passengers: [
      {
        id: 1,
        bookingId: 7,
        tenantId: 3,
        type: "adult",
        firstName: "Ali",
        lastName: "Test",
        seatNumber: null,
      },
    ],
    booking_segments: [
      {
        id: 21,
        bookingId: 7,
        segmentOrder: 1,
        flightId: 11,
        segmentAmount: 10000,
        seatsReserved: true,
        status: "confirmed",
      },
    ],
    ancillary_services: [
      {
        id: 41,
        code: "BAG_10KG",
        category: "baggage",
        name: "10kg Checked Baggage",
        price: 5000,
        currency: "SAR",
        available: true,
        weightGrams: 10000,
      },
      {
        id: 42,
        code: "BAG_SERVICE_RECOVERY",
        category: "baggage",
        name: "Recovery baggage allowance",
        price: 0,
        currency: "SAR",
        available: true,
        weightGrams: 5000,
      },
    ],
    flights: [
      {
        id: 11,
        originId: 1,
        destinationId: 3,
        departureTime: at(0),
        arrivalTime: at(2),
        economyPrice: 10000,
      },
      {
        id: 12,
        originId: 1,
        destinationId: 2,
        departureTime: at(3),
        arrivalTime: at(5),
        economyPrice: 6000,
      },
      {
        id: 13,
        originId: 2,
        destinationId: 3,
        departureTime: at(7),
        arrivalTime: at(9),
        economyPrice: 7000,
      },
    ].map(f => ({
      ...f,
      tenantId: 3,
      airlineId: 1,
      status: "scheduled",
      economyAvailable: 5,
      businessAvailable: 5,
      flightNumber: `AI${f.id}`,
      aircraftType: "A320",
    })),
    payment_receipts: [
      {
        paymentIntentId: "pi_original",
        bookingId: 7,
        targetId: 7,
        userId: 1,
        kind: "booking",
        amount: 10000,
        refundedAmount: 0,
        currency: "SAR",
        settlementStatus: "applied",
      },
    ],
    ndc_orders: [
      {
        id: 1,
        bookingId: 7,
        orderId: "ORDER-7",
        airlineId: 1,
        status: "confirmed",
        totalAmount: 10000,
        orderPayload: "{}",
      },
    ],
  });
  boundary.db = fixture.db;
  boundary.getFlight.mockImplementation(async (id: number) => {
    const f = fixture.rows("flights").find(f => f.id === id);
    return f
      ? {
          ...f,
          airline: { code: "AI", name: "Test" },
          origin: {
            id: f.originId,
            code: `A${f.originId}`,
            name: "Airport",
            city: "City",
            country: "SA",
          },
          destination: {
            id: f.destinationId,
            code: `A${f.destinationId}`,
            name: "Airport",
            city: "City",
            country: "SA",
          },
        }
      : null;
  });
  boundary.checkout.mockReset().mockResolvedValue({
    id: "cs_mod",
    url: "https://checkout.stripe.com/test",
  });
  boundary.refundList
    .mockReset()
    .mockImplementation(() => ({ async *[Symbol.asyncIterator]() {} }));
  boundary.refundCreate.mockReset().mockImplementation(async (p: any) => ({
    id: "re_mod",
    status: "succeeded",
    amount: p.amount,
    currency: "sar",
    payment_intent: p.payment_intent,
    charge: "ch_original",
    metadata: p.metadata,
  }));
});
async function offer(id: number) {
  return createRetailOffer({
    flightId: id,
    cabinClass: "economy",
    passengerTypes: ["adult"],
    userId: 1,
    channel: "direct",
  });
}
async function payment(modificationId: number, amount: number) {
  const change = fixture
    .rows("booking_modifications")
    .find(c => c.id === modificationId);
  await fixture.db.transaction((tx: any) =>
    settleVerifiedPayment(tx, {
      paymentIntentId: "pi_mod",
      amount,
      currency: "SAR",
      eventId: "evt_mod",
      metadata: {
        type: "modification",
        bookingId: "7",
        modificationId: String(modificationId),
        userId: "1",
        checkoutRequestId: change.checkoutRequestId,
      },
    })
  );
}
describe("paid order servicing", () => {
  it("funds an explicitly scoped baggage snapshot only after collection", async () => {
    const quote = await quotePaidOrderService(
      {
        bookingId: 7,
        idempotencyKey: "baggage-paid-1",
        ancillaries: [
          {
            ancillaryServiceId: 41,
            passengerId: 1,
            flightId: 11,
            quantity: 1,
          },
        ],
      },
      1,
      3
    );
    expect(fixture.rows("booking_ancillaries")).toHaveLength(0);
    await createOrderServiceCheckout(
      quote.modificationId,
      1,
      "https://ais.example"
    );
    await payment(quote.modificationId, 5000);
    expect(fixture.rows("booking_ancillaries")[0]).toMatchObject({
      passengerId: 1,
      segmentId: 21,
      scopeState: "specific_segment",
      weightSnapshotGrams: 10000,
      fundingReference: {
        kind: "collected_modification",
        modificationId: quote.modificationId,
        paymentIntentId: "pi_mod",
      },
    });
    expect(fixture.rows("booking_ancillaries")[0].fundedAt).toBeInstanceOf(
      Date
    );
  });

  it("records an explicit no-charge authority without a payment receipt", async () => {
    const quote = await quotePaidOrderService(
      {
        bookingId: 7,
        idempotencyKey: "baggage-no-charge-1",
        ancillaries: [
          {
            ancillaryServiceId: 42,
            passengerId: 1,
            flightId: 11,
            quantity: 1,
          },
        ],
      },
      1,
      3
    );
    await confirmNoChargeService(quote.modificationId, 1);
    expect(fixture.rows("booking_ancillaries")[0]).toMatchObject({
      weightSnapshotGrams: 5000,
      segmentId: 21,
      scopeState: "specific_segment",
      fundingReference: {
        kind: "authorized_no_charge",
        modificationId: quote.modificationId,
      },
    });
  });

  it("uses the same quote for the existing date-change screen and retries", async () => {
    fixture.rows("flights")[1].destinationId = 3;
    fixture.rows("flights")[0].departureTime = new Date(
      Date.now() + 48 * 3600000
    );
    const input = {
      bookingId: 7,
      userId: 1,
      newFlightId: 12,
      idempotencyKey: "screen-retry-1",
    };
    const quote = await requestChangeFlightDate(input);
    expect(quote).toMatchObject({
      modificationFee: 1000,
      newAmount: 7000,
      totalCost: -3000,
      refundDue: 3000,
    });
    expect(await requestChangeFlightDate(input)).toEqual(quote);
    expect(fixture.rows("booking_modifications")).toHaveLength(1);
  });
  it("allocates a fare reduction to both original split payers", async () => {
    fixture.rows("flights")[1].destinationId = 3;
    fixture.rows("payment_receipts").splice(
      0,
      1,
      ...[3000, 7000].map((amount, i) => ({
        paymentIntentId: `pi_split_${i}`,
        bookingId: 7,
        userId: i + 1,
        targetId: i + 1,
        kind: "split_payment",
        amount,
        refundedAmount: 0,
        currency: "SAR",
        settlementStatus: "applied",
      }))
    );
    const a = await offer(12);
    const quote = await quotePaidOrderService(
      { bookingId: 7, offerIds: [a.id], idempotencyKey: "split-refund-1" },
      1,
      3
    );
    await confirmNoChargeService(quote.modificationId, 1);
    expect(fixture.rows("order_service_refunds").map(r => r.amount)).toEqual([
      1200, 2800,
    ]);
    expect(fixture.rows("financial_ledger")).toHaveLength(0);
  });
  it("exchanges all legs only after verified payment and replays once", async () => {
    const offers = await Promise.all([offer(12), offer(13)]);
    const input = {
      bookingId: 7,
      offerIds: offers.map(o => o.id),
      idempotencyKey: "paid-test-1",
    };
    const quote = await quotePaidOrderService(input, 1, 3);
    expect(await quotePaidOrderService(input, 1, 3)).toEqual(quote);
    expect(quote.totalCost).toBe(3000);
    expect(fixture.rows("bookings")[0].flightId).toBe(11);
    const checkout = await createOrderServiceCheckout(
      quote.modificationId,
      1,
      "https://ais.example"
    );
    expect(
      await createOrderServiceCheckout(
        quote.modificationId,
        1,
        "https://ais.example"
      )
    ).toEqual(checkout);
    expect(boundary.checkout).toHaveBeenCalledTimes(1);
    await payment(quote.modificationId, 3000);
    await payment(quote.modificationId, 3000);
    expect(fixture.rows("booking_segments").map(s => s.flightId)).toEqual([
      12, 13,
    ]);
    expect(fixture.rows("booking_segments").every(s => s.seatsReserved)).toBe(
      true
    );
    expect(fixture.rows("flights").map(f => f.economyAvailable)).toEqual([
      6, 4, 4,
    ]);
    expect(fixture.rows("bookings")[0].totalAmount).toBe(13000);
    expect(fixture.rows("ndc_orders")[0].totalAmount).toBe(13000);
    expect(fixture.rows("financial_ledger")).toHaveLength(1);
  });
  it("retains a late collected payment for review without moving inventory", async () => {
    const a = await offer(12),
      b = await offer(13);
    const quote = await quotePaidOrderService(
      { bookingId: 7, offerIds: [a.id, b.id], idempotencyKey: "late-test-1" },
      1,
      3
    );
    await createOrderServiceCheckout(
      quote.modificationId,
      1,
      "https://ais.example"
    );
    fixture.rows("inventory_locks")[0].expiresAt = new Date(0);
    await payment(quote.modificationId, 3000);
    expect(fixture.rows("bookings")[0].flightId).toBe(11);
    expect(
      fixture.rows("payment_receipts").find(r => r.paymentIntentId === "pi_mod")
        .settlementStatus
    ).toBe("review_required");
    expect(fixture.rows("flights").map(f => f.economyAvailable)).toEqual([
      5, 5, 5,
    ]);
  });
  it("records a lower-fare liability and posts only a verified provider refund", async () => {
    fixture.rows("flights")[1].destinationId = 3;
    const a = await offer(12);
    const quote = await quotePaidOrderService(
      { bookingId: 7, offerIds: [a.id], idempotencyKey: "refund-test-1" },
      1,
      3
    );
    expect(quote.refundDue).toBe(4000);
    await confirmNoChargeService(quote.modificationId, 1);
    expect(fixture.rows("order_service_refunds")[0].status).toBe("queued");
    expect(fixture.rows("financial_ledger")).toHaveLength(0);
    await processPendingOrderRefunds();
    await processPendingOrderRefunds();
    expect(boundary.refundCreate).toHaveBeenCalledTimes(1);
    expect(fixture.rows("order_service_refunds")[0].status).toBe("succeeded");
    expect(fixture.rows("financial_ledger")[0].amount).toBe("40.00");
    expect(fixture.rows("bookings")[0].status).toBe("confirmed");
  });
  it("releases an abandoned quote and rejects a foreign owner", async () => {
    const a = await offer(12),
      b = await offer(13);
    await expect(
      quotePaidOrderService(
        {
          bookingId: 7,
          offerIds: [a.id, b.id],
          idempotencyKey: "owner-test-1",
        },
        2,
        3
      )
    ).rejects.toThrow();
    const quote = await quotePaidOrderService(
      { bookingId: 7, offerIds: [a.id, b.id], idempotencyKey: "cancel-test-1" },
      1,
      3
    );
    await cancelOrderServiceQuote(quote.modificationId, 1);
    expect(
      fixture.rows("inventory_locks").every(l => l.status === "released")
    ).toBe(true);
    expect(fixture.rows("bookings")[0].flightId).toBe(11);
  });
});
