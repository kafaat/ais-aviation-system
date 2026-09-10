// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  get: z.object({
    currency: z.string(),
    baseFare: outputNumber,
    ancillaries: z.array(
      z.object({ id: outputNumber, name: z.string(), price: outputNumber })
    ),
    ancillariesTotal: outputNumber,
    subtotal: outputNumber,
    loyaltyTier: z.union([
      z.null(),
      z.literal("bronze"),
      z.literal("silver"),
      z.literal("gold"),
      z.literal("platinum"),
    ]),
    tierDiscountRate: outputNumber,
    tierDiscount: outputNumber,
    milesRedeemed: outputNumber,
    milesDiscount: outputNumber,
    total: outputNumber,
  }),
};
