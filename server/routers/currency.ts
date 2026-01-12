import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "../_core/trpc";
import { SUPPORTED_CURRENCIES } from "../../drizzle/schema";
import {
  getAllExchangeRates,
  convertFromSAR,
  convertToSAR,
  formatCurrency,
  getUserPreferredCurrency,
  setUserPreferredCurrency,
} from "../services/currency.service";

/**
 * Currency Router
 * Handles multi-currency operations
 */
export const currencyRouter = router({
  /**
   * Get all supported currencies
   */
  getSupportedCurrencies: publicProcedure.query(() => {
    return SUPPORTED_CURRENCIES;
  }),

  /**
   * Get all current exchange rates
   */
  getExchangeRates: publicProcedure.query(async () => {
    return await getAllExchangeRates();
  }),

  /**
   * Convert amount from SAR to another currency
   */
  convertFromSAR: publicProcedure
    .input(
      z.object({
        amountInSAR: z.number().int().positive(),
        targetCurrency: z.enum([
          "SAR", "USD", "EUR", "GBP", "AED", "KWD", "BHD", "OMR", "QAR", "EGP"
        ]),
      })
    )
    .query(async ({ input }) => {
      const convertedAmount = await convertFromSAR(input.amountInSAR, input.targetCurrency);
      const formatted = formatCurrency(convertedAmount, input.targetCurrency);
      
      return {
        amountInCents: convertedAmount,
        formatted,
      };
    }),

  /**
   * Convert amount to SAR from another currency
   */
  convertToSAR: publicProcedure
    .input(
      z.object({
        amount: z.number().int().positive(),
        sourceCurrency: z.enum([
          "SAR", "USD", "EUR", "GBP", "AED", "KWD", "BHD", "OMR", "QAR", "EGP"
        ]),
      })
    )
    .query(async ({ input }) => {
      const convertedAmount = await convertToSAR(input.amount, input.sourceCurrency);
      const formatted = formatCurrency(convertedAmount, "SAR");
      
      return {
        amountInCents: convertedAmount,
        formatted,
      };
    }),

  /**
   * Format amount with currency symbol
   */
  formatAmount: publicProcedure
    .input(
      z.object({
        amountInCents: z.number().int(),
        currency: z.enum([
          "SAR", "USD", "EUR", "GBP", "AED", "KWD", "BHD", "OMR", "QAR", "EGP"
        ]),
      })
    )
    .query(({ input }) => {
      return formatCurrency(input.amountInCents, input.currency);
    }),

  /**
   * Get user's preferred currency
   */
  getUserPreference: protectedProcedure.query(async ({ ctx }) => {
    const currency = await getUserPreferredCurrency(ctx.user.id);
    return { preferredCurrency: currency };
  }),

  /**
   * Set user's preferred currency
   */
  setUserPreference: protectedProcedure
    .input(
      z.object({
        currency: z.enum([
          "SAR", "USD", "EUR", "GBP", "AED", "KWD", "BHD", "OMR", "QAR", "EGP"
        ]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await setUserPreferredCurrency(ctx.user.id, input.currency);
      return { success: true, preferredCurrency: input.currency };
    }),
});
