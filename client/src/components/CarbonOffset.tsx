import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Leaf, TreePine } from "lucide-react";

interface CarbonOffsetProps {
  flightId: number;
  cabinClass?: "economy" | "business";
  className?: string;
}

export function CarbonOffset({
  flightId,
  cabinClass = "economy",
  className = "",
}: CarbonOffsetProps) {
  const { t } = useTranslation();

  const { data, isLoading } = trpc.travelScenarios.getCarbonOffset.useQuery(
    { flightId },
    { enabled: flightId > 0 }
  );

  if (isLoading || !data) return null;

  const co2 = cabinClass === "economy" ? data.co2Economy : data.co2Business;

  return (
    <Card
      className={`p-4 bg-gradient-to-r from-emerald-50 to-green-50 dark:from-emerald-950/30 dark:to-green-950/30 border-emerald-200 dark:border-emerald-800 ${className}`}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center flex-shrink-0">
          <Leaf className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-emerald-900 dark:text-emerald-200 text-sm">
            {t("carbon.title")}
          </h4>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                {t("carbon.co2")}
              </p>
              <p className="text-lg font-bold text-emerald-800 dark:text-emerald-300">
                {co2} <span className="text-xs font-normal">kg</span>
              </p>
            </div>
            <div>
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                {t("carbon.distance")}
              </p>
              <p className="text-lg font-bold text-emerald-800 dark:text-emerald-300">
                {data.distanceKm.toLocaleString()}{" "}
                <span className="text-xs font-normal">km</span>
              </p>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
            <TreePine className="h-3 w-3" />
            <span>
              {t("carbon.treesEquivalent", { count: data.treesEquivalent })}
            </span>
          </div>
          <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
            {t("carbon.offsetCost", {
              cost: (data.offsetCostSAR / 100).toFixed(2),
            })}
          </p>
        </div>
      </div>
    </Card>
  );
}
