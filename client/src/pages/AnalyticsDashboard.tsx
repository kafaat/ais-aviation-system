import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Link } from "wouter";
import {
  ChevronLeft,
  TrendingUp,
  Users,
  DollarSign,
  XCircle,
  Package,
  ShoppingBag,
  Download,
  Calendar,
  FileSpreadsheet,
  FileText,
  Loader2,
} from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { toast } from "sonner";

const COLORS = [
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#06b6d4",
];

const categoryNames: Record<string, string> = {
  baggage: "الحقائب",
  meal: "الوجبات",
  seat: "المقاعد",
  insurance: "التأمين",
  lounge: "صالة الانتظار",
  priority_boarding: "الصعود الأولوي",
};

type DatePreset = "today" | "7d" | "30d" | "90d" | "year" | "all";

function getDateRange(preset: DatePreset): {
  startDate?: Date;
  endDate?: Date;
  days: number;
} {
  const now = new Date();
  const endDate = now;

  switch (preset) {
    case "today": {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return { startDate: start, endDate, days: 1 };
    }
    case "7d": {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      return { startDate: start, endDate, days: 7 };
    }
    case "30d": {
      const start = new Date(now);
      start.setDate(start.getDate() - 30);
      return { startDate: start, endDate, days: 30 };
    }
    case "90d": {
      const start = new Date(now);
      start.setDate(start.getDate() - 90);
      return { startDate: start, endDate, days: 90 };
    }
    case "year": {
      const start = new Date(now.getFullYear(), 0, 1);
      return { startDate: start, endDate, days: 365 };
    }
    case "all":
      return { days: 365 };
  }
}

