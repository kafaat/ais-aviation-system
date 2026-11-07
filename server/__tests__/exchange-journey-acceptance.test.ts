/**
 * Exchange journey acceptance (docs/acceptance/exchange-journey.md).
 *
 * A passenger holds two paid sectors and a funded paid seat on the second.
 * The second sector's schedule changes; the servicing path quotes a
 * replacement, binds consent to the quote version and amount, executes through
 * the order service and settles the difference through the verified payment
 * path. Provider calls are the existing Stripe boundary mocks; nothing here
 * reaches a network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { TrpcContext } from "../_core/context";
import { transactionMemory } from "./helpers/transaction-memory";
const boundary = vi.hoisted(() => ({
  db: null as any,
  getFlight: vi.fn(),
  checkout: vi.fn(),
  refundCreate: vi.fn(),
  refundList: vi.fn(),
  invoke: vi.fn(),
  search: vi.fn(),
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
  searchFlights: boundary.search,
}));
vi.mock("../services/intelligence/gateway", () => ({
  aiGateway: { invoke: boundary.invoke },
}));
vi.mock("../services/rate-limit.service", () => ({ rateLimitService: {} }));
import { aiChatRouter } from "../routers/ai-chat";
import { requestChangeFlightDate } from "../services/booking-modification.service";
import {
  CONSENT_MISMATCH,
  CONSENT_REQUIRED,
  UNSUPPORTED_QUOTE_VERSION,
  confirmNoChargeService,
  quotePaidOrderService,
  servicingQuoteVersion,
  stationServicingAcceptance,
} from "../services/order-servicing.service";
import {
  cancelOrderServiceQuote,
  createOrderServiceCheckout,
} from "../services/order-service-checkout.service";
import { settleVerifiedPayment } from "../services/payment-settlement.service";
import { processStripeEvent } from "../webhooks/stripe";
import { syncBookingMiles } from "../services/loyalty.service";
import {
  aggregateFinancialMonths,
  combineFinancialDays,
} from "../services/financial-reporting.service";
import { newTraceContext, type TraceContext } from "../../shared/trace-context";
import { runWithTrace } from "../_core/trace";
import { logger } from "../_core/logger";

const FIRST = 11; // sector 1, A -> B, unchanged
const OLD = 13; // sector 2, B -> C, schedule changed
const PRICIER = 14; // replacement, fare +2000
const SAME_FARE = 15; // replacement, fare unchanged (no-charge path)
const BOOKING = 7;
const PAX = 1;
const FAMILY_B_USER = 2;
const FAMILY_B_BOOKING = 8;
const OLD_SEAT = 52;
const PRICIER_SEAT = 53;
const SAME_FARE_SEAT = 54;
const SEAT_ITEM = 61;
const TICKET = "0010000000077";
const FUNDING_EVENT = "6a1b4b1e-1a4e-4a16-9c2e-0f0c0d0a0b01";

let fixture: ReturnType<typeof transactionMemory>;
const hours = (h: number) => new Date(Date.now() + h * 3600000);

function seat(id: number, flightId: number, occupied: boolean) {
  return {
    id,
    flightId,
    seatMapId: 1,
    seatNumber: "12A",
    row: 12,
    column: "A",
    cabinClass: "economy",
    seatType: "window",
    priceTier: "extra_legroom",
    hasExtraLegroom: true,
    hasPowerOutlet: false,
    isReclinable: true,
    nearLavatory: false,
    nearGalley: false,
    seatPrice: 2000,
    status: occupied ? "occupied" : "available",
    bookingId: occupied ? BOOKING : null,
    passengerId: occupied ? PAX : null,
  };
}

/** Flight times are taken from the clock at seeding time so a test may seed
 * under a fake clock. The replaced sector departs ten days out (no change fee). */
