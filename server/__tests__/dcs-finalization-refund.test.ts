import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";

const boundary = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: () => boundary.db }));
vi.mock("../services/baggage-custody.service", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../services/baggage-custody.service")
  >()),
  getFlightBaggageCloseout: async () => ({
    expectedBags: 0,
    unexpectedBags: 0,
    unresolvedRegistrations: [],
    readyToClose: true,
  }),
}));
import { finalizeDesk } from "../services/dcs-station.service";
import {
  getDcsDesk,
  transitionDcsPassenger,
} from "../services/dcs-operations.service";
import { settleVerifiedRefund } from "../services/payment-settlement.service";
import { DepartureReleaseError } from "../services/booking-settlement.service";

const now = new Date("2030-06-10T06:00:00Z");
const key = { flightId: 11, bookingId: 3, passengerId: 4 };
const supervisor = { userId: 20, role: "airline_admin", tenantId: 1 };
let fixture: ReturnType<typeof transactionMemory>;
let sequence = 0;
const command = () => ({
  reason: "Reviewed local departure readiness",
  idempotencyKey: `financial-close-${++sequence}`,
});
const flight = () => fixture.rows("flights")[0];
const receipt = () => fixture.rows("payment_receipts")[0];
const finalizeInput = (action: "close" | "record_out") => ({
  flightId: 11,
  action,
  ...command(),
  ...(action === "record_out" ? { offBlocksAt: now.toISOString() } : {}),
});
const snapshot = () =>
  structuredClone({
    flights: fixture.rows("flights"),
    bookings: fixture.rows("bookings"),
    seats: fixture.rows("seat_inventory"),
    attendance: fixture.rows("dcs_passenger_states"),
    coupons: fixture.rows("ticket_coupons"),
    events: fixture.rows("dcs_operation_events"),
    commands: fixture.rows("idempotency_requests"),
    receipts: fixture.rows("payment_receipts"),
    ledger: fixture.rows("financial_ledger"),
  });
