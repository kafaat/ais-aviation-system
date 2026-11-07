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
import { Textarea } from "@/components/ui/textarea";
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
  AlertCircle,
  CheckCircle2,
  DollarSign,
  FileText,
  Loader2,
  Scale,
  Settings,
  ShieldCheck,
  TrendingUp,
  XCircle,
  Plane,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import { useAuth } from "@/_core/hooks/useAuth";
import { Redirect } from "wouter";
import {
  type EvaluationView,
  PassengerRightsEvaluation,
} from "@/components/PassengerRightsEvaluation";
import { useOperationalLabels } from "@/components/OperationalReadState";
import {
  CLAIM_TYPE_BY_STORED,
  JURISDICTION_BY_REGULATION,
} from "@shared/passenger-rights/stored";

// ============================================================================
// Types
// ============================================================================

type ClaimStatus =
  | "pending"
  | "under_review"
  | "approved"
  | "denied"
  | "paid"
  | "appealed";

type RegulationType = "eu261" | "dot" | "local" | "uk261";

// ============================================================================
// Helper Components
// ============================================================================

function StatusBadge({ status }: { status: ClaimStatus }) {
  const { t } = useTranslation();

  const config: Record<
    ClaimStatus,
    {
      variant: "default" | "secondary" | "destructive" | "outline";
      label: string;
    }
  > = {
    pending: {
      variant: "secondary",
      label: t("compensation.statuses.pending", "Pending"),
    },
    under_review: {
      variant: "outline",
      label: t("compensation.statuses.underReview", "Under Review"),
    },
    approved: {
      variant: "default",
      label: t("compensation.statuses.approved", "Approved"),
    },
    denied: {
      variant: "destructive",
      label: t("compensation.statuses.denied", "Denied"),
    },
    paid: {
      variant: "default",
      label: t("compensation.statuses.paid", "Paid"),
    },
    appealed: {
      variant: "outline",
      label: t("compensation.statuses.appealed", "Appealed"),
    },
  };

  const c = config[status] ?? config.pending;

  return <Badge variant={c.variant}>{c.label}</Badge>;
}

