import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { priceLocks, flights } from "../../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";

const LOCK_DURATION_HOURS = 48;
const LOCK_FEE_CENTS = 2500; // 25 SAR

export async function createPriceLock(
  userId: number,
  flightId: number,
  cabinClass: "economy" | "business"
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Get current flight price (read-only, safe outside transaction)
  const [flight] = await db
    .select({
      economyPrice: flights.economyPrice,
      businessPrice: flights.businessPrice,
      departureTime: flights.departureTime,
    })
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);

  if (!flight) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
  }

  // Cannot lock if flight departs within 24 hours
  const now = new Date();
  const hoursUntilDeparture =
    (flight.departureTime.getTime() - now.getTime()) / (1000 * 60 * 60);
  if (hoursUntilDeparture < 24) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cannot lock price for flights departing within 24 hours",
    });
  }

  const price =
    cabinClass === "business" ? flight.businessPrice : flight.economyPrice;

  const expiresAt = new Date(
    now.getTime() + LOCK_DURATION_HOURS * 60 * 60 * 1000
  );

  // Use a transaction to atomically check-then-insert, preventing duplicate
  // active locks from concurrent requests
  return await db.transaction(async tx => {
    // Check for existing active lock inside the transaction
    const [existing] = await tx
      .select()
      .from(priceLocks)
      .where(
        and(
          eq(priceLocks.userId, userId),
          eq(priceLocks.flightId, flightId),
          eq(priceLocks.cabinClass, cabinClass),
          eq(priceLocks.status, "active")
        )
      )
      .limit(1);

    if (existing) {
      return { lock: existing, alreadyExists: true };
    }

    const [result] = await tx.insert(priceLocks).values({
      userId,
      flightId,
      cabinClass,
      lockedPrice: price,
      originalPrice: price,
      lockFee: LOCK_FEE_CENTS,
      status: "active",
      expiresAt,
    });

    const [lock] = await tx
      .select()
      .from(priceLocks)
      .where(eq(priceLocks.id, result.insertId))
      .limit(1);

    return { lock, alreadyExists: false };
  });
}

export async function getUserPriceLocks(userId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  return await db
    .select({
      id: priceLocks.id,
      flightId: priceLocks.flightId,
      cabinClass: priceLocks.cabinClass,
      lockedPrice: priceLocks.lockedPrice,
      originalPrice: priceLocks.originalPrice,
      lockFee: priceLocks.lockFee,
      status: priceLocks.status,
      expiresAt: priceLocks.expiresAt,
      createdAt: priceLocks.createdAt,
      flightNumber: flights.flightNumber,
      departureTime: flights.departureTime,
      currentEconomyPrice: flights.economyPrice,
      currentBusinessPrice: flights.businessPrice,
    })
    .from(priceLocks)
    .innerJoin(flights, eq(priceLocks.flightId, flights.id))
    .where(eq(priceLocks.userId, userId))
    .orderBy(sql`${priceLocks.createdAt} DESC`);
}

export async function cancelPriceLock(userId: number, lockId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const [lock] = await db
    .select()
    .from(priceLocks)
    .where(and(eq(priceLocks.id, lockId), eq(priceLocks.userId, userId)))
    .limit(1);

  if (!lock)
    throw new TRPCError({ code: "NOT_FOUND", message: "Price lock not found" });
  if (lock.status !== "active")
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Price lock is not active",
    });

  await db
    .update(priceLocks)
    .set({ status: "cancelled" })
    .where(eq(priceLocks.id, lockId));

  return { success: true };
}

export async function usePriceLock(lockId: number, bookingId: number) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  // Validate the lock is active before marking as used, inside a transaction
  // to prevent race conditions with concurrent use or expiration
  await db.transaction(async tx => {
    const [lock] = await tx
      .select({ status: priceLocks.status, expiresAt: priceLocks.expiresAt })
      .from(priceLocks)
      .where(eq(priceLocks.id, lockId))
      .limit(1);

    if (!lock) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Price lock not found",
      });
    }

    if (lock.status !== "active") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Price lock is ${lock.status}, cannot be used`,
      });
    }

    if (lock.expiresAt < new Date()) {
      await tx
        .update(priceLocks)
        .set({ status: "expired" })
        .where(eq(priceLocks.id, lockId));
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Price lock has expired",
      });
    }

    await tx
      .update(priceLocks)
      .set({ status: "used", bookingId })
      .where(eq(priceLocks.id, lockId));
  });
}

export async function getActiveLockForFlight(
  userId: number,
  flightId: number,
  cabinClass: "economy" | "business"
) {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const now = new Date();

  const [lock] = await db
    .select()
    .from(priceLocks)
    .where(
      and(
        eq(priceLocks.userId, userId),
        eq(priceLocks.flightId, flightId),
        eq(priceLocks.cabinClass, cabinClass),
        eq(priceLocks.status, "active")
      )
    )
    .limit(1);

  if (!lock) return null;

  // Check if expired
  if (lock.expiresAt < now) {
    await db
      .update(priceLocks)
      .set({ status: "expired" })
      .where(eq(priceLocks.id, lock.id));
    return null;
  }

  return lock;
}

export async function expireOldLocks() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });

  const now = new Date();

  const result = await db
    .update(priceLocks)
    .set({ status: "expired" })
    .where(
      and(
        eq(priceLocks.status, "active"),
        sql`${priceLocks.expiresAt} < ${now}`
      )
    );

  return { expired: result[0].affectedRows };
}
