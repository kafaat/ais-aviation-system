import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { transactionMemory } from "./helpers/transaction-memory";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => state.db }));
vi.mock("../_core/middleware/procedure-rate-limit", () => ({
  enforceProcedureRateLimit: vi.fn(),
}));
import { inventoryRouter } from "../routers/inventory.router";

let fx: ReturnType<typeof transactionMemory>;
const mk = (tenantId: number | null) =>
  inventoryRouter.createCaller({
    user: { id: 101, role: "user", tenantId },
    tenantId,
    req: { headers: {} },
    res: {},
  } as TrpcContext);
const caller = mk(1);
const platform = mk(null);
const future = (ms = 3600000) => new Date(Date.now() + ms);
const flight = (
  id: number,
  tenantId: number | null,
  o: Record<string, unknown> = {}
) => ({
  id,
  tenantId,
  airlineId: 2,
  originId: 1,
  destinationId: 2,
  economySeats: 20,
  economyAvailable: 20,
  businessSeats: 4,
  businessAvailable: 0,
  status: "scheduled",
  departureTime: future(86400000),
  ...o,
});
beforeEach(() => {
  fx = transactionMemory({
    flights: [flight(41, 1), flight(42, 3), flight(43, null)],
    inventory_locks: [],
    seat_holds: [],
    waitlist: [],
    overbooking_config: [],
  });
  const dialect = new MySqlDialect();
  state.db = Object.assign(fx.db, {
    query: {
      flights: {
        findFirst: ({ where }: { where: SQL }) => {
          const id = dialect.sqlToQuery(where).params[0];
          return Promise.resolve(
            structuredClone(fx.rows("flights").find(r => r.id === id))
          );
        },
      },
    },
  });
});
const nothing = () => {
  expect(fx.rows("inventory_locks")).toEqual([]);
  expect(fx.rows("seat_holds")).toEqual([]);
  expect(fx.rows("waitlist")).toEqual([]);
};

