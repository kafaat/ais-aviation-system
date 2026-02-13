/**
 * SmartSuggestions Component
 *
 * Displays personalized flight suggestions based on user history,
 * popular routes, and current deals.
 */

import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Plane,
  TrendingUp,
  History,
  Tag,
  ArrowRight,
  Clock,
} from "lucide-react";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";

export function SmartSuggestions() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const isRTL = i18n.language === "ar";
  const dateLocale = isRTL ? ar : enUS;

  // Fetch personalized suggestions for logged-in users, popular for guests
  const { data: suggestions, isLoading } = user
    ? trpc.suggestions.forUser.useQuery({ limit: 6 })
    : trpc.suggestions.popular.useQuery({ limit: 6 });

  const { data: deals } = trpc.suggestions.deals.useQuery({ limit: 3 });

  const formatPrice = (price: number) => {
    return (price / 100).toLocaleString(isRTL ? "ar-SA" : "en-US");
  };

  const formatTime = (date: Date) => {
    return format(new Date(date), "HH:mm", { locale: dateLocale });
  };

  const formatDate = (date: Date) => {
    return format(new Date(date), "d MMM", { locale: dateLocale });
  };

  const getReasonIcon = (reason: string) => {
    switch (reason) {
      case "history":
        return <History className="h-3 w-3" />;
      case "popular":
        return <TrendingUp className="h-3 w-3" />;
      case "deal":
        return <Tag className="h-3 w-3" />;
      default:
        return <Plane className="h-3 w-3" />;
    }
  };

  const getReasonLabel = (reason: string) => {
    switch (reason) {
      case "history":
        return t("suggestions.basedOnHistory");
      case "popular":
        return t("suggestions.trending");
      case "deal":
        return t("suggestions.bestDeal");
      default:
        return t("suggestions.recommended");
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">{t("suggestions.title")}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <Card key={i} className="p-4">
              <Skeleton className="h-4 w-24 mb-3" />
              <Skeleton className="h-6 w-full mb-2" />
              <Skeleton className="h-4 w-32 mb-2" />
              <Skeleton className="h-8 w-full mt-3" />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const allSuggestions = [
    ...(suggestions || []),
    ...(deals || []).map(d => ({ ...d, reason: "deal" as const })),
  ];

  if (allSuggestions.length === 0) return null;

  // Deduplicate by flightId
  const seen = new Set<number>();
  const uniqueSuggestions = allSuggestions.filter(s => {
    if (seen.has(s.flightId)) return false;
    seen.add(s.flightId);
    return true;
  });

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          {user ? t("suggestions.forYou") : t("suggestions.title")}
        </h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {uniqueSuggestions.slice(0, 6).map(suggestion => (
          <Card
            key={suggestion.flightId}
            className="p-4 hover:shadow-lg transition-all duration-300 border-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm group"
          >
            {/* Reason Badge */}
            <div className="flex items-center justify-between mb-3">
              <Badge
                variant="secondary"
                className="text-xs flex items-center gap-1"
              >
                {getReasonIcon(suggestion.reason)}
                {getReasonLabel(suggestion.reason)}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {suggestion.airlineCode}
              </span>
            </div>

            {/* Route */}
            <div className="flex items-center gap-2 mb-2">
              <span className="font-bold text-lg">{suggestion.originCode}</span>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <span className="font-bold text-lg">
                {suggestion.destinationCode}
              </span>
            </div>

            <p className="text-sm text-muted-foreground mb-1">
              {suggestion.originCity} → {suggestion.destinationCity}
            </p>

            {/* Date & Time */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
              <Clock className="h-3 w-3" />
              <span>
                {formatDate(suggestion.departureTime)}{" "}
                {formatTime(suggestion.departureTime)}
              </span>
            </div>

            {/* Price & CTA */}
            <div className="flex items-center justify-between mt-auto pt-3 border-t">
              <div>
                <p className="text-xs text-muted-foreground">
                  {t("suggestions.from")}
                </p>
                <p className="text-lg font-bold text-primary">
                  {formatPrice(suggestion.economyPrice)}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    {t("common.currency")}
                  </span>
                </p>
              </div>
              <Button
                asChild
                size="sm"
                className="group-hover:bg-primary group-hover:text-white"
                variant="outline"
              >
                <Link href={`/booking/${suggestion.flightId}?class=economy`}>
                  {t("search.bookNow")}
                </Link>
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

export default SmartSuggestions;
