import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";
import {
  AlertTriangle,
  Clock,
  XCircle,
  Plane,
  ArrowRight,
  Loader2,
} from "lucide-react";

const severityColors = {
  minor: "bg-yellow-100 text-yellow-700 border-yellow-200",
  moderate: "bg-orange-100 text-orange-700 border-orange-200",
  severe: "bg-red-100 text-red-700 border-red-200",
};

const typeIcons = {
  delay: <Clock className="h-5 w-5 text-orange-500" />,
  cancellation: <XCircle className="h-5 w-5 text-red-500" />,
  diversion: <ArrowRight className="h-5 w-5 text-blue-500" />,
};

export function DisruptionHub() {
  const { t } = useTranslation();

  const { data: disruptions, isLoading } =
    trpc.disruptions.myDisruptions.useQuery(undefined, { retry: false });

  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="h-5 w-5" />
          <h3 className="font-semibold">{t("disruptions.title")}</h3>
        </div>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      </Card>
    );
  }

  if (!disruptions || disruptions.length === 0) {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle className="h-5 w-5" />
          <h3 className="font-semibold">{t("disruptions.title")}</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("disruptions.noDisruptions")}
        </p>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-orange-500" />
          <h3 className="font-semibold">{t("disruptions.title")}</h3>
        </div>
        <Badge variant="destructive">{disruptions.length}</Badge>
      </div>

      <div className="space-y-4">
        {disruptions.map(disruption => (
          <div key={disruption.id} className="border rounded-lg p-4 space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {typeIcons[disruption.type as keyof typeof typeIcons]}
                <span className="font-medium">{disruption.flightNumber}</span>
                {disruption.bookingReference && (
                  <Badge variant="outline" className="text-xs">
                    {disruption.bookingReference}
                  </Badge>
                )}
              </div>
              <Badge
                className={
                  severityColors[
                    disruption.severity as keyof typeof severityColors
                  ]
                }
              >
                {t(`disruptions.severity.${disruption.severity}`)}
              </Badge>
            </div>

            {/* Reason */}
            <p className="text-sm text-muted-foreground">{disruption.reason}</p>

            {/* Time Info */}
            {disruption.type === "delay" && disruption.newDepartureTime && (
              <div className="flex items-center gap-3 text-sm">
                <div className="flex items-center gap-1">
                  <Clock className="h-3 w-3 text-muted-foreground" />
                  <span className="line-through text-muted-foreground">
                    {disruption.originalDepartureTime
                      ? new Date(
                          disruption.originalDepartureTime
                        ).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : ""}
                  </span>
                </div>
                <ArrowRight className="h-3 w-3" />
                <span className="font-medium text-orange-600">
                  {new Date(disruption.newDepartureTime).toLocaleTimeString(
                    [],
                    { hour: "2-digit", minute: "2-digit" }
                  )}
                </span>
                {disruption.delayMinutes && (
                  <Badge variant="secondary" className="text-xs">
                    +{disruption.delayMinutes} {t("disruptions.min")}
                  </Badge>
                )}
              </div>
            )}

            {/* Cancellation Actions */}
            {disruption.type === "cancellation" && (
              <div className="flex gap-2">
                <AlternativeFlightsButton flightId={disruption.flightId} />
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function AlternativeFlightsButton({ flightId }: { flightId: number }) {
  const { t } = useTranslation();

  const { data, isLoading, refetch, isFetched } =
    trpc.disruptions.getAlternatives.useQuery(
      { flightId },
      { enabled: false, retry: false }
    );

  if (!isFetched) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => refetch()}
        disabled={isLoading}
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : (
          <Plane className="h-4 w-4 mr-2" />
        )}
        {t("disruptions.findAlternatives")}
      </Button>
    );
  }

  if (!data || data.alternatives.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("disruptions.noAlternatives")}
      </p>
    );
  }

  return (
    <div className="space-y-2 w-full">
      <Separator />
      <p className="text-sm font-medium">
        {t("disruptions.alternativeFlights")}:
      </p>
      {data.alternatives.map(alt => (
        <div
          key={alt.id}
          className="flex items-center justify-between p-2 bg-muted/50 rounded-lg text-sm"
        >
          <div>
            <span className="font-medium">{alt.flightNumber}</span>
            <span className="text-muted-foreground ml-2">
              {new Date(alt.departureTime).toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
          <Badge variant="secondary">
            {(alt.economyPrice / 100).toFixed(0)} SAR
          </Badge>
        </div>
      ))}
    </div>
  );
}
