import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Plane,
  Scale,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";

// ============================================================================
// Types
// ============================================================================

type DisruptionType =
  | "delay"
  | "cancellation"
  | "denied_boarding"
  | "downgrade";
type RegulationType = "eu261" | "dot" | "local";
type ClaimStatus =
  | "pending"
  | "under_review"
  | "approved"
  | "denied"
  | "paid"
  | "appealed";

interface CompensationClaimProps {
  bookingId: number;
  bookingReference?: string;
  className?: string;
}

// ============================================================================
// Status Badge Component
// ============================================================================

function ClaimStatusBadge({ status }: { status: ClaimStatus }) {
  const { t } = useTranslation();

  const config: Record<
    ClaimStatus,
    {
      variant: "default" | "secondary" | "destructive" | "outline";
      icon: React.ReactNode;
      label: string;
    }
  > = {
    pending: {
      variant: "secondary",
      icon: <Clock className="h-3 w-3" />,
      label: t("compensation.status.pending", "Pending"),
    },
    under_review: {
      variant: "outline",
      icon: <FileText className="h-3 w-3" />,
      label: t("compensation.status.underReview", "Under Review"),
    },
    approved: {
      variant: "default",
      icon: <CheckCircle2 className="h-3 w-3" />,
      label: t("compensation.status.approved", "Approved"),
    },
    denied: {
      variant: "destructive",
      icon: <XCircle className="h-3 w-3" />,
      label: t("compensation.status.denied", "Denied"),
    },
    paid: {
      variant: "default",
      icon: <ShieldCheck className="h-3 w-3" />,
      label: t("compensation.status.paid", "Paid"),
    },
    appealed: {
      variant: "outline",
      icon: <Scale className="h-3 w-3" />,
      label: t("compensation.status.appealed", "Appealed"),
    },
  };

  const c = config[status];

  return (
    <Badge variant={c.variant} className="gap-1">
      {c.icon}
      {c.label}
    </Badge>
  );
}

// ============================================================================
// Regulation Type Badge
// ============================================================================

