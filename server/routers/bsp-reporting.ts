/**
 * BSP Reporting Router
 *
 * Admin endpoints for IATA BSP (Billing and Settlement Plan) reporting,
 * AHC (Airlines Handling Charges) reports, settlement cycle management,
 * reconciliation, HOT file exports, and IATA compliance validation.
 */

import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import {
  generateBSPReport,
  generateAHCReport,
  calculateAgentCommissions,
  getSettlementCycle,
  reconcileBSPTransactions,
  generateHOTFile,
  validateIATACompliance,
} from "../services/bsp-reporting.service";

export const bspReportingRouter = router({
  /**
   * Generate a BSP or AHC report for a given period
   */
  generateReport: adminProcedure
    .input(
      z.object({
        reportType: z.enum(["bsp", "ahc"]),
        periodStart: z.string(),
        periodEnd: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const periodStart = new Date(input.periodStart);
      const periodEnd = new Date(input.periodEnd);

      if (periodStart >= periodEnd) {
        throw new Error("Period start must be before period end");
      }

      if (input.reportType === "bsp") {
        const result = await generateBSPReport(periodStart, periodEnd);
        return {
          report: {
            ...result.report,
            periodStart: result.report.periodStart.toISOString(),
            periodEnd: result.report.periodEnd.toISOString(),
            submittedAt: result.report.submittedAt?.toISOString() || null,
            createdAt: result.report.createdAt.toISOString(),
          },
          transactionCount: result.transactions.length,
          agentSettlementCount: result.agentSettlements.length,
          transactions: result.transactions.slice(0, 100).map(t => ({
            ...t,
            issueDate: t.issueDate.toISOString(),
            travelDate: t.travelDate.toISOString(),
            createdAt: t.createdAt.toISOString(),
          })),
          agentSettlements: result.agentSettlements.map(s => ({
            ...s,
            settlementDate: s.settlementDate?.toISOString() || null,
            createdAt: s.createdAt.toISOString(),
          })),
        };
      } else {
        const result = await generateAHCReport(periodStart, periodEnd);
        return {
          report: {
            ...result.report,
            periodStart: result.report.periodStart.toISOString(),
            periodEnd: result.report.periodEnd.toISOString(),
            submittedAt: result.report.submittedAt?.toISOString() || null,
            createdAt: result.report.createdAt.toISOString(),
          },
          airlineCharges: result.airlineCharges,
          transactionCount: result.airlineCharges.reduce(
            (sum, a) => sum + a.transactionCount,
            0
          ),
          agentSettlementCount: 0,
          transactions: [],
          agentSettlements: [],
        };
      }
    }),

  /**
   * Get BSP reports for a date range with optional filters
   */
  getReports: adminProcedure
    .input(
      z.object({
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        reportType: z.enum(["bsp", "ahc", "hot"]).optional(),
        status: z
          .enum(["draft", "submitted", "reconciled", "settled"])
          .optional(),
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const periodStart = input.startDate
        ? new Date(input.startDate)
        : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // default 90 days back
      const periodEnd = input.endDate ? new Date(input.endDate) : new Date();

      // Generate reports for the period
      const bspResult = await generateBSPReport(periodStart, periodEnd);

      const reports = [
        {
          ...bspResult.report,
          periodStart: bspResult.report.periodStart.toISOString(),
          periodEnd: bspResult.report.periodEnd.toISOString(),
          submittedAt: bspResult.report.submittedAt?.toISOString() || null,
          createdAt: bspResult.report.createdAt.toISOString(),
          transactionCount: bspResult.transactions.length,
        },
      ];

      // Apply type filter
      const filtered = input.reportType
        ? reports.filter(r => r.reportType === input.reportType)
        : reports;

      // Apply status filter
      const statusFiltered = input.status
        ? filtered.filter(r => r.status === input.status)
        : filtered;

      return {
        reports: statusFiltered.slice(input.offset, input.offset + input.limit),
        total: statusFiltered.length,
      };
    }),

  /**
   * Get detailed view of a specific BSP report
   */
  getReportDetail: adminProcedure
    .input(
      z.object({
        periodStart: z.string(),
        periodEnd: z.string(),
        reportType: z.enum(["bsp", "ahc"]).default("bsp"),
      })
    )
    .query(async ({ input }) => {
      const periodStart = new Date(input.periodStart);
      const periodEnd = new Date(input.periodEnd);

      if (input.reportType === "bsp") {
        const result = await generateBSPReport(periodStart, periodEnd);
        return {
          report: {
            ...result.report,
            periodStart: result.report.periodStart.toISOString(),
            periodEnd: result.report.periodEnd.toISOString(),
            submittedAt: result.report.submittedAt?.toISOString() || null,
            createdAt: result.report.createdAt.toISOString(),
          },
          transactions: result.transactions.map(t => ({
            ...t,
            issueDate: t.issueDate.toISOString(),
            travelDate: t.travelDate.toISOString(),
            createdAt: t.createdAt.toISOString(),
          })),
          agentSettlements: result.agentSettlements.map(s => ({
            ...s,
            settlementDate: s.settlementDate?.toISOString() || null,
            createdAt: s.createdAt.toISOString(),
          })),
        };
      } else {
        const result = await generateAHCReport(periodStart, periodEnd);
        return {
          report: {
            ...result.report,
            periodStart: result.report.periodStart.toISOString(),
            periodEnd: result.report.periodEnd.toISOString(),
            submittedAt: result.report.submittedAt?.toISOString() || null,
            createdAt: result.report.createdAt.toISOString(),
          },
          airlineCharges: result.airlineCharges,
          transactions: [],
          agentSettlements: [],
        };
      }
    }),

  /**
   * Get settlement cycle data (list of cycles or specific cycle)
   */
  getSettlementCycles: adminProcedure
    .input(
      z.object({
        cycleNumber: z.number().optional(),
        count: z.number().min(1).max(24).default(6),
      })
    )
    .query(async ({ input }) => {
      if (input.cycleNumber) {
        const cycle = await getSettlementCycle(input.cycleNumber);
        return {
          cycles: [
            {
              ...cycle,
              periodStart: cycle.periodStart.toISOString(),
              periodEnd: cycle.periodEnd.toISOString(),
              transactions: cycle.transactions.slice(0, 50).map(t => ({
                ...t,
                issueDate: t.issueDate.toISOString(),
                travelDate: t.travelDate.toISOString(),
                createdAt: t.createdAt.toISOString(),
              })),
            },
          ],
        };
      }

      // Generate summary for recent cycles
      const now = new Date();
      const currentCycle =
        now.getFullYear() * 24 +
        now.getMonth() * 2 +
        (now.getDate() <= 15 ? 0 : 1);

      const cycles = [];
      for (let i = 0; i < input.count; i++) {
        const cycleNum = currentCycle - i;
        try {
          const cycle = await getSettlementCycle(cycleNum);
          cycles.push({
            cycleNumber: cycle.cycleNumber,
            periodStart: cycle.periodStart.toISOString(),
            periodEnd: cycle.periodEnd.toISOString(),
            reportCount: cycle.reportCount,
            totalSales: cycle.totalSales,
            totalRefunds: cycle.totalRefunds,
            netAmount: cycle.netAmount,
            commissionAmount: cycle.commissionAmount,
            status: cycle.status,
            transactionCount: cycle.transactions.length,
          });
        } catch (_err) {
          // Skip cycles that fail to load
        }
      }

      return { cycles };
    }),

  /**
   * Reconcile BSP transactions for a settlement cycle
   */
  reconcile: adminProcedure
    .input(
      z.object({
        cycleNumber: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await reconcileBSPTransactions(input.cycleNumber);
      return {
        ...result,
        period: {
          start: result.period.start.toISOString(),
          end: result.period.end.toISOString(),
        },
        reconciledAt: result.reconciledAt.toISOString(),
      };
    }),

  /**
   * Export IATA HOT (Hand Off Tape) file for the current cycle
   */
  exportHOT: adminProcedure.mutation(async () => {
    const result = await generateHOTFile();
    return {
      filename: result.filename,
      content: result.content,
      contentType: "text/plain",
      recordCount: result.recordCount,
      generatedAt: result.generatedAt.toISOString(),
    };
  }),

  /**
   * Get agent settlement data for a period
   */
  getAgentSettlements: adminProcedure
    .input(
      z.object({
        cycleNumber: z.number(),
      })
    )
    .query(async ({ input }) => {
      const result = await calculateAgentCommissions(input.cycleNumber);
      return {
        cycleNumber: result.cycleNumber,
        period: {
          start: result.period.start.toISOString(),
          end: result.period.end.toISOString(),
        },
        commissions: result.commissions,
        totalCommission: result.totalCommission,
      };
    }),

  /**
   * Validate a report against IATA compliance standards
   */
  validateCompliance: adminProcedure
    .input(
      z.object({
        reportId: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await validateIATACompliance(input.reportId || "");
      return {
        ...result,
        checkedAt: result.checkedAt.toISOString(),
      };
    }),
});
