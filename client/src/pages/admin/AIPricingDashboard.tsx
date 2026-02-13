import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
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
import {
  Brain,
  TrendingUp,
  Users,
  FlaskConical,
  DollarSign,
  Activity,
  BarChart3,
  Target,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Power,
} from "lucide-react";

const COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
];

export default function AIPricingDashboard() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === "ar";
  const [forecastFlightId, setForecastFlightId] = useState("");
  const [forecastCabin, setForecastCabin] = useState<"economy" | "business">(
    "economy"
  );

  // Dashboard data
  const { data: dashboard, isLoading: dashboardLoading } =
    trpc.aiPricing.getDashboard.useQuery();

  // Demand forecast (on-demand)
  const {
    data: forecast,
    isLoading: forecastLoading,
    refetch: refetchForecast,
  } = trpc.aiPricing.forecastDemand.useQuery(
    {
      flightId: parseInt(forecastFlightId) || 0,
      cabinClass: forecastCabin,
      horizonDays: 14,
    },
    { enabled: false }
  );

  // Segments
  const { data: segments, isLoading: segmentsLoading } =
    trpc.aiPricing.getSegments.useQuery();

  // A/B Tests
  const { data: abTests, isLoading: testsLoading } =
    trpc.aiPricing.getABTests.useQuery({});

  // Toggle AI pricing
  const toggleMutation = trpc.aiPricing.setEnabled.useMutation();

  const formatPrice = (price: number) => {
    return (price / 100).toLocaleString(isRTL ? "ar-SA" : "en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  };

  const handleForecast = () => {
    if (forecastFlightId) {
      refetchForecast();
    }
  };

  return (
    <div className="container py-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Brain className="h-8 w-8 text-primary" />
            {t("admin.aiPricing.title")}
          </h1>
          <p className="text-muted-foreground">
            {t("admin.aiPricing.subtitle")}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => toggleMutation.mutate({ enabled: true })}
          disabled={toggleMutation.isPending}
        >
          <Power className="mr-2 h-4 w-4" />
          {t("admin.aiPricing.toggleEnabled")}
        </Button>
      </div>

      {/* Revenue Metrics Cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {dashboardLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-32" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">
                  {t("admin.aiPricing.totalRevenue")}
                </CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatPrice(
                    dashboard?.data?.revenueMetrics?.totalRevenue || 0
                  )}{" "}
                  {t("common.sar")}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("admin.aiPricing.last30Days")}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">
                  {t("admin.aiPricing.avgYield")}
                </CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatPrice(dashboard?.data?.revenueMetrics?.avgYield || 0)}{" "}
                  {t("common.sar")}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("admin.aiPricing.perPassenger")}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">
                  {t("admin.aiPricing.loadFactor")}
                </CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {(
                    (dashboard?.data?.revenueMetrics?.loadFactor || 0) * 100
                  ).toFixed(1)}
                  %
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("admin.aiPricing.seatUtilization")}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">
                  {t("admin.aiPricing.aiImpact")}
                </CardTitle>
                <Brain className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatPrice(
                    dashboard?.data?.revenueMetrics?.optimizationImpact || 0
                  )}{" "}
                  {t("common.sar")}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("admin.aiPricing.revenueOptimization")}
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Demand Forecasting Section */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              {t("admin.aiPricing.demandForecast")}
            </CardTitle>
            <CardDescription>
              {t("admin.aiPricing.demandForecastDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex gap-4">
              <Input
                type="number"
                placeholder={t("admin.aiPricing.flightIdPlaceholder")}
                value={forecastFlightId}
                onChange={e => setForecastFlightId(e.target.value)}
                className="w-40"
              />
              <select
                value={forecastCabin}
                onChange={e =>
                  setForecastCabin(e.target.value as "economy" | "business")
                }
                className="rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="economy">{t("admin.aiPricing.economy")}</option>
                <option value="business">
                  {t("admin.aiPricing.business")}
                </option>
              </select>
              <Button
                onClick={handleForecast}
                disabled={!forecastFlightId || forecastLoading}
              >
                {forecastLoading
                  ? t("common.loading")
                  : t("admin.aiPricing.generateForecast")}
              </Button>
            </div>

            {forecast?.data && forecast.data.length > 0 ? (
              <ResponsiveContainer width="100%" height={350}>
                <LineChart data={forecast.data}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={v =>
                      new Date(v).toLocaleDateString(
                        isRTL ? "ar-SA" : "en-US",
                        { month: "short", day: "numeric" }
                      )
                    }
                  />
                  <YAxis yAxisId="demand" orientation="left" />
                  <YAxis
                    yAxisId="price"
                    orientation="right"
                    tickFormatter={v => formatPrice(v as number)}
                  />
                  <Tooltip
                    labelFormatter={v =>
                      new Date(v).toLocaleDateString(isRTL ? "ar-SA" : "en-US")
                    }
                  />
                  <Legend />
                  <Line
                    yAxisId="demand"
                    type="monotone"
                    dataKey="predictedDemand"
                    stroke="#3b82f6"
                    name={t("admin.aiPricing.predictedDemand")}
                    strokeWidth={2}
                  />
                  <Line
                    yAxisId="demand"
                    type="monotone"
                    dataKey="confidenceLower"
                    stroke="#93c5fd"
                    strokeDasharray="5 5"
                    name={t("admin.aiPricing.confidenceLower")}
                  />
                  <Line
                    yAxisId="demand"
                    type="monotone"
                    dataKey="confidenceUpper"
                    stroke="#93c5fd"
                    strokeDasharray="5 5"
                    name={t("admin.aiPricing.confidenceUpper")}
                  />
                  <Line
                    yAxisId="price"
                    type="monotone"
                    dataKey="recommendedPrice"
                    stroke="#10b981"
                    name={t("admin.aiPricing.recommendedPrice")}
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-48 items-center justify-center text-muted-foreground">
                {t("admin.aiPricing.enterFlightId")}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Customer Segments */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              {t("admin.aiPricing.customerSegments")}
            </CardTitle>
            <CardDescription>
              {t("admin.aiPricing.customerSegmentsDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {segmentsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : segments?.data && segments.data.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={segments.data.map(s => ({
                        name: s.name,
                        value: s.memberCount,
                      }))}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {segments.data.map((_s, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-4 space-y-2">
                  {segments.data.map(seg => (
                    <div
                      key={seg.id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div>
                        <p className="font-medium">{seg.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {seg.memberCount} {t("admin.aiPricing.members")} |{" "}
                          {t("admin.aiPricing.multiplier")}:{" "}
                          {seg.priceMultiplier.toFixed(2)}x
                        </p>
                      </div>
                      <Badge variant={seg.isActive ? "default" : "secondary"}>
                        {seg.segmentType}
                      </Badge>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex h-48 items-center justify-center text-muted-foreground">
                {t("admin.aiPricing.noSegments")}
              </div>
            )}
          </CardContent>
        </Card>

        {/* A/B Tests */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5" />
              {t("admin.aiPricing.abTests")}
            </CardTitle>
            <CardDescription>
              {t("admin.aiPricing.abTestsDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {testsLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : abTests?.data && abTests.data.length > 0 ? (
              <div className="space-y-3">
                {abTests.data.map(test => (
                  <div key={test.id} className="rounded-lg border p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="font-medium">{test.name}</p>
                      <Badge
                        variant={
                          test.status === "running"
                            ? "default"
                            : test.status === "completed"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {t(`admin.aiPricing.testStatus.${test.status}`)}
                      </Badge>
                    </div>
                    <div className="space-y-1">
                      {test.variants.map((v, vi) => {
                        const convRate =
                          v.metrics.impressions > 0
                            ? (
                                (v.metrics.conversions /
                                  v.metrics.impressions) *
                                100
                              ).toFixed(1)
                            : "0.0";
                        return (
                          <div
                            key={vi}
                            className="flex items-center justify-between text-sm"
                          >
                            <span className="text-muted-foreground">
                              {v.name}
                            </span>
                            <span>
                              {v.metrics.impressions}{" "}
                              {t("admin.aiPricing.impressions")} | {convRate}%{" "}
                              {t("admin.aiPricing.convRate")}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-48 items-center justify-center text-muted-foreground">
                {t("admin.aiPricing.noTests")}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Revenue Optimization Recommendations */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              {t("admin.aiPricing.revenueOptimization")}
            </CardTitle>
            <CardDescription>
              {t("admin.aiPricing.revenueOptDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {dashboard?.data?.recentOptimizations &&
            dashboard.data.recentOptimizations.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="px-4 py-2 text-left font-medium">
                        {t("admin.aiPricing.flightId")}
                      </th>
                      <th className="px-4 py-2 text-left font-medium">
                        {t("admin.aiPricing.cabin")}
                      </th>
                      <th className="px-4 py-2 text-left font-medium">
                        {t("admin.aiPricing.recommendation")}
                      </th>
                      <th className="px-4 py-2 text-left font-medium">
                        {t("admin.aiPricing.priceChange")}
                      </th>
                      <th className="px-4 py-2 text-left font-medium">
                        {t("admin.aiPricing.status")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.data.recentOptimizations.map((opt, i) => (
                      <tr key={i} className="border-b">
                        <td className="px-4 py-2">{opt.flightId}</td>
                        <td className="px-4 py-2">{opt.cabinClass}</td>
                        <td className="px-4 py-2">
                          <span className="flex items-center gap-1">
                            {opt.recommendation === "increase" ? (
                              <ArrowUpRight className="h-4 w-4 text-green-500" />
                            ) : opt.recommendation === "decrease" ? (
                              <ArrowDownRight className="h-4 w-4 text-red-500" />
                            ) : (
                              <Minus className="h-4 w-4 text-gray-400" />
                            )}
                            {t(`admin.aiPricing.rec.${opt.recommendation}`)}
                          </span>
                        </td>
                        <td className="px-4 py-2">
                          {opt.priceChange > 0 ? "+" : ""}
                          {opt.priceChange.toFixed(1)}%
                        </td>
                        <td className="px-4 py-2">
                          <Badge variant="outline">{opt.status}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex h-32 items-center justify-center text-muted-foreground">
                {t("admin.aiPricing.noOptimizations")}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
