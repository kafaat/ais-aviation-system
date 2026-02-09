import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import { useAuth } from "@/_core/hooks/useAuth";
import { Redirect } from "wouter";
import {
  Luggage,
  CheckCircle2,
  XCircle,
  Wrench,
  BarChart3,
  Package,
  Activity,
  Settings,
} from "lucide-react";

// ============================================================================
// Types
// ============================================================================

interface BagDropStation {
  id: number;
  stationCode: string;
  terminal: string;
  airportId: number;
  airportCode: string;
  status: "online" | "offline" | "maintenance" | "error";
  bagsProcessed: number;
  lastActivityAt: string | null;
  firmwareVersion: string;
  installedAt: string;
}

interface BagDropAnalytics {
  totalSessions: number;
  successfulSessions: number;
  failedSessions: number;
  averageProcessingTime: number;
  peakHour: number;
  excessBaggageRevenue: number;
  hourlyBreakdown: Array<{
    hour: number;
    sessions: number;
    avgTime: number;
  }>;
}

interface MaintenanceLog {
  id: number;
  stationId: number;
  stationCode: string;
  type: "scheduled" | "emergency" | "firmware_update" | "calibration";
  description: string;
  performedBy: string;
  performedAt: string;
  resolvedAt: string | null;
  status: "pending" | "in_progress" | "completed";
}

// ============================================================================
// Mock Data
// ============================================================================

const MOCK_STATIONS: BagDropStation[] = [
  {
    id: 1,
    stationCode: "BD-T1-01",
    terminal: "Terminal 1",
    airportId: 1,
    airportCode: "RUH",
    status: "online",
    bagsProcessed: 342,
    lastActivityAt: new Date().toISOString(),
    firmwareVersion: "3.2.1",
    installedAt: "2025-06-15T00:00:00Z",
  },
  {
    id: 2,
    stationCode: "BD-T1-02",
    terminal: "Terminal 1",
    airportId: 1,
    airportCode: "RUH",
    status: "online",
    bagsProcessed: 289,
    lastActivityAt: new Date().toISOString(),
    firmwareVersion: "3.2.1",
    installedAt: "2025-06-15T00:00:00Z",
  },
  {
    id: 3,
    stationCode: "BD-T1-03",
    terminal: "Terminal 1",
    airportId: 1,
    airportCode: "RUH",
    status: "maintenance",
    bagsProcessed: 0,
    lastActivityAt: "2026-02-08T14:30:00Z",
    firmwareVersion: "3.1.9",
    installedAt: "2025-06-15T00:00:00Z",
  },
  {
    id: 4,
    stationCode: "BD-T2-01",
    terminal: "Terminal 2",
    airportId: 1,
    airportCode: "RUH",
    status: "online",
    bagsProcessed: 198,
    lastActivityAt: new Date().toISOString(),
    firmwareVersion: "3.2.1",
    installedAt: "2025-08-01T00:00:00Z",
  },
  {
    id: 5,
    stationCode: "BD-T2-02",
    terminal: "Terminal 2",
    airportId: 1,
    airportCode: "RUH",
    status: "offline",
    bagsProcessed: 0,
    lastActivityAt: "2026-02-07T22:15:00Z",
    firmwareVersion: "3.2.0",
    installedAt: "2025-08-01T00:00:00Z",
  },
  {
    id: 6,
    stationCode: "BD-T1-01",
    terminal: "Terminal 1",
    airportId: 2,
    airportCode: "JED",
    status: "online",
    bagsProcessed: 256,
    lastActivityAt: new Date().toISOString(),
    firmwareVersion: "3.2.1",
    installedAt: "2025-09-10T00:00:00Z",
  },
  {
    id: 7,
    stationCode: "BD-T1-02",
    terminal: "Terminal 1",
    airportId: 2,
    airportCode: "JED",
    status: "online",
    bagsProcessed: 211,
    lastActivityAt: new Date().toISOString(),
    firmwareVersion: "3.2.1",
    installedAt: "2025-09-10T00:00:00Z",
  },
  {
    id: 8,
    stationCode: "BD-T1-03",
    terminal: "Terminal 1",
    airportId: 2,
    airportCode: "JED",
    status: "error",
    bagsProcessed: 47,
    lastActivityAt: "2026-02-09T08:45:00Z",
    firmwareVersion: "3.2.1",
    installedAt: "2025-09-10T00:00:00Z",
  },
];

