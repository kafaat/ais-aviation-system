import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";
import {
  ChevronLeft,
  Shield,
  Database,
  HardDrive,
  Settings,
  Server,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Activity,
  FileText,
  Play,
  Download,
  AlertOctagon,
  BookOpen,
  RefreshCw,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

type Tab =
  | "overview"
  | "backups"
  | "testing"
  | "incidents"
  | "runbooks"
  | "recovery";

export default function DisasterRecovery() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link href="/admin">
          <Button variant="ghost" size="sm">
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">
            {t("dr.title", "Disaster Recovery & Business Continuity")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t(
              "dr.subtitle",
              "Backup management, failover testing, incident tracking, and recovery planning"
            )}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {(
          [
            {
              id: "overview",
              label: t("dr.tabs.overview", "Overview"),
              icon: Activity,
            },
            {
              id: "backups",
              label: t("dr.tabs.backups", "Backups"),
              icon: Database,
            },
            {
              id: "testing",
              label: t("dr.tabs.testing", "Failover Testing"),
              icon: Zap,
            },
            {
              id: "incidents",
              label: t("dr.tabs.incidents", "Incidents"),
              icon: AlertOctagon,
            },
            {
              id: "runbooks",
              label: t("dr.tabs.runbooks", "Runbooks"),
              icon: BookOpen,
            },
            {
              id: "recovery",
              label: t("dr.tabs.recovery", "Recovery Plan"),
              icon: Shield,
            },
          ] as const
        ).map(tab => (
          <Button
            key={tab.id}
            variant={activeTab === tab.id ? "default" : "outline"}
            onClick={() => setActiveTab(tab.id)}
            className="gap-2"
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </Button>
        ))}
      </div>

      {/* Content */}
      {activeTab === "overview" && <OverviewTab />}
      {activeTab === "backups" && <BackupsTab />}
      {activeTab === "testing" && <TestingTab />}
      {activeTab === "incidents" && <IncidentsTab />}
      {activeTab === "runbooks" && <RunbooksTab />}
      {activeTab === "recovery" && <RecoveryPlanTab />}
    </div>
  );
}

// ============================================================================
// Helper Components
// ============================================================================

