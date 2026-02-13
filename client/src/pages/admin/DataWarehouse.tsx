import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Database,
  Download,
  Plus,
  Calendar,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  Activity,
  HardDrive,
  FileText,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAuth } from "@/_core/hooks/useAuth";
import { Redirect } from "wouter";

// ============================================================================
// Types
// ============================================================================

type ExportType =
  | "bookings"
  | "flights"
  | "revenue"
  | "customers"
  | "operational";
type ExportFormat = "csv" | "json" | "jsonl";
type ScheduleFrequency = "daily" | "weekly" | "monthly";

interface CreateExportForm {
  exportType: ExportType;
  startDate: string;
  endDate: string;
  format: ExportFormat;
  incremental: boolean;
}

interface CreateScheduleForm {
  name: string;
  exportType: ExportType;
  frequency: ScheduleFrequency;
  format: ExportFormat;
}

// ============================================================================
// Constants
// ============================================================================

const EXPORT_TYPE_LABELS: Record<ExportType, string> = {
  bookings: "Bookings",
  flights: "Flights",
  revenue: "Revenue",
  customers: "Customer Analytics",
  operational: "Operational Metrics",
};

const FORMAT_LABELS: Record<ExportFormat, string> = {
  csv: "CSV",
  json: "JSON",
  jsonl: "JSON Lines",
};

const FREQUENCY_LABELS: Record<ScheduleFrequency, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

const initialExportForm: CreateExportForm = {
  exportType: "bookings",
  startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0],
  endDate: new Date().toISOString().split("T")[0],
  format: "csv",
  incremental: false,
};

const initialScheduleForm: CreateScheduleForm = {
  name: "",
  exportType: "bookings",
  frequency: "daily",
  format: "csv",
};

// ============================================================================
// Status Badge Component
// ============================================================================

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return (
        <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
          <CheckCircle2 className="mr-1 h-3 w-3" />
          Completed
        </Badge>
      );
    case "processing":
      return (
        <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          Processing
        </Badge>
      );
    case "failed":
      return (
        <Badge className="bg-red-100 text-red-800 hover:bg-red-100">
          <XCircle className="mr-1 h-3 w-3" />
          Failed
        </Badge>
      );
    case "pending":
      return (
        <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">
          <Clock className="mr-1 h-3 w-3" />
          Pending
        </Badge>
      );
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

// ============================================================================
// ETL Status Indicator Component
// ============================================================================

function ETLStatusIndicator({
  status,
}: {
  status: "healthy" | "degraded" | "down";
}) {
  const config = {
    healthy: {
      color: "bg-green-500",
      label: "Healthy",
      icon: <CheckCircle2 className="h-5 w-5 text-green-600" />,
    },
    degraded: {
      color: "bg-yellow-500",
      label: "Degraded",
      icon: <AlertTriangle className="h-5 w-5 text-yellow-600" />,
    },
    down: {
      color: "bg-red-500",
      label: "Down",
      icon: <XCircle className="h-5 w-5 text-red-600" />,
    },
  };

  const { color, label, icon } = config[status];

  return (
    <div className="flex items-center gap-2">
      <div className={`h-3 w-3 rounded-full ${color} animate-pulse`} />
      {icon}
      <span className="font-medium">{label}</span>
    </div>
  );
}

// ============================================================================
// Data Volume Bar Component
// ============================================================================