function seed(extraAncillaries: any[] = []) {
  fixture = transactionMemory({
    audit_logs: [],
    booking_modifications: [],
    agent_bookings: [],
    corporate_bookings: [],
    booking_refund_plans: [],
    order_service_refunds: [],
    inventory_locks: [],
    chat_conversations: [
      {
        id: 70,
        userId: FAMILY_B_USER,
        status: "active",
        context: {},
        messageCount: 1,
      },
    ],
    chat_messages: [],
    loyalty_accounts: [],
    booking_loyalty_accruals: [],
    miles_transactions: [],
    loyalty_credit_lots: [],
    wallet_transactions: [],
    tenants: [{ id: 3, status: "active" }],
    users: [
      { id: 1, tenantId: 3, role: "user" },
      { id: FAMILY_B_USER, tenantId: 3, role: "user" },
    ],
    bookings: [
      {
        id: BOOKING,
        userId: 1,
        tenantId: 3,
        flightId: FIRST,
        bookingReference: "FAMA01",
        pnr: "FAMA01",
        cabinClass: "economy",
        totalAmount: 19000,
        numberOfPassengers: 1,
        status: "confirmed",
        paymentStatus: "paid",
        seatsReserved: true,
        checkedIn: false,
        deletedAt: null,
      },
      {
        id: FAMILY_B_BOOKING,
        userId: FAMILY_B_USER,
        tenantId: 3,
        flightId: FIRST,
        bookingReference: "FAMB02",
        pnr: "FAMB02",
        cabinClass: "economy",
        totalAmount: 10000,
        numberOfPassengers: 1,
        status: "confirmed",
        paymentStatus: "paid",
        seatsReserved: true,
        checkedIn: false,
        deletedAt: null,
      },
    ],
    passengers: [
      {
        id: PAX,
        bookingId: BOOKING,
        tenantId: 3,
        type: "adult",
        firstName: "Lina",
        lastName: "FamilyA",
        ticketNumber: TICKET,
        seatNumber: null,
      },
      {
        id: 2,
        bookingId: FAMILY_B_BOOKING,
        tenantId: 3,
        type: "adult",
        firstName: "Omar",
        lastName: "FamilyB",
        ticketNumber: null,
        seatNumber: null,
      },
    ],
    booking_segments: [
      {
        id: 21,
        bookingId: BOOKING,
        segmentOrder: 1,
        flightId: FIRST,
        segmentAmount: 10000,
        seatsReserved: true,
        status: "confirmed",
      },
      {
        id: 22,
        bookingId: BOOKING,
        segmentOrder: 2,
        flightId: OLD,
        segmentAmount: 9000,
        seatsReserved: true,
        status: "confirmed",
      },
    ],
    ticket_coupons: [
      {
        id: 31,
        bookingId: BOOKING,
        passengerId: PAX,
        ticketNumber: TICKET,
        flightId: FIRST,
        couponNumber: 1,
        status: "O",
      },
      {
        id: 32,
        bookingId: BOOKING,
        passengerId: PAX,
        ticketNumber: TICKET,
        flightId: OLD,
        couponNumber: 2,
        status: "O",
      },
    ],
    ancillary_services: [
      {
        id: 43,
        code: "SEAT_EXTRA_LEG",
        category: "seat",
        name: "Extra legroom",
        price: 2000,
        currency: "SAR",
        available: true,
      },
      {
        id: 44,
        code: "BAG_20KG",
        category: "baggage",
        name: "20kg Checked Baggage",
        price: 8000,
        currency: "SAR",
        available: true,
        weightGrams: 20000,
      },
      {
        id: 45,
        code: "MEAL_VEG",
        category: "meal",
        name: "Vegetarian meal",
        price: 3000,
        currency: "SAR",
        available: true,
      },
    ],
    booking_ancillaries: [
      {
        id: SEAT_ITEM,
        bookingId: BOOKING,
        passengerId: PAX,
        ancillaryServiceId: 43,
        quantity: 1,
        unitPrice: 2000,
        totalPrice: 2000,
        segmentId: 22,
        scopeState: "specific_segment",
        status: "active",
        fundedAt: new Date("2026-10-01T10:00:00Z"),
        metadata: JSON.stringify({
          paidSeat: {
            seatId: OLD_SEAT,
            flightId: OLD,
            seatNumber: "12A",
            fundingEventId: FUNDING_EVENT,
          },
        }),
      },
      ...extraAncillaries,
    ],
    seat_inventory: [
      seat(OLD_SEAT, OLD, true),
      seat(PRICIER_SEAT, PRICIER, false),
      seat(SAME_FARE_SEAT, SAME_FARE, false),
    ],
    outbox: [
      {
        id: 1,
        eventId: FUNDING_EVENT,
        aggregateType: "booking",
        aggregateId: String(BOOKING),
        eventType: "booking.confirmed",
        payload: {},
        status: "published",
      },
    ],
    flights: [
      {
        id: FIRST,
        originId: 1,
        destinationId: 2,
        departureTime: hours(200),
        arrivalTime: hours(202),
        economyPrice: 10000,
      },
      {
        id: OLD,
        originId: 2,
        destinationId: 3,
        departureTime: hours(240),
        arrivalTime: hours(242),
        economyPrice: 7000,
      },
      {
        id: PRICIER,
        originId: 2,
        destinationId: 3,
        departureTime: hours(246),
        arrivalTime: hours(248),
        economyPrice: 9000,
      },
      {
        id: SAME_FARE,
        originId: 2,
        destinationId: 3,
        departureTime: hours(252),
        arrivalTime: hours(254),
        economyPrice: 7000,
      },
    ].map(f => ({
      ...f,
      tenantId: 3,
      airlineId: 1,
      status: "scheduled",
      economyAvailable: 5,
      businessAvailable: 2,
      flightNumber: `AI${f.id}`,
      aircraftType: "A320",
    })),
    payment_receipts: [
      {
        paymentIntentId: "pi_original",
        bookingId: BOOKING,
        targetId: BOOKING,
        userId: 1,
        kind: "booking",
        amount: 19000,
        refundedAmount: 0,
        currency: "SAR",
        settlementStatus: "applied",
      },
    ],
    financial_ledger: [
      {
        id: 1,
        bookingId: BOOKING,
        userId: 1,
        type: "charge",
        amount: "190.00",
        currency: "SAR",
        stripeEventId: "evt_original",
        stripePaymentIntentId: "pi_original",
      },
    ],
    ndc_orders: [
      {
        id: 1,
        bookingId: BOOKING,
        orderId: "ORDER-7",
        airlineId: 1,
        status: "confirmed",
        totalAmount: 19000,
        orderPayload: JSON.stringify({ ndcVersion: "21.3" }),
        channel: "direct",
        currency: "SAR",
      },
    ],
  });
  boundary.db = fixture.db;
}

beforeEach(() => {
  seed();
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
    id: "cs_exchange",
    url: "https://checkout.stripe.com/test",
  });
  boundary.refundList
    .mockReset()
    .mockImplementation(() => ({ async *[Symbol.asyncIterator]() {} }));
  boundary.refundCreate.mockReset();
  boundary.invoke.mockReset();
  boundary.search.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

const rows = (name: string) => fixture.rows(name);
const change = (id: number) =>
  rows("booking_modifications").find(c => c.id === id);
const coupons = () =>
  rows("ticket_coupons")
    .slice()
    .sort((a, b) => a.couponNumber - b.couponNumber)
    .map(c => ({ id: c.id, flightId: c.flightId, status: c.status }));
const seatRow = (id: number) => rows("seat_inventory").find(s => s.id === id);
const ledgerCharges = () =>
  rows("financial_ledger").filter(l => l.type === "charge");

/** searchOffers + quoteExchange: the owner's screen asks for the replacement by sector. */
function quote(newFlightId: number, key = randomUUID()) {
  return requestChangeFlightDate({
    bookingId: BOOKING,
    userId: 1,
    tenantId: 3,
    replaceFlightId: OLD,
    newFlightId,
    idempotencyKey: key,
  });
}
const consentFor = (q: { quoteVersion?: string; totalCost: number }) => ({
  quoteVersion: q.quoteVersion ?? "",
  totalCost: q.totalCost,
  currency: "SAR" as const,
});
function paid(modificationId: number, amount: number, eventId = "evt_mod") {
  const pending = change(modificationId);
  return fixture.db.transaction((tx: any) =>
    settleVerifiedPayment(tx, {
      paymentIntentId: "pi_mod",
      amount,
      currency: "SAR",
      eventId,
      metadata: {
        type: "modification",
        bookingId: String(BOOKING),
        modificationId: String(modificationId),
        userId: "1",
        checkoutRequestId: pending.checkoutRequestId,
      },
    })
  );
}
const providerEvent = (event: Record<string, unknown>) =>
  fixture.db.transaction((tx: any) =>
    processStripeEvent(tx, event as Parameters<typeof processStripeEvent>[1])
  );
const inTrace = <T>(trace: TraceContext, run: () => Promise<T>) =>
  runWithTrace(trace, run);

