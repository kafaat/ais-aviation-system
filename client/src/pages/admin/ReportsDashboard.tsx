/**
 * Reports Dashboard - Admin Panel
 *
 * Allows admins to generate and export various reports
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
import {
  Download,
  FileText,
  FileSpreadsheet,
  Loader2,
  Calendar,
  TrendingUp,
  Plane,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { format, subDays } from "date-fns";

type ReportType = "bookings" | "revenue" | "flights";
type ExportFormat = "csv" | "pdf";

export default function ReportsDashboard() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ReportType>("bookings");
  const [startDate, setStartDate] = useState(
    format(subDays(new Date(), 30), "yyyy-MM-dd")
  );
  const [endDate, setEndDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [status, setStatus] = useState<string>("all");
  const [isExporting, setIsExporting] = useState(false);

  // Export mutations
  const exportBookingsCSV = trpc.reports.exportBookingsCSV.useMutation();
  const exportRevenueCSV = trpc.reports.exportRevenueCSV.useMutation();
  const exportFlightPerformanceCSV =
    trpc.reports.exportFlightPerformanceCSV.useMutation();
  const generateBookingsPDF = trpc.reports.generateBookingsPDF.useMutation();
  const generateRevenuePDF = trpc.reports.generateRevenuePDF.useMutation();

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

  // Export handlers
  const handleExport = async (format: ExportFormat) => {
    setIsExporting(true);
    const filters = {
      startDate,
      endDate,
      status: status !== "all" ? status : undefined,
    };

    try {
      if (activeTab === "bookings") {
        if (format === "csv") {
          const result = await exportBookingsCSV.mutateAsync(filters);
          downloadFile(result.content, result.filename, result.contentType);
        } else {
          const result = await generateBookingsPDF.mutateAsync(filters);
          downloadFile(
            result.content,
            result.filename,
            result.contentType,
            result.encoding
          );
        }
      } else if (activeTab === "revenue") {
        if (format === "csv") {
          const result = await exportRevenueCSV.mutateAsync(filters);
          downloadFile(result.content, result.filename, result.contentType);
        } else {
          const result = await generateRevenuePDF.mutateAsync(filters);
          downloadFile(
            result.content,
            result.filename,
            result.contentType,
            result.encoding
          );
        }
      } else if (activeTab === "flights") {
        if (format === "csv") {
          const result = await exportFlightPerformanceCSV.mutateAsync(filters);
          downloadFile(result.content, result.filename, result.contentType);
        } else {
          toast.error("PDF export not available for flight performance");
          return;
        }
      }

      toast.success(t("reports.exportSuccess"));
    } catch (error) {
      toast.error(t("reports.exportError"));
      console.error("Export error:", error);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">{t("reports.title")}</h1>
        <p className="text-muted-foreground">{t("reports.description")}</p>
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
              <Label>{t("reports.startDate")}</Label>
              <Input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("reports.endDate")}</Label>
              <Input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("reports.status")}</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("reports.allStatuses")}
                  </SelectItem>
                  <SelectItem value="pending">
                    {t("reports.pending")}
                  </SelectItem>
                  <SelectItem value="confirmed">
                    {t("reports.confirmed")}
                  </SelectItem>
                  <SelectItem value="cancelled">
                    {t("reports.cancelled")}
                  </SelectItem>
                  <SelectItem value="completed">
                    {t("reports.completed")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Report Types */}
      <Tabs
        value={activeTab}
        onValueChange={value => setActiveTab(value as ReportType)}
      >
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="bookings" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            {t("reports.bookings")}
          </TabsTrigger>
          <TabsTrigger value="revenue" className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            {t("reports.revenue")}
          </TabsTrigger>
          <TabsTrigger value="flights" className="flex items-center gap-2">
            <Plane className="h-4 w-4" />
            {t("reports.flights")}
          </TabsTrigger>
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
                  <li>{t("reports.dailyRevenue")}</li>
                  <li>{t("reports.totalBookings")}</li>
                  <li>{t("reports.confirmedRevenue")}</li>
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
                <FileSpreadsheet className="h-4 w-4" />
              )}
              {t("reports.exportCSV")}
            </Button>

            {activeTab !== "flights" && (
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
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
