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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import { useAuth } from "@/_core/hooks/useAuth";
import { Redirect } from "wouter";
import {
  Monitor,
  CheckCircle2,
  XCircle,
  Activity,
  MapPin,
  Plus,
  Settings,
  BarChart3,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

// ============================================================================
// Types
// ============================================================================

interface KioskDevice {
  id: number;
  airportId: number;
  airportCode: string;
  airportName: string;
  terminal: string;
  location: string;
  status: "online" | "offline" | "maintenance";
  hardwareType: string;
  hasPrinter: boolean;
  hasScanner: boolean;
  hasPayment: boolean;
  lastHeartbeat: string | null;
  checkInsToday: number;
  createdAt: string;
}

interface KioskAnalytics {
  totalCheckIns: number;
  averageSessionDuration: number;
  boardingPassesPrinted: number;
  bagTagsPrinted: number;
  ancillaryPurchases: number;
  peakHour: string;
  dailyBreakdown: Array<{
    date: string;
    checkIns: number;
    boardingPasses: number;
    bagTags: number;
  }>;
}

// ============================================================================
// Mock Fallback Data
// ============================================================================

const MOCK_DEVICES: KioskDevice[] = [
  {
    id: 1,
    airportId: 1,
    airportCode: "RUH",
    airportName: "King Khalid International",
    terminal: "Terminal 1",
    location: "Gate A1 - Departure Hall",
    status: "online",
    hardwareType: "SITA TS6",
    hasPrinter: true,
    hasScanner: true,
    hasPayment: true,
    lastHeartbeat: new Date().toISOString(),
    checkInsToday: 142,
    createdAt: "2025-11-01T08:00:00Z",
  },
  {
    id: 2,
    airportId: 1,
    airportCode: "RUH",
    airportName: "King Khalid International",
    terminal: "Terminal 1",
    location: "Gate A2 - Departure Hall",
    status: "online",
    hardwareType: "SITA TS6",
    hasPrinter: true,
    hasScanner: true,
    hasPayment: false,
    lastHeartbeat: new Date().toISOString(),
    checkInsToday: 98,
    createdAt: "2025-11-01T08:00:00Z",
  },
  {
    id: 3,
    airportId: 1,
    airportCode: "RUH",
    airportName: "King Khalid International",
    terminal: "Terminal 2",
    location: "Near Check-in Counter B",
    status: "offline",
    hardwareType: "Materna T10",
    hasPrinter: true,
    hasScanner: false,
    hasPayment: true,
    lastHeartbeat: "2026-02-08T14:30:00Z",
    checkInsToday: 0,
    createdAt: "2025-12-15T10:00:00Z",
  },
  {
    id: 4,
    airportId: 2,
    airportCode: "JED",
    airportName: "King Abdulaziz International",
    terminal: "Terminal 1",
    location: "Main Concourse - Zone C",
    status: "online",
    hardwareType: "SITA TS6",
    hasPrinter: true,
    hasScanner: true,
    hasPayment: true,
    lastHeartbeat: new Date().toISOString(),
    checkInsToday: 215,
    createdAt: "2025-10-20T09:00:00Z",
  },
  {
    id: 5,
    airportId: 2,
    airportCode: "JED",
    airportName: "King Abdulaziz International",
    terminal: "Terminal 1",
    location: "Main Concourse - Zone D",
    status: "maintenance",
    hardwareType: "Materna T10",
    hasPrinter: true,
    hasScanner: true,
    hasPayment: true,
    lastHeartbeat: "2026-02-09T06:00:00Z",
    checkInsToday: 34,
    createdAt: "2025-10-20T09:00:00Z",
  },
  {
    id: 6,
    airportId: 3,
    airportCode: "DMM",
    airportName: "King Fahd International",
    terminal: "Terminal 1",
    location: "Departure Hall - East Wing",
    status: "online",
    hardwareType: "SITA TS6",
    hasPrinter: true,
    hasScanner: true,
    hasPayment: false,
    lastHeartbeat: new Date().toISOString(),
    checkInsToday: 73,
    createdAt: "2026-01-10T12:00:00Z",
  },
];

const MOCK_ANALYTICS: KioskAnalytics = {
  totalCheckIns: 1847,
  averageSessionDuration: 124,
  boardingPassesPrinted: 1623,
  bagTagsPrinted: 892,
  ancillaryPurchases: 312,
  peakHour: "08:00 - 09:00",
  dailyBreakdown: [
    { date: "2026-02-03", checkIns: 245, boardingPasses: 220, bagTags: 112 },
    { date: "2026-02-04", checkIns: 278, boardingPasses: 251, bagTags: 134 },
    { date: "2026-02-05", checkIns: 312, boardingPasses: 289, bagTags: 156 },
    { date: "2026-02-06", checkIns: 198, boardingPasses: 175, bagTags: 89 },
    { date: "2026-02-07", checkIns: 267, boardingPasses: 242, bagTags: 128 },
    { date: "2026-02-08", checkIns: 289, boardingPasses: 261, bagTags: 141 },
    { date: "2026-02-09", checkIns: 258, boardingPasses: 185, bagTags: 132 },
  ],
};

// ============================================================================
// Helper Components
// ============================================================================

function DeviceStatusBadge({
  status,
}: {
  status: "online" | "offline" | "maintenance";
}) {
  if (status === "online") {
    return (
      <Badge className="bg-green-100 text-green-800 hover:bg-green-100 dark:bg-green-900 dark:text-green-300">
        <CheckCircle2 className="mr-1 h-3 w-3" />
        Online
      </Badge>
    );
  }
  if (status === "offline") {
    return (
      <Badge className="bg-red-100 text-red-800 hover:bg-red-100 dark:bg-red-900 dark:text-red-300">
        <XCircle className="mr-1 h-3 w-3" />
        Offline
      </Badge>
    );
  }
  return (
    <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100 dark:bg-yellow-900 dark:text-yellow-300">
      <Settings className="mr-1 h-3 w-3 animate-spin" />
      Maintenance
    </Badge>
  );
}

function CapabilityBadge({
  label,
  enabled,
}: {
  label: string;
  enabled: boolean;
}) {
  return (
    <Badge
      variant={enabled ? "default" : "outline"}
      className={
        enabled
          ? "bg-blue-100 text-blue-800 hover:bg-blue-100 dark:bg-blue-900 dark:text-blue-300"
          : "text-muted-foreground"
      }
    >
      {label}
    </Badge>
  );
}

function SummaryCardSkeleton() {
  return (
    <Card className="shadow-sm rounded-xl">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-4 rounded" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-8 w-16 mb-1" />
        <Skeleton className="h-3 w-32" />
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function KioskManagement() {
  const { t, i18n } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const dateLocale = i18n.language === "ar" ? ar : enUS;

  const [activeTab, setActiveTab] = useState("devices");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // -- Register form state --
  const [registerForm, setRegisterForm] = useState({
    airportId: "",
    terminal: "",
    location: "",
    hardwareType: "",
    hasPrinter: true,
    hasScanner: true,
    hasPayment: false,
  });

  // ---------- Queries ----------

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kioskTrpc = (trpc as any).kiosk as {
    getDevices: {
      useQuery: (
        input?: {
          airportId?: number;
          status?: "online" | "offline" | "maintenance";
        },
        opts?: { refetchInterval?: number }
      ) => {
        data: KioskDevice[] | undefined;
        isLoading: boolean;
        refetch: () => void;
      };
    };
    registerDevice: {
      useMutation: (opts: {
        onSuccess: () => void;
        onError: (err: { message: string }) => void;
      }) => {
        mutate: (input: {
          airportId: number;
          terminal: string;
          location: string;
          hardwareType?: string;
          hasPrinter?: boolean;
          hasScanner?: boolean;
          hasPayment?: boolean;
        }) => void;
        isPending: boolean;
      };
    };
    getAnalytics: {
      useQuery: (
        input: { airportId: number; from: Date; to: Date },
        opts?: { enabled?: boolean }
      ) => {
        data: KioskAnalytics | undefined;
        isLoading: boolean;
      };
    };
  };

  const filterInput =
    statusFilter === "all"
      ? undefined
      : { status: statusFilter as "online" | "offline" | "maintenance" };

  const {
    data: devicesData,
    isLoading: devicesLoading,
    refetch: refetchDevices,
  } = kioskTrpc.getDevices.useQuery(filterInput, {
    refetchInterval: 30000,
  });

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const { data: analyticsData, isLoading: analyticsLoading } =
    kioskTrpc.getAnalytics.useQuery(
      { airportId: 1, from: sevenDaysAgo, to: now },
      { enabled: activeTab === "analytics" }
    );

  const registerDeviceMutation = kioskTrpc.registerDevice.useMutation({
    onSuccess: () => {
      toast.success(
        t("kiosk.deviceRegistered", "Kiosk device registered successfully")
      );
      setRegisterForm({
        airportId: "",
        terminal: "",
        location: "",
        hardwareType: "",
        hasPrinter: true,
        hasScanner: true,
        hasPayment: false,
      });
      refetchDevices();
      setActiveTab("devices");
    },
    onError: (err: { message: string }) => {
      toast.error(err.message);
    },
  });

  // Use real data or fallback to mock
  const devices = devicesData ?? MOCK_DEVICES;
  const analytics = analyticsData ?? MOCK_ANALYTICS;

  // Compute summary stats
  const totalKiosks = devices.length;
  const onlineCount = devices.filter(d => d.status === "online").length;
  const offlineCount = devices.filter(d => d.status === "offline").length;
  const checkInsToday = devices.reduce((sum, d) => sum + d.checkInsToday, 0);

  // ---------- Auth Guard ----------

  if (authLoading) {
    return (
      <div className="container py-8">
        <Skeleton className="h-8 w-64 mb-4" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!user || !["admin", "super_admin"].includes(user.role)) {
    return <Redirect to="/" />;
  }

  // ---------- Handlers ----------

  function handleRegisterDevice() {
    const airportId = parseInt(registerForm.airportId);
    if (!airportId || !registerForm.terminal || !registerForm.location) {
      toast.error(
        t("kiosk.fillRequired", "Please fill in all required fields")
      );
      return;
    }
    registerDeviceMutation.mutate({
      airportId,
      terminal: registerForm.terminal,
      location: registerForm.location,
      hardwareType: registerForm.hardwareType || undefined,
      hasPrinter: registerForm.hasPrinter,
      hasScanner: registerForm.hasScanner,
      hasPayment: registerForm.hasPayment,
    });
  }

  // ---------- Render ----------

  return (
    <div className="container py-8">
      <SEO
        title={t("kiosk.title", "Kiosk Management")}
        description={t(
          "kiosk.seoDescription",
          "Manage self-service kiosk devices, monitor status, and view usage analytics"
        )}
      />

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Monitor className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold">
            {t("kiosk.title", "Kiosk Management")}
          </h1>
        </div>
        <p className="text-muted-foreground">
          {t(
            "kiosk.subtitle",
            "Monitor and manage self-service check-in kiosk devices across all airports"
          )}
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
        {devicesLoading ? (
          <>
            <SummaryCardSkeleton />
            <SummaryCardSkeleton />
            <SummaryCardSkeleton />
            <SummaryCardSkeleton />
          </>
        ) : (
          <>
            {/* Total Kiosks */}
            <Card className="shadow-sm rounded-xl">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {t("kiosk.totalKiosks", "Total Kiosks")}
                </CardTitle>
                <Monitor className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{totalKiosks}</div>
                <p className="text-xs text-muted-foreground">
                  {t("kiosk.acrossAllAirports", "Across all airports")}
                </p>
              </CardContent>
            </Card>

            {/* Online */}
            <Card className="shadow-sm rounded-xl">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {t("kiosk.online", "Online")}
                </CardTitle>
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {onlineCount}
                </div>
                <p className="text-xs text-muted-foreground">
                  {totalKiosks > 0
                    ? `${((onlineCount / totalKiosks) * 100).toFixed(0)}% ${t("kiosk.availability", "availability")}`
                    : t("kiosk.noDevices", "No devices")}
                </p>
              </CardContent>
            </Card>

            {/* Offline */}
            <Card className="shadow-sm rounded-xl">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {t("kiosk.offline", "Offline")}
                </CardTitle>
                <XCircle className="h-4 w-4 text-red-500" />
              </CardHeader>
              <CardContent>
                <div
                  className={`text-2xl font-bold ${
                    offlineCount > 0
                      ? "text-red-600 dark:text-red-400"
                      : "text-green-600 dark:text-green-400"
                  }`}
                >
                  {offlineCount}
                </div>
                <p className="text-xs text-muted-foreground">
                  {offlineCount === 0
                    ? t("kiosk.allOperational", "All devices operational")
                    : t("kiosk.requiresAttention", "Requires attention")}
                </p>
              </CardContent>
            </Card>

            {/* Check-ins Today */}
            <Card className="shadow-sm rounded-xl">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {t("kiosk.checkInsToday", "Check-ins Today")}
                </CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {checkInsToday.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t(
                    "kiosk.selfServiceCheckIns",
                    "Self-service check-ins processed"
                  )}
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-6">
          <TabsTrigger value="devices" className="gap-2">
            <Monitor className="h-4 w-4" />
            {t("kiosk.devices", "Devices")}
          </TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            {t("kiosk.analytics", "Analytics")}
          </TabsTrigger>
          <TabsTrigger value="register" className="gap-2">
            <Plus className="h-4 w-4" />
            {t("kiosk.register", "Register")}
          </TabsTrigger>
        </TabsList>

        {/* ================================================================ */}
        {/* Devices Tab                                                      */}
        {/* ================================================================ */}
        <TabsContent value="devices">
          {/* Filter Bar */}
          <div className="flex items-center gap-4 mb-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">
                {t("kiosk.filterByStatus", "Filter by status")}:
              </span>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t("kiosk.allStatuses", "All Statuses")}
                  </SelectItem>
                  <SelectItem value="online">
                    {t("kiosk.online", "Online")}
                  </SelectItem>
                  <SelectItem value="offline">
                    {t("kiosk.offline", "Offline")}
                  </SelectItem>
                  <SelectItem value="maintenance">
                    {t("kiosk.maintenance", "Maintenance")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchDevices()}
            >
              {t("kiosk.refresh", "Refresh")}
            </Button>
          </div>

          {/* Devices Table */}
          <Card className="shadow-sm rounded-xl">
            <CardContent className="p-0">
              {devicesLoading ? (
                <div className="p-6 space-y-4">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : devices.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                  <Monitor className="h-16 w-16 mb-4 opacity-30" />
                  <p className="text-lg font-medium">
                    {t("kiosk.noDevicesFound", "No kiosk devices found")}
                  </p>
                  <p className="text-sm">
                    {t(
                      "kiosk.registerFirst",
                      "Register a new kiosk device to get started."
                    )}
                  </p>
                  <Button
                    variant="outline"
                    className="mt-4"
                    onClick={() => setActiveTab("register")}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    {t("kiosk.registerDevice", "Register Device")}
                  </Button>
                </div>
              ) : (
                <div className="overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[60px]">
                          {t("kiosk.id", "ID")}
                        </TableHead>
                        <TableHead>{t("kiosk.airport", "Airport")}</TableHead>
                        <TableHead>{t("kiosk.terminal", "Terminal")}</TableHead>
                        <TableHead>{t("kiosk.location", "Location")}</TableHead>
                        <TableHead>{t("kiosk.status", "Status")}</TableHead>
                        <TableHead>{t("kiosk.hardware", "Hardware")}</TableHead>
                        <TableHead>
                          {t("kiosk.capabilities", "Capabilities")}
                        </TableHead>
                        <TableHead className="text-right">
                          {t("kiosk.todayCheckIns", "Today")}
                        </TableHead>
                        <TableHead>
                          {t("kiosk.lastSeen", "Last Seen")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {devices.map(device => (
                        <TableRow
                          key={device.id}
                          className={
                            device.status === "offline"
                              ? "bg-red-50/50 dark:bg-red-950/20"
                              : ""
                          }
                        >
                          <TableCell className="font-mono text-muted-foreground">
                            #{device.id}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <MapPin className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                              <div>
                                <p className="font-medium">
                                  {device.airportCode}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {device.airportName}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>{device.terminal}</TableCell>
                          <TableCell className="max-w-[200px] truncate">
                            {device.location}
                          </TableCell>
                          <TableCell>
                            <DeviceStatusBadge status={device.status} />
                          </TableCell>
                          <TableCell className="text-sm">
                            {device.hardwareType}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              <CapabilityBadge
                                label={t("kiosk.printer", "Printer")}
                                enabled={device.hasPrinter}
                              />
                              <CapabilityBadge
                                label={t("kiosk.scanner", "Scanner")}
                                enabled={device.hasScanner}
                              />
                              <CapabilityBadge
                                label={t("kiosk.payment", "Payment")}
                                enabled={device.hasPayment}
                              />
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold">
                            {device.checkInsToday}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                            {device.lastHeartbeat
                              ? format(
                                  new Date(device.lastHeartbeat),
                                  "MMM dd, HH:mm",
                                  {
                                    locale: dateLocale,
                                  }
                                )
                              : t("kiosk.never", "Never")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================================================================ */}
        {/* Analytics Tab                                                    */}
        {/* ================================================================ */}
        <TabsContent value="analytics">
          {analyticsLoading ? (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Card key={i} className="shadow-sm rounded-xl">
                    <CardHeader>
                      <Skeleton className="h-4 w-32" />
                    </CardHeader>
                    <CardContent>
                      <Skeleton className="h-8 w-20" />
                    </CardContent>
                  </Card>
                ))}
              </div>
              <Skeleton className="h-[300px] w-full" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Analytics Summary Cards */}
              <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
                <Card className="shadow-sm rounded-xl">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      {t("kiosk.totalCheckIns", "Total Check-ins")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {analytics.totalCheckIns.toLocaleString()}
                    </div>
                  </CardContent>
                </Card>

                <Card className="shadow-sm rounded-xl">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      {t("kiosk.avgSession", "Avg Session")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {analytics.averageSessionDuration}s
                    </div>
                  </CardContent>
                </Card>

                <Card className="shadow-sm rounded-xl">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      {t("kiosk.boardingPasses", "Boarding Passes")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {analytics.boardingPassesPrinted.toLocaleString()}
                    </div>
                  </CardContent>
                </Card>

                <Card className="shadow-sm rounded-xl">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      {t("kiosk.bagTags", "Bag Tags")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {analytics.bagTagsPrinted.toLocaleString()}
                    </div>
                  </CardContent>
                </Card>

                <Card className="shadow-sm rounded-xl">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      {t("kiosk.ancillaryPurchases", "Ancillary Sales")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold">
                      {analytics.ancillaryPurchases.toLocaleString()}
                    </div>
                  </CardContent>
                </Card>

                <Card className="shadow-sm rounded-xl">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      {t("kiosk.peakHour", "Peak Hour")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-lg font-bold">
                      {analytics.peakHour}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Daily Breakdown Chart */}
              <Card className="shadow-sm rounded-xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5" />
                    {t("kiosk.dailyBreakdown", "Daily Usage Breakdown")}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={350}>
                    <BarChart data={analytics.dailyBreakdown}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 12 }}
                        tickFormatter={v =>
                          format(new Date(v), "MM/dd", { locale: dateLocale })
                        }
                      />
                      <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                      <Tooltip
                        labelFormatter={label =>
                          format(new Date(label as string), "MMM dd, yyyy", {
                            locale: dateLocale,
                          })
                        }
                      />
                      <Legend />
                      <Bar
                        dataKey="checkIns"
                        name={t("kiosk.checkIns", "Check-ins")}
                        fill="#3b82f6"
                        radius={[4, 4, 0, 0]}
                      />
                      <Bar
                        dataKey="boardingPasses"
                        name={t("kiosk.boardingPasses", "Boarding Passes")}
                        fill="#10b981"
                        radius={[4, 4, 0, 0]}
                      />
                      <Bar
                        dataKey="bagTags"
                        name={t("kiosk.bagTags", "Bag Tags")}
                        fill="#f59e0b"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Daily Data Table */}
              <Card className="shadow-sm rounded-xl">
                <CardHeader>
                  <CardTitle>{t("kiosk.dailyData", "Daily Data")}</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t("kiosk.date", "Date")}</TableHead>
                          <TableHead className="text-right">
                            {t("kiosk.checkIns", "Check-ins")}
                          </TableHead>
                          <TableHead className="text-right">
                            {t("kiosk.boardingPasses", "Boarding Passes")}
                          </TableHead>
                          <TableHead className="text-right">
                            {t("kiosk.bagTags", "Bag Tags")}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {analytics.dailyBreakdown.map(day => (
                          <TableRow key={day.date}>
                            <TableCell className="font-medium">
                              {format(new Date(day.date), "MMM dd, yyyy", {
                                locale: dateLocale,
                              })}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {day.checkIns}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {day.boardingPasses}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {day.bagTags}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* ================================================================ */}
        {/* Register Tab                                                     */}
        {/* ================================================================ */}
        <TabsContent value="register">
          <Card className="shadow-sm rounded-xl max-w-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Plus className="h-5 w-5" />
                {t("kiosk.registerNewDevice", "Register New Kiosk Device")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {/* Airport ID */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    {t("kiosk.airportId", "Airport ID")} *
                  </label>
                  <Input
                    type="number"
                    placeholder={t(
                      "kiosk.enterAirportId",
                      "Enter airport ID (e.g. 1)"
                    )}
                    value={registerForm.airportId}
                    onChange={e =>
                      setRegisterForm({
                        ...registerForm,
                        airportId: e.target.value,
                      })
                    }
                  />
                </div>

                {/* Terminal */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    {t("kiosk.terminal", "Terminal")} *
                  </label>
                  <Input
                    placeholder={t("kiosk.enterTerminal", "e.g. Terminal 1")}
                    value={registerForm.terminal}
                    onChange={e =>
                      setRegisterForm({
                        ...registerForm,
                        terminal: e.target.value,
                      })
                    }
                  />
                </div>

                {/* Location */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    {t("kiosk.location", "Location")} *
                  </label>
                  <Input
                    placeholder={t(
                      "kiosk.enterLocation",
                      "e.g. Gate A1 - Departure Hall"
                    )}
                    value={registerForm.location}
                    onChange={e =>
                      setRegisterForm({
                        ...registerForm,
                        location: e.target.value,
                      })
                    }
                  />
                </div>

                {/* Hardware Type */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    {t("kiosk.hardwareType", "Hardware Type")}
                  </label>
                  <Select
                    value={registerForm.hardwareType}
                    onValueChange={value =>
                      setRegisterForm({ ...registerForm, hardwareType: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={t(
                          "kiosk.selectHardware",
                          "Select hardware type"
                        )}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="SITA TS6">SITA TS6</SelectItem>
                      <SelectItem value="Materna T10">Materna T10</SelectItem>
                      <SelectItem value="IER 919">IER 919</SelectItem>
                      <SelectItem value="Embross EZ-Kiosk">
                        Embross EZ-Kiosk
                      </SelectItem>
                      <SelectItem value="Custom">
                        {t("kiosk.custom", "Custom")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Capabilities */}
                <div className="space-y-3">
                  <label className="text-sm font-medium">
                    {t("kiosk.capabilities", "Capabilities")}
                  </label>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={registerForm.hasPrinter}
                        onChange={e =>
                          setRegisterForm({
                            ...registerForm,
                            hasPrinter: e.target.checked,
                          })
                        }
                        className="rounded border-gray-300"
                      />
                      <span className="text-sm">
                        {t("kiosk.hasPrinter", "Boarding Pass Printer")}
                      </span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={registerForm.hasScanner}
                        onChange={e =>
                          setRegisterForm({
                            ...registerForm,
                            hasScanner: e.target.checked,
                          })
                        }
                        className="rounded border-gray-300"
                      />
                      <span className="text-sm">
                        {t("kiosk.hasScanner", "Document Scanner")}
                      </span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={registerForm.hasPayment}
                        onChange={e =>
                          setRegisterForm({
                            ...registerForm,
                            hasPayment: e.target.checked,
                          })
                        }
                        className="rounded border-gray-300"
                      />
                      <span className="text-sm">
                        {t("kiosk.hasPayment", "Payment Terminal")}
                      </span>
                    </label>
                  </div>
                </div>

                {/* Submit */}
                <Button
                  onClick={handleRegisterDevice}
                  disabled={
                    registerDeviceMutation.isPending ||
                    !registerForm.airportId ||
                    !registerForm.terminal ||
                    !registerForm.location
                  }
                  className="w-full gap-2"
                >
                  <Plus className="h-4 w-4" />
                  {registerDeviceMutation.isPending
                    ? t("kiosk.registering", "Registering...")
                    : t("kiosk.registerDevice", "Register Device")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
