import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AnalyticsSkeleton } from "@/components/skeletons";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { TrendingUp, Users, DollarSign, XCircle, Plane } from "lucide-react";
import { ExportReportButton } from "@/components/ExportReportButton";
import { format, subDays } from "date-fns";

const COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
];

export default function AnalyticsDashboard() {
  const { t } = useTranslation();
  const { data: kpis, isLoading: kpisLoading } =
    trpc.analytics.getKPIs.useQuery();
  const { data: revenueData, isLoading: revenueLoading } =
    trpc.analytics.getRevenueOverTime.useQuery({ days: 30 });
  const { data: popularDestinations, isLoading: destinationsLoading } =
    trpc.analytics.getPopularDestinations.useQuery({ limit: 10 });
  const { data: bookingTrends, isLoading: trendsLoading } =
    trpc.analytics.getBookingTrends.useQuery({ days: 30 });
  const { data: flightOccupancy, isLoading: occupancyLoading } =
    trpc.analytics.getFlightOccupancy.useQuery();

  // Default date filters for export (last 30 days)
  const exportFilters = {
    startDate: format(subDays(new Date(), 30), "yyyy-MM-dd"),
    endDate: format(new Date(), "yyyy-MM-dd"),
  };

  return (
    <div className="container py-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("admin.analytics.title")}</h1>
          <p className="text-muted-foreground">
            {t("admin.analytics.subtitle")}
          </p>
        </div>
        <div className="flex gap-2">
          <ExportReportButton
            reportType="bookings"
            filters={exportFilters}
            variant="outline"
          />
          <ExportReportButton
            reportType="revenue"
            filters={exportFilters}
            variant="outline"
          />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("admin.analytics.totalBookings")}
            </CardTitle>
            <Plane className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {kpisLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {kpis?.totalBookings.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground">
                  {kpis?.totalPassengers.toLocaleString()}{" "}
                  {t("admin.analytics.passenger")}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("admin.analytics.totalRevenue")}
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {kpisLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {((kpis?.totalRevenue || 0) / 100).toLocaleString()}{" "}
                  {t("common.sar")}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("admin.analytics.average")}:{" "}
                  {kpis?.totalBookings
                    ? Math.round(kpis.totalRevenue / kpis.totalBookings / 100)
                    : 0}{" "}
                  {t("common.sar")}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("admin.analytics.occupancyRate")}
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {kpisLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {kpis?.averageOccupancyRate}%
                </div>
                <p className="text-xs text-muted-foreground">
                  {kpis && kpis.averageOccupancyRate > 70
                    ? t("admin.analytics.excellentPerformance")
                    : t("admin.analytics.canImprove")}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("admin.analytics.cancellationRate")}
            </CardTitle>
            <XCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {kpisLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {kpis?.cancellationRate}%
                </div>
                <p className="text-xs text-muted-foreground">
                  {kpis && kpis.cancellationRate < 10
                    ? t("admin.analytics.low")
                    : t("admin.analytics.high")}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("admin.analytics.totalPassengers")}
            </CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {kpisLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {kpis?.totalPassengers.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("admin.analytics.average")}:{" "}
                  {kpis?.totalBookings
                    ? Math.round(
                        (kpis.totalPassengers / kpis.totalBookings) * 10
                      ) / 10
                    : 0}{" "}
                  {t("admin.analytics.passengerPerBooking")}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 1 */}
      <div className="grid gap-4 md:grid-cols-2 mb-8">
        {/* Revenue Chart */}
        <Card>
          <CardHeader>
            <CardTitle>{t("admin.analytics.dailyRevenue")}</CardTitle>
            <CardDescription>{t("admin.analytics.last30Days")}</CardDescription>
          </CardHeader>
          <CardContent>
            {revenueLoading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart
                  data={revenueData?.map(d => ({
                    ...d,
                    revenue: d.revenue / 100,
                  }))}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(value: number) =>
                      `${value.toLocaleString()} ${t("common.sar")}`
                    }
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="#3b82f6"
                    name={t("admin.analytics.revenueLabel")}
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Booking Trends Chart */}
        <Card>
          <CardHeader>
            <CardTitle>{t("admin.analytics.bookingTrends")}</CardTitle>
            <CardDescription>{t("admin.analytics.last30Days")}</CardDescription>
          </CardHeader>
          <CardContent>
            {trendsLoading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={bookingTrends}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Bar
                    dataKey="bookings"
                    fill="#10b981"
                    name={t("admin.analytics.bookings")}
                  />
                  <Bar
                    dataKey="passengers"
                    fill="#3b82f6"
                    name={t("admin.analytics.passengers")}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2 */}
      <div className="grid gap-4 md:grid-cols-2 mb-8">
        {/* Popular Destinations */}
        <Card>
          <CardHeader>
            <CardTitle>{t("admin.analytics.popularDestinations")}</CardTitle>
            <CardDescription>
              {t("admin.analytics.top10Destinations")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {destinationsLoading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={popularDestinations}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={entry => `${entry.city} (${entry.bookingCount})`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="bookingCount"
                  >
                    {popularDestinations?.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={COLORS[index % COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Flight Occupancy Table */}
        <Card>
          <CardHeader>
            <CardTitle>{t("admin.analytics.flightOccupancy")}</CardTitle>
            <CardDescription>
              {t("admin.analytics.top20Flights")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {occupancyLoading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : (
              <div className="overflow-auto max-h-[300px]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background">
                    <tr className="border-b">
                      <th className="text-end p-2">
                        {t("admin.analytics.flightNumber")}
                      </th>
                      <th className="text-end p-2">
                        {t("admin.analytics.occupancy")}
                      </th>
                      <th className="text-end p-2">
                        {t("admin.analytics.seats")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {flightOccupancy?.map((flight: any) => (
                      <tr key={flight.flightId} className="border-b">
                        <td className="p-2">{flight.flightNumber}</td>
                        <td className="p-2">
                          <span
                            className={`font-semibold ${
                              flight.occupancyRate > 80
                                ? "text-green-600"
                                : flight.occupancyRate > 50
                                  ? "text-yellow-600"
                                  : "text-red-600"
                            }`}
                          >
                            {flight.occupancyRate}%
                          </span>
                        </td>
                        <td className="p-2">
                          {flight.bookedSeats}/{flight.totalSeats}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
