import { beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";

const boundary = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({
  getDb: () => boundary.db,
  getBookingByIdWithDetails: (id: number) =>
    fixture.rows("bookings").find(b => b.id === id),
}));
import { bookingsRouter } from "../routers/bookings";
vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));
import { dcsOperationsRouter } from "../routers/dcs-operations";
import {
  changeDcsFlightState,
  checkInDcsPassenger,
  getDcsDesk,
  transitionDcsPassenger,
  returnDcsBag,
  setBagReturnGrant,
  type DcsActor,
} from "../services/dcs-operations.service";
import { checkInPassengers } from "../services/departure-control.service";
import {
  issueBoardingPass,
  verifyActiveBoardingPass,
} from "../services/boarding-pass.service";
import { changeSeat, undoCheckIn } from "../services/seat-map.service";
import { paymentReceipts } from "../../drizzle/schema";
import { settleVerifiedRefund } from "../services/payment-settlement.service";

const actor: DcsActor = { userId: 20, role: "ops", tenantId: 1 };
const key = { flightId: 11, bookingId: 3, passengerId: 4 };
const reason = "Station operator reviewed the passenger";
let fixture: ReturnType<typeof transactionMemory>;
let serial = 0;
const command = () => ({ reason, idempotencyKey: `command-${++serial}` });
const checkIn = () => checkInDcsPassenger({ ...key, ...command() }, actor);
const transition = (
  action: "board" | "deplane" | "deny" | "allow" | "offload"
) => transitionDcsPassenger({ ...key, action, ...command() }, actor);
const passengerRow = () =>
  fixture
    .rows("dcs_passenger_states")
    .find(s => s.passengerId === 4 && s.flightId === 11);
const seatRow = () =>
  fixture
    .rows("seat_inventory")
    .find(s => s.passengerId === 4 && s.flightId === 11);

beforeEach(() => {
  serial = 0;
  fixture = transactionMemory({
    users: [{ id: actor.userId, tenantId: actor.tenantId, role: "ops" }],
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
        bookingReference: "TR1234",
        pnr: "TR1234",
        numberOfPassengers: 2,
        checkedIn: false,
        deletedAt: null,
      },
    ],
    passengers: [4, 5].map(id => ({
      id,
      bookingId: 3,
      tenantId: 1,
      firstName: "Sample",
      lastName: id === 4 ? "Traveler" : "Companion",
      type: "adult",
      ticketNumber: `065123456789${id}`,
    })),
    airlines: [{ id: 1, code: "SV", name: "Sample Carrier" }],
    airports: [
      { id: 1, code: "RUH", country: "SA", timezone: "Asia/Riyadh" },
      { id: 2, code: "JED", country: "SA", timezone: "Asia/Riyadh" },
      { id: 3, code: "DMM", country: "SA", timezone: "Asia/Riyadh" },
    ],
    flights: [11, 12].map((id, i) => ({
      id,
      tenantId: 1,
      flightNumber: `SV${id}`,
      airlineId: 1,
      originId: i + 1,
      destinationId: i + 2,
      status: "scheduled",
      economyAvailable: 1,
      departureTime: new Date(Date.now() + (6 + i * 3) * 3600000),
      arrivalTime: new Date(Date.now() + (7 + i * 3) * 3600000),
    })),
    booking_segments: [11, 12].map((flightId, i) => ({
      id: 30 + i,
      bookingId: 3,
      flightId,
      segmentOrder: i + 1,
      status: "confirmed",
      seatsReserved: true,
    })),
    seat_inventory: [11, 12].flatMap((flightId, i) =>
      ["1A", "1B", "2A"].map((seatNumber, j) => ({
        id: i * 10 + j + 1,
        flightId,
        seatNumber,
        row: j + 1,
        column: "A",
        cabinClass: "economy",
        status: "available",
        seatPrice: 0,
        bookingId: null,
        passengerId: null,
        checkInNonce: null,
      }))
    ),
    baggage_items: [],
    baggage_custody_events: [],
    ticket_coupons: [11, 12].flatMap((flightId, sectorIndex) =>
      [4, 5].map((passengerId, i) => ({
        id: flightId * 10 + i,
        couponNumber: sectorIndex + 1,
        ticketNumber: String(passengerId).padStart(13, "0"),
        bookingId: 3,
        passengerId,
        flightId,
        status: "O",
      }))
    ),
  });
  boundary.db = fixture.db;
});

function caller(
  role = "ops",
  tenantId: number | null = 1,
  userTenantId = tenantId
) {
  return dcsOperationsRouter.createCaller({
    user: { id: 20, role, tenantId: userTenantId },
    tenantId,
    req: { headers: {} },
    res: {},
  } as never);
}

