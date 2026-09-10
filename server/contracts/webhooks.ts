// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";

export const responseContracts = {
  stripe: z.object({
    received: z.boolean(),
    duplicate: z.boolean(),
    eventId: z.string(),
  }),
  test: z.object({
    status: z.string(),
    message: z.string(),
    timestamp: z.string(),
  }),
};
