import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { inventoryLocks, flights } from "../../drizzle/schema";
import { eq, and, lt, sql } from "drizzle-orm";

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
  userId?: number
): Promise<{ lockId: number; expiresAt: Date }> {
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    await releaseExpiredLocks();

    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + LOCK_DURATION_MINUTES);

    const result = await database.transaction(async tx => {
      const [flight] = await tx
        .select({
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

      const currentAvailable =
        cabinClass === "economy"
          ? flight.economyAvailable
          : flight.businessAvailable;

      const [lockResult] = await tx
        .select({
          lockedSeats: sql<number>`COALESCE(SUM(${inventoryLocks.numberOfSeats}), 0)`,
        })
        .from(inventoryLocks)
        .where(
          and(
            eq(inventoryLocks.flightId, flightId),
            eq(inventoryLocks.cabinClass, cabinClass),
            eq(inventoryLocks.status, "active")
          )
        );

      const lockedSeats = lockResult?.lockedSeats || 0;
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

      return { lockId: (insertResult as any).insertId };
    });

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
export async function releaseInventoryLock(lockId: number): Promise<void> {
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    await database
      .update(inventoryLocks)
      .set({
        status: "released",
        releasedAt: new Date(),
      })
      .where(eq(inventoryLocks.id, lockId));
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
      .where(eq(inventoryLocks.id, lockId));
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
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    const now = new Date();

    const [result] = await database
      .update(inventoryLocks)
      .set({
        status: "expired",
        releasedAt: now,
      })
      .where(
        and(
          eq(inventoryLocks.status, "active"),
          lt(inventoryLocks.expiresAt, now)
        )
      );

    const affectedRows = (result as any).affectedRows || 0;

    if (affectedRows > 0) {
      console.log(`[Inventory] Released ${affectedRows} expired locks`);
    }

    return affectedRows;
  } catch (error) {
    console.error("Error releasing expired locks:", error);
    return 0;
  }
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

    const [lockResult] = await database
      .select({
        lockedSeats: sql<number>`COALESCE(SUM(${inventoryLocks.numberOfSeats}), 0)`,
      })
      .from(inventoryLocks)
      .where(
        and(
          eq(inventoryLocks.flightId, flightId),
          eq(inventoryLocks.cabinClass, cabinClass),
          eq(inventoryLocks.status, "active")
        )
      );

    const lockedSeats = lockResult?.lockedSeats || 0;

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
          eq(inventoryLocks.status, "active")
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

    // Verify lock first
    const isValid = await verifyLock(lockId, sessionId);
    if (!isValid) {
      return null;
    }

    // Extend by another 15 minutes
    const newExpiresAt = new Date();
    newExpiresAt.setMinutes(newExpiresAt.getMinutes() + LOCK_DURATION_MINUTES);

    await database
      .update(inventoryLocks)
      .set({ expiresAt: newExpiresAt })
      .where(eq(inventoryLocks.id, lockId));

    return newExpiresAt;
  } catch (error) {
    console.error("Error extending lock:", error);
    return null;
  }
}
