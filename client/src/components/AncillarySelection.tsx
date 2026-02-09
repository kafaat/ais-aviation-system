import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Package,
  UtensilsCrossed,
  Armchair,
  Shield,
  Coffee,
  Zap,
  Plus,
  Minus,
  type LucideIcon,
} from "lucide-react";

interface AncillarySelectionProps {
  cabinClass: "economy" | "business";
  numberOfPassengers: number;
  onSelectionChange: (
    selectedAncillaries: SelectedAncillary[],
    totalCost: number
  ) => void;
}

export interface SelectedAncillary {
  ancillaryServiceId: number;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  passengerId?: number;
}

const categoryIcons: Record<string, LucideIcon> = {
  baggage: Package,
  meal: UtensilsCrossed,
  seat: Armchair,
  insurance: Shield,
  lounge: Coffee,
  priority_boarding: Zap,
};

export default function AncillarySelection({
  cabinClass,
  numberOfPassengers,
  onSelectionChange,
}: AncillarySelectionProps) {
  const { t } = useTranslation();
  const [selectedServices, setSelectedServices] = useState<Map<number, number>>(
    new Map()
  );

  const { data: ancillaries, isLoading } = trpc.ancillary.getAvailable.useQuery(
    {}
  );

  // Filter ancillaries by cabin class
  const filteredAncillaries = ancillaries?.filter(service => {
    if (!service.applicableCabinClasses) return true;
    try {
      const classes = JSON.parse(service.applicableCabinClasses);
      return classes.includes(cabinClass);
    } catch {
      return true;
    }
  });

  // Group by category
  const groupedAncillaries = filteredAncillaries?.reduce(
    (acc, service) => {
      if (!acc[service.category]) {
        acc[service.category] = [];
      }
      acc[service.category].push(service);
      return acc;
    },
    {} as Record<string, typeof filteredAncillaries>
  );

  const handleQuantityChange = (
    serviceId: number,
    delta: number,
    _price: number
  ) => {
    const newSelected = new Map(selectedServices);
    const current = newSelected.get(serviceId) || 0;
    const newQuantity = Math.max(
      0,
      Math.min(numberOfPassengers * 3, current + delta)
    );

    if (newQuantity === 0) {
      newSelected.delete(serviceId);
    } else {
      newSelected.set(serviceId, newQuantity);
    }

    setSelectedServices(newSelected);

    // Calculate total and notify parent
    const selected: SelectedAncillary[] = [];
    let totalCost = 0;

    newSelected.forEach((quantity, id) => {
      const service = ancillaries?.find(s => s.id === id);
      if (service) {
        const itemTotal = service.price * quantity;
        selected.push({
          ancillaryServiceId: id,
          quantity,
          unitPrice: service.price,
          totalPrice: itemTotal,
        });
        totalCost += itemTotal;
      }
    });

    onSelectionChange(selected, totalCost);
  };

  const toggleService = (serviceId: number, _price: number) => {
    const current = selectedServices.get(serviceId) || 0;
    if (current > 0) {
      handleQuantityChange(serviceId, -current, _price);
    } else {
      handleQuantityChange(serviceId, 1, _price);
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("ancillary.title")}</CardTitle>
          <CardDescription>{t("ancillary.loading")}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!groupedAncillaries || Object.keys(groupedAncillaries).length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("ancillary.title")}</CardTitle>
        <CardDescription>{t("ancillary.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {Object.entries(groupedAncillaries).map(([category, services]) => {
          const Icon = categoryIcons[category] || Package;
          return (
            <div key={category} className="space-y-3">
              <div className="flex items-center gap-2">
                <Icon className="h-5 w-5 text-primary" />
                <h3 className="font-semibold capitalize">
                  {t(`ancillary.categories.${category}`)}
                </h3>
              </div>
              <div className="grid gap-3">
                {services.map(service => {
                  const quantity = selectedServices.get(service.id) || 0;
                  const isSelected = quantity > 0;

                  return (
                    <div
                      key={service.id}
                      className={`border rounded-lg p-4 transition-all ${
                        isSelected
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-start gap-3 flex-1">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() =>
                              toggleService(service.id, service.price)
                            }
                            id={`service-${service.id}`}
                          />
                          <div className="flex-1">
                            <Label
                              htmlFor={`service-${service.id}`}
                              className="font-medium cursor-pointer"
                            >
                              {service.name}
                            </Label>
                            {service.description && (
                              <p className="text-sm text-muted-foreground mt-1">
                                {service.description}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="text-end">
                          <p className="font-semibold text-lg">
                            {(service.price / 100).toFixed(2)}{" "}
                            {t("common.currency")}
                          </p>
                        </div>
                      </div>

                      {isSelected && (
                        <div className="mt-3 pt-3 border-t flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                handleQuantityChange(
                                  service.id,
                                  -1,
                                  service.price
                                )
                              }
                              disabled={quantity <= 1}
                            >
                              <Minus className="h-3 w-3" />
                            </Button>
                            <span className="w-12 text-center font-medium">
                              {quantity}
                            </span>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                handleQuantityChange(
                                  service.id,
                                  1,
                                  service.price
                                )
                              }
                              disabled={quantity >= numberOfPassengers * 3}
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>
                          <div className="text-end">
                            <p className="text-sm text-muted-foreground">
                              {t("ancillary.subtotal")}
                            </p>
                            <p className="font-semibold">
                              {((service.price * quantity) / 100).toFixed(2)}{" "}
                              {t("common.currency")}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {selectedServices.size > 0 && (
          <>
            <Separator />
            <div className="bg-muted/50 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">{t("ancillary.totalExtras")}</p>
                  <p className="text-sm text-muted-foreground">
                    {selectedServices.size} {t("ancillary.servicesSelected")}
                  </p>
                </div>
                <p className="text-2xl font-bold text-primary">
                  {(
                    Array.from(selectedServices.entries()).reduce(
                      (sum, [id, qty]) => {
                        const service = ancillaries?.find(s => s.id === id);
                        return sum + (service ? service.price * qty : 0);
                      },
                      0
                    ) / 100
                  ).toFixed(2)}{" "}
                  {t("common.currency")}
                </p>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
