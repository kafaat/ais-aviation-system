// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  airlines: z.array(
    z.object({
      id: outputNumber,
      code: z.string(),
      name: z.string(),
      country: z.union([z.null(), z.string()]),
      logo: z.union([z.null(), z.string()]),
      active: z.boolean(),
      createdAt: z.date(),
    })
  ),
  airports: z.array(
    z.object({
      id: outputNumber,
      code: z.string(),
      name: z.string(),
      city: z.string(),
      country: z.string(),
      timezone: z.union([z.null(), z.string()]),
      createdAt: z.date(),
    })
  ),
};
