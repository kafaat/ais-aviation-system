import { countActiveHolds } from "./inventory-capacity.service";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  inventoryLocks,
  flights,
  bookings,
  seatInventory,
  passengers,
} from "../../drizzle/schema";
import type { SettlementTx } from "./booking-settlement.service";
import { eq, and, lt, gt, sql } from "drizzle-orm";

/**
 * Inventory Lock Service
 * Prevents double booking by temporarily locking seats during checkout
 */

const LOCK_DURATION_MINUTES = 15; // Locks expire after 15 minutes

/**
 * Create a temporary lock on flight inventory
 */
export async function createInventoryLock(
  flightId: number,
  numberOfSeats: number,
  cabinClass: "economy" | "business",
  sessionId: string,
  userId?: number,
  transaction?: SettlementTx,
  durationMinutes = LOCK_DURATION_MINUTES
): Promise<{ lockId: number; expiresAt: Date }> {
  try {
    const database = transaction || (await getDb());
    if (!database) throw new Error("Database not available");

    if (!Number.isSafeInteger(numberOfSeats) || numberOfSeats <= 0)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Seat count must be positive",
      });
    const expiresAt = new Date();
    if (
      !Number.isSafeInteger(durationMinutes) ||
      durationMinutes < 1 ||
      durationMinutes > 1440
    )
      throw new Error("Invalid hold duration");
    expiresAt.setMinutes(expiresAt.getMinutes() + durationMinutes);

    const create = async (tx: SettlementTx) => {
      const [flight] = await tx
        .select({
          status: flights.status,
          departureTime: flights.departureTime,
          economyAvailable: flights.economyAvailable,
          businessAvailable: flights.businessAvailable,
        })
        .from(flights)
        .where(eq(flights.id, flightId))
        .for("update")
        .limit(1);

      if (!flight) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Flight not found",
        });
      }

      if (
        !["scheduled", "delayed"].includes(flight.status) ||
        flight.departureTime <= new Date()
      )
        throw new Error("Flight is unavailable for an inventory hold");
      expiresAt.setTime(
        Math.min(expiresAt.getTime(), flight.departureTime.getTime())
      );
      const currentAvailable =
        cabinClass === "economy"
          ? flight.economyAvailable
          : flight.businessAvailable;

      const lockedSeats = await countActiveHolds(tx, flightId, cabinClass);
      const available = Math.max(0, currentAvailable - lockedSeats);

      if (available < numberOfSeats) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Only ${available} seats available. Requested: ${numberOfSeats}`,
        });
      }

      const [insertResult] = await tx.insert(inventoryLocks).values({
        flightId,
        numberOfSeats,
        cabinClass,
        sessionId,
        userId,
        status: "active",
        expiresAt,
      });

      return { lockId: insertResult.insertId };
    };
    const result = transaction
      ? await create(transaction)
      : await database.transaction(create);

    return {
      lockId: result.lockId,
      expiresAt,
    };
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }
    console.error("Error creating inventory lock:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to lock inventory",
    });
  }
}

/**
 * Release a lock (when user cancels or completes booking)
 */
export async function releaseInventoryLock(
  lockId: number,
  transaction?: SettlementTx
): Promise<void> {
  try {
    const database = transaction ?? getDb();
    if (!database) throw new Error("Database not available");

    await database
      .update(inventoryLocks)
      .set({
        status: "released",
        releasedAt: new Date(),
      })
      .where(
        and(eq(inventoryLocks.id, lockId), eq(inventoryLocks.status, "active"))
      );
  } catch (error) {
    console.error("Error releasing inventory lock:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to release lock",
    });
  }
}

/**
 * Convert lock to booking (when payment succeeds)
 */
export async function convertLockToBooking(lockId: number): Promise<void> {
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    await database
      .update(inventoryLocks)
      .set({
        status: "converted",
        releasedAt: new Date(),
      })
      .where(
        and(eq(inventoryLocks.id, lockId), eq(inventoryLocks.status, "active"))
      );
  } catch (error) {
    console.error("Error converting lock to booking:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to convert lock",
    });
  }
}

/**
 * Release all expired locks
 */
export async function releaseExpiredLocks(): Promise<number> {
  const db = getDb();
  if (!db) throw new Error("Database unavailable");
  const now = new Date();
  const candidates = await db
    .select()
    .from(inventoryLocks)
    .where(
      and(
        eq(inventoryLocks.status, "active"),
        lt(inventoryLocks.expiresAt, now)
      )
    )
    .limit(500);
  let released = 0;
  for (const candidate of candidates) {
    released += await db.transaction(async tx => {
      const linked = await tx
        .select()
        .from(bookings)
        .where(
          sql`(${bookings.inventoryLockId} = ${candidate.id} OR EXISTS (SELECT 1 FROM booking_segments bs WHERE bs.bookingId = ${bookings.id} AND bs.inventoryLockId = ${candidate.id}))`
        )
        .orderBy(bookings.id)
        .for("update");
      await tx
        .select()
        .from(flights)
        .where(eq(flights.id, candidate.flightId))
        .for("update");
      const [hold] = await tx
        .select()
        .from(inventoryLocks)
        .where(eq(inventoryLocks.id, candidate.id))
        .for("update");
      if (!hold || hold.status !== "active" || hold.expiresAt > now) return 0;
      for (const booking of linked.filter(
        b =>
          b.status === "pending" &&
          b.paymentStatus === "pending" &&
          !b.seatsReserved
      )) {
        await tx
          .update(seatInventory)
          .set({
            status: "available",
            bookingId: null,
            passengerId: null,
            assignedAt: null,
            checkedInAt: null,
            checkInNonce: null,
            boardingPassIssued: false,
            boardingGroup: null,
            boardingSequence: null,
          })
          .where(
            and(
              eq(seatInventory.bookingId, booking.id),
              eq(seatInventory.flightId, hold.flightId),
              eq(seatInventory.status, "occupied")
            )
          );
        if (booking.flightId === hold.flightId)
          await tx
            .update(passengers)
            .set({ seatNumber: null })
            .where(eq(passengers.bookingId, booking.id));
      }
      await tx
        .update(inventoryLocks)
        .set({ status: "expired", releasedAt: now })
        .where(eq(inventoryLocks.id, hold.id));
      return 1;
    });
  }
  return released;
}

/**
 * Get available seats considering active locks
 */
export async function getAvailableSeats(
  flightId: number,
  cabinClass: "economy" | "business"
): Promise<number> {
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    // Clean up expired locks first
    await releaseExpiredLocks();

    const [flight] = await database
      .select({
        economyAvailable: flights.economyAvailable,
        businessAvailable: flights.businessAvailable,
      })
      .from(flights)
      .where(eq(flights.id, flightId))
      .limit(1);

    if (!flight) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Flight not found",
      });
    }

    const currentAvailable =
      cabinClass === "economy"
        ? flight.economyAvailable
        : flight.businessAvailable;

    const lockedSeats = await countActiveHolds(
      database,
      flightId,
      cabinClass,
      undefined,
      false
    );

    const available = currentAvailable - lockedSeats;

    return Math.max(0, available);
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }
    console.error("Error getting available seats:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to check seat availability",
    });
  }
}

/**
 * Verify lock is still valid
 */
export async function verifyLock(
  lockId: number,
  sessionId: string
): Promise<boolean> {
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    const [lock] = await database
      .select()
      .from(inventoryLocks)
      .where(
        and(
          eq(inventoryLocks.id, lockId),
          eq(inventoryLocks.sessionId, sessionId),
          eq(inventoryLocks.status, "active"),
          gt(inventoryLocks.expiresAt, new Date())
        )
      )
      .limit(1);

    if (!lock) {
      return false;
    }

    // Check if expired
    if (new Date() > lock.expiresAt) {
      await releaseInventoryLock(lockId);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error verifying lock:", error);
    return false;
  }
}

/**
 * Extend lock expiry (when user is still active)
 */
export async function extendLock(
  lockId: number,
  sessionId: string
): Promise<Date | null> {
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    const now = new Date();
    const newExpiresAt = new Date(
      now.getTime() + LOCK_DURATION_MINUTES * 60_000
    );
    // One current UPDATE prevents extending a hold that was released,
    // converted or expired between validation and writing.
    const [updated] = await database
      .update(inventoryLocks)
      .set({ expiresAt: newExpiresAt })
      .where(
        and(
          eq(inventoryLocks.id, lockId),
          eq(inventoryLocks.sessionId, sessionId),
          eq(inventoryLocks.status, "active"),
          gt(inventoryLocks.expiresAt, now)
        )
      );
    return updated.affectedRows === 1 ? newExpiresAt : null;
  } catch (error) {
    console.error("Error extending lock:", error);
    return null;
  }
}
