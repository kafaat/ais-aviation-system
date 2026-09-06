import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { getPriceQuote } from "../services/price-quote.service";

/**
 * Price Quote Router
 * Customer-facing, read-only price composition (base fare + ancillaries −
 * loyalty/miles discount = total). Public so it can power search/price
 * discovery; loyalty tier & miles are optional what-if inputs.
 */
export const priceQuoteRouter = router({
  get: publicProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/price-quote",
        tags: ["Pricing"],
        summary: "Compose a transparent price quote",
        description:
          "Compute base fare + selected ancillaries − loyalty-tier discount − miles redeemed = total, returning a full breakdown. Read-only: miles are a what-if input and are not deducted.",
      },
    })
    .input(
      z.object({
        flightId: z.number().int().positive(),
        cabinClass: z.enum(["economy", "business"]),
        ancillaryServiceIds: z.array(z.number().int().positive()).optional(),
        loyaltyTier: z
          .enum(["bronze", "silver", "gold", "platinum"])
          .optional(),
        milesToRedeem: z.number().int().min(0).optional(),
      })
    )
    .query(async ({ input }) => {
      return await getPriceQuote(input);
    }),
});
