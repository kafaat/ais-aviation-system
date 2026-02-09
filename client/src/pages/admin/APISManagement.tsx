import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import { useAuth } from "@/_core/hooks/useAuth";
import { Redirect } from "wouter";
import {
  FileCheck,
  Shield,
  Globe,
  Send,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  Search,
} from "lucide-react";

// ============================================================================
// Types
// ============================================================================

type APISSubmissionStatus =
  | "pending"
  | "submitted"
  | "acknowledged"
  | "rejected"
  | "error";

type APISDataStatus =
  | "incomplete"
  | "complete"
  | "validated"
  | "submitted"
  | "rejected";

interface PassengerStatus {
  passengerId: number;
  name: string;
  bookingReference: string;
  pnr: string;
  apisStatus: APISDataStatus;
  validatedAt: string | null;
  submittedAt: string | null;
}

// ============================================================================
// Helper Components
// ============================================================================

function SubmissionStatusBadge({ status }: { status: APISSubmissionStatus }) {
  const { t } = useTranslation();

  const config: Record<
    APISSubmissionStatus,
    {
      variant: "default" | "secondary" | "destructive" | "outline";
      label: string;
    }
  > = {
    pending: {
      variant: "secondary",
      label: t("apis.status.pending", "Pending"),
    },
    submitted: {
      variant: "default",
      label: t("apis.status.submitted", "Submitted"),
    },
    acknowledged: {
      variant: "default",
      label: t("apis.status.acknowledged", "Acknowledged"),
    },
    rejected: {
      variant: "destructive",
      label: t("apis.status.rejected", "Rejected"),
    },
    error: {
      variant: "destructive",
      label: t("apis.status.error", "Error"),
    },
  };

  const c = config[status] ?? config.pending;

  return <Badge variant={c.variant}>{c.label}</Badge>;
}

function DataStatusBadge({ status }: { status: APISDataStatus }) {
  const { t } = useTranslation();

  const config: Record<
    APISDataStatus,
    {
      variant: "default" | "secondary" | "destructive" | "outline";
      label: string;
      icon: React.ReactNode;
    }
  > = {
    incomplete: {
      variant: "secondary",
      label: t("apis.dataStatus.incomplete", "Incomplete"),
      icon: <AlertTriangle className="me-1 h-3 w-3" />,
    },
    complete: {
      variant: "outline",
      label: t("apis.dataStatus.complete", "Complete"),
      icon: <Clock className="me-1 h-3 w-3" />,
    },
    validated: {
      variant: "default",
      label: t("apis.dataStatus.validated", "Validated"),
      icon: <CheckCircle2 className="me-1 h-3 w-3" />,
    },
    submitted: {
      variant: "default",
      label: t("apis.dataStatus.submitted", "Submitted"),
      icon: <Send className="me-1 h-3 w-3" />,
    },
    rejected: {
      variant: "destructive",
      label: t("apis.dataStatus.rejected", "Rejected"),
      icon: <AlertTriangle className="me-1 h-3 w-3" />,
    },
  };

  const c = config[status] ?? config.incomplete;

  return (
    <Badge variant={c.variant} className="gap-0.5">
      {c.icon}
      {c.label}
    </Badge>
  );
}

// ============================================================================
// Statistics Cards
// ============================================================================

