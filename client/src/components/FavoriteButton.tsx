/**
 * FavoriteButton Component
 * A reusable heart icon toggle button for favoriting flights
 */

import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Heart, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface FavoriteButtonProps {
  flightId: number;
  size?: "sm" | "default" | "lg" | "icon";
  variant?: "ghost" | "outline" | "default";
  className?: string;
  showTooltip?: boolean;
}

export function FavoriteButton({
  flightId,
  size = "icon",
  variant = "ghost",
  className = "",
  showTooltip = true,
}: FavoriteButtonProps) {
  const { t } = useTranslation();

  const {
    data: isFavorited,
    isLoading: isCheckingFavorite,
    refetch,
  } = trpc.favorites.isFlightFavorited.useQuery(
    { flightId },
    {
      enabled: !!flightId,
    }
  );

  const addFavorite = trpc.favorites.addFlight.useMutation({
    onSuccess: () => {
      toast.success(t("favorites.addedToFavorites"));
      refetch();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const removeFavorite = trpc.favorites.removeFlight.useMutation({
    onSuccess: () => {
      toast.success(t("favorites.removed"));
      refetch();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const isLoading =
    isCheckingFavorite || addFavorite.isPending || removeFavorite.isPending;

  const handleToggle = () => {
    if (isFavorited) {
      removeFavorite.mutate({ flightId });
    } else {
      addFavorite.mutate({ flightId });
    }
  };

  const buttonContent = (
    <Button
      variant={variant}
      size={size}
      className={`rounded-full transition-all duration-200 ${
        isFavorited
          ? "text-rose-500 bg-rose-50 hover:bg-rose-100"
          : "hover:text-rose-500 hover:bg-rose-50"
      } ${className}`}
      onClick={handleToggle}
      disabled={isLoading}
      aria-label={
        isFavorited
          ? t("favorites.removeFromFavorites")
          : t("favorites.addToFavorites")
      }
      data-testid="favorite-button"
    >
      {isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      ) : (
        <Heart
          className={`h-5 w-5 transition-all duration-200 ${
            isFavorited ? "fill-current scale-110" : ""
          }`}
          aria-hidden="true"
        />
      )}
    </Button>
  );

  if (!showTooltip) {
    return buttonContent;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{buttonContent}</TooltipTrigger>
      <TooltipContent>
        {isFavorited
          ? t("favorites.removeFromFavorites")
          : t("favorites.addToFavorites")}
      </TooltipContent>
    </Tooltip>
  );
}

export default FavoriteButton;
