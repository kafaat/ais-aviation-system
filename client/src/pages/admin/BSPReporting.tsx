/**
 * BSP Reporting Dashboard - Admin Panel
 *
 * IATA BSP (Billing and Settlement Plan) reporting interface.
 * Provides settlement cycle overview, report generation, transaction
 * listing, agent settlement summary, reconciliation, HOT file export,
 * and IATA compliance validation.
 *
 * Note: The bspReporting router must be registered in server/routers.ts
 * for the tRPC types to resolve. Until then, we use an untyped accessor.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Loader2,
  Calendar,
  TrendingUp,
  Users,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  DollarSign,
  ClipboardCheck,
  FileDown,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { format, subDays } from "date-fns";

// ============================================================================
// Types
// ============================================================================

type ReportType = "bsp" | "ahc";
type ActiveTab =
  | "overview"
  | "generate"
  | "transactions"
  | "agents"
  | "reconciliation"
  | "compliance";

interface SettlementCycleRow {
  cycleNumber: number;
  periodStart: string;
  periodEnd: string;
  reportCount: number;
  totalSales: number;
  totalRefunds: number;
  netAmount: number;
  commissionAmount: number;
  status: string;
  transactionCount: number;
}

interface BSPTransactionRow {
  id: string;
  transactionType: string;
  documentNumber: string;
  passengerName: string;
  routeCode: string;
  agentCode: string;
  fareAmount: number;
  taxAmount: number;
  commissionAmount: number;
  netAmount: number;
  issueDate: string;
  status: string;
}

interface AgentSettlementRow {
  id: string;
  agentName: string;
  iataNumber: string;
  totalSales: number;
  totalRefunds: number;
  commissionEarned: number;
  netPayable: number;
  status: string;
}

interface DiscrepancyRow {
  bookingReference: string;
  bookingAmount: number;
  paymentAmount: number;
  difference: number;
  issue: string;
}

interface ComplianceCheck {
  rule: string;
  description: string;
  passed: boolean;
  details: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const bspTrpc = (trpc as any).bspReporting;

// ============================================================================
// Helper Functions
// ============================================================================

function formatSAR(amountInCents: number): string {
  return `${(amountInCents / 100).toFixed(2)} SAR`;
}

function getStatusBadgeVariant(
  status: string
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "settled":
    case "paid":
    case "reconciled":
    case "clean":
      return "default";
    case "submitted":
    case "pending":
      return "secondary";
    case "disputed":
    case "discrepancies_found":
      return "destructive";
    default:
      return "outline";
  }
}

// ============================================================================
// Component
// ============================================================================

export default function BSPReporting() {
  const { t: _t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");
  const [startDate, setStartDate] = useState(
    format(subDays(new Date(), 15), "yyyy-MM-dd")
  );
  const [endDate, setEndDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [reportType, setReportType] = useState<ReportType>("bsp");
  const [selectedCycleCount, setSelectedCycleCount] = useState(6);

  // ---- Queries ----
  const settlementCyclesQuery = bspTrpc.getSettlementCycles.useQuery({
    count: selectedCycleCount,
  });

  // ---- Mutations ----
  const generateReportMutation = bspTrpc.generateReport.useMutation({
    onSuccess: () => {
      toast.success("BSP report generated successfully");
    },
    onError: (error: Error) => {
      toast.error(`Failed to generate report: ${error.message}`);
    },
  });

  const reconcileMutation = bspTrpc.reconcile.useMutation({
    onSuccess: (data: {
      reconciliationStatus: string;
      unmatchedTransactions: number;
    }) => {
      if (data.reconciliationStatus === "clean") {
        toast.success("Reconciliation complete - no discrepancies found");
      } else {
        toast.warning(
          `Reconciliation found ${data.unmatchedTransactions} discrepancies`
        );
      }
    },
    onError: (error: Error) => {
      toast.error(`Reconciliation failed: ${error.message}`);
    },
  });

  const exportHOTMutation = bspTrpc.exportHOT.useMutation({
    onSuccess: (data: {
      content: string;
      filename: string;
      recordCount: number;
    }) => {
      // Trigger file download
      const blob = new Blob([data.content], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = data.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success(`HOT file exported with ${data.recordCount} records`);
    },
    onError: (error: Error) => {
      toast.error(`HOT export failed: ${error.message}`);
    },
  });

  const validateComplianceMutation = bspTrpc.validateCompliance.useMutation({
    onSuccess: (data: { isCompliant: boolean; checks: ComplianceCheck[] }) => {
      if (data.isCompliant) {
        toast.success("Report is IATA compliant");
      } else {
        const failedCount = data.checks.filter(
          (c: ComplianceCheck) => !c.passed
        ).length;
        toast.warning(`${failedCount} compliance check(s) failed`);
      }
    },
    onError: (error: Error) => {
      toast.error(`Compliance validation failed: ${error.message}`);
    },
  });

  // ---- Handlers ----
  const handleGenerateReport = () => {
    generateReportMutation.mutate({
      reportType,
      periodStart: startDate,
      periodEnd: endDate,
    });
  };

  const handleReconcile = (cycleNumber: number) => {
    reconcileMutation.mutate({ cycleNumber });
  };

  const handleExportHOT = () => {
    exportHOTMutation.mutate();
  };

  const handleValidateCompliance = () => {
    validateComplianceMutation.mutate({ reportId: "" });
  };

  // ---- Computed ----
  const cycles: SettlementCycleRow[] = settlementCyclesQuery.data?.cycles || [];
  const currentCycle = cycles.length > 0 ? cycles[0] : null;
  const reportData = generateReportMutation.data as
    | {
        report: {
          id: string;
          reportType: string;
          cycleNumber: number;
          totalSales: number;
          totalRefunds: number;
          commissionAmount: number;
          netAmount: number;
        };
        transactionCount: number;
        agentSettlementCount: number;
        transactions: BSPTransactionRow[];
        agentSettlements: AgentSettlementRow[];
      }
    | undefined;
  const reconciliationData = reconcileMutation.data as
    | {
        cycleNumber: number;
        totalBookings: number;
        matchedTransactions: number;
        unmatchedTransactions: number;
        discrepancies: DiscrepancyRow[];
        reconciliationStatus: string;
        reconciledAt: string;
      }
    | undefined;
  const complianceData = validateComplianceMutation.data as
    | {
        reportId: string;
        isCompliant: boolean;
        checks: ComplianceCheck[];
        checkedAt: string;
      }
    | undefined;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">BSP Reporting</h1>
          <p className="text-muted-foreground">
            IATA Billing and Settlement Plan - Reports, Reconciliation &amp;
            Compliance
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleExportHOT}
            disabled={exportHOTMutation.isPending}
          >
            {exportHOTMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FileDown className="mr-2 h-4 w-4" />
            )}
            Export HOT File
          </Button>
          <Button
            variant="outline"
            onClick={handleValidateCompliance}
            disabled={validateComplianceMutation.isPending}
          >
            {validateComplianceMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="mr-2 h-4 w-4" />
            )}
            Validate Compliance
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      {currentCycle && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total Sales</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatSAR(currentCycle.totalSales)}
              </div>
              <p className="text-xs text-muted-foreground">
                Current settlement cycle
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">
                Total Refunds
              </CardTitle>
              <RefreshCw className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatSAR(currentCycle.totalRefunds)}
              </div>
              <p className="text-xs text-muted-foreground">
                Current settlement cycle
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Net Amount</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatSAR(currentCycle.netAmount)}
              </div>
              <p className="text-xs text-muted-foreground">
                After refunds &amp; commissions
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Commissions</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatSAR(currentCycle.commissionAmount)}
              </div>
              <p className="text-xs text-muted-foreground">
                Agent commissions this cycle
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={value => setActiveTab(value as ActiveTab)}
      >
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="overview" className="flex items-center gap-1">
            <Calendar className="h-4 w-4" />
            <span className="hidden sm:inline">Cycles</span>
          </TabsTrigger>
          <TabsTrigger value="generate" className="flex items-center gap-1">
            <FileText className="h-4 w-4" />
            <span className="hidden sm:inline">Generate</span>
          </TabsTrigger>
          <TabsTrigger value="transactions" className="flex items-center gap-1">
            <ClipboardCheck className="h-4 w-4" />
            <span className="hidden sm:inline">Transactions</span>
          </TabsTrigger>
          <TabsTrigger value="agents" className="flex items-center gap-1">
            <Users className="h-4 w-4" />
            <span className="hidden sm:inline">Agents</span>
          </TabsTrigger>
          <TabsTrigger
            value="reconciliation"
            className="flex items-center gap-1"
          >
            <RefreshCw className="h-4 w-4" />
            <span className="hidden sm:inline">Reconcile</span>
          </TabsTrigger>
          <TabsTrigger value="compliance" className="flex items-center gap-1">
            <ShieldCheck className="h-4 w-4" />
            <span className="hidden sm:inline">Compliance</span>
          </TabsTrigger>
        </TabsList>

        {/* ---- Settlement Cycles Overview ---- */}
        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Settlement Cycles</CardTitle>
              <CardDescription>
                BSP bi-monthly settlement cycle overview. Each cycle covers a
                15-day period.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 mb-4">
                <Label>Show cycles:</Label>
                <Select
                  value={String(selectedCycleCount)}
                  onValueChange={v => setSelectedCycleCount(Number(v))}
                >
                  <SelectTrigger className="w-[100px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="3">3</SelectItem>
                    <SelectItem value="6">6</SelectItem>
                    <SelectItem value="12">12</SelectItem>
                    <SelectItem value="24">24</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => settlementCyclesQuery.refetch()}
                  disabled={settlementCyclesQuery.isFetching}
                >
                  {settlementCyclesQuery.isFetching ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
              </div>

              {settlementCyclesQuery.isLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : cycles.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  No settlement cycle data available
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-2 font-medium">Cycle</th>
                        <th className="pb-2 font-medium">Period</th>
                        <th className="pb-2 font-medium text-right">Sales</th>
                        <th className="pb-2 font-medium text-right">Refunds</th>
                        <th className="pb-2 font-medium text-right">
                          Commission
                        </th>
                        <th className="pb-2 font-medium text-right">Net</th>
                        <th className="pb-2 font-medium text-center">Status</th>
                        <th className="pb-2 font-medium text-center">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {cycles.map((cycle: SettlementCycleRow) => (
                        <tr
                          key={cycle.cycleNumber}
                          className="border-b hover:bg-muted/50"
                        >
                          <td className="py-3 font-mono">
                            #{cycle.cycleNumber}
                          </td>
                          <td className="py-3">
                            {format(new Date(cycle.periodStart), "dd MMM")} -{" "}
                            {format(new Date(cycle.periodEnd), "dd MMM yyyy")}
                          </td>
                          <td className="py-3 text-right">
                            {formatSAR(cycle.totalSales)}
                          </td>
                          <td className="py-3 text-right text-red-600">
                            {formatSAR(cycle.totalRefunds)}
                          </td>
                          <td className="py-3 text-right">
                            {formatSAR(cycle.commissionAmount)}
                          </td>
                          <td className="py-3 text-right font-medium">
                            {formatSAR(cycle.netAmount)}
                          </td>
                          <td className="py-3 text-center">
                            <Badge
                              variant={getStatusBadgeVariant(cycle.status)}
                            >
                              {cycle.status}
                            </Badge>
                          </td>
                          <td className="py-3 text-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleReconcile(cycle.cycleNumber)}
                              disabled={reconcileMutation.isPending}
                            >
                              Reconcile
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Report Generation ---- */}
        <TabsContent value="generate" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Generate BSP / AHC Report</CardTitle>
              <CardDescription>
                Create a new BSP settlement report or Airlines Handling Charges
                report for a specified period.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Report Type</Label>
                  <Select
                    value={reportType}
                    onValueChange={v => setReportType(v as ReportType)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bsp">
                        BSP - Settlement Report
                      </SelectItem>
                      <SelectItem value="ahc">
                        AHC - Airlines Handling Charges
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Period Start</Label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Period End</Label>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={e => setEndDate(e.target.value)}
                  />
                </div>
              </div>
              <Button
                onClick={handleGenerateReport}
                disabled={generateReportMutation.isPending}
              >
                {generateReportMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="mr-2 h-4 w-4" />
                )}
                Generate Report
              </Button>
            </CardContent>
          </Card>

          {/* Generated Report Result */}
          {reportData && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  Report Generated
                </CardTitle>
                <CardDescription>
                  Report ID: {reportData.report.id} | Type:{" "}
                  {reportData.report.reportType.toUpperCase()} | Cycle #
                  {reportData.report.cycleNumber}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Total Sales</p>
                    <p className="text-lg font-bold">
                      {formatSAR(reportData.report.totalSales)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Total Refunds
                    </p>
                    <p className="text-lg font-bold text-red-600">
                      {formatSAR(reportData.report.totalRefunds)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Commission</p>
                    <p className="text-lg font-bold">
                      {formatSAR(reportData.report.commissionAmount)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Net Amount</p>
                    <p className="text-lg font-bold text-green-700">
                      {formatSAR(reportData.report.netAmount)}
                    </p>
                  </div>
                </div>
                <div className="mt-4 text-sm text-muted-foreground">
                  Transactions: {reportData.transactionCount} | Agent
                  Settlements: {reportData.agentSettlementCount}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ---- Transactions ---- */}
        <TabsContent value="transactions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>BSP Transactions</CardTitle>
              <CardDescription>
                Individual transaction records from the last generated report.
                Generate a report first to view transactions.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!reportData || reportData.transactions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <ClipboardCheck className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>
                    No transactions to display. Generate a BSP report first.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-2 font-medium">Type</th>
                        <th className="pb-2 font-medium">Document</th>
                        <th className="pb-2 font-medium">Passenger</th>
                        <th className="pb-2 font-medium">Route</th>
                        <th className="pb-2 font-medium">Agent</th>
                        <th className="pb-2 font-medium text-right">Fare</th>
                        <th className="pb-2 font-medium text-right">Tax</th>
                        <th className="pb-2 font-medium text-right">Comm.</th>
                        <th className="pb-2 font-medium text-right">Net</th>
                        <th className="pb-2 font-medium">Issue Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.transactions.map((txn: BSPTransactionRow) => (
                        <tr key={txn.id} className="border-b hover:bg-muted/50">
                          <td className="py-2">
                            <Badge
                              variant={
                                txn.transactionType === "refund"
                                  ? "destructive"
                                  : "default"
                              }
                            >
                              {txn.transactionType}
                            </Badge>
                          </td>
                          <td className="py-2 font-mono text-xs">
                            {txn.documentNumber}
                          </td>
                          <td className="py-2">{txn.passengerName}</td>
                          <td className="py-2 font-mono">{txn.routeCode}</td>
                          <td className="py-2">{txn.agentCode}</td>
                          <td className="py-2 text-right">
                            {formatSAR(txn.fareAmount)}
                          </td>
                          <td className="py-2 text-right">
                            {formatSAR(txn.taxAmount)}
                          </td>
                          <td className="py-2 text-right">
                            {formatSAR(txn.commissionAmount)}
                          </td>
                          <td className="py-2 text-right font-medium">
                            {formatSAR(txn.netAmount)}
                          </td>
                          <td className="py-2 text-xs">
                            {format(new Date(txn.issueDate), "dd MMM yyyy")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {reportData.transactionCount > 100 && (
                    <p className="text-sm text-muted-foreground mt-2 text-center">
                      Showing 100 of {reportData.transactionCount} transactions
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Agent Settlements ---- */}
        <TabsContent value="agents" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Agent Settlement Summary</CardTitle>
              <CardDescription>
                Commission breakdown by travel agent for the generated report
                period. Generate a BSP report to populate agent settlement data.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!reportData || reportData.agentSettlements.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>
                    No agent settlements to display. Generate a BSP report with
                    agent bookings.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-2 font-medium">Agent</th>
                        <th className="pb-2 font-medium">IATA Number</th>
                        <th className="pb-2 font-medium text-right">
                          Total Sales
                        </th>
                        <th className="pb-2 font-medium text-right">
                          Total Refunds
                        </th>
                        <th className="pb-2 font-medium text-right">
                          Commission
                        </th>
                        <th className="pb-2 font-medium text-right">
                          Net Payable
                        </th>
                        <th className="pb-2 font-medium text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.agentSettlements.map(
                        (settlement: AgentSettlementRow) => (
                          <tr
                            key={settlement.id}
                            className="border-b hover:bg-muted/50"
                          >
                            <td className="py-3 font-medium">
                              {settlement.agentName}
                            </td>
                            <td className="py-3 font-mono">
                              {settlement.iataNumber}
                            </td>
                            <td className="py-3 text-right">
                              {formatSAR(settlement.totalSales)}
                            </td>
                            <td className="py-3 text-right text-red-600">
                              {formatSAR(settlement.totalRefunds)}
                            </td>
                            <td className="py-3 text-right">
                              {formatSAR(settlement.commissionEarned)}
                            </td>
                            <td className="py-3 text-right font-medium">
                              {formatSAR(settlement.netPayable)}
                            </td>
                            <td className="py-3 text-center">
                              <Badge
                                variant={getStatusBadgeVariant(
                                  settlement.status
                                )}
                              >
                                {settlement.status}
                              </Badge>
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Reconciliation ---- */}
        <TabsContent value="reconciliation" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>BSP Reconciliation</CardTitle>
              <CardDescription>
                Cross-reference bookings with payment records to identify
                discrepancies. Select a settlement cycle from the overview tab
                and click Reconcile.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {reconcileMutation.isPending ? (
                <div className="flex flex-col items-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-2" />
                  <p className="text-muted-foreground">
                    Running reconciliation...
                  </p>
                </div>
              ) : !reconciliationData ? (
                <div className="text-center py-8 text-muted-foreground">
                  <RefreshCw className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>
                    No reconciliation data. Click &quot;Reconcile&quot; on a
                    settlement cycle in the Cycles tab.
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Reconciliation summary */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">
                        Total Bookings
                      </p>
                      <p className="text-2xl font-bold">
                        {reconciliationData.totalBookings}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Matched</p>
                      <p className="text-2xl font-bold text-green-600">
                        {reconciliationData.matchedTransactions}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">
                        Discrepancies
                      </p>
                      <p className="text-2xl font-bold text-red-600">
                        {reconciliationData.unmatchedTransactions}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">Status</p>
                      <Badge
                        variant={getStatusBadgeVariant(
                          reconciliationData.reconciliationStatus
                        )}
                        className="mt-1"
                      >
                        {reconciliationData.reconciliationStatus === "clean"
                          ? "Clean"
                          : "Discrepancies Found"}
                      </Badge>
                    </div>
                  </div>

                  {/* Discrepancies table */}
                  {reconciliationData.discrepancies.length > 0 && (
                    <div>
                      <h3 className="text-lg font-semibold mb-2">
                        Discrepancies
                      </h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-left">
                              <th className="pb-2 font-medium">Booking Ref</th>
                              <th className="pb-2 font-medium text-right">
                                Booking Amount
                              </th>
                              <th className="pb-2 font-medium text-right">
                                Payment Amount
                              </th>
                              <th className="pb-2 font-medium text-right">
                                Difference
                              </th>
                              <th className="pb-2 font-medium">Issue</th>
                            </tr>
                          </thead>
                          <tbody>
                            {reconciliationData.discrepancies.map(
                              (d: DiscrepancyRow, idx: number) => (
                                <tr
                                  key={idx}
                                  className="border-b hover:bg-muted/50"
                                >
                                  <td className="py-2 font-mono">
                                    {d.bookingReference}
                                  </td>
                                  <td className="py-2 text-right">
                                    {formatSAR(d.bookingAmount)}
                                  </td>
                                  <td className="py-2 text-right">
                                    {formatSAR(d.paymentAmount)}
                                  </td>
                                  <td className="py-2 text-right text-red-600">
                                    {formatSAR(d.difference)}
                                  </td>
                                  <td className="py-2 flex items-center gap-1">
                                    <AlertTriangle className="h-3 w-3 text-amber-500" />
                                    {d.issue}
                                  </td>
                                </tr>
                              )
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  <p className="text-xs text-muted-foreground">
                    Reconciled at:{" "}
                    {format(
                      new Date(reconciliationData.reconciledAt),
                      "dd MMM yyyy HH:mm:ss"
                    )}{" "}
                    | Cycle #{reconciliationData.cycleNumber}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Compliance Validation ---- */}
        <TabsContent value="compliance" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>IATA Compliance Validation</CardTitle>
              <CardDescription>
                Validate the current settlement period against IATA BSP
                standards. Click &quot;Validate Compliance&quot; in the header
                to run checks.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {validateComplianceMutation.isPending ? (
                <div className="flex flex-col items-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-2" />
                  <p className="text-muted-foreground">
                    Running compliance checks...
                  </p>
                </div>
              ) : !complianceData ? (
                <div className="text-center py-8 text-muted-foreground">
                  <ShieldCheck className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>
                    No compliance data. Click the &quot;Validate
                    Compliance&quot; button above.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Overall result */}
                  <div className="flex items-center gap-3 p-4 rounded-lg border">
                    {complianceData.isCompliant ? (
                      <CheckCircle className="h-8 w-8 text-green-600" />
                    ) : (
                      <XCircle className="h-8 w-8 text-red-600" />
                    )}
                    <div>
                      <p className="text-lg font-semibold">
                        {complianceData.isCompliant
                          ? "IATA Compliant"
                          : "Compliance Issues Detected"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {
                          complianceData.checks.filter(
                            (c: ComplianceCheck) => c.passed
                          ).length
                        }{" "}
                        of {complianceData.checks.length} checks passed |
                        Checked at{" "}
                        {format(
                          new Date(complianceData.checkedAt),
                          "dd MMM yyyy HH:mm"
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Individual checks */}
                  <div className="space-y-2">
                    {complianceData.checks.map(
                      (check: ComplianceCheck, idx: number) => (
                        <div
                          key={idx}
                          className={`flex items-start gap-3 p-3 rounded-lg border ${
                            check.passed
                              ? "bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800"
                              : "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800"
                          }`}
                        >
                          {check.passed ? (
                            <CheckCircle className="h-5 w-5 text-green-600 mt-0.5 shrink-0" />
                          ) : (
                            <XCircle className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />
                          )}
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs text-muted-foreground">
                                {check.rule}
                              </span>
                              <span className="font-medium">
                                {check.description}
                              </span>
                            </div>
                            <p className="text-sm text-muted-foreground mt-0.5">
                              {check.details}
                            </p>
                          </div>
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
