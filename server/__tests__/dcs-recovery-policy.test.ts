import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";

// Exercise production services and predicates. This relational DB double does
// not prove MySQL locking, isolation, device custody or concurrent execution.
const boundary = vi.hoisted(() => ({
  db: null as ReturnType<typeof transactionMemory>["db"] | null,
}));
vi.mock("../db", () => ({ getDb: () => boundary.db }));

import {
  checkInDcsPassenger,
  transitionDcsPassenger,
  type DcsActor,
} from "../services/dcs-operations.service";
import {
  verifyActiveBoardingPass,
  issueBoardingPass,
} from "../services/boarding-pass.service";

const now = new Date("2030-01-01T00:00:00.000Z");
const actor: DcsActor = { userId: 20, role: "ops", tenantId: 1 };
const key = { flightId: 11, bookingId: 3, passengerId: 4 };
type Recovery = "deplane" | "offload";
let fixture: ReturnType<typeof transactionMemory>;
let serial = 0;
const command = () => ({
  reason: "Station recovery reviewed with current passenger evidence",
  idempotencyKey: `recovery-policy-${++serial}`,
});
const checkIn = () => checkInDcsPassenger({ ...key, ...command() }, actor);
const transition = (
  action: "board" | "deplane" | "deny" | "allow" | "offload"
) => transitionDcsPassenger({ ...key, action, ...command() }, actor);
const flight = () => fixture.rows("flights")[0];
const booking = () => fixture.rows("bookings")[0];
const leg = () => fixture.rows("booking_segments")[0];
const state = () => fixture.rows("dcs_passenger_states")[0];
const seat = () =>
  fixture.rows("seat_inventory").find(s => s.passengerId === 4);
const afterDeparture = () =>
  vi.setSystemTime(new Date(now.getTime() + 6 * 3600000 + 1));
async function prepare(action: Recovery) {
  await checkIn();
  if (action === "deplane") await transition("board");
}
function snapshot() {
  return structuredClone({
    seat: fixture.rows("seat_inventory"),
    states: fixture.rows("dcs_passenger_states"),
    booking: fixture.rows("bookings"),
    coupons: fixture.rows("ticket_coupons"),
    events: fixture.rows("dcs_operation_events"),
    receipts: fixture.rows("idempotency_requests"),
  });
}

beforeEach(() => {
  serial = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  fixture = transactionMemory({
    tenants: [
      { id: 1, status: "active" },
      { id: 2, status: "active" },
    ],
    bookings: [
      {
        id: 3,
        userId: 7,
        tenantId: 1,
        flightId: 11,
        status: "confirmed",
        paymentStatus: "paid",
        seatsReserved: true,
        cabinClass: "economy",
        bookingReference: "QA1234",
        pnr: "QA1234",
        numberOfPassengers: 1,
        checkedIn: false,
        deletedAt: null,
      },
    ],
    passengers: [
      {
        id: 4,
        bookingId: 3,
        tenantId: 1,
        firstName: "Synthetic",
        lastName: "Traveler",
        type: "adult",
        ticketNumber: "0651234567894",
      },
    ],
    airlines: [{ id: 1, code: "SV", name: "Synthetic Carrier" }],
    airports: [
      { id: 1, code: "RUH", country: "SA", timezone: "Asia/Riyadh" },
      { id: 2, code: "JED", country: "SA", timezone: "Asia/Riyadh" },
    ],
    flights: [
      {
        id: 11,
        tenantId: 1,
        airlineId: 1,
        flightNumber: "SV11",
        originId: 1,
        destinationId: 2,
        status: "scheduled",
        departureTime: new Date(now.getTime() + 6 * 3600000),
        arrivalTime: new Date(now.getTime() + 7 * 3600000),
      },
    ],
    booking_segments: [
      {
        id: 30,
        bookingId: 3,
        flightId: 11,
        segmentOrder: 1,
        status: "confirmed",
        seatsReserved: true,
      },
    ],
    seat_inventory: [
      {
        id: 1,
        flightId: 11,
        seatNumber: "1A",
        row: 1,
        column: "A",
        cabinClass: "economy",
        status: "available",
        seatPrice: 0,
        bookingId: null,
        passengerId: null,
        checkInNonce: null,
      },
    ],
    ticket_coupons: [
      { id: 1, bookingId: 3, passengerId: 4, flightId: 11, status: "O" },
    ],
    baggage_items: [],
    baggage_custody_events: [],
  });
  boundary.db = fixture.db;
});
afterEach(() => vi.useRealTimers());

