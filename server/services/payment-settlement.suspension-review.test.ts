import { beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "../__tests__/helpers/transaction-memory";
const boundary = vi.hoisted(() => ({
  db: null as any,
  getFlight: vi.fn(),
  checkout: vi.fn(),
}));
vi.mock("../db", () => ({
  getDb: () => boundary.db,
  getFlightById: boundary.getFlight,
}));
vi.mock("../stripe", () => ({
  stripe: { checkout: { sessions: { create: boundary.checkout } } },
}));
vi.mock("./flights.service", () => ({
  calculateFlightPrice: async (f: any) => ({ price: f.economyPrice }),
}));
import { processStripeEvent } from "../webhooks/stripe";
import { createRetailOffer } from "./retail-offer.service";
import { quotePaidOrderService } from "./order-servicing.service";
import { createOrderServiceCheckout } from "./order-service-checkout.service";

/**
 * Money collected by a verified webhook must keep its receipt when a business
 * precondition (corporate account, airline tenant) stops the booking or the
 * order change after collection. The existing collection review takes it.
 */
let fixture: ReturnType<typeof transactionMemory>;
const webhook = (paymentIntentId: string, amount: number, metadata: object) =>
  fixture.db.transaction((tx: any) =>
    processStripeEvent(tx, {
      id: `evt_${paymentIntentId}`,
      type: "checkout.session.completed",
      data: {
        object: {
          id: `cs_${paymentIntentId}`,
          metadata,
          amount_total: amount,
          currency: "sar",
          payment_status: "paid",
          payment_intent: paymentIntentId,
        },
      },
    } as any)
  );
const reviewEvents = () =>
  fixture
    .rows("outbox")
    .filter(row => row.eventType === "payment.settlement_review_required");

describe("split booking collected while the corporate account is suspended", () => {
  const splitFixture = () =>
    transactionMemory({
      tenants: [{ id: 3, status: "active" }],
      bookings: [
        {
          id: 7,
          userId: 9,
          tenantId: 3,
          flightId: 4,
          bookingReference: "CORP07",
          status: "pending",
          paymentStatus: "pending",
          totalAmount: 100000,
          cabinClass: "economy",
          numberOfPassengers: 1,
          seatsReserved: false,
        },
      ],
      flights: [
        {
          id: 4,
          tenantId: 3,
          airlineId: 2,
          status: "scheduled",
          economyAvailable: 5,
          businessAvailable: 5,
          departureTime: new Date(Date.now() + 86400000),
        },
      ],
      payment_splits: [
        { id: 1, bookingId: 7, amount: 40000, status: "pending" },
        { id: 2, bookingId: 7, amount: 60000, status: "pending" },
      ],
      corporate_accounts: [{ id: 5, status: "active" }],
      corporate_bookings: [
        {
          id: 1,
          bookingId: 7,
          corporateAccountId: 5,
          approvalStatus: "approved",
        },
      ],
    });
  const share = (id: number) => ({
    type: "split_payment",
    bookingId: "7",
    userId: "9",
    splitId: String(id),
  });
  /** First share funds while active; `before` runs before the final share. */
  async function collectBoth(before: () => void) {
    await webhook("pi_1", 40000, share(1));
    expect(fixture.rows("bookings")[0].status).toBe("pending");
    before();
    await webhook("pi_2", 60000, share(2));
  }
  const reviewShape = () => ({
    receipts: fixture.rows("payment_receipts").map(r => ({
      paymentIntentId: r.paymentIntentId,
      kind: r.kind,
      targetId: r.targetId,
      settlementStatus: r.settlementStatus,
    })),
    events: reviewEvents().map(e => ({
      aggregateType: e.aggregateType,
      aggregateId: e.aggregateId,
      tenantId: e.tenantId,
      paymentIntentId: e.payload.paymentIntentId,
      bookingId: e.payload.bookingId,
    })),
    ledger: fixture.rows("financial_ledger").length,
    splits: fixture.rows("payment_splits").map(s => s.status),
  });

  beforeEach(() => {
    fixture = splitFixture();
    boundary.db = fixture.db;
  });

  it("keeps both receipts and records the collection review instead of rolling back", async () => {
    await expect(
      collectBoth(() => {
        fixture.rows("corporate_accounts")[0].status = "suspended";
      })
    ).resolves.toBeUndefined();
    expect(fixture.rows("payment_receipts")).toHaveLength(2);
    expect(
      fixture.rows("payment_receipts").map(r => ({
        paymentIntentId: r.paymentIntentId,
        settlementStatus: r.settlementStatus,
        settlementError: r.settlementError,
      }))
    ).toEqual([
      {
        paymentIntentId: "pi_1",
        settlementStatus: "review_required",
        settlementError: "Corporate account is not active",
      },
      {
        paymentIntentId: "pi_2",
        settlementStatus: "review_required",
        settlementError: "Corporate account is not active",
      },
    ]);
    expect(reviewEvents()).toHaveLength(1);
    expect(reviewEvents()[0]).toMatchObject({
      aggregateType: "payment",
      aggregateId: "pi_2",
      tenantId: 3,
      payload: {
        paymentIntentId: "pi_2",
        bookingId: 7,
        reason: "Corporate account is not active",
      },
    });
    expect(fixture.rows("financial_ledger")).toHaveLength(2);
    expect(fixture.rows("bookings")[0]).toMatchObject({
      status: "pending",
      paymentStatus: "pending",
      seatsReserved: false,
    });
    expect(fixture.rows("flights")[0].economyAvailable).toBe(5);
    expect(
      fixture.rows("outbox").some(e => e.eventType === "booking.confirmed")
    ).toBe(false);

    // Same review shape as the existing sold-out (InventoryUnavailableError) branch.
    const suspended = reviewShape();
    fixture = splitFixture();
    boundary.db = fixture.db;
    await collectBoth(() => {
      fixture.rows("flights")[0].economyAvailable = 0;
    });
    expect(fixture.rows("payment_receipts")[0].settlementError).toBe(
      "Insufficient economy inventory for booking"
    );
    expect(suspended).toEqual(reviewShape());
  });

  it("control: an active corporate account still confirms the funded split booking", async () => {
    await collectBoth(() => {});
    expect(fixture.rows("bookings")[0]).toMatchObject({
      status: "confirmed",
      paymentStatus: "paid",
      seatsReserved: true,
    });
    expect(
      fixture.rows("payment_receipts").map(r => r.settlementStatus)
    ).toEqual(["applied", "applied"]);
    expect(reviewEvents()).toHaveLength(0);
    expect(fixture.rows("flights")[0].economyAvailable).toBe(4);
  });

  it("control: another corporate precondition (TRPCError) still rolls back the final collection", async () => {
    await expect(
      collectBoth(() => {
        fixture.rows("corporate_bookings")[0].approvalStatus = "pending";
      })
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "Company approval is required before payment",
    });
    expect(
      fixture.rows("payment_receipts").map(r => r.paymentIntentId)
    ).toEqual(["pi_1"]);
    expect(fixture.rows("payment_splits")[1].status).toBe("pending");
    expect(reviewEvents()).toHaveLength(0);
  });

  it("control: an unrelated plain Error still rolls back the final collection", async () => {
    await expect(
      collectBoth(() => fixture.failInsert("booking_status_history"))
    ).rejects.toThrow("Injected insert failure");
    expect(
      fixture.rows("payment_receipts").map(r => r.paymentIntentId)
    ).toEqual(["pi_1"]);
    expect(fixture.rows("payment_splits")[1].status).toBe("pending");
    expect(fixture.rows("bookings")[0].status).toBe("pending");
    expect(reviewEvents()).toHaveLength(0);
  });
});

