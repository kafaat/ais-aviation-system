/**
 * LiveFlightTracking Page
 *
 * Real-time flight tracking with:
 * - Backend-powered flight data via tRPC
 * - Flight timeline visualization
 * - Flight progress indicator
 * - Telemetry data display (altitude, speed, heading)
 * - Active flights list
 */

import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, Link } from "wouter";
import { motion } from "framer-motion";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FlightTimeline } from "@/components/FlightTimeline";
import { FlightProgress } from "@/components/FlightProgress";
import {
  ChevronLeft,
  Search,
  Plane,
  MapPin,
  RefreshCw,
  Wifi,
  WifiOff,
  Gauge,
  Mountain,
  Compass,
  Thermometer,
  Wind,
  AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import { trpc } from "@/lib/trpc";

export default function LiveFlightTracking() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === "ar";
  const dateLocale = isRTL ? ar : enUS;
  const [_location] = useLocation();

  const [searchQuery, setSearchQuery] = useState("");
  const [trackedFlightNumber, setTrackedFlightNumber] = useState<string | null>(
    null
  );
  const [isConnected, _setIsConnected] = useState(true);

  // Query flight tracking data from backend
  const {
    data: trackingData,
    isLoading,
    refetch,
    isRefetching,
  } = trpc.flightTracking.trackByNumber.useQuery(
    { flightNumber: trackedFlightNumber ?? "" },
    {
      enabled: !!trackedFlightNumber,
      refetchInterval: 30000, // Refresh every 30 seconds
    }
  );

  // Active flights for quick access
  const { data: activeFlights } = trpc.flightTracking.activeFlights.useQuery(
    undefined,
    { refetchInterval: 60000 }
  );

  const handleSearch = () => {
    if (searchQuery.trim()) {
      setTrackedFlightNumber(searchQuery.trim().toUpperCase());
    }
  };

  const handleRefresh = async () => {
    await refetch();
  };

  // Quick access flights
  const sampleFlights = useMemo(() => {
    if (activeFlights && activeFlights.length > 0) {
      return activeFlights.slice(0, 3).map(f => ({
        number: f.flightNumber,
        route: `${f.origin} - ${f.destination}`,
      }));
    }
    return [
      { number: "AIS-1234", route: "JED - DXB" },
      { number: "AIS-5678", route: "RUH - CAI" },
      { number: "AIS-9012", route: "DMM - AMM" },
    ];
  }, [activeFlights]);

  const flight = trackingData?.flight;
  const position = trackingData?.currentPosition;

  const phaseLabel = (phase: string) => {
    const labels: Record<string, string> = {
      boarding: t("liveTracking.phaseBoarding"),
      taxiing: t("liveTracking.phaseTaxiing"),
      takeoff: t("liveTracking.phaseTakeoff"),
      climbing: t("liveTracking.phaseClimbing"),
      cruising: t("liveTracking.phaseCruising"),
      descending: t("liveTracking.phaseDescending"),
      approach: t("liveTracking.phaseApproach"),
      landing: t("liveTracking.phaseLanding"),
      arrived: t("liveTracking.phaseArrived"),
    };
    return labels[phase] || phase;
  };

  const turbulenceColor = (turbulence: string | null | undefined) => {
    switch (turbulence) {
      case "light":
        return "bg-yellow-100 text-yellow-700 border-yellow-200";
      case "moderate":
        return "bg-orange-100 text-orange-700 border-orange-200";
      case "severe":
        return "bg-red-100 text-red-700 border-red-200";
      default:
        return "bg-emerald-100 text-emerald-700 border-emerald-200";
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50 dark:from-slate-950 dark:via-blue-950/20 dark:to-slate-950">
      <SEO
        title={t("liveTracking.pageTitle")}
        description={t("liveTracking.pageDescription")}
      />

      {/* Header */}
      <header className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b sticky top-0 z-50 shadow-sm">
        <div className="container py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/">
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
              </Link>
              <div>
                <h1 className="text-xl font-bold bg-gradient-to-r from-slate-900 to-slate-600 dark:from-white dark:to-slate-300 bg-clip-text text-transparent">
                  {t("liveTracking.title")}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {t("liveTracking.subtitle")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isConnected ? (
                <Badge
                  variant="outline"
                  className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800"
                >
                  <Wifi className="h-3 w-3 mr-1" />
                  {t("liveTracking.connected")}
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="bg-red-50 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800"
                >
                  <WifiOff className="h-3 w-3 mr-1" />
                  {t("liveTracking.disconnected")}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="container py-8">
        {/* Search section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <Card className="border-0 shadow-lg bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Search className="h-5 w-5 text-primary" />
                {t("liveTracking.searchTitle")}
              </CardTitle>
              <CardDescription>
                {t("liveTracking.searchDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1">
                  <Input
                    placeholder={t("liveTracking.searchPlaceholder")}
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && handleSearch()}
                    className="h-12 text-lg"
                  />
                </div>
                <Button
                  onClick={handleSearch}
                  disabled={isLoading}
                  className="h-12 px-8 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
                >
                  <Search className="h-5 w-5 mr-2" />
                  {t("liveTracking.trackFlight")}
                </Button>
              </div>

              {/* Quick access flights */}
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="text-sm text-muted-foreground">
                  {t("liveTracking.quickAccess")}:
                </span>
                {sampleFlights.map(f => (
                  <Button
                    key={f.number}
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    onClick={() => {
                      setSearchQuery(f.number);
                      setTrackedFlightNumber(f.number);
                    }}
                  >
                    <Plane className="h-3 w-3 mr-1" />
                    {f.number}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Loading state */}
        {isLoading && trackedFlightNumber && (
          <div className="text-center py-16">
            <RefreshCw className="h-8 w-8 mx-auto mb-4 text-blue-500 animate-spin" />
            <p className="text-muted-foreground">
              {t("liveTracking.searching")}
            </p>
          </div>
        )}

        {/* Tracked flight display */}
        {flight && !isLoading && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="space-y-6"
          >
            {/* Flight header card */}
            <Card className="border-0 shadow-lg bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500" />
              <CardContent className="pt-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
                      <Plane className="h-8 w-8 text-white" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold">
                        {flight.flightNumber}
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {flight.aircraftType}
                      </p>
                      {position && (
                        <Badge
                          variant="outline"
                          className="mt-1 bg-blue-50 text-blue-700 border-blue-200"
                        >
                          {phaseLabel(position.phase)}
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-4">
                    <div className="text-center">
                      <p className="text-sm text-muted-foreground">
                        {t("liveTracking.departure")}
                      </p>
                      <p className="text-xl font-bold">
                        {format(new Date(flight.departureTime), "HH:mm", {
                          locale: dateLocale,
                        })}
                      </p>
                      <p className="text-sm font-medium">
                        {flight.origin.code}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 text-muted-foreground">
                      <div className="w-8 h-0.5 bg-slate-300 dark:bg-slate-600" />
                      <Plane className="h-4 w-4 rotate-90" />
                      <div className="w-8 h-0.5 bg-slate-300 dark:bg-slate-600" />
                    </div>

                    <div className="text-center">
                      <p className="text-sm text-muted-foreground">
                        {t("liveTracking.arrival")}
                      </p>
                      <p className="text-xl font-bold">
                        {format(new Date(flight.arrivalTime), "HH:mm", {
                          locale: dateLocale,
                        })}
                      </p>
                      <p className="text-sm font-medium">
                        {flight.destination.code}
                      </p>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRefresh}
                      disabled={isRefetching}
                      className="ml-4"
                    >
                      <RefreshCw
                        className={`h-4 w-4 mr-2 ${isRefetching ? "animate-spin" : ""}`}
                      />
                      {t("liveTracking.refresh")}
                    </Button>
                  </div>
                </div>

                {/* Route details */}
                <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-start gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                    <MapPin className="h-5 w-5 text-emerald-500 mt-0.5" />
                    <div>
                      <p className="font-medium">{flight.origin.city}</p>
                      <p className="text-sm text-muted-foreground">
                        {flight.origin.name}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                    <MapPin className="h-5 w-5 text-blue-500 mt-0.5" />
                    <div>
                      <p className="font-medium">{flight.destination.city}</p>
                      <p className="text-sm text-muted-foreground">
                        {flight.destination.name}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Telemetry Data */}
            {position && (
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                <Card className="border-0 shadow-md bg-white/80 dark:bg-slate-900/80 p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Mountain className="h-4 w-4 text-blue-500" />
                    <span className="text-xs text-muted-foreground">
                      {t("liveTracking.altitude")}
                    </span>
                  </div>
                  <p className="text-lg font-bold">
                    {position.altitude.toLocaleString()} ft
                  </p>
                </Card>
                <Card className="border-0 shadow-md bg-white/80 dark:bg-slate-900/80 p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Gauge className="h-4 w-4 text-indigo-500" />
                    <span className="text-xs text-muted-foreground">
                      {t("liveTracking.speed")}
                    </span>
                  </div>
                  <p className="text-lg font-bold">
                    {position.groundSpeed} kts
                  </p>
                </Card>
                <Card className="border-0 shadow-md bg-white/80 dark:bg-slate-900/80 p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Compass className="h-4 w-4 text-purple-500" />
                    <span className="text-xs text-muted-foreground">
                      {t("liveTracking.heading")}
                    </span>
                  </div>
                  <p className="text-lg font-bold">{position.heading}°</p>
                </Card>
                {position.temperature !== null && (
                  <Card className="border-0 shadow-md bg-white/80 dark:bg-slate-900/80 p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <Thermometer className="h-4 w-4 text-red-500" />
                      <span className="text-xs text-muted-foreground">
                        {t("liveTracking.temperature")}
                      </span>
                    </div>
                    <p className="text-lg font-bold">
                      {position.temperature}°C
                    </p>
                  </Card>
                )}
                {position.windSpeed !== null && (
                  <Card className="border-0 shadow-md bg-white/80 dark:bg-slate-900/80 p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <Wind className="h-4 w-4 text-cyan-500" />
                      <span className="text-xs text-muted-foreground">
                        {t("liveTracking.wind")}
                      </span>
                    </div>
                    <p className="text-lg font-bold">
                      {position.windSpeed} kts
                    </p>
                  </Card>
                )}
                {position.turbulence && position.turbulence !== "none" && (
                  <Card className="border-0 shadow-md bg-white/80 dark:bg-slate-900/80 p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      <span className="text-xs text-muted-foreground">
                        {t("liveTracking.turbulence")}
                      </span>
                    </div>
                    <Badge
                      variant="outline"
                      className={turbulenceColor(position.turbulence)}
                    >
                      {t(`liveTracking.turbulence_${position.turbulence}`)}
                    </Badge>
                  </Card>
                )}
              </div>
            )}

            {/* Flight Progress */}
            <FlightProgress
              departureTime={new Date(flight.departureTime)}
              arrivalTime={new Date(flight.arrivalTime)}
              origin={flight.origin.city}
              destination={flight.destination.city}
              originCode={flight.origin.code}
              destinationCode={flight.destination.code}
              flightNumber={flight.flightNumber}
              distanceKm={
                position?.distanceCovered && position?.distanceRemaining
                  ? position.distanceCovered + position.distanceRemaining
                  : 0
              }
              showFlightData={true}
              className="border-0 shadow-lg bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm"
            />

            {/* Flight Timeline */}
            <FlightTimeline
              departureTime={new Date(flight.departureTime)}
              arrivalTime={new Date(flight.arrivalTime)}
              flightNumber={flight.flightNumber}
              origin={flight.origin.code}
              destination={flight.destination.code}
              className="border-0 shadow-lg bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm"
            />

            {/* Flight path visualization */}
            <Card className="border-0 shadow-lg bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm overflow-hidden">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-primary" />
                  {t("liveTracking.flightPath")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="relative aspect-[16/9] bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl overflow-hidden">
                  <svg
                    className="absolute inset-0 w-full h-full"
                    viewBox="0 0 100 50"
                    preserveAspectRatio="none"
                  >
                    <path
                      d="M 10 40 Q 50 5 90 40"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="0.5"
                      className="text-blue-400 dark:text-blue-600"
                      strokeDasharray="2 2"
                    />
                    <circle
                      cx="10"
                      cy="40"
                      r="2"
                      className="fill-emerald-500"
                    />
                    <circle cx="90" cy="40" r="2" className="fill-blue-500" />
                    <motion.g
                      initial={{ offsetDistance: "0%" }}
                      animate={{
                        offsetDistance: `${position?.progressPercent ?? 40}%`,
                      }}
                      transition={{ duration: 2, ease: "easeOut" }}
                      style={{
                        offsetPath: "path('M 10 40 Q 50 5 90 40')",
                      }}
                    >
                      <circle r="1.5" className="fill-blue-600" />
                    </motion.g>
                  </svg>
                  <div className="absolute bottom-4 left-4 px-3 py-1 bg-white/90 dark:bg-slate-800/90 rounded-lg text-sm font-medium">
                    {flight.origin.code}
                  </div>
                  <div className="absolute bottom-4 right-4 px-3 py-1 bg-white/90 dark:bg-slate-800/90 rounded-lg text-sm font-medium">
                    {flight.destination.code}
                  </div>
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
                    <motion.div
                      animate={{ y: [0, -5, 0] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    >
                      <Plane className="h-8 w-8 mx-auto text-blue-600 rotate-45" />
                    </motion.div>
                    {position?.distanceCovered != null &&
                      position?.distanceRemaining != null && (
                        <p className="mt-2 text-sm font-medium bg-white/90 dark:bg-slate-800/90 px-3 py-1 rounded-lg">
                          {(
                            position.distanceCovered +
                            position.distanceRemaining
                          ).toLocaleString()}{" "}
                          km
                        </p>
                      )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Empty state */}
        {!flight && !isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="text-center py-16"
          >
            <div className="w-24 h-24 mx-auto mb-6 rounded-3xl bg-gradient-to-br from-blue-500/10 to-indigo-500/10 flex items-center justify-center">
              <Plane className="h-12 w-12 text-blue-500" />
            </div>
            <h3 className="text-xl font-semibold mb-2">
              {t("liveTracking.noFlightTracked")}
            </h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              {t("liveTracking.noFlightTrackedDesc")}
            </p>
          </motion.div>
        )}
      </div>
    </div>
  );
}