const recoverable = [
  { label: "scheduled after departure time", status: "scheduled", late: true },
  { label: "delayed after departure time", status: "delayed", late: true },
  {
    label: "cancelled before departure time",
    status: "cancelled",
    late: false,
  },
  { label: "cancelled after departure time", status: "cancelled", late: true },
];

describe("limited station recovery after cutoff or flight cancellation", () => {
  it.each(recoverable)(
    "recovers deplane on $label without revoking the checked-in seat",
    async ({ status, late }) => {
      await prepare("deplane");
      const nonce = seat().checkInNonce;
      flight().status = status;
      if (late) afterDeparture();
      const input = { ...key, action: "deplane" as const, ...command() };
      const result = await transitionDcsPassenger(input, actor);
      expect(result).toMatchObject({
        ...key,
        state: "checked_in",
        changed: true,
        seatNumber: "1A",
      });
      expect(state()).toMatchObject({
        state: "checked_in",
        boardingDenied: false,
      });
      expect(seat()).toMatchObject({
        status: "checked_in",
        checkInNonce: nonce,
      });
      expect(fixture.rows("ticket_coupons")[0].status).toBe("C");
      expect(fixture.rows("dcs_operation_events").at(-1)).toMatchObject({
        action: "deplane",
        actorId: 20,
        actorRole: "ops",
        reason: input.reason,
        fromState: "boarded",
        toState: "checked_in",
      });
    }
  );

  it.each(recoverable)(
    "recovers offload on $label and invalidates the previous pass",
    async ({ status, late }) => {
      await prepare("offload");
      const pass = await issueBoardingPass(key, { userId: 7 });
      flight().status = status;
      if (late) afterDeparture();
      const result = await transition("offload");
      expect(result).toMatchObject({
        ...key,
        state: "offloaded",
        changed: true,
      });
      expect(seat()).toMatchObject({
        status: "occupied",
        checkedInAt: null,
        checkInNonce: null,
        boardingPassIssued: false,
      });
      expect(fixture.rows("ticket_coupons")[0].status).toBe("O");
      expect(booking().checkedIn).toBe(false);
      expect((await verifyActiveBoardingPass(pass.token)).valid).toBe(false);
      expect(fixture.rows("dcs_operation_events").at(-1)).toMatchObject({
        action: "offload",
        fromState: "checked_in",
        toState: "offloaded",
        actorId: 20,
      });
    }
  );

  it("still requires deplane before offload and replays each successful recovery once", async () => {
    await prepare("deplane");
    flight().status = "cancelled";
    afterDeparture();
    const before = snapshot();
    await expect(transition("offload")).rejects.toThrow("Deplane");
    expect(snapshot()).toEqual(before);
    const deplane = { ...key, action: "deplane" as const, ...command() };
    const first = await transitionDcsPassenger(deplane, actor);
    const offload = { ...key, action: "offload" as const, ...command() };
    const second = await transitionDcsPassenger(offload, actor);
    const settled = snapshot();
    expect(await transitionDcsPassenger(deplane, actor)).toEqual(first);
    expect(await transitionDcsPassenger(offload, actor)).toEqual(second);
    expect(snapshot()).toEqual(settled);
    expect(state().state).toBe("offloaded");
    await expect(
      transitionDcsPassenger(
        { ...offload, reason: "A different operational reason" },
        actor
      )
    ).rejects.toThrow("different payload");
    expect(snapshot()).toEqual(settled);
  });

  it("preserves an existing boarding denial when offloading after cutoff", async () => {
    await checkIn();
    await transition("deny");
    afterDeparture();
    expect(await transition("offload")).toMatchObject({
      state: "boarding_denied",
    });
    expect(state()).toMatchObject({ state: "offloaded", boardingDenied: true });
    expect(fixture.rows("dcs_operation_events").at(-1).details).toMatchObject({
      deniedBefore: true,
      deniedAfter: true,
    });
    await expect(transition("allow")).rejects.toThrow("not open");
    await expect(transition("board")).rejects.toThrow("not open");
    expect(state().boardingDenied).toBe(true);
  });
});

