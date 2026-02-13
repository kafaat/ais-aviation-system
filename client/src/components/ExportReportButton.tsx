/**
 * ExportReportButton Component
 *
 * A dropdown button component for exporting reports in various formats (PDF, Excel, CSV)
 * Handles file download from base64 or text content
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Download,
  FileText,
  FileSpreadsheet,
  ChevronDown,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

export type ReportType = "bookings" | "revenue" | "flights" | "refunds";
export type ExportFormat = "pdf" | "excel" | "csv";

interface ExportReportButtonProps {
  reportType: ReportType;
  filters?: {
    startDate?: string;
    endDate?: string;
    status?: string;
  };
  variant?: "default" | "outline" | "secondary" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
  showLabel?: boolean;
}

/**
 * Helper function to download file from content
 */
function downloadFile(
  content: string,
  filename: string,
  contentType: string,
  encoding?: string
) {
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
}

export function ExportReportButton({
  reportType,
  filters = {},
  variant = "outline",
  size = "default",
  className,
  showLabel = true,
}: ExportReportButtonProps) {
  const { t } = useTranslation();
  const [isExporting, setIsExporting] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(
    null
  );

  // Mutations for bookings reports
  const exportBookingsCSV = trpc.reports.exportBookingsCSV.useMutation();
  const exportBookingsExcel = trpc.reports.exportBookingsExcel.useMutation();
  const generateBookingsPDF = trpc.reports.generateBookingsPDF.useMutation();

  // Mutations for revenue reports
  const exportRevenueCSV = trpc.reports.exportRevenueCSV.useMutation();
  const exportRevenueExcel = trpc.reports.exportRevenueExcel.useMutation();
  const generateRevenuePDF = trpc.reports.generateRevenuePDF.useMutation();

  // Mutations for flights reports
  const exportFlightPerformanceCSV =
    trpc.reports.exportFlightPerformanceCSV.useMutation();
  const exportFlightPerformanceExcel =
    trpc.reports.exportFlightPerformanceExcel.useMutation();
  const generateFlightPerformancePDF =
    trpc.reports.generateFlightPerformancePDF.useMutation();

  // Mutations for refunds reports
  const exportRefundsCSV = trpc.reports.exportRefundsCSV.useMutation();
  const exportRefundsExcel = trpc.reports.exportRefundsExcel.useMutation();
  const generateRefundsPDF = trpc.reports.generateRefundsPDF.useMutation();

  const handleExport = async (format: ExportFormat) => {
    setIsExporting(true);
    setExportingFormat(format);

    try {
      let result: {
        filename: string;
        content: string;
        contentType: string;
        encoding?: string;
      };

      switch (reportType) {
        case "bookings":
          if (format === "csv") {
            result = await exportBookingsCSV.mutateAsync(filters);
          } else if (format === "excel") {
            result = await exportBookingsExcel.mutateAsync(filters);
          } else {
            result = await generateBookingsPDF.mutateAsync(filters);
          }
          break;

        case "revenue":
          if (format === "csv") {
            result = await exportRevenueCSV.mutateAsync(filters);
          } else if (format === "excel") {
            result = await exportRevenueExcel.mutateAsync(filters);
          } else {
            result = await generateRevenuePDF.mutateAsync(filters);
          }
          break;

        case "flights":
          if (format === "csv") {
            result = await exportFlightPerformanceCSV.mutateAsync(filters);
          } else if (format === "excel") {
            result = await exportFlightPerformanceExcel.mutateAsync(filters);
          } else {
            result = await generateFlightPerformancePDF.mutateAsync(filters);
          }
          break;

        case "refunds":
          if (format === "csv") {
            result = await exportRefundsCSV.mutateAsync(filters);
          } else if (format === "excel") {
            result = await exportRefundsExcel.mutateAsync(filters);
          } else {
            result = await generateRefundsPDF.mutateAsync(filters);
          }
          break;

        default:
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
      console.error("Export error:", error);
      toast.error(t("reports.exportError"));
    } finally {
      setIsExporting(false);
      setExportingFormat(null);
    }
  };

  const getReportTypeLabel = () => {
    switch (reportType) {
      case "bookings":
        return t("reports.bookingsReport");
      case "revenue":
        return t("reports.revenueReport");
      case "flights":
        return t("reports.flightsReport");
      case "refunds":
        return t("reports.refundsReport");
      default:
        return t("reports.export");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant}
          size={size}
          disabled={isExporting}
          className={className}
        >
          {isExporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          {showLabel && (
            <span className="ml-2">
              {isExporting ? t("reports.exporting") : t("reports.export")}
            </span>
          )}
          <ChevronDown className="ml-2 h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>{getReportTypeLabel()}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => handleExport("pdf")}
          disabled={isExporting}
        >
          <FileText className="mr-2 h-4 w-4" />
          {exportingFormat === "pdf" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : null}
          {t("reports.exportPDF")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => handleExport("excel")}
          disabled={isExporting}
        >
          <FileSpreadsheet className="mr-2 h-4 w-4 text-green-600" />
          {exportingFormat === "excel" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : null}
          {t("reports.exportExcel")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => handleExport("csv")}
          disabled={isExporting}
        >
          <FileSpreadsheet className="mr-2 h-4 w-4 text-blue-600" />
          {exportingFormat === "csv" ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : null}
          {t("reports.exportCSV")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ExportReportButton;
