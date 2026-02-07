import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Package,
  UtensilsCrossed,
  Armchair,
  Shield,
  Coffee,
  Zap,
  Plus,
  Minus,
  Trash2,
} from "lucide-react";

interface ManageAncillariesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookingId: number;
  cabinClass: "economy" | "business";
  numberOfPassengers: number;
}

const categoryIcons: Record<string, any> = {
  baggage: Package,
  meal: UtensilsCrossed,
  seat: Armchair,
  insurance: Shield,
  lounge: Coffee,
  priority_boarding: Zap,
};

const categoryNameKeys: Record<string, string> = {
  baggage: "ancillary.categories.baggage",
  meal: "ancillary.categories.meal",
  seat: "ancillary.categories.seat",
  insurance: "ancillary.categories.insurance",
  lounge: "ancillary.categories.lounge",
  priority_boarding: "ancillary.categories.priority_boarding",
};

export function ManageAncillariesDialog({
  open,
  onOpenChange,
  bookingId,
  cabinClass: _cabinClass,
  numberOfPassengers,
}: ManageAncillariesDialogProps) {
  const { t } = useTranslation();
  const utils = trpc.useUtils();
  const [selectedServices, setSelectedServices] = useState<
    Record<number, number>
  >({});

  const { data: availableServices, isLoading: loadingAvailable } =
    trpc.ancillary.getAvailable.useQuery({}, { enabled: open });

  const { data: currentAncillaries, isLoading: loadingCurrent } =
    trpc.ancillary.getBookingAncillaries.useQuery(
      { bookingId },
      { enabled: open }
    );

  const addAncillary = trpc.ancillary.addToBooking.useMutation({
    onSuccess: () => {
      utils.ancillary.getBookingAncillaries.invalidate({ bookingId });
      utils.bookings.myBookings.invalidate();
      toast.success(t("manageAncillaries.addSuccess"));
    },
    onError: error => {
      toast.error(error.message || t("manageAncillaries.addError"));
    },
  });

  const removeAncillary = trpc.ancillary.removeFromBooking.useMutation({
    onSuccess: () => {
      utils.ancillary.getBookingAncillaries.invalidate({ bookingId });
      utils.bookings.myBookings.invalidate();
      toast.success(t("manageAncillaries.removeSuccess"));
    },
    onError: error => {
      toast.error(error.message || t("manageAncillaries.removeError"));
    },
  });

  const handleAddService = async (serviceId: number, _price: number) => {
    const quantity = selectedServices[serviceId] || 1;
    await addAncillary.mutateAsync({
      bookingId,
      ancillaryServiceId: serviceId,
      quantity,
    });
    setSelectedServices(prev => ({ ...prev, [serviceId]: 0 }));
  };

  const handleRemoveAncillary = async (ancillaryId: number) => {
    await removeAncillary.mutateAsync({
      ancillaryId,
    });
  };

  const incrementQuantity = (serviceId: number) => {
    setSelectedServices(prev => ({
      ...prev,
      [serviceId]: Math.min((prev[serviceId] || 0) + 1, numberOfPassengers * 3),
    }));
  };

  const decrementQuantity = (serviceId: number) => {
    setSelectedServices(prev => ({
      ...prev,
      [serviceId]: Math.max((prev[serviceId] || 0) - 1, 0),
    }));
  };

  const groupedServices = availableServices?.reduce(
    (acc, service) => {
      if (!acc[service.category]) {
        acc[service.category] = [];
      }
      acc[service.category].push(service);
      return acc;
    },
    {} as Record<string, typeof availableServices>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("manageAncillaries.title")}</DialogTitle>
          <DialogDescription>
            {t("manageAncillaries.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Current Ancillaries */}
          {loadingCurrent ? (
            <Skeleton className="h-32 w-full" />
          ) : currentAncillaries && currentAncillaries.length > 0 ? (
            <div>
              <h3 className="text-sm font-semibold mb-3">
                {t("manageAncillaries.currentServices")}
              </h3>
              <div className="space-y-2">
                {currentAncillaries.map(ancillary => {
                  if (!ancillary.service) return null;
                  const Icon =
                    categoryIcons[ancillary.service.category] || Package;
                  return (
                    <div
                      key={ancillary.id}
                      className="flex items-center justify-between p-3 border rounded-lg bg-gray-50"
                    >
                      <div className="flex items-center gap-3">
                        <Icon className="h-5 w-5 text-primary" />
                        <div>
                          <p className="font-medium">
                            {ancillary.service.name}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {t("manageAncillaries.quantity")}:{" "}
                            {ancillary.quantity} •{" "}
                            {(ancillary.totalPrice / 100).toFixed(2)}{" "}
                            {t("common.sar")}
                          </p>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemoveAncillary(ancillary.id)}
                        disabled={removeAncillary.isPending}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              {t("manageAncillaries.noServices")}
            </p>
          )}

          {/* Available Services */}
          {loadingAvailable ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <div>
              <h3 className="text-sm font-semibold mb-3">
                {t("manageAncillaries.availableServices")}
              </h3>
              <div className="space-y-4">
                {groupedServices &&
                  Object.entries(groupedServices).map(
                    ([category, services]) => {
                      const Icon = categoryIcons[category] || Package;
                      return (
                        <div key={category}>
                          <div className="flex items-center gap-2 mb-2">
                            <Icon className="h-4 w-4 text-primary" />
                            <h4 className="text-sm font-medium">
                              {t(categoryNameKeys[category] || category)}
                            </h4>
                          </div>
                          <div className="space-y-2">
                            {services.map(service => (
                              <div
                                key={service.id}
                                className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50"
                              >
                                <div className="flex-1">
                                  <p className="font-medium text-sm">
                                    {service.name}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {service.description}
                                  </p>
                                  <p className="text-sm font-semibold text-primary mt-1">
                                    {(service.price / 100).toFixed(2)}{" "}
                                    {t("common.sar")}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="flex items-center gap-1 border rounded-lg">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        decrementQuantity(service.id)
                                      }
                                      disabled={!selectedServices[service.id]}
                                    >
                                      <Minus className="h-3 w-3" />
                                    </Button>
                                    <span className="px-3 text-sm font-medium">
                                      {selectedServices[service.id] || 0}
                                    </span>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        incrementQuantity(service.id)
                                      }
                                    >
                                      <Plus className="h-3 w-3" />
                                    </Button>
                                  </div>
                                  <Button
                                    size="sm"
                                    onClick={() =>
                                      handleAddService(
                                        service.id,
                                        service.price
                                      )
                                    }
                                    disabled={
                                      !selectedServices[service.id] ||
                                      addAncillary.isPending
                                    }
                                  >
                                    {t("common.add")}
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    }
                  )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
