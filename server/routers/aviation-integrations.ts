import { ingestBaggageCustody } from "../services/baggage-custody.service";
import { z } from "zod";
import { router, publicProcedure, adminProcedure } from "../_core/trpc";
import { evidenceEnvelope } from "../services/aviation-evidence.service";
import {
  ingestOperationalEvent,
  getOperationalDeparture,
} from "../services/operational-events.service";
export const signedEvidenceInput = z.object({
  envelope: evidenceEnvelope,
  signature: z.string().regex(/^[a-f0-9]{64}$/),
});
export const evidenceReceipt = z.object({
  evidenceId: z.number().int().positive(),
  duplicate: z.boolean(),
});
export const aviationIntegrationsRouter = router({
  ingestBaggage: publicProcedure
    .input(signedEvidenceInput)
    .output(evidenceReceipt)
    .mutation(({ input }) =>
      ingestBaggageCustody(input.envelope, input.signature)
    ),
  ingestOperations: publicProcedure
    .input(signedEvidenceInput)
    .output(evidenceReceipt)
    .mutation(({ input }) =>
      ingestOperationalEvent(input.envelope, input.signature)
    ),
  departure: adminProcedure
    .input(z.object({ flightId: z.number().int().positive() }))
    .output(
      z.object({
        flightId: z.number().int(),
        flightNumber: z.string(),
        scheduledDeparture: z.date(),
        delayMinutes: z.number().nullable(),
        basis: z.enum(["observed", "partner_estimate", "unavailable"]),
        sourceId: z.string().nullable(),
        evidenceId: z.number().nullable(),
        observedAt: z.date().nullable(),
        fresh: z.boolean(),
      })
    )
    .query(({ input, ctx }) =>
      getOperationalDeparture(input.flightId, ctx.tenantId)
    ),
});
