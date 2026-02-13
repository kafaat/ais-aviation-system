/**
 * Test helper utilities for database operations
 */
import { getDb } from "../../db";

/**
 * Check if database is available for testing
 * @returns true if database connection is available
 */
export async function isDatabaseAvailable(): Promise<boolean> {
  try {
    const db = await getDb();
    if (!db) {
      return false;
    }

    // Try a simple query to verify the connection works
    await db.execute("SELECT 1");
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Helper to conditionally skip tests that require database
 * Use with describe.skipIf or it.skipIf
 */
export const skipIfNoDatabase = async () => {
  const isAvailable = await isDatabaseAvailable();
  return !isAvailable;
};
