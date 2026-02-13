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

function getStatusBadgeClassName(status: string): string {
  switch (status) {
    case "settled":
    case "paid":
    case "reconciled":
    case "clean":
      return "bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200";
    case "submitted":
    case "pending":
      return "bg-amber-100 text-amber-800 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200";
    case "disputed":
    case "discrepancies_found":
      return "bg-red-100 text-red-800 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-400 border-red-200";
    default:
      return "";
  }
}

// ============================================================================
// Component
// ============================================================================

export default function BSPReporting() {
  const { t } = useTranslation();
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
      toast.success(t("bspReporting.reportGeneratedSuccess"));
    },
    onError: (error: Error) => {
      toast.error(
        t("bspReporting.reportGenerateFailed", { error: error.message })
      );
    },
  });

  const reconcileMutation = bspTrpc.reconcile.useMutation({
    onSuccess: (data: {
      reconciliationStatus: string;
      unmatchedTransactions: number;
    }) => {
      if (data.reconciliationStatus === "clean") {
        toast.success(t("bspReporting.reconciliationClean"));
      } else {
        toast.warning(
          t("bspReporting.reconciliationDiscrepancies", {
            count: data.unmatchedTransactions,
          })
        );
      }
    },
    onError: (error: Error) => {
      toast.error(
        t("bspReporting.reconciliationFailed", { error: error.message })
      );
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
      toast.success(t("bspReporting.hotExported", { count: data.recordCount }));
    },
    onError: (error: Error) => {
      toast.error(t("bspReporting.hotExportFailed", { error: error.message }));
    },
  });

  const validateComplianceMutation = bspTrpc.validateCompliance.useMutation({
    onSuccess: (data: { isCompliant: boolean; checks: ComplianceCheck[] }) => {
      if (data.isCompliant) {
        toast.success(t("bspReporting.reportCompliant"));
      } else {
        const failedCount = data.checks.filter(
          (c: ComplianceCheck) => !c.passed
        ).length;
        toast.warning(
          t("bspReporting.complianceChecksFailed", { count: failedCount })
        );
      }
    },
    onError: (error: Error) => {
      toast.error(
        t("bspReporting.complianceValidationFailed", {
          error: error.message,
        })
      );
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
      <div className="flex items-center justify-between bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50 dark:from-blue-950/20 dark:via-indigo-950/20 dark:to-purple-950/20 p-6 rounded-xl">
        <div>
          <h1 className="text-2xl font-bold">{t("bspReporting.title")}</h1>
          <p className="text-muted-foreground">{t("bspReporting.subtitle")}</p>
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
            {t("bspReporting.exportHOT")}
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
            {t("bspReporting.validateCompliance")}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      {currentCycle && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="shadow-sm rounded-xl">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">
                {t("bspReporting.totalSales")}
              </CardTitle>
              <TrendingUp className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatSAR(currentCycle.totalSales)}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("bspReporting.currentCycle")}
              </p>
            </CardContent>
          </Card>
          <Card className="shadow-sm rounded-xl">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">
                {t("bspReporting.totalRefunds")}
              </CardTitle>
              <RefreshCw className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatSAR(currentCycle.totalRefunds)}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("bspReporting.currentCycle")}
              </p>
            </CardContent>
          </Card>
          <Card className="shadow-sm rounded-xl">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">
                {t("bspReporting.netAmount")}
              </CardTitle>
              <DollarSign className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatSAR(currentCycle.netAmount)}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("bspReporting.afterRefunds")}
              </p>
            </CardContent>
          </Card>
          <Card className="shadow-sm rounded-xl">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">
                {t("bspReporting.commissions")}
              </CardTitle>
              <Users className="h-4 w-4 text-purple-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatSAR(currentCycle.commissionAmount)}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("bspReporting.agentCommissions")}
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
            <span className="hidden sm:inline">
              {t("bspReporting.tabs.cycles")}
            </span>
          </TabsTrigger>
          <TabsTrigger value="generate" className="flex items-center gap-1">
            <FileText className="h-4 w-4" />
            <span className="hidden sm:inline">
              {t("bspReporting.tabs.generate")}
            </span>
          </TabsTrigger>
          <TabsTrigger value="transactions" className="flex items-center gap-1">
            <ClipboardCheck className="h-4 w-4" />
            <span className="hidden sm:inline">
              {t("bspReporting.tabs.transactions")}
            </span>
          </TabsTrigger>
          <TabsTrigger value="agents" className="flex items-center gap-1">
            <Users className="h-4 w-4" />
            <span className="hidden sm:inline">
              {t("bspReporting.tabs.agents")}
            </span>
          </TabsTrigger>
          <TabsTrigger
            value="reconciliation"
            className="flex items-center gap-1"
          >
            <RefreshCw className="h-4 w-4" />
            <span className="hidden sm:inline">
              {t("bspReporting.tabs.reconcile")}
            </span>
          </TabsTrigger>
          <TabsTrigger value="compliance" className="flex items-center gap-1">
            <ShieldCheck className="h-4 w-4" />
            <span className="hidden sm:inline">
              {t("bspReporting.tabs.compliance")}
            </span>
          </TabsTrigger>
        </TabsList>

        {/* ---- Settlement Cycles Overview ---- */}
        <TabsContent value="overview" className="space-y-4">
          <Card className="shadow-sm rounded-xl">
            <CardHeader>
              <CardTitle>{t("bspReporting.settlementCycles")}</CardTitle>
              <CardDescription>
                {t("bspReporting.cyclesDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 mb-4">
                <Label>{t("bspReporting.showCycles")}</Label>
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
                  {t("bspReporting.noCycleData")}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-2 font-medium">
                          {t("bspReporting.cycle")}
                        </th>
                        <th className="pb-2 font-medium">
                          {t("bspReporting.period")}
                        </th>
                        <th className="pb-2 font-medium text-right">
                          {t("bspReporting.sales")}
                        </th>
                        <th className="pb-2 font-medium text-right">
                          {t("bspReporting.refunds")}
                        </th>
                        <th className="pb-2 font-medium text-right">
                          {t("bspReporting.commission")}
                        </th>
                        <th className="pb-2 font-medium text-right">
                          {t("bspReporting.net")}
                        </th>
                        <th className="pb-2 font-medium text-center">
                          {t("bspReporting.status")}
                        </th>
                        <th className="pb-2 font-medium text-center">
                          {t("bspReporting.actions")}
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
                              variant="outline"
                              className={getStatusBadgeClassName(cycle.status)}
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
                              {t("bspReporting.reconcile")}
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
          <Card className="shadow-sm rounded-xl">
            <CardHeader>
              <CardTitle>{t("bspReporting.generateReport")}</CardTitle>
              <CardDescription>
                {t("bspReporting.generateDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>{t("bspReporting.reportType")}</Label>
                  <Select
                    value={reportType}
                    onValueChange={v => setReportType(v as ReportType)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bsp">
                        {t("bspReporting.bspSettlement")}
                      </SelectItem>
                      <SelectItem value="ahc">
                        {t("bspReporting.ahcCharges")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t("bspReporting.periodStart")}</Label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t("bspReporting.periodEnd")}</Label>
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
                {t("bspReporting.generateBtn")}
              </Button>
            </CardContent>
          </Card>

          {/* Generated Report Result */}
          {reportData && (
            <Card className="shadow-sm rounded-xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  {t("bspReporting.reportGenerated")}
                </CardTitle>
                <CardDescription>
                  {t("bspReporting.reportId")}: {reportData.report.id} |{" "}
                  {t("bspReporting.type")}:{" "}
                  {reportData.report.reportType.toUpperCase()} |{" "}
                  {t("bspReporting.cycle")} #{reportData.report.cycleNumber}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {t("bspReporting.totalSales")}
                    </p>
                    <p className="text-lg font-bold">
                      {formatSAR(reportData.report.totalSales)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {t("bspReporting.totalRefunds")}
                    </p>
                    <p className="text-lg font-bold text-red-600">
                      {formatSAR(reportData.report.totalRefunds)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {t("bspReporting.commission")}
                    </p>
                    <p className="text-lg font-bold">
                      {formatSAR(reportData.report.commissionAmount)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {t("bspReporting.netAmount")}
                    </p>
                    <p className="text-lg font-bold text-green-700">
                      {formatSAR(reportData.report.netAmount)}
                    </p>
                  </div>
                </div>
                <div className="mt-4 text-sm text-muted-foreground">
                  {t("bspReporting.transactionsCount")}:{" "}
                  {reportData.transactionCount} |{" "}
                  {t("bspReporting.agentSettlements")}:{" "}
                  {reportData.agentSettlementCount}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ---- Transactions ---- */}
        <TabsContent value="transactions" className="space-y-4">
          <Card className="shadow-sm rounded-xl">
            <CardHeader>
              <CardTitle>{t("bspReporting.bspTransactions")}</CardTitle>
              <CardDescription>
                {t("bspReporting.transactionsDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!reportData || reportData.transactions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <ClipboardCheck className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>{t("bspReporting.noTransactions")}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-2 font-medium">
                          {t("bspReporting.type")}
                        </th>
                        <th className="pb-2 font-medium">
                          {t("bspReporting.document")}
                        </th>
                        <th className="pb-2 font-medium">
                          {t("bspReporting.passengerName")}
                        </th>
                        <th className="pb-2 font-medium">
                          {t("bspReporting.routeCode")}
                        </th>
                        <th className="pb-2 font-medium">
                          {t("bspReporting.agent")}
                        </th>
                        <th className="pb-2 font-medium text-right">
                          {t("bspReporting.fare")}
                        </th>
                        <th className="pb-2 font-medium text-right">
                          {t("bspReporting.tax")}
                        </th>
                        <th className="pb-2 font-medium text-right">
                          {t("bspReporting.comm")}
                        </th>
                        <th className="pb-2 font-medium text-right">
                          {t("bspReporting.net")}
                        </th>
                        <th className="pb-2 font-medium">
                          {t("bspReporting.issueDate")}
                        </th>
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
                      {t("bspReporting.showingOf", {
                        count: reportData.transactionCount,
                      })}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Agent Settlements ---- */}
        <TabsContent value="agents" className="space-y-4">
          <Card className="shadow-sm rounded-xl">
            <CardHeader>
              <CardTitle>{t("bspReporting.agentSettlementSummary")}</CardTitle>
              <CardDescription>
                {t("bspReporting.agentsDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!reportData || reportData.agentSettlements.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>{t("bspReporting.noAgentSettlements")}</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-2 font-medium">
                          {t("bspReporting.agentName")}
                        </th>
                        <th className="pb-2 font-medium">
                          {t("bspReporting.iataNumber")}
                        </th>
                        <th className="pb-2 font-medium text-right">
                          {t("bspReporting.totalSales")}
                        </th>
                        <th className="pb-2 font-medium text-right">
                          {t("bspReporting.totalRefunds")}
                        </th>
                        <th className="pb-2 font-medium text-right">
                          {t("bspReporting.commission")}
                        </th>
                        <th className="pb-2 font-medium text-right">
                          {t("bspReporting.netPayable")}
                        </th>
                        <th className="pb-2 font-medium text-center">
                          {t("bspReporting.status")}
                        </th>
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
                                variant="outline"
                                className={getStatusBadgeClassName(
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
          <Card className="shadow-sm rounded-xl">
            <CardHeader>
              <CardTitle>{t("bspReporting.bspReconciliation")}</CardTitle>
              <CardDescription>
                {t("bspReporting.reconciliationDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {reconcileMutation.isPending ? (
                <div className="flex flex-col items-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-2" />
                  <p className="text-muted-foreground">
                    {t("bspReporting.runningReconciliation")}
                  </p>
                </div>
              ) : !reconciliationData ? (
                <div className="text-center py-8 text-muted-foreground">
                  <RefreshCw className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>{t("bspReporting.noReconciliationData")}</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Reconciliation summary */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">
                        {t("bspReporting.totalBookings")}
                      </p>
                      <p className="text-2xl font-bold">
                        {reconciliationData.totalBookings}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">
                        {t("bspReporting.matched")}
                      </p>
                      <p className="text-2xl font-bold text-green-600">
                        {reconciliationData.matchedTransactions}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">
                        {t("bspReporting.discrepancies")}
                      </p>
                      <p className="text-2xl font-bold text-red-600">
                        {reconciliationData.unmatchedTransactions}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">
                        {t("bspReporting.status")}
                      </p>
                      <Badge
                        variant="outline"
                        className={`mt-1 ${getStatusBadgeClassName(
                          reconciliationData.reconciliationStatus
                        )}`}
                      >
                        {reconciliationData.reconciliationStatus === "clean"
                          ? t("bspReporting.clean")
                          : t("bspReporting.discrepanciesFound")}
                      </Badge>
                    </div>
                  </div>

                  {/* Discrepancies table */}
                  {reconciliationData.discrepancies.length > 0 && (
                    <div>
                      <h3 className="text-lg font-semibold mb-2">
                        {t("bspReporting.discrepancies")}
                      </h3>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-left">
                              <th className="pb-2 font-medium">
                                {t("bspReporting.bookingRef")}
                              </th>
                              <th className="pb-2 font-medium text-right">
                                {t("bspReporting.bookingAmount")}
                              </th>
                              <th className="pb-2 font-medium text-right">
                                {t("bspReporting.paymentAmount")}
                              </th>
                              <th className="pb-2 font-medium text-right">
                                {t("bspReporting.difference")}
                              </th>
                              <th className="pb-2 font-medium">
                                {t("bspReporting.issue")}
                              </th>
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
                    {t("bspReporting.reconciledAt")}{" "}
                    {format(
                      new Date(reconciliationData.reconciledAt),
                      "dd MMM yyyy HH:mm:ss"
                    )}{" "}
                    | {t("bspReporting.cycle")} #
                    {reconciliationData.cycleNumber}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---- Compliance Validation ---- */}
        <TabsContent value="compliance" className="space-y-4">
          <Card className="shadow-sm rounded-xl">
            <CardHeader>
              <CardTitle>{t("bspReporting.iataCompliance")}</CardTitle>
              <CardDescription>
                {t("bspReporting.complianceDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {validateComplianceMutation.isPending ? (
                <div className="flex flex-col items-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-2" />
                  <p className="text-muted-foreground">
                    {t("bspReporting.runningChecks")}
                  </p>
                </div>
              ) : !complianceData ? (
                <div className="text-center py-8 text-muted-foreground">
                  <ShieldCheck className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p>{t("bspReporting.noComplianceData")}</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Overall result */}
                  <div
                    className={`flex items-center gap-3 p-4 rounded-lg border ${
                      complianceData.isCompliant
                        ? "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800"
                        : "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800"
                    }`}
                  >
                    {complianceData.isCompliant ? (
                      <CheckCircle className="h-8 w-8 text-emerald-600" />
                    ) : (
                      <XCircle className="h-8 w-8 text-red-600" />
                    )}
                    <div>
                      <p className="text-lg font-semibold">
                        {complianceData.isCompliant
                          ? t("bspReporting.iataCompliant")
                          : t("bspReporting.complianceIssues")}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {t("bspReporting.checksPassed", {
                          passed: complianceData.checks.filter(
                            (c: ComplianceCheck) => c.passed
                          ).length,
                          total: complianceData.checks.length,
                        })}{" "}
                        | {t("bspReporting.checkedAt")}{" "}
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
