/**
 * FlightReviewsSection Component
 *
 * A self-contained section for displaying and submitting flight reviews.
 * Can be embedded in flight details pages, booking confirmation pages, etc.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ReviewForm } from "@/components/ReviewForm";
import { ReviewsList } from "@/components/ReviewsList";
import { RatingDisplay } from "@/components/RatingStars";
import { Star, PenSquare, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface FlightReviewsSectionProps {
  /** Flight ID */
  flightId: number;
  /** Optional booking ID for verified reviews */
  bookingId?: number;
  /** Flight details for display in the review form */
  flightInfo?: {
    flightNumber: string;
    origin: string;
    destination: string;
  };
  /** Show compact view (only summary + button) */
  compact?: boolean;
  /** Additional CSS classes */
  className?: string;
}

export function FlightReviewsSection({
  flightId,
  bookingId,
  flightInfo,
  compact = false,
  className,
}: FlightReviewsSectionProps) {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const [showReviewForm, setShowReviewForm] = useState(false);

  // Check if user can review this flight
  const { data: canReviewData } = trpc.reviews.canReview.useQuery(
    { flightId },
    { enabled: isAuthenticated }
  );

  // Get flight stats for summary
  const { data: stats } = trpc.reviews.getFlightStats.useQuery({ flightId });

  const canReview = canReviewData?.canReview ?? false;
  const reviewBookingId = bookingId || canReviewData?.bookingId;

  const handleReviewSuccess = () => {
    setShowReviewForm(false);
  };

  // Compact view - just shows rating summary and review button
  if (compact) {
    return (
      <Card className={cn("border-0 shadow-sm", className)}>
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <Star className="h-5 w-5 text-amber-500 fill-amber-500" />
              </div>
              <div>
                {stats && stats.totalReviews > 0 ? (
                  <>
                    <RatingDisplay
                      rating={stats.averageRating}
                      totalReviews={stats.totalReviews}
                      size="sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("reviews.basedOn", { count: stats.totalReviews })}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("reviews.noReviews")}
                  </p>
                )}
              </div>
            </div>

            {isAuthenticated && canReview && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowReviewForm(true)}
                className="shrink-0"
              >
                <PenSquare className="h-4 w-4 mr-2" />
                {t("reviews.leaveReview")}
              </Button>
            )}
          </div>

          {/* Review Form Dialog */}
          <Dialog open={showReviewForm} onOpenChange={setShowReviewForm}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{t("reviews.writeReview")}</DialogTitle>
              </DialogHeader>
              <ReviewForm
                flightId={flightId}
                bookingId={reviewBookingId}
                flightInfo={flightInfo}
                onSuccess={handleReviewSuccess}
                onCancel={() => setShowReviewForm(false)}
              />
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>
    );
  }

  // Full view - shows stats, reviews list, and form
  return (
    <div className={cn("space-y-6", className)}>
      {/* Header with Write Review Button */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Star className="h-5 w-5 text-amber-500 fill-amber-500" />
          {t("reviews.title")}
        </h2>

        {isAuthenticated && canReview && (
          <Button
            onClick={() => setShowReviewForm(true)}
            className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
          >
            <PenSquare className="h-4 w-4 mr-2" />
            {t("reviews.writeReview")}
          </Button>
        )}

        {isAuthenticated && !canReview && canReviewData?.reason && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4" />
            {canReviewData.reason === "already_reviewed"
              ? t("reviews.alreadyReviewed")
              : t("reviews.noCompletedBooking")}
          </div>
        )}
      </div>

      {/* Reviews List */}
      <ReviewsList flightId={flightId} showStats />

      {/* Review Form Dialog */}
      <Dialog open={showReviewForm} onOpenChange={setShowReviewForm}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("reviews.writeReview")}</DialogTitle>
          </DialogHeader>
          <ReviewForm
            flightId={flightId}
            bookingId={reviewBookingId}
            flightInfo={flightInfo}
            onSuccess={handleReviewSuccess}
            onCancel={() => setShowReviewForm(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default FlightReviewsSection;
