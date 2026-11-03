import { z } from "zod";
import { boardingPassPayloadSchema } from "../services/boarding-pass.service";
export const responseContracts = {
  /** bcbp: IATA Resolution 792 M1 string (PDF417 payload) for wallets and readers. */
  issue: z.object({
    token: z.string(),
    payload: boardingPassPayloadSchema,
    bcbp: z.string(),
  }),
  verify: z.union([
    z.object({
      valid: z.literal(true),
      data: boardingPassPayloadSchema,
      format: z.enum(["jwt", "bcbp"]),
    }),
    z.object({ valid: z.literal(false), reason: z.string() }),
  ]),
};
