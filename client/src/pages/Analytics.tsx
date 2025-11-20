import { useAuth } from "@/_core/hooks/useAuth";
import { KPICard } from "@/components/KPICard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import {
  DollarSign,
  TrendingUp,
  Users,
  Calendar,
  MapPin,
  Plane,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
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

const COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4"];

export default function Analytics() {
  const { user, loading } = useAuth();
  const { t } = useTranslation();

  const { data: overview, isLoading: overviewLoading } = trpc.analytics.overview.useQuery();
  const { data: dailyBookings, isLoading: dailyLoading } = trpc.analytics.dailyBookings.useQuery();
  const { data: topDestinations, isLoading: destLoading } = trpc.analytics.topDestinations.useQuery();
  const { data: airlinePerformance, isLoading: airlineLoading } = trpc.analytics.airlinePerformance.useQuery();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const [, setLocation] = useLocation();

  if (!user || user.role !== "admin") {
    setLocation("/");
    return null;
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "SAR",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount / 100);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">{t("analytics.title")}</h1>
          <p className="text-muted-foreground mt-2">{t("analytics.subtitle")}</p>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <KPICard
            title={t("analytics.totalRevenue")}
            value={overview ? formatCurrency(overview.totalRevenue) : "-"}
            icon={DollarSign}
            color="green"
            subtitle={t("analytics.allTime")}
          />
          <KPICard
            title={t("analytics.totalBookings")}
            value={overview?.totalBookings || 0}
            icon={Users}
            color="blue"
            subtitle={t("analytics.allTime")}
          />
          <KPICard
            title={t("analytics.todayBookings")}
            value={overview?.todayBookings || 0}
            icon={Calendar}
            color="purple"
            subtitle={t("analytics.today")}
          />
          <KPICard
            title={t("analytics.avgBookingValue")}
            value={overview ? formatCurrency(overview.avgBookingValue) : "-"}
            icon={TrendingUp}
            color="orange"
            subtitle={t("analytics.perBooking")}
          />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Daily Bookings Chart */}
          <Card>
            <CardHeader>
              <CardTitle>{t("analytics.dailyBookings")}</CardTitle>
            </CardHeader>
            <CardContent>
              {dailyLoading ? (
                <div className="h-[300px] flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={dailyBookings}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="bookings"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      name={t("analytics.bookings")}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Daily Revenue Chart */}
          <Card>
            <CardHeader>
              <CardTitle>{t("analytics.dailyRevenue")}</CardTitle>
            </CardHeader>
            <CardContent>
              {dailyLoading ? (
                <div className="h-[300px] flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={dailyBookings}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar
                      dataKey="revenue"
                      fill="#10b981"
                      name={t("analytics.revenue")}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Top Destinations */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                {t("analytics.topDestinations")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {destLoading ? (
                <div className="h-[300px] flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={topDestinations}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ destination, count }) => `${destination} (${count})`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="count"
                    >
                      {topDestinations?.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Airline Performance */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plane className="h-5 w-5" />
                {t("analytics.airlinePerformance")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {airlineLoading ? (
                <div className="h-[300px] flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={airlinePerformance} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" />
                    <YAxis dataKey="airline" type="category" width={150} />
                    <Tooltip />
                    <Legend />
                    <Bar
                      dataKey="bookings"
                      fill="#3b82f6"
                      name={t("analytics.bookings")}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
