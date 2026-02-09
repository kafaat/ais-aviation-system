/**
 * Biometric Boarding Admin Page
 *
 * Admin dashboard for managing biometric boarding operations including
 * enrollment statistics, gate hardware status, audit event logs,
 * and gate biometric configuration.
 */

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
  Fingerprint,
  Scan,
  CheckCircle2,
  XCircle,
  Monitor,
  Settings,
  Eye,
  Activity,
} from "lucide-react";

// ============================================================================
// Types
// ============================================================================

interface GateStatusRecord {
  gateId: number;
  gateName: string;
  terminal: string;
  deviceType: string;
  status: "online" | "offline" | "maintenance";
  firmwareVersion: string;
  lastHeartbeat: string;
  passengersProcessed: number;
  successRate: number;
}

interface BiometricEvent {
  id: number;
  eventType:
    | "enrollment"
    | "verification_success"
    | "verification_failure"
    | "boarding_complete";
  passengerId: number;
  passengerName: string;
  flightId: number | null;
  flightNumber: string | null;
  gateId: number | null;
  gateName: string | null;
  biometricType: "face" | "fingerprint" | "iris";
  timestamp: string;
  details: string | null;
}

interface GateConfigForm {
  gateId: string;
  airportId: string;
  deviceType: string;
  status: "online" | "offline" | "maintenance";
  firmwareVersion: string;
}

// ============================================================================
// Mock Data (fallback when API is unavailable)
// ============================================================================

const MOCK_SUMMARY = {
  totalEnrollments: 12847,
  verifiedToday: 463,
  activeGates: 18,
  successRate: 97.3,
};

const MOCK_GATES: GateStatusRecord[] = [
  {
    gateId: 1,
    gateName: "A1",
    terminal: "Terminal 1",
    deviceType: "NEC NeoFace",
    status: "online",
    firmwareVersion: "4.2.1",
    lastHeartbeat: new Date().toISOString(),
    passengersProcessed: 342,
    successRate: 98.5,
  },
  {
    gateId: 2,
    gateName: "A2",
    terminal: "Terminal 1",
    deviceType: "NEC NeoFace",
    status: "online",
    firmwareVersion: "4.2.1",
    lastHeartbeat: new Date().toISOString(),
    passengersProcessed: 289,
    successRate: 97.2,
  },
  {
    gateId: 3,
    gateName: "B5",
    terminal: "Terminal 2",
    deviceType: "IDEMIA MorphoWave",
    status: "maintenance",
    firmwareVersion: "3.8.0",
    lastHeartbeat: new Date(Date.now() - 3600000).toISOString(),
    passengersProcessed: 0,
    successRate: 0,
  },
  {
    gateId: 4,
    gateName: "C3",
    terminal: "Terminal 3",
    deviceType: "SITA Smart Path",
    status: "online",
    firmwareVersion: "5.1.0",
    lastHeartbeat: new Date().toISOString(),
    passengersProcessed: 517,
    successRate: 99.1,
  },
  {
    gateId: 5,
    gateName: "D1",
    terminal: "Terminal 4",
    deviceType: "NEC NeoFace",
    status: "offline",
    firmwareVersion: "4.1.3",
    lastHeartbeat: new Date(Date.now() - 7200000).toISOString(),
    passengersProcessed: 0,
    successRate: 0,
  },
];

const MOCK_EVENTS: BiometricEvent[] = [
  {
    id: 1,
    eventType: "boarding_complete",
    passengerId: 1001,
    passengerName: "Ahmed Al-Rashid",
    flightId: 42,
    flightNumber: "SV301",
    gateId: 1,
    gateName: "A1",
    biometricType: "face",
    timestamp: new Date(Date.now() - 120000).toISOString(),
    details: null,
  },
  {
    id: 2,
    eventType: "verification_success",
    passengerId: 1002,
    passengerName: "Sara Mohammed",
    flightId: 42,
    flightNumber: "SV301",
    gateId: 1,
    gateName: "A1",
    biometricType: "face",
    timestamp: new Date(Date.now() - 180000).toISOString(),
    details: null,
  },
  {
    id: 3,
    eventType: "verification_failure",
    passengerId: 1003,
    passengerName: "John Smith",
    flightId: 55,
    flightNumber: "SV412",
    gateId: 4,
    gateName: "C3",
    biometricType: "face",
    timestamp: new Date(Date.now() - 300000).toISOString(),
    details: "Confidence score below threshold (72%)",
  },
  {
    id: 4,
    eventType: "enrollment",
    passengerId: 1004,
    passengerName: "Fatima Hassan",
    flightId: null,
    flightNumber: null,
    gateId: null,
    gateName: null,
    biometricType: "fingerprint",
    timestamp: new Date(Date.now() - 600000).toISOString(),
    details: "Initial enrollment - consent provided",
  },
  {
    id: 5,
    eventType: "boarding_complete",
    passengerId: 1005,
    passengerName: "Omar Al-Fayed",
    flightId: 55,
    flightNumber: "SV412",
    gateId: 4,
    gateName: "C3",
    biometricType: "face",
    timestamp: new Date(Date.now() - 900000).toISOString(),
    details: null,
  },
];

