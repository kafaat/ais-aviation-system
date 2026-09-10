// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  check: z.object({
    status: z.enum(["healthy", "unhealthy", "degraded"]),
    timestamp: z.string(),
    checks: z.object({
      database: z.object({
        status: z.enum(["pass", "fail"]),
        responseTime: z.union([z.undefined(), outputNumber]).optional(),
        error: z.union([z.undefined(), z.string()]).optional(),
      }),
      stripe: z.object({
        status: z.enum(["pass", "fail"]),
        responseTime: z.union([z.undefined(), outputNumber]).optional(),
        error: z.union([z.undefined(), z.string()]).optional(),
      }),
      cache: z.object({
        status: z.enum(["pass", "fail"]),
        responseTime: z.union([z.undefined(), outputNumber]).optional(),
        error: z.union([z.undefined(), z.string()]).optional(),
      }),
    }),
  }),
};
