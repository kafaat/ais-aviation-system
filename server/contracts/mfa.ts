// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  setup: z.object({
    secret: z.string(),
    qrCodeUrl: z.string(),
    backupCodes: z.array(z.string()),
  }),
  verify: z.object({ success: z.boolean(), message: z.string() }),
  disable: z.object({ success: z.boolean(), message: z.string() }),
  regenerateBackupCodes: z.object({ backupCodes: z.array(z.string()) }),
  getStatus: z.object({
    enabled: z.boolean(),
    enabledAt: z.union([z.null(), z.date()]),
    lastUsedAt: z.union([z.null(), z.date()]),
    backupCodesRemaining: outputNumber,
  }),
};
