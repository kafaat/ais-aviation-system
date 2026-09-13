import { z } from "zod";
import { boardingPassPayloadSchema } from "../services/boarding-pass.service";
export const responseContracts = {
  issue: z.object({ token: z.string(), payload: boardingPassPayloadSchema }),
  verify: z.union([
    z.object({ valid: z.literal(true), data: boardingPassPayloadSchema }),
    z.object({ valid: z.literal(false), reason: z.string() }),
  ]),
};
