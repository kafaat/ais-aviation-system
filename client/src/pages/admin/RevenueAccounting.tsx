import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DollarSign,
  Clock,
  CheckCircle,
  Package,
  TrendingUp,
  TrendingDown,
  FileText,
  RefreshCw,
} from "lucide-react";

type YieldRow =
  inferRouterOutputs<AppRouter>["revenueAccounting"]["getYieldAnalysis"][number];
const evidenceLabel = (row: YieldRow) =>
  row.evidenceId === null ? "—" : `${row.sourceId} / ${row.evidenceId}`;

// ============ Helpers ============

/** Convert SAR cents to SAR display string */
function formatSAR(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Get date N days ago */
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Channel display labels */
const CHANNEL_LABELS: Record<string, string> = {
  direct: "Direct (Website)",
  agent: "Travel Agent",
  corporate: "Corporate",
};

/** Category display labels */
const CATEGORY_LABELS: Record<string, string> = {
  baggage: "Baggage",
  meal: "Meals",
  seat: "Seat Selection",
  insurance: "Insurance",
  lounge: "Lounge Access",
  priority_boarding: "Priority Boarding",
};

// ============ Tabs ============

type TabKey = "route" | "class" | "channel" | "ancillary" | "yield" | "reports";

const TAB_KEYS: TabKey[] = [
  "route",
  "class",
  "channel",
  "ancillary",
  "yield",
  "reports",
];

// ============ Main Component ============

export function RevenueAccounting() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabKey>("route");
  const [dateRange, setDateRange] = useState<"30" | "90" | "365" | "all">("30");

  // Report generation state
  const [reportMonth, setReportMonth] = useState<number>(
    new Date().getMonth() + 1
  );
  const [reportYear, setReportYear] = useState<number>(
    new Date().getFullYear()
  );

  // All queries for this selection share a fixed reporting instant. A new
  // Date on each render would issue a new query before its result can render.
  const dateFilter = useMemo(
    () =>
      dateRange === "all"
        ? undefined
        : {
            startDate: daysAgo(Number(dateRange)),
            endDate: new Date(),
          },
    [dateRange]
  );

  // ============ Queries ============

  const dashboardQuery =
    trpc.revenueAccounting.getDashboard.useQuery(dateFilter);
  const routeQuery = trpc.revenueAccounting.getRevenueByRoute.useQuery(
    dateFilter,
    { enabled: activeTab === "route" }
  );
  const classQuery = trpc.revenueAccounting.getRevenueByClass.useQuery(
    dateFilter,
    { enabled: activeTab === "class" }
  );
  const channelQuery = trpc.revenueAccounting.getRevenueByChannel.useQuery(
    dateFilter,
    { enabled: activeTab === "channel" }
  );
  const ancillaryQuery = trpc.revenueAccounting.getAncillaryRevenue.useQuery(
    dateFilter,
    { enabled: activeTab === "ancillary" }
  );
  const yieldQuery = trpc.revenueAccounting.getYieldAnalysis.useQuery(
    { ...dateFilter, limit: 20 },
    { enabled: activeTab === "yield" }
  );
  const reportsQuery = trpc.revenueAccounting.getReports.useQuery(undefined, {
    enabled: activeTab === "reports",
  });
  const deferredQuery = trpc.revenueAccounting.getDeferredRevenue.useQuery();
  const { data: dashboard, isLoading: dashboardLoading } = dashboardQuery;
  const { data: routeData, isLoading: routeLoading } = routeQuery;
  const { data: classData, isLoading: classLoading } = classQuery;
  const { data: channelData, isLoading: channelLoading } = channelQuery;
  const { data: ancillaryData, isLoading: ancillaryLoading } = ancillaryQuery;
  const { data: yieldData, isLoading: yieldLoading } = yieldQuery;
  const { data: reports, isLoading: reportsLoading } = reportsQuery;
  const { data: deferredData, isLoading: deferredLoading } = deferredQuery;
  const generateReportMutation =
    trpc.revenueAccounting.generateReport.useMutation({
      onSuccess: () => {
        void reportsQuery.refetch();
      },
    });
  const selectedQuery = {
    route: routeQuery,
    class: classQuery,
    channel: channelQuery,
    ancillary: ancillaryQuery,
    yield: yieldQuery,
    reports: reportsQuery,
  }[activeTab];
  const requiredQueries = [dashboardQuery, deferredQuery, selectedQuery];
  if (requiredQueries.some(q => q.isError)) {
    return (
      <div className="container py-8">
        <h1 className="text-3xl font-bold">
          {t("revenueAccounting.title", "Revenue Accounting")}
        </h1>
        <div
          role="alert"
          className="my-6 rounded border border-destructive p-4"
        >
          <p>
            {t(
              "revenueAccounting.sourceUnavailable",
              "Financial data could not be loaded. Amounts are unavailable."
            )}
          </p>
          <Button
            className="mt-3"
            onClick={() => {
              for (const query of requiredQueries) void query.refetch();
            }}
          >
            {t("revenueAccounting.retry", "Retry")}
          </Button>
        </div>
      </div>
    );
  }

  // ============ Render ============

  return (
    <div className="container py-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">
            {t("revenueAccounting.title", "Revenue Accounting")}
          </h1>
          <p className="text-muted-foreground">
            {t(
              "revenueAccounting.subtitle",
              "Financial overview, revenue recognition, and yield analysis"
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {(["30", "90", "365", "all"] as const).map(range => (
            <Button
              key={range}
              variant={dateRange === range ? "default" : "outline"}
              size="sm"
              onClick={() => setDateRange(range)}
            >
              {range === "all"
                ? "All Time"
                : range === "365"
                  ? "1 Year"
                  : `${range} Days`}
            </Button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("revenueAccounting.cashCollected", "Cash collected")}
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {dashboardLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {formatSAR(dashboard?.totalRevenue ?? 0)} SAR
                </div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  {dashboard && dashboard.revenueGrowthPercent !== 0 ? (
                    <>
                      {dashboard.revenueGrowthPercent > 0 ? (
                        <TrendingUp className="h-3 w-3 text-green-600" />
                      ) : (
                        <TrendingDown className="h-3 w-3 text-red-600" />
                      )}
                      <span
                        className={
                          dashboard.revenueGrowthPercent > 0
                            ? "text-green-600"
                            : "text-red-600"
                        }
                      >
                        {dashboard.revenueGrowthPercent > 0 ? "+" : ""}
                        {dashboard.revenueGrowthPercent}%
                      </span>{" "}
                      vs previous period
                    </>
                  ) : (
                    <span>{dashboard?.totalBookings ?? 0} bookings</span>
                  )}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("revenueAccounting.deferredRevenue", "Deferred Revenue")}
            </CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {dashboardLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {dashboard?.deferredRevenue == null
                    ? t("revenueAccounting.notVerified", "Not verified")
                    : `${formatSAR(dashboard.deferredRevenue)} SAR`}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t(
                    "revenueAccounting.deferralEvidence",
                    "Requires a verified transport liability allocation"
                  )}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("revenueAccounting.recognizedRevenue", "Recognized Revenue")}
            </CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {dashboardLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {dashboard?.recognizedRevenue == null
                    ? t("revenueAccounting.notVerified", "Not verified")
                    : `${formatSAR(dashboard.recognizedRevenue)} SAR`}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t(
                    "revenueAccounting.recognitionEvidence",
                    "Requires evidence of delivered service and its value"
                  )}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("revenueAccounting.ancillaryRevenue", "Ancillary Revenue")}
            </CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {dashboardLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {dashboard?.ancillaryRevenue == null
                    ? t("revenueAccounting.notVerified", "Not verified")
                    : `${formatSAR(dashboard.ancillaryRevenue)} SAR`}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t(
                    "revenueAccounting.recognitionEvidence",
                    "Requires evidence of delivered service and its value"
                  )}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Summary bar */}
      <div className="grid gap-4 md:grid-cols-3 mb-8">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {t("revenueAccounting.netCash", "Net cash collected")}
              </span>
              <span className="text-lg font-semibold">
                {dashboard ? `${formatSAR(dashboard.netRevenue)} SAR` : "—"}
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {t(
                  "revenueAccounting.cashPerBooking",
                  "Average cash collected per paid booking"
                )}
              </span>
              <span className="text-lg font-semibold">
                {dashboard
                  ? `${formatSAR(dashboard.averageRevenuePerBooking)} SAR`
                  : "—"}
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {t("revenueAccounting.refunds", "Refunds")}
              </span>
              <span className="text-lg font-semibold text-red-600">
                {dashboard ? `-${formatSAR(dashboard.refundTotal)} SAR` : "—"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {TAB_KEYS.map(key => (
          <Button
            key={key}
            variant={activeTab === key ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveTab(key)}
          >
            {t(`revenueAccounting.tabs.${key}`, key)}
          </Button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="space-y-6">
        {/* By Route Tab */}
        {activeTab === "route" && (
          <Card>
            <CardHeader>
              <CardTitle>
                {t(
                  "revenueAccounting.revenueByRoute",
                  "Paid booking value by primary route"
                )}
              </CardTitle>
              <CardDescription>
                {t(
                  "revenueAccounting.topRoutesDesc",
                  "Primary routes ranked by gross paid booking value"
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {routeLoading ? (
                <Skeleton className="h-[400px] w-full" />
              ) : routeData && routeData.length > 0 ? (
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-3 font-medium">
                          {t("revenueAccounting.route", "Route")}
                        </th>
                        <th className="text-right p-3 font-medium">
                          {t(
                            "revenueAccounting.revenueSAR",
                            "Booking value (SAR)"
                          )}
                        </th>
                        <th className="text-right p-3 font-medium">
                          {t("revenueAccounting.bookings", "Bookings")}
                        </th>
                        <th className="text-right p-3 font-medium">
                          {t("revenueAccounting.passengers", "Passengers")}
                        </th>
                        <th className="text-right p-3 font-medium">
                          {t(
                            "revenueAccounting.avgPerBooking",
                            "Avg / Booking (SAR)"
                          )}
                        </th>
                        <th className="p-3 font-medium">
                          {t(
                            "revenueAccounting.revenueShare",
                            "Booking value share"
                          )}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const maxRevenue = Math.max(
                          ...routeData.map(r => r.totalRevenue),
                          1
                        );
                        return routeData.map((route, idx) => (
                          <tr key={idx} className="border-b hover:bg-muted/50">
                            <td className="p-3 font-medium">
                              {route.originCode} - {route.destinationCode}
                              <span className="block text-xs text-muted-foreground">
                                {route.originCity} to {route.destinationCity}
                              </span>
                            </td>
                            <td className="p-3 text-right font-semibold">
                              {formatSAR(route.totalRevenue)}
                            </td>
                            <td className="p-3 text-right">
                              {route.bookingCount.toLocaleString()}
                            </td>
                            <td className="p-3 text-right">
                              {route.passengerCount.toLocaleString()}
                            </td>
                            <td className="p-3 text-right">
                              {formatSAR(route.averageRevenue)}
                            </td>
                            <td className="p-3 w-32">
                              <div className="w-full bg-muted rounded-full h-2">
                                <div
                                  className="bg-blue-500 h-2 rounded-full"
                                  style={{
                                    width: `${(route.totalRevenue / maxRevenue) * 100}%`,
                                  }}
                                />
                              </div>
                            </td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-8">
                  No route revenue data available for the selected period.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* By Class Tab */}
        {activeTab === "class" && (
          <Card>
            <CardHeader>
              <CardTitle>
                {t(
                  "revenueAccounting.revenueByClass",
                  "Paid booking value by cabin class"
                )}
              </CardTitle>
              <CardDescription>
                {t(
                  "revenueAccounting.classComparisonDesc",
                  "Gross paid booking value for economy and business"
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {classLoading ? (
                <Skeleton className="h-[300px] w-full" />
              ) : classData && classData.length > 0 ? (
                <div className="space-y-6">
                  <div className="grid gap-4 md:grid-cols-2">
                    {classData.map(cls => (
                      <Card key={cls.classOfService} className="border-2">
                        <CardContent className="pt-6">
                          <div className="text-center mb-4">
                            <h3 className="text-lg font-semibold capitalize">
                              {cls.classOfService} Class
                            </h3>
                            <p className="text-3xl font-bold mt-2">
                              {formatSAR(cls.totalRevenue)} SAR
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {cls.percentageOfTotal}%{" "}
                              {t(
                                "revenueAccounting.ofBookingGross",
                                "of gross booking value"
                              )}
                            </p>
                          </div>
                          <div className="space-y-2 text-sm">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">
                                Bookings
                              </span>
                              <span className="font-medium">
                                {cls.bookingCount.toLocaleString()}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">
                                Passengers
                              </span>
                              <span className="font-medium">
                                {cls.passengerCount.toLocaleString()}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">
                                Avg / Booking
                              </span>
                              <span className="font-medium">
                                {formatSAR(cls.averageRevenue)} SAR
                              </span>
                            </div>
                          </div>
                          {/* Visual bar */}
                          <div className="mt-4 w-full bg-muted rounded-full h-3">
                            <div
                              className={`h-3 rounded-full ${
                                cls.classOfService === "business"
                                  ? "bg-purple-500"
                                  : "bg-blue-500"
                              }`}
                              style={{
                                width: `${cls.percentageOfTotal}%`,
                              }}
                            />
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-8">
                  No class revenue data available for the selected period.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* By Channel Tab */}
        {activeTab === "channel" && (
          <Card>
            <CardHeader>
              <CardTitle>
                {t(
                  "revenueAccounting.revenueByChannel",
                  "Paid booking value by channel"
                )}
              </CardTitle>
              <CardDescription>
                {t(
                  "revenueAccounting.channelDesc",
                  "Direct website, travel agent, and corporate booking channels"
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {channelLoading ? (
                <Skeleton className="h-[300px] w-full" />
              ) : channelData && channelData.length > 0 ? (
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-3 font-medium">Channel</th>
                        <th className="text-right p-3 font-medium">
                          {t(
                            "revenueAccounting.bookedAmountSar",
                            "Booked amount (SAR)"
                          )}
                        </th>
                        <th className="text-right p-3 font-medium">Bookings</th>
                        <th className="text-right p-3 font-medium">
                          Avg / Booking (SAR)
                        </th>
                        <th className="text-right p-3 font-medium">Share %</th>
                        <th className="p-3 font-medium">Distribution</th>
                      </tr>
                    </thead>
                    <tbody>
                      {channelData.map(ch => (
                        <tr
                          key={ch.channel}
                          className="border-b hover:bg-muted/50"
                        >
                          <td className="p-3 font-medium">
                            {CHANNEL_LABELS[ch.channel] || ch.channel}
                          </td>
                          <td className="p-3 text-right font-semibold">
                            {formatSAR(ch.totalRevenue)}
                          </td>
                          <td className="p-3 text-right">
                            {ch.bookingCount.toLocaleString()}
                          </td>
                          <td className="p-3 text-right">
                            {formatSAR(ch.averageRevenue)}
                          </td>
                          <td className="p-3 text-right">
                            {ch.percentageOfTotal}%
                          </td>
                          <td className="p-3 w-32">
                            <div className="w-full bg-muted rounded-full h-2">
                              <div
                                className={`h-2 rounded-full ${
                                  ch.channel === "direct"
                                    ? "bg-blue-500"
                                    : ch.channel === "agent"
                                      ? "bg-green-500"
                                      : "bg-purple-500"
                                }`}
                                style={{
                                  width: `${ch.percentageOfTotal}%`,
                                }}
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-8">
                  No channel revenue data available for the selected period.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Ancillary Tab */}
        {activeTab === "ancillary" && (
          <Card>
            <CardHeader>
              <CardTitle>
                {t(
                  "revenueAccounting.activeAddOns",
                  "Active add-on booking value"
                )}
              </CardTitle>
              <CardDescription>
                {t(
                  "revenueAccounting.activeAddOnBasis",
                  "Booked prices for active add-ons by category."
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {ancillaryLoading ? (
                <Skeleton className="h-[300px] w-full" />
              ) : ancillaryData ? (
                <div className="space-y-6">
                  <div className="text-center p-4 bg-muted/50 rounded-lg">
                    <p className="text-sm text-muted-foreground">
                      {t(
                        "revenueAccounting.activeAddOns",
                        "Active add-on booking value"
                      )}
                    </p>
                    <p className="text-3xl font-bold">
                      {formatSAR(ancillaryData.total)} SAR
                    </p>
                  </div>

                  {ancillaryData.breakdown.length > 0 ? (
                    <div className="overflow-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left p-3 font-medium">
                              Category
                            </th>
                            <th className="text-right p-3 font-medium">
                              {t(
                                "revenueAccounting.bookedAmountSar",
                                "Booked amount (SAR)"
                              )}
                            </th>
                            <th className="text-right p-3 font-medium">
                              Qty Sold
                            </th>
                            <th className="text-right p-3 font-medium">
                              Avg Price (SAR)
                            </th>
                            <th className="text-right p-3 font-medium">
                              Share %
                            </th>
                            <th className="p-3 font-medium">Distribution</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ancillaryData.breakdown.map(item => (
                            <tr
                              key={item.category}
                              className="border-b hover:bg-muted/50"
                            >
                              <td className="p-3 font-medium">
                                {CATEGORY_LABELS[item.category] ||
                                  item.category}
                              </td>
                              <td className="p-3 text-right font-semibold">
                                {formatSAR(item.totalRevenue)}
                              </td>
                              <td className="p-3 text-right">
                                {item.quantity.toLocaleString()}
                              </td>
                              <td className="p-3 text-right">
                                {formatSAR(item.averagePrice)}
                              </td>
                              <td className="p-3 text-right">
                                {item.percentageOfTotal}%
                              </td>
                              <td className="p-3 w-32">
                                <div className="w-full bg-muted rounded-full h-2">
                                  <div
                                    className="bg-amber-500 h-2 rounded-full"
                                    style={{
                                      width: `${item.percentageOfTotal}%`,
                                    }}
                                  />
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-center text-muted-foreground py-4">
                      No ancillary revenue data for the selected period.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-8">
                  No ancillary data available.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Yield Analysis Tab */}
        {activeTab === "yield" && (
          <Card>
            <CardHeader>
              <CardTitle>
                {t("revenueAccounting.yieldAnalysis", "Yield Analysis")}
              </CardTitle>
              <CardDescription>
                {t(
                  "revenueAccounting.yieldDesc",
                  "Flight revenue and distance require approved evidence; passenger counts represent funded itinerary membership."
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {yieldLoading ? (
                <Skeleton className="h-[400px] w-full" />
              ) : yieldData && yieldData.length > 0 ? (
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-3 font-medium">Flight</th>
                        <th className="text-left p-3 font-medium">Route</th>
                        <th className="text-right p-3 font-medium">
                          {t(
                            "revenueAccounting.bookedAmountSar",
                            "Booked amount (SAR)"
                          )}
                        </th>
                        <th className="text-right p-3 font-medium">Pax</th>
                        <th className="text-right p-3 font-medium">
                          {t("revenueAccounting.distanceKm", "Distance (km)")}
                        </th>
                        <th className="text-right p-3 font-medium">
                          {t(
                            "revenueAccounting.fundedPassengerKm",
                            "Funded passenger km"
                          )}
                        </th>
                        <th className="text-right p-3 font-medium">
                          {t(
                            "revenueAccounting.fundedYield",
                            "Revenue / funded passenger km"
                          )}
                        </th>
                        <th className="text-right p-3 font-medium">
                          {t("revenueAccounting.fundedLoad", "Funded load")}
                        </th>
                        <th className="text-left p-3">
                          {t("revenueAccounting.evidence", "Evidence")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {yieldData.map(row => (
                        <tr
                          key={row.flightId}
                          className="border-b hover:bg-muted/50"
                        >
                          <td className="p-3 font-medium">
                            {row.flightNumber}
                          </td>
                          <td className="p-3">
                            {row.originCode} - {row.destinationCode}
                          </td>
                          <td className="p-3 text-right font-semibold">
                            {row.totalRevenue === null
                              ? "—"
                              : formatSAR(row.totalRevenue)}
                          </td>
                          <td className="p-3 text-right">
                            {row.passengerCount}
                          </td>
                          <td className="p-3 text-right">
                            {row.distanceKm?.toLocaleString() ?? "—"}
                          </td>
                          <td className="p-3 text-right">
                            {row.rpk?.toLocaleString() ?? "—"}
                          </td>
                          <td className="p-3 text-right font-semibold">
                            {row.yield?.toFixed(2) ?? "—"}
                          </td>
                          <td className="p-3 text-right">
                            <span
                              className={`font-semibold ${
                                row.loadFactor >= 80
                                  ? "text-green-600"
                                  : row.loadFactor >= 50
                                    ? "text-yellow-600"
                                    : "text-red-600"
                              }`}
                            >
                              {row.loadFactor}%
                            </span>
                          </td>
                          <td className="p-3">
                            {evidenceLabel(row)}
                            <div>
                              {t(
                                `revenueAccounting.coverage.${row.coverage}`,
                                row.coverage
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-8">
                  No yield data available for the selected period.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Reports Tab */}
        {activeTab === "reports" && (
          <div className="space-y-6">
            {/* Report Generation */}
            <Card>
              <CardHeader>
                <CardTitle>
                  {t(
                    "revenueAccounting.generateMonthlyReport",
                    "Generate Monthly Report"
                  )}
                </CardTitle>
                <CardDescription>
                  {t(
                    "revenueAccounting.generateMonthlyReportDesc",
                    "Create a revenue reconciliation report for a specific month"
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-end gap-4">
                  <div>
                    <label className="text-sm font-medium block mb-1">
                      {t("revenueAccounting.month", "Month")}
                    </label>
                    <select
                      className="border rounded-md px-3 py-2 text-sm bg-background"
                      value={reportMonth}
                      onChange={e => setReportMonth(parseInt(e.target.value))}
                    >
                      {Array.from({ length: 12 }, (_, i) => (
                        <option key={i + 1} value={i + 1}>
                          {new Date(2024, i).toLocaleString("default", {
                            month: "long",
                          })}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1">
                      {t("revenueAccounting.year", "Year")}
                    </label>
                    <select
                      className="border rounded-md px-3 py-2 text-sm bg-background"
                      value={reportYear}
                      onChange={e => setReportYear(parseInt(e.target.value))}
                    >
                      {Array.from({ length: 5 }, (_, i) => {
                        const y = new Date().getFullYear() - i;
                        return (
                          <option key={y} value={y}>
                            {y}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <Button
                    onClick={() =>
                      generateReportMutation.mutate({
                        month: reportMonth,
                        year: reportYear,
                      })
                    }
                    disabled={generateReportMutation.isPending}
                  >
                    {generateReportMutation.isPending ? (
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <FileText className="h-4 w-4 mr-2" />
                    )}
                    Generate Report
                  </Button>
                </div>

                {generateReportMutation.isError && (
                  <p role="alert">
                    {t(
                      "revenueAccounting.reportFailed",
                      "Report generation failed. Retry when the source is available."
                    )}
                  </p>
                )}
                {/* This is a computed view, not a saved or approved report. */}
                {generateReportMutation.data && (
                  <div className="mt-6 border rounded-lg p-4 bg-muted/30">
                    <h4 className="font-semibold mb-2">
                      Report: {generateReportMutation.data.id}
                    </h4>
                    <p className="mb-3 text-xs text-muted-foreground">
                      Calculated live from booking and ledger dates; not saved.
                      Collected cash is not earned revenue.
                    </p>
                    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 text-sm">
                      {(
                        [
                          {
                            label: "Cash collected",
                            amount: generateReportMutation.data.collectedAmount,
                          },
                          {
                            label: "Cash refunds",
                            amount: generateReportMutation.data.refundAmount,
                          },
                          {
                            label: "Net cash collected",
                            amount:
                              generateReportMutation.data.netCollectedAmount,
                          },
                          {
                            label: "Booking totals (created)",
                            amount: generateReportMutation.data.billedAmount,
                          },
                          {
                            label: "Non-cash funding",
                            amount:
                              generateReportMutation.data.nonCashFundedAmount,
                          },
                          {
                            label: "Non-cash refunds",
                            amount:
                              generateReportMutation.data.nonCashRefundedAmount,
                          },
                          {
                            label: "Deferred revenue",
                            amount: generateReportMutation.data.deferredRevenue,
                          },
                          {
                            label: "Recognized revenue",
                            amount:
                              generateReportMutation.data.recognizedRevenue,
                          },
                          {
                            label: "Ancillary revenue",
                            amount:
                              generateReportMutation.data.ancillaryRevenue,
                          },
                        ] as const
                      ).map(({ label, amount }) => (
                        <div key={label}>
                          <span className="text-muted-foreground">
                            {label}:{" "}
                          </span>
                          <span className="font-medium">
                            {amount === null
                              ? "Not verified"
                              : formatSAR(amount) + " SAR"}
                          </span>
                        </div>
                      ))}
                    </div>
                    {(generateReportMutation.data.unreconciledBookings > 0 ||
                      generateReportMutation.data.unclassifiedEntries > 0) && (
                      <p role="alert" className="mt-3 text-sm">
                        Evidence gaps:{" "}
                        {generateReportMutation.data.unreconciledBookings}{" "}
                        unreconciled bookings,{" "}
                        {generateReportMutation.data.unclassifiedEntries}{" "}
                        unclassified ledger entries.
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Report History */}
            <Card>
              <CardHeader>
                <CardTitle>Monthly Cash Views</CardTitle>
                <CardDescription>
                  Computed monthly views, not persisted reports; cash is grouped
                  by ledger posting date.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {reportsLoading ? (
                  <Skeleton className="h-[300px] w-full" />
                ) : reports && reports.length > 0 ? (
                  <div className="overflow-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left p-3 font-medium">
                            Report ID
                          </th>
                          <th className="text-left p-3 font-medium">Period</th>
                          <th className="text-right p-3 font-medium">
                            Cash Collected (SAR)
                          </th>
                          <th className="text-left p-3 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reports.map(report => (
                          <tr
                            key={report.id}
                            className="border-b hover:bg-muted/50"
                          >
                            <td className="p-3 font-medium">{report.id}</td>
                            <td className="p-3">
                              {report.periodStart} to {report.periodEnd}
                            </td>
                            <td className="p-3 text-right font-semibold">
                              {formatSAR(report.collectedAmount)}
                            </td>
                            <td className="p-3">
                              <span
                                className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                                  report.status === "finalized"
                                    ? "bg-green-100 text-green-700"
                                    : "bg-yellow-100 text-yellow-700"
                                }`}
                              >
                                {report.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground py-8">
                    No monthly financial activity found.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Deferred Revenue Detail */}
        {activeTab === "route" && (
          <Card>
            <CardHeader>
              <CardTitle>
                {t(
                  "revenueAccounting.upcomingBookings",
                  "Upcoming paid bookings"
                )}
              </CardTitle>
              <CardDescription>
                {t(
                  "revenueAccounting.upcomingGrossBasis",
                  "Gross value of confirmed, paid bookings by primary flight departure."
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {deferredLoading ? (
                <Skeleton className="h-[200px] w-full" />
              ) : deferredData && deferredData.items.length > 0 ? (
                <div className="space-y-4">
                  <div className="text-center p-3 bg-muted/50 rounded-lg">
                    <p className="text-sm text-muted-foreground">
                      {t(
                        "revenueAccounting.upcomingGross",
                        "Upcoming booking gross value"
                      )}
                    </p>
                    <p className="text-2xl font-bold">
                      {formatSAR(deferredData.upcomingBookingGross)} SAR
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {deferredData.items.length}{" "}
                      {t("revenueAccounting.bookings", "Bookings")}
                    </p>
                  </div>
                  <div className="overflow-auto max-h-[300px]">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-background">
                        <tr className="border-b">
                          <th className="text-left p-2 font-medium">Ref</th>
                          <th className="text-left p-2 font-medium">Flight</th>
                          <th className="text-left p-2 font-medium">
                            Departure
                          </th>
                          <th className="text-left p-2 font-medium">Class</th>
                          <th className="text-right p-2 font-medium">Pax</th>
                          <th className="text-right p-2 font-medium">
                            Amount (SAR)
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {deferredData.items.slice(0, 50).map(item => (
                          <tr
                            key={item.bookingId}
                            className="border-b hover:bg-muted/50"
                          >
                            <td className="p-2 font-mono text-xs">
                              {item.bookingReference}
                            </td>
                            <td className="p-2">{item.flightNumber}</td>
                            <td className="p-2">{item.departureDate}</td>
                            <td className="p-2 capitalize">
                              {item.cabinClass}
                            </td>
                            <td className="p-2 text-right">
                              {item.passengerCount}
                            </td>
                            <td className="p-2 text-right font-semibold">
                              {formatSAR(item.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <p className="text-center text-muted-foreground py-4">
                  {t(
                    "revenueAccounting.noUpcoming",
                    "No upcoming paid bookings."
                  )}
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

export default RevenueAccounting;
