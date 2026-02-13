/**
 * ReviewForm Component
 *
 * Form for submitting flight reviews with:
 * - Overall rating (required)
 * - Category ratings (comfort, service, value)
 * - Title and comment
 * - Validation and error handling
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { RatingStars } from "@/components/RatingStars";
import { Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ReviewFormProps {
  /** Flight ID to review */
  flightId: number;
  /** Optional booking ID for verified reviews */
  bookingId?: number;
  /** Flight details for display */
  flightInfo?: {
    flightNumber: string;
    origin: string;
    destination: string;
  };
  /** Callback when review is submitted successfully */
  onSuccess?: () => void;
  /** Callback to close the form */
  onCancel?: () => void;
  /** Additional CSS classes */
  className?: string;
}

export function ReviewForm({
  flightId,
  bookingId,
  flightInfo,
  onSuccess,
  onCancel,
  className,
}: ReviewFormProps) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();

  // Form state
  const [rating, setRating] = useState(0);
  const [comfortRating, setComfortRating] = useState(0);
  const [serviceRating, setServiceRating] = useState(0);
  const [valueRating, setValueRating] = useState(0);
  const [title, setTitle] = useState("");
  const [comment, setComment] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Create review mutation
  const createReview = trpc.reviews.create.useMutation({
    onSuccess: () => {
      toast.success(t("reviews.submitSuccess"));
      // Invalidate related queries
      utils.reviews.getFlightReviews.invalidate({ flightId });
      utils.reviews.getFlightStats.invalidate({ flightId });
      utils.reviews.getUserReviews.invalidate();
      utils.reviews.canReview.invalidate({ flightId });
      onSuccess?.();
    },
    onError: (error: { message: string }) => {
      toast.error(error.message || t("reviews.submitError"));
    },
  });

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (rating === 0) {
      newErrors.rating = t("reviews.ratingRequired");
    }

    if (title && title.length > 200) {
      newErrors.title = t("reviews.titleTooLong");
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    createReview.mutate({
      flightId,
      bookingId,
      rating,
      comfortRating: comfortRating || undefined,
      serviceRating: serviceRating || undefined,
      valueRating: valueRating || undefined,
      title: title.trim() || undefined,
      comment: comment.trim() || undefined,
    });
  };

  const isSubmitting = createReview.isPending;

  return (
    <Card className={cn("border-0 shadow-lg", className)}>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-3">
          <span>{t("reviews.writeReview")}</span>
          {bookingId && (
            <Badge
              variant="secondary"
              className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
            >
              <CheckCircle className="h-3 w-3 mr-1" />
              {t("reviews.verified")}
            </Badge>
          )}
        </CardTitle>
        {flightInfo && (
          <p className="text-sm text-muted-foreground">
            {flightInfo.flightNumber} - {flightInfo.origin} {t("common.to")}{" "}
            {flightInfo.destination}
          </p>
        )}
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Overall Rating */}
          <div className="space-y-2">
            <Label className="text-base font-semibold">
              {t("reviews.overallRating")} *
            </Label>
            <div className="flex items-center gap-4">
              <RatingStars
                rating={rating}
                size="lg"
                interactive
                onRatingChange={setRating}
                showHalfStars={false}
              />
              {rating > 0 && (
                <span className="text-lg font-medium text-amber-600">
                  {rating}/5
                </span>
              )}
            </div>
            {errors.rating && (
              <p className="text-sm text-red-500 flex items-center gap-1">
                <AlertCircle className="h-4 w-4" />
                {errors.rating}
              </p>
            )}
          </div>

          {/* Category Ratings */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="text-sm">{t("reviews.comfort")}</Label>
              <RatingStars
                rating={comfortRating}
                size="sm"
                interactive
                onRatingChange={setComfortRating}
                showHalfStars={false}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm">{t("reviews.service")}</Label>
              <RatingStars
                rating={serviceRating}
                size="sm"
                interactive
                onRatingChange={setServiceRating}
                showHalfStars={false}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm">{t("reviews.value")}</Label>
              <RatingStars
                rating={valueRating}
                size="sm"
                interactive
                onRatingChange={setValueRating}
                showHalfStars={false}
              />
            </div>
          </div>

          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="review-title">{t("reviews.reviewTitle")}</Label>
            <Input
              id="review-title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={t("reviews.titlePlaceholder")}
              maxLength={200}
              disabled={isSubmitting}
            />
            {errors.title && (
              <p className="text-sm text-red-500">{errors.title}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {title.length}/200 {t("reviews.characters")}
            </p>
          </div>

          {/* Comment */}
          <div className="space-y-2">
            <Label htmlFor="review-comment">{t("reviews.yourReview")}</Label>
            <Textarea
              id="review-comment"
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder={t("reviews.commentPlaceholder")}
              rows={4}
              disabled={isSubmitting}
              className="resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            {onCancel && (
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                disabled={isSubmitting}
              >
                {t("common.cancel")}
              </Button>
            )}
            <Button
              type="submit"
              disabled={isSubmitting || rating === 0}
              className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {t("reviews.submitting")}
                </>
              ) : (
                t("reviews.submitReview")
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export default ReviewForm;
