import { beforeEach, describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
const boundary = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: () => boundary.db }));
import {
  createInventoryLock,
  extendLock,
  releaseExpiredLocks,
} from "../services/inventory-lock.service";
import { reserveSeats } from "../services/booking-settlement.service";
let fixture: ReturnType<typeof transactionMemory>;
beforeEach(() => {
  fixture = transactionMemory({
    flights: [
      { id: 1, economyAvailable: 1, businessAvailable: 1, status: "scheduled" },
    ],
    inventory_locks: [
      {
        id: 1,
        flightId: 1,
        cabinClass: "economy",
        numberOfSeats: 1,
        sessionId: "active",
        status: "active",
        expiresAt: new Date(Date.now() + 60_000),
      },
      {
        id: 2,
        sessionId: "expired",
        status: "active",
        expiresAt: new Date(Date.now() - 60_000),
      },
      {
        id: 3,
        sessionId: "converted",
        status: "converted",
        expiresAt: new Date(Date.now() - 60_000),
      },
    ],
  });
  boundary.db = fixture.db;
});
describe("inventory hold current state", () => {
  it("uses locking hold reads before rejecting a competing reservation or hold", async () => {
    await expect(reserveSeats(fixture.db, 1, "economy", 1)).rejects.toThrow(
      "Insufficient"
    );
    expect(fixture.lockedTables).toEqual(["flights", "inventory_locks"]);
    fixture.lockedTables.length = 0;
    await expect(
      createInventoryLock(1, 1, "economy", "other", 9)
    ).rejects.toThrow("Only 0 seats");
    expect(fixture.lockedTables).toEqual(["flights", "inventory_locks"]);
    expect(fixture.rows("flights")[0].economyAvailable).toBe(1);
  });
  it("expires only elapsed active holds", async () => {
    expect(await releaseExpiredLocks()).toBe(1);
    expect(fixture.rows("inventory_locks").map(row => row.status)).toEqual([
      "active",
      "expired",
      "converted",
    ]);
    expect(await releaseExpiredLocks()).toBe(0);
  });
  it("never extends expired, converted or another session's holds", async () => {
    expect(await extendLock(1, "wrong")).toBeNull();
    expect(await extendLock(2, "expired")).toBeNull();
    expect(await extendLock(3, "converted")).toBeNull();
    expect(await extendLock(1, "active")).toBeInstanceOf(Date);
    expect(
      fixture.rows("inventory_locks")[0].expiresAt.getTime()
    ).toBeGreaterThan(Date.now() + 14 * 60_000);
  });
});
