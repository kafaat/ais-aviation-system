import { eq } from "drizzle-orm";
import { getDb } from "../db";
import {
  userPreferences,
  type InsertUserPreference,
  type UserPreference,
} from "../../drizzle/schema";

/**
 * Get user preferences by user ID
 */
export async function getUserPreferences(
  userId: number
): Promise<UserPreference | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  return result[0] || null;
}

/**
 * Create or update user preferences
 */
export async function upsertUserPreferences(
  userId: number,
  data: Partial<
    Omit<InsertUserPreference, "userId" | "id" | "createdAt" | "updatedAt">
  >
): Promise<UserPreference> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // The unique userId arbitrates concurrent first writes. Update only supplied
  // fields so disjoint passport/notification requests do not reset each other.
  await db
    .insert(userPreferences)
    .values({ ...data, userId })
    .onDuplicateKeyUpdate({ set: { ...data, updatedAt: new Date() } });

  const persisted = await getUserPreferences(userId);
  if (!persisted) throw new Error("Failed to save preferences");
  return persisted;
}

/**
 * Delete user preferences
 */
export async function deleteUserPreferences(userId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(userPreferences).where(eq(userPreferences.userId, userId));
}

/**
 * Get saved passport info for quick booking
 */
export async function getSavedPassportInfo(userId: number): Promise<{
  passportNumber: string | null;
  passportExpiry: Date | null;
  nationality: string | null;
} | null> {
  const prefs = await getUserPreferences(userId);
  if (!prefs) return null;

  return {
    passportNumber: prefs.passportNumber,
    passportExpiry: prefs.passportExpiry,
    nationality: prefs.nationality,
  };
}

/**
 * Update saved passport info
 */
export async function updatePassportInfo(
  userId: number,
  data: {
    passportNumber?: string;
    passportExpiry?: Date;
    nationality?: string;
  }
): Promise<void> {
  await upsertUserPreferences(userId, data);
}

/**
 * Get notification preferences
 */
export async function getNotificationPreferences(userId: number): Promise<{
  emailNotifications: boolean;
  smsNotifications: boolean;
}> {
  const prefs = await getUserPreferences(userId);

  return {
    emailNotifications: prefs?.emailNotifications ?? true,
    smsNotifications: prefs?.smsNotifications ?? false,
  };
}

/**
 * Update notification preferences
 */
export async function updateNotificationPreferences(
  userId: number,
  data: {
    emailNotifications?: boolean;
    smsNotifications?: boolean;
  }
): Promise<void> {
  await upsertUserPreferences(userId, data);
}
