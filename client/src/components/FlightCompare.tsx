/**
 * FlightCompare Component
 *
 * Side-by-side comparison of 2-4 flights showing:
 * - Price (highlighting lowest)
 * - Duration (highlighting shortest)
 * - Departure/arrival times
 * - Stops
 * - Baggage allowance
 * - Cabin class
 * - Amenities
 */

import { useMemo } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Plane,
  Clock,
  X,
  Luggage,
  Utensils,
  Wifi,
  Armchair,
  Star,
  TrendingDown,
  Timer,
} from "lucide-react";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import type { FlightData } from "@/components/FlightCard";
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

interface FlightCompareProps {
  flights: FlightData[];
  onRemove: (flightId: number) => void;
  onClearAll: () => void;
}

interface ComparisonRow {
  label: string;
  key: string;
  getValue: (flight: FlightData) => string | number | boolean | null;
  format?: (value: string | number | boolean | null) => React.ReactNode;
  highlight?: "lowest" | "highest" | "shortest";
  icon?: React.ReactNode;
}

// ============================================================================
// Helper Functions
// ============================================================================

function calculateDurationMinutes(departure: Date, arrival: Date): number {
  return (
    (new Date(arrival).getTime() - new Date(departure).getTime()) / (1000 * 60)
  );
}

function formatDuration(minutes: number, isArabic: boolean): string {
  const hours = Math.floor(minutes / 60);
  const mins = Math.floor(minutes % 60);
  return isArabic ? `${hours}س ${mins}د` : `${hours}h ${mins}m`;
}

// ============================================================================
// Component
// ============================================================================

