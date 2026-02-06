import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link } from "wouter";
import {
  ChevronLeft,
  Plane,
  Users,
  Weight,
  FileText,
  Shield,
  AlertTriangle,
  CheckCircle,
  ClipboardList,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

type Tab = "overview" | "manifest" | "crew" | "loadplan" | "aircraft";

export default function DcsDashboard() {
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
            {t("dcs.title", "Departure Control System")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t(
              "dcs.subtitle",
              "Flight operations, crew, weight & balance, manifests"
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
              label: t("dcs.tabs.overview", "Overview"),
              icon: Plane,
            },
            {
              id: "manifest",
              label: t("dcs.tabs.manifest", "Flight Manifest"),
              icon: FileText,
            },
            {
              id: "crew",
              label: t("dcs.tabs.crew", "Crew Management"),
              icon: Users,
            },
            {
              id: "loadplan",
              label: t("dcs.tabs.loadPlan", "Weight & Balance"),
              icon: Weight,
            },
            {
              id: "aircraft",
              label: t("dcs.tabs.aircraft", "Aircraft Types"),
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
      {activeTab === "manifest" && <ManifestTab />}
      {activeTab === "crew" && <CrewTab />}
      {activeTab === "loadplan" && <LoadPlanTab />}
      {activeTab === "aircraft" && <AircraftTab />}
    </div>
  );
}

// ============================================================================
// Overview Tab
// ============================================================================

function OverviewTab() {
  const { t } = useTranslation();
  const { data: stats, isLoading } = trpc.dcs.getStats.useQuery();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-6 animate-pulse">
            <div className="h-20 bg-muted rounded" />
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-6">
          <div className="flex items-center gap-3 mb-2">
            <Plane className="h-5 w-5 text-blue-500" />
            <span className="text-sm text-muted-foreground">
              {t("dcs.stats.todayFlights", "Today's Flights")}
            </span>
          </div>
          <p className="text-3xl font-bold">{stats?.flights.total ?? 0}</p>
          <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
            <span>
              {t("dcs.stats.scheduled", "Scheduled")}:{" "}
              {stats?.flights.scheduled ?? 0}
            </span>
            <span>
              {t("dcs.stats.delayed", "Delayed")}: {stats?.flights.delayed ?? 0}
            </span>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-3 mb-2">
            <Users className="h-5 w-5 text-green-500" />
            <span className="text-sm text-muted-foreground">
              {t("dcs.stats.crewMembers", "Crew Members")}
            </span>
          </div>
          <p className="text-3xl font-bold">{stats?.crew.total ?? 0}</p>
          <p className="text-xs text-muted-foreground mt-2">
            {t("dcs.stats.active", "Active")}: {stats?.crew.active ?? 0}
          </p>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-3 mb-2">
            <ClipboardList className="h-5 w-5 text-orange-500" />
            <span className="text-sm text-muted-foreground">
              {t("dcs.stats.loadPlans", "Load Plans")}
            </span>
          </div>
          <p className="text-3xl font-bold">{stats?.loadPlans.total ?? 0}</p>
          <div className="flex gap-3 mt-2 text-xs text-muted-foreground">
            <span>
              {t("dcs.stats.approved", "Approved")}:{" "}
              {stats?.loadPlans.approved ?? 0}
            </span>
            <span>
              {t("dcs.stats.finalized", "Finalized")}:{" "}
              {stats?.loadPlans.finalized ?? 0}
            </span>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-3 mb-2">
            <Shield className="h-5 w-5 text-purple-500" />
            <span className="text-sm text-muted-foreground">
              {t("dcs.stats.aircraftTypes", "Aircraft Types")}
            </span>
          </div>
          <p className="text-3xl font-bold">{stats?.aircraftTypes ?? 0}</p>
        </Card>
      </div>
    </div>
  );
}

// ============================================================================
// Manifest Tab
// ============================================================================

function ManifestTab() {
  const { t } = useTranslation();
  const [flightId, setFlightId] = useState("");
  const parsedFlightId = flightId ? parseInt(flightId) : 0;

  const {
    data: manifestData,
    isLoading,
    refetch,
  } = trpc.dcs.getFlightManifest.useQuery(
    { flightId: parsedFlightId },
    { enabled: parsedFlightId > 0 }
  );

  const manifest = manifestData?.manifest;

  return (
    <div className="space-y-6">
      {/* Search */}
      <Card className="p-4">
        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <Label>{t("dcs.manifest.flightId", "Flight ID")}</Label>
            <Input
              type="number"
              value={flightId}
              onChange={e => setFlightId(e.target.value)}
              placeholder={t("dcs.manifest.enterFlightId", "Enter flight ID")}
            />
          </div>
          <Button onClick={() => refetch()} disabled={!parsedFlightId}>
            <FileText className="h-4 w-4 mr-2" />
            {t("dcs.manifest.generate", "Generate Manifest")}
          </Button>
        </div>
      </Card>

      {isLoading && (
        <Card className="p-6 animate-pulse">
          <div className="h-40 bg-muted rounded" />
        </Card>
      )}

      {manifest && (
        <div className="space-y-4">
          {/* Flight Info */}
          <Card className="p-6">
            <h3 className="font-semibold text-lg mb-4">
              {t("dcs.manifest.flightInfo", "Flight Information")}
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-muted-foreground">
                  {t("dcs.manifest.flight", "Flight")}
                </p>
                <p className="font-medium">
                  {manifest.flight.airline.code} {manifest.flight.flightNumber}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {t("dcs.manifest.route", "Route")}
                </p>
                <p className="font-medium">
                  {manifest.flight.origin.code} →{" "}
                  {manifest.flight.destination.code}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {t("dcs.manifest.aircraft", "Aircraft")}
                </p>
                <p className="font-medium">
                  {manifest.flight.aircraftType ?? "N/A"}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  {t("dcs.manifest.loadFactor", "Load Factor")}
                </p>
                <p className="font-medium">{manifest.capacity.loadFactor}%</p>
              </div>
            </div>
          </Card>

          {/* Passenger Summary */}
          <Card className="p-6">
            <h3 className="font-semibold text-lg mb-4">
              {t("dcs.manifest.passengers", "Passengers")} (
              {manifest.passengers.total})
            </h3>
            <div className="grid grid-cols-3 md:grid-cols-5 gap-4 mb-4">
              <div className="text-center p-3 bg-muted rounded">
                <p className="text-2xl font-bold">
                  {manifest.passengers.adults}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("dcs.manifest.adults", "Adults")}
                </p>
              </div>
              <div className="text-center p-3 bg-muted rounded">
                <p className="text-2xl font-bold">
                  {manifest.passengers.children}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("dcs.manifest.children", "Children")}
                </p>
              </div>
              <div className="text-center p-3 bg-muted rounded">
                <p className="text-2xl font-bold">
                  {manifest.passengers.infants}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("dcs.manifest.infants", "Infants")}
                </p>
              </div>
              <div className="text-center p-3 bg-blue-50 dark:bg-blue-950 rounded">
                <p className="text-2xl font-bold">
                  {manifest.passengers.economy}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("dcs.manifest.economy", "Economy")}
                </p>
              </div>
              <div className="text-center p-3 bg-amber-50 dark:bg-amber-950 rounded">
                <p className="text-2xl font-bold">
                  {manifest.passengers.business}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("dcs.manifest.business", "Business")}
                </p>
              </div>
            </div>

            {/* Passenger List */}
            <div className="border rounded max-h-64 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="p-2 text-start">
                      {t("dcs.manifest.name", "Name")}
                    </th>
                    <th className="p-2 text-start">
                      {t("dcs.manifest.pnr", "PNR")}
                    </th>
                    <th className="p-2 text-start">
                      {t("dcs.manifest.type", "Type")}
                    </th>
                    <th className="p-2 text-start">
                      {t("dcs.manifest.class", "Class")}
                    </th>
                    <th className="p-2 text-start">
                      {t("dcs.manifest.seat", "Seat")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {manifest.passengers.list.map(p => (
                    <tr key={p.id} className="border-t">
                      <td className="p-2">{p.name}</td>
                      <td className="p-2 font-mono">{p.pnr}</td>
                      <td className="p-2">{p.type}</td>
                      <td className="p-2">{p.cabinClass}</td>
                      <td className="p-2">{p.seat ?? "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Crew & Baggage */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="p-6">
              <h3 className="font-semibold text-lg mb-4">
                {t("dcs.manifest.crewOnboard", "Crew")} ({manifest.crew.total})
              </h3>
              {manifest.crew.cockpit.length > 0 && (
                <div className="mb-3">
                  <p className="text-sm font-medium text-muted-foreground mb-1">
                    {t("dcs.manifest.cockpit", "Cockpit")}
                  </p>
                  {manifest.crew.cockpit.map(c => (
                    <p key={c.assignmentId} className="text-sm">
                      {c.firstName} {c.lastName} - {c.role}
                    </p>
                  ))}
                </div>
              )}
              {manifest.crew.cabin.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">
                    {t("dcs.manifest.cabin", "Cabin")}
                  </p>
                  {manifest.crew.cabin.map(c => (
                    <p key={c.assignmentId} className="text-sm">
                      {c.firstName} {c.lastName} - {c.role}
                    </p>
                  ))}
                </div>
              )}
              {manifest.crew.total === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("dcs.manifest.noCrewAssigned", "No crew assigned")}
                </p>
              )}
            </Card>

            <Card className="p-6">
              <h3 className="font-semibold text-lg mb-4">
                {t("dcs.manifest.baggage", "Baggage")}
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="text-center p-4 bg-muted rounded">
                  <p className="text-2xl font-bold">
                    {manifest.baggage.pieces}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("dcs.manifest.pieces", "Pieces")}
                  </p>
                </div>
                <div className="text-center p-4 bg-muted rounded">
                  <p className="text-2xl font-bold">
                    {manifest.baggage.totalWeight} kg
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("dcs.manifest.totalWeight", "Total Weight")}
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Crew Tab
// ============================================================================

