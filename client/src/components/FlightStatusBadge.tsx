import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type {
  FlightStatusType,
  FlightStatusData,
} from "@/hooks/useFlightStatus";
import {
  Plane,
  PlaneTakeoff,
  PlaneLanding,
  Clock,
  XCircle,
  Wifi,
  WifiOff,
} from "lucide-react";

export interface FlightStatusBadgeProps {
  status: FlightStatusType;
  delayMinutes?: number;
  isLive?: boolean;
  isConnected?: boolean;
  showLabel?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

interface StatusConfig {
  icon: React.ReactNode;
  label: string;
  className: string;
  pulseColor: string;
}

/**
 * FlightStatusBadge - Displays live flight status with animated indicator
 */
export function FlightStatusBadge({
  status,
  delayMinutes,
  isLive = false,
  isConnected = true,
  showLabel = true,
  size = "md",
  className,
}: FlightStatusBadgeProps) {
  const { t } = useTranslation();

  const sizeClasses = {
    sm: "text-xs px-2 py-0.5",
    md: "text-sm px-3 py-1",
    lg: "text-base px-4 py-1.5",
  };

  const iconSizes = {
    sm: "h-3 w-3",
    md: "h-4 w-4",
    lg: "h-5 w-5",
  };

  const getStatusConfig = (statusType: FlightStatusType): StatusConfig => {
    const configs: Record<FlightStatusType, StatusConfig> = {
      scheduled: {
        icon: <Clock className={iconSizes[size]} />,
        label: t("flightStatus.scheduled"),
        className:
          "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
        pulseColor: "bg-slate-400",
      },
      boarding: {
        icon: <Plane className={iconSizes[size]} />,
        label: t("flightStatus.boarding"),
        className:
          "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800",
        pulseColor: "bg-blue-500",
      },
      departed: {
        icon: <PlaneTakeoff className={iconSizes[size]} />,
        label: t("flightStatus.departed"),
        className:
          "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800",
        pulseColor: "bg-emerald-500",
      },
      delayed: {
        icon: <Clock className={iconSizes[size]} />,
        label: delayMinutes
          ? `${t("flightStatus.delayed")} (${delayMinutes} min)`
          : t("flightStatus.delayed"),
        className:
          "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800",
        pulseColor: "bg-amber-500",
      },
      cancelled: {
        icon: <XCircle className={iconSizes[size]} />,
        label: t("flightStatus.cancelled"),
        className:
          "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800",
        pulseColor: "bg-red-500",
      },
      landed: {
        icon: <PlaneLanding className={iconSizes[size]} />,
        label: t("flightStatus.landed"),
        className:
          "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800",
        pulseColor: "bg-green-500",
      },
    };

    return configs[statusType] || configs.scheduled;
  };

  const config = getStatusConfig(status);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            "inline-flex items-center gap-1.5 font-medium border transition-all duration-200",
            sizeClasses[size],
            config.className,
            className
          )}
        >
          {/* Live indicator */}
          {isLive && (
            <span className="relative flex h-2 w-2">
              <span
                className={cn(
                  "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
                  config.pulseColor
                )}
              />
              <span
                className={cn(
                  "relative inline-flex rounded-full h-2 w-2",
                  config.pulseColor
                )}
              />
            </span>
          )}

          {/* Status icon */}
          {config.icon}

          {/* Status label */}
          {showLabel && <span>{config.label}</span>}

          {/* Connection indicator */}
          {isLive && !isConnected && (
            <WifiOff className={cn(iconSizes[size], "text-red-500 ml-1")} />
          )}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            {isLive ? (
              <>
                {isConnected ? (
                  <Wifi className="h-4 w-4 text-green-500" />
                ) : (
                  <WifiOff className="h-4 w-4 text-red-500" />
                )}
                <span className="font-medium">
                  {isConnected
                    ? t("flightStatus.live")
                    : t("flightStatus.disconnected")}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">
                {t("flightStatus.staticStatus")}
              </span>
            )}
          </div>
          <span>{config.label}</span>
          {delayMinutes && status === "delayed" && (
            <span className="text-amber-600 dark:text-amber-400">
              {t("flightStatus.delayedBy", { minutes: delayMinutes })}
            </span>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * FlightStatusIndicator - Compact live status indicator for lists
 */
export function FlightStatusIndicator({
  statusData,
  isConnected = true,
}: {
  statusData?: FlightStatusData;
  isConnected?: boolean;
}) {
  const { t } = useTranslation();

  if (!statusData) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      <FlightStatusBadge
        status={statusData.status}
        delayMinutes={statusData.delayMinutes}
        isLive={true}
        isConnected={isConnected}
        size="sm"
      />
      {statusData.gate && (
        <Badge variant="secondary" className="text-xs">
          {t("flightStatus.gate")}: {statusData.gate}
        </Badge>
      )}
    </div>
  );
}

/**
 * FlightDelayNotification - Alert banner for delayed flights
 */
export function FlightDelayNotification({
  status,
  delayMinutes,
  flightNumber,
  className,
}: {
  status: FlightStatusType;
  delayMinutes?: number;
  flightNumber: string;
  className?: string;
}) {
  const { t } = useTranslation();

  if (status !== "delayed" && status !== "cancelled") {
    return null;
  }

  const isDelayed = status === "delayed";
  const isCancelled = status === "cancelled";

  return (
    <div
      className={cn(
        "rounded-lg p-3 flex items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-300",
        isDelayed &&
          "bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-800",
        isCancelled &&
          "bg-red-50 border border-red-200 dark:bg-red-900/20 dark:border-red-800",
        className
      )}
    >
      <div
        className={cn(
          "flex-shrink-0 rounded-full p-2",
          isDelayed && "bg-amber-100 dark:bg-amber-900/30",
          isCancelled && "bg-red-100 dark:bg-red-900/30"
        )}
      >
        {isDelayed ? (
          <Clock
            className={cn("h-5 w-5", "text-amber-600 dark:text-amber-400")}
          />
        ) : (
          <XCircle
            className={cn("h-5 w-5", "text-red-600 dark:text-red-400")}
          />
        )}
      </div>
      <div className="flex-1">
        <p
          className={cn(
            "font-medium",
            isDelayed && "text-amber-800 dark:text-amber-300",
            isCancelled && "text-red-800 dark:text-red-300"
          )}
        >
          {isDelayed
            ? t("flightStatus.flightDelayed", { flightNumber })
            : t("flightStatus.flightCancelled", { flightNumber })}
        </p>
        {delayMinutes && isDelayed && (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            {t("flightStatus.delayedBy", { minutes: delayMinutes })}
          </p>
        )}
      </div>
      <div className="flex items-center gap-1">
        <span className="relative flex h-2 w-2">
          <span
            className={cn(
              "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
              isDelayed && "bg-amber-500",
              isCancelled && "bg-red-500"
            )}
          />
          <span
            className={cn(
              "relative inline-flex rounded-full h-2 w-2",
              isDelayed && "bg-amber-500",
              isCancelled && "bg-red-500"
            )}
          />
        </span>
        <span className="text-xs font-medium text-muted-foreground">
          {t("flightStatus.live")}
        </span>
      </div>
    </div>
  );
}

export default FlightStatusBadge;
