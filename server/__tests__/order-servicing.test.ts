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
    seat_inventory: [],
    agent_bookings: [],
    corporate_bookings: [],
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
        orderPayload: JSON.stringify({ ndcVersion: "21.3" }),
        channel: "direct",
        currency: "SAR",
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
    // Existing paid local document predates durable coupons.
    fixture.rows("passengers")[0].ticketNumber = "0010000000011";
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
    expect(fixture.rows("ticket_coupons")).toMatchObject([
      {
        ticketNumber: "0010000000011",
        couponNumber: 1,
        flightId: 11,
        status: "E",
      },
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
  it.each(["saved", "legacy"])(
    "preserves a codeshare reservation on a collected %s exchange",
    async kind => {
      const quote = await quotePaidOrderService(
        {
          bookingId: 7,
          offerIds: [(await offer(12)).id, (await offer(13)).id],
          idempotencyKey: "codeshare-collection",
        },
        1,
        3
      );
      await createOrderServiceCheckout(
        quote.modificationId,
        1,
        "https://ais.example"
      );
      fixture.rows("bookings")[0].codeshareAllotmentId = 9;
      if (kind === "legacy") {
        const modification = fixture.rows("booking_modifications")[0];
        modification.servicingPayload = null;
        modification.newFlightId = 12;
      }
      await payment(quote.modificationId, 3000);
      expect(
        fixture
          .rows("payment_receipts")
          .find(receipt => receipt.paymentIntentId === "pi_mod")
          .settlementStatus
      ).toBe("review_required");
      expect(fixture.rows("bookings")[0]).toMatchObject({
        flightId: 11,
        codeshareAllotmentId: 9,
        totalAmount: 10000,
      });
      expect(fixture.rows("flights").map(f => f.economyAvailable)).toEqual([
        5, 5, 5,
      ]);
    }
  );
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
  it("holds the fare, document, seat and segment identity of the unchanged sector", async () => {
    const [booking] = fixture.rows("bookings");
    booking.flightId = 12;
    booking.inventoryLockId = 91;
    const [first] = fixture.rows("booking_segments");
    first.flightId = 12;
    first.segmentAmount = 4400;
    first.updatedAt = new Date("2020-01-01T00:00:00Z");
    fixture.rows("booking_segments").push({
      ...first,
      id: 22,
      segmentOrder: 2,
      flightId: 13,
      segmentAmount: 5600,
    });
    const replacement = {
      ...fixture.rows("flights")[2],
      id: 14,
      flightNumber: "AI14",
      economyPrice: 5600,
    };
    fixture.rows("flights").push(replacement);
    fixture.rows("passengers")[0].ticketNumber = "0010000000001";
    fixture.rows("passengers")[0].seatNumber = "12A";
    fixture.rows("seat_inventory").push({
      id: 51,
      flightId: 12,
      bookingId: 7,
      passengerId: 1,
      status: "occupied",
      seatNumber: "12A",
      seatPrice: 0,
    });
    const input = {
      bookingId: 7,
      userId: 1,
      tenantId: 3,
      replaceFlightId: 13,
      newFlightId: 14,
      idempotencyKey: "replace-return-1",
    };
    const quote = await requestChangeFlightDate(input);
    expect(quote).toMatchObject({
      newAmount: 10000,
      priceDifference: 0,
      currency: "SAR",
      requiresPayment: false,
    });
    expect(fixture.rows("booking_modifications")[0]).toMatchObject({
      originalFlightId: 13,
      newFlightId: 14,
    });
    await expect(
      requestChangeFlightDate({ ...input, tenantId: 4 })
    ).rejects.toThrow("Booking not found");
    await expect(
      confirmNoChargeService(quote.modificationId, 1, 4)
    ).rejects.toThrow();
    const receipt = await confirmNoChargeService(quote.modificationId, 1, 3);
    expect(await confirmNoChargeService(quote.modificationId, 1, 3)).toEqual(
      receipt
    );
    expect(fixture.rows("booking_segments")).toMatchObject([
      { id: 21, flightId: 12, segmentAmount: 4400 },
      { id: 22, flightId: 14, segmentAmount: 5600 },
    ]);
    expect(fixture.rows("bookings")[0].inventoryLockId).toBe(91);
    expect(fixture.rows("booking_segments")[0].updatedAt).toEqual(
      new Date("2020-01-01T00:00:00Z")
    );
    expect(fixture.rows("seat_inventory")[0]).toMatchObject({
      flightId: 12,
      passengerId: 1,
      status: "occupied",
    });
    expect(fixture.rows("passengers")[0]).toMatchObject({
      ticketNumber: "0010000000001",
      seatNumber: "12A",
    });
    expect(
      fixture.rows("ticket_coupons").map(c => [c.flightId, c.status])
    ).toEqual(
      expect.arrayContaining([
        [12, "O"],
        [13, "E"],
        [14, "O"],
      ])
    );
  });

  it.each([
    "changed invoice",
    "cancelled flight",
    "changed destination",
    "changed source schedule",
    "changed passengers",
    "changed quote terms",
    "expired quote",
    "selling channel changed",
  ])("refuses checkout before a provider call for %s", async defect => {
    const input = {
      bookingId: 7,
      offerIds: [(await offer(12)).id, (await offer(13)).id],
      idempotencyKey: "stale-before-payment",
    };
    const q = await quotePaidOrderService(input, 1, 3);
    const change = fixture.rows("booking_modifications")[0];
    if (defect === "changed invoice") fixture.rows("bookings")[0].totalAmount++;
    if (defect === "changed source schedule")
      fixture.rows("flights")[0].departureTime = at(8);
    if (defect === "changed passengers")
      fixture.rows("passengers")[0].type = "infant";
    if (defect === "cancelled flight")
      fixture.rows("flights")[2].status = "cancelled";
    if (defect === "changed destination")
      fixture.rows("flights")[2].destinationId = 456;
    if (defect === "changed quote terms") {
      change.totalCost++;
      change.newAmount++;
    }
    if (defect === "expired quote")
      change.servicingPayload.expiresAt = new Date(0).toISOString();
    if (defect === "selling channel changed")
      fixture.rows("ndc_orders")[0].channel = "travel_agent";
    await expect(
      createOrderServiceCheckout(q.modificationId, 1, "https://ais.example", 3)
    ).rejects.toThrow();
    expect(boundary.checkout).not.toHaveBeenCalled();
    expect(change.checkoutRequestId).toBeFalsy();
  });

  it("reuses a single saved provider operation after the checkout response is lost", async () => {
    const input = {
      bookingId: 7,
      offerIds: [(await offer(12)).id, (await offer(13)).id],
      idempotencyKey: "lost-response",
    };
    const q = await quotePaidOrderService(input, 1, 3);
    boundary.checkout.mockRejectedValueOnce(new Error("response lost"));
    await expect(
      createOrderServiceCheckout(q.modificationId, 1, "https://ais.example", 3)
    ).rejects.toThrow("response lost");
    await expect(
      createOrderServiceCheckout(q.modificationId, 1, "https://ais.example", 4)
    ).rejects.toThrow();
    await createOrderServiceCheckout(
      q.modificationId,
      1,
      "https://ais.example",
      3
    );
    expect(boundary.checkout.mock.calls).toHaveLength(2);
    expect(boundary.checkout.mock.calls[0]).toEqual(
      boundary.checkout.mock.calls[1]
    );
    expect(fixture.rows("booking_modifications")).toHaveLength(1);
  });
  it.each(["agent_bookings", "corporate_bookings"])(
    "blocks direct exchange for independently linked %s without an NDC order",
    async channel => {
      fixture.rows("ndc_orders").splice(0);
      const a = await offer(12),
        b = await offer(13);
      fixture.rows(channel).push({ id: 51, bookingId: 7 });
      const input = {
        bookingId: 7,
        offerIds: [a.id, b.id],
        idempotencyKey: "partner-issued",
      };
      await expect(quotePaidOrderService(input, 1, 3)).rejects.toThrow(
        "Issuing channel"
      );
      expect(fixture.rows("booking_modifications")).toHaveLength(0);
      fixture.rows(channel).splice(0);
      const q = await quotePaidOrderService(input, 1, 3);
      fixture.rows(channel).push({ id: 51, bookingId: 7 });
      await expect(
        createOrderServiceCheckout(
          q.modificationId,
          1,
          "https://ais.example",
          3
        )
      ).rejects.toThrow("Issuing channel");
      expect(boundary.checkout).not.toHaveBeenCalled();
    }
  );
  it("releases an unknown checkout only on a matching verified unpaid expiry", async () => {
    const { processStripeEvent } = await import("../webhooks/stripe");
    const q = await quotePaidOrderService(
      {
        bookingId: 7,
        offerIds: [(await offer(12)).id, (await offer(13)).id],
        idempotencyKey: "expiry-no-ack",
      },
      1,
      3
    );
    boundary.checkout.mockRejectedValueOnce(new Error("lost acknowledgement"));
    await expect(
      createOrderServiceCheckout(q.modificationId, 1, "https://ais.example", 3)
    ).rejects.toThrow("lost acknowledgement");
    const request = boundary.checkout.mock.calls[0][0];
    const session = {
      id: "cs_unknown",
      metadata: request.metadata,
      currency: "sar",
      amount_total: q.totalCost,
      mode: "payment",
      status: "expired",
      payment_status: "unpaid",
    };
    const deliver = async (override: Record<string, unknown> = {}) =>
      fixture.db.transaction((tx: any) =>
        processStripeEvent(tx, {
          id: "evt_verified_expiry",
          type: "checkout.session.expired",
          data: { object: { ...session, ...override } },
        } as Parameters<typeof processStripeEvent>[1])
      );
    const state = () => fixture.rows("booking_modifications")[0];
    for (const override of [
      { amount_total: 1 },
      { currency: "usd" },
      { payment_status: "paid" },
      { status: "open" },
      { metadata: { ...request.metadata, checkoutRequestId: "another" } },
      { metadata: { ...request.metadata, userId: "999" } },
      { metadata: { ...request.metadata, bookingId: "999" } },
    ])
      await deliver(override);
    expect(state().status).toBe("pending");
    expect(state().checkoutSessionId).toBeFalsy();
    const review = {
      paymentIntentId: "pi_review",
      bookingId: 7,
      kind: "modification",
      targetId: q.modificationId,
      settlementStatus: "review_required",
    };
    fixture.rows("payment_receipts").push(review);
    await deliver();
    expect(state().status).toBe("pending");
    fixture.rows("payment_receipts").pop();
    await deliver();
    await deliver();
    expect(state()).toMatchObject({
      status: "rejected",
      checkoutSessionId: "cs_unknown",
      checkoutUrl: null,
    });
    expect(
      fixture.rows("inventory_locks").every(l => l.status === "released")
    ).toBe(true);
    expect(
      fixture
        .rows("outbox")
        .filter(e => e.eventType === "order.servicing_cancelled")
    ).toHaveLength(1);
    expect(fixture.rows("bookings")[0]).toMatchObject({
      flightId: 11,
      totalAmount: 10000,
      status: "confirmed",
    });
    expect(boundary.checkout).toHaveBeenCalledTimes(1);
  });
});
