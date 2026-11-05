/**
 * FavoriteButton Component
 * A reusable heart icon toggle button for favoriting flights
 */

import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
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
  showLabel?: boolean;
}

export function FavoriteButton({
  flightId,
  size = "icon",
  variant = "ghost",
  className = "",
  showTooltip = true,
  showLabel = false,
}: FavoriteButtonProps) {
  const { t } = useTranslation();
  const { isAuthenticated, loading: isLoadingAuth } = useAuth();
  const utils = trpc.useUtils();

  const {
    data: isFavorited,
    isLoading: isCheckingFavorite,
    isError,
    refetch,
  } = trpc.favorites.isFlightFavorited.useQuery(
    { flightId },
    {
      enabled: isAuthenticated && !!flightId,
    }
  );

  const addFavorite = trpc.favorites.addFlight.useMutation({
    onSuccess: async () => {
      toast.success(t("favorites.addedToFavorites"));
      await Promise.all([
        utils.favorites.isFlightFavorited.invalidate({ flightId }),
        utils.favorites.getFlights.invalidate(),
      ]);
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const removeFavorite = trpc.favorites.removeFlight.useMutation({
    onSuccess: async () => {
      toast.success(t("favorites.removed"));
      await Promise.all([
        utils.favorites.isFlightFavorited.invalidate({ flightId }),
        utils.favorites.getFlights.invalidate(),
      ]);
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const isLoading =
    isLoadingAuth ||
    (isAuthenticated && isCheckingFavorite) ||
    addFavorite.isPending ||
    removeFavorite.isPending;

  const saved = isAuthenticated && Boolean(isFavorited);
  const label = saved
    ? t("favorites.removeSavedFlight", "Remove saved flight")
    : t("favorites.saveFlight", "Save this flight");

  const handleToggle = () => {
    if (!isAuthenticated) {
      toast.error(t("common.loginRequired"));
      return;
    }
    if (isError) {
      void refetch();
      toast.error(
        t("favorites.loadError", "Could not load saved flights. Please retry.")
      );
      return;
    }
    if (saved) {
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
        saved
          ? "text-rose-500 bg-rose-50 hover:bg-rose-100"
          : "hover:text-rose-500 hover:bg-rose-50"
      } ${className}`}
      onClick={handleToggle}
      disabled={isLoading}
      aria-label={label}
      aria-pressed={saved}
      data-testid="favorite-button"
    >
      {isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      ) : (
        <Heart
          className={`h-5 w-5 transition-all duration-200 ${
            saved ? "fill-current scale-110" : ""
          }`}
          aria-hidden="true"
        />
      )}
      {showLabel && <span>{label}</span>}
    </Button>
  );

  if (!showTooltip) {
    return buttonContent;
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>{buttonContent}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export default FavoriteButton;
