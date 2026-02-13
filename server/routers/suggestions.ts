/**
 * Suggestions Router
 * Provides personalized and popular flight suggestions
 */

import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import {
  getUserSuggestions,
  getPopularFlightSuggestions,
  getDealSuggestions,
} from "../services/smart-suggestions.service";

export const suggestionsRouter = router({
  /**
   * Get personalized suggestions for authenticated user
   */
  forUser: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(20).default(6),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 6;
      return await getUserSuggestions(ctx.user.id, limit);
    }),

  /**
   * Get popular flight suggestions (no auth required)
   */
  popular: publicProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(20).default(6),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const limit = input?.limit ?? 6;
      return await getPopularFlightSuggestions(limit);
    }),

  /**
   * Get deal/cheap flight suggestions
   */
  deals: publicProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(20).default(4),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const limit = input?.limit ?? 4;
      return await getDealSuggestions(limit);
    }),
});
