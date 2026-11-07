// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber, structuredValue } from "./primitives";

const nullableNumber = z.union([z.null(), outputNumber]);
const nullableString = z.union([z.null(), z.string()]);
const nullableDate = z.union([z.null(), z.date()]);

export const settlementPlanEnum = z.enum(["bsp", "arc", "other"]);
export const linkTypeEnum = z.enum(["ndclink", "ifg", "direct"]);
export const confirmationStatusEnum = z.enum(["draft", "confirmed", "revoked"]);
export const retStatusEnum = z.enum([
  "generated",
  "transmitted",
  "accepted",
  "rejected",
]);
export const classificationEnum = z.enum([
  "matched",
  "missing_in_hot",
  "amount_mismatch",
  "missing_remittance",
  "unexpected_in_hot",
]);

export const linkSpecification = z.object({
  id: outputNumber,
  tenantId: nullableNumber,
  bspCountry: z.string(),
  settlementPlan: settlementPlanEnum,
  linkType: linkTypeEnum,
  dishVersion: z.string(),
  airlineNumericCode: z.string(),
  reportingSystemId: z.string(),
  currency: z.string(),
  timeZone: z.string(),
  retCutoffLocalTime: z.string(),
  hotCutoffLocalTime: z.string(),
  effectiveFrom: z.string(),
  effectiveTo: nullableString,
  confirmationStatus: confirmationStatusEnum,
  confirmationReference: nullableString,
  confirmedBy: nullableNumber,
  confirmedAt: nullableDate,
  createdBy: outputNumber,
  createdAt: z.date(),
  updatedAt: z.date(),
});

const controlTotals = z.object({
  currency: z.string(),
  transactionCount: outputNumber,
  fareTotal: outputNumber,
  taxTotal: outputNumber,
  commissionTotal: outputNumber,
  netRemittance: outputNumber,
  grossSales: outputNumber,
  grossRefunds: outputNumber,
});

const skipped = z.object({
  directSales: outputNumber,
  unticketedPassengers: outputNumber,
  foreignCurrency: outputNumber,
});

export const retFile = z.object({
  id: outputNumber,
  specificationId: outputNumber,
  bspCountry: z.string(),
  reportingDate: z.string(),
  windowStart: z.date(),
  windowEnd: z.date(),
  sequenceNumber: outputNumber,
  fileName: z.string(),
  sha256: z.string(),
  recordCount: outputNumber,
  transactionCount: outputNumber,
  controlTotals: structuredValue,
  fallbackLineCount: outputNumber,
  status: retStatusEnum,
  transmittedAt: nullableDate,
  transportReference: nullableString,
  acknowledgedAt: nullableDate,
  acknowledgementReason: nullableString,
  createdBy: outputNumber,
  createdAt: z.date(),
});

export const retLine = z.object({
  id: outputNumber,
  fileId: outputNumber,
  transactionNumber: outputNumber,
  transactionCode: z.string(),
  documentNumber: z.string(),
  bookingId: nullableNumber,
  passengerId: nullableNumber,
  ledgerEntryId: nullableNumber,
  agentCode: z.string(),
  fareAmount: outputNumber,
  taxAmount: outputNumber,
  commissionAmount: outputNumber,
  netAmount: outputNumber,
  currency: z.string(),
  formOfPayment: z.string(),
  issuedAt: z.date(),
  componentsSource: z.enum(["fare_components", "booking_total_fallback"]),
  createdAt: z.date(),
});

export const hotFile = z.object({
  id: outputNumber,
  bspCountry: z.string(),
  fileName: z.string(),
  sha256: z.string(),
  recordCount: outputNumber,
  transactionCount: outputNumber,
  processingDate: nullableString,
  remittancePeriodEnd: nullableString,
  totals: structuredValue,
  warnings: structuredValue,
  ingestedBy: outputNumber,
  createdAt: z.date(),
});

export const hotLine = z.object({
  id: outputNumber,
  fileId: outputNumber,
  transactionNumber: outputNumber,
  transactionCode: z.string(),
  documentNumber: z.string(),
  agentCode: z.string(),
  passengerName: nullableString,
  fareAmount: outputNumber,
  taxAmount: outputNumber,
  commissionAmount: outputNumber,
  netAmount: outputNumber,
  currency: z.string(),
  formOfPayment: nullableString,
  issueDate: nullableString,
  createdAt: z.date(),
});

