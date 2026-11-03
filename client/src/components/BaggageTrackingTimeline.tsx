import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, Circle, ScanLine, Tag } from "lucide-react";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";

/**
 * Admin view of a bag's IATA Resolution 753 journey: licence plate, the four
 * core points per leg (plus optional screening) and the provenance of each
 * observation. A system entry is never shown as a physical scan.
 */
export function BaggageTrackingTimeline({
  identifier,
}: {
  identifier: string;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === "ar" ? ar : enUS;
  const timeline = trpc.baggage.adminTimeline.useQuery(
    { identifier },
    { enabled: identifier.length > 0 }
  );
  if (timeline.isLoading)
    return (
      <div className="space-y-2">
        {[1, 2, 3].map(i => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  if (!timeline.data) return null;
  const { bag, legs } = timeline.data;
  const requiredCount = legs.flatMap(l => l.points).filter(p => p.required);
  return (
    <div className="space-y-4" data-testid="baggage-tracking-timeline">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1 font-mono text-lg font-semibold">
          <Tag className="h-4 w-4" />
          {bag.licensePlate ?? bag.tagNumber}
        </span>
        {!bag.licensePlate && (
          <Badge variant="outline">
            {t("baggage.tracking.noLicensePlate")}
          </Badge>
        )}
        <Badge variant="secondary">
          {t("baggage.tracking.derivedStatus")}:{" "}
          {t(`baggage.tracking.status.${bag.derived.status}`)}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {t("baggage.tracking.corePoints", {
            observed: requiredCount.filter(p => p.event).length,
            required: requiredCount.length,
          })}
        </span>
      </div>
      <h4 className="font-medium">{t("baggage.tracking.title")}</h4>
      {legs.map((leg, index) => (
        <div key={leg.flightId} className="rounded-lg border p-3 space-y-2">
          <p className="text-sm font-medium">
            {t("baggage.tracking.leg", {
              index: index + 1,
              flightId: leg.flightId,
            })}
          </p>
          <ol className="grid grid-cols-1 md:grid-cols-4 gap-2">
            {leg.points.map(({ point, required, event }) => (
              <li
                key={point}
                className={`rounded-md border p-2 text-sm ${
                  event
                    ? "border-green-200 bg-green-50"
                    : required
                      ? "border-dashed"
                      : "border-dashed opacity-70"
                }`}
              >
                <div className="flex items-center gap-2">
                  {event ? (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  ) : (
                    <Circle className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span className="font-medium">
                    {t(`baggage.tracking.points.${point}`)}
                  </span>
                  {!required && (
                    <span className="text-xs text-muted-foreground">
                      {t("baggage.tracking.optional")}
                    </span>
                  )}
                </div>
                {event ? (
                  <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                    <p>
                      {event.stationCode} ·{" "}
                      {format(new Date(event.observedAt), "PPp", { locale })}
                    </p>
                    <p className="flex flex-wrap items-center gap-1">
                      <Badge
                        variant="outline"
                        className={
                          event.origin === "handler"
                            ? "bg-blue-50 text-blue-700 border-blue-200"
                            : "bg-gray-50 text-gray-700 border-gray-200"
                        }
                      >
                        {event.origin === "handler"
                          ? t("baggage.tracking.originHandler")
                          : t("baggage.tracking.originSystem")}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={
                          event.physicalScanVerified
                            ? "bg-green-50 text-green-700 border-green-200"
                            : "bg-amber-50 text-amber-700 border-amber-200"
                        }
                      >
                        <ScanLine className="h-3 w-3 me-1" />
                        {event.physicalScanVerified
                          ? t("baggage.tracking.physicalScan")
                          : t("baggage.tracking.notPhysicalScan")}
                      </Badge>
                      <span>{event.scanMethod}</span>
                      {event.containerId && <span>· {event.containerId}</span>}
                    </p>
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("baggage.tracking.missing")}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </div>
      ))}
      {timeline.data.events.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t("baggage.tracking.noEvents")}
        </p>
      )}
    </div>
  );
}
