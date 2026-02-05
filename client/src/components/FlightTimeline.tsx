/**
 * FlightTimeline Component
 *
 * Visual timeline showing flight phases from departure to arrival:
 * - Check-in open
 * - Boarding
 * - Departure
 * - In-flight
 * - Arrival
 *
 * Features:
 * - Current status indicator
 * - Time remaining for each phase
 * - Animated progress
 * - Responsive design
 */

import { useMemo, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "framer-motion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  Clock,
  Plane,
  PlaneTakeoff,
  PlaneLanding,
  Ticket,
  Users,
} from "lucide-react";
import { format, differenceInMinutes, isBefore } from "date-fns";
import { ar, enUS } from "date-fns/locale";

export type FlightPhase =
  | "pre_checkin"
  | "checkin_open"
  | "boarding"
  | "departed"
  | "in_flight"
  | "landing"
  | "arrived"
  | "completed";

export interface FlightTimelineProps {
  departureTime: Date | string;
  arrivalTime: Date | string;
  flightNumber: string;
  origin: string;
  destination: string;
  /** Hours before departure when check-in opens (default: 24) */
  checkInHoursBefore?: number;
  /** Minutes before departure when boarding starts (default: 45) */
  boardingMinutesBefore?: number;
  /** Current flight status override */
  currentStatus?: FlightPhase;
  className?: string;
}

interface PhaseInfo {
  id: FlightPhase;
  icon: React.ComponentType<{ className?: string }>;
  time: Date;
  labelKey: string;
}

