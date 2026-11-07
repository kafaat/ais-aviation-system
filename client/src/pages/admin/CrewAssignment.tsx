/**
 * Crew Assignment Page
 *
 * Admin interface for managing crew assignments to flights,
 * viewing availability calendars, FTL compliance, and finding replacements.
 */

import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "wouter";
import {
  ChevronLeft,
  Users,
  Plane,
  Search,
  UserPlus,
  UserMinus,
  Calendar,
  Shield,
  AlertTriangle,
  CheckCircle,
  Clock,
  RefreshCw,
  XCircle,
  Scale,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

// ============================================================================
// Types
// ============================================================================

type CrewRole = "captain" | "first_officer" | "purser" | "cabin_crew";
type ActiveTab =
  | "flight-crew"
  | "assign"
  | "availability"
  | "schedule"
  | "replacement"
  | "legality";

interface ScheduleAssignment {
  assignmentId: number;
  role: string;
  assignmentStatus: string;
  notes: string | null;
  flightId: number;
  flightNumber: string;
  departureTime: Date;
  arrivalTime: Date;
  flightStatus: string;
  aircraftType: string | null;
  originId: number;
  destinationId: number;
}

interface ScheduleDay {
  date: string;
  assignments: ScheduleAssignment[];
  totalDutyHours: number;
  ftlStatus: "green" | "yellow" | "red";
}

interface CrewMemberBasic {
  id: number;
  employeeId: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
  qualifiedAircraft: string[];
  email: string | null;
  phone: string | null;
}

const ROLE_LABELS: Record<CrewRole, string> = {
  captain: "Captain",
  first_officer: "First Officer",
  purser: "Purser",
  cabin_crew: "Cabin Crew",
};

const ROLE_COLORS: Record<CrewRole, string> = {
  captain: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  first_officer:
    "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200",
  purser:
    "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  cabin_crew:
    "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
};

// ============================================================================
// Main Component
// ============================================================================

export default function CrewAssignment() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<ActiveTab>("flight-crew");

  const tabs: Array<{ id: ActiveTab; label: string; icon: typeof Users }> = [
    {
      id: "flight-crew",
      label: t("crew.tabs.flightCrew", "Flight Crew"),
      icon: Plane,
    },
    {
      id: "assign",
      label: t("crew.tabs.assign", "Assign Crew"),
      icon: UserPlus,
    },
    {
      id: "availability",
      label: t("crew.tabs.availability", "Availability"),
      icon: Calendar,
    },
    {
      id: "schedule",
      label: t("crew.tabs.schedule", "Schedule"),
      icon: Clock,
    },
    {
      id: "replacement",
      label: t("crew.tabs.replacement", "Find Replacement"),
      icon: RefreshCw,
    },
    {
      id: "legality",
      label: t("crew.tabs.legality", "Legality (FTL)"),
      icon: Scale,
    },
  ];

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link href="/admin/dcs">
          <Button variant="ghost" size="sm">
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">
            {t("crew.title", "Crew Assignment")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t(
              "crew.subtitle",
              "Manage crew assignments, schedules, and FTL compliance"
            )}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {tabs.map(tab => (
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
      {activeTab === "flight-crew" && <FlightCrewTab />}
      {activeTab === "assign" && <AssignCrewTab />}
      {activeTab === "availability" && <AvailabilityTab />}
      {activeTab === "schedule" && <ScheduleTab />}
      {activeTab === "replacement" && <ReplacementTab />}
      {activeTab === "legality" && <LegalityTab />}
    </div>
  );
}

// ============================================================================
// Flight Crew Overview Tab
// ============================================================================

function FlightCrewTab() {
  const { t } = useTranslation();
  const [flightId, setFlightId] = useState("");

  const flightCrewQuery = trpc.crew.getFlightCrew.useQuery(
    { flightId: Number(flightId) },
    { enabled: !!flightId && !isNaN(Number(flightId)) }
  );

  const requirementsQuery = trpc.crew.validateRequirements.useQuery(
    { flightId: Number(flightId) },
    { enabled: !!flightId && !isNaN(Number(flightId)) }
  );

  const removeFromFlight = trpc.crew.removeFromFlight.useMutation({
    onSuccess: () => {
      toast.success(t("crew.removeSuccess", "Crew member removed from flight"));
      flightCrewQuery.refetch();
      requirementsQuery.refetch();
    },
    onError: (err: { message: string }) => {
      toast.error(err.message);
    },
  });

  const data = flightCrewQuery.data;
  const requirements = requirementsQuery.data;

  return (
    <div className="space-y-6">
      {/* Flight selector */}
      <Card className="p-4 shadow-sm rounded-xl">
        <div className="flex items-end gap-4">
          <div className="flex-1">
            <Label>{t("crew.flightId", "Flight ID")}</Label>
            <Input
              type="number"
              placeholder={t("crew.enterFlightId", "Enter flight ID...")}
              value={flightId}
              onChange={e => setFlightId(e.target.value)}
            />
          </div>
          <Button
            onClick={() => {
              flightCrewQuery.refetch();
              requirementsQuery.refetch();
            }}
            disabled={!flightId}
          >
            <Search className="h-4 w-4 mr-2" />
            {t("crew.loadCrew", "Load Crew")}
          </Button>
        </div>
      </Card>

      {/* Requirements validation */}
      {requirements && (
        <Card className="p-4 shadow-sm rounded-xl">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="h-5 w-5" />
            <h3 className="font-semibold">
              {t("crew.requirements", "Crew Requirements")}
            </h3>
            {requirements.meetsMinimum ? (
              <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-0">
                <CheckCircle className="h-3 w-3 mr-1" />
                {t("crew.requirementsMet", "Met")}
              </Badge>
            ) : (
              <Badge variant="destructive">
                <AlertTriangle className="h-3 w-3 mr-1" />
                {t("crew.requirementsNotMet", "Not Met")}
              </Badge>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(requirements.requirements).map(
              ([role, required]: [string, number]) => {
                const assigned =
                  (requirements.roleCounts as Record<string, number>)[role] ??
                  0;
                const isMet = assigned >= required;
                return (
                  <div
                    key={role}
                    className={`p-3 rounded-lg border ${
                      isMet
                        ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950"
                        : "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950"
                    }`}
                  >
                    <div className="text-xs text-muted-foreground uppercase">
                      {ROLE_LABELS[role as CrewRole] ?? role}
                    </div>
                    <div className="text-lg font-bold">
                      {assigned} / {required}
                    </div>
                  </div>
                );
              }
            )}
          </div>
          {requirements.issues.length > 0 && (
            <div className="mt-3 space-y-1">
              {requirements.issues.map(
                (
                  issue: { message: string; role: string; severity: string },
                  idx: number
                ) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400"
                  >
                    <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                    {issue.message}
                  </div>
                )
              )}
            </div>
          )}
        </Card>
      )}

      {/* Flight info */}
      {data?.flight && (
        <Card className="p-4 shadow-sm rounded-xl">
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <span className="text-sm text-muted-foreground">
                {t("crew.flight", "Flight")}
              </span>
              <div className="font-bold text-lg">
                {data.flight.flightNumber}
              </div>
            </div>
            <div>
              <span className="text-sm text-muted-foreground">
                {t("crew.aircraft", "Aircraft")}
              </span>
              <div className="font-medium">
                {data.flight.aircraftType ?? "N/A"}
              </div>
            </div>
            <div>
              <span className="text-sm text-muted-foreground">
                {t("crew.departure", "Departure")}
              </span>
              <div className="font-medium">
                {new Date(data.flight.departureTime).toLocaleString()}
              </div>
            </div>
            <div>
              <span className="text-sm text-muted-foreground">
                {t("crew.arrival", "Arrival")}
              </span>
              <div className="font-medium">
                {new Date(data.flight.arrivalTime).toLocaleString()}
              </div>
            </div>
            <Badge
              variant={
                data.flight.status === "scheduled" ? "secondary" : "outline"
              }
            >
              {data.flight.status}
            </Badge>
          </div>
        </Card>
      )}

      {/* Crew table */}
      {data && (
        <div className="space-y-4">
          {/* Cockpit crew */}
          <Card className="p-4 shadow-sm rounded-xl">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Shield className="h-4 w-4 text-blue-500" />
              {t("crew.cockpitCrew", "Cockpit Crew")} (
              {data.crew.cockpit.length})
            </h3>
            {data.crew.cockpit.length > 0 ? (
              <CrewTable
                assignments={data.crew.cockpit}
                onRemove={(flightId, crewId) =>
                  removeFromFlight.mutate({ flightId, crewMemberId: crewId })
                }
                flightId={Number(flightId)}
                isRemoving={removeFromFlight.isPending}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("crew.noCockpitCrew", "No cockpit crew assigned")}
              </p>
            )}
          </Card>

          {/* Cabin crew */}
          <Card className="p-4 shadow-sm rounded-xl">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Users className="h-4 w-4 text-purple-500" />
              {t("crew.cabinCrew", "Cabin Crew")} ({data.crew.cabin.length})
            </h3>
            {data.crew.cabin.length > 0 ? (
              <CrewTable
                assignments={data.crew.cabin}
                onRemove={(flightId, crewId) =>
                  removeFromFlight.mutate({ flightId, crewMemberId: crewId })
                }
                flightId={Number(flightId)}
                isRemoving={removeFromFlight.isPending}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("crew.noCabinCrew", "No cabin crew assigned")}
              </p>
            )}
          </Card>
        </div>
      )}

      {flightCrewQuery.isLoading && (
        <Card className="p-6 shadow-sm rounded-xl">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-muted rounded w-1/3" />
            <div className="h-20 bg-muted rounded" />
          </div>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Crew Table Component
// ============================================================================

function CrewTable({
  assignments,
  onRemove,
  flightId,
  isRemoving,
}: {
  assignments: Array<{
    assignmentId: number;
    role: string;
    assignmentStatus: string;
    notes: string | null;
    assignedAt: Date;
    crew: {
      id: number;
      employeeId: string;
      firstName: string;
      lastName: string;
      baseRole: string;
      licenseNumber: string | null;
      licenseExpiry: Date | null;
      medicalExpiry: Date | null;
      qualifiedAircraft: string[];
      status: string;
      phone: string | null;
      email: string | null;
    };
  }>;
  onRemove: (flightId: number, crewId: number) => void;
  flightId: number;
  isRemoving: boolean;
}) {
  const { t } = useTranslation();

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("crew.table.employee", "Employee")}</TableHead>
          <TableHead>{t("crew.table.name", "Name")}</TableHead>
          <TableHead>{t("crew.table.role", "Role")}</TableHead>
          <TableHead>{t("crew.table.license", "License")}</TableHead>
          <TableHead>{t("crew.table.status", "Status")}</TableHead>
          <TableHead>
            {t("crew.table.qualifications", "Qualifications")}
          </TableHead>
          <TableHead className="text-right">
            {t("crew.table.actions", "Actions")}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {assignments.map(assignment => {
          const licenseExpired =
            assignment.crew.licenseExpiry &&
            new Date(assignment.crew.licenseExpiry) < new Date();
          const medicalExpired =
            assignment.crew.medicalExpiry &&
            new Date(assignment.crew.medicalExpiry) < new Date();

          return (
            <TableRow key={assignment.assignmentId}>
              <TableCell className="font-mono text-sm">
                {assignment.crew.employeeId}
              </TableCell>
              <TableCell className="font-medium">
                {assignment.crew.firstName} {assignment.crew.lastName}
              </TableCell>
              <TableCell>
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    ROLE_COLORS[assignment.role as CrewRole] ?? ""
                  }`}
                >
                  {ROLE_LABELS[assignment.role as CrewRole] ?? assignment.role}
                </span>
              </TableCell>
              <TableCell>
                <div className="text-sm">
                  {assignment.crew.licenseNumber ?? "N/A"}
                </div>
                {licenseExpired && (
                  <span className="text-xs text-red-500 flex items-center gap-1">
                    <XCircle className="h-3 w-3" />
                    {t("crew.licenseExpired", "Expired")}
                  </span>
                )}
                {medicalExpired && (
                  <span className="text-xs text-red-500 flex items-center gap-1">
                    <XCircle className="h-3 w-3" />
                    {t("crew.medicalExpired", "Medical expired")}
                  </span>
                )}
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    assignment.assignmentStatus === "assigned"
                      ? "secondary"
                      : assignment.assignmentStatus === "confirmed"
                        ? "default"
                        : "outline"
                  }
                >
                  {assignment.assignmentStatus}
                </Badge>
              </TableCell>
              <TableCell>
                <div className="flex gap-1 flex-wrap">
                  {assignment.crew.qualifiedAircraft.map(ac => (
                    <Badge key={ac} variant="outline" className="text-xs">
                      {ac}
                    </Badge>
                  ))}
                  {assignment.crew.qualifiedAircraft.length === 0 && (
                    <span className="text-xs text-muted-foreground">--</span>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isRemoving}
                  onClick={() => onRemove(flightId, assignment.crew.id)}
                >
                  <UserMinus className="h-3 w-3 mr-1" />
                  {t("crew.remove", "Remove")}
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

// ============================================================================
// Assign Crew Tab
// ============================================================================

function AssignCrewTab() {
  const { t } = useTranslation();
  const [flightId, setFlightId] = useState("");
  const [selectedCrewId, setSelectedCrewId] = useState("");
  const [selectedRole, setSelectedRole] = useState<CrewRole | "">("");
  const [notes, setNotes] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [showFtlDialog, setShowFtlDialog] = useState(false);

  const crewMembersQuery = trpc.crew.getMembers.useQuery({
    status: "active",
    role: roleFilter !== "all" ? (roleFilter as CrewRole) : undefined,
    search: searchTerm || undefined,
  });

  const ftlCheckQuery = trpc.crew.getFlightCrew.useQuery(
    { flightId: Number(flightId) },
    { enabled: !!flightId && !isNaN(Number(flightId)) }
  );

  const assignMutation = trpc.crew.assignToFlight.useMutation({
    onSuccess: (result: {
      crewName: string;
      role: string;
      flightNumber: string;
      ftlWarnings?: string[];
    }) => {
      toast.success(
        t("crew.assignSuccess", "{{name}} assigned as {{role}} to {{flight}}", {
          name: result.crewName,
          role: ROLE_LABELS[result.role as CrewRole] ?? result.role,
          flight: result.flightNumber,
        })
      );
      if (result.ftlWarnings && result.ftlWarnings.length > 0) {
        for (const warning of result.ftlWarnings) {
          toast.warning(warning);
        }
      }
      setSelectedCrewId("");
      setSelectedRole("");
      setNotes("");
      ftlCheckQuery.refetch();
    },
    onError: (err: { message: string }) => {
      toast.error(err.message);
    },
  });

  const crewMembers: Array<{
    id: number;
    employeeId: string;
    firstName: string;
    lastName: string;
    role: string;
    status: string;
    qualifiedAircraft: string[];
    email: string | null;
    phone: string | null;
  }> = crewMembersQuery.data ?? [];

  const handleAssign = () => {
    if (!flightId || !selectedCrewId || !selectedRole) {
      toast.error(
        t(
          "crew.assignValidation",
          "Please select a flight, crew member, and role"
        )
      );
      return;
    }
    assignMutation.mutate({
      flightId: Number(flightId),
      crewMemberId: Number(selectedCrewId),
      role: selectedRole as CrewRole,
      notes: notes || undefined,
    });
  };

  return (
    <div className="space-y-6">
      {/* Assignment form */}
      <Card className="p-4 shadow-sm rounded-xl">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <UserPlus className="h-4 w-4" />
          {t("crew.assignCrew", "Assign Crew to Flight")}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <Label>{t("crew.flightId", "Flight ID")}</Label>
            <Input
              type="number"
              placeholder="e.g. 42"
              value={flightId}
              onChange={e => setFlightId(e.target.value)}
            />
          </div>
          <div>
            <Label>{t("crew.crewMember", "Crew Member")}</Label>
            <Select value={selectedCrewId} onValueChange={setSelectedCrewId}>
              <SelectTrigger>
                <SelectValue
                  placeholder={t("crew.selectCrew", "Select crew member...")}
                />
              </SelectTrigger>
              <SelectContent>
                {crewMembers.map(member => (
                  <SelectItem key={member.id} value={String(member.id)}>
                    {member.firstName} {member.lastName} ({member.employeeId}) -{" "}
                    {ROLE_LABELS[member.role as CrewRole] ?? member.role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t("crew.assignmentRole", "Assignment Role")}</Label>
            <Select
              value={selectedRole}
              onValueChange={val => setSelectedRole(val as CrewRole)}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={t("crew.selectRole", "Select role...")}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="captain">Captain</SelectItem>
                <SelectItem value="first_officer">First Officer</SelectItem>
                <SelectItem value="purser">Purser</SelectItem>
                <SelectItem value="cabin_crew">Cabin Crew</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t("crew.notes", "Notes")}</Label>
            <Input
              placeholder={t("crew.notesPlaceholder", "Optional notes...")}
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button
            onClick={handleAssign}
            disabled={
              !flightId ||
              !selectedCrewId ||
              !selectedRole ||
              assignMutation.isPending
            }
          >
            <UserPlus className="h-4 w-4 mr-2" />
            {assignMutation.isPending
              ? t("crew.assigning", "Assigning...")
              : t("crew.assignBtn", "Assign to Flight")}
          </Button>
          {selectedCrewId && flightId && (
            <Button variant="outline" onClick={() => setShowFtlDialog(true)}>
              <Shield className="h-4 w-4 mr-2" />
              {t("crew.checkFtl", "Check FTL")}
            </Button>
          )}
        </div>
      </Card>

      {/* FTL Check Dialog */}
      {showFtlDialog && selectedCrewId && flightId && (
        <FtlCheckDialog
          crewMemberId={Number(selectedCrewId)}
          flightId={Number(flightId)}
          open={showFtlDialog}
          onClose={() => setShowFtlDialog(false)}
        />
      )}

      {/* Crew search / directory */}
      <Card className="p-4 shadow-sm rounded-xl">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <Search className="h-4 w-4" />
          {t("crew.crewDirectory", "Crew Directory")}
        </h3>
        <div className="flex gap-4 mb-4 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <Input
              placeholder={t(
                "crew.searchPlaceholder",
                "Search by name or employee ID..."
              )}
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {t("crew.allRoles", "All Roles")}
              </SelectItem>
              <SelectItem value="captain">Captain</SelectItem>
              <SelectItem value="first_officer">First Officer</SelectItem>
              <SelectItem value="purser">Purser</SelectItem>
              <SelectItem value="cabin_crew">Cabin Crew</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {crewMembersQuery.isLoading ? (
          <div className="animate-pulse space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 bg-muted rounded" />
            ))}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("crew.table.employee", "Employee")}</TableHead>
                <TableHead>{t("crew.table.name", "Name")}</TableHead>
                <TableHead>{t("crew.table.role", "Role")}</TableHead>
                <TableHead>{t("crew.table.status", "Status")}</TableHead>
                <TableHead>
                  {t("crew.table.qualifications", "Qualifications")}
                </TableHead>
                <TableHead>{t("crew.table.contact", "Contact")}</TableHead>
                <TableHead className="text-right">
                  {t("crew.table.actions", "Actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {crewMembers.map((member: CrewMemberBasic) => (
                <TableRow key={member.id}>
                  <TableCell className="font-mono text-sm">
                    {member.employeeId}
                  </TableCell>
                  <TableCell className="font-medium">
                    {member.firstName} {member.lastName}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                        ROLE_COLORS[member.role as CrewRole] ?? ""
                      }`}
                    >
                      {ROLE_LABELS[member.role as CrewRole] ?? member.role}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        member.status === "active" ? "default" : "secondary"
                      }
                    >
                      {member.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {member.qualifiedAircraft.map(ac => (
                        <Badge key={ac} variant="outline" className="text-xs">
                          {ac}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {member.email ?? member.phone ?? "--"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedCrewId(String(member.id));
                        setSelectedRole(member.role as CrewRole);
                      }}
                      disabled={!flightId}
                    >
                      <UserPlus className="h-3 w-3 mr-1" />
                      {t("crew.select", "Select")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {crewMembers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    <p className="text-muted-foreground">
                      {t("crew.noMembers", "No crew members found")}
                    </p>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

// ============================================================================
// FTL Check Dialog
// ============================================================================

function FtlCheckDialog({
  crewMemberId,
  flightId,
  open,
  onClose,
}: {
  crewMemberId: number;
  flightId: number;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  // We need flight details for the FTL check. Use getFlightCrew to get departure/arrival.
  const flightQuery = trpc.crew.getFlightCrew.useQuery(
    { flightId },
    { enabled: open }
  );

  const flight = flightQuery.data?.flight;

  const ftlQuery = trpc.crew.checkFTL.useQuery(
    {
      crewMemberId,
      departureTime: flight?.departureTime
        ? new Date(flight.departureTime)
        : new Date(),
      arrivalTime: flight?.arrivalTime
        ? new Date(flight.arrivalTime)
        : new Date(),
    },
    { enabled: open && !!flight }
  );

  const ftl = ftlQuery.data;

  return (
    <Dialog open={open} onOpenChange={val => !val && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            {t("crew.ftlCheck", "FTL Compliance Check")}
          </DialogTitle>
        </DialogHeader>

        {ftlQuery.isLoading || flightQuery.isLoading ? (
          <div className="animate-pulse space-y-3 py-4">
            <div className="h-4 bg-muted rounded w-2/3" />
            <div className="h-4 bg-muted rounded w-1/2" />
            <div className="h-4 bg-muted rounded w-3/4" />
          </div>
        ) : ftl ? (
          <div className="space-y-4 py-2">
            {/* Overall status */}
            <div
              className={`flex items-center gap-3 p-3 rounded-lg ${
                ftl.compliant
                  ? "bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800"
                  : "bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800"
              }`}
            >
              {ftl.compliant ? (
                <CheckCircle className="h-6 w-6 text-green-600" />
              ) : (
                <XCircle className="h-6 w-6 text-red-600" />
              )}
              <div>
                <div className="font-semibold">
                  {ftl.compliant
                    ? t("crew.ftlCompliant", "FTL Compliant")
                    : t("crew.ftlViolation", "FTL Violation")}
                </div>
                <div className="text-sm text-muted-foreground">
                  {t("crew.dutyHours", "Duty: {{hours}}h / {{max}}h", {
                    hours: ftl.totalDutyHours,
                    max: ftl.maxDutyHours,
                  })}
                </div>
              </div>
            </div>

            {/* Duty hours gauge */}
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>{t("crew.totalDutyTime", "Total Duty Time")}</span>
                <span>
                  {ftl.totalDutyHours}h / {ftl.maxDutyHours}h
                </span>
              </div>
              <FtlGauge current={ftl.totalDutyHours} max={ftl.maxDutyHours} />
            </div>

            {/* Proposed flight */}
            <div className="text-sm">
              <span className="text-muted-foreground">
                {t("crew.proposedDuration", "Proposed flight duration")}:{" "}
              </span>
              <span className="font-medium">{ftl.proposedFlightDuration}h</span>
            </div>

            {/* Violations */}
            {ftl.violations.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-medium text-red-600 dark:text-red-400">
                  {t("crew.violations", "Violations")}
                </h4>
                {ftl.violations.map((v: string, i: number) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400"
                  >
                    <XCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    {v}
                  </div>
                ))}
              </div>
            )}

            {/* Warnings */}
            {ftl.warnings.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-medium text-yellow-600 dark:text-yellow-400">
                  {t("crew.warnings", "Warnings")}
                </h4>
                {ftl.warnings.map((w: string, i: number) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 text-sm text-yellow-600 dark:text-yellow-400"
                  >
                    <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    {w}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="text-muted-foreground py-4">
            {t("crew.ftlNoData", "Unable to load FTL data")}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.close", "Close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// FTL Gauge Component
// ============================================================================

function FtlGauge({ current, max }: { current: number; max: number }) {
  const percent = Math.min((current / max) * 100, 100);
  const status: "green" | "yellow" | "red" =
    percent >= 100 ? "red" : percent >= 80 ? "yellow" : "green";

  const colorClass =
    status === "red"
      ? "bg-red-500"
      : status === "yellow"
        ? "bg-yellow-500"
        : "bg-green-500";

  return (
    <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${colorClass}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

// ============================================================================
// Availability Tab
// ============================================================================

function AvailabilityTab() {
  const { t } = useTranslation();
  const [crewMemberId, setCrewMemberId] = useState("");
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0]
  );

  const crewMembersQuery = trpc.crew.getMembers.useQuery({
    status: "active",
  });

  const availabilityQuery = trpc.crew.checkAvailability.useQuery(
    {
      crewMemberId: Number(crewMemberId),
      date: new Date(selectedDate),
    },
    {
      enabled: !!crewMemberId && !!selectedDate,
    }
  );

  // Build a 7-day window for the calendar view
  const weekDates = useMemo(() => {
    const base = new Date(selectedDate);
    const dates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      dates.push(d.toISOString().split("T")[0]);
    }
    return dates;
  }, [selectedDate]);

  const scheduleQuery = trpc.crew.getSchedule.useQuery(
    {
      crewMemberId: Number(crewMemberId),
      startDate: new Date(weekDates[0]),
      endDate: new Date(weekDates[6]),
    },
    {
      enabled: !!crewMemberId,
    }
  );

  const availability = availabilityQuery.data;
  const schedule = scheduleQuery.data;
  const crewMembers: CrewMemberBasic[] = crewMembersQuery.data ?? [];

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card className="p-4 shadow-sm rounded-xl">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label>{t("crew.crewMember", "Crew Member")}</Label>
            <Select value={crewMemberId} onValueChange={setCrewMemberId}>
              <SelectTrigger>
                <SelectValue
                  placeholder={t("crew.selectCrew", "Select crew member...")}
                />
              </SelectTrigger>
              <SelectContent>
                {crewMembers.map(member => (
                  <SelectItem key={member.id} value={String(member.id)}>
                    {member.firstName} {member.lastName} ({member.employeeId})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t("crew.date", "Date")}</Label>
            <Input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button
              onClick={() => {
                availabilityQuery.refetch();
                scheduleQuery.refetch();
              }}
              disabled={!crewMemberId}
            >
              <Search className="h-4 w-4 mr-2" />
              {t("crew.checkBtn", "Check")}
            </Button>
          </div>
        </div>
      </Card>

      {/* Availability status */}
      {availability && (
        <Card className="p-4 shadow-sm rounded-xl">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            {t("crew.availabilityStatus", "Availability Status")} -{" "}
            {availability.crewMember.name}
          </h3>
          <div
            className={`flex items-center gap-3 p-3 rounded-lg ${
              availability.available
                ? "bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800"
                : "bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800"
            }`}
          >
            {availability.available ? (
              <CheckCircle className="h-6 w-6 text-green-600" />
            ) : (
              <XCircle className="h-6 w-6 text-red-600" />
            )}
            <div>
              <div className="font-semibold">
                {availability.available
                  ? t("crew.available", "Available")
                  : t("crew.unavailable", "Unavailable")}
              </div>
              {!availability.available && availability.reason && (
                <div className="text-sm text-muted-foreground">
                  {availability.reason}
                </div>
              )}
              {availability.available && (
                <div className="text-sm text-muted-foreground">
                  {t(
                    "crew.dutyInfo",
                    "Duty: {{duty}}h | Remaining: {{remaining}}h",
                    {
                      duty: availability.dutyHoursOnDate,
                      remaining: availability.remainingDutyHours,
                    }
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Assignments on date */}
          {availability.assignmentsOnDate.length > 0 && (
            <div className="mt-4">
              <h4 className="text-sm font-medium mb-2">
                {t("crew.assignmentsOnDate", "Assignments on this date")}
              </h4>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("crew.flight", "Flight")}</TableHead>
                    <TableHead>{t("crew.role", "Role")}</TableHead>
                    <TableHead>{t("crew.departure", "Departure")}</TableHead>
                    <TableHead>{t("crew.arrival", "Arrival")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {availability.assignmentsOnDate.map(
                    (a: {
                      assignmentId: number;
                      flightId: number;
                      flightNumber: string;
                      role: string;
                      departureTime: Date;
                      arrivalTime: Date;
                    }) => (
                      <TableRow key={a.assignmentId}>
                        <TableCell className="font-medium">
                          {a.flightNumber}
                        </TableCell>
                        <TableCell>
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                              ROLE_COLORS[a.role as CrewRole] ?? ""
                            }`}
                          >
                            {ROLE_LABELS[a.role as CrewRole] ?? a.role}
                          </span>
                        </TableCell>
                        <TableCell>
                          {new Date(a.departureTime).toLocaleTimeString()}
                        </TableCell>
                        <TableCell>
                          {new Date(a.arrivalTime).toLocaleTimeString()}
                        </TableCell>
                      </TableRow>
                    )
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      )}

      {/* 7-day calendar view */}
      {schedule && (
        <Card className="p-4 shadow-sm rounded-xl">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            {t("crew.weekCalendar", "7-Day Calendar")} -{" "}
            {schedule.crewMember.name}
          </h3>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("crew.date", "Date")}</TableHead>
                  <TableHead>{t("crew.flights", "Flights")}</TableHead>
                  <TableHead>{t("crew.dutyHrs", "Duty Hours")}</TableHead>
                  <TableHead>{t("crew.ftl", "FTL")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedule.schedule.map((day: ScheduleDay) => (
                  <TableRow key={day.date}>
                    <TableCell className="font-medium">
                      {new Date(day.date + "T00:00:00").toLocaleDateString(
                        undefined,
                        {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                        }
                      )}
                    </TableCell>
                    <TableCell>
                      {day.assignments.length > 0 ? (
                        <div className="flex gap-1 flex-wrap">
                          {day.assignments.map((a: ScheduleAssignment) => (
                            <Badge
                              key={a.assignmentId}
                              variant="outline"
                              className="text-xs"
                            >
                              {a.flightNumber}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">
                          {t("crew.noFlights", "No flights")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{day.totalDutyHours}h</TableCell>
                    <TableCell>
                      <FtlIndicator status={day.ftlStatus} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {availabilityQuery.isLoading && (
        <Card className="p-6 shadow-sm rounded-xl">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-muted rounded w-1/3" />
            <div className="h-16 bg-muted rounded" />
          </div>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// FTL Indicator (green/yellow/red)
// ============================================================================

function FtlIndicator({ status }: { status: "green" | "yellow" | "red" }) {
  const { t } = useTranslation();

  if (status === "green") {
    return (
      <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
        <CheckCircle className="h-4 w-4" />
        <span className="text-xs">{t("crew.ftlOk", "OK")}</span>
      </span>
    );
  }
  if (status === "yellow") {
    return (
      <span className="inline-flex items-center gap-1 text-yellow-600 dark:text-yellow-400">
        <AlertTriangle className="h-4 w-4" />
        <span className="text-xs">{t("crew.ftlCaution", "Caution")}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
      <XCircle className="h-4 w-4" />
      <span className="text-xs">{t("crew.ftlExceeded", "Exceeded")}</span>
    </span>
  );
}

// ============================================================================
// Schedule Tab
// ============================================================================

function ScheduleTab() {
  const { t } = useTranslation();
  const [crewMemberId, setCrewMemberId] = useState("");
  const [startDate, setStartDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().split("T")[0];
  });

  const crewMembersQuery = trpc.crew.getMembers.useQuery({
    status: "active",
  });

  const scheduleQuery = trpc.crew.getSchedule.useQuery(
    {
      crewMemberId: Number(crewMemberId),
      startDate: new Date(startDate),
      endDate: new Date(endDate),
    },
    {
      enabled: !!crewMemberId && !!startDate && !!endDate,
    }
  );

  const crewMembers: CrewMemberBasic[] = crewMembersQuery.data ?? [];
  const schedule = scheduleQuery.data;

  // Summary stats
  const totalFlights =
    schedule?.schedule.reduce((sum, d) => sum + d.assignments.length, 0) ?? 0;
  const totalDuty =
    schedule?.schedule.reduce((sum, d) => sum + d.totalDutyHours, 0) ?? 0;
  const daysWithRedFtl =
    schedule?.schedule.filter(d => d.ftlStatus === "red").length ?? 0;

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card className="p-4 shadow-sm rounded-xl">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <Label>{t("crew.crewMember", "Crew Member")}</Label>
            <Select value={crewMemberId} onValueChange={setCrewMemberId}>
              <SelectTrigger>
                <SelectValue
                  placeholder={t("crew.selectCrew", "Select crew member...")}
                />
              </SelectTrigger>
              <SelectContent>
                {crewMembers.map(member => (
                  <SelectItem key={member.id} value={String(member.id)}>
                    {member.firstName} {member.lastName} ({member.employeeId})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t("crew.startDate", "Start Date")}</Label>
            <Input
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
            />
          </div>
          <div>
            <Label>{t("crew.endDate", "End Date")}</Label>
            <Input
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button
              onClick={() => scheduleQuery.refetch()}
              disabled={!crewMemberId}
            >
              <Search className="h-4 w-4 mr-2" />
              {t("crew.loadSchedule", "Load Schedule")}
            </Button>
          </div>
        </div>
      </Card>

      {/* Summary cards */}
      {schedule && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="p-4 shadow-sm rounded-xl">
            <div className="text-sm text-muted-foreground">
              {t("crew.crewMember", "Crew Member")}
            </div>
            <div className="font-bold text-lg">{schedule.crewMember.name}</div>
            <div className="text-xs text-muted-foreground">
              {ROLE_LABELS[schedule.crewMember.role as CrewRole] ??
                schedule.crewMember.role}{" "}
              | {schedule.crewMember.employeeId}
            </div>
          </Card>
          <Card className="p-4 shadow-sm rounded-xl">
            <div className="text-sm text-muted-foreground">
              {t("crew.totalFlights", "Total Flights")}
            </div>
            <div className="font-bold text-lg">{totalFlights}</div>
          </Card>
          <Card className="p-4 shadow-sm rounded-xl">
            <div className="text-sm text-muted-foreground">
              {t("crew.totalDutyHours", "Total Duty Hours")}
            </div>
            <div className="font-bold text-lg">
              {Math.round(totalDuty * 10) / 10}h
            </div>
          </Card>
          <Card className="p-4 shadow-sm rounded-xl">
            <div className="text-sm text-muted-foreground">
              {t("crew.ftlAlerts", "FTL Alerts")}
            </div>
            <div
              className={`font-bold text-lg ${daysWithRedFtl > 0 ? "text-red-600" : "text-green-600"}`}
            >
              {daysWithRedFtl > 0
                ? `${daysWithRedFtl} ${t("crew.days", "day(s)")}`
                : t("crew.allClear", "All Clear")}
            </div>
          </Card>
        </div>
      )}

      {/* Schedule table */}
      {schedule && (
        <Card className="p-4 shadow-sm rounded-xl">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4" />
            {t("crew.detailedSchedule", "Detailed Schedule")}
          </h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("crew.date", "Date")}</TableHead>
                <TableHead>{t("crew.flights", "Flights")}</TableHead>
                <TableHead>{t("crew.dutyHrs", "Duty Hours")}</TableHead>
                <TableHead>{t("crew.ftl", "FTL")}</TableHead>
                <TableHead>{t("crew.details", "Details")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schedule.schedule.map((day: ScheduleDay) => (
                <TableRow
                  key={day.date}
                  className={
                    day.ftlStatus === "red"
                      ? "bg-red-50 dark:bg-red-950/30"
                      : day.ftlStatus === "yellow"
                        ? "bg-yellow-50 dark:bg-yellow-950/30"
                        : ""
                  }
                >
                  <TableCell className="font-medium">
                    {new Date(day.date + "T00:00:00").toLocaleDateString(
                      undefined,
                      {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      }
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {day.assignments.map((a: ScheduleAssignment) => (
                        <Badge
                          key={a.assignmentId}
                          variant="outline"
                          className="text-xs"
                        >
                          {a.flightNumber}
                        </Badge>
                      ))}
                      {day.assignments.length === 0 && (
                        <span className="text-muted-foreground text-sm">
                          {t("crew.rest", "Rest")}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span>{day.totalDutyHours}h</span>
                      <FtlGauge current={day.totalDutyHours} max={14} />
                    </div>
                  </TableCell>
                  <TableCell>
                    <FtlIndicator status={day.ftlStatus} />
                  </TableCell>
                  <TableCell>
                    {day.assignments.length > 0 && (
                      <div className="space-y-1">
                        {day.assignments.map((a: ScheduleAssignment) => (
                          <div key={a.assignmentId} className="text-xs">
                            <span className="font-medium">
                              {a.flightNumber}
                            </span>{" "}
                            <span className="text-muted-foreground">
                              {new Date(a.departureTime).toLocaleTimeString(
                                [],
                                { hour: "2-digit", minute: "2-digit" }
                              )}{" "}
                              -{" "}
                              {new Date(a.arrivalTime).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {scheduleQuery.isLoading && (
        <Card className="p-6 shadow-sm rounded-xl">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-muted rounded w-1/3" />
            <div className="h-40 bg-muted rounded" />
          </div>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Find Replacement Tab
// ============================================================================

function ReplacementTab() {
  const { t } = useTranslation();
  const [flightId, setFlightId] = useState("");
  const [role, setRole] = useState<CrewRole | "">("");

  const replacementQuery = trpc.crew.findReplacement.useQuery(
    {
      flightId: Number(flightId),
      role: role as CrewRole,
    },
    {
      enabled: !!flightId && !!role,
    }
  );

  const assignMutation = trpc.crew.assignToFlight.useMutation({
    onSuccess: (result: {
      crewName: string;
      role: string;
      flightNumber: string;
      ftlWarnings?: string[];
    }) => {
      toast.success(
        t("crew.assignSuccess", "{{name}} assigned as {{role}} to {{flight}}", {
          name: result.crewName,
          role: ROLE_LABELS[result.role as CrewRole] ?? result.role,
          flight: result.flightNumber,
        })
      );
      replacementQuery.refetch();
    },
    onError: (err: { message: string }) => {
      toast.error(err.message);
    },
  });

  const data = replacementQuery.data;

  return (
    <div className="space-y-6">
      {/* Search */}
      <Card className="p-4 shadow-sm rounded-xl">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <RefreshCw className="h-4 w-4" />
          {t("crew.findReplacement", "Find Replacement Crew")}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label>{t("crew.flightId", "Flight ID")}</Label>
            <Input
              type="number"
              placeholder="e.g. 42"
              value={flightId}
              onChange={e => setFlightId(e.target.value)}
            />
          </div>
          <div>
            <Label>{t("crew.role", "Role Needed")}</Label>
            <Select
              value={role}
              onValueChange={val => setRole(val as CrewRole)}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={t("crew.selectRole", "Select role...")}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="captain">Captain</SelectItem>
                <SelectItem value="first_officer">First Officer</SelectItem>
                <SelectItem value="purser">Purser</SelectItem>
                <SelectItem value="cabin_crew">Cabin Crew</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button
              onClick={() => replacementQuery.refetch()}
              disabled={!flightId || !role}
            >
              <Search className="h-4 w-4 mr-2" />
              {t("crew.search", "Search")}
            </Button>
          </div>
        </div>
      </Card>

      {/* Results */}
      {data && (
        <Card className="p-4 shadow-sm rounded-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold">
              {t("crew.replacementResults", "Replacement Candidates")} -{" "}
              {data.flightNumber} ({ROLE_LABELS[data.role as CrewRole]})
            </h3>
            <div className="flex gap-2 text-sm">
              <Badge variant="default">{data.availableCount} available</Badge>
              <Badge variant="outline">{data.totalCandidates} total</Badge>
            </div>
          </div>

          {data.candidates.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("crew.table.name", "Name")}</TableHead>
                  <TableHead>{t("crew.table.employee", "Employee")}</TableHead>
                  <TableHead>
                    {t("crew.availability", "Availability")}
                  </TableHead>
                  <TableHead>{t("crew.ftl", "FTL")}</TableHead>
                  <TableHead>{t("crew.dutyHrs", "Duty Hours")}</TableHead>
                  <TableHead>{t("crew.conflicts", "Conflicts")}</TableHead>
                  <TableHead>{t("crew.score", "Score")}</TableHead>
                  <TableHead className="text-right">
                    {t("crew.table.actions", "Actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.candidates.map(candidate => (
                  <TableRow
                    key={candidate.crewMember.id}
                    className={
                      candidate.available ? "" : "opacity-60 bg-muted/30"
                    }
                  >
                    <TableCell className="font-medium">
                      {candidate.crewMember.name}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {candidate.crewMember.employeeId}
                    </TableCell>
                    <TableCell>
                      {candidate.available ? (
                        <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-0">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          {t("crew.available", "Available")}
                        </Badge>
                      ) : (
                        <Badge variant="destructive">
                          <XCircle className="h-3 w-3 mr-1" />
                          {t("crew.unavailable", "Unavailable")}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        {candidate.ftlCompliant ? (
                          <FtlIndicator status="green" />
                        ) : (
                          <FtlIndicator status="red" />
                        )}
                        <VerdictBadge verdict={candidate.legality.verdict} />
                        {candidate.legality.failedRules.length > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {candidate.legality.failedRules.join(", ")}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{candidate.dutyHoursOnDate}h</TableCell>
                    <TableCell>
                      {candidate.conflicts.length > 0 ? (
                        <div className="flex gap-1 flex-wrap">
                          {candidate.conflicts.map(c => (
                            <Badge
                              key={c}
                              variant="destructive"
                              className="text-xs"
                            >
                              {c}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-muted-foreground text-sm">
                          {t("crew.noConflicts", "None")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`font-bold ${
                          candidate.score >= 80
                            ? "text-green-600"
                            : candidate.score >= 50
                              ? "text-yellow-600"
                              : "text-red-600"
                        }`}
                      >
                        {candidate.score}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        disabled={
                          !candidate.available || assignMutation.isPending
                        }
                        onClick={() =>
                          assignMutation.mutate({
                            flightId: Number(flightId),
                            crewMemberId: candidate.crewMember.id,
                            role: role as CrewRole,
                          })
                        }
                      >
                        <UserPlus className="h-3 w-3 mr-1" />
                        {t("crew.assign", "Assign")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-8">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">
                {t(
                  "crew.noCandidates",
                  "No crew members found for this role and airline"
                )}
              </p>
            </div>
          )}
        </Card>
      )}

      {replacementQuery.isLoading && (
        <Card className="p-6 shadow-sm rounded-xl">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-muted rounded w-1/3" />
            <div className="h-40 bg-muted rounded" />
          </div>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Legality (FTL) Tab: rule sets as data, verdicts with margins, overrides
// ============================================================================

type VerdictKind = "legal" | "legal_with_extension" | "illegal";

function VerdictBadge({ verdict }: { verdict: VerdictKind }) {
  const { t } = useTranslation();
  const styles: Record<VerdictKind, string> = {
    legal:
      "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-0",
    legal_with_extension:
      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 border-0",
    illegal:
      "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 border-0",
  };
  const labels: Record<VerdictKind, string> = {
    legal: t("crew.legality.verdict.legal", "Legal"),
    legal_with_extension: t(
      "crew.legality.verdict.legalWithExtension",
      "Legal with extension"
    ),
    illegal: t("crew.legality.verdict.illegal", "Illegal"),
  };
  return <Badge className={styles[verdict]}>{labels[verdict]}</Badge>;
}

function FatigueBadge({ level }: { level: "low" | "elevated" | "high" }) {
  const { t } = useTranslation();
  const styles = {
    low: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-0",
    elevated:
      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 border-0",
    high: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 border-0",
  } as const;
  return (
    <Badge className={styles[level]}>
      {t(`crew.legality.fatigue.${level}`, level)}
    </Badge>
  );
}

function formatMinutes(value: number | null | undefined, unit: string) {
  if (value === null || value === undefined) return "—";
  if (unit !== "minutes") return String(value);
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(Math.round(value));
  return `${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
}

function LegalityTab() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [airlineId, setAirlineId] = useState("");
  const [confirmNote, setConfirmNote] = useState("");
  const [previewCrewId, setPreviewCrewId] = useState("");
  const [previewFlightId, setPreviewFlightId] = useState("");
  const [override, setOverride] = useState({
    ruleCodes: "",
    reason: "",
    approvedBy: "",
    expiresHours: "24",
  });

  const ruleSetsQuery = trpc.crew.listRuleSets.useQuery(
    airlineId ? { airlineId: Number(airlineId) } : undefined
  );
  const verdictsQuery = trpc.crew.listVerdicts.useQuery({ limit: 50 });
  const previewQuery = trpc.crew.previewLegality.useQuery(
    { crewMemberId: Number(previewCrewId), flightId: Number(previewFlightId) },
    { enabled: false, retry: false }
  );

  const refresh = () => {
    utils.crew.listRuleSets.invalidate();
    utils.crew.listVerdicts.invalidate();
  };
  const onError = (err: { message: string }) => toast.error(err.message);
  const importMutation = trpc.crew.importRuleSet.useMutation({
    onSuccess: r => {
      toast.success(
        t("crew.legality.imported", "Imported {{code}} {{version}}", {
          code: r.code,
          version: r.version,
        })
      );
      refresh();
    },
    onError,
  });
  const confirmMutation = trpc.crew.confirmRuleSet.useMutation({
    onSuccess: () => {
      toast.success(
        t("crew.legality.confirmed", "Rule set confirmed by operator")
      );
      setConfirmNote("");
      refresh();
    },
    onError,
  });
  const activateMutation = trpc.crew.activateRuleSet.useMutation({
    onSuccess: () => {
      toast.success(t("crew.legality.activated", "Rule set activated"));
      refresh();
    },
    onError,
  });
  const overridePolicyMutation = trpc.crew.setRuleSetOverridePolicy.useMutation(
    {
      onSuccess: refresh,
      onError,
    }
  );
  const overrideMutation = trpc.crew.createOverride.useMutation({
    onSuccess: r => {
      toast.success(
        t(
          "crew.legality.overrideCreated",
          "Operational override #{{id}} recorded",
          {
            id: r.id,
          }
        )
      );
      utils.crew.listVerdicts.invalidate();
    },
    onError,
  });

  const preview = previewQuery.data;
  const previewAirlineId = ruleSetsQuery.data?.find(r => r.active)?.airlineId;

  return (
    <div className="space-y-6">
      <Card className="p-4 shadow-sm rounded-xl border-yellow-200 dark:border-yellow-800 bg-yellow-50/50 dark:bg-yellow-950/30">
        <div className="flex items-start gap-2 text-sm">
          <AlertTriangle className="h-4 w-4 mt-0.5 text-yellow-600" />
          <p>
            {t(
              "crew.legality.notice",
              "Rule values are data imported per operator. Only an operator-confirmed, active rule set gates assignments; GACAR Part 117 values must be loaded from the official text and are never invented. The fatigue indicator is advisory and not a certified FRMS."
            )}
          </p>
        </div>
      </Card>

      {/* Rule sets */}
      <Card className="p-4 shadow-sm rounded-xl">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Scale className="h-4 w-4" />
            {t("crew.legality.ruleSets", "FTL rule sets")}
          </h3>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label>{t("crew.legality.airlineId", "Airline ID")}</Label>
              <Input
                type="number"
                className="w-32"
                value={airlineId}
                onChange={e => setAirlineId(e.target.value)}
              />
            </div>
            <Button
              variant="outline"
              disabled={!airlineId || importMutation.isPending}
              onClick={() =>
                importMutation.mutate({
                  airlineId: Number(airlineId),
                  template: "EASA-ORO-FTL",
                })
              }
            >
              {t("crew.legality.importEasa", "Import EASA ORO.FTL seed")}
            </Button>
            <Button
              variant="outline"
              disabled={!airlineId || importMutation.isPending}
              onClick={() =>
                importMutation.mutate({
                  airlineId: Number(airlineId),
                  template: "GACAR-117",
                })
              }
            >
              {t("crew.legality.importGacar", "Import GACAR 117 structure")}
            </Button>
          </div>
        </div>
        <div className="mb-4">
          <Label>
            {t(
              "crew.legality.confirmNote",
              "Confirmation note (name the verified official text)"
            )}
          </Label>
          <Input
            value={confirmNote}
            onChange={e => setConfirmNote(e.target.value)}
            placeholder={t(
              "crew.legality.confirmNotePlaceholder",
              "e.g. Verified against ORO.FTL.205 Table 1, consolidated 2024 edition"
            )}
          />
        </div>
        {ruleSetsQuery.data && ruleSetsQuery.data.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("crew.legality.table.code", "Code")}</TableHead>
                <TableHead>
                  {t("crew.legality.table.values", "Values")}
                </TableHead>
                <TableHead>
                  {t("crew.legality.table.confirmation", "Confirmation")}
                </TableHead>
                <TableHead>
                  {t("crew.legality.table.status", "Status")}
                </TableHead>
                <TableHead className="text-right">
                  {t("crew.table.actions", "Actions")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ruleSetsQuery.data.map(rs => (
                <TableRow key={rs.id}>
                  <TableCell>
                    <div className="font-medium">
                      {rs.code}{" "}
                      <span className="text-muted-foreground">
                        {rs.version}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {rs.name} · {t("crew.legality.airlineId", "Airline ID")}{" "}
                      {rs.airlineId}
                    </div>
                    <a
                      className="text-xs underline text-muted-foreground"
                      href={rs.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("crew.legality.source", "Source")}
                    </a>
                  </TableCell>
                  <TableCell className="text-sm">
                    <div>
                      {rs.fdpRows} {t("crew.legality.fdpRows", "FDP rows")},{" "}
                      {rs.limitRows} {t("crew.legality.limitRows", "limits")}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t(
                        "crew.legality.valuesStatus." + rs.valuesStatus,
                        rs.valuesStatus
                      )}
                      {rs.pendingValues > 0 &&
                        ` · ${rs.pendingValues} ${t("crew.legality.pending", "pending")}`}
                      {rs.unverifiedValues > 0 &&
                        ` · ${rs.unverifiedValues} ${t("crew.legality.unverified", "unverified")}`}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {rs.operatorConfirmed ? (
                      <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-0">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        {t(
                          "crew.legality.operatorConfirmed",
                          "Operator confirmed"
                        )}
                      </Badge>
                    ) : (
                      <Badge variant="outline">
                        {t("crew.legality.notConfirmed", "Not confirmed")}
                      </Badge>
                    )}
                    {rs.readinessIssues.length > 0 && (
                      <ul className="text-xs text-red-600 dark:text-red-400 mt-1 list-disc ms-4">
                        {rs.readinessIssues.slice(0, 3).map(issue => (
                          <li key={issue}>{issue}</li>
                        ))}
                        {rs.readinessIssues.length > 3 && (
                          <li>+{rs.readinessIssues.length - 3}</li>
                        )}
                      </ul>
                    )}
                  </TableCell>
                  <TableCell>
                    {rs.active ? (
                      <Badge>{t("crew.legality.active", "Active")}</Badge>
                    ) : (
                      <Badge variant="outline">
                        {t("crew.legality.inactive", "Inactive")}
                      </Badge>
                    )}
                    <div className="text-xs text-muted-foreground mt-1">
                      {rs.allowsOverride
                        ? t(
                            "crew.legality.overridesAllowed",
                            "Overrides allowed"
                          )
                        : t("crew.legality.overridesBlocked", "No overrides")}
                    </div>
                  </TableCell>
                  <TableCell className="text-right space-x-1 space-y-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={
                        rs.operatorConfirmed ||
                        rs.readinessIssues.length > 0 ||
                        !confirmNote.trim() ||
                        confirmMutation.isPending
                      }
                      onClick={() =>
                        confirmMutation.mutate({
                          ruleSetId: rs.id,
                          note: confirmNote,
                        })
                      }
                    >
                      {t("crew.legality.confirm", "Confirm")}
                    </Button>
                    <Button
                      size="sm"
                      disabled={
                        !rs.operatorConfirmed ||
                        rs.active ||
                        activateMutation.isPending
                      }
                      onClick={() =>
                        activateMutation.mutate({ ruleSetId: rs.id })
                      }
                    >
                      {t("crew.legality.activate", "Activate")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={overridePolicyMutation.isPending}
                      onClick={() =>
                        overridePolicyMutation.mutate({
                          ruleSetId: rs.id,
                          allowsOverride: !rs.allowsOverride,
                        })
                      }
                    >
                      {rs.allowsOverride
                        ? t(
                            "crew.legality.disallowOverrides",
                            "Disallow overrides"
                          )
                        : t("crew.legality.allowOverrides", "Allow overrides")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t(
              "crew.legality.noRuleSets",
              "No rule sets imported. Assignments are blocked until an operator-confirmed rule set is active."
            )}
          </p>
        )}
      </Card>

      {/* Verdict preview */}
      <Card className="p-4 shadow-sm rounded-xl">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <Shield className="h-4 w-4" />
          {t("crew.legality.preview", "Verdict preview per assignment")}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <Label>{t("crew.crewMember", "Crew Member")} ID</Label>
            <Input
              type="number"
              value={previewCrewId}
              onChange={e => setPreviewCrewId(e.target.value)}
            />
          </div>
          <div>
            <Label>{t("crew.flightId", "Flight ID")}</Label>
            <Input
              type="number"
              value={previewFlightId}
              onChange={e => setPreviewFlightId(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button
              disabled={
                !previewCrewId || !previewFlightId || previewQuery.isFetching
              }
              onClick={() => previewQuery.refetch()}
            >
              <Search className="h-4 w-4 mr-2" />
              {t("crew.legality.evaluate", "Evaluate")}
            </Button>
          </div>
        </div>
        {previewQuery.error && (
          <p className="text-sm text-red-600 dark:text-red-400">
            {previewQuery.error.message}
          </p>
        )}
        {preview && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <VerdictBadge verdict={preview.verdict} />
              <span>
                {preview.crewName} · {preview.flightNumber} ·{" "}
                {preview.ruleSet.code} {preview.ruleSet.version}
              </span>
              <span className="text-muted-foreground">
                {t("crew.legality.fdp", "FDP")}{" "}
                {formatMinutes(preview.fdpMinutes, "minutes")} ·{" "}
                {t("crew.legality.acclimatisation", "Acclimatisation")}{" "}
                {preview.acclimatisation.state} (
                {preview.acclimatisation.referenceTimeZone})
              </span>
              <span className="flex items-center gap-1">
                {t("crew.legality.fatigueIndicator", "Fatigue indicator")}:
                <FatigueBadge level={preview.fatigue.level} />
                <span className="text-xs text-muted-foreground">
                  {preview.fatigue.score}/100
                </span>
              </span>
            </div>
            {!preview.operatorProfile.compliant && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {t(
                  "crew.legality.operatorProfileViolations",
                  "Operator profile"
                )}
                : {preview.operatorProfile.violations.join("; ")}
              </p>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("crew.legality.table.rule", "Rule")}</TableHead>
                  <TableHead>
                    {t("crew.legality.table.status", "Status")}
                  </TableHead>
                  <TableHead>
                    {t("crew.legality.table.actual", "Actual")}
                  </TableHead>
                  <TableHead>
                    {t("crew.legality.table.limit", "Limit")}
                  </TableHead>
                  <TableHead>
                    {t("crew.legality.table.margin", "Margin")}
                  </TableHead>
                  <TableHead>
                    {t("crew.legality.table.detail", "Detail")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.checks.map(check => (
                  <TableRow key={check.code}>
                    <TableCell>
                      <div className="font-mono text-xs">{check.code}</div>
                      <div className="text-xs text-muted-foreground">
                        {check.reference}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          check.status === "fail" ||
                          check.status === "not_evaluable"
                            ? "destructive"
                            : "outline"
                        }
                      >
                        {t(
                          `crew.legality.status.${check.status}`,
                          check.status
                        )}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {formatMinutes(check.actual, check.unit)}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {formatMinutes(check.limit, check.unit)}
                    </TableCell>
                    <TableCell
                      className={`font-mono text-sm ${
                        check.margin !== null && check.margin < 0
                          ? "text-red-600 dark:text-red-400"
                          : ""
                      }`}
                    >
                      {formatMinutes(check.margin, check.unit)}
                    </TableCell>
                    <TableCell className="text-sm">{check.detail}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {preview.fatigue.factors.length > 0 && (
              <div className="text-sm">
                <div className="font-medium">
                  {t(
                    "crew.legality.fatigueFactors",
                    "Fatigue factors (advisory)"
                  )}
                </div>
                <ul className="list-disc ms-5 text-muted-foreground">
                  {preview.fatigue.factors.map(f => (
                    <li key={f.code}>
                      {f.detail} (+{f.weight})
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground mt-1">
                  {preview.fatigue.disclaimer}
                </p>
              </div>
            )}
            {preview.verdict === "illegal" && previewAirlineId && (
              <div className="border rounded-lg p-3 space-y-2">
                <div className="font-medium text-sm">
                  {t(
                    "crew.legality.override",
                    "Documented operational override"
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t(
                    "crew.legality.overrideHint",
                    "Only honoured when the active rule set allows overrides; requires reason, approver and expiry, and is logged with the verdict."
                  )}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <Input
                    placeholder={t(
                      "crew.legality.overrideRules",
                      "Rule codes, comma-separated"
                    )}
                    value={override.ruleCodes}
                    onChange={e =>
                      setOverride({ ...override, ruleCodes: e.target.value })
                    }
                  />
                  <Input
                    type="number"
                    placeholder={t(
                      "crew.legality.approverId",
                      "Approver user ID"
                    )}
                    value={override.approvedBy}
                    onChange={e =>
                      setOverride({ ...override, approvedBy: e.target.value })
                    }
                  />
                  <Input
                    type="number"
                    placeholder={t(
                      "crew.legality.expiresHours",
                      "Expires in hours"
                    )}
                    value={override.expiresHours}
                    onChange={e =>
                      setOverride({ ...override, expiresHours: e.target.value })
                    }
                  />
                </div>
                <Textarea
                  placeholder={t(
                    "crew.legality.overrideReason",
                    "Operational reason (min. 10 characters)"
                  )}
                  value={override.reason}
                  onChange={e =>
                    setOverride({ ...override, reason: e.target.value })
                  }
                />
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={overrideMutation.isPending}
                  onClick={() =>
                    overrideMutation.mutate({
                      airlineId: previewAirlineId,
                      crewMemberId: preview.crewMemberId,
                      flightId: preview.flightId,
                      ruleCodes: override.ruleCodes
                        .split(",")
                        .map(s => s.trim())
                        .filter(Boolean),
                      reason: override.reason,
                      approvedBy: Number(override.approvedBy),
                      expiresAt: new Date(
                        Date.now() +
                          Number(override.expiresHours || 24) * 3600000
                      ),
                    })
                  }
                >
                  {t("crew.legality.recordOverride", "Record override")}
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Verdict log */}
      <Card className="p-4 shadow-sm rounded-xl">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <Clock className="h-4 w-4" />
          {t("crew.legality.verdictLog", "Verdict audit log")}
        </h3>
        {verdictsQuery.data && verdictsQuery.data.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("crew.legality.table.when", "When")}</TableHead>
                <TableHead>{t("crew.table.name", "Name")}</TableHead>
                <TableHead>{t("crew.flight", "Flight")}</TableHead>
                <TableHead>{t("crew.legality.table.path", "Path")}</TableHead>
                <TableHead>
                  {t("crew.legality.table.verdict", "Verdict")}
                </TableHead>
                <TableHead>
                  {t("crew.legality.table.failedRules", "Failed rules")}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {verdictsQuery.data.map(v => (
                <TableRow key={v.id}>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(v.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    {v.crewName}
                    <div className="text-xs text-muted-foreground">
                      {v.employeeId}
                    </div>
                  </TableCell>
                  <TableCell>{v.flightNumber ?? v.flightId ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {t(`crew.legality.path.${v.path}`, v.path)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <VerdictBadge verdict={v.verdict} />
                      {v.blocked && (
                        <span className="text-xs text-red-600 dark:text-red-400">
                          {t("crew.legality.blocked", "Blocked")}
                        </span>
                      )}
                      {v.overrideId !== null && (
                        <span className="text-xs text-yellow-700 dark:text-yellow-300">
                          {t(
                            "crew.legality.overrideApplied",
                            "Override #{{id}}",
                            {
                              id: v.overrideId,
                            }
                          )}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs font-mono">
                    {v.checks
                      .filter(
                        c => c.status === "fail" || c.status === "not_evaluable"
                      )
                      .map(c => c.code)
                      .join(", ") || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("crew.legality.noVerdicts", "No verdicts recorded yet")}
          </p>
        )}
      </Card>
    </div>
  );
}
