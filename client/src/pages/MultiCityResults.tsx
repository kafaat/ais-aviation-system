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
import { useAuth } from "@/_core/hooks/useAuth";
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
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import { toast } from "sonner";

interface SegmentSearchParams {
  originId: number;
  destinationId: number;
  departureDate: Date;
}

interface SelectedFlight {
  segmentIndex: number;
  flightId: number;
  cabinClass: "economy" | "business";
  price: number;
}

type FlightResult = {
  id: number;
  flightNumber: string;
  departureTime: Date;
  arrivalTime: Date;
  status: string;
  economyPrice: number;
  businessPrice: number;
  economyAvailable: number;
  businessAvailable: number;
  airline: {
    code: string;
    name: string;
    logo: string | null;
  };
  origin: {
    code: string;
    name: string;
    city: string;
  };
  destination: {
    code: string;
    name: string;
    city: string;
  };
};

export default function MultiCityResults() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const [segments, setSegments] = useState<SegmentSearchParams[]>([]);
  const [selectedFlights, setSelectedFlights] = useState<SelectedFlight[]>([]);
  const [cabinClass, setCabinClass] = useState<"economy" | "business">(
    "economy"
  );
  const [passengerCount, setPassengerCount] = useState(1);

  const currentLocale = i18n.language === "ar" ? ar : enUS;

  // Parse URL parameters
  useEffect(() => {
    const searchParams = new URLSearchParams(location.split("?")[1]);
    const segmentsParam = searchParams.get("segments");

    if (segmentsParam) {
      try {
        const parsedSegments = JSON.parse(decodeURIComponent(segmentsParam));
        setSegments(
          parsedSegments.map(
            (s: {
              originId: string;
              destinationId: string;
              departureDate: string;
            }) => ({
              originId: parseInt(s.originId),
              destinationId: parseInt(s.destinationId),
              departureDate: new Date(s.departureDate),
            })
          )
        );
      } catch (e) {
        console.error("Failed to parse segments:", e);
      }
    }

    const classParam = searchParams.get("class");
    if (classParam === "business") {
      setCabinClass("business");
    }

    const passengersParam = searchParams.get("passengers");
    if (passengersParam) {
      const parsed = parseInt(passengersParam);
      if (!isNaN(parsed) && parsed >= 1) {
        setPassengerCount(parsed);
      }
    }
  }, [location]);

  // Search mutation for multi-city flights
  const searchMutation = trpc.multiCity.search.useMutation({
    onError: error => {
      toast.error(error.message);
    },
  });

  // Calculate price for selected flights
  const { data: priceResult } = trpc.multiCity.calculatePrice.useQuery(
    {
      segments: selectedFlights.map(sf => ({
        flightId: sf.flightId,
        cabinClass,
      })),
      passengerCount,
    },
    {
      enabled:
        selectedFlights.length === segments.length && segments.length >= 2,
    }
  );

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
    flight: FlightResult,
    selectedClass: "economy" | "business"
  ) => {
    const price =
      selectedClass === "economy" ? flight.economyPrice : flight.businessPrice;

    setSelectedFlights(prev => {
      const existing = prev.filter(sf => sf.segmentIndex !== segmentIndex);
      return [
        ...existing,
        {
          segmentIndex,
          flightId: flight.id,
          cabinClass: selectedClass,
          price,
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
    if (!user) {
      toast.error(t("common.loginRequired"));
      return;
    }

    if (selectedFlights.length !== segments.length) {
      toast.error(t("multiCity.selectAllFlights"));
      return;
    }

    // Navigate to booking page with selected flights
    const bookingData = {
      segments: selectedFlights.map(sf => ({
        flightId: sf.flightId,
        departureDate: segments[sf.segmentIndex].departureDate.toISOString(),
      })),
      cabinClass,
    };

    setLocation(
      `/booking/multi-city?data=${encodeURIComponent(JSON.stringify(bookingData))}`
    );
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
      ? `${hours}s ${minutes}d`
      : `${hours}h ${minutes}m`;
  };

  const totalSelectedPrice = useMemo(() => {
    return selectedFlights.reduce((sum, sf) => sum + sf.price, 0);
  }, [selectedFlights]);

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
                        {format(segments[segmentIndex].departureDate, "PPP", {
                          locale: currentLocale,
                        })}
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
                    {segmentResult.flights.map((flight: FlightResult) => {
                      const isSelected = isFlightSelected(
                        segmentIndex,
                        flight.id
                      );

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
                                    {formatTime(flight.departureTime)}
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
                                    {formatTime(flight.arrivalTime)}
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
                                {flight.economyAvailable > 0 && (
                                  <Button
                                    variant={
                                      isSelected && cabinClass === "economy"
                                        ? "default"
                                        : "outline"
                                    }
                                    size="sm"
                                    className="flex-1"
                                    onClick={() =>
                                      handleSelectFlight(
                                        segmentIndex,
                                        flight,
                                        "economy"
                                      )
                                    }
                                  >
                                    <div className="text-center">
                                      <p className="text-xs">
                                        {t("search.economy")}
                                      </p>
                                      <p className="font-bold">
                                        {formatPrice(flight.economyPrice)}
                                      </p>
                                    </div>
                                  </Button>
                                )}
                                {flight.businessAvailable > 0 && (
                                  <Button
                                    variant={
                                      isSelected && cabinClass === "business"
                                        ? "default"
                                        : "outline"
                                    }
                                    size="sm"
                                    className="flex-1 border-amber-300 hover:bg-amber-50"
                                    onClick={() =>
                                      handleSelectFlight(
                                        segmentIndex,
                                        flight,
                                        "business"
                                      )
                                    }
                                  >
                                    <div className="text-center">
                                      <p className="text-xs text-amber-700">
                                        {t("search.business")}
                                      </p>
                                      <p className="font-bold text-amber-700">
                                        {formatPrice(flight.businessPrice)}
                                      </p>
                                    </div>
                                  </Button>
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
            ))}
          </div>

          {/* Price Summary Sidebar */}
          <div className="lg:col-span-1">
            <Card className="p-6 sticky top-24">
              <h3 className="text-lg font-semibold mb-4">
                {t("multiCity.priceSummary")}
              </h3>

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
                          {formatPrice(selected.price)} {t("common.currency")}
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
                  <span className="text-2xl font-bold text-primary">
                    {priceResult
                      ? formatPrice(priceResult.totalPrice)
                      : formatPrice(totalSelectedPrice)}{" "}
                    {t("common.currency")}
                  </span>
                </div>
              </div>

              {/* Book Button */}
              <Button
                className="w-full mt-6"
                size="lg"
                disabled={selectedFlights.length !== segments.length}
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
