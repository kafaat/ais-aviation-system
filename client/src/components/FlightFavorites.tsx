/**
 * FlightFavorites Component
 * Displays user's favorited individual flights
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { FlightPreviewDialog } from "@/components/FlightPreviewDialog";
import type { FlightData } from "@/components/FlightCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Plane,
  Trash2,
  Loader2,
  Calendar,
  ArrowRight,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { ArrivalDayOffset } from "@/components/ArrivalDayOffset";
import {
  dayOffset,
  formatFlightDate,
  formatFlightTime,
} from "@/lib/flight-time";

export function FlightFavorites() {
  const { t, i18n } = useTranslation();
  const { user, isAuthenticated, loading: isLoadingAuth } = useAuth();
  const utils = trpc.useUtils();
  const [previewFlight, setPreviewFlight] = useState<FlightData | null>(null);

  const {
    data: favorites,
    isLoading,
    isFetching,
    isError,
    refetch,
  } = trpc.favorites.getFlights.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const removeFavorite = trpc.favorites.removeFlight.useMutation({
    onSuccess: async (_result, { flightId }) => {
      toast.success(t("favorites.removed"));
      await Promise.all([
        utils.favorites.getFlights.invalidate(),
        utils.favorites.isFlightFavorited.invalidate({ flightId }),
      ]);
    },
    onError: (error: { message: string }) => {
      toast.error(error.message);
    },
  });

  const formatDate = (date: Date | string, timeZone: string | null) => {
    return formatFlightDate(date, timeZone, i18n.language);
  };

  const formatPrice = (priceInCents: number) => {
    return (priceInCents / 100).toLocaleString(
      i18n.language === "ar" ? "ar-SA" : "en-US",
      {
        style: "currency",
        currency: "SAR",
        maximumFractionDigits: 0,
      }
    );
  };

  if (isLoadingAuth || (isAuthenticated && isLoading)) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!isAuthenticated) {
    return <p>{t("common.loginRequired")}</p>;
  }

  // Do not display a previous identity's cached private data during a refresh.
  const favoritesList = (favorites || []).filter(
    item => item.favorite.userId === user?.id
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Plane className="h-5 w-5 text-primary" />
            {t("favorites.savedFlights")}
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            <RefreshCw className="h-4 w-4 me-2" />
            {t("common.refresh", "Refresh")}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isError ? (
          <p role="alert">
            {t(
              "favorites.loadError",
              "Could not load saved flights. Please retry."
            )}
          </p>
        ) : favoritesList.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Plane className="h-12 w-12 mx-auto mb-4 opacity-20" />
            <p>{t("favorites.noSavedFlights")}</p>
            <p className="text-sm mt-2">{t("favorites.noSavedFlightsHint")}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {favoritesList.map(item => {
              const isPastFlight =
                new Date(item.flight.departureTime) < new Date();
              return (
                <div
                  key={item.favorite.id}
                  className={`p-4 border rounded-lg transition-colors ${
                    isPastFlight
                      ? "bg-muted/30 opacity-70"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    {/* Flight Info */}
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        {item.airline.logo ? (
                          <img
                            src={item.airline.logo}
                            alt={item.airline.name}
                            className="h-8 w-8 object-contain rounded"
                          />
                        ) : (
                          <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center">
                            <Plane className="h-4 w-4 text-primary" />
                          </div>
                        )}
                        <span className="font-semibold">
                          {item.airline.name}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {item.flight.flightNumber}
                        </Badge>
                        {isPastFlight && (
                          <Badge variant="secondary" className="text-xs">
                            {t("favorites.pastFlight")}
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-4">
                        <div className="text-center">
                          <div className="font-bold text-lg">
                            {item.origin.code}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {item.origin.city}
                          </div>
                          <div className="text-sm font-medium">
                            {formatFlightTime(
                              item.flight.departureTime,
                              item.origin.timezone
                            )}
                          </div>
                        </div>

                        <ArrowRight className="h-4 w-4 text-muted-foreground" />

                        <div className="text-center">
                          <div className="font-bold text-lg">
                            {item.destination.code}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {item.destination.city}
                          </div>
                          <div className="text-sm font-medium">
                            {formatFlightTime(
                              item.flight.arrivalTime,
                              item.destination.timezone
                            )}
                            <ArrivalDayOffset
                              offset={dayOffset(
                                item.flight.departureTime,
                                item.origin.timezone,
                                item.flight.arrivalTime,
                                item.destination.timezone
                              )}
                            />
                          </div>
                        </div>

                        <div className="ml-4 flex items-center gap-2 text-sm text-muted-foreground">
                          <Calendar className="h-4 w-4" />
                          {formatDate(
                            item.flight.departureTime,
                            item.origin.timezone
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Price and Actions */}
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">
                          {t("favorites.from")}
                        </div>
                        <div className="text-lg font-bold text-primary">
                          {formatPrice(item.flight.economyPrice)}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setPreviewFlight({
                              ...item.flight,
                              airline: item.airline,
                              origin: item.origin,
                              destination: item.destination,
                            })
                          }
                        >
                          {t("flightPreview.title")}
                        </Button>
                        {!isPastFlight && (
                          <Button asChild size="sm">
                            <Link href={`/booking/${item.flight.id}`}>
                              {t("search.bookNow")}
                            </Link>
                          </Button>
                        )}

                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            removeFavorite.mutate({ flightId: item.flight.id })
                          }
                          disabled={removeFavorite.isPending}
                          aria-label={t("favorites.removeFlight", {
                            defaultValue:
                              "Remove {{flightNumber}} from saved flights",
                            flightNumber: item.flight.flightNumber,
                          })}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          {removeFavorite.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
      <FlightPreviewDialog
        flight={previewFlight}
        open={Boolean(previewFlight)}
        onOpenChange={open => {
          if (!open) setPreviewFlight(null);
        }}
      />
    </Card>
  );
}

export default FlightFavorites;
