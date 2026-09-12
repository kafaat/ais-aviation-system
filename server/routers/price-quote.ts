import { createRetailOffer } from "../services/retail-offer.service";
import { responseContracts } from "../contracts/price-quote";
import { z } from "zod";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { getPriceQuote } from "../services/price-quote.service";

/**
 * Price Quote Router
 * Customer-facing, read-only price composition (base fare + ancillaries −
 * loyalty/miles discount = total). Public so it can power search/price
 * discovery; loyalty tier & miles are optional what-if inputs.
 */
export const priceQuoteRouter = router({
  createOffer: protectedProcedure
    .input(
      z.object({
        flightId: z.number().int().positive(),
        cabinClass: z.enum(["economy", "business"]),
        passengerTypes: z
          .array(z.enum(["adult", "child", "infant"]))
          .min(1)
          .max(100),
        sessionId: z.string().min(1).max(255).optional(),
      })
    )
    .output(
      z.object({
        offerId: z.string().uuid(),
        totalAmount: z.number().int(),
        currency: z.literal("SAR"),
        expiresAt: z.date(),
        scope: z.literal("airfare"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const offer = await createRetailOffer({
        ...input,
        userId: ctx.user.id,
        channel: "direct",
      });
      return {
        offerId: offer.id,
        totalAmount: offer.totalAmount,
        currency: "SAR" as const,
        expiresAt: offer.expiresAt,
        scope: "airfare" as const,
      };
    }),
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
    .output(responseContracts["get"])
    .query(async ({ input }) => {
      return await getPriceQuote(input);
    }),
});