export function FlightCompare({
  flights,
  onRemove,
  onClearAll,
}: FlightCompareProps) {
  const { t, i18n } = useTranslation();
  const isArabic = i18n.language === "ar";
  const currentLocale = isArabic ? ar : enUS;

  const formatTime = (date: Date) => {
    return format(new Date(date), "HH:mm", { locale: currentLocale });
  };

  const formatDate = (date: Date) => {
    return format(new Date(date), "PP", { locale: currentLocale });
  };

  const formatPrice = (price: number) => {
    return (price / 100).toLocaleString(isArabic ? "ar-SA" : "en-US");
  };

  // Calculate best values for highlighting
  const bestValues = useMemo(() => {
    const economyPrices = flights.map(f => f.economyPrice);
    const businessPrices = flights.map(f => f.businessPrice);
    const durations = flights.map(f =>
      calculateDurationMinutes(f.departureTime, f.arrivalTime)
    );

    return {
      lowestEconomyPrice: Math.min(...economyPrices),
      lowestBusinessPrice: Math.min(...businessPrices),
      shortestDuration: Math.min(...durations),
    };
  }, [flights]);

  // Check if value is the best
  const isBestEconomyPrice = (flight: FlightData) =>
    flight.economyPrice === bestValues.lowestEconomyPrice;
  const isBestBusinessPrice = (flight: FlightData) =>
    flight.businessPrice === bestValues.lowestBusinessPrice;
  const isShortestDuration = (flight: FlightData) =>
    calculateDurationMinutes(flight.departureTime, flight.arrivalTime) ===
    bestValues.shortestDuration;

  if (flights.length === 0) {
    return null;
  }

  // Comparison rows configuration
  const comparisonRows: ComparisonRow[] = [
    {
      label: t("compare.route"),
      key: "route",
      icon: <Plane className="h-4 w-4" />,
      getValue: f => `${f.origin.code} - ${f.destination.code}`,
    },
    {
      label: t("compare.airline"),
      key: "airline",
      getValue: f => f.airline.name,
    },
    {
      label: t("compare.flightNumber"),
      key: "flightNumber",
      getValue: f => f.flightNumber,
    },
    {
      label: t("compare.departure"),
      key: "departure",
      icon: <Clock className="h-4 w-4" />,
      getValue: f => f.departureTime.toString(),
      format: v => {
        if (!v) return "-";
        const date = new Date(v as string);
        return (
          <div>
            <div className="font-semibold">{formatTime(date)}</div>
            <div className="text-xs text-muted-foreground">
              {formatDate(date)}
            </div>
          </div>
        );
      },
    },
    {
      label: t("compare.arrival"),
      key: "arrival",
      getValue: f => f.arrivalTime.toString(),
      format: v => {
        if (!v) return "-";
        const date = new Date(v as string);
        return (
          <div>
            <div className="font-semibold">{formatTime(date)}</div>
            <div className="text-xs text-muted-foreground">
              {formatDate(date)}
            </div>
          </div>
        );
      },
    },
    {
      label: t("compare.duration"),
      key: "duration",
      icon: <Timer className="h-4 w-4" />,
      getValue: f => calculateDurationMinutes(f.departureTime, f.arrivalTime),
      format: v => formatDuration(v as number, isArabic),
      highlight: "shortest",
    },
    {
      label: t("compare.stops"),
      key: "stops",
      getValue: () => 0, // All flights are direct in current implementation
      format: () => (
        <Badge variant="outline" className="text-xs">
          {t("search.directFlight")}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">{t("compare.title")}</h2>
          <p className="text-muted-foreground">
            {t("compare.comparing", { count: flights.length })}
          </p>
        </div>
        <Button variant="outline" onClick={onClearAll}>
          {t("common.clearAll")}
        </Button>
      </div>

      {/* Comparison Table */}
      <div className="overflow-x-auto">
        <div className="min-w-[800px]">
          {/* Flight Headers */}
          <div
            className="grid gap-4"
            style={{
              gridTemplateColumns: `200px repeat(${flights.length}, 1fr)`,
            }}
          >
            <div className="p-4" /> {/* Empty corner cell */}
            {flights.map(flight => (
              <Card key={flight.id} className="relative">
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-2 right-2 h-6 w-6 z-10"
                  onClick={() => onRemove(flight.id)}
                  aria-label={t("compare.removeFromCompare")}
                >
                  <X className="h-4 w-4" />
                </Button>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-3">
                    {flight.airline.logo ? (
                      <img
                        src={flight.airline.logo}
                        alt={flight.airline.name}
                        className="h-10 w-10 object-contain rounded-lg"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Plane className="h-5 w-5 text-primary" />
                      </div>
                    )}
                    <div>
                      <CardTitle className="text-base">
                        {flight.flightNumber}
                      </CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {flight.airline.name}
                      </p>
                    </div>
                  </div>
                </CardHeader>
              </Card>
            ))}
          </div>

          {/* Comparison Rows */}
          <div className="mt-4 border rounded-lg overflow-hidden">
            {comparisonRows.map((row, idx) => (
              <div
                key={row.key}
                className={cn(
                  "grid gap-4 items-center",
                  idx % 2 === 0 ? "bg-muted/30" : "bg-background"
                )}
                style={{
                  gridTemplateColumns: `200px repeat(${flights.length}, 1fr)`,
                }}
              >
                <div className="p-4 font-medium flex items-center gap-2">
                  {row.icon}
                  {row.label}
                </div>
                {flights.map(flight => {
                  const value = row.getValue(flight);
                  const isHighlighted =
                    row.key === "duration" && isShortestDuration(flight);

                  return (
                    <div
                      key={flight.id}
                      className={cn(
                        "p-4 text-center",
                        isHighlighted &&
                          "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400"
                      )}
                    >
                      {isHighlighted && (
                        <Badge
                          variant="secondary"
                          className="mb-1 bg-green-100 text-green-700 text-[10px]"
                        >
                          <Timer className="h-3 w-3 me-1" />
                          {t("compare.shortest")}
                        </Badge>
                      )}
                      <div>
                        {row.format
                          ? row.format(value)
                          : (value as React.ReactNode)}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            {/* Economy Price Row */}
            <div
              className="grid gap-4 items-center bg-muted/30"
              style={{
                gridTemplateColumns: `200px repeat(${flights.length}, 1fr)`,
              }}
            >
              <div className="p-4 font-medium flex items-center gap-2">
                <TrendingDown className="h-4 w-4" />
                {t("compare.economyPrice")}
              </div>
              {flights.map(flight => {
                const isBest = isBestEconomyPrice(flight);
                return (
                  <div
                    key={flight.id}
                    className={cn(
                      "p-4 text-center",
                      isBest &&
                        "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400"
                    )}
                  >
                    {isBest && (
                      <Badge
                        variant="secondary"
                        className="mb-1 bg-green-100 text-green-700 text-[10px]"
                      >
                        <Star className="h-3 w-3 me-1" />
                        {t("compare.bestPrice")}
                      </Badge>
                    )}
                    <div className="text-xl font-bold">
                      {formatPrice(flight.economyPrice)}{" "}
                      <span className="text-sm font-normal">
                        {t("common.currency")}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {flight.economyAvailable > 0 ? (
                        t("search.seatsAvailable", {
                          count: flight.economyAvailable,
                        })
                      ) : (
                        <span className="text-destructive">
                          {t("compare.soldOut")}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Business Price Row */}
            <div
              className="grid gap-4 items-center bg-background"
              style={{
                gridTemplateColumns: `200px repeat(${flights.length}, 1fr)`,
              }}
            >
              <div className="p-4 font-medium flex items-center gap-2">
                <Star className="h-4 w-4" />
                {t("compare.businessPrice")}
              </div>
              {flights.map(flight => {
                const isBest = isBestBusinessPrice(flight);
                return (
                  <div
                    key={flight.id}
                    className={cn(
                      "p-4 text-center",
                      isBest &&
                        "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400"
                    )}
                  >
                    {isBest && (
                      <Badge
                        variant="secondary"
                        className="mb-1 bg-amber-100 text-amber-700 text-[10px]"
                      >
                        <Star className="h-3 w-3 me-1" />
                        {t("compare.bestPrice")}
                      </Badge>
                    )}
                    <div className="text-xl font-bold text-amber-700 dark:text-amber-400">
                      {formatPrice(flight.businessPrice)}{" "}
                      <span className="text-sm font-normal">
                        {t("common.currency")}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {flight.businessAvailable > 0 ? (
                        t("search.seatsAvailable", {
                          count: flight.businessAvailable,
                        })
                      ) : (
                        <span className="text-destructive">
                          {t("compare.soldOut")}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Amenities Row */}
            <div
              className="grid gap-4 items-center bg-muted/30"
              style={{
                gridTemplateColumns: `200px repeat(${flights.length}, 1fr)`,
              }}
            >
              <div className="p-4 font-medium">{t("compare.amenities")}</div>
              {flights.map(flight => (
                <div key={flight.id} className="p-4">
                  <div className="flex flex-wrap gap-2 justify-center">
                    <Badge variant="outline" className="text-xs">
                      <Luggage className="h-3 w-3 me-1" />
                      {t("compare.baggage")}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      <Utensils className="h-3 w-3 me-1" />
                      {t("compare.meals")}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      <Wifi className="h-3 w-3 me-1" />
                      {t("compare.wifi")}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      <Armchair className="h-3 w-3 me-1" />
                      {t("compare.seatSelection")}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>

            {/* Baggage Allowance Row */}
            <div
              className="grid gap-4 items-center bg-background"
              style={{
                gridTemplateColumns: `200px repeat(${flights.length}, 1fr)`,
              }}
            >
              <div className="p-4 font-medium flex items-center gap-2">
                <Luggage className="h-4 w-4" />
                {t("compare.baggageAllowance")}
              </div>
              {flights.map(flight => (
                <div key={flight.id} className="p-4 text-center">
                  <div className="space-y-1">
                    <div className="text-sm">
                      <span className="font-medium">
                        {t("search.economy")}:
                      </span>{" "}
                      23kg + 7kg
                    </div>
                    <div className="text-sm">
                      <span className="font-medium">
                        {t("search.business")}:
                      </span>{" "}
                      32kg + 10kg
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Book Now Row */}
            <div
              className="grid gap-4 items-center bg-muted/30"
              style={{
                gridTemplateColumns: `200px repeat(${flights.length}, 1fr)`,
              }}
            >
              <div className="p-4 font-medium">{t("compare.bookFlight")}</div>
              {flights.map(flight => (
                <div key={flight.id} className="p-4">
                  <div className="flex flex-col gap-2">
                    {flight.economyAvailable > 0 && (
                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="w-full"
                      >
                        <Link href={`/booking/${flight.id}?class=economy`}>
                          {t("search.economy")} -{" "}
                          {formatPrice(flight.economyPrice)}{" "}
                          {t("common.currency")}
                        </Link>
                      </Button>
                    )}
                    {flight.businessAvailable > 0 && (
                      <Button
                        asChild
                        size="sm"
                        className="w-full bg-amber-600 hover:bg-amber-700"
                      >
                        <Link href={`/booking/${flight.id}?class=business`}>
                          {t("search.business")} -{" "}
                          {formatPrice(flight.businessPrice)}{" "}
                          {t("common.currency")}
                        </Link>
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default FlightCompare;
