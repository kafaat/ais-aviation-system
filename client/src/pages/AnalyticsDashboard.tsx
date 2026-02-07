import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  ChevronLeft,
  TrendingUp,
  Users,
  DollarSign,
  XCircle,
  Package,
  ShoppingBag,
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

export default function AnalyticsDashboard() {
  const { user, isAuthenticated } = useAuth();

  const { data: kpis, isLoading: loadingKPIs } =
    trpc.analytics.getKPIs.useQuery();
  const { data: revenueData, isLoading: loadingRevenue } =
    trpc.analytics.getRevenueOverTime.useQuery({ days: 30 });
  const { data: popularDestinations, isLoading: loadingDestinations } =
    trpc.analytics.getPopularDestinations.useQuery({ limit: 5 });
  const { data: bookingTrends, isLoading: loadingTrends } =
    trpc.analytics.getBookingTrends.useQuery({ days: 30 });

  // Ancillary Analytics
  const { data: ancillaryMetrics, isLoading: loadingAncillaryMetrics } =
    trpc.analytics.getAncillaryMetrics.useQuery();
  const { data: ancillaryByCategory, isLoading: loadingAncillaryCategory } =
    trpc.analytics.getAncillaryRevenueByCategory.useQuery();
  const { data: popularAncillaries, isLoading: loadingPopularAncillaries } =
    trpc.analytics.getPopularAncillaries.useQuery({ limit: 5 });

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Card className="p-8 text-center max-w-md">
          <h2 className="text-2xl font-bold mb-4">يرجى تسجيل الدخول</h2>
          <Button asChild className="w-full">
            <a href="/login">تسجيل الدخول</a>
          </Button>
        </Card>
      </div>
    );
  }

  if (user?.role !== "admin") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Card className="p-8 text-center max-w-md">
          <h2 className="text-2xl font-bold mb-4">غير مصرح</h2>
          <p className="text-muted-foreground mb-6">
            ليس لديك صلاحيات الوصول لهذه الصفحة
          </p>
          <Button asChild>
            <Link href="/">
              <a>العودة للرئيسية</a>
            </Link>
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="container py-4">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="icon">
                <ChevronLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold">لوحة التحليلات</h1>
              <p className="text-sm text-muted-foreground">
                مؤشرات الأداء والتقارير
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="container py-8 space-y-8">
        {/* Main KPIs */}
        <div>
          <h2 className="text-lg font-semibold mb-4">مؤشرات الأداء الرئيسية</h2>
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
                      إجمالي الحجوزات
                    </p>
                    <Users className="h-5 w-5 text-blue-500" />
                  </div>
                  <p className="text-3xl font-bold">
                    {kpis?.totalBookings || 0}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {kpis?.totalPassengers || 0} راكب
                  </p>
                </Card>

                <Card className="p-6">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm text-muted-foreground">
                      إجمالي الإيرادات
                    </p>
                    <DollarSign className="h-5 w-5 text-green-500" />
                  </div>
                  <p className="text-3xl font-bold">
                    {((kpis?.totalRevenue || 0) / 100).toFixed(0)} ر.س
                  </p>
                </Card>

                <Card className="p-6">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm text-muted-foreground">
                      معدل الإشغال
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
                      معدل الإلغاء
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
            مؤشرات الخدمات الإضافية
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
                <Card className="p-6 bg-blue-50 border-blue-200">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm text-blue-900 font-medium">
                      إيرادات الخدمات
                    </p>
                    <ShoppingBag className="h-5 w-5 text-blue-600" />
                  </div>
                  <p className="text-3xl font-bold text-blue-900">
                    {(
                      (ancillaryMetrics?.totalAncillaryRevenue || 0) / 100
                    ).toFixed(0)}{" "}
                    ر.س
                  </p>
                </Card>

                <Card className="p-6 bg-purple-50 border-purple-200">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm text-purple-900 font-medium">
                      معدل الإرفاق
                    </p>
                    <Package className="h-5 w-5 text-purple-600" />
                  </div>
                  <p className="text-3xl font-bold text-purple-900">
                    {ancillaryMetrics?.ancillaryAttachmentRate || 0}%
                  </p>
                  <p className="text-xs text-purple-700 mt-1">
                    من الحجوزات تحتوي على خدمات
                  </p>
                </Card>

                <Card className="p-6 bg-green-50 border-green-200">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm text-green-900 font-medium">
                      متوسط الإيراد
                    </p>
                    <DollarSign className="h-5 w-5 text-green-600" />
                  </div>
                  <p className="text-3xl font-bold text-green-900">
                    {(
                      (ancillaryMetrics?.averageAncillaryRevenuePerBooking ||
                        0) / 100
                    ).toFixed(0)}{" "}
                    ر.س
                  </p>
                  <p className="text-xs text-green-700 mt-1">لكل حجز</p>
                </Card>

                <Card className="p-6 bg-orange-50 border-orange-200">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm text-orange-900 font-medium">
                      إجمالي المبيعات
                    </p>
                    <TrendingUp className="h-5 w-5 text-orange-600" />
                  </div>
                  <p className="text-3xl font-bold text-orange-900">
                    {ancillaryMetrics?.totalAncillariesSold || 0}
                  </p>
                  <p className="text-xs text-orange-700 mt-1">خدمة مباعة</p>
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
              الإيرادات خلال آخر 30 يوم
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
                    name="الإيرادات"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </Card>

          {/* Booking Trends */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">اتجاهات الحجز</h3>
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
                  <Bar dataKey="bookings" fill="#8b5cf6" name="الحجوزات" />
                  <Bar dataKey="passengers" fill="#ec4899" name="الركاب" />
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
              إيرادات الخدمات حسب الفئة
            </h3>
            {loadingAncillaryCategory ? (
              <Skeleton className="h-64" />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={ancillaryByCategory?.map(item => ({
                      name: categoryNames[item.category] || item.category,
                      value: item.revenue / 100,
                    }))}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={entry =>
                      `${entry.name}: ${entry.value.toFixed(0)} ر.س`
                    }
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {ancillaryByCategory?.map((entry, index) => (
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
          </Card>

          {/* Popular Destinations */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">أشهر الوجهات</h3>
            {loadingDestinations ? (
              <Skeleton className="h-64" />
            ) : (
              <div className="space-y-3">
                {popularDestinations?.map((dest, index) => (
                  <div
                    key={dest.airportCode}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
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
                      <p className="font-semibold">{dest.bookingCount} حجز</p>
                      <p className="text-sm text-muted-foreground">
                        {(dest.revenue / 100).toFixed(0)} ر.س
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
          <h3 className="text-lg font-semibold mb-4">أشهر الخدمات الإضافية</h3>
          {loadingPopularAncillaries ? (
            <Skeleton className="h-48" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {popularAncillaries?.map((ancillary, index) => (
                <div
                  key={index}
                  className="p-4 border rounded-lg bg-gradient-to-br from-blue-50 to-purple-50"
                >
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold text-gray-900">
                      {ancillary.serviceName}
                    </h4>
                    <Package className="h-5 w-5 text-blue-600" />
                  </div>
                  <p className="text-sm text-gray-600 mb-2">
                    {categoryNames[ancillary.category] || ancillary.category}
                  </p>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">
                      المبيعات: {ancillary.totalSold}
                    </span>
                    <span className="text-sm font-semibold text-blue-900">
                      {(ancillary.revenue / 100).toFixed(0)} ر.س
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
