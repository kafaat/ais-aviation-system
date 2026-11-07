import { useMemo, useState } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  Calculator,
  FileText,
  AlertTriangle,
  CheckCircle,
  XCircle,
  PenLine,
  Repeat,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

type Outputs = inferRouterOutputs<AppRouter>["weightBalance"];
type LoadSheetRecord = NonNullable<Outputs["getLatest"]>;
type Figures = LoadSheetRecord["figures"];
type RegistrationSummary = Outputs["listRegistrations"][number];
type TypeSummary = Outputs["listTypeBalanceData"][number];

type Tab = "registry" | "compute" | "loadsheet";

const kg = (value: number) => `${Math.round(value).toLocaleString()} kg`;

export default function WeightBalance() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>("loadsheet");
  const [flightId, setFlightId] = useState("");

  return (
    <div className="container mx-auto p-6 max-w-7xl page-enter">
      <div className="flex items-center gap-4 mb-6">
        <Link href="/admin/dcs">
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full hover:bg-blue-50 dark:hover:bg-blue-950"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-700 to-blue-500 bg-clip-text text-transparent dark:from-blue-400 dark:to-blue-300">
            {t("wb.title", "Weight & Balance")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t(
              "wb.subtitle",
              "AHM 560/565 load control: registry data, index to %MAC, envelopes, underload, LMC and signed load sheet editions"
            )}
          </p>
        </div>
      </div>

      <div
        role="status"
        className="mb-6 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
      >
        <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
        <div>
          <p className="font-semibold">
            {t("wb.notDispatchApproved", "Not dispatch-approved")}
          </p>
          <p>
            {t(
              "wb.gateNotice",
              "Figures are computed by the engine from registry data. Load sheets stay marked not dispatch-approved until the operator approves the aircraft data, confirms the standard masses and records acceptance in the capability catalog."
            )}
          </p>
        </div>
      </div>

      <div className="flex gap-2 mb-6 flex-wrap">
        {(
          [
            {
              id: "registry",
              label: t("wb.tabs.registry", "Aircraft registry"),
              icon: Plane,
            },
            {
              id: "compute",
              label: t("wb.tabs.compute", "Compute load sheet"),
              icon: Calculator,
            },
            {
              id: "loadsheet",
              label: t("wb.tabs.loadsheet", "Load sheet"),
              icon: FileText,
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

      {activeTab === "registry" && <RegistryTab />}
      {activeTab === "compute" && (
        <ComputeTab
          flightId={flightId}
          setFlightId={setFlightId}
          onComputed={() => setActiveTab("loadsheet")}
        />
      )}
      {activeTab === "loadsheet" && (
        <LoadSheetTab flightId={flightId} setFlightId={setFlightId} />
      )}
    </div>
  );
}

// ============================================================================
// Registry
// ============================================================================

function RegistryTab() {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const types = trpc.weightBalance.listTypeBalanceData.useQuery({});
  const registrations = trpc.weightBalance.listRegistrations.useQuery({});
  const [datasetJson, setDatasetJson] = useState("");
  const [registrationJson, setRegistrationJson] = useState("");
  const [airlineId, setAirlineId] = useState("1");
  const refresh = () => {
    utils.weightBalance.listTypeBalanceData.invalidate();
    utils.weightBalance.listRegistrations.invalidate();
  };
  const onError = (error: { message: string }) => toast.error(error.message);
  const importType = trpc.weightBalance.importTypeBalanceData.useMutation({
    onSuccess: () => {
      toast.success(
        t("wb.registry.datasetImported", "Dataset imported as draft")
      );
      setDatasetJson("");
      refresh();
    },
    onError,
  });
  const importRegistration = trpc.weightBalance.importRegistration.useMutation({
    onSuccess: () => {
      toast.success(
        t("wb.registry.registrationImported", "Registration imported as draft")
      );
      setRegistrationJson("");
      refresh();
    },
    onError,
  });
  const approveType = trpc.weightBalance.setTypeBalanceApproval.useMutation({
    onSuccess: refresh,
    onError,
  });
  const approveRegistration =
    trpc.weightBalance.setRegistrationApproval.useMutation({
      onSuccess: refresh,
      onError,
    });
  const seed = trpc.weightBalance.seedTrainingFixture.useMutation({
    onSuccess: () => {
      toast.success(
        t("wb.registry.seeded", "Fictional AIS-T1 training fixture loaded")
      );
      refresh();
    },
    onError,
  });

  const parseJson = (text: string) => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      toast.error(t("wb.registry.invalidJson", "Invalid JSON"));
      return undefined;
    }
  };
  const approvalPrompt = (status: "operator_approved" | "withdrawn") => {
    const reference = window.prompt(
      t(
        "wb.registry.approvalReferencePrompt",
        "Approval reference (document, revision, approver)"
      )
    );
    return reference && reference.trim().length >= 3
      ? { status, reference }
      : null;
  };

  return (
    <div className="space-y-6">
      <Card className="p-6 shadow-sm rounded-xl space-y-3">
        <h3 className="font-semibold text-lg">
          {t("wb.registry.datasets", "Type balance datasets (AHM 560/565)")}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t(
            "wb.registry.noShippedData",
            "No certified figures for a real type are shipped. Import the operator's dataset as JSON; it is validated and stored as a draft version until approved with a reference."
          )}
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">{t("wb.registry.type", "Type")}</th>
                <th className="py-1 pr-3">
                  {t("wb.registry.version", "Version")}
                </th>
                <th className="py-1 pr-3">
                  {t("wb.registry.limits", "MTOW / MLW / MZFW")}
                </th>
                <th className="py-1 pr-3">
                  {t("wb.registry.lmcLimit", "LMC limit")}
                </th>
                <th className="py-1 pr-3">
                  {t("wb.registry.status", "Status")}
                </th>
                <th className="py-1 pr-3">
                  {t("wb.registry.source", "Source")}
                </th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {types.data?.map(type => (
                <TypeRow
                  key={type.id}
                  type={type}
                  onDecision={status => {
                    const decision = approvalPrompt(status);
                    if (decision)
                      approveType.mutate({
                        id: type.id,
                        approvalStatus: decision.status,
                        approvalReference: decision.reference,
                      });
                  }}
                />
              ))}
              {types.data?.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-3 text-muted-foreground">
                    {t("wb.registry.noDatasets", "No datasets imported yet")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Label>{t("wb.registry.importDataset", "Import dataset JSON")}</Label>
        <Textarea
          rows={6}
          value={datasetJson}
          onChange={e => setDatasetJson(e.target.value)}
          placeholder='{"typeCode":"...","variant":"","description":"...","dataSource":"AHM 560 rev ...","fictional":false,"limits":{...},"lmcLimitKg":...,"effectiveFrom":"2026-01-01","payload":{...}}'
          className="font-mono text-xs"
        />
        <div className="flex gap-2 flex-wrap">
          <Button
            disabled={!datasetJson.trim() || importType.isPending}
            onClick={() => {
              const dataset = parseJson(datasetJson);
              if (dataset !== undefined) importType.mutate({ dataset });
            }}
          >
            {t("wb.registry.importBtn", "Validate and import")}
          </Button>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              className="w-24"
              value={airlineId}
              onChange={e => setAirlineId(e.target.value)}
              aria-label={t("wb.registry.airlineId", "Operator ID")}
            />
            <Button
              variant="outline"
              disabled={seed.isPending || !Number(airlineId)}
              onClick={() => seed.mutate({ airlineId: Number(airlineId) })}
            >
              {t(
                "wb.registry.seedBtn",
                "Load fictional AIS-T1 training fixture (dev only)"
              )}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-6 shadow-sm rounded-xl space-y-3">
        <h3 className="font-semibold text-lg">
          {t("wb.registry.registrations", "Aircraft registrations (DOW/DOI)")}
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">
                  {t("wb.registry.registration", "Registration")}
                </th>
                <th className="py-1 pr-3">{t("wb.registry.type", "Type")}</th>
                <th className="py-1 pr-3">DOW</th>
                <th className="py-1 pr-3">DOI</th>
                <th className="py-1 pr-3">
                  {t("wb.registry.cabinConfig", "Cabin config")}
                </th>
                <th className="py-1 pr-3">
                  {t("wb.registry.envelope", "Envelope")}
                </th>
                <th className="py-1 pr-3">
                  {t("wb.registry.status", "Status")}
                </th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {registrations.data?.map(reg => (
                <RegistrationRow
                  key={reg.id}
                  registration={reg}
                  onDecision={status => {
                    const decision = approvalPrompt(status);
                    if (decision)
                      approveRegistration.mutate({
                        id: reg.id,
                        approvalStatus: decision.status,
                        approvalReference: decision.reference,
                      });
                  }}
                />
              ))}
              {registrations.data?.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-3 text-muted-foreground">
                    {t("wb.registry.noRegistrations", "No registrations yet")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Label>
          {t("wb.registry.importRegistration", "Import registration JSON")}
        </Label>
        <Textarea
          rows={4}
          value={registrationJson}
          onChange={e => setRegistrationJson(e.target.value)}
          placeholder='{"registration":"HZ-...","airlineId":1,"balanceDataId":1,"typeCode":"...","variant":"","dowKg":...,"doi":...,"fuelCapacityKg":...,"cabinConfigVersion":"...","envelopeRef":"...","effectiveFrom":"2026-01-01"}'
          className="font-mono text-xs"
        />
        <Button
          disabled={!registrationJson.trim() || importRegistration.isPending}
          onClick={() => {
            const record = parseJson(registrationJson);
            if (record !== undefined) importRegistration.mutate({ record });
          }}
        >
          {t("wb.registry.importBtn", "Validate and import")}
        </Button>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const labels: Record<string, string> = {
    draft: t("wb.status.draft", "Draft"),
    operator_approved: t("wb.status.operatorApproved", "Operator approved"),
    withdrawn: t("wb.status.withdrawn", "Withdrawn"),
    preliminary: t("wb.status.preliminary", "Preliminary"),
    final: t("wb.status.final", "Final (signed)"),
    superseded: t("wb.status.superseded", "Superseded"),
    superseded_by_aircraft_change: t(
      "wb.status.supersededByAircraftChange",
      "Superseded by aircraft change"
    ),
  };
  const color =
    status === "operator_approved" || status === "final"
      ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
      : status === "superseded_by_aircraft_change" || status === "withdrawn"
        ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
        : "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200";
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${color}`}>
      {labels[status] ?? status}
    </span>
  );
}

function TypeRow({
  type,
  onDecision,
}: {
  type: TypeSummary;
  onDecision: (status: "operator_approved" | "withdrawn") => void;
}) {
  const { t } = useTranslation();
  return (
    <tr className="border-t">
      <td className="py-2 pr-3 font-medium">
        {type.typeCode}
        {type.variant ? `-${type.variant}` : ""}
        {type.fictional && (
          <span className="ml-2 text-xs text-red-700 dark:text-red-300">
            {t("wb.registry.fictional", "FICTIONAL")}
          </span>
        )}
        <div className="text-xs text-muted-foreground">{type.description}</div>
      </td>
      <td className="py-2 pr-3">v{type.version}</td>
      <td className="py-2 pr-3">
        {type.limits.mtowKg.toLocaleString()} /{" "}
        {type.limits.mlwKg.toLocaleString()} /{" "}
        {type.limits.mzfwKg.toLocaleString()}
      </td>
      <td className="py-2 pr-3">{type.lmcLimitKg} kg</td>
      <td className="py-2 pr-3">
        <StatusBadge status={type.approvalStatus} />
        {type.approvalReference && (
          <div className="text-xs text-muted-foreground">
            {type.approvalReference}
          </div>
        )}
      </td>
      <td className="py-2 pr-3 text-xs">{type.dataSource}</td>
      <td className="py-2 flex gap-1">
        {type.approvalStatus === "draft" && !type.fictional && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onDecision("operator_approved")}
          >
            {t("wb.registry.approve", "Approve")}
          </Button>
        )}
        {type.approvalStatus !== "withdrawn" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onDecision("withdrawn")}
          >
            {t("wb.registry.withdraw", "Withdraw")}
          </Button>
        )}
      </td>
    </tr>
  );
}

function RegistrationRow({
  registration,
  onDecision,
}: {
  registration: RegistrationSummary;
  onDecision: (status: "operator_approved" | "withdrawn") => void;
}) {
  const { t } = useTranslation();
  return (
    <tr className="border-t">
      <td className="py-2 pr-3 font-medium">{registration.registration}</td>
      <td className="py-2 pr-3">
        {registration.typeCode}
        {registration.variant ? `-${registration.variant}` : ""}
      </td>
      <td className="py-2 pr-3">{registration.dowKg.toLocaleString()} kg</td>
      <td className="py-2 pr-3">{registration.doi}</td>
      <td className="py-2 pr-3">{registration.cabinConfigVersion}</td>
      <td className="py-2 pr-3">{registration.envelopeRef}</td>
      <td className="py-2 pr-3">
        <StatusBadge status={registration.approvalStatus} />
      </td>
      <td className="py-2 flex gap-1">
        {registration.approvalStatus === "draft" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onDecision("operator_approved")}
          >
            {t("wb.registry.approve", "Approve")}
          </Button>
        )}
        {registration.approvalStatus !== "withdrawn" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onDecision("withdrawn")}
          >
            {t("wb.registry.withdraw", "Withdraw")}
          </Button>
        )}
      </td>
    </tr>
  );
}

// ============================================================================
// Compute
// ============================================================================

type DeadloadRow = {
  compartment: string;
  baggagePieces: string;
  baggageKg: string;
  cargoKg: string;
  mailKg: string;
};
type ZoneRow = {
  zone: string;
  male: string;
  female: string;
  child: string;
  infant: string;
};

function ComputeTab({
  flightId,
  setFlightId,
  onComputed,
}: {
  flightId: string;
  setFlightId: (value: string) => void;
  onComputed: () => void;
}) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const registrations = trpc.weightBalance.listRegistrations.useQuery({});
  const ruleSets = trpc.weightBalance.listStandardMassRuleSets.useQuery();
  const [registrationId, setRegistrationId] = useState("");
  const [ruleSetId, setRuleSetId] = useState("easa-cat-pol-mab-100-20plus");
  const [ruleSetConfirmation, setRuleSetConfirmation] = useState("");
  const [passengerSource, setPassengerSource] = useState<"system" | "manual">(
    "system"
  );
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [systemBaggageCompartment, setSystemBaggageCompartment] = useState("");
  const [deadload, setDeadload] = useState<DeadloadRow[]>([]);
  const [fuel, setFuel] = useState({ blockKg: "", taxiKg: "", tripKg: "" });
  const [rtowKg, setRtowKg] = useState("");
  const [mlawKg, setMlawKg] = useState("");

  const selected = registrations.data?.find(
    r => r.id === Number(registrationId)
  );
  const typeDetail = trpc.weightBalance.getTypeBalanceData.useQuery(
    { id: selected?.balanceDataId ?? 0 },
    { enabled: Boolean(selected) }
  );
  const compartments = typeDetail.data?.compartments ?? [];
  const cabinZones = typeDetail.data?.cabinZones ?? [];

  const compute = trpc.weightBalance.compute.useMutation({
    onSuccess: record => {
      toast.success(
        t("wb.compute.success", "Edition {{edition}} computed", {
          edition: record.edition,
        })
      );
      utils.weightBalance.getLatest.invalidate();
      utils.weightBalance.listEditions.invalidate();
      onComputed();
    },
    onError: error => toast.error(error.message),
  });

  const num = (value: string) => (value.trim() === "" ? 0 : Number(value));
  const submit = () => {
    compute.mutate({
      flightId: Number(flightId),
      registrationId: Number(registrationId),
      ruleSetId,
      ruleSetConfirmationReference: ruleSetConfirmation.trim() || undefined,
      passengerSource,
      passengersByZone:
        passengerSource === "manual"
          ? zones
              .filter(z => z.zone)
              .map(z => ({
                zone: z.zone,
                male: num(z.male),
                female: num(z.female),
                child: num(z.child),
                infant: num(z.infant),
              }))
          : undefined,
      systemBaggageCompartment: systemBaggageCompartment || undefined,
      deadload: deadload
        .filter(d => d.compartment)
        .map(d => ({
          compartment: d.compartment,
          baggagePieces: num(d.baggagePieces),
          baggageKg: d.baggageKg.trim() === "" ? null : Number(d.baggageKg),
          cargoKg: num(d.cargoKg),
          mailKg: num(d.mailKg),
        })),
      fuel: {
        blockKg: num(fuel.blockKg),
        taxiKg: num(fuel.taxiKg),
        tripKg: num(fuel.tripKg),
      },
      performanceLimits: {
        rtowKg: rtowKg ? Number(rtowKg) : null,
        mlawKg: mlawKg ? Number(mlawKg) : null,
      },
    });
  };

  return (
    <Card className="p-6 shadow-sm rounded-xl space-y-5">
      <h3 className="font-semibold text-lg">
        {t("wb.compute.title", "Compute a new preliminary edition")}
      </h3>
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <Label>{t("wb.compute.flightId", "Flight ID")}</Label>
          <Input
            type="number"
            min={1}
            value={flightId}
            onChange={e => setFlightId(e.target.value)}
          />
        </div>
        <div>
          <Label>{t("wb.compute.registration", "Registration")}</Label>
          <Select value={registrationId} onValueChange={setRegistrationId}>
            <SelectTrigger>
              <SelectValue
                placeholder={t(
                  "wb.compute.selectRegistration",
                  "Select registration"
                )}
              />
            </SelectTrigger>
            <SelectContent>
              {registrations.data?.map(r => (
                <SelectItem key={r.id} value={String(r.id)}>
                  {r.registration} ({r.typeCode}
                  {r.variant ? `-${r.variant}` : ""}, DOW{" "}
                  {r.dowKg.toLocaleString()})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>{t("wb.compute.ruleSet", "Standard mass rule set")}</Label>
          <Select value={ruleSetId} onValueChange={setRuleSetId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ruleSets.data?.map(r => (
                <SelectItem key={r.id} value={r.id}>
                  {r.authority}: {r.masses.maleKg}/{r.masses.femaleKg}/
                  {r.masses.childKg} kg, bag {r.masses.checkedBagKg} kg
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {ruleSets.data && (
            <p className="text-xs text-muted-foreground mt-1">
              <a
                href={ruleSets.data.find(r => r.id === ruleSetId)?.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                {t("wb.compute.ruleSetSource", "Source")}
              </a>{" "}
              · {ruleSets.data.find(r => r.id === ruleSetId)?.effectiveFrom}
            </p>
          )}
        </div>
        <div className="md:col-span-3">
          <Label>
            {t(
              "wb.compute.ruleSetConfirmation",
              "Operator confirmation reference for these masses (leave empty to record them as unconfirmed)"
            )}
          </Label>
          <Input
            value={ruleSetConfirmation}
            onChange={e => setRuleSetConfirmation(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>{t("wb.compute.passengers", "Passengers")}</Label>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={passengerSource === "system" ? "default" : "outline"}
            onClick={() => setPassengerSource("system")}
          >
            {t("wb.compute.paxSystem", "From confirmed bookings and seats")}
          </Button>
          <Button
            size="sm"
            variant={passengerSource === "manual" ? "default" : "outline"}
            onClick={() => setPassengerSource("manual")}
          >
            {t("wb.compute.paxManual", "Enter counts by zone")}
          </Button>
        </div>
        {passengerSource === "manual" && (
          <div className="space-y-2">
            {zones.map((zone, i) => (
              <div key={i} className="grid grid-cols-5 gap-2">
                <Select
                  value={zone.zone}
                  onValueChange={value =>
                    setZones(
                      zones.map((z, j) => (j === i ? { ...z, zone: value } : z))
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("wb.compute.zone", "Zone")} />
                  </SelectTrigger>
                  <SelectContent>
                    {cabinZones.map(c => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.code} ({c.seats})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(["male", "female", "child", "infant"] as const).map(key => (
                  <Input
                    key={key}
                    type="number"
                    min={0}
                    placeholder={t(`wb.compute.${key}`, key)}
                    value={zone[key]}
                    onChange={e =>
                      setZones(
                        zones.map((z, j) =>
                          j === i ? { ...z, [key]: e.target.value } : z
                        )
                      )
                    }
                  />
                ))}
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setZones([
                  ...zones,
                  { zone: "", male: "", female: "", child: "", infant: "" },
                ])
              }
            >
              {t("wb.compute.addZone", "+ Zone")}
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label>
          {t("wb.compute.deadload", "Deadload by compartment (kg)")}
        </Label>
        <div className="grid gap-2 md:grid-cols-2">
          <div>
            <Label className="text-xs text-muted-foreground">
              {t(
                "wb.compute.systemBaggage",
                "Place the system's checked bags in compartment"
              )}
            </Label>
            <Select
              value={systemBaggageCompartment}
              onValueChange={setSystemBaggageCompartment}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={t("wb.compute.none", "None (manual only)")}
                />
              </SelectTrigger>
              <SelectContent>
                {compartments.map(c => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.code} {c.name ?? ""} (max {c.maxKg.toLocaleString()} kg)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {deadload.map((row, i) => (
          <div key={i} className="grid grid-cols-5 gap-2">
            <Select
              value={row.compartment}
              onValueChange={value =>
                setDeadload(
                  deadload.map((d, j) =>
                    j === i ? { ...d, compartment: value } : d
                  )
                )
              }
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={t("wb.compute.compartment", "Compartment")}
                />
              </SelectTrigger>
              <SelectContent>
                {compartments.map(c => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.code} (max {c.maxKg.toLocaleString()})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(
              [
                ["baggagePieces", t("wb.compute.bagPieces", "Bag pcs")],
                [
                  "baggageKg",
                  t("wb.compute.bagKg", "Bag kg (blank = standard)"),
                ],
                ["cargoKg", t("wb.compute.cargoKg", "Cargo kg")],
                ["mailKg", t("wb.compute.mailKg", "Mail kg")],
              ] as const
            ).map(([key, label]) => (
              <Input
                key={key}
                type="number"
                min={0}
                placeholder={label}
                value={row[key]}
                onChange={e =>
                  setDeadload(
                    deadload.map((d, j) =>
                      j === i ? { ...d, [key]: e.target.value } : d
                    )
                  )
                }
              />
            ))}
          </div>
        ))}
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            setDeadload([
              ...deadload,
              {
                compartment: "",
                baggagePieces: "",
                baggageKg: "",
                cargoKg: "",
                mailKg: "",
              },
            ])
          }
        >
          {t("wb.compute.addCompartment", "+ Compartment")}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        {(
          [
            ["blockKg", t("wb.compute.blockFuel", "Block fuel (kg)")],
            ["taxiKg", t("wb.compute.taxiFuel", "Taxi fuel (kg)")],
            ["tripKg", t("wb.compute.tripFuel", "Trip fuel (kg)")],
          ] as const
        ).map(([key, label]) => (
          <div key={key}>
            <Label>{label}</Label>
            <Input
              type="number"
              min={0}
              value={fuel[key]}
              onChange={e => setFuel({ ...fuel, [key]: e.target.value })}
            />
          </div>
        ))}
        <div>
          <Label>{t("wb.compute.rtow", "RTOW (performance, optional)")}</Label>
          <Input
            type="number"
            min={0}
            value={rtowKg}
            onChange={e => setRtowKg(e.target.value)}
          />
        </div>
        <div>
          <Label>
            {t("wb.compute.mlaw", "Perf. landing limit (optional)")}
          </Label>
          <Input
            type="number"
            min={0}
            value={mlawKg}
            onChange={e => setMlawKg(e.target.value)}
          />
        </div>
      </div>

      <Button
        onClick={submit}
        disabled={
          !Number(flightId) || !Number(registrationId) || compute.isPending
        }
        className="w-full"
      >
        {compute.isPending
          ? t("wb.compute.computing", "Computing...")
          : t("wb.compute.computeBtn", "Compute preliminary load sheet")}
      </Button>
    </Card>
  );
}

// ============================================================================
// Load sheet
// ============================================================================

function LoadSheetTab({
  flightId,
  setFlightId,
}: {
  flightId: string;
  setFlightId: (value: string) => void;
}) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const id = Number(flightId);
  const latest = trpc.weightBalance.getLatest.useQuery(
    { flightId: id },
    { enabled: id > 0 }
  );
  const editions = trpc.weightBalance.listEditions.useQuery(
    { flightId: id },
    { enabled: id > 0 }
  );
  const changes = trpc.weightBalance.listAircraftChanges.useQuery(
    { flightId: id },
    { enabled: id > 0 }
  );
  const [selectedEdition, setSelectedEdition] = useState<number | null>(null);
  const record = useMemo(() => {
    if (selectedEdition)
      return editions.data?.find(e => e.id === selectedEdition) ?? null;
    return latest.data ?? null;
  }, [selectedEdition, editions.data, latest.data]);
  const document = trpc.weightBalance.renderDocument.useQuery(
    { id: record?.id ?? 0 },
    { enabled: Boolean(record) }
  );
  const refresh = () => {
    utils.weightBalance.getLatest.invalidate();
    utils.weightBalance.listEditions.invalidate();
    utils.weightBalance.listAircraftChanges.invalidate();
    utils.weightBalance.renderDocument.invalidate();
    setSelectedEdition(null);
  };
  const sign = trpc.weightBalance.sign.useMutation({
    onSuccess: () => {
      toast.success(
        t("wb.sheet.signed", "Load sheet signed and frozen as final")
      );
      refresh();
    },
    onError: error => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <Card className="p-4 shadow-sm rounded-xl">
        <div className="flex gap-4 items-end flex-wrap">
          <div className="max-w-xs">
            <Label>{t("wb.sheet.flightId", "Flight ID")}</Label>
            <Input
              type="number"
              min={1}
              value={flightId}
              onChange={e => {
                setFlightId(e.target.value);
                setSelectedEdition(null);
              }}
            />
          </div>
          {editions.data && editions.data.length > 0 && (
            <div className="max-w-xs">
              <Label>{t("wb.sheet.edition", "Edition")}</Label>
              <Select
                value={record ? String(record.id) : ""}
                onValueChange={value => setSelectedEdition(Number(value))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {editions.data.map(e => (
                    <SelectItem key={e.id} value={String(e.id)}>
                      EDN {e.edition} {e.basis === "lmc" ? "(LMC)" : ""} ·{" "}
                      {e.status} · {e.figures.aircraft.registration}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </Card>

      {id > 0 && latest.data === null && (
        <Card className="p-6 shadow-sm rounded-xl text-muted-foreground">
          {t(
            "wb.sheet.none",
            "No load sheet for this flight yet. Compute one first."
          )}
        </Card>
      )}

      {record && (
        <>
          <LoadSheetView record={record} />
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="p-6 shadow-sm rounded-xl space-y-3">
              <h3 className="font-semibold text-lg flex items-center gap-2">
                <PenLine className="h-5 w-5" />
                {t("wb.sheet.signing", "Signature")}
              </h3>
              {record.status === "preliminary" ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    {t(
                      "wb.sheet.signNotice",
                      "Signing freezes this edition under your identity and timestamp (EASA AMC1 CAT.POL.MAB.105(c) electronic equivalent). Editions with limit breaches cannot be signed."
                    )}
                  </p>
                  <Button
                    disabled={!record.figures.ok || sign.isPending}
                    onClick={() => sign.mutate({ id: record.id })}
                  >
                    {t("wb.sheet.signBtn", "Sign as final")}
                  </Button>
                </>
              ) : (
                <p className="text-sm">
                  {record.signedByName ?? record.signedBy ?? "-"} ·{" "}
                  {record.signedAt
                    ? new Date(record.signedAt).toLocaleString()
                    : "-"}
                </p>
              )}
              <p className="text-xs text-muted-foreground break-all">
                {t("wb.sheet.digest", "Digest")}: {record.digest}
              </p>
            </Card>
            <LmcForm record={record} onApplied={refresh} />
          </div>
          <AircraftChangeForm record={record} onChanged={refresh} />
          {changes.data && changes.data.length > 0 && (
            <Card className="p-6 shadow-sm rounded-xl space-y-2">
              <h3 className="font-semibold text-lg">
                {t("wb.sheet.aircraftChanges", "Aircraft change audit")}
              </h3>
              {changes.data.map(change => (
                <div key={change.id} className="border-t pt-2 text-sm">
                  <p>
                    {change.review.from.registration} →{" "}
                    {change.review.to.registration} ·{" "}
                    {change.changedByName ?? change.changedBy} ·{" "}
                    {new Date(change.changedAt).toLocaleString()}
                  </p>
                  <p className="text-muted-foreground">{change.reason}</p>
                  <p className="text-xs">
                    {t("wb.sheet.invalidated", "Invalidated editions")}:{" "}
                    {change.invalidatedEditionIds.join(", ") || "-"} ·{" "}
                    {t("wb.sheet.requiresReview", "Requires review")}:{" "}
                    {change.review.checksRequiringReview.join("; ") ||
                      t("wb.sheet.nothing", "none")}
                  </p>
                </div>
              ))}
            </Card>
          )}
          {document.data && (
            <Card className="p-6 shadow-sm rounded-xl">
              <h3 className="font-semibold text-lg mb-2">
                {t("wb.sheet.document", "Printable load sheet")}
              </h3>
              <pre className="text-xs font-mono whitespace-pre overflow-x-auto bg-muted p-4 rounded">
                {document.data.text}
              </pre>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function LoadSheetView({ record }: { record: LoadSheetRecord }) {
  const { t } = useTranslation();
  const f = record.figures;
  const failing = f.structuralChecks.filter(c => !c.ok);
  return (
    <div className="space-y-6">
      <Card
        className={`p-6 shadow-sm rounded-xl border-2 ${
          f.ok
            ? "border-green-300 dark:border-green-800"
            : "border-red-400 dark:border-red-700"
        }`}
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="font-semibold text-lg">
              {record.flight.flightNumber} {record.flight.origin}-
              {record.flight.destination} · {record.flight.date} ·{" "}
              {f.aircraft.registration} {f.aircraft.typeCode}
              {f.aircraft.variant ? `-${f.aircraft.variant}` : ""}
            </h3>
            <div className="flex gap-2 mt-1 flex-wrap items-center text-sm">
              <StatusBadge status={record.status} />
              <span>EDN {record.edition}</span>
              {record.basis === "lmc" && <span>(LMC)</span>}
              <span
                className={`text-xs px-2 py-0.5 rounded ${
                  record.dispatchApproved
                    ? "bg-green-100 text-green-800"
                    : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                }`}
              >
                {record.dispatchApproved
                  ? t("wb.sheet.dispatchApproved", "Dispatch-approved")
                  : t("wb.notDispatchApproved", "Not dispatch-approved")}
              </span>
              {f.aircraft.fictional && (
                <span className="text-xs px-2 py-0.5 rounded bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                  {t("wb.registry.fictional", "FICTIONAL")}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 text-lg font-semibold">
            {f.ok ? (
              <>
                <CheckCircle className="h-6 w-6 text-green-600" />
                {t("wb.sheet.withinLimits", "Within all limits")}
              </>
            ) : (
              <>
                <XCircle className="h-6 w-6 text-red-600" />
                {t("wb.sheet.breaches", "{{count}} limit breach(es)", {
                  count: f.breaches.length,
                })}
              </>
            )}
          </div>
        </div>
        {f.breaches.length > 0 && (
          <ul className="mt-4 space-y-1 rounded-lg bg-red-50 dark:bg-red-950 p-3 text-sm text-red-800 dark:text-red-200">
            {f.breaches.map(b => (
              <li key={b} className="flex gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                {b}
              </li>
            ))}
          </ul>
        )}
        {record.remarks.length > 0 && (
          <ul className="mt-3 text-xs text-muted-foreground list-disc pl-5">
            {record.remarks.map(r => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6 shadow-sm rounded-xl">
          <h3 className="font-semibold text-lg mb-3">
            {t("wb.sheet.weightChain", "Weight chain")}
          </h3>
          <table className="w-full text-sm">
            <tbody>
              <Row
                label={t("wb.sheet.dow", "Dry operating weight / DOI")}
                value={`${kg(f.dow.weightKg)} / ${f.dow.index}`}
              />
              <Row
                label={`${t("wb.sheet.passengers", "Passengers")} ${f.passengers.byCategory.male}/${f.passengers.byCategory.female}/${f.passengers.byCategory.child}/${f.passengers.byCategory.infant}`}
                value={kg(f.passengers.weightKg)}
              />
              <Row
                label={t("wb.sheet.baggage", "Baggage")}
                value={kg(f.deadload.baggageKg)}
              />
              <Row
                label={t("wb.sheet.cargo", "Cargo")}
                value={kg(f.deadload.cargoKg)}
              />
              <Row
                label={t("wb.sheet.mail", "Mail")}
                value={kg(f.deadload.mailKg)}
              />
              <Row
                label={t("wb.sheet.trafficLoad", "Total traffic load")}
                value={kg(f.trafficLoadKg)}
                bold
              />
              <Row
                label={`${t("wb.sheet.zfw", "Zero fuel weight")} (max ${f.effectiveLimits.mzfwKg.toLocaleString()})`}
                value={`${kg(f.zfw.weightKg)} · ZFI ${f.zfw.index} · ${f.zfw.macPct.toFixed(2)} %MAC`}
                bold
                bad={
                  !f.zfw.withinEnvelope ||
                  f.zfw.weightKg > f.effectiveLimits.mzfwKg
                }
              />
              <Row
                label={t("wb.sheet.takeoffFuel", "Take-off fuel")}
                value={kg(f.fuel.takeoffKg)}
              />
              <Row
                label={`${t("wb.sheet.tow", "Take-off weight")} (max ${Math.min(f.effectiveLimits.mtowKg, f.effectiveLimits.rtowKg ?? Infinity).toLocaleString()})`}
                value={`${kg(f.tow.weightKg)} · TOI ${f.tow.index} · ${f.tow.macPct.toFixed(2)} %MAC`}
                bold
                bad={
                  !f.tow.withinEnvelope ||
                  f.tow.weightKg > f.effectiveLimits.mtowKg
                }
              />
              <Row
                label={t("wb.sheet.tripFuel", "Trip fuel")}
                value={kg(f.fuel.tripKg)}
              />
              <Row
                label={`${t("wb.sheet.law", "Landing weight")} (max ${Math.min(f.effectiveLimits.mlwKg, f.effectiveLimits.performanceMlawKg ?? Infinity).toLocaleString()})`}
                value={`${kg(f.law.weightKg)} · LI ${f.law.index} · ${f.law.macPct.toFixed(2)} %MAC`}
                bold
                bad={
                  !f.law.withinEnvelope ||
                  f.law.weightKg > f.effectiveLimits.mlwKg
                }
              />
              <Row
                label={`${t("wb.sheet.underload", "Underload before LMC")} (${f.underload.limitingFactor})`}
                value={kg(f.underload.underloadKg)}
                bad={f.underload.underloadKg < 0}
              />
              <Row
                label={t("wb.sheet.trim", "Stabiliser trim")}
                value={
                  f.trim.stabTrimUnits === null
                    ? `- (${f.trim.source})`
                    : `${f.trim.stabTrimUnits}`
                }
              />
              <Row
                label={t("wb.sheet.lmc", "LMC used / limit")}
                value={`${f.lmc.appliedKg} / ${f.lmc.limitKg} kg`}
                bad={f.lmc.requiresNewLoadSheet}
              />
            </tbody>
          </table>
        </Card>

        <Card className="p-6 shadow-sm rounded-xl">
          <h3 className="font-semibold text-lg mb-3">
            {t("wb.sheet.envelope", "CG envelope")}
          </h3>
          <EnvelopeGraph figures={f} />
        </Card>
      </div>

      <Card className="p-6 shadow-sm rounded-xl">
        <h3 className="font-semibold text-lg mb-3">
          {t("wb.sheet.limitChecks", "Structural and configuration limits")}
          {failing.length > 0 && (
            <span className="ml-2 text-sm text-red-700 dark:text-red-300">
              {t("wb.sheet.failingCount", "{{count}} failing", {
                count: failing.length,
              })}
            </span>
          )}
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">{t("wb.sheet.check", "Check")}</th>
                <th className="py-1 pr-3">{t("wb.sheet.actual", "Actual")}</th>
                <th className="py-1 pr-3">{t("wb.sheet.limit", "Limit")}</th>
                <th className="py-1 pr-3">{t("wb.sheet.margin", "Margin")}</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {f.structuralChecks.map(c => (
                <tr
                  key={c.code}
                  className={`border-t ${c.ok ? "" : "bg-red-50 dark:bg-red-950 font-semibold"}`}
                >
                  <td className="py-1 pr-3">
                    {c.code}
                    <div className="text-xs text-muted-foreground font-normal">
                      {c.description}
                    </div>
                  </td>
                  <td className="py-1 pr-3">{c.actualKg.toLocaleString()}</td>
                  <td className="py-1 pr-3">{c.limitKg.toLocaleString()}</td>
                  <td className="py-1 pr-3">{c.marginKg.toLocaleString()}</td>
                  <td className="py-1">
                    {c.ok ? (
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-600" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-4 md:grid-cols-2 mt-4 text-sm">
          <div>
            <h4 className="font-medium mb-1">
              {t("wb.sheet.paxByZone", "Passengers by zone")}
            </h4>
            {f.passengers.byZone.map(z => (
              <p key={z.zone}>
                {z.zone}: {z.count}/{z.seats} · {kg(z.weightKg)} · idx {z.index}
              </p>
            ))}
          </div>
          <div>
            <h4 className="font-medium mb-1">
              {t("wb.sheet.deadloadByCompartment", "Deadload by compartment")}
            </h4>
            {f.deadload.byCompartment.map(c => (
              <p
                key={c.compartment}
                className={
                  c.totalKg > c.maxKg ? "text-red-700 font-semibold" : ""
                }
              >
                {c.compartment}: {kg(c.totalKg)} / {c.maxKg.toLocaleString()} ·
                B {c.baggageKg}
                {c.baggageWeighed ? "" : "*"} C {c.cargoKg} M {c.mailKg} · idx{" "}
                {c.index}
              </p>
            ))}
            <p className="text-xs text-muted-foreground mt-1">
              {t(
                "wb.sheet.standardBagNote",
                "* baggage from pieces × standard mass"
              )}
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Row({
  label,
  value,
  bold,
  bad,
}: {
  label: string;
  value: string;
  bold?: boolean;
  bad?: boolean;
}) {
  return (
    <tr
      className={`border-t ${bad ? "bg-red-50 dark:bg-red-950 text-red-800 dark:text-red-200" : ""}`}
    >
      <td className={`py-1 pr-3 ${bold ? "font-semibold" : ""}`}>{label}</td>
      <td className={`py-1 text-right ${bold ? "font-semibold" : ""}`}>
        {value}
      </td>
    </tr>
  );
}

/** Weight vs %MAC chart: envelope limits at each phase weight and the CG. */
function EnvelopeGraph({ figures }: { figures: Figures }) {
  const { t } = useTranslation();
  const phases = [
    { name: "ZFW", p: figures.zfw },
    { name: "TOW", p: figures.tow },
    { name: "LAW", p: figures.law },
  ];
  const macs = phases.flatMap(({ p }) => [
    p.macPct,
    p.fwdLimitMacPct ?? p.macPct,
    p.aftLimitMacPct ?? p.macPct,
  ]);
  const minMac = Math.floor(Math.min(...macs) - 3);
  const maxMac = Math.ceil(Math.max(...macs) + 3);
  const weights = phases.map(({ p }) => p.weightKg);
  const minW = Math.min(...weights) * 0.95;
  const maxW = Math.max(...weights) * 1.05;
  const width = 420;
  const height = 240;
  const pad = 36;
  const x = (mac: number) =>
    pad + ((mac - minMac) / (maxMac - minMac)) * (width - 2 * pad);
  const y = (w: number) =>
    height - pad - ((w - minW) / (maxW - minW)) * (height - 2 * pad);
  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto"
        role="img"
      >
        <title>
          {t("wb.sheet.envelopeGraph", "CG position against envelope limits")}
        </title>
        <line
          x1={pad}
          y1={height - pad}
          x2={width - pad}
          y2={height - pad}
          className="stroke-current opacity-40"
        />
        <line
          x1={pad}
          y1={pad}
          x2={pad}
          y2={height - pad}
          className="stroke-current opacity-40"
        />
        {[minMac, (minMac + maxMac) / 2, maxMac].map(mac => (
          <text
            key={mac}
            x={x(mac)}
            y={height - pad + 14}
            fontSize={9}
            textAnchor="middle"
            className="fill-current"
          >
            {mac.toFixed(0)}%
          </text>
        ))}
        {phases.map(({ name, p }) => (
          <g key={name}>
            {p.fwdLimitMacPct !== null && p.aftLimitMacPct !== null && (
              <line
                x1={x(p.fwdLimitMacPct)}
                x2={x(p.aftLimitMacPct)}
                y1={y(p.weightKg)}
                y2={y(p.weightKg)}
                strokeWidth={6}
                className="stroke-green-300 dark:stroke-green-800"
              />
            )}
            <circle
              cx={x(p.macPct)}
              cy={y(p.weightKg)}
              r={5}
              className={p.withinEnvelope ? "fill-blue-600" : "fill-red-600"}
            />
            <text
              x={pad - 4}
              y={y(p.weightKg) + 3}
              fontSize={9}
              textAnchor="end"
              className="fill-current"
            >
              {name}
            </text>
            <text
              x={x(p.macPct) + 8}
              y={y(p.weightKg) - 6}
              fontSize={9}
              className="fill-current"
            >
              {p.macPct.toFixed(2)}%
            </text>
          </g>
        ))}
      </svg>
      <div className="grid grid-cols-3 gap-2 text-xs mt-2">
        {phases.map(({ name, p }) => (
          <div
            key={name}
            className={
              p.withinEnvelope
                ? ""
                : "text-red-700 dark:text-red-300 font-semibold"
            }
          >
            {name}: {p.macPct.toFixed(2)}% (
            {p.fwdLimitMacPct?.toFixed(2) ?? "-"} –{" "}
            {p.aftLimitMacPct?.toFixed(2) ?? "-"})
          </div>
        ))}
      </div>
    </div>
  );
}

function LmcForm({
  record,
  onApplied,
}: {
  record: LoadSheetRecord;
  onApplied: () => void;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<"passenger" | "baggage" | "cargo" | "mail">(
    "cargo"
  );
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState<
    "male" | "female" | "child" | "infant"
  >("male");
  const [delta, setDelta] = useState("");
  const [description, setDescription] = useState("");
  const apply = trpc.weightBalance.applyLmc.useMutation({
    onSuccess: () => {
      toast.success(t("wb.lmc.applied", "LMC applied as a new signed edition"));
      setDelta("");
      setDescription("");
      onApplied();
    },
    onError: error => toast.error(error.message),
  });
  const locations =
    kind === "passenger"
      ? record.figures.passengers.byZone.map(z => z.zone)
      : record.figures.deadload.byCompartment.map(c => c.compartment);
  return (
    <Card className="p-6 shadow-sm rounded-xl space-y-3">
      <h3 className="font-semibold text-lg">
        {t("wb.lmc.title", "Last-minute change")}
      </h3>
      <p className="text-sm text-muted-foreground">
        {t(
          "wb.lmc.notice",
          "Allowed on a signed final edition only, within {{limit}} kg cumulative; beyond that a new load sheet is required.",
          {
            limit: record.figures.lmc.limitKg,
          }
        )}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Select
          value={kind}
          onValueChange={value => setKind(value as typeof kind)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["passenger", "baggage", "cargo", "mail"] as const).map(k => (
              <SelectItem key={k} value={k}>
                {t(`wb.lmc.kind.${k}`, k)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          list="wb-lmc-locations"
          placeholder={
            kind === "passenger"
              ? t("wb.compute.zone", "Zone")
              : t("wb.compute.compartment", "Compartment")
          }
          value={location}
          onChange={e => setLocation(e.target.value)}
        />
        <datalist id="wb-lmc-locations">
          {locations.map(l => (
            <option key={l} value={l} />
          ))}
        </datalist>
        {kind === "passenger" && (
          <Select
            value={category}
            onValueChange={value => setCategory(value as typeof category)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["male", "female", "child", "infant"] as const).map(c => (
                <SelectItem key={c} value={c}>
                  {t(`wb.compute.${c}`, c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Input
          type="number"
          placeholder={
            kind === "passenger"
              ? t("wb.lmc.deltaCount", "± passengers")
              : t("wb.lmc.deltaKg", "± kg")
          }
          value={delta}
          onChange={e => setDelta(e.target.value)}
        />
        <Input
          className="col-span-2"
          placeholder={t(
            "wb.lmc.description",
            "Reason (e.g. 2 pax offloaded, late cargo)"
          )}
          value={description}
          onChange={e => setDescription(e.target.value)}
        />
      </div>
      <Button
        disabled={
          record.status !== "final" ||
          !location ||
          !delta ||
          !description ||
          apply.isPending
        }
        onClick={() =>
          apply.mutate({
            flightId: record.flightId,
            changes: [
              kind === "passenger"
                ? {
                    kind,
                    location,
                    category,
                    deltaCount: Number(delta),
                    description,
                  }
                : { kind, location, deltaKg: Number(delta), description },
            ],
          })
        }
      >
        {t("wb.lmc.applyBtn", "Apply LMC")}
      </Button>
      {record.lmcList.length > 0 && (
        <ul className="text-xs space-y-1">
          {record.lmcList.map(l => (
            <li key={l.sequence}>
              {l.sequence}. {l.kind} {l.location} {l.appliedKg >= 0 ? "+" : ""}
              {l.appliedKg} kg · {l.description} · {l.actorName ?? l.actorId}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AircraftChangeForm({
  record,
  onChanged,
}: {
  record: LoadSheetRecord;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const registrations = trpc.weightBalance.listRegistrations.useQuery({});
  const [newRegistrationId, setNewRegistrationId] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<Outputs["changeAircraft"] | null>(null);
  const change = trpc.weightBalance.changeAircraft.useMutation({
    onSuccess: data => {
      setResult(data);
      toast.warning(
        t(
          "wb.swap.done",
          "Aircraft changed; {{count}} edition(s) invalidated. A new preliminary load sheet is required.",
          {
            count: data.invalidatedEditionIds.length,
          }
        )
      );
      onChanged();
    },
    onError: error => toast.error(error.message),
  });
  return (
    <Card className="p-6 shadow-sm rounded-xl space-y-3">
      <h3 className="font-semibold text-lg flex items-center gap-2">
        <Repeat className="h-5 w-5" />
        {t("wb.swap.title", "Aircraft registration change")}
      </h3>
      <p className="text-sm text-muted-foreground">
        {t(
          "wb.swap.notice",
          "Swapping the registration invalidates every preliminary or final edition of this flight, re-evaluates the load under the new registration's data and records who changed it, when and why."
        )}
      </p>
      <div className="grid gap-2 md:grid-cols-3">
        <Select value={newRegistrationId} onValueChange={setNewRegistrationId}>
          <SelectTrigger>
            <SelectValue
              placeholder={t("wb.swap.newRegistration", "New registration")}
            />
          </SelectTrigger>
          <SelectContent>
            {registrations.data
              ?.filter(r => r.id !== record.registrationId)
              .map(r => (
                <SelectItem key={r.id} value={String(r.id)}>
                  {r.registration} ({r.typeCode}
                  {r.variant ? `-${r.variant}` : ""})
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Input
          className="md:col-span-2"
          placeholder={t("wb.swap.reason", "Reason (minimum 3 characters)")}
          value={reason}
          onChange={e => setReason(e.target.value)}
        />
      </div>
      <Button
        variant="destructive"
        disabled={
          !Number(newRegistrationId) ||
          reason.trim().length < 3 ||
          change.isPending
        }
        onClick={() =>
          change.mutate({
            flightId: record.flightId,
            newRegistrationId: Number(newRegistrationId),
            reason: reason.trim(),
          })
        }
      >
        {t("wb.swap.applyBtn", "Change aircraft and invalidate editions")}
      </Button>
      {result && (
        <div className="text-sm space-y-2 rounded-lg bg-muted p-3">
          <p className="font-medium">
            {result.review.from.registration} → {result.review.to.registration}{" "}
            {result.review.sameTypeAndVariant
              ? t("wb.swap.sameType", "(same type and variant)")
              : t("wb.swap.differentType", "(different type or variant)")}
          </p>
          <div>
            <p className="font-medium">
              {t("wb.swap.differences", "Data differences")}
            </p>
            <ul className="list-disc pl-5">
              {result.review.dataDifferences.map(d => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-medium text-red-700 dark:text-red-300">
              {t("wb.sheet.requiresReview", "Requires review")}
            </p>
            <ul className="list-disc pl-5">
              {result.review.checksRequiringReview.length === 0 && (
                <li>{t("wb.sheet.nothing", "none")}</li>
              )}
              {result.review.checksRequiringReview.map(d => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("wb.swap.stillValid", "Still valid")}:{" "}
            {result.review.checksStillValid.join("; ")}
          </p>
        </div>
      )}
    </Card>
  );
}