function downloadFile(
  content: string,
  filename: string,
  contentType: string,
  encoding?: string
) {
  let blob: Blob;
  if (encoding === "base64") {
    const binaryString = atob(content);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    blob = new Blob([bytes], { type: contentType });
  } else {
    blob = new Blob([content], { type: contentType });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function AnalyticsDashboard() {
  const { t } = useTranslation();
  const { user, isAuthenticated } = useAuth();
  const [datePreset, setDatePreset] = useState<DatePreset>("30d");
  const [exporting, setExporting] = useState(false);

  const dateRange = useMemo(() => getDateRange(datePreset), [datePreset]);

  const kpiInput =
    dateRange.startDate && dateRange.endDate
      ? { startDate: dateRange.startDate, endDate: dateRange.endDate }
      : undefined;

  const { data: kpis, isLoading: loadingKPIs } =
    trpc.analytics.getKPIs.useQuery(kpiInput);
  const { data: revenueData, isLoading: loadingRevenue } =
    trpc.analytics.getRevenueOverTime.useQuery({ days: dateRange.days });
  const { data: popularDestinations, isLoading: loadingDestinations } =
    trpc.analytics.getPopularDestinations.useQuery({ limit: 5 });
  const { data: bookingTrends, isLoading: loadingTrends } =
    trpc.analytics.getBookingTrends.useQuery({ days: dateRange.days });

  // Ancillary Analytics
  const { data: ancillaryMetrics, isLoading: loadingAncillaryMetrics } =
    trpc.analytics.getAncillaryMetrics.useQuery(kpiInput);
  const { data: ancillaryByCategory, isLoading: loadingAncillaryCategory } =
    trpc.analytics.getAncillaryRevenueByCategory.useQuery();
  const { data: popularAncillaries, isLoading: loadingPopularAncillaries } =
    trpc.analytics.getPopularAncillaries.useQuery({ limit: 5 });

  // Export mutations
  const exportBookingsCSV = trpc.reports.exportBookingsCSV.useMutation();
  const exportBookingsExcel = trpc.reports.exportBookingsExcel.useMutation();
  const generateBookingsPDF = trpc.reports.generateBookingsPDF.useMutation();

  const handleExport = async (format: "csv" | "excel" | "pdf") => {
    setExporting(true);
    try {
      const filters = {
        startDate: dateRange.startDate?.toISOString(),
        endDate: dateRange.endDate?.toISOString(),
      };

      let result;
      if (format === "csv") {
        result = await exportBookingsCSV.mutateAsync(filters);
      } else if (format === "excel") {
        result = await exportBookingsExcel.mutateAsync(filters);
      } else {
        result = await generateBookingsPDF.mutateAsync(filters);
      }

      downloadFile(
        result.content,
        result.filename,
        result.contentType,
        "encoding" in result
          ? (result as { encoding?: string }).encoding
          : undefined
      );
      toast.success(t("admin.analytics.exportSuccess"));
    } catch {
      toast.error(t("admin.analytics.exportError"));
    } finally {
      setExporting(false);
    }
  };

  const presetLabels: Record<DatePreset, string> = {
    today: t("admin.analytics.today"),
    "7d": t("admin.analytics.last7Days"),
    "30d": t("admin.analytics.last30Days"),
    "90d": t("admin.analytics.last90Days"),
    year: t("admin.analytics.thisYear"),
    all: t("admin.analytics.allTime"),
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <Card className="p-8 text-center max-w-md">
          <h2 className="text-2xl font-bold mb-4">{t("login.required")}</h2>
          <Button asChild className="w-full">
            <a href="/login">{t("login.submit")}</a>
          </Button>
        </Card>
      </div>
    );
  }

  if (user?.role !== "admin") {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <Card className="p-8 text-center max-w-md">
          <h2 className="text-2xl font-bold mb-4">
            {t("common.unauthorized")}
          </h2>
          <Button asChild>
            <Link href="/">{t("common.backToHome")}</Link>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b sticky top-0 z-50">
        <div className="container py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/">
                <Button variant="ghost" size="icon">
                  <ChevronLeft className="h-5 w-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-xl font-bold">
                  {t("admin.analytics.title")}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {t("admin.analytics.subtitle")}
                </p>
              </div>
            </div>

            {/* Date Filter + Export */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <Select
                  value={datePreset}
                  onValueChange={v => setDatePreset(v as DatePreset)}
                >
                  <SelectTrigger className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      Object.entries(presetLabels) as [DatePreset, string][]
                    ).map(([key, label]) => (
                      <SelectItem key={key} value={key}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" disabled={exporting}>
                    {exporting ? (
                      <Loader2 className="h-4 w-4 me-2 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 me-2" />
                    )}
                    {t("admin.analytics.export")}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => handleExport("csv")}>
                    <FileText className="h-4 w-4 me-2" />
                    {t("admin.analytics.exportCSV")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("excel")}>
                    <FileSpreadsheet className="h-4 w-4 me-2" />
                    {t("admin.analytics.exportExcel")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("pdf")}>
                    <FileText className="h-4 w-4 me-2" />
                    {t("admin.analytics.exportPDF")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </header>

      <div className="container py-8 space-y-8">
        {/* Main KPIs */}
        <div>
          <h2 className="text-lg font-semibold mb-4">
            {t("admin.analytics.kpiTitle")}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {loadingKPIs ? (
              <>
                {[1, 2, 3, 4].map(i => (
                  <Skeleton key={i} className="h-32" />
                ))}
              </>
            ) : (
              <>
                <Card className="p-6">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm text-muted-foreground">
                      {t("admin.analytics.totalBookings")}
                    </p>
                    <Users className="h-5 w-5 text-blue-500" />
                  </div>
                  <p className="text-3xl font-bold">
                    {kpis?.totalBookings || 0}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {kpis?.totalPassengers || 0}{" "}
                    {t("admin.analytics.passenger")}
                  </p>
                </Card>

                <Card className="p-6">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm text-muted-foreground">
                      {t("admin.analytics.totalRevenue")}
                    </p>
                    <DollarSign className="h-5 w-5 text-green-500" />
                  </div>
                  <p className="text-3xl font-bold">
                    {((kpis?.totalRevenue || 0) / 100).toFixed(0)} SAR
                  </p>
                </Card>

                <Card className="p-6">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm text-muted-foreground">
                      {t("admin.analytics.occupancyRate")}
                    </p>
                    <TrendingUp className="h-5 w-5 text-purple-500" />
                  </div>
                  <p className="text-3xl font-bold">
                    {kpis?.averageOccupancyRate || 0}%
                  </p>
                </Card>

                <Card className="p-6">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm text-muted-foreground">
                      {t("admin.analytics.cancellationRate")}
                    </p>
                    <XCircle className="h-5 w-5 text-red-500" />
                  </div>
                  <p className="text-3xl font-bold">
                    {kpis?.cancellationRate || 0}%
                  </p>
                </Card>
              </>
            )}
          </div>
        </div>

        {/* Ancillary KPIs */}
        <div>
          <h2 className="text-lg font-semibold mb-4">
            {t("admin.analytics.ancillaryTitle")}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {loadingAncillaryMetrics ? (
              <>
                {[1, 2, 3, 4].map(i => (
                  <Skeleton key={i} className="h-32" />
                ))}
              </>
            ) : (
              <>
                <Card className="p-6 bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm text-blue-900 dark:text-blue-100 font-medium">
                      {t("admin.analytics.ancillaryRevenue")}
                    </p>
                    <ShoppingBag className="h-5 w-5 text-blue-600" />
                  </div>
                  <p className="text-3xl font-bold text-blue-900 dark:text-blue-100">
                    {(
                      (ancillaryMetrics?.totalAncillaryRevenue || 0) / 100
                    ).toFixed(0)}{" "}
                    SAR
                  </p>
                </Card>

                <Card className="p-6 bg-purple-50 dark:bg-purple-950 border-purple-200 dark:border-purple-800">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm text-purple-900 dark:text-purple-100 font-medium">
                      {t("admin.analytics.attachmentRate")}
                    </p>
                    <Package className="h-5 w-5 text-purple-600" />
                  </div>
                  <p className="text-3xl font-bold text-purple-900 dark:text-purple-100">
                    {ancillaryMetrics?.ancillaryAttachmentRate || 0}%
                  </p>
                  <p className="text-xs text-purple-700 dark:text-purple-300 mt-1">
                    {t("admin.analytics.bookingsWithServices")}
                  </p>
                </Card>

                <Card className="p-6 bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm text-green-900 dark:text-green-100 font-medium">
                      {t("admin.analytics.avgRevenue")}
                    </p>
                    <DollarSign className="h-5 w-5 text-green-600" />
                  </div>
                  <p className="text-3xl font-bold text-green-900 dark:text-green-100">
                    {(
                      (ancillaryMetrics?.averageAncillaryRevenuePerBooking ||
                        0) / 100
                    ).toFixed(0)}{" "}
                    SAR
                  </p>
                  <p className="text-xs text-green-700 dark:text-green-300 mt-1">
                    {t("admin.analytics.perBooking")}
                  </p>
                </Card>

                <Card className="p-6 bg-orange-50 dark:bg-orange-950 border-orange-200 dark:border-orange-800">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm text-orange-900 dark:text-orange-100 font-medium">
                      {t("admin.analytics.totalSold")}
                    </p>
                    <TrendingUp className="h-5 w-5 text-orange-600" />
                  </div>
                  <p className="text-3xl font-bold text-orange-900 dark:text-orange-100">
                    {ancillaryMetrics?.totalAncillariesSold || 0}
                  </p>
                  <p className="text-xs text-orange-700 dark:text-orange-300 mt-1">
                    {t("admin.analytics.servicesSold")}
                  </p>
                </Card>
              </>
            )}
          </div>
        </div>

        {/* Charts Row 1 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Revenue Over Time */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">
              {t("admin.analytics.dailyRevenue")}
            </h3>
            {loadingRevenue ? (
              <Skeleton className="h-64" />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={revenueData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="#3b82f6"
                    name={t("admin.analytics.revenueLabel")}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Card>

          {/* Booking Trends */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">
              {t("admin.analytics.bookingTrends")}
            </h3>
            {loadingTrends ? (
              <Skeleton className="h-64" />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={bookingTrends}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar
                    dataKey="bookings"
                    fill="#8b5cf6"
                    name={t("admin.analytics.bookings")}
                  />
                  <Bar
                    dataKey="passengers"
                    fill="#ec4899"
                    name={t("admin.analytics.passengers")}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </div>

        {/* Charts Row 2: Ancillary Analytics */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Ancillary Revenue by Category */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">
              {t("admin.analytics.revenueByCat")}
            </h3>
            {loadingAncillaryCategory ? (
              <Skeleton className="h-64" />
            ) : ancillaryByCategory && ancillaryByCategory.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={ancillaryByCategory.map(item => ({
                      name: categoryNames[item.category] || item.category,
                      value: item.revenue / 100,
                    }))}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={entry =>
                      `${entry.name}: ${entry.value.toFixed(0)} SAR`
                    }
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {ancillaryByCategory.map((_entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={COLORS[index % COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-64 flex items-center justify-center text-muted-foreground">
                {t("admin.analytics.noData")}
              </div>
            )}
          </Card>

          {/* Popular Destinations */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">
              {t("admin.analytics.popularDestinations")}
            </h3>
            {loadingDestinations ? (
              <Skeleton className="h-64" />
            ) : (
              <div className="space-y-3">
                {popularDestinations?.map((dest, index) => (
                  <div
                    key={dest.airportCode}
                    className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-primary text-white flex items-center justify-center font-bold">
                        {index + 1}
                      </div>
                      <div>
                        <p className="font-medium">{dest.city}</p>
                        <p className="text-sm text-muted-foreground">
                          {dest.airportCode}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">
                        {dest.bookingCount} {t("admin.analytics.bookings")}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {(dest.revenue / 100).toFixed(0)} SAR
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Popular Ancillaries */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">
            {t("admin.analytics.topAncillaries")}
          </h3>
          {loadingPopularAncillaries ? (
            <Skeleton className="h-48" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {popularAncillaries?.map((ancillary, index) => (
                <div
                  key={index}
                  className="p-4 border rounded-lg bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950 dark:to-purple-950"
                >
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold">{ancillary.serviceName}</h4>
                    <Package className="h-5 w-5 text-blue-600" />
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">
                    {categoryNames[ancillary.category] || ancillary.category}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      {t("admin.analytics.sales")}: {ancillary.totalSold}
                    </span>
                    <span className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                      {(ancillary.revenue / 100).toFixed(0)} SAR
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
