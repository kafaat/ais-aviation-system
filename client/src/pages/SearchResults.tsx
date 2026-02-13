import { useEffect, useState, useMemo } from "react";
import { useLocation, Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AdvancedFilters } from "@/components/AdvancedFilters";
import { Plane, Clock, ArrowRight, ChevronLeft } from "lucide-react";
import { format } from "date-fns";
import { ar } from "date-fns/locale";

interface FilterOptions {
  priceRange: [number, number];
  airlines: string[];
  stops: string[];
  departureTime: string[];
  cabinClass: string[];
}

export default function SearchResults() {
  const [location] = useLocation();
  const [params, setParams] = useState<{
    originId: number;
    destinationId: number;
    departureDate: Date;
  } | null>(null);

  const [filters, setFilters] = useState<FilterOptions>({
    priceRange: [0, 10000],
    airlines: [],
    stops: [],
    departureTime: [],
    cabinClass: [],
  });

  useEffect(() => {
    const searchParams = new URLSearchParams(location.split('?')[1]);
    const origin = searchParams.get('origin');
    const destination = searchParams.get('destination');
    const date = searchParams.get('date');

    if (origin && destination && date) {
      setParams({
        originId: parseInt(origin),
        destinationId: parseInt(destination),
        departureDate: new Date(date),
      });
    }
  }, [location]);

  const { data: flights, isLoading } = trpc.flights.search.useQuery(
    params!,
    { enabled: !!params }
  );

  // Filter and sort flights based on selected filters
  const filteredFlights = useMemo(() => {
    if (!flights) return [];

    let result = [...flights];

    // Price filter
    result = result.filter((flight) => {
      const minPrice = Math.min(flight.economyPrice, flight.businessPrice);
      return minPrice >= filters.priceRange[0] * 100 && minPrice <= filters.priceRange[1] * 100;
    });

    // Airlines filter
    if (filters.airlines.length > 0) {
      result = result.filter((flight) =>
        filters.airlines.includes(flight.airline.code)
      );
    }

    // Departure time filter
    if (filters.departureTime.length > 0) {
      result = result.filter((flight) => {
        const hour = new Date(flight.departureTime).getHours();
        return filters.departureTime.some((timeSlot) => {
          switch (timeSlot) {
            case 'morning':
              return hour >= 6 && hour < 12;
            case 'afternoon':
              return hour >= 12 && hour < 18;
            case 'evening':
              return hour >= 18 && hour < 24;
            case 'night':
              return hour >= 0 && hour < 6;
            default:
              return true;
          }
        });
      });
    }

    // Cabin class filter
    if (filters.cabinClass.length > 0) {
      result = result.filter((flight) => {
        if (filters.cabinClass.includes('economy') && flight.economyAvailable > 0) return true;
        if (filters.cabinClass.includes('business') && flight.businessAvailable > 0) return true;
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
    return format(new Date(date), "HH:mm", { locale: ar });
  };

  const formatPrice = (price: number) => {
    return (price / 100).toFixed(2);
  };

  const calculateDuration = (departure: Date, arrival: Date) => {
    const diff = new Date(arrival).getTime() - new Date(departure).getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}س ${minutes}د`;
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="container py-8">
          <Skeleton className="h-8 w-64 mb-8" />
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-40 w-full" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-50">
        <div className="container py-4">
          <div className="flex items-center gap-4">
            <Link href="/">
              <Button variant="ghost" size="icon">
                <ChevronLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold">نتائج البحث</h1>
              {params && (
                <p className="text-sm text-muted-foreground">
                  {format(params.departureDate, "PPP", { locale: ar })}
                </p>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Results */}
      <div className="container py-8">
        {!flights || flights.length === 0 ? (
          <Card className="p-12 text-center">
            <Plane className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-2xl font-semibold mb-2">لا توجد رحلات متاحة</h2>
            <p className="text-muted-foreground mb-6">
              عذراً، لم نجد أي رحلات متاحة لهذا المسار في التاريخ المحدد
            </p>
            <Button asChild>
              <Link href="/">
                <a>العودة للبحث</a>
              </Link>
            </Button>
          </Card>
        ) : (
          <div className="space-y-6">
            {/* Filters */}
            <AdvancedFilters
              onApply={handleApplyFilters}
              onReset={handleResetFilters}
            />

            {/* Results Count */}
            <div className="flex items-center justify-between">
              <p className="text-lg font-medium">
                وجدنا {filteredFlights.length} رحلة متاحة
                {filteredFlights.length !== flights.length && (
                  <span className="text-sm text-muted-foreground ml-2">
                    (من أصل {flights.length})
                  </span>
                )}
              </p>
            </div>

            {/* Flight Cards */}
            {filteredFlights.length === 0 ? (
              <Card className="p-12 text-center">
                <Plane className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                <h2 className="text-2xl font-semibold mb-2">لا توجد رحلات تطابق الفلاتر</h2>
                <p className="text-muted-foreground mb-6">
                  جرب تغيير معايير البحث أو إعادة تعيين الفلاتر
                </p>
                <Button onClick={handleResetFilters}>
                  إعادة تعيين الفلاتر
                </Button>
              </Card>
            ) : (
              <div className="space-y-4">
                {filteredFlights.map((flight) => (
                  <Card key={flight.id} className="p-6 hover:shadow-lg transition-shadow">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
                      {/* Airline Info */}
                      <div className="lg:col-span-2">
                        <div className="flex items-center gap-3">
                          {flight.airline.logo && (
                            <img 
                              src={flight.airline.logo} 
                              alt={flight.airline.name}
                              className="h-12 w-12 object-contain"
                            />
                          )}
                          <div>
                            <p className="font-semibold">{flight.airline.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {flight.flightNumber}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Flight Details */}
                      <div className="lg:col-span-6">
                        <div className="flex items-center justify-between">
                          <div className="text-center">
                            <p className="text-3xl font-bold">
                              {formatTime(flight.departureTime)}
                            </p>
                            <p className="text-sm text-muted-foreground mt-1">
                              {flight.origin.city} ({flight.origin.code})
                            </p>
                          </div>

                          <div className="flex-1 px-6">
                            <div className="relative">
                              <div className="border-t-2 border-dashed border-gray-300"></div>
                              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white px-3">
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                  <Clock className="h-4 w-4" />
                                  <span>
                                    {calculateDuration(flight.departureTime, flight.arrivalTime)}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <p className="text-xs text-center text-muted-foreground mt-2">
                              رحلة مباشرة
                            </p>
                          </div>

                          <div className="text-center">
                            <p className="text-3xl font-bold">
                              {formatTime(flight.arrivalTime)}
                            </p>
                            <p className="text-sm text-muted-foreground mt-1">
                              {flight.destination.city} ({flight.destination.code})
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Pricing */}
                      <div className="lg:col-span-4">
                        <div className="flex flex-col sm:flex-row gap-3">
                          {flight.economyAvailable > 0 && (
                            <div className="flex-1">
                              <div className="text-center p-3 border rounded-lg">
                                <p className="text-xs text-muted-foreground mb-1">الدرجة السياحية</p>
                                <p className="text-2xl font-bold text-primary">
                                  {formatPrice(flight.economyPrice)} ر.س
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                  {flight.economyAvailable} مقعد متاح
                                </p>
                                <Button 
                                  asChild 
                                  className="w-full mt-3" 
                                  size="sm"
                                >
                                  <Link href={`/booking/${flight.id}?class=economy`}>
                                    <a>احجز الآن</a>
                                  </Link>
                                </Button>
                              </div>
                            </div>
                          )}

                          {flight.businessAvailable > 0 && (
                            <div className="flex-1">
                              <div className="text-center p-3 border rounded-lg bg-primary/5">
                                <p className="text-xs text-muted-foreground mb-1">درجة الأعمال</p>
                                <p className="text-2xl font-bold text-primary">
                                  {formatPrice(flight.businessPrice)} ر.س
                                </p>
                                <p className="text-xs text-muted-foreground mt-1">
                                  {flight.businessAvailable} مقعد متاح
                                </p>
                                <Button 
                                  asChild 
                                  className="w-full mt-3" 
                                  size="sm"
                                  variant="default"
                                >
                                  <Link href={`/booking/${flight.id}?class=business`}>
                                    <a>احجز الآن</a>
                                  </Link>
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