describe("exchange journey: second sector schedule change with a paid seat", () => {
  it("quotes the affected sector, binds consent, settles the difference once and keeps the evidence chain", async () => {
    const quoteTrace = newTraceContext();
    const q = await inTrace(quoteTrace, () => quote(PRICIER));
    // Shown to the passenger: affected sector, difference, currency, seat fate, expiry.
    expect(q).toMatchObject({
      originalAmount: 19000,
      newAmount: 21000,
      priceDifference: 2000,
      modificationFee: 0,
      totalCost: 2000,
      currency: "SAR",
      requiresPayment: true,
    });
    expect(q.seatExchange).toMatchObject({
      retainedAmount: 2000,
      seats: [
        {
          ancillaryId: SEAT_ITEM,
          fromFlightId: OLD,
          toFlightId: PRICIER,
          seatNumber: "12A",
          amount: 2000,
        },
      ],
    });
    expect(q.quoteVersion).toMatch(/^[a-f0-9]{64}$/);
    expect(q.expiresAt!.getTime() - Date.now()).toBeGreaterThan(9 * 60000);
    expect(change(q.modificationId)).toMatchObject({
      originalFlightId: OLD,
      newFlightId: PRICIER,
      status: "pending",
    });
    // Nothing moved at quote time.
    expect(coupons().map(c => c.status)).toEqual(["O", "O"]);
    expect(seatRow(OLD_SEAT).status).toBe("occupied");

    // The server rejects consent given for any other version or amount.
    await expect(
      createOrderServiceCheckout(
        q.modificationId,
        1,
        "https://ais.example",
        3,
        {
          ...consentFor(q),
          totalCost: 1999,
        }
      )
    ).rejects.toThrow(CONSENT_MISMATCH);
    expect(boundary.checkout).not.toHaveBeenCalled();

    // commitExchange through the order service, scoped to owner, tenant and quote.
    const commitTrace = newTraceContext();
    const checkout = await inTrace(commitTrace, () =>
      createOrderServiceCheckout(
        q.modificationId,
        1,
        "https://ais.example",
        3,
        consentFor(q)
      )
    );
    expect(checkout.sessionId).toBe("cs_exchange");
    expect(change(q.modificationId).servicingPayload.consent).toMatchObject({
      quoteVersion: q.quoteVersion,
      totalCost: 2000,
      currency: "SAR",
    });
    expect(boundary.checkout.mock.calls[0][1].idempotencyKey).toBe(
      `order-checkout:${change(q.modificationId).checkoutRequestId}`
    );

    const settleTrace = newTraceContext();
    await inTrace(settleTrace, () => paid(q.modificationId, 2000));
    await inTrace(newTraceContext(), () => paid(q.modificationId, 2000));

    // Sector 1 coupon untouched; sector 2 old coupon exchanged; new coupon open.
    expect(coupons()).toEqual([
      { id: 31, flightId: FIRST, status: "O" },
      { id: 32, flightId: OLD, status: "E" },
      { id: expect.any(Number), flightId: PRICIER, status: "O" },
    ]);
    // Seat moved with its funding evidence; the fee was neither re-collected nor refunded.
    expect(seatRow(OLD_SEAT)).toMatchObject({
      status: "available",
      bookingId: null,
      passengerId: null,
    });
    expect(seatRow(PRICIER_SEAT)).toMatchObject({
      status: "occupied",
      bookingId: BOOKING,
      passengerId: PAX,
    });
    const item = rows("booking_ancillaries").find(a => a.id === SEAT_ITEM);
    expect(JSON.parse(item.metadata).paidSeat).toEqual({
      seatId: PRICIER_SEAT,
      flightId: PRICIER,
      seatNumber: "12A",
      fundingEventId: FUNDING_EVENT,
    });
    expect(item.segmentId).toBe(22);
    expect(
      rows("booking_segments").map(s => [s.id, s.flightId, s.segmentAmount])
    ).toEqual([
      [21, FIRST, 10000],
      [22, PRICIER, 11000],
    ]);
    expect(rows("bookings")[0].totalAmount).toBe(21000);
    expect(rows("order_service_refunds")).toHaveLength(0);

    // Accountant's trace: one charge for the difference, linked to the provider
    // receipt (payment intent + event) and to the reconciliation row (receipt).
    const charges = ledgerCharges();
    expect(charges).toHaveLength(2);
    const delta = charges[1];
    const receipt = rows("payment_receipts").find(
      r => r.paymentIntentId === "pi_mod"
    );
    expect(receipt).toMatchObject({
      kind: "modification",
      targetId: q.modificationId,
      bookingId: BOOKING,
      userId: 1,
      amount: 2000,
      currency: "SAR",
      settlementStatus: "applied",
    });
    expect(delta).toMatchObject({
      bookingId: BOOKING,
      userId: 1,
      type: "charge",
      amount: (2000 / 100).toFixed(2),
      currency: "SAR",
      stripePaymentIntentId: "pi_mod",
      stripeEventId: "evt_mod",
    });
    expect(change(q.modificationId)).toMatchObject({
      status: "completed",
      paymentStatus: "paid",
      stripePaymentIntentId: "pi_mod",
      executionEventId: expect.any(String),
    });
    const applied = rows("outbox").find(
      e => e.eventType === "order.servicing_applied"
    );
    expect(applied.payload).toMatchObject({
      modificationId: q.modificationId,
      quoteTermsHash: q.quoteVersion,
      previousTotal: 19000,
      totalAmount: 21000,
    });
    // Trace ids differ per attempt; the provider idempotency key did not.
    const quoted = rows("outbox").find(
      e => e.eventType === "order.servicing_quoted"
    );
    expect(quoted.traceId).toBe(quoteTrace.traceId);
    expect(applied.traceId).toBe(settleTrace.traceId);
    expect(
      new Set([quoted.traceId, applied.traceId, commitTrace.traceId]).size
    ).toBe(3);
  });
});

