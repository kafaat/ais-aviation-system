import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { ChevronLeft, ChevronRight, TrendingDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface PriceCalendarViewProps {
  originId: number;
  destinationId: number;
  cabinClass?: "economy" | "business";
  onDateSelect?: (date: string, price: number) => void;
}

export function PriceCalendarView({
  originId,
  destinationId,
  cabinClass = "economy",
  onDateSelect,
}: PriceCalendarViewProps) {
  const { t } = useTranslation();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const { data, isLoading } = trpc.priceCalendar.getMonthlyPrices.useQuery(
    { originId, destinationId, month, year, cabinClass },
    { enabled: originId > 0 && destinationId > 0 }
  );

  const goToPrevMonth = () => {
    if (month === 1) {
      setMonth(12);
      setYear(year - 1);
    } else {
      setMonth(month - 1);
    }
  };

  const goToNextMonth = () => {
    if (month === 12) {
      setMonth(1);
      setYear(year + 1);
    } else {
      setMonth(month + 1);
    }
  };

  const monthNames = [
    t("calendar.jan"),
    t("calendar.feb"),
    t("calendar.mar"),
    t("calendar.apr"),
    t("calendar.may"),
    t("calendar.jun"),
    t("calendar.jul"),
    t("calendar.aug"),
    t("calendar.sep"),
    t("calendar.oct"),
    t("calendar.nov"),
    t("calendar.dec"),
  ];

  // Get price color based on relative cost
  const getPriceColor = (price: number | null) => {
    if (!price || !data) return "";
    const min = data.lowestMonthPrice || 0;
    const max = data.highestMonthPrice || 0;
    if (max === min) return "bg-green-100 text-green-700 border-green-200";
    const ratio = (price - min) / (max - min);
    if (ratio <= 0.33) return "bg-green-100 text-green-700 border-green-200";
    if (ratio <= 0.66) return "bg-amber-50 text-amber-700 border-amber-200";
    return "bg-red-50 text-red-700 border-red-200";
  };

  // Build calendar grid
  const firstDayOfMonth = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const calendarDays: (null | {
    day: number;
    price: number | null;
    hasFlights: boolean;
    isCheapest: boolean;
  })[] = [];

  // Pad beginning
  for (let i = 0; i < firstDayOfMonth; i++) {
    calendarDays.push(null);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dayData = data?.prices.find(p => p.date === dateStr);
    calendarDays.push({
      day,
      price: dayData?.lowestPrice || null,
      hasFlights: dayData?.hasFlights || false,
      isCheapest: dateStr === data?.cheapestDay,
    });
  }

  const dayHeaders = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <Card className="p-4">
      {/* Month Navigation */}
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" size="sm" onClick={goToPrevMonth}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h3 className="font-semibold">
          {monthNames[month - 1]} {year}
        </h3>
        <Button variant="ghost" size="sm" onClick={goToNextMonth}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Legend */}
      <div className="flex gap-3 mb-3 justify-center text-xs">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-green-100 border border-green-200" />
          <span>{t("priceCalendar.cheap")}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-amber-50 border border-amber-200" />
          <span>{t("priceCalendar.average")}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded bg-red-50 border border-red-200" />
          <span>{t("priceCalendar.expensive")}</span>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <>
          {/* Day Headers */}
          <div className="grid grid-cols-7 gap-1 mb-1">
            {dayHeaders.map(d => (
              <div
                key={d}
                className="text-center text-xs font-medium text-muted-foreground py-1"
              >
                {d}
              </div>
            ))}
          </div>

          {/* Calendar Grid */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((cell, idx) => {
              if (!cell) {
                return <div key={`empty-${idx}`} className="h-16" />;
              }

              const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(cell.day).padStart(2, "0")}`;
              const isPast =
                new Date(dateStr) < new Date(new Date().toDateString());

              return (
                <button
                  key={cell.day}
                  onClick={() => {
                    if (cell.hasFlights && cell.price && !isPast) {
                      onDateSelect?.(dateStr, cell.price);
                    }
                  }}
                  disabled={!cell.hasFlights || isPast}
                  className={cn(
                    "h-16 rounded-lg border text-center p-1 transition-all relative",
                    cell.hasFlights && !isPast
                      ? cn(
                          getPriceColor(cell.price),
                          "hover:shadow-md cursor-pointer"
                        )
                      : "bg-gray-50 text-gray-300 border-gray-100",
                    cell.isCheapest && "ring-2 ring-green-500"
                  )}
                >
                  <span className="text-xs block">{cell.day}</span>
                  {cell.hasFlights && cell.price && (
                    <span className="text-[10px] font-medium block mt-0.5">
                      {(cell.price / 100).toFixed(0)}
                    </span>
                  )}
                  {cell.isCheapest && (
                    <TrendingDown className="h-3 w-3 absolute top-0.5 right-0.5 text-green-600" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Cheapest Day Badge */}
          {data?.cheapestDay && data?.lowestMonthPrice && (
            <div className="mt-3 flex items-center justify-center">
              <Badge className="bg-green-100 text-green-700 border-green-200">
                <TrendingDown className="h-3 w-3 mr-1" />
                {t("priceCalendar.bestPrice")}:{" "}
                {(data.lowestMonthPrice / 100).toFixed(0)} {t("common.sar")} (
                {data.cheapestDay})
              </Badge>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
