/**
 * Price Calendar Component
 *
 * Displays a calendar with flight prices for each day
 * Helps users find the best deals by showing price trends
 * Features:
 * - Monthly calendar view with lowest prices per day
 * - Color coding: green (cheap), yellow (medium), red (expensive)
 * - Click day to select departure date
 * - Show price range for each day
 * - Navigation between months
 */

import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ChevronLeft,
  ChevronRight,
  Plane,
  TrendingDown,
  TrendingUp,
  Calendar as CalendarIcon,
} from "lucide-react";
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameDay,
  addMonths,
  subMonths,
  isToday,
  isBefore,
  startOfDay,
} from "date-fns";
import { ar, enUS } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface PriceCalendarProps {
  originId: number;
  destinationId: number;
  cabinClass?: "economy" | "business";
  onDateSelect?: (date: Date, price: number) => void;
  selectedDate?: Date;
  className?: string;
}

export default function PriceCalendar({
  originId,
  destinationId,
  cabinClass = "economy",
  onDateSelect,
  selectedDate,
  className,
}: PriceCalendarProps) {
  const { t, i18n } = useTranslation();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const locale = i18n.language === "ar" ? ar : enUS;

  // Get month and year for the API
  const month = currentMonth.getMonth() + 1;
  const year = currentMonth.getFullYear();

  // Fetch monthly prices from the new API
  const { data: monthlyPrices, isLoading } =
    trpc.priceCalendar.getMonthlyPrices.useQuery(
      {
        originId,
        destinationId,
        month,
        year,
        cabinClass,
      },
      {
        enabled: originId > 0 && destinationId > 0,
        staleTime: 5 * 60 * 1000, // 5 minutes
      }
    );

  // Get month range for calendar display
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  // Process prices by date
  const pricesByDate = useMemo(() => {
    const map = new Map<
      string,
      {
        lowestPrice: number | null;
        highestPrice: number | null;
        averagePrice: number | null;
        flightCount: number;
        hasFlights: boolean;
      }
    >();

    if (monthlyPrices?.prices) {
      monthlyPrices.prices.forEach(day => {
        map.set(day.date, {
          lowestPrice: day.lowestPrice,
          highestPrice: day.highestPrice,
          averagePrice: day.averagePrice,
          flightCount: day.flightCount,
          hasFlights: day.hasFlights,
        });
      });
    }

    return map;
  }, [monthlyPrices]);

  // Navigation handlers
  const handlePrevMonth = () => {
    const newMonth = subMonths(currentMonth, 1);
    // Don't allow navigating to past months
    if (newMonth >= startOfMonth(new Date())) {
      setCurrentMonth(newMonth);
    }
  };

  const handleNextMonth = () => {
    const newMonth = addMonths(currentMonth, 1);
    // Limit to 12 months ahead
    const maxDate = addMonths(new Date(), 12);
    if (newMonth <= maxDate) {
      setCurrentMonth(newMonth);
    }
  };

  // Can navigate to previous month?
  const canGoPrev = startOfMonth(currentMonth) > startOfMonth(new Date());
  const canGoNext =
    startOfMonth(addMonths(currentMonth, 1)) <=
    startOfMonth(addMonths(new Date(), 12));

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
  const getPriceColor = (price: number | null): string => {
    if (!price || !monthlyPrices?.lowestMonthPrice) return "";

    const lowestPrice = monthlyPrices.lowestMonthPrice;
    const ratio = price / lowestPrice;

    if (ratio <= 1.1) return "bg-green-50 text-green-700 border-green-200";
    if (ratio <= 1.3) return "bg-yellow-50 text-yellow-700 border-yellow-200";
    return "bg-red-50 text-red-700 border-red-200";
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
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5" />
            {t("priceCalendar.title")}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={handlePrevMonth}
              disabled={!canGoPrev}
              aria-label={t("common.previous")}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[140px] text-center font-medium">
              {format(currentMonth, "MMMM yyyy", { locale })}
            </span>
            <Button
              variant="outline"
              size="icon"
              onClick={handleNextMonth}
              disabled={!canGoNext}
              aria-label={t("common.next")}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Price summary */}
        {monthlyPrices && (
          <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground mt-3">
            {monthlyPrices.lowestMonthPrice && (
              <div className="flex items-center gap-1.5">
                <TrendingDown className="h-4 w-4 text-green-600" />
                <span>
                  {t("priceCalendar.lowestPrice")}:{" "}
                  <span className="font-semibold text-green-600">
                    {formatPrice(monthlyPrices.lowestMonthPrice)}
                  </span>
                </span>
              </div>
            )}
            {monthlyPrices.highestMonthPrice && (
              <div className="flex items-center gap-1.5">
                <TrendingUp className="h-4 w-4 text-red-600" />
                <span>
                  {t("priceCalendar.highestPrice")}:{" "}
                  <span className="font-semibold text-red-600">
                    {formatPrice(monthlyPrices.highestMonthPrice)}
                  </span>
                </span>
              </div>
            )}
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
          <TooltipProvider>
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
                const isPast =
                  isBefore(startOfDay(day), startOfDay(new Date())) &&
                  !isToday(day);
                const isSelected = selectedDate && isSameDay(day, selectedDate);
                const isCheapestDay =
                  monthlyPrices?.cheapestDay === dateKey &&
                  dayData?.lowestPrice;

                return (
                  <Tooltip key={dateKey}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => {
                          if (!isPast && dayData?.lowestPrice && onDateSelect) {
                            onDateSelect(day, dayData.lowestPrice);
                          }
                        }}
                        disabled={isPast || !dayData?.hasFlights}
                        className={cn(
                          "h-16 p-1 rounded-lg border transition-all text-left flex flex-col relative",
                          "hover:border-primary hover:shadow-sm",
                          "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-border",
                          isSelected && "ring-2 ring-primary border-primary",
                          isToday(day) && "border-primary/50",
                          dayData?.lowestPrice &&
                            getPriceColor(dayData.lowestPrice)
                        )}
                      >
                        <span
                          className={cn(
                            "text-xs font-medium",
                            isToday(day) && "text-primary font-bold"
                          )}
                        >
                          {format(day, "d")}
                        </span>

                        {dayData?.lowestPrice ? (
                          <span className="text-xs font-bold mt-auto truncate">
                            {formatPrice(dayData.lowestPrice)}
                          </span>
                        ) : dayData?.hasFlights ? (
                          <span className="text-xs text-muted-foreground mt-auto">
                            -
                          </span>
                        ) : null}

                        {isCheapestDay && (
                          <Badge
                            variant="secondary"
                            className="absolute top-0.5 right-0.5 text-[8px] px-1 py-0 bg-green-100 text-green-700 border-green-300"
                          >
                            {t("priceCalendar.best")}
                          </Badge>
                        )}
                      </button>
                    </TooltipTrigger>
                    {dayData?.hasFlights && dayData.lowestPrice && (
                      <TooltipContent side="top" className="text-xs">
                        <div className="space-y-1">
                          <p className="font-semibold">
                            {format(day, "EEEE, d MMMM", { locale })}
                          </p>
                          <p>
                            {t("priceCalendar.lowestPrice")}:{" "}
                            {formatPrice(dayData.lowestPrice)}
                          </p>
                          {dayData.highestPrice &&
                            dayData.highestPrice !== dayData.lowestPrice && (
                              <p>
                                {t("priceCalendar.highestPrice")}:{" "}
                                {formatPrice(dayData.highestPrice)}
                              </p>
                            )}
                          <p className="text-muted-foreground">
                            {dayData.flightCount}{" "}
                            {dayData.flightCount === 1 ? "flight" : "flights"}{" "}
                            {t("priceCalendar.available")}
                          </p>
                        </div>
                      </TooltipContent>
                    )}
                  </Tooltip>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center justify-center gap-4 mt-4 text-xs">
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded bg-green-50 border border-green-200" />
                <span>{t("priceCalendar.low")}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded bg-yellow-50 border border-yellow-200" />
                <span>{t("priceCalendar.medium")}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded bg-red-50 border border-red-200" />
                <span>{t("priceCalendar.high")}</span>
              </div>
            </div>

            {/* No flights message */}
            {monthlyPrices && !monthlyPrices.lowestMonthPrice && (
              <div className="text-center text-muted-foreground py-4">
                <Plane className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>{t("priceCalendar.noFlights")}</p>
              </div>
            )}
          </TooltipProvider>
        )}
      </CardContent>
    </Card>
  );
}