describe("acceptance", () => {
  it("(a) a quote whose amounts changed between quote and commit is refused and must be re-quoted", async () => {
    const q = await quote(PRICIER);
    // The booking's invoice changed after the quote (another line was added).
    rows("bookings")[0].totalAmount += 500;
    await expect(
      createOrderServiceCheckout(
        q.modificationId,
        1,
        "https://ais.example",
        3,
        consentFor(q)
      )
    ).rejects.toThrow("Servicing quote expired or booking changed");
    expect(boundary.checkout).not.toHaveBeenCalled();
    expect(change(q.modificationId).status).toBe("pending");
    expect(change(q.modificationId).checkoutRequestId).toBeFalsy();
    // A second quote cannot be stacked on the stale one; cancel then re-quote.
    await expect(quote(PRICIER)).rejects.toThrow(
      "Resolve the existing servicing request first"
    );
    await cancelOrderServiceQuote(q.modificationId, 1, 3);
    expect(change(q.modificationId).status).toBe("rejected");
    rows("bookings")[0].totalAmount -= 500;
    const again = await quote(PRICIER);
    expect(again.modificationId).not.toBe(q.modificationId);
    expect(again.quoteVersion).toBe(q.quoteVersion); // same amounts, same version
    // Consent carried over from a differently priced quote is refused too.
    const stale = {
      ...consentFor(again),
      quoteVersion: servicingQuoteVersion({
        originalAmount: 19000,
        newAmount: 21500,
        modificationFee: 0,
        priceDifference: 2500,
      }),
    };
    await expect(
      createOrderServiceCheckout(
        again.modificationId,
        1,
        "https://ais.example",
        3,
        stale
      )
    ).rejects.toThrow(CONSENT_MISMATCH);
    expect(boundary.checkout).not.toHaveBeenCalled();
    // A fare change on the replacement after the quote does not reprice the held
    // quote: the quoted amount is what consent names and what is collected.
    rows("flights").find(f => f.id === PRICIER).economyPrice = 12000;
    await createOrderServiceCheckout(
      again.modificationId,
      1,
      "https://ais.example",
      3,
      consentFor(again)
    );
    expect(
      boundary.checkout.mock.calls[0][0].line_items[0].price_data.unit_amount
    ).toBe(2000);
  });

  it("(b) payment failure after commit started leaves coupons, seat and ledger untouched and records at most one charge", async () => {
    const q = await quote(PRICIER);
    await createOrderServiceCheckout(
      q.modificationId,
      1,
      "https://ais.example",
      3,
      consentFor(q)
    );
    const metadata = boundary.checkout.mock.calls[0][0].metadata;
    await providerEvent({
      id: "evt_failed",
      type: "payment_intent.payment_failed",
      data: {
        object: { id: "pi_mod", status: "requires_payment_method", metadata },
      },
    });
    expect(coupons().map(c => c.status)).toEqual(["O", "O"]);
    expect(seatRow(OLD_SEAT).status).toBe("occupied");
    expect(seatRow(PRICIER_SEAT).status).toBe("available");
    expect(ledgerCharges()).toHaveLength(1);
    expect(change(q.modificationId).status).toBe("pending");
    // The provider later reports the session unpaid and expired: the quote is released.
    await providerEvent({
      id: "evt_expired",
      type: "checkout.session.expired",
      data: {
        object: {
          id: "cs_exchange",
          metadata,
          currency: "sar",
          amount_total: 2000,
          mode: "payment",
          status: "expired",
          payment_status: "unpaid",
        },
      },
    });
    expect(change(q.modificationId).status).toBe("rejected");
    expect(rows("inventory_locks").every(l => l.status === "released")).toBe(
      true
    );
    // A late collection against the released quote is kept for review, never applied.
    await paid(q.modificationId, 2000, "evt_late");
    await paid(q.modificationId, 2000, "evt_late_again");
    expect(ledgerCharges()).toHaveLength(2);
    expect(
      rows("payment_receipts").find(r => r.paymentIntentId === "pi_mod")
        .settlementStatus
    ).toBe("review_required");
    expect(coupons().map(c => c.status)).toEqual(["O", "O"]);
    expect(rows("booking_segments").map(s => s.flightId)).toEqual([FIRST, OLD]);
    expect(rows("bookings")[0].totalAmount).toBe(19000);
  });

  it("(c) a network drop after the request is saved resumes onto the same provider operation: one passenger, one charge", async () => {
    const q = await quote(PRICIER);
    boundary.checkout.mockRejectedValueOnce(new Error("socket hang up"));
    await expect(
      inTrace(newTraceContext(), () =>
        createOrderServiceCheckout(
          q.modificationId,
          1,
          "https://ais.example",
          3,
          consentFor(q)
        )
      )
    ).rejects.toThrow("socket hang up");
    const saved = change(q.modificationId);
    expect(saved.checkoutRequestId).toBeTruthy();
    expect(saved.checkoutSessionId).toBeFalsy();
    // The resume path re-reads the saved request before any new provider call.
    const resumed = await inTrace(newTraceContext(), () =>
      createOrderServiceCheckout(
        q.modificationId,
        1,
        "https://ais.example",
        3,
        consentFor(q)
      )
    );
    expect(resumed.sessionId).toBe("cs_exchange");
    expect(change(q.modificationId).checkoutRequestId).toBe(
      saved.checkoutRequestId
    );
    const keys = boundary.checkout.mock.calls.map(c => c[1].idempotencyKey);
    expect(keys).toEqual([
      `order-checkout:${saved.checkoutRequestId}`,
      `order-checkout:${saved.checkoutRequestId}`,
    ]);
    expect(boundary.checkout.mock.calls[0][0]).toEqual(
      boundary.checkout.mock.calls[1][0]
    );
    // A third call after acknowledgement reuses the saved session without a provider call.
    await createOrderServiceCheckout(
      q.modificationId,
      1,
      "https://ais.example",
      3,
      consentFor(q)
    );
    expect(boundary.checkout).toHaveBeenCalledTimes(2);
    await paid(q.modificationId, 2000);
    await paid(q.modificationId, 2000);
    expect(
      rows("passengers").filter(p => p.bookingId === BOOKING)
    ).toHaveLength(1);
    expect(
      rows("payment_receipts").filter(r => r.kind === "modification")
    ).toHaveLength(1);
    expect(ledgerCharges()).toHaveLength(2);
    expect(rows("booking_modifications")).toHaveLength(1);
  });

  it("(d) a quote stored in a previous contract version is rejected with a clear error and no partial state", async () => {
    const q = await quote(PRICIER);
    const before = structuredClone({
      segments: rows("booking_segments"),
      seats: rows("seat_inventory"),
      coupons: rows("ticket_coupons"),
      flights: rows("flights").map(f => f.economyAvailable),
    });
    // An older client/version persisted the quote as "legs" without a version field.
    // (Rows are re-read after each refused command: the fixture rolls back by snapshot.)
    const stored = change(q.modificationId).servicingPayload;
    change(q.modificationId).servicingPayload = {
      fingerprint: stored.fingerprint,
      expiresAt: stored.expiresAt,
      legs: stored.segments,
    };
    await expect(
      createOrderServiceCheckout(
        q.modificationId,
        1,
        "https://ais.example",
        3,
        consentFor(q)
      )
    ).rejects.toThrow(UNSUPPORTED_QUOTE_VERSION);
    expect(boundary.checkout).not.toHaveBeenCalled();
    // A newer version number is equally refused.
    change(q.modificationId).servicingPayload = { ...stored, version: 2 };
    await expect(
      createOrderServiceCheckout(
        q.modificationId,
        1,
        "https://ais.example",
        3,
        consentFor(q)
      )
    ).rejects.toThrow(UNSUPPORTED_QUOTE_VERSION);
    await expect(
      confirmNoChargeService(q.modificationId, 1, 3, undefined, consentFor(q))
    ).rejects.toThrow("Verified payment is required");
    // A collection that arrives for it is retained for review instead of crashing the webhook.
    change(q.modificationId).checkoutRequestId = "legacy-request";
    await expect(paid(q.modificationId, 2000)).resolves.toBeUndefined();
    expect(
      rows("payment_receipts").find(r => r.paymentIntentId === "pi_mod")
    ).toMatchObject({
      settlementStatus: "review_required",
      settlementError: UNSUPPORTED_QUOTE_VERSION,
    });
    expect({
      segments: rows("booking_segments"),
      seats: rows("seat_inventory"),
      coupons: rows("ticket_coupons"),
      flights: rows("flights").map(f => f.economyAvailable),
    }).toEqual(before);
    expect(change(q.modificationId).status).toBe("pending");
    // Consent itself has one shape; an old client's shape is a validation error.
    expect(
      (
        await import("../services/order-servicing.service")
      ).servicingConsentInput.safeParse({
        quoteVersion: "v1",
        amount: 2000,
      }).success
    ).toBe(false);
  });

  it("(e) an agent quoting at 23:59 local (+03:00) and committing at 00:01 keeps dates, fare validity and expiry on the instant, not the local day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const quoteAt = new Date("2026-11-30T20:59:00Z"); // 23:59 Asia/Riyadh
    vi.setSystemTime(quoteAt);
    seed();
    // The replaced sector departs 72h30m after the quote: the 5% tier applies.
    const departure = new Date(quoteAt.getTime() + 72.5 * 3600000);
    const old = rows("flights").find(f => f.id === OLD);
    old.departureTime = departure;
    old.arrivalTime = new Date(departure.getTime() + 2 * 3600000);
    const q = await quote(SAME_FARE);
    expect(q).toMatchObject({
      modificationFee: 950,
      priceDifference: 0,
      totalCost: 950,
    });
    expect(q.expiresAt).toEqual(new Date(quoteAt.getTime() + 10 * 60000));
    const riyadh = (d: Date) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Riyadh",
        dateStyle: "short",
      }).format(d);
    expect(riyadh(quoteAt)).toBe("2026-11-30");
    // Local midnight passes; the quote is still within its ten-minute window.
    const commitAt = new Date("2026-11-30T21:01:00Z"); // 00:01 Asia/Riyadh, 1 December
    vi.setSystemTime(commitAt);
    expect(riyadh(commitAt)).toBe("2026-12-01");
    await createOrderServiceCheckout(
      q.modificationId,
      1,
      "https://ais.example",
      3,
      consentFor(q)
    );
    await paid(q.modificationId, 950);
    const applied = change(q.modificationId);
    expect(applied).toMatchObject({
      status: "completed",
      modificationFee: 950,
      totalCost: 950,
    });
    // The fee is the quoted one; it was not recomputed on the far side of midnight
    // (72h28m before departure would still be 5%, but the quote is the authority).
    const replacement = rows("flights").find(f => f.id === SAME_FARE);
    const segment = rows("booking_segments").find(s => s.id === 22);
    expect(segment.flightId).toBe(SAME_FARE);
    expect(segment.departureDate).toEqual(replacement.departureTime);
    expect(applied.completedAt).toEqual(commitAt);
    // Past expiry, the same quote is refused regardless of the local date.
    seed();
    vi.setSystemTime(quoteAt);
    const late = await quote(SAME_FARE);
    expect(late.totalCost).toBe(0);
    vi.setSystemTime(new Date(quoteAt.getTime() + 11 * 60000));
    await expect(
      confirmNoChargeService(
        late.modificationId,
        1,
        3,
        undefined,
        consentFor(late)
      )
    ).rejects.toThrow("Servicing quote expired or booking changed");
    expect(coupons().map(c => c.status)).toEqual(["O", "O"]);
  });

  it("(f) an exchange committed on the last day of the month and settled next month posts cash in the settlement period and keeps the unflown coupon open", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const commitAt = new Date("2026-11-30T23:45:00Z");
    vi.setSystemTime(commitAt);
    seed();
    const q = await quote(PRICIER);
    await createOrderServiceCheckout(
      q.modificationId,
      1,
      "https://ais.example",
      3,
      consentFor(q)
    );
    expect(q.expiresAt!.toISOString().slice(0, 7)).toBe("2026-11");
    // Nothing is earned or posted at commit: no ledger movement in November.
    expect(ledgerCharges()).toHaveLength(1);
    expect(coupons().map(c => c.status)).toEqual(["O", "O"]);
    // Settled inside the 32-minute checkout window, on the first day of December.
    const settledAt = new Date("2026-12-01T00:05:00Z");
    vi.setSystemTime(settledAt);
    await paid(q.modificationId, 2000, "evt_december");
    const applied = change(q.modificationId);
    expect(applied.completedAt).toEqual(settledAt);
    expect(ledgerCharges()[1]).toMatchObject({
      stripeEventId: "evt_december",
      amount: "20.00",
    });
    // The cash report buckets the invoice day and the settlement day separately
    // (booking createdAt vs. ledger transactionDate, both UTC), so the November
    // quote and the December collection land in different months.
    const day = (d: Date) => Math.floor(d.getTime() / 86400000);
    const months = aggregateFinancialMonths(
      combineFinancialDays(
        [{ day: day(commitAt), amount: 21000, count: 1, unreconciled: 0 }],
        [{ day: day(settledAt), collected: 2000, refunded: 0, unclassified: 0 }]
      )
    );
    expect(
      months.map(m => [m.yearMonth, m.billedAmount, m.collectedAmount])
    ).toEqual([
      ["2026-12", 0, 2000],
      ["2026-11", 21000, 0],
    ]);
    // Liability view: the replacement coupon stays open until flown; the exchanged
    // coupon is closed; nothing was recognised as flown by the exchange itself.
    expect(coupons()).toEqual([
      { id: 31, flightId: FIRST, status: "O" },
      { id: 32, flightId: OLD, status: "E" },
      { id: expect.any(Number), flightId: PRICIER, status: "O" },
    ]);
    expect(rows("ticket_coupons").some(c => c.status === "F")).toBe(false);
    expect(rows("bookings")[0].totalAmount).toBe(21000);
  });

  it("(g) a session of family A cannot quote, pay, confirm, cancel or list family B's exchange; each attempt is logged without leaking data or changing a row", async () => {
    const q = await quote(PRICIER); // family A's own quote
    const warned = vi.spyOn(logger, "warn");
    warned.mockClear();
    const generic = /not found/i;
    const attempts = [
      () =>
        requestChangeFlightDate({
          bookingId: BOOKING,
          userId: FAMILY_B_USER,
          tenantId: 3,
          replaceFlightId: OLD,
          newFlightId: PRICIER,
          idempotencyKey: randomUUID(),
        }),
      () =>
        quotePaidOrderService(
          {
            bookingId: BOOKING,
            replaceFlightId: OLD,
            offerIds: [randomUUID()],
            idempotencyKey: randomUUID(),
          },
          FAMILY_B_USER,
          3
        ),
      () =>
        createOrderServiceCheckout(
          q.modificationId,
          FAMILY_B_USER,
          "https://ais.example",
          3,
          consentFor(q)
        ),
      () =>
        confirmNoChargeService(
          q.modificationId,
          FAMILY_B_USER,
          3,
          undefined,
          consentFor(q)
        ),
      () => cancelOrderServiceQuote(q.modificationId, FAMILY_B_USER, 3),
      // Same owner id, wrong airline tenant: the record is equally invisible.
      () =>
        confirmNoChargeService(
          q.modificationId,
          1,
          4,
          undefined,
          consentFor(q)
        ),
    ];
    for (const attempt of attempts) {
      const error = await attempt().then(
        () => null,
        (e: Error) => e
      );
      expect(error).toBeInstanceOf(Error);
      expect(error!.message).toMatch(generic);
      expect(error!.message).not.toMatch(/FAMA01|19000|2000|Lina|12A/);
    }
    // A refused attempt changes no row: it is kept only as a structured warning.
    expect(rows("audit_logs")).toHaveLength(0);
    const denials = warned.mock.calls
      .map(call => call[0] as Record<string, unknown>)
      .filter(entry => entry?.event === "servicing_access_denied");
    expect(denials).toHaveLength(attempts.length);
    expect(denials.map(d => d.actorId)).toEqual([2, 2, 2, 2, 2, 1]);
    expect(denials.map(d => d.procedure)).toEqual([
      "order.servicing.quote",
      "order.servicing.quote",
      "order.servicing.checkout",
      "order.servicing.confirm",
      "order.servicing.cancel",
      "order.servicing.confirm",
    ]);
    expect(denials.every(d => d.bookingId === BOOKING)).toBe(true);
    expect(JSON.stringify(denials)).not.toMatch(
      /FAMA01|Lina|FamilyA|19000|12A/
    );
    warned.mockRestore();
    // Family A's quote is intact; nothing was created for family B.
    expect(change(q.modificationId)).toMatchObject({
      status: "pending",
      userId: 1,
    });
    expect(change(q.modificationId).checkoutRequestId).toBeFalsy();
    expect(rows("booking_modifications")).toHaveLength(1);
    expect(boundary.checkout).not.toHaveBeenCalled();
    // The assistant's exchange handoff lists only the caller's own bookings and quotes nothing.
    const chat = aiChatRouter.createCaller({
      user: { id: FAMILY_B_USER, role: "user" },
      tenantId: 3,
      authMethod: "cookie",
    } as TrpcContext);
    const reply = await chat.sendMessage({
      conversationId: 70,
      message: "I need to change my booking FAMA01 and pay the difference",
    });
    expect(reply.exchangeBookings).toEqual([
      { id: FAMILY_B_BOOKING, bookingReference: "FAMB02" },
    ]);
    expect(JSON.stringify(rows("chat_messages"))).not.toMatch(/FAMA01/);
    expect(rows("booking_modifications")).toHaveLength(1);
    expect(boundary.invoke).not.toHaveBeenCalled();
  });

  it("(h) changing a segment propagates to the seat, the entitlement scope, inventory, loyalty inputs and the manifest basis, or is refused while a service would be left undelivered", async () => {
    const before = rows("flights").map(f => [f.id, f.economyAvailable]);
    const q = await quote(SAME_FARE);
    expect(q.totalCost).toBe(0);
    const receipt = await confirmNoChargeService(
      q.modificationId,
      1,
      3,
      undefined,
      consentFor(q)
    );
    expect(
      await confirmNoChargeService(
        q.modificationId,
        1,
        3,
        undefined,
        consentFor(q)
      )
    ).toEqual(receipt);
    // Seat view: moved to the equivalent seat on the replacement flight.
    expect(seatRow(OLD_SEAT)).toMatchObject({
      status: "available",
      bookingId: null,
    });
    expect(seatRow(SAME_FARE_SEAT)).toMatchObject({
      status: "occupied",
      bookingId: BOOKING,
      passengerId: PAX,
    });
    // Ancillary view: the entitlement keeps its segment, and the segment now names the new flight.
    const item = rows("booking_ancillaries").find(a => a.id === SEAT_ITEM);
    expect(item).toMatchObject({
      segmentId: 22,
      status: "active",
      fundedAt: expect.any(Date),
    });
    expect(JSON.parse(item.metadata).paidSeat.flightId).toBe(SAME_FARE);
    // Manifest/crew basis: manifest membership is EXISTS(booking_segments.flightId = flight).
    const segmentsOf = (flightId: number) =>
      rows("booking_segments").filter(
        s => s.flightId === flightId && s.status === "confirmed"
      );
    expect(segmentsOf(OLD)).toHaveLength(0);
    expect(segmentsOf(SAME_FARE).map(s => s.bookingId)).toEqual([BOOKING]);
    expect(segmentsOf(FIRST).map(s => s.bookingId)).toEqual([BOOKING]);
    // Capacity view: the seat count moved from the old flight to the new one.
    const after = Object.fromEntries(
      rows("flights").map(f => [f.id, f.economyAvailable])
    );
    expect(Object.fromEntries(before)).toEqual({
      ...after,
      [OLD]: after[OLD] - 1,
      [SAME_FARE]: after[SAME_FARE] + 1,
    });
    // Loyalty view: miles recompute from the booking's net funding, which the exchange updates.
    expect(rows("bookings")[0].totalAmount).toBe(19000);
    const miles = await fixture.db.transaction((tx: any) =>
      syncBookingMiles(tx, BOOKING, 1)
    );
    expect(miles.baseMiles).toBeGreaterThan(0);
    // Delivery impact: with an unreconciled baggage or meal entitlement on the booking the
    // exchange is refused before any hold, quote or seat change, not silently orphaned.
    for (const service of [44, 45]) {
      seed([
        {
          id: 62,
          bookingId: BOOKING,
          passengerId: PAX,
          ancillaryServiceId: service,
          quantity: 1,
          unitPrice: 3000,
          totalPrice: 3000,
          segmentId: 22,
          scopeState: "specific_segment",
          status: "active",
          fundedAt: new Date("2026-10-01T10:00:00Z"),
          weightSnapshotGrams: service === 44 ? 20000 : null,
          metadata: JSON.stringify({ fulfillment: "entitlement_created" }),
        },
      ]);
      await expect(quote(SAME_FARE)).rejects.toThrow(
        "Existing ancillary fulfillment must be reconciled before itinerary exchange"
      );
      expect(rows("booking_modifications")).toHaveLength(0);
      expect(rows("inventory_locks")).toHaveLength(0);
      expect(seatRow(OLD_SEAT).status).toBe("occupied");
      expect(coupons().map(c => c.status)).toEqual(["O", "O"]);
    }
  });

  it("(i) coupon lifecycle across the exchange and the accountant's trace from difference to provider receipt and reconciliation row", async () => {
    const original = coupons();
    const q = await quote(PRICIER);
    await createOrderServiceCheckout(
      q.modificationId,
      1,
      "https://ais.example",
      3,
      consentFor(q)
    );
    await paid(q.modificationId, 2000);
    const final = coupons();
    expect(final[0]).toEqual(original[0]); // sector 1: unchanged, still O (would be C after check-in)
    expect(final[1]).toEqual({ ...original[1], status: "E" }); // sector 2 old: exchanged
    expect(final[2]).toMatchObject({ flightId: PRICIER, status: "O" }); // sector 2 new: open
    expect(rows("ticket_coupons").map(c => c.couponNumber)).toEqual([1, 2, 3]);
    expect(
      rows("ticket_coupons").every(
        c => c.ticketNumber === TICKET && c.passengerId === PAX
      )
    ).toBe(true);
    // Difference -> receipt -> ledger -> reconciliation join, as comparePayoutEvidence reads it.
    const mod = change(q.modificationId);
    const receipt = rows("payment_receipts").find(
      r => r.kind === "modification"
    );
    const ledger = ledgerCharges().find(
      l => l.stripePaymentIntentId === receipt.paymentIntentId
    );
    expect(mod.totalCost).toBe(2000);
    expect(receipt).toMatchObject({
      targetId: mod.id,
      amount: mod.totalCost,
      bookingId: BOOKING,
      userId: 1,
      currency: "SAR",
    });
    expect(ledger).toMatchObject({
      bookingId: receipt.bookingId,
      userId: receipt.userId,
      type: "charge",
      currency: receipt.currency,
      amount: (receipt.amount / 100).toFixed(2),
      stripeEventId: "evt_mod",
    });
    expect(mod.stripePaymentIntentId).toBe(receipt.paymentIntentId);
    expect(
      rows("payments").find(p => p.stripePaymentIntentId === "pi_mod")
    ).toMatchObject({
      bookingId: BOOKING,
      amount: 2000,
      idempotencyKey: "stripe:pi_mod",
    });
    // The consent that authorised the amount is on the executed record.
    expect(mod.servicingPayload.consent).toMatchObject({
      quoteVersion: q.quoteVersion,
      totalCost: 2000,
    });
    expect(
      rows("outbox").find(e => e.eventType === "order.servicing_applied")
        .eventId
    ).toBe(mod.executionEventId);
  });
});

