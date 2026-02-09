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
  Weight,
  AlertTriangle,
  CheckCircle,
  FileText,
  History,
  Calculator,
  Gauge,
  XCircle,
  Info,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

// ============================================================================
// Type Definitions
// These types mirror the service return shapes. Once the weightBalance router
// is registered in server/routers.ts, these can be removed in favor of
// tRPC-inferred types.
// ============================================================================

interface WBPassengerBreakdown {
  males: { count: number; weight: number };
  females: { count: number; weight: number };
  children: { count: number; weight: number };
  infants: { count: number; weight: number };
}

interface WBFuelBreakdown {
  taxiFuel: number;
  tripFuel: number;
  contingency: number;
  alternateFuel: number;
  finalReserve: number;
  extraFuel: number;
}

interface WBDetails {
  aircraft: {
    code: string;
    name: string;
    limits: {
      mtow: number;
      mlw: number;
      mzfw: number;
      oew: number;
      maxPayload: number;
      maxFuel: number;
    };
  };
  weights: {
    operatingEmpty: number;
    passengers: {
      count: number;
      weight: number;
      breakdown: WBPassengerBreakdown;
    };
    baggage: {
      checkedCount: number;
      checkedWeight: number;
      carryOnCount: number;
      totalWeight: number;
    };
    cargo: {
      zones: Array<{ zone: string; weight: number }>;
      totalWeight: number;
    };
    fuel: {
      totalFuelWeight: number;
      breakdown: WBFuelBreakdown;
      fuelDensity: number;
    };
    zeroFuel: number;
    takeoff: number;
    landing: number;
  };
  balance: {
    cgPosition: number;
    forwardLimit: number;
    aftLimit: number;
    trimSetting: number;
  };
  isWithinLimits: boolean;
}

interface WBCalculationResult {
  id: number;
  flightId: number;
  aircraftTypeId: number;
  operatingEmptyWeight: number;
  passengerWeight: number;
  baggageWeight: number;
  cargoWeight: number;
  fuelWeight: number;
  totalWeight: number;
  maxTakeoffWeight: number;
  cgPosition: number;
  cgForwardLimit: number;
  cgAftLimit: number;
  isWithinLimits: boolean;
  trimSetting: number;
  status: string;
  calculatedBy: number;
  calculatedAt: string;
  details: WBDetails;
}

interface WBFlightData {
  id: number;
  flightId: number;
  aircraftTypeId: number;
  operatingEmptyWeight: number;
  passengerWeight: number;
  baggageWeight: number;
  cargoWeight: number;
  fuelWeight: number;
  totalWeight: number;
  maxTakeoffWeight: number;
  cgPosition: number;
  cgForwardLimit: number;
  cgAftLimit: number;
  isWithinLimits: boolean;
  trimSetting: number;
  status: string;
}

interface WBLimitCheck {
  name: string;
  actual: number;
  limit: number;
  unit: string;
  passed: boolean;
  margin: number;
}

interface WBLimitsResult {
  isWithinAllLimits: boolean;
  checks: WBLimitCheck[];
  warnings: string[];
  errors: string[];
}

interface WBLoadSheet {
  loadSheetNumber: string;
  edition: string;
  generatedAt: string;
  flight: {
    id: number;
    flightNumber: string;
    date: string;
    origin: string;
    destination: string;
    aircraftType: string;
    registration: string;
  };
  crew: { cockpit: number; cabin: number; total: number };
  passengers: {
    males: number;
    females: number;
    children: number;
    infants: number;
    totalExcludingInfants: number;
    total: number;
  };
  weights: {
    operatingEmptyWeight: number;
    passengerWeight: number;
    baggageWeight: number;
    cargoMailWeight: number;
    totalTrafficLoad: number;
    dryOperatingWeight: number;
    zeroFuelWeightActual: number;
    zeroFuelWeightMax: number;
    takeoffFuel: number;
    takeoffWeightActual: number;
    takeoffWeightMax: number;
    tripFuel: number;
    landingWeightActual: number;
    landingWeightMax: number;
  };
  balance: {
    cgPercent: number;
    cgForwardLimit: number;
    cgAftLimit: number;
    trimSetting: number;
    stabilizerSetting: number;
  };
  cargoByZone: Array<{ zone: string; weight: number; maxWeight: number }>;
  limitations: { isWithinAllLimits: boolean; items: string[] };
  remarks: string[];
}

interface WBHistoryRecord {
  id: number;
  status: string;
  passengerCount: number;
  passengerWeight: number;
  baggageWeight: number;
  cargoWeight: number;
  fuelWeight: number;
  zeroFuelWeight: number;
  takeoffWeight: number;
  landingWeight: number;
  cgPosition: string | null;
  withinLimits: boolean;
  warnings: string[];
  createdAt: string;
}

// Access the weightBalance router via type assertion.
// The router is defined but must be registered in server/routers.ts
// for full type inference. Until then, we use this typed accessor.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const wbTrpc = (trpc as any).weightBalance as {
  calculate: {
    useMutation: (opts: {
      onSuccess: () => void;
      onError: (err: { message: string }) => void;
    }) => {
      mutate: (input: {
        flightId: number;
        aircraftTypeId: number;
        fuelWeight: number;
        cargoDistribution?: Array<{ zone: string; weight: number }>;
      }) => void;
      data: WBCalculationResult | undefined;
      isPending: boolean;
    };
  };
  getFlightWB: {
    useQuery: (
      input: { flightId: number },
      opts: { enabled: boolean }
    ) => { data: WBFlightData | null | undefined; isLoading: boolean };
  };
  checkLimits: {
    useQuery: (
      input: { flightId: number },
      opts: { enabled: boolean }
    ) => {
      data: WBLimitsResult | undefined;
      isLoading: boolean;
      refetch: () => void;
    };
  };
  generateLoadSheet: {
    useMutation: (opts: {
      onSuccess: () => void;
      onError: (err: { message: string }) => void;
    }) => {
      mutate: (input: { flightId: number }) => void;
      data: WBLoadSheet | undefined;
      isPending: boolean;
    };
  };
  getHistory: {
    useQuery: (
      input: { flightId: number },
      opts: { enabled: boolean }
    ) => { data: WBHistoryRecord[] | undefined; isLoading: boolean };
  };
};

