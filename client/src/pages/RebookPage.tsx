import { useRoute, useLocation, Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronLeft,
  Plane,
  Clock,
  Users,
  MapPin,
  RefreshCw,
  ArrowRight,
  Calendar,
  Ticket,
  Zap,
} from "lucide-react";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";

export default function RebookPage() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === "ar";
  const dateLocale = isRTL ? ar : enUS;
  const [, params] = useRoute("/rebook/:bookingId");
  const [, navigate] = useLocation();
  const { isAuthenticated, loading: authLoading } = useAuth();

  const bookingId = params?.bookingId ? parseInt(params.bookingId) : 0;

  // Fetch rebooking data from previous booking
  const {
    data: rebookData,
    isLoading,
    error,
  } = trpc.rebooking.getRebookData.useQuery(
    { bookingId },
    { enabled: isAuthenticated && bookingId > 0 }
  );

  // Search for available flights on the same route
  const { data: availableFlights, isLoading: flightsLoading } =
    trpc.rebooking.searchFlights.useQuery(
      {
        originId: rebookData?.route.originId ?? 0,
        destinationId: rebookData?.route.destinationId ?? 0,
        cabinClass: rebookData?.cabinClass ?? "economy",
      },
      { enabled: !!rebookData }
    );

  // Quick rebook mutation
  const quickRebookMutation = trpc.rebooking.quickRebook.useMutation({
    onSuccess: () => {
      navigate(`/my-bookings`);
    },
  });

  const handleSelectFlight = (flightId: number) => {
    navigate(
      `/booking/${flightId}?class=${rebookData?.cabinClass}&rebook=${bookingId}`
    );
  };

  const handleQuickRebook = (flightId: number) => {
    quickRebookMutation.mutate({
      bookingId,
      newFlightId: flightId,
    });
  };

  const calculateDuration = (
    departure: Date | string,
    arrival: Date | string
  ) => {
    const diff = new Date(arrival).getTime() - new Date(departure).getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return isRTL ? `${hours}س ${minutes}د` : `${hours}h ${minutes}m`;
  };

  // Loading state
  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50 dark:from-slate-950 dark:via-blue-950/20 dark:to-slate-950">
        <SEO title={t("rebook.title")} />
        <header className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b sticky top-0 z-50">
          <div className="container py-4">
            <div className="flex items-center gap-4">
              <Skeleton className="h-10 w-10 rounded-lg" />
              <div className="space-y-2">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-64" />
              </div>
            </div>
          </div>
        </header>
        <div className="container py-8 space-y-4">
          <Skeleton className="h-32 w-full rounded-xl" />
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  // Not authenticated
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50 dark:from-slate-950 dark:via-blue-950/20 dark:to-slate-950 flex items-center justify-center p-4">
        <SEO title={t("rebook.title")} />
        <Card className="p-8 text-center max-w-md shadow-xl border-0">
          <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg">
            <Ticket className="h-8 w-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold mb-2">
            {t("myBookings.loginRequired")}
          </h2>
          <p className="text-muted-foreground mb-6">
            {t("myBookings.loginRequiredDesc")}
          </p>
          <Button asChild className="w-full">
            <a href="/login">{t("common.login")}</a>
          </Button>
        </Card>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50 dark:from-slate-950 dark:via-blue-950/20 dark:to-slate-950 flex items-center justify-center p-4">
        <SEO title={t("rebook.title")} />
        <Card className="p-8 text-center max-w-md shadow-xl border-0">
          <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <Plane className="h-8 w-8 text-red-600 dark:text-red-400" />
          </div>
          <h2 className="text-2xl font-bold mb-2">{t("common.error")}</h2>
          <p className="text-muted-foreground mb-6">{error.message}</p>
          <Button asChild variant="outline">
            <Link href="/my-bookings">{t("common.back")}</Link>
          </Button>
        </Card>
      </div>
    );
  }

  if (!rebookData) return null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50 dark:from-slate-950 dark:via-blue-950/20 dark:to-slate-950">
      <SEO
        title={`${t("rebook.title")} - ${rebookData.route.originCity} → ${rebookData.route.destinationCity}`}
        description={t("rebook.subtitle")}
      />

      {/* Header */}
      <header className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b sticky top-0 z-50 shadow-sm">
        <div className="container py-4">
          <div className="flex items-center gap-4">
            <Link href="/my-bookings">
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
                {t("rebook.title")}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t("rebook.subtitle")}
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="container py-8 space-y-6">
        {/* Previous Booking Info */}
        <Card className="overflow-hidden border-0 shadow-md bg-white dark:bg-slate-900">
          <div className="h-1 bg-gradient-to-r from-blue-400 to-indigo-600" />
          <div className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                <RefreshCw className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <h2 className="font-bold text-lg">
                  {t("rebook.previousBooking")}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t("rebook.ref")}: {rebookData.originalBookingRef}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Route */}
              <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                <MapPin className="h-5 w-5 text-blue-500" />
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">
                    {t("rebook.route")}
                  </p>
                  <p className="font-semibold">
                    {rebookData.route.originCode}{" "}
                    <ArrowRight className="inline h-3 w-3 mx-1" />{" "}
                    {rebookData.route.destinationCode}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {rebookData.route.originCity} →{" "}
                    {rebookData.route.destinationCity}
                  </p>
                </div>
              </div>

              {/* Passengers */}
              <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                <Users className="h-5 w-5 text-purple-500" />
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">
                    {t("rebook.passengers")}
                  </p>
                  <p className="font-semibold">
                    {rebookData.passengers.length}{" "}
                    {t("rebook.passengerCount", {
                      count: rebookData.passengers.length,
                    })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {rebookData.passengers
                      .map(p => `${p.firstName} ${p.lastName}`)
                      .join(", ")}
                  </p>
                </div>
              </div>

              {/* Cabin Class */}
              <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl">
                <Plane className="h-5 w-5 text-emerald-500" />
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wider">
                    {t("rebook.cabinClass")}
                  </p>
                  <p className="font-semibold">
                    {rebookData.cabinClass === "economy"
                      ? t("search.economy")
                      : t("search.business")}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* Available Flights */}
        <div>
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <Calendar className="h-5 w-5 text-blue-500" />
            {t("rebook.availableFlights")}
          </h2>

          {flightsLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-32 w-full rounded-xl" />
              ))}
            </div>
          ) : !availableFlights || availableFlights.length === 0 ? (
            <Card className="p-12 text-center border-dashed border-2 bg-white/50 dark:bg-slate-900/50">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <Plane className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">
                {t("rebook.noFlights")}
              </h3>
              <p className="text-muted-foreground mb-4">
                {t("rebook.noFlightsDesc")}
              </p>
              <Button asChild variant="outline">
                <Link href="/">{t("rebook.searchDifferent")}</Link>
              </Button>
            </Card>
          ) : (
            <div className="space-y-3">
              {availableFlights.map(flight => {
                const price =
                  rebookData.cabinClass === "economy"
                    ? flight.economyPrice
                    : flight.businessPrice;
                const seatsLeft =
                  rebookData.cabinClass === "economy"
                    ? flight.economyAvailable
                    : flight.businessAvailable;

                return (
                  <Card
                    key={flight.id}
                    className="overflow-hidden border-0 shadow-md hover:shadow-xl transition-all duration-300 bg-white dark:bg-slate-900 cursor-pointer group"
                    onClick={() => handleSelectFlight(flight.id)}
                  >
                    <div className="p-5">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        {/* Flight Info */}
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-3">
                            <Badge
                              variant="secondary"
                              className="font-mono text-sm"
                            >
                              {flight.flightNumber}
                            </Badge>
                            <span className="text-sm text-muted-foreground">
                              {format(
                                new Date(flight.departureTime),
                                "EEEE, d MMMM yyyy",
                                { locale: dateLocale }
                              )}
                            </span>
                          </div>

                          <div className="flex items-center gap-4">
                            <div className="text-center">
                              <p className="text-2xl font-bold">
                                {format(
                                  new Date(flight.departureTime),
                                  "HH:mm"
                                )}
                              </p>
                              <p className="text-sm font-semibold text-blue-600 dark:text-blue-400">
                                {flight.originCode}
                              </p>
                            </div>

                            <div className="flex-1 px-4">
                              <div className="relative">
                                <div className="border-t-2 border-dashed border-slate-300 dark:border-slate-600" />
                                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-slate-900 px-2">
                                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <Clock className="h-3 w-3" />
                                    <span>
                                      {calculateDuration(
                                        flight.departureTime,
                                        flight.arrivalTime
                                      )}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="text-center">
                              <p className="text-2xl font-bold">
                                {format(new Date(flight.arrivalTime), "HH:mm")}
                              </p>
                              <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                                {flight.destinationCode}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Price & Select */}
                        <div className="flex md:flex-col items-center md:items-end gap-3 md:gap-2">
                          <div className="text-end">
                            <p className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                              {(price / 100).toFixed(0)}{" "}
                              <span className="text-sm">
                                {t("common.currency")}
                              </span>
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {t("rebook.perPerson")}
                            </p>
                          </div>
                          {seatsLeft <= 5 && (
                            <Badge
                              variant="destructive"
                              className="text-xs whitespace-nowrap"
                            >
                              {t("rebook.seatsLeft", { count: seatsLeft })}
                            </Badge>
                          )}
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="whitespace-nowrap"
                              onClick={e => {
                                e.stopPropagation();
                                handleSelectFlight(flight.id);
                              }}
                            >
                              {t("rebook.selectFlight")}
                              <ArrowRight className="h-4 w-4 ms-2" />
                            </Button>
                            <Button
                              size="sm"
                              className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 shadow-md group-hover:shadow-lg transition-all whitespace-nowrap"
                              disabled={quickRebookMutation.isPending}
                              onClick={e => {
                                e.stopPropagation();
                                handleQuickRebook(flight.id);
                              }}
                            >
                              <Zap className="h-4 w-4 me-1" />
                              {quickRebookMutation.isPending
                                ? t("rebook.rebooking")
                                : t("rebook.quickRebook")}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
