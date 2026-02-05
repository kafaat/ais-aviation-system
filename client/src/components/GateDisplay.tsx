/**
 * GateDisplay Component
 *
 * Displays gate information for a flight including:
 * - Gate number and terminal
 * - Boarding times
 * - Gate change indicator
 */

import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DoorOpen, Clock, AlertCircle, Building2 } from "lucide-react";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import { trpc } from "@/lib/trpc";

export interface GateDisplayProps {
  flightId: number;
  compact?: boolean;
  showBoardingTimes?: boolean;
  className?: string;
}

export function GateDisplay({
  flightId,
  compact = false,
  showBoardingTimes = true,
  className = "",
}: GateDisplayProps) {
  const { t, i18n } = useTranslation();
  const currentLocale = i18n.language === "ar" ? ar : enUS;

  const { data: gateInfo, isLoading } = trpc.gates.getFlightGate.useQuery({
    flightId,
  });

  const formatTime = (date: Date | null) => {
    if (!date) return "-";
    return format(new Date(date), "HH:mm", { locale: currentLocale });
  };

  if (isLoading) {
    return compact ? (
      <Skeleton className="h-6 w-20" />
    ) : (
      <Card className={`p-4 ${className}`}>
        <div className="space-y-2">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-4 w-32" />
        </div>
      </Card>
    );
  }

  if (!gateInfo) {
    if (compact) {
      return (
        <Badge variant="outline" className="text-muted-foreground">
          <DoorOpen className="h-3 w-3 mr-1" />
          {t("gates.notAssigned")}
        </Badge>
      );
    }

    return (
      <Card className={`p-4 ${className}`}>
        <div className="flex items-center gap-3 text-muted-foreground">
          <DoorOpen className="h-5 w-5" />
          <div>
            <p className="font-medium">{t("gates.title")}</p>
            <p className="text-sm">{t("gates.notAssigned")}</p>
          </div>
        </div>
      </Card>
    );
  }

  const hasGateChanged = gateInfo.previousGateId !== null;

  // Compact display for inline use (e.g., in flight cards)
  if (compact) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1">
            <Badge
              variant={hasGateChanged ? "destructive" : "secondary"}
              className={`${
                hasGateChanged
                  ? "bg-amber-100 text-amber-800 border-amber-300"
                  : ""
              }`}
            >
              <DoorOpen className="h-3 w-3 mr-1" />
              {gateInfo.terminal && `${gateInfo.terminal} - `}
              {gateInfo.gateNumber}
              {hasGateChanged && (
                <AlertCircle className="h-3 w-3 ml-1 text-amber-600" />
              )}
            </Badge>
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <div className="text-sm">
            <p className="font-medium">
              {t("gates.gate")}: {gateInfo.gateNumber}
            </p>
            {gateInfo.terminal && (
              <p>
                {t("gates.terminal")}: {gateInfo.terminal}
              </p>
            )}
            {gateInfo.boardingStartTime && (
              <p>
                {t("gates.boardingStarts")}:{" "}
                {formatTime(gateInfo.boardingStartTime)}
              </p>
            )}
            {hasGateChanged && (
              <p className="text-amber-600 mt-1">{t("gates.gateChanged")}</p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  // Full display for detailed views
  return (
    <Card
      className={`p-4 ${hasGateChanged ? "border-amber-300 bg-amber-50/50" : ""} ${className}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div
            className={`p-2 rounded-lg ${
              hasGateChanged ? "bg-amber-100" : "bg-primary/10"
            }`}
          >
            <DoorOpen
              className={`h-5 w-5 ${hasGateChanged ? "text-amber-600" : "text-primary"}`}
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-semibold text-lg">{gateInfo.gateNumber}</p>
              {hasGateChanged && (
                <Badge
                  variant="outline"
                  className="bg-amber-100 text-amber-800 border-amber-300 text-xs"
                >
                  <AlertCircle className="h-3 w-3 mr-1" />
                  {t("gates.changed")}
                </Badge>
              )}
            </div>
            {gateInfo.terminal && (
              <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                <Building2 className="h-3 w-3" />
                {t("gates.terminal")}: {gateInfo.terminal}
              </p>
            )}
          </div>
        </div>

        {showBoardingTimes && gateInfo.boardingStartTime && (
          <div className="text-right">
            <p className="text-xs text-muted-foreground">
              {t("gates.boardingStarts")}
            </p>
            <p className="font-medium flex items-center justify-end gap-1">
              <Clock className="h-3 w-3" />
              {formatTime(gateInfo.boardingStartTime)}
            </p>
            {gateInfo.boardingEndTime && (
              <>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("gates.boardingEnds")}
                </p>
                <p className="font-medium flex items-center justify-end gap-1">
                  <Clock className="h-3 w-3" />
                  {formatTime(gateInfo.boardingEndTime)}
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {hasGateChanged && gateInfo.changeReason && (
        <div className="mt-3 p-2 bg-amber-100 rounded text-sm text-amber-800">
          <p className="font-medium">{t("gates.changeReason")}:</p>
          <p>{gateInfo.changeReason}</p>
        </div>
      )}
    </Card>
  );
}

export default GateDisplay;
