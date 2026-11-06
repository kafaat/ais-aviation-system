import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import type { TrpcContext } from "../_core/context";
import { transactionMemory } from "./helpers/transaction-memory";

const boundary = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: () => boundary.db }));
vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));

import { seatMapRouter } from "../routers/seat-map";
import {
  releaseSeat,
  type SeatReleaseAuthorization,
} from "../services/seat-map.service";

// This rollback-capable boundary double exercises authorization and state
// transitions. The native acceptance suite separately exercises MySQL races.
const authorization: SeatReleaseAuthorization = {
  actor: { userId: 7, tenantId: 1 },
  expected: { bookingId: 3, passengerId: 4 },
};
let fixture: ReturnType<typeof transactionMemory>;
const caller = (userId = 7, tenantId: number | null = 1) =>
  seatMapRouter.createCaller({
    user: { id: userId, tenantId, role: "user" },
    tenantId,
    authMethod: "cookie",
  } as TrpcContext);
const seat = () => fixture.rows("seat_inventory")[0];
const passenger = (id = 4) =>
  fixture.rows("passengers").find(row => row.id === id);
const booking = () => fixture.rows("bookings")[0];
const snapshot = () =>
  structuredClone({
    bookings: fixture.rows("bookings"),
    seats: fixture.rows("seat_inventory"),
    passengers: fixture.rows("passengers"),
    flights: fixture.rows("flights"),
  });

beforeEach(() => {
  fixture = transactionMemory({
    bookings: [
      { id: 3, userId: 7, tenantId: 1, flightId: 11, deletedAt: null },
      { id: 9, userId: 8, tenantId: 1, flightId: 11, deletedAt: null },
    ],
    flights: [{ id: 11, tenantId: 1, dcsClosedAt: null }],
    passengers: [
      { id: 4, bookingId: 3, tenantId: 1, seatNumber: "1A" },
      { id: 5, bookingId: 3, tenantId: 1, seatNumber: null },
      { id: 6, bookingId: 9, tenantId: 1, seatNumber: null },
    ],
    seat_inventory: [
      {
        id: 1,
        flightId: 11,
        seatNumber: "1A",
        bookingId: 3,
        passengerId: 4,
        status: "occupied",
        seatPrice: 0,
        assignedAt: new Date("2030-11-20T10:00:00Z"),
        boardingGroup: null,
        boardingSequence: null,
        boardingPassIssued: false,
        checkInNonce: null,
      },
    ],
  });
  boundary.db = fixture.db;
});

