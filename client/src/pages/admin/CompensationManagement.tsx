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
  Clock,
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

type RegulationType = "eu261" | "dot" | "local";

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
      label: t("compensation.status.pending", "Pending"),
    },
    under_review: {
      variant: "outline",
      label: t("compensation.status.underReview", "Under Review"),
    },
    approved: {
      variant: "default",
      label: t("compensation.status.approved", "Approved"),
    },
    denied: {
      variant: "destructive",
      label: t("compensation.status.denied", "Denied"),
    },
    paid: {
      variant: "default",
      label: t("compensation.status.paid", "Paid"),
    },
    appealed: {
      variant: "outline",
      label: t("compensation.status.appealed", "Appealed"),
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
  };

  const labels: Record<RegulationType, string> = {
    eu261: "EU261",
    dot: "US DOT",
    local: "Local",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colors[type]}`}
    >
      {labels[type]}
    </span>
  );
}

function formatSAR(cents: number): string {
  return (cents / 100).toFixed(2);
}

// ============================================================================
// Statistics Cards
// ============================================================================

function StatsCards() {
  const { t } = useTranslation();

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
      title: t("compensation.admin.totalLiability", "Total Liability"),
      value: `${formatSAR(stats.totalCalculated)} SAR`,
      icon: <DollarSign className="h-5 w-5 text-muted-foreground" />,
      detail: `${formatSAR(stats.totalApproved)} SAR ${t("compensation.admin.approved", "approved")}`,
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
        <Card key={i}>
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
  const [denialReason, setDenialReason] = useState("");

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
        decision === "partial" && approvedAmount
          ? Math.round(parseFloat(approvedAmount) * 100)
          : undefined,
      denialReason: decision === "denied" ? denialReason : undefined,
    });
  };

  const openProcessDialog = (claimId: number) => {
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
                {t("compensation.status.pending", "Pending")}
              </SelectItem>
              <SelectItem value="under_review">
                {t("compensation.status.underReview", "Under Review")}
              </SelectItem>
              <SelectItem value="approved">
                {t("compensation.status.approved", "Approved")}
              </SelectItem>
              <SelectItem value="denied">
                {t("compensation.status.denied", "Denied")}
              </SelectItem>
              <SelectItem value="paid">
                {t("compensation.status.paid", "Paid")}
              </SelectItem>
              <SelectItem value="appealed">
                {t("compensation.status.appealed", "Appealed")}
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

            {decision === "partial" && (
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
                (decision === "partial" && !approvedAmount)
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
        <Card>
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
                  {formatSAR(liability.totalCalculated)}{" "}
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
      <Card>
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
            "EU261, US DOT, and local compensation claims tracking"
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
      </Tabs>
    </div>
  );
}

export default CompensationManagement;