describe("scoped staff departure desk", () => {
  it("reads paid active onward sectors, exact segment identity and explicit operational state", async () => {
    await checkIn();
    const desk = await caller().getDesk({ flightId: 12 });
    expect(desk.passengers).toHaveLength(2);
    expect(desk.passengers[0]).toMatchObject({
      bookingId: 3,
      passengerId: 4,
      segmentId: 31,
      checkedIn: false,
      departureState: "not_checked_in",
      boardingDenied: false,
    });
    expect(desk.history).toEqual([]);
    expect(desk).toMatchObject({
      checkInState: "open",
      stateConfigured: false,
      checkInWindowOpen: true,
      historyHasMore: false,
    });
    fixture.rows("booking_segments")[1].seatsReserved = false;
    expect((await getDcsDesk(12, actor)).passengers).toEqual([]);
    fixture.rows("bookings")[0].paymentStatus = "refunded";
    expect((await getDcsDesk(11, actor)).passengers).toEqual([]);
  });

  it.each(["deny", "board"] as const)(
    "checks in an eligible companion on the customer route after %s and rejects stale batches atomically",
    async action => {
      const customer = bookingsRouter.createCaller({
        user: { id: 7, role: "user", tenantId: 1 },
        tenantId: 1,
        req: { headers: {} },
        res: {},
      } as never);
      const rows = () => customer.getDepartureState({ bookingId: 3 });
      const submit = (...ids: number[]) =>
        customer.checkIn({
          bookingId: 3,
          flightId: 11,
          seatAssignments: ids.map(passengerId => ({ passengerId })),
        });
      expect((await rows())[0].passengers.map(p => p.departureState)).toEqual([
        "not_checked_in",
        "not_checked_in",
      ]);
      if (action === "board") await checkIn();
      await transition(action);
      const before = structuredClone(fixture.rows("seat_inventory"));
      const status = action === "deny" ? "boarding_denied" : "boarded";
      const [leg, onward] = await rows();
      expect(leg.passengers.map(p => p.departureState)).toEqual([
        status,
        "not_checked_in",
      ]);
      expect(
        onward.passengers.every(p => p.departureState === "not_checked_in")
      ).toBe(true);
      await expect(submit(5, 4)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      for (const ids of [[999], [5, 5]])
        await expect(submit(...ids)).rejects.toMatchObject({
          code: "BAD_REQUEST",
        });
      expect(fixture.rows("seat_inventory")).toEqual(before);
      await expect(submit(5)).resolves.toEqual({ success: true });
      expect((await rows())[0].passengers.map(p => p.departureState)).toEqual([
        status,
        "checked_in",
      ]);
      expect(
        fixture.rows("seat_inventory").filter(s => s.passengerId === 4)
      ).toEqual(before.filter(s => s.passengerId === 4));
    }
  );

  it("requires operational reconciliation after a real late full-refund settlement without rewriting either truth", async () => {
    await checkIn();
    await transition("board");
    await fixture.db.insert(paymentReceipts).values({
      paymentIntentId: "pi_dcs_late_refund",
      kind: "booking",
      bookingId: 3,
      userId: 7,
      targetId: 3,
      amount: 10000,
      refundedAmount: 0,
      currency: "SAR",
      settlementStatus: "applied",
    });
    await fixture.db.transaction((tx: any) =>
      settleVerifiedRefund(tx, {
        paymentIntentId: "pi_dcs_late_refund",
        chargeId: "ch_dcs_late_refund",
        eventId: "evt_dcs_late_refund",
        amount: 10000,
        amountRefunded: 10000,
        currency: "sar",
      })
    );
    expect(fixture.rows("bookings")[0]).toMatchObject({
      status: "cancelled",
      paymentStatus: "refunded",
      seatsReserved: false,
      checkedIn: false,
    });
    expect(fixture.rows("payment_receipts")[0].refundedAmount).toBe(10000);
    expect(fixture.rows("financial_ledger")[0]).toMatchObject({
      type: "refund",
      amount: "100.00",
    });
    expect(passengerRow().state).toBe("boarded");
    expect(seatRow()).toBeUndefined();
    const events = structuredClone(fixture.rows("dcs_operation_events"));
    await expect(caller().getDesk({ flightId: 11 })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("Departure reconciliation is required"),
    });
    expect(fixture.rows("bookings")[0].paymentStatus).toBe("refunded");
    expect(passengerRow().state).toBe("boarded");
    expect(fixture.rows("dcs_operation_events")).toEqual(events);
    expect(events.map(e => e.action)).toEqual(["check_in", "board"]);
  });

  it.each(["lost_seat", "revoked_nonce", "missing_passenger"])(
    "does not present a boarded passenger with %s as a normal desk row",
    async condition => {
      await checkIn();
      await transition("board");
      if (condition === "lost_seat") seatRow().status = "occupied";
      if (condition === "revoked_nonce") seatRow().checkInNonce = null;
      if (condition === "missing_passenger")
        fixture.rows("passengers").splice(0, 1);
      await expect(getDcsDesk(11, actor)).rejects.toThrow(
        "Departure reconciliation is required"
      );
      expect(passengerRow().state).toBe("boarded");
    }
  );

  it("reconciles only the selected flight and keeps valid boarded passengers represented", async () => {
    await checkIn();
    await transition("board");
    fixture.rows("dcs_passenger_states").push({
      ...passengerRow(),
      id: 99,
      bookingId: 99,
      flightId: 12,
    });
    expect((await getDcsDesk(11, actor)).passengers[0]).toMatchObject({
      passengerId: 4,
      departureState: "boarded",
      checkedIn: true,
    });
    await expect(getDcsDesk(12, actor)).rejects.toThrow(
      "Departure reconciliation is required"
    );
  });

  it("fails closed when boarded reconciliation exceeds the bounded flight read", async () => {
    await checkIn();
    fixture.rows("dcs_passenger_states").push(
      ...Array.from({ length: 2001 }, (_, i) => ({
        id: i + 100,
        bookingId: i + 100,
        passengerId: i + 100,
        flightId: 11,
        state: "boarded",
        boardingDenied: false,
      }))
    );
    await expect(getDcsDesk(11, actor)).rejects.toThrow(
      "too many boarded records to verify safely"
    );
  });

  it("requires an actual ops/admin role and matching tenant on reads and writes", async () => {
    for (const role of ["user", "finance", "support"])
      await expect(
        caller(role).getDesk({ flightId: 11 })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller("ops", 2).getDesk({ flightId: 11 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller("ops", null).getDesk({ flightId: 11 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller("ops", 1, 2).getDesk({ flightId: 11 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      checkInDcsPassenger({ ...key, ...command() }, { ...actor, tenantId: 2 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // A platform operator with an explicit airline context cannot widen it.
    await expect(
      getDcsDesk(11, { ...actor, role: "admin", tenantId: 2 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixture.rows("dcs_operation_events")).toHaveLength(0);
  });

  it("does not infer a legacy segment and rejects an ambiguous active sector", async () => {
    fixture.rows("booking_segments").splice(0);
    expect((await getDcsDesk(11, actor)).passengers[0].segmentId).toBeNull();
    fixture.rows("booking_segments").push(
      ...[30, 31].map(id => ({
        id,
        bookingId: 3,
        flightId: 11,
        status: "confirmed",
        seatsReserved: true,
      }))
    );
    await expect(getDcsDesk(11, actor)).rejects.toThrow("more than one");
    await expect(checkIn()).rejects.toThrow("more than one");
  });

  it("records the real staff actor while using the existing transactional check-in authority", async () => {
    const input = { ...key, seatNumber: "1A", ...command() };
    const result = await caller().checkIn(input);
    expect(result).toMatchObject({
      ...key,
      state: "checked_in",
      changed: true,
      seatNumber: "1A",
    });
    expect(fixture.rows("dcs_operation_events")[0]).toMatchObject({
      actorId: 20,
      actorRole: "ops",
      bookingId: 3,
      passengerId: 4,
      action: "check_in",
      fromState: "not_checked_in",
      toState: "checked_in",
      reason,
      idempotencyKey: input.idempotencyKey,
    });
    expect(fixture.rows("bookings")[0].userId).toBe(7);
    expect(
      fixture
        .rows("ticket_coupons")
        .find(c => c.flightId === 11 && c.passengerId === 4).status
    ).toBe("C");
    expect(fixture.rows("outbox")).toHaveLength(1);
    expect((await getDcsDesk(11, actor)).passengers[0]).toMatchObject({
      checkedIn: true,
      attendanceState: "checked_in",
    });
    const nonce = seatRow().checkInNonce;
    expect(await caller().checkIn(input)).toEqual(result);
    expect(seatRow().checkInNonce).toBe(nonce);
    expect(fixture.rows("dcs_operation_events")).toHaveLength(1);
    await expect(
      caller().checkIn({ ...input, seatNumber: "1B" })
    ).rejects.toThrow("different payload");
    fixture.rows("tenants")[0].status = "suspended";
    await expect(caller().checkIn(input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("flight closure and transactional failure", () => {
  it("closes customer and staff check-in, reopens explicitly and retains original command receipts", async () => {
    const input = { flightId: 11, action: "close" as const, ...command() };
    const closed = await changeDcsFlightState(input, actor);
    expect(closed).toMatchObject({
      flightId: 11,
      state: "closed",
      changed: true,
    });
    await expect(checkIn()).rejects.toThrow("closed by departure control");
    await expect(
      checkInPassengers({
        bookingId: 3,
        flightId: 11,
        assignments: [{ passengerId: 4 }],
      })
    ).rejects.toThrow("closed by departure control");
    await expect(
      changeDcsFlightState(
        { ...input, action: "open", idempotencyKey: "open-after-close" },
        actor
      )
    ).rejects.toThrow("reopen");
    await changeDcsFlightState(
      { flightId: 11, action: "reopen", ...command() },
      actor
    );
    expect(await changeDcsFlightState(input, actor)).toEqual(closed);
    expect((await getDcsDesk(11, actor)).checkInState).toBe("open");
    await checkIn();
    const events = fixture.rows("dcs_operation_events");
    expect(events.map(e => e.action)).toEqual(["close", "reopen", "check_in"]);
    expect(events[0]).toMatchObject({
      bookingId: null,
      passengerId: null,
      actorId: 20,
    });
  });

  it.each(["unpaid", "time_window", "clearance", "flight_cancelled"])(
    "opening the gate cannot override %s eligibility",
    async blockedBy => {
      await changeDcsFlightState(
        { flightId: 11, action: "open", ...command() },
        actor
      );
      if (blockedBy === "unpaid")
        fixture.rows("bookings")[0].paymentStatus = "pending";
      if (blockedBy === "time_window")
        fixture.rows("flights")[0].departureTime = new Date(
          Date.now() + 1800000
        );
      if (blockedBy === "clearance") fixture.rows("airports")[1].country = "AE";
      if (blockedBy === "flight_cancelled")
        fixture.rows("flights")[0].status = "cancelled";
      await expect(checkIn()).rejects.toThrow();
      expect(fixture.rows("dcs_operation_events")).toHaveLength(1);
      expect(fixture.rows("dcs_passenger_states")).toHaveLength(0);
      expect(
        fixture.rows("seat_inventory").every(s => s.status === "available")
      ).toBe(true);
    }
  );

  it("rolls back seats, coupon, outbox, lifecycle and receipt when audit persistence fails", async () => {
    fixture.failInsert("dcs_operation_events");
    await expect(checkIn()).rejects.toThrow("Injected insert failure");
    expect(
      fixture.rows("seat_inventory").every(s => s.status === "available")
    ).toBe(true);
    expect(fixture.rows("ticket_coupons").every(c => c.status === "O")).toBe(
      true
    );
    for (const table of [
      "outbox",
      "dcs_passenger_states",
      "dcs_operation_events",
      "idempotency_requests",
    ])
      expect(fixture.rows(table)).toHaveLength(0);
    await expect(
      changeDcsFlightState(
        { flightId: 11, action: "close", ...command() },
        actor
      )
    ).rejects.toThrow("Injected insert failure");
    expect(fixture.rows("dcs_flight_operations")).toHaveLength(0);
  });
});

describe("passenger attendance, denial and scan binding", () => {
  it("guards all old mutation/verification paths while boarded and preserves retry identity", async () => {
    await checkIn();
    const pass = await issueBoardingPass(key, { userId: 7 });
    const input = {
      ...key,
      action: "board" as const,
      boardingPassToken: pass.token,
      ...command(),
    };
    const boarded = await transitionDcsPassenger(input, actor);
    expect(boarded.state).toBe("boarded");
    expect(await transitionDcsPassenger(input, actor)).toEqual(boarded);
    expect((await verifyActiveBoardingPass(pass.token)).valid).toBe(false);
    await expect(undoCheckIn(11, 3, 4)).rejects.toThrow("deplane");
    await expect(changeSeat(11, "1A", "2A", 3, 4)).rejects.toThrow("deplane");
    await expect(
      checkInPassengers({
        bookingId: 3,
        flightId: 11,
        assignments: [{ passengerId: 4 }],
      })
    ).rejects.toThrow("deplane");
    await expect(transition("offload")).rejects.toThrow("Deplane");
    await expect(transition("deny")).rejects.toThrow("Deplane");
    await expect(transition("board")).rejects.toThrow("deplane");
    const nonce = seatRow().checkInNonce;
    expect((await transition("deplane")).state).toBe("checked_in");
    expect(seatRow().checkInNonce).toBe(nonce);
    expect((await verifyActiveBoardingPass(pass.bcbp)).valid).toBe(true);
    expect(fixture.rows("dcs_operation_events").map(e => e.action)).toEqual([
      "check_in",
      "board",
      "deplane",
    ]);
  });

  it("retains denial across offload and requires allow plus fresh check-in", async () => {
    await checkIn();
    const pass = await issueBoardingPass(key, { userId: 7 });
    await transition("deny");
    expect((await verifyActiveBoardingPass(pass.token)).valid).toBe(false);
    await expect(changeSeat(11, "1A", "2A", 3, 4)).rejects.toThrow("denied");
    await expect(undoCheckIn(11, 3, 4)).rejects.toThrow("denied");
    await expect(transition("board")).rejects.toThrow("denied");
    expect((await transition("offload")).state).toBe("boarding_denied");
    expect(passengerRow()).toMatchObject({
      state: "offloaded",
      boardingDenied: true,
    });
    expect(seatRow()).toMatchObject({
      status: "occupied",
      checkInNonce: null,
      checkedInAt: null,
      boardingPassIssued: false,
    });
    expect(
      fixture
        .rows("ticket_coupons")
        .find(c => c.flightId === 11 && c.passengerId === 4).status
    ).toBe("O");
    const desk = await getDcsDesk(11, actor);
    expect(desk.passengers[0]).toMatchObject({
      attendanceState: "offloaded",
      departureState: "boarding_denied",
      boardingDenied: true,
      checkedIn: false,
    });
    expect(fixture.rows("bookings")[0].checkedIn).toBe(false);
    await expect(checkIn()).rejects.toThrow("denied");
    expect((await transition("allow")).state).toBe("offloaded");
    await expect(transition("board")).rejects.toThrow("check in again");
    await checkIn();
    expect(seatRow().checkInNonce).not.toBe(pass.payload.checkInNonce);
    expect((await verifyActiveBoardingPass(pass.token)).valid).toBe(false);
  });

  it("denies before check-in without changing another passenger or onward sector", async () => {
    await transition("deny");
    await expect(checkIn()).rejects.toThrow("denied");
    await checkInDcsPassenger({ ...key, passengerId: 5, ...command() }, actor);
    await checkInDcsPassenger({ ...key, flightId: 12, ...command() }, actor);
    expect(
      (await getDcsDesk(11, actor)).passengers.map(p => p.departureState)
    ).toEqual(["boarding_denied", "checked_in"]);
    expect((await getDcsDesk(12, actor)).passengers[0].departureState).toBe(
      "checked_in"
    );
    await transition("allow");
    await checkIn();
    expect(passengerRow().boardingDenied).toBe(false);
  });

  it("validates JWT and BCBP against the exact row and revokes stale seat nonces", async () => {
    await checkIn();
    await checkInDcsPassenger(
      { ...key, passengerId: 5, seatNumber: "1B", ...command() },
      actor
    );
    const pass = await issueBoardingPass(key, { userId: 7 });
    for (const boardingPassToken of [pass.token, pass.bcbp])
      await expect(
        transitionDcsPassenger(
          {
            ...key,
            passengerId: 5,
            action: "board",
            boardingPassToken,
            ...command(),
          },
          actor
        )
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await changeSeat(11, "1A", "2A", 3, 4);
    await expect(
      transitionDcsPassenger(
        {
          ...key,
          action: "board",
          boardingPassToken: pass.token,
          ...command(),
        },
        actor
      )
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    const current = await issueBoardingPass(key, { userId: 7 });
    expect(
      (
        await transitionDcsPassenger(
          {
            ...key,
            action: "board",
            boardingPassToken: current.bcbp,
            ...command(),
          },
          actor
        )
      ).state
    ).toBe("boarded");
    expect(fixture.rows("dcs_operation_events").at(-1).details.scanFormat).toBe(
      "bcbp"
    );
  });

  it("returns only the identified bag once and preserves other bags and their offload block", async () => {
    await checkIn();
    const bag = {
      id: 70,
      bookingId: 3,
      passengerId: 4,
      flightId: 11,
      segmentId: 30,
      tagNumber: "0123000070",
      status: "checked_in",
    };
    fixture
      .rows("baggage_items")
      .push(bag, { ...bag, id: 71, tagNumber: "0123000071" });
    const admin = { ...actor, userId: 99, role: "airline_admin" };
    const grant = (flightId: number, airportId: number, enabled: boolean) => ({
      flightId,
      airlineId: 1,
      airportId,
      enabled,
      staffId: actor.userId,
      ...command(),
    });
    const input = {
      ...key,
      segmentId: 30,
      tagNumber: bag.tagNumber,
      ...command(),
    };
    await expect(returnDcsBag(input, actor)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      setBagReturnGrant(grant(11, 1, true), actor)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      setBagReturnGrant(grant(11, 1, true), { ...admin, tenantId: 2 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setBagReturnGrant(grant(11, 2, true), admin)).rejects.toThrow(
      /station/i
    );
    await setBagReturnGrant(grant(12, 2, true), admin);
    // Same carrier and tenant, but the operator only has a grant at the other origin.
    await expect(returnDcsBag(input, actor)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect((await getDcsDesk(11, actor)).canReturnBags).toBe(false);
    const commandGrant = grant(11, 1, true);
    const granted = await setBagReturnGrant(commandGrant, admin);
    expect(await setBagReturnGrant(commandGrant, admin)).toEqual(granted);
    expect((await getDcsDesk(11, actor)).canReturnBags).toBe(true);
    await setBagReturnGrant(grant(11, 1, false), admin);
    await expect(returnDcsBag(input, actor)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await setBagReturnGrant(grant(11, 1, true), admin);
    await expect(
      returnDcsBag({ ...input, flightId: 12, segmentId: 31 }, actor)
    ).rejects.toThrow(/sector/i);
    await expect(
      returnDcsBag({ ...input, passengerId: 5 }, actor)
    ).rejects.toThrow(/sector/i);
    await expect(
      returnDcsBag(input, { ...actor, tenantId: 2 })
    ).rejects.toThrow(/scope/i);
    await transition("board");
    await expect(returnDcsBag(input, actor)).rejects.toThrow(/deplaned/i);
    await transition("deplane");
    const first = await returnDcsBag(input, actor);
    expect(await returnDcsBag(input, actor)).toEqual(first);
    await setBagReturnGrant(grant(11, 1, false), admin);
    await expect(returnDcsBag(input, actor)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await setBagReturnGrant(grant(11, 1, true), admin);
    await expect(
      returnDcsBag({ ...input, ...command() }, actor)
    ).rejects.toThrow(/already returned/i);
    expect(
      fixture
        .rows("dcs_operation_events")
        .filter(e => e.action === "return_bag")
    ).toMatchObject([
      {
        id: first.eventId,
        actorId: actor.userId,
        flightId: 11,
        reason: input.reason,
        details: {
          baggageId: 70,
          segmentId: 30,
          tagNumber: bag.tagNumber,
          stationId: 1,
        },
      },
    ]);
    expect(fixture.rows("baggage_tracking")).toHaveLength(1);
    expect(fixture.rows("baggage_custody_events")).toHaveLength(0);
    await expect(transition("offload")).rejects.toThrow(/baggage/i);
    const second = { ...input, ...command(), tagNumber: "0123000071" };
    fixture.rows("baggage_custody_events").push({
      id: 90,
      baggageId: 71,
      flightId: 11,
      stage: "loading",
      airportId: 1,
    });
    await expect(returnDcsBag(second, actor)).rejects.toThrow(/custody/i);
    expect(
      fixture.rows("baggage_items").find(b => b.id === 71)?.returnEventId
    ).toBeUndefined();
  });
  it("refuses offload and legacy undo when a legacy bag has no scoped handover receipt", async () => {
    await checkIn();
    const nonce = seatRow().checkInNonce;
    fixture
      .rows("baggage_items")
      .push({ id: 70, bookingId: 3, passengerId: 4 });
    fixture
      .rows("baggage_custody_events")
      .push({ id: 80, baggageId: 70, flightId: 11, stage: "acceptance" });
    await expect(transition("offload")).rejects.toThrow(/baggage/i);
    await expect(undoCheckIn(11, 3, 4)).rejects.toThrow(/baggage/i);
    expect(seatRow().checkInNonce).toBe(nonce);
    expect(passengerRow().state).toBe("checked_in");
    expect(fixture.rows("dcs_operation_events")).toHaveLength(1);
    expect(fixture.rows("idempotency_requests")).toHaveLength(1);
  });

  it.each([
    { label: "current flight", flightId: 11, segmentId: 30 },
    { label: "unscoped legacy", flightId: null, segmentId: null },
    { label: "incomplete other sector", flightId: 12, segmentId: null },
  ])(
    "refuses offload after a $label counter registration before any device scan",
    async ({ flightId, segmentId }) => {
      await checkIn();
      fixture.rows("baggage_items").push({
        id: 70,
        bookingId: 3,
        passengerId: 4,
        flightId,
        segmentId,
        status: "claimed",
      });
      // Mutable baggage labels do not prove the physical bag was withdrawn.
      await expect(transition("offload")).rejects.toThrow(/baggage/i);
      await expect(undoCheckIn(11, 3, 4)).rejects.toThrow(/baggage/i);
      expect(seatRow().status).toBe("checked_in");
      expect(fixture.rows("dcs_operation_events")).toHaveLength(1);
    }
  );

  it("does not block offload for another passenger or a provably different sector", async () => {
    await checkIn();
    fixture.rows("baggage_items").push(
      {
        id: 70,
        bookingId: 3,
        passengerId: 5,
        flightId: 11,
        segmentId: 30,
        status: "checked_in",
      },
      {
        id: 71,
        bookingId: 3,
        passengerId: 4,
        flightId: 12,
        segmentId: 31,
        status: "checked_in",
      }
    );
    fixture
      .rows("baggage_custody_events")
      .push({ id: 80, baggageId: 71, flightId: 12, stage: "acceptance" });
    expect((await transition("offload")).state).toBe("offloaded");
  });

  it("trusts current-flight custody over mismatched baggage metadata", async () => {
    await checkIn();
    fixture.rows("baggage_items").push({
      id: 70,
      bookingId: 3,
      passengerId: 4,
      flightId: 12,
      segmentId: 31,
      status: "claimed",
    });
    fixture
      .rows("baggage_custody_events")
      .push({ id: 80, baggageId: 70, flightId: 11, stage: "loading" });
    await expect(transition("offload")).rejects.toThrow(/baggage/i);
    expect(seatRow().status).toBe("checked_in");
  });

  it("audits legacy undo with the acting operator and does not clear sibling check-in", async () => {
    await checkIn();
    await checkInDcsPassenger({ ...key, passengerId: 5, ...command() }, actor);
    await undoCheckIn(11, 3, 4, { userId: 21, role: "admin", tenantId: 1 });
    expect(fixture.rows("bookings")[0].checkedIn).toBe(true);
    expect(passengerRow().state).toBe("offloaded");
    expect(fixture.rows("dcs_operation_events").at(-1)).toMatchObject({
      actorId: 21,
      action: "undo_check_in",
      toState: "offloaded",
    });
  });
});

describe("station reports and controlled desk commands", () => {
  it("reopens a cancelled final closure for supervised attendance recovery without admitting travel", async () => {
    await checkIn();
    await transition("board");
    await changeDcsFlightState(
      { flightId: key.flightId, action: "close", ...command() },
      actor
    );
    // Persisted final closure is seeded here; the disposable-DB acceptance
    // scenario exercises the actual close/reconcile/cancel/reopen sequence.
    const closedAt = new Date(Date.now() - 1000);
    Object.assign(fixture.rows("flights")[0], {
      status: "cancelled",
      dcsClosedAt: closedAt,
      stationOffBlocksAt: null,
    });
    const supervisor = caller("airline_admin");
    const reopen = {
      flightId: key.flightId,
      action: "reopen" as const,
      ...command(),
    };
    await expect(transition("deplane")).rejects.toThrow(/final DCS closure/i);
    await expect(caller().finalize(reopen)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      caller("airline_admin", 2).finalize(reopen)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const action of ["close", "record_out"] as const) {
      await expect(
        supervisor.finalize({
          flightId: key.flightId,
          action,
          ...(action === "record_out"
            ? { offBlocksAt: new Date().toISOString() }
            : {}),
          ...command(),
        })
      ).rejects.toThrow(/outside active station operations/i);
    }
    const receipt = await supervisor.finalize(reopen);
    expect(await supervisor.finalize(reopen)).toEqual(receipt);
    expect(fixture.rows("flights")[0]).toMatchObject({
      status: "cancelled",
      dcsClosedAt: null,
      stationOffBlocksAt: null,
    });
    expect(fixture.rows("dcs_flight_operations")[0].checkInState).toBe(
      "closed"
    );
    expect(
      fixture
        .rows("dcs_operation_events")
        .filter(e => e.action === "dcs_reopen")
    ).toMatchObject([
      {
        id: receipt.eventId,
        actorId: actor.userId,
        actorRole: "airline_admin",
        fromState: "closed",
        toState: "open",
        reason: reopen.reason,
      },
    ]);
    expect((await transition("deplane")).state).toBe("checked_in");
    await expect(transition("board")).rejects.toThrow();
    expect((await transition("offload")).state).toBe("offloaded");
    await expect(checkIn()).rejects.toThrow();
    expect(fixture.rows("bookings")[0]).toMatchObject({
      status: "confirmed",
      paymentStatus: "paid",
      seatsReserved: true,
    });
  });

  it.each([
    { status: "completed", observedOut: false },
    { status: "cancelled", observedOut: true },
    { status: "scheduled", observedOut: true },
  ])(
    "preserves final closure for $status with observed OUT=$observedOut",
    async ({ status, observedOut }) => {
      const closedAt = new Date(Date.now() - 2000);
      const stationOffBlocksAt = observedOut
        ? new Date(Date.now() - 1000)
        : null;
      Object.assign(fixture.rows("flights")[0], {
        status,
        dcsClosedAt: closedAt,
        stationOffBlocksAt,
      });
      await expect(
        caller("airline_admin").finalize({
          flightId: key.flightId,
          action: "reopen",
          ...command(),
        })
      ).rejects.toThrow(
        observedOut ? /OUT has already been recorded/ : /outside active station/
      );
      expect(fixture.rows("flights")[0]).toMatchObject({
        status,
        dcsClosedAt: closedAt,
        stationOffBlocksAt,
      });
      expect(fixture.rows("dcs_operation_events")).toHaveLength(0);
    }
  );

  it("refuses a saved station command after a staff or tenant change", async () => {
    await expect(
      caller().openCase({
        flightId: 11,
        kind: "no_rec",
        stationReference: "NO-REC-17",
        reason: "Station verification",
        idempotencyKey: "no-rec-session-17",
        expectedActorId: 987651,
        expectedTenantId: 987652,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("opens an unresolved case and only links a funded passenger of the selected flight", async () => {
    const station = caller(),
      input = {
        flightId: 11,
        kind: "no_rec" as const,
        stationReference: "ST-27",
        ...command(),
      };
    const receipt = await station.openCase(input);
    expect(await station.openCase(input)).toEqual(receipt);
    await expect(station.openCase({ ...input, ...command() })).rejects.toThrow(
      /already exists/i
    );
    await expect(
      caller("ops", 2).openCase({ ...input, ...command() })
    ).rejects.toThrow();
    await expect(
      station.resolveCase({
        ...key,
        caseId: receipt.eventId,
        passengerId: 99,
        ...command(),
      })
    ).rejects.toThrow();
    await station.resolveCase({
      ...key,
      caseId: receipt.eventId,
      ...command(),
    });
    expect((await station.stationReport({ flightId: 11 })).cases).toEqual([
      {
        id: receipt.eventId,
        kind: "no_rec",
        stationReference: "ST-27",
        dismissed: false,
        resolvedPassengerId: 4,
      },
    ]);
    expect(
      fixture.rows("seat_inventory").every(s => s.status === "available")
    ).toBe(true);
  });
  it("shows only notes on the exact passenger and sector; repeated commands preserve one entry", async () => {
    const note = { ...key, ...command(), reason: "Meet at the gate" };
    await caller().addOsi(note);
    await caller().addOsi(note);
    const r = await caller().stationReport({ flightId: 11 });
    expect(r.items).toEqual([
      {
        passengerId: 4,
        name: "Sample Traveler",
        seat: null,
        category: "osi",
        code: "OSI",
        status: "recorded",
        note: note.reason,
      },
    ]);
    expect((await caller().stationReport({ flightId: 12 })).items).toEqual([]);
    await expect(
      caller("ops", 2).stationReport({ flightId: 11 })
    ).rejects.toThrow();
  });
  it("refuses an occupied seat, an excessive range, duplicate seats and an unauthorized operator", async () => {
    const flight = fixture.rows("flights")[0],
      day = flight.departureTime.toISOString().slice(0, 10);
    const req = {
      flightId: 11,
      startDate: day,
      endDate: day,
      seatNumbers: ["1A"],
      ...command(),
    };
    await expect(caller().blockSeats(req)).rejects.toThrow(/administration/);
    await expect(
      caller("airline_admin").blockSeats({ ...req, seatNumbers: ["1A", "1A"] })
    ).rejects.toThrow();
    await expect(
      caller("airline_admin").blockSeats({ ...req, endDate: "2050-01-01" })
    ).rejects.toThrow();
    fixture.rows("seat_inventory")[0].status = "held";
    await expect(caller("airline_admin").blockSeats(req)).rejects.toThrow(
      /available/
    );
    expect(fixture.rows("dcs_operation_events")).toHaveLength(0);
  });
});
