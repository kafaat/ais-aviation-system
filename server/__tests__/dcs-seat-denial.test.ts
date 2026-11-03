import { beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";

const boundary = vi.hoisted(() => ({
  db: null as ReturnType<typeof transactionMemory>["db"] | null,
}));
vi.mock("../db", () => ({ getDb: () => boundary.db }));
vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));

import { seatMapRouter } from "../routers/seat-map";
import {
  checkInDcsPassenger,
  transitionDcsPassenger,
  type DcsActor,
} from "../services/dcs-operations.service";
import { releaseSeat, selectSeat } from "../services/seat-map.service";

// Exercise the real seat and departure services. The relational boundary double
// provides rollback and simple predicates, not MySQL concurrency guarantees.
const actor: DcsActor = { userId: 20, role: "ops", tenantId: 1 };
const key = { bookingId: 3, passengerId: 4, flightId: 11 };
let fixture: ReturnType<typeof transactionMemory>;
let serial = 0;
const command = () => ({
  idempotencyKey: `seat-denial-command-${++serial}`,
  reason: "Station operator reviewed the passenger",
});
const transition = (action: "deny" | "allow" | "board") =>
  transitionDcsPassenger({ ...key, action, ...command() }, actor);
const seat = (seatNumber: string, flightId = 11) =>
  fixture
    .rows("seat_inventory")
    .find(row => row.seatNumber === seatNumber && row.flightId === flightId);
const decision = () =>
  fixture
    .rows("dcs_passenger_states")
    .find(row => row.passengerId === 4 && row.flightId === 11);
const snapshot = () =>
  structuredClone({
    seats: fixture.rows("seat_inventory"),
    passengers: fixture.rows("passengers"),
    decisions: fixture.rows("dcs_passenger_states"),
    events: fixture.rows("dcs_operation_events"),
    coupons: fixture.rows("ticket_coupons"),
  });

beforeEach(() => {
  serial = 0;
  fixture = transactionMemory({
    tenants: [{ id: 1, status: "active" }],
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
        bookingReference: "SEAT03",
        pnr: "SEAT03",
        numberOfPassengers: 2,
        checkedIn: false,
        deletedAt: null,
      },
    ],
    passengers: [
      ...[4, 5].map(id => ({
        id,
        bookingId: 3,
        tenantId: 1,
        firstName: "Sample",
        lastName: "Traveler",
        type: "adult",
        ticketNumber: `065123456789${id}`,
        seatNumber: null,
      })),
      { id: 6, bookingId: 9, tenantId: 2, seatNumber: null },
    ],
    airlines: [{ id: 1, code: "SV", name: "Sample Carrier" }],
    airports: [
      { id: 1, code: "RUH", country: "SA", timezone: "Asia/Riyadh" },
      { id: 2, code: "JED", country: "SA", timezone: "Asia/Riyadh" },
      { id: 3, code: "DMM", country: "SA", timezone: "Asia/Riyadh" },
    ],
    flights: [11, 12].map((id, index) => ({
      id,
      tenantId: 1,
      flightNumber: `SV${id}`,
      airlineId: 1,
      originId: index + 1,
      destinationId: index + 2,
      status: "scheduled",
      departureTime: new Date(Date.now() + (6 + index * 3) * 3600000),
      arrivalTime: new Date(Date.now() + (7 + index * 3) * 3600000),
    })),
    booking_segments: [11, 12].map((flightId, index) => ({
      id: 30 + index,
      bookingId: 3,
      flightId,
      segmentOrder: index + 1,
      status: "confirmed",
      seatsReserved: true,
    })),
    seat_inventory: [11, 12].flatMap((flightId, index) =>
      ["1A", "2A"].map((seatNumber, position) => ({
        id: index * 10 + position + 1,
        flightId,
        seatNumber,
        row: position + 1,
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
      }))
    ),
    ticket_coupons: [11, 12].flatMap(flightId =>
      [4, 5].map(passengerId => ({
        id: flightId * 10 + passengerId,
        bookingId: 3,
        passengerId,
        flightId,
        status: "O",
      }))
    ),
  });
  boundary.db = fixture.db;
});

