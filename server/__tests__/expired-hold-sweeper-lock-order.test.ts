import { describe, expect, it, vi } from "vitest";
import { transactionMemory } from "./helpers/transaction-memory";
const boundary = vi.hoisted(() => ({ db: null as any }));
vi.mock("../db", () => ({ getDb: () => boundary.db }));
import { inventoryTransactionConfig } from "../services/inventory-capacity.service";
import { releaseExpiredLocks } from "../services/inventory-lock.service";

/** Lock behaviour itself is proven on native MySQL in
 * expired-hold-sweeper-lock-order-mysql.test.ts; this guards the boundary. */
describe("expired hold sweeper transaction boundary", () => {
  it("expires each hold at READ COMMITTED, locking bookings before the flight and hold", async () => {
    const past = new Date(Date.now() - 60_000);
    const fixture = transactionMemory({
      flights: [{ id: 1 }],
      inventory_locks: [
        { id: 2, flightId: 1, status: "active", expiresAt: past },
        { id: 3, flightId: 1, status: "active", expiresAt: past },
      ],
      bookings: [
        {
          id: 7,
          flightId: 1,
          inventoryLockId: 2,
          status: "pending",
          paymentStatus: "pending",
          seatsReserved: false,
        },
      ],
    });
    const configs: unknown[] = [];
    const transaction = fixture.db.transaction;
    fixture.db.transaction = (run: any, config?: unknown) => {
      configs.push(config);
      return transaction(run, config);
    };
    boundary.db = fixture.db;

    expect(await releaseExpiredLocks()).toBe(2);
    expect(configs).toEqual([
      inventoryTransactionConfig,
      inventoryTransactionConfig,
    ]);
    // Hold 2 locks its linked booking first; hold 3 has none to lock.
    expect(fixture.lockedTables).toEqual([
      "bookings",
      "flights",
      "inventory_locks",
      "flights",
      "inventory_locks",
    ]);
  });
});
