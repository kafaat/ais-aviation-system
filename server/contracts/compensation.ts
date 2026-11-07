// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber, structuredValue } from "./primitives";
import {
  CLAIM_TYPES,
  CONFIRMATION_STATUSES,
  ENTITLEMENT_STATUSES,
  JURISDICTIONS,
} from "../../shared/passenger-rights/types";

export const regulationTypes = ["local", "eu261", "dot", "uk261"] as const;
export const storedClaimTypes = [
  "delay",
  "cancellation",
  "denied_boarding",
  "downgrade",
  "baggage_delay",
  "baggage_loss",
  "baggage_damage",
  "tarmac_delay",
  "care",
] as const;
const legacyClaimTypes = [
  "delay",
  "cancellation",
  "denied_boarding",
  "downgrade",
] as const;
const claimStatuses = [
  "pending",
  "paid",
  "approved",
  "denied",
  "under_review",
  "appealed",
] as const;

const claimRecord = z.object({
  id: outputNumber,
  bookingId: outputNumber,
  flightId: outputNumber,
  passengerId: z.union([z.null(), outputNumber]),
  regulationType: z.enum(regulationTypes),
  claimType: z.enum(storedClaimTypes),
  flightDistance: z.union([z.null(), outputNumber]),
  delayMinutes: z.union([z.null(), outputNumber]),
  calculatedAmount: outputNumber.nullable(),
  approvedAmount: z.union([z.null(), outputNumber]),
  currency: z.string(),
  status: z.enum(claimStatuses),
  reason: z.union([z.null(), z.string()]),
  denialReason: z.union([z.null(), z.string()]),
  filedAt: z.date(),
  resolvedAt: z.union([z.null(), z.date()]),
  paidAt: z.union([z.null(), z.date()]),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const legacyRule = z.object({
  id: outputNumber,
  regulationType: z.enum(["local", "eu261", "dot"]),
  claimType: z.enum(legacyClaimTypes),
  minDelay: z.union([z.null(), outputNumber]),
  maxDelay: z.union([z.null(), outputNumber]),
  distanceMin: z.union([z.null(), outputNumber]),
  distanceMax: z.union([z.null(), outputNumber]),
  compensationAmount: outputNumber,
  currency: z.string(),
  conditions: z.union([z.null(), z.record(z.string(), structuredValue)]),
  isActive: z.boolean(),
  createdAt: z.date(),
});

const source = z.object({
  url: z.string(),
  title: z.string(),
  kind: z.enum(["official", "secondary"]),
});
const money = z.object({ minorUnits: outputNumber, currency: z.string() });
const settlement = money.extend({
  fxRecordId: z.union([z.null(), outputNumber, z.string()]),
  rate: z.string().nullable(),
  fxSource: z.string().nullable(),
});
const care = z.object({
  meals: z.boolean().optional(),
  refreshments: z.boolean().optional(),
  hotel: z.boolean().optional(),
  transport: z.boolean().optional(),
  communications: outputNumber.optional(),
});
const determination = z.object({
  jurisdiction: z.enum(JURISDICTIONS),
  status: z.enum([
    "applicable",
    "not_applicable",
    "not_yet_applicable",
    "requires_review",
  ]),
  reasons: z.array(z.string()),
  basis: z.string(),
  version: z.string(),
});
const entitlement = z.object({
  ruleCode: z.string(),
  jurisdiction: z.enum(JURISDICTIONS),
  claimType: z.enum(CLAIM_TYPES),
  title: z.string(),
  article: z.string().optional(),
  status: z.enum(ENTITLEMENT_STATUSES),
  amount: money.nullable(),
  settlement: settlement.nullable(),
  care: care.optional(),
  explanation: z.array(z.string()),
  sources: z.array(source),
  confirmationStatus: z.enum(CONFIRMATION_STATUSES),
});
const deadline = z.object({
  ruleCode: z.string(),
  kind: z.enum(["refund_due", "claim_document_duty", "claim_window"]),
  dueAt: z.string(),
  basis: z.string(),
});
export const evaluationContract = z.object({
  version: z.literal(1),
  nonBinding: z.literal(true),
  evaluatedAt: z.string(),
  claimType: z.enum(CLAIM_TYPES),
  jurisdictions: z.array(determination),
  rulesConsidered: z.array(z.string()),
  entitlements: z.array(entitlement),
  deadlines: z.array(deadline),
  inputs: z.object({
    itinerary: z.object({
      operatingCarrier: z.object({
        code: z.string().optional(),
        country: z.string(),
      }),
      departure: z.object({
        airport: z.string().optional(),
        country: z.string(),
      }),
      arrival: z.object({
        airport: z.string().optional(),
        country: z.string(),
      }),
      scheduledDepartureUtc: z.string(),
      scheduledArrivalUtc: z.string(),
      distanceKm: z
        .object({ value: outputNumber, source: z.string() })
        .optional(),
    }),
    facts: z.record(z.string(), structuredValue),
    ticketValue: z
      .object({
        minorUnits: outputNumber,
        currency: z.string(),
        basis: z.string(),
        reference: z.string(),
      })
      .nullable(),
    settlementCurrency: z.string(),
    fxRecordIds: z.array(z.union([outputNumber, z.string()])),
  }),
});

const catalogRule = z.object({
  code: z.string(),
  claimTypes: z.array(z.enum(CLAIM_TYPES)),
  title: z.string(),
  article: z.string().nullable(),
  amount: z.record(z.string(), structuredValue),
  thresholds: z.record(z.string(), structuredValue).nullable(),
  timeLimits: z.record(z.string(), structuredValue).nullable(),
  exclusions: z.array(z.string()),
  sources: z.array(source),
  confirmationStatus: z.enum(CONFIRMATION_STATUSES),
  disputeGroup: z.string().nullable(),
  candidate: z.string().nullable(),
  note: z.string().nullable(),
  confirmation: z
    .object({
      ruleCode: z.string(),
      confirmedAt: z.string(),
      reference: z.string(),
      decision: z.enum(["confirmed", "rejected"]),
    })
    .nullable(),
  requiresConfirmation: z.boolean(),
});

const refundDeadline = z.object({
  id: outputNumber,
  bookingId: outputNumber,
  jurisdiction: z.string(),
  ruleCode: z.string(),
  trigger: z.enum(["carrier_cancellation", "significant_change"]),
  tenderClass: z.enum(["card", "other"]),
  triggeredAt: z.date(),
  dueAt: z.date(),
  basis: z.string(),
  completedAt: z.date().nullable(),
  ledgerId: outputNumber.nullable(),
  metOnTime: z.boolean().nullable(),
  overdue: z.boolean(),
});

export const responseContracts = {
  fileClaim: claimRecord,
  getMyClaims: z.array(claimRecord),
  getClaimDetail: claimRecord,
  checkEligibility: z.object({
    assessmentStatus: z.literal("needs_review"),
    flightId: outputNumber,
    eligible: z.boolean().nullable(),
    regulationType: z.enum(regulationTypes).nullable(),
    estimatedAmount: outputNumber.nullable(),
    currency: z.string(),
    reason: z.string(),
    flightDistance: outputNumber.nullable(),
    delayMinutes: outputNumber.nullable(),
  }),
  previewEntitlements: z.object({
    nonBinding: z.literal(true),
    disclaimer: z.string(),
    flightId: outputNumber,
    flightNumber: z.string(),
    ruleSource: z.enum(["database", "built-in"]),
    evaluation: evaluationContract,
  }),
  processClaim: claimRecord,
  evaluateForReview: z.object({
    ruleSource: z.enum(["database", "built-in"]),
    evaluation: evaluationContract,
  }),
  getClaimEvaluation: z.object({
    claimId: outputNumber,
    status: z.enum(claimStatuses),
    reviewEvidence: z.record(z.string(), structuredValue).nullable(),
  }),
  getAllClaims: z.object({
    claims: z.array(claimRecord),
    total: outputNumber,
    page: outputNumber,
    totalPages: outputNumber,
  }),
  getFlightLiability: z.object({
    flightId: outputNumber,
    flightNumber: z.string(),
    totalClaims: outputNumber,
    totalCalculated: outputNumber,
    unassessedClaims: outputNumber,
    totalApproved: outputNumber,
    totalPaid: outputNumber,
    statusBreakdown: z.record(z.string(), outputNumber),
  }),
  getStats: z.object({
    totalClaims: outputNumber,
    pendingClaims: outputNumber,
    approvedClaims: outputNumber,
    deniedClaims: outputNumber,
    paidClaims: outputNumber,
    appealedClaims: outputNumber,
    totalCalculated: outputNumber,
    unassessedClaims: outputNumber,
    totalApproved: outputNumber,
    totalPaid: outputNumber,
    avgProcessingDays: outputNumber,
  }),
  getRules: z.array(legacyRule),
  updateRule: legacyRule,
  getRuleCatalog: z.object({
    source: z.enum(["database", "built-in"]),
    ruleSets: z.array(
      z.object({
        jurisdiction: z.enum(JURISDICTIONS),
        version: z.string(),
        effectiveFrom: z.string().nullable(),
        effectiveTo: z.string().nullable(),
        sourceUrl: z.string(),
        sourceKind: z.enum(["official", "secondary"]),
        confirmationStatus: z.enum(CONFIRMATION_STATUSES),
        governingLanguage: z.string(),
        notes: z.string(),
        rules: z.array(catalogRule),
      })
    ),
  }),
  syncRuleCatalog: z.object({
    inserted: outputNumber,
    updated: outputNumber,
    actorId: outputNumber,
    syncedAt: z.string(),
  }),
  confirmRule: z.object({
    ruleCode: z.string(),
    decision: z.enum(["confirmed", "rejected"]),
    reference: z.string(),
    at: z.string(),
  }),
  listRefundDeadlines: z.array(refundDeadline),
  openRefundDeadline: z.object({
    id: outputNumber,
    ruleCode: z.string(),
    dueAt: z.date(),
    basis: z.string(),
  }),
};
