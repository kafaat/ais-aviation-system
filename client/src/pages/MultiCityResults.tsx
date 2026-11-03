import { BrandIdentity } from "@/components/BrandIdentity";
import { readSearchPreferences as searchPreferences } from "@/lib/ibe-display-context";
import { useRawSearch } from "@/lib/useRawSearch";
/**
 * MultiCityResults Page
 *
 * Displays search results for multi-city flight searches.
 * Users can select flights for each segment and see combined pricing.
 */

import { useEffect, useState, useMemo } from "react";
import { useLocation, Link } from "wouter";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import {
  parseMultiCitySearch,
  preferenceParams,
  travelerTypes,
} from "@shared/ibe-search";
import { DisplayCurrencyEstimate } from "@/components/DisplayCurrencyEstimate";
import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Plane,
  Clock,
  ChevronLeft,
  Check,
  Loader2,
  ArrowRight,
} from "lucide-react";
import { formatFlightTime } from "@/lib/flight-time";
import { toast } from "sonner";

interface SelectedFlight {
  segmentIndex: number;
  flightId: number;
  cabinClass: "economy" | "business";
  fareClassCode?: string;
}

type PassengerType = "adult" | "child" | "infant";

export default function MultiCityResults() {
  const search = useRawSearch();
  return <MultiCityResultsForm key={search} search={search} />;
}

