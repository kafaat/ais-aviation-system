/**
 * SearchHistory Component
 * Shows recent flight searches and allows quick re-search
 */

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  History,
  Plane,
  X,
  Search,
  Clock,
  ArrowRight,
  Trash2,
} from "lucide-react";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { ar } from "date-fns/locale";

interface SearchEntry {
  id: string;
  originCode: string;
  originCity: string;
  destinationCode: string;
  destinationCity: string;
  departureDate: string;
  cabinClass: "economy" | "business";
  passengers: number;
  timestamp: number;
}

const STORAGE_KEY = "flight_search_history";
const MAX_HISTORY = 10;

/**
 * Get search history from localStorage
 */
function getSearchHistory(): SearchEntry[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch {
    // Ignore parse errors
  }
  return [];
}

/**
 * Save search to history
 */
export function saveSearchToHistory(
  search: Omit<SearchEntry, "id" | "timestamp">
): void {
  try {
    const history = getSearchHistory();

    // Check for duplicate (same route and date)
    const isDuplicate = history.some(
      entry =>
        entry.originCode === search.originCode &&
        entry.destinationCode === search.destinationCode &&
        entry.departureDate === search.departureDate
    );

    if (isDuplicate) return;

    const newEntry: SearchEntry = {
      ...search,
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
    };

    // Add to beginning and limit size
    const updatedHistory = [newEntry, ...history].slice(0, MAX_HISTORY);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedHistory));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Clear search history
 */
export function clearSearchHistory(): void {
  localStorage.removeItem(STORAGE_KEY);
}

interface SearchHistoryProps {
  onSelect?: (search: SearchEntry) => void;
  compact?: boolean;
}

export function SearchHistory({
  onSelect,
  compact = false,
}: SearchHistoryProps) {
  const { t, i18n } = useTranslation();
  const [, setLocation] = useLocation();
  const [history, setHistory] = useState<SearchEntry[]>([]);

  useEffect(() => {
    setHistory(getSearchHistory());
  }, []);

  const handleRemove = (id: string) => {
    const updatedHistory = history.filter(entry => entry.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedHistory));
    setHistory(updatedHistory);
  };

  const handleClearAll = () => {
    clearSearchHistory();
    setHistory([]);
  };

  const handleSearch = (entry: SearchEntry) => {
    if (onSelect) {
      onSelect(entry);
    } else {
      // Navigate to search with params
      const params = new URLSearchParams({
        origin: entry.originCode,
        destination: entry.destinationCode,
        date: entry.departureDate,
        cabin: entry.cabinClass,
        passengers: entry.passengers.toString(),
      });
      setLocation(`/search?${params.toString()}`);
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return format(date, "EEE, d MMM", {
        locale: i18n.language === "ar" ? ar : undefined,
      });
    } catch {
      return dateStr;
    }
  };

  const formatTimestamp = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return t("searchHistory.justNow");
    if (minutes < 60) return t("searchHistory.minutesAgo", { count: minutes });
    if (hours < 24) return t("searchHistory.hoursAgo", { count: hours });
    return t("searchHistory.daysAgo", { count: days });
  };

  if (history.length === 0) {
    if (compact) return null;
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
            <History className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="font-semibold mb-1">{t("searchHistory.empty")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("searchHistory.emptyHint")}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (compact) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <div className="p-1.5 bg-primary/10 rounded-lg">
              <History className="h-4 w-4 text-primary" />
            </div>
            {t("searchHistory.recent")}
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearAll}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" />
            {t("common.clearAll")}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {history.slice(0, 5).map(entry => (
            <Button
              key={entry.id}
              variant="outline"
              size="sm"
              className="text-xs group hover:border-primary hover:bg-primary/5 transition-all"
              onClick={() => handleSearch(entry)}
            >
              <span className="font-semibold">{entry.originCode}</span>
              <ArrowRight className="h-3 w-3 mx-1 text-muted-foreground group-hover:text-primary" />
              <span className="font-semibold">{entry.destinationCode}</span>
            </Button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3 bg-gradient-to-r from-slate-50 to-gray-50 border-b">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-xl">
              <History className="h-5 w-5 text-primary" />
            </div>
            {t("searchHistory.title")}
            <Badge variant="secondary" className="text-xs">
              {history.length}
            </Badge>
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClearAll}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-4 w-4 mr-1.5" />
            {t("common.clearAll")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y">
          {history.map((entry, _index) => (
            <div
              key={entry.id}
              className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors group"
            >
              <div className="flex items-center gap-4 flex-1 min-w-0">
                {/* Route visualization */}
                <div className="flex items-center gap-3">
                  <div className="text-center min-w-[60px]">
                    <div className="text-lg font-bold text-primary">
                      {entry.originCode}
                    </div>
                    <div className="text-xs text-muted-foreground truncate max-w-[80px]">
                      {entry.originCity}
                    </div>
                  </div>

                  <div className="flex flex-col items-center">
                    <div className="w-20 h-px bg-gradient-to-r from-primary/50 via-primary to-primary/50 relative">
                      <Plane className="h-4 w-4 text-primary absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-background" />
                    </div>
                  </div>

                  <div className="text-center min-w-[60px]">
                    <div className="text-lg font-bold text-primary">
                      {entry.destinationCode}
                    </div>
                    <div className="text-xs text-muted-foreground truncate max-w-[80px]">
                      {entry.destinationCity}
                    </div>
                  </div>
                </div>

                {/* Trip details */}
                <div className="hidden md:flex items-center gap-2 flex-wrap">
                  <Badge
                    variant="outline"
                    className="text-xs font-normal bg-white"
                  >
                    📅 {formatDate(entry.departureDate)}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="text-xs font-normal bg-white"
                  >
                    {entry.cabinClass === "business" ? "💼" : "✈️"}{" "}
                    {t(`cabin.${entry.cabinClass}`)}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="text-xs font-normal bg-white"
                  >
                    👤 {entry.passengers}
                  </Badge>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground hidden sm:flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatTimestamp(entry.timestamp)}
                </span>

                <Button
                  variant="default"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => handleSearch(entry)}
                >
                  <Search className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">
                    {t("searchHistory.searchAgain")}
                  </span>
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                  onClick={() => handleRemove(entry.id)}
                  aria-label={t("common.delete")}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default SearchHistory;