describe("consent is the last gate: business refusals keep their messages without it", () => {
  it("surfaces state and expiry refusals before asking for consent, then requires consent only for a voluntary exchange", async () => {
    const q = await quote(SAME_FARE);
    expect(q.totalCost).toBe(0);
    // Booking state refusal first (no consent sent).
    rows("bookings")[0].checkedIn = true;
    await expect(
      confirmNoChargeService(q.modificationId, 1, 3)
    ).rejects.toThrow("Booking is no longer serviceable");
    rows("bookings")[0].checkedIn = false;
    // Expiry refusal first (no consent sent).
    const stored = change(q.modificationId).servicingPayload;
    change(q.modificationId).servicingPayload = {
      ...stored,
      expiresAt: new Date(0).toISOString(),
    };
    await expect(
      confirmNoChargeService(q.modificationId, 1, 3)
    ).rejects.toThrow("Servicing quote expired or booking changed");
    change(q.modificationId).servicingPayload = stored;
    // A valid voluntary exchange without consent is refused with the clear message, unchanged.
    await expect(
      confirmNoChargeService(q.modificationId, 1, 3)
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: CONSENT_REQUIRED,
    });
    expect(coupons().map(c => c.status)).toEqual(["O", "O"]);
    expect(seatRow(OLD_SEAT).status).toBe("occupied");
    // A quote that carries revalidation evidence is not a voluntary exchange: the
    // consent gate does not apply to it (its own evidence checks do).
    const { assertServicingConsent, planSchema } =
      await import("../services/order-servicing.service");
    const plan = planSchema.parse(stored);
    expect(() =>
      assertServicingConsent(change(q.modificationId), undefined, {
        ...plan,
        revalidation: {} as never,
      })
    ).not.toThrow();
    expect(() =>
      assertServicingConsent(change(q.modificationId), undefined, {
        ...plan,
        segments: [],
      })
    ).not.toThrow();
    // With consent the same quote executes.
    await confirmNoChargeService(
      q.modificationId,
      1,
      3,
      undefined,
      consentFor(q)
    );
    expect(change(q.modificationId).status).toBe("completed");
  });

  it("paid checkout: the quote's preconditions are judged before consent and no provider call precedes either", async () => {
    const q = await quote(PRICIER);
    rows("bookings")[0].totalAmount += 1;
    await expect(
      createOrderServiceCheckout(q.modificationId, 1, "https://ais.example", 3)
    ).rejects.toThrow("Servicing quote expired or booking changed");
    rows("bookings")[0].totalAmount -= 1;
    await expect(
      createOrderServiceCheckout(q.modificationId, 1, "https://ais.example", 3)
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: CONSENT_REQUIRED,
    });
    expect(boundary.checkout).not.toHaveBeenCalled();
    expect(change(q.modificationId).checkoutRequestId).toBeFalsy();
    await createOrderServiceCheckout(
      q.modificationId,
      1,
      "https://ais.example",
      3,
      consentFor(q)
    );
    expect(boundary.checkout).toHaveBeenCalledTimes(1);
  });
});

