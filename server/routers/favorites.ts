import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import * as favoritesService from "../services/favorites.service";

export const favoritesRouter = router({
  // ============================================================================
  // Individual Flight Favorites (specific flights)
  // ============================================================================

  /**
   * Add a specific flight to favorites
   */
  addFlight: protectedProcedure
    .input(
      z.object({
        flightId: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await favoritesService.addFlightFavorite(
        ctx.user.id,
        input.flightId
      );
    }),

  /**
   * Remove a specific flight from favorites
   */
  removeFlight: protectedProcedure
    .input(
      z.object({
        flightId: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await favoritesService.removeFlightFavorite(
        ctx.user.id,
        input.flightId
      );
    }),

  /**
   * Get user's favorite flights (specific flights)
   */
  getFlights: protectedProcedure.query(async ({ ctx }) => {
    return await favoritesService.getUserFlightFavorites(ctx.user.id);
  }),

  /**
   * Check if a specific flight is favorited
   */
  isFlightFavorited: protectedProcedure
    .input(
      z.object({
        flightId: z.number().int().positive(),
      })
    )
    .query(async ({ ctx, input }) => {
      return await favoritesService.isFlightFavorited(
        ctx.user.id,
        input.flightId
      );
    }),

  // ============================================================================
  // Route Favorites (origin/destination pairs)
  // ============================================================================

  /**
   * Add a favorite flight route
   */
  add: protectedProcedure
    .input(
      z.object({
        originId: z.number().int().positive(),
        destinationId: z.number().int().positive(),
        airlineId: z.number().int().positive().optional(),
        cabinClass: z.enum(["economy", "business"]).optional(),
        enablePriceAlert: z.boolean().optional(),
        maxPrice: z.number().int().positive().optional(),
        emailNotifications: z.boolean().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await favoritesService.addFavorite({
        userId: ctx.user.id,
        ...input,
      });
    }),

  /**
   * Get user's favorite flights
   */
  getAll: protectedProcedure.query(async ({ ctx }) => {
    return await favoritesService.getUserFavorites(ctx.user.id);
  }),

  /**
   * Update favorite settings
   */
  update: protectedProcedure
    .input(
      z.object({
        favoriteId: z.number().int().positive(),
        enablePriceAlert: z.boolean().optional(),
        maxPrice: z.number().int().positive().optional(),
        emailNotifications: z.boolean().optional(),
        notes: z.string().optional(),
        cabinClass: z.enum(["economy", "business"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await favoritesService.updateFavorite({
        userId: ctx.user.id,
        ...input,
      });
    }),

  /**
   * Delete a favorite
   */
  delete: protectedProcedure
    .input(
      z.object({
        favoriteId: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await favoritesService.deleteFavorite(
        input.favoriteId,
        ctx.user.id
      );
    }),

  /**
   * Check if a route is favorited
   */
  isFavorited: protectedProcedure
    .input(
      z.object({
        originId: z.number().int().positive(),
        destinationId: z.number().int().positive(),
        airlineId: z.number().int().positive().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      return await favoritesService.isFavorited({
        userId: ctx.user.id,
        ...input,
      });
    }),

  /**
   * Get price alert history for a favorite
   */
  getPriceAlertHistory: protectedProcedure
    .input(
      z.object({
        favoriteId: z.number().int().positive(),
      })
    )
    .query(async ({ ctx, input }) => {
      return await favoritesService.getPriceAlertHistory(
        input.favoriteId,
        ctx.user.id
      );
    }),

  /**
   * Get current best prices for a favorite
   */
  getBestPrices: protectedProcedure
    .input(
      z.object({
        favoriteId: z.number().int().positive(),
      })
    )
    .query(async ({ ctx, input }) => {
      return await favoritesService.getBestPricesForFavorite(
        input.favoriteId,
        ctx.user.id
      );
    }),

  /**
   * Check for price alerts and notify (admin only - for cron job)
   */
  checkPriceAlerts: protectedProcedure.mutation(async ({ ctx }) => {
    // Only allow admins to trigger this
    if (ctx.user?.role !== "admin") {
      throw new Error("Unauthorized");
    }
    return await favoritesService.checkPriceAlertsAndNotify();
  }),
});
