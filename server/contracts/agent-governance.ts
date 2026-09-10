// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  getAiCostBreakdown: z.array(
    z.object({
      tenantId: z.union([z.null(), outputNumber]),
      feature: z.union([z.null(), z.string()]),
      calls: outputNumber,
      totalCostUsd: outputNumber,
      totalInputTokens: outputNumber,
      totalOutputTokens: outputNumber,
    })
  ),
};
