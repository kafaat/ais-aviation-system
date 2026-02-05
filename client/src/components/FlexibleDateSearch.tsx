/**
 * FlexibleDateSearch Component
 *
 * Shows price comparison across flexible dates (+/- days from selected date)
 * Features:
 * - +/- 3 days flexible search option
 * - Show price comparison across dates
 * - Highlight cheapest day
 * - Visual price bar chart
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { CalendarRange, TrendingDown, Check } from "lucide-react";
import { format, parseISO } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface FlexibleDateSearchProps {
  originId: number;
  destinationId: number;
  centerDate: Date;
  cabinClass?: "economy" | "business";
  flexDays?: number;
  onDateSelect?: (date: Date, price: number) => void;
  selectedDate?: Date;
  className?: string;
}

export default function FlexibleDateSearch({
  originId,
  destinationId,
  centerDate,
  cabinClass = "economy",
  flexDays = 3,
  onDateSelect,
  selectedDate,
  className,
}: FlexibleDateSearchProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "ar" ? ar : enUS;

  // Fetch flexible prices
  const { data: flexiblePrices, isLoading } =
    trpc.priceCalendar.getFlexiblePrices.useQuery(
      {
        originId,
        destinationId,
        date: centerDate,
        flexDays,
        cabinClass,
      },
      {
        enabled: originId > 0 && destinationId > 0,
        staleTime: 5 * 60 * 1000, // 5 minutes
      }
    );

  // Calculate price bar heights for visualization
  const priceData = useMemo(() => {
    if (!flexiblePrices?.prices) return [];

    const { min, max } = flexiblePrices.priceRange;
    if (!min || !max) return flexiblePrices.prices;

    const range = max - min || 1;

    return flexiblePrices.prices.map(day => ({
      ...day,
      barHeight:
        day.lowestPrice !== null
          ? Math.max(20, ((day.lowestPrice - min) / range) * 80 + 20)
          : 0,
    }));
  }, [flexiblePrices]);

  // Format price
  const formatPrice = (price: number) => {
    return new Intl.NumberFormat(i18n.language === "ar" ? "ar-SA" : "en-SA", {
      style: "currency",
      currency: "SAR",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(price / 100);
  };

  // Get savings compared to selected date
  const calculateSavings = (price: number): number | null => {
    if (!selectedDate || !flexiblePrices?.prices) return null;

    const selectedDateStr = format(selectedDate, "yyyy-MM-dd");
    const selectedDayData = flexiblePrices.prices.find(
      d => d.date === selectedDateStr
    );

    if (!selectedDayData?.lowestPrice) return null;
    if (price >= selectedDayData.lowestPrice) return null;

    return selectedDayData.lowestPrice - price;
  };

  // Determine if this is the cheapest day
  const isCheapestDay = (dateStr: string): boolean => {
    return flexiblePrices?.cheapestDay?.date === dateStr;
  };

  // Check if date is the center date
  const isCenterDate = (dateStr: string): boolean => {
    return dateStr === flexiblePrices?.centerDate;
  };

  // Check if date is selected
  const isSelectedDate = (dateStr: string): boolean => {
    if (!selectedDate) return false;
    return dateStr === format(selectedDate, "yyyy-MM-dd");
  };

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarRange className="h-5 w-5" />
          {t("flexibleDates.title")}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {t("flexibleDates.subtitle", { days: flexDays })}
        </p>
      </CardHeader>

      <CardContent>
        {isLoading ? (
          <div className="flex gap-2">
            {Array.from({ length: flexDays * 2 + 1 }).map((_, i) => (
              <Skeleton key={i} className="h-32 flex-1" />
            ))}
          </div>
        ) : flexiblePrices?.prices && priceData.length > 0 ? (
          <>
            {/* Cheapest day summary */}
            {flexiblePrices.cheapestDay && (
              <div className="flex items-center gap-2 mb-4 p-2 bg-green-50 dark:bg-green-950 rounded-lg border border-green-200 dark:border-green-800">
                <TrendingDown className="h-4 w-4 text-green-600" />
                <span className="text-sm">
                  {t("flexibleDates.cheapestDay")}:{" "}
                  <span className="font-semibold">
                    {format(
                      parseISO(flexiblePrices.cheapestDay.date),
                      "EEE, d MMM",
                      { locale }
                    )}
                  </span>{" "}
                  -{" "}
                  <span className="font-bold text-green-600">
                    {formatPrice(flexiblePrices.cheapestDay.price)}
                  </span>
                </span>
              </div>
            )}

            {/* Price comparison cards */}
            <div className="flex gap-2 overflow-x-auto pb-2">
              {priceData.map(day => {
                const date = parseISO(day.date);
                const cheapest = isCheapestDay(day.date);
                const center = isCenterDate(day.date);
                const selected = isSelectedDate(day.date);
                const savings =
                  day.lowestPrice !== null
                    ? calculateSavings(day.lowestPrice)
                    : null;

                return (
                  <Button
                    key={day.date}
                    variant={selected ? "default" : "outline"}
                    className={cn(
                      "flex-1 min-w-[80px] h-auto flex flex-col items-center gap-1 p-2 relative",
                      cheapest &&
                        !selected &&
                        "border-green-500 bg-green-50 dark:bg-green-950 hover:bg-green-100",
                      center && !selected && !cheapest && "border-primary/50",
                      !day.hasFlights && "opacity-50"
                    )}
                    onClick={() => {
                      if (day.hasFlights && day.lowestPrice && onDateSelect) {
                        onDateSelect(date, day.lowestPrice);
                      }
                    }}
                    disabled={!day.hasFlights}
                  >
                    {/* Day of week */}
                    <span
                      className={cn(
                        "text-[10px] uppercase font-medium",
                        !selected && "text-muted-foreground"
                      )}
                    >
                      {format(date, "EEE", { locale })}
                    </span>

                    {/* Date */}
                    <span
                      className={cn(
                        "text-sm font-semibold",
                        center && !selected && "text-primary"
                      )}
                    >
                      {format(date, "d MMM", { locale })}
                    </span>

                    {/* Price bar visualization */}
                    {day.lowestPrice !== null && (
                      <div className="w-full h-20 flex items-end justify-center">
                        <div
                          className={cn(
                            "w-8 rounded-t transition-all",
                            cheapest
                              ? "bg-green-500"
                              : selected
                                ? "bg-primary-foreground/20"
                                : "bg-primary/30"
                          )}
                          style={{
                            height: `${(day as typeof day & { barHeight?: number }).barHeight || 20}%`,
                          }}
                        />
                      </div>
                    )}

                    {/* Price */}
                    {day.lowestPrice !== null ? (
                      <span
                        className={cn(
                          "text-xs font-bold",
                          cheapest && !selected && "text-green-600"
                        )}
                      >
                        {formatPrice(day.lowestPrice)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {t("flexibleDates.noFlights")}
                      </span>
                    )}

                    {/* Badges */}
                    {cheapest && (
                      <Badge
                        variant="secondary"
                        className="absolute -top-2 left-1/2 -translate-x-1/2 text-[8px] px-1 py-0 bg-green-500 text-white border-0"
                      >
                        {t("flexibleDates.best")}
                      </Badge>
                    )}

                    {selected && (
                      <Check className="absolute top-1 right-1 h-3 w-3" />
                    )}

                    {/* Savings indicator */}
                    {savings && savings > 0 && !selected && (
                      <span className="text-[10px] text-green-600 font-medium">
                        {t("flexibleDates.save")} {formatPrice(savings)}
                      </span>
                    )}
                  </Button>
                );
              })}
            </div>

            {/* Price range info */}
            {flexiblePrices.priceRange.min && flexiblePrices.priceRange.max && (
              <div className="flex justify-between text-xs text-muted-foreground mt-3 pt-3 border-t">
                <span>
                  {t("flexibleDates.priceRange")}:{" "}
                  {formatPrice(flexiblePrices.priceRange.min)} -{" "}
                  {formatPrice(flexiblePrices.priceRange.max)}
                </span>
                {flexiblePrices.priceRange.max >
                  flexiblePrices.priceRange.min && (
                  <span className="text-green-600">
                    {t("flexibleDates.potentialSavings")}:{" "}
                    {formatPrice(
                      flexiblePrices.priceRange.max -
                        flexiblePrices.priceRange.min
                    )}
                  </span>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="text-center text-muted-foreground py-6">
            <CalendarRange className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>{t("flexibleDates.noData")}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
