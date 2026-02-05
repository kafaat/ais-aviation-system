/**
 * FlightFavorites Component
 * Displays user's favorited individual flights
 */

import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plane, Trash2, Loader2, Calendar, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";

export function FlightFavorites() {
  const { t, i18n } = useTranslation();
  const currentLocale = i18n.language === "ar" ? ar : enUS;

  const {
    data: favorites,
    isLoading,
    refetch,
  } = trpc.favorites.getFlights.useQuery();

  const removeFavorite = trpc.favorites.removeFlight.useMutation({
    onSuccess: () => {
      toast.success(t("favorites.removed"));
      refetch();
    },
    onError: (error: { message: string }) => {
      toast.error(error.message);
    },
  });

  const formatTime = (date: Date | string) => {
    return format(new Date(date), "HH:mm", { locale: currentLocale });
  };

  const formatDate = (date: Date | string) => {
    return format(new Date(date), "d MMM yyyy", { locale: currentLocale });
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

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const favoritesList = favorites || [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plane className="h-5 w-5 text-primary" />
          {t("favorites.savedFlights")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {favoritesList.length === 0 ? (
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
                            {formatTime(item.flight.departureTime)}
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
                            {formatTime(item.flight.arrivalTime)}
                          </div>
                        </div>

                        <div className="ml-4 flex items-center gap-2 text-sm text-muted-foreground">
                          <Calendar className="h-4 w-4" />
                          {formatDate(item.flight.departureTime)}
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
    </Card>
  );
}

export default FlightFavorites;
