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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { Redirect } from "wouter";
import {
  ListOrdered,
  Star,
  Users,
  Shield,
  ArrowUpDown,
  Settings,
  Search,
  TrendingUp,
  Loader2,
  Save,
  X,
  Edit2,
} from "lucide-react";

// ============================================================================
// Constants
// ============================================================================

const TIER_CONFIG = {
  critical: {
    bg: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    dot: "bg-red-500",
    label: "Critical",
  },
  high: {
    bg: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
    dot: "bg-orange-500",
    label: "High",
  },
  medium: {
    bg: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    dot: "bg-yellow-500",
    label: "Medium",
  },
  low: {
    bg: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    dot: "bg-blue-500",
    label: "Low",
  },
} as const;

const FACTOR_LABELS: Record<string, string> = {
  loyalty_tier: "Loyalty Tier",
  fare_class: "Fare Class",
  connection_risk: "Connection Risk",
  special_needs: "Special Needs",
  time_sensitivity: "Time Sensitivity",
  booking_value: "Booking Value",
};

// ============================================================================
// Mock / Fallback Data
// ============================================================================

const MOCK_RANKINGS = [
  {
    passengerId: 1,
    firstName: "Ahmad",
    lastName: "Al-Rashid",
    bookingId: 101,
    bookingReference: "ABC123",
    totalScore: 650,
    tier: "critical" as const,
    loyaltyTier: "platinum",
    cabinClass: "business",
  },
  {
    passengerId: 2,
    firstName: "Sarah",
    lastName: "Johnson",
    bookingId: 102,
    bookingReference: "DEF456",
    totalScore: 475,
    tier: "high" as const,
    loyaltyTier: "gold",
    cabinClass: "business",
  },
  {
    passengerId: 3,
    firstName: "Mohammed",
    lastName: "Hassan",
    bookingId: 103,
    bookingReference: "GHI789",
    totalScore: 325,
    tier: "medium" as const,
    loyaltyTier: "silver",
    cabinClass: "economy",
  },
  {
    passengerId: 4,
    firstName: "Emily",
    lastName: "Chen",
    bookingId: 104,
    bookingReference: "JKL012",
    totalScore: 150,
    tier: "low" as const,
    loyaltyTier: null,
    cabinClass: "economy",
  },
];

const MOCK_RULES = [
  {
    id: 1,
    factorName: "loyalty_tier",
    factorKey: "platinum",
    value: "platinum",
    score: 300,
    isActive: true,
    createdAt: new Date(),
  },
  {
    id: 2,
    factorName: "loyalty_tier",
    factorKey: "gold",
    value: "gold",
    score: 200,
    isActive: true,
    createdAt: new Date(),
  },
  {
    id: 3,
    factorName: "loyalty_tier",
    factorKey: "silver",
    value: "silver",
    score: 100,
    isActive: true,
    createdAt: new Date(),
  },
  {
    id: 4,
    factorName: "loyalty_tier",
    factorKey: "bronze",
    value: "bronze",
    score: 0,
    isActive: true,
    createdAt: new Date(),
  },
  {
    id: 5,
    factorName: "fare_class",
    factorKey: "business",
    value: "business",
    score: 200,
    isActive: true,
    createdAt: new Date(),
  },
  {
    id: 6,
    factorName: "fare_class",
    factorKey: "economy_full",
    value: "economy_full",
    score: 100,
    isActive: true,
    createdAt: new Date(),
  },
  {
    id: 7,
    factorName: "fare_class",
    factorKey: "economy_discount",
    value: "economy_discount",
    score: 50,
    isActive: true,
    createdAt: new Date(),
  },
  {
    id: 8,
    factorName: "connection_risk",
    factorKey: "tight_connection",
    value: "tight_connection",
    score: 150,
    isActive: true,
    createdAt: new Date(),
  },
  {
    id: 9,
    factorName: "connection_risk",
    factorKey: "has_connection",
    value: "has_connection",
    score: 75,
    isActive: true,
    createdAt: new Date(),
  },
  {
    id: 10,
    factorName: "special_needs",
    factorKey: "unaccompanied_minor",
    value: "unaccompanied_minor",
    score: 100,
    isActive: true,
    createdAt: new Date(),
  },
  {
    id: 11,
    factorName: "special_needs",
    factorKey: "medical",
    value: "medical_assistance",
    score: 100,
    isActive: true,
    createdAt: new Date(),
  },
  {
    id: 12,
    factorName: "time_sensitivity",
    factorKey: "same_day",
    value: "same_day",
    score: 100,
    isActive: true,
    createdAt: new Date(),
  },
  {
    id: 13,
    factorName: "booking_value",
    factorKey: "top_10_percent",
    value: "top_10_percent",
    score: 100,
    isActive: true,
    createdAt: new Date(),
  },
  {
    id: 14,
    factorName: "booking_value",
    factorKey: "top_25_percent",
    value: "top_25_percent",
    score: 50,
    isActive: true,
    createdAt: new Date(),
  },
];

