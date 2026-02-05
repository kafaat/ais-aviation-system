/**
 * FlightCard Component
 *
 * Displays flight information including:
 * - Airline details
 * - Departure and arrival times
 * - Flight duration
 * - Pricing for economy and business class
 * - Actions (favorite, share, book)
 */

import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { FlightStatusBadge } from "@/components/FlightStatusBadge";
import { Plane, Clock, Heart, Loader2, Share2 } from "lucide-react";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import type { FlightStatusType } from "@/hooks/useFlightStatus";

export interface FlightData {
  id: number;
  flightNumber: string;
  airline: {
    id: number;
    name: string;
    code: string;
    logo: string | null;
  };
  origin: {
    id: number;
    code: string;
    city: string;
    name: string;
  };
  destination: {
    id: number;
    code: string;
    city: string;
    name: string;
  };
  departureTime: Date;
  arrivalTime: Date;
  economyPrice: number;
  businessPrice: number;
  economyAvailable: number;
  businessAvailable: number;
  status: FlightStatusType;
}

export interface FlightCardProps {
  flight: FlightData;
  isFavorited?: boolean;
  onAddToFavorites?: () => void;
  onShare?: () => void;
  isFavoriteLoading?: boolean;
  liveStatus?: {
    status: FlightStatusType;
    delayMinutes?: number;
  };
  isConnected?: boolean;
}

