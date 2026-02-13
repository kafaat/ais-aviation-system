import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Link } from "wouter";
import {
  AlertTriangle,
  ChevronLeft,
  Shield,
  Users,
  Plane,
  Bell,
  ArrowUpCircle,
  CheckCircle,
  Clock,
  XCircle,
  Activity,
  Loader2,
  Send,
  Zap,
  BarChart3,
  Link2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

// ============================================================================
// Constants
// ============================================================================

const SEVERITY_CONFIG = {
  low: {
    bg: "bg-blue-50 dark:bg-blue-950",
    border: "border-blue-200 dark:border-blue-800",
    text: "text-blue-700 dark:text-blue-300",
    badge: "bg-blue-100 text-blue-700 border-blue-200",
    dot: "bg-blue-500",
    label: "Low",
  },
  medium: {
    bg: "bg-yellow-50 dark:bg-yellow-950",
    border: "border-yellow-200 dark:border-yellow-800",
    text: "text-yellow-700 dark:text-yellow-300",
    badge: "bg-yellow-100 text-yellow-700 border-yellow-200",
    dot: "bg-yellow-500",
    label: "Medium",
  },
  high: {
    bg: "bg-orange-50 dark:bg-orange-950",
    border: "border-orange-200 dark:border-orange-800",
    text: "text-orange-700 dark:text-orange-300",
    badge: "bg-orange-100 text-orange-700 border-orange-200",
    dot: "bg-orange-500",
    label: "High",
  },
  critical: {
    bg: "bg-red-50 dark:bg-red-950",
    border: "border-red-200 dark:border-red-800",
    text: "text-red-700 dark:text-red-300",
    badge: "bg-red-100 text-red-700 border-red-200",
    dot: "bg-red-500",
    label: "Critical",
  },
} as const;

const EVENT_TYPE_CONFIG = {
  delay: { icon: Clock, color: "text-orange-500", label: "Delay" },
  cancellation: { icon: XCircle, color: "text-red-500", label: "Cancellation" },
  diversion: { icon: Plane, color: "text-blue-500", label: "Diversion" },
  equipment_change: {
    icon: RefreshCw,
    color: "text-purple-500",
    label: "Equipment Change",
  },
} as const;

const ACTION_TYPE_LABELS: Record<string, string> = {
  rebook: "Rebooking",
  hotel: "Hotel Accommodation",
  compensation: "Compensation",
  notification: "Notification",
  meal_voucher: "Meal Voucher",
};

// i18n key mapping for action types (snake_case to camelCase)
const ACTION_TYPE_I18N_KEYS: Record<string, string> = {
  rebook: "rebook",
  hotel: "hotel",
  compensation: "compensation",
  notification: "notification",
  meal_voucher: "mealVoucher",
};

// i18n key mapping for action statuses (snake_case to camelCase)
const ACTION_STATUS_I18N_KEYS: Record<string, string> = {
  pending: "pending",
  in_progress: "inProgress",
  completed: "completed",
  failed: "failed",
};

// i18n key mapping for event types (snake_case to camelCase)
const EVENT_TYPE_I18N_KEYS: Record<string, string> = {
  delay: "delay",
  cancellation: "cancellation",
  diversion: "diversion",
  equipment_change: "equipmentChange",
};

const ACTION_STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  pending: { color: "bg-gray-100 text-gray-700", label: "Pending" },
  in_progress: { color: "bg-blue-100 text-blue-700", label: "In Progress" },
  completed: { color: "bg-green-100 text-green-700", label: "Completed" },
  failed: { color: "bg-red-100 text-red-700", label: "Failed" },
};

// ============================================================================
// Types
// ============================================================================

type Tab = "overview" | "events" | "passengers" | "connections" | "metrics";

// ============================================================================
// Main Component
// ============================================================================

