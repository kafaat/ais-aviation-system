import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  DoorOpen,
  Plus,
  Building2,
  PlaneTakeoff,
  Wrench,
  CheckCircle,
  Trash2,
  Loader2,
  RefreshCw,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import { useAuth } from "@/_core/hooks/useAuth";
import { Redirect } from "wouter";

type GateType = "domestic" | "international" | "both";
type GateStatus = "available" | "occupied" | "maintenance";

interface CreateGateForm {
  airportId: number | null;
  gateNumber: string;
  terminal: string;
  type: GateType;
  capacity: string;
}

const initialFormState: CreateGateForm = {
  airportId: null,
  gateNumber: "",
  terminal: "",
  type: "both",
  capacity: "",
};

export default function GateManagement() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "ar" ? ar : enUS;
  const { user, loading: authLoading } = useAuth();

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [formData, setFormData] = useState<CreateGateForm>(initialFormState);
  const [selectedAirportId, setSelectedAirportId] = useState<number | null>(
    null
  );
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split("T")[0]
  );
  const [activeTab, setActiveTab] = useState("gates");

  // Fetch airports for dropdown
  const { data: airports } = trpc.reference.airports.useQuery();

  // Fetch gates for selected airport
  const {
    data: gates,
    isLoading: gatesLoading,
    refetch: refetchGates,
  } = trpc.gates.getAirportGates.useQuery(
    { airportId: selectedAirportId ?? 0 },
    { enabled: !!selectedAirportId }
  );

  // Fetch gate schedule for selected airport and date
  const { data: scheduleData, isLoading: scheduleLoading } =
    trpc.gates.getGateSchedule.useQuery(
      { airportId: selectedAirportId ?? 0, date: new Date(selectedDate) },
      { enabled: !!selectedAirportId && activeTab === "schedule" }
    );

  // Fetch gate statistics
  const { data: stats, isLoading: statsLoading } = trpc.gates.getStats.useQuery(
    selectedAirportId ? { airportId: selectedAirportId } : undefined
  );

  // Mutations
  const createGateMutation = trpc.gates.createGate.useMutation({
    onSuccess: () => {
      toast.success(t("admin.gates.created"));
      setIsCreateDialogOpen(false);
      setFormData(initialFormState);
      refetchGates();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const updateStatusMutation = trpc.gates.updateGateStatus.useMutation({
    onSuccess: () => {
      toast.success(t("admin.gates.statusUpdated"));
      refetchGates();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const deleteGateMutation = trpc.gates.deleteGate.useMutation({
    onSuccess: () => {
      toast.success(t("admin.gates.deleted"));
      refetchGates();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  if (authLoading) {
    return (
      <div className="container mx-auto max-w-7xl space-y-6 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
    return <Redirect to="/" />;
  }

  const handleCreateGate = () => {
    if (!formData.airportId || !formData.gateNumber) {
      toast.error(t("admin.gates.requiredFields"));
      return;
    }

    createGateMutation.mutate({
      airportId: formData.airportId,
      gateNumber: formData.gateNumber,
      terminal: formData.terminal || undefined,
      type: formData.type,
      capacity: formData.capacity || undefined,
    });
  };

  const handleStatusChange = (gateId: number, status: GateStatus) => {
    updateStatusMutation.mutate({ gateId, status });
  };

  const handleDeleteGate = (gateId: number) => {
    if (window.confirm(t("admin.gates.confirmDelete"))) {
      deleteGateMutation.mutate({ gateId });
    }
  };

  const getStatusBadge = (status: GateStatus) => {
    switch (status) {
      case "available":
        return (
          <Badge variant="default" className="bg-green-500">
            <CheckCircle className="mr-1 h-3 w-3" />
            {t("admin.gates.statusAvailable")}
          </Badge>
        );
      case "occupied":
        return (
          <Badge variant="default" className="bg-blue-500">
            <PlaneTakeoff className="mr-1 h-3 w-3" />
            {t("admin.gates.statusOccupied")}
          </Badge>
        );
      case "maintenance":
        return (
          <Badge variant="destructive">
            <Wrench className="mr-1 h-3 w-3" />
            {t("admin.gates.statusMaintenance")}
          </Badge>
        );
    }
  };

  const getTypeBadge = (type: GateType) => {
    switch (type) {
      case "domestic":
        return <Badge variant="outline">{t("admin.gates.typeDomestic")}</Badge>;
      case "international":
        return (
          <Badge variant="outline">{t("admin.gates.typeInternational")}</Badge>
        );
      case "both":
        return <Badge variant="secondary">{t("admin.gates.typeBoth")}</Badge>;
    }
  };

  return (
    <div className="container mx-auto max-w-7xl space-y-6 p-6">
      <SEO
        title={t("admin.gates.title")}
        description={t("admin.gates.description")}
      />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("admin.gates.title")}</h1>
          <p className="text-muted-foreground">
            {t("admin.gates.description")}
          </p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              {t("admin.gates.create")}
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[425px]">
            <DialogHeader>
              <DialogTitle>{t("admin.gates.createTitle")}</DialogTitle>
              <DialogDescription>
                {t("admin.gates.createDescription")}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="airport">{t("admin.gates.airport")}</Label>
                <Select
                  value={formData.airportId?.toString() ?? ""}
                  onValueChange={value =>
                    setFormData({ ...formData, airportId: parseInt(value) })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("admin.gates.selectAirport")} />
                  </SelectTrigger>
                  <SelectContent>
                    {airports?.map(airport => (
                      <SelectItem
                        key={airport.id}
                        value={airport.id.toString()}
                      >
                        {airport.code} - {airport.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="gateNumber">
                    {t("admin.gates.gateNumber")}
                  </Label>
                  <Input
                    id="gateNumber"
                    value={formData.gateNumber}
                    onChange={e =>
                      setFormData({
                        ...formData,
                        gateNumber: e.target.value.toUpperCase(),
                      })
                    }
                    placeholder="A1"
                    className="uppercase"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="terminal">{t("admin.gates.terminal")}</Label>
                  <Input
                    id="terminal"
                    value={formData.terminal}
                    onChange={e =>
                      setFormData({ ...formData, terminal: e.target.value })
                    }
                    placeholder="1"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="type">{t("admin.gates.type")}</Label>
                  <Select
                    value={formData.type}
                    onValueChange={(value: GateType) =>
                      setFormData({ ...formData, type: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="domestic">
                        {t("admin.gates.typeDomestic")}
                      </SelectItem>
                      <SelectItem value="international">
                        {t("admin.gates.typeInternational")}
                      </SelectItem>
                      <SelectItem value="both">
                        {t("admin.gates.typeBoth")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="capacity">{t("admin.gates.capacity")}</Label>
                  <Select
                    value={formData.capacity}
                    onValueChange={value =>
                      setFormData({ ...formData, capacity: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={t("admin.gates.selectCapacity")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="narrow-body">Narrow-body</SelectItem>
                      <SelectItem value="wide-body">Wide-body</SelectItem>
                      <SelectItem value="regional">Regional</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsCreateDialogOpen(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                onClick={handleCreateGate}
                disabled={createGateMutation.isPending || !formData.gateNumber}
              >
                {createGateMutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {t("common.create")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Airport Selection */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <Label htmlFor="airport-filter">
                {t("admin.gates.filterByAirport")}
              </Label>
              <Select
                value={selectedAirportId?.toString() ?? ""}
                onValueChange={value => setSelectedAirportId(parseInt(value))}
              >
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder={t("admin.gates.selectAirport")} />
                </SelectTrigger>
                <SelectContent>
                  {airports?.map(airport => (
                    <SelectItem key={airport.id} value={airport.id.toString()}>
                      {airport.code} - {airport.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedAirportId && (
              <Button
                variant="outline"
                onClick={() => refetchGates()}
                className="mt-8"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                {t("common.refresh")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Stats Cards */}
      {!statsLoading && stats && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {t("admin.gates.totalGates")}
              </CardTitle>
              <DoorOpen className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalGates}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {t("admin.gates.availableGates")}
              </CardTitle>
              <CheckCircle className="h-4 w-4 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {stats.availableGates}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {t("admin.gates.occupiedGates")}
              </CardTitle>
              <PlaneTakeoff className="h-4 w-4 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">
                {stats.occupiedGates}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {t("admin.gates.todayAssignments")}
              </CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.todayAssignments}</div>
              <p className="text-xs text-muted-foreground">
                {stats.todayGateChanges} {t("admin.gates.gateChanges")}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tabs */}
      {selectedAirportId && (
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="gates">
              <DoorOpen className="mr-2 h-4 w-4" />
              {t("admin.gates.gatesTab")}
            </TabsTrigger>
            <TabsTrigger value="schedule">
              <Calendar className="mr-2 h-4 w-4" />
              {t("admin.gates.scheduleTab")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="gates" className="mt-4">
            <Card>
              <CardContent className="p-0">
                {gatesLoading ? (
                  <div className="space-y-4 p-6">
                    {[1, 2, 3].map(i => (
                      <Skeleton key={i} className="h-16 w-full" />
                    ))}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("admin.gates.gateNumber")}</TableHead>
                        <TableHead>{t("admin.gates.terminal")}</TableHead>
                        <TableHead>{t("admin.gates.type")}</TableHead>
                        <TableHead>{t("admin.gates.capacity")}</TableHead>
                        <TableHead>{t("admin.gates.status")}</TableHead>
                        <TableHead>{t("common.actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {gates?.map(gate => (
                        <TableRow key={gate.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <DoorOpen className="h-4 w-4 text-muted-foreground" />
                              <span className="font-mono font-semibold">
                                {gate.gateNumber}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            {gate.terminal ? (
                              <div className="flex items-center gap-1">
                                <Building2 className="h-3 w-3" />
                                {gate.terminal}
                              </div>
                            ) : (
                              "-"
                            )}
                          </TableCell>
                          <TableCell>
                            {getTypeBadge(gate.type as GateType)}
                          </TableCell>
                          <TableCell>{gate.capacity || "-"}</TableCell>
                          <TableCell>
                            {getStatusBadge(gate.status as GateStatus)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Select
                                value={gate.status}
                                onValueChange={(value: GateStatus) =>
                                  handleStatusChange(gate.id, value)
                                }
                              >
                                <SelectTrigger className="h-8 w-[130px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="available">
                                    {t("admin.gates.statusAvailable")}
                                  </SelectItem>
                                  <SelectItem value="occupied">
                                    {t("admin.gates.statusOccupied")}
                                  </SelectItem>
                                  <SelectItem value="maintenance">
                                    {t("admin.gates.statusMaintenance")}
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive"
                                onClick={() => handleDeleteGate(gate.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                      {gates?.length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={6}
                            className="py-8 text-center text-muted-foreground"
                          >
                            {t("admin.gates.noGates")}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="schedule" className="mt-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>{t("admin.gates.scheduleTitle")}</CardTitle>
                  <Input
                    type="date"
                    value={selectedDate}
                    onChange={e => setSelectedDate(e.target.value)}
                    className="w-auto"
                  />
                </div>
              </CardHeader>
              <CardContent>
                {scheduleLoading ? (
                  <div className="space-y-4">
                    {[1, 2, 3].map(i => (
                      <Skeleton key={i} className="h-24 w-full" />
                    ))}
                  </div>
                ) : scheduleData?.gates && scheduleData.gates.length > 0 ? (
                  <div className="space-y-4">
                    {scheduleData.gates.map(gate => (
                      <div key={gate.id} className="rounded-lg border p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <DoorOpen className="h-5 w-5" />
                            <span className="font-semibold">
                              {gate.gateNumber}
                            </span>
                            {gate.terminal && (
                              <Badge variant="outline">
                                <Building2 className="mr-1 h-3 w-3" />
                                {gate.terminal}
                              </Badge>
                            )}
                          </div>
                          {getStatusBadge(gate.status as GateStatus)}
                        </div>
                        {gate.assignments && gate.assignments.length > 0 ? (
                          <div className="space-y-2">
                            {gate.assignments.map(assignment => (
                              <div
                                key={assignment.id}
                                className="flex items-center justify-between rounded bg-muted/50 p-2 text-sm"
                              >
                                <div className="flex items-center gap-2">
                                  <PlaneTakeoff className="h-4 w-4" />
                                  <span className="font-medium">
                                    {assignment.flightNumber}
                                  </span>
                                </div>
                                <div className="text-muted-foreground">
                                  {format(
                                    new Date(assignment.departureTime),
                                    "HH:mm",
                                    { locale }
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            {t("admin.gates.noAssignments")}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="py-8 text-center text-muted-foreground">
                    {t("admin.gates.noGates")}
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {!selectedAirportId && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Building2 className="mx-auto mb-4 h-12 w-12 opacity-50" />
            <p>{t("admin.gates.selectAirportFirst")}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