export function FlightCard({
  flight,
  isFavorited = false,
  onAddToFavorites,
  onShare,
  isFavoriteLoading = false,
  liveStatus,
  isConnected = false,
}: FlightCardProps) {
  const { t, i18n } = useTranslation();
  const currentLocale = i18n.language === "ar" ? ar : enUS;

  const formatTime = (date: Date) => {
    return format(new Date(date), "HH:mm", { locale: currentLocale });
  };

  const formatPrice = (price: number) => {
    return (price / 100).toLocaleString(
      i18n.language === "ar" ? "ar-SA" : "en-US"
    );
  };

  const calculateDuration = (departure: Date, arrival: Date) => {
    const diff = new Date(arrival).getTime() - new Date(departure).getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return i18n.language === "ar"
      ? `${hours}س ${minutes}د`
      : `${hours}h ${minutes}m`;
  };

  const displayStatus: FlightStatusType =
    liveStatus?.status || flight.status || "scheduled";

  return (
    <Card
      className="p-6 hover:shadow-xl transition-all duration-300 border-0 bg-white/80 backdrop-blur-sm"
      role="article"
      aria-label={`${t("search.title")}: ${flight.airline.name} ${flight.flightNumber}, ${flight.origin.city} ${t("home.search.to")} ${flight.destination.city}`}
      data-testid="flight-card"
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
        {/* Airline Info */}
        <div className="lg:col-span-2" data-testid="airline-info">
          <div className="flex items-center gap-3">
            {flight.airline.logo ? (
              <img
                src={flight.airline.logo}
                alt={flight.airline.name}
                className="h-12 w-12 object-contain rounded-lg"
              />
            ) : (
              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Plane className="h-6 w-6 text-primary" aria-hidden="true" />
              </div>
            )}
            <div>
              <p className="font-semibold" data-testid="airline-name">
                {flight.airline.name}
              </p>
              <p
                className="text-sm text-muted-foreground"
                data-testid="flight-number"
              >
                {flight.flightNumber}
              </p>
              <FlightStatusBadge
                status={displayStatus}
                delayMinutes={liveStatus?.delayMinutes}
                isLive={!!liveStatus}
                isConnected={isConnected}
                size="sm"
                className="mt-1"
              />
            </div>
          </div>
        </div>

        {/* Flight Details */}
        <div className="lg:col-span-5" data-testid="flight-details">
          <div className="flex items-center justify-between">
            <div className="text-center">
              <p className="text-3xl font-bold" data-testid="departure-time">
                {formatTime(flight.departureTime)}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                <span
                  className="font-semibold text-foreground"
                  data-testid="origin-code"
                >
                  {flight.origin.code}
                </span>{" "}
                - {flight.origin.city}
              </p>
            </div>

            <div className="flex-1 px-4">
              <div className="relative">
                <div className="border-t-2 border-dashed border-primary/30"></div>
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white px-2">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-1 rounded-full">
                    <Clock className="h-3 w-3" aria-hidden="true" />
                    <span data-testid="flight-duration">
                      {calculateDuration(
                        flight.departureTime,
                        flight.arrivalTime
                      )}
                    </span>
                  </div>
                </div>
              </div>
              <p className="text-xs text-center text-muted-foreground mt-2">
                <Badge variant="outline" className="text-[10px]">
                  {t("search.directFlight")}
                </Badge>
              </p>
            </div>

            <div className="text-center">
              <p className="text-3xl font-bold" data-testid="arrival-time">
                {formatTime(flight.arrivalTime)}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                <span
                  className="font-semibold text-foreground"
                  data-testid="destination-code"
                >
                  {flight.destination.code}
                </span>{" "}
                - {flight.destination.city}
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="lg:col-span-1 flex lg:flex-col items-center justify-center gap-2">
          {onAddToFavorites && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`rounded-full ${
                    isFavorited
                      ? "text-rose-500 bg-rose-50"
                      : "hover:text-rose-500 hover:bg-rose-50"
                  }`}
                  onClick={onAddToFavorites}
                  disabled={isFavoriteLoading || isFavorited}
                  aria-label={
                    isFavorited
                      ? t("favorites.removeFromFavorites")
                      : t("favorites.addToFavorites")
                  }
                  data-testid="favorite-button"
                >
                  {isFavoriteLoading ? (
                    <Loader2
                      className="h-5 w-5 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <Heart
                      className={`h-5 w-5 ${isFavorited ? "fill-current" : ""}`}
                      aria-hidden="true"
                    />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {isFavorited
                  ? t("favorites.removeFromFavorites")
                  : t("favorites.addToFavorites")}
              </TooltipContent>
            </Tooltip>
          )}

          {onShare && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full hover:text-blue-500 hover:bg-blue-50"
                  onClick={onShare}
                  aria-label={t("common.share")}
                  data-testid="share-button"
                >
                  <Share2 className="h-5 w-5" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("common.share")}</TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Pricing */}
        <div className="lg:col-span-4" data-testid="pricing-section">
          <div className="flex flex-col sm:flex-row gap-3">
            {flight.economyAvailable > 0 && (
              <div className="flex-1" data-testid="economy-pricing">
                <div className="text-center p-4 border-2 rounded-xl hover:border-primary/50 transition-colors group">
                  <p className="text-xs text-muted-foreground mb-1">
                    {t("search.economy")}
                  </p>
                  <p
                    className="text-2xl font-bold text-primary"
                    data-testid="economy-price"
                  >
                    {formatPrice(flight.economyPrice)}{" "}
                    <span className="text-sm font-normal">
                      {t("common.currency")}
                    </span>
                  </p>
                  <p
                    className="text-xs text-muted-foreground mt-1"
                    data-testid="economy-seats"
                  >
                    {t("search.seatsAvailable", {
                      count: flight.economyAvailable,
                    })}
                  </p>
                  <Button
                    asChild
                    className="w-full mt-3 group-hover:bg-primary group-hover:text-white"
                    variant="outline"
                    size="sm"
                    data-testid="book-economy-button"
                  >
                    <Link href={`/booking/${flight.id}?class=economy`}>
                      {t("search.bookNow")}
                    </Link>
                  </Button>
                </div>
              </div>
            )}

            {flight.businessAvailable > 0 && (
              <div className="flex-1" data-testid="business-pricing">
                <div className="text-center p-4 border-2 rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200 hover:border-amber-400 transition-colors group">
                  <p className="text-xs text-amber-700 mb-1 font-medium">
                    {t("search.business")}
                  </p>
                  <p
                    className="text-2xl font-bold text-amber-700"
                    data-testid="business-price"
                  >
                    {formatPrice(flight.businessPrice)}{" "}
                    <span className="text-sm font-normal">
                      {t("common.currency")}
                    </span>
                  </p>
                  <p
                    className="text-xs text-amber-600 mt-1"
                    data-testid="business-seats"
                  >
                    {t("search.seatsAvailable", {
                      count: flight.businessAvailable,
                    })}
                  </p>
                  <Button
                    asChild
                    className="w-full mt-3 bg-amber-600 hover:bg-amber-700"
                    size="sm"
                    data-testid="book-business-button"
                  >
                    <Link href={`/booking/${flight.id}?class=business`}>
                      {t("search.bookNow")}
                    </Link>
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

export default FlightCard;
