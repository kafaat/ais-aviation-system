/**
 * MFAVerify - MFA Verification Dialog
 *
 * A compact verification dialog for TOTP-based MFA during login.
 * Features:
 * - 6-digit code input with auto-focus and auto-submit
 * - "Use backup code" toggle for backup code entry
 * - Loading and error states
 * - Supports English and Arabic (RTL) inline
 *
 * @version 1.0.0
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  Shield,
  Loader2,
  KeyRound,
  AlertCircle,
  ArrowLeft,
} from "lucide-react";
import { useTranslation } from "react-i18next";

// ============================================================================
// Types
// ============================================================================

interface MFAVerifyProps {
  /** The user ID to verify MFA for (from password auth step) */
  userId: number;
  /** Callback on successful MFA verification */
  onVerified: () => void;
  /** Callback to go back (e.g., to login form) */
  onBack?: () => void;
  /** Additional class names */
  className?: string;
}

// ============================================================================
// Translations (inline for EN/AR)
// ============================================================================

const translations = {
  en: {
    title: "Two-Factor Authentication",
    subtitle: "Enter the 6-digit code from your authenticator app",
    codeLabel: "Verification Code",
    codePlaceholder: "------",
    verifying: "Verifying...",
    verify: "Verify",
    useBackupCode: "Use a backup code",
    useAuthenticator: "Use authenticator app",
    backupTitle: "Enter Backup Code",
    backupSubtitle: "Enter one of your 8-character backup codes",
    backupLabel: "Backup Code",
    backupPlaceholder: "Enter backup code",
    submitBackup: "Verify Backup Code",
    invalidCode: "Invalid verification code. Please try again.",
    invalidBackup: "Invalid backup code. Please try again.",
    error: "Verification failed. Please try again.",
    back: "Back",
    remainingCodes: "backup codes remaining",
  },
  ar: {
    title:
      "\u0627\u0644\u0645\u0635\u0627\u062f\u0642\u0629 \u0627\u0644\u062b\u0646\u0627\u0626\u064a\u0629",
    subtitle:
      "\u0623\u062f\u062e\u0644 \u0627\u0644\u0631\u0645\u0632 \u0627\u0644\u0645\u0643\u0648\u0646 \u0645\u0646 6 \u0623\u0631\u0642\u0627\u0645 \u0645\u0646 \u062a\u0637\u0628\u064a\u0642 \u0627\u0644\u0645\u0635\u0627\u062f\u0642\u0629",
    codeLabel: "\u0631\u0645\u0632 \u0627\u0644\u062a\u062d\u0642\u0642",
    codePlaceholder: "------",
    verifying:
      "\u062c\u0627\u0631\u064a \u0627\u0644\u062a\u062d\u0642\u0642...",
    verify: "\u062a\u062d\u0642\u0642",
    useBackupCode:
      "\u0627\u0633\u062a\u062e\u062f\u0645 \u0631\u0645\u0632 \u0627\u0633\u062a\u0631\u062f\u0627\u062f",
    useAuthenticator:
      "\u0627\u0633\u062a\u062e\u062f\u0645 \u062a\u0637\u0628\u064a\u0642 \u0627\u0644\u0645\u0635\u0627\u062f\u0642\u0629",
    backupTitle:
      "\u0623\u062f\u062e\u0644 \u0631\u0645\u0632 \u0627\u0644\u0627\u0633\u062a\u0631\u062f\u0627\u062f",
    backupSubtitle:
      "\u0623\u062f\u062e\u0644 \u0623\u062d\u062f \u0631\u0645\u0648\u0632 \u0627\u0644\u0627\u0633\u062a\u0631\u062f\u0627\u062f \u0627\u0644\u0645\u0643\u0648\u0646\u0629 \u0645\u0646 8 \u0623\u062d\u0631\u0641",
    backupLabel:
      "\u0631\u0645\u0632 \u0627\u0644\u0627\u0633\u062a\u0631\u062f\u0627\u062f",
    backupPlaceholder:
      "\u0623\u062f\u062e\u0644 \u0631\u0645\u0632 \u0627\u0644\u0627\u0633\u062a\u0631\u062f\u0627\u062f",
    submitBackup:
      "\u062a\u062d\u0642\u0642 \u0645\u0646 \u0631\u0645\u0632 \u0627\u0644\u0627\u0633\u062a\u0631\u062f\u0627\u062f",
    invalidCode:
      "\u0631\u0645\u0632 \u062a\u062d\u0642\u0642 \u063a\u064a\u0631 \u0635\u0627\u0644\u062d. \u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649.",
    invalidBackup:
      "\u0631\u0645\u0632 \u0627\u0633\u062a\u0631\u062f\u0627\u062f \u063a\u064a\u0631 \u0635\u0627\u0644\u062d. \u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649.",
    error:
      "\u0641\u0634\u0644 \u0627\u0644\u062a\u062d\u0642\u0642. \u062d\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062e\u0631\u0649.",
    back: "\u0631\u062c\u0648\u0639",
    remainingCodes:
      "\u0631\u0645\u0648\u0632 \u0627\u0633\u062a\u0631\u062f\u0627\u062f \u0645\u062a\u0628\u0642\u064a\u0629",
  },
} as const;

type Lang = "en" | "ar";

// ============================================================================
// Component
// ============================================================================

