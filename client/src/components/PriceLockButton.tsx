import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Lock, Clock, Loader2, Check } from "lucide-react";
import { toast } from "sonner";

interface PriceLockButtonProps {
  flightId: number;
  cabinClass: "economy" | "business";
  currentPrice: number; // SAR cents
}

export function PriceLockButton({
  flightId,
  cabinClass,
  currentPrice: _currentPrice,
}: PriceLockButtonProps) {
  const { t } = useTranslation();
  const [isLocked, setIsLocked] = useState(false);

  const { data: lockStatus } = trpc.priceLock.checkLock.useQuery(
    { flightId, cabinClass },
    { retry: false }
  );

  const lockMutation = trpc.priceLock.create.useMutation({
    onSuccess: data => {
      setIsLocked(true);
      if (data.isNew) {
        toast.success(t("priceLock.success"));
      } else {
        toast.info(t("priceLock.alreadyLocked"));
      }
    },
    onError: error => {
      toast.error(error.message || t("priceLock.error"));
    },
  });

  const hasActiveLock = lockStatus?.lock || isLocked;

  if (hasActiveLock && lockStatus?.lock) {
    const expiresAt = new Date(lockStatus.lock.expiresAt);
    const hoursLeft = Math.max(
      0,
      Math.round((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60))
    );

    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
        <Check className="h-4 w-4 text-green-600" />
        <span className="text-sm text-green-700 font-medium">
          {t("priceLock.locked")}
        </span>
        <Badge variant="secondary" className="text-xs">
          <Clock className="h-3 w-3 me-1" />
          {hoursLeft}h
        </Badge>
      </div>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => lockMutation.mutate({ flightId, cabinClass })}
      disabled={lockMutation.isPending}
      className="border-amber-200 text-amber-700 hover:bg-amber-50"
    >
      {lockMutation.isPending ? (
        <Loader2 className="h-4 w-4 me-2 animate-spin" />
      ) : (
        <Lock className="h-4 w-4 me-2" />
      )}
      {t("priceLock.lockPrice")}
      <Badge variant="secondary" className="ms-2 text-xs">
        {(25).toFixed(0)} {t("common.sar")}
      </Badge>
    </Button>
  );
}
