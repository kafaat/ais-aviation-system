import { and, eq, gt, isNull, ne, sql } from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";
import { inventoryLocks, seatHolds } from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";

function canonicalHoldCondition(
  flightId: number | AnyMySqlColumn,
  cabin: "economy" | "business",
  now: Date,
  ownLockId?: number | null
) {
  return and(
    eq(inventoryLocks.flightId, flightId),
    eq(inventoryLocks.cabinClass, cabin),
    eq(inventoryLocks.status, "active"),
    gt(inventoryLocks.expiresAt, now),
    ownLockId ? ne(inventoryLocks.id, ownLockId) : undefined
  );
}

function legacyHoldCondition(
  flightId: number | AnyMySqlColumn,
  cabin: "economy" | "business",
  now: Date
) {
  return and(
    eq(seatHolds.flightId, flightId),
    eq(seatHolds.cabinClass, cabin),
    eq(seatHolds.status, "active"),
    gt(seatHolds.expiresAt, now),
    isNull(seatHolds.inventoryLockId)
  );
}

/** Read-only counterpart of the writer's hold count. Correlated aggregates
 * allow filtering effective capacity BEFORE limiting alternative flights.
 * Expired rows are ignored without running the mutating expiry sweeper. */
export function availableSeatsExpression(
  flightId: AnyMySqlColumn,
  recorded: AnyMySqlColumn,
  cabin: "economy" | "business",
  now: Date
) {
  return sql<number>`greatest(0, ${recorded}
    - (select coalesce(sum(${inventoryLocks.numberOfSeats}), 0) from ${inventoryLocks}
       where ${canonicalHoldCondition(flightId, cabin, now)})
    - (select coalesce(sum(${seatHolds.seats}), 0) from ${seatHolds}
       where ${legacyHoldCondition(flightId, cabin, now)}))`.mapWith(Number);
}

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
    .where(canonicalHoldCondition(flightId, cabin, now, ownLockId));
  const legacy = tx
    .select({ seats: seatHolds.seats })
    .from(seatHolds)
    .where(legacyHoldCondition(flightId, cabin, now));
  const rows = [
    ...(await (lock ? canonical.for("update") : canonical)),
    ...(await (lock ? legacy.for("update") : legacy)),
  ];
  return rows.reduce((sum, row) => sum + Number(row.seats), 0);
}