// ============================================================================
// Helper: Status Badge
// ============================================================================

function GateStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "online":
      return (
        <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-0">
          <CheckCircle2 className="mr-1 h-3 w-3" />
          Online
        </Badge>
      );
    case "offline":
      return (
        <Badge variant="destructive">
          <XCircle className="mr-1 h-3 w-3" />
          Offline
        </Badge>
      );
    case "maintenance":
      return (
        <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 border-0">
          <Settings className="mr-1 h-3 w-3" />
          Maintenance
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function EventTypeBadge({
  eventType,
}: {
  eventType: BiometricEvent["eventType"];
}) {
  switch (eventType) {
    case "enrollment":
      return (
        <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border-0">
          <Fingerprint className="mr-1 h-3 w-3" />
          Enrollment
        </Badge>
      );
    case "verification_success":
      return (
        <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-0">
          <CheckCircle2 className="mr-1 h-3 w-3" />
          Verified
        </Badge>
      );
    case "verification_failure":
      return (
        <Badge variant="destructive">
          <XCircle className="mr-1 h-3 w-3" />
          Failed
        </Badge>
      );
    case "boarding_complete":
      return (
        <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 border-0">
          <Scan className="mr-1 h-3 w-3" />
          Boarded
        </Badge>
      );
    default:
      return <Badge variant="outline">{eventType}</Badge>;
  }
}

// ============================================================================
// Helper: Date locale
// ============================================================================

function useDateLocale() {
  const { i18n } = useTranslation();
  return i18n.language === "ar" ? ar : enUS;
}

// ============================================================================
// Main Component
// ============================================================================

export default function BiometricBoarding() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState("gates");

  // Admin check
  if (authLoading) {
    return (
      <div className="container mx-auto p-6 max-w-7xl">
        <div className="space-y-6">
          <Skeleton className="h-10 w-64" />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-32 w-full rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  if (!user || !["admin", "super_admin"].includes(user.role ?? "")) {
    return <Redirect to="/" />;
  }

  return (
    <>
      <SEO
        title={t("biometric.title", "Biometric Boarding")}
        description={t(
          "biometric.seoDescription",
          "Manage biometric boarding gates, enrollments, and audit events"
        )}
      />
      <div className="container mx-auto p-6 max-w-7xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Fingerprint className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">
                {t("biometric.title", "Biometric Boarding")}
              </h1>
              <p className="text-muted-foreground text-sm">
                {t(
                  "biometric.subtitle",
                  "Manage biometric gates, monitor enrollments, and review audit trails"
                )}
              </p>
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        <SummaryCards />

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-8">
          <TabsList className="mb-6">
            <TabsTrigger value="gates" className="gap-2">
              <Monitor className="h-4 w-4" />
              {t("biometric.gates", "Gate Status")}
            </TabsTrigger>
            <TabsTrigger value="events" className="gap-2">
              <Eye className="h-4 w-4" />
              {t("biometric.events", "Events Log")}
            </TabsTrigger>
            <TabsTrigger value="config" className="gap-2">
              <Settings className="h-4 w-4" />
              {t("biometric.configuration", "Configuration")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="gates">
            <GateStatusTab />
          </TabsContent>

          <TabsContent value="events">
            <EventsLogTab />
          </TabsContent>

          <TabsContent value="config">
            <ConfigurationTab />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

// ============================================================================
// Summary Cards
// ============================================================================

function SummaryCards() {
  const { t } = useTranslation();

  // Summary data uses mock since there is no dedicated summary endpoint.
  // When a real aggregation endpoint is added, replace MOCK_SUMMARY with the
  // query result and add loading skeletons.
  const summary = MOCK_SUMMARY;

  const cards = [
    {
      title: t("biometric.totalEnrollments", "Total Enrollments"),
      value: summary.totalEnrollments.toLocaleString(),
      icon: Fingerprint,
      color: "text-blue-600 dark:text-blue-400",
      bgColor: "bg-blue-50 dark:bg-blue-950",
    },
    {
      title: t("biometric.verifiedToday", "Verified Today"),
      value: summary.verifiedToday.toLocaleString(),
      icon: CheckCircle2,
      color: "text-green-600 dark:text-green-400",
      bgColor: "bg-green-50 dark:bg-green-950",
    },
    {
      title: t("biometric.activeGates", "Active Gates"),
      value: summary.activeGates.toString(),
      icon: Monitor,
      color: "text-purple-600 dark:text-purple-400",
      bgColor: "bg-purple-50 dark:bg-purple-950",
    },
    {
      title: t("biometric.successRate", "Success Rate"),
      value: `${summary.successRate}%`,
      icon: Activity,
      color: "text-emerald-600 dark:text-emerald-400",
      bgColor: "bg-emerald-50 dark:bg-emerald-950",
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {cards.map(card => (
        <Card key={card.title} className="shadow-sm rounded-xl">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{card.title}</CardTitle>
            <div className={`p-2 rounded-lg ${card.bgColor}`}>
              <card.icon className={`h-4 w-4 ${card.color}`} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{card.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================================================================
// Gate Status Tab
// ============================================================================

function GateStatusTab() {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const [gateIdFilter, setGateIdFilter] = useState("");

  // Try to use the real API, fall back to mock data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const biometricTrpc = (trpc as any).biometric as {
    getGateStatus: {
      useQuery: (
        input: { gateId: number },
        opts: { enabled: boolean }
      ) => {
        data: GateStatusRecord | undefined;
        isLoading: boolean;
        isError: boolean;
      };
    };
  };

  const parsedGateId = gateIdFilter ? parseInt(gateIdFilter, 10) : 0;

  const gateQuery = biometricTrpc?.getGateStatus?.useQuery(
    { gateId: parsedGateId },
    { enabled: parsedGateId > 0 }
  );

  // Use mock gates when no specific gate is queried or API unavailable
  const gates: GateStatusRecord[] =
    parsedGateId > 0 && gateQuery?.data
      ? [gateQuery.data as GateStatusRecord]
      : MOCK_GATES;

  const isLoading = parsedGateId > 0 && gateQuery?.isLoading;

  const onlineCount = gates.filter(g => g.status === "online").length;
  const offlineCount = gates.filter(g => g.status === "offline").length;
  const maintenanceCount = gates.filter(g => g.status === "maintenance").length;

  return (
    <div className="space-y-6">
      {/* Gate filter */}
      <Card className="p-4 shadow-sm rounded-xl">
        <div className="flex items-end gap-4">
          <div className="flex-1 max-w-xs">
            <label className="text-sm font-medium mb-1 block">
              {t("biometric.filterByGate", "Filter by Gate ID")}
            </label>
            <Input
              type="number"
              placeholder={t(
                "biometric.enterGateId",
                "Enter gate ID to filter..."
              )}
              value={gateIdFilter}
              onChange={e => setGateIdFilter(e.target.value)}
            />
          </div>
          {gateIdFilter && (
            <Button variant="outline" onClick={() => setGateIdFilter("")}>
              {t("biometric.clearFilter", "Clear")}
            </Button>
          )}
        </div>
      </Card>

      {/* Status summary strip */}
      <div className="flex gap-4 flex-wrap">
        <div className="flex items-center gap-2 text-sm">
          <div className="h-3 w-3 rounded-full bg-green-500" />
          <span className="text-muted-foreground">
            {t("biometric.online", "Online")}: {onlineCount}
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <div className="h-3 w-3 rounded-full bg-red-500" />
          <span className="text-muted-foreground">
            {t("biometric.offline", "Offline")}: {offlineCount}
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <div className="h-3 w-3 rounded-full bg-yellow-500" />
          <span className="text-muted-foreground">
            {t("biometric.maintenance", "Maintenance")}: {maintenanceCount}
          </span>
        </div>
      </div>

      {/* Gates table */}
      <Card className="shadow-sm rounded-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Monitor className="h-5 w-5" />
            {t("biometric.gateOverview", "Gate Biometric Status")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : gates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Monitor className="h-12 w-12 mb-3" />
              <p className="text-sm">
                {t("biometric.noGates", "No gate data available")}
              </p>
            </div>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("biometric.gateId", "Gate")}</TableHead>
                    <TableHead>{t("biometric.terminal", "Terminal")}</TableHead>
                    <TableHead>{t("biometric.deviceType", "Device")}</TableHead>
                    <TableHead>{t("biometric.status", "Status")}</TableHead>
                    <TableHead>{t("biometric.firmware", "Firmware")}</TableHead>
                    <TableHead>
                      {t("biometric.lastHeartbeat", "Last Heartbeat")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("biometric.processed", "Processed")}
                    </TableHead>
                    <TableHead className="text-right">
                      {t("biometric.gateSuccessRate", "Success %")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {gates.map(gate => (
                    <TableRow key={gate.gateId}>
                      <TableCell className="font-medium">
                        {gate.gateName}
                      </TableCell>
                      <TableCell>{gate.terminal}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {gate.deviceType}
                      </TableCell>
                      <TableCell>
                        <GateStatusBadge status={gate.status} />
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        v{gate.firmwareVersion}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {format(
                          new Date(gate.lastHeartbeat),
                          "MMM dd, HH:mm:ss",
                          { locale: dateLocale }
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {gate.passengersProcessed.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {gate.status === "online" ? (
                          <span
                            className={`font-semibold ${
                              gate.successRate >= 95
                                ? "text-green-600 dark:text-green-400"
                                : gate.successRate >= 85
                                  ? "text-yellow-600 dark:text-yellow-400"
                                  : "text-red-600 dark:text-red-400"
                            }`}
                          >
                            {gate.successRate.toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-muted-foreground">--</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// Events Log Tab
// ============================================================================

function EventsLogTab() {
  const { t } = useTranslation();
  const dateLocale = useDateLocale();
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("all");
  const [limit] = useState(50);

  // Try the real API
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const biometricTrpc = (trpc as any).biometric as {
    getEvents: {
      useQuery: (
        input?: {
          eventType?: string;
          limit?: number;
          offset?: number;
        },
        opts?: { enabled: boolean }
      ) => {
        data: BiometricEvent[] | undefined;
        isLoading: boolean;
        isError: boolean;
        refetch: () => void;
      };
    };
  };

  const eventInput: Record<string, unknown> = { limit, offset: 0 };
  if (eventTypeFilter !== "all") {
    eventInput.eventType = eventTypeFilter;
  }

  const eventsQuery = biometricTrpc?.getEvents?.useQuery(eventInput, {
    enabled: true,
  });

  const events: BiometricEvent[] =
    eventsQuery?.data ??
    (eventTypeFilter === "all"
      ? MOCK_EVENTS
      : MOCK_EVENTS.filter(e => e.eventType === eventTypeFilter));

  const isLoading = eventsQuery?.isLoading ?? false;

  return (
    <div className="space-y-6">
      {/* Filter controls */}
      <Card className="p-4 shadow-sm rounded-xl">
        <div className="flex items-end gap-4 flex-wrap">
          <div>
            <label className="text-sm font-medium mb-1 block">
              {t("biometric.eventType", "Event Type")}
            </label>
            <div className="flex gap-2 flex-wrap">
              {[
                { value: "all", label: t("biometric.allEvents", "All") },
                {
                  value: "enrollment",
                  label: t("biometric.enrollment", "Enrollment"),
                },
                {
                  value: "verification_success",
                  label: t("biometric.verified", "Verified"),
                },
                {
                  value: "verification_failure",
                  label: t("biometric.failed", "Failed"),
                },
                {
                  value: "boarding_complete",
                  label: t("biometric.boarded", "Boarded"),
                },
              ].map(filter => (
                <Button
                  key={filter.value}
                  variant={
                    eventTypeFilter === filter.value ? "default" : "outline"
                  }
                  size="sm"
                  onClick={() => setEventTypeFilter(filter.value)}
                >
                  {filter.label}
                </Button>
              ))}
            </div>
          </div>
          {eventsQuery?.refetch && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => eventsQuery.refetch()}
            >
              {t("biometric.refresh", "Refresh")}
            </Button>
          )}
        </div>
      </Card>

      {/* Events table */}
      <Card className="shadow-sm rounded-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            {t("biometric.auditTrail", "Biometric Audit Trail")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : events.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Eye className="h-12 w-12 mb-3" />
              <p className="text-sm">
                {t("biometric.noEvents", "No biometric events found")}
              </p>
            </div>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("biometric.eventId", "ID")}</TableHead>
                    <TableHead>
                      {t("biometric.eventTypeCol", "Event")}
                    </TableHead>
                    <TableHead>
                      {t("biometric.passenger", "Passenger")}
                    </TableHead>
                    <TableHead>{t("biometric.flight", "Flight")}</TableHead>
                    <TableHead>{t("biometric.gate", "Gate")}</TableHead>
                    <TableHead>
                      {t("biometric.biometricType", "Type")}
                    </TableHead>
                    <TableHead>
                      {t("biometric.timestamp", "Timestamp")}
                    </TableHead>
                    <TableHead>{t("biometric.details", "Details")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.map(event => (
                    <TableRow
                      key={event.id}
                      className={
                        event.eventType === "verification_failure"
                          ? "bg-red-50/50 dark:bg-red-950/20"
                          : ""
                      }
                    >
                      <TableCell className="font-mono text-sm text-muted-foreground">
                        #{event.id}
                      </TableCell>
                      <TableCell>
                        <EventTypeBadge eventType={event.eventType} />
                      </TableCell>
                      <TableCell>
                        <div>
                          <span className="font-medium">
                            {event.passengerName}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            ID: {event.passengerId}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {event.flightNumber ? (
                          <Badge variant="outline" className="font-mono">
                            {event.flightNumber}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">--</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {event.gateName ?? (
                          <span className="text-muted-foreground">--</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="capitalize">
                          {event.biometricType}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {format(new Date(event.timestamp), "MMM dd, HH:mm:ss", {
                          locale: dateLocale,
                        })}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                        {event.details ?? "--"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// Configuration Tab
// ============================================================================

function ConfigurationTab() {
  const { t } = useTranslation();

  const [form, setForm] = useState<GateConfigForm>({
    gateId: "",
    airportId: "",
    deviceType: "",
    status: "online",
    firmwareVersion: "",
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const biometricTrpc = (trpc as any).biometric as {
    configureGate: {
      useMutation: (opts: {
        onSuccess: () => void;
        onError: (err: { message: string }) => void;
      }) => {
        mutate: (input: {
          gateId: number;
          airportId: number;
          deviceType: string;
          status: "online" | "offline" | "maintenance";
          firmwareVersion?: string;
        }) => void;
        isPending: boolean;
      };
    };
  };

  const configureMutation = biometricTrpc?.configureGate?.useMutation({
    onSuccess: () => {
      toast.success(
        t(
          "biometric.gateConfigured",
          "Gate biometric configuration updated successfully"
        )
      );
      setForm({
        gateId: "",
        airportId: "",
        deviceType: "",
        status: "online",
        firmwareVersion: "",
      });
    },
    onError: (err: { message: string }) => {
      toast.error(err.message);
    },
  });

  const handleSubmit = () => {
    const gateId = parseInt(form.gateId, 10);
    const airportId = parseInt(form.airportId, 10);

    if (!gateId || !airportId || !form.deviceType) {
      toast.error(
        t(
          "biometric.configValidation",
          "Please fill in all required fields: Gate ID, Airport ID, and Device Type"
        )
      );
      return;
    }

    if (configureMutation) {
      configureMutation.mutate({
        gateId,
        airportId,
        deviceType: form.deviceType,
        status: form.status,
        firmwareVersion: form.firmwareVersion || undefined,
      });
    } else {
      toast.success(
        t(
          "biometric.gateConfiguredMock",
          "Gate configuration saved (mock mode)"
        )
      );
      setForm({
        gateId: "",
        airportId: "",
        deviceType: "",
        status: "online",
        firmwareVersion: "",
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Configuration form */}
      <Card className="shadow-sm rounded-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            {t("biometric.configureGate", "Configure Gate Biometric Hardware")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="text-sm font-medium mb-1 block">
                {t("biometric.gateIdLabel", "Gate ID")} *
              </label>
              <Input
                type="number"
                placeholder={t("biometric.enterGateIdConfig", "e.g. 1")}
                value={form.gateId}
                onChange={e => setForm({ ...form, gateId: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">
                {t("biometric.airportId", "Airport ID")} *
              </label>
              <Input
                type="number"
                placeholder={t("biometric.enterAirportId", "e.g. 1")}
                value={form.airportId}
                onChange={e => setForm({ ...form, airportId: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">
                {t("biometric.deviceTypeLabel", "Device Type")} *
              </label>
              <Input
                placeholder={t(
                  "biometric.enterDeviceType",
                  "e.g. NEC NeoFace, IDEMIA MorphoWave"
                )}
                value={form.deviceType}
                onChange={e => setForm({ ...form, deviceType: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">
                {t("biometric.gateStatus", "Status")}
              </label>
              <div className="flex gap-2">
                {(["online", "offline", "maintenance"] as const).map(status => (
                  <Button
                    key={status}
                    variant={form.status === status ? "default" : "outline"}
                    size="sm"
                    onClick={() => setForm({ ...form, status })}
                    className="capitalize"
                  >
                    {status}
                  </Button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">
                {t("biometric.firmwareVersionLabel", "Firmware Version")}
              </label>
              <Input
                placeholder={t("biometric.enterFirmware", "e.g. 4.2.1")}
                value={form.firmwareVersion}
                onChange={e =>
                  setForm({ ...form, firmwareVersion: e.target.value })
                }
              />
            </div>
          </div>

          <div className="mt-6 flex items-center gap-4">
            <Button
              onClick={handleSubmit}
              disabled={configureMutation?.isPending ?? false}
              className="gap-2"
            >
              <Settings className="h-4 w-4" />
              {configureMutation?.isPending
                ? t("biometric.configuring", "Configuring...")
                : t("biometric.saveConfig", "Save Configuration")}
            </Button>
            <p className="text-xs text-muted-foreground">
              {t(
                "biometric.configNote",
                "Fields marked with * are required. Changes take effect immediately."
              )}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Device type reference */}
      <Card className="shadow-sm rounded-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scan className="h-5 w-5" />
            {t("biometric.supportedDevices", "Supported Biometric Devices")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("biometric.deviceName", "Device")}</TableHead>
                  <TableHead>
                    {t("biometric.manufacturer", "Manufacturer")}
                  </TableHead>
                  <TableHead>{t("biometric.modality", "Modality")}</TableHead>
                  <TableHead>
                    {t("biometric.latestFirmware", "Latest Firmware")}
                  </TableHead>
                  <TableHead>
                    {t("biometric.compatibility", "Compatibility")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="font-medium">NEC NeoFace</TableCell>
                  <TableCell>NEC Corporation</TableCell>
                  <TableCell>
                    <Badge variant="secondary">Face</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm">v4.2.1</TableCell>
                  <TableCell>
                    <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-0">
                      <CheckCircle2 className="mr-1 h-3 w-3" />
                      {t("biometric.certified", "Certified")}
                    </Badge>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">
                    IDEMIA MorphoWave
                  </TableCell>
                  <TableCell>IDEMIA</TableCell>
                  <TableCell>
                    <Badge variant="secondary">Fingerprint</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm">v3.8.0</TableCell>
                  <TableCell>
                    <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-0">
                      <CheckCircle2 className="mr-1 h-3 w-3" />
                      {t("biometric.certified", "Certified")}
                    </Badge>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">SITA Smart Path</TableCell>
                  <TableCell>SITA</TableCell>
                  <TableCell>
                    <Badge variant="secondary">Face</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm">v5.1.0</TableCell>
                  <TableCell>
                    <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-0">
                      <CheckCircle2 className="mr-1 h-3 w-3" />
                      {t("biometric.certified", "Certified")}
                    </Badge>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell className="font-medium">
                    IriTech IriShield
                  </TableCell>
                  <TableCell>IriTech Inc.</TableCell>
                  <TableCell>
                    <Badge variant="secondary">Iris</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm">v2.4.0</TableCell>
                  <TableCell>
                    <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 border-0">
                      {t("biometric.pending", "Pending")}
                    </Badge>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
