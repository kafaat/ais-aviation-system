/**
 * Scoped reports dashboard
 *
 * Allows authorized airline staff and global admins to export reports
 * Supports CSV, PDF, and Excel formats
 */

import { useState } from "react";
import { Link, Redirect } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
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
import {
  FileText,
  FileSpreadsheet,
  Loader2,
  Calendar,
  TrendingUp,
  Plane,
  Users,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { format, subDays } from "date-fns";
import { ExportReportButton } from "@/components/ExportReportButton";

type ReportType = "bookings" | "revenue" | "flights" | "refunds";
type ExportFormat = "csv" | "pdf" | "excel";

export default function ReportsDashboard() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const canFinance = Boolean(
    user &&
    ["admin", "super_admin", "airline_admin", "finance"].includes(user.role)
  );
  const canOperations = Boolean(
    user && ["admin", "super_admin", "airline_admin", "ops"].includes(user.role)
  );
  const reportTypes: ReportType[] = [
    ...(canFinance ? (["bookings", "revenue"] as const) : []),
    ...(canOperations ? (["flights"] as const) : []),
    ...(canFinance ? (["refunds"] as const) : []),
  ];
  const [selectedTab, setActiveTab] = useState<ReportType>("bookings");
  const activeTab = reportTypes.includes(selectedTab)
    ? selectedTab
    : reportTypes[0];
  const [startDate, setStartDate] = useState(
    format(subDays(new Date(), 30), "yyyy-MM-dd")
  );
  const [endDate, setEndDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [flightStatus, setFlightStatus] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [isExporting, setIsExporting] = useState(false);

  // CSV Export mutations
  const exportBookingsCSV = trpc.reports.exportBookingsCSV.useMutation();
  const exportRevenueCSV = trpc.reports.exportRevenueCSV.useMutation();
  const exportFlightPerformanceCSV =
    trpc.reports.exportFlightPerformanceCSV.useMutation();
  const exportRefundsCSV = trpc.reports.exportRefundsCSV.useMutation();

  // Excel Export mutations
  const exportBookingsExcel = trpc.reports.exportBookingsExcel.useMutation();
  const exportRevenueExcel = trpc.reports.exportRevenueExcel.useMutation();
  const exportFlightPerformanceExcel =
    trpc.reports.exportFlightPerformanceExcel.useMutation();
  const exportRefundsExcel = trpc.reports.exportRefundsExcel.useMutation();

  // PDF Export mutations
  const generateBookingsPDF = trpc.reports.generateBookingsPDF.useMutation();
  const generateRevenuePDF = trpc.reports.generateRevenuePDF.useMutation();
  const generateFlightPerformancePDF =
    trpc.reports.generateFlightPerformancePDF.useMutation();
  const generateRefundsPDF = trpc.reports.generateRefundsPDF.useMutation();

  // Download helper
  const downloadFile = (
    content: string,
    filename: string,
    contentType: string,
    encoding?: string
  ) => {
    let blob: Blob;
    if (encoding === "base64") {
      const byteCharacters = atob(content);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      blob = new Blob([byteArray], { type: contentType });
    } else {
      blob = new Blob([content], { type: contentType });
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const filters = {
    startDate: startDate || undefined,
    endDate: endDate || undefined,
  };
  const bookingFilters = {
    ...filters,
    status: status === "all" ? undefined : status,
  };
  const flightFilters = {
    ...filters,
    status: flightStatus === "all" ? undefined : flightStatus,
  };

  // Export handlers
  const handleExport = async (format: ExportFormat) => {
    setIsExporting(true);

    try {
      let result: {
        filename: string;
        content: string;
        contentType: string;
        encoding?: string;
      };

      if (activeTab === "bookings") {
        if (format === "csv") {
          result = await exportBookingsCSV.mutateAsync(bookingFilters);
        } else if (format === "excel") {
          result = await exportBookingsExcel.mutateAsync(bookingFilters);
        } else {
          result = await generateBookingsPDF.mutateAsync(bookingFilters);
        }
      } else if (activeTab === "revenue") {
        if (format === "csv") {
          result = await exportRevenueCSV.mutateAsync(filters);
        } else if (format === "excel") {
          result = await exportRevenueExcel.mutateAsync(filters);
        } else {
          result = await generateRevenuePDF.mutateAsync(filters);
        }
      } else if (activeTab === "flights") {
        if (format === "csv") {
          result = await exportFlightPerformanceCSV.mutateAsync(flightFilters);
        } else if (format === "excel") {
          result =
            await exportFlightPerformanceExcel.mutateAsync(flightFilters);
        } else {
          result =
            await generateFlightPerformancePDF.mutateAsync(flightFilters);
        }
      } else if (activeTab === "refunds") {
        if (format === "csv") {
          result = await exportRefundsCSV.mutateAsync(filters);
        } else if (format === "excel") {
          result = await exportRefundsExcel.mutateAsync(filters);
        } else {
          result = await generateRefundsPDF.mutateAsync(filters);
        }
      } else {
        throw new Error("Invalid report type");
      }

      downloadFile(
        result.content,
        result.filename,
        result.contentType,
        result.encoding
      );
      toast.success(t("reports.exportSuccess"));
    } catch (error) {
      toast.error(t("reports.exportError"));
      console.error("Export error:", error);
    } finally {
      setIsExporting(false);
    }
  };

  if (reportTypes.length === 0) return <Redirect to="/" />;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">{t("reports.title")}</h1>
        <p className="text-muted-foreground">{t("reports.description")}</p>
        <Button asChild variant="outline" className="mt-3">
          <Link href="/admin/standard-reports">
            <FileText className="size-4" aria-hidden="true" />
            {i18n?.language?.startsWith("ar")
              ? "التقارير القياسية والقوالب"
              : "Standard reports and templates"}
          </Link>
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            {t("reports.filters")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="report-start">{t("reports.startDate")}</Label>
              <Input
                type="date"
                id="report-start"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="report-end">{t("reports.endDate")}</Label>
              <Input
                type="date"
                id="report-end"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
              />
            </div>
            {(activeTab === "bookings" || activeTab === "flights") && (
              <div className="space-y-2">
                <Label htmlFor="report-status">{t("reports.status")}</Label>
                <Select
                  value={activeTab === "flights" ? flightStatus : status}
                  onValueChange={
                    activeTab === "flights" ? setFlightStatus : setStatus
                  }
                >
                  <SelectTrigger id="report-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      {t("reports.allStatuses")}
                    </SelectItem>
                    {activeTab === "flights" ? (
                      <>
                        <SelectItem value="scheduled">
                          {t("flightStatus.scheduled")}
                        </SelectItem>
                        <SelectItem value="delayed">
                          {t("flightStatus.delayed")}
                        </SelectItem>
                      </>
                    ) : (
                      <>
                        <SelectItem value="pending">
                          {t("reports.pending")}
                        </SelectItem>
                        <SelectItem value="confirmed">
                          {t("reports.confirmed")}
                        </SelectItem>
                      </>
                    )}
                    <SelectItem value="cancelled">
                      {t("reports.cancelled")}
                    </SelectItem>
                    <SelectItem value="completed">
                      {t("reports.completed")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Report Types */}
      <Tabs
        value={activeTab}
        onValueChange={value => setActiveTab(value as ReportType)}
      >
        <TabsList className="flex w-full">
          {reportTypes.map(type => {
            const Icon = {
              bookings: Users,
              revenue: TrendingUp,
              flights: Plane,
              refunds: RefreshCw,
            }[type];
            return (
              <TabsTrigger
                key={type}
                value={type}
                className="flex flex-1 items-center gap-2"
              >
                <Icon className="h-4 w-4" />
                {t(`reports.${type}`)}
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent value="bookings">
          <Card>
            <CardHeader>
              <CardTitle>{t("reports.bookingsReport")}</CardTitle>
              <CardDescription>
                {t("reports.bookingsReportDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {t("reports.bookingsIncludes")}:
                </p>
                <ul className="list-disc list-inside text-sm space-y-1">
                  <li>{t("reports.bookingReference")}</li>
                  <li>{t("reports.flightDetails")}</li>
                  <li>{t("reports.passengerCount")}</li>
                  <li>{t("reports.paymentStatus")}</li>
                  <li>{t("reports.totalAmount")}</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="revenue">
          <Card>
            <CardHeader>
              <CardTitle>{t("reports.revenueReport")}</CardTitle>
              <CardDescription>
                {t("reports.revenueReportDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {t("reports.revenueIncludes")}:
                </p>
                <ul className="list-disc list-inside text-sm space-y-1">
                  <li>{t("reports.dailyBilling")}</li>
                  <li>{t("reports.totalBookings")}</li>
                  <li>{t("reports.settlements")}</li>
                  <li>{t("reports.refundedAmount")}</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="flights">
          <Card>
            <CardHeader>
              <CardTitle>{t("reports.flightsReport")}</CardTitle>
              <CardDescription>
                {t("reports.flightsReportDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {t("reports.flightsIncludes")}:
                </p>
                <ul className="list-disc list-inside text-sm space-y-1">
                  <li>{t("reports.flightNumber")}</li>
                  <li>{t("reports.route")}</li>
                  <li>{t("reports.occupancyRate")}</li>
                  <li>{t("reports.estimatedRevenue")}</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="refunds">
          <Card>
            <CardHeader>
              <CardTitle>{t("reports.refundsReport")}</CardTitle>
              <CardDescription>
                {t("reports.refundsReportDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {t("reports.refundsIncludes")}:
                </p>
                <ul className="list-disc list-inside text-sm space-y-1">
                  <li>{t("reports.bookingReference")}</li>
                  <li>{t("reports.refundAmount")}</li>
                  <li>{t("reports.refundDate")}</li>
                  <li>{t("reports.userEmail")}</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Export Buttons */}
      <Card>
        <CardHeader>
          <CardTitle>{t("reports.export")}</CardTitle>
          <CardDescription>{t("reports.exportDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <Button
              onClick={() => handleExport("csv")}
              disabled={isExporting}
              variant="outline"
              className="flex items-center gap-2"
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="h-4 w-4 text-blue-600" />
              )}
              {t("reports.exportCSV")}
            </Button>

            <Button
              onClick={() => handleExport("excel")}
              disabled={isExporting}
              variant="outline"
              className="flex items-center gap-2"
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="h-4 w-4 text-green-600" />
              )}
              {t("reports.exportExcel")}
            </Button>

            <Button
              onClick={() => handleExport("pdf")}
              disabled={isExporting}
              className="flex items-center gap-2"
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              {t("reports.exportPDF")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Quick Export Section */}
      <Card>
        <CardHeader>
          <CardTitle>{t("reports.quickExport")}</CardTitle>
          <CardDescription>{t("reports.quickExportDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {reportTypes.map(type => (
              <ExportReportButton
                key={type}
                reportType={type}
                filters={
                  type === "bookings"
                    ? bookingFilters
                    : type === "flights"
                      ? flightFilters
                      : filters
                }
                showLabel={true}
                variant="outline"
                className="w-full justify-start"
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