describe("inventory tenant, waitlist and hold guards: edge cases", () => {
  it("E1 allocateSeats on a missing flight -> NOT_FOUND, nothing written", async () => {
    await expect(
      caller.allocateSeats({
        flightId: 999,
        cabinClass: "economy",
        seats: 1,
        sessionId: "s",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    nothing();
  });
  it("E2 addToWaitlist on a missing flight -> NOT_FOUND", async () => {
    await expect(
      caller.addToWaitlist({ flightId: 999, cabinClass: "business", seats: 1 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    nothing();
  });
  it("E3 tenant user on an untenanted flight -> NOT_FOUND (createBooking rule)", async () => {
    await expect(
      caller.allocateSeats({
        flightId: 43,
        cabinClass: "economy",
        seats: 1,
        sessionId: "s",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      caller.addToWaitlist({ flightId: 43, cabinClass: "business", seats: 1 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    nothing();
  });
  it("E4 platform caller (tenantId null) is not tenant-restricted (createBooking rule)", async () => {
    await expect(
      platform.allocateSeats({
        flightId: 42,
        cabinClass: "economy",
        seats: 1,
        sessionId: "p",
      })
    ).resolves.toMatchObject({ success: true });
  });
  it("E5 partial path that would exceed the ceiling refuses whole request, no queue entry, no new hold", async () => {
    fx.rows("flights")[0].economyAvailable = 11;
    fx.rows("inventory_locks").push({
      id: 1,
      flightId: 41,
      cabinClass: "economy",
      numberOfSeats: 8,
      userId: 101,
      status: "active",
      expiresAt: future(),
    });
    await expect(
      caller.allocateSeats({
        flightId: 41,
        cabinClass: "economy",
        seats: 5,
        sessionId: "partial-ceiling",
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("at most 9"),
    });
    expect(fx.rows("inventory_locks")).toHaveLength(1);
    expect(fx.rows("seat_holds")).toEqual([]);
    expect(fx.rows("waitlist")).toEqual([]);
  });
  it("E6 seat count 0 and 10 rejected at input", async () => {
    await expect(
      caller.allocateSeats({
        flightId: 41,
        cabinClass: "economy",
        seats: 0,
        sessionId: "s",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.allocateSeats({
        flightId: 41,
        cabinClass: "economy",
        seats: 10,
        sessionId: "s",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.addToWaitlist({ flightId: 41, cabinClass: "business", seats: 10 })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.addToWaitlist({
        flightId: -1,
        cabinClass: "business",
        seats: 1,
      } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    nothing();
  });
  it("E7 foreign flight on the partial path -> NOT_FOUND, nothing written", async () => {
    fx.rows("flights")[1].economyAvailable = 3;
    await expect(
      caller.allocateSeats({
        flightId: 42,
        cabinClass: "economy",
        seats: 5,
        sessionId: "fp",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    nothing();
  });
  it("E8 an entry in the other cabin does not block joining this cabin", async () => {
    fx.rows("flights")[0].economyAvailable = 0;
    fx.rows("waitlist").push({
      id: 1,
      flightId: 41,
      cabinClass: "business",
      userId: 101,
      seats: 1,
      status: "waiting",
      priority: 1,
    });
    await expect(
      caller.addToWaitlist({ flightId: 41, cabinClass: "economy", seats: 1 })
    ).resolves.toMatchObject({ data: { priority: 1 } });
  });
  it("E9 another user's waiting entry does not block", async () => {
    fx.rows("waitlist").push({
      id: 1,
      flightId: 41,
      cabinClass: "business",
      userId: 202,
      seats: 1,
      status: "waiting",
      priority: 1,
    });
    await expect(
      caller.addToWaitlist({ flightId: 41, cabinClass: "business", seats: 1 })
    ).resolves.toMatchObject({ data: { priority: 2 } });
  });
  it("E10 own entry on a different flight does not block", async () => {
    fx.rows("waitlist").push({
      id: 1,
      flightId: 43,
      cabinClass: "business",
      userId: 101,
      seats: 1,
      status: "waiting",
      priority: 1,
    });
    await expect(
      caller.addToWaitlist({ flightId: 41, cabinClass: "business", seats: 1 })
    ).resolves.toMatchObject({ data: { priority: 1 } });
  });
  it("E11 delayed flight accepts a waitlist request", async () => {
    fx.rows("flights")[0].status = "delayed";
    await expect(
      caller.addToWaitlist({ flightId: 41, cabinClass: "business", seats: 1 })
    ).resolves.toMatchObject({ success: true });
  });
  it("E12 allocateSeats waitlist-only path on a cancelled flight -> BAD_REQUEST, no entry", async () => {
    Object.assign(fx.rows("flights")[0], { status: "cancelled" });
    fx.rows("waitlist").push({
      id: 1,
      flightId: 41,
      cabinClass: "business",
      userId: 202,
      seats: 1,
      status: "waiting",
      priority: 1,
    });
    await expect(
      caller.allocateSeats({
        flightId: 41,
        cabinClass: "business",
        seats: 1,
        sessionId: "c",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fx.rows("waitlist")).toHaveLength(1);
  });
  it("E13 expired or released legacy holds do not count toward the ceiling", async () => {
    fx.rows("seat_holds").push(
      {
        id: 1,
        flightId: 41,
        cabinClass: "economy",
        seats: 5,
        userId: 101,
        status: "active",
        expiresAt: future(-1000),
        inventoryLockId: null,
      },
      {
        id: 2,
        flightId: 41,
        cabinClass: "economy",
        seats: 5,
        userId: 101,
        status: "released",
        expiresAt: future(),
        inventoryLockId: null,
      },
      {
        id: 3,
        flightId: 41,
        cabinClass: "economy",
        seats: 5,
        userId: 202,
        status: "active",
        expiresAt: future(),
        inventoryLockId: null,
      },
      {
        id: 4,
        flightId: 42,
        cabinClass: "economy",
        seats: 5,
        userId: 101,
        status: "active",
        expiresAt: future(),
        inventoryLockId: null,
      }
    );
    await expect(
      caller.allocateSeats({
        flightId: 41,
        cabinClass: "economy",
        seats: 9,
        sessionId: "legacy-filters",
      })
    ).resolves.toMatchObject({ success: true, data: { seatsAllocated: 9 } });
  });
});