async function refund() {
  await fixture.db.transaction((tx: any) =>
    settleVerifiedRefund(tx, {
      paymentIntentId: "pi_finalization",
      chargeId: "ch_finalization",
      eventId: "evt_finalization",
      amount: 10000,
      amountRefunded: 10000,
      currency: "sar",
    })
  );
}
function intent(status = "pending", providerStatus = "pending") {
  fixture.rows("ordinary_booking_refunds").push({
    bookingId: 3,
    paymentIntentId: "pi_finalization",
    operationId: "ordinary-finalization",
    actorId: 7,
    amount: 5000,
    collectedAmount: 10000,
    baseRefundedAmount: 0,
    refundId: "re_finalization",
    requestPayload: "{}",
    completedAt: null,
    status,
    providerStatus,
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  sequence = 0;
  fixture = transactionMemory({
    tenants: [{ id: 1, status: "active" }],
    users: [{ id: 20, role: "airline_admin", tenantId: 1 }],
    bookings: [
      {
        id: 3,
        userId: 7,
        tenantId: 1,
        flightId: 11,
        bookingReference: "FI0003",
        pnr: "FI0003",
        status: "confirmed",
        paymentStatus: "paid",
        seatsReserved: true,
        checkedIn: true,
        totalAmount: 10000,
        cabinClass: "economy",
        numberOfPassengers: 1,
        stripePaymentIntentId: "pi_finalization",
        deletedAt: null,
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
        stationOffBlocksAt: null,
        economyAvailable: 7,
        economySeats: 8,
      },
    ],
    dcs_flight_operations: [
      { id: 1, flightId: 11, tenantId: 1, checkInState: "closed" },
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
        status: "checked_in",
        seatPrice: 0,
        bookingId: 3,
        passengerId: 4,
        checkedInAt: now,
        checkInNonce: "financial-close-nonce",
        boardingGroup: "4",
        boardingSequence: 1,
        boardingPassIssued: true,
      },
    ],
    dcs_passenger_states: [
      { id: 1, ...key, state: "boarded", boardingDenied: false },
    ],
    ticket_coupons: [
      {
        id: 1,
        bookingId: 3,
        passengerId: 4,
        flightId: 11,
        ticketNumber: "0651234567894",
        couponNumber: 1,
        status: "C",
      },
    ],
    payment_receipts: [
      {
        paymentIntentId: "pi_finalization",
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
    ordinary_booking_refunds: [],
  });
  // This double has no joined legs or pending bookings. The native companion
  // exercises finalization's real LEFT JOIN and baggage SQL on migrated MySQL.
  const select = fixture.db.select;
  fixture.db.select = (fields: any) => {
    const query = select(fields);
    query.leftJoin = () => query;
    return query;
  };
  boundary.db = fixture.db;
});
afterEach(() => vi.useRealTimers());

describe("DCS financial finalization authority (relational fixture, empty baggage boundary)", () => {
  it.each(["close", "record_out"] as const)(
    "rejects fresh %s after verified cash return without changing physical evidence or command receipts",
    async action => {
      if (action === "record_out")
        flight().dcsClosedAt = new Date(now.getTime() - 1000);
      await refund();
      expect(receipt()).toMatchObject({
        refundedAmount: 10000,
        settlementStatus: "review_required",
        settlementError:
          action === "close"
            ? DepartureReleaseError.boardedReason
            : DepartureReleaseError.reason,
      });
      expect(
        (await getDcsDesk(11, supervisor)).passengers[0].attendanceState
      ).toBe("boarded");
      const before = snapshot();
      await expect(
        finalizeDesk(finalizeInput(action), supervisor)
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringMatching(/reconciliation/i),
      });
      expect(snapshot()).toEqual(before);
    }
  );

  it.each(["queued", "requesting", "pending", "review_required", "succeeded"])(
    "holds legacy boarded carriage with an unresolved %s ordinary cancellation",
    async status => {
      intent(status);
      const before = snapshot();
      await expect(
        finalizeDesk(finalizeInput("close"), supervisor)
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(snapshot()).toEqual(before);
    }
  );

  it.each(["failed", "canceled"])(
    "permits close and OUT after clean terminal provider %s",
    async providerStatus => {
      intent("failed", providerStatus);
      await expect(
        finalizeDesk(finalizeInput("close"), supervisor)
      ).resolves.toMatchObject({ flightId: 11 });
      await expect(
        finalizeDesk(finalizeInput("record_out"), supervisor)
      ).resolves.toMatchObject({ flightId: 11 });
      expect(flight().stationOffBlocksAt).toEqual(now);
      expect(receipt().refundedAmount).toBe(0);
      expect(fixture.rows("financial_ledger")).toEqual([]);
      for (const table of [
        "bookings",
        "payment_receipts",
        "ordinary_booking_refunds",
      ])
        expect(fixture.lockedTables).not.toContain(table);
    }
  );

  it.each([
    [
      "changed cash balance",
      () => {
        receipt().refundedAmount = 5000;
      },
    ],
    [
      "missing receipt",
      () => {
        fixture.rows("payment_receipts").length = 0;
      },
    ],
    [
      "quarantined receipt",
      () => {
        receipt().settlementStatus = "review_required";
      },
    ],
    [
      "wrong owner",
      () => {
        receipt().userId = 99;
      },
    ],
    [
      "wrong purchase",
      () => {
        receipt().targetId = 99;
      },
    ],
    [
      "missing provider identity",
      () => {
        fixture.rows("ordinary_booking_refunds")[0].refundId = null;
      },
    ],
    [
      "completed cancellation",
      () => {
        fixture.rows("ordinary_booking_refunds")[0].completedAt = now;
      },
    ],
    [
      "unknown provider outcome",
      () => {
        fixture.rows("ordinary_booking_refunds")[0].providerStatus = "pending";
      },
    ],
  ] as const)(
    "retains terminal-failure hold with %s",
    async (_label, mutate) => {
      intent("failed", "failed");
      mutate();
      const before = snapshot();
      await expect(
        finalizeDesk(finalizeInput("close"), supervisor)
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(snapshot()).toEqual(before);
    }
  );

  it("returns an already committed close receipt after later refund, while a fresh OUT is denied", async () => {
    const input = finalizeInput("close");
    const committed = await finalizeDesk(input, supervisor);
    await refund();
    const before = snapshot();
    expect(await finalizeDesk(input, supervisor)).toEqual(committed);
    expect(snapshot()).toEqual(before);
    await expect(
      finalizeDesk(finalizeInput("record_out"), supervisor)
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(snapshot()).toEqual(before);
  });

  it("keeps reopen and physical deplane/offload recovery available", async () => {
    await finalizeDesk(finalizeInput("close"), supervisor);
    await refund();
    await finalizeDesk(
      { flightId: 11, action: "reopen", ...command() },
      supervisor
    );
    for (const action of ["deplane", "offload"] as const)
      await expect(
        transitionDcsPassenger({ ...key, action, ...command() }, supervisor)
      ).resolves.toMatchObject({
        state: action === "deplane" ? "checked_in" : "offloaded",
      });
    expect(receipt()).toMatchObject({
      refundedAmount: 10000,
      settlementStatus: "review_required",
    });
    expect(fixture.rows("financial_ledger")).toHaveLength(1);
  });

  it("does not transfer another flight's hold or a duplicate-collection review onto this departure", async () => {
    fixture
      .rows("ordinary_booking_refunds")
      .push({ bookingId: 99, status: "pending" });
    fixture.rows("payment_receipts").push({
      ...receipt(),
      paymentIntentId: "pi_duplicate",
      settlementStatus: "review_required",
      settlementError: "Booking already has a different collected payment",
    });
    await expect(
      finalizeDesk(finalizeInput("close"), supervisor)
    ).resolves.toMatchObject({ flightId: 11 });
  });

  it.each([
    { ...supervisor, role: "ops" },
    { ...supervisor, tenantId: 2 },
  ])(
    "retains operator/tenant authorization for $role tenant $tenantId",
    async actor => {
      const before = snapshot();
      await expect(
        Promise.resolve().then(() =>
          finalizeDesk(finalizeInput("close"), actor)
        )
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(snapshot()).toEqual(before);
    }
  );
});