function CrewTab() {
  const { t } = useTranslation();
  const {
    data: crewList,
    isLoading,
    refetch,
  } = trpc.dcs.getCrewMembers.useQuery({});
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    employeeId: "",
    firstName: "",
    lastName: "",
    role: "" as "captain" | "first_officer" | "purser" | "cabin_crew" | "",
    airlineId: "",
    licenseNumber: "",
    email: "",
    phone: "",
  });

  const createMutation = trpc.dcs.createCrewMember.useMutation({
    onSuccess: () => {
      toast.success(t("dcs.crew.created", "Crew member added"));
      setShowAdd(false);
      setForm({
        employeeId: "",
        firstName: "",
        lastName: "",
        role: "",
        airlineId: "",
        licenseNumber: "",
        email: "",
        phone: "",
      });
      refetch();
    },
    onError: err => toast.error(err.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-lg">
          {t("dcs.crew.title", "Crew Members")} ({crewList?.length ?? 0})
        </h3>
        <Button onClick={() => setShowAdd(!showAdd)} className="gap-2">
          <UserPlus className="h-4 w-4" />
          {t("dcs.crew.addNew", "Add Crew Member")}
        </Button>
      </div>

      {showAdd && (
        <Card className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>{t("dcs.crew.employeeId", "Employee ID")}</Label>
              <Input
                value={form.employeeId}
                onChange={e => setForm({ ...form, employeeId: e.target.value })}
              />
            </div>
            <div>
              <Label>{t("dcs.crew.firstName", "First Name")}</Label>
              <Input
                value={form.firstName}
                onChange={e => setForm({ ...form, firstName: e.target.value })}
              />
            </div>
            <div>
              <Label>{t("dcs.crew.lastName", "Last Name")}</Label>
              <Input
                value={form.lastName}
                onChange={e => setForm({ ...form, lastName: e.target.value })}
              />
            </div>
            <div>
              <Label>{t("dcs.crew.role", "Role")}</Label>
              <Select
                value={form.role}
                onValueChange={v =>
                  setForm({ ...form, role: v as typeof form.role })
                }
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={t("dcs.crew.selectRole", "Select role")}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="captain">
                    {t("dcs.crew.captain", "Captain")}
                  </SelectItem>
                  <SelectItem value="first_officer">
                    {t("dcs.crew.firstOfficer", "First Officer")}
                  </SelectItem>
                  <SelectItem value="purser">
                    {t("dcs.crew.purser", "Purser")}
                  </SelectItem>
                  <SelectItem value="cabin_crew">
                    {t("dcs.crew.cabinCrew", "Cabin Crew")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t("dcs.crew.airlineId", "Airline ID")}</Label>
              <Input
                type="number"
                value={form.airlineId}
                onChange={e => setForm({ ...form, airlineId: e.target.value })}
              />
            </div>
            <div>
              <Label>{t("dcs.crew.license", "License Number")}</Label>
              <Input
                value={form.licenseNumber}
                onChange={e =>
                  setForm({ ...form, licenseNumber: e.target.value })
                }
              />
            </div>
          </div>
          <Button
            className="mt-4"
            disabled={
              !form.employeeId ||
              !form.firstName ||
              !form.lastName ||
              !form.role ||
              !form.airlineId
            }
            onClick={() =>
              createMutation.mutate({
                ...form,
                role: form.role as
                  | "captain"
                  | "first_officer"
                  | "purser"
                  | "cabin_crew",
                airlineId: parseInt(form.airlineId),
                licenseNumber: form.licenseNumber || undefined,
                email: form.email || undefined,
                phone: form.phone || undefined,
              })
            }
          >
            {t("dcs.crew.save", "Save")}
          </Button>
        </Card>
      )}

      {isLoading ? (
        <Card className="p-6 animate-pulse">
          <div className="h-40 bg-muted rounded" />
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="p-3 text-start">
                  {t("dcs.crew.employeeId", "Employee ID")}
                </th>
                <th className="p-3 text-start">{t("dcs.crew.name", "Name")}</th>
                <th className="p-3 text-start">{t("dcs.crew.role", "Role")}</th>
                <th className="p-3 text-start">
                  {t("dcs.crew.status", "Status")}
                </th>
                <th className="p-3 text-start">
                  {t("dcs.crew.license", "License")}
                </th>
              </tr>
            </thead>
            <tbody>
              {crewList?.map(crew => (
                <tr key={crew.id} className="border-t">
                  <td className="p-3 font-mono">{crew.employeeId}</td>
                  <td className="p-3">
                    {crew.firstName} {crew.lastName}
                  </td>
                  <td className="p-3 capitalize">
                    {crew.role.replace("_", " ")}
                  </td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-1 rounded text-xs ${
                        crew.status === "active"
                          ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                          : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                      }`}
                    >
                      {crew.status}
                    </span>
                  </td>
                  <td className="p-3">{crew.licenseNumber ?? "-"}</td>
                </tr>
              ))}
              {(!crewList || crewList.length === 0) && (
                <tr>
                  <td
                    colSpan={5}
                    className="p-6 text-center text-muted-foreground"
                  >
                    {t("dcs.crew.empty", "No crew members found")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Load Plan Tab
// ============================================================================

function LoadPlanTab() {
  const { t } = useTranslation();
  const [flightId, setFlightId] = useState("");
  const [aircraftTypeId, setAircraftTypeId] = useState("");
  const [fuelWeight, setFuelWeight] = useState("");

  const parsedFlightId = flightId ? parseInt(flightId) : 0;
  const { data: aircraftList } = trpc.dcs.getAircraftTypes.useQuery();
  const { data: existingPlan } = trpc.dcs.getLoadPlan.useQuery(
    { flightId: parsedFlightId },
    { enabled: parsedFlightId > 0 }
  );

  const calculateMutation = trpc.dcs.createLoadPlan.useMutation({
    onSuccess: () =>
      toast.success(t("dcs.loadPlan.created", "Load plan calculated")),
    onError: err => toast.error(err.message),
  });

  const approveMutation = trpc.dcs.approveLoadPlan.useMutation({
    onSuccess: () =>
      toast.success(t("dcs.loadPlan.approved", "Load plan approved")),
    onError: err => toast.error(err.message),
  });

  const wb = calculateMutation.data;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="font-semibold mb-4">
          {t("dcs.loadPlan.calculate", "Calculate Weight & Balance")}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label>{t("dcs.loadPlan.flightId", "Flight ID")}</Label>
            <Input
              type="number"
              value={flightId}
              onChange={e => setFlightId(e.target.value)}
            />
          </div>
          <div>
            <Label>{t("dcs.loadPlan.aircraftType", "Aircraft Type")}</Label>
            <Select value={aircraftTypeId} onValueChange={setAircraftTypeId}>
              <SelectTrigger>
                <SelectValue
                  placeholder={t(
                    "dcs.loadPlan.selectAircraft",
                    "Select aircraft"
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                {aircraftList?.map(ac => (
                  <SelectItem key={ac.id} value={ac.id.toString()}>
                    {ac.code} - {ac.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t("dcs.loadPlan.fuelWeight", "Fuel Weight (kg)")}</Label>
            <Input
              type="number"
              value={fuelWeight}
              onChange={e => setFuelWeight(e.target.value)}
            />
          </div>
        </div>
        <Button
          className="mt-4"
          disabled={!parsedFlightId || !aircraftTypeId || !fuelWeight}
          onClick={() =>
            calculateMutation.mutate({
              flightId: parsedFlightId,
              aircraftTypeId: parseInt(aircraftTypeId),
              fuelWeight: parseInt(fuelWeight),
            })
          }
        >
          <Weight className="h-4 w-4 mr-2" />
          {t("dcs.loadPlan.calculateBtn", "Calculate")}
        </Button>
      </Card>

      {/* Existing plan */}
      {existingPlan && !wb && (
        <Card className="p-4">
          <h3 className="font-semibold mb-2">
            {t("dcs.loadPlan.existing", "Existing Load Plan")}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-muted-foreground">
                {t("dcs.loadPlan.status", "Status")}
              </p>
              <p className="font-medium capitalize">{existingPlan.status}</p>
            </div>
            <div>
              <p className="text-muted-foreground">
                {t("dcs.loadPlan.takeoffWeight", "Takeoff Weight")}
              </p>
              <p className="font-medium">
                {existingPlan.takeoffWeight?.toLocaleString()} kg
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">
                {t("dcs.loadPlan.cgPosition", "CG Position")}
              </p>
              <p className="font-medium">{existingPlan.cgPosition}% MAC</p>
            </div>
            <div>
              <p className="text-muted-foreground">
                {t("dcs.loadPlan.withinLimits", "Within Limits")}
              </p>
              {existingPlan.withinLimits ? (
                <CheckCircle className="h-5 w-5 text-green-500" />
              ) : (
                <AlertTriangle className="h-5 w-5 text-red-500" />
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Calculation Results */}
      {wb && (
        <div className="space-y-4">
          {/* Safety Status */}
          <Card
            className={`p-4 border-2 ${wb.safety.withinLimits ? "border-green-500" : "border-red-500"}`}
          >
            <div className="flex items-center gap-3">
              {wb.safety.withinLimits ? (
                <CheckCircle className="h-6 w-6 text-green-500" />
              ) : (
                <AlertTriangle className="h-6 w-6 text-red-500" />
              )}
              <div>
                <p className="font-semibold">
                  {wb.safety.withinLimits
                    ? t(
                        "dcs.loadPlan.withinLimitsMsg",
                        "All weights within limits"
                      )
                    : t(
                        "dcs.loadPlan.exceedsLimits",
                        "Weight limits exceeded!"
                      )}
                </p>
                {wb.safety.warnings.map((w: string, i: number) => (
                  <p key={i} className="text-sm text-red-600">
                    {w}
                  </p>
                ))}
              </div>
            </div>
          </Card>

          {/* Weight Breakdown */}
          <Card className="p-6">
            <h3 className="font-semibold text-lg mb-4">
              {t("dcs.loadPlan.weightBreakdown", "Weight Breakdown")}
            </h3>
            <div className="space-y-3">
              <WeightRow
                label={t("dcs.loadPlan.oew", "Operating Empty Weight")}
                value={wb.weights.operatingEmpty}
              />
              <WeightRow
                label={`${t("dcs.loadPlan.passengers", "Passengers")} (${wb.weights.passengers.count})`}
                value={wb.weights.passengers.weight}
              />
              <WeightRow
                label={`${t("dcs.loadPlan.baggageLabel", "Baggage")} (${wb.weights.baggage.count} pcs)`}
                value={wb.weights.baggage.weight}
              />
              <WeightRow
                label={t("dcs.loadPlan.cargo", "Cargo")}
                value={wb.weights.cargo.weight}
              />
              <hr />
              <WeightRow
                label={t("dcs.loadPlan.zfw", "Zero Fuel Weight")}
                value={wb.weights.zeroFuel}
                limit={wb.aircraft.limits.mzfw}
                bold
              />
              <WeightRow
                label={t("dcs.loadPlan.fuel", "Fuel")}
                value={wb.weights.fuel}
                limit={wb.aircraft.limits.maxFuel}
              />
              <hr />
              <WeightRow
                label={t("dcs.loadPlan.tow", "Takeoff Weight")}
                value={wb.weights.takeoff}
                limit={wb.aircraft.limits.mtow}
                bold
              />
              <WeightRow
                label={t("dcs.loadPlan.lw", "Landing Weight")}
                value={wb.weights.landing}
                limit={wb.aircraft.limits.mlw}
                bold
              />
            </div>
          </Card>

          {/* CG */}
          <Card className="p-6">
            <h3 className="font-semibold text-lg mb-4">
              {t("dcs.loadPlan.centerOfGravity", "Center of Gravity")}
            </h3>
            <div className="flex items-center gap-4">
              <span className="text-sm">{wb.balance.forwardLimit}%</span>
              <div className="flex-1 h-6 bg-muted rounded relative">
                <div
                  className="absolute top-0 bottom-0 bg-green-200 dark:bg-green-900 rounded"
                  style={{
                    left: `${(wb.balance.forwardLimit / 50) * 100}%`,
                    right: `${100 - (wb.balance.aftLimit / 50) * 100}%`,
                  }}
                />
                <div
                  className={`absolute top-0 bottom-0 w-1 rounded ${
                    wb.balance.cgPosition >= wb.balance.forwardLimit &&
                    wb.balance.cgPosition <= wb.balance.aftLimit
                      ? "bg-green-600"
                      : "bg-red-600"
                  }`}
                  style={{ left: `${(wb.balance.cgPosition / 50) * 100}%` }}
                />
              </div>
              <span className="text-sm">{wb.balance.aftLimit}%</span>
            </div>
            <p className="text-center text-sm mt-2">
              CG: <strong>{wb.balance.cgPosition}%</strong> MAC
            </p>
          </Card>

          {wb.safety.withinLimits && (
            <Button
              onClick={() => approveMutation.mutate({ loadPlanId: wb.id })}
              className="gap-2"
            >
              <CheckCircle className="h-4 w-4" />
              {t("dcs.loadPlan.approve", "Approve Load Plan")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function WeightRow({
  label,
  value,
  limit,
  bold,
}: {
  label: string;
  value: number;
  limit?: number;
  bold?: boolean;
}) {
  const exceeds = limit ? value > limit : false;
  return (
    <div
      className={`flex justify-between items-center ${bold ? "font-semibold" : ""}`}
    >
      <span>{label}</span>
      <span className={exceeds ? "text-red-600 font-bold" : ""}>
        {value.toLocaleString()} kg
        {limit ? (
          <span className="text-xs text-muted-foreground ml-2">
            / {limit.toLocaleString()} kg
          </span>
        ) : null}
      </span>
    </div>
  );
}

// ============================================================================
// Aircraft Tab
// ============================================================================

function AircraftTab() {
  const { t } = useTranslation();
  const {
    data: aircraftList,
    isLoading,
    refetch,
  } = trpc.dcs.getAircraftTypes.useQuery();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    code: "",
    name: "",
    manufacturer: "",
    maxTakeoffWeight: "",
    maxLandingWeight: "",
    maxZeroFuelWeight: "",
    operatingEmptyWeight: "",
    maxPayload: "",
    maxFuelCapacity: "",
    totalSeats: "",
    economySeats: "",
    businessSeats: "",
  });

  const createMutation = trpc.dcs.createAircraftType.useMutation({
    onSuccess: () => {
      toast.success(t("dcs.aircraft.created", "Aircraft type added"));
      setShowAdd(false);
      refetch();
    },
    onError: err => toast.error(err.message),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-lg">
          {t("dcs.aircraft.title", "Aircraft Types")} (
          {aircraftList?.length ?? 0})
        </h3>
        <Button onClick={() => setShowAdd(!showAdd)} className="gap-2">
          <Plane className="h-4 w-4" />
          {t("dcs.aircraft.addNew", "Add Aircraft Type")}
        </Button>
      </div>

      {showAdd && (
        <Card className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>{t("dcs.aircraft.code", "Code")}</Label>
              <Input
                value={form.code}
                onChange={e => setForm({ ...form, code: e.target.value })}
                placeholder="B777"
              />
            </div>
            <div>
              <Label>{t("dcs.aircraft.name", "Name")}</Label>
              <Input
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="Boeing 777-300ER"
              />
            </div>
            <div>
              <Label>{t("dcs.aircraft.manufacturer", "Manufacturer")}</Label>
              <Input
                value={form.manufacturer}
                onChange={e =>
                  setForm({ ...form, manufacturer: e.target.value })
                }
                placeholder="Boeing"
              />
            </div>
            <div>
              <Label>MTOW (kg)</Label>
              <Input
                type="number"
                value={form.maxTakeoffWeight}
                onChange={e =>
                  setForm({ ...form, maxTakeoffWeight: e.target.value })
                }
              />
            </div>
            <div>
              <Label>MLW (kg)</Label>
              <Input
                type="number"
                value={form.maxLandingWeight}
                onChange={e =>
                  setForm({ ...form, maxLandingWeight: e.target.value })
                }
              />
            </div>
            <div>
              <Label>MZFW (kg)</Label>
              <Input
                type="number"
                value={form.maxZeroFuelWeight}
                onChange={e =>
                  setForm({ ...form, maxZeroFuelWeight: e.target.value })
                }
              />
            </div>
            <div>
              <Label>OEW (kg)</Label>
              <Input
                type="number"
                value={form.operatingEmptyWeight}
                onChange={e =>
                  setForm({ ...form, operatingEmptyWeight: e.target.value })
                }
              />
            </div>
            <div>
              <Label>{t("dcs.aircraft.maxPayload", "Max Payload")} (kg)</Label>
              <Input
                type="number"
                value={form.maxPayload}
                onChange={e => setForm({ ...form, maxPayload: e.target.value })}
              />
            </div>
            <div>
              <Label>{t("dcs.aircraft.maxFuel", "Max Fuel")} (kg)</Label>
              <Input
                type="number"
                value={form.maxFuelCapacity}
                onChange={e =>
                  setForm({ ...form, maxFuelCapacity: e.target.value })
                }
              />
            </div>
            <div>
              <Label>{t("dcs.aircraft.totalSeats", "Total Seats")}</Label>
              <Input
                type="number"
                value={form.totalSeats}
                onChange={e => setForm({ ...form, totalSeats: e.target.value })}
              />
            </div>
            <div>
              <Label>{t("dcs.aircraft.economySeats", "Economy Seats")}</Label>
              <Input
                type="number"
                value={form.economySeats}
                onChange={e =>
                  setForm({ ...form, economySeats: e.target.value })
                }
              />
            </div>
            <div>
              <Label>{t("dcs.aircraft.businessSeats", "Business Seats")}</Label>
              <Input
                type="number"
                value={form.businessSeats}
                onChange={e =>
                  setForm({ ...form, businessSeats: e.target.value })
                }
              />
            </div>
          </div>
          <Button
            className="mt-4"
            disabled={
              !form.code ||
              !form.name ||
              !form.manufacturer ||
              !form.maxTakeoffWeight
            }
            onClick={() =>
              createMutation.mutate({
                code: form.code,
                name: form.name,
                manufacturer: form.manufacturer,
                maxTakeoffWeight: parseInt(form.maxTakeoffWeight),
                maxLandingWeight: parseInt(form.maxLandingWeight),
                maxZeroFuelWeight: parseInt(form.maxZeroFuelWeight),
                operatingEmptyWeight: parseInt(form.operatingEmptyWeight),
                maxPayload: parseInt(form.maxPayload),
                maxFuelCapacity: parseInt(form.maxFuelCapacity),
                totalSeats: parseInt(form.totalSeats),
                economySeats: parseInt(form.economySeats),
                businessSeats: parseInt(form.businessSeats),
              })
            }
          >
            {t("dcs.aircraft.save", "Save")}
          </Button>
        </Card>
      )}

      {isLoading ? (
        <Card className="p-6 animate-pulse">
          <div className="h-40 bg-muted rounded" />
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="p-3 text-start">
                  {t("dcs.aircraft.code", "Code")}
                </th>
                <th className="p-3 text-start">
                  {t("dcs.aircraft.name", "Name")}
                </th>
                <th className="p-3 text-start">MTOW</th>
                <th className="p-3 text-start">OEW</th>
                <th className="p-3 text-start">
                  {t("dcs.aircraft.seats", "Seats")}
                </th>
              </tr>
            </thead>
            <tbody>
              {aircraftList?.map(ac => (
                <tr key={ac.id} className="border-t">
                  <td className="p-3 font-mono font-bold">{ac.code}</td>
                  <td className="p-3">{ac.name}</td>
                  <td className="p-3">
                    {ac.maxTakeoffWeight.toLocaleString()} kg
                  </td>
                  <td className="p-3">
                    {ac.operatingEmptyWeight.toLocaleString()} kg
                  </td>
                  <td className="p-3">
                    {ac.totalSeats} ({ac.economySeats}Y / {ac.businessSeats}C)
                  </td>
                </tr>
              ))}
              {(!aircraftList || aircraftList.length === 0) && (
                <tr>
                  <td
                    colSpan={5}
                    className="p-6 text-center text-muted-foreground"
                  >
                    {t("dcs.aircraft.empty", "No aircraft types configured")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
