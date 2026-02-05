/**
 * LiveFlightTracking Page
 *
 * A page for tracking flights in real-time with:
 * - Flight timeline visualization
 * - Flight progress indicator
 * - Mock live flight data
 * - Responsive design
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
} from "lucide-react";
import { format, addHours, subHours } from "date-fns";
import { ar, enUS } from "date-fns/locale";

// Mock flight data for demonstration
const getMockFlight = (flightNumber: string) => {
  const now = new Date();
  // Create a flight that's currently in progress
  const departure = subHours(now, 2);
  const arrival = addHours(now, 3);

  return {
    id: 1,
    flightNumber: flightNumber || "AIS-1234",
    airline: {
      name: "AIS Airlines",
      code: "AIS",
      logo: null,
    },
    origin: {
      code: "JED",
      city: "Jeddah",
      name: "King Abdulaziz International Airport",
    },
    destination: {
      code: "DXB",
      city: "Dubai",
      name: "Dubai International Airport",
    },
    departureTime: departure,
    arrivalTime: arrival,
    status: "in_flight" as const,
    aircraft: "Boeing 787-9 Dreamliner",
    distanceKm: 1920,
  };
};

export default function LiveFlightTracking() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === "ar";
  const dateLocale = isRTL ? ar : enUS;
  const [_location] = useLocation();

  const [searchQuery, setSearchQuery] = useState("");
  const [trackedFlight, setTrackedFlight] = useState<ReturnType<
    typeof getMockFlight
  > | null>(null);
  const [isConnected, _setIsConnected] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleSearch = () => {
    if (searchQuery.trim()) {
      setTrackedFlight(getMockFlight(searchQuery.trim().toUpperCase()));
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    // Simulate refresh
    await new Promise(resolve => setTimeout(resolve, 1500));
    if (trackedFlight) {
      setTrackedFlight(getMockFlight(trackedFlight.flightNumber));
    }
    setIsRefreshing(false);
  };

  // Sample flights for quick access
  const sampleFlights = useMemo(
    () => [
      { number: "AIS-1234", route: "JED - DXB" },
      { number: "AIS-5678", route: "RUH - CAI" },
      { number: "AIS-9012", route: "DMM - AMM" },
    ],
    []
  );

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
                {sampleFlights.map(flight => (
                  <Button
                    key={flight.number}
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    onClick={() => {
                      setSearchQuery(flight.number);
                      setTrackedFlight(getMockFlight(flight.number));
                    }}
                  >
                    <Plane className="h-3 w-3 mr-1" />
                    {flight.number}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Tracked flight display */}
        {trackedFlight && (
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
                        {trackedFlight.flightNumber}
                      </h2>
                      <p className="text-muted-foreground">
                        {trackedFlight.airline.name}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {trackedFlight.aircraft}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-4">
                    <div className="text-center">
                      <p className="text-sm text-muted-foreground">
                        {t("liveTracking.departure")}
                      </p>
                      <p className="text-xl font-bold">
                        {format(trackedFlight.departureTime, "HH:mm", {
                          locale: dateLocale,
                        })}
                      </p>
                      <p className="text-sm font-medium">
                        {trackedFlight.origin.code}
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
                        {format(trackedFlight.arrivalTime, "HH:mm", {
                          locale: dateLocale,
                        })}
                      </p>
                      <p className="text-sm font-medium">
                        {trackedFlight.destination.code}
                      </p>
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRefresh}
                      disabled={isRefreshing}
                      className="ml-4"
                    >
                      <RefreshCw
                        className={`h-4 w-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`}
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
                      <p className="font-medium">{trackedFlight.origin.city}</p>
                      <p className="text-sm text-muted-foreground">
                        {trackedFlight.origin.name}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                    <MapPin className="h-5 w-5 text-blue-500 mt-0.5" />
                    <div>
                      <p className="font-medium">
                        {trackedFlight.destination.city}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {trackedFlight.destination.name}
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Flight Progress */}
            <FlightProgress
              departureTime={trackedFlight.departureTime}
              arrivalTime={trackedFlight.arrivalTime}
              origin={trackedFlight.origin.city}
              destination={trackedFlight.destination.city}
              originCode={trackedFlight.origin.code}
              destinationCode={trackedFlight.destination.code}
              flightNumber={trackedFlight.flightNumber}
              distanceKm={trackedFlight.distanceKm}
              showFlightData={true}
              className="border-0 shadow-lg bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm"
            />

            {/* Flight Timeline */}
            <FlightTimeline
              departureTime={trackedFlight.departureTime}
              arrivalTime={trackedFlight.arrivalTime}
              flightNumber={trackedFlight.flightNumber}
              origin={trackedFlight.origin.code}
              destination={trackedFlight.destination.code}
              className="border-0 shadow-lg bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm"
            />

            {/* Mock map placeholder */}
            <Card className="border-0 shadow-lg bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm overflow-hidden">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-primary" />
                  {t("liveTracking.flightPath")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="relative aspect-[16/9] bg-gradient-to-br from-blue-100 to-indigo-100 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl overflow-hidden">
                  {/* Mock flight path visualization */}
                  <svg
                    className="absolute inset-0 w-full h-full"
                    viewBox="0 0 100 50"
                    preserveAspectRatio="none"
                  >
                    {/* Flight path curve */}
                    <path
                      d="M 10 40 Q 50 5 90 40"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="0.5"
                      className="text-blue-400 dark:text-blue-600"
                      strokeDasharray="2 2"
                    />
                    {/* Origin marker */}
                    <circle
                      cx="10"
                      cy="40"
                      r="2"
                      className="fill-emerald-500"
                    />
                    {/* Destination marker */}
                    <circle cx="90" cy="40" r="2" className="fill-blue-500" />
                    {/* Plane position (animated) */}
                    <motion.g
                      initial={{ offsetDistance: "0%" }}
                      animate={{ offsetDistance: "40%" }}
                      transition={{ duration: 2, ease: "easeOut" }}
                      style={{
                        offsetPath: "path('M 10 40 Q 50 5 90 40')",
                      }}
                    >
                      <circle r="1.5" className="fill-blue-600" />
                    </motion.g>
                  </svg>
                  {/* Labels */}
                  <div className="absolute bottom-4 left-4 px-3 py-1 bg-white/90 dark:bg-slate-800/90 rounded-lg text-sm font-medium">
                    {trackedFlight.origin.code}
                  </div>
                  <div className="absolute bottom-4 right-4 px-3 py-1 bg-white/90 dark:bg-slate-800/90 rounded-lg text-sm font-medium">
                    {trackedFlight.destination.code}
                  </div>
                  {/* Center info */}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
                    <motion.div
                      animate={{ y: [0, -5, 0] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    >
                      <Plane className="h-8 w-8 mx-auto text-blue-600 rotate-45" />
                    </motion.div>
                    <p className="mt-2 text-sm font-medium bg-white/90 dark:bg-slate-800/90 px-3 py-1 rounded-lg">
                      {trackedFlight.distanceKm.toLocaleString()} km
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Empty state */}
        {!trackedFlight && (
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
