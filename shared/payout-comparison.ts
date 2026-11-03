import { z } from "zod";

const reference = z.string().trim().min(1).max(128);
const minor = z.number().int().nonnegative().max(2_147_483_647);
const currency = z.literal("SAR");

// Normalized evidence for a single SAR payout consisting only of captured
// booking payments. Other transaction types require their own statement mapping.
export const payoutEvidence = z
  .strictObject({
    payout: z.strictObject({
      reference,
      currency,
      netMinor: minor,
      captureCount: z.number().int().min(1).max(200),
      captures: z
        .array(
          z
            .strictObject({
              paymentIntentId: reference,
              grossMinor: minor.positive(),
              feeMinor: minor,
            })
            .refine(
              row => row.feeMinor <= row.grossMinor,
              "Fee exceeds capture"
            )
        )
        .min(1)
        .max(200),
    }),
    bank: z.strictObject({
      statementLineId: reference,
      payoutReference: reference,
      currency,
      creditedMinor: minor,
    }),
  })
  .superRefine(({ payout }, ctx) => {
    if (
      payout.captureCount !== payout.captures.length ||
      new Set(payout.captures.map(c => c.paymentIntentId)).size !==
        payout.captures.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Provide the complete, unique capture list for this payout",
      });
  });

export const payoutComparison = z.object({
  basis: z.literal("operator_supplied_statements"),
  matched: z.boolean(),
  payoutReference: z.string(),
  statementLineId: z.string(),
  calculatedNetMinor: z.number().int(),
  payoutNetMatches: z.boolean(),
  bankTransferMatches: z.boolean(),
  lines: z.array(
    z.object({
      paymentIntentId: z.string(),
      matched: z.boolean(),
      bookingId: z.number().int().nullable(),
      modificationId: z.number().int().nullable(),
      ledgerEntryId: z.number().int().nullable(),
      collectionState: z.string().nullable(),
    })
  ),
});
