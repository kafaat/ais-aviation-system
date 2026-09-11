import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { transactionMemory } from "./helpers/transaction-memory";
const state = vi.hoisted(() => ({
  db: null as any,
  create: vi.fn(),
  list: vi.fn(),
  retrieve: vi.fn(),
}));
vi.mock("../db", () => ({ getDb: () => state.db }));
vi.mock("../stripe", () => ({
  stripe: {
    refunds: {
      create: state.create,
      list: state.list,
      retrieve: state.retrieve,
    },
  },
}));
vi.mock("../services/email.service", () => ({}));
import {
  allocateSplitRefund,
  getSplitRefundCancellation,
  reserveSplitRefundCancellation,
  resumeSplitRefundCancellation,
  recordVerifiedSplitRefund,
  processPendingSplitRefunds,
  listSplitRefundCancellations,
} from "../services/split-refund.service";
import { settleVerifiedRefund } from "../services/payment-settlement.service";
import { cancelBookingResources } from "../services/booking-settlement.service";
import { getRefundDetails } from "../services/refunds.service";
import { performCheckIn } from "../services/kiosk.service";
import { checkIn as seatMapCheckIn } from "../services/seat-map.service";
import { refundsRouter } from "../routers/refunds";
import { processStripeEvent } from "../webhooks/stripe";
import { consumeLocalEvent } from "../services/event-inbox.service";
import { splitCancellationContract } from "../contracts/refunds";

let fixture: ReturnType<typeof transactionMemory>;
let provider: Map<string, Stripe.Refund>;
const owner = { id: 9, role: "user" };
const booking = () => fixture.rows("bookings")[0];
const items = () => fixture.rows("booking_refund_items");
const plan = () => fixture.rows("booking_refund_plans")[0];
const receipt = (split = 1) =>
  fixture.rows("payment_receipts").find(r => r.targetId === split)!;
const preview = () => getSplitRefundCancellation(7, owner);
const resume = (splitId = 1) =>
  resumeSplitRefundCancellation({ bookingId: 7, splitId }, owner);
