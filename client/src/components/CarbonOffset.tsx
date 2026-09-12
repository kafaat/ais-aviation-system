import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Leaf } from "lucide-react";
export function CarbonOffset({
  flightId,
  cabinClass = "economy",
  className = "",
}: {
  flightId: number;
  cabinClass?: "economy" | "business";
  className?: string;
}) {
  const { t, i18n } = useTranslation(),
    ar = i18n.language.startsWith("ar");
  const { data, isLoading } = trpc.travelScenarios.getCarbonOffset.useQuery(
    { flightId },
    { enabled: flightId > 0 }
  );
  if (isLoading || !data) return null;
  const co2 = cabinClass === "economy" ? data.co2Economy : data.co2Business,
    cost =
      cabinClass === "economy"
        ? data.offsetCostSAR
        : data.offsetBusinessCostSAR;
  return (
    <Card className={`p-4 space-y-2 ${className}`}>
      <h4 className="font-semibold flex gap-2">
        <Leaf className="w-5 h-5" />
        {t("carbon.title")}
      </h4>
      {co2 === null ? (
        <p className="text-sm text-muted-foreground">
          {ar
            ? "تقدير الانبعاثات غير متاح: يلزم مصدر ساري لهذه الرحلة."
            : "Emissions unavailable: current flight-specific source data is required."}
        </p>
      ) : (
        <>
          <p>
            {co2.toLocaleString()} kg CO₂ · {data.distanceKm?.toLocaleString()}{" "}
            km
          </p>
          <p className="text-xs text-muted-foreground">
            {ar ? "أساس الحساب" : "Calculation basis"}: {data.basis} ·{" "}
            {data.method} {data.methodVersion}
          </p>
          {data.reference && (
            <a
              href={data.reference}
              target="_blank"
              rel="noreferrer"
              className="text-xs underline"
            >
              {ar ? "مصدر المنهجية" : "Method source"}
            </a>
          )}
          {data.observedAt && (
            <p className="text-xs">
              {ar ? "تاريخ البيانات" : "Data as of"}:{" "}
              {data.observedAt.toLocaleString()}
            </p>
          )}
        </>
      )}
      {cost !== null && (
        <p className="text-xs">
          {t("carbon.offsetCost", { cost: (cost / 100).toFixed(2) })} ·{" "}
          {ar
            ? "عرض سعر، لم يتم شراء تعويض"
            : "Quote only; no offset purchased"}
        </p>
      )}
    </Card>
  );
}