function MultiCityResultsForm({ search }: { search: string }) {
  const { t, i18n } = useTranslation();
  const [, setLocation] = useLocation();
  const segments = useMemo(() => parseMultiCitySearch(search), [search]);
  const [selectedFlights, setSelectedFlights] = useState<SelectedFlight[]>([]);
  const [cabinClass, setCabinClass] = useState<"economy" | "business">(
    new URLSearchParams(search).get("class") === "business"
      ? "business"
      : "economy"
  );
  const preferences = useMemo(() => searchPreferences(search), [search]);
  const [passengerTypes, setPassengerTypes] = useState<PassengerType[]>(() =>
    travelerTypes(preferences)
  );
  const passengerCount = passengerTypes.length;

  // Search mutation for multi-city flights
  const searchMutation = trpc.multiCity.search.useMutation({
    onError: error => {
      toast.error(error.message);
    },
  });

  // Calculate price for selected flights
  const quote = trpc.multiCity.calculatePrice.useQuery(
    {
      segments: selectedFlights.map(sf => ({
        flightId: sf.flightId,
        cabinClass: sf.cabinClass,
        ...(sf.fareClassCode ? { fareClassCode: sf.fareClassCode } : {}),
      })),
      passengerCount,
      passengerTypes,
    },
    {
      retry: false,
      enabled:
        selectedFlights.length === segments.length && segments.length >= 2,
    }
  );

  const priceResult =
    quote.isError || quote.isFetching ? undefined : quote.data;

  // Trigger search when segments are loaded
  useEffect(() => {
    if (
      segments.length >= 2 &&
      !searchMutation.isPending &&
      !searchMutation.data
    ) {
      searchMutation.mutate({ segments });
    }
  }, [segments]);

  const handleSelectFlight = (
    segmentIndex: number,
    flightId: number,
    selectedClass: "economy" | "business",
    fareClassCode?: string
  ) => {
    setSelectedFlights(prev => {
      const existing = prev.filter(
        sf =>
          sf.segmentIndex !== segmentIndex && sf.cabinClass === selectedClass
      );
      return [
        ...existing,
        {
          segmentIndex,
          flightId,
          cabinClass: selectedClass,
          fareClassCode,
        },
      ].sort((a, b) => a.segmentIndex - b.segmentIndex);
    });
    setCabinClass(selectedClass);
  };

  const isFlightSelected = (segmentIndex: number, flightId: number) => {
    return selectedFlights.some(
      sf => sf.segmentIndex === segmentIndex && sf.flightId === flightId
    );
  };

  const getSelectedFlightForSegment = (segmentIndex: number) => {
    return selectedFlights.find(sf => sf.segmentIndex === segmentIndex);
  };

  const handleProceedToBooking = () => {
    if (!priceResult || selectedFlights.length !== segments.length) {
      toast.error(t("multiCity.selectAllFlights"));
      return;
    }

    // Navigate to booking page with selected flights
    const bookingData = {
      version: 1,
      sessionId: crypto.randomUUID(),
      passengerCount,
      passengerTypes,
      segments: selectedFlights.map(sf => ({
        flightId: sf.flightId,
        departureDate: segments[sf.segmentIndex].departureDate.toISOString(),
        ...(sf.fareClassCode ? { fareClassCode: sf.fareClassCode } : {}),
      })),
      cabinClass,
    };

    const context = preferenceParams({
      ...preferences,
      adults: passengerTypes.filter(type => type === "adult").length,
      children: passengerTypes.filter(type => type === "child").length,
      infants: passengerTypes.filter(type => type === "infant").length,
    });
    context.set("data", JSON.stringify(bookingData));
    context.set("search", search);
    setLocation(`/booking/multi-city?${context}`);
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
      ? `${hours}s ${minutes}d`
      : `${hours}h ${minutes}m`;
  };

  if (!segments.length)
    return (
      <main className="container py-8">
        <p role="alert">{t("multiCity.invalidItinerary")}</p>
        <Link href="/">{t("nav.searchFlights")}</Link>
      </main>
    );

  if (searchMutation.isPending) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
        <SEO title={t("multiCity.searchResults")} />
        <div className="container py-12">
          <div className="flex flex-col items-center justify-center space-y-4">
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <p className="text-lg text-muted-foreground">
              {t("multiCity.searchingFlights")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      <SEO
        title={t("multiCity.searchResults")}
        description={t("multiCity.searchResultsDesc")}
      />

      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b sticky top-0 z-50 shadow-sm">
        <div className="container py-4">
          <BrandIdentity
            className="mb-1 max-w-full text-primary"
            logoClassName="h-6 w-6"
          />
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
                <h1 className="text-xl font-bold">
                  {t("multiCity.searchResults")}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {t("multiCity.segmentCount", {
                    current: segments.length,
                    min: 2,
                    max: 5,
                  })}
                </p>
              </div>
            </div>

            {/* Summary Badge */}
            <div className="hidden md:flex items-center gap-2 text-sm bg-muted/50 px-4 py-2 rounded-full">
              {segments.length > 0 && (
                <>
                  <span className="font-semibold">
                    {segments.length} {t("multiCity.segments")}
                  </span>
                  <span className="text-muted-foreground">|</span>
                  <span>
                    {selectedFlights.length}/{segments.length}{" "}
                    {t("multiCity.selected")}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="container py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Flight Results */}
          <div className="lg:col-span-2 space-y-8">
            {searchMutation.data?.map((segmentResult, segmentIndex) => (
              <div key={segmentIndex}>
                {/* Segment Header */}
                <div className="flex items-center gap-4 mb-4">
                  <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary text-white font-bold text-sm">
                    {segmentIndex + 1}
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold">
                      {t("multiCity.segment")} {segmentIndex + 1}
                    </h2>
                    {segments[segmentIndex] && (
                      <p className="text-sm text-muted-foreground">
                        {new Intl.DateTimeFormat(i18n.language, {
                          dateStyle: "long",
                          timeZone: "UTC",
                        }).format(
                          new Date(
                            segments[segmentIndex].departureDate.getTime() +
                              12 * 3600_000
                          )
                        )}
                      </p>
                    )}
                  </div>
                  {getSelectedFlightForSegment(segmentIndex) && (
                    <Badge
                      variant="secondary"
                      className="ml-auto bg-green-100 text-green-800"
                    >
                      <Check className="h-3 w-3 mr-1" />
                      {t("multiCity.flightSelected")}
                    </Badge>
                  )}
                </div>

                {/* Flights for this segment */}
                {segmentResult.flights.length === 0 ? (
                  <Card className="p-8 text-center border-dashed">
                    <Plane className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">
                      {t("search.noFlights")}
                    </p>
                  </Card>
                ) : (
                  <div className="space-y-3">
                    {segmentResult.flights.map(flight => {
                      const isSelected = isFlightSelected(
                        segmentIndex,
                        flight.id
                      );

                      const selectedFare = isSelected
                        ? getSelectedFlightForSegment(segmentIndex)
                            ?.fareClassCode
                        : undefined;
                      return (
                        <Card
                          key={flight.id}
                          className={`p-4 transition-all duration-200 ${
                            isSelected
                              ? "ring-2 ring-primary bg-primary/5"
                              : "hover:shadow-md"
                          }`}
                        >
                          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                            {/* Airline Info */}
                            <div className="md:col-span-3">
                              <div className="flex items-center gap-3">
                                {flight.airline.logo ? (
                                  <img
                                    src={flight.airline.logo}
                                    alt={flight.airline.name}
                                    className="h-10 w-10 object-contain rounded"
                                  />
                                ) : (
                                  <div className="h-10 w-10 rounded bg-primary/10 flex items-center justify-center">
                                    <Plane className="h-5 w-5 text-primary" />
                                  </div>
                                )}
                                <div>
                                  <p className="font-medium text-sm">
                                    {flight.airline.name}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {flight.flightNumber}
                                  </p>
                                </div>
                              </div>
                            </div>

                            {/* Flight Times */}
                            <div className="md:col-span-5">
                              <div className="flex items-center justify-between">
                                <div className="text-center">
                                  <p className="text-xl font-bold">
                                    {formatFlightTime(
                                      flight.departureTime,
                                      flight.origin.timezone,
                                      i18n.language
                                    )}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {flight.origin.code}
                                  </p>
                                </div>
                                <div className="flex-1 px-4">
                                  <div className="flex items-center gap-2">
                                    <div className="flex-1 border-t border-dashed border-muted-foreground/30"></div>
                                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                      <Clock className="h-3 w-3" />
                                      {calculateDuration(
                                        flight.departureTime,
                                        flight.arrivalTime
                                      )}
                                    </div>
                                    <div className="flex-1 border-t border-dashed border-muted-foreground/30"></div>
                                  </div>
                                </div>
                                <div className="text-center">
                                  <p className="text-xl font-bold">
                                    {formatFlightTime(
                                      flight.arrivalTime,
                                      flight.destination.timezone,
                                      i18n.language
                                    )}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {flight.destination.code}
                                  </p>
                                </div>
                              </div>
                            </div>

                            {/* Pricing & Select */}
                            <div className="md:col-span-4">
                              <div className="flex gap-2">
                                {flight.economyAvailable >= passengerCount && (
                                  <Button
                                    variant={
                                      isSelected &&
                                      !selectedFare &&
                                      cabinClass === "economy"
                                        ? "default"
                                        : "outline"
                                    }
                                    size="sm"
                                    className="flex-1"
                                    onClick={() =>
                                      handleSelectFlight(
                                        segmentIndex,
                                        flight.id,
                                        "economy"
                                      )
                                    }
                                  >
                                    <div className="text-center">
                                      <p className="text-xs">
                                        {t("search.economy")}
                                      </p>
                                      <p className="font-bold">
                                        {formatPrice(flight.economyPrice)}{" "}
                                        {t("common.currency")}
                                        <DisplayCurrencyEstimate
                                          amountMinor={flight.economyPrice}
                                        />
                                      </p>
                                    </div>
                                  </Button>
                                )}
                                {flight.businessAvailable >= passengerCount && (
                                  <Button
                                    variant={
                                      isSelected &&
                                      !selectedFare &&
                                      cabinClass === "business"
                                        ? "default"
                                        : "outline"
                                    }
                                    size="sm"
                                    className="flex-1 border-amber-300 hover:bg-amber-50"
                                    onClick={() =>
                                      handleSelectFlight(
                                        segmentIndex,
                                        flight.id,
                                        "business"
                                      )
                                    }
                                  >
                                    <div className="text-center">
                                      <p className="text-xs text-amber-700">
                                        {t("search.business")}
                                      </p>
                                      <p className="font-bold text-amber-700">
                                        {formatPrice(flight.businessPrice)}{" "}
                                        {t("common.currency")}
                                        <DisplayCurrencyEstimate
                                          amountMinor={flight.businessPrice}
                                        />
                                      </p>
                                    </div>
                                  </Button>
                                )}
                              </div>
                              {flight.fareClassAvailability
                                ?.filter(
                                  fare => fare.availableSeats >= passengerCount
                                )
                                .map(fare => (
                                  <Button
                                    key={fare.fareClassId}
                                    size="sm"
                                    className="mt-2 mr-2"
                                    variant={
                                      selectedFare === fare.code
                                        ? "default"
                                        : "outline"
                                    }
                                    aria-pressed={selectedFare === fare.code}
                                    onClick={() =>
                                      handleSelectFlight(
                                        segmentIndex,
                                        flight.id,
                                        fare.cabinClass,
                                        fare.code
                                      )
                                    }
                                  >
                                    {t("search." + fare.cabinClass)} ·{" "}
                                    {fare.fareFamily
                                      ? fare.fareFamily + " · "
                                      : ""}
                                    {fare.code}
                                  </Button>
                                ))}
                            </div>
                          </div>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Price Summary Sidebar */}
          <div className="lg:col-span-1">
            <Card className="p-6 sticky top-24">
              <h3 className="text-lg font-semibold mb-4">
                {t("multiCity.priceSummary")}
              </h3>

              <label className="mb-2 flex justify-between gap-2 text-sm">
                {t("booking.passengers")}
                <select
                  value={passengerCount}
                  onChange={event => {
                    const count = Number(event.target.value);
                    setPassengerTypes(types =>
                      Array.from(
                        { length: count },
                        (_, i) => types[i] ?? "adult"
                      )
                    );
                  }}
                >
                  {Array.from({ length: 9 }, (_, index) => (
                    <option key={index + 1} value={index + 1}>
                      {index + 1}
                    </option>
                  ))}
                </select>
              </label>
              {passengerTypes.map((type, index) => (
                <label
                  key={index}
                  className="mb-2 flex justify-between gap-2 text-sm"
                >
                  {t("booking.passengerType")} {index + 1}
                  <select
                    value={type}
                    onChange={event => {
                      const value = event.target.value as PassengerType;
                      setPassengerTypes(types =>
                        types.map((original, i) =>
                          i === index ? value : original
                        )
                      );
                    }}
                  >
                    {(["adult", "child", "infant"] as const).map(value => (
                      <option key={value} value={value}>
                        {t("booking." + value)}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              {/* Selected Flights Summary */}
              <div className="space-y-3 mb-6">
                {segments.map((_, index) => {
                  const selected = getSelectedFlightForSegment(index);
                  return (
                    <div
                      key={index}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-muted-foreground">
                        {t("multiCity.segment")} {index + 1}
                      </span>
                      {selected ? (
                        <span className="font-medium">
                          {selected.fareClassCode &&
                            selected.fareClassCode + " · "}
                          {priceResult?.segments[index]
                            ? formatPrice(
                                priceResult.segments[index].basePrice
                              ) +
                              " " +
                              t("common.currency")
                            : "—"}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          {t("multiCity.notSelected")}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Discount Info */}
              {priceResult && priceResult.discountPercentage > 0 && (
                <div className="border-t pt-4 mb-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {t("multiCity.subtotal")}
                    </span>
                    <span>
                      {formatPrice(priceResult.subtotal)} {t("common.currency")}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm text-green-600">
                    <span>
                      {t("multiCity.discount")} (
                      {priceResult.discountPercentage}
                      %)
                    </span>
                    <span>
                      -{formatPrice(priceResult.discount)}{" "}
                      {t("common.currency")}
                    </span>
                  </div>
                </div>
              )}

              {/* Total */}
              <div className="border-t pt-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{t("booking.total")}</span>
                  <span
                    data-testid="multi-city-quoted-total"
                    className="text-2xl font-bold text-primary"
                  >
                    {priceResult ? (
                      <>
                        {formatPrice(priceResult.totalPrice)}{" "}
                        {t("common.currency")}
                        <DisplayCurrencyEstimate
                          amountMinor={priceResult.totalPrice}
                        />
                      </>
                    ) : (
                      "—"
                    )}
                  </span>
                </div>
              </div>

              {quote.error && <p role="alert">{quote.error.message}</p>}
              {/* Book Button */}
              <Button
                className="w-full mt-6"
                size="lg"
                disabled={
                  segments.length < 2 ||
                  selectedFlights.length !== segments.length ||
                  !priceResult
                }
                onClick={handleProceedToBooking}
              >
                {t("multiCity.proceedToBooking")}
                <ArrowRight className="h-5 w-5 ml-2" />
              </Button>

              {selectedFlights.length !== segments.length && (
                <p className="text-xs text-muted-foreground text-center mt-2">
                  {t("multiCity.selectAllFlightsHint")}
                </p>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