describe("who accepted the quote is recorded; a station agent supplies an explicit authorisation", () => {
  it("records the passenger as acceptor on the client path", async () => {
    const q = await quote(SAME_FARE);
    await confirmNoChargeService(
      q.modificationId,
      1,
      3,
      undefined,
      consentFor(q)
    );
    expect(change(q.modificationId).servicingPayload.consent).toMatchObject({
      quoteVersion: q.quoteVersion,
      totalCost: 0,
      acceptedBy: { kind: "passenger", actorId: 1 },
    });
  });

  it("station path: the agent's authorisation is derived from the held quote, cross-checked and recorded; without it the gate refuses", async () => {
    const q = await quote(SAME_FARE);
    const row = change(q.modificationId);
    // Without any acceptance the desk path is refused like any other caller.
    await expect(
      confirmNoChargeService(q.modificationId, 1, 3, undefined)
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: CONSENT_REQUIRED,
    });
    // An agent re-asserting a different refund than the quote holds is refused before anything executes.
    expect(() =>
      stationServicingAcceptance(row, {
        actorId: 501,
        reason: "Passenger asked to move to the later departure",
        reference: "dcs-operation-event:77",
        expectedRefund: 1,
      })
    ).toThrow("Downgrade terms have changed");
    expect(change(q.modificationId).status).toBe("pending");
    const authorisation = stationServicingAcceptance(row, {
      actorId: 501,
      reason: "Passenger asked to move to the later departure",
      reference: "dcs-operation-event:77",
      expectedRefund: 0,
    });
    expect(authorisation).toMatchObject({
      quoteVersion: q.quoteVersion,
      totalCost: 0,
      currency: "SAR",
      acceptedBy: { kind: "station_agent", actorId: 501 },
    });
    // The same gate accepts it: version and amount still have to match the row.
    await expect(
      confirmNoChargeService(q.modificationId, 1, 3, undefined, {
        ...authorisation,
        totalCost: 5,
      })
    ).rejects.toThrow(CONSENT_MISMATCH);
    await confirmNoChargeService(
      q.modificationId,
      1,
      3,
      undefined,
      authorisation
    );
    expect(change(q.modificationId)).toMatchObject({ status: "completed" });
    expect(change(q.modificationId).servicingPayload.consent).toMatchObject({
      quoteVersion: q.quoteVersion,
      totalCost: 0,
      acceptedBy: {
        kind: "station_agent",
        actorId: 501,
        reason: "Passenger asked to move to the later departure",
        reference: "dcs-operation-event:77",
      },
    });
    expect(seatRow(SAME_FARE_SEAT)).toMatchObject({
      status: "occupied",
      passengerId: PAX,
    });
  });
});

