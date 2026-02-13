import { eq, and } from "drizzle-orm";
import { getDb } from "../db";
import {
  savedPassengers,
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

/**
 * Add a new saved passenger
 */
export async function addPassenger(
  userId: number,
  data: Omit<InsertSavedPassenger, "userId" | "id" | "createdAt" | "updatedAt">
): Promise<SavedPassenger> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // If this is being set as default, unset any existing default
  if (data.isDefault) {
    await db
      .update(savedPassengers)
      .set({ isDefault: false })
      .where(eq(savedPassengers.userId, userId));
  }

  // If this is the first passenger, make it default
  const existingPassengers = await getUserPassengers(userId);
  const shouldBeDefault = existingPassengers.length === 0 || data.isDefault;

  const result = await db.insert(savedPassengers).values({
    userId,
    ...data,
    isDefault: shouldBeDefault,
  });

  const insertId = Number(result[0].insertId);
  const created = await getPassenger(insertId, userId);
  if (!created) throw new Error("Failed to create passenger");

  return created;
}

/**
 * Update an existing saved passenger
 */
export async function updatePassenger(
  id: number,
  userId: number,
  data: Partial<
    Omit<InsertSavedPassenger, "userId" | "id" | "createdAt" | "updatedAt">
  >
): Promise<SavedPassenger> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Check if passenger exists and belongs to user
  const existing = await getPassenger(id, userId);
  if (!existing) {
    throw new Error("Passenger not found");
  }

  // If this is being set as default, unset any existing default
  if (data.isDefault) {
    await db
      .update(savedPassengers)
      .set({ isDefault: false })
      .where(eq(savedPassengers.userId, userId));
  }

  await db
    .update(savedPassengers)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(and(eq(savedPassengers.id, id), eq(savedPassengers.userId, userId)));

  const updated = await getPassenger(id, userId);
  if (!updated) throw new Error("Failed to update passenger");

  return updated;
}

/**
 * Delete a saved passenger
 */
export async function deletePassenger(
  id: number,
  userId: number
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Check if passenger exists and belongs to user
  const existing = await getPassenger(id, userId);
  if (!existing) {
    throw new Error("Passenger not found");
  }

  await db
    .delete(savedPassengers)
    .where(and(eq(savedPassengers.id, id), eq(savedPassengers.userId, userId)));

  // If we deleted the default passenger, set another one as default
  if (existing.isDefault) {
    const remaining = await getUserPassengers(userId);
    if (remaining.length > 0) {
      await db
        .update(savedPassengers)
        .set({ isDefault: true })
        .where(eq(savedPassengers.id, remaining[0].id));
    }
  }
}

/**
 * Set a passenger as the default
 */
export async function setDefaultPassenger(
  id: number,
  userId: number
): Promise<SavedPassenger> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Check if passenger exists and belongs to user
  const existing = await getPassenger(id, userId);
  if (!existing) {
    throw new Error("Passenger not found");
  }

  // Unset all defaults for this user
  await db
    .update(savedPassengers)
    .set({ isDefault: false })
    .where(eq(savedPassengers.userId, userId));

  // Set the new default
  await db
    .update(savedPassengers)
    .set({ isDefault: true, updatedAt: new Date() })
    .where(and(eq(savedPassengers.id, id), eq(savedPassengers.userId, userId)));

  const updated = await getPassenger(id, userId);
  if (!updated) throw new Error("Failed to set default passenger");

  return updated;
}
