import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getUserPreferences,
  upsertUserPreferences,
  deleteUserPreferences,
  getSavedPassportInfo,
  updatePassportInfo,
  getNotificationPreferences,
  updateNotificationPreferences,
} from "../services/user-preferences.service";

export const userPreferencesRouter = router({
  /**
   * Get current user's preferences
   */
  getMyPreferences: protectedProcedure.query(async ({ ctx }) => {
    return await getUserPreferences(ctx.user.id);
  }),

  /**
   * Update current user's preferences
   */
  updateMyPreferences: protectedProcedure
    .input(
      z.object({
        preferredSeatType: z.enum(["window", "aisle", "middle"]).optional(),
        preferredCabinClass: z.enum(["economy", "business", "first"]).optional(),
        mealPreference: z.enum(["regular", "vegetarian", "vegan", "halal", "kosher", "gluten_free"]).optional(),
        wheelchairAssistance: z.boolean().optional(),
        extraLegroom: z.boolean().optional(),
        passportNumber: z.string().optional(),
        passportExpiry: z.date().optional(),
        nationality: z.string().optional(),
        phoneNumber: z.string().optional(),
        emergencyContact: z.string().optional(),
        emergencyPhone: z.string().optional(),
        emailNotifications: z.boolean().optional(),
        smsNotifications: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return await upsertUserPreferences(ctx.user.id, input);
    }),

  /**
   * Delete current user's preferences
   */
  deleteMyPreferences: protectedProcedure.mutation(async ({ ctx }) => {
    await deleteUserPreferences(ctx.user.id);
    return { success: true };
  }),

  /**
   * Get saved passport info for quick booking
   */
  getSavedPassport: protectedProcedure.query(async ({ ctx }) => {
    return await getSavedPassportInfo(ctx.user.id);
  }),

  /**
   * Update saved passport info
   */
  updatePassport: protectedProcedure
    .input(
      z.object({
        passportNumber: z.string().optional(),
        passportExpiry: z.date().optional(),
        nationality: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await updatePassportInfo(ctx.user.id, input);
      return { success: true };
    }),

  /**
   * Get notification preferences
   */
  getNotificationSettings: protectedProcedure.query(async ({ ctx }) => {
    return await getNotificationPreferences(ctx.user.id);
  }),

  /**
   * Update notification preferences
   */
  updateNotificationSettings: protectedProcedure
    .input(
      z.object({
        emailNotifications: z.boolean().optional(),
        smsNotifications: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await updateNotificationPreferences(ctx.user.id, input);
      return { success: true };
    }),
});
