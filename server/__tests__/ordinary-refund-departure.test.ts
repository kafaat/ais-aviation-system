import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";

const boundary = vi.hoisted(() => ({ db: null as any, refund: null as any }));
vi.mock("../db", () => ({ getDb: () => boundary.db }));
vi.mock("../stripe", () => ({
  stripe: {
    refunds: {
      create: async (request: any) => {
        boundary.refund = {
          id: "re_departure_hold",
          status: "pending",
          amount: request.amount,
          currency: "sar",
          payment_intent: request.payment_intent,
          charge: "ch_departure_hold",
          metadata: request.metadata,
        };
        return boundary.refund;
      },
      retrieve: async () => boundary.refund,
      list: () => ({
        async *[Symbol.asyncIterator]() {
          if (boundary.refund) yield boundary.refund;
        },
      }),
    },
  },
}));
vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));

import { checkInPassengers } from "../services/departure-control.service";
import {
  checkInDcsPassenger,
  transitionDcsPassenger,
} from "../services/dcs-operations.service";
import {
  issueBoardingPass,
  verifyActiveBoardingPass,
} from "../services/boarding-pass.service";
import {
  reserveOrdinaryRefundCancellation,
  processOrdinaryRefundCancellation,
} from "../services/ordinary-refund.service";
import { performCheckIn } from "../services/kiosk.service";
import { settleVerifiedRefund } from "../services/payment-settlement.service";
import {
  cancelBookingResources,
  DepartureReleaseError,
} from "../services/booking-settlement.service";

const now = new Date("2030-06-10T06:00:00Z");
const key = { bookingId: 3, passengerId: 4, flightId: 11 };
const owner = { userId: 7, tenantId: 1, role: "user" };
const operator = { userId: 20, tenantId: 1, role: "ops" };
let fixture: ReturnType<typeof transactionMemory>;
let sequence = 0;
const command = () => ({
  idempotencyKey: `refund-admission-${++sequence}`,
  reason: "Controlled cancellation admission regression",
});
const onlineCheckIn = () =>
  checkInPassengers({
    bookingId: key.bookingId,
    flightId: key.flightId,
    assignments: [{ passengerId: key.passengerId, seatNumber: "1A" }],
    owner,
  });
const dcsCheckIn = () =>
  checkInDcsPassenger({ ...key, seatNumber: "1A", ...command() }, operator);
const kioskCheckIn = () =>
  performCheckIn(key.bookingId, key.passengerId, {
    seatNumber: "1A",
    flightId: key.flightId,
  });
const board = () =>
  transitionDcsPassenger({ ...key, action: "board", ...command() }, operator);
const evidence = () =>
  structuredClone({
    booking: fixture.rows("bookings"),
    seats: fixture.rows("seat_inventory"),
    coupons: fixture.rows("ticket_coupons"),
    attendance: fixture.rows("dcs_passenger_states"),
    movements: fixture.rows("financial_ledger"),
    receipts: fixture.rows("payment_receipts"),
  });
const intent = () => fixture.rows("ordinary_booking_refunds")[0];
const receipt = () => fixture.rows("payment_receipts")[0];
const cancellation = {
  bookingId: 3,
  actor: { id: 7, role: "user" },
  userId: 7,
  tenantId: 1,
  baseRefundedAmount: 0,
  request: {
    payment_intent: "pi_departure_hold",
    amount: 5000,
    reason: "requested_by_customer" as const,
    metadata: {
      bookingId: "3",
      refundOperationId: "booking-3-cancel-pi_departure_hold",
    },
  },
};