function StatsCards({
  flightId,
  submissions,
}: {
  flightId: string;
  submissions: Array<{ status: APISSubmissionStatus }> | undefined;
}) {
  const { t } = useTranslation();

  const { data: flightStatus, isLoading } = trpc.apis.getFlightStatus.useQuery(
    { flightId: parseInt(flightId) },
    { enabled: !!flightId && !isNaN(parseInt(flightId)) }
  );

  if (isLoading && flightId) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    );
  }

  const totalSubmissions = submissions?.length ?? 0;
  const pendingValidation = flightStatus
    ? flightStatus.summary.complete + flightStatus.summary.incomplete
    : 0;
  const submittedCount = submissions
    ? submissions.filter(
        s => s.status === "submitted" || s.status === "acknowledged"
      ).length
    : 0;
  const rejectedCount = submissions
    ? submissions.filter(s => s.status === "rejected" || s.status === "error")
        .length
    : 0;

  const cards = [
    {
      title: t("apis.stats.totalSubmissions", "Total Submissions"),
      value: totalSubmissions,
      icon: <FileCheck className="h-5 w-5 text-muted-foreground" />,
      detail: flightStatus
        ? `${flightStatus.totalPassengers} ${t("apis.stats.passengers", "passengers")}`
        : t("apis.stats.enterFlightId", "Enter a flight ID to view"),
    },
    {
      title: t("apis.stats.pendingValidation", "Pending Validation"),
      value: pendingValidation,
      icon: <Clock className="h-5 w-5 text-amber-500" />,
      detail: flightStatus
        ? `${flightStatus.summary.incomplete} ${t("apis.stats.incomplete", "incomplete")}`
        : "--",
    },
    {
      title: t("apis.stats.submitted", "Submitted"),
      value: submittedCount,
      icon: <Send className="h-5 w-5 text-green-500" />,
      detail: flightStatus?.readyForSubmission
        ? t("apis.stats.readyForSubmission", "Ready for submission")
        : t("apis.stats.notReady", "Not ready"),
    },
    {
      title: t("apis.stats.rejected", "Rejected"),
      value: rejectedCount,
      icon: <AlertTriangle className="h-5 w-5 text-red-500" />,
      detail: flightStatus
        ? `${flightStatus.summary.rejected} ${t("apis.stats.passengerRejections", "passenger rejections")}`
        : "--",
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
// Submissions Tab
// ============================================================================

function SubmissionsTab({ flightId }: { flightId: string }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "ar" ? ar : enUS;

  const {
    data: submissions,
    isLoading,
    refetch: refetchSubmissions,
  } = trpc.apis.getSubmissions.useQuery(
    { flightId: parseInt(flightId) },
    { enabled: !!flightId && !isNaN(parseInt(flightId)) }
  );

  const {
    data: flightStatus,
    isLoading: statusLoading,
    refetch: refetchStatus,
  } = trpc.apis.getFlightStatus.useQuery(
    { flightId: parseInt(flightId) },
    { enabled: !!flightId && !isNaN(parseInt(flightId)) }
  );

  const submitMutation = trpc.apis.submitToAuthorities.useMutation({
    onSuccess: data => {
      toast.success(
        t(
          "apis.submitSuccess",
          "APIS data submitted successfully for {{flight}}",
          {
            flight: data.flightNumber,
          }
        )
      );
      refetchSubmissions();
      refetchStatus();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const generateMutation = trpc.apis.generateMessage.useMutation({
    onSuccess: data => {
      toast.success(
        t(
          "apis.generateSuccess",
          "{{format}} message generated for {{count}} passengers",
          { format: data.format.toUpperCase(), count: data.passengerCount }
        )
      );
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  if (!flightId || isNaN(parseInt(flightId))) {
    return (
      <Card className="shadow-sm rounded-xl">
        <CardContent className="py-12 text-center">
          <Search className="mx-auto h-12 w-12 text-muted-foreground" />
          <p className="mt-4 text-muted-foreground">
            {t(
              "apis.enterFlightIdPrompt",
              "Enter a Flight ID above to view APIS submissions and passenger status."
            )}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading || statusLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Flight Summary */}
      {flightStatus && (
        <Card className="shadow-sm rounded-xl">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Shield className="h-5 w-5" />
              {t("apis.flightStatus", "Flight {{number}} - APIS Status", {
                number: flightStatus.flightNumber,
              })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-5">
              <div className="rounded-lg border p-3 text-center">
                <p className="text-xs text-muted-foreground">
                  {t("apis.dataStatus.incomplete", "Incomplete")}
                </p>
                <p className="text-xl font-bold text-amber-600">
                  {flightStatus.summary.incomplete}
                </p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-xs text-muted-foreground">
                  {t("apis.dataStatus.complete", "Complete")}
                </p>
                <p className="text-xl font-bold text-blue-600">
                  {flightStatus.summary.complete}
                </p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-xs text-muted-foreground">
                  {t("apis.dataStatus.validated", "Validated")}
                </p>
                <p className="text-xl font-bold text-green-600">
                  {flightStatus.summary.validated}
                </p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-xs text-muted-foreground">
                  {t("apis.dataStatus.submitted", "Submitted")}
                </p>
                <p className="text-xl font-bold text-emerald-600">
                  {flightStatus.summary.submitted}
                </p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-xs text-muted-foreground">
                  {t("apis.dataStatus.rejected", "Rejected")}
                </p>
                <p className="text-xl font-bold text-red-600">
                  {flightStatus.summary.rejected}
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="mt-4 flex flex-wrap gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  generateMutation.mutate({
                    flightId: parseInt(flightId),
                    format: "paxlst",
                  })
                }
                disabled={generateMutation.isPending}
              >
                {generateMutation.isPending ? (
                  <Loader2 className="me-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileCheck className="me-2 h-4 w-4" />
                )}
                {t("apis.generatePAXLST", "Generate PAXLST")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  generateMutation.mutate({
                    flightId: parseInt(flightId),
                    format: "pnrgov",
                  })
                }
                disabled={generateMutation.isPending}
              >
                {generateMutation.isPending ? (
                  <Loader2 className="me-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileCheck className="me-2 h-4 w-4" />
                )}
                {t("apis.generatePNRGOV", "Generate PNR/GOV")}
              </Button>
              <Button
                size="sm"
                onClick={() =>
                  submitMutation.mutate({
                    flightId: parseInt(flightId),
                  })
                }
                disabled={
                  submitMutation.isPending || !flightStatus.readyForSubmission
                }
              >
                {submitMutation.isPending ? (
                  <Loader2 className="me-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="me-2 h-4 w-4" />
                )}
                {t("apis.submitToAuthorities", "Submit to Authorities")}
              </Button>
            </div>

            {!flightStatus.readyForSubmission &&
              flightStatus.totalPassengers > 0 && (
                <p className="mt-2 flex items-center gap-1 text-sm text-amber-600">
                  <AlertTriangle className="h-4 w-4" />
                  {t(
                    "apis.notReadyWarning",
                    "All passengers must have validated APIS data before submission."
                  )}
                </p>
              )}
          </CardContent>
        </Card>
      )}

      {/* Passenger Status Table */}
      {flightStatus &&
        flightStatus.passengerStatuses &&
        flightStatus.passengerStatuses.length > 0 && (
          <Card className="shadow-sm rounded-xl">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {t("apis.passengerStatuses", "Passenger APIS Status")} (
                {flightStatus.totalPassengers})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("apis.passenger", "Passenger")}</TableHead>
                      <TableHead>
                        {t("apis.bookingRef", "Booking Ref")}
                      </TableHead>
                      <TableHead>{t("apis.pnr", "PNR")}</TableHead>
                      <TableHead>
                        {t("apis.apisStatus", "APIS Status")}
                      </TableHead>
                      <TableHead>
                        {t("apis.validatedAt", "Validated")}
                      </TableHead>
                      <TableHead>
                        {t("apis.submittedAt", "Submitted")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(flightStatus.passengerStatuses as PassengerStatus[]).map(
                      pax => (
                        <TableRow key={pax.passengerId}>
                          <TableCell className="font-medium">
                            {pax.name}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {pax.bookingReference}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {pax.pnr}
                          </TableCell>
                          <TableCell>
                            <DataStatusBadge status={pax.apisStatus} />
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {pax.validatedAt
                              ? format(new Date(pax.validatedAt), "PP p", {
                                  locale,
                                })
                              : "--"}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {pax.submittedAt
                              ? format(new Date(pax.submittedAt), "PP p", {
                                  locale,
                                })
                              : "--"}
                          </TableCell>
                        </TableRow>
                      )
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

      {/* Submission History Table */}
      <Card className="shadow-sm rounded-xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {t("apis.submissionHistory", "Submission History")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">{t("apis.id", "ID")}</TableHead>
                  <TableHead>{t("apis.destination", "Destination")}</TableHead>
                  <TableHead>{t("apis.format", "Format")}</TableHead>
                  <TableHead>{t("apis.status", "Status")}</TableHead>
                  <TableHead>{t("apis.submittedTime", "Submitted")}</TableHead>
                  <TableHead>
                    {t("apis.acknowledgedTime", "Acknowledged")}
                  </TableHead>
                  <TableHead>{t("apis.response", "Response")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {submissions && submissions.length > 0 ? (
                  submissions.map(sub => (
                    <TableRow key={sub.id}>
                      <TableCell className="font-mono text-sm">
                        #{sub.id}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono">
                          {sub.destinationCountry}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium uppercase">
                          {sub.format}
                        </span>
                      </TableCell>
                      <TableCell>
                        <SubmissionStatusBadge
                          status={sub.status as APISSubmissionStatus}
                        />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {sub.submissionTime
                          ? format(new Date(sub.submissionTime), "PP p", {
                              locale,
                            })
                          : "--"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {sub.acknowledgmentTime
                          ? format(new Date(sub.acknowledgmentTime), "PP p", {
                              locale,
                            })
                          : "--"}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground">
                        {sub.responseMessage ?? "--"}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-8 text-center text-muted-foreground"
                    >
                      {t(
                        "apis.noSubmissions",
                        "No APIS submissions found for this flight"
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// Validation Tab
// ============================================================================

function ValidationTab() {
  const { t } = useTranslation();
  const [flightIdInput, setFlightIdInput] = useState("");
  const [passengerIdInput, setPassengerIdInput] = useState("");

  const {
    data: incompleteData,
    isLoading: incompleteLoading,
    refetch: refetchIncomplete,
  } = trpc.apis.flagIncomplete.useQuery(
    { flightId: parseInt(flightIdInput) },
    { enabled: !!flightIdInput && !isNaN(parseInt(flightIdInput)) }
  );

  const validateMutation = trpc.apis.validatePassenger.useMutation({
    onSuccess: data => {
      if (data.valid) {
        toast.success(
          t(
            "apis.validationPassed",
            "Passenger APIS data validated successfully"
          )
        );
      } else {
        toast.error(
          t("apis.validationFailed", "Validation failed: {{count}} error(s)", {
            count: data.errors.length,
          })
        );
      }
      refetchIncomplete();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  return (
    <div className="space-y-6">
      {/* Validate Individual Passenger */}
      <Card className="shadow-sm rounded-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CheckCircle2 className="h-5 w-5" />
            {t("apis.validatePassenger", "Validate Passenger APIS Data")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <div className="w-64">
              <Input
                type="number"
                value={passengerIdInput}
                onChange={e => setPassengerIdInput(e.target.value)}
                placeholder={t("apis.enterPassengerId", "Enter Passenger ID")}
              />
            </div>
            <Button
              variant="outline"
              onClick={() =>
                validateMutation.mutate({
                  passengerId: parseInt(passengerIdInput),
                })
              }
              disabled={
                !passengerIdInput ||
                isNaN(parseInt(passengerIdInput)) ||
                validateMutation.isPending
              }
            >
              {validateMutation.isPending ? (
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="me-2 h-4 w-4" />
              )}
              {t("apis.validate", "Validate")}
            </Button>
          </div>

          {/* Validation Result */}
          {validateMutation.data && (
            <div className="mt-4 rounded-lg border p-4">
              <div className="flex items-center gap-2">
                {validateMutation.data.valid ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                )}
                <span className="font-medium">
                  {validateMutation.data.valid
                    ? t("apis.validationSuccess", "Validation Passed")
                    : t("apis.validationError", "Validation Failed")}
                </span>
                <DataStatusBadge status={validateMutation.data.status} />
              </div>

              {validateMutation.data.errors.length > 0 && (
                <div className="mt-3">
                  <p className="text-sm font-medium text-red-600">
                    {t("apis.errors", "Errors")}:
                  </p>
                  <ul className="mt-1 list-inside list-disc text-sm text-red-600">
                    {validateMutation.data.errors.map(
                      (err: string, i: number) => (
                        <li key={i}>{err}</li>
                      )
                    )}
                  </ul>
                </div>
              )}

              {validateMutation.data.warnings.length > 0 && (
                <div className="mt-3">
                  <p className="text-sm font-medium text-amber-600">
                    {t("apis.warnings", "Warnings")}:
                  </p>
                  <ul className="mt-1 list-inside list-disc text-sm text-amber-600">
                    {validateMutation.data.warnings.map(
                      (warn: string, i: number) => (
                        <li key={i}>{warn}</li>
                      )
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Flag Incomplete Passengers for a Flight */}
      <Card className="shadow-sm rounded-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="h-5 w-5" />
            {t("apis.incompletePassengers", "Incomplete APIS Data")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <div className="w-64">
              <Input
                type="number"
                value={flightIdInput}
                onChange={e => setFlightIdInput(e.target.value)}
                placeholder={t("apis.enterFlightId", "Enter Flight ID")}
              />
            </div>
            <Button
              variant="outline"
              onClick={() => refetchIncomplete()}
              disabled={
                !flightIdInput ||
                isNaN(parseInt(flightIdInput)) ||
                incompleteLoading
              }
            >
              {incompleteLoading ? (
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
              ) : (
                <Search className="me-2 h-4 w-4" />
              )}
              {t("apis.checkIncomplete", "Check Incomplete")}
            </Button>
          </div>

          {incompleteData && (
            <div className="mt-4">
              <div className="mb-3 flex items-center gap-3">
                <p className="text-sm font-medium">
                  {t("apis.flight", "Flight")} {incompleteData.flightNumber}
                </p>
                <Badge variant="outline">
                  {incompleteData.incompleteCount} /{" "}
                  {incompleteData.totalPassengers}{" "}
                  {t("apis.incomplete", "incomplete")}
                </Badge>
              </div>

              {incompleteData.incompletePassengers.length > 0 ? (
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          {t("apis.passenger", "Passenger")}
                        </TableHead>
                        <TableHead>
                          {t("apis.bookingRef", "Booking Ref")}
                        </TableHead>
                        <TableHead>{t("apis.pnr", "PNR")}</TableHead>
                        <TableHead>{t("apis.reason", "Reason")}</TableHead>
                        <TableHead className="w-32">
                          {t("apis.actions", "Actions")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {incompleteData.incompletePassengers.map(pax => (
                        <TableRow key={pax.passengerId}>
                          <TableCell className="font-medium">
                            {pax.name}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {pax.bookingReference}
                          </TableCell>
                          <TableCell className="font-mono text-sm">
                            {pax.pnr}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {pax.reason}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setPassengerIdInput(String(pax.passengerId));
                                validateMutation.mutate({
                                  passengerId: pax.passengerId,
                                });
                              }}
                              disabled={validateMutation.isPending}
                            >
                              {t("apis.validate", "Validate")}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  <p className="text-sm text-green-700 dark:text-green-300">
                    {t(
                      "apis.allComplete",
                      "All passengers have complete APIS data for this flight."
                    )}
                  </p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// Route Requirements Tab
// ============================================================================

function RouteRequirementsTab() {
  const { t } = useTranslation();
  const [originCountry, setOriginCountry] = useState("");
  const [destinationCountry, setDestinationCountry] = useState("");

  const {
    data: requirements,
    isLoading,
    refetch,
  } = trpc.apis.getRequirements.useQuery(
    {
      originCountry: originCountry.toUpperCase(),
      destinationCountry: destinationCountry.toUpperCase(),
    },
    {
      enabled: originCountry.length >= 2 && destinationCountry.length >= 2,
    }
  );

  const commonRoutes = [
    { origin: "SA", destination: "US", label: "SA -> US" },
    { origin: "SA", destination: "GB", label: "SA -> GB" },
    { origin: "SA", destination: "CA", label: "SA -> CA" },
    { origin: "SA", destination: "AU", label: "SA -> AU" },
    { origin: "SA", destination: "AE", label: "SA -> AE" },
    { origin: "SA", destination: "EG", label: "SA -> EG" },
  ];

  return (
    <div className="space-y-6">
      {/* Search */}
      <Card className="shadow-sm rounded-xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Globe className="h-5 w-5" />
            {t("apis.routeRequirements", "Route APIS Requirements")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted-foreground">
            {t(
              "apis.routeRequirementsDescription",
              "Check what passenger information is required for specific routes. Enter ISO country codes (2-3 letters)."
            )}
          </p>

          <div className="flex flex-wrap gap-3">
            <div className="w-40">
              <Input
                value={originCountry}
                onChange={e =>
                  setOriginCountry(e.target.value.toUpperCase().slice(0, 3))
                }
                placeholder={t("apis.originCountry", "Origin (e.g. SA)")}
                maxLength={3}
              />
            </div>
            <span className="self-center text-muted-foreground">-&gt;</span>
            <div className="w-40">
              <Input
                value={destinationCountry}
                onChange={e =>
                  setDestinationCountry(
                    e.target.value.toUpperCase().slice(0, 3)
                  )
                }
                placeholder={t("apis.destinationCountry", "Dest (e.g. US)")}
                maxLength={3}
              />
            </div>
            <Button
              variant="outline"
              onClick={() => refetch()}
              disabled={
                originCountry.length < 2 ||
                destinationCountry.length < 2 ||
                isLoading
              }
            >
              {isLoading ? (
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
              ) : (
                <Search className="me-2 h-4 w-4" />
              )}
              {t("apis.checkRequirements", "Check Requirements")}
            </Button>
          </div>

          {/* Quick Route Buttons */}
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="self-center text-xs text-muted-foreground">
              {t("apis.quickRoutes", "Quick:")}
            </span>
            {commonRoutes.map(route => (
              <Button
                key={route.label}
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  setOriginCountry(route.origin);
                  setDestinationCountry(route.destination);
                }}
              >
                {route.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Requirements Result */}
      {requirements && (
        <Card className="shadow-sm rounded-xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileCheck className="h-5 w-5" />
              {t(
                "apis.requirementsFor",
                "Requirements: {{origin}} -> {{dest}}",
                {
                  origin: requirements.originCountry,
                  dest: requirements.destinationCountry,
                }
              )}
              <Badge variant="outline" className="ms-2 text-xs font-normal">
                {requirements.source === "database"
                  ? t("apis.sourceDatabase", "Database")
                  : t("apis.sourceDefault", "Default Rules")}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              {/* Message Format */}
              <div className="rounded-lg border p-4">
                <p className="text-sm font-medium text-muted-foreground">
                  {t("apis.messageFormat", "Message Format")}
                </p>
                <p className="mt-1 text-lg font-bold uppercase">
                  {requirements.format}
                </p>
              </div>

              {/* Submission Deadline */}
              <div className="rounded-lg border p-4">
                <p className="text-sm font-medium text-muted-foreground">
                  {t("apis.submissionDeadline", "Submission Deadline")}
                </p>
                <p className="mt-1 text-lg font-bold">
                  {requirements.submissionDeadlineMinutes >= 1440
                    ? `${Math.round(requirements.submissionDeadlineMinutes / 1440)}d`
                    : requirements.submissionDeadlineMinutes >= 60
                      ? `${Math.round(requirements.submissionDeadlineMinutes / 60)}h`
                      : `${requirements.submissionDeadlineMinutes}m`}
                  <span className="ms-1 text-sm font-normal text-muted-foreground">
                    {t("apis.beforeDeparture", "before departure")}
                  </span>
                </p>
              </div>

              {/* Required Fields Count */}
              <div className="rounded-lg border p-4">
                <p className="text-sm font-medium text-muted-foreground">
                  {t("apis.requiredFieldsCount", "Required Fields")}
                </p>
                <p className="mt-1 text-lg font-bold">
                  {requirements.requiredFields.length}
                  <span className="ms-1 text-sm font-normal text-muted-foreground">
                    {t("apis.fields", "fields")}
                  </span>
                </p>
              </div>
            </div>

            {/* Required Fields List */}
            <div className="mt-4">
              <p className="mb-2 text-sm font-medium">
                {t("apis.requiredFieldsList", "Required Fields")}:
              </p>
              <div className="flex flex-wrap gap-2">
                {requirements.requiredFields.map((field: string) => (
                  <Badge
                    key={field}
                    variant="secondary"
                    className="font-mono text-xs"
                  >
                    {field}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Enhanced fields note */}
            {requirements.requiredFields.length > 9 && (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  {t(
                    "apis.enhancedFieldsNote",
                    "This route requires enhanced APIS data including address information. Passengers must provide residence and destination addresses."
                  )}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Main Page Component
// ============================================================================

export default function APISManagement() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState("submissions");
  const [flightId, setFlightId] = useState("");

  // Query submissions for stats cards (shared with SubmissionsTab)
  const { data: submissions } = trpc.apis.getSubmissions.useQuery(
    { flightId: parseInt(flightId) },
    { enabled: !!flightId && !isNaN(parseInt(flightId)) }
  );

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
        title={t("apis.title", "APIS Management")}
        description={t(
          "apis.description",
          "Manage Advance Passenger Information System data, validation, and submissions"
        )}
      />

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          <Shield className="me-2 inline h-6 w-6" />
          {t("apis.title", "APIS Management")}
        </h1>
        <p className="text-muted-foreground">
          {t(
            "apis.subtitle",
            "Advance Passenger Information System - collect, validate, and submit travel document data to border authorities"
          )}
        </p>
      </div>

      {/* Flight ID Input (shared across tabs) */}
      <Card className="shadow-sm rounded-xl">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-muted-foreground">
              {t("apis.flightId", "Flight ID")}:
            </label>
            <div className="w-48">
              <Input
                type="number"
                value={flightId}
                onChange={e => setFlightId(e.target.value)}
                placeholder={t("apis.enterFlightId", "Enter Flight ID")}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {t(
                "apis.flightIdHint",
                "Enter a flight ID to view APIS data and submissions"
              )}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Statistics */}
      <StatsCards flightId={flightId} submissions={submissions} />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="submissions" className="gap-2">
            <Send className="h-4 w-4" />
            {t("apis.submissions", "Submissions")}
          </TabsTrigger>
          <TabsTrigger value="validation" className="gap-2">
            <CheckCircle2 className="h-4 w-4" />
            {t("apis.validation", "Validation")}
          </TabsTrigger>
          <TabsTrigger value="requirements" className="gap-2">
            <Globe className="h-4 w-4" />
            {t("apis.routeRequirements", "Route Requirements")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="submissions" className="mt-4">
          <SubmissionsTab flightId={flightId} />
        </TabsContent>

        <TabsContent value="validation" className="mt-4">
          <ValidationTab />
        </TabsContent>

        <TabsContent value="requirements" className="mt-4">
          <RouteRequirementsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
