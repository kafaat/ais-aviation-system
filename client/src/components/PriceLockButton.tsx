import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Lock, Clock, Loader2, Check } from "lucide-react";
import { toast } from "sonner";

interface PriceLockButtonProps {
  flightId: number;
  cabinClass: "economy" | "business";
}

export function PriceLockButton({
  flightId,
  cabinClass,
}: PriceLockButtonProps) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  // Creating a lock is idempotent per user, flight and cabin. Request it only
  // on a click so search does not issue two extra reads for every flight.
  const lockMutation = trpc.priceLock.create.useMutation({
    onSuccess: data => {
      utils.priceLock.checkLock.setData(
        { flightId, cabinClass },
        { lock: data.lock }
      );
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

  const lock = lockMutation.data?.lock;
  if (lock && lock.expiresAt.getTime() > Date.now()) {
    const expiresAt = lock.expiresAt;
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
          {t("priceLock.expiresIn", { hours: hoursLeft })}
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
        25 {t("common.currency")}
      </Badge>
    </Button>
  );
}
