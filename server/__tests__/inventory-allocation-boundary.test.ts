import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../db", () => ({ getDb: () => state.db }));
import {
  allocateSeats,
  getInventoryStatus,
} from "../services/inventory/inventory.service";

let fixture: ReturnType<typeof transactionMemory>;
const future = () => new Date(Date.now() + 600000);
const hold = (overrides = {}) => ({
  id: 1,
  flightId: 41,
  cabinClass: "economy",
  numberOfSeats: 1,
  status: "active",
  expiresAt: future(),
  ...overrides,
});

beforeEach(() => {
  fixture = transactionMemory({
    flights: [
      {
        id: 41,
        tenantId: 3,
        airlineId: 2,
        originId: 1,
        destinationId: 2,
        economySeats: 5,
        economyAvailable: 2,
        businessSeats: 3,
        businessAvailable: 3,
        status: "scheduled",
        departureTime: new Date(Date.now() + 3600000),
      },
    ],
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

describe("inventory allocation through real services and rollback boundaries", () => {
  it("creates one canonical lock and one linked display hold without double-counting capacity", async () => {
    const result = await allocateSeats(
      41,
      "economy",
      1,
      9,
      "allocation-session"
    );
    expect(result).toMatchObject({
      success: true,
      seatsAllocated: 1,
      holdId: 1,
      lockId: 1,
    });
    expect(fixture.rows("inventory_locks")).toHaveLength(1);
    expect(fixture.rows("seat_holds")).toHaveLength(1);
    expect(fixture.rows("seat_holds")[0]).toMatchObject({
      inventoryLockId: 1,
      userId: 9,
      sessionId: "allocation-session",
      seats: 1,
    });
    expect(fixture.rows("inventory_locks")[0].expiresAt).toEqual(
      fixture.rows("seat_holds")[0].expiresAt
    );
    expect(await getInventoryStatus(41, "economy")).toMatchObject({
      heldSeats: 1,
      effectiveAvailable: 1,
    });
    expect(fixture.rows("flights")[0].economyAvailable).toBe(2);
  });

  it("allocates available seats and queues only the remainder after the highest historic priority", async () => {
    fixture.rows("waitlist").push({
      id: 1,
      flightId: 41,
      cabinClass: "economy",
      priority: 7,
      status: "expired",
      seats: 1,
    });
    const result = await allocateSeats(41, "economy", 4, 9, "partial-session");
    expect(result).toMatchObject({
      success: true,
      seatsAllocated: 2,
      waitlistPosition: 8,
    });
    expect(fixture.rows("seat_holds")[0].seats).toBe(2);
    expect(fixture.rows("waitlist")[1]).toMatchObject({
      seats: 2,
      priority: 8,
      userId: 9,
      status: "waiting",
    });
    expect(await getInventoryStatus(41, "economy")).toMatchObject({
      heldSeats: 2,
      effectiveAvailable: 0,
      status: "waitlist_only",
    });
  });

  it("rolls back both a partial allocation's lock and hold if inserting its waitlist remainder fails", async () => {
    fixture.failInsert("waitlist");
    await expect(
      allocateSeats(41, "economy", 4, 9, "partial-failure")
    ).rejects.toThrow("Injected insert failure");
    expect(fixture.rows("inventory_locks")).toEqual([]);
    expect(fixture.rows("seat_holds")).toEqual([]);
    expect(fixture.rows("waitlist")).toEqual([]);
    expect(fixture.rows("flights")[0].economyAvailable).toBe(2);
  });

  it("rolls back the canonical lock when creating its display hold fails", async () => {
    fixture.failInsert("seat_holds");
    await expect(
      allocateSeats(41, "economy", 1, 9, "alias-failure")
    ).rejects.toThrow("Injected insert failure");
    expect(fixture.rows("inventory_locks")).toEqual([]);
    expect(fixture.rows("seat_holds")).toEqual([]);
  });

  it("rechecks capacity under the flight lock after an earlier availability read", async () => {
    const transact = fixture.db.transaction.bind(fixture.db);
    vi.spyOn(fixture.db, "transaction").mockImplementationOnce(
      async (run: (tx: unknown) => Promise<unknown>) => {
        // Deterministic interleaving; the native suite proves actual row locking.
        fixture
          .rows("inventory_locks")
          .push(hold({ id: 99, numberOfSeats: 2 }));
        return transact(run);
      }
    );
    await expect(
      allocateSeats(41, "economy", 1, 9, "stale-read")
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fixture.rows("inventory_locks").map(row => row.id)).toEqual([99]);
    expect(fixture.rows("seat_holds")).toEqual([]);
  });

  it("queues the full request only for an existing open queue when no seats remain", async () => {
    fixture.rows("flights")[0].economyAvailable = 0;
    expect(await allocateSeats(41, "economy", 2, 9, "closed")).toMatchObject({
      success: false,
      seatsAllocated: 0,
    });
    expect(fixture.rows("waitlist")).toHaveLength(0);
    fixture.rows("waitlist").push({
      id: 1,
      flightId: 41,
      cabinClass: "economy",
      priority: 1,
      status: "waiting",
      seats: 1,
    });
    expect(await allocateSeats(41, "economy", 2, 9, "queued")).toMatchObject({
      success: false,
      seatsAllocated: 0,
      waitlistPosition: 2,
    });
    expect(fixture.rows("waitlist")[1]).toMatchObject({ seats: 2, userId: 9 });
    expect(fixture.rows("inventory_locks")).toEqual([]);
  });

  it("counts only current holds in the selected cabin and never counts a linked alias twice", async () => {
    fixture.rows("inventory_locks").push(
      hold({ numberOfSeats: 1 }),
      hold({ id: 2, status: "converted", numberOfSeats: 20 }),
      hold({
        id: 3,
        expiresAt: new Date(Date.now() - 1000),
        numberOfSeats: 20,
      }),
      hold({ id: 4, flightId: 99, numberOfSeats: 20 }),
      hold({ id: 5, cabinClass: "business", numberOfSeats: 1 })
    );
    fixture.rows("seat_holds").push(
      { ...hold(), seats: 1, inventoryLockId: 1 },
      { ...hold({ id: 2 }), seats: 1, inventoryLockId: null },
      {
        ...hold({ id: 3, status: "released" }),
        seats: 20,
        inventoryLockId: null,
      }
    );
    expect(await getInventoryStatus(41, "economy")).toMatchObject({
      heldSeats: 2,
      availableSeats: 0,
      effectiveAvailable: 0,
    });
    expect(await getInventoryStatus(41, "business")).toMatchObject({
      heldSeats: 1,
      availableSeats: 2,
      effectiveAvailable: 2,
    });
  });

  it.each([
    { total: 100, available: 50, status: "available", occupancyRate: 0.5 },
    { total: 100, available: 10, status: "limited", occupancyRate: 0.9 },
    { total: 100, available: 2, status: "waitlist_only", occupancyRate: 0.98 },
    { total: 0, available: 0, status: "closed", occupancyRate: 0 },
  ])(
    "reports $status capacity honestly with $available of $total seats",
    async ({ total, available, status, occupancyRate }) => {
      Object.assign(fixture.rows("flights")[0], {
        economySeats: total,
        economyAvailable: available,
      });
      expect(await getInventoryStatus(41, "economy")).toMatchObject({
        status,
        effectiveAvailable: available,
        occupancyRate,
      });
    }
  );

  it("refuses new holds after final DCS closure without inserting either hold record", async () => {
    fixture.rows("flights")[0].dcsClosedAt = new Date();
    await expect(
      allocateSeats(41, "economy", 1, 9, "closed-dcs")
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(fixture.rows("inventory_locks")).toEqual([]);
    expect(fixture.rows("seat_holds")).toEqual([]);
  });

  it("fails explicitly on an absent database or missing flight", async () => {
    await expect(getInventoryStatus(404, "economy")).rejects.toThrow(
      "Flight 404 not found"
    );
    state.db = null;
    await expect(allocateSeats(41, "economy", 1, 9, "offline")).rejects.toThrow(
      "Database connection not available"
    );
  });
});
