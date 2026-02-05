/**
 * FlightProgress Component
 *
 * Circular progress showing flight completion with:
 * - Progress ring animation
 * - Current altitude/speed (mock data)
 * - Distance remaining
 * - Estimated time of arrival
 *
 * Features:
 * - Real-time progress updates
 * - Animated circular progress
 * - Responsive design
 */

import { useMemo, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  Plane,
  Navigation,
  Gauge,
  Mountain,
  Clock,
  MapPin,
} from "lucide-react";
import { format, differenceInMinutes } from "date-fns";
import { ar, enUS } from "date-fns/locale";

export interface FlightProgressProps {
  departureTime: Date | string;
  arrivalTime: Date | string;
  origin: string;
  destination: string;
  originCode: string;
  destinationCode: string;
  flightNumber: string;
  /** Distance in kilometers (for mock data calculations) */
  distanceKm?: number;
  /** Show detailed flight data (altitude, speed) */
  showFlightData?: boolean;
  className?: string;
}

interface FlightData {
  altitude: number; // feet
  speed: number; // km/h
  heading: number; // degrees
  distanceRemaining: number; // km
  distanceTraveled: number; // km
}

export function FlightProgress({
  departureTime,
  arrivalTime,
  origin,
  destination,
  originCode,
  destinationCode,
  flightNumber,
  distanceKm = 1500,
  showFlightData = true,
  className,
}: FlightProgressProps) {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === "ar";
  const dateLocale = isRTL ? ar : enUS;

  const [now, setNow] = useState(new Date());

  // Update current time every second for smoother animation
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const departure = useMemo(() => new Date(departureTime), [departureTime]);
  const arrival = useMemo(() => new Date(arrivalTime), [arrivalTime]);

  // Calculate progress percentage
  const progressPercent = useMemo(() => {
    const totalDuration = arrival.getTime() - departure.getTime();
    const elapsed = now.getTime() - departure.getTime();
    return Math.max(0, Math.min(100, (elapsed / totalDuration) * 100));
  }, [now, departure, arrival]);

  // Calculate flight status
  const flightStatus = useMemo(() => {
    if (now < departure) return "scheduled";
    if (now >= arrival) return "arrived";
    return "in_flight";
  }, [now, departure, arrival]);

  // Mock flight data based on progress
  const flightData = useMemo<FlightData>(() => {
    const progress = progressPercent / 100;

    // Simulate altitude curve (climb, cruise, descent)
    let altitude: number;
    if (progress < 0.15) {
      // Climbing
      altitude = Math.round((progress / 0.15) * 35000);
    } else if (progress > 0.85) {
      // Descending
      altitude = Math.round(((1 - progress) / 0.15) * 35000);
    } else {
      // Cruising
      altitude = 35000 + Math.sin(progress * Math.PI) * 2000;
    }

    // Simulate speed (varies during climb/cruise/descent)
    let speed: number;
    if (progress < 0.15 || progress > 0.85) {
      speed = 400 + Math.random() * 100;
    } else {
      speed = 850 + Math.random() * 50;
    }

    // Calculate distances
    const distanceTraveled = distanceKm * progress;
    const distanceRemaining = distanceKm - distanceTraveled;

    // Mock heading (would be calculated from actual coordinates)
    const heading = 45 + Math.sin(progress * Math.PI * 2) * 10;

    return {
      altitude: flightStatus === "in_flight" ? Math.round(altitude) : 0,
      speed: flightStatus === "in_flight" ? Math.round(speed) : 0,
      heading: Math.round(heading),
      distanceRemaining: Math.round(distanceRemaining),
      distanceTraveled: Math.round(distanceTraveled),
    };
  }, [progressPercent, distanceKm, flightStatus]);

  // Calculate ETA
  const eta = useMemo(() => {
    const minutesRemaining = differenceInMinutes(arrival, now);
    if (minutesRemaining <= 0) return null;

    if (minutesRemaining < 60) {
      return t("flightProgress.minutesRemaining", { count: minutesRemaining });
    }
    const hours = Math.floor(minutesRemaining / 60);
    const mins = minutesRemaining % 60;
    return t("flightProgress.hoursMinutesRemaining", {
      hours,
      minutes: mins,
    });
  }, [now, arrival, t]);

  // SVG circle parameters
  const size = 200;
  const strokeWidth = 12;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset =
    circumference - (progressPercent / 100) * circumference;

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Navigation className="h-5 w-5 text-primary" />
              {t("flightProgress.title")}
            </CardTitle>
            <CardDescription className="mt-1">{flightNumber}</CardDescription>
          </div>
          <motion.div
            className={cn(
              "px-3 py-1 rounded-full text-xs font-medium",
              flightStatus === "in_flight"
                ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                : flightStatus === "arrived"
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                  : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
            )}
            animate={
              flightStatus === "in_flight" ? { opacity: [1, 0.7, 1] } : {}
            }
            transition={{ duration: 2, repeat: Infinity }}
          >
            {t(`flightProgress.status.${flightStatus}`)}
          </motion.div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="flex flex-col lg:flex-row items-center gap-8">
          {/* Circular Progress */}
          <div className="relative flex-shrink-0">
            <svg width={size} height={size} className="transform -rotate-90">
              {/* Background circle */}
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke="currentColor"
                strokeWidth={strokeWidth}
                fill="none"
                className="text-slate-200 dark:text-slate-700"
              />
              {/* Progress circle */}
              <motion.circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke="url(#progressGradient)"
                strokeWidth={strokeWidth}
                fill="none"
                strokeLinecap="round"
                strokeDasharray={circumference}
                initial={{ strokeDashoffset: circumference }}
                animate={{ strokeDashoffset }}
                transition={{ duration: 1, ease: "easeOut" }}
              />
              {/* Gradient definition */}
              <defs>
                <linearGradient
                  id="progressGradient"
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="100%"
                >
                  <stop offset="0%" stopColor="#3b82f6" />
                  <stop offset="50%" stopColor="#6366f1" />
                  <stop offset="100%" stopColor="#8b5cf6" />
                </linearGradient>
              </defs>
            </svg>

            {/* Center content */}
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <motion.div
                animate={flightStatus === "in_flight" ? { y: [0, -5, 0] } : {}}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <Plane
                  className={cn(
                    "h-10 w-10 mb-2",
                    flightStatus === "in_flight"
                      ? "text-blue-500"
                      : flightStatus === "arrived"
                        ? "text-emerald-500"
                        : "text-slate-400"
                  )}
                />
              </motion.div>
              <motion.span
                className="text-3xl font-bold"
                key={Math.round(progressPercent)}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.3 }}
              >
                {Math.round(progressPercent)}%
              </motion.span>
              <span className="text-xs text-muted-foreground">
                {t("flightProgress.complete")}
              </span>
            </div>
          </div>

          {/* Flight details */}
          <div className="flex-1 space-y-4 w-full">
            {/* Route info */}
            <div className="flex items-center justify-between gap-4 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
              <div className="text-center">
                <p className="text-lg font-bold">{originCode}</p>
                <p className="text-xs text-muted-foreground">{origin}</p>
              </div>
              <div className="flex-1 relative">
                <div className="h-0.5 bg-slate-300 dark:bg-slate-600 w-full" />
                <motion.div
                  className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-blue-500 rounded-full shadow-lg"
                  style={{ left: `${progressPercent}%` }}
                  animate={{
                    scale: [1, 1.2, 1],
                  }}
                  transition={{
                    duration: 1.5,
                    repeat: Infinity,
                  }}
                />
                <Plane
                  className="absolute -top-3 text-blue-500 h-6 w-6 transform"
                  style={{
                    left: `calc(${progressPercent}% - 12px)`,
                  }}
                />
              </div>
              <div className="text-center">
                <p className="text-lg font-bold">{destinationCode}</p>
                <p className="text-xs text-muted-foreground">{destination}</p>
              </div>
            </div>

            {/* Flight data grid */}
            {showFlightData && flightStatus === "in_flight" && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <motion.div
                  className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-center"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                >
                  <Mountain className="h-5 w-5 mx-auto mb-1 text-blue-500" />
                  <p className="text-lg font-bold">
                    {flightData.altitude.toLocaleString()}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {t("flightProgress.altitudeFt")}
                  </p>
                </motion.div>

                <motion.div
                  className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-center"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <Gauge className="h-5 w-5 mx-auto mb-1 text-emerald-500" />
                  <p className="text-lg font-bold">{flightData.speed}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {t("flightProgress.speedKmh")}
                  </p>
                </motion.div>

                <motion.div
                  className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-center"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                >
                  <MapPin className="h-5 w-5 mx-auto mb-1 text-purple-500" />
                  <p className="text-lg font-bold">
                    {flightData.distanceRemaining.toLocaleString()}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {t("flightProgress.distanceKm")}
                  </p>
                </motion.div>

                <motion.div
                  className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-center"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.4 }}
                >
                  <Navigation className="h-5 w-5 mx-auto mb-1 text-amber-500" />
                  <p className="text-lg font-bold">{flightData.heading}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {t("flightProgress.headingDeg")}
                  </p>
                </motion.div>
              </div>
            )}

            {/* ETA and arrival info */}
            <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t">
              {eta && flightStatus === "in_flight" && (
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">
                    {t("flightProgress.eta")}:
                  </span>
                  <span className="font-medium text-blue-600 dark:text-blue-400">
                    {eta}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">
                  {t("flightProgress.arrivalTime")}:
                </span>
                <span className="font-medium">
                  {format(arrival, "HH:mm", { locale: dateLocale })}
                </span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default FlightProgress;