describe("transaction-bound seat release authorization", () => {
  it("releases the owner's exact assignment and primary-flight mirror", async () => {
    await expect(
      caller().releaseSeat({ flightId: 11, seatNumber: "1A" })
    ).resolves.toEqual({ success: true, seatNumber: "1A" });
    expect(seat()).toMatchObject({
      status: "available",
      bookingId: null,
      passengerId: null,
      assignedAt: null,
    });
    expect(passenger().seatNumber).toBeNull();
    expect(fixture.lockedTables).toEqual([
      "bookings",
      "flights",
      "passengers",
      "seat_inventory",
    ]);
  });

  it.each([
    ["another owner", 8, 1],
    ["another tenant", 7, 2],
    ["a missing tenant", 7, null],
  ] as const)(
    "rejects %s without changing state",
    async (_, userId, tenantId) => {
      const before = snapshot();
      await expect(
        releaseSeat(11, "1A", {
          ...authorization,
          actor: { userId, tenantId },
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(snapshot()).toEqual(before);
    }
  );

  it.each([
    ["another booking", 9, 6],
    ["another passenger in the same booking", 3, 5],
  ] as const)(
    "rejects a reassignment to %s after router preflight",
    async (_, bookingId, passengerId) => {
      const transaction = fixture.db.transaction;
      let transferred: ReturnType<typeof snapshot> | undefined;
      vi.spyOn(fixture.db, "transaction").mockImplementationOnce(
        async (run: any) => {
          // A committed transfer happens after the router's ownership read and
          // before the release transaction. Its replacement must survive.
          Object.assign(seat(), { bookingId, passengerId });
          passenger().seatNumber = null;
          passenger(passengerId).seatNumber = "1A";
          transferred = snapshot();
          return transaction(run);
        }
      );

      await expect(
        caller().releaseSeat({ flightId: 11, seatNumber: "1A" })
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: "Seat assignment changed; refresh and retry",
      });
      expect(snapshot()).toEqual(transferred);
      expect(seat()).toMatchObject({
        status: "occupied",
        bookingId,
        passengerId,
      });
    }
  );

  it.each([
    ["owner", { userId: 8 }],
    ["tenant", { tenantId: 2 }],
  ] as const)(
    "rechecks the booking %s after preflight",
    async (_, replacement) => {
      const transaction = fixture.db.transaction;
      let transferred: ReturnType<typeof snapshot> | undefined;
      vi.spyOn(fixture.db, "transaction").mockImplementationOnce(
        async (run: any) => {
          Object.assign(booking(), replacement);
          transferred = snapshot();
          return transaction(run);
        }
      );
      await expect(
        caller().releaseSeat({ flightId: 11, seatNumber: "1A" })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(snapshot()).toEqual(transferred);
    }
  );

  it.each([
    ["paid seat", { seatPrice: 1500 }, "CONFLICT"],
    ["checked-in seat", { status: "checked_in" }, "BAD_REQUEST"],
    ["blocked seat", { status: "blocked" }, "CONFLICT"],
    ["restricted seat", { status: "restricted" }, "CONFLICT"],
  ])("preserves the %s guard", async (_, replacement, code) => {
    Object.assign(seat(), replacement);
    const before = snapshot();
    await expect(releaseSeat(11, "1A", authorization)).rejects.toMatchObject({
      code,
    });
    expect(snapshot()).toEqual(before);
  });

  it("preserves final DCS closure", async () => {
    fixture.rows("flights")[0].dcsClosedAt = new Date("2030-11-20T11:00:00Z");
    const before = snapshot();
    await expect(releaseSeat(11, "1A", authorization)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("Final DCS closure"),
    });
    expect(snapshot()).toEqual(before);
  });

  it("releases an owned hold with no passenger without requiring an active booking", async () => {
    Object.assign(booking(), { status: "cancelled", seatsReserved: false });
    Object.assign(seat(), { status: "held", passengerId: null });
    passenger().seatNumber = null;
    await expect(
      releaseSeat(11, "1A", {
        ...authorization,
        expected: { bookingId: 3, passengerId: null },
      })
    ).resolves.toEqual({ success: true, seatNumber: "1A" });
    expect(seat()).toMatchObject({
      status: "available",
      bookingId: null,
      passengerId: null,
    });
  });

  it.each(["onward flight", "different seat"])(
    "preserves a passenger mirror for an %s",
    async scenario => {
      if (scenario === "onward flight") booking().flightId = 10;
      else passenger().seatNumber = "2A";
      const before = passenger().seatNumber;
      await releaseSeat(11, "1A", authorization);
      expect(passenger().seatNumber).toBe(before);
    }
  );

  it("rejects a conditional-write miss without clearing the passenger", async () => {
    const update = fixture.db.update;
    vi.spyOn(fixture.db, "update").mockImplementation((table: any) =>
      getTableName(table) === "seat_inventory"
        ? { set: () => ({ where: async () => [{ affectedRows: 0 }] }) }
        : update(table)
    );
    const before = snapshot();
    await expect(releaseSeat(11, "1A", authorization)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(snapshot()).toEqual(before);
  });

  it("rolls back the seat release if the passenger write fails", async () => {
    const update = fixture.db.update;
    vi.spyOn(fixture.db, "update").mockImplementation((table: any) =>
      getTableName(table) === "passengers"
        ? {
            set: () => ({
              where: async () => {
                throw new Error("Injected passenger write failure");
              },
            }),
          }
        : update(table)
    );
    const before = snapshot();
    await expect(releaseSeat(11, "1A", authorization)).rejects.toThrow(
      "Injected passenger write failure"
    );
    expect(snapshot()).toEqual(before);
  });
});
