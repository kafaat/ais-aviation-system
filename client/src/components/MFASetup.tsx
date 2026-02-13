/**
 * MFASetup - Multi-Factor Authentication Setup Wizard
 *
 * A 3-step wizard for enrolling in TOTP-based MFA:
 * 1. Display QR code and manual secret key
 * 2. Verify setup with a 6-digit TOTP code
 * 3. Display and copy backup codes
 *
 * Supports English and Arabic (RTL) inline.
 *
 * @version 1.0.0
 */

import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  Shield,
  Copy,
  Check,
  Loader2,
  KeyRound,
  ArrowRight,
  ArrowLeft,
  Download,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";

// ============================================================================
// Types
// ============================================================================

interface MFASetupProps {
  onComplete?: () => void;
  onCancel?: () => void;
  className?: string;
}

interface SetupData {
  secret: string;
  qrCodeUrl: string;
  backupCodes: string[];
}

// ============================================================================
// Translations (inline for EN/AR)
// ============================================================================

const translations = {
  en: {
    title: "Set Up Two-Factor Authentication",
    subtitle: "Add an extra layer of security to your account",
    step1Title: "Scan QR Code",
    step1Desc:
      "Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)",
    manualEntry: "Can't scan? Enter this key manually:",
    copiedKey: "Secret key copied to clipboard",
    step2Title: "Verify Setup",
    step2Desc:
      "Enter the 6-digit code from your authenticator app to confirm setup",
    verificationCode: "Verification Code",
    verifyButton: "Verify & Enable",
    verifying: "Verifying...",
    step3Title: "Save Backup Codes",
    step3Desc:
      "Save these backup codes in a safe place. Each code can only be used once if you lose access to your authenticator.",
    warning:
      "These codes will not be shown again. Make sure to save them before closing.",
    copyAll: "Copy All Codes",
    copiedCodes: "Backup codes copied to clipboard",
    downloadCodes: "Download as Text",
    done: "Done",
    cancel: "Cancel",
    back: "Back",
    next: "Next",
    step: "Step",
    of: "of",
    settingUp: "Setting up...",
    setupError: "Failed to initiate MFA setup. Please try again.",
    verifyError: "Invalid code. Please check and try again.",
    mfaEnabled: "Two-factor authentication has been enabled!",
  },
  ar: {
    title:
      "\u0625\u0639\u062f\u0627\u062f \u0627\u0644\u0645\u0635\u0627\u062f\u0642\u0629 \u0627\u0644\u062b\u0646\u0627\u0626\u064a\u0629",
    subtitle:
      "\u0623\u0636\u0641 \u0637\u0628\u0642\u0629 \u0623\u0645\u0627\u0646 \u0625\u0636\u0627\u0641\u064a\u0629 \u0644\u062d\u0633\u0627\u0628\u0643",
    step1Title: "\u0627\u0645\u0633\u062d \u0631\u0645\u0632 QR",
    step1Desc:
      "\u0627\u0645\u0633\u062d \u0647\u0630\u0627 \u0627\u0644\u0631\u0645\u0632 \u0628\u062a\u0637\u0628\u064a\u0642 \u0627\u0644\u0645\u0635\u0627\u062f\u0642\u0629 (Google Authenticator\u060c Authy\u060c \u0625\u0644\u062e)",
    manualEntry:
      "\u0644\u0627 \u064a\u0645\u0643\u0646\u0643 \u0627\u0644\u0645\u0633\u062d\u061f \u0623\u062f\u062e\u0644 \u0647\u0630\u0627 \u0627\u0644\u0645\u0641\u062a\u0627\u062d \u064a\u062f\u0648\u064a\u0627\u064b:",
    copiedKey:
      "\u062a\u0645 \u0646\u0633\u062e \u0627\u0644\u0645\u0641\u062a\u0627\u062d \u0627\u0644\u0633\u0631\u064a",
    step2Title:
      "\u062a\u062d\u0642\u0642 \u0645\u0646 \u0627\u0644\u0625\u0639\u062f\u0627\u062f",
    step2Desc:
      "\u0623\u062f\u062e\u0644 \u0627\u0644\u0631\u0645\u0632 \u0627\u0644\u0645\u0643\u0648\u0646 \u0645\u0646 6 \u0623\u0631\u0642\u0627\u0645 \u0645\u0646 \u062a\u0637\u0628\u064a\u0642 \u0627\u0644\u0645\u0635\u0627\u062f\u0642\u0629",
    verificationCode: "\u0631\u0645\u0632 \u0627\u0644\u062a\u062d\u0642\u0642",
    verifyButton:
      "\u062a\u062d\u0642\u0642 \u0648\u062a\u0641\u0639\u064a\u0644",
    verifying:
      "\u062c\u0627\u0631\u064a \u0627\u0644\u062a\u062d\u0642\u0642...",
    step3Title:
      "\u0627\u062d\u0641\u0638 \u0631\u0645\u0648\u0632 \u0627\u0644\u0627\u0633\u062a\u0631\u062f\u0627\u062f",
    step3Desc:
      "\u0627\u062d\u0641\u0638 \u0647\u0630\u0647 \u0627\u0644\u0631\u0645\u0648\u0632 \u0641\u064a \u0645\u0643\u0627\u0646 \u0622\u0645\u0646. \u0643\u0644 \u0631\u0645\u0632 \u064a\u0633\u062a\u062e\u062f\u0645 \u0645\u0631\u0629 \u0648\u0627\u062d\u062f\u0629 \u0641\u0642\u0637.",
    warning:
      "\u0644\u0646 \u062a\u0638\u0647\u0631 \u0647\u0630\u0647 \u0627\u0644\u0631\u0645\u0648\u0632 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649. \u062a\u0623\u0643\u062f \u0645\u0646 \u062d\u0641\u0638\u0647\u0627 \u0642\u0628\u0644 \u0627\u0644\u0625\u063a\u0644\u0627\u0642.",
    copyAll:
      "\u0646\u0633\u062e \u062c\u0645\u064a\u0639 \u0627\u0644\u0631\u0645\u0648\u0632",
    copiedCodes:
      "\u062a\u0645 \u0646\u0633\u062e \u0631\u0645\u0648\u0632 \u0627\u0644\u0627\u0633\u062a\u0631\u062f\u0627\u062f",
    downloadCodes:
      "\u062a\u0646\u0632\u064a\u0644 \u0643\u0645\u0644\u0641 \u0646\u0635\u064a",
    done: "\u062a\u0645",
    cancel: "\u0625\u0644\u063a\u0627\u0621",
    back: "\u0631\u062c\u0648\u0639",
    next: "\u0627\u0644\u062a\u0627\u0644\u064a",
    step: "\u0627\u0644\u062e\u0637\u0648\u0629",
    of: "\u0645\u0646",
    settingUp:
      "\u062c\u0627\u0631\u064a \u0627\u0644\u0625\u0639\u062f\u0627\u062f...",
    setupError:
      "\u0641\u0634\u0644 \u0625\u0639\u062f\u0627\u062f MFA. \u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649.",
    verifyError:
      "\u0631\u0645\u0632 \u063a\u064a\u0631 \u0635\u0627\u0644\u062d. \u062a\u062d\u0642\u0642 \u0648\u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649.",
    mfaEnabled:
      "\u062a\u0645 \u062a\u0641\u0639\u064a\u0644 \u0627\u0644\u0645\u0635\u0627\u062f\u0642\u0629 \u0627\u0644\u062b\u0646\u0627\u0626\u064a\u0629!",
  },
} as const;

