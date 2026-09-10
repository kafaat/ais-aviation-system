import { and, eq, gt, isNull, ne } from "drizzle-orm";
import { inventoryLocks, seatHolds } from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";

/** All writers lock the flight before counting or creating holds. Legacy,
 * unlinked seat_holds remain visible until they expire; linked aliases never
 * double count their canonical inventory_locks row. */
export async function countActiveHolds(
  tx: SettlementTx,
  flightId: number,
  cabin: "economy" | "business",
  ownLockId?: number | null,
  lock = true
) {
  const now = new Date();
  const canonical = tx
    .select({ seats: inventoryLocks.numberOfSeats })
    .from(inventoryLocks)
    .where(
      and(
        eq(inventoryLocks.flightId, flightId),
        eq(inventoryLocks.cabinClass, cabin),
        eq(inventoryLocks.status, "active"),
        gt(inventoryLocks.expiresAt, now),
        ownLockId ? ne(inventoryLocks.id, ownLockId) : undefined
      )
    );
  const legacy = tx
    .select({ seats: seatHolds.seats })
    .from(seatHolds)
    .where(
      and(
        eq(seatHolds.flightId, flightId),
        eq(seatHolds.cabinClass, cabin),
        eq(seatHolds.status, "active"),
        gt(seatHolds.expiresAt, now),
        isNull(seatHolds.inventoryLockId)
      )
    );
  const rows = [
    ...(await (lock ? canonical.for("update") : canonical)),
    ...(await (lock ? legacy.for("update") : legacy)),
  ];
  return rows.reduce((sum, row) => sum + Number(row.seats), 0);
}
