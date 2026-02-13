/**
 * RatingStars Component
 *
 * Displays star ratings with support for:
 * - Read-only display mode
 * - Interactive selection mode
 * - Half-star display for average ratings
 * - Customizable size and colors
 */

import { useState } from "react";
import { Star, StarHalf } from "lucide-react";
import { cn } from "@/lib/utils";

interface RatingStarsProps {
  /** Current rating value (1-5) */
  rating: number;
  /** Maximum rating (default: 5) */
  maxRating?: number;
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Whether the rating can be changed by user */
  interactive?: boolean;
  /** Callback when rating changes (only for interactive mode) */
  onRatingChange?: (rating: number) => void;
  /** Show half stars for decimal ratings */
  showHalfStars?: boolean;
  /** Show numeric rating value */
  showValue?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Label for accessibility */
  "aria-label"?: string;
}

const sizeClasses = {
  sm: "h-4 w-4",
  md: "h-5 w-5",
  lg: "h-6 w-6",
};

const gapClasses = {
  sm: "gap-0.5",
  md: "gap-1",
  lg: "gap-1.5",
};

const textClasses = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
};

export function RatingStars({
  rating,
  maxRating = 5,
  size = "md",
  interactive = false,
  onRatingChange,
  showHalfStars = true,
  showValue = false,
  className,
  "aria-label": ariaLabel,
}: RatingStarsProps) {
  const [hoverRating, setHoverRating] = useState<number | null>(null);

  const displayRating = hoverRating ?? rating;

  const handleClick = (index: number) => {
    if (interactive && onRatingChange) {
      onRatingChange(index + 1);
    }
  };

  const handleMouseEnter = (index: number) => {
    if (interactive) {
      setHoverRating(index + 1);
    }
  };

  const handleMouseLeave = () => {
    if (interactive) {
      setHoverRating(null);
    }
  };

  const renderStar = (index: number) => {
    const starValue = index + 1;
    const isFilled = displayRating >= starValue;
    const isHalfFilled =
      showHalfStars &&
      !isFilled &&
      displayRating > index &&
      displayRating < starValue;

    const starClass = cn(
      sizeClasses[size],
      "transition-colors",
      interactive && "cursor-pointer hover:scale-110 transition-transform",
      isFilled || isHalfFilled
        ? "text-amber-400 fill-amber-400"
        : "text-slate-300 dark:text-slate-600"
    );

    if (isHalfFilled) {
      return (
        <span
          key={index}
          className="relative"
          onClick={() => handleClick(index)}
          onMouseEnter={() => handleMouseEnter(index)}
          role={interactive ? "button" : undefined}
          tabIndex={interactive ? 0 : undefined}
          onKeyDown={
            interactive
              ? e => {
                  if (e.key === "Enter" || e.key === " ") {
                    handleClick(index);
                  }
                }
              : undefined
          }
        >
          <Star
            className={cn(
              sizeClasses[size],
              "text-slate-300 dark:text-slate-600"
            )}
          />
          <StarHalf
            className={cn(
              sizeClasses[size],
              "absolute top-0 left-0 text-amber-400 fill-amber-400"
            )}
          />
        </span>
      );
    }

    return (
      <Star
        key={index}
        className={starClass}
        onClick={() => handleClick(index)}
        onMouseEnter={() => handleMouseEnter(index)}
        role={interactive ? "button" : undefined}
        tabIndex={interactive ? 0 : undefined}
        onKeyDown={
          interactive
            ? e => {
                if (e.key === "Enter" || e.key === " ") {
                  handleClick(index);
                }
              }
            : undefined
        }
      />
    );
  };

  return (
    <div
      className={cn("flex items-center", gapClasses[size], className)}
      onMouseLeave={handleMouseLeave}
      role={interactive ? "group" : "img"}
      aria-label={ariaLabel || `Rating: ${rating} out of ${maxRating} stars`}
    >
      {Array.from({ length: maxRating }, (_, i) => renderStar(i))}
      {showValue && (
        <span
          className={cn(
            "ml-1 font-medium text-slate-700 dark:text-slate-300",
            textClasses[size]
          )}
        >
          {rating.toFixed(1)}
        </span>
      )}
    </div>
  );
}

/**
 * RatingDisplay Component
 *
 * A simpler component for displaying a rating with additional context
 */
interface RatingDisplayProps {
  rating: number;
  totalReviews?: number;
  size?: "sm" | "md" | "lg";
  showCount?: boolean;
  className?: string;
}

export function RatingDisplay({
  rating,
  totalReviews,
  size = "md",
  showCount = true,
  className,
}: RatingDisplayProps) {
  return (
    <div className={cn("flex items-center", gapClasses[size], className)}>
      <RatingStars rating={rating} size={size} showValue />
      {showCount && totalReviews !== undefined && (
        <span className={cn("text-muted-foreground", textClasses[size])}>
          ({totalReviews})
        </span>
      )}
    </div>
  );
}

export default RatingStars;