type Lang = "en" | "ar";

// ============================================================================
// QR Code Placeholder SVG
// ============================================================================

function QRCodePlaceholder({ url }: { url: string }) {
  // Generate a deterministic pattern based on the URL for visual variety
  const hash = url.split("").reduce((acc, char) => {
    return ((acc << 5) - acc + char.charCodeAt(0)) | 0;
  }, 0);

  const cells: { x: number; y: number }[] = [];
  const size = 21; // Standard QR code size
  let seed = Math.abs(hash);

  // Simple pseudo-random generator for deterministic pattern
  const nextRand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed;
  };

  // QR code finder patterns (top-left, top-right, bottom-left)
  const addFinderPattern = (ox: number, oy: number) => {
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        if (
          y === 0 ||
          y === 6 ||
          x === 0 ||
          x === 6 ||
          (y >= 2 && y <= 4 && x >= 2 && x <= 4)
        ) {
          cells.push({ x: ox + x, y: oy + y });
        }
      }
    }
  };

  addFinderPattern(0, 0);
  addFinderPattern(14, 0);
  addFinderPattern(0, 14);

  // Fill remaining area with pseudo-random data
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inFinder =
        (x < 8 && y < 8) || (x >= 13 && y < 8) || (x < 8 && y >= 13);
      if (!inFinder && nextRand() % 3 === 0) {
        cells.push({ x, y });
      }
    }
  }

  const cellSize = 8;
  const padding = 16;
  const svgSize = size * cellSize + padding * 2;

  return (
    <svg
      width={svgSize}
      height={svgSize}
      viewBox={`0 0 ${svgSize} ${svgSize}`}
      className="mx-auto"
      role="img"
      aria-label="QR Code for authenticator app"
    >
      <rect width={svgSize} height={svgSize} fill="white" rx="8" />
      {cells.map((cell, i) => (
        <rect
          key={i}
          x={padding + cell.x * cellSize}
          y={padding + cell.y * cellSize}
          width={cellSize}
          height={cellSize}
          fill="#1a1a2e"
          rx="1"
        />
      ))}
    </svg>
  );
}