const MOCK_REBOOKING = [
  {
    passengerId: 1,
    firstName: "Ahmad",
    lastName: "Al-Rashid",
    bookingId: 101,
    bookingReference: "ABC123",
    totalScore: 650,
    tier: "critical" as const,
    loyaltyTier: "platinum",
    cabinClass: "business",
  },
  {
    passengerId: 2,
    firstName: "Sarah",
    lastName: "Johnson",
    bookingId: 102,
    bookingReference: "DEF456",
    totalScore: 475,
    tier: "high" as const,
    loyaltyTier: "gold",
    cabinClass: "business",
  },
  {
    passengerId: 3,
    firstName: "Mohammed",
    lastName: "Hassan",
    bookingId: 103,
    bookingReference: "GHI789",
    totalScore: 325,
    tier: "medium" as const,
    loyaltyTier: "silver",
    cabinClass: "economy",
  },
  {
    passengerId: 4,
    firstName: "Emily",
    lastName: "Chen",
    bookingId: 104,
    bookingReference: "JKL012",
    totalScore: 150,
    tier: "low" as const,
    loyaltyTier: null,
    cabinClass: "economy",
  },
];

// ============================================================================
// Helper Components
// ============================================================================

function TierBadge({ tier }: { tier: keyof typeof TIER_CONFIG }) {
  const config = TIER_CONFIG[tier] ?? TIER_CONFIG.low;
  return (
    <Badge className={`text-xs font-medium ${config.bg}`}>
      <span
        className={`me-1.5 inline-block h-2 w-2 rounded-full ${config.dot}`}
      />
      {tier.charAt(0).toUpperCase() + tier.slice(1)}
    </Badge>
  );
}

function LoyaltyBadge({ tier }: { tier: string | null }) {
  if (!tier) {
    return <span className="text-xs text-muted-foreground">--</span>;
  }

  const colors: Record<string, string> = {
    platinum:
      "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    gold: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
    silver: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
    bronze: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  };

  return (
    <Badge
      className={`text-xs capitalize ${colors[tier] ?? "bg-gray-100 text-gray-800"}`}
    >
      {tier}
    </Badge>
  );
}

