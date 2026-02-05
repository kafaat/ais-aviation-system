/**
 * MultiCitySearch Component
 *
 * A flight search form for multi-city itineraries that allows users to:
 * - Add/remove flight segments (2-5 segments)
 * - Select origin, destination, and date for each segment
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
import { MapPin, Calendar as CalendarIcon, Plus, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";

export interface Airport {
  id: number;
  code: string;
  city: string;
  name: string;
}

export interface Segment {
  originId: string;
  destinationId: string;
  departureDate: Date | undefined;
}

export interface MultiCitySearchProps {
  airports: Airport[];
  segments: Segment[];
  onSegmentsChange: (segments: Segment[]) => void;
  onSearch: () => void;
  isLoading?: boolean;
  minSegments?: number;
  maxSegments?: number;
}

export function MultiCitySearch({
  airports,
  segments,
  onSegmentsChange,
  onSearch,
  isLoading = false,
  minSegments = 2,
  maxSegments = 5,
}: MultiCitySearchProps) {
  const { t, i18n } = useTranslation();
  const currentLocale = i18n.language === "ar" ? ar : enUS;

  const updateSegment = (
    index: number,
    field: keyof Segment,
    value: string | Date | undefined
  ) => {
    const newSegments = [...segments];
    newSegments[index] = {
      ...newSegments[index],
      [field]: value,
    };
    onSegmentsChange(newSegments);
  };

  const addSegment = () => {
    if (segments.length >= maxSegments) return;

    // Use the destination of the last segment as the origin of the new segment
    const lastSegment = segments[segments.length - 1];
    const newSegment: Segment = {
      originId: lastSegment?.destinationId || "",
      destinationId: "",
      departureDate: undefined,
    };
    onSegmentsChange([...segments, newSegment]);
  };

  const removeSegment = (index: number) => {
    if (segments.length <= minSegments) return;
    const newSegments = segments.filter((_, i) => i !== index);
    onSegmentsChange(newSegments);
  };

  const isSearchDisabled =
    isLoading ||
    segments.some(
      segment =>
        !segment.originId || !segment.destinationId || !segment.departureDate
    );

  // Validate dates are in chronological order
  const hasInvalidDates = () => {
    for (let i = 1; i < segments.length; i++) {
      const prevDate = segments[i - 1].departureDate;
      const currDate = segments[i].departureDate;
      if (prevDate && currDate && currDate < prevDate) {
        return true;
      }
    }
    return false;
  };

  return (
    <Card
      className="p-8 max-w-4xl mx-auto shadow-2xl border-0 bg-white/80 backdrop-blur-sm"
      data-testid="multi-city-search-form"
    >
      <div className="space-y-6">
        {segments.map((segment, index) => (
          <div key={index} className="relative">
            {/* Segment Header */}
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-muted-foreground">
                {t("multiCity.segment")} {index + 1}
              </span>
              {segments.length > minSegments && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => removeSegment(index)}
                  aria-label={t("multiCity.removeSegment")}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
            </div>

            {/* Segment Fields */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Origin Selection */}
              <div className="space-y-2" data-testid={`origin-field-${index}`}>
                <label
                  id={`origin-label-${index}`}
                  className="text-sm font-medium flex items-center gap-2"
                >
                  <MapPin className="h-4 w-4 text-primary" aria-hidden="true" />
                  {t("home.search.from")}
                </label>
                <Select
                  value={segment.originId}
                  onValueChange={value =>
                    updateSegment(index, "originId", value)
                  }
                >
                  <SelectTrigger
                    className="h-12"
                    aria-labelledby={`origin-label-${index}`}
                    data-testid={`origin-select-${index}`}
                  >
                    <SelectValue placeholder={t("home.search.selectCity")} />
                  </SelectTrigger>
                  <SelectContent>
                    {airports.map(airport => (
                      <SelectItem
                        key={airport.id}
                        value={airport.id.toString()}
                        data-testid={`origin-option-${index}-${airport.code}`}
                      >
                        {airport.city} ({airport.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Destination Selection */}
              <div
                className="space-y-2"
                data-testid={`destination-field-${index}`}
              >
                <label
                  id={`destination-label-${index}`}
                  className="text-sm font-medium flex items-center gap-2"
                >
                  <MapPin className="h-4 w-4 text-primary" aria-hidden="true" />
                  {t("home.search.to")}
                </label>
                <Select
                  value={segment.destinationId}
                  onValueChange={value =>
                    updateSegment(index, "destinationId", value)
                  }
                >
                  <SelectTrigger
                    className="h-12"
                    aria-labelledby={`destination-label-${index}`}
                    data-testid={`destination-select-${index}`}
                  >
                    <SelectValue placeholder={t("home.search.selectCity")} />
                  </SelectTrigger>
                  <SelectContent>
                    {airports.map(airport => (
                      <SelectItem
                        key={airport.id}
                        value={airport.id.toString()}
                        data-testid={`destination-option-${index}-${airport.code}`}
                      >
                        {airport.city} ({airport.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Date Selection */}
              <div className="space-y-2" data-testid={`date-field-${index}`}>
                <label
                  id={`date-label-${index}`}
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
                      aria-labelledby={`date-label-${index}`}
                      data-testid={`date-picker-button-${index}`}
                    >
                      {segment.departureDate ? (
                        <span data-testid={`selected-date-${index}`}>
                          {format(segment.departureDate, "PPP", {
                            locale: currentLocale,
                          })}
                        </span>
                      ) : (
                        <span
                          className="text-muted-foreground"
                          data-testid={`date-placeholder-${index}`}
                        >
                          {t("home.search.selectDate")}
                        </span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-auto p-0"
                    data-testid={`calendar-popover-${index}`}
                  >
                    <Calendar
                      mode="single"
                      selected={segment.departureDate}
                      onSelect={date =>
                        updateSegment(index, "departureDate", date)
                      }
                      disabled={date => {
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        // Disable past dates
                        if (date < today) return true;
                        // Disable dates before previous segment
                        const prevSegmentDate =
                          index > 0 ? segments[index - 1].departureDate : null;
                        if (prevSegmentDate && date < prevSegmentDate) {
                          return true;
                        }
                        return false;
                      }}
                      initialFocus
                      data-testid={`calendar-${index}`}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Connection line between segments */}
            {index < segments.length - 1 && (
              <div className="flex justify-center my-4">
                <div className="w-0.5 h-8 bg-gradient-to-b from-primary/50 to-primary/20"></div>
              </div>
            )}
          </div>
        ))}

        {/* Add Segment Button */}
        {segments.length < maxSegments && (
          <Button
            type="button"
            variant="outline"
            className="w-full h-12 border-dashed border-2 hover:bg-muted/50"
            onClick={addSegment}
            data-testid="add-segment-button"
          >
            <Plus className="h-5 w-5 mr-2" aria-hidden="true" />
            {t("multiCity.addSegment")}
          </Button>
        )}

        {/* Discount Info */}
        <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-4">
          <p className="text-sm text-green-800 font-medium">
            {t("multiCity.discountInfo")}
          </p>
          <div className="flex flex-wrap gap-3 mt-2 text-xs text-green-700">
            <span>{t("multiCity.discount3Segments")}</span>
            <span>{t("multiCity.discount4Segments")}</span>
            <span>{t("multiCity.discount5Segments")}</span>
          </div>
        </div>

        {/* Search Button */}
        <div className="mt-6">
          <Button
            onClick={onSearch}
            size="lg"
            className="w-full h-14 text-lg font-semibold shadow-lg"
            disabled={isSearchDisabled || hasInvalidDates()}
            data-testid="search-button"
          >
            {isLoading ? t("common.loading") : t("multiCity.searchFlights")}
          </Button>
        </div>

        {/* Validation Messages */}
        {hasInvalidDates() && (
          <p
            className="text-sm text-destructive text-center"
            data-testid="date-validation-message"
          >
            {t("multiCity.invalidDatesOrder")}
          </p>
        )}

        {/* Segment Count Info */}
        <p className="text-sm text-muted-foreground text-center">
          {t("multiCity.segmentCount", {
            current: segments.length,
            min: minSegments,
            max: maxSegments,
          })}
        </p>
      </div>
    </Card>
  );
}

export default MultiCitySearch;
