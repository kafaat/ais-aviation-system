/**
 * BSP Settlement Router
 *
 * Admin endpoints for the IATA BSP link: contractual link specifications,
 * outbound DISH RET generation and transmission, inbound HOT ingestion, bank
 * remittance import and the reconciliation gate. Direction: RET out, HOT in.
 */
import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import {
  responseContracts,
  settlementPlanEnum,
  linkTypeEnum,
} from "../contracts/bsp-settlement";
import {
  acknowledgeRetFile,
  confirmLinkSpecification,
  dispositionReconciliationItem,
  generateRetFile,
  getHotFile,
  getReconciliationReport,
  getRetFile,
  importBankStatement,
  ingestHotFile,
  listBankRemittances,
  listHotFiles,
  listLinkSpecifications,
  listReconciliationRuns,
  listRetFiles,
  revokeLinkSpecification,
  runReconciliation,
  saveLinkSpecification,
  settlementPlans,
  transmitRetFile,
} from "../services/bsp-settlement.service";

const bspCountry = z.string().regex(/^[A-Z]{2}$/);
const civilDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.number().int().positive();

export const bspSettlementRouter = router({
  settlementPlans: adminProcedure
    .output(responseContracts.settlementPlans)
    .query(() => [...settlementPlans]),

  listLinkSpecifications: adminProcedure
    .input(z.object({ bspCountry: bspCountry.optional() }).default({}))
    .output(responseContracts.listLinkSpecifications)
    .query(({ input }) => listLinkSpecifications(input.bspCountry)),

  saveLinkSpecification: adminProcedure
    .input(
      z.object({
        id: id.optional(),
        tenantId: z.number().int().nullable().optional(),
        bspCountry,
        settlementPlan: settlementPlanEnum.default("bsp"),
        linkType: linkTypeEnum,
        dishVersion: z.string().regex(/^\d{1,2}\.\d$/),
        airlineNumericCode: z.string().regex(/^\d{3}$/),
        reportingSystemId: z.string().regex(/^[A-Z0-9]{1,4}$/),
        currency: z.string().regex(/^[A-Z]{3}$/),
        timeZone: z.string().min(1).max(50),
        retCutoffLocalTime: z.string().regex(/^\d{2}:\d{2}$/),
        hotCutoffLocalTime: z.string().regex(/^\d{2}:\d{2}$/),
        effectiveFrom: civilDate,
        effectiveTo: civilDate.nullable().optional(),
      })
    )
    .output(responseContracts.saveLinkSpecification)
    .mutation(async ({ input, ctx }) => ({
      id: await saveLinkSpecification(input, ctx.user.id),
    })),

  confirmLinkSpecification: adminProcedure
    .input(z.object({ id, confirmationReference: z.string().min(1).max(100) }))
    .output(responseContracts.confirmLinkSpecification)
    .mutation(async ({ input, ctx }) => {
      await confirmLinkSpecification(
        input.id,
        input.confirmationReference,
        ctx.user.id
      );
      return { id: input.id };
    }),

  revokeLinkSpecification: adminProcedure
    .input(z.object({ id }))
    .output(responseContracts.revokeLinkSpecification)
    .mutation(async ({ input }) => {
      await revokeLinkSpecification(input.id);
      return { id: input.id };
    }),

  generateRet: adminProcedure
    .input(z.object({ bspCountry, reportingDate: civilDate }))
    .output(responseContracts.generateRet)
    .mutation(({ input, ctx }) =>
      generateRetFile({ ...input, actorId: ctx.user.id })
    ),

  listRetFiles: adminProcedure
    .input(z.object({ bspCountry: bspCountry.optional() }).default({}))
    .output(responseContracts.listRetFiles)
    .query(({ input }) => listRetFiles(input.bspCountry)),

  getRetFile: adminProcedure
    .input(z.object({ fileId: id }))
    .output(responseContracts.getRetFile)
    .query(({ input }) => getRetFile(input.fileId)),

  transmitRet: adminProcedure
    .input(z.object({ fileId: id }))
    .output(responseContracts.transmitRet)
    .mutation(({ input, ctx }) => transmitRetFile(input.fileId, ctx.user.id)),

  acknowledgeRet: adminProcedure
    .input(
      z.object({
        fileId: id,
        outcome: z.enum(["accepted", "rejected"]),
        reason: z.string().min(1).max(500),
      })
    )
    .output(responseContracts.acknowledgeRet)
    .mutation(async ({ input }) => {
      await acknowledgeRetFile(input);
      return { fileId: input.fileId };
    }),

  ingestHot: adminProcedure
    .input(
      z.object({
        bspCountry,
        fileName: z.string().min(1).max(128),
        content: z.string().min(1).max(16_000_000),
      })
    )
    .output(responseContracts.ingestHot)
    .mutation(({ input, ctx }) =>
      ingestHotFile({ ...input, actorId: ctx.user.id })
    ),

  listHotFiles: adminProcedure
    .input(z.object({ bspCountry: bspCountry.optional() }).default({}))
    .output(responseContracts.listHotFiles)
    .query(({ input }) => listHotFiles(input.bspCountry)),

  getHotFile: adminProcedure
    .input(z.object({ fileId: id }))
    .output(responseContracts.getHotFile)
    .query(({ input }) => getHotFile(input.fileId)),

  importBankStatement: adminProcedure
    .input(
      z.object({
        bspCountry,
        currency: z.string().regex(/^[A-Z]{3}$/),
        csv: z.string().min(1).max(4_000_000),
      })
    )
    .output(responseContracts.importBankStatement)
    .mutation(({ input, ctx }) =>
      importBankStatement({ ...input, actorId: ctx.user.id })
    ),

  listBankRemittances: adminProcedure
    .input(z.object({ bspCountry }))
    .output(responseContracts.listBankRemittances)
    .query(({ input }) => listBankRemittances(input.bspCountry)),

  runReconciliation: adminProcedure
    .input(
      z.object({
        bspCountry,
        periodStart: civilDate,
        periodEnd: civilDate,
        settlementPlan: settlementPlanEnum.default("bsp"),
        hotFileIds: z.array(id).max(50).optional(),
        remittanceIds: z.array(id).max(200).optional(),
      })
    )
    .output(responseContracts.runReconciliation)
    .mutation(({ input, ctx }) =>
      runReconciliation({ ...input, actorId: ctx.user.id })
    ),

  getReconciliationReport: adminProcedure
    .input(z.object({ runId: id }))
    .output(responseContracts.getReconciliationReport)
    .query(({ input }) => getReconciliationReport(input.runId)),

  listReconciliationRuns: adminProcedure
    .input(z.object({ bspCountry: bspCountry.optional() }).default({}))
    .output(responseContracts.listReconciliationRuns)
    .query(({ input }) => listReconciliationRuns(input.bspCountry)),

  dispositionItem: adminProcedure
    .input(z.object({ itemId: id, reason: z.string().min(5).max(500) }))
    .output(responseContracts.dispositionItem)
    .mutation(({ input, ctx }) =>
      dispositionReconciliationItem({ ...input, actorId: ctx.user.id })
    ),
});
