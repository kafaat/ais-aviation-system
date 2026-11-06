import { z } from "zod";

// Vouchers apply to SAR invoices. Monetary fields are integer halalas (100 =
// SAR 1); a percentage value is a raw integer percent (10 = 10%).
export const voucherCurrency = "SAR";
export const voucherMoneySchema = z.number().int().min(0).max(2_147_483_647);
const positiveInteger = z.number().int().positive().max(2_147_483_647);
const voucherFieldsSchema = z.object({
  type: z.enum(["fixed", "percentage"]),
  value: positiveInteger,
  minPurchase: voucherMoneySchema.default(0),
  maxDiscount: positiveInteger.nullable().default(null),
  maxUses: positiveInteger.nullable().default(null),
  validFrom: z.date(),
  validUntil: z.date(),
  description: z.string().nullable().default(null),
  isActive: z.boolean().default(true),
});
function validateTerms(
  data: z.infer<typeof voucherFieldsSchema>,
  ctx: z.RefinementCtx
) {
  if (data.type === "percentage" && data.value > 100) {
    ctx.addIssue({
      code: "custom",
      path: ["value"],
      message: "Percentage must be between 1 and 100",
    });
  }
  if (data.type === "fixed" && data.maxDiscount !== null) {
    ctx.addIssue({
      code: "custom",
      path: ["maxDiscount"],
      message: "A maximum discount applies only to percentage vouchers",
    });
  }
  if (data.validUntil <= data.validFrom) {
    ctx.addIssue({
      code: "custom",
      path: ["validUntil"],
      message: "Expiration must be after the start date",
    });
  }
}
export const voucherTermsSchema =
  voucherFieldsSchema.superRefine(validateTerms);
export const createVoucherInputSchema = voucherFieldsSchema
  .extend({
    code: z.string().trim().min(3).max(50).toUpperCase(),
  })
  .strict()
  .superRefine(validateTerms);
// Cross-field checks run on the merged persisted record in the service.
export const updateVoucherPatchSchema = z
  .object({
    type: z.enum(["fixed", "percentage"]).optional(),
    value: positiveInteger.optional(),
    minPurchase: voucherMoneySchema.optional(),
    maxDiscount: positiveInteger.nullable().optional(),
    maxUses: positiveInteger.nullable().optional(),
    validFrom: z.date().optional(),
    validUntil: z.date().optional(),
    description: z.string().nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export const updateVoucherInputSchema = updateVoucherPatchSchema.extend({
  id: positiveInteger,
});
export const voucherLockedFields = [
  "type",
  "value",
  "minPurchase",
  "maxDiscount",
  "validFrom",
] as const;
