import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import {
  getTranslation,
  getEntityTranslations,
  setTranslation,
  setEntityTranslations,
  deleteTranslation,
  getAvailableLocales,
} from "../services/i18n.service";
import { SUPPORTED_LOCALES } from "../../drizzle/schema-i18n";

/**
 * i18n Router
 * Handles translation-related API endpoints
 */

const localeEnum = z.enum(["ar", "en", "fr", "es", "de"]);

export const i18nRouter = router({
  /**
   * Get supported locales
   */
  getSupportedLocales: publicProcedure.query(async () => {
    return SUPPORTED_LOCALES;
  }),

  /**
   * Get translation for a specific field
   */
  getTranslation: publicProcedure
    .input(
      z.object({
        contentType: z.string(),
        entityId: z.number().int().positive(),
        fieldName: z.string(),
        locale: localeEnum.optional(),
      })
    )
    .query(async ({ input }) => {
      const translation = await getTranslation(
        input.contentType,
        input.entityId,
        input.fieldName,
        input.locale
      );

      return {
        contentType: input.contentType,
        entityId: input.entityId,
        fieldName: input.fieldName,
        locale: input.locale || "ar",
        value: translation,
      };
    }),

  /**
   * Get all translations for an entity
   */
  getEntityTranslations: publicProcedure
    .input(
      z.object({
        contentType: z.string(),
        entityId: z.number().int().positive(),
        locale: localeEnum.optional(),
      })
    )
    .query(async ({ input }) => {
      const translations = await getEntityTranslations(
        input.contentType,
        input.entityId,
        input.locale
      );

      return {
        contentType: input.contentType,
        entityId: input.entityId,
        locale: input.locale || "ar",
        translations,
      };
    }),

  /**
   * Set translation (protected - admin only)
   */
  setTranslation: protectedProcedure
    .input(
      z.object({
        contentType: z.string(),
        entityId: z.number().int().positive(),
        fieldName: z.string(),
        locale: localeEnum,
        value: z.string(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await setTranslation(
        input.contentType,
        input.entityId,
        input.fieldName,
        input.locale,
        input.value,
        ctx.user.id.toString()
      );

      return {
        success: true,
        message: "Translation saved successfully",
      };
    }),

  /**
   * Set multiple translations for an entity (protected - admin only)
   */
  setEntityTranslations: protectedProcedure
    .input(
      z.object({
        contentType: z.string(),
        entityId: z.number().int().positive(),
        locale: localeEnum,
        translations: z.record(z.string()),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await setEntityTranslations(
        input.contentType,
        input.entityId,
        input.locale,
        input.translations,
        ctx.user.id.toString()
      );

      return {
        success: true,
        message: "Translations saved successfully",
      };
    }),

  /**
   * Delete translation (protected - admin only)
   */
  deleteTranslation: protectedProcedure
    .input(
      z.object({
        contentType: z.string(),
        entityId: z.number().int().positive(),
        fieldName: z.string(),
        locale: localeEnum,
      })
    )
    .mutation(async ({ input }) => {
      await deleteTranslation(
        input.contentType,
        input.entityId,
        input.fieldName,
        input.locale
      );

      return {
        success: true,
        message: "Translation deleted successfully",
      };
    }),

  /**
   * Get available locales for an entity
   */
  getAvailableLocales: publicProcedure
    .input(
      z.object({
        contentType: z.string(),
        entityId: z.number().int().positive(),
      })
    )
    .query(async ({ input }) => {
      const locales = await getAvailableLocales(input.contentType, input.entityId);

      return {
        contentType: input.contentType,
        entityId: input.entityId,
        availableLocales: locales,
      };
    }),
});
