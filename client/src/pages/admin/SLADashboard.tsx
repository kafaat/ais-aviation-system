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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock,
  FileText,
  RefreshCw,
  Server,
  Shield,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { format, subDays, subHours } from "date-fns";

// ============================================================================
// Helper Components
// ============================================================================

function StatusIndicator({
  status,
}: {
  status: "healthy" | "degraded" | "unhealthy";
}) {
  const config = {
    healthy: {
      color: "bg-green-500",
      pulse: "animate-pulse",
      label: "Healthy",
    },
    degraded: {
      color: "bg-yellow-500",
      pulse: "animate-pulse",
      label: "Degraded",
    },
    unhealthy: {
      color: "bg-red-500",
      pulse: "animate-pulse",
      label: "Unhealthy",
    },
  };

  const c = config[status];

  return (
    <div className="flex items-center gap-2">
      <div className={`h-3 w-3 rounded-full ${c.color} ${c.pulse}`} />
      <span
        className={`text-sm font-medium ${
          status === "healthy"
            ? "text-green-700 dark:text-green-400"
            : status === "degraded"
              ? "text-yellow-700 dark:text-yellow-400"
              : "text-red-700 dark:text-red-400"
        }`}
      >
        {c.label}
      </span>
    </div>
  );
}

function UptimeDisplay({ value }: { value: number }) {
  const color =
    value >= 99.9
      ? "text-green-600 dark:text-green-400"
      : value >= 99.0
        ? "text-yellow-600 dark:text-yellow-400"
        : "text-red-600 dark:text-red-400";

  return (
    <div className="text-center">
      <div className={`text-4xl font-bold tabular-nums ${color}`}>
        {value.toFixed(2)}%
      </div>
      <p className="text-sm text-muted-foreground mt-1">Uptime</p>
    </div>
  );
}

function ResponseTimeGauge({
  label,
  value,
  target,
}: {
  label: string;
  value: number;
  target: number;
}) {
  const ratio = Math.min(value / (target * 2), 1);
  const percentage = ratio * 100;
  const isGood = value <= target;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span
          className={`font-mono font-semibold ${
            isGood
              ? "text-green-600 dark:text-green-400"
              : "text-red-600 dark:text-red-400"
          }`}
        >
          {Math.round(value)}ms
        </span>
      </div>
      <Progress
        value={percentage}
        className={`h-2 ${
          isGood
            ? "[&>[data-slot=indicator]]:bg-green-500"
            : "[&>[data-slot=indicator]]:bg-red-500"
        }`}
      />
      <p className="text-xs text-muted-foreground">Target: {target}ms</p>
    </div>
  );
}

function SeverityBadge({
  severity,
}: {
  severity: "warning" | "critical" | "resolved";
}) {
  if (severity === "critical") {
    return <Badge variant="destructive">Critical</Badge>;
  }
  if (severity === "warning") {
    return (
      <Badge className="bg-yellow-500 text-white border-transparent">
        Warning
      </Badge>
    );
  }
  return (
    <Badge className="bg-green-500 text-white border-transparent">
      Resolved
    </Badge>
  );
}

function AlertStatusBadge({
  status,
}: {
  status: "active" | "acknowledged" | "resolved";
}) {
  if (status === "active") {
    return <Badge variant="destructive">Active</Badge>;
  }
  if (status === "acknowledged") {
    return <Badge variant="secondary">Acknowledged</Badge>;
  }
  return <Badge variant="outline">Resolved</Badge>;
}

// ============================================================================
// Main Dashboard Component
// ============================================================================

