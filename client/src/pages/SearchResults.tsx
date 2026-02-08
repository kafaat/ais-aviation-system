import { useEffect, useState, useMemo } from "react";
import { useLocation, Link } from "wouter";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchResultsSkeleton } from "@/components/skeletons";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AdvancedFilters } from "@/components/AdvancedFilters";
import { SearchHistory, saveSearchToHistory } from "@/components/SearchHistory";
import { FlightStatusBadge } from "@/components/FlightStatusBadge";
import { CompareBar } from "@/components/CompareBar";
import { JoinWaitlistDialog } from "@/components/JoinWaitlistDialog";
import { useFlightCompare } from "@/contexts/FlightCompareContext";
import {
  useFlightStatus,
  type FlightStatusType,
} from "@/hooks/useFlightStatus";
import {
  Plane,
  Clock,
  ChevronLeft,
  Heart,
  Loader2,
  Share2,
  ArrowLeftRight,
  Scale,
} from "lucide-react";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import { toast } from "sonner";
import type { FlightData } from "@/components/FlightCard";

interface FilterOptions {
  priceRange: [number, number];
  airlines: string[];
  stops: string[];
  departureTime: string[];
  cabinClass: string[];
}

export default function SearchResults() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [location] = useLocation();
  const [params, setParams] = useState<{
    originId: number;
    destinationId: number;
    departureDate: Date;
  } | null>(null);

  // Flight comparison state
  const {
    selectedFlights,
    addFlight,
    removeFlight,
    clearAll,
    isSelected,
    canAdd,
  } = useFlightCompare();

  const [filters, setFilters] = useState<FilterOptions>({
    priceRange: [0, 10000],
    airlines: [],
    stops: [],
    departureTime: [],
    cabinClass: [],
  });

  const currentLocale = i18n.language === "ar" ? ar : enUS;

  useEffect(() => {
    const searchParams = new URLSearchParams(location.split("?")[1]);
    const origin = searchParams.get("origin");
    const destination = searchParams.get("destination");
    const date = searchParams.get("date");

    if (origin && destination && date) {
      setParams({
        originId: parseInt(origin),
        destinationId: parseInt(destination),
        departureDate: new Date(date),
      });
    }
  }, [location]);

  const { data: flights, isLoading } = trpc.flights.search.useQuery(params!, {
    enabled: !!params,
  });

  // Get user's favorites to check if route is favorited
  const { data: favorites, refetch: refetchFavorites } =
    trpc.favorites.getAll.useQuery(undefined, {
      enabled: !!user,
    });

  // Add to favorites mutation
  const addFavorite = trpc.favorites.add.useMutation({
    onSuccess: () => {
      toast.success(t("favorites.addToFavorites") + " ✓");
      refetchFavorites();
    },
    onError: (error: { message: string }) => {
      toast.error(error.message);
    },
  });

  // Get flight IDs for WebSocket subscription
  const flightIds = useMemo(
    () => (flights ? flights.map(f => f.id) : []),
    [flights]
  );

  // Subscribe to real-time flight status updates
  const { statuses: flightStatuses, isConnected: wsConnected } =
    useFlightStatus({
      flightIds,
      enabled: flightIds.length > 0,
    });

  // Check if current route is favorited (using params)
  const isRouteFavorited = () => {
    if (!favorites || !params) return false;
    return favorites.some(
      (fav: { favorite: { originId: number; destinationId: number } }) =>
        fav.favorite.originId === params.originId &&
        fav.favorite.destinationId === params.destinationId
    );
  };

  // Handle add to favorites (using params)
  const handleAddToFavorites = () => {
    if (!user) {
      toast.error(t("common.loginRequired"));
      return;
    }
    if (!params) return;
    addFavorite.mutate({
      originId: params.originId,
      destinationId: params.destinationId,
    });
  };

  // Save search to history when we get results
  useEffect(() => {
    if (flights && flights.length > 0 && params) {
      const flight = flights[0];
      saveSearchToHistory({
        originCode: flight.origin.code,
        originCity: flight.origin.city,
        destinationCode: flight.destination.code,
        destinationCity: flight.destination.city,
        departureDate: params.departureDate.toISOString().split("T")[0],
        cabinClass: "economy",
        passengers: 1,
      });
    }
  }, [flights, params]);

  // Filter and sort flights based on selected filters
  const filteredFlights = useMemo(() => {
    if (!flights) return [];

    let result = [...flights];

    // Price filter
    result = result.filter(flight => {
      const minPrice = Math.min(flight.economyPrice, flight.businessPrice);
      return (
        minPrice >= filters.priceRange[0] * 100 &&
        minPrice <= filters.priceRange[1] * 100
      );
    });

    // Airlines filter
    if (filters.airlines.length > 0) {
      result = result.filter(flight =>
        filters.airlines.includes(flight.airline.code)
      );
    }

    // Departure time filter
    if (filters.departureTime.length > 0) {
      result = result.filter(flight => {
        const hour = new Date(flight.departureTime).getHours();
        return filters.departureTime.some(timeSlot => {
          switch (timeSlot) {
            case "morning":
              return hour >= 6 && hour < 12;
            case "afternoon":
              return hour >= 12 && hour < 18;
            case "evening":
              return hour >= 18 && hour < 24;
            case "night":
              return hour >= 0 && hour < 6;
            default:
              return true;
          }
        });
      });
    }

    // Cabin class filter
    if (filters.cabinClass.length > 0) {
      result = result.filter(flight => {
        if (
          filters.cabinClass.includes("economy") &&
          flight.economyAvailable > 0
        )
          return true;
        if (
          filters.cabinClass.includes("business") &&
          flight.businessAvailable > 0
        )
          return true;
        return false;
      });
    }

    return result;
  }, [flights, filters]);

  const handleApplyFilters = (newFilters: FilterOptions) => {
    setFilters(newFilters);
  };

  const handleResetFilters = () => {
    setFilters({
      priceRange: [0, 10000],
      airlines: [],
      stops: [],
      departureTime: [],
      cabinClass: [],
    });
  };

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

  // Handle adding/removing flights from compare
  const handleCompareToggle = (flight: FlightData) => {
    if (isSelected(flight.id)) {
      removeFlight(flight.id);
      toast.success(t("compare.removedFromCompare"));
    } else {
      if (canAdd) {
        addFlight(flight);
        toast.success(t("compare.addedToCompare"));
      } else {
        toast.error(t("compare.maxFlightsReached"));
      }
    }
  };

  const handleShare = async (flight: {
    id: number;
    origin: { city: string };
    destination: { city: string };
    economyPrice: number;
  }) => {
    const url = `${window.location.origin}/booking/${flight.id}`;
    const text = `${flight.origin.city} → ${flight.destination.city} - ${formatPrice(flight.economyPrice)} ${t("common.currency")}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: t("common.appName"), text, url });
      } catch {
        // User cancelled share
      }
    } else {
      await navigator.clipboard.writeText(url);
      toast.success(t("common.copied"));
    }
  };

  // Generate dynamic SEO title based on search
  const seoTitle = useMemo(() => {
    if (flights && flights.length > 0) {
      return `${flights[0].origin.city} - ${flights[0].destination.city}`;
    }
    return t("search.title");
  }, [flights, t]);

  if (isLoading) {
    return (
      <div data-testid="loading">
        <SEO title={t("search.title")} />
        <SearchResultsSkeleton cardCount={3} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      <SEO
        title={seoTitle}
        description={t("search.foundFlights", {
          count: filteredFlights.length,
        })}
        keywords="flight search, booking, travel"
      />
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b sticky top-0 z-50 shadow-sm">
        <div className="container py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/">
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full"
                  aria-label={t("common.back")}
                >
                  <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                </Button>
              </Link>
              <div>
                <h1 className="text-xl font-bold">{t("search.title")}</h1>
                {params && (
                  <p className="text-sm text-muted-foreground">
                    {format(params.departureDate, "PPP", {
                      locale: currentLocale,
                    })}
                  </p>
                )}
              </div>
            </div>

            {flights && flights.length > 0 && (
              <div className="hidden md:flex items-center gap-2 text-sm bg-muted/50 px-4 py-2 rounded-full">
                <span className="font-semibold">{flights[0].origin.code}</span>
                <ArrowLeftRight
                  className="h-4 w-4 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="font-semibold">
                  {flights[0].destination.code}
                </span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Results */}
      <div className="container py-8">
        {!flights || flights.length === 0 ? (
          <div className="space-y-6" data-testid="no-results">
            <Card className="p-12 text-center border-dashed">
              <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-muted mb-6">
                <Plane className="h-10 w-10 text-muted-foreground" />
              </div>
              <h2 className="text-2xl font-semibold mb-2">
                {t("search.noFlights")}
              </h2>
              <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                {t("search.noFlightsDesc")}
              </p>
              <Button asChild size="lg">
                <Link href="/">{t("common.back")}</Link>
              </Button>
            </Card>

            {/* Recent Searches */}
            <div data-testid="search-history">
              <SearchHistory />
            </div>
          </div>
        ) : (
          <div className="space-y-6" data-testid="flight-results">
            {/* Filters */}
            <div data-testid="advanced-filters">
              <AdvancedFilters
                onApply={handleApplyFilters}
                onReset={handleResetFilters}
              />
            </div>

            {/* Results Count */}
            <div className="flex items-center justify-between">
              <p className="text-lg font-medium">
                {t("search.foundFlights", { count: filteredFlights.length })}
                {filteredFlights.length !== flights.length && (
                  <span className="text-sm text-muted-foreground ms-2">
                    ({flights.length} {t("search.total")})
                  </span>
                )}
              </p>
            </div>

            {/* Flight Cards */}
            {filteredFlights.length === 0 ? (
              <Card className="p-12 text-center border-dashed">
                <Plane className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                <h2 className="text-2xl font-semibold mb-2">
                  {t("search.noMatchingFlights")}
                </h2>
                <p className="text-muted-foreground mb-6">
                  {t("search.tryChangingFilters")}
                </p>
                <Button onClick={handleResetFilters}>
                  {t("filters.reset")}
                </Button>
              </Card>
            ) : (
              <div className="space-y-4">
                {filteredFlights.map(flight => {
                  const isFavorited = isRouteFavorited();
                  const liveStatus = flightStatuses.get(flight.id);
                  const displayStatus: FlightStatusType =
                    liveStatus?.status ||
                    (flight.status as FlightStatusType) ||
                    "scheduled";

                  return (
                    <Card
                      key={flight.id}
                      className="p-6 hover:shadow-xl transition-all duration-300 border-0 bg-white/80 backdrop-blur-sm"
                      role="article"
                      data-testid="flight-card"
                      aria-label={`${t("search.title")}: ${flight.airline.name} ${flight.flightNumber}, ${flight.origin.city} ${t("home.search.to")} ${flight.destination.city}`}
                    >
                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
                        {/* Airline Info */}
                        <div className="lg:col-span-2">
                          <div className="flex items-center gap-3">
                            {flight.airline.logo ? (
                              <img
                                src={flight.airline.logo}
                                alt={flight.airline.name}
                                className="h-12 w-12 object-contain rounded-lg"
                              />
                            ) : (
                              <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
                                <Plane
                                  className="h-6 w-6 text-primary"
                                  aria-hidden="true"
                                />
                              </div>
                            )}
                            <div>
                              <p
                                className="font-semibold"
                                data-testid="airline-name"
                              >
                                {flight.airline.name}
                              </p>
                              <p
                                className="text-sm text-muted-foreground"
                                data-testid="flight-number"
                              >
                                {flight.flightNumber}
                              </p>
                              {/* Live Flight Status Badge */}
                              <FlightStatusBadge
                                status={displayStatus}
                                delayMinutes={liveStatus?.delayMinutes}
                                isLive={!!liveStatus}
                                isConnected={wsConnected}
                                size="sm"
                                className="mt-1"
                              />
                            </div>
                          </div>
                        </div>

                        {/* Flight Details */}
                        <div className="lg:col-span-5">
                          <div className="flex items-center justify-between">
                            <div className="text-center">
                              <p
                                className="text-3xl font-bold"
                                data-testid="departure-time"
                              >
                                {formatTime(flight.departureTime)}
                              </p>
                              <p className="text-sm text-muted-foreground mt-1">
                                <span className="font-semibold text-foreground">
                                  {flight.origin.code}
                                </span>{" "}
                                - {flight.origin.city}
                              </p>
                            </div>

                            <div className="flex-1 px-4">
                              <div className="relative">
                                <div className="border-t-2 border-dashed border-primary/30"></div>
                                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white px-2">
                                  <div
                                    className="flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-1 rounded-full"
                                    data-testid="flight-duration"
                                  >
                                    <Clock
                                      className="h-3 w-3"
                                      aria-hidden="true"
                                    />
                                    <span>
                                      {calculateDuration(
                                        flight.departureTime,
                                        flight.arrivalTime
                                      )}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <p className="text-xs text-center text-muted-foreground mt-2">
                                <Badge
                                  variant="outline"
                                  className="text-[10px]"
                                >
                                  {t("search.directFlight")}
                                </Badge>
                              </p>
                            </div>

                            <div className="text-center">
                              <p className="text-3xl font-bold">
                                {formatTime(flight.arrivalTime)}
                              </p>
                              <p className="text-sm text-muted-foreground mt-1">
                                <span className="font-semibold text-foreground">
                                  {flight.destination.code}
                                </span>{" "}
                                - {flight.destination.city}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="lg:col-span-1 flex lg:flex-col items-center justify-center gap-2">
                          {/* Compare Checkbox */}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div
                                className={`flex items-center justify-center rounded-full p-2 cursor-pointer transition-colors ${
                                  isSelected(flight.id)
                                    ? "text-primary bg-primary/10"
                                    : "hover:text-primary hover:bg-primary/10"
                                }`}
                                onClick={() =>
                                  handleCompareToggle(
                                    flight as unknown as FlightData
                                  )
                                }
                                role="checkbox"
                                aria-checked={isSelected(flight.id)}
                                aria-label={t("compare.addToCompare")}
                              >
                                <Scale
                                  className={`h-5 w-5 ${isSelected(flight.id) ? "fill-current" : ""}`}
                                  aria-hidden="true"
                                />
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>
                              {isSelected(flight.id)
                                ? t("compare.removeFromCompare")
                                : t("compare.addToCompare")}
                            </TooltipContent>
                          </Tooltip>

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
                                onClick={handleAddToFavorites}
                                disabled={addFavorite.isPending || isFavorited}
                                aria-label={
                                  isFavorited
                                    ? t("favorites.removeFromFavorites")
                                    : t("favorites.addToFavorites")
                                }
                              >
                                {addFavorite.isPending ? (
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

                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="rounded-full hover:text-blue-500 hover:bg-blue-50"
                                onClick={() => handleShare(flight)}
                                aria-label={t("common.share")}
                              >
                                <Share2
                                  className="h-5 w-5"
                                  aria-hidden="true"
                                />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t("common.share")}</TooltipContent>
                          </Tooltip>
                        </div>

                        {/* Pricing */}
                        <div className="lg:col-span-4">
                          <div className="flex flex-col sm:flex-row gap-3">
                            {flight.economyAvailable > 0 ? (
                              <div className="flex-1">
                                <div className="text-center p-4 border-2 rounded-xl hover:border-primary/50 transition-colors group">
                                  <p className="text-xs text-muted-foreground mb-1">
                                    {t("search.economy")}
                                  </p>
                                  <p
                                    className="text-2xl font-bold text-primary"
                                    data-testid="flight-price"
                                  >
                                    {formatPrice(flight.economyPrice)}{" "}
                                    <span className="text-sm font-normal">
                                      {t("common.currency")}
                                    </span>
                                  </p>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {t("search.seatsAvailable", {
                                      count: flight.economyAvailable,
                                    })}
                                  </p>
                                  <Button
                                    asChild
                                    className="w-full mt-3 group-hover:bg-primary group-hover:text-white"
                                    variant="outline"
                                    size="sm"
                                  >
                                    <Link
                                      href={`/booking/${flight.id}?class=economy`}
                                    >
                                      {t("search.bookNow")}
                                    </Link>
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex-1">
                                <div className="text-center p-4 border-2 rounded-xl border-slate-200 bg-slate-50/50 dark:bg-slate-800/50">
                                  <p className="text-xs text-muted-foreground mb-1">
                                    {t("search.economy")}
                                  </p>
                                  <Badge
                                    variant="secondary"
                                    className="mb-2 bg-slate-200 text-slate-700"
                                  >
                                    {t("waitlist.soldOut")}
                                  </Badge>
                                  <p className="text-xs text-muted-foreground mt-1 mb-3">
                                    {t("waitlist.joinToGetNotified")}
                                  </p>
                                  <JoinWaitlistDialog
                                    flightId={flight.id}
                                    flightNumber={flight.flightNumber}
                                    originCity={flight.origin.city}
                                    destinationCity={flight.destination.city}
                                    departureTime={flight.departureTime}
                                    cabinClass="economy"
                                  />
                                </div>
                              </div>
                            )}

                            {flight.businessAvailable > 0 ? (
                              <div className="flex-1">
                                <div className="text-center p-4 border-2 rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200 hover:border-amber-400 transition-colors group">
                                  <p className="text-xs text-amber-700 mb-1 font-medium">
                                    {t("search.business")}
                                  </p>
                                  <p className="text-2xl font-bold text-amber-700">
                                    {formatPrice(flight.businessPrice)}{" "}
                                    <span className="text-sm font-normal">
                                      {t("common.currency")}
                                    </span>
                                  </p>
                                  <p className="text-xs text-amber-600 mt-1">
                                    {t("search.seatsAvailable", {
                                      count: flight.businessAvailable,
                                    })}
                                  </p>
                                  <Button
                                    asChild
                                    className="w-full mt-3 bg-amber-600 hover:bg-amber-700"
                                    size="sm"
                                  >
                                    <Link
                                      href={`/booking/${flight.id}?class=business`}
                                    >
                                      {t("search.bookNow")}
                                    </Link>
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex-1">
                                <div className="text-center p-4 border-2 rounded-xl border-amber-200 bg-amber-50/50 dark:bg-amber-900/20">
                                  <p className="text-xs text-amber-700 mb-1 font-medium">
                                    {t("search.business")}
                                  </p>
                                  <Badge
                                    variant="secondary"
                                    className="mb-2 bg-amber-200 text-amber-700"
                                  >
                                    {t("waitlist.soldOut")}
                                  </Badge>
                                  <p className="text-xs text-muted-foreground mt-1 mb-3">
                                    {t("waitlist.joinToGetNotified")}
                                  </p>
                                  <JoinWaitlistDialog
                                    flightId={flight.id}
                                    flightNumber={flight.flightNumber}
                                    originCity={flight.origin.city}
                                    destinationCity={flight.destination.city}
                                    departureTime={flight.departureTime}
                                    cabinClass="business"
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Compare Bar - Sticky at bottom */}
      <CompareBar
        selectedFlights={selectedFlights}
        onRemove={removeFlight}
        onClearAll={clearAll}
      />

      {/* Add padding at bottom when CompareBar is visible */}
      {selectedFlights.length > 0 && <div className="h-32 md:h-24" />}
    </div>
  );
}
