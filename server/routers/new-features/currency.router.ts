import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import {
  getAllExchangeRates,
  getExchangeRate,
  convertFromSAR,
  formatCurrency,
  fetchLatestExchangeRates,
} from "../services/currency.service";
import { SUPPORTED_CURRENCIES } from "../../drizzle/schema-currency";

/**
 * Currency Router
 * Handles currency-related API endpoints
 */
export const currencyRouter = router({
  /**
   * Get all supported currencies
   */
  getSupportedCurrencies: publicProcedure.query(async () => {
    return SUPPORTED_CURRENCIES;
  }),

  /**
   * Get all exchange rates
   */
  getExchangeRates: publicProcedure.query(async () => {
    return await getAllExchangeRates();
  }),

  /**
   * Get specific exchange rate
   */
  getExchangeRate: publicProcedure
    .input(
      z.object({
        targetCurrency: z.enum(["SAR", "USD", "EUR", "GBP", "AED", "KWD", "BHD", "OMR", "QAR", "EGP"]),
      })
    )
    .query(async ({ input }) => {
      const rate = await getExchangeRate(input.targetCurrency);
      return {
        baseCurrency: "SAR",
        targetCurrency: input.targetCurrency,
        rate,
      };
    }),

  /**
   * Convert amount from SAR to target currency
   */
  convertFromSAR: publicProcedure
    .input(
      z.object({
        amountInSAR: z.number().int().positive(),
        targetCurrency: z.enum(["SAR", "USD", "EUR", "GBP", "AED", "KWD", "BHD", "OMR", "QAR", "EGP"]),
      })
    )
    .query(async ({ input }) => {
      const convertedAmount = await convertFromSAR(input.amountInSAR, input.targetCurrency);
      const formattedAmount = formatCurrency(convertedAmount, input.targetCurrency);
      
      return {
        originalAmount: input.amountInSAR,
        originalCurrency: "SAR",
        convertedAmount,
        targetCurrency: input.targetCurrency,
        formatted: formattedAmount,
      };
    }),

  /**
   * Format amount with currency
   */
  formatCurrency: publicProcedure
    .input(
      z.object({
        amountInCents: z.number().int(),
        currency: z.enum(["SAR", "USD", "EUR", "GBP", "AED", "KWD", "BHD", "OMR", "QAR", "EGP"]),
      })
    )
    .query(async ({ input }) => {
      return formatCurrency(input.amountInCents, input.currency);
    }),

  /**
   * Refresh exchange rates (admin only)
   * Manually trigger exchange rate update
   */
  refreshExchangeRates: publicProcedure.mutation(async () => {
    try {
      await fetchLatestExchangeRates();
      return {
        success: true,
        message: "Exchange rates updated successfully",
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : "Failed to update exchange rates",
      };
    }
  }),
});
