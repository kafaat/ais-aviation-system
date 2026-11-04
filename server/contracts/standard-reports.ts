import { z } from "zod";

export const reportFilterKeySchema = z.enum([
  "startDate",
  "endDate",
  "flightId",
  "bookingReference",
  "ticketNumber",
  "couponNumber",
  "origin",
  "destination",
  "memberId",
  "officeId",
  "status",
]);
export const standardReportFiltersSchema = z
  .object({
    startDate: z.string().date().optional(),
    endDate: z.string().date().optional(),
    flightId: z.number().int().positive().optional(),
    bookingReference: z.string().trim().min(1).max(32).optional(),
    ticketNumber: z.string().trim().min(1).max(32).optional(),
    couponNumber: z.number().int().min(1).max(99).optional(),
    origin: z.string().trim().min(2).max(100).optional(),
    destination: z.string().trim().min(2).max(100).optional(),
    memberId: z.number().int().positive().optional(),
    officeId: z.number().int().positive().optional(),
    status: z.string().trim().min(1).max(40).optional(),
  })
  .strict()
  .refine(
    value =>
      !value.startDate || !value.endDate || value.startDate <= value.endDate,
    "Report start must precede end"
  );

export const reportColumnsSelectionSchema = z
  .array(
    z
      .string()
      .regex(/^[A-Za-z][A-Za-z0-9_]*$/)
      .max(100)
  )
  .min(1)
  .max(100)
  .refine(
    value => new Set(value).size === value.length,
    "Select each column once"
  );
export const standardReportRequestSchema = z
  .object({
    reportId: z.number().int().min(1).max(99),
    filters: standardReportFiltersSchema.default({}),
    columns: reportColumnsSelectionSchema.optional(),
  })
  .strict();
export const standardReportFormatSchema = z.enum(["csv", "html", "xml"]);
export const standardReportDefinitionSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  category: z.enum(["operations", "finance", "commercial"]),
  availability: z.enum(["available", "partial", "blocked"]),
  description: z.string(),
  limitations: z.array(z.string()),
  filters: z.array(reportFilterKeySchema),
});
export const standardReportResultSchema = z.object({
  reportId: z.number().int(),
  title: z.string(),
  generatedAt: z.string(),
  filters: standardReportFiltersSchema,
  total: z.number().int().nonnegative(),
  columns: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      type: z.enum(["text", "number", "date", "boolean"]),
    })
  ),
  rows: z.array(
    z.record(
      z.string(),
      z.union([z.string(), z.number().finite(), z.boolean(), z.null()])
    )
  ),
  notes: z.array(z.string()),
});
export const standardReportDownloadSchema = z.object({
  filename: z.string(),
  contentType: z.string(),
  content: z.string(),
  checksum: z.string(),
  recordCount: z.number().int(),
});

export const reportTemplateInputSchema = standardReportRequestSchema
  .extend({
    name: z.string().trim().min(1).max(120),
    format: standardReportFormatSchema,
    cadence: z.enum(["manual", "daily", "weekly", "monthly"]).default("manual"),
    hourUtc: z.number().int().min(0).max(23).default(0),
    minuteUtc: z.number().int().min(0).max(59).default(0),
    lookbackDays: z.number().int().min(1).max(366).nullable().default(null),
    emailToOwner: z.boolean().default(false),
    enabled: z.boolean().default(true),
  })
  .strict();
export const reportTemplateSchema = reportTemplateInputSchema.extend({
  id: z.number().int(),
  createdAt: z.date(),
  updatedAt: z.date(),
  nextRunAt: z.date().nullable(),
});
export const reportRunSchema = z.object({
  id: z.number().int(),
  templateId: z.number().int().nullable(),
  reportId: z.number().int(),
  name: z.string(),
  format: standardReportFormatSchema,
  status: z.enum(["generating", "ready", "failed"]),
  recordCount: z.number().int(),
  checksum: z.string().nullable(),
  deliveryStatus: z.enum([
    "none",
    "pending",
    "sending",
    "accepted",
    "failed",
    "unknown",
  ]),
  emailReceiptId: z.string().nullable(),
  emailAcceptedAt: z.date().nullable(),
  createdAt: z.date(),
  completedAt: z.date().nullable(),
  errorMessage: z.string().nullable(),
});
export const responseContracts = {
  catalog: z.array(standardReportDefinitionSchema),
  run: standardReportResultSchema,
  export: standardReportDownloadSchema,
  templates: z.array(reportTemplateSchema),
  saveTemplate: reportTemplateSchema,
  setTemplateEnabled: reportTemplateSchema,
  deleteTemplate: z.object({ deleted: z.boolean() }),
  runTemplate: reportRunSchema,
  runs: z.array(reportRunSchema),
  downloadRun: standardReportDownloadSchema,
};
