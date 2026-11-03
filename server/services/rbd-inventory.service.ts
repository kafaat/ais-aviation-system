import { and, eq, gt, inArray, sql } from "drizzle-orm";
import {
  fareClasses,
  flightFareClassInventory,
  inventoryLocks,
} from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";

export type SellableCabin = "economy" | "business";

export interface RbdAvailability {
  fareClassId: number;
  code: string;
  cabinClass: SellableCabin;
  fareFamily: string | null;
  priority: number;
  totalAllocated: number;
  availableSeats: number;
}

export class RbdInventoryUnavailableError extends Error {}

export async function resolveFlightFareClass(
  tx: SettlementTx,
  flightId: number,
  airlineId: number,
  cabinClass: SellableCabin,
  code: string
) {
  const normalized = code.trim().toUpperCase();
  const [fareClass] = await tx
    .select()
    .from(fareClasses)
    .where(
      and(
        eq(fareClasses.airlineId, airlineId),
        eq(fareClasses.code, normalized),
        eq(fareClasses.cabinClass, cabinClass),
        eq(fareClasses.active, true)
      )
    )
    .limit(1);
  if (!fareClass) return null;
  const [inventory] = await tx
    .select()
    .from(flightFareClassInventory)
    .where(
      and(
        eq(flightFareClassInventory.flightId, flightId),
        eq(flightFareClassInventory.fareClassId, fareClass.id)
      )
    )
    .limit(1);
  return inventory ? { fareClass, inventory } : null;
}

export async function countActiveRbdHolds(
  tx: SettlementTx,
  flightId: number,
  fareClassId: number,
  ownLockId?: number | null,
  lock = true
) {
  const query = tx
    .select({ id: inventoryLocks.id, seats: inventoryLocks.numberOfSeats })
    .from(inventoryLocks)
    .where(
      and(
        eq(inventoryLocks.flightId, flightId),
        eq(inventoryLocks.fareClassId, fareClassId),
        eq(inventoryLocks.status, "active"),
        gt(inventoryLocks.expiresAt, new Date())
      )
    );
  const rows = await (lock ? query.for("update") : query);
  return rows
    .filter(row => row.id !== ownLockId)
    .reduce((sum, row) => sum + Number(row.seats), 0);
}

export async function assertRbdHoldCapacity(
  tx: SettlementTx,
  flightId: number,
  fareClassId: number,
  requestedSeats: number
) {
  const [inventory] = await tx
    .select()
    .from(flightFareClassInventory)
    .where(
      and(
        eq(flightFareClassInventory.flightId, flightId),
        eq(flightFareClassInventory.fareClassId, fareClassId)
      )
    )
    .limit(1)
    .for("update");
  if (!inventory)
    throw new RbdInventoryUnavailableError("RBD inventory is not configured");
  const held = await countActiveRbdHolds(tx, flightId, fareClassId);
  if (inventory.availableSeats - held < requestedSeats)
    throw new RbdInventoryUnavailableError(
      "Requested booking class is unavailable"
    );
}

export async function reserveRbdSeats(
  tx: SettlementTx,
  flightId: number,
  fareClassId: number,
  count: number,
  ownLockId?: number | null
) {
  if (ownLockId != null) {
    const [hold] = await tx
      .select()
      .from(inventoryLocks)
      .where(eq(inventoryLocks.id, ownLockId))
      .limit(1)
      .for("update");
    if (
      !hold ||
      hold.flightId !== flightId ||
      hold.fareClassId !== fareClassId ||
      hold.numberOfSeats !== count ||
      hold.status !== "active" ||
      hold.expiresAt <= new Date()
    )
      throw new RbdInventoryUnavailableError(
        "RBD inventory hold is unavailable"
      );
  }
  const [inventory] = await tx
    .select()
    .from(flightFareClassInventory)
    .where(
      and(
        eq(flightFareClassInventory.flightId, flightId),
        eq(flightFareClassInventory.fareClassId, fareClassId)
      )
    )
    .limit(1)
    .for("update");
  if (!inventory)
    throw new RbdInventoryUnavailableError("RBD inventory is not configured");
  const held = await countActiveRbdHolds(tx, flightId, fareClassId, ownLockId);
  if (inventory.availableSeats - held < count)
    throw new RbdInventoryUnavailableError(
      "Requested booking class is unavailable"
    );
  const [updated] = await tx
    .update(flightFareClassInventory)
    .set({
      availableSeats: sql`${flightFareClassInventory.availableSeats} - ${count}`,
    })
    .where(
      and(
        eq(flightFareClassInventory.id, inventory.id),
        sql`${flightFareClassInventory.availableSeats} >= ${count}`
      )
    );
  if (updated.affectedRows !== 1)
    throw new RbdInventoryUnavailableError(
      "Requested booking class is unavailable"
    );
}

export async function restoreRbdSeats(
  tx: SettlementTx,
  flightId: number,
  fareClassId: number,
  count: number
) {
  const [updated] = await tx
    .update(flightFareClassInventory)
    .set({
      availableSeats: sql`${flightFareClassInventory.availableSeats} + ${count}`,
    })
    .where(
      and(
        eq(flightFareClassInventory.flightId, flightId),
        eq(flightFareClassInventory.fareClassId, fareClassId)
      )
    );
  if (updated.affectedRows !== 1)
    throw new Error("RBD inventory row is missing during restoration");
}

export async function getFlightRbdAvailability(
  tx: SettlementTx,
  flightIds: number[]
): Promise<Map<number, RbdAvailability[]>> {
  const result = new Map<number, RbdAvailability[]>();
  if (!flightIds.length) return result;
  const rows = await tx
    .select()
    .from(flightFareClassInventory)
    .where(inArray(flightFareClassInventory.flightId, flightIds));
  if (!rows.length) return result;
  const ids = [...new Set(rows.map(row => row.fareClassId))];
  const classes = await tx
    .select()
    .from(fareClasses)
    .where(inArray(fareClasses.id, ids));
  const byId = new Map(classes.map(fareClass => [fareClass.id, fareClass]));
  for (const row of rows) {
    const fareClass = byId.get(row.fareClassId);
    if (
      !fareClass?.active ||
      (fareClass.cabinClass !== "economy" &&
        fareClass.cabinClass !== "business")
    )
      continue;
    const held = await countActiveRbdHolds(
      tx,
      row.flightId,
      row.fareClassId,
      undefined,
      false
    );
    const item: RbdAvailability = {
      fareClassId: fareClass.id,
      code: fareClass.code,
      cabinClass: fareClass.cabinClass,
      fareFamily: fareClass.fareFamily,
      priority: fareClass.priority,
      totalAllocated: row.capacity,
      availableSeats: Math.max(0, row.availableSeats - held),
    };
    result.set(row.flightId, [...(result.get(row.flightId) ?? []), item]);
  }
  for (const items of result.values())
    items.sort(
      (a, b) => b.priority - a.priority || a.code.localeCompare(b.code)
    );
  return result;
}
