/**
 * inventory.allocateSeats and inventory.addToWaitlist enforce the guards of
 * the canonical booking and waitlist paths: tenant scope, waitlist
 * eligibility, and a per-user hold ceiling of one booking's passengers.
 */
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

const OWN_FLIGHT = 41;
const FOREIGN_FLIGHT = 42;
// One booking carries at most nine passengers (the router's seat bound).
const MAX_SEATS = 9;

let fixture: ReturnType<typeof transactionMemory>;
const caller = inventoryRouter.createCaller({
  user: { id: 101, role: "user", tenantId: 1 },
  tenantId: 1,
  req: { headers: {} },
  res: {},
} as TrpcContext);

const future = (ms = 3600000) => new Date(Date.now() + ms);
const flight = (id: number, tenantId: number) => ({
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
});
const lock = (overrides: Record<string, unknown>) => ({
  flightId: OWN_FLIGHT,
  cabinClass: "economy",
  numberOfSeats: 1,
  status: "active",
  expiresAt: future(),
  ...overrides,
});
const entry = (overrides: Record<string, unknown>) => ({
  flightId: OWN_FLIGHT,
  cabinClass: "business",
  seats: 1,
  status: "waiting",
  priority: 1,
  ...overrides,
});

beforeEach(() => {
  fixture = transactionMemory({
    flights: [flight(OWN_FLIGHT, 1), flight(FOREIGN_FLIGHT, 3)],
    inventory_locks: [],
    seat_holds: [],
    waitlist: [],
    overbooking_config: [],
  });
  const dialect = new MySqlDialect();
  state.db = Object.assign(fixture.db, {
    query: {
      flights: {
        findFirst: ({ where }: { where: SQL }) => {
          const id = dialect.sqlToQuery(where).params[0];
          return Promise.resolve(
            structuredClone(fixture.rows("flights").find(row => row.id === id))
          );
        },
      },
    },
  });
});

const nothingWritten = () => {
  expect(fixture.rows("inventory_locks")).toEqual([]);
  expect(fixture.rows("seat_holds")).toEqual([]);
};

