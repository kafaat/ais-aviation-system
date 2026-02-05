/**
 * CreatePriceAlertDialog Component
 * Dialog for creating a new price alert
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Bell, Plus, Loader2, ArrowRight } from "lucide-react";
import { toast } from "sonner";

interface CreatePriceAlertDialogProps {
  onSuccess?: () => void;
  triggerButton?: React.ReactNode;
}

export function CreatePriceAlertDialog({
  onSuccess,
  triggerButton,
}: CreatePriceAlertDialogProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [originId, setOriginId] = useState<string>("");
  const [destinationId, setDestinationId] = useState<string>("");
  const [targetPrice, setTargetPrice] = useState<string>("");
  const [cabinClass, setCabinClass] = useState<"economy" | "business">(
    "economy"
  );

  const { data: airports, isLoading: isLoadingAirports } =
    trpc.reference.airports.useQuery();

  const createAlert = trpc.priceAlerts.create.useMutation({
    onSuccess: () => {
      toast.success(t("priceAlerts.alertCreated"));
      setOpen(false);
      resetForm();
      onSuccess?.();
    },
    onError: error => {
      toast.error(error.message);
    },
  });

  const resetForm = () => {
    setOriginId("");
    setDestinationId("");
    setTargetPrice("");
    setCabinClass("economy");
  };

  const handleCreate = () => {
    if (!originId || !destinationId || !targetPrice) {
      toast.error(t("priceAlerts.fillAllFields"));
      return;
    }

    if (originId === destinationId) {
      toast.error(t("priceAlerts.sameAirportError"));
      return;
    }

    const price = parseFloat(targetPrice);
    if (isNaN(price) || price <= 0) {
      toast.error(t("favorites.invalidPrice"));
      return;
    }

    createAlert.mutate({
      originId: parseInt(originId),
      destinationId: parseInt(destinationId),
      targetPrice: Math.round(price * 100), // Convert to cents
      cabinClass,
    });
  };

  const airportsList = airports || [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {triggerButton || (
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            {t("priceAlerts.createAlert")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            {t("priceAlerts.createNewAlert")}
          </DialogTitle>
          <DialogDescription>
            {t("priceAlerts.createAlertDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Route Selection */}
          <div className="grid grid-cols-[1fr,auto,1fr] gap-4 items-end">
            <div className="space-y-2">
              <Label>{t("home.search.from")}</Label>
              <Select value={originId} onValueChange={setOriginId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("home.search.selectCity")} />
                </SelectTrigger>
                <SelectContent>
                  {isLoadingAirports ? (
                    <div className="p-2 text-center">
                      <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                    </div>
                  ) : (
                    airportsList.map(airport => (
                      <SelectItem
                        key={airport.id}
                        value={airport.id.toString()}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-bold">{airport.code}</span>
                          <span className="text-muted-foreground">
                            {airport.city}
                          </span>
                        </div>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <ArrowRight className="h-5 w-5 text-muted-foreground mb-2" />

            <div className="space-y-2">
              <Label>{t("home.search.to")}</Label>
              <Select value={destinationId} onValueChange={setDestinationId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("home.search.selectCity")} />
                </SelectTrigger>
                <SelectContent>
                  {isLoadingAirports ? (
                    <div className="p-2 text-center">
                      <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                    </div>
                  ) : (
                    airportsList
                      .filter(a => a.id.toString() !== originId)
                      .map(airport => (
                        <SelectItem
                          key={airport.id}
                          value={airport.id.toString()}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-bold">{airport.code}</span>
                            <span className="text-muted-foreground">
                              {airport.city}
                            </span>
                          </div>
                        </SelectItem>
                      ))
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Cabin Class */}
          <div className="space-y-2">
            <Label>{t("filters.cabinClass")}</Label>
            <RadioGroup
              value={cabinClass}
              onValueChange={(value: "economy" | "business") =>
                setCabinClass(value)
              }
              className="flex gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="economy" id="economy" />
                <Label htmlFor="economy" className="font-normal cursor-pointer">
                  {t("cabin.economy")}
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="business" id="business" />
                <Label
                  htmlFor="business"
                  className="font-normal cursor-pointer"
                >
                  {t("cabin.business")}
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Target Price */}
          <div className="space-y-2">
            <Label>{t("priceAlerts.targetPrice")}</Label>
            <div className="relative">
              <Input
                type="number"
                value={targetPrice}
                onChange={e => setTargetPrice(e.target.value)}
                placeholder={t("priceAlerts.enterTargetPrice")}
                className="pr-16"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                {t("common.currency")}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("priceAlerts.targetPriceHint")}
            </p>
          </div>

          {/* Summary */}
          {originId && destinationId && targetPrice && (
            <div className="p-4 bg-muted/50 rounded-lg">
              <p className="text-sm text-muted-foreground mb-2">
                {t("priceAlerts.alertSummary")}
              </p>
              <p className="font-medium">
                {t("priceAlerts.alertSummaryText", {
                  origin:
                    airportsList.find(a => a.id.toString() === originId)
                      ?.code || "",
                  destination:
                    airportsList.find(a => a.id.toString() === destinationId)
                      ?.code || "",
                  price: parseFloat(targetPrice).toLocaleString(),
                  cabinClass: t(`cabin.${cabinClass}`),
                })}
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => setOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleCreate} disabled={createAlert.isPending}>
            {createAlert.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Bell className="h-4 w-4 mr-2" />
            )}
            {t("priceAlerts.createAlert")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default CreatePriceAlertDialog;
