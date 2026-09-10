// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  generateReport: z.union([
    z.object({
      report: z.object({
        periodStart: z.string(),
        periodEnd: z.string(),
        submittedAt: z.union([z.null(), z.string()]),
        createdAt: z.string(),
        id: z.string(),
        reportType: z.enum(["bsp", "ahc", "hot"]),
        cycleNumber: outputNumber,
        totalSales: outputNumber,
        totalRefunds: outputNumber,
        netAmount: outputNumber,
        commissionAmount: outputNumber,
        taxAmount: outputNumber,
        status: z.enum(["draft", "submitted", "reconciled", "settled"]),
      }),
      transactionCount: outputNumber,
      agentSettlementCount: outputNumber,
      transactions: z.array(
        z.object({
          issueDate: z.string(),
          travelDate: z.string(),
          createdAt: z.string(),
          id: z.string(),
          reportId: z.string(),
          transactionType: z.enum(["void", "refund", "sale", "exchange"]),
          documentNumber: z.string(),
          ticketNumber: z.string(),
          agentCode: z.string(),
          passengerName: z.string(),
          routeCode: z.string(),
          fareAmount: outputNumber,
          taxAmount: outputNumber,
          commissionAmount: outputNumber,
          netAmount: outputNumber,
          status: z.enum(["active", "reconciled", "voided", "disputed"]),
        })
      ),
      agentSettlements: z.array(
        z.object({
          settlementDate: z.union([z.null(), z.string()]),
          createdAt: z.string(),
          id: z.string(),
          agentId: outputNumber,
          agentName: z.string(),
          iataNumber: z.string(),
          bspReportId: z.string(),
          totalSales: outputNumber,
          totalRefunds: outputNumber,
          commissionEarned: outputNumber,
          netPayable: outputNumber,
          status: z.enum(["pending", "paid", "disputed"]),
        })
      ),
      airlineCharges: z.undefined().optional(),
    }),
    z.object({
      report: z.object({
        periodStart: z.string(),
        periodEnd: z.string(),
        submittedAt: z.union([z.null(), z.string()]),
        createdAt: z.string(),
        id: z.string(),
        reportType: z.enum(["bsp", "ahc", "hot"]),
        cycleNumber: outputNumber,
        totalSales: outputNumber,
        totalRefunds: outputNumber,
        netAmount: outputNumber,
        commissionAmount: outputNumber,
        taxAmount: outputNumber,
        status: z.enum(["draft", "submitted", "reconciled", "settled"]),
      }),
      airlineCharges: z.array(
        z.object({
          airlineCode: z.string(),
          airlineName: z.string(),
          transactionCount: outputNumber,
          grossSales: outputNumber,
          handlingCharge: outputNumber,
          processingFee: outputNumber,
          totalCharges: outputNumber,
        })
      ),
      transactionCount: outputNumber,
      agentSettlementCount: outputNumber,
      transactions: z.array(z.never()),
      agentSettlements: z.array(z.never()),
    }),
  ]),
  getReports: z.object({
    reports: z.array(
      z.object({
        periodStart: z.string(),
        periodEnd: z.string(),
        submittedAt: z.union([z.null(), z.string()]),
        createdAt: z.string(),
        transactionCount: outputNumber,
        id: z.string(),
        reportType: z.enum(["bsp", "ahc", "hot"]),
        cycleNumber: outputNumber,
        totalSales: outputNumber,
        totalRefunds: outputNumber,
        netAmount: outputNumber,
        commissionAmount: outputNumber,
        taxAmount: outputNumber,
        status: z.enum(["draft", "submitted", "reconciled", "settled"]),
      })
    ),
    total: outputNumber,
  }),
  getReportDetail: z.union([
    z.object({
      report: z.object({
        periodStart: z.string(),
        periodEnd: z.string(),
        submittedAt: z.union([z.null(), z.string()]),
        createdAt: z.string(),
        id: z.string(),
        reportType: z.enum(["bsp", "ahc", "hot"]),
        cycleNumber: outputNumber,
        totalSales: outputNumber,
        totalRefunds: outputNumber,
        netAmount: outputNumber,
        commissionAmount: outputNumber,
        taxAmount: outputNumber,
        status: z.enum(["draft", "submitted", "reconciled", "settled"]),
      }),
      transactions: z.array(
        z.object({
          issueDate: z.string(),
          travelDate: z.string(),
          createdAt: z.string(),
          id: z.string(),
          reportId: z.string(),
          transactionType: z.enum(["void", "refund", "sale", "exchange"]),
          documentNumber: z.string(),
          ticketNumber: z.string(),
          agentCode: z.string(),
          passengerName: z.string(),
          routeCode: z.string(),
          fareAmount: outputNumber,
          taxAmount: outputNumber,
          commissionAmount: outputNumber,
          netAmount: outputNumber,
          status: z.enum(["active", "reconciled", "voided", "disputed"]),
        })
      ),
      agentSettlements: z.array(
        z.object({
          settlementDate: z.union([z.null(), z.string()]),
          createdAt: z.string(),
          id: z.string(),
          agentId: outputNumber,
          agentName: z.string(),
          iataNumber: z.string(),
          bspReportId: z.string(),
          totalSales: outputNumber,
          totalRefunds: outputNumber,
          commissionEarned: outputNumber,
          netPayable: outputNumber,
          status: z.enum(["pending", "paid", "disputed"]),
        })
      ),
      airlineCharges: z.undefined().optional(),
    }),
    z.object({
      report: z.object({
        periodStart: z.string(),
        periodEnd: z.string(),
        submittedAt: z.union([z.null(), z.string()]),
        createdAt: z.string(),
        id: z.string(),
        reportType: z.enum(["bsp", "ahc", "hot"]),
        cycleNumber: outputNumber,
        totalSales: outputNumber,
        totalRefunds: outputNumber,
        netAmount: outputNumber,
        commissionAmount: outputNumber,
        taxAmount: outputNumber,
        status: z.enum(["draft", "submitted", "reconciled", "settled"]),
      }),
      airlineCharges: z.array(
        z.object({
          airlineCode: z.string(),
          airlineName: z.string(),
          transactionCount: outputNumber,
          grossSales: outputNumber,
          handlingCharge: outputNumber,
          processingFee: outputNumber,
          totalCharges: outputNumber,
        })
      ),
      transactions: z.array(z.never()),
      agentSettlements: z.array(z.never()),
    }),
  ]),
  getSettlementCycles: z.union([
    z.object({
      cycles: z.array(
        z.object({
          periodStart: z.string(),
          periodEnd: z.string(),
          transactions: z.array(
            z.object({
              issueDate: z.string(),
              travelDate: z.string(),
              createdAt: z.string(),
              id: z.string(),
              reportId: z.string(),
              transactionType: z.enum(["void", "refund", "sale", "exchange"]),
              documentNumber: z.string(),
              ticketNumber: z.string(),
              agentCode: z.string(),
              passengerName: z.string(),
              routeCode: z.string(),
              fareAmount: outputNumber,
              taxAmount: outputNumber,
              commissionAmount: outputNumber,
              netAmount: outputNumber,
              status: z.enum(["active", "reconciled", "voided", "disputed"]),
            })
          ),
          cycleNumber: outputNumber,
          reportCount: outputNumber,
          totalSales: outputNumber,
          totalRefunds: outputNumber,
          netAmount: outputNumber,
          commissionAmount: outputNumber,
          status: z.enum(["draft", "submitted", "reconciled", "settled"]),
        })
      ),
    }),
    z.object({
      cycles: z.array(
        z.object({
          cycleNumber: outputNumber,
          periodStart: z.string(),
          periodEnd: z.string(),
          reportCount: outputNumber,
          totalSales: outputNumber,
          totalRefunds: outputNumber,
          netAmount: outputNumber,
          commissionAmount: outputNumber,
          status: z.enum(["draft", "submitted", "reconciled", "settled"]),
          transactionCount: outputNumber,
        })
      ),
    }),
  ]),
  reconcile: z.object({
    period: z.object({ start: z.string(), end: z.string() }),
    reconciledAt: z.string(),
    cycleNumber: outputNumber,
    totalBookings: outputNumber,
    matchedTransactions: outputNumber,
    unmatchedTransactions: outputNumber,
    discrepancies: z.array(
      z.object({
        bookingReference: z.string(),
        bookingAmount: outputNumber,
        paymentAmount: outputNumber,
        difference: outputNumber,
        issue: z.string(),
      })
    ),
    reconciliationStatus: z.enum(["clean", "discrepancies_found"]),
  }),
  exportHOT: z.object({
    filename: z.string(),
    content: z.string(),
    contentType: z.string(),
    recordCount: outputNumber,
    generatedAt: z.string(),
  }),
  getAgentSettlements: z.object({
    cycleNumber: outputNumber,
    period: z.object({ start: z.string(), end: z.string() }),
    commissions: z.array(
      z.object({
        agentId: outputNumber,
        agencyName: z.string(),
        iataNumber: z.string(),
        commissionRate: z.string(),
        totalBookings: outputNumber,
        totalBookingAmount: outputNumber,
        totalCommission: outputNumber,
        pendingCommission: outputNumber,
        paidCommission: outputNumber,
      })
    ),
    totalCommission: outputNumber,
  }),
  validateCompliance: z.object({
    checkedAt: z.string(),
    reportId: z.string(),
    isCompliant: z.boolean(),
    checks: z.array(
      z.object({
        rule: z.string(),
        description: z.string(),
        passed: z.boolean(),
        details: z.string(),
      })
    ),
  }),
};
