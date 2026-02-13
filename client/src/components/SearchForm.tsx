/**
 * SearchForm Component
 *
 * A flight search form that allows users to select:
 * - Origin airport
 * - Destination airport
 * - Departure date
 * - Calendar view toggle for price comparison
 * - Flexible dates option (+/- 3 days)
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  MapPin,
  Calendar as CalendarIcon,
  CalendarRange,
  ChevronDown,
} from "lucide-react";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import PriceCalendar from "@/components/PriceCalendar";
import FlexibleDateSearch from "@/components/FlexibleDateSearch";
import { cn } from "@/lib/utils";

export interface Airport {
  id: number;
  code: string;
  city: string;
  name: string;
}

export interface SearchFormProps {
  airports: Airport[];
  originId: string;
  destinationId: string;
  departureDate: Date | undefined;
  onOriginChange: (value: string) => void;
  onDestinationChange: (value: string) => void;
  onDateChange: (date: Date | undefined) => void;
  onSearch: () => void;
  isLoading?: boolean;
  showCalendarView?: boolean;
  onCalendarViewChange?: (show: boolean) => void;
  flexibleDates?: boolean;
  onFlexibleDatesChange?: (flexible: boolean) => void;
}

export function SearchForm({
  airports,
  originId,
  destinationId,
  departureDate,
  onOriginChange,
  onDestinationChange,
  onDateChange,
  onSearch,
  isLoading = false,
  showCalendarView: controlledShowCalendar,
  onCalendarViewChange,
  flexibleDates: controlledFlexibleDates,
  onFlexibleDatesChange,
}: SearchFormProps) {
  const { t, i18n } = useTranslation();
  const currentLocale = i18n.language === "ar" ? ar : enUS;

  // Internal state for calendar view (used if not controlled)
  const [internalShowCalendar, setInternalShowCalendar] = useState(false);
  const [internalFlexibleDates, setInternalFlexibleDates] = useState(false);

  // Use controlled or internal state
  const showCalendarView = controlledShowCalendar ?? internalShowCalendar;
  const flexibleDates = controlledFlexibleDates ?? internalFlexibleDates;

  const handleCalendarViewChange = (show: boolean) => {
    if (onCalendarViewChange) {
      onCalendarViewChange(show);
    } else {
      setInternalShowCalendar(show);
    }
  };

  const handleFlexibleDatesChange = (flexible: boolean) => {
    if (onFlexibleDatesChange) {
      onFlexibleDatesChange(flexible);
    } else {
      setInternalFlexibleDates(flexible);
    }
  };

  const isSearchDisabled =
    !originId || !destinationId || !departureDate || isLoading;

  // Check if we have enough info to show calendar features
  const canShowCalendarFeatures =
    originId &&
    destinationId &&
    Number(originId) > 0 &&
    Number(destinationId) > 0;

  // Handle date selection from calendar components
  const handlePriceCalendarDateSelect = (date: Date, _price: number) => {
    onDateChange(date);
  };

  return (
    <div className="space-y-4">
      <Card
        className="p-8 max-w-4xl mx-auto shadow-2xl border-0 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm"
        data-testid="search-form"
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Origin Selection */}
          <div className="space-y-2" data-testid="origin-field">
            <label
              id="origin-label"
              className="text-sm font-medium flex items-center gap-2"
            >
              <MapPin className="h-4 w-4 text-primary" aria-hidden="true" />
              {t("home.search.from")}
            </label>
            <Select value={originId} onValueChange={onOriginChange}>
              <SelectTrigger
                className="h-12"
                aria-labelledby="origin-label"
                data-testid="origin-select"
              >
                <SelectValue placeholder={t("home.search.selectCity")} />
              </SelectTrigger>
              <SelectContent>
                {airports.map(airport => (
                  <SelectItem
                    key={airport.id}
                    value={airport.id.toString()}
                    data-testid={`origin-option-${airport.code}`}
                  >
                    {airport.city} ({airport.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Destination Selection */}
          <div className="space-y-2" data-testid="destination-field">
            <label
              id="destination-label"
              className="text-sm font-medium flex items-center gap-2"
            >
              <MapPin className="h-4 w-4 text-primary" aria-hidden="true" />
              {t("home.search.to")}
            </label>
            <Select value={destinationId} onValueChange={onDestinationChange}>
              <SelectTrigger
                className="h-12"
                aria-labelledby="destination-label"
                data-testid="destination-select"
              >
                <SelectValue placeholder={t("home.search.selectCity")} />
              </SelectTrigger>
              <SelectContent>
                {airports.map(airport => (
                  <SelectItem
                    key={airport.id}
                    value={airport.id.toString()}
                    data-testid={`destination-option-${airport.code}`}
                  >
                    {airport.city} ({airport.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date Selection */}
          <div className="space-y-2" data-testid="date-field">
            <label
              id="date-label"
              className="text-sm font-medium flex items-center gap-2"
            >
              <CalendarIcon
                className="h-4 w-4 text-primary"
                aria-hidden="true"
              />
              {t("home.search.departureDate")}
            </label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full h-12 justify-start text-left font-normal"
                  aria-labelledby="date-label"
                  data-testid="date-picker-button"
                >
                  {departureDate ? (
                    <span data-testid="selected-date">
                      {format(departureDate, "PPP", { locale: currentLocale })}
                    </span>
                  ) : (
                    <span
                      className="text-muted-foreground"
                      data-testid="date-placeholder"
                    >
                      {t("home.search.selectDate")}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-auto p-0"
                data-testid="calendar-popover"
              >
                <Calendar
                  mode="single"
                  selected={departureDate}
                  onSelect={onDateChange}
                  disabled={date => date < new Date()}
                  initialFocus
                  data-testid="calendar"
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Advanced Options: Calendar View Toggle and Flexible Dates */}
        <div className="mt-6 flex flex-wrap items-center gap-6">
          {/* Calendar View Toggle */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="calendar-view"
              checked={showCalendarView}
              onCheckedChange={checked =>
                handleCalendarViewChange(checked === true)
              }
              disabled={!canShowCalendarFeatures}
              data-testid="calendar-view-toggle"
            />
            <Label
              htmlFor="calendar-view"
              className={cn(
                "text-sm cursor-pointer flex items-center gap-1.5",
                !canShowCalendarFeatures && "text-muted-foreground"
              )}
            >
              <CalendarIcon className="h-4 w-4" />
              {t("home.search.showPriceCalendar")}
            </Label>
          </div>

          {/* Flexible Dates Toggle */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="flexible-dates"
              checked={flexibleDates}
              onCheckedChange={checked =>
                handleFlexibleDatesChange(checked === true)
              }
              disabled={!departureDate || !canShowCalendarFeatures}
              data-testid="flexible-dates-toggle"
            />
            <Label
              htmlFor="flexible-dates"
              className={cn(
                "text-sm cursor-pointer flex items-center gap-1.5",
                (!departureDate || !canShowCalendarFeatures) &&
                  "text-muted-foreground"
              )}
            >
              <CalendarRange className="h-4 w-4" />
              {t("home.search.flexibleDates")}
            </Label>
          </div>
        </div>

        {/* Search Button */}
        <div className="mt-6">
          <Button
            onClick={onSearch}
            size="lg"
            className="w-full h-14 text-lg font-semibold shadow-lg"
            disabled={isSearchDisabled}
            data-testid="search-button"
          >
            {isLoading ? t("common.loading") : t("home.search.searchFlights")}
          </Button>
        </div>

        {/* Validation Message */}
        {isSearchDisabled && !isLoading && (
          <p
            className="text-sm text-muted-foreground text-center mt-4"
            data-testid="validation-message"
          >
            {!originId && t("home.search.selectOrigin")}
            {originId && !destinationId && t("home.search.selectDestination")}
            {originId &&
              destinationId &&
              !departureDate &&
              t("home.search.selectDate")}
          </p>
        )}
      </Card>

      {/* Price Calendar View */}
      {showCalendarView && canShowCalendarFeatures && (
        <Collapsible defaultOpen className="max-w-4xl mx-auto">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              className="w-full flex items-center justify-between p-4 hover:bg-muted/50"
            >
              <span className="flex items-center gap-2 font-medium">
                <CalendarIcon className="h-5 w-5" />
                {t("priceCalendar.title")}
              </span>
              <ChevronDown className="h-4 w-4 transition-transform duration-200 group-data-[state=open]:rotate-180" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <PriceCalendar
              originId={Number(originId)}
              destinationId={Number(destinationId)}
              cabinClass="economy"
              selectedDate={departureDate}
              onDateSelect={handlePriceCalendarDateSelect}
            />
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Flexible Dates View */}
      {flexibleDates && departureDate && canShowCalendarFeatures && (
        <FlexibleDateSearch
          originId={Number(originId)}
          destinationId={Number(destinationId)}
          centerDate={departureDate}
          cabinClass="economy"
          flexDays={3}
          selectedDate={departureDate}
          onDateSelect={handlePriceCalendarDateSelect}
          className="max-w-4xl mx-auto"
        />
      )}
    </div>
  );
}

export default SearchForm;