export function SLADashboard() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("overview");
  const [reportDays, setReportDays] = useState("7");

  // Queries
  const {
    data: dashboard,
    isLoading: dashboardLoading,
    refetch: refetchDashboard,
  } = trpc.sla.getSLADashboard.useQuery(undefined, {
    refetchInterval: 30000, // Auto-refresh every 30 seconds
  });

  const { data: alerts, isLoading: alertsLoading } =
    trpc.sla.getAlerts.useQuery(
      {
        startDate: subDays(new Date(), 7).toISOString(),
        endDate: new Date().toISOString(),
      },
      {
        refetchInterval: 15000,
      }
    );

  const { data: targets, isLoading: targetsLoading } =
    trpc.sla.getTargets.useQuery({ activeOnly: true });

  const { data: reports, isLoading: reportsLoading } =
    trpc.sla.getReports.useQuery();

  // Mutations
  const acknowledgeAlertMutation = trpc.sla.acknowledgeAlert.useMutation({
    onSuccess: data => {
      if (data.success) {
        toast.success(t("sla.alertAcknowledged", "Alert acknowledged"));
        refetchDashboard();
      } else {
        toast.error(data.message || "Failed to acknowledge alert");
      }
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const generateReportMutation = trpc.sla.generateReport.useMutation({
    onSuccess: data => {
      if (data.success) {
        toast.success(
          t("sla.reportGenerated", "SLA report generated successfully")
        );
      }
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const handleGenerateReport = () => {
    const days = parseInt(reportDays, 10);
    generateReportMutation.mutate({
      startDate: subDays(new Date(), days).toISOString(),
      endDate: new Date().toISOString(),
    });
  };

  const systemHealth = dashboard?.systemHealth;
  const complianceHistory = dashboard?.complianceHistory ?? [];
  const serviceBreakdown = dashboard?.serviceBreakdown ?? [];

  return (
    <div className="container py-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">
            {t("sla.title", "SLA Monitoring")}
          </h1>
          <p className="text-muted-foreground">
            {t(
              "sla.subtitle",
              "Service level agreement compliance and system health monitoring"
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetchDashboard()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          {t("sla.refresh", "Refresh")}
        </Button>
      </div>

      {/* System Health Overview Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5 mb-8">
        {/* Overall Status */}
        <Card className="shadow-sm rounded-xl">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("sla.systemStatus", "System Status")}
            </CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {dashboardLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <StatusIndicator
                status={systemHealth?.overallStatus ?? "healthy"}
              />
            )}
          </CardContent>
        </Card>

        {/* Uptime */}
        <Card className="shadow-sm rounded-xl">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("sla.averageUptime", "Average Uptime")}
            </CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {dashboardLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold tabular-nums">
                {(systemHealth?.uptimeAverage ?? 100).toFixed(2)}%
              </div>
            )}
          </CardContent>
        </Card>

        {/* SLA Compliance */}
        <Card className="shadow-sm rounded-xl">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("sla.overallCompliance", "SLA Compliance")}
            </CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {dashboardLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div
                className={`text-2xl font-bold ${
                  (systemHealth?.slaCompliance ?? 100) >= 100
                    ? "text-green-600 dark:text-green-400"
                    : (systemHealth?.slaCompliance ?? 0) >= 75
                      ? "text-yellow-600 dark:text-yellow-400"
                      : "text-red-600 dark:text-red-400"
                }`}
              >
                {(systemHealth?.slaCompliance ?? 100).toFixed(1)}%
              </div>
            )}
          </CardContent>
        </Card>

        {/* Active Alerts */}
        <Card className="shadow-sm rounded-xl">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("sla.activeAlerts", "Active Alerts")}
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {dashboardLoading ? (
              <Skeleton className="h-8 w-12" />
            ) : (
              <div
                className={`text-2xl font-bold ${
                  (systemHealth?.activeAlerts ?? 0) === 0
                    ? "text-green-600 dark:text-green-400"
                    : "text-red-600 dark:text-red-400"
                }`}
              >
                {systemHealth?.activeAlerts ?? 0}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Services Monitored */}
        <Card className="shadow-sm rounded-xl">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("sla.services", "Services")}
            </CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {dashboardLoading ? (
              <Skeleton className="h-8 w-12" />
            ) : (
              <div className="text-2xl font-bold">
                {systemHealth?.services?.length ?? 0}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="overview">
            {t("sla.tabs.overview", "Overview")}
          </TabsTrigger>
          <TabsTrigger value="services">
            {t("sla.tabs.services", "Services")}
          </TabsTrigger>
          <TabsTrigger value="alerts">
            {t("sla.tabs.alerts", "Alerts")}
          </TabsTrigger>
          <TabsTrigger value="targets">
            {t("sla.tabs.targets", "SLA Targets")}
          </TabsTrigger>
          <TabsTrigger value="reports">
            {t("sla.tabs.reports", "Reports")}
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview">
          <div className="grid gap-4 md:grid-cols-2 mb-8">
            {/* Uptime Display */}
            <Card className="shadow-sm rounded-xl">
              <CardHeader>
                <CardTitle>{t("sla.systemUptime", "System Uptime")}</CardTitle>
                <CardDescription>
                  {t(
                    "sla.systemUptimeDesc",
                    "Average uptime across all monitored services"
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex items-center justify-center py-8">
                {dashboardLoading ? (
                  <Skeleton className="h-16 w-40" />
                ) : (
                  <UptimeDisplay value={systemHealth?.uptimeAverage ?? 100} />
                )}
              </CardContent>
            </Card>

            {/* Compliance History Chart */}
            <Card className="shadow-sm rounded-xl">
              <CardHeader>
                <CardTitle>
                  {t("sla.complianceHistory", "Compliance History")}
                </CardTitle>
                <CardDescription>
                  {t(
                    "sla.complianceHistoryDesc",
                    "SLA compliance over the last 7 days"
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {dashboardLoading ? (
                  <Skeleton className="h-[200px] w-full" />
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={complianceHistory}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 12 }}
                        tickFormatter={v => format(new Date(v), "MM/dd")}
                      />
                      <YAxis
                        domain={[90, 100]}
                        tick={{ fontSize: 12 }}
                        tickFormatter={v => `${v}%`}
                      />
                      <Tooltip
                        formatter={(value: number) => [
                          `${value}%`,
                          "Compliance",
                        ]}
                        labelFormatter={label =>
                          format(new Date(label as string), "MMM dd, yyyy")
                        }
                      />
                      <Line
                        type="monotone"
                        dataKey="compliance"
                        stroke="#10b981"
                        strokeWidth={2}
                        dot={{ fill: "#10b981" }}
                        name="Compliance %"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          {/* SLA Breaches Chart */}
          <Card className="mb-8 shadow-sm rounded-xl">
            <CardHeader>
              <CardTitle>{t("sla.slaBreaches", "SLA Breaches")}</CardTitle>
              <CardDescription>
                {t(
                  "sla.slaBreachesDesc",
                  "Number of SLA violations per day over the last 7 days"
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {dashboardLoading ? (
                <Skeleton className="h-[200px] w-full" />
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={complianceHistory}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 12 }}
                      tickFormatter={v => format(new Date(v), "MM/dd")}
                    />
                    <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                    <Tooltip
                      formatter={(value: number) => [value, "Breaches"]}
                      labelFormatter={label =>
                        format(new Date(label as string), "MMM dd, yyyy")
                      }
                    />
                    <Bar
                      dataKey="breaches"
                      fill="#ef4444"
                      name="Breaches"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Recent Alerts */}
          <Card className="shadow-sm rounded-xl">
            <CardHeader>
              <CardTitle>{t("sla.recentAlerts", "Recent Alerts")}</CardTitle>
              <CardDescription>
                {t(
                  "sla.recentAlertsDesc",
                  "Latest SLA violation alerts (last 24 hours)"
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {dashboardLoading ? (
                <Skeleton className="h-[200px] w-full" />
              ) : (dashboard?.recentAlerts?.length ?? 0) === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <CheckCircle className="h-12 w-12 mb-3 text-green-500" />
                  <p className="text-sm">
                    {t(
                      "sla.noRecentAlerts",
                      "No recent alerts. All services are operating normally."
                    )}
                  </p>
                </div>
              ) : (
                <div className="overflow-auto max-h-[300px]">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-background">
                      <tr className="border-b">
                        <th className="text-start p-2">
                          {t("sla.service", "Service")}
                        </th>
                        <th className="text-start p-2">
                          {t("sla.metric", "Metric")}
                        </th>
                        <th className="text-start p-2">
                          {t("sla.severity", "Severity")}
                        </th>
                        <th className="text-start p-2">
                          {t("sla.status", "Status")}
                        </th>
                        <th className="text-start p-2">
                          {t("sla.message", "Message")}
                        </th>
                        <th className="text-start p-2">
                          {t("sla.time", "Time")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard?.recentAlerts?.map(alert => (
                        <tr key={alert.id} className="border-b">
                          <td className="p-2 font-medium">
                            {alert.serviceName}
                          </td>
                          <td className="p-2">{alert.metricType}</td>
                          <td className="p-2">
                            <SeverityBadge severity={alert.severity} />
                          </td>
                          <td className="p-2">
                            <AlertStatusBadge status={alert.status} />
                          </td>
                          <td className="p-2 max-w-[300px] truncate">
                            {alert.message}
                          </td>
                          <td className="p-2 text-muted-foreground whitespace-nowrap">
                            {format(new Date(alert.createdAt), "MMM dd, HH:mm")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Services Tab */}
        <TabsContent value="services">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {dashboardLoading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <Card key={i} className="shadow-sm rounded-xl">
                    <CardHeader>
                      <Skeleton className="h-6 w-32" />
                    </CardHeader>
                    <CardContent>
                      <Skeleton className="h-32 w-full" />
                    </CardContent>
                  </Card>
                ))
              : serviceBreakdown.map(service => (
                  <Card key={service.serviceName} className="shadow-sm rounded-xl">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg capitalize">
                          {service.serviceName}
                        </CardTitle>
                        <StatusIndicator status={service.status} />
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Uptime */}
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          {t("sla.uptime", "Uptime")}
                        </span>
                        <span
                          className={`font-mono font-semibold ${
                            service.uptime >= 99.9
                              ? "text-green-600 dark:text-green-400"
                              : service.uptime >= 99.0
                                ? "text-yellow-600 dark:text-yellow-400"
                                : "text-red-600 dark:text-red-400"
                          }`}
                        >
                          {service.uptime.toFixed(2)}%
                        </span>
                      </div>
                      <Progress
                        value={service.uptime}
                        className={`h-2 ${
                          service.uptime >= 99.9
                            ? "[&>[data-slot=indicator]]:bg-green-500"
                            : service.uptime >= 99.0
                              ? "[&>[data-slot=indicator]]:bg-yellow-500"
                              : "[&>[data-slot=indicator]]:bg-red-500"
                        }`}
                      />

                      {/* Response Times */}
                      <div className="space-y-2">
                        <ResponseTimeGauge
                          label="Avg Response"
                          value={service.responseTime.avg}
                          target={200}
                        />
                        <ResponseTimeGauge
                          label="P95 Response"
                          value={service.responseTime.p95}
                          target={500}
                        />
                        <ResponseTimeGauge
                          label="P99 Response"
                          value={service.responseTime.p99}
                          target={1000}
                        />
                      </div>

                      {/* Error Rate */}
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          {t("sla.errorRate", "Error Rate")}
                        </span>
                        <span
                          className={`font-mono font-semibold ${
                            service.errorRate <= 0.1
                              ? "text-green-600 dark:text-green-400"
                              : service.errorRate <= 1.0
                                ? "text-yellow-600 dark:text-yellow-400"
                                : "text-red-600 dark:text-red-400"
                          }`}
                        >
                          {service.errorRate.toFixed(3)}%
                        </span>
                      </div>

                      {/* Active Alerts / SLA Status */}
                      <div className="flex items-center justify-between pt-2 border-t">
                        <div className="flex items-center gap-1">
                          {service.activeAlerts > 0 ? (
                            <>
                              <AlertTriangle className="h-4 w-4 text-red-500" />
                              <span className="text-sm text-red-600 dark:text-red-400">
                                {service.activeAlerts} active alert
                                {service.activeAlerts !== 1 ? "s" : ""}
                              </span>
                            </>
                          ) : (
                            <>
                              <CheckCircle className="h-4 w-4 text-green-500" />
                              <span className="text-sm text-green-600 dark:text-green-400">
                                {t("sla.noAlerts", "No alerts")}
                              </span>
                            </>
                          )}
                        </div>
                        <Badge
                          variant={
                            service.slaCompliant ? "default" : "destructive"
                          }
                        >
                          {service.slaCompliant
                            ? t("sla.compliant", "Compliant")
                            : t("sla.nonCompliant", "Non-Compliant")}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
          </div>
        </TabsContent>

        {/* Alerts Tab */}
        <TabsContent value="alerts">
          <Card className="shadow-sm rounded-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                {t("sla.slaAlerts", "SLA Alerts")}
              </CardTitle>
              <CardDescription>
                {t(
                  "sla.slaAlertsDesc",
                  "All SLA violation alerts from the last 7 days"
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {alertsLoading ? (
                <Skeleton className="h-[300px] w-full" />
              ) : !alerts || alerts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <CheckCircle className="h-16 w-16 mb-4 text-green-500" />
                  <p className="text-lg font-medium">
                    {t("sla.noAlertsFound", "No alerts found")}
                  </p>
                  <p className="text-sm">
                    {t(
                      "sla.allServicesWithinTargets",
                      "All services are within SLA targets."
                    )}
                  </p>
                </div>
              ) : (
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-background">
                      <tr className="border-b">
                        <th className="text-start p-3">{t("sla.id", "ID")}</th>
                        <th className="text-start p-3">
                          {t("sla.service", "Service")}
                        </th>
                        <th className="text-start p-3">
                          {t("sla.metric", "Metric")}
                        </th>
                        <th className="text-start p-3">
                          {t("sla.severity", "Severity")}
                        </th>
                        <th className="text-start p-3">
                          {t("sla.current", "Current")}
                        </th>
                        <th className="text-start p-3">
                          {t("sla.target", "Target")}
                        </th>
                        <th className="text-start p-3">
                          {t("sla.status", "Status")}
                        </th>
                        <th className="text-start p-3">
                          {t("sla.created", "Created")}
                        </th>
                        <th className="text-start p-3">
                          {t("sla.actions", "Actions")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {alerts.map(alert => (
                        <tr
                          key={alert.id}
                          className={`border-b ${
                            alert.status === "active"
                              ? "bg-red-50 dark:bg-red-950/20"
                              : ""
                          }`}
                        >
                          <td className="p-3 font-mono text-muted-foreground">
                            #{alert.id}
                          </td>
                          <td className="p-3 font-medium capitalize">
                            {alert.serviceName}
                          </td>
                          <td className="p-3">{alert.metricType}</td>
                          <td className="p-3">
                            <SeverityBadge severity={alert.severity} />
                          </td>
                          <td className="p-3 font-mono">
                            {alert.currentValue}
                          </td>
                          <td className="p-3 font-mono">{alert.targetValue}</td>
                          <td className="p-3">
                            <AlertStatusBadge status={alert.status} />
                          </td>
                          <td className="p-3 text-muted-foreground whitespace-nowrap">
                            {format(
                              new Date(alert.createdAt),
                              "MMM dd, HH:mm:ss"
                            )}
                          </td>
                          <td className="p-3">
                            {alert.status === "active" && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  acknowledgeAlertMutation.mutate({
                                    alertId: alert.id,
                                  })
                                }
                                disabled={acknowledgeAlertMutation.isPending}
                              >
                                {t("sla.acknowledge", "Acknowledge")}
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* SLA Targets Tab */}
        <TabsContent value="targets">
          <Card className="shadow-sm rounded-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5" />
                {t("sla.slaTargets", "SLA Targets")}
              </CardTitle>
              <CardDescription>
                {t(
                  "sla.slaTargetsDesc",
                  "Configured service level targets and thresholds for all monitored services"
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {targetsLoading ? (
                <Skeleton className="h-[300px] w-full" />
              ) : !targets || targets.length === 0 ? (
                <p className="text-muted-foreground py-8 text-center">
                  {t("sla.noTargets", "No SLA targets configured.")}
                </p>
              ) : (
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-background">
                      <tr className="border-b">
                        <th className="text-start p-3">
                          {t("sla.service", "Service")}
                        </th>
                        <th className="text-start p-3">
                          {t("sla.metric", "Metric")}
                        </th>
                        <th className="text-start p-3">
                          {t("sla.target", "Target")}
                        </th>
                        <th className="text-start p-3">
                          {t("sla.warning", "Warning")}
                        </th>
                        <th className="text-start p-3">
                          {t("sla.critical", "Critical")}
                        </th>
                        <th className="text-start p-3">
                          {t("sla.unit", "Unit")}
                        </th>
                        <th className="text-start p-3">
                          {t("sla.status", "Status")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {targets.map(target => (
                        <tr key={target.id} className="border-b">
                          <td className="p-3 font-medium capitalize">
                            {target.serviceName}
                          </td>
                          <td className="p-3">
                            {target.metricType.replace("_", " ")}
                          </td>
                          <td className="p-3 font-mono font-semibold text-green-600 dark:text-green-400">
                            {target.targetValue}
                            {target.unit === "percent"
                              ? "%"
                              : target.unit === "ms"
                                ? "ms"
                                : "/min"}
                          </td>
                          <td className="p-3 font-mono text-yellow-600 dark:text-yellow-400">
                            {target.warningThreshold}
                            {target.unit === "percent"
                              ? "%"
                              : target.unit === "ms"
                                ? "ms"
                                : "/min"}
                          </td>
                          <td className="p-3 font-mono text-red-600 dark:text-red-400">
                            {target.criticalThreshold}
                            {target.unit === "percent"
                              ? "%"
                              : target.unit === "ms"
                                ? "ms"
                                : "/min"}
                          </td>
                          <td className="p-3">{target.unit}</td>
                          <td className="p-3">
                            {target.isActive ? (
                              <Badge variant="default">Active</Badge>
                            ) : (
                              <Badge variant="secondary">Inactive</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Reports Tab */}
        <TabsContent value="reports">
          <div className="grid gap-4 md:grid-cols-3 mb-8">
            {/* Generate Report Card */}
            <Card className="shadow-sm rounded-xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  {t("sla.generateReport", "Generate Report")}
                </CardTitle>
                <CardDescription>
                  {t(
                    "sla.generateReportDesc",
                    "Create a new SLA compliance report"
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <label className="text-sm font-medium mb-1 block">
                    {t("sla.reportPeriod", "Report Period")}
                  </label>
                  <Select value={reportDays} onValueChange={setReportDays}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">
                        {t("sla.last24Hours", "Last 24 hours")}
                      </SelectItem>
                      <SelectItem value="7">
                        {t("sla.last7Days", "Last 7 days")}
                      </SelectItem>
                      <SelectItem value="14">
                        {t("sla.last14Days", "Last 14 days")}
                      </SelectItem>
                      <SelectItem value="30">
                        {t("sla.last30Days", "Last 30 days")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={handleGenerateReport}
                  disabled={generateReportMutation.isPending}
                  className="w-full"
                >
                  {generateReportMutation.isPending
                    ? t("sla.generating", "Generating...")
                    : t("sla.generateReport", "Generate Report")}
                </Button>
              </CardContent>
            </Card>

            {/* Latest Report Summary */}
            {reports && reports.length > 0 && (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-medium">
                      {t("sla.latestReportUptime", "Latest Report - Uptime")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <UptimeDisplay value={reports[0].overallUptime} />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-medium">
                      {t(
                        "sla.latestReportResponseTimes",
                        "Latest Report - Response Times"
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" /> Avg
                      </span>
                      <span className="font-mono font-semibold">
                        {Math.round(reports[0].avgResponseTime)}ms
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" /> P95
                      </span>
                      <span className="font-mono font-semibold">
                        {Math.round(reports[0].p95ResponseTime)}ms
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" /> P99
                      </span>
                      <span className="font-mono font-semibold">
                        {Math.round(reports[0].p99ResponseTime)}ms
                      </span>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t">
                      <span className="text-sm text-muted-foreground flex items-center gap-1">
                        <XCircle className="h-3 w-3" /> Error Rate
                      </span>
                      <span className="font-mono font-semibold">
                        {reports[0].errorRate.toFixed(3)}%
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" /> Breaches
                      </span>
                      <span
                        className={`font-mono font-semibold ${
                          reports[0].slaBreaches > 0
                            ? "text-red-600 dark:text-red-400"
                            : "text-green-600 dark:text-green-400"
                        }`}
                      >
                        {reports[0].slaBreaches}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>

          {/* Reports Table */}
          <Card>
            <CardHeader>
              <CardTitle>{t("sla.reportHistory", "Report History")}</CardTitle>
              <CardDescription>
                {t(
                  "sla.reportHistoryDesc",
                  "Previously generated SLA compliance reports"
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {reportsLoading ? (
                <Skeleton className="h-[200px] w-full" />
              ) : !reports || reports.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <FileText className="h-12 w-12 mb-3" />
                  <p className="text-sm">
                    {t(
                      "sla.noReports",
                      "No reports generated yet. Use the form above to create one."
                    )}
                  </p>
                </div>
              ) : (
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-background">
                      <tr className="border-b">
                        <th className="text-start p-3">{t("sla.id", "ID")}</th>
                        <th className="text-start p-3">
                          {t("sla.period", "Period")}
                        </th>
                        <th className="text-start p-3">
                          {t("sla.uptime", "Uptime")}
                        </th>
                        <th className="text-start p-3">
                          {t("sla.avgRT", "Avg RT")}
                        </th>
                        <th className="text-start p-3">
                          {t("sla.p95RT", "P95 RT")}
                        </th>
                        <th className="text-start p-3">
                          {t("sla.errorRate", "Error Rate")}
                        </th>
                        <th className="text-start p-3">
                          {t("sla.requests", "Requests")}
                        </th>
                        <th className="text-start p-3">
                          {t("sla.breaches", "Breaches")}
                        </th>
                        <th className="text-start p-3">
                          {t("sla.status", "Status")}
                        </th>
                        <th className="text-start p-3">
                          {t("sla.generated", "Generated")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {reports.map(report => (
                        <tr key={report.id} className="border-b">
                          <td className="p-3 font-mono text-muted-foreground">
                            #{report.id}
                          </td>
                          <td className="p-3 whitespace-nowrap">
                            {format(
                              new Date(report.reportPeriodStart),
                              "MM/dd"
                            )}{" "}
                            -{" "}
                            {format(new Date(report.reportPeriodEnd), "MM/dd")}
                          </td>
                          <td
                            className={`p-3 font-mono font-semibold ${
                              report.overallUptime >= 99.9
                                ? "text-green-600 dark:text-green-400"
                                : report.overallUptime >= 99.0
                                  ? "text-yellow-600 dark:text-yellow-400"
                                  : "text-red-600 dark:text-red-400"
                            }`}
                          >
                            {report.overallUptime.toFixed(2)}%
                          </td>
                          <td className="p-3 font-mono">
                            {Math.round(report.avgResponseTime)}ms
                          </td>
                          <td className="p-3 font-mono">
                            {Math.round(report.p95ResponseTime)}ms
                          </td>
                          <td className="p-3 font-mono">
                            {report.errorRate.toFixed(3)}%
                          </td>
                          <td className="p-3 font-mono">
                            {report.totalRequests.toLocaleString()}
                          </td>
                          <td className="p-3">
                            <span
                              className={`font-semibold ${
                                report.slaBreaches > 0
                                  ? "text-red-600 dark:text-red-400"
                                  : "text-green-600 dark:text-green-400"
                              }`}
                            >
                              {report.slaBreaches}
                            </span>
                          </td>
                          <td className="p-3">
                            <Badge
                              variant={
                                report.status === "published"
                                  ? "default"
                                  : "secondary"
                              }
                            >
                              {report.status}
                            </Badge>
                          </td>
                          <td className="p-3 text-muted-foreground whitespace-nowrap">
                            {format(
                              new Date(report.generatedAt),
                              "MMM dd, HH:mm"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default SLADashboard;
