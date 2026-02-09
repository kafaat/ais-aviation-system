/**
 * BiometricEnrollment Component
 *
 * Provides a complete UI for biometric data enrollment:
 * - Consent form with privacy information
 * - Biometric type selection (Face, Fingerprint)
 * - Enrollment status indicator
 * - Camera/scanner placeholder
 * - Revocation option
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ScanFace,
  Fingerprint,
  ShieldCheck,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Loader2,
  Camera,
  Trash2,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type BiometricType = "face" | "fingerprint";

interface BiometricEnrollmentProps {
  passengerId: number;
  className?: string;
}

export function BiometricEnrollment({
  passengerId,
  className,
}: BiometricEnrollmentProps) {
  const { t } = useTranslation();

  const [selectedType, setSelectedType] = useState<BiometricType>("face");
  const [consentGiven, setConsentGiven] = useState(false);
  const [captureStep, setCaptureStep] = useState<
    "idle" | "capturing" | "captured"
  >("idle");
  const [capturedHash, setCapturedHash] = useState<string | null>(null);

  // Query enrollment status
  const {
    data: enrollmentStatus,
    isLoading: isLoadingStatus,
    refetch: refetchStatus,
  } = trpc.biometric.getMyEnrollment.useQuery({ passengerId });

  // Enrollment mutation
  const enrollMutation = trpc.biometric.enroll.useMutation({
    onSuccess: () => {
      toast.success(t("biometric.enrollSuccess"));
      setCaptureStep("idle");
      setCapturedHash(null);
      setConsentGiven(false);
      refetchStatus();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  // Revoke mutation
  const revokeMutation = trpc.biometric.revokeEnrollment.useMutation({
    onSuccess: () => {
      toast.success(t("biometric.revokeSuccess"));
      refetchStatus();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const activeEnrollments =
    enrollmentStatus?.enrollments.filter(e => e.status === "active") ?? [];

  const isEnrolledForType = activeEnrollments.some(
    e => e.biometricType === selectedType
  );

  /**
   * Simulate biometric capture.
   * In production, this would interface with camera/scanner hardware APIs.
   */
  const handleCapture = () => {
    setCaptureStep("capturing");

    // Simulate capture delay
    setTimeout(() => {
      const simulatedHash = Array.from(
        crypto.getRandomValues(new Uint8Array(32))
      )
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");

      setCapturedHash(simulatedHash);
      setCaptureStep("captured");
    }, 2000);
  };

  const handleEnroll = () => {
    if (!capturedHash) {
      toast.error(t("biometric.captureFirst"));
      return;
    }

    if (!consentGiven) {
      toast.error(t("biometric.consentRequired"));
      return;
    }

    enrollMutation.mutate({
      passengerId,
      biometricType: selectedType,
      templateHash: capturedHash,
      consentGiven,
    });
  };

  const handleRevoke = (biometricType?: BiometricType) => {
    revokeMutation.mutate({
      passengerId,
      biometricType,
    });
  };

  // Loading state
  if (isLoadingStatus) {
    return (
      <Card className={cn("p-6", className)}>
        <div className="flex items-center justify-center gap-2 py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            {t("biometric.loadingStatus")}
          </span>
        </div>
      </Card>
    );
  }

  return (
    <Card className={cn("p-6", className)}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <ScanFace className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-lg">{t("biometric.title")}</h3>
              <p className="text-sm text-muted-foreground">
                {t("biometric.subtitle")}
              </p>
            </div>
          </div>

          {/* Status indicator */}
          <EnrollmentStatusBadge
            hasActiveEnrollment={enrollmentStatus?.hasActiveEnrollment ?? false}
            count={activeEnrollments.length}
          />
        </div>

        {/* Active Enrollments List */}
        {activeEnrollments.length > 0 && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">
              {t("biometric.activeEnrollments")}
            </Label>
            <div className="space-y-2">
              {activeEnrollments.map(enrollment => (
                <div
                  key={enrollment.id}
                  className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-800 dark:bg-green-950"
                >
                  <div className="flex items-center gap-3">
                    {enrollment.biometricType === "face" ? (
                      <ScanFace className="h-4 w-4 text-green-600" />
                    ) : (
                      <Fingerprint className="h-4 w-4 text-green-600" />
                    )}
                    <div>
                      <span className="text-sm font-medium capitalize">
                        {t(`biometric.type.${enrollment.biometricType}`)}
                      </span>
                      <p className="text-xs text-muted-foreground">
                        {t("biometric.expiresAt")}:{" "}
                        {new Date(enrollment.expiresAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        disabled={revokeMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {t("biometric.revokeTitle")}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {t("biometric.revokeDescription")}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>
                          {t("common.cancel")}
                        </AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() =>
                            handleRevoke(
                              enrollment.biometricType as BiometricType
                            )
                          }
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          {t("biometric.confirmRevoke")}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Biometric Type Selection */}
        <div className="space-y-3">
          <Label className="text-sm font-medium">
            {t("biometric.selectType")}
          </Label>
          <RadioGroup
            value={selectedType}
            onValueChange={value => {
              setSelectedType(value as BiometricType);
              setCaptureStep("idle");
              setCapturedHash(null);
            }}
            className="grid grid-cols-2 gap-3"
          >
            <label
              htmlFor="type-face"
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-lg border p-4 transition-colors",
                selectedType === "face"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-accent"
              )}
            >
              <RadioGroupItem value="face" id="type-face" />
              <ScanFace className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-medium">
                  {t("biometric.type.face")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("biometric.type.faceDesc")}
                </p>
              </div>
            </label>

            <label
              htmlFor="type-fingerprint"
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-lg border p-4 transition-colors",
                selectedType === "fingerprint"
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-accent"
              )}
            >
              <RadioGroupItem value="fingerprint" id="type-fingerprint" />
              <Fingerprint className="h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-medium">
                  {t("biometric.type.fingerprint")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("biometric.type.fingerprintDesc")}
                </p>
              </div>
            </label>
          </RadioGroup>
        </div>

        {/* Camera / Scanner Placeholder */}
        {!isEnrolledForType && (
          <div className="space-y-3">
            <Label className="text-sm font-medium">
              {selectedType === "face"
                ? t("biometric.cameraCapture")
                : t("biometric.scannerCapture")}
            </Label>
            <div
              className={cn(
                "relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors",
                captureStep === "captured"
                  ? "border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-950"
                  : captureStep === "capturing"
                    ? "border-primary/50 bg-primary/5"
                    : "border-border bg-muted/30"
              )}
            >
              {captureStep === "idle" && (
                <>
                  <Camera className="h-12 w-12 text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground text-center mb-4">
                    {selectedType === "face"
                      ? t("biometric.cameraPlaceholder")
                      : t("biometric.scannerPlaceholder")}
                  </p>
                  <Button onClick={handleCapture} variant="outline">
                    {selectedType === "face"
                      ? t("biometric.startCamera")
                      : t("biometric.startScanner")}
                  </Button>
                </>
              )}

              {captureStep === "capturing" && (
                <>
                  <Loader2 className="h-12 w-12 text-primary animate-spin mb-3" />
                  <p className="text-sm text-primary font-medium">
                    {selectedType === "face"
                      ? t("biometric.capturingFace")
                      : t("biometric.capturingFingerprint")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("biometric.holdStill")}
                  </p>
                </>
              )}

              {captureStep === "captured" && (
                <>
                  <CheckCircle2 className="h-12 w-12 text-green-600 mb-3" />
                  <p className="text-sm text-green-700 font-medium dark:text-green-400">
                    {t("biometric.captureComplete")}
                  </p>
                  <Button
                    onClick={handleCapture}
                    variant="ghost"
                    size="sm"
                    className="mt-2"
                  >
                    {t("biometric.retake")}
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Consent Form */}
        {!isEnrolledForType && captureStep === "captured" && (
          <div className="space-y-3">
            <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                <div className="space-y-2 text-sm">
                  <p className="font-medium">{t("biometric.privacyTitle")}</p>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    <li>{t("biometric.privacy1")}</li>
                    <li>{t("biometric.privacy2")}</li>
                    <li>{t("biometric.privacy3")}</li>
                    <li>{t("biometric.privacy4")}</li>
                  </ul>
                </div>
              </div>
            </div>

            <label
              htmlFor="consent-checkbox"
              className="flex items-start gap-3 cursor-pointer"
            >
              <input
                type="checkbox"
                id="consent-checkbox"
                checked={consentGiven}
                onChange={e => setConsentGiven(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-gray-300"
              />
              <span className="text-sm">{t("biometric.consentText")}</span>
            </label>
          </div>
        )}

        {/* Enroll Button */}
        {!isEnrolledForType && captureStep === "captured" && (
          <Button
            onClick={handleEnroll}
            disabled={
              !consentGiven || !capturedHash || enrollMutation.isPending
            }
            className="w-full"
          >
            {enrollMutation.isPending ? (
              <>
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
                {t("biometric.enrolling")}
              </>
            ) : (
              <>
                <ShieldCheck className="me-2 h-4 w-4" />
                {t("biometric.enrollButton")}
              </>
            )}
          </Button>
        )}

        {/* Already enrolled message */}
        {isEnrolledForType && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-950">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-blue-600" />
              <p className="text-sm text-blue-700 dark:text-blue-300">
                {t("biometric.alreadyEnrolled", {
                  type: t(`biometric.type.${selectedType}`),
                })}
              </p>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function EnrollmentStatusBadge({
  hasActiveEnrollment,
  count,
}: {
  hasActiveEnrollment: boolean;
  count: number;
}) {
  const { t } = useTranslation();

  if (hasActiveEnrollment) {
    return (
      <Badge
        variant="secondary"
        className="bg-green-100 text-green-800 border-green-300 dark:bg-green-900 dark:text-green-200"
      >
        <ShieldCheck className="h-3 w-3 me-1" />
        {t("biometric.enrolled")} ({count})
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="text-muted-foreground">
      <ShieldAlert className="h-3 w-3 me-1" />
      {t("biometric.notEnrolled")}
    </Badge>
  );
}

export default BiometricEnrollment;