function RegBadge({ type }: { type: RegulationType }) {
  const colors: Record<RegulationType, string> = {
    eu261: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    dot: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
    local: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
    uk261:
      "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  };

  const labels: Record<RegulationType, string> = {
    eu261: "EU261",
    dot: "US DOT",
    local: "GACA",
    uk261: "UK261",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[type]}`}
    >
      {labels[type]}
    </span>
  );
}

function formatSAR(cents: number | null): string {
  if (cents === null) return "—";
  return (cents / 100).toFixed(2);
}

// ============================================================================
// Statistics Cards
// ============================================================================

function StatsCards() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language.startsWith("ar");

  const { data: stats, isLoading } = trpc.compensation.getStats.useQuery();

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    );
  }

  if (!stats) return null;

  const cards = [
    {
      title: t("compensation.admin.totalClaims", "Total Claims"),
      value: stats.totalClaims,
      icon: <FileText className="h-5 w-5 text-muted-foreground" />,
      detail: `${stats.pendingClaims} ${t("compensation.admin.pending", "pending")}`,
    },
    {
      title: t("compensation.admin.approved", "Approved"),
      value: `${formatSAR(stats.totalApproved)} SAR`,
      icon: <DollarSign className="h-5 w-5 text-muted-foreground" />,
      detail: `${stats.unassessedClaims} ${isRTL ? "مطالبة بلا تقدير معتمد" : "claims without an accepted assessment"}`,
    },
    {
      title: t("compensation.admin.paidOut", "Paid Out"),
      value: `${formatSAR(stats.totalPaid)} SAR`,
      icon: <ShieldCheck className="h-5 w-5 text-muted-foreground" />,
      detail: `${stats.paidClaims} ${t("compensation.admin.claims", "claims")}`,
    },
    {
      title: t("compensation.admin.avgProcessing", "Avg. Processing"),
      value: `${stats.avgProcessingDays.toFixed(1)}d`,
      icon: <TrendingUp className="h-5 w-5 text-muted-foreground" />,
      detail: `${stats.approvedClaims + stats.deniedClaims} ${t("compensation.admin.resolved", "resolved")}`,
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card, i) => (
        <Card key={i} className="shadow-sm rounded-xl">
          <CardContent className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{card.title}</p>
                <p className="mt-1 text-2xl font-bold">{card.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {card.detail}
                </p>
              </div>
              {card.icon}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================================================================
// Claims Queue Tab
// ============================================================================

function ClaimsQueue() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "ar" ? ar : enUS;

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [regulationFilter, setRegulationFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [processDialogOpen, setProcessDialogOpen] = useState(false);
  const [selectedClaimId, setSelectedClaimId] = useState<number | null>(null);
  const [decision, setDecision] = useState<"approved" | "denied" | "partial">(
    "approved"
  );
  const [approvedAmount, setApprovedAmount] = useState("");
  const [policyReference, setPolicyReference] = useState("");
  const [fxReference, setFxReference] = useState("");
  const [distanceReference, setDistanceReference] = useState("");
  const [distanceKm, setDistanceKm] = useState("");
  const [denialReason, setDenialReason] = useState("");
  const [useGaca, setUseGaca] = useState(false);
  const [scheduledArrival, setScheduledArrival] = useState("");
  const [actualArrival, setActualArrival] = useState("");
  const [arrivalSource, setArrivalSource] = useState("");
  const [sarPerSdr, setSarPerSdr] = useState("");
  const [useEngine, setUseEngine] = useState(false);
  const [ruleCode, setRuleCode] = useState("");
  const [factsReference, setFactsReference] = useState("");
  const [fxRecordId, setFxRecordId] = useState("");
  const [factActualArrival, setFactActualArrival] = useState("");
  const [factDepartureDelay, setFactDepartureDelay] = useState("");
  const [factNoticeDays, setFactNoticeDays] = useState("");
  const [factReroutedDelay, setFactReroutedDelay] = useState("");
  const [factAltArrival, setFactAltArrival] = useState("");
  const [factAltDeparture, setFactAltDeparture] = useState("");
  const [factBagDays, setFactBagDays] = useState("");
  const [factReceipts, setFactReceipts] = useState("");
  const [factReceiptsCurrency, setFactReceiptsCurrency] = useState("SAR");
  const [factTarmac, setFactTarmac] = useState("");
  const [factExtraordinary, setFactExtraordinary] = useState(false);
  const [factPassengerCaused, setFactPassengerCaused] = useState(false);
  const [trace, setTrace] = useState<EvaluationView | null>(null);
  const [traceClaimId, setTraceClaimId] = useState<number | null>(null);
  const l = useOperationalLabels();
  const utils = trpc.useUtils();
  const catalog = trpc.compensation.getRuleCatalog.useQuery();
  const storedTrace = trpc.compensation.getClaimEvaluation.useQuery(
    { claimId: traceClaimId ?? 0 },
    { enabled: traceClaimId !== null }
  );

  const {
    data: claimsData,
    isLoading,
    refetch,
  } = trpc.compensation.getAllClaims.useQuery({
    status: statusFilter !== "all" ? (statusFilter as ClaimStatus) : undefined,
    regulationType:
      regulationFilter !== "all"
        ? (regulationFilter as RegulationType)
        : undefined,
    page,
    limit: 15,
  });

  const selectedClaim = claimsData?.claims.find(
    claim => claim.id === selectedClaimId
  );
  const allowsGaca =
    decision === "approved" &&
    selectedClaim?.regulationType === "local" &&
    selectedClaim.claimType === "delay";
  const gacaMode = allowsGaca && useGaca;
  const engineMode = decision === "approved" && useEngine && !gacaMode;
  const engineRules =
    selectedClaim && catalog.data
      ? catalog.data.ruleSets
          .filter(
            set =>
              set.jurisdiction ===
              JURISDICTION_BY_REGULATION[selectedClaim.regulationType]
          )
          .flatMap(set => set.rules)
          .filter(rule =>
            rule.claimTypes.includes(
              CLAIM_TYPE_BY_STORED[selectedClaim.claimType]
            )
          )
      : [];
  const optionalNumber = (value: string) =>
    value.trim() && Number.isFinite(Number(value)) ? Number(value) : undefined;
  const reviewerFacts = () => {
    const receipts = optionalNumber(factReceipts);
    const receiptsMinor =
      receipts === undefined ? undefined : Math.round(receipts * 100);
    return {
      actualArrivalUtc: utcIso(factActualArrival) || undefined,
      departureDelayMinutes: optionalNumber(factDepartureDelay),
      cancellation:
        selectedClaim?.claimType === "cancellation"
          ? {
              noticeDays: optionalNumber(factNoticeDays),
              reroutedArrivalDelayMinutes: optionalNumber(factReroutedDelay),
            }
          : undefined,
      deniedBoarding:
        selectedClaim?.claimType === "denied_boarding"
          ? {
              involuntary: true,
              alternativeArrivalDelayMinutes: optionalNumber(factAltArrival),
              alternativeDepartureWithinMinutes:
                optionalNumber(factAltDeparture),
            }
          : undefined,
      downgrade: selectedClaim?.claimType === "downgrade" || undefined,
      baggage: selectedClaim?.claimType.startsWith("baggage")
        ? {
            delayDays: optionalNumber(factBagDays),
            receiptsMinorUnits: receiptsMinor,
            receiptsCurrency:
              receiptsMinor === undefined ? undefined : factReceiptsCurrency,
          }
        : undefined,
      tarmacMinutes: optionalNumber(factTarmac),
      careExpenses:
        selectedClaim?.claimType === "care" && receiptsMinor !== undefined
          ? {
              receiptsMinorUnits: receiptsMinor,
              receiptsCurrency: factReceiptsCurrency,
            }
          : undefined,
      extraordinaryCircumstances: factExtraordinary || undefined,
      passengerCaused: factPassengerCaused || undefined,
    };
  };
  const engineInput = () => ({
    facts: reviewerFacts(),
    factsReference,
    fxRecordId: optionalNumber(fxRecordId),
  });
  const runEvaluation = async () => {
    if (!selectedClaimId) return;
    try {
      const result = await utils.compensation.evaluateForReview.fetch({
        claimId: selectedClaimId,
        ...engineInput(),
      });
      setTrace(result.evaluation);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };
  // datetime-local values are read as UTC, which is what the label asks for.
  const utcIso = (value: string) =>
    value && Number.isFinite(Date.parse(`${value}:00Z`))
      ? new Date(`${value}:00Z`).toISOString()
      : "";
  const validArrivals =
    !!utcIso(scheduledArrival) &&
    !!utcIso(actualArrival) &&
    Date.parse(utcIso(actualArrival)) > Date.parse(utcIso(scheduledArrival));
  const validFx =
    /^\d{1,5}(\.\d{1,6})?$/.test(sarPerSdr) && Number(sarPerSdr) > 0;

  const processClaimMutation = trpc.compensation.processClaim.useMutation({
    onSuccess: () => {
      toast.success(
        t("compensation.admin.claimProcessed", "Claim processed successfully")
      );
      setProcessDialogOpen(false);
      resetProcessForm();
      refetch();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const resetProcessForm = () => {
    setSelectedClaimId(null);
    setUseGaca(false);
    setUseEngine(false);
    setRuleCode("");
    setFactsReference("");
    setFxRecordId("");
    setFactActualArrival("");
    setFactDepartureDelay("");
    setFactNoticeDays("");
    setFactReroutedDelay("");
    setFactAltArrival("");
    setFactAltDeparture("");
    setFactBagDays("");
    setFactReceipts("");
    setFactTarmac("");
    setFactExtraordinary(false);
    setFactPassengerCaused(false);
    setTrace(null);
    setScheduledArrival("");
    setActualArrival("");
    setArrivalSource("");
    setSarPerSdr("");
    setPolicyReference("");
    setFxReference("");
    setDistanceReference("");
    setDistanceKm("");
    setDecision("approved");
    setApprovedAmount("");
    setDenialReason("");
  };

  const handleProcess = () => {
    if (!selectedClaimId) return;

    processClaimMutation.mutate({
      claimId: selectedClaimId,
      decision,
      approvedAmount:
        decision !== "denied" && !gacaMode && !engineMode && approvedAmount
          ? Math.round(parseFloat(approvedAmount) * 100)
          : undefined,
      denialReason: decision === "denied" ? denialReason : undefined,
      rightsEvidence: engineMode
        ? {
            ruleCode,
            scopeAndExceptionReview: policyReference,
            ...engineInput(),
          }
        : undefined,
      gacaArrivalEvidence: gacaMode
        ? {
            scopeAndExceptionReview: policyReference,
            arrivalReference: arrivalSource,
            scheduledArrivalUtc: utcIso(scheduledArrival),
            actualArrivalUtc: utcIso(actualArrival),
            fxReference,
            sarPerXdrMillionths: Math.round(Number(sarPerSdr) * 1_000_000),
          }
        : undefined,
      evidence:
        decision === "denied" || gacaMode || engineMode
          ? undefined
          : {
              policyReference,
              fxReference,
              distanceReference,
              distanceKm: Number(distanceKm),
            },
    });
  };

  const openProcessDialog = (claimId: number) => {
    resetProcessForm();
    setSelectedClaimId(claimId);
    setProcessDialogOpen(true);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="w-48">
          <Select
            value={statusFilter}
            onValueChange={v => {
              setStatusFilter(v);
              setPage(1);
            }}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={t("compensation.admin.filterStatus", "Status")}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {t("compensation.admin.allStatuses", "All Statuses")}
              </SelectItem>
              <SelectItem value="pending">
                {t("compensation.statuses.pending", "Pending")}
              </SelectItem>
              <SelectItem value="under_review">
                {t("compensation.statuses.underReview", "Under Review")}
              </SelectItem>
              <SelectItem value="approved">
                {t("compensation.statuses.approved", "Approved")}
              </SelectItem>
              <SelectItem value="denied">
                {t("compensation.statuses.denied", "Denied")}
              </SelectItem>
              <SelectItem value="paid">
                {t("compensation.statuses.paid", "Paid")}
              </SelectItem>
              <SelectItem value="appealed">
                {t("compensation.statuses.appealed", "Appealed")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-48">
          <Select
            value={regulationFilter}
            onValueChange={v => {
              setRegulationFilter(v);
              setPage(1);
            }}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={t(
                  "compensation.admin.filterRegulation",
                  "Regulation"
                )}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {t("compensation.admin.allRegulations", "All Regulations")}
              </SelectItem>
              <SelectItem value="eu261">EU261</SelectItem>
              <SelectItem value="uk261">UK261</SelectItem>
              <SelectItem value="dot">US DOT</SelectItem>
              <SelectItem value="local">
                {t("compensation.localRegulation", "Local")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Claims Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">
                {t("compensation.admin.id", "ID")}
              </TableHead>
              <TableHead>
                {t("compensation.admin.booking", "Booking")}
              </TableHead>
              <TableHead>
                {t("compensation.admin.regulation", "Regulation")}
              </TableHead>
              <TableHead>{t("compensation.admin.type", "Type")}</TableHead>
              <TableHead>{t("compensation.admin.amount", "Amount")}</TableHead>
              <TableHead>{t("compensation.admin.status", "Status")}</TableHead>
              <TableHead>{t("compensation.admin.filed", "Filed")}</TableHead>
              <TableHead className="w-32">
                {t("compensation.admin.actions", "Actions")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {claimsData?.claims && claimsData.claims.length > 0 ? (
              claimsData.claims.map(claim => (
                <TableRow key={claim.id}>
                  <TableCell className="font-mono text-sm">
                    #{claim.id}
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">
                      <span className="font-medium">B-{claim.bookingId}</span>
                      {claim.flightDistance && (
                        <span className="ms-1 text-xs text-muted-foreground">
                          ({claim.flightDistance} km)
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <RegBadge type={claim.regulationType} />
                  </TableCell>
                  <TableCell className="capitalize text-sm">
                    {claim.claimType.replace("_", " ")}
                  </TableCell>
                  <TableCell>
                    <div>
                      <span className="font-medium">
                        {formatSAR(claim.calculatedAmount)} SAR
                      </span>
                      {claim.approvedAmount !== null &&
                        claim.approvedAmount !== claim.calculatedAmount && (
                          <div className="text-xs text-green-600">
                            {t("compensation.approved", "Approved")}:{" "}
                            {formatSAR(claim.approvedAmount)} SAR
                          </div>
                        )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={claim.status} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {format(new Date(claim.filedAt), "PP", { locale })}
                  </TableCell>
                  <TableCell>
                    {(claim.status === "pending" ||
                      claim.status === "under_review" ||
                      claim.status === "appealed") && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openProcessDialog(claim.id)}
                      >
                        {t("compensation.admin.process", "Process")}
                      </Button>
                    )}
                    {(claim.status === "approved" ||
                      claim.status === "denied" ||
                      claim.status === "paid") && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setTraceClaimId(claim.id)}
                      >
                        {t("compensation.rights.trace", "Trace")}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-8 text-center text-muted-foreground"
                >
                  {t("compensation.admin.noClaims", "No claims found")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {claimsData && claimsData.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            {t("compensation.admin.showing", "Page")} {claimsData.page}{" "}
            {t("compensation.admin.of", "of")} {claimsData.totalPages} (
            {claimsData.total} {t("compensation.admin.totalItems", "total")})
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => p + 1)}
              disabled={page >= (claimsData?.totalPages ?? 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Process Claim Dialog */}
      <Dialog open={processDialogOpen} onOpenChange={setProcessDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("compensation.admin.processClaim", "Process Claim")} #
              {selectedClaimId}
            </DialogTitle>
            <DialogDescription>
              {t(
                "compensation.admin.processDescription",
                "Review and decide on this compensation claim."
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("compensation.admin.decision", "Decision")}</Label>
              <Select
                value={decision}
                onValueChange={v =>
                  setDecision(v as "approved" | "denied" | "partial")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="approved">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      {t(
                        "compensation.admin.approveFullAmount",
                        "Approve (Full Amount)"
                      )}
                    </div>
                  </SelectItem>
                  <SelectItem value="partial">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 text-amber-600" />
                      {t(
                        "compensation.admin.partialApproval",
                        "Partial Approval"
                      )}
                    </div>
                  </SelectItem>
                  <SelectItem value="denied">
                    <div className="flex items-center gap-2">
                      <XCircle className="h-4 w-4 text-red-600" />
                      {t("compensation.admin.deny", "Deny")}
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {allowsGaca && (
              <label className="block">
                <input
                  type="checkbox"
                  checked={useGaca}
                  onChange={e => setUseGaca(e.target.checked)}
                />{" "}
                GACA article 10(6) arrival delay / تأخير الوصول وفق المادة
                العاشرة
              </label>
            )}
            {decision === "approved" && !gacaMode && (
              <label className="block">
                <input
                  type="checkbox"
                  checked={useEngine}
                  onChange={e => setUseEngine(e.target.checked)}
                />{" "}
                {t(
                  "compensation.rights.engineBasis",
                  "Passenger-rights engine basis (jurisdiction rule with trace)"
                )}
              </label>
            )}
            {engineMode && selectedClaim && (
              <div className="space-y-2">
                <Label>{t("compensation.rights.rule", "Rule")}</Label>
                <select
                  className="border block p-2 w-full"
                  value={ruleCode}
                  onChange={e => setRuleCode(e.target.value)}
                >
                  <option value="">—</option>
                  {engineRules.map(rule => (
                    <option key={rule.code} value={rule.code}>
                      {rule.code} · {rule.title} [{rule.confirmationStatus}]
                    </option>
                  ))}
                </select>
                {[
                  {
                    label: t(
                      "compensation.rights.scopeReview",
                      "Scope and exceptions review reference"
                    ),
                    value: policyReference,
                    set: setPolicyReference,
                  },
                  {
                    label: t(
                      "compensation.rights.factsReference",
                      "Facts evidence reference"
                    ),
                    value: factsReference,
                    set: setFactsReference,
                  },
                  {
                    label: t(
                      "compensation.rights.fxRecordId",
                      "FX record id (exchange_rates) when currencies differ"
                    ),
                    value: fxRecordId,
                    set: setFxRecordId,
                    type: "number",
                  },
                  ...(selectedClaim.claimType === "delay" ||
                  selectedClaim.claimType === "downgrade"
                    ? [
                        {
                          label: t(
                            "compensation.rights.actualArrival",
                            "Actual arrival (UTC); schedule comes from the flight record"
                          ),
                          value: factActualArrival,
                          set: setFactActualArrival,
                          type: "datetime-local",
                        },
                      ]
                    : []),
                  ...(selectedClaim.claimType === "care"
                    ? [
                        {
                          label: t(
                            "compensation.rights.departureDelay",
                            "Departure delay (minutes)"
                          ),
                          value: factDepartureDelay,
                          set: setFactDepartureDelay,
                          type: "number",
                        },
                      ]
                    : []),
                  ...(selectedClaim.claimType === "cancellation"
                    ? [
                        {
                          label: t(
                            "compensation.rights.noticeDays",
                            "Days of notice before departure"
                          ),
                          value: factNoticeDays,
                          set: setFactNoticeDays,
                          type: "number",
                        },
                        {
                          label: t(
                            "compensation.rights.reroutedDelay",
                            "Rerouted arrival delay (minutes)"
                          ),
                          value: factReroutedDelay,
                          set: setFactReroutedDelay,
                          type: "number",
                        },
                      ]
                    : []),
                  ...(selectedClaim.claimType === "denied_boarding"
                    ? [
                        {
                          label: t(
                            "compensation.rights.altArrival",
                            "Alternative arrival delay (minutes)"
                          ),
                          value: factAltArrival,
                          set: setFactAltArrival,
                          type: "number",
                        },
                        {
                          label: t(
                            "compensation.rights.altDeparture",
                            "Alternative departure within (minutes of schedule)"
                          ),
                          value: factAltDeparture,
                          set: setFactAltDeparture,
                          type: "number",
                        },
                      ]
                    : []),
                  ...(selectedClaim.claimType === "baggage_delay"
                    ? [
                        {
                          label: t(
                            "compensation.rights.bagDays",
                            "Baggage delay (days)"
                          ),
                          value: factBagDays,
                          set: setFactBagDays,
                          type: "number",
                        },
                      ]
                    : []),
                  ...(selectedClaim.claimType.startsWith("baggage") ||
                  selectedClaim.claimType === "care"
                    ? [
                        {
                          label: t(
                            "compensation.rights.receipts",
                            "Receipts total (major units)"
                          ),
                          value: factReceipts,
                          set: setFactReceipts,
                          type: "number",
                        },
                        {
                          label: t(
                            "compensation.rights.receiptsCurrency",
                            "Receipts currency"
                          ),
                          value: factReceiptsCurrency,
                          set: setFactReceiptsCurrency,
                        },
                      ]
                    : []),
                  ...(selectedClaim.claimType === "tarmac_delay"
                    ? [
                        {
                          label: t(
                            "compensation.rights.tarmac",
                            "Tarmac delay (minutes)"
                          ),
                          value: factTarmac,
                          set: setFactTarmac,
                          type: "number",
                        },
                      ]
                    : []),
                ].map(field => (
                  <label className="block" key={field.label}>
                    {field.label}
                    <Input
                      type={field.type ?? "text"}
                      dir={field.type ? "ltr" : undefined}
                      value={field.value}
                      onChange={e => field.set(e.target.value)}
                    />
                  </label>
                ))}
                <label className="block">
                  <input
                    type="checkbox"
                    checked={factExtraordinary}
                    onChange={e => setFactExtraordinary(e.target.checked)}
                  />{" "}
                  {t(
                    "compensation.rights.extraordinary",
                    "Extraordinary circumstances established"
                  )}
                </label>
                <label className="block">
                  <input
                    type="checkbox"
                    checked={factPassengerCaused}
                    onChange={e => setFactPassengerCaused(e.target.checked)}
                  />{" "}
                  {t("compensation.rights.passengerCaused", "Passenger-caused")}
                </label>
                <Button
                  type="button"
                  variant="outline"
                  onClick={runEvaluation}
                  disabled={factsReference.trim().length < 5}
                >
                  {t("compensation.rights.evaluate", "Evaluate (dry run)")}
                </Button>
                {trace && (
                  <div className="max-h-72 overflow-auto border rounded p-2">
                    <PassengerRightsEvaluation evaluation={trace} showTrace />
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  {l(
                    "لا يُعتمد المبلغ إلا إذا كانت القاعدة المختارة قابلة للاعتماد في التقييم؛ يُحفظ التقييم كاملاً كدليل مراجعة.",
                    "The amount is approved only when the chosen rule is awardable in the evaluation; the full evaluation is stored as review evidence."
                  )}
                </p>
              </div>
            )}
            {gacaMode && (
              <div className="space-y-2">
                {[
                  {
                    label:
                      "Scope and exceptions review / مرجع مراجعة الانطباق والاستثناءات",
                    value: policyReference,
                    set: setPolicyReference,
                  },
                  {
                    label: "Arrival evidence reference / مرجع إثبات الوصول",
                    value: arrivalSource,
                    set: setArrivalSource,
                  },
                  {
                    label:
                      "Booked arrival (UTC) / الوصول المحجوز بالتوقيت العالمي",
                    value: scheduledArrival,
                    set: setScheduledArrival,
                    type: "datetime-local",
                  },
                  {
                    label:
                      "Actual arrival (UTC) / الوصول الفعلي بالتوقيت العالمي",
                    value: actualArrival,
                    set: setActualArrival,
                    type: "datetime-local",
                  },
                  {
                    label:
                      "Dated exchange-rate reference / مرجع سعر الصرف وتاريخه",
                    value: fxReference,
                    set: setFxReference,
                  },
                  {
                    label: "SAR per SDR / ريال لكل وحدة حقوق سحب خاصة",
                    value: sarPerSdr,
                    set: setSarPerSdr,
                    type: "number",
                    hint: "5.123456",
                  },
                ].map(field => (
                  <label className="block" key={field.label}>
                    {field.label}
                    <Input
                      type={field.type ?? "text"}
                      step={field.type === "number" ? "0.000001" : undefined}
                      min={field.type === "number" ? "0" : undefined}
                      dir={field.type ? "ltr" : undefined}
                      value={field.value}
                      placeholder={field.hint}
                      onChange={e => field.set(e.target.value)}
                    />
                  </label>
                ))}
                {scheduledArrival && actualArrival && !validArrivals && (
                  <p className="text-sm text-red-600">
                    Actual arrival must be a valid time after the booked arrival
                    / يجب أن يكون الوصول الفعلي وقتاً صحيحاً بعد الوصول المحجوز
                  </p>
                )}
              </div>
            )}
            {decision !== "denied" && !gacaMode && !engineMode && (
              <div className="space-y-2">
                <Label htmlFor="approved-amount">
                  {t(
                    "compensation.admin.approvedAmount",
                    "Approved Amount (SAR)"
                  )}
                </Label>
                <Input
                  id="approved-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={approvedAmount}
                  onChange={e => setApprovedAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
            )}

            {decision !== "denied" && !gacaMode && !engineMode && (
              <div className="space-y-2">
                {[
                  {
                    label: "Policy acceptance reference / مرجع السياسة",
                    value: policyReference,
                    set: setPolicyReference,
                  },
                  {
                    label: "Currency conversion reference / مرجع التحويل",
                    value: fxReference,
                    set: setFxReference,
                  },
                  {
                    label: "Distance source / مصدر المسافة",
                    value: distanceReference,
                    set: setDistanceReference,
                  },
                  {
                    label: "Distance in km / المسافة كم",
                    value: distanceKm,
                    set: setDistanceKm,
                  },
                ].map(field => (
                  <label className="block" key={field.label}>
                    {field.label}
                    <Input
                      value={field.value}
                      onChange={e => field.set(e.target.value)}
                    />
                  </label>
                ))}
                <p>
                  Approval records entitlement; payout requires a separate
                  settlement receipt.
                </p>
              </div>
            )}
            {decision === "denied" && (
              <div className="space-y-2">
                <Label htmlFor="denial-reason">
                  {t("compensation.admin.denialReason", "Reason for Denial")}
                </Label>
                <Textarea
                  id="denial-reason"
                  value={denialReason}
                  onChange={e => setDenialReason(e.target.value)}
                  placeholder={t(
                    "compensation.admin.denialReasonPlaceholder",
                    "Explain why this claim is being denied..."
                  )}
                  rows={3}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setProcessDialogOpen(false);
                resetProcessForm();
              }}
            >
              {t("common.cancel", "Cancel")}
            </Button>
            <Button
              onClick={handleProcess}
              disabled={
                processClaimMutation.isPending ||
                (decision === "denied" && !denialReason.trim()) ||
                (gacaMode &&
                  (!validFx ||
                    !validArrivals ||
                    !arrivalSource.trim() ||
                    !policyReference.trim() ||
                    !fxReference.trim())) ||
                (engineMode &&
                  (!ruleCode ||
                    policyReference.trim().length < 5 ||
                    factsReference.trim().length < 5)) ||
                (decision !== "denied" &&
                  !gacaMode &&
                  !engineMode &&
                  (!approvedAmount ||
                    !policyReference ||
                    !fxReference ||
                    !distanceReference ||
                    !distanceKm))
              }
            >
              {processClaimMutation.isPending ? (
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
              ) : null}
              {t("compensation.admin.confirm", "Confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stored evaluation trace */}
      <Dialog
        open={traceClaimId !== null}
        onOpenChange={open => !open && setTraceClaimId(null)}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {t("compensation.rights.storedTrace", "Review evidence")} #
              {traceClaimId}
            </DialogTitle>
            <DialogDescription>
              {t(
                "compensation.rights.storedTraceDescription",
                "Evaluation stored with the decision: rules considered, inputs, amounts and the FX record."
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto space-y-2">
            {storedTrace.data?.reviewEvidence &&
            isEvaluation(storedTrace.data.reviewEvidence.evaluation) ? (
              <PassengerRightsEvaluation
                evaluation={storedTrace.data.reviewEvidence.evaluation}
                showTrace
              />
            ) : (
              <pre className="text-xs whitespace-pre-wrap">
                {JSON.stringify(storedTrace.data?.reviewEvidence, null, 2)}
              </pre>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function isEvaluation(value: unknown): value is EvaluationView {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as EvaluationView).jurisdictions) &&
    Array.isArray((value as EvaluationView).entitlements)
  );
}

// ============================================================================
// Rule catalogue (passenger-rights rule sets with provenance)
// ============================================================================

function RuleCatalogue() {
  const { t } = useTranslation();
  const l = useOperationalLabels();
  const catalog = trpc.compensation.getRuleCatalog.useQuery();
  const [reference, setReference] = useState("");
  const sync = trpc.compensation.syncRuleCatalog.useMutation({
    onSuccess: r => {
      toast.success(`${r.inserted} inserted, ${r.updated} updated`);
      void catalog.refetch();
    },
    onError: e => toast.error(e.message),
  });
  const confirm = trpc.compensation.confirmRule.useMutation({
    onSuccess: () => void catalog.refetch(),
    onError: e => toast.error(e.message),
  });
  if (catalog.isLoading) return <Skeleton className="h-96 w-full" />;
  if (!catalog.data) return null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <p className="text-sm text-muted-foreground">
          {t("compensation.rights.catalogSource", "Catalogue source")}:{" "}
          {catalog.data.source}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => sync.mutate()}
          disabled={sync.isPending}
        >
          {t("compensation.rights.syncSeed", "Sync seeded rule sets")}
        </Button>
        <label className="block text-sm">
          {t(
            "compensation.rights.confirmationReference",
            "Confirmation reference (governing text check)"
          )}
          <Input
            value={reference}
            onChange={e => setReference(e.target.value)}
            className="w-80"
          />
        </label>
      </div>
      {catalog.data.ruleSets.map(set => (
        <Card key={set.jurisdiction} className="shadow-sm rounded-xl">
          <CardHeader>
            <CardTitle className="text-base">
              {set.jurisdiction} · {set.version} ·{" "}
              <Badge variant="outline">{set.confirmationStatus}</Badge>
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {set.notes}{" "}
              <a className="underline" href={set.sourceUrl} rel="noreferrer">
                {t("compensation.rights.source", "source")}
              </a>{" "}
              · {t("compensation.rights.effectiveFrom", "effective from")}{" "}
              {set.effectiveFrom ?? l("غير محدد", "TBD")}
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("compensation.rights.rule", "Rule")}</TableHead>
                  <TableHead>
                    {t("compensation.admin.amount", "Amount")}
                  </TableHead>
                  <TableHead>
                    {t("compensation.rights.status", "Status")}
                  </TableHead>
                  <TableHead>
                    {t("compensation.admin.actions", "Actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {set.rules.map(rule => (
                  <TableRow key={rule.code}>
                    <TableCell className="text-sm">
                      <span className="font-mono text-xs">{rule.code}</span>
                      <br />
                      {rule.title}
                      {rule.note && (
                        <p className="text-xs text-muted-foreground">
                          {rule.note}
                        </p>
                      )}
                      <p className="text-xs">
                        {rule.sources.map((s, i) => (
                          <span key={s.url}>
                            {i > 0 && ", "}
                            <a
                              className="underline"
                              href={s.url}
                              rel="noreferrer"
                            >
                              {s.title}
                            </a>{" "}
                            [{s.kind}]
                          </span>
                        ))}
                      </p>
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {JSON.stringify(rule.amount)}
                    </TableCell>
                    <TableCell className="text-sm">
                      <Badge
                        variant={
                          rule.confirmationStatus === "disputed"
                            ? "destructive"
                            : rule.confirmationStatus === "official"
                              ? "default"
                              : "outline"
                        }
                      >
                        {rule.confirmationStatus}
                      </Badge>
                      {rule.disputeGroup && (
                        <p className="text-xs">
                          {t("compensation.rights.candidate", "candidate")}{" "}
                          {rule.candidate} · {rule.disputeGroup}
                        </p>
                      )}
                      {rule.confirmation && (
                        <p className="text-xs">
                          {rule.confirmation.decision} ·{" "}
                          {rule.confirmation.reference}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      {rule.requiresConfirmation &&
                        catalog.data?.source === "database" && (
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                reference.trim().length < 5 || confirm.isPending
                              }
                              onClick={() =>
                                confirm.mutate({
                                  ruleCode: rule.code,
                                  decision: "confirmed",
                                  reference,
                                })
                              }
                            >
                              {t("compensation.rights.confirm", "Confirm")}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={
                                reference.trim().length < 5 || confirm.isPending
                              }
                              onClick={() =>
                                confirm.mutate({
                                  ruleCode: rule.code,
                                  decision: "rejected",
                                  reference,
                                })
                              }
                            >
                              {t("compensation.rights.reject", "Reject")}
                            </Button>
                          </div>
                        )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================================================================
// US DOT refund deadlines
// ============================================================================

function RefundDeadlines() {
  const { t } = useTranslation();
  const [overdueOnly, setOverdueOnly] = useState(true);
  const [bookingId, setBookingId] = useState("");
  const [trigger, setTrigger] = useState<
    "carrier_cancellation" | "significant_change"
  >("carrier_cancellation");
  const [tenderClass, setTenderClass] = useState<"card" | "other">("card");
  const [triggeredAt, setTriggeredAt] = useState("");
  const list = trpc.compensation.listRefundDeadlines.useQuery({ overdueOnly });
  const open = trpc.compensation.openRefundDeadline.useMutation({
    onSuccess: r => {
      toast.success(`${r.ruleCode} · ${new Date(r.dueAt).toISOString()}`);
      void list.refetch();
    },
    onError: e => toast.error(e.message),
  });
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t(
          "compensation.rights.refundRule",
          "14 CFR 260: 7 business days (card) or 20 calendar days (other) from the involuntary trigger. Weekends excluded; US federal holidays are not modelled."
        )}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Input
          className="w-32"
          placeholder={t("compensation.admin.booking", "Booking")}
          value={bookingId}
          onChange={e => setBookingId(e.target.value)}
        />
        <select
          className="border p-2"
          value={trigger}
          onChange={e => setTrigger(e.target.value as typeof trigger)}
        >
          <option value="carrier_cancellation">carrier_cancellation</option>
          <option value="significant_change">significant_change</option>
        </select>
        <select
          className="border p-2"
          value={tenderClass}
          onChange={e => setTenderClass(e.target.value as typeof tenderClass)}
        >
          <option value="card">card</option>
          <option value="other">other</option>
        </select>
        <Input
          type="datetime-local"
          dir="ltr"
          value={triggeredAt}
          onChange={e => setTriggeredAt(e.target.value)}
        />
        <Button
          size="sm"
          disabled={!bookingId || !triggeredAt || open.isPending}
          onClick={() =>
            open.mutate({
              bookingId: Number(bookingId),
              trigger,
              tenderClass,
              triggeredAt: new Date(`${triggeredAt}:00Z`).toISOString(),
            })
          }
        >
          {t("compensation.rights.openDeadline", "Record refund due")}
        </Button>
        <label className="text-sm">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={e => setOverdueOnly(e.target.checked)}
          />{" "}
          {t("compensation.rights.overdueOnly", "Overdue only")}
        </label>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("compensation.admin.booking", "Booking")}</TableHead>
            <TableHead>{t("compensation.rights.trigger", "Trigger")}</TableHead>
            <TableHead>{t("compensation.rights.dueAt", "Due")}</TableHead>
            <TableHead>{t("compensation.rights.status", "Status")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.data?.map(row => (
            <TableRow key={row.id}>
              <TableCell>B-{row.bookingId}</TableCell>
              <TableCell className="text-sm">
                {row.trigger} · {row.tenderClass} ·{" "}
                {new Date(row.triggeredAt).toISOString()}
              </TableCell>
              <TableCell className="text-sm">
                {new Date(row.dueAt).toISOString()}
                <p className="text-xs text-muted-foreground">{row.basis}</p>
              </TableCell>
              <TableCell>
                {row.completedAt ? (
                  <Badge variant={row.metOnTime ? "default" : "destructive"}>
                    {row.metOnTime
                      ? t("compensation.rights.metOnTime", "Refunded on time")
                      : t("compensation.rights.late", "Refunded late")}
                  </Badge>
                ) : row.overdue ? (
                  <Badge variant="destructive">
                    {t("compensation.rights.overdue", "Overdue")}
                  </Badge>
                ) : (
                  <Badge variant="outline">
                    {t("compensation.rights.open", "Open")}
                  </Badge>
                )}
              </TableCell>
            </TableRow>
          ))}
          {list.data?.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={4}
                className="text-center text-muted-foreground"
              >
                {t("compensation.rights.noDeadlines", "No refund deadlines")}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

// ============================================================================
// Flight Liability Tab
// ============================================================================

function FlightLiability() {
  const { t } = useTranslation();
  const [flightId, setFlightId] = useState("");

  const {
    data: liability,
    isLoading,
    refetch,
  } = trpc.compensation.getFlightLiability.useQuery(
    { flightId: parseInt(flightId) },
    { enabled: !!flightId && !isNaN(parseInt(flightId)) }
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="w-64">
          <Input
            type="number"
            value={flightId}
            onChange={e => setFlightId(e.target.value)}
            placeholder={t(
              "compensation.admin.enterFlightId",
              "Enter Flight ID"
            )}
          />
        </div>
        <Button
          variant="outline"
          onClick={() => refetch()}
          disabled={!flightId || isLoading}
        >
          {isLoading ? (
            <Loader2 className="me-2 h-4 w-4 animate-spin" />
          ) : (
            <Plane className="me-2 h-4 w-4" />
          )}
          {t("compensation.admin.checkLiability", "Check Liability")}
        </Button>
      </div>

      {liability && (
        <Card className="shadow-sm rounded-xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Plane className="h-5 w-5" />
              {t("compensation.admin.flight", "Flight")}{" "}
              {liability.flightNumber}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border p-3">
                <p className="text-sm text-muted-foreground">
                  {t("compensation.admin.totalClaims", "Total Claims")}
                </p>
                <p className="text-2xl font-bold">{liability.totalClaims}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-sm text-muted-foreground">
                  {t("compensation.admin.calculatedLiability", "Calculated")}
                </p>
                <p className="text-2xl font-bold">
                  {liability.unassessedClaims > 0
                    ? "—"
                    : formatSAR(liability.totalCalculated)}{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    SAR
                  </span>
                </p>
              </div>
              <div className="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950">
                <p className="text-sm text-green-700 dark:text-green-300">
                  {t("compensation.admin.approved", "Approved")}
                </p>
                <p className="text-2xl font-bold text-green-800 dark:text-green-200">
                  {formatSAR(liability.totalApproved)}{" "}
                  <span className="text-sm font-normal">SAR</span>
                </p>
              </div>
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950">
                <p className="text-sm text-blue-700 dark:text-blue-300">
                  {t("compensation.admin.paidOut", "Paid Out")}
                </p>
                <p className="text-2xl font-bold text-blue-800 dark:text-blue-200">
                  {formatSAR(liability.totalPaid)}{" "}
                  <span className="text-sm font-normal">SAR</span>
                </p>
              </div>
            </div>

            {/* Status breakdown */}
            {Object.keys(liability.statusBreakdown).length > 0 && (
              <div className="mt-4">
                <p className="mb-2 text-sm font-medium text-muted-foreground">
                  {t("compensation.admin.statusBreakdown", "Status Breakdown")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(liability.statusBreakdown).map(
                    ([status, count]) => (
                      <Badge key={status} variant="outline" className="gap-1">
                        {status}: {count}
                      </Badge>
                    )
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Rules Configuration Tab
// ============================================================================

function RulesConfiguration() {
  const { t } = useTranslation();
  const [editingRule, setEditingRule] = useState<number | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editMinDelay, setEditMinDelay] = useState("");
  const [editMaxDelay, setEditMaxDelay] = useState("");

  const {
    data: rules,
    isLoading,
    refetch,
  } = trpc.compensation.getRules.useQuery();

  const updateRuleMutation = trpc.compensation.updateRule.useMutation({
    onSuccess: () => {
      toast.success(
        t("compensation.admin.ruleUpdated", "Rule updated successfully")
      );
      setEditingRule(null);
      refetch();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const handleSaveRule = (ruleId: number) => {
    const updates: Record<string, unknown> = { id: ruleId };
    if (editAmount)
      updates.compensationAmount = Math.round(parseFloat(editAmount) * 100);
    if (editMinDelay) updates.minDelay = parseInt(editMinDelay);
    if (editMaxDelay) updates.maxDelay = parseInt(editMaxDelay);

    updateRuleMutation.mutate(
      updates as {
        id: number;
        compensationAmount?: number;
        minDelay?: number;
        maxDelay?: number;
      }
    );
  };

  const handleToggleRule = (ruleId: number, currentActive: boolean) => {
    updateRuleMutation.mutate({
      id: ruleId,
      isActive: !currentActive,
    });
  };

  if (isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }

  if (!rules || rules.length === 0) {
    return (
      <Card className="shadow-sm rounded-xl">
        <CardContent className="py-12 text-center">
          <Settings className="mx-auto h-12 w-12 text-muted-foreground" />
          <p className="mt-4 text-muted-foreground">
            {t(
              "compensation.admin.noRules",
              "No compensation rules configured. Rules will be created when the compensation_rules table is seeded."
            )}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              {t("compensation.admin.regulation", "Regulation")}
            </TableHead>
            <TableHead>
              {t("compensation.admin.claimType", "Claim Type")}
            </TableHead>
            <TableHead>
              {t("compensation.admin.delayRange", "Delay (min)")}
            </TableHead>
            <TableHead>
              {t("compensation.admin.distanceRange", "Distance (km)")}
            </TableHead>
            <TableHead>{t("compensation.admin.amount", "Amount")}</TableHead>
            <TableHead>{t("compensation.admin.active", "Active")}</TableHead>
            <TableHead className="w-32">
              {t("compensation.admin.actions", "Actions")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rules.map(rule => (
            <TableRow key={rule.id}>
              <TableCell>
                <RegBadge type={rule.regulationType} />
              </TableCell>
              <TableCell className="capitalize text-sm">
                {rule.claimType.replace("_", " ")}
              </TableCell>
              <TableCell className="text-sm">
                {editingRule === rule.id ? (
                  <div className="flex gap-1">
                    <Input
                      type="number"
                      className="h-8 w-20"
                      value={editMinDelay}
                      onChange={e => setEditMinDelay(e.target.value)}
                      placeholder={String(rule.minDelay ?? 0)}
                    />
                    <span className="self-center">-</span>
                    <Input
                      type="number"
                      className="h-8 w-20"
                      value={editMaxDelay}
                      onChange={e => setEditMaxDelay(e.target.value)}
                      placeholder={String(rule.maxDelay ?? "---")}
                    />
                  </div>
                ) : (
                  <>
                    {rule.minDelay ?? 0} - {rule.maxDelay ?? "---"}
                  </>
                )}
              </TableCell>
              <TableCell className="text-sm">
                {rule.distanceMin ?? 0} - {rule.distanceMax ?? "---"}
              </TableCell>
              <TableCell>
                {editingRule === rule.id ? (
                  <Input
                    type="number"
                    className="h-8 w-28"
                    step="0.01"
                    value={editAmount}
                    onChange={e => setEditAmount(e.target.value)}
                    placeholder={formatSAR(rule.compensationAmount)}
                  />
                ) : (
                  <span className="font-medium">
                    {(rule.compensationAmount / 100).toFixed(2)} {rule.currency}
                  </span>
                )}
              </TableCell>
              <TableCell>
                <Switch
                  checked={rule.isActive}
                  onCheckedChange={() =>
                    handleToggleRule(rule.id, rule.isActive)
                  }
                />
              </TableCell>
              <TableCell>
                {editingRule === rule.id ? (
                  <div className="flex gap-1">
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => handleSaveRule(rule.id)}
                      disabled={updateRuleMutation.isPending}
                    >
                      {updateRuleMutation.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        t("common.save", "Save")
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingRule(null)}
                    >
                      {t("common.cancel", "Cancel")}
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditingRule(rule.id);
                      setEditAmount("");
                      setEditMinDelay("");
                      setEditMaxDelay("");
                    }}
                  >
                    {t("common.edit", "Edit")}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ============================================================================
// Main Page Component
// ============================================================================

export function CompensationManagement() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState("claims");

  if (authLoading) {
    return (
      <div className="container mx-auto max-w-7xl space-y-6 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!user || (user.role !== "admin" && user.role !== "super_admin")) {
    return <Redirect to="/" />;
  }

  return (
    <div className="container mx-auto max-w-7xl space-y-6 p-6">
      <SEO
        title={t("compensation.admin.pageTitle", "Compensation Management")}
        description={t(
          "compensation.admin.pageDescription",
          "Manage EU261/DOT compensation claims for flight disruptions"
        )}
      />

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          <Scale className="me-2 inline h-6 w-6" />
          {t("compensation.admin.pageTitle", "Compensation Management")}
        </h1>
        <p className="text-muted-foreground">
          {t(
            "compensation.admin.pageSubtitle",
            "GACA 2023, EU261, UK261 and US DOT passenger-rights claims with auditable evaluation"
          )}
        </p>
      </div>

      {/* Statistics */}
      <StatsCards />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="claims" className="gap-2">
            <FileText className="h-4 w-4" />
            {t("compensation.admin.claimsQueue", "Claims Queue")}
          </TabsTrigger>
          <TabsTrigger value="liability" className="gap-2">
            <Plane className="h-4 w-4" />
            {t("compensation.admin.flightLiability", "Flight Liability")}
          </TabsTrigger>
          <TabsTrigger value="rules" className="gap-2">
            <Settings className="h-4 w-4" />
            {t("compensation.admin.rules", "Rules")}
          </TabsTrigger>
          <TabsTrigger value="catalogue" className="gap-2">
            <Scale className="h-4 w-4" />
            {t("compensation.rights.catalogue", "Rule catalogue")}
          </TabsTrigger>
          <TabsTrigger value="refunds" className="gap-2">
            <ShieldCheck className="h-4 w-4" />
            {t("compensation.rights.refundDeadlines", "Refund deadlines")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="claims" className="mt-4">
          <ClaimsQueue />
        </TabsContent>

        <TabsContent value="liability" className="mt-4">
          <FlightLiability />
        </TabsContent>

        <TabsContent value="rules" className="mt-4">
          <RulesConfiguration />
        </TabsContent>

        <TabsContent value="catalogue" className="mt-4">
          <RuleCatalogue />
        </TabsContent>

        <TabsContent value="refunds" className="mt-4">
          <RefundDeadlines />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default CompensationManagement;
