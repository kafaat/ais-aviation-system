// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";

export const taxInvoiceContract = z.object({
  id: z.number().int().positive(),
  uuid: z.string(),
  issuingUnit: z.string(),
  sequence: z.number().int().positive(),
  invoiceNumber: z.string(),
  bookingId: z.number().int().positive(),
  tenantId: z.number().int().nullable(),
  documentType: z.enum(["simplified_invoice", "simplified_credit_note"]),
  referencedInvoiceId: z.number().int().nullable(),
  sellerName: z.string(),
  sellerVatNumber: z.string(),
  issuedAt: z.date(),
  currency: z.literal("SAR"),
  amountUnit: z.literal("minor"),
  totalExcludingVat: z.number().int(),
  vatAmount: z.number().int(),
  totalIncludingVat: z.number().int(),
  qrPayload: z.string(),
  invoiceHash: z.string(),
  previousInvoiceHash: z.string(),
  status: z.enum(["generated", "reported", "cleared", "failed"]),
  submissionReference: z.string().nullable(),
  submissionError: z.string().nullable(),
  reference: z.string(),
  reporting: z.literal(
    "local_record_fatoora_submission_requires_operator_csid"
  ),
});

export const fareComponentContract = z.object({
  id: z.number().int().positive(),
  bookingId: z.number().int().positive(),
  passengerId: z.number().int().nullable(),
  flightId: z.number().int().nullable(),
  segmentId: z.number().int().nullable(),
  componentType: z.enum(["base", "tax", "surcharge", "fee"]),
  code: z.string(),
  jurisdiction: z.string().nullable(),
  rateBasisPoints: z.number().int().nullable(),
  amount: z.number().int(),
  currency: z.string().length(3),
  fxRateMillionths: z.number().int().nullable(),
  fxSource: z.string().nullable(),
  fxAsOf: z.date().nullable(),
  entryKind: z.enum(["sale", "adjustment", "reversal"]),
  basis: z.enum(["fare_line", "derived", "unresolved"]),
  reference: z.string(),
  createdAt: z.date(),
});

export const responseContracts = {
  list: z.array(taxInvoiceContract),
  get: taxInvoiceContract.nullable(),
  verifyChain: z.object({
    issuingUnit: z.string(),
    count: z.number().int().nonnegative(),
    valid: z.boolean(),
    brokenAt: z.string().nullable(),
  }),
  submit: z.object({
    invoiceId: z.number().int().positive(),
    status: z.enum(["generated", "reported", "cleared", "failed"]),
    message: z.string().nullable(),
  }),
  sellerConfiguration: z.object({
    configured: z.boolean(),
    issuingUnit: z.string().nullable(),
    reason: z.string().nullable(),
  }),
  fareComponents: z.object({
    bookingId: z.number().int().positive(),
    total: z.number().int(),
    vat: z.number().int(),
    currency: z.literal("SAR"),
    amountUnit: z.literal("minor"),
    components: z.array(fareComponentContract),
  }),
};