export function FlightTimeline({
  departureTime,
  arrivalTime,
  flightNumber,
  origin,
  destination,
  checkInHoursBefore = 24,
  boardingMinutesBefore = 45,
  currentStatus,
  className,
}: FlightTimelineProps) {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === "ar";
  const dateLocale = isRTL ? ar : enUS;

  const [now, setNow] = useState(new Date());

  // Update current time every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const departure = useMemo(() => new Date(departureTime), [departureTime]);
  const arrival = useMemo(() => new Date(arrivalTime), [arrivalTime]);

  // Calculate phase times
  const phases = useMemo<PhaseInfo[]>(() => {
    const checkInOpen = new Date(
      departure.getTime() - checkInHoursBefore * 60 * 60 * 1000
    );
    const boardingStart = new Date(
      departure.getTime() - boardingMinutesBefore * 60 * 1000
    );

    return [
      {
        id: "checkin_open" as FlightPhase,
        icon: Ticket,
        time: checkInOpen,
        labelKey: "flightTimeline.checkInOpen",
      },
      {
        id: "boarding" as FlightPhase,
        icon: Users,
        time: boardingStart,
        labelKey: "flightTimeline.boarding",
      },
      {
        id: "departed" as FlightPhase,
        icon: PlaneTakeoff,
        time: departure,
        labelKey: "flightTimeline.departure",
      },
      {
        id: "in_flight" as FlightPhase,
        icon: Plane,
        time: new Date(
          departure.getTime() + (arrival.getTime() - departure.getTime()) / 2
        ),
        labelKey: "flightTimeline.inFlight",
      },
      {
        id: "arrived" as FlightPhase,
        icon: PlaneLanding,
        time: arrival,
        labelKey: "flightTimeline.arrival",
      },
    ];
  }, [departure, arrival, checkInHoursBefore, boardingMinutesBefore]);

  // Determine current phase
  const currentPhase = useMemo<FlightPhase>(() => {
    if (currentStatus) return currentStatus;

    const checkInOpen = phases[0].time;
    const boardingStart = phases[1].time;

    if (isBefore(now, checkInOpen)) return "pre_checkin";
    if (isBefore(now, boardingStart)) return "checkin_open";
    if (isBefore(now, departure)) return "boarding";
    if (isBefore(now, arrival)) return "in_flight";
    return "completed";
  }, [now, phases, departure, arrival, currentStatus]);

  // Calculate progress percentage
  const progressPercent = useMemo(() => {
    const checkInOpen = phases[0].time;
    const totalDuration = arrival.getTime() - checkInOpen.getTime();
    const elapsed = now.getTime() - checkInOpen.getTime();
    return Math.max(0, Math.min(100, (elapsed / totalDuration) * 100));
  }, [now, phases, arrival]);

  // Get time remaining for next phase
  const getTimeRemaining = (targetTime: Date) => {
    const minutes = differenceInMinutes(targetTime, now);
    if (minutes <= 0) return null;
    if (minutes < 60) {
      return t("flightTimeline.minutesRemaining", { count: minutes });
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (hours < 24) {
      return t("flightTimeline.hoursMinutesRemaining", {
        hours,
        minutes: remainingMinutes,
      });
    }
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return t("flightTimeline.daysHoursRemaining", {
      days,
      hours: remainingHours,
    });
  };

  const getPhaseStatus = (
    phase: PhaseInfo,
    _index: number
  ): "completed" | "current" | "upcoming" => {
    const phaseOrder: FlightPhase[] = [
      "pre_checkin",
      "checkin_open",
      "boarding",
      "departed",
      "in_flight",
      "arrived",
      "completed",
    ];
    const currentIndex = phaseOrder.indexOf(currentPhase);
    const phaseIndex = phaseOrder.indexOf(phase.id);

    if (phaseIndex < currentIndex) return "completed";
    if (phase.id === currentPhase) return "current";
    return "upcoming";
  };

  const getPhaseColor = (
    status: "completed" | "current" | "upcoming"
  ): string => {
    switch (status) {
      case "completed":
        return "bg-emerald-500 text-white";
      case "current":
        return "bg-blue-500 text-white";
      default:
        return "bg-slate-200 dark:bg-slate-700 text-slate-500";
    }
  };

  const getLineColor = (
    status: "completed" | "current" | "upcoming"
  ): string => {
    switch (status) {
      case "completed":
        return "bg-emerald-500";
      case "current":
        return "bg-gradient-to-r from-emerald-500 to-blue-500";
      default:
        return "bg-slate-200 dark:bg-slate-700";
    }
  };

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Plane className="h-5 w-5 text-primary" />
              {t("flightTimeline.title")}
            </CardTitle>
            <CardDescription className="mt-1">
              {flightNumber} - {origin} {t("common.to")} {destination}
            </CardDescription>
          </div>
          <Badge
            variant={
              currentPhase === "completed"
                ? "default"
                : currentPhase === "in_flight"
                  ? "secondary"
                  : "outline"
            }
            className={cn(
              "text-xs",
              currentPhase === "in_flight" &&
                "bg-blue-500 text-white animate-pulse"
            )}
          >
            {t(`flightTimeline.status.${currentPhase}`)}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="pt-4">
        {/* Progress bar */}
        <div className="relative h-2 bg-slate-200 dark:bg-slate-700 rounded-full mb-8 overflow-hidden">
          <motion.div
            className="absolute top-0 left-0 h-full bg-gradient-to-r from-emerald-500 via-blue-500 to-indigo-500 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${progressPercent}%` }}
            transition={{ duration: 1, ease: "easeOut" }}
          />
          {/* Animated pulse indicator at current progress */}
          <motion.div
            className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-blue-500 rounded-full shadow-lg"
            style={{ left: `calc(${progressPercent}% - 8px)` }}
            animate={{
              scale: [1, 1.2, 1],
              opacity: [1, 0.8, 1],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />
        </div>

        {/* Timeline phases */}
        <div className="relative">
          {/* Desktop timeline - horizontal */}
          <div className="hidden md:block">
            <div className="flex justify-between items-start relative">
              {/* Connection line */}
              <div className="absolute top-5 left-0 right-0 h-0.5 bg-slate-200 dark:bg-slate-700" />

              {phases.map((phase, index) => {
                const status = getPhaseStatus(phase, index);
                const Icon = phase.icon;
                const timeRemaining = getTimeRemaining(phase.time);

                return (
                  <motion.div
                    key={phase.id}
                    className="relative flex flex-col items-center z-10"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 }}
                  >
                    {/* Icon circle */}
                    <motion.div
                      className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center shadow-md transition-all duration-300",
                        getPhaseColor(status)
                      )}
                      whileHover={{ scale: 1.1 }}
                    >
                      {status === "completed" ? (
                        <CheckCircle2 className="h-5 w-5" />
                      ) : (
                        <Icon className="h-5 w-5" />
                      )}
                    </motion.div>

                    {/* Label */}
                    <div className="mt-3 text-center max-w-[100px]">
                      <p
                        className={cn(
                          "text-xs font-medium",
                          status === "current"
                            ? "text-blue-600 dark:text-blue-400"
                            : status === "completed"
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-muted-foreground"
                        )}
                      >
                        {t(phase.labelKey)}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {format(phase.time, "HH:mm", { locale: dateLocale })}
                      </p>
                      <AnimatePresence>
                        {status === "upcoming" && timeRemaining && (
                          <motion.p
                            className="text-[10px] text-blue-500 mt-1 font-medium"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            exit={{ opacity: 0, height: 0 }}
                          >
                            {timeRemaining}
                          </motion.p>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* Current phase indicator */}
                    {status === "current" && (
                      <motion.div
                        className="absolute -top-1 -right-1 w-3 h-3 bg-blue-500 rounded-full"
                        animate={{
                          scale: [1, 1.5, 1],
                          opacity: [1, 0.5, 1],
                        }}
                        transition={{
                          duration: 1.5,
                          repeat: Infinity,
                        }}
                      />
                    )}
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* Mobile timeline - vertical */}
          <div className="md:hidden space-y-4">
            {phases.map((phase, index) => {
              const status = getPhaseStatus(phase, index);
              const Icon = phase.icon;
              const timeRemaining = getTimeRemaining(phase.time);
              const isLast = index === phases.length - 1;

              return (
                <motion.div
                  key={phase.id}
                  className="relative flex gap-4"
                  initial={{ opacity: 0, x: isRTL ? 20 : -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                >
                  {/* Line and icon */}
                  <div className="flex flex-col items-center">
                    <motion.div
                      className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center shadow-md transition-all duration-300 z-10",
                        getPhaseColor(status)
                      )}
                      whileHover={{ scale: 1.1 }}
                    >
                      {status === "completed" ? (
                        <CheckCircle2 className="h-5 w-5" />
                      ) : (
                        <Icon className="h-5 w-5" />
                      )}
                    </motion.div>
                    {!isLast && (
                      <div
                        className={cn(
                          "w-0.5 flex-1 min-h-[40px] mt-2",
                          getLineColor(
                            getPhaseStatus(phases[index + 1], index + 1)
                          )
                        )}
                      />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 pb-4">
                    <div className="flex items-center justify-between">
                      <p
                        className={cn(
                          "font-medium",
                          status === "current"
                            ? "text-blue-600 dark:text-blue-400"
                            : status === "completed"
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-muted-foreground"
                        )}
                      >
                        {t(phase.labelKey)}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {format(phase.time, "HH:mm", { locale: dateLocale })}
                      </p>
                    </div>
                    <AnimatePresence>
                      {status === "upcoming" && timeRemaining && (
                        <motion.div
                          className="flex items-center gap-1 mt-1 text-sm text-blue-500"
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                        >
                          <Clock className="h-3 w-3" />
                          <span>{timeRemaining}</span>
                        </motion.div>
                      )}
                      {status === "current" && (
                        <motion.div
                          className="flex items-center gap-1 mt-1 text-sm text-blue-500"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                        >
                          <motion.span
                            animate={{ opacity: [1, 0.5, 1] }}
                            transition={{ duration: 1.5, repeat: Infinity }}
                          >
                            {t("flightTimeline.inProgress")}
                          </motion.span>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Flight info footer */}
        <div className="mt-6 pt-4 border-t flex items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            <span>
              {t("flightTimeline.totalDuration")}:{" "}
              <span className="font-medium text-foreground">
                {(() => {
                  const minutes = differenceInMinutes(arrival, departure);
                  const hours = Math.floor(minutes / 60);
                  const mins = minutes % 60;
                  return isRTL ? `${hours}س ${mins}د` : `${hours}h ${mins}m`;
                })()}
              </span>
            </span>
          </div>
          <div className="text-xs">
            {format(departure, "PP", { locale: dateLocale })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default FlightTimeline;