export default function IROPSCommandCenter() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [selectedFlightId, setSelectedFlightId] = useState<number | null>(null);
  const [notificationMessage, setNotificationMessage] = useState("");
  const [escalateId, setEscalateId] = useState<number | null>(null);
  const [escalateLevel, setEscalateLevel] = useState<string>("high");

  const tabs: Array<{ id: Tab; label: string; icon: typeof Activity }> = [
    { id: "overview", label: t("irops.tabs.overview"), icon: Activity },
    { id: "events", label: t("irops.tabs.events"), icon: AlertTriangle },
    { id: "passengers", label: t("irops.tabs.passengers"), icon: Users },
    { id: "connections", label: t("irops.tabs.connections"), icon: Link2 },
    { id: "metrics", label: t("irops.tabs.metrics"), icon: BarChart3 },
  ];

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6 p-4 rounded-xl bg-gradient-to-r from-slate-50 to-red-50/30 dark:from-slate-900 dark:to-red-950/20 border border-slate-200/60 dark:border-slate-800/60">
        <Link href="/admin">
          <Button variant="ghost" size="sm">
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-red-500" />
            {t("irops.title")}
          </h1>
          <p className="text-muted-foreground text-sm">{t("irops.subtitle")}</p>
        </div>
        <LiveIndicator />
      </div>

      {/* Tabs - Pill Style */}
      <div className="flex gap-1.5 mb-6 flex-wrap p-1 bg-muted/50 rounded-lg w-fit">
        {tabs.map(tab => {
          const Icon = tab.icon;
          return (
            <Button
              key={tab.id}
              variant={activeTab === tab.id ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveTab(tab.id)}
              className={`gap-2 rounded-md ${
                activeTab === tab.id ? "shadow-sm" : "hover:bg-background/60"
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </Button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === "overview" && (
        <OverviewTab
          onSelectFlight={setSelectedFlightId}
          onSwitchTab={setActiveTab}
        />
      )}
      {activeTab === "events" && (
        <EventsTab
          onSelectFlight={setSelectedFlightId}
          escalateId={escalateId}
          setEscalateId={setEscalateId}
          escalateLevel={escalateLevel}
          setEscalateLevel={setEscalateLevel}
        />
      )}
      {activeTab === "passengers" && (
        <PassengersTab
          selectedFlightId={selectedFlightId}
          setSelectedFlightId={setSelectedFlightId}
          notificationMessage={notificationMessage}
          setNotificationMessage={setNotificationMessage}
        />
      )}
      {activeTab === "connections" && (
        <ConnectionsTab
          selectedFlightId={selectedFlightId}
          setSelectedFlightId={setSelectedFlightId}
        />
      )}
      {activeTab === "metrics" && <MetricsTab />}
    </div>
  );
}

// ============================================================================
// Live Indicator
// ============================================================================

function LiveIndicator() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800">
      <span className="relative flex h-2.5 w-2.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
      </span>
      <span className="text-xs font-medium text-red-700 dark:text-red-300">
        {t("irops.live")}
      </span>
    </div>
  );
}

// ============================================================================
// Overview Tab
// ============================================================================

function OverviewTab({
  onSelectFlight,
  onSwitchTab,
}: {
  onSelectFlight: (id: number) => void;
  onSwitchTab: (tab: Tab) => void;
}) {
  const { t } = useTranslation();
  const {
    data: dashboard,
    isLoading,
    refetch,
  } = trpc.irops.getDashboard.useQuery(undefined, {
    retry: false,
    refetchInterval: 30000,
  });

  if (isLoading) {
    return <LoadingState message={t("irops.loadingDashboard")} />;
  }

  if (!dashboard) {
    return <EmptyState message={t("irops.unableToLoadDashboard")} />;
  }

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <KPICard
          title={t("irops.kpi.activeDisruptions")}
          value={dashboard.activeDisruptions}
          icon={AlertTriangle}
          color="text-red-500"
          bgColor="bg-gradient-to-br from-red-50 to-red-100/50 dark:from-red-950/50 dark:to-red-900/30"
        />
        <KPICard
          title={t("irops.kpi.passengersAffected")}
          value={dashboard.totalPassengersAffected}
          icon={Users}
          color="text-orange-500"
          bgColor="bg-gradient-to-br from-orange-50 to-orange-100/50 dark:from-orange-950/50 dark:to-orange-900/30"
        />
        <KPICard
          title={t("irops.kpi.connectionsAtRisk")}
          value={dashboard.connectionsAtRisk}
          icon={Link2}
          color="text-yellow-500"
          bgColor="bg-gradient-to-br from-yellow-50 to-yellow-100/50 dark:from-yellow-950/50 dark:to-yellow-900/30"
        />
        <KPICard
          title={t("irops.kpi.recoveryRate")}
          value={`${dashboard.recoveryRate}%`}
          icon={Activity}
          color="text-green-500"
          bgColor="bg-gradient-to-br from-green-50 to-green-100/50 dark:from-green-950/50 dark:to-green-900/30"
        />
        <KPICard
          title={t("irops.kpi.criticalEvents")}
          value={dashboard.criticalEvents}
          icon={Zap}
          color="text-red-600"
          bgColor="bg-gradient-to-br from-red-50 to-red-100/50 dark:from-red-950/50 dark:to-red-900/30"
          highlight={dashboard.criticalEvents > 0}
        />
      </div>

      {/* Severity Breakdown */}
      <Card className="p-6 rounded-xl shadow-sm">
        <h3 className="font-semibold mb-4">{t("irops.severityBreakdown")}</h3>
        <div className="grid grid-cols-4 gap-3">
          {(
            Object.entries(dashboard.severityBreakdown) as Array<
              [keyof typeof SEVERITY_CONFIG, number]
            >
          ).map(([severity, count]) => {
            const config = SEVERITY_CONFIG[severity];
            return (
              <div
                key={severity}
                className={`rounded-lg p-3 border ${config.bg} ${config.border}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`h-2.5 w-2.5 rounded-full ${config.dot}`} />
                  <span
                    className={`text-sm font-medium capitalize ${config.text}`}
                  >
                    {t(`irops.severity.${severity}`)}
                  </span>
                </div>
                <p className={`text-2xl font-bold ${config.text}`}>{count}</p>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Two columns: Recent Events + Recent Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Events */}
        <Card className="p-6 rounded-xl shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">{t("irops.recentEvents")}</h3>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onSwitchTab("events")}
            >
              {t("irops.viewAll")}
            </Button>
          </div>
          <div className="space-y-3">
            {dashboard.recentEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                {t("irops.noActiveEvents")}
              </p>
            ) : (
              dashboard.recentEvents.slice(0, 5).map(event => (
                <EventCard
                  key={event.id}
                  event={event}
                  compact
                  onSelect={() => {
                    onSelectFlight(event.flightId);
                    onSwitchTab("events");
                  }}
                />
              ))
            )}
          </div>
        </Card>

        {/* Recent Actions Timeline */}
        <Card className="p-6 rounded-xl shadow-sm hover:shadow-md transition-shadow">
          <h3 className="font-semibold mb-4">{t("irops.actionsTimeline")}</h3>
          <div className="space-y-3 max-h-[400px] overflow-y-auto">
            {dashboard.recentActions.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                {t("irops.noRecentActions")}
              </p>
            ) : (
              dashboard.recentActions
                .slice(0, 10)
                .map(action => (
                  <ActionTimelineItem key={action.id} action={action} />
                ))
            )}
          </div>
        </Card>
      </div>

      {/* Refresh button */}
      <div className="flex justify-center">
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          className="gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          {t("irops.refreshDashboard")}
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// Events Tab
// ============================================================================