const MOCK_ANALYTICS: BagDropAnalytics = {
  totalSessions: 1843,
  successfulSessions: 1756,
  failedSessions: 87,
  averageProcessingTime: 94,
  peakHour: 8,
  excessBaggageRevenue: 2450000,
  hourlyBreakdown: [
    { hour: 5, sessions: 42, avgTime: 88 },
    { hour: 6, sessions: 128, avgTime: 91 },
    { hour: 7, sessions: 215, avgTime: 96 },
    { hour: 8, sessions: 287, avgTime: 102 },
    { hour: 9, sessions: 198, avgTime: 95 },
    { hour: 10, sessions: 156, avgTime: 89 },
    { hour: 11, sessions: 134, avgTime: 87 },
    { hour: 12, sessions: 112, avgTime: 85 },
    { hour: 13, sessions: 98, avgTime: 84 },
    { hour: 14, sessions: 125, avgTime: 90 },
    { hour: 15, sessions: 148, avgTime: 93 },
    { hour: 16, sessions: 104, avgTime: 91 },
    { hour: 17, sessions: 56, avgTime: 86 },
    { hour: 18, sessions: 40, avgTime: 82 },
  ],
};

const MOCK_MAINTENANCE: MaintenanceLog[] = [
  {
    id: 1,
    stationId: 3,
    stationCode: "BD-T1-03",
    type: "scheduled",
    description: "Belt motor replacement and calibration",
    performedBy: "Ahmed Al-Rashid",
    performedAt: "2026-02-08T14:30:00Z",
    resolvedAt: null,
    status: "in_progress",
  },
  {
    id: 2,
    stationId: 5,
    stationCode: "BD-T2-02",
    type: "emergency",
    description: "Scale sensor malfunction - zero-point drift detected",
    performedBy: "Mohammed Tariq",
    performedAt: "2026-02-07T22:15:00Z",
    resolvedAt: null,
    status: "pending",
  },
  {
    id: 3,
    stationId: 8,
    stationCode: "BD-T1-03 (JED)",
    type: "emergency",
    description:
      "Barcode scanner hardware failure - unable to read boarding passes",
    performedBy: "Khalid Bin Saeed",
    performedAt: "2026-02-09T08:45:00Z",
    resolvedAt: null,
    status: "in_progress",
  },
  {
    id: 4,
    stationId: 1,
    stationCode: "BD-T1-01",
    type: "firmware_update",
    description: "Firmware upgraded from v3.2.0 to v3.2.1",
    performedBy: "System",
    performedAt: "2026-02-05T03:00:00Z",
    resolvedAt: "2026-02-05T03:12:00Z",
    status: "completed",
  },
  {
    id: 5,
    stationId: 2,
    stationCode: "BD-T1-02",
    type: "calibration",
    description: "Weight scale recalibration - annual maintenance",
    performedBy: "Ahmed Al-Rashid",
    performedAt: "2026-02-03T10:00:00Z",
    resolvedAt: "2026-02-03T10:45:00Z",
    status: "completed",
  },
  {
    id: 6,
    stationId: 4,
    stationCode: "BD-T2-01",
    type: "firmware_update",
    description: "Firmware upgraded from v3.2.0 to v3.2.1",
    performedBy: "System",
    performedAt: "2026-02-05T03:00:00Z",
    resolvedAt: "2026-02-05T03:15:00Z",
    status: "completed",
  },
];

// ============================================================================
// Helper: get locale for date-fns
// ============================================================================

function useDateLocale() {
  const { i18n } = useTranslation();
  return i18n.language === "ar" ? ar : enUS;
}

// ============================================================================
// Status badge component
// ============================================================================