describe("tenant scope", () => {
  it("refuses to hold seats on another tenant's flight", async () => {
    await expect(
      caller.allocateSeats({
        flightId: FOREIGN_FLIGHT,
        cabinClass: "economy",
        seats: 1,
        sessionId: "foreign-hold",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    nothingWritten();
    expect(fixture.rows("waitlist")).toEqual([]);
  });

  it("refuses to queue an allocation on another tenant's full flight", async () => {
    fixture
      .rows("waitlist")
      .push(entry({ id: 1, userId: 202, flightId: FOREIGN_FLIGHT }));
    await expect(
      caller.allocateSeats({
        flightId: FOREIGN_FLIGHT,
        cabinClass: "business",
        seats: 1,
        sessionId: "foreign-queue",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fixture.rows("waitlist")).toHaveLength(1);
  });

  it("refuses to join another tenant's waitlist", async () => {
    await expect(
      caller.addToWaitlist({
        flightId: FOREIGN_FLIGHT,
        cabinClass: "business",
        seats: 1,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fixture.rows("waitlist")).toEqual([]);
  });

  it("still serves the caller's own tenant", async () => {
    await expect(
      caller.allocateSeats({
        flightId: OWN_FLIGHT,
        cabinClass: "economy",
        seats: 2,
        sessionId: "own-hold",
      })
    ).resolves.toMatchObject({ success: true, data: { seatsAllocated: 2 } });
    await expect(
      caller.addToWaitlist({
        flightId: OWN_FLIGHT,
        cabinClass: "business",
        seats: 1,
      })
    ).resolves.toMatchObject({
      success: true,
      data: { priority: 1, userId: 101, status: "waiting" },
    });
  });
});

describe("waitlist eligibility", () => {
  it("refuses a waitlist request that unheld seats can satisfy", async () => {
    await expect(
      caller.addToWaitlist({
        flightId: OWN_FLIGHT,
        cabinClass: "economy",
        seats: 2,
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("still available"),
    });
    expect(fixture.rows("waitlist")).toEqual([]);
  });

  it("accepts a request once the remaining seats are held by others", async () => {
    fixture.rows("flights")[0].economyAvailable = 2;
    fixture
      .rows("inventory_locks")
      .push(lock({ id: 1, userId: 202, numberOfSeats: 2 }));
    await expect(
      caller.addToWaitlist({
        flightId: OWN_FLIGHT,
        cabinClass: "economy",
        seats: 1,
      })
    ).resolves.toMatchObject({ data: { priority: 1, seats: 1 } });
  });

  it.each(["waiting", "offered"])(
    "refuses a second entry while one is %s",
    async status => {
      fixture.rows("waitlist").push(entry({ id: 1, userId: 101, status }));
      await expect(
        caller.addToWaitlist({
          flightId: OWN_FLIGHT,
          cabinClass: "business",
          seats: 2,
        })
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("already on the waitlist"),
      });
      expect(fixture.rows("waitlist")).toHaveLength(1);
    }
  );

  it("refuses a duplicate queued through allocateSeats as well", async () => {
    fixture.rows("waitlist").push(entry({ id: 1, userId: 101 }));
    await expect(
      caller.allocateSeats({
        flightId: OWN_FLIGHT,
        cabinClass: "business",
        seats: 1,
        sessionId: "duplicate-queue",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fixture.rows("waitlist")).toHaveLength(1);
  });

  it("allows rejoining after an earlier entry ended", async () => {
    fixture
      .rows("waitlist")
      .push(entry({ id: 1, userId: 101, status: "cancelled" }));
    await expect(
      caller.addToWaitlist({
        flightId: OWN_FLIGHT,
        cabinClass: "business",
        seats: 1,
      })
    ).resolves.toMatchObject({ data: { priority: 2 } });
  });

  it.each([
    ["cancelled", { status: "cancelled" }],
    ["completed", { status: "completed" }],
    ["departed", { departureTime: new Date(Date.now() - 60000) }],
  ])("refuses to queue on a %s flight", async (_label, change) => {
    Object.assign(fixture.rows("flights")[0], change);
    await expect(
      caller.addToWaitlist({
        flightId: OWN_FLIGHT,
        cabinClass: "business",
        seats: 1,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fixture.rows("waitlist")).toEqual([]);
  });
});

describe("per-user hold ceiling", () => {
  const hold = (seats: number, sessionId: string) =>
    caller.allocateSeats({
      flightId: OWN_FLIGHT,
      cabinClass: "economy",
      seats,
      sessionId,
    });

  it("refuses holds that would give one user more seats than one booking carries", async () => {
    await expect(hold(MAX_SEATS, "first")).resolves.toMatchObject({
      success: true,
    });
    await expect(hold(1, "second")).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(fixture.rows("inventory_locks")).toHaveLength(1);
    expect(fixture.rows("seat_holds")).toHaveLength(1);
  });

  it("counts the user's current holds in every cabin, including legacy holds", async () => {
    fixture.rows("inventory_locks").push(
      lock({ id: 1, userId: 101, cabinClass: "business", numberOfSeats: 3 }),
      // Not counted: other users, other flights, ended or expired holds.
      lock({ id: 2, userId: 202, numberOfSeats: 9 }),
      lock({ id: 3, userId: 101, flightId: FOREIGN_FLIGHT, numberOfSeats: 9 }),
      lock({ id: 4, userId: 101, status: "released", numberOfSeats: 9 }),
      lock({ id: 5, userId: 101, expiresAt: future(-1000), numberOfSeats: 9 })
    );
    fixture.rows("seat_holds").push({
      id: 1,
      flightId: OWN_FLIGHT,
      cabinClass: "economy",
      seats: 2,
      userId: 101,
      status: "active",
      expiresAt: future(),
      inventoryLockId: null,
    });
    await expect(hold(4, "fills-ceiling")).resolves.toMatchObject({
      success: true,
      data: { seatsAllocated: 4 },
    });
    await expect(hold(1, "over-ceiling")).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining(`at most ${MAX_SEATS}`),
    });
    expect(fixture.rows("inventory_locks")).toHaveLength(6);
  });

  it("frees the ceiling when the user releases a hold", async () => {
    const first = await hold(MAX_SEATS, "before-release");
    await caller.releaseHold({ holdId: first.data.holdId ?? 0 });
    await expect(hold(MAX_SEATS, "after-release")).resolves.toMatchObject({
      success: true,
    });
  });
});
