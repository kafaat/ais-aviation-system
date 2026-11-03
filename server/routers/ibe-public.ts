import { z } from "zod";
import { DISPLAY_CURRENCIES } from "../../shared/ibe-search";
import { getDisplayExchangeRate } from "../services/currency/currency.service";
import { publicProcedure, router } from "../_core/trpc";
import { publicIbeConfiguration } from "../services/ibe-public-config.service";

export const ibePublicRouter = router({
  displayRate: publicProcedure
    .input(z.object({ currency: z.enum(DISPLAY_CURRENCIES) }))
    .output(
      z
        .object({
          fromCurrency: z.string(),
          toCurrency: z.enum(DISPLAY_CURRENCIES),
          rate: z.number().finite().positive(),
          source: z.string(),
          updatedAt: z.date(),
          expiresAt: z.date(),
        })
        .nullable()
    )
    .query(({ input }) => getDisplayExchangeRate(input.currency)),
  config: publicProcedure
    .output(
      z.object({
        brandName: z.string(),
        logoPath: z.string().nullable(),
        embedSearchEnabled: z.boolean(),
      })
    )
    .query(() => publicIbeConfiguration()),
});