describe("idempotency audit findings (workstream 13), as they stand on main", () => {
  it("F2: a quote without a client key derives its key from the request, so a retry replays the same quote", async () => {
    const base = {
      bookingId: BOOKING,
      userId: 1,
      tenantId: 3,
      replaceFlightId: OLD,
      newFlightId: PRICIER,
    };
    const first = await requestChangeFlightDate({ ...base });
    expect(await requestChangeFlightDate({ ...base })).toEqual(first);
    expect(rows("booking_modifications")).toHaveLength(1);
    expect(rows("idempotency_requests").map(r => r.scope)).toContain(
      "booking.modification.quote"
    );
    // A client-owned key behaves the same way and never collides with the derived one.
    const key = randomUUID();
    await cancelOrderServiceQuote(first.modificationId, 1, 3);
    const keyed = await requestChangeFlightDate({
      ...base,
      idempotencyKey: key,
    });
    expect(keyed.modificationId).not.toBe(first.modificationId);
    expect(
      await requestChangeFlightDate({ ...base, idempotencyKey: key })
    ).toEqual(keyed);
    expect(rows("booking_modifications")).toHaveLength(2);
    // Edge recorded for the owner: after cancelling a quote, the same request
    // without a client key replays the cancelled quote's stored response, since
    // the derived key has no lifetime. The dialog always sends a key.
    await cancelOrderServiceQuote(keyed.modificationId, 1, 3);
    const replayed = await requestChangeFlightDate({ ...base });
    expect(replayed.modificationId).toBe(first.modificationId);
    expect(change(first.modificationId).status).toBe("rejected");
  });

  it("F1: a legacy modification checkout is a frozen, keyed provider operation and refuses replay after 23 hours", async () => {
    const legacy = {
      id: 900,
      bookingId: BOOKING,
      userId: 1,
      modificationType: "change_date",
      originalFlightId: OLD,
      originalCabinClass: "economy",
      originalAmount: 19000,
      newFlightId: PRICIER,
      newCabinClass: "economy",
      newAmount: 21000,
      priceDifference: 2000,
      modificationFee: 0,
      totalCost: 2000,
      status: "pending",
      paymentStatus: "pending",
      servicingPayload: null,
      createdAt: new Date(),
    };
    rows("booking_modifications").push(legacy);
    const { paymentsRouter } = await import("../routers/payments");
    const caller = paymentsRouter.createCaller({
      user: { id: 1, role: "user", email: null, name: null },
      tenantId: 3,
      authMethod: "cookie",
      req: { protocol: "https", headers: { host: "ais.example" } },
    } as unknown as TrpcContext);
    const request = {
      bookingId: BOOKING,
      modificationId: 900,
      provider: "stripe" as const,
    };
    const first = await caller.createModificationCheckout(request);
    const second = await caller.createModificationCheckout(request);
    expect(second).toEqual(first);
    // One operation key named by the modification and its amount, identical
    // params on every attempt: a retry is a replay, never a second charge.
    expect(boundary.checkout.mock.calls).toHaveLength(2);
    expect(boundary.checkout.mock.calls[0][1]).toMatchObject({
      idempotencyKey: "modification.checkout:900:2000",
      maxNetworkRetries: 0,
    });
    expect(boundary.checkout.mock.calls[1]).toEqual(
      boundary.checkout.mock.calls[0]
    );
    expect(
      boundary.checkout.mock.calls[0][0].line_items[0].price_data.unit_amount
    ).toBe(2000);
    // Beyond the safe replay age the row is handed to reconciliation before any provider call.
    boundary.checkout.mockClear();
    change(900).createdAt = new Date(Date.now() - 24 * 3600000);
    await expect(
      caller.createModificationCheckout(request)
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("provider reconciliation"),
    });
    expect(boundary.checkout).not.toHaveBeenCalled();
    // Servicing quotes additionally require the consent that binds version and amount.
    change(900).status = "rejected";
    const q = await quote(PRICIER);
    await expect(
      caller.createModificationCheckout({
        ...request,
        modificationId: q.modificationId,
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(boundary.checkout).not.toHaveBeenCalled();
  });
});
