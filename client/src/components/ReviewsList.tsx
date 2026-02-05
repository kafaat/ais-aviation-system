/**
 * ReviewsList Component
 *
 * Displays a list of reviews with:
 * - Rating statistics summary
 * - Individual review cards
 * - Helpful voting
 * - Pagination
 * - Filtering options
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RatingStars, RatingDisplay } from "@/components/RatingStars";
import {
  ThumbsUp,
  CheckCircle,
  MessageSquare,
  Star,
  ChevronDown,
  User,
} from "lucide-react";
import { format, type Locale } from "date-fns";
import { ar, enUS } from "date-fns/locale";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ReviewsListProps {
  /** Flight ID to show reviews for */
  flightId: number;
  /** Show rating summary statistics */
  showStats?: boolean;
  /** Initial number of reviews to show */
  initialLimit?: number;
  /** Additional CSS classes */
  className?: string;
}

export function ReviewsList({
  flightId,
  showStats = true,
  initialLimit = 5,
  className,
}: ReviewsListProps) {
  const { t, i18n } = useTranslation();
  const { isAuthenticated } = useAuth();
  const dateLocale = i18n.language === "ar" ? ar : enUS;

  const [limit, setLimit] = useState(initialLimit);
  const [minRating, setMinRating] = useState<number | undefined>(undefined);

  // Fetch reviews
  const { data: reviews, isLoading: isLoadingReviews } =
    trpc.reviews.getFlightReviews.useQuery({
      flightId,
      limit,
      minRating,
    });

  // Fetch statistics
  const { data: stats, isLoading: isLoadingStats } =
    trpc.reviews.getFlightStats.useQuery({ flightId }, { enabled: showStats });

  // Mark helpful mutation
  const markHelpful = trpc.reviews.markHelpful.useMutation({
    onSuccess: () => {
      toast.success(t("reviews.markedHelpful"));
    },
    onError: () => {
      toast.error(t("reviews.errorMarkingHelpful"));
    },
  });

  const handleMarkHelpful = (reviewId: number) => {
    if (!isAuthenticated) {
      toast.error(t("common.loginRequired"));
      return;
    }
    markHelpful.mutate({ reviewId });
  };

  const handleLoadMore = () => {
    setLimit(prev => prev + 10);
  };

  const handleFilterChange = (value: string) => {
    setMinRating(value === "all" ? undefined : parseInt(value));
  };

  if (isLoadingReviews && isLoadingStats) {
    return <ReviewsListSkeleton />;
  }

  const hasMoreReviews =
    reviews && stats && reviews.length < stats.totalReviews;

  return (
    <div className={cn("space-y-6", className)}>
      {/* Statistics Summary */}
      {showStats && stats && stats.totalReviews > 0 && (
        <Card className="border-0 shadow-md bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2">
              <Star className="h-5 w-5 text-amber-400 fill-amber-400" />
              {t("reviews.ratingSummary")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Overall Rating */}
              <div className="flex items-center gap-6">
                <div className="text-center">
                  <p className="text-5xl font-bold text-amber-600">
                    {stats.averageRating.toFixed(1)}
                  </p>
                  <RatingStars rating={stats.averageRating} size="md" />
                  <p className="text-sm text-muted-foreground mt-2">
                    {t("reviews.basedOn", { count: stats.totalReviews })}
                  </p>
                </div>

                {/* Rating Distribution */}
                <div className="flex-1 space-y-2">
                  {[5, 4, 3, 2, 1].map(star => {
                    const count = stats.ratingDistribution[star] || 0;
                    const percentage =
                      stats.totalReviews > 0
                        ? (count / stats.totalReviews) * 100
                        : 0;
                    return (
                      <div key={star} className="flex items-center gap-2">
                        <span className="text-sm w-4">{star}</span>
                        <Star className="h-3 w-3 text-amber-400 fill-amber-400" />
                        <Progress value={percentage} className="h-2 flex-1" />
                        <span className="text-xs text-muted-foreground w-8">
                          {count}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Category Averages */}
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center p-3 bg-white dark:bg-slate-800 rounded-xl shadow-sm">
                  <p className="text-sm text-muted-foreground mb-1">
                    {t("reviews.comfort")}
                  </p>
                  <p className="text-2xl font-bold text-slate-700 dark:text-slate-200">
                    {stats.averageComfort.toFixed(1)}
                  </p>
                  <RatingStars rating={stats.averageComfort} size="sm" />
                </div>
                <div className="text-center p-3 bg-white dark:bg-slate-800 rounded-xl shadow-sm">
                  <p className="text-sm text-muted-foreground mb-1">
                    {t("reviews.service")}
                  </p>
                  <p className="text-2xl font-bold text-slate-700 dark:text-slate-200">
                    {stats.averageService.toFixed(1)}
                  </p>
                  <RatingStars rating={stats.averageService} size="sm" />
                </div>
                <div className="text-center p-3 bg-white dark:bg-slate-800 rounded-xl shadow-sm">
                  <p className="text-sm text-muted-foreground mb-1">
                    {t("reviews.value")}
                  </p>
                  <p className="text-2xl font-bold text-slate-700 dark:text-slate-200">
                    {stats.averageValue.toFixed(1)}
                  </p>
                  <RatingStars rating={stats.averageValue} size="sm" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters and Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          {t("reviews.customerReviews")}
          {stats && (
            <span className="text-muted-foreground font-normal">
              ({stats.totalReviews})
            </span>
          )}
        </h3>

        <Select
          value={minRating?.toString() || "all"}
          onValueChange={handleFilterChange}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder={t("reviews.filterByRating")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("reviews.allRatings")}</SelectItem>
            <SelectItem value="5">5 {t("reviews.starsOnly")}</SelectItem>
            <SelectItem value="4">4+ {t("reviews.starsUp")}</SelectItem>
            <SelectItem value="3">3+ {t("reviews.starsUp")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Reviews List */}
      {!reviews || reviews.length === 0 ? (
        <Card className="p-8 text-center border-dashed">
          <MessageSquare className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">{t("reviews.noReviews")}</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {reviews.map(review => (
            <ReviewCard
              key={review.id}
              review={review}
              dateLocale={dateLocale}
              onMarkHelpful={handleMarkHelpful}
              isMarkingHelpful={markHelpful.isPending}
            />
          ))}

          {/* Load More Button */}
          {hasMoreReviews && (
            <div className="text-center pt-4">
              <Button
                variant="outline"
                onClick={handleLoadMore}
                className="min-w-[200px]"
              >
                <ChevronDown className="h-4 w-4 mr-2" />
                {t("reviews.loadMore")}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ReviewCardProps {
  review: {
    id: number;
    rating: number;
    comfortRating: number | null;
    serviceRating: number | null;
    valueRating: number | null;
    title: string | null;
    comment: string | null;
    isVerified: boolean;
    helpfulCount: number;
    createdAt: Date;
  };
  dateLocale: Locale;
  onMarkHelpful: (reviewId: number) => void;
  isMarkingHelpful: boolean;
}

function ReviewCard({
  review,
  dateLocale,
  onMarkHelpful,
  isMarkingHelpful,
}: ReviewCardProps) {
  const { t } = useTranslation();

  return (
    <Card className="border-0 shadow-sm hover:shadow-md transition-shadow">
      <CardContent className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white">
              <User className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <RatingDisplay
                  rating={review.rating}
                  size="sm"
                  showCount={false}
                />
                {review.isVerified && (
                  <Badge
                    variant="secondary"
                    className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-xs"
                  >
                    <CheckCircle className="h-3 w-3 mr-1" />
                    {t("reviews.verified")}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {format(new Date(review.createdAt), "PPP", {
                  locale: dateLocale,
                })}
              </p>
            </div>
          </div>
        </div>

        {review.title && (
          <h4 className="font-semibold text-slate-900 dark:text-white mb-2">
            {review.title}
          </h4>
        )}

        {review.comment && (
          <p className="text-slate-600 dark:text-slate-300 mb-4 whitespace-pre-wrap">
            {review.comment}
          </p>
        )}

        {/* Category Ratings */}
        {(review.comfortRating ||
          review.serviceRating ||
          review.valueRating) && (
          <div className="flex flex-wrap gap-4 mb-4 pt-4 border-t border-slate-100 dark:border-slate-800">
            {review.comfortRating && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">
                  {t("reviews.comfort")}:
                </span>
                <RatingStars rating={review.comfortRating} size="sm" />
              </div>
            )}
            {review.serviceRating && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">
                  {t("reviews.service")}:
                </span>
                <RatingStars rating={review.serviceRating} size="sm" />
              </div>
            )}
            {review.valueRating && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">
                  {t("reviews.value")}:
                </span>
                <RatingStars rating={review.valueRating} size="sm" />
              </div>
            )}
          </div>
        )}

        {/* Helpful Button */}
        <div className="flex items-center justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onMarkHelpful(review.id)}
            disabled={isMarkingHelpful}
            className="text-muted-foreground hover:text-blue-600"
          >
            <ThumbsUp className="h-4 w-4 mr-1" />
            {t("reviews.helpful")}
            {review.helpfulCount > 0 && (
              <span className="ml-1">({review.helpfulCount})</span>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ReviewsListSkeleton() {
  return (
    <div className="space-y-6">
      {/* Stats Skeleton */}
      <Card className="border-0 shadow-md">
        <CardHeader className="pb-4">
          <Skeleton className="h-6 w-40" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="flex items-center gap-6">
              <Skeleton className="h-20 w-20 rounded-full" />
              <div className="flex-1 space-y-2">
                {[1, 2, 3, 4, 5].map(i => (
                  <Skeleton key={i} className="h-3 w-full" />
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Reviews Skeleton */}
      <div className="space-y-4">
        {[1, 2, 3].map(i => (
          <Card key={i} className="border-0 shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-start gap-3 mb-4">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
              <Skeleton className="h-4 w-3/4 mb-2" />
              <Skeleton className="h-16 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default ReviewsList;
