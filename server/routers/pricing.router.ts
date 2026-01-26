/**
 * Pricing Router
 * 
 * tRPC endpoints for dynamic pricing operations
 * 
 * @module routers/pricing.router
 */

import { z } from "zod";
import { router, publicProcedure, protectedProcedure, adminProcedure } from "../trpc";
import { DynamicPricingService } from "../services/pricing/dynamic-pricing.service";
import { CurrencyService } from "../services/currency/currency.service";
import { TRPCError } from "@trpc/server";

// ============================================================================
// Input Schemas
// ============================================================================

const calculatePriceInput = z.object({
  flightId: z.number().int().positive(),
  cabinClass: z.enum(["economy", "business"]),
  passengers: z.number().int().min(1).max(9).default(1),
  currency: z.string().length(3).default("SAR"),
  promoCode: z.string().optional(),
});

const getPriceRangeInput = z.object({
  originId: z.number().int().positive(),
  destinationId: z.number().int().positive(),
  cabinClass: z.enum(["economy", "business"]),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  currency: z.string().length(3).default("SAR"),
});

const validatePriceInput = z.object({
  priceId: z.string(),
  expectedPrice: z.number().int().positive(),
});

const getPriceForecastInput = z.object({
  flightId: z.number().int().positive(),
  cabinClass: z.enum(["economy", "business"]),
  days: z.number().int().min(1).max(30).default(7),
  currency: z.string().length(3).default("SAR"),
});

// ============================================================================
// Router Definition
// ============================================================================

export const pricingRouter = router({
  /**
   * Calculate dynamic price for a flight
   */
  calculate: publicProcedure
    .input(calculatePriceInput)
    .query(async ({ input }) => {
      try {
        const result = await DynamicPricingService.calculateDynamicPrice({
          flightId: input.flightId,
          cabinClass: input.cabinClass,
          requestedSeats: input.passengers,
          promoCode: input.promoCode,
        });

        // Convert to requested currency if needed
        let convertedPrice = result.finalPrice;
        let displayCurrency = "SAR";

        if (input.currency !== "SAR") {
          const conversion = await CurrencyService.convertCurrency(
            result.finalPrice / 100, // Convert from cents
            "SAR",
            input.currency
          );
          convertedPrice = Math.round(conversion.convertedAmount * 100);
          displayCurrency = input.currency;
        }

        return {
          success: true,
          data: {
            basePrice: result.basePrice,
            finalPrice: result.finalPrice,
            convertedPrice,
            currency: displayCurrency,
            breakdown: result.breakdown,
            validUntil: result.validUntil,
            priceId: result.priceId,
            formatted: CurrencyService.formatPrice(
              convertedPrice / 100,
              displayCurrency
            ),
          },
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to calculate price",
        });
      }
    }),

  /**
   * Get price range for a route
   */
  getPriceRange: publicProcedure
    .input(getPriceRangeInput)
    .query(async ({ input }) => {
      try {
        const range = await DynamicPricingService.getPriceRange(
          input.originId,
          input.destinationId,
          input.cabinClass,
          new Date(input.startDate),
          new Date(input.endDate)
        );

        // Convert to requested currency if needed
        if (input.currency !== "SAR" && range.min > 0) {
          const minConversion = await CurrencyService.convertCurrency(
            range.min / 100,
            "SAR",
            input.currency
          );
          const maxConversion = await CurrencyService.convertCurrency(
            range.max / 100,
            "SAR",
            input.currency
          );
          const avgConversion = await CurrencyService.convertCurrency(
            range.average / 100,
            "SAR",
            input.currency
          );

          return {
            success: true,
            data: {
              min: Math.round(minConversion.convertedAmount * 100),
              max: Math.round(maxConversion.convertedAmount * 100),
              average: Math.round(avgConversion.convertedAmount * 100),
              currency: input.currency,
              formattedMin: CurrencyService.formatPrice(
                minConversion.convertedAmount,
                input.currency
              ),
              formattedMax: CurrencyService.formatPrice(
                maxConversion.convertedAmount,
                input.currency
              ),
            },
          };
        }

        return {
          success: true,
          data: {
            ...range,
            currency: "SAR",
            formattedMin: CurrencyService.formatPrice(range.min / 100, "SAR"),
            formattedMax: CurrencyService.formatPrice(range.max / 100, "SAR"),
          },
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to get price range",
        });
      }
    }),

  /**
   * Validate a previously calculated price
   */
  validate: publicProcedure
    .input(validatePriceInput)
    .query(async ({ input }) => {
      const result = await DynamicPricingService.validatePrice(
        input.priceId,
        input.expectedPrice
      );

      return {
        success: result.valid,
        valid: result.valid,
        reason: result.reason,
      };
    }),

  /**
   * Get price forecast for a flight
   */
  getForecast: publicProcedure
    .input(getPriceForecastInput)
    .query(async ({ input }) => {
      try {
        const forecast = await DynamicPricingService.getPriceForecast(
          input.flightId,
          input.cabinClass,
          input.days
        );

        // Convert to requested currency if needed
        if (input.currency !== "SAR") {
          const convertedForecast = await Promise.all(
            forecast.map(async (item) => {
              const conversion = await CurrencyService.convertCurrency(
                item.predictedPrice / 100,
                "SAR",
                input.currency
              );
              return {
                date: item.date,
                predictedPrice: Math.round(conversion.convertedAmount * 100),
                formatted: CurrencyService.formatPrice(
                  conversion.convertedAmount,
                  input.currency
                ),
              };
            })
          );

          return {
            success: true,
            data: {
              forecast: convertedForecast,
              currency: input.currency,
            },
          };
        }

        return {
          success: true,
          data: {
            forecast: forecast.map((item) => ({
              ...item,
              formatted: CurrencyService.formatPrice(
                item.predictedPrice / 100,
                "SAR"
              ),
            })),
            currency: "SAR",
          },
        };
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error instanceof Error ? error.message : "Failed to get forecast",
        });
      }
    }),

  /**
   * Get supported currencies
   */
  getSupportedCurrencies: publicProcedure.query(async () => {
    const currencies = CurrencyService.getSupportedCurrencies();
    return {
      success: true,
      data: currencies,
    };
  }),

  /**
   * Convert price between currencies
   */
  convertCurrency: publicProcedure
    .input(
      z.object({
        amount: z.number().positive(),
        fromCurrency: z.string().length(3),
        toCurrency: z.string().length(3),
      })
    )
    .query(async ({ input }) => {
      try {
        const result = await CurrencyService.convertCurrency(
          input.amount,
          input.fromCurrency,
          input.toCurrency
        );

        return {
          success: true,
          data: result,
        };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Currency conversion failed",
        });
      }
    }),

  /**
   * Get exchange rate
   */
  getExchangeRate: publicProcedure
    .input(
      z.object({
        fromCurrency: z.string().length(3),
        toCurrency: z.string().length(3),
      })
    )
    .query(async ({ input }) => {
      try {
        const rate = await CurrencyService.getExchangeRate(
          input.fromCurrency,
          input.toCurrency
        );

        return {
          success: true,
          data: rate,
        };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Failed to get exchange rate",
        });
      }
    }),
});

export type PricingRouter = typeof pricingRouter;
