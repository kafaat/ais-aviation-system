import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import { flights, inventoryLocks } from "../../drizzle/schema";
import { getDb } from "../../server/db";
import {
  countActiveHolds,
  withInventoryTransaction,
} from "../../server/services/inventory-capacity.service";
import { createInventoryLock } from "../../server/services/inventory-lock.service";

/** Called only on the disposable harness's two freshly seeded, neighboring flights.
 * Keep the read/insert interleaving deterministic; scheduling simultaneous
 * booking calls alone does not reliably reproduce an empty-index-gap collision. */
export async function verifyInventoryHoldConcurrency(
  first: number,
  lastSeat: number,
  userId: number
) {
  const db = getDb();
  assert(db);
  let progressed = 0;
  let openGate = () => {};
  const bothCounted = new Promise<void>(resolve => {
    openGate = resolve;
  });
  const keys = [
    "ci-hold-adjacent-a",
    "ci-hold-adjacent-b",
    "ci-snapshot-winner",
    "ci-snapshot-loser",
    "ci-last-seat-a",
    "ci-last-seat-b",
  ];
  const cleanup = () =>
    db.delete(inventoryLocks).where(inArray(inventoryLocks.sessionId, keys));
  try {
    const claims = await Promise.allSettled(
      [first, lastSeat].map((flightId, i) =>
        withInventoryTransaction(db, async tx => {
          await tx
            .select({ id: flights.id })
            .from(flights)
            .where(eq(flights.id, flightId))
            .for("update");
          assert.equal(await countActiveHolds(tx, flightId, "economy"), 0);
          if (++progressed === 2) openGate();
          await bothCounted;
          await createInventoryLock(
            flightId,
            1,
            "economy",
            keys[i],
            userId,
            tx
          );
        }).catch(error => {
          openGate();
          throw error;
        })
      )
    );
    for (const claim of claims)
      if (claim.status === "rejected") throw claim.reason;
    await cleanup();

    // A caller-supplied RR transaction may have read the empty table before
    // another writer committed. The current hold read under the flight lock
    // must still observe that writer rather than sell its last seat again.
    await db.transaction(
      async tx => {
        assert.equal(
          (
            await tx
              .select()
              .from(inventoryLocks)
              .where(eq(inventoryLocks.flightId, lastSeat))
          ).length,
          0
        );
        await createInventoryLock(lastSeat, 1, "economy", keys[2], userId);
        await assert.rejects(
          createInventoryLock(lastSeat, 1, "economy", keys[3], userId, tx),
          {
            code: "BAD_REQUEST",
            message: "Only 0 seats available. Requested: 1",
          }
        );
      },
      { isolationLevel: "repeatable read" }
    );
    await cleanup();

    const sameFlight = await Promise.allSettled(
      keys
        .slice(4)
        .map(key => createInventoryLock(lastSeat, 1, "economy", key, userId))
    );
    assert.equal(sameFlight.filter(r => r.status === "fulfilled").length, 1);
    const loser = sameFlight.find(r => r.status === "rejected");
    assert.equal(loser?.reason.code, "BAD_REQUEST");
    assert.equal(loser?.reason.message, "Only 0 seats available. Requested: 1");
    assert.equal(
      (
        await db
          .select()
          .from(inventoryLocks)
          .where(eq(inventoryLocks.flightId, lastSeat))
      ).length,
      1
    );
  } finally {
    await cleanup();
  }
}
