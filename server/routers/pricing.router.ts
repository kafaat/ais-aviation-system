import { responseContracts } from "../contracts/pricing.router";
/**
 * Pricing Router
 *
 * tRPC endpoints for dynamic pricing operations
 *
 * @module routers/pricing.router
 */

import { z } from "zod";
import { router, publicProcedure } from "../_core/trpc";
import { DynamicPricingService } from "../services/pricing/dynamic-pricing.service";
import {
  CurrencyService,
  ExchangeRateUnavailableError,
  type SarPriceConverter,
} from "../services/currency/currency.service";
import { TRPCError } from "@trpc/server";

/** No converted price is quoted without a current rate (#319 Wave 1): the
 * price routes convert only with the quote the display estimate would show
 * (CurrencyService.sarPriceConverter). A missing rate is a client-visible
 * precondition, not a server fault. */
function pricingError(error: unknown, fallback: string): TRPCError {
  if (error instanceof ExchangeRateUnavailableError)
    return new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `${error.message}. Request the price in SAR.`,
      cause: error,
    });
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: error instanceof Error ? error.message : fallback,
  });
}

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

/** The public range query scans one row per departure day; an open window let
 * an anonymous caller ask for decades (review R7). One year is the fare
 * calendar horizon. */
export const MAX_PRICE_RANGE_DAYS = 366;
const getPriceRangeInput = z
  .object({
    originId: z.number().int().positive(),
    destinationId: z.number().int().positive(),
    cabinClass: z.enum(["economy", "business"]),
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
    currency: z.string().length(3).default("SAR"),
  })
  .refine(
    input => {
      const span =
        (Date.parse(input.endDate) - Date.parse(input.startDate)) / 86_400_000;
      return span >= 0 && span <= MAX_PRICE_RANGE_DAYS;
    },
    {
      message: `endDate must not precede startDate and the window may span at most ${MAX_PRICE_RANGE_DAYS} days`,
      path: ["endDate"],
    }
  );

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
    .output(responseContracts["calculate"])
    .query(async ({ input, ctx }) => {
      try {
        const result = await DynamicPricingService.calculateDynamicPrice({
          flightId: input.flightId,
          cabinClass: input.cabinClass,
          requestedSeats: input.passengers,
          promoCode: input.promoCode,
          userId: ctx.user?.id,
          sessionId: ctx.req.headers["x-session-id"] as string | undefined,
        });

        // Convert to requested currency if needed
        let convertedPrice = result.finalPrice;
        let displayCurrency = "SAR";

        if (input.currency !== "SAR") {
          const toTarget = await CurrencyService.sarPriceConverter(
            input.currency
          );
          convertedPrice = CurrencyService.toMinorUnits(
            toTarget(CurrencyService.fromMinorUnits(result.finalPrice, "SAR")),
            input.currency
          );
          displayCurrency = input.currency;
        }

        return {
          success: true,
          data: {
            basePrice: result.basePrice,
            finalPrice: result.finalPrice,
            // Base/final prices remain SAR minor units; this field uses the
            // target currency exponent (for example, 1000 minor units per KWD).
            convertedPrice,
            currency: displayCurrency,
            breakdown: result.breakdown,
            validUntil: result.validUntil,
            priceId: result.priceId,
            formatted: CurrencyService.formatPrice(
              CurrencyService.fromMinorUnits(convertedPrice, displayCurrency),
              displayCurrency
            ),
          },
        };
      } catch (error) {
        throw pricingError(error, "Failed to calculate price");
      }
    }),

  /**
   * Get price range for a route
   */
  getPriceRange: publicProcedure
    .input(getPriceRangeInput)
    .output(responseContracts["getPriceRange"])
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
          // One quote for the whole response.
          const toTarget = await CurrencyService.sarPriceConverter(
            input.currency
          );
          const min = toTarget(range.min / 100);
          const max = toTarget(range.max / 100);
          const average = toTarget(range.average / 100);

          return {
            success: true,
            data: {
              min: CurrencyService.toMinorUnits(min, input.currency),
              max: CurrencyService.toMinorUnits(max, input.currency),
              average: CurrencyService.toMinorUnits(average, input.currency),
              currency: input.currency,
              formattedMin: CurrencyService.formatPrice(min, input.currency),
              formattedMax: CurrencyService.formatPrice(max, input.currency),
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
        throw pricingError(error, "Failed to get price range");
      }
    }),

  /**
   * Validate a previously calculated price
   */
  validate: publicProcedure
    .input(validatePriceInput)
    .output(responseContracts["validate"])
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
    .output(responseContracts["getForecast"])
    .query(async ({ input }) => {
      try {
        const forecast = await DynamicPricingService.getPriceForecast(
          input.flightId,
          input.cabinClass,
          input.days
        );

        // Convert to requested currency if needed
        if (input.currency !== "SAR") {
          // One quote for every day, resolved only when there is a price to
          // convert (an empty forecast needed no rate before either).
          const toTarget: SarPriceConverter = forecast.length
            ? await CurrencyService.sarPriceConverter(input.currency)
            : amount => amount;
          const convertedForecast = forecast.map(item => {
            const amount = toTarget(item.predictedPrice / 100);
            return {
              date: item.date,
              predictedPrice: CurrencyService.toMinorUnits(
                amount,
                input.currency
              ),
              formatted: CurrencyService.formatPrice(amount, input.currency),
            };
          });

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
            forecast: forecast.map(item => ({
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
        throw pricingError(error, "Failed to get forecast");
      }
    }),

  /**
   * Get supported currencies
   */
  getSupportedCurrencies: publicProcedure
    .output(responseContracts["getSupportedCurrencies"])
    .query(() => {
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
    .output(responseContracts["convertCurrency"])
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
          message:
            error instanceof Error
              ? error.message
              : "Currency conversion failed",
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
    .output(responseContracts["getExchangeRate"])
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
          message:
            error instanceof Error
              ? error.message
              : "Failed to get exchange rate",
        });
      }
    }),
});

export type PricingRouter = typeof pricingRouter;