function EventsTab({
  onSelectFlight,
  escalateId,
  setEscalateId,
  escalateLevel,
  setEscalateLevel,
}: {
  onSelectFlight: (id: number) => void;
  escalateId: number | null;
  setEscalateId: (id: number | null) => void;
  escalateLevel: string;
  setEscalateLevel: (level: string) => void;
}) {
  const { t } = useTranslation();
  const {
    data: events,
    isLoading,
    refetch,
  } = trpc.irops.getActiveDisruptions.useQuery(undefined, {
    retry: false,
    refetchInterval: 15000,
  });

  const triggerProtection = trpc.irops.triggerAutoProtection.useMutation({
    onSuccess: data => {
      toast.success(
        t("irops.protectionTriggered", {
          actions: data.actionsCreated,
          passengers: data.passengersProtected,
        })
      );
      refetch();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const escalateMutation = trpc.irops.escalate.useMutation({
    onSuccess: data => {
      toast.success(t("irops.escalatedTo", { level: data.severity }));
      setEscalateId(null);
      refetch();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const resolveEvent = trpc.irops.resolveEvent.useMutation({
    onSuccess: () => {
      toast.success(t("irops.eventResolved"));
      refetch();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  if (isLoading) {
    return <LoadingState message={t("irops.loadingEvents")} />;
  }

  if (!events || events.length === 0) {
    return (
      <Card className="p-12 text-center rounded-xl shadow-sm">
        <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
        <h3 className="text-lg font-semibold mb-2">{t("irops.allClear")}</h3>
        <p className="text-muted-foreground">
          {t("irops.noActiveDisruptions")}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">
          {events.length !== 1
            ? t("irops.activeEventsPlural", { count: events.length })
            : t("irops.activeEvents", { count: events.length })}
        </h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          className="gap-2"
        >
          <RefreshCw className="h-4 w-4" />
          {t("irops.refresh")}
        </Button>
      </div>

      {events.map(event => (
        <Card
          key={event.id}
          className={`p-5 border-l-4 rounded-xl shadow-sm hover:shadow-md transition-shadow ${
            SEVERITY_CONFIG[event.severity as keyof typeof SEVERITY_CONFIG]
              ?.border ?? "border-gray-200"
          }`}
        >
          <EventCard
            event={event}
            compact={false}
            onSelect={() => onSelectFlight(event.flightId)}
          />

          {/* Action Buttons */}
          <Separator className="my-4" />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() =>
                triggerProtection.mutate({ flightId: event.flightId })
              }
              disabled={triggerProtection.isPending}
            >
              {triggerProtection.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Shield className="h-3.5 w-3.5" />
              )}
              {t("irops.autoProtect")}
            </Button>

            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => onSelectFlight(event.flightId)}
            >
              <Users className="h-3.5 w-3.5" />
              {t("irops.viewPassengers")}
            </Button>

            {escalateId === event.id ? (
              <div className="flex items-center gap-2">
                <Select value={escalateLevel} onValueChange={setEscalateLevel}>
                  <SelectTrigger className="w-[120px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">
                      {t("irops.severity.low")}
                    </SelectItem>
                    <SelectItem value="medium">
                      {t("irops.severity.medium")}
                    </SelectItem>
                    <SelectItem value="high">
                      {t("irops.severity.high")}
                    </SelectItem>
                    <SelectItem value="critical">
                      {t("irops.severity.critical")}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() =>
                    escalateMutation.mutate({
                      disruptionId: event.id,
                      level: escalateLevel as
                        | "low"
                        | "medium"
                        | "high"
                        | "critical",
                    })
                  }
                  disabled={escalateMutation.isPending}
                >
                  {t("irops.confirm")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEscalateId(null)}
                >
                  {t("irops.cancel")}
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-orange-600 border-orange-200 hover:bg-orange-50"
                onClick={() => setEscalateId(event.id)}
              >
                <ArrowUpCircle className="h-3.5 w-3.5" />
                {t("irops.escalate")}
              </Button>
            )}

            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-green-600 border-green-200 hover:bg-green-50"
              onClick={() => resolveEvent.mutate({ eventId: event.id })}
              disabled={resolveEvent.isPending}
            >
              {resolveEvent.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle className="h-3.5 w-3.5" />
              )}
              {t("irops.resolve")}
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ============================================================================
// Passengers Tab
// ============================================================================

function PassengersTab({
  selectedFlightId,
  setSelectedFlightId,
  notificationMessage,
  setNotificationMessage,
}: {
  selectedFlightId: number | null;
  setSelectedFlightId: (id: number | null) => void;
  notificationMessage: string;
  setNotificationMessage: (msg: string) => void;
}) {
  const { t } = useTranslation();
  const [flightIdInput, setFlightIdInput] = useState(
    selectedFlightId?.toString() ?? ""
  );

  const queryFlightId = selectedFlightId ?? 0;

  const { data: passengers, isLoading } =
    trpc.irops.getAffectedPassengers.useQuery(
      { flightId: queryFlightId },
      { enabled: queryFlightId > 0, retry: false }
    );

  const sendNotification = trpc.irops.sendNotification.useMutation({
    onSuccess: data => {
      toast.success(
        t("irops.notificationsSent", {
          sent: data.notificationsSent,
          failed: data.failedCount,
        })
      );
      setNotificationMessage("");
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const handleLoadPassengers = () => {
    const id = parseInt(flightIdInput);
    if (!isNaN(id) && id > 0) {
      setSelectedFlightId(id);
    }
  };

  return (
    <div className="space-y-6">
      {/* Flight selection */}
      <Card className="p-4 rounded-xl shadow-sm">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Label htmlFor="flightId" className="text-sm">
              {t("irops.flightId")}
            </Label>
            <Input
              id="flightId"
              type="number"
              placeholder={t("irops.enterFlightId")}
              value={flightIdInput}
              onChange={e => setFlightIdInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleLoadPassengers()}
            />
          </div>
          <Button onClick={handleLoadPassengers} className="gap-2">
            <Users className="h-4 w-4" />
            {t("irops.loadPassengers")}
          </Button>
        </div>
      </Card>

      {isLoading && queryFlightId > 0 && (
        <LoadingState message={t("irops.loadingPassengers")} />
      )}

      {passengers && passengers.length > 0 && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="p-4 rounded-xl shadow-sm hover:shadow-md transition-shadow bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-slate-950/50 dark:to-slate-900/30">
              <p className="text-sm text-muted-foreground">
                {t("irops.totalPassengers")}
              </p>
              <p className="text-2xl font-bold">{passengers.length}</p>
            </Card>
            <Card className="p-4 rounded-xl shadow-sm hover:shadow-md transition-shadow bg-gradient-to-br from-orange-50 to-orange-100/50 dark:from-orange-950/50 dark:to-orange-900/30">
              <p className="text-sm text-muted-foreground">
                {t("irops.withConnections")}
              </p>
              <p className="text-2xl font-bold text-orange-500">
                {passengers.filter(p => p.hasConnection).length}
              </p>
            </Card>
            <Card className="p-4 rounded-xl shadow-sm hover:shadow-md transition-shadow bg-gradient-to-br from-purple-50 to-purple-100/50 dark:from-purple-950/50 dark:to-purple-900/30">
              <p className="text-sm text-muted-foreground">
                {t("irops.businessClass")}
              </p>
              <p className="text-2xl font-bold text-purple-500">
                {passengers.filter(p => p.cabinClass === "business").length}
              </p>
            </Card>
          </div>

          {/* Notification Panel */}
          <Card className="p-4 rounded-xl shadow-sm">
            <h4 className="font-semibold mb-3 flex items-center gap-2">
              <Bell className="h-4 w-4" />
              {t("irops.massNotification")}
            </h4>
            <div className="flex gap-3">
              <Input
                placeholder={t("irops.typeNotification")}
                value={notificationMessage}
                onChange={e => setNotificationMessage(e.target.value)}
                className="flex-1"
              />
              <Button
                onClick={() =>
                  sendNotification.mutate({
                    flightId: queryFlightId,
                    message: notificationMessage,
                  })
                }
                disabled={
                  sendNotification.isPending || notificationMessage.length < 10
                }
                className="gap-2"
              >
                {sendNotification.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {t("irops.sendToAll")}
              </Button>
            </div>
          </Card>

          {/* Passenger List */}
          <Card className="p-0 overflow-hidden rounded-xl shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3 font-medium">
                      {t("irops.passenger")}
                    </th>
                    <th className="text-left p-3 font-medium">
                      {t("irops.booking")}
                    </th>
                    <th className="text-left p-3 font-medium">
                      {t("irops.class")}
                    </th>
                    <th className="text-left p-3 font-medium">
                      {t("irops.seat")}
                    </th>
                    <th className="text-left p-3 font-medium">
                      {t("irops.connection")}
                    </th>
                    <th className="text-left p-3 font-medium">
                      {t("irops.contact")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {passengers.map(pax => (
                    <tr
                      key={pax.passengerId}
                      className={
                        pax.hasConnection
                          ? "bg-orange-50/50 dark:bg-orange-950/20"
                          : ""
                      }
                    >
                      <td className="p-3">
                        <div className="font-medium">
                          {pax.firstName} {pax.lastName}
                        </div>
                        <span className="text-xs text-muted-foreground capitalize">
                          {pax.type}
                        </span>
                      </td>
                      <td className="p-3">
                        <Badge variant="outline" className="font-mono text-xs">
                          {pax.bookingReference}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <Badge
                          className={
                            pax.cabinClass === "business"
                              ? "bg-purple-100 text-purple-700"
                              : "bg-gray-100 text-gray-700"
                          }
                        >
                          {pax.cabinClass === "business" ? "J" : "Y"}
                        </Badge>
                      </td>
                      <td className="p-3 font-mono text-xs">
                        {pax.seatNumber ?? "-"}
                      </td>
                      <td className="p-3">
                        {pax.hasConnection ? (
                          <div className="flex items-center gap-1.5">
                            <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />
                            <span className="text-xs font-medium text-orange-600">
                              {pax.connectionFlightNumber}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {t("irops.none")}
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground truncate max-w-[180px]">
                        {pax.contactEmail ?? "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {passengers && passengers.length === 0 && queryFlightId > 0 && (
        <EmptyState message={t("irops.noPassengersFound")} />
      )}

      {!selectedFlightId && (
        <EmptyState message={t("irops.enterFlightIdPassengers")} />
      )}
    </div>
  );
}

// ============================================================================
// Connections at Risk Tab
// ============================================================================

function ConnectionsTab({
  selectedFlightId,
  setSelectedFlightId,
}: {
  selectedFlightId: number | null;
  setSelectedFlightId: (id: number | null) => void;
}) {
  const { t } = useTranslation();
  const [flightIdInput, setFlightIdInput] = useState(
    selectedFlightId?.toString() ?? ""
  );

  const queryFlightId = selectedFlightId ?? 0;

  const { data: connections, isLoading } =
    trpc.irops.getConnectionsAtRisk.useQuery(
      { flightId: queryFlightId },
      { enabled: queryFlightId > 0, retry: false }
    );

  const handleLoad = () => {
    const id = parseInt(flightIdInput);
    if (!isNaN(id) && id > 0) {
      setSelectedFlightId(id);
    }
  };

  const riskColors = {
    low: "bg-blue-100 text-blue-700",
    medium: "bg-yellow-100 text-yellow-700",
    high: "bg-orange-100 text-orange-700",
    critical: "bg-red-100 text-red-700",
  };

  return (
    <div className="space-y-6">
      {/* Flight selection */}
      <Card className="p-4 rounded-xl shadow-sm">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Label htmlFor="connFlightId" className="text-sm">
              {t("irops.flightId")}
            </Label>
            <Input
              id="connFlightId"
              type="number"
              placeholder={t("irops.enterFlightId")}
              value={flightIdInput}
              onChange={e => setFlightIdInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleLoad()}
            />
          </div>
          <Button onClick={handleLoad} className="gap-2">
            <Link2 className="h-4 w-4" />
            {t("irops.checkConnections")}
          </Button>
        </div>
      </Card>

      {isLoading && queryFlightId > 0 && (
        <LoadingState message={t("irops.analyzingConnections")} />
      )}

      {connections && connections.length > 0 && (
        <>
          {/* Risk summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(["critical", "high", "medium", "low"] as const).map(level => {
              const count = connections.filter(
                c => c.riskLevel === level
              ).length;
              const config = SEVERITY_CONFIG[level];
              return (
                <Card
                  key={level}
                  className={`p-3 border rounded-xl shadow-sm ${config.bg} ${config.border}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`h-2 w-2 rounded-full ${config.dot}`} />
                    <span
                      className={`text-xs font-medium uppercase ${config.text}`}
                    >
                      {t(`irops.severity.${level}`)}
                    </span>
                  </div>
                  <p className={`text-xl font-bold ${config.text}`}>{count}</p>
                </Card>
              );
            })}
          </div>

          {/* Connection list */}
          <Card className="p-0 overflow-hidden rounded-xl shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3 font-medium">
                      {t("irops.risk")}
                    </th>
                    <th className="text-left p-3 font-medium">
                      {t("irops.passenger")}
                    </th>
                    <th className="text-left p-3 font-medium">
                      {t("irops.booking")}
                    </th>
                    <th className="text-left p-3 font-medium">
                      {t("irops.connectionFlight")}
                    </th>
                    <th className="text-left p-3 font-medium">
                      {t("irops.route")}
                    </th>
                    <th className="text-left p-3 font-medium">
                      {t("irops.departure")}
                    </th>
                    <th className="text-left p-3 font-medium">
                      {t("irops.minutesUntil")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {connections.map((conn, idx) => (
                    <tr
                      key={`${conn.passengerId}-${idx}`}
                      className={
                        conn.riskLevel === "critical"
                          ? "bg-red-50/50 dark:bg-red-950/20"
                          : conn.riskLevel === "high"
                            ? "bg-orange-50/30 dark:bg-orange-950/10"
                            : ""
                      }
                    >
                      <td className="p-3">
                        <Badge
                          className={`text-xs ${riskColors[conn.riskLevel]}`}
                        >
                          {conn.riskLevel.toUpperCase()}
                        </Badge>
                      </td>
                      <td className="p-3 font-medium">{conn.passengerName}</td>
                      <td className="p-3">
                        <Badge variant="outline" className="font-mono text-xs">
                          {conn.bookingReference}
                        </Badge>
                      </td>
                      <td className="p-3 font-mono text-xs">
                        {conn.connectionFlightNumber}
                      </td>
                      <td className="p-3 text-xs">
                        {conn.connectionOrigin} &rarr;{" "}
                        {conn.connectionDestination}
                      </td>
                      <td className="p-3 text-xs">
                        {new Date(conn.connectionDepartureTime).toLocaleString(
                          [],
                          {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          }
                        )}
                      </td>
                      <td className="p-3">
                        <span
                          className={`text-sm font-bold ${
                            conn.minutesUntilConnection < 60
                              ? "text-red-600"
                              : conn.minutesUntilConnection < 90
                                ? "text-orange-600"
                                : "text-muted-foreground"
                          }`}
                        >
                          {conn.minutesUntilConnection < 0
                            ? t("irops.missed")
                            : `${conn.minutesUntilConnection}m`}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {connections && connections.length === 0 && queryFlightId > 0 && (
        <Card className="p-12 text-center rounded-xl shadow-sm">
          <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">
            {t("irops.noConnectionsAtRisk")}
          </h3>
          <p className="text-muted-foreground">
            {t("irops.noConnectionsMessage")}
          </p>
        </Card>
      )}

      {!selectedFlightId && (
        <EmptyState message={t("irops.enterFlightIdConnections")} />
      )}
    </div>
  );
}

// ============================================================================
// Metrics Tab
// ============================================================================

function MetricsTab() {
  const { t } = useTranslation();
  const now = new Date();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: metrics, isLoading } = trpc.irops.getRecoveryMetrics.useQuery(
    { start: thirtyDaysAgo, end: now },
    { retry: false }
  );

  if (isLoading) {
    return <LoadingState message={t("irops.loadingMetrics")} />;
  }

  if (!metrics) {
    return <EmptyState message={t("irops.unableToLoadMetrics")} />;
  }

  return (
    <div className="space-y-6">
      <Card className="p-6 rounded-xl shadow-sm">
        <h3 className="font-semibold mb-1">{t("irops.recoveryPerformance")}</h3>
        <p className="text-sm text-muted-foreground mb-6">
          {t("irops.last30Days")}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            label={t("irops.totalEvents")}
            value={metrics.totalEvents}
            subLabel={t("irops.disruptionsReported")}
          />
          <MetricCard
            label={t("irops.resolved")}
            value={metrics.resolvedEvents}
            subLabel={t("irops.ofEvents", { count: metrics.totalEvents })}
          />
          <MetricCard
            label={t("irops.avgResolution")}
            value={`${metrics.avgResolutionMinutes}m`}
            subLabel={t("irops.avgTimeToResolve")}
          />
          <MetricCard
            label={t("irops.kpi.recoveryRate")}
            value={`${metrics.recoveryRatePercent}%`}
            subLabel={t("irops.eventsFullyResolved")}
            highlight={metrics.recoveryRatePercent >= 90}
          />
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-6 rounded-xl shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950 dark:to-blue-900/30">
              <Plane className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">
                {t("irops.rebookingSuccess")}
              </p>
              <p className="text-2xl font-bold">{metrics.rebookingSuccess}</p>
            </div>
          </div>
          <ProgressBar
            value={metrics.rebookingSuccess}
            max={Math.max(metrics.totalEvents, 1)}
            color="bg-blue-500"
          />
        </Card>

        <Card className="p-6 rounded-xl shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-gradient-to-br from-green-50 to-green-100/50 dark:from-green-950 dark:to-green-900/30">
              <CheckCircle className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">
                {t("irops.compensationIssued")}
              </p>
              <p className="text-2xl font-bold">{metrics.compensationIssued}</p>
            </div>
          </div>
          <ProgressBar
            value={metrics.compensationIssued}
            max={Math.max(metrics.totalEvents, 1)}
            color="bg-green-500"
          />
        </Card>

        <Card className="p-6 rounded-xl shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-gradient-to-br from-purple-50 to-purple-100/50 dark:from-purple-950 dark:to-purple-900/30">
              <Users className="h-5 w-5 text-purple-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">
                {t("irops.passengersRecovered")}
              </p>
              <p className="text-2xl font-bold">
                {metrics.passengersRecovered}
              </p>
            </div>
          </div>
          <ProgressBar
            value={metrics.passengersRecovered}
            max={Math.max(metrics.totalEvents * 5, 1)}
            color="bg-purple-500"
          />
        </Card>
      </div>
    </div>
  );
}

// ============================================================================
// Shared Sub-Components
// ============================================================================

function KPICard({
  title,
  value,
  icon: Icon,
  color,
  bgColor,
  highlight = false,
}: {
  title: string;
  value: string | number;
  icon: typeof Activity;
  color: string;
  bgColor: string;
  highlight?: boolean;
}) {
  return (
    <Card
      className={`p-4 rounded-xl shadow-sm hover:shadow-md transition-shadow ${highlight ? "ring-2 ring-red-300 dark:ring-red-700" : ""}`}
    >
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${bgColor}`}>
          <Icon className={`h-5 w-5 ${color}`} />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{title}</p>
          <p className="text-xl font-bold">{value}</p>
        </div>
      </div>
    </Card>
  );
}

function EventCard({
  event,
  compact,
  onSelect,
}: {
  event: {
    id: number;
    flightId: number;
    eventType: string;
    severity: string;
    delayMinutes?: number | null;
    reason: string;
    affectedPassengers: number;
    connectionsAtRisk: number;
    status: string;
    flightNumber?: string;
    origin?: string;
    destination?: string;
    departureTime?: Date | string;
    createdAt: Date | string;
  };
  compact: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const typeConfig =
    EVENT_TYPE_CONFIG[event.eventType as keyof typeof EVENT_TYPE_CONFIG] ??
    EVENT_TYPE_CONFIG.delay;
  const TypeIcon = typeConfig.icon;
  const severityConfig =
    SEVERITY_CONFIG[event.severity as keyof typeof SEVERITY_CONFIG] ??
    SEVERITY_CONFIG.medium;

  const _eventTypeKey =
    EVENT_TYPE_I18N_KEYS[event.eventType] ?? event.eventType;
  const severityKey = event.severity as keyof typeof SEVERITY_CONFIG;

  return (
    <div
      className={`${compact ? "p-3 border rounded-lg hover:bg-muted/50 cursor-pointer" : ""}`}
      onClick={compact ? onSelect : undefined}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <TypeIcon className={`h-4 w-4 ${typeConfig.color}`} />
          <span className="font-medium text-sm">
            {event.flightNumber ?? `Flight #${event.flightId}`}
          </span>
          {event.origin && event.destination && (
            <span className="text-xs text-muted-foreground">
              {event.origin} &rarr; {event.destination}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge className={`text-xs ${severityConfig.badge}`}>
            {t(`irops.severity.${severityKey}`)}
          </Badge>
          {event.status === "recovering" && (
            <Badge className="bg-blue-100 text-blue-700 text-xs">
              {t("irops.recovering")}
            </Badge>
          )}
        </div>
      </div>

      <p className="text-sm text-muted-foreground mb-2">{event.reason}</p>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Users className="h-3 w-3" />
          {event.affectedPassengers} {t("irops.pax")}
        </span>
        {event.connectionsAtRisk > 0 && (
          <span className="flex items-center gap-1 text-orange-500">
            <Link2 className="h-3 w-3" />
            {event.connectionsAtRisk} {t("irops.atRisk")}
          </span>
        )}
        {event.delayMinutes && event.delayMinutes > 0 && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {t("irops.minDelay", { min: event.delayMinutes })}
          </span>
        )}
        <span>
          {new Date(event.createdAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
    </div>
  );
}

function ActionTimelineItem({
  action,
}: {
  action: {
    id: number;
    actionType: string;
    status: string;
    details: Record<string, unknown>;
    createdAt: Date | string;
  };
}) {
  const { t } = useTranslation();
  const statusConfig =
    ACTION_STATUS_CONFIG[action.status] ?? ACTION_STATUS_CONFIG.pending;

  const actionTypeKey =
    ACTION_TYPE_I18N_KEYS[action.actionType] ?? action.actionType;
  const actionStatusKey =
    ACTION_STATUS_I18N_KEYS[action.status] ?? action.status;

  return (
    <div className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted/50">
      <div className="mt-0.5">
        <span
          className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${statusConfig.color}`}
        >
          {action.status === "completed" ? (
            <CheckCircle className="h-3.5 w-3.5" />
          ) : action.status === "failed" ? (
            <XCircle className="h-3.5 w-3.5" />
          ) : (
            <Clock className="h-3.5 w-3.5" />
          )}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">
            {t(`irops.actions.${actionTypeKey}`, {
              defaultValue:
                ACTION_TYPE_LABELS[action.actionType] ?? action.actionType,
            })}
          </span>
          <Badge className={`text-xs ${statusConfig.color}`}>
            {t(`irops.actionStatus.${actionStatusKey}`, {
              defaultValue: statusConfig.label,
            })}
          </Badge>
        </div>
        {action.details.passengerName ? (
          <p className="text-xs text-muted-foreground truncate">
            {String(action.details.passengerName)}
          </p>
        ) : null}
        {action.details.message ? (
          <p className="text-xs text-muted-foreground truncate">
            {String(action.details.message)}
          </p>
        ) : null}
      </div>
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {new Date(action.createdAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>
    </div>
  );
}

function MetricCard({
  label,
  value,
  subLabel,
  highlight = false,
}: {
  label: string;
  value: string | number;
  subLabel: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`p-4 rounded-lg border ${
        highlight
          ? "bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800"
          : "bg-muted/30"
      }`}
    >
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold ${highlight ? "text-green-600" : ""}`}>
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{subLabel}</p>
    </div>
  );
}

function ProgressBar({
  value,
  max,
  color,
}: {
  value: number;
  max: number;
  color: string;
}) {
  const percent = Math.min(Math.round((value / max) * 100), 100);

  return (
    <div className="w-full bg-muted rounded-full h-2">
      <div
        className={`h-2 rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

function LoadingState({ message }: { message: string }) {
  return (
    <Card className="p-12 rounded-xl">
      <div className="flex flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </Card>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <Card className="p-12 text-center rounded-xl">
      <Activity className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
      <p className="text-muted-foreground">{message}</p>
    </Card>
  );
}
