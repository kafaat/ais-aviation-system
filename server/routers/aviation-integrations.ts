import {
  acceptPremiumPolicy,
  pausePremiumPolicy,
  premiumResults,
} from "../services/premium-experiment.service";
import {
  ingestFlightCost,
  getFlightEconomics,
} from "../services/flight-economics-evidence.service";
import {
  ingestMaintenance,
  assignAircraftRotation,
} from "../services/aircraft-rotation.service";
import { ingestCrewRules } from "../services/crew-rule.service";
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
  acceptPremiumPolicy: adminProcedure
    .input(signedEvidenceInput)
    .output(z.object({ id: z.string().uuid(), evidenceId: z.number() }))
    .mutation(({ input, ctx }) =>
      acceptPremiumPolicy(
        input.envelope,
        input.signature,
        ctx.user.id,
        ctx.tenantId
      )
    ),
  pausePremiumPolicy: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .output(z.object({ receiptId: z.string() }))
    .mutation(({ input, ctx }) =>
      pausePremiumPolicy(input.id, ctx.user.id, ctx.tenantId)
    ),
  premiumResults: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .output(
      z.object({
        id: z.string(),
        currency: z.literal("SAR"),
        asOf: z.date(),
        metric: z.literal("lifecycle_net_collections_per_randomized_user"),
        arms: z.array(
          z.object({
            variant: z.enum(["control", "treatment"]),
            randomizedUsers: z.number(),
            paidUsers: z.number(),
            netCollectedMinor: z.number(),
            netCollectedPerUserMinor: z.number().nullable(),
          })
        ),
        unclassifiedEntries: z.number(),
        effect: z
          .object({
            difference: z.number(),
            lower95: z.number(),
            upper95: z.number(),
            method: z.literal("normal_approximation_per_randomized_user"),
          })
          .nullable(),
        status: z.enum(["analysis_window_open", "observing"]),
      })
    )
    .query(({ input, ctx }) => premiumResults(input.id, ctx.tenantId)),
  ingestFlightCost: publicProcedure
    .input(signedEvidenceInput)
    .output(evidenceReceipt)
    .mutation(({ input }) => ingestFlightCost(input.envelope, input.signature)),
  ingestMaintenance: publicProcedure
    .input(signedEvidenceInput)
    .output(evidenceReceipt)
    .mutation(({ input }) =>
      ingestMaintenance(input.envelope, input.signature)
    ),
  assignRotation: adminProcedure
    .input(
      z.object({
        flightId: z.number().int().positive(),
        tailNumber: z.string().regex(/^[A-Z0-9-]{2,20}$/),
      })
    )
    .output(
      z.object({
        flightId: z.number(),
        tailNumber: z.string(),
        maintenanceEvidenceId: z.number(),
        receiptId: z.string(),
        acceptance: z.literal("planning_only_dispatch_required"),
      })
    )
    .mutation(({ input, ctx }) =>
      assignAircraftRotation(
        input.flightId,
        input.tailNumber,
        ctx.user.id,
        ctx.tenantId
      )
    ),
  flightEconomics: adminProcedure
    .input(z.object({ flightId: z.number().int().positive() }))
    .output(
      z.object({
        flightId: z.number(),
        sourceId: z.string().nullable(),
        evidenceId: z.number().nullable(),
        observedAt: z.date().nullable(),
        currency: z.literal("SAR"),
        totalCostMinor: z.number().nullable(),
        recognizedRevenueMinor: z.number().nullable(),
        operatingResultMinor: z.number().nullable(),
        availableSeatKm: z.number().nullable(),
        caskMinor: z.number().nullable(),
        raskMinor: z.number().nullable(),
        costs: z
          .object({
            fuel: z.number(),
            crew: z.number(),
            maintenance: z.number(),
            airport: z.number(),
            navigation: z.number(),
            insurance: z.number(),
            overhead: z.number(),
          })
          .nullable(),
      })
    )
    .query(({ input, ctx }) =>
      getFlightEconomics(input.flightId, ctx.tenantId)
    ),
  acceptCrewRules: adminProcedure
    .input(signedEvidenceInput)
    .output(evidenceReceipt)
    .mutation(({ input, ctx }) =>
      ingestCrewRules(
        input.envelope,
        input.signature,
        ctx.user.id,
        ctx.tenantId
      )
    ),
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
