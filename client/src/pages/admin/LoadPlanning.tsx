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
  Package,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Lock,
  FileEdit,
  Plane,
  ArrowRight,
  XCircle,
  Plus,
  Weight,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

type Tab = "plan" | "compartments" | "uld" | "amend";

export default function LoadPlanning() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>("plan");
  const [flightId, setFlightId] = useState("");

  const parsedFlightId = flightId ? parseInt(flightId) : 0;

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
            {t("loadPlanning.title", "Load Planning")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t(
              "loadPlanning.subtitle",
              "Cargo compartment assignment, optimization, and finalization"
            )}
          </p>
        </div>
      </div>

      {/* Flight ID input */}
      <Card className="p-4 mb-6 shadow-sm rounded-xl">
        <div className="flex gap-4 items-end">
          <div className="flex-1 max-w-xs">
            <Label>{t("loadPlanning.flightId", "Flight ID")}</Label>
            <Input
              type="number"
              value={flightId}
              onChange={e => setFlightId(e.target.value)}
              placeholder={t(
                "loadPlanning.enterFlightId",
                "Enter flight ID..."
              )}
            />
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {(
          [
            {
              id: "plan",
              label: t("loadPlanning.tabs.plan", "Load Plan"),
              icon: Package,
            },
            {
              id: "compartments",
              label: t("loadPlanning.tabs.compartments", "Compartments"),
              icon: Plane,
            },
            {
              id: "uld",
              label: t("loadPlanning.tabs.uld", "ULD"),
              icon: Weight,
            },
            {
              id: "amend",
              label: t("loadPlanning.tabs.amend", "Amend (LIR)"),
              icon: FileEdit,
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
      {activeTab === "plan" && <LoadPlanTab flightId={parsedFlightId} />}
      {activeTab === "compartments" && (
        <CompartmentsTab flightId={parsedFlightId} />
      )}
      {activeTab === "uld" && <ULDTab flightId={parsedFlightId} />}
      {activeTab === "amend" && <AmendTab flightId={parsedFlightId} />}
    </div>
  );
}

// ============================================================================
// Load Plan Tab
// ============================================================================

function LoadPlanTab({ flightId }: { flightId: number }) {
  const { t } = useTranslation();
  const _utils = trpc.useUtils();

  const {
    data: plan,
    isLoading: planLoading,
    refetch: refetchPlan,
  } = trpc.loadPlanning.get.useQuery({ flightId }, { enabled: flightId > 0 });

  const {
    data: validation,
    isLoading: validationLoading,
    refetch: refetchValidation,
  } = trpc.loadPlanning.validate.useQuery(
    { flightId },
    { enabled: flightId > 0 && !!plan }
  );

  const createMutation = trpc.loadPlanning.create.useMutation({
    onSuccess: () => {
      toast.success(t("loadPlanning.planCreated", "Load plan created"));
      refetchPlan();
    },
    onError: err => toast.error(err.message),
  });

  const optimizeMutation = trpc.loadPlanning.optimize.useMutation({
    onSuccess: () => {
      toast.success(t("loadPlanning.optimized", "Load distribution optimized"));
      refetchPlan();
      refetchValidation();
    },
    onError: err => toast.error(err.message),
  });

  const finalizeMutation = trpc.loadPlanning.finalize.useMutation({
    onSuccess: () => {
      toast.success(t("loadPlanning.finalized", "Load plan finalized"));
      refetchPlan();
    },
    onError: err => toast.error(err.message),
  });

  if (!flightId) {
    return (
      <Card className="p-8 text-center text-muted-foreground shadow-sm rounded-xl">
        {t(
          "loadPlanning.enterFlightFirst",
          "Enter a flight ID above to begin."
        )}
      </Card>
    );
  }

  if (planLoading) {
    return (
      <Card className="p-6 animate-pulse shadow-sm rounded-xl">
        <div className="h-40 bg-muted rounded" />
      </Card>
    );
  }

  if (!plan) {
    return (
      <Card className="p-8 text-center shadow-sm rounded-xl">
        <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <p className="text-lg font-medium mb-2">
          {t("loadPlanning.noPlan", "No load plan exists for this flight")}
        </p>
        <p className="text-sm text-muted-foreground mb-4">
          {t(
            "loadPlanning.createPrompt",
            "Create one to begin assigning cargo to compartments."
          )}
        </p>
        <Button
          onClick={() => createMutation.mutate({ flightId })}
          disabled={createMutation.isPending}
          className="gap-2"
        >
          <Plus className="h-4 w-4" />
          {t("loadPlanning.createPlan", "Create Load Plan")}
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status Bar */}
      <Card className="p-4 shadow-sm rounded-xl">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <StatusBadge status={plan.status} />
            <div>
              <p className="text-sm text-muted-foreground">
                {t("loadPlanning.planId", "Plan")} #{plan.id}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("loadPlanning.lastUpdated", "Updated")}:{" "}
                {new Date(plan.updatedAt).toLocaleString()}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => optimizeMutation.mutate({ flightId })}
              disabled={
                optimizeMutation.isPending || plan.status === "finalized"
              }
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              {t("loadPlanning.optimize", "Optimize")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchValidation()}
              disabled={validationLoading}
              className="gap-2"
            >
              <CheckCircle className="h-4 w-4" />
              {t("loadPlanning.validate", "Validate")}
            </Button>
            <Button
              size="sm"
              onClick={() => finalizeMutation.mutate({ flightId })}
              disabled={
                finalizeMutation.isPending || plan.status === "finalized"
              }
              className="gap-2"
            >
              <Lock className="h-4 w-4" />
              {t("loadPlanning.finalize", "Finalize")}
            </Button>
          </div>
        </div>
      </Card>

      {/* Validation Status */}
      {validation && (
        <Card
          className={`p-4 border-2 shadow-sm rounded-xl ${validation.valid ? "border-green-500" : "border-red-500"}`}
        >
          <div className="flex items-start gap-3">
            {validation.valid ? (
              <CheckCircle className="h-5 w-5 text-green-500 mt-0.5" />
            ) : (
              <XCircle className="h-5 w-5 text-red-500 mt-0.5" />
            )}
            <div className="flex-1">
              <p className="font-semibold">
                {validation.valid
                  ? t("loadPlanning.validationPass", "Validation Passed")
                  : t("loadPlanning.validationFail", "Validation Failed")}
              </p>
              {validation.errors.map((err: string, i: number) => (
                <p key={`err-${i}`} className="text-sm text-red-600">
                  {err}
                </p>
              ))}
              {validation.warnings.map((warn: string, i: number) => (
                <p key={`warn-${i}`} className="text-sm text-amber-600">
                  {warn}
                </p>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Weight Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <WeightCard
          label={t("loadPlanning.baggage", "Baggage")}
          value={Math.round(plan.totalBaggage / 100)}
          unit="kg"
        />
        <WeightCard
          label={t("loadPlanning.cargo", "Cargo")}
          value={Math.round(plan.totalCargo / 100)}
          unit="kg"
        />
        <WeightCard
          label={t("loadPlanning.mail", "Mail")}
          value={Math.round(plan.totalMail / 100)}
          unit="kg"
        />
        <WeightCard
          label={t("loadPlanning.deadload", "Deadload")}
          value={Math.round(plan.deadload / 100)}
          unit="kg"
          highlight
        />
        <WeightCard
          label={t("loadPlanning.items", "Items")}
          value={
            plan.items.filter(
              (i: { status: string }) => i.status !== "offloaded"
            ).length
          }
          unit=""
        />
      </div>

      {/* Aircraft Side-View Visualization */}
      <Card className="p-6 shadow-sm rounded-xl">
        <h3 className="font-semibold text-lg mb-4">
          {t("loadPlanning.aircraftLayout", "Aircraft Compartment Layout")}
        </h3>
        <AircraftSideView compartments={plan.compartments} />
      </Card>

      {/* Compartment Details */}
      <Card className="p-6 shadow-sm rounded-xl">
        <h3 className="font-semibold text-lg mb-4">
          {t("loadPlanning.compartmentDetails", "Compartment Details")}
        </h3>
        <div className="space-y-4">
          {plan.compartments.map(
            (ca: {
              compartment: {
                id: number;
                compartmentCode: string;
                name: string;
                position: string;
                maxWeight: number;
                maxVolume: number;
                uldCompatible: boolean;
              };
              items: Array<{
                id: number;
                description: string;
                weight: number;
                pieces: number;
                itemType: string;
                status: string;
              }>;
              totalWeight: number;
              totalVolume: number;
              fillPercentWeight: number;
              fillPercentVolume: number;
            }) => (
              <CompartmentCard
                key={ca.compartment.id}
                compartment={ca}
                flightId={flightId}
                allItems={plan.items}
                onAssigned={() => {
                  refetchPlan();
                  refetchValidation();
                }}
              />
            )
          )}
        </div>
      </Card>

      {/* Items List */}
      <Card className="p-6 shadow-sm rounded-xl">
        <h3 className="font-semibold text-lg mb-4">
          {t("loadPlanning.allItems", "All Load Items")}
        </h3>
        <ItemsTable items={plan.items} compartments={plan.compartments} />
      </Card>
    </div>
  );
}

// ============================================================================
// Compartments Tab
// ============================================================================

function CompartmentsTab({ flightId: _flightId }: { flightId: number }) {
  const { t } = useTranslation();
  const [aircraftTypeId, setAircraftTypeId] = useState("");
  const { data: aircraftList } = trpc.dcs.getAircraftTypes.useQuery();

  const parsedId = aircraftTypeId ? parseInt(aircraftTypeId) : 0;
  const { data: layout, isLoading } =
    trpc.loadPlanning.getCompartments.useQuery(
      { aircraftTypeId: parsedId },
      { enabled: parsedId > 0 }
    );

  return (
    <div className="space-y-4">
      <Card className="p-4 shadow-sm rounded-xl">
        <div className="flex gap-4 items-end">
          <div className="flex-1 max-w-sm">
            <Label>
              {t("loadPlanning.selectAircraftType", "Aircraft Type")}
            </Label>
            <Select value={aircraftTypeId} onValueChange={setAircraftTypeId}>
              <SelectTrigger>
                <SelectValue
                  placeholder={t(
                    "loadPlanning.selectAircraft",
                    "Select aircraft type..."
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
        </div>
      </Card>

      {isLoading && (
        <Card className="p-6 animate-pulse shadow-sm rounded-xl">
          <div className="h-40 bg-muted rounded" />
        </Card>
      )}

      {layout && (
        <div className="space-y-4">
          <Card className="p-4 shadow-sm rounded-xl">
            <div className="flex items-center gap-3 mb-2">
              <Plane className="h-5 w-5 text-blue-500" />
              <h3 className="font-semibold text-lg">
                {layout.aircraftType.name}
              </h3>
              <span className="text-xs bg-muted px-2 py-1 rounded">
                {layout.aircraftType.isWidebody ? "Widebody" : "Narrowbody"}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">
                  {t("loadPlanning.totalMaxWeight", "Total Max Weight")}
                </p>
                <p className="font-medium">
                  {(layout.totalMaxWeight / 100).toLocaleString()} kg
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">
                  {t("loadPlanning.totalMaxVolume", "Total Max Volume")}
                </p>
                <p className="font-medium">
                  {(layout.totalMaxVolume / 100).toFixed(1)} m3
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">
                  {t("loadPlanning.compartmentCount", "Compartments")}
                </p>
                <p className="font-medium">{layout.compartments.length}</p>
              </div>
            </div>
          </Card>

          {layout.compartments.map(
            (comp: {
              id: number;
              compartmentCode: string;
              name: string;
              position: string;
              maxWeight: number;
              maxVolume: number;
              uldCompatible: boolean;
            }) => (
              <Card key={comp.id} className="p-4 shadow-sm rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-lg">
                      {comp.compartmentCode}
                    </span>
                    <span className="text-muted-foreground">{comp.name}</span>
                  </div>
                  <div className="flex gap-2">
                    <PositionBadge position={comp.position} />
                    {comp.uldCompatible && (
                      <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 px-2 py-1 rounded">
                        ULD
                      </span>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">
                      {t("loadPlanning.maxWeight", "Max Weight")}
                    </p>
                    <p className="font-medium">
                      {(comp.maxWeight / 100).toLocaleString()} kg
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">
                      {t("loadPlanning.maxVolume", "Max Volume")}
                    </p>
                    <p className="font-medium">
                      {(comp.maxVolume / 100).toFixed(1)} m3
                    </p>
                  </div>
                </div>
              </Card>
            )
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// ULD Tab
// ============================================================================

function ULDTab({ flightId }: { flightId: number }) {
  const { t } = useTranslation();

  // ULD calculation is not a separate tRPC endpoint - we use the service directly
  // For now we show ULD info derived from the load plan
  const { data: plan } = trpc.loadPlanning.get.useQuery(
    { flightId },
    { enabled: flightId > 0 }
  );

  if (!flightId) {
    return (
      <Card className="p-8 text-center text-muted-foreground shadow-sm rounded-xl">
        {t(
          "loadPlanning.enterFlightFirst",
          "Enter a flight ID above to begin."
        )}
      </Card>
    );
  }

  if (!plan) {
    return (
      <Card className="p-8 text-center text-muted-foreground shadow-sm rounded-xl">
        {t(
          "loadPlanning.noPlanForULD",
          "Create a load plan first to see ULD calculations."
        )}
      </Card>
    );
  }

  // Calculate ULD summary from plan compartments
  const uldCompartments = plan.compartments.filter(
    (c: { compartment: { uldCompatible: boolean } }) =>
      c.compartment.uldCompatible
  );
  const bulkCompartments = plan.compartments.filter(
    (c: { compartment: { uldCompatible: boolean } }) =>
      !c.compartment.uldCompatible
  );

  return (
    <div className="space-y-4">
      <Card className="p-6 shadow-sm rounded-xl">
        <h3 className="font-semibold text-lg mb-4">
          {t("loadPlanning.uldSummary", "ULD Summary")}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="text-center p-4 bg-muted rounded">
            <p className="text-2xl font-bold">{uldCompartments.length}</p>
            <p className="text-xs text-muted-foreground">
              {t("loadPlanning.uldCompatible", "ULD-Compatible Holds")}
            </p>
          </div>
          <div className="text-center p-4 bg-muted rounded">
            <p className="text-2xl font-bold">{bulkCompartments.length}</p>
            <p className="text-xs text-muted-foreground">
              {t("loadPlanning.bulkHolds", "Bulk Holds")}
            </p>
          </div>
          <div className="text-center p-4 bg-muted rounded">
            <p className="text-2xl font-bold">
              {Math.round(plan.deadload / 100)}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("loadPlanning.totalWeightKg", "Total Weight (kg)")}
            </p>
          </div>
        </div>

        <h4 className="font-medium mb-3">
          {t(
            "loadPlanning.uldCompatibleCompartments",
            "ULD-Compatible Compartments"
          )}
        </h4>
        <div className="space-y-3">
          {uldCompartments.map(
            (ca: {
              compartment: {
                id: number;
                compartmentCode: string;
                name: string;
                maxWeight: number;
              };
              totalWeight: number;
              items: Array<{
                id: number;
                description: string;
                weight: number;
                itemType: string;
              }>;
              fillPercentWeight: number;
            }) => {
              const bagItems = ca.items.filter(
                (i: { itemType: string }) => i.itemType === "baggage"
              );
              const cargoItems = ca.items.filter(
                (i: { itemType: string }) => i.itemType !== "baggage"
              );
              // Estimate LD3s for baggage (max ~1588 kg each), PMCs for cargo (max ~6804 kg each)
              const ld3Count =
                bagItems.length > 0
                  ? Math.ceil(
                      bagItems.reduce(
                        (s: number, i: { weight: number }) => s + i.weight,
                        0
                      ) / 158800
                    )
                  : 0;
              const pmcCount =
                cargoItems.length > 0
                  ? Math.ceil(
                      cargoItems.reduce(
                        (s: number, i: { weight: number }) => s + i.weight,
                        0
                      ) / 680400
                    )
                  : 0;

              return (
                <div key={ca.compartment.id} className="p-3 border rounded">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono font-bold">
                      {ca.compartment.compartmentCode}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {Math.round(ca.totalWeight / 100)} /{" "}
                      {Math.round(ca.compartment.maxWeight / 100)} kg
                    </span>
                  </div>
                  <div className="flex gap-4 text-sm">
                    {ld3Count > 0 && (
                      <span className="bg-blue-50 dark:bg-blue-950 px-2 py-1 rounded">
                        {ld3Count}x LD-3 ({t("loadPlanning.baggage", "Baggage")}
                        )
                      </span>
                    )}
                    {pmcCount > 0 && (
                      <span className="bg-amber-50 dark:bg-amber-950 px-2 py-1 rounded">
                        {pmcCount}x PMC ({t("loadPlanning.cargo", "Cargo")})
                      </span>
                    )}
                    {ld3Count === 0 && pmcCount === 0 && (
                      <span className="text-muted-foreground">
                        {t("loadPlanning.empty", "Empty")}
                      </span>
                    )}
                  </div>
                </div>
              );
            }
          )}
        </div>

        {bulkCompartments.length > 0 && (
          <>
            <h4 className="font-medium mt-6 mb-3">
              {t("loadPlanning.bulkCompartments", "Bulk Compartments")}
            </h4>
            <div className="space-y-3">
              {bulkCompartments.map(
                (ca: {
                  compartment: {
                    id: number;
                    compartmentCode: string;
                    name: string;
                    maxWeight: number;
                  };
                  totalWeight: number;
                  items: Array<{
                    id: number;
                    description: string;
                    weight: number;
                  }>;
                  fillPercentWeight: number;
                }) => (
                  <div key={ca.compartment.id} className="p-3 border rounded">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono font-bold">
                        {ca.compartment.compartmentCode}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {Math.round(ca.totalWeight / 100)} /{" "}
                        {Math.round(ca.compartment.maxWeight / 100)} kg
                      </span>
                    </div>
                    <FillBar percent={ca.fillPercentWeight} />
                  </div>
                )
              )}
            </div>
          </>
        )}
      </Card>

      <Card className="p-4 shadow-sm rounded-xl">
        <h4 className="font-medium mb-2">
          {t("loadPlanning.uldTypes", "Standard ULD Types")}
        </h4>
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="p-2 text-start">
                {t("loadPlanning.type", "Type")}
              </th>
              <th className="p-2 text-start">
                {t("loadPlanning.description", "Description")}
              </th>
              <th className="p-2 text-start">
                {t("loadPlanning.maxWeightLabel", "Max Weight")}
              </th>
              <th className="p-2 text-start">
                {t("loadPlanning.typicalUse", "Typical Use")}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t">
              <td className="p-2 font-mono font-bold">LD-3</td>
              <td className="p-2">LD-3 Container (AKE)</td>
              <td className="p-2">1,588 kg</td>
              <td className="p-2">Passenger baggage</td>
            </tr>
            <tr className="border-t">
              <td className="p-2 font-mono font-bold">LD-7</td>
              <td className="p-2">LD-7 Container (AAP)</td>
              <td className="p-2">4,536 kg</td>
              <td className="p-2">Cargo, general</td>
            </tr>
            <tr className="border-t">
              <td className="p-2 font-mono font-bold">PMC</td>
              <td className="p-2">P6 Pallet</td>
              <td className="p-2">6,804 kg</td>
              <td className="p-2">Heavy cargo, palletized</td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// ============================================================================
// Amend (LIR) Tab
// ============================================================================

function AmendTab({ flightId }: { flightId: number }) {
  const { t } = useTranslation();
  const { data: plan, refetch: refetchPlan } = trpc.loadPlanning.get.useQuery(
    { flightId },
    { enabled: flightId > 0 }
  );

  const [amendAction, setAmendAction] = useState<
    "add" | "remove" | "update_weight" | "move"
  >("add");
  const [itemId, setItemId] = useState("");
  const [newWeight, setNewWeight] = useState("");
  const [newCompartment, setNewCompartment] = useState("");
  const [newItemType, setNewItemType] = useState<
    "baggage" | "cargo" | "mail" | "ballast"
  >("cargo");
  const [newItemDesc, setNewItemDesc] = useState("");
  const [newItemPieces, setNewItemPieces] = useState("");
  const [newItemWeight, setNewItemWeight] = useState("");
  const [newItemVolume, setNewItemVolume] = useState("");
  const [newItemComp, setNewItemComp] = useState("");

  // Add bulk load states
  const [bulkComp, setBulkComp] = useState("");
  const [bulkWeight, setBulkWeight] = useState("");

  const amendMutation = trpc.loadPlanning.amend.useMutation({
    onSuccess: _data => {
      toast.success(
        t("loadPlanning.amended", "Load plan amended successfully")
      );
      refetchPlan();
      // Reset form
      setItemId("");
      setNewWeight("");
      setNewCompartment("");
      setNewItemDesc("");
      setNewItemPieces("");
      setNewItemWeight("");
      setNewItemVolume("");
      setNewItemComp("");
    },
    onError: err => toast.error(err.message),
  });

  const bulkMutation = trpc.loadPlanning.updateBulk.useMutation({
    onSuccess: () => {
      toast.success(t("loadPlanning.bulkUpdated", "Bulk cargo updated"));
      refetchPlan();
      setBulkWeight("");
    },
    onError: err => toast.error(err.message),
  });

  if (!flightId) {
    return (
      <Card className="p-8 text-center text-muted-foreground shadow-sm rounded-xl">
        {t(
          "loadPlanning.enterFlightFirst",
          "Enter a flight ID above to begin."
        )}
      </Card>
    );
  }

  if (!plan) {
    return (
      <Card className="p-8 text-center text-muted-foreground shadow-sm rounded-xl">
        {t(
          "loadPlanning.noPlanForAmend",
          "No load plan exists. Create one first."
        )}
      </Card>
    );
  }

  const isAmendable = plan.status === "finalized" || plan.status === "amended";

  return (
    <div className="space-y-4">
      {/* Current Status */}
      <Card className="p-4 shadow-sm rounded-xl">
        <div className="flex items-center gap-3">
          <StatusBadge status={plan.status} />
          <div>
            <p className="text-sm">
              {t("loadPlanning.planStatus", "Plan Status")}:{" "}
              <strong className="capitalize">{plan.status}</strong>
            </p>
            {plan.lastAmendedAt && (
              <p className="text-xs text-muted-foreground">
                {t("loadPlanning.lastAmended", "Last amended")}:{" "}
                {new Date(plan.lastAmendedAt).toLocaleString()}
              </p>
            )}
          </div>
        </div>
        {!isAmendable && (
          <p className="text-sm text-amber-600 mt-2">
            <AlertTriangle className="inline h-4 w-4 mr-1" />
            {t(
              "loadPlanning.mustFinalize",
              "Plan must be finalized before amendments (LIR) can be made."
            )}
          </p>
        )}
      </Card>

      {/* Update Bulk Cargo */}
      <Card className="p-4 shadow-sm rounded-xl">
        <h3 className="font-semibold mb-4">
          {t("loadPlanning.updateBulkCargo", "Update Bulk Cargo")}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label>{t("loadPlanning.compartmentCode", "Compartment")}</Label>
            <Select value={bulkComp} onValueChange={setBulkComp}>
              <SelectTrigger>
                <SelectValue
                  placeholder={t(
                    "loadPlanning.selectComp",
                    "Select compartment..."
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                {plan.compartments.map(
                  (ca: {
                    compartment: {
                      id: number;
                      compartmentCode: string;
                      name: string;
                    };
                  }) => (
                    <SelectItem
                      key={ca.compartment.id}
                      value={ca.compartment.compartmentCode}
                    >
                      {ca.compartment.compartmentCode} - {ca.compartment.name}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t("loadPlanning.weightKg100", "Weight (kg * 100)")}</Label>
            <Input
              type="number"
              value={bulkWeight}
              onChange={e => setBulkWeight(e.target.value)}
              placeholder="e.g. 50000 = 500 kg"
            />
          </div>
          <div className="flex items-end">
            <Button
              onClick={() =>
                bulkMutation.mutate({
                  flightId,
                  compartment: bulkComp,
                  weight: parseInt(bulkWeight),
                })
              }
              disabled={!bulkComp || !bulkWeight || bulkMutation.isPending}
              className="gap-2"
            >
              <Package className="h-4 w-4" />
              {t("loadPlanning.updateBulk", "Update Bulk")}
            </Button>
          </div>
        </div>
      </Card>

      {/* LIR Amendment */}
      {isAmendable && (
        <Card className="p-4 shadow-sm rounded-xl">
          <h3 className="font-semibold mb-4">
            {t("loadPlanning.lirAmendment", "LIR Amendment")}
          </h3>

          {/* Action selector */}
          <div className="mb-4">
            <Label>{t("loadPlanning.action", "Action")}</Label>
            <Select
              value={amendAction}
              onValueChange={v => setAmendAction(v as typeof amendAction)}
            >
              <SelectTrigger className="max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="add">
                  {t("loadPlanning.addItem", "Add Item")}
                </SelectItem>
                <SelectItem value="remove">
                  {t("loadPlanning.removeItem", "Remove / Offload Item")}
                </SelectItem>
                <SelectItem value="update_weight">
                  {t("loadPlanning.updateWeight", "Update Weight")}
                </SelectItem>
                <SelectItem value="move">
                  {t("loadPlanning.moveItem", "Move to Compartment")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Add new item */}
          {amendAction === "add" && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>{t("loadPlanning.itemType", "Item Type")}</Label>
                <Select
                  value={newItemType}
                  onValueChange={v => setNewItemType(v as typeof newItemType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="baggage">Baggage</SelectItem>
                    <SelectItem value="cargo">Cargo</SelectItem>
                    <SelectItem value="mail">Mail</SelectItem>
                    <SelectItem value="ballast">Ballast</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>
                  {t("loadPlanning.descriptionLabel", "Description")}
                </Label>
                <Input
                  value={newItemDesc}
                  onChange={e => setNewItemDesc(e.target.value)}
                  placeholder="e.g. Late checked bag"
                />
              </div>
              <div>
                <Label>{t("loadPlanning.pieces", "Pieces")}</Label>
                <Input
                  type="number"
                  value={newItemPieces}
                  onChange={e => setNewItemPieces(e.target.value)}
                />
              </div>
              <div>
                <Label>
                  {t("loadPlanning.weightKg100", "Weight (kg * 100)")}
                </Label>
                <Input
                  type="number"
                  value={newItemWeight}
                  onChange={e => setNewItemWeight(e.target.value)}
                />
              </div>
              <div>
                <Label>
                  {t("loadPlanning.volumeLabel", "Volume (m3 * 100)")}
                </Label>
                <Input
                  type="number"
                  value={newItemVolume}
                  onChange={e => setNewItemVolume(e.target.value)}
                />
              </div>
              <div>
                <Label>{t("loadPlanning.compartment", "Compartment")}</Label>
                <Select value={newItemComp} onValueChange={setNewItemComp}>
                  <SelectTrigger>
                    <SelectValue
                      placeholder={t("loadPlanning.selectComp", "Select...")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {plan.compartments.map(
                      (ca: {
                        compartment: {
                          id: number;
                          compartmentCode: string;
                          name: string;
                        };
                      }) => (
                        <SelectItem
                          key={ca.compartment.id}
                          value={ca.compartment.compartmentCode}
                        >
                          {ca.compartment.compartmentCode} -{" "}
                          {ca.compartment.name}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Remove / Update Weight / Move */}
          {(amendAction === "remove" ||
            amendAction === "update_weight" ||
            amendAction === "move") && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>{t("loadPlanning.itemIdLabel", "Item ID")}</Label>
                <Input
                  type="number"
                  value={itemId}
                  onChange={e => setItemId(e.target.value)}
                  placeholder={t("loadPlanning.enterItemId", "Enter item ID")}
                />
              </div>
              {amendAction === "update_weight" && (
                <div>
                  <Label>
                    {t("loadPlanning.newWeight", "New Weight (kg * 100)")}
                  </Label>
                  <Input
                    type="number"
                    value={newWeight}
                    onChange={e => setNewWeight(e.target.value)}
                  />
                </div>
              )}
              {amendAction === "move" && (
                <div>
                  <Label>
                    {t("loadPlanning.targetCompartment", "Target Compartment")}
                  </Label>
                  <Select
                    value={newCompartment}
                    onValueChange={setNewCompartment}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {plan.compartments.map(
                        (ca: {
                          compartment: {
                            id: number;
                            compartmentCode: string;
                            name: string;
                          };
                        }) => (
                          <SelectItem
                            key={ca.compartment.id}
                            value={ca.compartment.compartmentCode}
                          >
                            {ca.compartment.compartmentCode} -{" "}
                            {ca.compartment.name}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          <Button
            className="mt-4 gap-2"
            onClick={() => {
              const change: {
                action: typeof amendAction;
                itemId?: number;
                newItem?: {
                  itemType: typeof newItemType;
                  description: string;
                  pieces: number;
                  weight: number;
                  volume: number;
                  compartmentCode: string;
                };
                newWeight?: number;
                newCompartmentCode?: string;
              } = { action: amendAction };

              if (amendAction === "add") {
                change.newItem = {
                  itemType: newItemType,
                  description: newItemDesc,
                  pieces: parseInt(newItemPieces) || 0,
                  weight: parseInt(newItemWeight) || 0,
                  volume: parseInt(newItemVolume) || 0,
                  compartmentCode: newItemComp,
                };
              } else {
                change.itemId = parseInt(itemId);
                if (amendAction === "update_weight") {
                  change.newWeight = parseInt(newWeight);
                }
                if (amendAction === "move") {
                  change.newCompartmentCode = newCompartment;
                }
              }

              amendMutation.mutate({
                flightId,
                changes: [change],
              });
            }}
            disabled={amendMutation.isPending}
          >
            <FileEdit className="h-4 w-4" />
            {t("loadPlanning.submitAmendment", "Submit Amendment")}
          </Button>
        </Card>
      )}

      {/* Current Items for Reference */}
      {plan.items.length > 0 && (
        <Card className="p-4 shadow-sm rounded-xl">
          <h3 className="font-semibold mb-3">
            {t("loadPlanning.currentItems", "Current Items (Reference)")}
          </h3>
          <div className="border rounded max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted sticky top-0">
                <tr>
                  <th className="p-2 text-start">ID</th>
                  <th className="p-2 text-start">
                    {t("loadPlanning.type", "Type")}
                  </th>
                  <th className="p-2 text-start">
                    {t("loadPlanning.description", "Description")}
                  </th>
                  <th className="p-2 text-start">
                    {t("loadPlanning.weightLabel", "Weight")}
                  </th>
                  <th className="p-2 text-start">
                    {t("loadPlanning.statusLabel", "Status")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {plan.items.map(
                  (item: {
                    id: number;
                    itemType: string;
                    description: string;
                    weight: number;
                    status: string;
                  }) => (
                    <tr
                      key={item.id}
                      className={`border-t ${item.status === "offloaded" ? "opacity-50" : ""}`}
                    >
                      <td className="p-2 font-mono">{item.id}</td>
                      <td className="p-2 capitalize">{item.itemType}</td>
                      <td className="p-2">{item.description}</td>
                      <td className="p-2">
                        {(item.weight / 100).toFixed(1)} kg
                      </td>
                      <td className="p-2">
                        <span
                          className={`px-2 py-0.5 rounded text-xs ${
                            item.status === "offloaded"
                              ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                              : item.status === "loaded"
                                ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                                : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                          }`}
                        >
                          {item.status}
                        </span>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Shared Components
// ============================================================================

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
    optimized: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    validated:
      "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    finalized:
      "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
    amended:
      "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
  };

  return (
    <span
      className={`px-3 py-1 rounded-full text-xs font-medium uppercase ${colors[status] ?? colors.draft}`}
    >
      {status}
    </span>
  );
}

function PositionBadge({ position }: { position: string }) {
  const colors: Record<string, string> = {
    forward: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    aft: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
    bulk: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  };

  return (
    <span
      className={`px-2 py-1 rounded text-xs ${colors[position] ?? colors.bulk}`}
    >
      {position.toUpperCase()}
    </span>
  );
}

function FillBar({ percent }: { percent: number }) {
  const color =
    percent > 90
      ? "bg-red-500"
      : percent > 70
        ? "bg-amber-500"
        : "bg-green-500";

  return (
    <div className="w-full h-3 bg-muted rounded overflow-hidden">
      <div
        className={`h-full ${color} rounded transition-all duration-300`}
        style={{ width: `${Math.min(percent, 100)}%` }}
      />
    </div>
  );
}

function WeightCard({
  label,
  value,
  unit,
  highlight,
}: {
  label: string;
  value: number;
  unit: string;
  highlight?: boolean;
}) {
  return (
    <Card
      className={`p-4 text-center shadow-sm rounded-xl ${highlight ? "border-2 border-blue-500" : ""}`}
    >
      <p className="text-2xl font-bold">
        {value.toLocaleString()}
        {unit ? ` ${unit}` : ""}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </Card>
  );
}

/**
 * Simplified aircraft side-view showing compartments with fill levels.
 * Renders a visual representation of forward, aft, and bulk holds.
 */
function AircraftSideView({
  compartments,
}: {
  compartments: Array<{
    compartment: {
      id: number;
      compartmentCode: string;
      name: string;
      position: string;
      maxWeight: number;
    };
    totalWeight: number;
    fillPercentWeight: number;
  }>;
}) {
  const forward = compartments.filter(
    c => c.compartment.position === "forward"
  );
  const aft = compartments.filter(c => c.compartment.position === "aft");
  const bulk = compartments.filter(c => c.compartment.position === "bulk");

  return (
    <div className="relative">
      {/* Aircraft body outline */}
      <div className="flex items-stretch gap-0 h-40 relative">
        {/* Nose */}
        <div className="w-16 flex items-center justify-center">
          <div className="w-full h-20 bg-muted rounded-l-full border border-r-0 flex items-center justify-center">
            <span className="text-xs text-muted-foreground -rotate-90">
              NOSE
            </span>
          </div>
        </div>

        {/* Forward holds */}
        <div className="flex-1 flex flex-col gap-1 py-1">
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground bg-muted/30 border-b rounded-t">
            Cabin (Forward)
          </div>
          <div className="flex gap-1 h-16">
            {forward.map(ca => (
              <div
                key={ca.compartment.id}
                className="flex-1 border rounded relative overflow-hidden group"
              >
                <div
                  className={`absolute bottom-0 left-0 right-0 transition-all duration-300 ${
                    ca.fillPercentWeight > 90
                      ? "bg-red-400/60"
                      : ca.fillPercentWeight > 70
                        ? "bg-amber-400/60"
                        : "bg-green-400/60"
                  }`}
                  style={{ height: `${Math.min(ca.fillPercentWeight, 100)}%` }}
                />
                <div className="relative z-10 p-1 text-center">
                  <p className="font-mono text-xs font-bold">
                    {ca.compartment.compartmentCode}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {ca.fillPercentWeight}%
                  </p>
                </div>
              </div>
            ))}
            {forward.length === 0 && (
              <div className="flex-1 border rounded flex items-center justify-center text-xs text-muted-foreground">
                FWD
              </div>
            )}
          </div>
        </div>

        {/* Center / Wing area marker */}
        <div className="w-8 flex flex-col items-center justify-center">
          <div className="w-px h-full bg-border" />
        </div>

        {/* Aft holds */}
        <div className="flex-1 flex flex-col gap-1 py-1">
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground bg-muted/30 border-b rounded-t">
            Cabin (Aft)
          </div>
          <div className="flex gap-1 h-16">
            {aft.map(ca => (
              <div
                key={ca.compartment.id}
                className="flex-1 border rounded relative overflow-hidden group"
              >
                <div
                  className={`absolute bottom-0 left-0 right-0 transition-all duration-300 ${
                    ca.fillPercentWeight > 90
                      ? "bg-red-400/60"
                      : ca.fillPercentWeight > 70
                        ? "bg-amber-400/60"
                        : "bg-green-400/60"
                  }`}
                  style={{ height: `${Math.min(ca.fillPercentWeight, 100)}%` }}
                />
                <div className="relative z-10 p-1 text-center">
                  <p className="font-mono text-xs font-bold">
                    {ca.compartment.compartmentCode}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {ca.fillPercentWeight}%
                  </p>
                </div>
              </div>
            ))}
            {aft.length === 0 && (
              <div className="flex-1 border rounded flex items-center justify-center text-xs text-muted-foreground">
                AFT
              </div>
            )}
          </div>
        </div>

        {/* Bulk + tail */}
        <div className="w-24 flex flex-col gap-1 py-1">
          <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground bg-muted/30 border-b rounded-t rounded-r">
            Tail
          </div>
          <div className="flex gap-1 h-16">
            {bulk.map(ca => (
              <div
                key={ca.compartment.id}
                className="flex-1 border rounded relative overflow-hidden"
              >
                <div
                  className={`absolute bottom-0 left-0 right-0 transition-all duration-300 ${
                    ca.fillPercentWeight > 90
                      ? "bg-red-400/60"
                      : ca.fillPercentWeight > 70
                        ? "bg-amber-400/60"
                        : "bg-green-400/60"
                  }`}
                  style={{ height: `${Math.min(ca.fillPercentWeight, 100)}%` }}
                />
                <div className="relative z-10 p-1 text-center">
                  <p className="font-mono text-xs font-bold">
                    {ca.compartment.compartmentCode}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {ca.fillPercentWeight}%
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tail cone */}
        <div className="w-10 flex items-center justify-center">
          <div className="w-full h-12 bg-muted rounded-r-full border border-l-0" />
        </div>
      </div>

      {/* Weight distribution summary below the visual */}
      <div className="flex gap-4 mt-4 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-green-400" />
          <span>&lt; 70%</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-amber-400" />
          <span>70-90%</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-red-400" />
          <span>&gt; 90%</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Compartment card with fill bars and item assignment using select inputs.
 */
function CompartmentCard({
  compartment,
  flightId,
  allItems,
  onAssigned,
}: {
  compartment: {
    compartment: {
      id: number;
      compartmentCode: string;
      name: string;
      position: string;
      maxWeight: number;
      maxVolume: number;
      uldCompatible: boolean;
    };
    items: Array<{
      id: number;
      description: string;
      weight: number;
      pieces: number;
      itemType: string;
      status: string;
    }>;
    totalWeight: number;
    totalVolume: number;
    fillPercentWeight: number;
    fillPercentVolume: number;
  };
  flightId: number;
  allItems: Array<{
    id: number;
    description: string;
    weight: number;
    compartmentId: number | null;
    status: string;
    itemType: string;
  }>;
  onAssigned: () => void;
}) {
  const { t } = useTranslation();
  const [selectedItemId, setSelectedItemId] = useState("");

  const assignMutation = trpc.loadPlanning.assignCompartment.useMutation({
    onSuccess: () => {
      toast.success(t("loadPlanning.itemAssigned", "Item assigned"));
      setSelectedItemId("");
      onAssigned();
    },
    onError: err => toast.error(err.message),
  });

  const ca = compartment;
  const unassignedItems = allItems.filter(
    i => i.compartmentId === null && i.status !== "offloaded"
  );

  return (
    <div className="border rounded p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-lg">
            {ca.compartment.compartmentCode}
          </span>
          <span className="text-sm text-muted-foreground">
            {ca.compartment.name}
          </span>
          <PositionBadge position={ca.compartment.position} />
          {ca.compartment.uldCompatible && (
            <span className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 px-2 py-0.5 rounded">
              ULD
            </span>
          )}
        </div>
        <div className="text-sm text-right">
          <p>
            {Math.round(ca.totalWeight / 100).toLocaleString()} /{" "}
            {Math.round(ca.compartment.maxWeight / 100).toLocaleString()} kg
          </p>
        </div>
      </div>

      {/* Weight fill bar */}
      <div className="mb-2">
        <div className="flex items-center justify-between text-xs mb-1">
          <span>{t("loadPlanning.weight", "Weight")}</span>
          <span>{ca.fillPercentWeight}%</span>
        </div>
        <FillBar percent={ca.fillPercentWeight} />
      </div>

      {/* Volume fill bar */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-xs mb-1">
          <span>{t("loadPlanning.volume", "Volume")}</span>
          <span>{ca.fillPercentVolume}%</span>
        </div>
        <FillBar percent={ca.fillPercentVolume} />
      </div>

      {/* Items in this compartment */}
      {ca.items.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-medium mb-1 text-muted-foreground">
            {t("loadPlanning.assignedItems", "Assigned Items")}:
          </p>
          <div className="space-y-1">
            {ca.items.map(item => (
              <div
                key={item.id}
                className="flex items-center justify-between text-xs bg-muted/50 px-2 py-1 rounded"
              >
                <span>
                  <span className="font-mono mr-1">#{item.id}</span>
                  {item.description}
                </span>
                <span className="font-medium">
                  {(item.weight / 100).toFixed(1)} kg
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Assign item select */}
      {unassignedItems.length > 0 && (
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <Label className="text-xs">
              {t("loadPlanning.assignItem", "Assign item")}
            </Label>
            <Select value={selectedItemId} onValueChange={setSelectedItemId}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue
                  placeholder={t(
                    "loadPlanning.selectItem",
                    "Select unassigned item..."
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                {unassignedItems.map(item => (
                  <SelectItem key={item.id} value={item.id.toString()}>
                    #{item.id} - {item.description} (
                    {(item.weight / 100).toFixed(1)} kg)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!selectedItemId || assignMutation.isPending}
            onClick={() =>
              assignMutation.mutate({
                flightId,
                itemId: parseInt(selectedItemId),
                compartmentId: ca.compartment.id,
              })
            }
            className="gap-1 h-8"
          >
            <ArrowRight className="h-3 w-3" />
            {t("loadPlanning.assign", "Assign")}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Table showing all items in the load plan.
 */
function ItemsTable({
  items,
  compartments,
}: {
  items: Array<{
    id: number;
    itemType: string;
    description: string;
    pieces: number;
    weight: number;
    volume: number;
    compartmentId: number | null;
    status: string;
    uldNumber: string | null;
  }>;
  compartments: Array<{
    compartment: { id: number; compartmentCode: string };
  }>;
}) {
  const { t } = useTranslation();

  function getCompCode(compId: number | null): string {
    if (!compId) return "-";
    const ca = compartments.find(c => c.compartment.id === compId);
    return ca?.compartment.compartmentCode ?? "-";
  }

  return (
    <div className="border rounded max-h-72 overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted sticky top-0">
          <tr>
            <th className="p-2 text-start">ID</th>
            <th className="p-2 text-start">{t("loadPlanning.type", "Type")}</th>
            <th className="p-2 text-start">
              {t("loadPlanning.description", "Description")}
            </th>
            <th className="p-2 text-start">{t("loadPlanning.pcs", "Pcs")}</th>
            <th className="p-2 text-start">
              {t("loadPlanning.weightLabel", "Weight")}
            </th>
            <th className="p-2 text-start">
              {t("loadPlanning.comp", "Comp.")}
            </th>
            <th className="p-2 text-start">
              {t("loadPlanning.statusLabel", "Status")}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr
              key={item.id}
              className={`border-t ${item.status === "offloaded" ? "opacity-50 line-through" : ""}`}
            >
              <td className="p-2 font-mono">{item.id}</td>
              <td className="p-2 capitalize">{item.itemType}</td>
              <td className="p-2">{item.description}</td>
              <td className="p-2">{item.pieces}</td>
              <td className="p-2">{(item.weight / 100).toFixed(1)} kg</td>
              <td className="p-2 font-mono">
                {getCompCode(item.compartmentId)}
              </td>
              <td className="p-2">
                <span
                  className={`px-2 py-0.5 rounded text-xs ${
                    item.status === "offloaded"
                      ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                      : item.status === "loaded"
                        ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                        : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                  }`}
                >
                  {item.status}
                </span>
              </td>
            </tr>
          ))}
          {items.length === 0 && (
            <tr>
              <td colSpan={7} className="p-6 text-center text-muted-foreground">
                {t("loadPlanning.noItems", "No items in load plan")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