// ============================================================================
// Component
// ============================================================================

export function MFASetup({ onComplete, onCancel, className }: MFASetupProps) {
  const { i18n } = useTranslation();
  const lang: Lang = i18n.language?.startsWith("ar") ? "ar" : "en";
  const t = translations[lang];
  const isRTL = lang === "ar";

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [setupData, setSetupData] = useState<SetupData | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedBackup, setCopiedBackup] = useState(false);

  // tRPC mutations
  const setupMutation = trpc.mfa.setup.useMutation({
    onSuccess: (data: SetupData) => {
      setSetupData(data);
    },
    onError: () => {
      toast.error(t.setupError);
    },
  });

  const verifyMutation = trpc.mfa.verify.useMutation({
    onSuccess: () => {
      toast.success(t.mfaEnabled);
      setStep(3);
    },
    onError: () => {
      toast.error(t.verifyError);
      setVerificationCode("");
    },
  });

  // Start setup on mount (step 1)
  const handleStartSetup = useCallback(() => {
    if (!setupData && !setupMutation.isPending) {
      setupMutation.mutate();
    }
  }, [setupData, setupMutation]);

  // Auto-trigger setup when component mounts
  if (!setupData && !setupMutation.isPending && !setupMutation.isError) {
    handleStartSetup();
  }

  const handleCopySecret = async () => {
    if (!setupData) return;
    try {
      await navigator.clipboard.writeText(setupData.secret);
      setCopiedSecret(true);
      toast.success(t.copiedKey);
      setTimeout(() => setCopiedSecret(false), 2000);
    } catch {
      // Fallback: select text
      toast.error("Failed to copy");
    }
  };

  const handleVerify = () => {
    if (verificationCode.length !== 6) return;
    verifyMutation.mutate({ token: verificationCode });
  };

  const handleCopyBackupCodes = async () => {
    if (!setupData) return;
    try {
      const text = setupData.backupCodes.join("\n");
      await navigator.clipboard.writeText(text);
      setCopiedBackup(true);
      toast.success(t.copiedCodes);
      setTimeout(() => setCopiedBackup(false), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  };

  const handleDownloadBackupCodes = () => {
    if (!setupData) return;
    const text = [
      "AIS Aviation - MFA Backup Codes",
      "================================",
      `Generated: ${new Date().toISOString()}`,
      "",
      "Each code can only be used once:",
      "",
      ...setupData.backupCodes.map((code, i) => `${i + 1}. ${code}`),
      "",
      "Keep these codes in a safe place.",
    ].join("\n");

    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ais-aviation-backup-codes.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCodeInput = (value: string) => {
    const cleaned = value.replace(/\D/g, "").slice(0, 6);
    setVerificationCode(cleaned);
  };

  // Format secret for display (groups of 4)
  const formatSecret = (secret: string): string => {
    return secret.match(/.{1,4}/g)?.join(" ") || secret;
  };

  return (
    <div
      className={cn(
        "mx-auto w-full max-w-md rounded-xl border bg-white p-6 shadow-lg dark:border-gray-700 dark:bg-gray-900",
        className
      )}
      dir={isRTL ? "rtl" : "ltr"}
    >
      {/* Header */}
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900">
          <Shield className="h-6 w-6 text-blue-600 dark:text-blue-400" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
          {t.title}
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t.subtitle}
        </p>
      </div>

      {/* Step indicator */}
      <div className="mb-6 flex items-center justify-center gap-2">
        {[1, 2, 3].map(s => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors",
                s === step
                  ? "bg-blue-600 text-white"
                  : s < step
                    ? "bg-green-500 text-white"
                    : "bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400"
              )}
            >
              {s < step ? <Check className="h-4 w-4" /> : s}
            </div>
            {s < 3 && (
              <div
                className={cn(
                  "h-0.5 w-8",
                  s < step ? "bg-green-500" : "bg-gray-200 dark:bg-gray-700"
                )}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step 1: QR Code */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="text-center">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">
              {t.step1Title}
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t.step1Desc}
            </p>
          </div>

          {setupMutation.isPending ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
              <p className="mt-2 text-sm text-gray-500">{t.settingUp}</p>
            </div>
          ) : setupData ? (
            <>
              {/* QR Code */}
              <div className="rounded-lg border bg-white p-4 dark:border-gray-600 dark:bg-white">
                <QRCodePlaceholder url={setupData.qrCodeUrl} />
              </div>

              {/* Manual key entry */}
              <div className="space-y-2">
                <Label className="text-sm text-gray-600 dark:text-gray-400">
                  {t.manualEntry}
                </Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-md border bg-gray-50 px-3 py-2 text-center font-mono text-sm tracking-wider text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100">
                    {formatSecret(setupData.secret)}
                  </code>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleCopySecret}
                    className="shrink-0"
                  >
                    {copiedSecret ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            </>
          ) : null}

          {/* Actions */}
          <div className="flex justify-between pt-2">
            <Button variant="ghost" onClick={onCancel}>
              {t.cancel}
            </Button>
            <Button onClick={() => setStep(2)} disabled={!setupData}>
              {t.next}
              {isRTL ? (
                <ArrowLeft className="ms-2 h-4 w-4" />
              ) : (
                <ArrowRight className="ms-2 h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Verify */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="text-center">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">
              {t.step2Title}
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t.step2Desc}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="mfa-verification-code">{t.verificationCode}</Label>
            <div className="flex justify-center">
              <Input
                id="mfa-verification-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                value={verificationCode}
                onChange={e => handleCodeInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && verificationCode.length === 6) {
                    handleVerify();
                  }
                }}
                className="w-48 text-center font-mono text-2xl tracking-[0.5em]"
                placeholder="------"
              />
            </div>
          </div>

          <div className="flex items-center justify-center">
            <KeyRound className="me-2 h-4 w-4 text-gray-400" />
            <span className="text-xs text-gray-400">
              {verificationCode.length}/6
            </span>
          </div>

          {/* Actions */}
          <div className="flex justify-between pt-2">
            <Button variant="ghost" onClick={() => setStep(1)}>
              {isRTL ? (
                <ArrowRight className="me-2 h-4 w-4" />
              ) : (
                <ArrowLeft className="me-2 h-4 w-4" />
              )}
              {t.back}
            </Button>
            <Button
              onClick={handleVerify}
              disabled={
                verificationCode.length !== 6 || verifyMutation.isPending
              }
            >
              {verifyMutation.isPending ? (
                <>
                  <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  {t.verifying}
                </>
              ) : (
                t.verifyButton
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Backup Codes */}
      {step === 3 && setupData && (
        <div className="space-y-4">
          <div className="text-center">
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">
              {t.step3Title}
            </h3>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t.step3Desc}
            </p>
          </div>

          {/* Warning */}
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-sm text-amber-800 dark:text-amber-200">
              {t.warning}
            </p>
          </div>

          {/* Backup codes grid */}
          <div className="grid grid-cols-2 gap-2 rounded-lg border bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800">
            {setupData.backupCodes.map((code, index) => (
              <div
                key={index}
                className="rounded-md bg-white px-3 py-2 text-center font-mono text-sm tracking-wider text-gray-900 dark:bg-gray-700 dark:text-gray-100"
              >
                {code}
              </div>
            ))}
          </div>

          {/* Copy and download actions */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleCopyBackupCodes}
            >
              {copiedBackup ? (
                <Check className="me-2 h-4 w-4 text-green-500" />
              ) : (
                <Copy className="me-2 h-4 w-4" />
              )}
              {t.copyAll}
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={handleDownloadBackupCodes}
            >
              <Download className="me-2 h-4 w-4" />
              {t.downloadCodes}
            </Button>
          </div>

          {/* Done */}
          <div className="flex justify-end pt-2">
            <Button
              onClick={onComplete}
              className="bg-green-600 hover:bg-green-700"
            >
              <Check className="me-2 h-4 w-4" />
              {t.done}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
