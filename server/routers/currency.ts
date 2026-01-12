import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import * as currencyService from "../services/currency.service";
import { SUPPORTED_CURRENCIES } from "../../drizzle/schema-currency";

/**
 * Currency Router
 * Handles currency conversion and exchange rate APIs
 */

export const currencyRouter = router({
  /**
   * Get all supported currencies
   */
  getSupportedCurrencies: publicProcedure.query(async () => {
    return currencyService.getSupportedCurrencies();
  }),

  /**
   * Get exchange rate for a specific currency
   */
  getExchangeRate: publicProcedure
    .input(
      z.object({
        targetCurrency: z.enum(["SAR", "USD", "EUR", "GBP", "AED", "KWD", "BHD", "OMR", "QAR", "EGP"]),
      })
    )
    .query(async ({ input }) => {
      try {
        const rate = await currencyService.getExchangeRate(input.targetCurrency);
        return {
          baseCurrency: "SAR",
          targetCurrency: input.targetCurrency,
          rate,
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to get exchange rate",
        });
      }
    }),

  /**
   * Get all exchange rates
   */
  getAllExchangeRates: publicProcedure.query(async () => {
    try {
      return await currencyService.getAllExchangeRates();
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to get exchange rates",
      });
    }
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
      try {
        const convertedAmount = await currencyService.convertFromSAR(
          input.amountInSAR,
          input.targetCurrency
        );
        return {
          amountInSAR: input.amountInSAR,
          amountInTargetCurrency: convertedAmount,
          targetCurrency: input.targetCurrency,
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to convert currency",
        });
      }
    }),

  /**
   * Convert amount to SAR from source currency
   */
  convertToSAR: publicProcedure
    .input(
      z.object({
        amountInSourceCurrency: z.number().int().positive(),
        sourceCurrency: z.enum(["SAR", "USD", "EUR", "GBP", "AED", "KWD", "BHD", "OMR", "QAR", "EGP"]),
      })
    )
    .query(async ({ input }) => {
      try {
        const convertedAmount = await currencyService.convertToSAR(
          input.amountInSourceCurrency,
          input.sourceCurrency
        );
        return {
          amountInSourceCurrency: input.amountInSourceCurrency,
          amountInSAR: convertedAmount,
          sourceCurrency: input.sourceCurrency,
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to convert currency",
        });
      }
    }),

  /**
   * Manually trigger exchange rate update (admin only)
   */
  updateExchangeRates: publicProcedure.mutation(async () => {
    try {
      await currencyService.fetchLatestExchangeRates();
      return { success: true, message: "Exchange rates updated successfully" };
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to update exchange rates",
      });
    }
  }),
});