function StationStatusBadge({ status }: { status: BagDropStation["status"] }) {
  const { t } = useTranslation();

  const config: Record<
    BagDropStation["status"],
    {
      variant: "default" | "secondary" | "destructive" | "outline";
      label: string;
    }
  > = {
    online: {
      variant: "default",
      label: t("bagDrop.status.online", "Online"),
    },
    offline: {
      variant: "secondary",
      label: t("bagDrop.status.offline", "Offline"),
    },
    maintenance: {
      variant: "outline",
      label: t("bagDrop.status.maintenance", "Maintenance"),
    },
    error: {
      variant: "destructive",
      label: t("bagDrop.status.error", "Error"),
    },
  };

  const c = config[status];
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

function MaintenanceStatusBadge({
  status,
}: {
  status: MaintenanceLog["status"];
}) {
  const { t } = useTranslation();

  const config: Record<
    MaintenanceLog["status"],
    {
      variant: "default" | "secondary" | "destructive" | "outline";
      label: string;
    }
  > = {
    pending: {
      variant: "destructive",
      label: t("bagDrop.maintenanceStatus.pending", "Pending"),
    },
    in_progress: {
      variant: "outline",
      label: t("bagDrop.maintenanceStatus.inProgress", "In Progress"),
    },
    completed: {
      variant: "default",
      label: t("bagDrop.maintenanceStatus.completed", "Completed"),
    },
  };

  const c = config[status];
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

function MaintenanceTypeBadge({ type }: { type: MaintenanceLog["type"] }) {
  const { t } = useTranslation();

  const labels: Record<MaintenanceLog["type"], string> = {
    scheduled: t("bagDrop.maintenanceType.scheduled", "Scheduled"),
    emergency: t("bagDrop.maintenanceType.emergency", "Emergency"),
    firmware_update: t(
      "bagDrop.maintenanceType.firmwareUpdate",
      "Firmware Update"
    ),
    calibration: t("bagDrop.maintenanceType.calibration", "Calibration"),
  };

  const colors: Record<MaintenanceLog["type"], string> = {
    scheduled: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    emergency: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    firmware_update:
      "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    calibration:
      "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  };

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[type]}`}>
      {labels[type]}
    </span>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function BagDropManagement() {
  const { t, i18n } = useTranslation();
  const { user, loading } = useAuth();
  const dateLocale = useDateLocale();
  const [activeTab, setActiveTab] = useState("stations");
  const [searchQuery, setSearchQuery] = useState("");

  // ---------------------------------------------------------------------------
  // tRPC queries with mock fallbacks
  // ---------------------------------------------------------------------------

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bdTrpc = (trpc as any).bagDrop as {
    getUnits: {
      useQuery: (
        input?: { airportId?: number },
        opts?: { enabled?: boolean }
      ) => {
        data: { units: BagDropStation[] } | undefined;
        isLoading: boolean;
        refetch: () => void;
      };
    };
    getUnitStatus: {
      useQuery: (
        input: { unitId: number },
        opts?: { enabled?: boolean }
      ) => {
        data: Record<string, unknown> | undefined;
        isLoading: boolean;
      };
    };
    getAnalytics: {
      useQuery: (
        input: { airportId: number; startDate: string; endDate: string },
        opts?: { enabled?: boolean }
      ) => {
        data: BagDropAnalytics | undefined;
        isLoading: boolean;
      };
    };
  };

  const {
    data: unitsData,
    isLoading: unitsLoading,
    refetch: refetchUnits,
  } = bdTrpc.getUnits.useQuery(undefined, { enabled: true });

  // Use API data if available, otherwise fall back to mock data
  const stations: BagDropStation[] = unitsData?.units ?? MOCK_STATIONS;

  const today = new Date();
  const startOfDay = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  const { data: analyticsData, isLoading: analyticsLoading } =
    bdTrpc.getAnalytics.useQuery(
      {
        airportId: 1,
        startDate: startOfDay.toISOString(),
        endDate: today.toISOString(),
      },
      { enabled: true }
    );

  const analytics: BagDropAnalytics = analyticsData ?? MOCK_ANALYTICS;
  const maintenanceLogs: MaintenanceLog[] = MOCK_MAINTENANCE;

  // ---------------------------------------------------------------------------
  // Computed values
  // ---------------------------------------------------------------------------

  const totalStations = stations.length;
  const activeStations = stations.filter(s => s.status === "online").length;
  const maintenanceStations = stations.filter(
    s => s.status === "maintenance"
  ).length;
  const bagsProcessedToday = stations.reduce(
    (sum, s) => sum + s.bagsProcessed,
    0
  );

  const filteredStations = stations.filter(s => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.stationCode.toLowerCase().includes(q) ||
      s.terminal.toLowerCase().includes(q) ||
      s.airportCode.toLowerCase().includes(q) ||
      s.status.toLowerCase().includes(q)
    );
  });

  // ---------------------------------------------------------------------------
  // Auth guard
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="container mx-auto p-6 max-w-7xl">
        <div className="space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
    return <Redirect to="/" />;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="container mx-auto p-6 max-w-7xl page-enter">
      <SEO
        title={t("bagDrop.title", "Automated Bag Drop Management")}
        description={t(
          "bagDrop.seoDescription",
          "Manage and monitor automated self-service bag drop stations across airports"
        )}
      />

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-700 to-blue-500 bg-clip-text text-transparent dark:from-blue-400 dark:to-blue-300 flex items-center gap-3">
            <Luggage className="h-7 w-7 text-blue-600 dark:text-blue-400" />
            {t("bagDrop.title", "Automated Bag Drop Management")}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {t(
              "bagDrop.subtitle",
              "Monitor and manage self-service bag drop stations, analytics, and maintenance"
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            refetchUnits();
            toast.success(t("bagDrop.refreshed", "Data refreshed"));
          }}
          className="gap-2"
        >
          <Activity className="h-4 w-4" />
          {t("bagDrop.refresh", "Refresh")}
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Card className="shadow-sm rounded-xl">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("bagDrop.totalStations", "Total Stations")}
            </CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {unitsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{totalStations}</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              {t("bagDrop.acrossAirports", "Across all airports")}
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm rounded-xl">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("bagDrop.activeStations", "Active Stations")}
            </CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            {unitsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                {activeStations}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              {t("bagDrop.currentlyOperational", "Currently operational")}
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm rounded-xl">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("bagDrop.inMaintenance", "In Maintenance")}
            </CardTitle>
            <Wrench className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            {unitsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                {maintenanceStations}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              {t("bagDrop.undergoingService", "Undergoing service")}
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-sm rounded-xl">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              {t("bagDrop.bagsProcessedToday", "Bags Processed Today")}
            </CardTitle>
            <Luggage className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            {unitsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {bagsProcessedToday.toLocaleString()}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              {t("bagDrop.sinceStartOfDay", "Since start of day")}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="stations" className="gap-2">
            <Settings className="h-4 w-4" />
            {t("bagDrop.stations", "Stations")}
          </TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            {t("bagDrop.analytics", "Analytics")}
          </TabsTrigger>
          <TabsTrigger value="maintenance" className="gap-2">
            <Wrench className="h-4 w-4" />
            {t("bagDrop.maintenance", "Maintenance")}
          </TabsTrigger>
        </TabsList>

        {/* ================================================================ */}
        {/* Stations Tab                                                     */}
        {/* ================================================================ */}
        <TabsContent value="stations">
          <Card className="shadow-sm rounded-xl">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5" />
                  {t("bagDrop.stationOverview", "Bag Drop Stations")}
                </CardTitle>
                <div className="w-64">
                  <Input
                    placeholder={t(
                      "bagDrop.searchStations",
                      "Search stations..."
                    )}
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {unitsLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : filteredStations.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Package className="h-12 w-12 mb-3" />
                  <p className="text-sm">
                    {t(
                      "bagDrop.noStationsFound",
                      "No stations match your search."
                    )}
                  </p>
                </div>
              ) : (
                <div className="overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          {t("bagDrop.stationId", "Station ID")}
                        </TableHead>
                        <TableHead>{t("bagDrop.airport", "Airport")}</TableHead>
                        <TableHead>
                          {t("bagDrop.terminal", "Terminal")}
                        </TableHead>
                        <TableHead>
                          {t("bagDrop.statusLabel", "Status")}
                        </TableHead>
                        <TableHead className="text-right">
                          {t("bagDrop.bagsProcessed", "Bags Processed")}
                        </TableHead>
                        <TableHead>
                          {t("bagDrop.firmware", "Firmware")}
                        </TableHead>
                        <TableHead>
                          {t("bagDrop.lastActivity", "Last Activity")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredStations.map(station => (
                        <TableRow key={station.id}>
                          <TableCell className="font-mono font-medium">
                            {station.stationCode}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {station.airportCode}
                            </Badge>
                          </TableCell>
                          <TableCell>{station.terminal}</TableCell>
                          <TableCell>
                            <StationStatusBadge status={station.status} />
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {station.bagsProcessed.toLocaleString()}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            v{station.firmwareVersion}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {station.lastActivityAt
                              ? format(
                                  new Date(station.lastActivityAt),
                                  "MMM dd, HH:mm",
                                  {
                                    locale: dateLocale,
                                  }
                                )
                              : t("bagDrop.never", "Never")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Station Distribution by Status */}
          <Card className="shadow-sm rounded-xl mt-4">
            <CardHeader>
              <CardTitle className="text-sm font-medium">
                {t(
                  "bagDrop.stationDistribution",
                  "Station Distribution by Status"
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="flex items-center gap-3 p-3 rounded-lg bg-green-50 dark:bg-green-950">
                  <CheckCircle2 className="h-8 w-8 text-green-500" />
                  <div>
                    <p className="text-2xl font-bold text-green-700 dark:text-green-300">
                      {stations.filter(s => s.status === "online").length}
                    </p>
                    <p className="text-xs text-green-600 dark:text-green-400">
                      {t("bagDrop.status.online", "Online")}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 dark:bg-gray-900">
                  <XCircle className="h-8 w-8 text-gray-400" />
                  <div>
                    <p className="text-2xl font-bold text-gray-700 dark:text-gray-300">
                      {stations.filter(s => s.status === "offline").length}
                    </p>
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      {t("bagDrop.status.offline", "Offline")}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950">
                  <Wrench className="h-8 w-8 text-amber-500" />
                  <div>
                    <p className="text-2xl font-bold text-amber-700 dark:text-amber-300">
                      {stations.filter(s => s.status === "maintenance").length}
                    </p>
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      {t("bagDrop.status.maintenance", "Maintenance")}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 p-3 rounded-lg bg-red-50 dark:bg-red-950">
                  <XCircle className="h-8 w-8 text-red-500" />
                  <div>
                    <p className="text-2xl font-bold text-red-700 dark:text-red-300">
                      {stations.filter(s => s.status === "error").length}
                    </p>
                    <p className="text-xs text-red-600 dark:text-red-400">
                      {t("bagDrop.status.error", "Error")}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================================================================ */}
        {/* Analytics Tab                                                    */}
        {/* ================================================================ */}
        <TabsContent value="analytics">
          <div className="space-y-4">
            {/* Summary Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <Card className="shadow-sm rounded-xl">
                <CardContent className="pt-6 text-center">
                  {analyticsLoading ? (
                    <Skeleton className="h-10 w-20 mx-auto" />
                  ) : (
                    <>
                      <p className="text-2xl font-bold">
                        {analytics.totalSessions.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t("bagDrop.totalSessions", "Total Sessions")}
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card className="shadow-sm rounded-xl">
                <CardContent className="pt-6 text-center">
                  {analyticsLoading ? (
                    <Skeleton className="h-10 w-20 mx-auto" />
                  ) : (
                    <>
                      <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                        {analytics.successfulSessions.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t("bagDrop.successfulSessions", "Successful")}
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card className="shadow-sm rounded-xl">
                <CardContent className="pt-6 text-center">
                  {analyticsLoading ? (
                    <Skeleton className="h-10 w-20 mx-auto" />
                  ) : (
                    <>
                      <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                        {analytics.failedSessions.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t("bagDrop.failedSessions", "Failed")}
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card className="shadow-sm rounded-xl">
                <CardContent className="pt-6 text-center">
                  {analyticsLoading ? (
                    <Skeleton className="h-10 w-20 mx-auto" />
                  ) : (
                    <>
                      <p className="text-2xl font-bold">
                        {analytics.averageProcessingTime}s
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t("bagDrop.avgProcessingTime", "Avg Processing Time")}
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card className="shadow-sm rounded-xl">
                <CardContent className="pt-6 text-center">
                  {analyticsLoading ? (
                    <Skeleton className="h-10 w-20 mx-auto" />
                  ) : (
                    <>
                      <p className="text-2xl font-bold">
                        {analytics.peakHour}:00
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t("bagDrop.peakHour", "Peak Hour")}
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card className="shadow-sm rounded-xl">
                <CardContent className="pt-6 text-center">
                  {analyticsLoading ? (
                    <Skeleton className="h-10 w-20 mx-auto" />
                  ) : (
                    <>
                      <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                        {(
                          analytics.excessBaggageRevenue / 100
                        ).toLocaleString()}{" "}
                        SAR
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t(
                          "bagDrop.excessBaggageRevenue",
                          "Excess Baggage Revenue"
                        )}
                      </p>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Success Rate Card */}
            <Card className="shadow-sm rounded-xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  {t("bagDrop.processingStats", "Processing Statistics")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {analyticsLoading ? (
                  <Skeleton className="h-48 w-full" />
                ) : (
                  <div className="space-y-6">
                    {/* Success Rate */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium">
                          {t("bagDrop.successRate", "Success Rate")}
                        </span>
                        <span className="text-sm font-bold text-green-600 dark:text-green-400">
                          {analytics.totalSessions > 0
                            ? (
                                (analytics.successfulSessions /
                                  analytics.totalSessions) *
                                100
                              ).toFixed(1)
                            : 0}
                          %
                        </span>
                      </div>
                      <div className="h-3 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-500 rounded-full transition-all"
                          style={{
                            width: `${
                              analytics.totalSessions > 0
                                ? (analytics.successfulSessions /
                                    analytics.totalSessions) *
                                  100
                                : 0
                            }%`,
                          }}
                        />
                      </div>
                    </div>

                    {/* Hourly Breakdown */}
                    <div>
                      <h4 className="text-sm font-medium mb-3">
                        {t("bagDrop.hourlyBreakdown", "Hourly Breakdown")}
                      </h4>
                      <div className="overflow-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>{t("bagDrop.hour", "Hour")}</TableHead>
                              <TableHead className="text-right">
                                {t("bagDrop.sessions", "Sessions")}
                              </TableHead>
                              <TableHead className="text-right">
                                {t("bagDrop.avgTime", "Avg Time (s)")}
                              </TableHead>
                              <TableHead>
                                {t("bagDrop.volume", "Volume")}
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {analytics.hourlyBreakdown.map(row => {
                              const maxSessions = Math.max(
                                ...analytics.hourlyBreakdown.map(
                                  r => r.sessions
                                )
                              );
                              const barWidth =
                                maxSessions > 0
                                  ? (row.sessions / maxSessions) * 100
                                  : 0;

                              return (
                                <TableRow key={row.hour}>
                                  <TableCell className="font-mono">
                                    {String(row.hour).padStart(2, "0")}:00
                                  </TableCell>
                                  <TableCell className="text-right font-mono">
                                    {row.sessions}
                                  </TableCell>
                                  <TableCell className="text-right font-mono">
                                    {row.avgTime}s
                                  </TableCell>
                                  <TableCell className="w-48">
                                    <div className="h-4 bg-muted rounded-full overflow-hidden">
                                      <div
                                        className="h-full bg-blue-500 rounded-full transition-all"
                                        style={{ width: `${barWidth}%` }}
                                      />
                                    </div>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ================================================================ */}
        {/* Maintenance Tab                                                  */}
        {/* ================================================================ */}
        <TabsContent value="maintenance">
          <div className="space-y-4">
            {/* Active Issues Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="shadow-sm rounded-xl border-l-4 border-l-red-500">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <XCircle className="h-8 w-8 text-red-500" />
                    <div>
                      <p className="text-2xl font-bold">
                        {
                          maintenanceLogs.filter(m => m.status === "pending")
                            .length
                        }
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("bagDrop.pendingIssues", "Pending Issues")}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-sm rounded-xl border-l-4 border-l-amber-500">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <Wrench className="h-8 w-8 text-amber-500" />
                    <div>
                      <p className="text-2xl font-bold">
                        {
                          maintenanceLogs.filter(
                            m => m.status === "in_progress"
                          ).length
                        }
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("bagDrop.inProgressIssues", "In Progress")}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-sm rounded-xl border-l-4 border-l-green-500">
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-8 w-8 text-green-500" />
                    <div>
                      <p className="text-2xl font-bold">
                        {
                          maintenanceLogs.filter(m => m.status === "completed")
                            .length
                        }
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("bagDrop.resolvedIssues", "Resolved")}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Maintenance Log Table */}
            <Card className="shadow-sm rounded-xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wrench className="h-5 w-5" />
                  {t("bagDrop.maintenanceLog", "Maintenance Log")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("bagDrop.logId", "ID")}</TableHead>
                        <TableHead>{t("bagDrop.station", "Station")}</TableHead>
                        <TableHead>{t("bagDrop.type", "Type")}</TableHead>
                        <TableHead>
                          {t("bagDrop.description", "Description")}
                        </TableHead>
                        <TableHead>
                          {t("bagDrop.performedBy", "Performed By")}
                        </TableHead>
                        <TableHead>{t("bagDrop.date", "Date")}</TableHead>
                        <TableHead>
                          {t("bagDrop.resolved", "Resolved")}
                        </TableHead>
                        <TableHead>
                          {t("bagDrop.statusLabel", "Status")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {maintenanceLogs.map(log => (
                        <TableRow
                          key={log.id}
                          className={
                            log.status !== "completed"
                              ? "bg-amber-50/50 dark:bg-amber-950/20"
                              : ""
                          }
                        >
                          <TableCell className="font-mono text-muted-foreground">
                            #{log.id}
                          </TableCell>
                          <TableCell className="font-mono font-medium">
                            {log.stationCode}
                          </TableCell>
                          <TableCell>
                            <MaintenanceTypeBadge type={log.type} />
                          </TableCell>
                          <TableCell className="max-w-[300px]">
                            <p
                              className="text-sm truncate"
                              title={log.description}
                            >
                              {log.description}
                            </p>
                          </TableCell>
                          <TableCell className="text-sm">
                            {log.performedBy}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            {format(
                              new Date(log.performedAt),
                              "MMM dd, HH:mm",
                              {
                                locale: dateLocale,
                              }
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            {log.resolvedAt
                              ? format(
                                  new Date(log.resolvedAt),
                                  "MMM dd, HH:mm",
                                  {
                                    locale: dateLocale,
                                  }
                                )
                              : "-"}
                          </TableCell>
                          <TableCell>
                            <MaintenanceStatusBadge status={log.status} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Active Station Issues Detail */}
            <Card className="shadow-sm rounded-xl">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
                  <Activity className="h-5 w-5" />
                  {t("bagDrop.activeIssues", "Active Station Issues")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {(() => {
                  const problemStations = stations.filter(
                    s =>
                      s.status === "offline" ||
                      s.status === "error" ||
                      s.status === "maintenance"
                  );

                  if (problemStations.length === 0) {
                    return (
                      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                        <CheckCircle2 className="h-12 w-12 mb-3 text-green-500" />
                        <p className="text-sm">
                          {t(
                            "bagDrop.allStationsOperational",
                            "All stations are operational. No active issues."
                          )}
                        </p>
                      </div>
                    );
                  }

                  return (
                    <div className="space-y-3">
                      {problemStations.map(station => {
                        const relatedLog = maintenanceLogs.find(
                          m =>
                            m.stationId === station.id &&
                            m.status !== "completed"
                        );

                        return (
                          <div
                            key={station.id}
                            className={`p-4 rounded-lg border ${
                              station.status === "error"
                                ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950"
                                : station.status === "offline"
                                  ? "border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900"
                                  : "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950"
                            }`}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-3">
                                <span className="font-mono font-bold">
                                  {station.stationCode}
                                </span>
                                <Badge variant="outline">
                                  {station.airportCode}
                                </Badge>
                                <span className="text-sm text-muted-foreground">
                                  {station.terminal}
                                </span>
                              </div>
                              <StationStatusBadge status={station.status} />
                            </div>
                            {relatedLog && (
                              <div className="mt-2 text-sm">
                                <p className="text-muted-foreground">
                                  <strong>
                                    {t("bagDrop.issue", "Issue")}:
                                  </strong>{" "}
                                  {relatedLog.description}
                                </p>
                                <p className="text-muted-foreground mt-1">
                                  <strong>
                                    {t("bagDrop.assignedTo", "Assigned to")}:
                                  </strong>{" "}
                                  {relatedLog.performedBy} |{" "}
                                  <MaintenanceStatusBadge
                                    status={relatedLog.status}
                                  />
                                </p>
                              </div>
                            )}
                            {!relatedLog && (
                              <p className="mt-2 text-sm text-muted-foreground italic">
                                {t(
                                  "bagDrop.noMaintenanceTicket",
                                  "No maintenance ticket assigned yet."
                                )}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
