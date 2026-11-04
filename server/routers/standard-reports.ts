import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  responseContracts,
  reportTemplateInputSchema,
  standardReportFormatSchema,
  standardReportRequestSchema,
} from "../contracts/standard-reports";
import {
  assertReportStaff,
  authorizeStandardReport,
  listStandardReports,
  renderStandardReport,
  runStandardReport,
} from "../services/standard-reports.service";
import {
  deleteStandardReportTemplate,
  downloadStandardReportRun,
  listStandardReportRuns,
  listStandardReportTemplates,
  runStandardReportTemplate,
  saveStandardReportTemplate,
  setStandardReportTemplateEnabled,
} from "../services/standard-report-schedules.service";

const reportProcedure = protectedProcedure.use(({ ctx, next }) => {
  assertReportStaff(ctx.user, ctx.tenantId);
  return next({ ctx });
});

export const standardReportsRouter = router({
  setTemplateEnabled: reportProcedure
    .input(
      z
        .object({ id: z.number().int().positive(), enabled: z.boolean() })
        .strict()
    )
    .output(responseContracts.setTemplateEnabled)
    .mutation(({ input, ctx }) =>
      setStandardReportTemplateEnabled(
        ctx.user,
        ctx.tenantId,
        input.id,
        input.enabled
      )
    ),
  catalog: reportProcedure
    .input(z.void())
    .output(responseContracts.catalog)
    .query(({ ctx }) => listStandardReports(ctx.user, ctx.tenantId)),
  run: reportProcedure
    .input(standardReportRequestSchema)
    .output(responseContracts.run)
    .mutation(({ input, ctx }) =>
      runStandardReport(
        input,
        authorizeStandardReport(ctx.user, ctx.tenantId, input.reportId)
      )
    ),
  export: reportProcedure
    .input(
      standardReportRequestSchema.extend({ format: standardReportFormatSchema })
    )
    .output(responseContracts.export)
    .mutation(async ({ input, ctx }) =>
      renderStandardReport(
        await runStandardReport(
          input,
          authorizeStandardReport(ctx.user, ctx.tenantId, input.reportId)
        ),
        input.format
      )
    ),
  templates: reportProcedure
    .input(z.void())
    .output(responseContracts.templates)
    .query(({ ctx }) => listStandardReportTemplates(ctx.user, ctx.tenantId)),
  saveTemplate: reportProcedure
    .input(
      z
        .object({
          id: z.number().int().positive().optional(),
          template: reportTemplateInputSchema,
        })
        .strict()
    )
    .output(responseContracts.saveTemplate)
    .mutation(({ input, ctx }) =>
      saveStandardReportTemplate(
        ctx.user,
        ctx.tenantId,
        input.template,
        input.id
      )
    ),
  deleteTemplate: reportProcedure
    .input(z.object({ id: z.number().int().positive() }).strict())
    .output(responseContracts.deleteTemplate)
    .mutation(({ input, ctx }) =>
      deleteStandardReportTemplate(ctx.user, ctx.tenantId, input.id)
    ),
  runTemplate: reportProcedure
    .input(
      z
        .object({
          id: z.number().int().positive(),
          requestId: z.string().uuid(),
        })
        .strict()
    )
    .output(responseContracts.runTemplate)
    .mutation(({ input, ctx }) =>
      runStandardReportTemplate(
        ctx.user,
        ctx.tenantId,
        input.id,
        input.requestId
      )
    ),
  runs: reportProcedure
    .input(
      z
        .object({ beforeId: z.number().int().positive().optional() })
        .strict()
        .default({})
    )
    .output(responseContracts.runs)
    .query(({ input, ctx }) =>
      listStandardReportRuns(ctx.user, ctx.tenantId, input.beforeId)
    ),
  downloadRun: reportProcedure
    .input(z.object({ id: z.number().int().positive() }).strict())
    .output(responseContracts.downloadRun)
    .mutation(({ input, ctx }) =>
      downloadStandardReportRun(ctx.user, ctx.tenantId, input.id)
    ),
});
