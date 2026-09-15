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

  // The flight is the existing resource lock, shared with booking creation.
  // All creations for this logical key serialize even before its first row exists.
  return db.transaction(async tx => {
    const [flight] = await tx
      .select()
      .from(flights)
      .where(eq(flights.id, flightId))
      .for("update");
    if (!flight)
      throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
    const now = new Date();
    if (
      !["scheduled", "delayed"].includes(flight.status) ||
      flight.departureTime.getTime() - now.getTime() < 24 * 3600_000
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Flight is unavailable for a price lock",
      });
    const key = and(
      eq(priceLocks.userId, userId),
      eq(priceLocks.flightId, flightId),
      eq(priceLocks.cabinClass, cabinClass),
      eq(priceLocks.status, "active")
    );
    await tx
      .update(priceLocks)
      .set({ status: "expired" })
      .where(and(key, sql`${priceLocks.expiresAt} <= ${now}`));
    const active = await tx.select().from(priceLocks).where(key).for("update");
    if (active.length > 1)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Duplicate historical price locks require reconciliation",
      });
    if (active[0]) return { lock: active[0], alreadyExists: true };
    const price =
      cabinClass === "business" ? flight.businessPrice : flight.economyPrice;
    const [result] = await tx.insert(priceLocks).values({
      userId,
      flightId,
      cabinClass,
      lockedPrice: price,
      originalPrice: price,
      lockFee: LOCK_FEE_CENTS,
      status: "active",
      expiresAt: new Date(now.getTime() + LOCK_DURATION_HOURS * 3600_000),
    });
    const [lock] = await tx
      .select()
      .from(priceLocks)
      .where(eq(priceLocks.id, result.insertId));
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

  const [result] = await db
    .update(priceLocks)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(priceLocks.id, lockId),
        eq(priceLocks.userId, userId),
        eq(priceLocks.status, "active")
      )
    );
  if (result.affectedRows !== 1)
    throw new TRPCError({
      code: "CONFLICT",
      message: "Price lock is missing or no longer active",
    });
  return { success: true };
}
// Consumption is owned by bookings.service's booking transaction.

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
      .where(
        and(
          eq(priceLocks.id, lock.id),
          eq(priceLocks.status, "active"),
          sql`${priceLocks.expiresAt} <= ${now}`
        )
      );
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
