/**
 * SearchHistory Component
 * Shows recent flight searches and allows quick re-search
 */

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { History, Plane, X, Search, Clock } from "lucide-react";
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
      <Card>
        <CardContent className="py-6 text-center text-muted-foreground">
          <History className="h-8 w-8 mx-auto mb-2 opacity-20" />
          <p>{t("searchHistory.empty")}</p>
        </CardContent>
      </Card>
    );
  }

  if (compact) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <History className="h-4 w-4" />
            {t("searchHistory.recent")}
          </h3>
          <Button variant="ghost" size="sm" onClick={handleClearAll}>
            {t("common.clearAll")}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {history.slice(0, 5).map(entry => (
            <Button
              key={entry.id}
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={() => handleSearch(entry)}
            >
              {entry.originCode} → {entry.destinationCode}
            </Button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <History className="h-5 w-5" />
            {t("searchHistory.title")}
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={handleClearAll}>
            {t("common.clearAll")}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {history.map(entry => (
            <div
              key={entry.id}
              className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors group"
            >
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <div className="text-center">
                    <div className="font-bold">{entry.originCode}</div>
                    <div className="text-xs text-muted-foreground">
                      {entry.originCity}
                    </div>
                  </div>
                  <Plane className="h-4 w-4 text-muted-foreground" />
                  <div className="text-center">
                    <div className="font-bold">{entry.destinationCode}</div>
                    <div className="text-xs text-muted-foreground">
                      {entry.destinationCity}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Badge variant="secondary" className="text-xs">
                    {formatDate(entry.departureDate)}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {t(`cabin.${entry.cabinClass}`)}
                  </Badge>
                  <span className="text-xs">
                    {entry.passengers} {t("searchHistory.passengers")}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatTimestamp(entry.timestamp)}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => handleSearch(entry)}
                >
                  <Search className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => handleRemove(entry.id)}
                >
                  <X className="h-4 w-4 text-destructive" />
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
