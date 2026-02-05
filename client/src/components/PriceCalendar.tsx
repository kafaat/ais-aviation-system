/**
 * Price Calendar Component
 *
 * Displays a calendar with flight prices for each day
 * Helps users find the best deals by showing price trends
 */

import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, Plane, TrendingDown } from "lucide-react";
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
  isToday,
  isBefore,
} from "date-fns";
import { ar, enUS } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface PriceCalendarProps {
  originId: number;
  destinationId: number;
  cabinClass?: "economy" | "business";
  onDateSelect?: (date: Date, price: number) => void;
  selectedDate?: Date;
}

interface DayPrice {
  date: string;
  lowestPrice: number | null;
  hasFlights: boolean;
}

export default function PriceCalendar({
  originId,
  destinationId,
  cabinClass = "economy",
  onDateSelect,
  selectedDate,
}: PriceCalendarProps) {
  const { t, i18n } = useTranslation();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const locale = i18n.language === "ar" ? ar : enUS;

  // Get month range
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Fetch prices for the month
  const { data: pricesData, isLoading } = trpc.flights.search.useQuery(
    {
      originId,
      destinationId,
      departureDate: monthStart,
    },
    {
      enabled: originId > 0 && destinationId > 0,
    }
  );

  // Process prices by date
  const pricesByDate = useMemo(() => {
    const map = new Map<string, DayPrice>();

    if (pricesData) {
      pricesData.forEach(flight => {
        const dateKey = format(flight.departureTime, "yyyy-MM-dd");
        const price =
          cabinClass === "business"
            ? Number(flight.businessPrice)
            : Number(flight.economyPrice);

        const existing = map.get(dateKey);
        if (
          !existing ||
          (price && price < (existing.lowestPrice || Infinity))
        ) {
          map.set(dateKey, {
            date: dateKey,
            lowestPrice: price || null,
            hasFlights: true,
          });
        }
      });
    }

    return map;
  }, [pricesData, cabinClass]);

  // Find lowest price in month
  const lowestMonthPrice = useMemo(() => {
    let lowest = Infinity;
    pricesByDate.forEach(day => {
      if (day.lowestPrice && day.lowestPrice < lowest) {
        lowest = day.lowestPrice;
      }
    });
    return lowest === Infinity ? null : lowest;
  }, [pricesByDate]);

  // Navigation handlers
  const handlePrevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));
  const handleNextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));

  // Format price
  const formatPrice = (price: number) => {
    return new Intl.NumberFormat(i18n.language === "ar" ? "ar-SA" : "en-SA", {
      style: "currency",
      currency: "SAR",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(price / 100);
  };

  // Get price color based on comparison to lowest
  const getPriceColor = (price: number | null) => {
    if (!price || !lowestMonthPrice) return "";
    const ratio = price / lowestMonthPrice;
    if (ratio <= 1.1) return "text-green-600 bg-green-50";
    if (ratio <= 1.3) return "text-yellow-600 bg-yellow-50";
    return "text-red-600 bg-red-50";
  };

  // Day names
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayNamesAr = [
    "الأحد",
    "الاثنين",
    "الثلاثاء",
    "الأربعاء",
    "الخميس",
    "الجمعة",
    "السبت",
  ];

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Plane className="h-5 w-5" />
            {t("priceCalendar.title")}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={handlePrevMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[140px] text-center font-medium">
              {format(currentMonth, "MMMM yyyy", { locale })}
            </span>
            <Button variant="outline" size="icon" onClick={handleNextMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {lowestMonthPrice && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground mt-2">
            <TrendingDown className="h-4 w-4 text-green-600" />
            <span>
              {t("priceCalendar.lowestPrice")}: {formatPrice(lowestMonthPrice)}
            </span>
          </div>
        )}
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: 35 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : (
          <>
            {/* Day headers */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {(i18n.language === "ar" ? dayNamesAr : dayNames).map(day => (
                <div
                  key={day}
                  className="text-center text-xs font-medium text-muted-foreground py-2"
                >
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-1">
              {/* Empty cells for days before month starts */}
              {Array.from({ length: monthStart.getDay() }).map((_, i) => (
                <div key={`empty-${i}`} className="h-16" />
              ))}

              {/* Days */}
              {daysInMonth.map(day => {
                const dateKey = format(day, "yyyy-MM-dd");
                const dayData = pricesByDate.get(dateKey);
                const isPast = isBefore(day, new Date()) && !isToday(day);
                const isSelected = selectedDate && isSameDay(day, selectedDate);

                return (
                  <button
                    key={dateKey}
                    onClick={() => {
                      if (!isPast && dayData?.lowestPrice && onDateSelect) {
                        onDateSelect(day, dayData.lowestPrice);
                      }
                    }}
                    disabled={isPast || !dayData?.hasFlights}
                    className={cn(
                      "h-16 p-1 rounded-lg border transition-all text-left flex flex-col",
                      "hover:border-primary hover:shadow-sm",
                      "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-border",
                      isSelected && "ring-2 ring-primary border-primary",
                      isToday(day) && "border-primary/50",
                      dayData?.lowestPrice && getPriceColor(dayData.lowestPrice)
                    )}
                  >
                    <span
                      className={cn(
                        "text-xs font-medium",
                        isToday(day) && "text-primary"
                      )}
                    >
                      {format(day, "d")}
                    </span>
                    {dayData?.lowestPrice ? (
                      <span className="text-xs font-bold mt-auto">
                        {formatPrice(dayData.lowestPrice)}
                      </span>
                    ) : dayData?.hasFlights ? (
                      <span className="text-xs text-muted-foreground mt-auto">
                        -
                      </span>
                    ) : null}
                    {dayData?.lowestPrice === lowestMonthPrice && (
                      <Badge
                        variant="secondary"
                        className="text-[10px] px-1 py-0 mt-0.5"
                      >
                        {t("priceCalendar.best")}
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex items-center justify-center gap-4 mt-4 text-xs">
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded bg-green-100 border border-green-300" />
                <span>{t("priceCalendar.low")}</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded bg-yellow-100 border border-yellow-300" />
                <span>{t("priceCalendar.medium")}</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded bg-red-100 border border-red-300" />
                <span>{t("priceCalendar.high")}</span>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