export const bankRemittance = z.object({
  id: outputNumber,
  bspCountry: z.string(),
  importSha256: z.string(),
  lineNumber: outputNumber,
  valueDate: z.string(),
  amount: outputNumber,
  currency: z.string(),
  reference: z.string(),
  counterparty: nullableString,
  importedBy: outputNumber,
  createdAt: z.date(),
});

export const reconciliationRun = z.object({
  id: outputNumber,
  bspCountry: z.string(),
  settlementPlan: settlementPlanEnum,
  periodStart: z.string(),
  periodEnd: z.string(),
  sources: structuredValue,
  summary: structuredValue,
  status: z.enum(["open", "complete"]),
  createdBy: outputNumber,
  createdAt: z.date(),
  completedAt: nullableDate,
});

export const reconciliationItem = z.object({
  id: outputNumber,
  runId: outputNumber,
  documentNumber: z.string(),
  transactionCode: z.string(),
  ledgerEntryId: nullableNumber,
  bookingId: nullableNumber,
  retLineId: nullableNumber,
  hotLineId: nullableNumber,
  remittanceId: nullableNumber,
  expectedAmount: nullableNumber,
  hotAmount: nullableNumber,
  classification: classificationEnum,
  dispositionReason: nullableString,
  dispositionedBy: nullableNumber,
  dispositionedAt: nullableDate,
  createdAt: z.date(),
});

export const settlementGate = z.object({
  status: z.enum(["complete", "blocked"]),
  openItems: outputNumber,
  dispositionedItems: outputNumber,
  matchedItems: outputNumber,
});

const counts = z.object({
  matched: outputNumber,
  missing_in_hot: outputNumber,
  amount_mismatch: outputNumber,
  missing_remittance: outputNumber,
  unexpected_in_hot: outputNumber,
});

export const reconciliationReport = z.object({
  run: reconciliationRun,
  items: z.array(reconciliationItem),
  gate: settlementGate,
  counts,
});

export const responseContracts = {
  settlementPlans: z.array(
    z.object({
      plan: settlementPlanEnum,
      implemented: z.boolean(),
      label: z.string(),
    })
  ),
  listLinkSpecifications: z.array(linkSpecification),
  saveLinkSpecification: z.object({ id: outputNumber }),
  confirmLinkSpecification: z.object({ id: outputNumber }),
  revokeLinkSpecification: z.object({ id: outputNumber }),
  generateRet: z.object({
    fileId: outputNumber,
    fileName: z.string(),
    sha256: z.string(),
    reportingDate: z.string(),
    sequenceNumber: outputNumber,
    window: z.object({
      reportingDate: z.string(),
      start: z.date(),
      end: z.date(),
    }),
    recordCount: outputNumber,
    transactionCount: outputNumber,
    controlTotals,
    fallbackLineCount: outputNumber,
    skipped,
    specificationStatus: confirmationStatusEnum,
  }),
  listRetFiles: z.array(retFile),
  getRetFile: z.object({
    file: retFile.extend({ content: z.string() }),
    lines: z.array(retLine),
  }),
  transmitRet: z.object({
    fileId: outputNumber,
    status: z.literal("transmitted"),
    reference: z.string(),
    transmittedAt: z.date(),
  }),
  acknowledgeRet: z.object({ fileId: outputNumber }),
  ingestHot: z.object({
    fileId: outputNumber,
    sha256: z.string(),
    recordCount: outputNumber,
    transactionCount: outputNumber,
    netRemittance: outputNumber,
    processingDate: nullableString,
    remittancePeriodEnd: nullableString,
    warnings: z.array(z.string()),
  }),
  listHotFiles: z.array(hotFile),
  getHotFile: z.object({
    file: hotFile.extend({ content: z.string() }),
    lines: z.array(hotLine),
  }),
  importBankStatement: z.object({
    importSha256: z.string(),
    lineCount: outputNumber,
    totalAmount: outputNumber,
  }),
  listBankRemittances: z.array(bankRemittance),
  runReconciliation: reconciliationReport,
  getReconciliationReport: reconciliationReport,
  listReconciliationRuns: z.array(reconciliationRun),
  dispositionItem: settlementGate,
};
