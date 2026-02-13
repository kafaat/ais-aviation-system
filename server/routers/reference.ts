import { publicProcedure, router } from "../_core/trpc";
import * as db from "../db";

/**
 * Reference Data Router
 * Handles all reference data operations (airlines, airports, etc.)
 */
export const referenceRouter = router({
  /**
   * Get all active airlines
   */
  airlines: publicProcedure.query(async () => {
    return await db.getAllAirlines();
  }),

  /**
   * Get all airports
   */
  airports: publicProcedure.query(async () => {
    return await db.getAllAirports();
  }),
});
