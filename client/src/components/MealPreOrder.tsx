import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";
import {
  UtensilsCrossed,
  Leaf,
  Baby,
  ShieldCheck,
  Check,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

interface MealOption {
  id: number;
  code: string;
  name: string;
  description: string | null;
  price: number;
  icon: string;
}

interface MealPreOrderProps {
  bookingId: number;
  passengerId?: number;
  onMealSelected?: (mealId: number) => void;
}

const MEAL_ICONS: Record<string, React.ReactNode> = {
  MEAL_REG: <UtensilsCrossed className="h-5 w-5" />,
  MEAL_VEG: <Leaf className="h-5 w-5 text-green-600" />,
  MEAL_HALAL: <ShieldCheck className="h-5 w-5 text-emerald-600" />,
  MEAL_KIDS: <Baby className="h-5 w-5 text-blue-500" />,
};

export function MealPreOrder({
  bookingId,
  passengerId,
  onMealSelected,
}: MealPreOrderProps) {
  const { t } = useTranslation();
  const [selectedMealId, setSelectedMealId] = useState<number | null>(null);

  const { data: meals, isLoading } = trpc.ancillary.getByCategory.useQuery({
    category: "meal",
  });

  const addToBooking = trpc.ancillary.addToBooking.useMutation({
    onSuccess: () => {
      toast.success(t("meal.orderSuccess"));
    },
    onError: error => {
      toast.error(error.message || t("meal.orderError"));
    },
  });

  const handleSelectMeal = async (meal: MealOption) => {
    setSelectedMealId(meal.id);
    onMealSelected?.(meal.id);

    await addToBooking.mutateAsync({
      bookingId,
      ancillaryServiceId: meal.id,
      quantity: 1,
      passengerId,
      metadata: JSON.stringify({
        mealCode: meal.code,
        mealName: meal.name,
      }),
    });
  };

  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <UtensilsCrossed className="h-5 w-5" />
          <h3 className="font-semibold">{t("meal.title")}</h3>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-28 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      </Card>
    );
  }

  const mealList = (meals || []) as MealOption[];

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-2">
        <UtensilsCrossed className="h-5 w-5" />
        <h3 className="font-semibold">{t("meal.title")}</h3>
      </div>
      <p className="text-sm text-muted-foreground mb-4">{t("meal.subtitle")}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {mealList.map(meal => {
          const isSelected = selectedMealId === meal.id;
          const icon = MEAL_ICONS[meal.code] || (
            <UtensilsCrossed className="h-5 w-5" />
          );

          return (
            <button
              key={meal.id}
              onClick={() => handleSelectMeal(meal)}
              disabled={addToBooking.isPending}
              className={`relative p-4 rounded-lg border-2 text-left transition-all ${
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50 hover:bg-accent/50"
              }`}
            >
              {isSelected && (
                <div className="absolute top-2 right-2">
                  <Check className="h-4 w-4 text-primary" />
                </div>
              )}

              <div className="flex items-start gap-3">
                <div className="mt-0.5">{icon}</div>
                <div className="flex-1">
                  <p className="font-medium text-sm">{meal.name}</p>
                  {meal.description && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {meal.description}
                    </p>
                  )}
                  <Badge variant="secondary" className="mt-2 text-xs">
                    {(meal.price / 100).toFixed(0)} {t("common.sar")}
                  </Badge>
                </div>
              </div>

              {addToBooking.isPending && selectedMealId === meal.id && (
                <div className="absolute inset-0 bg-background/50 flex items-center justify-center rounded-lg">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {mealList.length === 0 && (
        <p className="text-center text-muted-foreground py-4">
          {t("meal.noOptions")}
        </p>
      )}
    </Card>
  );
}
