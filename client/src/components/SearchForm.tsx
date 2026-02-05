/**
 * SearchForm Component
 *
 * A flight search form that allows users to select:
 * - Origin airport
 * - Destination airport
 * - Departure date
 */

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
import { MapPin, Calendar as CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";

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
}: SearchFormProps) {
  const { t, i18n } = useTranslation();
  const currentLocale = i18n.language === "ar" ? ar : enUS;

  const isSearchDisabled = !originId || !destinationId || !departureDate || isLoading;

  return (
    <Card className="p-8 max-w-4xl mx-auto shadow-2xl border-0 bg-white/80 backdrop-blur-sm" data-testid="search-form">
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
              {airports.map((airport) => (
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
              {airports.map((airport) => (
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
            <CalendarIcon className="h-4 w-4 text-primary" aria-hidden="true" />
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
                  <span className="text-muted-foreground" data-testid="date-placeholder">
                    {t("home.search.selectDate")}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" data-testid="calendar-popover">
              <Calendar
                mode="single"
                selected={departureDate}
                onSelect={onDateChange}
                disabled={(date) => date < new Date()}
                initialFocus
                data-testid="calendar"
              />
            </PopoverContent>
          </Popover>
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
        <p className="text-sm text-muted-foreground text-center mt-4" data-testid="validation-message">
          {!originId && t("home.search.selectOrigin")}
          {originId && !destinationId && t("home.search.selectDestination")}
          {originId && destinationId && !departureDate && t("home.search.selectDate")}
        </p>
      )}
    </Card>
  );
}

export default SearchForm;
