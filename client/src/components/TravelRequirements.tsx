import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText, AlertTriangle, CheckCircle } from "lucide-react";

interface TravelRequirementsProps {
  flightId: number;
  className?: string;
}

export function TravelRequirements({
  flightId,
  className = "",
}: TravelRequirementsProps) {
  const { t } = useTranslation();

  const { data, isLoading } =
    trpc.travelScenarios.getTravelRequirements.useQuery(
      { flightId },
      { enabled: flightId > 0 }
    );

  if (isLoading || !data) return null;

  const { destination, requirements } = data;

  return (
    <Card
      className={`p-4 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 border-amber-200 dark:border-amber-800 ${className}`}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center flex-shrink-0">
          <FileText className="h-5 w-5 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-amber-900 dark:text-amber-200 text-sm">
            {t("travelDocs.title")} - {destination.city} ({destination.country})
          </h4>

          <div className="mt-3 space-y-2">
            {/* Visa Status */}
            <div className="flex items-center gap-2">
              {requirements.visaRequired ? (
                <>
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <span className="text-sm font-medium text-amber-800 dark:text-amber-300">
                    {t("travelDocs.visaRequired")}
                  </span>
                  {requirements.visaOnArrival && (
                    <Badge
                      variant="secondary"
                      className="text-xs bg-amber-100 dark:bg-amber-900/50"
                    >
                      {t("travelDocs.visaOnArrival")}
                    </Badge>
                  )}
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 text-emerald-600" />
                  <span className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
                    {t("travelDocs.visaFree")}
                  </span>
                </>
              )}
            </div>

            {/* Passport Validity */}
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <span className="text-sm text-amber-800 dark:text-amber-300">
                {t("travelDocs.passportValidity", {
                  months: requirements.passportValidityMonths,
                })}
              </span>
            </div>

            {/* Notes */}
            {requirements.notes.length > 0 && (
              <div className="mt-2 pt-2 border-t border-amber-200 dark:border-amber-800">
                <ul className="space-y-1">
                  {requirements.notes.map((note, i) => (
                    <li
                      key={i}
                      className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1"
                    >
                      <span className="mt-1">•</span>
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
