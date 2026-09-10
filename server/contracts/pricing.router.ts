// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  calculate: z.object({
    success: z.boolean(),
    data: z.object({
      basePrice: outputNumber,
      finalPrice: outputNumber,
      convertedPrice: outputNumber,
      currency: z.string(),
      breakdown: z.object({
        basePrice: outputNumber,
        demandMultiplier: outputNumber,
        timeMultiplier: outputNumber,
        occupancyMultiplier: outputNumber,
        seasonalMultiplier: outputNumber,
        aiMultiplier: outputNumber,
        promoDiscount: outputNumber,
        taxes: outputNumber,
        fees: outputNumber,
        total: outputNumber,
      }),
      validUntil: z.date(),
      priceId: z.string(),
      formatted: z.string(),
    }),
  }),
  getPriceRange: z.object({
    success: z.boolean(),
    data: z.object({
      min: outputNumber,
      max: outputNumber,
      average: outputNumber,
      currency: z.string(),
      formattedMin: z.string(),
      formattedMax: z.string(),
    }),
  }),
  validate: z.object({
    success: z.boolean(),
    valid: z.boolean(),
    reason: z.union([z.undefined(), z.string()]),
  }),
  getForecast: z.object({
    success: z.boolean(),
    data: z.object({
      forecast: z.array(
        z.object({
          date: z.date(),
          predictedPrice: outputNumber,
          formatted: z.string(),
        })
      ),
      currency: z.string(),
    }),
  }),
  getSupportedCurrencies: z.object({
    success: z.boolean(),
    data: z.array(
      z.object({
        code: z.string(),
        name: z.string(),
        nameAr: z.string(),
        symbol: z.string(),
        decimalPlaces: outputNumber,
        isActive: z.boolean(),
      })
    ),
  }),
  convertCurrency: z.object({
    success: z.boolean(),
    data: z.object({
      originalAmount: outputNumber,
      originalCurrency: z.string(),
      convertedAmount: outputNumber,
      targetCurrency: z.string(),
      exchangeRate: outputNumber,
      formattedOriginal: z.string(),
      formattedConverted: z.string(),
      rateTimestamp: z.date(),
    }),
  }),
  getExchangeRate: z.object({
    success: z.boolean(),
    data: z.object({
      fromCurrency: z.string(),
      toCurrency: z.string(),
      rate: outputNumber,
      inverseRate: outputNumber,
      source: z.string(),
      updatedAt: z.date(),
    }),
  }),
};
