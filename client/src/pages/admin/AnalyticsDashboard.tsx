import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
          <h1 className="text-3xl font-bold">لوحة التحليلات</h1>
          <p className="text-muted-foreground">نظرة شاملة على أداء النظام</p>
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
              إجمالي الحجوزات
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
                  {kpis?.totalPassengers.toLocaleString()} راكب
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              إجمالي الإيرادات
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {kpisLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {((kpis?.totalRevenue || 0) / 100).toLocaleString()} ر.س
                </div>
                <p className="text-xs text-muted-foreground">
                  متوسط:{" "}
                  {kpis?.totalBookings
                    ? Math.round(kpis.totalRevenue / kpis.totalBookings / 100)
                    : 0}{" "}
                  ر.س
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">معدل الإشغال</CardTitle>
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
                    ? "أداء ممتاز"
                    : "يمكن التحسين"}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">معدل الإلغاء</CardTitle>
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
                  {kpis && kpis.cancellationRate < 10 ? "منخفض" : "مرتفع"}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">إجمالي الركاب</CardTitle>
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
                  متوسط:{" "}
                  {kpis?.totalBookings
                    ? Math.round(
                        (kpis.totalPassengers / kpis.totalBookings) * 10
                      ) / 10
                    : 0}{" "}
                  راكب/حجز
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
            <CardTitle>الإيرادات اليومية</CardTitle>
            <CardDescription>آخر 30 يوم</CardDescription>
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
                      `${value.toLocaleString()} ر.س`
                    }
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="revenue"
                    stroke="#3b82f6"
                    name="الإيرادات (ر.س)"
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
            <CardTitle>اتجاهات الحجوزات</CardTitle>
            <CardDescription>آخر 30 يوم</CardDescription>
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
                  <Bar dataKey="bookings" fill="#10b981" name="الحجوزات" />
                  <Bar dataKey="passengers" fill="#3b82f6" name="الركاب" />
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
            <CardTitle>أكثر الوجهات طلباً</CardTitle>
            <CardDescription>أعلى 10 وجهات</CardDescription>
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
            <CardTitle>معدل إشغال الرحلات</CardTitle>
            <CardDescription>أعلى 20 رحلة</CardDescription>
          </CardHeader>
          <CardContent>
            {occupancyLoading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : (
              <div className="overflow-auto max-h-[300px]">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background">
                    <tr className="border-b">
                      <th className="text-right p-2">رقم الرحلة</th>
                      <th className="text-right p-2">الإشغال</th>
                      <th className="text-right p-2">المقاعد</th>
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