const reserve = async () => {
  const q = (await preview()).quote!;
  return reserveSplitRefundCancellation(
    {
      bookingId: 7,
      quoteHash: q.quoteHash,
      reason: "requested_by_customer",
      notes: "Plans changed",
    },
    owner
  );
};
function refundFor(
  splitId = 1,
  status: NonNullable<Stripe.Refund["status"]> = "succeeded"
) {
  const i = items().find(i => i.splitId === splitId)!;
  return {
    id: `re_${i.id}`,
    object: "refund",
    payment_intent: i.paymentIntentId,
    charge: `ch_${splitId}`,
    amount: i.refundAmount,
    currency: "sar",
    metadata: JSON.parse(i.requestPayload).metadata,
    status,
    created: Math.floor(Date.now() / 1000),
    reason: "requested_by_customer",
  } as Stripe.Refund;
}
const verified = (refund: Stripe.Refund) =>
  fixture.db.transaction((tx: any) =>
    recordVerifiedSplitRefund(tx, refund, `evt_${refund.id}_${refund.status}`)
  );
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-11T12:00:00Z"));
  fixture = transactionMemory({
    bookings: [
      {
        id: 7,
        userId: 9,
        tenantId: 3,
        flightId: 4,
        bookingReference: "SPLIT7",
        pnr: "SPLIT7",
        totalAmount: 10001,
        status: "confirmed",
        paymentStatus: "paid",
        seatsReserved: true,
        cabinClass: "economy",
        numberOfPassengers: 1,
        checkedIn: false,
        stripePaymentIntentId: "pi_2",
      },
    ],
    flights: [4, 5].map(id => ({
      id,
      airlineId: 2,
      economyAvailable: 4,
      status: "scheduled",
      departureTime: new Date(`2026-09-${id === 4 ? "17" : "16"}T12:00:00Z`),
    })),
    booking_segments: [4, 5].map(flightId => ({
      id: flightId,
      bookingId: 7,
      flightId,
      seatsReserved: true,
      status: "confirmed",
    })),
    payment_splits: [4001, 6000].map((amount, n) => ({
      id: n + 1,
      bookingId: 7,
      amount,
      status: "paid",
      payerName: `Payer ${n + 1}`,
      payerEmail: `p${n}@example.invalid`,
      stripePaymentIntentId: `pi_${n + 1}`,
    })),
    payment_receipts: [4001, 6000].map((amount, n) => ({
      paymentIntentId: `pi_${n + 1}`,
      kind: "split_payment",
      bookingId: 7,
      userId: 9,
      targetId: n + 1,
      amount,
      currency: "SAR",
      refundedAmount: 0,
      settlementStatus: "applied",
    })),
    ndc_orders: [{ id: 1, bookingId: 7, status: "confirmed" }],
    booking_ancillaries: [{ id: 1, bookingId: 7, status: "active" }],
    seat_inventory: [
      { id: 1, bookingId: 7, passengerId: 1, status: "occupied" },
    ],
    passengers: [{ id: 1, bookingId: 7, seatNumber: "1A" }],
  });
  state.db = fixture.db;
  provider = new Map();
  state.list.mockImplementation(({ payment_intent }) => ({
    async *[Symbol.asyncIterator]() {
      for (const r of provider.values())
        if (r.payment_intent === payment_intent) yield structuredClone(r);
    },
  }));
  state.create.mockImplementation(async (request, options) => {
    if (!provider.has(options.idempotencyKey))
      provider.set(options.idempotencyKey, {
        ...refundFor(Number(request.metadata.splitId)),
        amount: request.amount,
      });
    return structuredClone(provider.get(options.idempotencyKey));
  });
  state.retrieve.mockImplementation(async id =>
    structuredClone([...provider.values()].find(r => r.id === id))
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("split cancellation invoice authority", () => {
  it("rejects all check-in paths after policy cancellation and detects partially checked-in groups", async () => {
    await reserve();
    await expect(performCheckIn(7, 1, {})).rejects.toThrow("Cannot check in");
    await expect(seatMapCheckIn(4, 7, 1)).rejects.toThrow("Cannot check in");
    expect(booking().checkedIn).toBe(false);
  });
  it("blocks refunding a group when only one passenger is checked in", async () => {
    fixture.rows("seat_inventory")[0].status = "checked_in";
    expect((await preview()).quote).toBeNull();
    expect((await preview()).reason).toContain("offload");
  });
  it("validates route authority and refuses client amounts or foreign split IDs", async () => {
    const context = {
      user: owner,
      authMethod: "bearer",
      tenantId: null,
      req: { headers: {}, ip: "127.0.0.1" },
      res: {},
    } as any;
    const caller = refundsRouter.createCaller(context);
    const q = (await caller.splitCancellation({ bookingId: 7 })).quote!;
    await expect(
      caller.cancelSplitBooking({
        bookingId: 7,
        quoteHash: q.quoteHash,
        amount: 1,
      } as any)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await caller.cancelSplitBooking({ bookingId: 7, quoteHash: q.quoteHash });
    await expect(
      caller.resumeSplitCancellation({ bookingId: 7, splitId: 99 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller.splitCancellationQueue({})).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(state.create).not.toHaveBeenCalled();
  });
  it("uses the earliest itinerary departure and conserves odd halalas", async () => {
    const q = (await preview()).quote!;
    expect(q).toMatchObject({
      totalAmount: 10001,
      cancellationFee: 2500,
      refundAmount: 7501,
    });
    expect(q.items.map(i => i.refundAmount)).toEqual([3001, 4500]);
    fixture.rows("flights")[1].departureTime = new Date("2026-09-12T12:00:00Z");
    expect((await preview()).quote!.refundAmount).toBe(5000);
    expect(plan()).toBeUndefined();
    expect(state.create).not.toHaveBeenCalled();
  });
  it("uses deterministic largest remainders without floating-point overflow", () => {
    expect(
      allocateSplitRefund(
        [
          { splitId: 3, amount: 100 },
          { splitId: 2, amount: 100 },
          { splitId: 1, amount: 100 },
        ],
        100
      ).map(i => i.refundAmount)
    ).toEqual([34, 33, 33]);
    const amounts = allocateSplitRefund(
      [
        { splitId: 1, amount: 1234567890 },
        { splitId: 2, amount: 765432100 },
      ],
      1500000000
    );
    expect(amounts.reduce((s, i) => s + i.refundAmount, 0)).toBe(1500000000);
    expect(amounts.every(i => i.refundAmount <= i.amount)).toBe(true);
  });
  it.each([0, -1, 301, 1.2, NaN])("rejects invalid refund allocation %s", n => {
    expect(() =>
      allocateSplitRefund(
        [
          { splitId: 1, amount: 100 },
          { splitId: 2, amount: 200 },
        ],
        n
      )
    ).toThrow();
  });
  it("rejects duplicate payers and invalid share amounts", () => {
    expect(() =>
      allocateSplitRefund(
        [
          { splitId: 1, amount: 100 },
          { splitId: 1, amount: 100 },
        ],
        100
      )
    ).toThrow();
    expect(() =>
      allocateSplitRefund(
        [
          { splitId: 1, amount: 100 },
          { splitId: 2, amount: -10 },
        ],
        50
      )
    ).toThrow();
  });
  it("reserves all requests and releases every resource once before provider calls", async () => {
    const q = (await preview()).quote!;
    await reserve();
    expect(booking()).toMatchObject({
      status: "cancelled",
      paymentStatus: "paid",
      seatsReserved: false,
    });
    expect(items()).toHaveLength(2);
    expect(plan()).toMatchObject({
      refundAmount: 7501,
      cancellationFee: 2500,
      notes: "Plans changed",
    });
    expect(fixture.rows("flights").map(f => f.economyAvailable)).toEqual([
      5, 5,
    ]);
    expect(fixture.rows("seat_inventory")[0]).toMatchObject({
      bookingId: null,
      passengerId: null,
      status: "available",
    });
    expect(fixture.rows("booking_ancillaries")[0].status).toBe("cancelled");
    expect(fixture.rows("ndc_orders")[0].status).toBe("cancelled");
    await reserveSplitRefundCancellation(
      { bookingId: 7, quoteHash: q.quoteHash, reason: "duplicate" },
      owner
    );
    expect(items()).toHaveLength(2);
    expect(fixture.rows("booking_status_history")).toHaveLength(1);
    expect(state.create).not.toHaveBeenCalled();
  });
  it("rolls back plans, requests, seats and ancillaries when outbox fails", async () => {
    fixture.failInsert("outbox");
    await expect(reserve()).rejects.toThrow("Injected insert failure");
    expect(plan()).toBeUndefined();
    expect(items()).toHaveLength(0);
    expect(booking()).toMatchObject({
      status: "confirmed",
      seatsReserved: true,
    });
    expect(fixture.rows("flights").map(f => f.economyAvailable)).toEqual([
      4, 4,
    ]);
    expect(fixture.rows("booking_ancillaries")[0].status).toBe("active");
  });
  it("rejects changed fee quotes without silently accepting a smaller refund", async () => {
    const q = (await preview()).quote!;
    vi.setSystemTime(new Date("2026-09-15T12:00:01Z"));
    await expect(
      reserveSplitRefundCancellation(
        { bookingId: 7, quoteHash: q.quoteHash, reason: "duplicate" },
        owner
      )
    ).rejects.toThrow("quote changed");
    expect(plan()).toBeUndefined();
    expect(booking().status).toBe("confirmed");
  });
  it.each([
    "unpaid",
    "checked_in",
    "completed",
    "refunded",
    "review",
    "wrong_owner",
    "missing_receipt",
    "mixed_funding",
    "departed",
    "missing_leg",
  ])("fails closed on %s", async condition => {
    if (condition === "unpaid") booking().paymentStatus = "pending";
    if (condition === "checked_in") booking().checkedIn = true;
    if (condition === "completed") booking().status = "completed";
    if (condition === "refunded") receipt().refundedAmount = 1;
    if (condition === "review") receipt().settlementStatus = "review_required";
    if (condition === "wrong_owner") receipt().userId = 99;
    if (condition === "missing_receipt") fixture.rows("payment_receipts").pop();
    if (condition === "mixed_funding") receipt().kind = "booking";
    if (condition === "departed")
      vi.setSystemTime(new Date("2026-09-16T12:00:01Z"));
    if (condition === "missing_leg") fixture.rows("flights").pop();
    expect((await preview()).quote).toBeNull();
    expect(plan()).toBeUndefined();
  });
  it("forbids direct resource cancellation without the refund decision", async () => {
    await expect(
      fixture.db.transaction((tx: any) =>
        cancelBookingResources(tx, booking(), "bypass")
      )
    ).rejects.toThrow("refund plan");
    expect(booking().seatsReserved).toBe(true);
  });
  it("requires owner or admin at both read and write boundaries", async () => {
    const q = (await preview()).quote!;
    for (const actor of [
      { id: 99, role: "user" },
      { id: 99, role: "airline_admin" },
    ]) {
      await expect(getSplitRefundCancellation(7, actor)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(
        reserveSplitRefundCancellation(
          { bookingId: 7, quoteHash: q.quoteHash, reason: "duplicate" },
          actor
        )
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        resumeSplitRefundCancellation({ bookingId: 7, splitId: 1 }, actor)
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect(
      (await getSplitRefundCancellation(7, { id: 99, role: "admin" })).quote
    ).not.toBeNull();
    expect(state.list).not.toHaveBeenCalled();
  });
  it("returns ordinary bookings to the existing workflow and omits secrets from DTOs", async () => {
    const result = splitCancellationContract.parse(await preview());
    expect(JSON.stringify(result)).not.toContain("pi_1");
    expect(JSON.stringify(result)).not.toContain("payerEmail");
    fixture.rows("payment_splits").forEach(s => {
      s.stripePaymentIntentId = null;
    });
    expect(await preview()).toMatchObject({
      splitFunded: false,
      quote: null,
      plan: null,
    });
  });
});

describe("durable payer refund execution", () => {
  it("delivers one completion notification to the booking owner through the durable inbox", async () => {
    await reserve();
    await resume(1);
    await resume(2);
    const event = fixture
      .rows("outbox")
      .find(e => e.eventType === "booking.split_refund_completed")!;
    await consumeLocalEvent(event);
    await consumeLocalEvent(event);
    expect(fixture.rows("notifications")).toHaveLength(1);
    expect(fixture.rows("notifications")[0]).toMatchObject({
      userId: 9,
      title: "Payer Refunds Confirmed",
    });
  });
  it("routes all three refund event types through the canonical webhook dispatcher", async () => {
    await reserve();
    const r = refundFor(1, "pending");
    for (const [type, status] of [
      ["refund.created", "pending"],
      ["refund.failed", "failed"],
      ["refund.updated", "succeeded"],
    ])
      await fixture.db.transaction((tx: any) =>
        processStripeEvent(tx, {
          type,
          id: `evt_${type}`,
          data: { object: { ...r, status } },
        } as Stripe.Event)
      );
    expect(items()[0].status).toBe("failed");
    expect(receipt().refundedAmount).toBe(0);
  });
  it("quarantines corrupted saved request payloads before any provider access", async () => {
    await reserve();
    const request = JSON.parse(items()[0].requestPayload);
    request.amount++;
    items()[0].requestPayload = JSON.stringify(request);
    await resume();
    expect(items()[0].errorCode).toBe("invalid_refund_request");
    expect(state.list).not.toHaveBeenCalled();
  });
  it("returns each policy share to its original intent and keeps the fee without double charging it", async () => {
    await reserve();
    await resume(1);
    await resume(2);
    expect(
      state.create.mock.calls.map(c => [c[0].payment_intent, c[0].amount])
    ).toEqual([
      ["pi_1", 3001],
      ["pi_2", 4500],
    ]);
    expect(plan().status).toBe("completed");
    expect(booking()).toMatchObject({
      status: "cancelled",
      paymentStatus: "paid",
      seatsReserved: false,
    });
    expect(
      fixture.rows("financial_ledger").map(r => [r.type, r.amount])
    ).toEqual([
      ["partial_refund", "30.01"],
      ["partial_refund", "45.00"],
    ]);
    expect(receipt(1).refundedAmount + receipt(2).refundedAmount).toBe(7501);
    expect(fixture.rows("flights").map(f => f.economyAvailable)).toEqual([
      5, 5,
    ]);
    await resume(1);
    await resume(2);
    expect(state.create).toHaveBeenCalledTimes(2);
  });
  it("completes full refunds without releasing inventory twice", async () => {
    fixture.rows("flights").forEach(f => {
      f.departureTime = new Date("2026-10-01");
    });
    await reserve();
    await resume(2);
    await resume(1);
    expect(booking().paymentStatus).toBe("refunded");
    expect(plan().cancellationFee).toBe(0);
    expect(plan().status).toBe("completed");
    expect(fixture.rows("flights").map(f => f.economyAvailable)).toEqual([
      5, 5,
    ]);
  });
  it("recovers a lost provider response using the exact saved request, without another refund", async () => {
    await reserve();
    const create = state.create.getMockImplementation()!;
    state.create.mockImplementationOnce(async (...args) => {
      await create(...args);
      throw new Error("lost response");
    });
    await resume(1);
    expect(items()[0]).toMatchObject({
      status: "requesting",
      errorCode: "provider_unavailable",
    });
    expect(receipt().refundedAmount).toBe(0);
    await resume(1);
    expect(items()[0].status).toBe("succeeded");
    expect(state.create).toHaveBeenCalledTimes(1);
    expect(provider.size).toBe(1);
  });
  it("reuses the frozen key and body when no provider operation is visible", async () => {
    await reserve();
    state.create.mockRejectedValueOnce(new Error("not reached"));
    await resume();
    vi.setSystemTime(new Date("2026-09-11T13:00:00Z"));
    await resume();
    expect(state.create.mock.calls[0]).toEqual(state.create.mock.calls[1]);
    expect(receipt().refundedAmount).toBe(3001);
  });
  it("quarantines a missing outcome after 23h and can recover it later by listing only", async () => {
    await reserve();
    state.create.mockRejectedValueOnce(new Error("unknown"));
    await resume();
    vi.setSystemTime(new Date("2026-09-12T12:00:00Z"));
    await resume();
    expect(items()[0].errorCode).toBe("unknown_provider_outcome");
    expect(state.create).toHaveBeenCalledTimes(1);
    provider.set("later", refundFor());
    await resume();
    expect(items()[0].status).toBe("succeeded");
    expect(state.create).toHaveBeenCalledTimes(1);
  });
  it("does not age unstarted shares out of the provider retry window", async () => {
    await reserve();
    vi.setSystemTime(new Date("2026-09-14T12:00:00Z"));
    await resume();
    expect(items()[0].status).toBe("succeeded");
    expect(plan().refundAmount).toBe(7501);
  });
  it("continues remaining shares after partial external failure", async () => {
    await reserve();
    state.create.mockRejectedValueOnce(new Error("outage"));
    await processPendingSplitRefunds();
    expect(items().map(i => i.status)).toEqual(["requesting", "succeeded"]);
    vi.setSystemTime(new Date("2026-09-11T12:02:00Z"));
    await processPendingSplitRefunds();
    expect(plan().status).toBe("completed");
    expect(provider.size).toBe(2);
  });
  it("never treats a pending provider refund or aggregate charge event as success", async () => {
    await reserve();
    const r = refundFor(1, "pending");
    provider.set("pending", r);
    await resume();
    await fixture.db.transaction((tx: any) =>
      settleVerifiedRefund(tx, {
        paymentIntentId: "pi_1",
        chargeId: "ch_1",
        amount: 4001,
        amountRefunded: 3001,
        currency: "sar",
        eventId: "evt_charge_pending",
      })
    );
    expect(items()[0].status).toBe("pending");
    expect(receipt().refundedAmount).toBe(0);
    expect(fixture.rows("financial_ledger")).toHaveLength(0);
    r.status = "succeeded";
    await resume();
    expect(receipt().refundedAmount).toBe(3001);
    expect(state.retrieve).toHaveBeenCalledWith(r.id, expect.any(Object));
  });
  it("handles a verified webhook before the API response and ignores stale pending replays", async () => {
    await reserve();
    const r = refundFor();
    state.create.mockImplementationOnce(async () => {
      await verified(r);
      return r;
    });
    await resume();
    await verified(r);
    await verified({ ...r, status: "pending" });
    expect(items()[0].status).toBe("succeeded");
    expect(fixture.rows("financial_ledger")).toHaveLength(1);
  });
  it.each([
    "wrong_intent",
    "wrong_amount",
    "wrong_currency",
    "wrong_metadata",
    "wrong_charge",
  ])("quarantines %s before recording any refund", async fault => {
    await reserve();
    const r = refundFor();
    if (fault === "wrong_intent") r.payment_intent = "pi_foreign";
    if (fault === "wrong_amount") r.amount++;
    if (fault === "wrong_currency") r.currency = "usd";
    if (fault === "wrong_metadata")
      r.metadata = { refundRequestId: items()[0].id };
    if (fault === "wrong_charge") r.charge = null;
    state.create.mockResolvedValueOnce(r);
    await resume();
    expect(items()[0]).toMatchObject({
      status: "review_required",
      errorCode: "provider_refund_conflict",
    });
    expect(receipt().refundedAmount).toBe(0);
  });
  it("detects an unrelated active provider refund before issuing the planned refund", async () => {
    await reserve();
    provider.set("foreign", { ...refundFor(), metadata: {} });
    await resume();
    expect(items()[0].status).toBe("review_required");
    expect(state.create).not.toHaveBeenCalled();
  });
  it("ignores unrelated failed provider refunds, but never replaces a failed planned refund automatically", async () => {
    await reserve();
    provider.set("old", { ...refundFor(1, "failed"), metadata: {} });
    state.create.mockResolvedValueOnce(refundFor(1, "failed"));
    await resume();
    await resume();
    expect(items()[0].status).toBe("failed");
    expect(plan().status).toBe("review_required");
    expect(state.create).toHaveBeenCalledTimes(1);
    expect(receipt().refundedAmount).toBe(0);
    await verified(refundFor(1));
    expect(items()[0].status).toBe("failed");
  });
  it("routes a later bank reversal to review without claiming completion or issuing more money", async () => {
    await reserve();
    await resume(1);
    await resume(2);
    await verified(refundFor(1, "failed"));
    expect(plan().status).toBe("review_required");
    expect(items()[0].errorCode).toBe("provider_reversed_refund");
    await verified(refundFor());
    await resume();
    expect(items()[0].status).toBe("review_required");
    expect(state.create).toHaveBeenCalledTimes(2);
  });
  it("shows required payer action and enforces scheduled due times", async () => {
    await reserve();
    provider.set("pending", refundFor(1, "requires_action"));
    await resume();
    expect(items()[0]).toMatchObject({
      status: "pending",
      errorCode: "provider_action_required",
    });
    expect((await processPendingSplitRefunds()).scanned).toBe(1);
    expect((await processPendingSplitRefunds()).scanned).toBe(0);
  });
  it("rolls back item success and receipt/ledger if event persistence fails", async () => {
    await reserve();
    fixture.failInsert("outbox");
    await resume();
    expect(items()[0].status).toBe("requesting");
    expect(receipt().refundedAmount).toBe(0);
    expect(fixture.rows("financial_ledger")).toHaveLength(0);
    fixture.failInsert("none");
    await resume();
    expect(items()[0].status).toBe("succeeded");
    expect(provider.size).toBe(1);
  });
  it("keeps non-plan refund events outside this authority", async () => {
    expect(
      await verified({ payment_intent: "pi_other" } as Stripe.Refund)
    ).toBe(false);
    expect(await verified({ payment_intent: null } as Stripe.Refund)).toBe(
      false
    );
  });
  it("allows refund detail lookup for every original payer only to booking owner or admin", async () => {
    await reserve();
    await resume();
    const r = [...provider.values()][0];
    expect(await getRefundDetails(r.id, owner)).toMatchObject({
      id: r.id,
      amount: 3001,
    });
    await expect(
      getRefundDetails(r.id, { id: 99, role: "user" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(listSplitRefundCancellations({}, owner)).rejects.toMatchObject(
      { code: "FORBIDDEN" }
    );
    expect(
      (await listSplitRefundCancellations({}, { id: 99, role: "admin" })).items
    ).toHaveLength(1);
  });
});
