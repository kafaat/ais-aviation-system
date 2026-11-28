import { and, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import type { AnyMySqlColumn } from "drizzle-orm/mysql-core";
import { TRPCError } from "@trpc/server";
import {
  flights,
  users,
  inventoryLocks,
  seatHolds,
} from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";

/** Range locks on an absent child hold under REPEATABLE READ can cover another
 * flight's insertion gap. Writers serialize on the existing flight primary key
 * before checking its capacity. READ COMMITTED at the transaction boundary
 * keeps hold scans current without locking unrelated insertion gaps.
 * Existing caller-owned transactions retain their isolation and locking reads. */
export const inventoryTransactionConfig = {
  isolationLevel: "read committed",
} as const;

export function withInventoryTransaction<T>(
  db: SettlementTx,
  run: (tx: SettlementTx) => Promise<T>
): Promise<T> {
  return db.transaction(run, inventoryTransactionConfig);
}

/** Lock the buyer before the flight so a reassignment and inventory mutation serialize. */
export async function lockPurchaserFlight(
  tx: SettlementTx,
  flightId: number,
  userId: number
) {
  const [actor] = await tx
    .select({ tenantId: users.tenantId })
    .from(users)
    .where(eq(users.id, userId))
    .for("update");
  const [flight] = await tx
    .select()
    .from(flights)
    .where(eq(flights.id, flightId))
    .for("update");
  if (
    !actor ||
    !flight ||
    (actor.tenantId != null && actor.tenantId !== flight.tenantId)
  )
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
  return flight;
}

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

/** Aggregate cabin holds for read-only search; writers use the locking path below. */
export async function readCabinHoldTotals(
  tx: SettlementTx,
  flightIds: number[],
  now: Date
) {
  const totals = new Map<number, { economy: number; business: number }>();
  if (!flightIds.length) return totals;
  const canonical = await tx
    .select({
      flightId: inventoryLocks.flightId,
      cabin: inventoryLocks.cabinClass,
      seats: sql<number>`SUM(${inventoryLocks.numberOfSeats})`.mapWith(Number),
    })
    .from(inventoryLocks)
    .where(
      and(
        inArray(inventoryLocks.flightId, flightIds),
        eq(inventoryLocks.status, "active"),
        gt(inventoryLocks.expiresAt, now)
      )
    )
    .groupBy(inventoryLocks.flightId, inventoryLocks.cabinClass);
  const legacy = await tx
    .select({
      flightId: seatHolds.flightId,
      cabin: seatHolds.cabinClass,
      seats: sql<number>`SUM(${seatHolds.seats})`.mapWith(Number),
    })
    .from(seatHolds)
    .where(
      and(
        inArray(seatHolds.flightId, flightIds),
        eq(seatHolds.status, "active"),
        gt(seatHolds.expiresAt, now),
        isNull(seatHolds.inventoryLockId)
      )
    )
    .groupBy(seatHolds.flightId, seatHolds.cabinClass);
  for (const row of [...canonical, ...legacy]) {
    const cabins = totals.get(row.flightId) ?? { economy: 0, business: 0 };
    cabins[row.cabin] += row.seats;
    totals.set(row.flightId, cabins);
  }
  return totals;
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
