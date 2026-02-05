/**
 * GateChangeAlert Component
 *
 * Displays an alert notification when a flight's gate has changed.
 * Can be used in booking details, flight cards, and notification lists.
 */

import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  DoorOpen,
  ArrowRight,
  Building2,
  Clock,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import { cn } from "@/lib/utils";

export interface GateChangeAlertProps {
  flightNumber: string;
  oldGate: string;
  newGate: string;
  oldTerminal?: string | null;
  newTerminal?: string | null;
  changeReason?: string | null;
  boardingTime?: Date | null;
  onDismiss?: () => void;
  className?: string;
  variant?: "default" | "compact" | "banner";
}

export function GateChangeAlert({
  flightNumber,
  oldGate,
  newGate,
  oldTerminal,
  newTerminal,
  changeReason,
  boardingTime,
  onDismiss,
  className = "",
  variant = "default",
}: GateChangeAlertProps) {
  const { t, i18n } = useTranslation();
  const currentLocale = i18n.language === "ar" ? ar : enUS;

  const formatTime = (date: Date) => {
    return format(new Date(date), "HH:mm", { locale: currentLocale });
  };

  // Compact version for inline display in flight cards
  if (variant === "compact") {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-md bg-amber-100 px-2 py-1 text-xs text-amber-800 dark:bg-amber-900 dark:text-amber-200",
          className
        )}
      >
        <AlertTriangle className="h-3 w-3" />
        <span className="font-medium">{t("gates.gateChanged")}:</span>
        <span className="line-through opacity-60">{oldGate}</span>
        <ArrowRight className="h-3 w-3" />
        <span className="font-semibold">{newGate}</span>
      </div>
    );
  }

  // Banner version for page-level notifications
  if (variant === "banner") {
    return (
      <div
        className={cn(
          "relative flex items-center justify-between gap-4 rounded-lg bg-amber-50 border border-amber-200 p-4 dark:bg-amber-950 dark:border-amber-800",
          className
        )}
      >
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-200 dark:bg-amber-800">
            <AlertTriangle className="h-5 w-5 text-amber-700 dark:text-amber-300" />
          </div>
          <div>
            <p className="font-semibold text-amber-800 dark:text-amber-200">
              {t("gates.gateChangeTitle")}
            </p>
            <p className="text-sm text-amber-700 dark:text-amber-300">
              {t("gates.gateChangeMessage", { flight: flightNumber })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 dark:bg-amber-900">
            <div className="text-center">
              <p className="text-xs text-muted-foreground">{t("gates.oldGate")}</p>
              <p className="font-mono text-lg font-bold line-through opacity-60">
                {oldGate}
              </p>
            </div>
            <ArrowRight className="h-5 w-5 text-amber-600" />
            <div className="text-center">
              <p className="text-xs text-muted-foreground">{t("gates.newGate")}</p>
              <p className="font-mono text-lg font-bold text-amber-700 dark:text-amber-300">
                {newGate}
              </p>
            </div>
          </div>
          {onDismiss && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onDismiss}
              className="h-8 w-8 text-amber-600 hover:text-amber-800"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Default full alert component
  return (
    <Alert
      variant="default"
      className={cn(
        "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950",
        className
      )}
    >
      <AlertTriangle className="h-5 w-5 text-amber-600" />
      <AlertTitle className="text-amber-800 dark:text-amber-200">
        {t("gates.gateChangeTitle")}
      </AlertTitle>
      <AlertDescription>
        <div className="mt-3 space-y-3">
          {/* Flight info */}
          <p className="text-sm text-amber-700 dark:text-amber-300">
            {t("gates.gateChangeMessage", { flight: flightNumber })}
          </p>

          {/* Gate change display */}
          <div className="flex items-center gap-4 rounded-lg bg-white p-3 dark:bg-amber-900/50">
            <div className="flex-1">
              <p className="text-xs text-muted-foreground">{t("gates.oldGate")}</p>
              <div className="flex items-center gap-2">
                <DoorOpen className="h-4 w-4 text-muted-foreground" />
                <span className="font-mono text-lg font-semibold line-through opacity-60">
                  {oldGate}
                </span>
                {oldTerminal && (
                  <Badge variant="outline" className="opacity-60">
                    <Building2 className="mr-1 h-3 w-3" />
                    {oldTerminal}
                  </Badge>
                )}
              </div>
            </div>

            <ArrowRight className="h-6 w-6 text-amber-500" />

            <div className="flex-1">
              <p className="text-xs text-muted-foreground">{t("gates.newGate")}</p>
              <div className="flex items-center gap-2">
                <DoorOpen className="h-4 w-4 text-amber-600" />
                <span className="font-mono text-lg font-bold text-amber-700 dark:text-amber-300">
                  {newGate}
                </span>
                {newTerminal && (
                  <Badge className="bg-amber-200 text-amber-800 dark:bg-amber-800 dark:text-amber-200">
                    <Building2 className="mr-1 h-3 w-3" />
                    {newTerminal}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {/* Boarding time */}
          {boardingTime && (
            <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
              <Clock className="h-4 w-4" />
              <span>
                {t("gates.boardingAt", { time: formatTime(boardingTime) })}
              </span>
            </div>
          )}

          {/* Change reason */}
          {changeReason && (
            <div className="rounded bg-amber-100 p-2 text-sm text-amber-800 dark:bg-amber-900 dark:text-amber-200">
              <span className="font-medium">{t("gates.changeReason")}: </span>
              {changeReason}
            </div>
          )}

          {/* Dismiss button */}
          {onDismiss && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={onDismiss}
                className="border-amber-300 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300"
              >
                {t("common.dismiss")}
              </Button>
            </div>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}

export default GateChangeAlert;