async function pending() {
  await reserveOrdinaryRefundCancellation(fixture.db, cancellation);
  expect((await processOrdinaryRefundCancellation(3)).status).toBe("pending");
}
async function terminal(status: "failed" | "canceled") {
  boundary.refund.status = status;
  await processOrdinaryRefundCancellation(3);
  expect(intent()).toMatchObject({ status: "failed", providerStatus: status });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  sequence = 0;
  boundary.refund = null;
  fixture = transactionMemory({
    tenants: [{ id: 1, status: "active" }],
    users: [
      { id: 7, tenantId: 1, role: "user" },
      { id: 20, tenantId: 1, role: "ops" },
    ],
    bookings: [
      {
        id: 3,
        userId: 7,
        tenantId: 1,
        flightId: 11,
        bookingReference: "RF0003",
        pnr: "RF0003",
        status: "confirmed",
        paymentStatus: "paid",
        seatsReserved: true,
        checkedIn: false,
        totalAmount: 10000,
        cabinClass: "economy",
        numberOfPassengers: 1,
        stripePaymentIntentId: "pi_departure_hold",
        deletedAt: null,
      },
    ],
    airlines: [{ id: 1, code: "SV", name: "Controlled Carrier" }],
    airports: [
      {
        id: 1,
        code: "RUH",
        name: "Origin",
        city: "Riyadh",
        country: "SA",
        timezone: "Asia/Riyadh",
      },
      {
        id: 2,
        code: "JED",
        name: "Destination",
        city: "Jeddah",
        country: "SA",
        timezone: "Asia/Riyadh",
      },
    ],
    flights: [
      {
        id: 11,
        tenantId: 1,
        airlineId: 1,
        flightNumber: "SV0011",
        originId: 1,
        destinationId: 2,
        status: "scheduled",
        departureTime: new Date("2030-06-10T12:00:00Z"),
        arrivalTime: new Date("2030-06-10T14:00:00Z"),
        dcsClosedAt: null,
        economyAvailable: 7,
        economySeats: 8,
      },
    ],
    passengers: [
      {
        id: 4,
        bookingId: 3,
        tenantId: 1,
        firstName: "Ada",
        lastName: "Fixture",
        type: "adult",
        ticketNumber: "0651234567894",
        seatNumber: null,
      },
    ],
    seat_inventory: [
      {
        id: 1,
        flightId: 11,
        seatMapId: 1,
        seatNumber: "1A",
        row: 1,
        column: "A",
        cabinClass: "economy",
        status: "available",
        seatPrice: 0,
        bookingId: null,
        passengerId: null,
        assignedAt: null,
        checkedInAt: null,
        checkInNonce: null,
        boardingGroup: null,
        boardingSequence: null,
        boardingPassIssued: false,
      },
    ],
    ticket_coupons: [
      {
        id: 1,
        bookingId: 3,
        passengerId: 4,
        flightId: 11,
        ticketNumber: "0651234567894",
        couponNumber: 1,
        status: "O",
      },
    ],
    payment_receipts: [
      {
        paymentIntentId: "pi_departure_hold",
        bookingId: 3,
        targetId: 3,
        userId: 7,
        kind: "booking",
        amount: 10000,
        refundedAmount: 0,
        currency: "SAR",
        settlementStatus: "applied",
        settlementError: null,
      },
    ],
  });
  boundary.db = fixture.db;
});
afterEach(() => vi.useRealTimers());