describe("DCS denial and seat selection", () => {
  it("refuses to move an occupied seat after deny without changing the decision or seat", async () => {
    await selectSeat(11, "1A", 3, 4);
    await transition("deny");
    const before = snapshot();

    await expect(selectSeat(11, "2A", 3, 4)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("denied"),
    });
    expect(snapshot()).toEqual(before);
  });

  it("allows selecting another free seat after an authorized allow decision", async () => {
    await selectSeat(11, "1A", 3, 4);
    await transition("deny");
    await transition("allow");

    await expect(selectSeat(11, "2A", 3, 4)).resolves.toMatchObject({
      status: "occupied",
      bookingId: 3,
      passengerId: 4,
      seatNumber: "2A",
    });
    expect(seat("1A")).toMatchObject({
      status: "available",
      bookingId: null,
      passengerId: null,
    });
    expect(fixture.rows("passengers")[0].seatNumber).toBe("2A");
    expect(decision()).toMatchObject({
      state: "not_checked_in",
      boardingDenied: false,
    });
    expect(fixture.rows("dcs_operation_events").map(row => row.action)).toEqual(
      ["deny", "allow"]
    );
  });

  it("keeps releaseSeat available without clearing denial or permitting reselection", async () => {
    await selectSeat(11, "1A", 3, 4);
    await transition("deny");
    const denied = structuredClone(decision());

    await expect(releaseSeat(11, "1A")).resolves.toMatchObject({
      success: true,
    });
    expect(seat("1A")).toMatchObject({
      status: "available",
      bookingId: null,
      passengerId: null,
    });
    expect(decision()).toEqual(denied);
    const released = snapshot();
    await expect(selectSeat(11, "2A", 3, 4)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("denied"),
    });
    expect(snapshot()).toEqual(released);
  });

  it("keeps the denial scoped to its passenger and flight", async () => {
    await transition("deny");
    const denied = structuredClone(decision());
    await expect(selectSeat(11, "1A", 3, 5)).resolves.toMatchObject({
      passengerId: 5,
      flightId: 11,
    });
    await expect(selectSeat(12, "1A", 3, 4)).resolves.toMatchObject({
      passengerId: 4,
      flightId: 12,
    });
    expect(decision()).toEqual(denied);
  });

  it("does not let allow attach a passenger from another booking", async () => {
    await transition("deny");
    await transition("allow");
    const before = snapshot();
    await expect(selectSeat(11, "1A", 3, 6)).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Passenger does not belong to booking",
    });
    expect(snapshot()).toEqual(before);
  });

  it("retains the router ownership check for a foreign user after allow", async () => {
    await transition("deny");
    await transition("allow");
    const before = snapshot();
    const foreign = seatMapRouter.createCaller({
      user: { id: 8, role: "user", tenantId: 1 },
      tenantId: 1,
      req: { headers: {} },
      res: {},
    } as never);

    await expect(
      foreign.selectSeat({ ...key, seatNumber: "1A" })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "You do not own this booking",
    });
    expect(snapshot()).toEqual(before);
  });

  it.each(["checked_in", "boarded"] as const)(
    "preserves the seat and pass identity when selection is attempted while %s",
    async state => {
      await checkInDcsPassenger(
        { ...key, seatNumber: "1A", ...command() },
        actor
      );
      if (state === "boarded") await transition("board");
      const before = snapshot();

      await expect(selectSeat(11, "2A", 3, 4)).rejects.toMatchObject({
        code: expect.stringMatching(/^(CONFLICT|PRECONDITION_FAILED)$/),
      });
      expect(snapshot()).toEqual(before);
    }
  );

  it.each(["unpaid", "unreserved"] as const)(
    "retains the funded inventory gate after allow for %s bookings",
    async condition => {
      await transition("deny");
      await transition("allow");
      if (condition === "unpaid")
        fixture.rows("bookings")[0].paymentStatus = "pending";
      else fixture.rows("booking_segments")[0].seatsReserved = false;
      const before = snapshot();

      await expect(selectSeat(11, "1A", 3, 4)).rejects.toThrow(
        "Seat selection requires funded inventory"
      );
      expect(snapshot()).toEqual(before);
    }
  );

  it.each(["current", "target"] as const)(
    "does not bypass paid-seat servicing for the %s seat after allow",
    async paidSeat => {
      await selectSeat(11, "1A", 3, 4);
      await transition("deny");
      await transition("allow");
      seat(paidSeat === "current" ? "1A" : "2A").seatPrice = 1500;
      const before = snapshot();

      await expect(selectSeat(11, "2A", 3, 4)).rejects.toMatchObject({
        code: "CONFLICT",
        message:
          paidSeat === "current"
            ? "Use paid seat servicing before releasing this seat"
            : "Seat unavailable in booked cabin",
      });
      expect(snapshot()).toEqual(before);
    }
  );
});