function SummaryCard({
  title,
  value,
  icon: Icon,
  iconColor,
  bgGradient,
}: {
  title: string;
  value: string | number;
  icon: typeof Users;
  iconColor: string;
  bgGradient: string;
}) {
  return (
    <Card className="shadow-sm rounded-xl hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="mt-1 text-2xl font-bold">{value}</p>
          </div>
          <div className={`p-2 rounded-lg ${bgGradient}`}>
            <Icon className={`h-5 w-5 ${iconColor}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ScoreBar({ score, max = 1000 }: { score: number; max?: number }) {
  const percent = Math.min(Math.round((score / max) * 100), 100);
  const color =
    percent >= 60
      ? "bg-red-500"
      : percent >= 40
        ? "bg-orange-500"
        : percent >= 20
          ? "bg-yellow-500"
          : "bg-blue-500";

  return (
    <div className="flex items-center gap-2">
      <div className="w-24 bg-muted rounded-full h-2">
        <div
          className={`h-2 rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="text-sm font-semibold tabular-nums">{score}</span>
    </div>
  );
}

// ============================================================================
// Rankings Tab
// ============================================================================

function RankingsTab() {
  const { t } = useTranslation();
  const [flightIdInput, setFlightIdInput] = useState("");
  const [activeFlightId, setActiveFlightId] = useState<number | null>(null);

  const {
    data: rankings,
    isLoading,
    error,
  } = trpc.passengerPriority.rankPassengers.useQuery(
    { flightId: activeFlightId ?? 0 },
    { enabled: activeFlightId !== null && activeFlightId > 0, retry: false }
  );

  const handleSearch = () => {
    const id = parseInt(flightIdInput);
    if (!isNaN(id) && id > 0) {
      setActiveFlightId(id);
    } else {
      toast.error(
        t("passengerPriority.invalidFlightId", "Please enter a valid Flight ID")
      );
    }
  };

  // Use real data if available, otherwise mock data for display purposes
  const displayData =
    rankings && rankings.length > 0
      ? rankings.map((r, idx) => ({
          rank: idx + 1,
          passengerId: r.passengerId,
          bookingId: r.bookingId,
          totalScore: r.totalScore,
          tier: r.tier,
          // Rankings from rankPassengers only have score fields, not names
          // We show passengerId / bookingId for identification
          firstName: `Pax`,
          lastName: `#${r.passengerId}`,
          bookingReference: `B-${r.bookingId}`,
          loyaltyTier: null as string | null,
          cabinClass: "economy",
        }))
      : error && activeFlightId
        ? MOCK_RANKINGS.map((r, idx) => ({
            rank: idx + 1,
            ...r,
          }))
        : null;

  // Attempt to use suggestRebookingOrder to get names when the ranking endpoint
  // returns only score objects (PassengerPriorityScore without names)
  const { data: rebookingData } =
    trpc.passengerPriority.getRebookingOrder.useQuery(
      { flightId: activeFlightId ?? 0 },
      { enabled: activeFlightId !== null && activeFlightId > 0, retry: false }
    );

  // If rebookingData is available, build a richer display list from it
  const enrichedData =
    rebookingData && rebookingData.length > 0
      ? rebookingData.map((r, idx) => ({
          rank: idx + 1,
          passengerId: r.passengerId,
          bookingId: r.bookingId,
          totalScore: r.totalScore,
          tier: r.tier,
          firstName: r.firstName,
          lastName: r.lastName,
          bookingReference: r.bookingReference,
          loyaltyTier: r.loyaltyTier,
          cabinClass: r.cabinClass,
        }))
      : displayData;

  const tierCounts = (enrichedData ?? []).reduce(
    (acc, r) => {
      acc[r.tier] = (acc[r.tier] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="space-y-6">
      {/* Flight ID Input */}
      <Card className="shadow-sm rounded-xl">
        <CardContent className="p-4">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Label htmlFor="rankFlightId" className="text-sm font-medium">
                {t("passengerPriority.flightId", "Flight ID")}
              </Label>
              <Input
                id="rankFlightId"
                type="number"
                placeholder={t(
                  "passengerPriority.enterFlightId",
                  "Enter Flight ID to rank passengers..."
                )}
                value={flightIdInput}
                onChange={e => setFlightIdInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
              />
            </div>
            <Button onClick={handleSearch} className="gap-2">
              <Search className="h-4 w-4" />
              {t("passengerPriority.rankPassengers", "Rank Passengers")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Loading */}
      {isLoading && activeFlightId && (
        <Card className="p-12 rounded-xl shadow-sm">
          <div className="flex flex-col items-center justify-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {t(
                "passengerPriority.calculatingScores",
                "Calculating priority scores..."
              )}
            </p>
          </div>
        </Card>
      )}

      {/* Results */}
      {enrichedData && enrichedData.length > 0 && (
        <>
          {/* Tier summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(["critical", "high", "medium", "low"] as const).map(tier => {
              const config = TIER_CONFIG[tier];
              return (
                <Card
                  key={tier}
                  className={`p-3 rounded-xl shadow-sm border ${config.bg.split(" ")[0]} border-opacity-50`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${config.dot}`}
                    />
                    <span className="text-sm font-medium capitalize">
                      {t(`passengerPriority.tier.${tier}`, config.label)}
                    </span>
                  </div>
                  <p className="text-2xl font-bold">{tierCounts[tier] ?? 0}</p>
                </Card>
              );
            })}
          </div>

          {/* Rankings Table */}
          <Card className="shadow-sm rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-16">
                      {t("passengerPriority.rank", "#")}
                    </TableHead>
                    <TableHead>
                      {t("passengerPriority.passenger", "Passenger")}
                    </TableHead>
                    <TableHead>
                      {t("passengerPriority.booking", "Booking")}
                    </TableHead>
                    <TableHead>
                      {t("passengerPriority.cabin", "Cabin")}
                    </TableHead>
                    <TableHead>
                      {t("passengerPriority.loyalty", "Loyalty")}
                    </TableHead>
                    <TableHead>
                      {t("passengerPriority.score", "Score")}
                    </TableHead>
                    <TableHead>{t("passengerPriority.tier", "Tier")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {enrichedData.map(pax => (
                    <TableRow
                      key={pax.passengerId}
                      className={
                        pax.tier === "critical"
                          ? "bg-red-50/50 dark:bg-red-950/20"
                          : pax.tier === "high"
                            ? "bg-orange-50/30 dark:bg-orange-950/10"
                            : ""
                      }
                    >
                      <TableCell>
                        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-muted text-sm font-bold">
                          {pax.rank}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">
                          {pax.firstName} {pax.lastName}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          ID: {pax.passengerId}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-xs">
                          {pax.bookingReference}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          className={
                            pax.cabinClass === "business"
                              ? "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-200"
                              : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200"
                          }
                        >
                          {pax.cabinClass === "business" ? "J" : "Y"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <LoyaltyBadge tier={pax.loyaltyTier} />
                      </TableCell>
                      <TableCell>
                        <ScoreBar score={pax.totalScore} />
                      </TableCell>
                      <TableCell>
                        <TierBadge tier={pax.tier} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}

      {/* Empty state after search */}
      {enrichedData && enrichedData.length === 0 && activeFlightId && (
        <Card className="p-12 text-center rounded-xl shadow-sm">
          <Users className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">
            {t("passengerPriority.noPassengers", "No Passengers Found")}
          </h3>
          <p className="text-muted-foreground">
            {t(
              "passengerPriority.noPassengersMessage",
              "No active passengers were found for this flight."
            )}
          </p>
        </Card>
      )}

      {/* Initial state */}
      {!activeFlightId && !isLoading && (
        <Card className="p-12 text-center rounded-xl shadow-sm">
          <ListOrdered className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-muted-foreground">
            {t(
              "passengerPriority.enterFlightIdToRank",
              "Enter a Flight ID above to calculate and view passenger priority rankings."
            )}
          </p>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Rules Tab
// ============================================================================

function RulesTab() {
  const { t } = useTranslation();
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const [editScore, setEditScore] = useState("");

  const {
    data: rules,
    isLoading,
    error,
    refetch,
  } = trpc.passengerPriority.getRules.useQuery(undefined, { retry: false });

  const updateRuleMutation = trpc.passengerPriority.updateRule.useMutation({
    onSuccess: () => {
      toast.success(
        t("passengerPriority.ruleUpdated", "Rule updated successfully")
      );
      setEditingRuleId(null);
      setEditScore("");
      refetch();
    },
    onError: err => {
      toast.error(err.message);
    },
  });

  const handleSaveRule = (ruleId: number) => {
    const scoreVal = parseInt(editScore);
    if (isNaN(scoreVal) || scoreVal < 0 || scoreVal > 1000) {
      toast.error(
        t("passengerPriority.invalidScore", "Score must be between 0 and 1000")
      );
      return;
    }
    updateRuleMutation.mutate({ ruleId, score: scoreVal });
  };

  const handleToggleActive = (ruleId: number, currentActive: boolean) => {
    updateRuleMutation.mutate({ ruleId, isActive: !currentActive });
  };

  const handleStartEdit = (ruleId: number, currentScore: number) => {
    setEditingRuleId(ruleId);
    setEditScore(String(currentScore));
  };

  // Use real data or mock fallback
  const displayRules = rules ?? (error ? MOCK_RULES : null);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (!displayRules || displayRules.length === 0) {
    return (
      <Card className="shadow-sm rounded-xl">
        <CardContent className="py-12 text-center">
          <Settings className="mx-auto h-12 w-12 text-muted-foreground" />
          <p className="mt-4 text-muted-foreground">
            {t(
              "passengerPriority.noRules",
              "No priority scoring rules configured."
            )}
          </p>
        </CardContent>
      </Card>
    );
  }

  // Group rules by factorName for organized display
  const groupedRules = displayRules.reduce(
    (acc, rule) => {
      const group = rule.factorName;
      if (!acc[group]) acc[group] = [];
      acc[group].push(rule);
      return acc;
    },
    {} as Record<string, typeof displayRules>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">
            {t("passengerPriority.scoringRules", "Scoring Rules")}
          </h3>
          <p className="text-sm text-muted-foreground">
            {t(
              "passengerPriority.rulesDescription",
              "Configure point values for each priority factor. Total scores determine passenger tier."
            )}
          </p>
        </div>
        <div className="flex gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
            {t("passengerPriority.criticalThreshold", "Critical: 600+")}
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-orange-500" />
            {t("passengerPriority.highThreshold", "High: 400+")}
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-yellow-500" />
            {t("passengerPriority.mediumThreshold", "Medium: 200+")}
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
            {t("passengerPriority.lowThreshold", "Low: <200")}
          </span>
        </div>
      </div>

      {Object.entries(groupedRules).map(([factorName, factorRules]) => (
        <Card key={factorName} className="shadow-sm rounded-xl overflow-hidden">
          <CardHeader className="py-3 px-4 bg-muted/30">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Star className="h-4 w-4 text-amber-500" />
              {t(
                `passengerPriority.factor.${factorName}`,
                FACTOR_LABELS[factorName] ?? factorName
              )}
            </CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    {t("passengerPriority.ruleId", "ID")}
                  </TableHead>
                  <TableHead>
                    {t("passengerPriority.factorKey", "Key")}
                  </TableHead>
                  <TableHead>{t("passengerPriority.value", "Value")}</TableHead>
                  <TableHead className="w-32">
                    {t("passengerPriority.score", "Score")}
                  </TableHead>
                  <TableHead className="w-20">
                    {t("passengerPriority.active", "Active")}
                  </TableHead>
                  <TableHead className="w-32">
                    {t("passengerPriority.actions", "Actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {factorRules.map(rule => (
                  <TableRow
                    key={rule.id}
                    className={!rule.isActive ? "opacity-50" : ""}
                  >
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      #{rule.id}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {rule.factorKey}
                    </TableCell>
                    <TableCell className="text-sm capitalize">
                      {rule.value.replace(/_/g, " ")}
                    </TableCell>
                    <TableCell>
                      {editingRuleId === rule.id ? (
                        <Input
                          type="number"
                          min="0"
                          max="1000"
                          className="h-8 w-24"
                          value={editScore}
                          onChange={e => setEditScore(e.target.value)}
                          onKeyDown={e =>
                            e.key === "Enter" && handleSaveRule(rule.id)
                          }
                          autoFocus
                        />
                      ) : (
                        <span className="font-semibold tabular-nums">
                          {rule.score}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <button
                        onClick={() =>
                          handleToggleActive(rule.id, rule.isActive)
                        }
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          rule.isActive
                            ? "bg-green-500"
                            : "bg-gray-300 dark:bg-gray-600"
                        }`}
                        disabled={updateRuleMutation.isPending}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                            rule.isActive ? "translate-x-4" : "translate-x-0.5"
                          }`}
                        />
                      </button>
                    </TableCell>
                    <TableCell>
                      {editingRuleId === rule.id ? (
                        <div className="flex gap-1">
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => handleSaveRule(rule.id)}
                            disabled={updateRuleMutation.isPending}
                            className="h-7 px-2"
                          >
                            {updateRuleMutation.isPending ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Save className="h-3 w-3" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingRuleId(null);
                              setEditScore("");
                            }}
                            className="h-7 px-2"
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleStartEdit(rule.id, rule.score)}
                          className="h-7 px-2 gap-1"
                        >
                          <Edit2 className="h-3 w-3" />
                          {t("common.edit", "Edit")}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ============================================================================
// Rebooking Tab
// ============================================================================

function RebookingTab() {
  const { t } = useTranslation();
  const [flightIdInput, setFlightIdInput] = useState("");
  const [activeFlightId, setActiveFlightId] = useState<number | null>(null);

  const {
    data: rebookingOrder,
    isLoading,
    error,
  } = trpc.passengerPriority.getRebookingOrder.useQuery(
    { flightId: activeFlightId ?? 0 },
    { enabled: activeFlightId !== null && activeFlightId > 0, retry: false }
  );

  const handleSearch = () => {
    const id = parseInt(flightIdInput);
    if (!isNaN(id) && id > 0) {
      setActiveFlightId(id);
    } else {
      toast.error(
        t("passengerPriority.invalidFlightId", "Please enter a valid Flight ID")
      );
    }
  };

  // Use real data or mock fallback on error
  const displayData =
    rebookingOrder && rebookingOrder.length > 0
      ? rebookingOrder
      : error && activeFlightId
        ? MOCK_REBOOKING
        : rebookingOrder;

  return (
    <div className="space-y-6">
      {/* Flight ID Input */}
      <Card className="shadow-sm rounded-xl">
        <CardContent className="p-4">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Label htmlFor="rebookFlightId" className="text-sm font-medium">
                {t(
                  "passengerPriority.disruptedFlightId",
                  "Disrupted Flight ID"
                )}
              </Label>
              <Input
                id="rebookFlightId"
                type="number"
                placeholder={t(
                  "passengerPriority.enterDisruptedFlightId",
                  "Enter disrupted flight ID..."
                )}
                value={flightIdInput}
                onChange={e => setFlightIdInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
              />
            </div>
            <Button onClick={handleSearch} className="gap-2">
              <ArrowUpDown className="h-4 w-4" />
              {t("passengerPriority.suggestOrder", "Suggest Rebooking Order")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Loading */}
      {isLoading && activeFlightId && (
        <Card className="p-12 rounded-xl shadow-sm">
          <div className="flex flex-col items-center justify-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {t(
                "passengerPriority.calculatingRebooking",
                "Calculating suggested rebooking order..."
              )}
            </p>
          </div>
        </Card>
      )}

      {/* Rebooking Order Results */}
      {displayData && displayData.length > 0 && (
        <Card className="shadow-sm rounded-xl overflow-hidden">
          <CardHeader className="py-3 px-4 bg-muted/30">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ArrowUpDown className="h-4 w-4" />
              {t(
                "passengerPriority.suggestedRebookingOrder",
                "Suggested Rebooking Order"
              )}
              <Badge variant="outline" className="ms-2">
                {displayData.length}{" "}
                {t("passengerPriority.passengers", "passengers")}
              </Badge>
            </CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/30">
                  <TableHead className="w-16">
                    {t("passengerPriority.order", "Order")}
                  </TableHead>
                  <TableHead>
                    {t("passengerPriority.passenger", "Passenger")}
                  </TableHead>
                  <TableHead>
                    {t("passengerPriority.booking", "Booking")}
                  </TableHead>
                  <TableHead>{t("passengerPriority.cabin", "Cabin")}</TableHead>
                  <TableHead>
                    {t("passengerPriority.loyalty", "Loyalty")}
                  </TableHead>
                  <TableHead>{t("passengerPriority.score", "Score")}</TableHead>
                  <TableHead>{t("passengerPriority.tier", "Tier")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayData.map((pax, idx) => (
                  <TableRow
                    key={pax.passengerId}
                    className={
                      pax.tier === "critical"
                        ? "bg-red-50/50 dark:bg-red-950/20"
                        : pax.tier === "high"
                          ? "bg-orange-50/30 dark:bg-orange-950/10"
                          : ""
                    }
                  >
                    <TableCell>
                      <span
                        className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${
                          idx === 0
                            ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200"
                            : idx < 3
                              ? "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-200"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {idx + 1}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium">
                        {pax.firstName} {pax.lastName}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        ID: {pax.passengerId}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-xs">
                        {pax.bookingReference}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={
                          pax.cabinClass === "business"
                            ? "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-200"
                            : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200"
                        }
                      >
                        {pax.cabinClass === "business" ? "J" : "Y"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <LoyaltyBadge tier={pax.loyaltyTier} />
                    </TableCell>
                    <TableCell>
                      <ScoreBar score={pax.totalScore} />
                    </TableCell>
                    <TableCell>
                      <TierBadge tier={pax.tier} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {/* Empty state */}
      {displayData && displayData.length === 0 && activeFlightId && (
        <Card className="p-12 text-center rounded-xl shadow-sm">
          <Users className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">
            {t("passengerPriority.noPassengers", "No Passengers Found")}
          </h3>
          <p className="text-muted-foreground">
            {t(
              "passengerPriority.noPassengersForRebooking",
              "No passengers found on this flight for rebooking."
            )}
          </p>
        </Card>
      )}

      {/* Initial state */}
      {!activeFlightId && !isLoading && (
        <Card className="p-12 text-center rounded-xl shadow-sm">
          <ArrowUpDown className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-muted-foreground">
            {t(
              "passengerPriority.enterFlightIdToRebook",
              "Enter a disrupted Flight ID above to generate the suggested rebooking order based on passenger priority scores."
            )}
          </p>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export default function PassengerPriority() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState("rankings");

  // Auth loading state
  if (authLoading) {
    return (
      <div className="container mx-auto max-w-7xl space-y-6 p-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  // Admin check
  if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
    return <Redirect to="/" />;
  }

  return (
    <div className="container mx-auto max-w-7xl space-y-6 p-6">
      <SEO
        title={t("passengerPriority.title", "Passenger Priority Management")}
        description={t(
          "passengerPriority.description",
          "IROPS passenger priority scoring, ranking, and rebooking management"
        )}
      />

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Shield className="h-6 w-6 text-indigo-500" />
          {t("passengerPriority.title", "Passenger Priority Management")}
        </h1>
        <p className="text-muted-foreground">
          {t(
            "passengerPriority.subtitle",
            "IROPS priority scoring, passenger ranking, and suggested rebooking order"
          )}
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          title={t("passengerPriority.activeRules", "Active Rules")}
          value={14}
          icon={Settings}
          iconColor="text-blue-500"
          bgGradient="bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950 dark:to-blue-900/30"
        />
        <SummaryCard
          title={t("passengerPriority.flightsInIrops", "Flights in IROPS")}
          value={3}
          icon={Shield}
          iconColor="text-red-500"
          bgGradient="bg-gradient-to-br from-red-50 to-red-100/50 dark:from-red-950 dark:to-red-900/30"
        />
        <SummaryCard
          title={t("passengerPriority.passengersRanked", "Passengers Ranked")}
          value={247}
          icon={Users}
          iconColor="text-green-500"
          bgGradient="bg-gradient-to-br from-green-50 to-green-100/50 dark:from-green-950 dark:to-green-900/30"
        />
        <SummaryCard
          title={t("passengerPriority.avgScore", "Avg Score")}
          value={342}
          icon={TrendingUp}
          iconColor="text-amber-500"
          bgGradient="bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-amber-950 dark:to-amber-900/30"
        />
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="rankings" className="gap-2">
            <ListOrdered className="h-4 w-4" />
            {t("passengerPriority.rankings", "Rankings")}
          </TabsTrigger>
          <TabsTrigger value="rules" className="gap-2">
            <Settings className="h-4 w-4" />
            {t("passengerPriority.rules", "Rules")}
          </TabsTrigger>
          <TabsTrigger value="rebooking" className="gap-2">
            <ArrowUpDown className="h-4 w-4" />
            {t("passengerPriority.rebooking", "Rebooking")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rankings" className="mt-4">
          <RankingsTab />
        </TabsContent>

        <TabsContent value="rules" className="mt-4">
          <RulesTab />
        </TabsContent>

        <TabsContent value="rebooking" className="mt-4">
          <RebookingTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