describe("ordinary refund departure admission (controlled relational/provider boundaries)", () => {
  it("refuses a new cancellation after boarding commits first on an open flight", async () => {
    await onlineCheckIn();
    await board();
    const before = evidence();
    await expect(pending()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("Boarded passenger"),
    });
    expect(evidence()).toEqual(before);
    expect(fixture.rows("ordinary_booking_refunds")).toHaveLength(0);
    expect(boundary.refund).toBeNull();
  });

  it("does not directly release an open-flight booking with boarded attendance", async () => {
    await onlineCheckIn();
    await board();
    const before = evidence();
    await expect(
      fixture.db.transaction((tx: any) =>
        cancelBookingResources(
          tx,
          fixture.rows("bookings")[0],
          "Direct cancellation control",
          7
        )
      )
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("Boarded passenger"),
    });
    expect(evidence()).toEqual(before);
  });

  it("blocks new admission on a boarded cash-reconciliation receipt without an ordinary intent", async () => {
    await onlineCheckIn();
    const pass = await issueBoardingPass(key, owner);
    await board();
    await fixture.db.transaction((tx: any) =>
      settleVerifiedRefund(tx, {
        paymentIntentId: "pi_departure_hold",
        chargeId: "ch_boarded_full_refund",
        eventId: "evt_boarded_full_refund",
        amount: 10000,
        amountRefunded: 10000,
        currency: "sar",
      })
    );
    expect(receipt()).toMatchObject({
      refundedAmount: 10000,
      settlementStatus: "review_required",
      settlementError: DepartureReleaseError.boardedReason,
    });
    expect(fixture.rows("ordinary_booking_refunds")).toEqual([]);
    expect(await verifyActiveBoardingPass(pass.token)).toMatchObject({
      valid: false,
    });
    await expect(issueBoardingPass(key, owner)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringMatching(/departure reconciliation/i),
    });
    expect(fixture.rows("dcs_passenger_states")[0].state).toBe("boarded");
    expect(fixture.rows("ticket_coupons")[0].status).toBe("C");
    expect(fixture.rows("financial_ledger")).toMatchObject([
      { type: "refund", amount: "100.00" },
    ]);
  });

  it("records an authenticated late cancellation refund without erasing boarded carriage, and retains physical recovery", async () => {
    await onlineCheckIn();
    const pass = await issueBoardingPass(key, owner);
    await board();
    const before = evidence();
    // A provider result from a pre-existing cancellation must be adopted even
    // when it arrives after boarding. This is controlled cash evidence, not a
    // request to create another provider refund.
    const refund = {
      ...cancellation.request,
      id: "re_late_boarded",
      object: "refund" as const,
      status: "succeeded" as const,
      currency: "sar",
      charge: "ch_late_boarded",
    } as any;
    await reserveOrdinaryRefundCancellation(fixture.db, {
      ...cancellation,
      existingRefund: refund,
    });
    await processOrdinaryRefundCancellation(3, refund);
    expect(receipt()).toMatchObject({
      refundedAmount: 5000,
      settlementStatus: "review_required",
      settlementError: DepartureReleaseError.boardedReason,
    });
    expect(intent()).toMatchObject({
      status: "review_required",
      errorCode: "cancellation_reconciliation_required",
    });
    expect(intent().completedAt).toBeFalsy();
    expect(fixture.rows("financial_ledger")).toMatchObject([
      { type: "partial_refund", amount: "50.00" },
    ]);
    const after = evidence();
    for (const field of ["booking", "seats", "coupons", "attendance"] as const)
      expect(after[field]).toEqual(before[field]);
    expect(await verifyActiveBoardingPass(pass.token)).toMatchObject({
      valid: false,
    });
    for (const action of ["deplane", "offload"] as const)
      await expect(
        transitionDcsPassenger({ ...key, action, ...command() }, operator)
      ).resolves.toMatchObject({
        state: action === "deplane" ? "checked_in" : "offloaded",
      });
    expect(fixture.rows("dcs_passenger_states")[0].state).toBe("offloaded");
    expect(fixture.rows("ticket_coupons")[0].status).toBe("O");
    expect(fixture.rows("bookings")[0]).toMatchObject({
      status: "confirmed",
      paymentStatus: "paid",
      seatsReserved: true,
    });
    expect(receipt().settlementStatus).toBe("review_required");
    expect(receipt().refundedAmount).toBe(5000);
    expect(fixture.rows("financial_ledger")).toHaveLength(1);
    expect(boundary.refund).toBeNull();
  });

  it.each(["online", "dcs", "kiosk"])(
    "blocks new %s check-in after a real cancellation command receives pending",
    async channel => {
      await pending();
      const before = evidence();
      await expect(
        channel === "online"
          ? onlineCheckIn()
          : channel === "dcs"
            ? dcsCheckIn()
            : kioskCheckIn()
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(evidence()).toEqual(before);
    }
  );

  it("blocks boarding an already checked-in passenger while the cancellation is pending", async () => {
    await onlineCheckIn();
    await pending();
    const before = evidence();
    await expect(board()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(evidence()).toEqual(before);
  });

  it("rejects a pass issued before cancellation and refuses new pass issuance", async () => {
    await onlineCheckIn();
    const pass = await issueBoardingPass(key, owner);
    expect(await verifyActiveBoardingPass(pass.token)).toMatchObject({
      valid: true,
    });
    await pending();
    expect(await verifyActiveBoardingPass(pass.token)).toMatchObject({
      valid: false,
    });
    await expect(issueBoardingPass(key, owner)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it.each(["queued", "requesting", "pending", "review_required", "succeeded"])(
    "blocks an unresolved %s cancellation",
    async status => {
      await pending();
      Object.assign(intent(), {
        status,
        completedAt: null,
        errorCode:
          status === "review_required" ? "unknown_provider_outcome" : null,
      });
      await expect(onlineCheckIn()).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
    }
  );

  it.each(["failed", "canceled"] as const)(
    "restores check-in and boarding after verified %s and unchanged clean cash",
    async status => {
      await pending();
      await terminal(status);
      await expect(onlineCheckIn()).resolves.toHaveLength(1);
      await expect(board()).resolves.toMatchObject({ state: "boarded" });
      expect(receipt().refundedAmount).toBe(0);
    }
  );

  it.each([
    [
      "unknown provider status",
      () => {
        intent().providerStatus = "pending";
      },
    ],
    [
      "missing provider identity",
      () => {
        intent().refundId = null;
      },
    ],
    [
      "completed cancellation",
      () => {
        intent().completedAt = new Date();
      },
    ],
    [
      "changed refund balance",
      () => {
        receipt().refundedAmount = 5000;
      },
    ],
    [
      "settlement quarantine",
      () => {
        receipt().settlementStatus = "review_required";
      },
    ],
    [
      "receipt owner mismatch",
      () => {
        receipt().userId = 99;
      },
    ],
    [
      "receipt purchase mismatch",
      () => {
        receipt().targetId = 99;
      },
    ],
    [
      "missing receipt",
      () => {
        fixture.rows("payment_receipts").length = 0;
      },
    ],
  ] as const)(
    "retains the hold after a terminal status with %s",
    async (_label, mutate) => {
      await pending();
      await terminal("failed");
      mutate();
      const before = evidence();
      await expect(onlineCheckIn()).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(evidence()).toEqual(before);
    }
  );

  it("keeps offload available without clearing the pending cancellation or returning money", async () => {
    await onlineCheckIn();
    await pending();
    await expect(
      transitionDcsPassenger(
        { ...key, action: "offload", ...command() },
        operator
      )
    ).resolves.toMatchObject({ state: "offloaded" });
    expect(intent().status).toBe("pending");
    expect(receipt().refundedAmount).toBe(0);
    expect(fixture.rows("financial_ledger")).toHaveLength(0);
  });

  it("does not weaken final DCS closure after a clean provider failure", async () => {
    await pending();
    await terminal("failed");
    fixture.rows("flights")[0].dcsClosedAt = new Date();
    await expect(onlineCheckIn()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("Final DCS closure"),
    });
  });

  it("ignores another booking's cancellation and preserves a clean prior compensating refund", async () => {
    await pending();
    await terminal("failed");
    intent().baseRefundedAmount = 1000;
    receipt().refundedAmount = 1000;
    fixture.rows("ordinary_booking_refunds").push({
      ...intent(),
      bookingId: 99,
      paymentIntentId: "pi_other",
      status: "pending",
    });
    await expect(onlineCheckIn()).resolves.toHaveLength(1);
  });
});
