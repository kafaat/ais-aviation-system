// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  getMonthlyPrices: z.object({
    originId: outputNumber,
    destinationId: outputNumber,
    month: outputNumber,
    year: outputNumber,
    cabinClass: z.enum(["economy", "business"]),
    prices: z.array(
      z.object({
        date: z.string(),
        lowestPrice: z.union([z.null(), outputNumber]),
        highestPrice: z.union([z.null(), outputNumber]),
        averagePrice: z.union([z.null(), outputNumber]),
        flightCount: outputNumber,
        hasFlights: z.boolean(),
      })
    ),
    lowestMonthPrice: z.union([z.null(), outputNumber]),
    highestMonthPrice: z.union([z.null(), outputNumber]),
    cheapestDay: z.union([z.null(), z.string()]),
  }),
  getFlexiblePrices: z.object({
    originId: outputNumber,
    destinationId: outputNumber,
    centerDate: z.string(),
    cabinClass: z.enum(["economy", "business"]),
    prices: z.array(
      z.object({
        date: z.string(),
        lowestPrice: z.union([z.null(), outputNumber]),
        highestPrice: z.union([z.null(), outputNumber]),
        averagePrice: z.union([z.null(), outputNumber]),
        flightCount: outputNumber,
        hasFlights: z.boolean(),
      })
    ),
    cheapestDay: z.union([
      z.null(),
      z.object({ date: z.string(), price: outputNumber }),
    ]),
    priceRange: z.object({
      min: z.union([z.null(), outputNumber]),
      max: z.union([z.null(), outputNumber]),
    }),
  }),
  getAvailableMonths: z.array(
    z.object({
      year: outputNumber,
      month: outputNumber,
      hasFlights: z.boolean(),
    })
  ),
};
