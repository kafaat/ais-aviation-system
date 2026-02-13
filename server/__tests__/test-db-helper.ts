/**
 * Test helper for database-dependent tests.
 * Checks if MySQL is actually reachable before running integration tests.
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db";

let _dbAvailable: boolean | null = null;

/**
 * Check if the database is actually reachable.
 * Caches the result for the lifetime of the test process.
 */
export async function isDatabaseAvailable(): Promise<boolean> {
  if (_dbAvailable !== null) return _dbAvailable;

  const db = getDb();
  if (!db) {
    _dbAvailable = false;
    return false;
  }

  try {
    await db.execute(sql`SELECT 1`);
    _dbAvailable = true;
  } catch {
    _dbAvailable = false;
  }

  return _dbAvailable;
}
