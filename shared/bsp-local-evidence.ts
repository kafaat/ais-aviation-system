import { z } from "zod";

// Local correlation fields only. Contractual DISH wire layouts require a
// separately accepted adapter. There is deliberately no transport here.
const profile = z.literal("AIS-BSP-LOCAL-1");
export const bspDay = z.iso.date();
export const bspReference = z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,95}$/);
const referenceId = z.number().int().positive().max(2147483647);
const money = z.number().int().positive().max(9999999999);
const currency = z.literal("SAR");
export const bspMovement = z.strictObject({
  ledgerId: referenceId,
  bookingId: referenceId,
  agentId: referenceId,
  kind: z.enum(["sale", "refund"]),
  amountMinor: money,
});
const lines = z.array(bspMovement).min(1).max(1000);
const fileHeader = z.strictObject({
  profile,
  day: bspDay,
  tenantId: referenceId,
  currency,
});
export const localRetDraft = fileHeader.extend({
  direction: z.literal("outbound_ret_draft"),
  lines,
});
export const normalizedHot = fileHeader
  .extend({
    direction: z.literal("inbound_hot"),
    settlementReference: bspReference,
    lines,
    // Net of sale/refund lines before any deductions. Other profiles (including
    // commission adjustments/multi-day cycles) require separate mapping rules.
    transferMinor: z.number().int().min(-9999999999999).max(9999999999999),
  })
  .refine(
    f => new Set(f.lines.map(l => l.ledgerId)).size === f.lines.length,
    "Duplicate HOT movement"
  );
export const normalizedBank = fileHeader.extend({
  direction: z.literal("inbound_bank"),
  settlementReference: bspReference,
  statementLineId: bspReference,
  transferMinor: z.number().int().min(-9999999999999).max(9999999999999),
});
export const bspEvidenceComparison = z.object({
  basis: z.literal("local_evidence_only"),
  matches: z.boolean(),
  retMatchesLedger: z.boolean(),
  hotMatchesRet: z.boolean(),
  bankMatchesHot: z.boolean(),
  netMinor: z.number().int(),
  differingLedgerIds: z.array(referenceId),
});
export type Ret = z.infer<typeof localRetDraft>;
export type Hot = z.infer<typeof normalizedHot>;
export type Bank = z.infer<typeof normalizedBank>;
export const inboundBspEvidence = z.union([normalizedHot, normalizedBank]);
