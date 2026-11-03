import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { publicIbeConfiguration } from "../services/ibe-public-config.service";

export const ibePublicRouter = router({
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
