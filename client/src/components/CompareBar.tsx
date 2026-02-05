/**
 * CompareBar Component
 *
 * Sticky bar that appears at the bottom of the screen showing:
 * - Selected flights for comparison
 * - Quick preview of each flight
 * - "Compare Now" button to navigate to comparison page
 * - Remove individual flights or clear all
 */

import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Plane, X, ArrowRight, Scale } from "lucide-react";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import { motion, AnimatePresence } from "framer-motion";
import type { FlightData } from "@/components/FlightCard";
import { MIN_FLIGHTS, MAX_FLIGHTS } from "@/contexts/FlightCompareContext";
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

interface CompareBarProps {
  selectedFlights: FlightData[];
  onRemove: (flightId: number) => void;
  onClearAll: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function CompareBar({
  selectedFlights,
  onRemove,
  onClearAll,
}: CompareBarProps) {
  const { t, i18n } = useTranslation();
  const isArabic = i18n.language === "ar";
  const currentLocale = isArabic ? ar : enUS;

  const formatTime = (date: Date) => {
    return format(new Date(date), "HH:mm", { locale: currentLocale });
  };

  const formatPrice = (price: number) => {
    return (price / 100).toLocaleString(isArabic ? "ar-SA" : "en-US");
  };

  const canCompare = selectedFlights.length >= MIN_FLIGHTS;
  const isFull = selectedFlights.length >= MAX_FLIGHTS;

  if (selectedFlights.length === 0) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 100 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 100 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur-lg border-t shadow-2xl"
      >
        <div className="container py-4">
          {/* Mobile View */}
          <div className="md:hidden">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Scale className="h-5 w-5 text-primary" />
                <span className="font-semibold">
                  {t("compare.selected", { count: selectedFlights.length })}
                </span>
                <Badge variant="secondary" className="text-xs">
                  {selectedFlights.length}/{MAX_FLIGHTS}
                </Badge>
              </div>
              <Button variant="ghost" size="sm" onClick={onClearAll}>
                {t("common.clearAll")}
              </Button>
            </div>

            {/* Scrollable flight cards */}
            <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 snap-x">
              {selectedFlights.map(flight => (
                <Card
                  key={flight.id}
                  className="flex-shrink-0 w-[200px] p-3 relative snap-start"
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-muted hover:bg-destructive hover:text-destructive-foreground"
                    onClick={() => onRemove(flight.id)}
                    aria-label={t("compare.removeFromCompare")}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                  <div className="flex items-center gap-2 mb-2">
                    {flight.airline.logo ? (
                      <img
                        src={flight.airline.logo}
                        alt={flight.airline.name}
                        className="h-6 w-6 object-contain"
                      />
                    ) : (
                      <Plane className="h-4 w-4 text-primary" />
                    )}
                    <span className="text-xs font-medium truncate">
                      {flight.flightNumber}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {flight.origin.code} - {flight.destination.code}
                  </div>
                  <div className="text-xs font-medium mt-1 text-primary">
                    {formatPrice(flight.economyPrice)} {t("common.currency")}
                  </div>
                </Card>
              ))}
            </div>

            {/* Compare button */}
            <div className="mt-3">
              {canCompare ? (
                <Button asChild className="w-full" size="lg">
                  <Link href="/compare">
                    {t("compare.compareNow")}
                    <ArrowRight
                      className={cn("h-4 w-4", isArabic ? "mr-2" : "ml-2")}
                    />
                  </Link>
                </Button>
              ) : (
                <div className="text-center text-sm text-muted-foreground py-2">
                  {t("compare.addMoreToCompare", {
                    count: MIN_FLIGHTS - selectedFlights.length,
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Desktop View */}
          <div className="hidden md:block">
            <div className="flex items-center justify-between">
              {/* Left: Selected flights */}
              <div className="flex items-center gap-4 flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Scale className="h-5 w-5 text-primary" />
                  <span className="font-semibold">
                    {t("compare.compareFlights")}
                  </span>
                  <Badge
                    variant={isFull ? "default" : "secondary"}
                    className="text-xs"
                  >
                    {selectedFlights.length}/{MAX_FLIGHTS}
                  </Badge>
                </div>

                {/* Flight pills */}
                <div className="flex gap-2 overflow-x-auto flex-1 min-w-0 py-1">
                  <AnimatePresence mode="popLayout">
                    {selectedFlights.map(flight => (
                      <motion.div
                        key={flight.id}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                        transition={{ duration: 0.2 }}
                        layout
                      >
                        <Card className="flex items-center gap-3 p-2 pr-1 flex-shrink-0 bg-muted/50">
                          <div className="flex items-center gap-2">
                            {flight.airline.logo ? (
                              <img
                                src={flight.airline.logo}
                                alt={flight.airline.name}
                                className="h-6 w-6 object-contain"
                              />
                            ) : (
                              <div className="h-6 w-6 rounded bg-primary/10 flex items-center justify-center">
                                <Plane className="h-3 w-3 text-primary" />
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="text-sm font-medium">
                                {flight.flightNumber}
                              </div>
                              <div className="text-xs text-muted-foreground flex items-center gap-1">
                                <span>{flight.origin.code}</span>
                                <ArrowRight className="h-3 w-3" />
                                <span>{flight.destination.code}</span>
                                <span className="mx-1">|</span>
                                <span>{formatTime(flight.departureTime)}</span>
                              </div>
                            </div>
                            <div className="text-sm font-semibold text-primary whitespace-nowrap">
                              {formatPrice(flight.economyPrice)}{" "}
                              <span className="text-xs font-normal">
                                {t("common.currency")}
                              </span>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 rounded-full hover:bg-destructive hover:text-destructive-foreground"
                            onClick={() => onRemove(flight.id)}
                            aria-label={t("compare.removeFromCompare")}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </Card>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </div>

              {/* Right: Actions */}
              <div className="flex items-center gap-3 flex-shrink-0 ml-4">
                <Button variant="ghost" size="sm" onClick={onClearAll}>
                  {t("common.clearAll")}
                </Button>
                {canCompare ? (
                  <Button asChild>
                    <Link href="/compare">
                      {t("compare.compareNow")}
                      <ArrowRight
                        className={cn("h-4 w-4", isArabic ? "mr-2" : "ml-2")}
                      />
                    </Link>
                  </Button>
                ) : (
                  <Button disabled>
                    {t("compare.addMoreToCompare", {
                      count: MIN_FLIGHTS - selectedFlights.length,
                    })}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

export default CompareBar;