// ============================================================================
// Main WeightBalance Page
// ============================================================================

type Tab = "calculate" | "current" | "limits" | "loadsheet" | "history";

export default function WeightBalance() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>("calculate");

  return (
    <div className="container mx-auto p-6 max-w-7xl page-enter">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
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
              "Flight weight calculations, CG envelope, load sheets & trim settings"
            )}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-8 flex-wrap">
        {(
          [
            {
              id: "calculate",
              label: t("wb.tabs.calculate", "Calculate W&B"),
              icon: Calculator,
            },
            {
              id: "current",
              label: t("wb.tabs.current", "Current W&B"),
              icon: Weight,
            },
            {
              id: "limits",
              label: t("wb.tabs.limits", "Check Limits"),
              icon: Gauge,
            },
            {
              id: "loadsheet",
              label: t("wb.tabs.loadsheet", "Load Sheet"),
              icon: FileText,
            },
            {
              id: "history",
              label: t("wb.tabs.history", "History"),
              icon: History,
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
      {activeTab === "calculate" && <CalculateTab />}
      {activeTab === "current" && <CurrentWBTab />}
      {activeTab === "limits" && <CheckLimitsTab />}
      {activeTab === "loadsheet" && <LoadSheetTab />}
      {activeTab === "history" && <HistoryTab />}
    </div>
  );
}

// ============================================================================
// Calculate Tab - Full W&B Calculation
// ============================================================================

function CalculateTab() {
  const { t } = useTranslation();
  const [flightId, setFlightId] = useState("");
  const [aircraftTypeId, setAircraftTypeId] = useState("");
  const [fuelWeight, setFuelWeight] = useState("");
  const [cargoZones, setCargoZones] = useState<
    Array<{ zone: string; weight: string }>
  >([]);

  const parsedFlightId = flightId ? parseInt(flightId) : 0;
  const { data: aircraftList } = trpc.dcs.getAircraftTypes.useQuery();

  const calculateMutation = wbTrpc.calculate.useMutation({
    onSuccess: () => {
      toast.success(
        t("wb.calculated", "Weight & Balance calculated successfully")
      );
    },
    onError: (err: { message: string }) => toast.error(err.message),
  });

  const wb = calculateMutation.data;

  const addCargoZone = () => {
    setCargoZones([...cargoZones, { zone: "", weight: "" }]);
  };

  const removeCargoZone = (idx: number) => {
    setCargoZones(cargoZones.filter((_, i) => i !== idx));
  };

  const updateCargoZone = (
    idx: number,
    field: "zone" | "weight",
    value: string
  ) => {
    const updated = [...cargoZones];
    updated[idx] = { ...updated[idx], [field]: value };
    setCargoZones(updated);
  };

  const handleCalculate = () => {
    const cargo = cargoZones
      .filter(c => c.zone && c.weight)
      .map(c => ({ zone: c.zone, weight: parseInt(c.weight) || 0 }));

    calculateMutation.mutate({
      flightId: parsedFlightId,
      aircraftTypeId: parseInt(aircraftTypeId),
      fuelWeight: parseInt(fuelWeight) || 0,
      cargoDistribution: cargo.length > 0 ? cargo : undefined,
    });
  };

  return (
    <div className="space-y-6">
      {/* Input Form */}
      <Card className="p-6">
        <h3 className="font-semibold text-lg mb-4">
          {t("wb.calc.title", "Calculate Weight & Balance")}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label>{t("wb.calc.flightId", "Flight ID")}</Label>
            <Input
              type="number"
              value={flightId}
              onChange={e => setFlightId(e.target.value)}
              placeholder={t("wb.calc.enterFlightId", "Enter flight ID")}
            />
          </div>
          <div>
            <Label>{t("wb.calc.aircraftType", "Aircraft Type")}</Label>
            <Select value={aircraftTypeId} onValueChange={setAircraftTypeId}>
              <SelectTrigger>
                <SelectValue
                  placeholder={t("wb.calc.selectAircraft", "Select aircraft")}
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
            <Label>{t("wb.calc.fuelWeight", "Fuel Weight (kg)")}</Label>
            <Input
              type="number"
              value={fuelWeight}
              onChange={e => setFuelWeight(e.target.value)}
              placeholder="e.g. 15000"
            />
          </div>
        </div>

        {/* Cargo Zones */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <Label>{t("wb.calc.cargoZones", "Cargo Zones")}</Label>
            <Button variant="outline" size="sm" onClick={addCargoZone}>
              {t("wb.calc.addZone", "+ Add Zone")}
            </Button>
          </div>
          {cargoZones.map((zone, idx) => (
            <div key={idx} className="flex gap-2 mb-2 items-end">
              <div className="flex-1">
                <Input
                  value={zone.zone}
                  onChange={e => updateCargoZone(idx, "zone", e.target.value)}
                  placeholder={t("wb.calc.zoneName", "Zone (e.g. FWD, AFT)")}
                />
              </div>
              <div className="flex-1">
                <Input
                  type="number"
                  value={zone.weight}
                  onChange={e => updateCargoZone(idx, "weight", e.target.value)}
                  placeholder={t("wb.calc.zoneWeight", "Weight (kg)")}
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeCargoZone(idx)}
              >
                <XCircle className="h-4 w-4 text-red-500" />
              </Button>
            </div>
          ))}
        </div>

        <Button
          className="mt-4 gap-2"
          disabled={
            !parsedFlightId ||
            !aircraftTypeId ||
            !fuelWeight ||
            calculateMutation.isPending
          }
          onClick={handleCalculate}
        >
          <Calculator className="h-4 w-4" />
          {calculateMutation.isPending
            ? t("wb.calc.calculating", "Calculating...")
            : t("wb.calc.calculateBtn", "Calculate W&B")}
        </Button>
      </Card>

      {/* Results */}
      {wb && (
        <div className="space-y-4">
          {/* Safety Status */}
          <Card
            className={`p-4 border-2 ${
              wb.isWithinLimits ? "border-green-500" : "border-red-500"
            }`}
          >
            <div className="flex items-center gap-3">
              {wb.isWithinLimits ? (
                <CheckCircle className="h-6 w-6 text-green-500" />
              ) : (
                <AlertTriangle className="h-6 w-6 text-red-500" />
              )}
              <div>
                <p className="font-semibold text-lg">
                  {wb.isWithinLimits
                    ? t("wb.result.withinLimits", "All weights within limits")
                    : t("wb.result.exceedsLimits", "Weight limits exceeded!")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("wb.result.status", "Status")}: {wb.status} |{" "}
                  {t("wb.result.trim", "Trim")}: {wb.trimSetting}{" "}
                  {t("wb.result.units", "units")}
                </p>
              </div>
            </div>
          </Card>

          {/* Weight Breakdown */}
          <Card className="p-6">
            <h3 className="font-semibold text-lg mb-4">
              {t("wb.result.weightBreakdown", "Weight Breakdown")}
            </h3>
            <div className="space-y-3">
              <WeightRow
                label={t("wb.result.oew", "Operating Empty Weight (OEW)")}
                value={wb.details.weights.operatingEmpty}
              />
              <div className="pl-4 border-l-2 border-muted space-y-2">
                <WeightRow
                  label={`${t("wb.result.males", "Males")} (${wb.details.weights.passengers.breakdown.males.count})`}
                  value={wb.details.weights.passengers.breakdown.males.weight}
                  small
                />
                <WeightRow
                  label={`${t("wb.result.females", "Females")} (${wb.details.weights.passengers.breakdown.females.count})`}
                  value={wb.details.weights.passengers.breakdown.females.weight}
                  small
                />
                <WeightRow
                  label={`${t("wb.result.children", "Children")} (${wb.details.weights.passengers.breakdown.children.count})`}
                  value={
                    wb.details.weights.passengers.breakdown.children.weight
                  }
                  small
                />
                <WeightRow
                  label={`${t("wb.result.infants", "Infants")} (${wb.details.weights.passengers.breakdown.infants.count})`}
                  value={wb.details.weights.passengers.breakdown.infants.weight}
                  small
                />
              </div>
              <WeightRow
                label={`${t("wb.result.passengers", "Passengers")} (${wb.details.weights.passengers.count})`}
                value={wb.details.weights.passengers.weight}
              />
              <WeightRow
                label={`${t("wb.result.baggage", "Checked Baggage")} (${wb.details.weights.baggage.checkedCount} pcs)`}
                value={wb.details.weights.baggage.totalWeight}
              />
              <WeightRow
                label={t("wb.result.cargo", "Cargo")}
                value={wb.details.weights.cargo.totalWeight}
              />
              <hr />
              <WeightRow
                label={t("wb.result.zfw", "Zero Fuel Weight (ZFW)")}
                value={wb.details.weights.zeroFuel}
                limit={wb.details.aircraft.limits.mzfw}
                bold
              />
              <WeightRow
                label={t("wb.result.fuel", "Fuel")}
                value={wb.details.weights.fuel.totalFuelWeight}
                limit={wb.details.aircraft.limits.maxFuel}
              />
              <hr />
              <WeightRow
                label={t("wb.result.tow", "Takeoff Weight (TOW)")}
                value={wb.details.weights.takeoff}
                limit={wb.details.aircraft.limits.mtow}
                bold
              />
              <WeightRow
                label={t("wb.result.lw", "Landing Weight (LW)")}
                value={wb.details.weights.landing}
                limit={wb.details.aircraft.limits.mlw}
                bold
              />
            </div>
          </Card>

          {/* Weight Limit Progress Bars */}
          <Card className="p-6">
            <h3 className="font-semibold text-lg mb-4">
              {t("wb.result.limitIndicators", "Weight Limit Indicators")}
            </h3>
            <div className="space-y-4">
              <WeightProgressBar
                label="MTOW"
                value={wb.details.weights.takeoff}
                max={wb.details.aircraft.limits.mtow}
              />
              <WeightProgressBar
                label="MLW"
                value={wb.details.weights.landing}
                max={wb.details.aircraft.limits.mlw}
              />
              <WeightProgressBar
                label="MZFW"
                value={wb.details.weights.zeroFuel}
                max={wb.details.aircraft.limits.mzfw}
              />
              <WeightProgressBar
                label={t("wb.result.payload", "Payload")}
                value={
                  wb.details.weights.passengers.weight +
                  wb.details.weights.baggage.totalWeight +
                  wb.details.weights.cargo.totalWeight
                }
                max={wb.details.aircraft.limits.maxPayload}
              />
              <WeightProgressBar
                label={t("wb.result.fuelCap", "Fuel")}
                value={wb.details.weights.fuel.totalFuelWeight}
                max={wb.details.aircraft.limits.maxFuel}
              />
            </div>
          </Card>

          {/* CG Envelope Visualization */}
          <Card className="p-6">
            <h3 className="font-semibold text-lg mb-4">
              {t("wb.result.cgEnvelope", "CG Envelope")}
            </h3>
            <CgEnvelopeGraph
              cgPosition={wb.details.balance.cgPosition}
              forwardLimit={wb.details.balance.forwardLimit}
              aftLimit={wb.details.balance.aftLimit}
            />
          </Card>

          {/* Trim Settings */}
          <Card className="p-6">
            <h3 className="font-semibold text-lg mb-4">
              {t("wb.result.trimSettings", "Trim Settings")}
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-4 bg-muted rounded">
                <p className="text-2xl font-bold">
                  {wb.details.balance.trimSetting}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("wb.result.trimUnits", "Trim (units)")}
                </p>
              </div>
              <div className="text-center p-4 bg-muted rounded">
                <p className="text-2xl font-bold">
                  {wb.details.balance.cgPosition}%
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("wb.result.cgMAC", "CG (% MAC)")}
                </p>
              </div>
              <div className="text-center p-4 bg-muted rounded">
                <p className="text-2xl font-bold">
                  {wb.details.balance.forwardLimit}%
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("wb.result.fwdLimit", "Fwd Limit")}
                </p>
              </div>
              <div className="text-center p-4 bg-muted rounded">
                <p className="text-2xl font-bold">
                  {wb.details.balance.aftLimit}%
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("wb.result.aftLimit", "Aft Limit")}
                </p>
              </div>
            </div>
          </Card>

          {/* Fuel Breakdown */}
          <Card className="p-6">
            <h3 className="font-semibold text-lg mb-4">
              {t("wb.result.fuelBreakdown", "Fuel Breakdown")}
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {Object.entries(wb.details.weights.fuel.breakdown).map(
                ([key, value]) => (
                  <div key={key} className="p-3 bg-muted rounded">
                    <p className="text-sm text-muted-foreground capitalize">
                      {key.replace(/([A-Z])/g, " $1").trim()}
                    </p>
                    <p className="font-semibold">
                      {(value as number).toLocaleString()} kg
                    </p>
                  </div>
                )
              )}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Current W&B Tab
// ============================================================================

function CurrentWBTab() {
  const { t } = useTranslation();
  const [flightId, setFlightId] = useState("");
  const parsedFlightId = flightId ? parseInt(flightId) : 0;

  const { data: wb, isLoading } = wbTrpc.getFlightWB.useQuery(
    { flightId: parsedFlightId },
    { enabled: parsedFlightId > 0 }
  );

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <Label>{t("wb.current.flightId", "Flight ID")}</Label>
            <Input
              type="number"
              value={flightId}
              onChange={e => setFlightId(e.target.value)}
              placeholder={t("wb.current.enterFlightId", "Enter flight ID")}
            />
          </div>
        </div>
      </Card>

      {isLoading && parsedFlightId > 0 && (
        <Card className="p-6 animate-pulse">
          <div className="h-40 bg-muted rounded" />
        </Card>
      )}

      {!isLoading && parsedFlightId > 0 && !wb && (
        <Card className="p-6">
          <div className="flex items-center gap-3 text-muted-foreground">
            <Info className="h-5 w-5" />
            <p>
              {t(
                "wb.current.noData",
                "No W&B data found for this flight. Use the Calculate tab first."
              )}
            </p>
          </div>
        </Card>
      )}

      {wb && (
        <div className="space-y-4">
          {/* Status Banner */}
          <Card
            className={`p-4 border-2 ${
              wb.isWithinLimits ? "border-green-500" : "border-red-500"
            }`}
          >
            <div className="flex items-center gap-3">
              {wb.isWithinLimits ? (
                <CheckCircle className="h-6 w-6 text-green-500" />
              ) : (
                <AlertTriangle className="h-6 w-6 text-red-500" />
              )}
              <div>
                <p className="font-semibold">
                  {wb.isWithinLimits
                    ? t("wb.current.withinLimits", "All weights within limits")
                    : t("wb.current.exceedsLimits", "Weight limits exceeded!")}
                </p>
                <p className="text-sm text-muted-foreground">
                  {t("wb.current.status", "Status")}: {wb.status}
                </p>
              </div>
            </div>
          </Card>

          {/* Weight Summary */}
          <Card className="p-6">
            <h3 className="font-semibold text-lg mb-4">
              {t("wb.current.summary", "Weight Summary")}
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 bg-muted rounded text-center">
                <p className="text-2xl font-bold">
                  {wb.operatingEmptyWeight.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">OEW (kg)</p>
              </div>
              <div className="p-4 bg-blue-50 dark:bg-blue-950 rounded text-center">
                <p className="text-2xl font-bold">
                  {wb.passengerWeight.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("wb.current.paxWeight", "Passengers (kg)")}
                </p>
              </div>
              <div className="p-4 bg-amber-50 dark:bg-amber-950 rounded text-center">
                <p className="text-2xl font-bold">
                  {wb.baggageWeight.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("wb.current.bagWeight", "Baggage (kg)")}
                </p>
              </div>
              <div className="p-4 bg-green-50 dark:bg-green-950 rounded text-center">
                <p className="text-2xl font-bold">
                  {wb.cargoWeight.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("wb.current.cargoWeight", "Cargo (kg)")}
                </p>
              </div>
              <div className="p-4 bg-purple-50 dark:bg-purple-950 rounded text-center">
                <p className="text-2xl font-bold">
                  {wb.fuelWeight.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("wb.current.fuelWeight", "Fuel (kg)")}
                </p>
              </div>
              <div className="p-4 bg-muted rounded text-center">
                <p className="text-2xl font-bold">
                  {wb.totalWeight.toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">TOW (kg)</p>
              </div>
              <div className="p-4 bg-muted rounded text-center">
                <p className="text-2xl font-bold">{wb.cgPosition}%</p>
                <p className="text-xs text-muted-foreground">CG (% MAC)</p>
              </div>
              <div className="p-4 bg-muted rounded text-center">
                <p className="text-2xl font-bold">{wb.trimSetting}</p>
                <p className="text-xs text-muted-foreground">
                  {t("wb.current.trim", "Trim (units)")}
                </p>
              </div>
            </div>
          </Card>

          {/* Weight Progress Bars */}
          <Card className="p-6">
            <h3 className="font-semibold text-lg mb-4">
              {t("wb.current.limits", "Limit Utilization")}
            </h3>
            <div className="space-y-4">
              <WeightProgressBar
                label="TOW vs MTOW"
                value={wb.totalWeight}
                max={wb.maxTakeoffWeight}
              />
            </div>
          </Card>

          {/* CG Envelope */}
          <Card className="p-6">
            <h3 className="font-semibold text-lg mb-4">
              {t("wb.current.cgEnvelope", "CG Position")}
            </h3>
            <CgEnvelopeGraph
              cgPosition={wb.cgPosition}
              forwardLimit={wb.cgForwardLimit}
              aftLimit={wb.cgAftLimit}
            />
          </Card>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Check Limits Tab
// ============================================================================

function CheckLimitsTab() {
  const { t } = useTranslation();
  const [flightId, setFlightId] = useState("");
  const parsedFlightId = flightId ? parseInt(flightId) : 0;

  const {
    data: limitsData,
    isLoading,
    refetch,
  } = wbTrpc.checkLimits.useQuery(
    { flightId: parsedFlightId },
    { enabled: false }
  );

  const handleCheck = () => {
    if (parsedFlightId > 0) {
      refetch();
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <Label>{t("wb.limits.flightId", "Flight ID")}</Label>
            <Input
              type="number"
              value={flightId}
              onChange={e => setFlightId(e.target.value)}
              placeholder={t("wb.limits.enterFlightId", "Enter flight ID")}
            />
          </div>
          <Button
            onClick={handleCheck}
            disabled={!parsedFlightId}
            className="gap-2"
          >
            <Gauge className="h-4 w-4" />
            {t("wb.limits.checkBtn", "Check Limits")}
          </Button>
        </div>
      </Card>

      {isLoading && (
        <Card className="p-6 animate-pulse">
          <div className="h-40 bg-muted rounded" />
        </Card>
      )}

      {limitsData && (
        <div className="space-y-4">
          {/* Overall Status */}
          <Card
            className={`p-4 border-2 ${
              limitsData.isWithinAllLimits
                ? "border-green-500"
                : "border-red-500"
            }`}
          >
            <div className="flex items-center gap-3">
              {limitsData.isWithinAllLimits ? (
                <CheckCircle className="h-6 w-6 text-green-500" />
              ) : (
                <AlertTriangle className="h-6 w-6 text-red-500" />
              )}
              <p className="font-semibold text-lg">
                {limitsData.isWithinAllLimits
                  ? t("wb.limits.allPassed", "All limit checks passed")
                  : t("wb.limits.failed", "One or more limits exceeded")}
              </p>
            </div>
          </Card>

          {/* Individual Checks */}
          <Card className="p-6">
            <h3 className="font-semibold text-lg mb-4">
              {t("wb.limits.detailedChecks", "Detailed Limit Checks")}
            </h3>
            <div className="space-y-3">
              {limitsData.checks.map((check, idx) => (
                <div
                  key={idx}
                  className={`flex items-center justify-between p-3 rounded border ${
                    check.passed
                      ? "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950"
                      : "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {check.passed ? (
                      <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
                    ) : (
                      <XCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
                    )}
                    <div>
                      <p className="font-medium">{check.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {t("wb.limits.actual", "Actual")}:{" "}
                        {check.unit === "% MAC"
                          ? `${check.actual.toFixed(2)}${check.unit}`
                          : `${check.actual.toLocaleString()} ${check.unit}`}{" "}
                        / {t("wb.limits.limit", "Limit")}:{" "}
                        {check.unit === "% MAC"
                          ? `${check.limit.toFixed(2)}${check.unit}`
                          : `${check.limit.toLocaleString()} ${check.unit}`}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p
                      className={`font-mono text-sm ${
                        check.passed ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {check.margin >= 0 ? "+" : ""}
                      {check.unit === "% MAC"
                        ? check.margin.toFixed(2)
                        : check.margin.toLocaleString()}{" "}
                      {check.unit}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("wb.limits.margin", "Margin")}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* Warnings */}
          {limitsData.warnings.length > 0 && (
            <Card className="p-6 border-amber-200 dark:border-amber-800">
              <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                {t("wb.limits.warnings", "Warnings")}
              </h3>
              <ul className="space-y-1">
                {limitsData.warnings.map((w, i) => (
                  <li
                    key={i}
                    className="text-sm text-amber-700 dark:text-amber-300"
                  >
                    {w}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Errors */}
          {limitsData.errors.length > 0 && (
            <Card className="p-6 border-red-200 dark:border-red-800">
              <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                <XCircle className="h-5 w-5 text-red-500" />
                {t("wb.limits.errors", "Errors")}
              </h3>
              <ul className="space-y-1">
                {limitsData.errors.map((e, i) => (
                  <li
                    key={i}
                    className="text-sm text-red-700 dark:text-red-300"
                  >
                    {e}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Load Sheet Tab
// ============================================================================

function LoadSheetTab() {
  const { t } = useTranslation();
  const [flightId, setFlightId] = useState("");
  const parsedFlightId = flightId ? parseInt(flightId) : 0;

  const generateMutation = wbTrpc.generateLoadSheet.useMutation({
    onSuccess: () =>
      toast.success(t("wb.loadsheet.generated", "Load sheet generated")),
    onError: (err: { message: string }) => toast.error(err.message),
  });

  const loadSheet = generateMutation.data;

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <Label>{t("wb.loadsheet.flightId", "Flight ID")}</Label>
            <Input
              type="number"
              value={flightId}
              onChange={e => setFlightId(e.target.value)}
              placeholder={t("wb.loadsheet.enterFlightId", "Enter flight ID")}
            />
          </div>
          <Button
            onClick={() =>
              generateMutation.mutate({ flightId: parsedFlightId })
            }
            disabled={!parsedFlightId || generateMutation.isPending}
            className="gap-2"
          >
            <FileText className="h-4 w-4" />
            {generateMutation.isPending
              ? t("wb.loadsheet.generating", "Generating...")
              : t("wb.loadsheet.generateBtn", "Generate Load Sheet")}
          </Button>
        </div>
      </Card>

      {loadSheet && (
        <Card className="p-6 font-mono text-sm">
          {/* Load Sheet Header */}
          <div className="border-b-2 border-black dark:border-white pb-4 mb-4">
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-xl font-bold">
                  {t("wb.loadsheet.title", "LOAD & TRIM SHEET")}
                </h2>
                <p className="text-muted-foreground">
                  {t("wb.loadsheet.iataStandard", "IATA AHM 515 Standard")}
                </p>
              </div>
              <div className="text-right">
                <p>
                  {t("wb.loadsheet.lsNumber", "LS#")}:{" "}
                  {loadSheet.loadSheetNumber}
                </p>
                <p>
                  {t("wb.loadsheet.edition", "Edition")}:{" "}
                  <span
                    className={`font-bold ${
                      loadSheet.edition === "FINAL"
                        ? "text-green-600"
                        : "text-amber-600"
                    }`}
                  >
                    {loadSheet.edition}
                  </span>
                </p>
              </div>
            </div>
          </div>

          {/* Flight Info */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div>
              <p className="text-xs text-muted-foreground">
                {t("wb.loadsheet.flight", "FLIGHT")}
              </p>
              <p className="font-bold">{loadSheet.flight.flightNumber}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                {t("wb.loadsheet.date", "DATE")}
              </p>
              <p className="font-bold">{loadSheet.flight.date}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                {t("wb.loadsheet.route", "ROUTE")}
              </p>
              <p className="font-bold">
                {loadSheet.flight.origin} - {loadSheet.flight.destination}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                {t("wb.loadsheet.acType", "A/C TYPE")}
              </p>
              <p className="font-bold">{loadSheet.flight.aircraftType}</p>
            </div>
          </div>

          {/* Passenger Section */}
          <div className="border rounded p-4 mb-4">
            <h4 className="font-bold mb-2 border-b pb-1">
              {t("wb.loadsheet.paxSection", "PASSENGERS")}
            </h4>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
              <div>
                <p className="text-xs text-muted-foreground">M</p>
                <p className="font-bold">{loadSheet.passengers.males}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">F</p>
                <p className="font-bold">{loadSheet.passengers.females}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">CHD</p>
                <p className="font-bold">{loadSheet.passengers.children}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">INF</p>
                <p className="font-bold">{loadSheet.passengers.infants}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">TTL (excl INF)</p>
                <p className="font-bold">
                  {loadSheet.passengers.totalExcludingInfants}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">TTL</p>
                <p className="font-bold">{loadSheet.passengers.total}</p>
              </div>
            </div>
          </div>

          {/* Weight Section */}
          <div className="border rounded p-4 mb-4">
            <h4 className="font-bold mb-2 border-b pb-1">
              {t("wb.loadsheet.weightSection", "WEIGHTS (kg)")}
            </h4>
            <table className="w-full">
              <tbody>
                <LoadSheetRow
                  label={t("wb.loadsheet.dow", "Dry Operating Weight (DOW)")}
                  value={loadSheet.weights.dryOperatingWeight}
                />
                <LoadSheetRow
                  label={t("wb.loadsheet.paxWeight", "Passenger Weight")}
                  value={loadSheet.weights.passengerWeight}
                />
                <LoadSheetRow
                  label={t("wb.loadsheet.bagWeight", "Baggage Weight")}
                  value={loadSheet.weights.baggageWeight}
                />
                <LoadSheetRow
                  label={t("wb.loadsheet.cargoMail", "Cargo / Mail")}
                  value={loadSheet.weights.cargoMailWeight}
                />
                <LoadSheetRow
                  label={t("wb.loadsheet.totalTraffic", "Total Traffic Load")}
                  value={loadSheet.weights.totalTrafficLoad}
                  bold
                />
                <tr>
                  <td colSpan={2}>
                    <hr className="my-1" />
                  </td>
                </tr>
                <LoadSheetRow
                  label={t(
                    "wb.loadsheet.zfwActual",
                    "Zero Fuel Weight (Actual)"
                  )}
                  value={loadSheet.weights.zeroFuelWeightActual}
                  bold
                />
                <LoadSheetRow
                  label={t("wb.loadsheet.zfwMax", "Zero Fuel Weight (Max)")}
                  value={loadSheet.weights.zeroFuelWeightMax}
                  muted
                />
                <tr>
                  <td colSpan={2}>
                    <hr className="my-1" />
                  </td>
                </tr>
                <LoadSheetRow
                  label={t("wb.loadsheet.takeoffFuel", "Takeoff Fuel")}
                  value={loadSheet.weights.takeoffFuel}
                />
                <LoadSheetRow
                  label={t("wb.loadsheet.towActual", "Takeoff Weight (Actual)")}
                  value={loadSheet.weights.takeoffWeightActual}
                  bold
                />
                <LoadSheetRow
                  label={t("wb.loadsheet.towMax", "Takeoff Weight (Max)")}
                  value={loadSheet.weights.takeoffWeightMax}
                  muted
                />
                <tr>
                  <td colSpan={2}>
                    <hr className="my-1" />
                  </td>
                </tr>
                <LoadSheetRow
                  label={t("wb.loadsheet.tripFuel", "Trip Fuel")}
                  value={loadSheet.weights.tripFuel}
                />
                <LoadSheetRow
                  label={t("wb.loadsheet.lwActual", "Landing Weight (Actual)")}
                  value={loadSheet.weights.landingWeightActual}
                  bold
                />
                <LoadSheetRow
                  label={t("wb.loadsheet.lwMax", "Landing Weight (Max)")}
                  value={loadSheet.weights.landingWeightMax}
                  muted
                />
              </tbody>
            </table>
          </div>

          {/* Balance Section */}
          <div className="border rounded p-4 mb-4">
            <h4 className="font-bold mb-2 border-b pb-1">
              {t("wb.loadsheet.balanceSection", "BALANCE / TRIM")}
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">CG %MAC</p>
                <p className="font-bold">
                  {loadSheet.balance.cgPercent.toFixed(2)}%
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">FWD LIMIT</p>
                <p className="font-bold">{loadSheet.balance.cgForwardLimit}%</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">AFT LIMIT</p>
                <p className="font-bold">{loadSheet.balance.cgAftLimit}%</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">STAB TRIM</p>
                <p className="font-bold">
                  {loadSheet.balance.stabilizerSetting} units
                </p>
              </div>
            </div>

            {/* Inline CG visualization */}
            <div className="mt-3">
              <CgEnvelopeGraph
                cgPosition={loadSheet.balance.cgPercent}
                forwardLimit={loadSheet.balance.cgForwardLimit}
                aftLimit={loadSheet.balance.cgAftLimit}
              />
            </div>
          </div>

          {/* Cargo Zones */}
          {loadSheet.cargoByZone.length > 0 && (
            <div className="border rounded p-4 mb-4">
              <h4 className="font-bold mb-2 border-b pb-1">
                {t("wb.loadsheet.cargoSection", "CARGO DISTRIBUTION")}
              </h4>
              <table className="w-full">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th className="text-start pb-1">ZONE</th>
                    <th className="text-end pb-1">WEIGHT (kg)</th>
                    <th className="text-end pb-1">MAX (kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {loadSheet.cargoByZone.map((zone, idx) => (
                    <tr key={idx}>
                      <td className="font-bold">{zone.zone}</td>
                      <td
                        className={`text-end ${
                          zone.maxWeight > 0 && zone.weight > zone.maxWeight
                            ? "text-red-600 font-bold"
                            : ""
                        }`}
                      >
                        {zone.weight.toLocaleString()}
                      </td>
                      <td className="text-end text-muted-foreground">
                        {zone.maxWeight > 0
                          ? zone.maxWeight.toLocaleString()
                          : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Limitations */}
          <div className="border rounded p-4 mb-4">
            <h4 className="font-bold mb-2 border-b pb-1 flex items-center gap-2">
              {loadSheet.limitations.isWithinAllLimits ? (
                <CheckCircle className="h-4 w-4 text-green-500" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-red-500" />
              )}
              {t("wb.loadsheet.limitations", "LIMITATIONS")}
            </h4>
            {loadSheet.limitations.items.length === 0 ? (
              <p className="text-green-600">
                {t(
                  "wb.loadsheet.noLimitations",
                  "No limitations - all within acceptable limits"
                )}
              </p>
            ) : (
              <ul className="space-y-1">
                {loadSheet.limitations.items.map((item, i) => (
                  <li key={i} className="text-red-600">
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Remarks */}
          {loadSheet.remarks.length > 0 && (
            <div className="border rounded p-4">
              <h4 className="font-bold mb-2 border-b pb-1">
                {t("wb.loadsheet.remarks", "REMARKS")}
              </h4>
              <ul className="space-y-1">
                {loadSheet.remarks.map((r, i) => (
                  <li key={i} className="text-sm">
                    {r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Footer */}
          <div className="mt-4 pt-4 border-t-2 border-black dark:border-white text-xs text-muted-foreground">
            <p>
              {t("wb.loadsheet.generatedAt", "Generated")}:{" "}
              {new Date(loadSheet.generatedAt).toLocaleString()}
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// History Tab
// ============================================================================

function HistoryTab() {
  const { t } = useTranslation();
  const [flightId, setFlightId] = useState("");
  const parsedFlightId = flightId ? parseInt(flightId) : 0;
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const { data: history, isLoading } = wbTrpc.getHistory.useQuery(
    { flightId: parsedFlightId },
    { enabled: parsedFlightId > 0 }
  );

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <Label>{t("wb.history.flightId", "Flight ID")}</Label>
            <Input
              type="number"
              value={flightId}
              onChange={e => setFlightId(e.target.value)}
              placeholder={t("wb.history.enterFlightId", "Enter flight ID")}
            />
          </div>
        </div>
      </Card>

      {isLoading && parsedFlightId > 0 && (
        <Card className="p-6 animate-pulse">
          <div className="h-40 bg-muted rounded" />
        </Card>
      )}

      {!isLoading &&
        parsedFlightId > 0 &&
        (!history || history.length === 0) && (
          <Card className="p-6">
            <div className="flex items-center gap-3 text-muted-foreground">
              <Info className="h-5 w-5" />
              <p>
                {t(
                  "wb.history.noData",
                  "No weight history found for this flight."
                )}
              </p>
            </div>
          </Card>
        )}

      {history && history.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-semibold text-lg">
            {t("wb.history.title", "Weight Calculation History")} (
            {history.length} {t("wb.history.records", "records")})
          </h3>

          {history.map((record, _idx) => (
            <Card key={record.id} className="p-0 overflow-hidden">
              <button
                className="w-full p-4 flex items-center justify-between hover:bg-muted/50 transition-colors"
                onClick={() =>
                  setExpandedId(expandedId === record.id ? null : record.id)
                }
              >
                <div className="flex items-center gap-3">
                  {record.withinLimits ? (
                    <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-red-500 flex-shrink-0" />
                  )}
                  <div className="text-start">
                    <p className="font-medium">
                      TOW: {record.takeoffWeight.toLocaleString()} kg
                      <span className="text-muted-foreground ml-2">|</span>
                      <span className="ml-2">
                        CG: {record.cgPosition ?? "N/A"}% MAC
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(record.createdAt).toLocaleString()} -{" "}
                      <span className="capitalize">{record.status}</span>
                    </p>
                  </div>
                </div>
                {expandedId === record.id ? (
                  <ChevronUp className="h-4 w-4 flex-shrink-0" />
                ) : (
                  <ChevronDown className="h-4 w-4 flex-shrink-0" />
                )}
              </button>

              {expandedId === record.id && (
                <div className="p-4 pt-0 border-t">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div>
                      <p className="text-muted-foreground">
                        {t("wb.history.pax", "Passengers")}
                      </p>
                      <p className="font-medium">
                        {record.passengerCount} (
                        {record.passengerWeight.toLocaleString()} kg)
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">
                        {t("wb.history.baggage", "Baggage")}
                      </p>
                      <p className="font-medium">
                        {record.baggageWeight.toLocaleString()} kg
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">
                        {t("wb.history.cargo", "Cargo")}
                      </p>
                      <p className="font-medium">
                        {record.cargoWeight.toLocaleString()} kg
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">
                        {t("wb.history.fuel", "Fuel")}
                      </p>
                      <p className="font-medium">
                        {record.fuelWeight.toLocaleString()} kg
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">ZFW</p>
                      <p className="font-medium">
                        {record.zeroFuelWeight.toLocaleString()} kg
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">TOW</p>
                      <p className="font-medium">
                        {record.takeoffWeight.toLocaleString()} kg
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">LW</p>
                      <p className="font-medium">
                        {record.landingWeight.toLocaleString()} kg
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">
                        {t("wb.history.status", "Status")}
                      </p>
                      <p className="font-medium capitalize">{record.status}</p>
                    </div>
                  </div>

                  {record.warnings.length > 0 && (
                    <div className="mt-3 p-3 bg-red-50 dark:bg-red-950 rounded">
                      <p className="text-sm font-medium text-red-700 dark:text-red-300 mb-1">
                        {t("wb.history.warnings", "Warnings")}:
                      </p>
                      {record.warnings.map((w: string, wi: number) => (
                        <p
                          key={wi}
                          className="text-sm text-red-600 dark:text-red-400"
                        >
                          {w}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Shared Components
// ============================================================================

/**
 * Weight row for breakdown display.
 */
function WeightRow({
  label,
  value,
  limit,
  bold,
  small,
}: {
  label: string;
  value: number;
  limit?: number;
  bold?: boolean;
  small?: boolean;
}) {
  const exceeds = limit !== undefined ? value > limit : false;
  return (
    <div
      className={`flex justify-between items-center ${
        bold ? "font-semibold" : ""
      } ${small ? "text-sm text-muted-foreground" : ""}`}
    >
      <span>{label}</span>
      <span className={exceeds ? "text-red-600 font-bold" : ""}>
        {value.toLocaleString()} kg
        {limit !== undefined ? (
          <span className="text-xs text-muted-foreground ml-2">
            / {limit.toLocaleString()} kg
          </span>
        ) : null}
      </span>
    </div>
  );
}

/**
 * Weight progress bar showing utilization percentage.
 */
function WeightProgressBar({
  label,
  value,
  max,
}: {
  label: string;
  value: number;
  max: number;
}) {
  const { t } = useTranslation();
  const percentage = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const exceeds = value > max;
  const isWarning = percentage > 90 && !exceeds;

  let barColor = "bg-green-500";
  if (exceeds) barColor = "bg-red-500";
  else if (isWarning) barColor = "bg-amber-500";

  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="font-medium">{label}</span>
        <span className={`${exceeds ? "text-red-600 font-bold" : ""}`}>
          {value.toLocaleString()} / {max.toLocaleString()} kg (
          {percentage.toFixed(1)}%)
        </span>
      </div>
      <div className="h-3 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
      {exceeds && (
        <p className="text-xs text-red-600 mt-1">
          {t("wb.result.exceedsBy", "Exceeds limit by {{amount}} kg", {
            amount: (value - max).toLocaleString(),
          })}
        </p>
      )}
    </div>
  );
}

/**
 * CG Envelope visualization - simple div-based graph showing
 * the forward/aft limits and current CG position.
 */
function CgEnvelopeGraph({
  cgPosition,
  forwardLimit,
  aftLimit,
}: {
  cgPosition: number;
  forwardLimit: number;
  aftLimit: number;
}) {
  const { t } = useTranslation();
  // Scale: we show from 0% to 50% MAC
  const scaleMax = 50;

  const fwdPct = (forwardLimit / scaleMax) * 100;
  const aftPct = (aftLimit / scaleMax) * 100;
  const cgPct = (cgPosition / scaleMax) * 100;
  const isWithin = cgPosition >= forwardLimit && cgPosition <= aftLimit;

  return (
    <div>
      {/* Scale labels */}
      <div className="flex justify-between text-xs text-muted-foreground mb-1">
        <span>0% MAC</span>
        <span>25% MAC</span>
        <span>50% MAC</span>
      </div>

      {/* CG Bar */}
      <div className="relative h-10 bg-muted rounded overflow-hidden">
        {/* Acceptable range (green zone) */}
        <div
          className="absolute top-0 bottom-0 bg-green-200 dark:bg-green-900"
          style={{
            left: `${fwdPct}%`,
            width: `${aftPct - fwdPct}%`,
          }}
        />

        {/* Forward limit line */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-green-600"
          style={{ left: `${fwdPct}%` }}
        />

        {/* Aft limit line */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-green-600"
          style={{ left: `${aftPct}%` }}
        />

        {/* CG position marker */}
        <div
          className={`absolute top-0 bottom-0 w-1.5 rounded ${
            isWithin ? "bg-blue-600" : "bg-red-600"
          }`}
          style={{
            left: `${Math.max(0, Math.min(cgPct, 100))}%`,
            transform: "translateX(-50%)",
          }}
        />

        {/* CG label */}
        <div
          className="absolute top-0 flex items-center justify-center h-full"
          style={{
            left: `${Math.max(2, Math.min(cgPct, 98))}%`,
            transform: "translateX(-50%)",
          }}
        >
          <span
            className={`text-xs font-bold px-1 rounded ${
              isWithin
                ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200"
                : "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200"
            }`}
          >
            {cgPosition.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex justify-between mt-2 text-xs">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-green-200 dark:bg-green-900 border border-green-600 rounded" />
          <span className="text-muted-foreground">
            {t("wb.result.envelope", "Envelope")} ({forwardLimit}% - {aftLimit}
            %)
          </span>
        </div>
        <div className="flex items-center gap-1">
          <div
            className={`w-3 h-3 rounded ${
              isWithin ? "bg-blue-600" : "bg-red-600"
            }`}
          />
          <span
            className={
              isWithin ? "text-blue-600" : "text-red-600 font-semibold"
            }
          >
            CG: {cgPosition.toFixed(2)}% MAC{" "}
            {isWithin
              ? t("wb.result.ok", "(OK)")
              : t("wb.result.outOfLimits", "(OUT OF LIMITS)")}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Load sheet table row.
 */
function LoadSheetRow({
  label,
  value,
  bold,
  muted,
}: {
  label: string;
  value: number;
  bold?: boolean;
  muted?: boolean;
}) {
  return (
    <tr>
      <td
        className={`py-1 ${bold ? "font-bold" : ""} ${
          muted ? "text-muted-foreground text-xs" : ""
        }`}
      >
        {label}
      </td>
      <td
        className={`py-1 text-end ${bold ? "font-bold" : ""} ${
          muted ? "text-muted-foreground text-xs" : ""
        }`}
      >
        {value.toLocaleString()}
      </td>
    </tr>
  );
}