describe("order-service checkout collected while the airline tenant is suspended", () => {
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
  });
  const offer = (flightId: number) =>
    createRetailOffer({
      flightId,
      cabinClass: "economy",
      passengerTypes: ["adult"],
      userId: 1,
      channel: "direct",
    });
  /** Quote and open the provider checkout while the tenant is operational. */
  async function checkout(kind: "ancillary" | "exchange") {
    const quote = await quotePaidOrderService(
      kind === "ancillary"
        ? {
            bookingId: 7,
            idempotencyKey: "suspension-ancillary",
            ancillaries: [
              {
                ancillaryServiceId: 41,
                passengerId: 1,
                flightId: 11,
                quantity: 1,
              },
            ],
          }
        : {
            bookingId: 7,
            offerIds: [(await offer(12)).id, (await offer(13)).id],
            idempotencyKey: "suspension-exchange",
          },
      1,
      3
    );
    await createOrderServiceCheckout(
      quote.modificationId,
      1,
      "https://ais.example",
      3,
      {
        quoteVersion: quote.quoteVersion ?? "",
        totalCost: quote.totalCost,
        currency: "SAR",
      }
    );
    const change = fixture
      .rows("booking_modifications")
      .find(c => c.id === quote.modificationId);
    return () =>
      webhook("pi_mod", quote.totalCost, {
        type: "modification",
        bookingId: "7",
        modificationId: String(quote.modificationId),
        userId: "1",
        checkoutRequestId: change.checkoutRequestId,
      });
  }
  const modReceipt = () =>
    fixture.rows("payment_receipts").find(r => r.paymentIntentId === "pi_mod");

  it.each(["ancillary", "exchange"] as const)(
    "keeps the %s receipt for review and does not apply the order change",
    async kind => {
      const collect = await checkout(kind);
      const flightsBefore = fixture
        .rows("flights")
        .map(f => f.economyAvailable);
      fixture.rows("tenants")[0].status = "suspended";
      await expect(collect()).resolves.toBeUndefined();
      expect(modReceipt()).toMatchObject({
        kind: "modification",
        settlementStatus: "review_required",
        settlementError: "Airline tenant is not active",
      });
      // Only the collected order payment goes to review; the original fare stays applied.
      expect(
        fixture
          .rows("payment_receipts")
          .find(r => r.paymentIntentId === "pi_original").settlementStatus
      ).toBe("applied");
      expect(reviewEvents()).toHaveLength(1);
      expect(reviewEvents()[0]).toMatchObject({
        aggregateType: "payment",
        aggregateId: "pi_mod",
        tenantId: 3,
        payload: {
          paymentIntentId: "pi_mod",
          bookingId: 7,
          reason: "Airline tenant is not active",
        },
      });
      expect(fixture.rows("booking_modifications")[0]).toMatchObject({
        status: "pending",
      });
      expect(
        fixture.rows("booking_modifications")[0].stripePaymentIntentId
      ).toBeFalsy();
      expect(fixture.rows("booking_ancillaries")).toHaveLength(0);
      expect(fixture.rows("bookings")[0]).toMatchObject({
        flightId: 11,
        totalAmount: 10000,
      });
      expect(fixture.rows("flights").map(f => f.economyAvailable)).toEqual(
        flightsBefore
      );
    }
  );

  it("control: an operational tenant still applies the paid order change", async () => {
    const collect = await checkout("ancillary");
    await collect();
    expect(modReceipt().settlementStatus).toBe("applied");
    expect(reviewEvents()).toHaveLength(0);
    expect(fixture.rows("booking_ancillaries")).toHaveLength(1);
    expect(
      fixture.rows("booking_ancillaries")[0].fundingReference
    ).toMatchObject({
      kind: "collected_modification",
      modificationId: fixture.rows("booking_modifications")[0].id,
      paymentIntentId: "pi_mod",
    });
  });

  it("control: an unrelated plain Error still rolls back the collected order payment", async () => {
    const collect = await checkout("ancillary");
    fixture.failInsert("booking_ancillaries");
    await expect(collect()).rejects.toThrow("Injected insert failure");
    expect(modReceipt()).toBeUndefined();
    expect(reviewEvents()).toHaveLength(0);
    expect(fixture.rows("booking_ancillaries")).toHaveLength(0);
  });
});