function StatusBadge({
  status,
  size = "sm",
}: {
  status: string;
  size?: "sm" | "md";
}) {
  const colorMap: Record<string, string> = {
    healthy:
      "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    within_target:
      "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    passed: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    completed:
      "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    verified:
      "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    resolved:
      "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    warning:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
    approaching_limit:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
    degraded:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
    investigating:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
    mitigating:
      "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
    running: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    started: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    scheduled: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    open: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
    critical: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
    exceeded: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
    failed: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
    down: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
    postmortem:
      "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  };

  const classes =
    colorMap[status] ??
    "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300";

  return (
    <span
      className={`px-2 py-1 rounded ${size === "md" ? "text-sm font-medium" : "text-xs"} ${classes}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

function HealthScoreGauge({ score }: { score: number }) {
  const color =
    score >= 80
      ? "text-green-500"
      : score >= 50
        ? "text-yellow-500"
        : "text-red-500";
  const bgColor =
    score >= 80
      ? "stroke-green-500"
      : score >= 50
        ? "stroke-yellow-500"
        : "stroke-red-500";

  const circumference = 2 * Math.PI * 45;
  const dashOffset = circumference - (score / 100) * circumference;

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="120" height="120" className="-rotate-90">
        <circle
          cx="60"
          cy="60"
          r="45"
          stroke="currentColor"
          strokeWidth="8"
          fill="none"
          className="text-muted/30"
        />
        <circle
          cx="60"
          cy="60"
          r="45"
          strokeWidth="8"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className={bgColor}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className={`text-2xl font-bold ${color}`}>{score}</span>
        <span className="text-xs text-muted-foreground">/ 100</span>
      </div>
    </div>
  );
}

function RPOGauge({
  minutes,
  targetMinutes,
  status,
}: {
  minutes: number;
  targetMinutes: number;
  status: string;
}) {
  const percentage = Math.min((minutes / (targetMinutes * 3)) * 100, 100);
  const barColor =
    status === "within_target"
      ? "bg-green-500"
      : status === "approaching_limit"
        ? "bg-yellow-500"
        : "bg-red-500";

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">RPO</span>
        <span className="font-medium">
          {minutes === Infinity ? "N/A" : `${minutes} min`} / {targetMinutes}{" "}
          min target
        </span>
      </div>
      <div className="h-3 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>0 min</span>
        <span className="border-l border-dashed border-muted-foreground pl-1">
          {targetMinutes} min target
        </span>
        <span>{targetMinutes * 3} min</span>
      </div>
    </div>
  );
}

function RTOGauge({
  estimatedMinutes,
  targetMinutes,
  status,
}: {
  estimatedMinutes: number;
  targetMinutes: number;
  status: string;
}) {
  const percentage = Math.min(
    (estimatedMinutes / (targetMinutes * 2)) * 100,
    100
  );
  const barColor =
    status === "within_target"
      ? "bg-green-500"
      : status === "approaching_limit"
        ? "bg-yellow-500"
        : "bg-red-500";

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">RTO</span>
        <span className="font-medium">
          {estimatedMinutes} min estimated / {targetMinutes} min target
        </span>
      </div>
      <div className="h-3 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>0 min</span>
        <span className="border-l border-dashed border-muted-foreground pl-1">
          {targetMinutes} min target
        </span>
        <span>{targetMinutes * 2} min</span>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

function getComponentIcon(component: string) {
  switch (component) {
    case "database":
      return Database;
    case "files":
      return HardDrive;
    case "config":
      return Settings;
    case "redis":
      return Server;
    default:
      return Server;
  }
}

// ============================================================================
// Overview Tab
// ============================================================================

function OverviewTab() {
  const { t } = useTranslation();
  const { data: dashboard, isLoading } =
    trpc.disasterRecovery.getDashboard.useQuery();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i} className="p-6 animate-pulse shadow-sm rounded-xl">
            <div className="h-20 bg-muted rounded" />
          </Card>
        ))}
      </div>
    );
  }

  if (!dashboard) {
    return (
      <Card className="p-6 text-center text-muted-foreground shadow-sm rounded-xl">
        {t("dr.overview.noData", "No dashboard data available")}
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Row: Health Score + RPO/RTO */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Health Score */}
        <Card className="p-6 flex flex-col items-center shadow-sm rounded-xl">
          <h3 className="text-sm font-medium text-muted-foreground mb-4">
            {t("dr.overview.healthScore", "DR Health Score")}
          </h3>
          <HealthScoreGauge score={dashboard.healthScore} />
          <StatusBadge status={dashboard.overallStatus} size="md" />
        </Card>

        {/* RPO Gauge */}
        <Card className="p-6 shadow-sm rounded-xl">
          <h3 className="text-sm font-medium text-muted-foreground mb-4">
            {t(
              "dr.overview.recoveryPointObjective",
              "Recovery Point Objective"
            )}
          </h3>
          <RPOGauge
            minutes={dashboard.rpo.minutes}
            targetMinutes={dashboard.rpo.targetMinutes}
            status={dashboard.rpo.status}
          />
          {dashboard.rpo.lastBackupTime && (
            <p className="text-xs text-muted-foreground mt-3">
              {t("dr.overview.lastBackup", "Last backup")}:{" "}
              {formatRelativeTime(dashboard.rpo.lastBackupTime)}
            </p>
          )}
        </Card>

        {/* RTO Gauge */}
        <Card className="p-6 shadow-sm rounded-xl">
          <h3 className="text-sm font-medium text-muted-foreground mb-4">
            {t("dr.overview.recoveryTimeObjective", "Recovery Time Objective")}
          </h3>
          <RTOGauge
            estimatedMinutes={dashboard.rto.estimatedMinutes}
            targetMinutes={dashboard.rto.targetMinutes}
            status={dashboard.rto.status}
          />
          <div className="mt-3 flex flex-wrap gap-1">
            {dashboard.rto.components.map(c => (
              <span
                key={c.component}
                className="text-xs bg-muted px-2 py-0.5 rounded"
              >
                {c.component}: {c.estimatedMinutes}m
              </span>
            ))}
          </div>
        </Card>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-6 shadow-sm rounded-xl">
          <div className="flex items-center gap-3 mb-2">
            <Database className="h-5 w-5 text-blue-500" />
            <span className="text-sm text-muted-foreground">
              {t("dr.overview.backups", "Backups")}
            </span>
          </div>
          <p className="text-3xl font-bold">
            {dashboard.backupSummary.completed}
          </p>
          <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
            <span>
              {t("dr.overview.total", "Total")}: {dashboard.backupSummary.total}
            </span>
            {dashboard.backupSummary.failed > 0 && (
              <span className="text-red-500">
                {t("dr.overview.failed", "Failed")}:{" "}
                {dashboard.backupSummary.failed}
              </span>
            )}
          </div>
        </Card>

        <Card className="p-6 shadow-sm rounded-xl">
          <div className="flex items-center gap-3 mb-2">
            <Zap className="h-5 w-5 text-purple-500" />
            <span className="text-sm text-muted-foreground">
              {t("dr.overview.failoverTests", "Failover Tests")}
            </span>
          </div>
          <p className="text-3xl font-bold">{dashboard.testSummary.passed}</p>
          <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
            <span>
              {t("dr.overview.total", "Total")}: {dashboard.testSummary.total}
            </span>
            {dashboard.testSummary.failed > 0 && (
              <span className="text-red-500">
                {t("dr.overview.failed", "Failed")}:{" "}
                {dashboard.testSummary.failed}
              </span>
            )}
          </div>
        </Card>

        <Card className="p-6 shadow-sm rounded-xl">
          <div className="flex items-center gap-3 mb-2">
            <AlertTriangle className="h-5 w-5 text-orange-500" />
            <span className="text-sm text-muted-foreground">
              {t("dr.overview.activeIncidents", "Active Incidents")}
            </span>
          </div>
          <p className="text-3xl font-bold">{dashboard.activeIncidents}</p>
          {dashboard.criticalIncidents > 0 && (
            <p className="text-xs text-red-500 mt-2">
              {dashboard.criticalIncidents}{" "}
              {t("dr.overview.critical", "critical")}
            </p>
          )}
        </Card>

        <Card className="p-6 shadow-sm rounded-xl">
          <div className="flex items-center gap-3 mb-2">
            <Shield className="h-5 w-5 text-green-500" />
            <span className="text-sm text-muted-foreground">
              {t("dr.overview.components", "Components")}
            </span>
          </div>
          <p className="text-3xl font-bold">
            {
              dashboard.componentHealth.filter(c => c.status === "healthy")
                .length
            }
            <span className="text-lg text-muted-foreground">
              /{dashboard.componentHealth.length}
            </span>
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            {t("dr.overview.healthyComponents", "healthy")}
          </p>
        </Card>
      </div>

      {/* Component Health Grid */}
      <Card className="p-6 shadow-sm rounded-xl">
        <h3 className="font-semibold text-lg mb-4">
          {t("dr.overview.componentHealth", "Component Health")}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {dashboard.componentHealth.map(comp => {
            const Icon = getComponentIcon(comp.component);
            return (
              <div
                key={comp.component}
                className={`p-4 rounded-lg border-2 ${
                  comp.status === "healthy"
                    ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950"
                    : comp.status === "degraded"
                      ? "border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950"
                      : "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950"
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Icon className="h-4 w-4" />
                  <span className="font-medium capitalize">
                    {comp.component}
                  </span>
                </div>
                <StatusBadge status={comp.status} />
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {comp.lastBackup && (
                    <p>
                      {t("dr.overview.lastBackup", "Last backup")}:{" "}
                      {formatRelativeTime(comp.lastBackup)}
                    </p>
                  )}
                  {comp.rpoMinutes !== null && (
                    <p>RPO: {comp.rpoMinutes} min</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Recent Backups */}
        <Card className="p-6 shadow-sm rounded-xl">
          <h3 className="font-semibold text-lg mb-4">
            {t("dr.overview.recentBackups", "Recent Backups")}
          </h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {dashboard.recentBackups.map(backup => {
              const Icon = getComponentIcon(backup.component);
              return (
                <div
                  key={backup.id}
                  className="flex items-center justify-between p-2 rounded bg-muted/50"
                >
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium capitalize">
                        {backup.component} ({backup.backupType})
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatRelativeTime(backup.startedAt)}
                        {backup.sizeBytes
                          ? ` - ${formatBytes(backup.sizeBytes)}`
                          : ""}
                      </p>
                    </div>
                  </div>
                  <StatusBadge status={backup.status} />
                </div>
              );
            })}
            {dashboard.recentBackups.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                {t("dr.overview.noRecentBackups", "No recent backups")}
              </p>
            )}
          </div>
        </Card>

        {/* Recent Incidents */}
        <Card className="p-6 shadow-sm rounded-xl">
          <h3 className="font-semibold text-lg mb-4">
            {t("dr.overview.recentIncidents", "Recent Incidents")}
          </h3>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {dashboard.recentIncidents.map(incident => (
              <div
                key={incident.id}
                className="flex items-center justify-between p-2 rounded bg-muted/50"
              >
                <div>
                  <p className="text-sm font-medium">
                    {incident.description.length > 60
                      ? `${incident.description.slice(0, 60)}...`
                      : incident.description}
                  </p>
                  <div className="flex gap-2 mt-1">
                    <StatusBadge status={incident.severity} />
                    <span className="text-xs text-muted-foreground">
                      {formatRelativeTime(incident.createdAt)}
                    </span>
                  </div>
                </div>
                <StatusBadge status={incident.status} />
              </div>
            ))}
            {dashboard.recentIncidents.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                {t("dr.overview.noIncidents", "No incidents recorded")}
              </p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ============================================================================
// Backups Tab
// ============================================================================

function BackupsTab() {
  const { t } = useTranslation();
  const {
    data: backupStatus,
    isLoading,
    refetch,
  } = trpc.disasterRecovery.getBackupStatus.useQuery();
  const { data: schedule } = trpc.disasterRecovery.getBackupSchedule.useQuery();

  const [backupType, setBackupType] = useState<string>("");
  const [backupComponent, setBackupComponent] = useState<string>("");

  const triggerMutation = trpc.disasterRecovery.triggerBackup.useMutation({
    onSuccess: data => {
      toast.success(
        t("dr.backups.triggered", "Backup triggered for {{component}}", {
          component: data.component,
        })
      );
      refetch();
    },
    onError: err => toast.error(err.message),
  });

  return (
    <div className="space-y-6">
      {/* Trigger Manual Backup */}
      <Card className="p-4 shadow-sm rounded-xl">
        <h3 className="font-semibold mb-4">
          {t("dr.backups.triggerManual", "Trigger Manual Backup")}
        </h3>
        <div className="flex gap-4 items-end flex-wrap">
          <div className="min-w-48">
            <Label>{t("dr.backups.type", "Backup Type")}</Label>
            <Select value={backupType} onValueChange={setBackupType}>
              <SelectTrigger>
                <SelectValue
                  placeholder={t("dr.backups.selectType", "Select type")}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="full">Full</SelectItem>
                <SelectItem value="incremental">Incremental</SelectItem>
                <SelectItem value="differential">Differential</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-48">
            <Label>{t("dr.backups.component", "Component")}</Label>
            <Select value={backupComponent} onValueChange={setBackupComponent}>
              <SelectTrigger>
                <SelectValue
                  placeholder={t(
                    "dr.backups.selectComponent",
                    "Select component"
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="database">Database</SelectItem>
                <SelectItem value="files">Files</SelectItem>
                <SelectItem value="config">Config</SelectItem>
                <SelectItem value="redis">Redis</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            disabled={
              !backupType || !backupComponent || triggerMutation.isPending
            }
            onClick={() =>
              triggerMutation.mutate({
                backupType: backupType as
                  | "full"
                  | "incremental"
                  | "differential",
                component: backupComponent as
                  | "database"
                  | "files"
                  | "config"
                  | "redis",
              })
            }
            className="gap-2"
          >
            <Download className="h-4 w-4" />
            {t("dr.backups.trigger", "Start Backup")}
          </Button>
        </div>
      </Card>

      {/* Backup Status Cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-6 animate-pulse shadow-sm rounded-xl">
              <div className="h-24 bg-muted rounded" />
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {backupStatus?.components.map(comp => {
            const Icon = getComponentIcon(comp.component);
            const borderColor =
              comp.status === "healthy"
                ? "border-green-500"
                : comp.status === "warning"
                  ? "border-yellow-500"
                  : "border-red-500";

            return (
              <Card
                key={comp.component}
                className={`p-6 border-t-4 shadow-sm rounded-xl ${borderColor}`}
              >
                <div className="flex items-center gap-2 mb-3">
                  <Icon className="h-5 w-5" />
                  <span className="font-semibold capitalize">
                    {comp.component}
                  </span>
                </div>
                <StatusBadge status={comp.status} size="md" />
                <div className="mt-3 space-y-1 text-sm">
                  <p>
                    <span className="text-muted-foreground">
                      {t("dr.backups.last24h", "Last 24h")}:
                    </span>{" "}
                    {comp.backupsLast24h}{" "}
                    {t("dr.backups.backupsUnit", "backups")}
                  </p>
                  <p>
                    <span className="text-muted-foreground">
                      {t("dr.backups.totalSize", "Total size")}:
                    </span>{" "}
                    {formatBytes(comp.totalSize)}
                  </p>
                  {comp.lastBackup && (
                    <p>
                      <span className="text-muted-foreground">
                        {t("dr.backups.lastBackup", "Last")}:
                      </span>{" "}
                      {formatRelativeTime(comp.lastBackup.startedAt)}
                    </p>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Backup Schedule */}
      {schedule && (
        <Card className="p-6 shadow-sm rounded-xl">
          <h3 className="font-semibold text-lg mb-4">
            {t("dr.backups.schedule", "Backup Schedule")}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="p-3 text-start">
                    {t("dr.backups.component", "Component")}
                  </th>
                  <th className="p-3 text-start">
                    {t("dr.backups.type", "Type")}
                  </th>
                  <th className="p-3 text-start">
                    {t("dr.backups.cron", "Schedule")}
                  </th>
                  <th className="p-3 text-start">
                    {t("dr.backups.retention", "Retention")}
                  </th>
                  <th className="p-3 text-start">
                    {t("dr.backups.status", "Status")}
                  </th>
                  <th className="p-3 text-start">
                    {t("dr.backups.lastRun", "Last Run")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {schedule.map((entry, idx) => (
                  <tr key={idx} className="border-t">
                    <td className="p-3 capitalize font-medium">
                      {entry.component}
                    </td>
                    <td className="p-3 capitalize">{entry.backupType}</td>
                    <td className="p-3 font-mono text-xs">
                      {entry.cronExpression}
                    </td>
                    <td className="p-3">{entry.retentionDays}d</td>
                    <td className="p-3">
                      {entry.enabled ? (
                        <span className="flex items-center gap-1 text-green-600">
                          <CheckCircle className="h-3 w-3" />
                          {t("dr.backups.enabled", "Enabled")}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-gray-500">
                          <XCircle className="h-3 w-3" />
                          {t("dr.backups.disabled", "Disabled")}
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {entry.lastRun ? formatRelativeTime(entry.lastRun) : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Testing Tab
// ============================================================================

function TestingTab() {
  const { t } = useTranslation();
  const {
    data: testHistory,
    isLoading,
    refetch,
  } = trpc.disasterRecovery.getTestHistory.useQuery();

  const [testType, setTestType] = useState<string>("");
  const [testComponent, setTestComponent] = useState("");

  const testMutation = trpc.disasterRecovery.testFailover.useMutation({
    onSuccess: data => {
      toast.success(
        data.status === "passed"
          ? t("dr.testing.passed", "Failover test passed")
          : t("dr.testing.failed", "Failover test failed")
      );
      refetch();
    },
    onError: err => toast.error(err.message),
  });

  return (
    <div className="space-y-6">
      {/* Run Test */}
      <Card className="p-4 shadow-sm rounded-xl">
        <h3 className="font-semibold mb-4">
          {t("dr.testing.runTest", "Run Failover Test")}
        </h3>
        <div className="flex gap-4 items-end flex-wrap">
          <div className="min-w-48">
            <Label>{t("dr.testing.testType", "Test Type")}</Label>
            <Select value={testType} onValueChange={setTestType}>
              <SelectTrigger>
                <SelectValue
                  placeholder={t("dr.testing.selectType", "Select test type")}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="failover">Failover</SelectItem>
                <SelectItem value="backup_restore">Backup Restore</SelectItem>
                <SelectItem value="network_partition">
                  Network Partition
                </SelectItem>
                <SelectItem value="data_recovery">Data Recovery</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-48">
            <Label>{t("dr.testing.component", "Component")}</Label>
            <Select value={testComponent} onValueChange={setTestComponent}>
              <SelectTrigger>
                <SelectValue
                  placeholder={t(
                    "dr.testing.selectComponent",
                    "Select component"
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="database">Database</SelectItem>
                <SelectItem value="redis">Redis</SelectItem>
                <SelectItem value="stripe">Stripe</SelectItem>
                <SelectItem value="auth-service">Auth Service</SelectItem>
                <SelectItem value="application">Application</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            disabled={!testType || !testComponent || testMutation.isPending}
            onClick={() =>
              testMutation.mutate({
                testType: testType as
                  | "failover"
                  | "backup_restore"
                  | "network_partition"
                  | "data_recovery",
                component: testComponent,
              })
            }
            className="gap-2"
          >
            {testMutation.isPending ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {t("dr.testing.run", "Run Test")}
          </Button>
        </div>
      </Card>

      {/* Latest Test Result */}
      {testMutation.data && (
        <Card
          className={`p-4 border-2 shadow-sm rounded-xl ${
            testMutation.data.status === "passed"
              ? "border-green-500"
              : "border-red-500"
          }`}
        >
          <div className="flex items-center gap-3 mb-3">
            {testMutation.data.status === "passed" ? (
              <CheckCircle className="h-6 w-6 text-green-500" />
            ) : (
              <XCircle className="h-6 w-6 text-red-500" />
            )}
            <div>
              <p className="font-semibold">
                {testMutation.data.testType.replace(/_/g, " ")} -{" "}
                {testMutation.data.component}
              </p>
              <p className="text-sm text-muted-foreground">
                {t("dr.testing.status", "Status")}:{" "}
                <StatusBadge status={testMutation.data.status} />
              </p>
            </div>
          </div>
          {testMutation.data.findings &&
            Object.keys(testMutation.data.findings).length > 0 && (
              <div className="bg-muted p-3 rounded text-sm">
                <p className="font-medium mb-2">
                  {t("dr.testing.findings", "Findings")}:
                </p>
                <div className="space-y-1">
                  {Object.entries(testMutation.data.findings).map(
                    ([key, value]) => (
                      <div key={key} className="flex gap-2">
                        <span className="text-muted-foreground">
                          {key.replace(/([A-Z])/g, " $1").trim()}:
                        </span>
                        <span className="font-mono">{String(value)}</span>
                      </div>
                    )
                  )}
                </div>
              </div>
            )}
        </Card>
      )}

      {/* Test History */}
      <Card className="p-6 shadow-sm rounded-xl">
        <h3 className="font-semibold text-lg mb-4">
          {t("dr.testing.history", "Test History")}
        </h3>
        {isLoading ? (
          <div className="animate-pulse">
            <div className="h-40 bg-muted rounded" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="p-3 text-start">
                    {t("dr.testing.testType", "Test Type")}
                  </th>
                  <th className="p-3 text-start">
                    {t("dr.testing.component", "Component")}
                  </th>
                  <th className="p-3 text-start">
                    {t("dr.testing.status", "Status")}
                  </th>
                  <th className="p-3 text-start">RTO</th>
                  <th className="p-3 text-start">
                    {t("dr.testing.testedBy", "Tested By")}
                  </th>
                  <th className="p-3 text-start">
                    {t("dr.testing.date", "Date")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {testHistory?.map(test => (
                  <tr key={test.id} className="border-t">
                    <td className="p-3 capitalize">
                      {test.testType.replace(/_/g, " ")}
                    </td>
                    <td className="p-3 capitalize">{test.component}</td>
                    <td className="p-3">
                      <StatusBadge status={test.status} />
                    </td>
                    <td className="p-3">
                      {test.rtoAchieved !== null
                        ? `${test.rtoAchieved} min`
                        : "-"}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {test.testedBy}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {formatRelativeTime(test.createdAt)}
                    </td>
                  </tr>
                ))}
                {(!testHistory || testHistory.length === 0) && (
                  <tr>
                    <td
                      colSpan={6}
                      className="p-6 text-center text-muted-foreground"
                    >
                      {t("dr.testing.noTests", "No tests have been run yet")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ============================================================================
// Incidents Tab
// ============================================================================

function IncidentsTab() {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<string>("");

  const {
    data: incidents,
    isLoading,
    refetch,
  } = trpc.disasterRecovery.getIncidents.useQuery(
    statusFilter
      ? {
          status: statusFilter as
            | "open"
            | "investigating"
            | "mitigating"
            | "resolved"
            | "postmortem",
        }
      : undefined
  );

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    incidentType: "" as string,
    severity: "" as string,
    description: "",
    impactAssessment: "",
  });

  const [resolveId, setResolveId] = useState<number | null>(null);
  const [resolution, setResolution] = useState("");

  const createMutation = trpc.disasterRecovery.createIncident.useMutation({
    onSuccess: () => {
      toast.success(t("dr.incidents.created", "Incident created"));
      setShowCreate(false);
      setForm({
        incidentType: "",
        severity: "",
        description: "",
        impactAssessment: "",
      });
      refetch();
    },
    onError: err => toast.error(err.message),
  });

  const resolveMutation = trpc.disasterRecovery.resolveIncident.useMutation({
    onSuccess: () => {
      toast.success(t("dr.incidents.resolved", "Incident resolved"));
      setResolveId(null);
      setResolution("");
      refetch();
    },
    onError: err => toast.error(err.message),
  });

  return (
    <div className="space-y-6">
      {/* Actions Bar */}
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div className="flex gap-2 items-center">
          <Label className="whitespace-nowrap">
            {t("dr.incidents.filterByStatus", "Filter by status")}:
          </Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="min-w-40">
              <SelectValue placeholder={t("dr.incidents.allStatuses", "All")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {t("dr.incidents.allStatuses", "All")}
              </SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="investigating">Investigating</SelectItem>
              <SelectItem value="mitigating">Mitigating</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="postmortem">Postmortem</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => setShowCreate(!showCreate)} className="gap-2">
          <AlertOctagon className="h-4 w-4" />
          {t("dr.incidents.reportIncident", "Report Incident")}
        </Button>
      </div>

      {/* Create Incident Form */}
      {showCreate && (
        <Card className="p-4 shadow-sm rounded-xl">
          <h3 className="font-semibold mb-4">
            {t("dr.incidents.newIncident", "Report New Incident")}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>{t("dr.incidents.type", "Incident Type")}</Label>
              <Select
                value={form.incidentType}
                onValueChange={v => setForm({ ...form, incidentType: v })}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={t("dr.incidents.selectType", "Select type")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="outage">Outage</SelectItem>
                  <SelectItem value="data_loss">Data Loss</SelectItem>
                  <SelectItem value="performance">Performance</SelectItem>
                  <SelectItem value="security">Security</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("dr.incidents.severity", "Severity")}</Label>
              <Select
                value={form.severity}
                onValueChange={v => setForm({ ...form, severity: v })}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={t(
                      "dr.incidents.selectSeverity",
                      "Select severity"
                    )}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label>{t("dr.incidents.description", "Description")}</Label>
              <Input
                value={form.description}
                onChange={e =>
                  setForm({ ...form, description: e.target.value })
                }
                placeholder={t(
                  "dr.incidents.descriptionPlaceholder",
                  "Describe the incident..."
                )}
              />
            </div>
            <div className="md:col-span-2">
              <Label>
                {t("dr.incidents.impact", "Impact Assessment (optional)")}
              </Label>
              <Input
                value={form.impactAssessment}
                onChange={e =>
                  setForm({ ...form, impactAssessment: e.target.value })
                }
                placeholder={t(
                  "dr.incidents.impactPlaceholder",
                  "Affected systems, users, data..."
                )}
              />
            </div>
          </div>
          <Button
            className="mt-4"
            disabled={!form.incidentType || !form.severity || !form.description}
            onClick={() =>
              createMutation.mutate({
                incidentType: form.incidentType as
                  | "outage"
                  | "data_loss"
                  | "performance"
                  | "security",
                severity: form.severity as
                  | "low"
                  | "medium"
                  | "high"
                  | "critical",
                description: form.description,
                impactAssessment: form.impactAssessment || undefined,
              })
            }
          >
            {t("dr.incidents.submit", "Submit Incident")}
          </Button>
        </Card>
      )}

      {/* Incidents List */}
      {isLoading ? (
        <Card className="p-6 animate-pulse">
          <div className="h-40 bg-muted rounded" />
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden shadow-sm rounded-xl">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="p-3 text-start">ID</th>
                <th className="p-3 text-start">
                  {t("dr.incidents.type", "Type")}
                </th>
                <th className="p-3 text-start">
                  {t("dr.incidents.severity", "Severity")}
                </th>
                <th className="p-3 text-start">
                  {t("dr.incidents.description", "Description")}
                </th>
                <th className="p-3 text-start">
                  {t("dr.incidents.status", "Status")}
                </th>
                <th className="p-3 text-start">
                  {t("dr.incidents.created", "Created")}
                </th>
                <th className="p-3 text-start">
                  {t("dr.incidents.actions", "Actions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {incidents?.map(incident => (
                <tr key={incident.id} className="border-t">
                  <td className="p-3 font-mono">#{incident.id}</td>
                  <td className="p-3 capitalize">
                    {incident.incidentType.replace(/_/g, " ")}
                  </td>
                  <td className="p-3">
                    <StatusBadge status={incident.severity} />
                  </td>
                  <td className="p-3 max-w-xs truncate">
                    {incident.description}
                  </td>
                  <td className="p-3">
                    <StatusBadge status={incident.status} />
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {formatRelativeTime(incident.createdAt)}
                  </td>
                  <td className="p-3">
                    {incident.status !== "resolved" &&
                      incident.status !== "postmortem" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setResolveId(incident.id)}
                        >
                          {t("dr.incidents.resolve", "Resolve")}
                        </Button>
                      )}
                    {incident.resolution && (
                      <span
                        className="text-xs text-muted-foreground"
                        title={incident.resolution}
                      >
                        {t("dr.incidents.resolved", "Resolved")}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {(!incidents || incidents.length === 0) && (
                <tr>
                  <td
                    colSpan={7}
                    className="p-6 text-center text-muted-foreground"
                  >
                    {t("dr.incidents.noIncidents", "No incidents found")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}

      {/* Resolve Dialog */}
      {resolveId !== null && (
        <Card className="p-4 border-2 border-green-500 shadow-sm rounded-xl">
          <h3 className="font-semibold mb-4">
            {t("dr.incidents.resolveIncident", "Resolve Incident")} #{resolveId}
          </h3>
          <div>
            <Label>{t("dr.incidents.resolution", "Resolution")}</Label>
            <Input
              value={resolution}
              onChange={e => setResolution(e.target.value)}
              placeholder={t(
                "dr.incidents.resolutionPlaceholder",
                "Describe how the incident was resolved..."
              )}
            />
          </div>
          <div className="flex gap-2 mt-4">
            <Button
              disabled={!resolution}
              onClick={() =>
                resolveMutation.mutate({
                  incidentId: resolveId,
                  resolution,
                })
              }
              className="gap-2"
            >
              <CheckCircle className="h-4 w-4" />
              {t("dr.incidents.confirmResolve", "Confirm Resolution")}
            </Button>
            <Button variant="outline" onClick={() => setResolveId(null)}>
              {t("dr.incidents.cancel", "Cancel")}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Runbooks Tab
// ============================================================================

function RunbooksTab() {
  const { t } = useTranslation();
  const { data: runbooks, isLoading } =
    trpc.disasterRecovery.getAllRunbooks.useQuery();
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="p-6 animate-pulse shadow-sm rounded-xl">
            <div className="h-20 bg-muted rounded" />
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-lg">
          {t("dr.runbooks.title", "DR Runbooks")} ({runbooks?.length ?? 0})
        </h3>
      </div>

      {runbooks?.map(runbook => {
        const isExpanded = expandedId === runbook.id;
        const scenarioIcons: Record<string, typeof Shield> = {
          db_failure: Database,
          region_outage: Server,
          network_failure: Activity,
          security_breach: Shield,
          data_corruption: AlertTriangle,
        };
        const Icon = scenarioIcons[runbook.scenarioType] ?? FileText;

        return (
          <Card
            key={runbook.id}
            className="overflow-hidden shadow-sm rounded-xl"
          >
            {/* Runbook Header */}
            <button
              className="w-full p-4 flex items-center justify-between hover:bg-muted/50 transition-colors text-left"
              onClick={() => setExpandedId(isExpanded ? null : runbook.id)}
            >
              <div className="flex items-center gap-3">
                <Icon className="h-5 w-5 text-blue-500" />
                <div>
                  <p className="font-semibold">{runbook.title}</p>
                  <div className="flex gap-3 text-xs text-muted-foreground mt-1">
                    <span>
                      {t("dr.runbooks.scenario", "Scenario")}:{" "}
                      {runbook.scenarioType.replace(/_/g, " ")}
                    </span>
                    <span>
                      RTO: {runbook.estimatedRTO}{" "}
                      {t("dr.runbooks.minutes", "min")}
                    </span>
                    <span>v{runbook.version}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {runbook.lastReviewed && (
                  <span className="text-xs text-muted-foreground">
                    {t("dr.runbooks.reviewed", "Reviewed")}:{" "}
                    {formatRelativeTime(runbook.lastReviewed)}
                  </span>
                )}
                <ChevronLeft
                  className={`h-4 w-4 transition-transform ${
                    isExpanded ? "-rotate-90" : "rotate-180"
                  }`}
                />
              </div>
            </button>

            {/* Runbook Steps */}
            {isExpanded && (
              <div className="border-t p-4 bg-muted/30">
                <div className="space-y-4">
                  {runbook.steps.map((step, idx) => (
                    <div key={idx} className="flex gap-4">
                      {/* Step Number */}
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-sm font-bold text-blue-700 dark:text-blue-300">
                        {step.order}
                      </div>
                      {/* Step Content */}
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-medium">{step.title}</p>
                          {step.automated && (
                            <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded">
                              {t("dr.runbooks.automated", "Automated")}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {step.description}
                        </p>
                        <div className="flex gap-4 mt-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {step.estimatedMinutes}{" "}
                            {t("dr.runbooks.minutes", "min")}
                          </span>
                          <span>{step.responsible}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 pt-4 border-t flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {t("dr.runbooks.totalEstimatedRTO", "Total Estimated RTO")}:{" "}
                    <strong>{runbook.estimatedRTO} min</strong>
                  </span>
                  <span className="text-muted-foreground">
                    {t("dr.runbooks.steps", "Steps")}: {runbook.steps.length}
                  </span>
                </div>
              </div>
            )}
          </Card>
        );
      })}

      {(!runbooks || runbooks.length === 0) && (
        <Card className="p-6 text-center text-muted-foreground shadow-sm rounded-xl">
          {t("dr.runbooks.noRunbooks", "No runbooks configured")}
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Recovery Plan Tab
// ============================================================================

function RecoveryPlanTab() {
  const { t } = useTranslation();
  const { data: plan, isLoading } =
    trpc.disasterRecovery.getRecoveryPlan.useQuery();

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="p-6 animate-pulse shadow-sm rounded-xl">
            <div className="h-24 bg-muted rounded" />
          </Card>
        ))}
      </div>
    );
  }

  if (!plan) {
    return (
      <Card className="p-6 text-center text-muted-foreground shadow-sm rounded-xl">
        {t("dr.recovery.noplan", "No recovery plan configured")}
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Plan Overview */}
      <Card className="p-6 shadow-sm rounded-xl">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h3 className="font-semibold text-lg">
              {t("dr.recovery.planTitle", "Disaster Recovery Plan")}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t("dr.recovery.version", "Version")} {plan.version} -{" "}
              {t("dr.recovery.lastUpdated", "Last updated")}:{" "}
              {formatRelativeTime(plan.lastUpdated)}
            </p>
          </div>
          <div className="flex gap-4">
            <div className="text-center p-3 bg-blue-50 dark:bg-blue-950 rounded">
              <p className="text-xs text-muted-foreground">RPO Target</p>
              <p className="text-lg font-bold">{plan.rpoTarget} min</p>
            </div>
            <div className="text-center p-3 bg-purple-50 dark:bg-purple-950 rounded">
              <p className="text-xs text-muted-foreground">RTO Target</p>
              <p className="text-lg font-bold">{plan.rtoTarget} min</p>
            </div>
          </div>
        </div>

        {/* Priority Order */}
        <div className="mb-4">
          <p className="text-sm font-medium mb-2">
            {t("dr.recovery.priorityOrder", "Recovery Priority Order")}:
          </p>
          <div className="flex gap-2 flex-wrap">
            {plan.priorityOrder.map((item, idx) => (
              <span
                key={item}
                className="flex items-center gap-1 bg-muted px-3 py-1 rounded text-sm"
              >
                <span className="text-xs font-bold text-blue-600 dark:text-blue-400">
                  {idx + 1}
                </span>
                {item}
              </span>
            ))}
          </div>
        </div>
      </Card>

      {/* Components */}
      <Card className="p-6 shadow-sm rounded-xl">
        <h3 className="font-semibold text-lg mb-4">
          {t("dr.recovery.components", "Recovery Components")}
        </h3>
        <div className="space-y-4">
          {plan.components.map((comp, _idx) => (
            <div key={comp.name} className="p-4 border rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-xs font-bold text-blue-700 dark:text-blue-300">
                  {comp.priority}
                </span>
                <h4 className="font-semibold">{comp.name}</h4>
                <span className="text-xs bg-muted px-2 py-0.5 rounded">
                  {comp.estimatedRecoveryTime} min
                </span>
              </div>
              <p className="text-sm text-muted-foreground mb-2">
                {comp.recoveryStrategy}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">
                    {t("dr.recovery.backupLocation", "Backup")}:
                  </span>{" "}
                  <span className="font-mono">{comp.backupLocation}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">
                    {t("dr.recovery.contact", "Contact")}:
                  </span>{" "}
                  {comp.contactPerson}
                </div>
                {comp.dependencies.length > 0 && (
                  <div>
                    <span className="text-muted-foreground">
                      {t("dr.recovery.dependencies", "Depends on")}:
                    </span>{" "}
                    {comp.dependencies.join(", ")}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Communication Plan */}
      <Card className="p-6 shadow-sm rounded-xl">
        <h3 className="font-semibold text-lg mb-4">
          {t("dr.recovery.communicationPlan", "Communication Plan")}
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="p-3 text-start">#</th>
                <th className="p-3 text-start">
                  {t("dr.recovery.audience", "Audience")}
                </th>
                <th className="p-3 text-start">
                  {t("dr.recovery.channel", "Channel")}
                </th>
                <th className="p-3 text-start">
                  {t("dr.recovery.template", "Template")}
                </th>
                <th className="p-3 text-start">
                  {t("dr.recovery.within", "Within")}
                </th>
              </tr>
            </thead>
            <tbody>
              {plan.communicationPlan.map(step => (
                <tr key={step.order} className="border-t">
                  <td className="p-3 font-bold">{step.order}</td>
                  <td className="p-3 font-medium">{step.audience}</td>
                  <td className="p-3">{step.channel}</td>
                  <td className="p-3 text-muted-foreground text-xs max-w-xs">
                    {step.template}
                  </td>
                  <td className="p-3">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {step.withinMinutes} min
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Escalation Matrix */}
      <Card className="p-6 shadow-sm rounded-xl">
        <h3 className="font-semibold text-lg mb-4">
          {t("dr.recovery.escalationMatrix", "Escalation Matrix")}
        </h3>
        <div className="space-y-3">
          {plan.escalationMatrix.map(entry => (
            <div
              key={entry.level}
              className="flex items-center gap-4 p-3 rounded-lg bg-muted/50"
            >
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-orange-100 dark:bg-orange-900 flex items-center justify-center text-sm font-bold text-orange-700 dark:text-orange-300">
                L{entry.level}
              </div>
              <div className="flex-1">
                <p className="font-medium">{entry.role}</p>
                <p className="text-sm text-muted-foreground">
                  {entry.contactMethod}
                </p>
              </div>
              <div className="text-right">
                <span className="flex items-center gap-1 text-sm">
                  <Clock className="h-3 w-3" />
                  {entry.triggerAfterMinutes === 0
                    ? t("dr.recovery.immediate", "Immediate")
                    : `${t("dr.recovery.after", "After")} ${entry.triggerAfterMinutes} min`}
                </span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
