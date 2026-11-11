import { eq, and } from "drizzle-orm";
import { getDb } from "../db";
import type { SettlementTx } from "./booking-settlement.service";
import {
  savedPassengers,
  users,
  type SavedPassenger,
  type InsertSavedPassenger,
} from "../../drizzle/schema";

/**
 * Get all saved passengers for a user
 */
export async function getUserPassengers(
  userId: number
): Promise<SavedPassenger[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db
    .select()
    .from(savedPassengers)
    .where(eq(savedPassengers.userId, userId))
    .orderBy(savedPassengers.isDefault, savedPassengers.lastName);
}

/**
 * Get a single saved passenger by ID
 */
export async function getPassenger(
  id: number,
  userId: number
): Promise<SavedPassenger | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .select()
    .from(savedPassengers)
    .where(and(eq(savedPassengers.id, id), eq(savedPassengers.userId, userId)))
    .limit(1);

  return result[0] || null;
}

/**
 * Get the default passenger for a user
 */
export async function getDefaultPassenger(
  userId: number
): Promise<SavedPassenger | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .select()
    .from(savedPassengers)
    .where(
      and(
        eq(savedPassengers.userId, userId),
        eq(savedPassengers.isDefault, true)
      )
    )
    .limit(1);

  return result[0] || null;
}

// Every writer locks the stable owner row, including the first insertion when
// no passenger row exists to lock. Keep ownership checks and readback in the
// same transaction, so a failed switch preserves the previous default.
async function withPassengerOwner<T>(
  userId: number,
  run: (tx: SettlementTx) => Promise<T>
): Promise<T> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(async tx => {
    const [owner] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    if (!owner) throw new Error("User not found");
    return run(tx);
  });
}

async function ownedPassenger(tx: SettlementTx, id: number, userId: number) {
  const [passenger] = await tx
    .select()
    .from(savedPassengers)
    .where(and(eq(savedPassengers.id, id), eq(savedPassengers.userId, userId)))
    .for("update");
  if (!passenger) throw new Error("Passenger not found");
  return passenger;
}

async function ensureDefault(tx: SettlementTx, userId: number) {
  const rows = await tx
    .select()
    .from(savedPassengers)
    .where(eq(savedPassengers.userId, userId))
    .orderBy(savedPassengers.id)
    .for("update");
  if (rows.length && !rows.some(row => row.isDefault)) {
    await tx
      .update(savedPassengers)
      .set({ isDefault: true })
      .where(
        and(
          eq(savedPassengers.id, rows[0].id),
          eq(savedPassengers.userId, userId)
        )
      );
  }
}

/** Add a saved passenger. A nonempty collection always has a default. */
export function addPassenger(
  userId: number,
  data: Omit<InsertSavedPassenger, "userId" | "id" | "createdAt" | "updatedAt">
): Promise<SavedPassenger> {
  return withPassengerOwner(userId, async tx => {
    if (data.isDefault) {
      await tx
        .update(savedPassengers)
        .set({ isDefault: false })
        .where(eq(savedPassengers.userId, userId));
    }
    const [result] = await tx.insert(savedPassengers).values({
      ...data,
      userId,
      isDefault: Boolean(data.isDefault),
    });
    await ensureDefault(tx, userId);
    return ownedPassenger(tx, Number(result.insertId), userId);
  });
}

export function updatePassenger(
  id: number,
  userId: number,
  data: Partial<
    Omit<InsertSavedPassenger, "userId" | "id" | "createdAt" | "updatedAt">
  >
): Promise<SavedPassenger> {
  return withPassengerOwner(userId, async tx => {
    await ownedPassenger(tx, id, userId);
    if (data.isDefault) {
      await tx
        .update(savedPassengers)
        .set({ isDefault: false })
        .where(eq(savedPassengers.userId, userId));
    }
    await tx
      .update(savedPassengers)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(eq(savedPassengers.id, id), eq(savedPassengers.userId, userId))
      );
    await ensureDefault(tx, userId);
    return ownedPassenger(tx, id, userId);
  });
}

export function deletePassenger(id: number, userId: number): Promise<void> {
  return withPassengerOwner(userId, async tx => {
    await ownedPassenger(tx, id, userId);
    await tx
      .delete(savedPassengers)
      .where(
        and(eq(savedPassengers.id, id), eq(savedPassengers.userId, userId))
      );
    await ensureDefault(tx, userId);
  });
}

export function setDefaultPassenger(
  id: number,
  userId: number
): Promise<SavedPassenger> {
  return updatePassenger(id, userId, { isDefault: true });
}