export function MFAVerify({
  userId,
  onVerified,
  onBack,
  className,
}: MFAVerifyProps) {
  const { i18n } = useTranslation();
  const lang: Lang = i18n.language?.startsWith("ar") ? "ar" : "en";
  const t = translations[lang];
  const isRTL = lang === "ar";

  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [totpCode, setTotpCode] = useState("");
  const [backupCode, setBackupCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [remainingCodes, setRemainingCodes] = useState<number | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus input on mount and mode change
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, [mode]);

  // TOTP verification mutation
  const verifyLoginMutation = trpc.mfa.verifyLogin.useMutation({
    onSuccess: () => {
      setError(null);
      onVerified();
    },
    onError: (err: { message?: string }) => {
      setError(err.message || t.invalidCode);
      setTotpCode("");
      inputRef.current?.focus();
    },
  });

  // Backup code mutation
  const useBackupCodeMutation = trpc.mfa.useBackupCode.useMutation({
    onSuccess: (data: {
      success: boolean;
      verified: boolean;
      remainingCodes?: number;
    }) => {
      setError(null);
      if (data.remainingCodes !== undefined) {
        setRemainingCodes(data.remainingCodes);
      }
      onVerified();
    },
    onError: (err: { message?: string }) => {
      setError(err.message || t.invalidBackup);
      setBackupCode("");
      inputRef.current?.focus();
    },
  });

  const isLoading =
    verifyLoginMutation.isPending || useBackupCodeMutation.isPending;

  // Handle TOTP code input with auto-submit
  const handleTotpInput = useCallback(
    (value: string) => {
      const cleaned = value.replace(/\D/g, "").slice(0, 6);
      setTotpCode(cleaned);
      setError(null);

      // Auto-submit when 6 digits are entered
      if (cleaned.length === 6) {
        verifyLoginMutation.mutate({ userId, token: cleaned });
      }
    },
    [userId, verifyLoginMutation]
  );

  // Handle backup code input
  const handleBackupInput = (value: string) => {
    const cleaned = value
      .replace(/[^a-zA-Z0-9]/g, "")
      .toLowerCase()
      .slice(0, 8);
    setBackupCode(cleaned);
    setError(null);
  };

  const handleSubmitBackup = () => {
    if (backupCode.length !== 8) return;
    useBackupCodeMutation.mutate({ userId, code: backupCode });
  };

  const toggleMode = () => {
    setMode(prev => (prev === "totp" ? "backup" : "totp"));
    setTotpCode("");
    setBackupCode("");
    setError(null);
  };

  return (
    <div
      className={cn(
        "mx-auto w-full max-w-sm rounded-xl border bg-white p-6 shadow-lg dark:border-gray-700 dark:bg-gray-900",
        className
      )}
      dir={isRTL ? "rtl" : "ltr"}
    >
      {/* Header */}
      <div className="mb-5 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900">
          <Shield className="h-6 w-6 text-blue-600 dark:text-blue-400" />
        </div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          {mode === "totp" ? t.title : t.backupTitle}
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {mode === "totp" ? t.subtitle : t.backupSubtitle}
        </p>
      </div>

      {/* Error message */}
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {/* TOTP input mode */}
      {mode === "totp" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mfa-totp-input" className="sr-only">
              {t.codeLabel}
            </Label>
            <Input
              ref={inputRef}
              id="mfa-totp-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={totpCode}
              onChange={e => handleTotpInput(e.target.value)}
              disabled={isLoading}
              className="h-14 text-center font-mono text-3xl tracking-[0.6em]"
              placeholder={t.codePlaceholder}
            />
          </div>

          {/* Digit progress indicator */}
          <div className="flex justify-center gap-1.5">
            {[0, 1, 2, 3, 4, 5].map(i => (
              <div
                key={i}
                className={cn(
                  "h-1.5 w-6 rounded-full transition-colors",
                  i < totpCode.length
                    ? "bg-blue-600 dark:bg-blue-400"
                    : "bg-gray-200 dark:bg-gray-700"
                )}
              />
            ))}
          </div>

          {/* Loading indicator */}
          {isLoading && (
            <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t.verifying}
            </div>
          )}
        </div>
      )}

      {/* Backup code input mode */}
      {mode === "backup" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mfa-backup-input">{t.backupLabel}</Label>
            <Input
              ref={inputRef}
              id="mfa-backup-input"
              type="text"
              autoComplete="off"
              maxLength={8}
              value={backupCode}
              onChange={e => handleBackupInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && backupCode.length === 8) {
                  handleSubmitBackup();
                }
              }}
              disabled={isLoading}
              className="font-mono text-center text-lg tracking-wider"
              placeholder={t.backupPlaceholder}
            />
          </div>

          {remainingCodes !== null && (
            <p className="text-center text-xs text-gray-400">
              {remainingCodes} {t.remainingCodes}
            </p>
          )}

          <Button
            onClick={handleSubmitBackup}
            disabled={backupCode.length !== 8 || isLoading}
            className="w-full"
          >
            {isLoading ? (
              <>
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
                {t.verifying}
              </>
            ) : (
              <>
                <KeyRound className="me-2 h-4 w-4" />
                {t.submitBackup}
              </>
            )}
          </Button>
        </div>
      )}

      {/* Footer actions */}
      <div className="mt-5 flex flex-col gap-2">
        {/* Toggle mode */}
        <button
          type="button"
          onClick={toggleMode}
          disabled={isLoading}
          className="text-center text-sm font-medium text-blue-600 hover:text-blue-700 disabled:opacity-50 dark:text-blue-400 dark:hover:text-blue-300"
        >
          {mode === "totp" ? t.useBackupCode : t.useAuthenticator}
        </button>

        {/* Back button */}
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            disabled={isLoading}
            className="flex items-center justify-center gap-1 text-center text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50 dark:text-gray-400 dark:hover:text-gray-300"
          >
            {!isRTL && <ArrowLeft className="h-3 w-3" />}
            {t.back}
            {isRTL && <ArrowLeft className="h-3 w-3 rotate-180" />}
          </button>
        )}
      </div>
    </div>
  );
}