describe("recovery retains scope, financial and reconciliation boundaries", () => {
  it.each<Recovery>(["deplane", "offload"])(
    "rejects %s for a completed flight",
    async action => {
      await prepare(action);
      flight().status = "completed";
      afterDeparture();
      const before = snapshot();
      await expect(transition(action)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(snapshot()).toEqual(before);
    }
  );

  it.each(["unpaid", "refunded", "cancelled booking", "released inventory"])(
    "keeps %s in reconciliation instead of offloading",
    async condition => {
      await prepare("offload");
      if (condition === "unpaid") booking().paymentStatus = "pending";
      if (condition === "refunded") booking().paymentStatus = "refunded";
      if (condition === "cancelled booking") booking().status = "cancelled";
      if (condition === "released inventory") leg().seatsReserved = false;
      flight().status = "cancelled";
      afterDeparture();
      const before = snapshot();
      await expect(transition("offload")).rejects.toThrow(
        "active paid reservation"
      );
      expect(snapshot()).toEqual(before);
    }
  );

  it.each(["cancelled segment", "ambiguous segment"])(
    "rejects recovery for a %s",
    async condition => {
      await prepare("deplane");
      if (condition === "cancelled segment") leg().status = "cancelled";
      else
        fixture
          .rows("booking_segments")
          .push({ ...leg(), id: 31, segmentOrder: 2 });
      afterDeparture();
      const before = snapshot();
      await expect(transition("deplane")).rejects.toThrow(
        condition === "cancelled segment"
          ? "Booking not found for flight"
          : "more than one active booking segment"
      );
      expect(snapshot()).toEqual(before);
    }
  );

  it.each<Recovery>(["deplane", "offload"])(
    "rejects %s from another tenant",
    async action => {
      await prepare(action);
      flight().status = "cancelled";
      afterDeparture();
      const before = snapshot();
      await expect(
        transitionDcsPassenger(
          { ...key, action, ...command() },
          { ...actor, tenantId: 2 }
        )
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(snapshot()).toEqual(before);
    }
  );

  it.each(["unprivileged role", "suspended tenant"])(
    "does not widen authority for an %s",
    async condition => {
      await prepare("offload");
      if (condition === "suspended tenant")
        fixture.rows("tenants")[0].status = "suspended";
      flight().status = "cancelled";
      afterDeparture();
      const before = snapshot();
      await expect(
        transitionDcsPassenger(
          { ...key, action: "offload", ...command() },
          condition === "unprivileged role" ? { ...actor, role: "user" } : actor
        )
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(snapshot()).toEqual(before);
    }
  );

  it.each([
    { action: "deplane" as const, missing: "seat" },
    { action: "deplane" as const, missing: "nonce" },
    { action: "offload" as const, missing: "seat" },
    { action: "offload" as const, missing: "nonce" },
  ])(
    "rejects $action without a current $missing",
    async ({ action, missing }) => {
      await prepare(action);
      if (missing === "seat") fixture.rows("seat_inventory").splice(0);
      else seat().checkInNonce = null;
      flight().status = "cancelled";
      afterDeparture();
      const before = snapshot();
      await expect(transition(action)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect(snapshot()).toEqual(before);
    }
  );
});

describe("recovery does not authorize new travel or discard physical receipts", () => {
  it.each(["late", "cancelled"])(
    "keeps board, allow and deny under their existing %s gate",
    async condition => {
      await checkIn();
      await transition("deny");
      if (condition === "late") afterDeparture();
      else flight().status = "cancelled";
      const before = snapshot();
      for (const action of ["board", "allow", "deny"] as const)
        await expect(transition(action)).rejects.toThrow("not open");
      expect(snapshot()).toEqual(before);
    }
  );

  it.each(["late", "cancelled"])(
    "preserves a counter bag receipt during %s offload",
    async condition => {
      await checkIn();
      fixture.rows("baggage_items").push({
        id: 70,
        bookingId: 3,
        passengerId: 4,
        flightId: 11,
        segmentId: 30,
        status: "checked_in",
        weight: "10.00",
      });
      if (condition === "late") afterDeparture();
      else flight().status = "cancelled";
      const before = snapshot();
      await expect(transition("offload")).rejects.toThrow("Return or reroute");
      expect(snapshot()).toEqual(before);
      expect(fixture.rows("baggage_items")).toHaveLength(1);
    }
  );

  it("rolls back recovery state, coupon and command receipt if the audit insert fails", async () => {
    await checkIn();
    afterDeparture();
    fixture.failInsert("dcs_operation_events");
    const before = snapshot();
    await expect(transition("offload")).rejects.toThrow(
      "Injected insert failure"
    );
    expect(snapshot()).toEqual(before);
  });
});
