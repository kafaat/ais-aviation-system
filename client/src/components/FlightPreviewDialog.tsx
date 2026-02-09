/**
 * FlightPreviewDialog Component
 *
 * Shows a detailed flight preview in a modal dialog.
 * Allows users to see comprehensive flight information before booking.
 */

import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { FlightStatusBadge } from "@/components/FlightStatusBadge";
import type { FlightData } from "@/components/FlightCard";
import {
  Plane,
  Clock,
  Calendar,
  Users,
  PlaneTakeoff,
  PlaneLanding,
  Armchair,
  Info,
} from "lucide-react";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";

export interface FlightPreviewDialogProps {
  flight: FlightData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FlightPreviewDialog({
  flight,
  open,
  onOpenChange,
}: FlightPreviewDialogProps) {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === "ar";
  const dateLocale = isRTL ? ar : enUS;

  if (!flight) return null;

  const formatTime = (date: Date) => {
    return format(new Date(date), "HH:mm", { locale: dateLocale });
  };

  const formatDate = (date: Date) => {
    return format(new Date(date), "EEEE, d MMMM yyyy", { locale: dateLocale });
  };

  const formatPrice = (price: number) => {
    return (price / 100).toLocaleString(isRTL ? "ar-SA" : "en-US");
  };

  const calculateDuration = (departure: Date, arrival: Date) => {
    const diff = new Date(arrival).getTime() - new Date(departure).getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return isRTL ? `${hours}س ${minutes}د` : `${hours}h ${minutes}m`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plane className="h-5 w-5 text-primary" />
            {t("flightPreview.title")}
          </DialogTitle>
          <DialogDescription>
            {flight.origin.city} → {flight.destination.city}
          </DialogDescription>
        </DialogHeader>

        {/* Airline Info */}
        <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
          {flight.airline.logo ? (
            <img
              src={flight.airline.logo}
              alt={flight.airline.name}
              className="h-14 w-14 object-contain rounded-lg"
            />
          ) : (
            <div className="h-14 w-14 rounded-lg bg-primary/10 flex items-center justify-center">
              <Plane className="h-7 w-7 text-primary" />
            </div>
          )}
          <div className="flex-1">
            <h3 className="text-lg font-semibold">{flight.airline.name}</h3>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{flight.flightNumber}</span>
              <span>•</span>
              <Badge variant="outline" className="text-xs">
                {t("search.directFlight")}
              </Badge>
            </div>
          </div>
          <FlightStatusBadge status={flight.status || "scheduled"} size="sm" />
        </div>

        {/* Flight Route Visualization */}
        <div className="p-6 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 rounded-xl">
          <div className="flex items-center justify-between">
            {/* Departure */}
            <div className="text-center flex-1">
              <PlaneTakeoff className="h-6 w-6 text-primary mx-auto mb-2" />
              <p className="text-3xl font-bold tracking-tight">
                {formatTime(flight.departureTime)}
              </p>
              <p className="text-lg font-semibold text-primary mt-1">
                {flight.origin.code}
              </p>
              <p className="text-sm text-muted-foreground">
                {flight.origin.city}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {flight.origin.name}
              </p>
            </div>

            {/* Duration & Route Line */}
            <div className="flex-1 px-4">
              <div className="relative py-4">
                <div className="border-t-2 border-dashed border-primary/40" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                  <div className="flex items-center gap-1.5 bg-white dark:bg-slate-900 px-3 py-1.5 rounded-full shadow-sm border">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm font-medium">
                      {calculateDuration(
                        flight.departureTime,
                        flight.arrivalTime
                      )}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Arrival */}
            <div className="text-center flex-1">
              <PlaneLanding className="h-6 w-6 text-primary mx-auto mb-2" />
              <p className="text-3xl font-bold tracking-tight">
                {formatTime(flight.arrivalTime)}
              </p>
              <p className="text-lg font-semibold text-primary mt-1">
                {flight.destination.code}
              </p>
              <p className="text-sm text-muted-foreground">
                {flight.destination.city}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {flight.destination.name}
              </p>
            </div>
          </div>

          {/* Date */}
          <div className="flex items-center justify-center gap-2 mt-4 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4" />
            <span>{formatDate(flight.departureTime)}</span>
          </div>
        </div>

        <Separator />

        {/* Flight Details Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
            <Info className="h-4 w-4 text-muted-foreground shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">
                {t("flightPreview.flightNumber")}
              </p>
              <p className="font-medium">{flight.flightNumber}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
            <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">
                {t("flightPreview.duration")}
              </p>
              <p className="font-medium">
                {calculateDuration(flight.departureTime, flight.arrivalTime)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
            <Plane className="h-4 w-4 text-muted-foreground shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">
                {t("flightPreview.airline")}
              </p>
              <p className="font-medium">{flight.airline.name}</p>
            </div>
          </div>
        </div>

        <Separator />

        {/* Cabin Classes / Pricing */}
        <div>
          <h4 className="font-semibold mb-3 flex items-center gap-2">
            <Armchair className="h-4 w-4" />
            {t("flightPreview.cabinClasses")}
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Economy */}
            <div
              className={`p-4 rounded-xl border-2 transition-colors ${
                flight.economyAvailable > 0
                  ? "border-primary/20 hover:border-primary/50"
                  : "border-slate-200 bg-slate-50/50 opacity-60"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <Badge variant="outline">{t("search.economy")}</Badge>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Users className="h-3 w-3" />
                  <span>
                    {flight.economyAvailable > 0
                      ? t("search.seatsAvailable", {
                          count: flight.economyAvailable,
                        })
                      : t("waitlist.soldOut")}
                  </span>
                </div>
              </div>
              <p className="text-2xl font-bold text-primary">
                {formatPrice(flight.economyPrice)}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  {t("common.currency")}
                </span>
              </p>
              {flight.economyAvailable > 0 && (
                <Button asChild className="w-full mt-3" size="sm">
                  <Link
                    href={`/booking/${flight.id}?class=economy`}
                    onClick={() => onOpenChange(false)}
                  >
                    {t("search.bookNow")}
                  </Link>
                </Button>
              )}
            </div>

            {/* Business */}
            <div
              className={`p-4 rounded-xl border-2 transition-colors ${
                flight.businessAvailable > 0
                  ? "border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 hover:border-amber-400"
                  : "border-amber-200 bg-amber-50/50 opacity-60"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <Badge
                  variant="outline"
                  className="border-amber-300 text-amber-700"
                >
                  {t("search.business")}
                </Badge>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Users className="h-3 w-3" />
                  <span>
                    {flight.businessAvailable > 0
                      ? t("search.seatsAvailable", {
                          count: flight.businessAvailable,
                        })
                      : t("waitlist.soldOut")}
                  </span>
                </div>
              </div>
              <p className="text-2xl font-bold text-amber-700">
                {formatPrice(flight.businessPrice)}{" "}
                <span className="text-sm font-normal text-amber-600">
                  {t("common.currency")}
                </span>
              </p>
              {flight.businessAvailable > 0 && (
                <Button
                  asChild
                  className="w-full mt-3 bg-amber-600 hover:bg-amber-700"
                  size="sm"
                >
                  <Link
                    href={`/booking/${flight.id}?class=business`}
                    onClick={() => onOpenChange(false)}
                  >
                    {t("search.bookNow")}
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default FlightPreviewDialog;