function RegulationBadge({ type }: { type: RegulationType }) {
  const labels: Record<RegulationType, string> = {
    eu261: "EU261",
    dot: "US DOT",
    local: "Local",
  };

  return (
    <Badge variant="outline" className="font-mono text-xs">
      {labels[type]}
    </Badge>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function CompensationClaim({
  bookingId,
  bookingReference,
  className,
}: CompensationClaimProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "ar" ? ar : enUS;

  // Form state
  const [disruptionType, setDisruptionType] = useState<DisruptionType | "">("");
  const [reason, setReason] = useState("");
  const [showForm, setShowForm] = useState(false);

  // Existing claims for this booking
  const {
    data: existingClaims,
    isLoading: claimsLoading,
    refetch: refetchClaims,
  } = trpc.compensation.getMyClaims.useQuery(undefined, {
    select: data => data.filter(c => c.bookingId === bookingId),
  });

  // Eligibility check
  const {
    data: eligibility,
    isLoading: eligibilityLoading,
    refetch: _refetchEligibility,
  } = trpc.compensation.checkEligibility.useQuery(
    {
      bookingId,
      disruptionType: disruptionType as DisruptionType,
    },
    {
      enabled: !!disruptionType,
    }
  );

  // File claim mutation
  const fileClaimMutation = trpc.compensation.fileClaim.useMutation({
    onSuccess: () => {
      toast.success(
        t("compensation.claimFiled", "Compensation claim filed successfully")
      );
      setShowForm(false);
      setDisruptionType("");
      setReason("");
      refetchClaims();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const handleDisruptionTypeChange = (value: string) => {
    setDisruptionType(value as DisruptionType);
  };

  const handleSubmitClaim = () => {
    if (!disruptionType || !eligibility) return;

    fileClaimMutation.mutate({
      bookingId,
      regulationType: eligibility.regulationType,
      claimType: disruptionType as DisruptionType,
      reason: reason || undefined,
    });
  };

  // ============================================================================
  // Render: Existing Claims List
  // ============================================================================

  const renderExistingClaims = () => {
    if (claimsLoading) {
      return (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      );
    }

    if (!existingClaims || existingClaims.length === 0) {
      return null;
    }

    return (
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-muted-foreground">
          {t("compensation.existingClaims", "Your Claims")}
        </h4>
        {existingClaims.map(claim => (
          <Card key={claim.id} className="border-muted">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <RegulationBadge type={claim.regulationType} />
                    <ClaimStatusBadge status={claim.status} />
                  </div>
                  <p className="text-sm capitalize text-muted-foreground">
                    {t(
                      `compensation.claimType.${claim.claimType}`,
                      claim.claimType.replace("_", " ")
                    )}
                  </p>
                  {claim.filedAt && (
                    <p className="text-xs text-muted-foreground">
                      {t("compensation.filedOn", "Filed")}{" "}
                      {format(new Date(claim.filedAt), "PPp", { locale })}
                    </p>
                  )}
                  {claim.denialReason && (
                    <p className="text-xs text-destructive">
                      {t("compensation.denialReason", "Reason")}:{" "}
                      {claim.denialReason}
                    </p>
                  )}
                </div>
                <div className="text-end">
                  <p className="text-lg font-semibold">
                    {(claim.calculatedAmount / 100).toFixed(2)}{" "}
                    <span className="text-xs text-muted-foreground">
                      {t("common.sar", "SAR")}
                    </span>
                  </p>
                  {claim.approvedAmount !== null &&
                    claim.approvedAmount !== claim.calculatedAmount && (
                      <p className="text-sm text-green-600">
                        {t("compensation.approved", "Approved")}:{" "}
                        {(claim.approvedAmount / 100).toFixed(2)}{" "}
                        {t("common.sar", "SAR")}
                      </p>
                    )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  };

  // ============================================================================
  // Render: Eligibility Result
  // ============================================================================

  const renderEligibility = () => {
    if (!disruptionType) return null;

    if (eligibilityLoading) {
      return (
        <div className="flex items-center gap-2 rounded-lg border p-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">
            {t("compensation.checkingEligibility", "Checking eligibility...")}
          </span>
        </div>
      );
    }

    if (!eligibility) return null;

    if (!eligibility.eligible) {
      return (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              {t("compensation.notEligible", "Not eligible for compensation")}
            </p>
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
              {eligibility.reason}
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
        <div className="flex-1 space-y-2">
          <p className="text-sm font-medium text-green-800 dark:text-green-200">
            {t("compensation.eligible", "Eligible for compensation")}
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs text-green-700 dark:text-green-300">
            <div>
              <span className="font-medium">
                {t("compensation.regulation", "Regulation")}:
              </span>{" "}
              {eligibility.regulationType === "eu261"
                ? "EU261"
                : eligibility.regulationType === "dot"
                  ? "US DOT"
                  : t("compensation.localRegulation", "Local")}
            </div>
            <div>
              <span className="font-medium">
                {t("compensation.distance", "Distance")}:
              </span>{" "}
              {eligibility.flightDistance.toLocaleString()} km
            </div>
            {eligibility.delayMinutes > 0 && (
              <div>
                <span className="font-medium">
                  {t("compensation.delay", "Delay")}:
                </span>{" "}
                {Math.floor(eligibility.delayMinutes / 60)}h{" "}
                {eligibility.delayMinutes % 60}m
              </div>
            )}
          </div>
          <div className="mt-2 rounded bg-green-100 p-2 dark:bg-green-900">
            <p className="text-sm font-semibold text-green-900 dark:text-green-100">
              {t("compensation.estimatedAmount", "Estimated compensation")}:{" "}
              {(eligibility.estimatedAmount / 100).toFixed(2)}{" "}
              {t("common.sar", "SAR")}
            </p>
          </div>
          <p className="text-xs italic text-green-600 dark:text-green-400">
            {eligibility.reason}
          </p>
        </div>
      </div>
    );
  };

  // ============================================================================
  // Render: Claim Form
  // ============================================================================

  const renderClaimForm = () => {
    if (!showForm) {
      return (
        <Button
          variant="outline"
          onClick={() => setShowForm(true)}
          className="w-full gap-2"
        >
          <Scale className="h-4 w-4" />
          {t("compensation.fileNewClaim", "File Compensation Claim")}
        </Button>
      );
    }

    return (
      <div className="space-y-4 rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <h4 className="font-medium">
            {t("compensation.newClaim", "New Compensation Claim")}
          </h4>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setShowForm(false);
              setDisruptionType("");
              setReason("");
            }}
          >
            {t("common.cancel", "Cancel")}
          </Button>
        </div>

        {/* Disruption type selector */}
        <div className="space-y-2">
          <Label>
            {t("compensation.disruptionType", "Type of Disruption")}
          </Label>
          <Select
            value={disruptionType}
            onValueChange={handleDisruptionTypeChange}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={t(
                  "compensation.selectType",
                  "Select disruption type"
                )}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="delay">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  {t("compensation.claimType.delay", "Flight Delay")}
                </div>
              </SelectItem>
              <SelectItem value="cancellation">
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4" />
                  {t(
                    "compensation.claimType.cancellation",
                    "Flight Cancellation"
                  )}
                </div>
              </SelectItem>
              <SelectItem value="denied_boarding">
                <div className="flex items-center gap-2">
                  <Plane className="h-4 w-4" />
                  {t(
                    "compensation.claimType.denied_boarding",
                    "Denied Boarding"
                  )}
                </div>
              </SelectItem>
              <SelectItem value="downgrade">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  {t("compensation.claimType.downgrade", "Cabin Downgrade")}
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Eligibility check result */}
        {renderEligibility()}

        {/* Reason / additional details */}
        {disruptionType && eligibility?.eligible && (
          <div className="space-y-2">
            <Label htmlFor="claim-reason">
              {t(
                "compensation.additionalDetails",
                "Additional Details (optional)"
              )}
            </Label>
            <Textarea
              id="claim-reason"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder={t(
                "compensation.reasonPlaceholder",
                "Describe any additional circumstances..."
              )}
              rows={3}
              maxLength={1000}
            />
          </div>
        )}

        {/* Submit button */}
        {disruptionType && eligibility?.eligible && (
          <Button
            onClick={handleSubmitClaim}
            disabled={fileClaimMutation.isPending}
            className="w-full gap-2"
          >
            {fileClaimMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("compensation.filing", "Filing claim...")}
              </>
            ) : (
              <>
                <FileText className="h-4 w-4" />
                {t("compensation.submitClaim", "Submit Claim")} -{" "}
                {(eligibility.estimatedAmount / 100).toFixed(2)}{" "}
                {t("common.sar", "SAR")}
              </>
            )}
          </Button>
        )}
      </div>
    );
  };

  // ============================================================================
  // Main Render
  // ============================================================================

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Scale className="h-5 w-5" />
          {t("compensation.title", "Compensation")}
          {bookingReference && (
            <Badge variant="outline" className="ms-auto font-mono">
              {bookingReference}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Existing claims */}
        {renderExistingClaims()}

        {/* File new claim */}
        {renderClaimForm()}
      </CardContent>
    </Card>
  );
}