function DataVolumeBar({
  label,
  value,
  maxValue,
  color,
}: {
  label: string;
  value: number;
  maxValue: number;
  color: string;
}) {
  const percentage = maxValue > 0 ? Math.min((value / maxValue) * 100, 100) : 0;

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{value.toLocaleString()}</span>
      </div>
      <div className="h-3 w-full rounded-full bg-gray-100">
        <div
          className={`h-3 rounded-full ${color} transition-all duration-500`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

// ============================================================================
// Format file size for display
// ============================================================================

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(1)} ${units[i]}`;
}

// ============================================================================
// Main Component
// ============================================================================

export default function DataWarehouse() {
  const { t: _t } = useTranslation();
  const { user, loading: authLoading } = useAuth();

  const [activeTab, setActiveTab] = useState("exports");
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);
  const [exportForm, setExportForm] =
    useState<CreateExportForm>(initialExportForm);
  const [scheduleForm, setScheduleForm] =
    useState<CreateScheduleForm>(initialScheduleForm);
  const [currentPage, setCurrentPage] = useState(1);

  // ---------- Queries ----------

  const {
    data: exportsData,
    isLoading: exportsLoading,
    refetch: refetchExports,
  } = trpc.dataWarehouse.getExports.useQuery({
    page: currentPage,
    limit: 10,
  });

  const {
    data: schedules,
    isLoading: schedulesLoading,
    refetch: refetchSchedules,
  } = trpc.dataWarehouse.getSchedules.useQuery();

  const { data: etlStatus, isLoading: etlLoading } =
    trpc.dataWarehouse.getETLStatus.useQuery();

  // ---------- Mutations ----------

  const createExportMutation = trpc.dataWarehouse.createExport.useMutation({
    onSuccess: (data: { recordCount: number }) => {
      toast.success(
        `Export created: ${data.recordCount.toLocaleString()} records exported`
      );
      setIsExportDialogOpen(false);
      setExportForm(initialExportForm);
      refetchExports();
    },
    onError: (error: { message: string }) => {
      toast.error(`Export failed: ${error.message}`);
    },
  });

  const createScheduleMutation = trpc.dataWarehouse.createSchedule.useMutation({
    onSuccess: () => {
      toast.success("Schedule created successfully");
      setIsScheduleDialogOpen(false);
      setScheduleForm(initialScheduleForm);
      refetchSchedules();
    },
    onError: (error: { message: string }) => {
      toast.error(`Failed to create schedule: ${error.message}`);
    },
  });

  const updateScheduleMutation = trpc.dataWarehouse.updateSchedule.useMutation({
    onSuccess: (result: { success: boolean; message?: string }) => {
      if (result.success) {
        toast.success("Schedule updated");
        refetchSchedules();
      } else {
        toast.error(result.message ?? "Update failed");
      }
    },
    onError: (error: { message: string }) => {
      toast.error(error.message);
    },
  });

  const deleteScheduleMutation = trpc.dataWarehouse.deleteSchedule.useMutation({
    onSuccess: (result: { success: boolean; message: string }) => {
      if (result.success) {
        toast.success("Schedule deleted");
        refetchSchedules();
      } else {
        toast.error(result.message);
      }
    },
    onError: (error: { message: string }) => {
      toast.error(error.message);
    },
  });

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

  function handleCreateExport() {
    createExportMutation.mutate({
      exportType: exportForm.exportType,
      startDate: new Date(exportForm.startDate),
      endDate: new Date(exportForm.endDate),
      format: exportForm.format,
      incremental: exportForm.incremental,
    });
  }

  function handleCreateSchedule() {
    if (!scheduleForm.name.trim()) {
      toast.error("Schedule name is required");
      return;
    }
    createScheduleMutation.mutate({
      name: scheduleForm.name,
      exportType: scheduleForm.exportType,
      frequency: scheduleForm.frequency,
      format: scheduleForm.format,
    });
  }

  function handleToggleSchedule(id: number, isActive: boolean) {
    updateScheduleMutation.mutate({ id, isActive: !isActive });
  }

  function handleDeleteSchedule(id: number) {
    deleteScheduleMutation.mutate({ id });
  }

  // ---------- Compute volume chart data ----------

  const exportsList = (exportsData?.exports ?? []) as Array<{
    id: number;
    exportType: string;
    dateRangeStart: string | Date;
    dateRangeEnd: string | Date;
    format: string;
    status: string;
    filePath: string | null;
    recordCount: number;
    fileSize: number;
    createdBy: number;
    createdAt: string | Date;
    completedAt: string | Date | null;
    errorMessage: string | null;
  }>;

  const exportsByType = exportsList.reduce(
    (acc: Record<string, number>, e) => {
      acc[e.exportType] = (acc[e.exportType] || 0) + e.recordCount;
      return acc;
    },
    {} as Record<string, number>
  );

  const maxVolume = Math.max(...Object.values(exportsByType), 1);

  const volumeColors: Record<string, string> = {
    bookings: "bg-blue-500",
    flights: "bg-emerald-500",
    revenue: "bg-amber-500",
    customers: "bg-purple-500",
    operational: "bg-rose-500",
  };

  // ---------- Typed data for rendering ----------

  const schedulesList = (schedules ?? []) as Array<{
    id: number;
    name: string;
    exportType: string;
    frequency: string;
    format: string;
    lastRunAt: string | Date | null;
    nextRunAt: string | Date;
    isActive: boolean;
    config: Record<string, unknown>;
    createdAt: string | Date;
  }>;

  const recentFailures = (etlStatus?.recentFailures ?? []) as Array<{
    id: number;
    exportType: string;
    errorMessage: string | null;
    createdAt: string;
  }>;

  // ---------- Render ----------

  return (
    <div className="container py-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Database className="h-8 w-8" />
            Data Warehouse
          </h1>
          <p className="text-muted-foreground mt-1">
            Export data for BI analytics, ETL pipelines, and reporting
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setIsScheduleDialogOpen(true)}
          >
            <Clock className="mr-2 h-4 w-4" />
            New Schedule
          </Button>
          <Button onClick={() => setIsExportDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Export
          </Button>
        </div>
      </div>

      {/* ETL Status Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Pipeline Status
            </CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {etlLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <ETLStatusIndicator status={etlStatus?.status ?? "healthy"} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Exports</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {etlLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {etlStatus?.totalExports ?? 0}
                </div>
                <p className="text-xs text-muted-foreground">
                  {etlStatus?.completedExports ?? 0} completed,{" "}
                  {etlStatus?.failedExports ?? 0} failed
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Active Schedules
            </CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {etlLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">
                {etlStatus?.activeSchedules ?? 0}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Last Export</CardTitle>
            <HardDrive className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {etlLoading ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <div className="text-sm font-medium">
                {etlStatus?.lastExportAt
                  ? format(
                      new Date(etlStatus.lastExportAt),
                      "MMM dd, yyyy HH:mm"
                    )
                  : "No exports yet"}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="exports">Export History</TabsTrigger>
          <TabsTrigger value="schedules">Scheduled Exports</TabsTrigger>
          <TabsTrigger value="volume">Data Volume</TabsTrigger>
        </TabsList>

        {/* Export History Tab */}
        <TabsContent value="exports">
          <Card>
            <CardHeader>
              <CardTitle>Export History</CardTitle>
              <CardDescription>
                Recent data warehouse export jobs and their status
              </CardDescription>
            </CardHeader>
            <CardContent>
              {exportsLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : !exportsList.length ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Database className="mx-auto h-12 w-12 mb-4 opacity-50" />
                  <p className="text-lg font-medium">No exports yet</p>
                  <p className="text-sm">
                    Create your first export to get started
                  </p>
                </div>
              ) : (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>ID</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Date Range</TableHead>
                        <TableHead>Format</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Records</TableHead>
                        <TableHead>Size</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {exportsList.map(exp => (
                        <TableRow key={exp.id}>
                          <TableCell className="font-mono text-sm">
                            #{exp.id}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">
                              {EXPORT_TYPE_LABELS[
                                exp.exportType as ExportType
                              ] ?? exp.exportType}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {format(new Date(exp.dateRangeStart), "MMM dd")} -{" "}
                            {format(new Date(exp.dateRangeEnd), "MMM dd, yyyy")}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">
                              {FORMAT_LABELS[exp.format as ExportFormat] ??
                                exp.format}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={exp.status} />
                          </TableCell>
                          <TableCell>
                            {exp.recordCount.toLocaleString()}
                          </TableCell>
                          <TableCell>{formatFileSize(exp.fileSize)}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {format(new Date(exp.createdAt), "MMM dd, HH:mm")}
                          </TableCell>
                          <TableCell>
                            {exp.status === "completed" && (
                              <Button variant="ghost" size="sm">
                                <Download className="h-4 w-4" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>

                  {/* Pagination */}
                  {(exportsData?.totalPages ?? 0) > 1 && (
                    <div className="flex items-center justify-between mt-4">
                      <p className="text-sm text-muted-foreground">
                        Page {exportsData?.page ?? 1} of{" "}
                        {exportsData?.totalPages ?? 1} (
                        {exportsData?.total ?? 0} total)
                      </p>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={currentPage <= 1}
                          onClick={() =>
                            setCurrentPage(prev => Math.max(1, prev - 1))
                          }
                        >
                          Previous
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={
                            currentPage >= (exportsData?.totalPages ?? 1)
                          }
                          onClick={() =>
                            setCurrentPage(prev =>
                              Math.min(exportsData?.totalPages ?? 1, prev + 1)
                            )
                          }
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Scheduled Exports Tab */}
        <TabsContent value="schedules">
          <Card>
            <CardHeader>
              <CardTitle>Scheduled Exports</CardTitle>
              <CardDescription>
                Automated export schedules for recurring data warehouse feeds
              </CardDescription>
            </CardHeader>
            <CardContent>
              {schedulesLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : !schedulesList.length ? (
                <div className="text-center py-12 text-muted-foreground">
                  <Clock className="mx-auto h-12 w-12 mb-4 opacity-50" />
                  <p className="text-lg font-medium">No scheduled exports</p>
                  <p className="text-sm">
                    Set up automated exports for your ETL pipeline
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Frequency</TableHead>
                      <TableHead>Format</TableHead>
                      <TableHead>Last Run</TableHead>
                      <TableHead>Next Run</TableHead>
                      <TableHead>Active</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {schedulesList.map(schedule => (
                      <TableRow key={schedule.id}>
                        <TableCell className="font-medium">
                          {schedule.name}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {EXPORT_TYPE_LABELS[
                              schedule.exportType as ExportType
                            ] ?? schedule.exportType}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {FREQUENCY_LABELS[
                            schedule.frequency as ScheduleFrequency
                          ] ?? schedule.frequency}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {FORMAT_LABELS[schedule.format as ExportFormat] ??
                              schedule.format}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {schedule.lastRunAt
                            ? format(
                                new Date(schedule.lastRunAt),
                                "MMM dd, HH:mm"
                              )
                            : "Never"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {format(
                            new Date(schedule.nextRunAt),
                            "MMM dd, yyyy HH:mm"
                          )}
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={schedule.isActive}
                            onCheckedChange={() =>
                              handleToggleSchedule(
                                schedule.id,
                                schedule.isActive
                              )
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteSchedule(schedule.id)}
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Data Volume Tab */}
        <TabsContent value="volume">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Records by Export Type</CardTitle>
                <CardDescription>
                  Total records exported by data category
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {Object.entries(EXPORT_TYPE_LABELS).map(([key, label]) => (
                  <DataVolumeBar
                    key={key}
                    label={label}
                    value={exportsByType[key] || 0}
                    maxValue={maxVolume}
                    color={volumeColors[key] || "bg-gray-500"}
                  />
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>ETL Pipeline Health</CardTitle>
                <CardDescription>
                  Current pipeline status and recent activity
                </CardDescription>
              </CardHeader>
              <CardContent>
                {etlLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-6 w-full" />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between py-2 border-b">
                      <span className="text-sm text-muted-foreground">
                        Status
                      </span>
                      <ETLStatusIndicator
                        status={etlStatus?.status ?? "healthy"}
                      />
                    </div>
                    <div className="flex items-center justify-between py-2 border-b">
                      <span className="text-sm text-muted-foreground">
                        Completed
                      </span>
                      <span className="font-medium text-green-600">
                        {etlStatus?.completedExports ?? 0}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b">
                      <span className="text-sm text-muted-foreground">
                        Failed
                      </span>
                      <span className="font-medium text-red-600">
                        {etlStatus?.failedExports ?? 0}
                      </span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-b">
                      <span className="text-sm text-muted-foreground">
                        Processing
                      </span>
                      <span className="font-medium text-blue-600">
                        {etlStatus?.processingExports ?? 0}
                      </span>
                    </div>

                    {/* Recent failures */}
                    {recentFailures.length > 0 && (
                      <div className="mt-4">
                        <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
                          <AlertTriangle className="h-4 w-4 text-yellow-500" />
                          Recent Failures
                        </h4>
                        <div className="space-y-2">
                          {recentFailures.map(failure => (
                            <div
                              key={failure.id}
                              className="text-xs p-2 rounded bg-red-50 border border-red-100"
                            >
                              <div className="flex justify-between">
                                <span className="font-medium">
                                  #{failure.id} - {failure.exportType}
                                </span>
                                <span className="text-muted-foreground">
                                  {format(
                                    new Date(failure.createdAt),
                                    "MMM dd, HH:mm"
                                  )}
                                </span>
                              </div>
                              {failure.errorMessage && (
                                <p className="text-red-600 mt-1 truncate">
                                  {failure.errorMessage}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Create Export Dialog */}
      <Dialog open={isExportDialogOpen} onOpenChange={setIsExportDialogOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Create Data Export</DialogTitle>
            <DialogDescription>
              Export data for your BI/ETL pipeline
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Export Type</Label>
              <Select
                value={exportForm.exportType}
                onValueChange={val =>
                  setExportForm(prev => ({
                    ...prev,
                    exportType: val as ExportType,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(EXPORT_TYPE_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input
                  type="date"
                  value={exportForm.startDate}
                  onChange={e =>
                    setExportForm(prev => ({
                      ...prev,
                      startDate: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input
                  type="date"
                  value={exportForm.endDate}
                  onChange={e =>
                    setExportForm(prev => ({
                      ...prev,
                      endDate: e.target.value,
                    }))
                  }
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Format</Label>
              <Select
                value={exportForm.format}
                onValueChange={val =>
                  setExportForm(prev => ({
                    ...prev,
                    format: val as ExportFormat,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(FORMAT_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Switch
                id="incremental"
                checked={exportForm.incremental}
                onCheckedChange={val =>
                  setExportForm(prev => ({ ...prev, incremental: val }))
                }
              />
              <Label htmlFor="incremental">
                Incremental export (only changed records)
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsExportDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateExport}
              disabled={createExportMutation.isPending}
            >
              {createExportMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Start Export
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Schedule Dialog */}
      <Dialog
        open={isScheduleDialogOpen}
        onOpenChange={setIsScheduleDialogOpen}
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Create Export Schedule</DialogTitle>
            <DialogDescription>
              Set up automated recurring data exports
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Schedule Name</Label>
              <Input
                placeholder="e.g., Daily Bookings Export"
                value={scheduleForm.name}
                onChange={e =>
                  setScheduleForm(prev => ({
                    ...prev,
                    name: e.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-2">
              <Label>Export Type</Label>
              <Select
                value={scheduleForm.exportType}
                onValueChange={val =>
                  setScheduleForm(prev => ({
                    ...prev,
                    exportType: val as ExportType,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(EXPORT_TYPE_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Frequency</Label>
              <Select
                value={scheduleForm.frequency}
                onValueChange={val =>
                  setScheduleForm(prev => ({
                    ...prev,
                    frequency: val as ScheduleFrequency,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(FREQUENCY_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Format</Label>
              <Select
                value={scheduleForm.format}
                onValueChange={val =>
                  setScheduleForm(prev => ({
                    ...prev,
                    format: val as ExportFormat,
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(FORMAT_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsScheduleDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateSchedule}
              disabled={createScheduleMutation.isPending}
            >
              {createScheduleMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Calendar className="mr-2 h-4 w-4" />
                  Create Schedule
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
