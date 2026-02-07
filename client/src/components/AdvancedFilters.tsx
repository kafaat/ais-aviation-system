import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Filter, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

interface FilterOptions {
  priceRange: [number, number];
  airlines: string[];
  stops: string[];
  departureTime: string[];
  cabinClass: string[];
}

interface AdvancedFiltersProps {
  onApply: (filters: FilterOptions) => void;
  onReset: () => void;
}

export function AdvancedFilters({ onApply, onReset }: AdvancedFiltersProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  const [priceRange, setPriceRange] = useState<[number, number]>([0, 10000]);
  const [selectedAirlines, setSelectedAirlines] = useState<string[]>([]);
  const [selectedStops, setSelectedStops] = useState<string[]>([]);
  const [selectedTimes, setSelectedTimes] = useState<string[]>([]);
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);

  const airlines = [
    { id: "SV", name: "Saudi Arabian Airlines" },
    { id: "MS", name: "EgyptAir" },
    { id: "EK", name: "Emirates" },
    { id: "QR", name: "Qatar Airways" },
  ];

  const stops = [
    { id: "direct", label: t("filters.direct") },
    { id: "1-stop", label: t("filters.oneStop") },
    { id: "2-stops", label: t("filters.twoStops") },
  ];

  const departureTimes = [
    { id: "morning", label: t("filters.morning"), time: "06:00 - 12:00" },
    { id: "afternoon", label: t("filters.afternoon"), time: "12:00 - 18:00" },
    { id: "evening", label: t("filters.evening"), time: "18:00 - 00:00" },
    { id: "night", label: t("filters.night"), time: "00:00 - 06:00" },
  ];

  const cabinClasses = [
    { id: "economy", label: t("flights.economy") },
    { id: "business", label: t("flights.business") },
  ];

  const handleApply = () => {
    onApply({
      priceRange,
      airlines: selectedAirlines,
      stops: selectedStops,
      departureTime: selectedTimes,
      cabinClass: selectedClasses,
    });
    setIsOpen(false);
  };

  const handleReset = () => {
    setPriceRange([0, 10000]);
    setSelectedAirlines([]);
    setSelectedStops([]);
    setSelectedTimes([]);
    setSelectedClasses([]);
    onReset();
  };

  const activeFiltersCount =
    selectedAirlines.length +
    selectedStops.length +
    selectedTimes.length +
    selectedClasses.length +
    (priceRange[0] > 0 || priceRange[1] < 10000 ? 1 : 0);

  if (!isOpen) {
    return (
      <Button
        variant="outline"
        onClick={() => setIsOpen(true)}
        className="relative"
      >
        <Filter className="h-4 w-4 me-2" />
        {t("filters.advancedFilters")}
        {activeFiltersCount > 0 && (
          <Badge className="ms-2 h-5 w-5 rounded-full p-0 flex items-center justify-center">
            {activeFiltersCount}
          </Badge>
        )}
      </Button>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            {t("filters.advancedFilters")}
          </CardTitle>
          <Button variant="ghost" size="icon" onClick={() => setIsOpen(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Price Range */}
        <div className="space-y-3">
          <Label>{t("filters.priceRange")}</Label>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">
              {priceRange[0]} {t("common.currency")}
            </span>
            <Slider
              value={priceRange}
              onValueChange={value => setPriceRange(value as [number, number])}
              max={10000}
              step={100}
              className="flex-1"
            />
            <span className="text-sm text-muted-foreground">
              {priceRange[1]} {t("common.currency")}
            </span>
          </div>
        </div>

        {/* Airlines */}
        <div className="space-y-3">
          <Label>{t("filters.airlines")}</Label>
          <div className="space-y-2">
            {airlines.map(airline => (
              <div key={airline.id} className="flex items-center space-x-2">
                <Checkbox
                  id={airline.id}
                  checked={selectedAirlines.includes(airline.id)}
                  onCheckedChange={checked => {
                    if (checked) {
                      setSelectedAirlines([...selectedAirlines, airline.id]);
                    } else {
                      setSelectedAirlines(
                        selectedAirlines.filter(id => id !== airline.id)
                      );
                    }
                  }}
                />
                <label
                  htmlFor={airline.id}
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                >
                  {airline.name}
                </label>
              </div>
            ))}
          </div>
        </div>

        {/* Stops */}
        <div className="space-y-3">
          <Label>{t("filters.stops")}</Label>
          <div className="space-y-2">
            {stops.map(stop => (
              <div key={stop.id} className="flex items-center space-x-2">
                <Checkbox
                  id={stop.id}
                  checked={selectedStops.includes(stop.id)}
                  onCheckedChange={checked => {
                    if (checked) {
                      setSelectedStops([...selectedStops, stop.id]);
                    } else {
                      setSelectedStops(
                        selectedStops.filter(id => id !== stop.id)
                      );
                    }
                  }}
                />
                <label
                  htmlFor={stop.id}
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                >
                  {stop.label}
                </label>
              </div>
            ))}
          </div>
        </div>

        {/* Departure Time */}
        <div className="space-y-3">
          <Label>{t("filters.departureTime")}</Label>
          <div className="space-y-2">
            {departureTimes.map(time => (
              <div key={time.id} className="flex items-center space-x-2">
                <Checkbox
                  id={time.id}
                  checked={selectedTimes.includes(time.id)}
                  onCheckedChange={checked => {
                    if (checked) {
                      setSelectedTimes([...selectedTimes, time.id]);
                    } else {
                      setSelectedTimes(
                        selectedTimes.filter(id => id !== time.id)
                      );
                    }
                  }}
                />
                <label
                  htmlFor={time.id}
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer flex-1"
                >
                  {time.label}
                  <span className="text-xs text-muted-foreground ms-2">
                    ({time.time})
                  </span>
                </label>
              </div>
            ))}
          </div>
        </div>

        {/* Cabin Class */}
        <div className="space-y-3">
          <Label>{t("filters.cabinClass")}</Label>
          <div className="space-y-2">
            {cabinClasses.map(cabin => (
              <div key={cabin.id} className="flex items-center space-x-2">
                <Checkbox
                  id={cabin.id}
                  checked={selectedClasses.includes(cabin.id)}
                  onCheckedChange={checked => {
                    if (checked) {
                      setSelectedClasses([...selectedClasses, cabin.id]);
                    } else {
                      setSelectedClasses(
                        selectedClasses.filter(id => id !== cabin.id)
                      );
                    }
                  }}
                />
                <label
                  htmlFor={cabin.id}
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                >
                  {cabin.label}
                </label>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-4">
          <Button onClick={handleApply} className="flex-1">
            {t("filters.apply")}
          </Button>
          <Button onClick={handleReset} variant="outline">
            {t("filters.reset")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
