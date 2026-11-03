import { useAuth } from "@/_core/hooks/useAuth";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Package,
  Search,
  MapPin,
  Clock,
  AlertCircle,
  CheckCircle2,
  Plane,
  ArrowRight,
} from "lucide-react";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";

const LICENSE_PLATE = /^[0-9]{10}$/;

interface BaggageTrackerProps {
  initialTagNumber?: string;
  showSearch?: boolean;
  compact?: boolean;
}

export function BaggageTracker({
  initialTagNumber,
  showSearch = true,
  compact = false,
}: BaggageTrackerProps) {
  const { t, i18n } = useTranslation();
  const currentLocale = i18n.language === "ar" ? ar : enUS;
  const [tagNumber, setTagNumber] = useState(initialTagNumber || "");
  const [identity, setIdentity] = useState("");
  const [searchTag, setSearchTag] = useState(initialTagNumber || "");
  const [searchIdentity, setSearchIdentity] = useState("");

  // A 10-digit IATA licence plate is printed on the bag, so the public
  // tracker also needs the passenger surname or booking reference.
  const isLicensePlate = LICENSE_PLATE.test(tagNumber.trim());
  const searchIsPlate = LICENSE_PLATE.test(searchTag);
  const identityIsReference = /^[A-Z0-9]{4,6}$/.test(searchIdentity);

  // Fetch tracking data (legacy tags)
  const {
    data: trackingData,
    isLoading,
    error,
    refetch,
  } = trpc.baggage.track.useQuery(
    { tagNumber: searchTag },
    {
      enabled: searchTag.length > 0 && !searchIsPlate,
    }
  );
  const plateTracking = trpc.baggage.trackByLicensePlate.useQuery(
    {
      licensePlate: searchTag,
      ...(identityIsReference
        ? { bookingReference: searchIdentity }
        : { surname: searchIdentity }),
    },
    { enabled: searchIsPlate && searchIdentity.length >= 2 }
  );

  const { isAuthenticated } = useAuth();
  const custody = trpc.baggage.custody.useQuery(
    { tagNumber: searchTag },
    { enabled: isAuthenticated && searchTag.length > 0 }
  );
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const value = tagNumber.trim().toUpperCase();
    if (!value) return;
    if (LICENSE_PLATE.test(value) && identity.trim().length < 2) return;
    setSearchTag(value);
    setSearchIdentity(identity.trim().toUpperCase());
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "checked_in":
      case "security_screening":
        return "bg-blue-50 text-blue-700 border-blue-200";
      case "loading":
      case "in_transit":
        return "bg-yellow-50 text-yellow-700 border-yellow-200";
      case "arrived":
      case "customs":
      case "ready_for_pickup":
        return "bg-green-50 text-green-700 border-green-200";
      case "claimed":
        return "bg-emerald-50 text-emerald-700 border-emerald-200";
      case "lost":
      case "damaged":
        return "bg-red-50 text-red-700 border-red-200";
      case "found":
        return "bg-purple-50 text-purple-700 border-purple-200";
      default:
        return "bg-gray-50 text-gray-700 border-gray-200";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "checked_in":
        return <Package className="h-4 w-4" />;
      case "security_screening":
        return <AlertCircle className="h-4 w-4" />;
      case "loading":
      case "in_transit":
        return <Plane className="h-4 w-4" />;
      case "arrived":
      case "customs":
      case "ready_for_pickup":
        return <MapPin className="h-4 w-4" />;
      case "claimed":
        return <CheckCircle2 className="h-4 w-4" />;
      case "lost":
      case "damaged":
        return <AlertCircle className="h-4 w-4" />;
      default:
        return <Package className="h-4 w-4" />;
    }
  };

  return (
    <div className="space-y-4">
      {custody.data && (
        <Card className="p-4 space-y-2">
          <p className="font-medium">
            {i18n.language === "ar"
              ? "إثباتات تسليم الأمتعة"
              : "Verified baggage handovers"}
            : {custody.data.verifiedPoints}/{custody.data.requiredPoints}
          </p>
          <p className="text-sm text-muted-foreground">
            {custody.data.complete
              ? i18n.language === "ar"
                ? "اكتملت نقاط التتبع المطلوبة"
                : "Required custody points are complete"
              : i18n.language === "ar"
                ? "سلسلة التتبع غير مكتملة"
                : "Custody history is incomplete"}
          </p>
          <ul className="text-xs space-y-1">
            {custody.data.events.map(event => (
              <li key={event.id}>
                {event.stage} · {event.sourceId} ·{" "}
                {event.observedAt.toLocaleString()}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {/* Search Form */}
      {showSearch && (
        <Card className="p-4">
          <form onSubmit={handleSearch} className="space-y-2">
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  type="text"
                  value={tagNumber}
                  onChange={e => setTagNumber(e.target.value.toUpperCase())}
                  placeholder={t("baggage.enterTagNumber")}
                  maxLength={20}
                  className="uppercase"
                  aria-label={t("baggage.tagNumber")}
                />
              </div>
              <Button
                type="submit"
                disabled={
                  !tagNumber.trim() ||
                  (isLicensePlate && identity.trim().length < 2)
                }
              >
                <Search className="h-4 w-4 me-2" />
                {t("baggage.track")}
              </Button>
            </div>
            {isLicensePlate && (
              <div className="space-y-1">
                <Input
                  type="text"
                  value={identity}
                  onChange={e => setIdentity(e.target.value)}
                  placeholder={`${t("baggage.tracking.surname")} / ${t(
                    "baggage.tracking.bookingReference"
                  )}`}
                  maxLength={100}
                  aria-label={t("baggage.tracking.identityRequired")}
                />
                <p className="text-xs text-muted-foreground">
                  {t("baggage.tracking.identityHint")}
                </p>
              </div>
            )}
          </form>
        </Card>
      )}

      {/* Licence-plate tracker (IATA Resolution 753 points, public allow-list) */}
      {searchIsPlate && plateTracking.isLoading && (
        <Card className="p-6">
          <Skeleton className="h-8 w-48 mb-4" />
          <Skeleton className="h-16 w-full" />
        </Card>
      )}
      {searchIsPlate && plateTracking.error && (
        <Card className="p-6 border-red-200 bg-red-50">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-red-600" />
            <div>
              <p className="font-medium text-red-800">
                {t("baggage.notFound")}
              </p>
              <p className="text-sm text-red-600">
                {t("baggage.notFoundDesc", { tagNumber: searchTag })}
              </p>
            </div>
          </div>
        </Card>
      )}
      {searchIsPlate && plateTracking.data && (
        <Card className={compact ? "p-4" : "p-6"}>
          <div className="flex items-start justify-between mb-4">
            <h3 className="text-lg font-semibold flex items-center gap-2 font-mono">
              <Package className="h-5 w-5" />
              {plateTracking.data.licensePlate}
            </h3>
            <Badge variant="outline">
              {t(`baggage.tracking.status.${plateTracking.data.status}`)}
            </Badge>
          </div>
          {plateTracking.data.lastStationCode && (
            <p className="text-sm text-muted-foreground mb-4 flex items-center gap-1">
              <MapPin className="h-4 w-4" />
              {t("baggage.currentLocation")}:{" "}
              {plateTracking.data.lastStationCode}
            </p>
          )}
          <h4 className="font-medium mb-2">{t("baggage.tracking.title")}</h4>
          <ol className="space-y-2">
            {(["acceptance", "loading", "transfer", "arrival"] as const).map(
              point => {
                const observed = plateTracking.data.points.filter(
                  p => p.trackingPoint === point
                );
                return (
                  <li key={point} className="flex items-start gap-3 text-sm">
                    {observed.length ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5" />
                    ) : (
                      <Clock className="h-4 w-4 text-muted-foreground mt-0.5" />
                    )}
                    <div>
                      <p className="font-medium">
                        {t(`baggage.tracking.points.${point}`)}
                      </p>
                      {observed.map((p, i) => (
                        <p key={i} className="text-xs text-muted-foreground">
                          {p.stationCode} ·{" "}
                          {format(new Date(p.observedAt), "PPp", {
                            locale: currentLocale,
                          })}{" "}
                          ·{" "}
                          {p.physicalScanVerified
                            ? t("baggage.tracking.physicalScan")
                            : t("baggage.tracking.notPhysicalScan")}
                        </p>
                      ))}
                      {!observed.length && (
                        <p className="text-xs text-muted-foreground">
                          {t("baggage.tracking.missing")}
                        </p>
                      )}
                    </div>
                  </li>
                );
              }
            )}
          </ol>
        </Card>
      )}

      {/* Loading State */}
      {isLoading && (
        <Card className="p-6">
          <div className="space-y-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-full" />
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Error State */}
      {error && searchTag && (
        <Card className="p-6 border-red-200 bg-red-50">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-red-600" />
            <div>
              <p className="font-medium text-red-800">
                {t("baggage.notFound")}
              </p>
              <p className="text-sm text-red-600">
                {t("baggage.notFoundDesc", { tagNumber: searchTag })}
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Tracking Results */}
      {trackingData && (
        <Card className={compact ? "p-4" : "p-6"}>
          {/* Baggage Info Header */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Package className="h-5 w-5" />
                {t("baggage.tagNumber")}: {trackingData.baggage.tagNumber}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t("baggage.weight")}: {trackingData.baggage.weight} kg
              </p>
            </div>
            <Badge
              variant="outline"
              className={getStatusColor(trackingData.baggage.status)}
            >
              {getStatusIcon(trackingData.baggage.status)}
              <span className="ms-1">
                {t(`baggage.status.${trackingData.baggage.status}`)}
              </span>
            </Badge>
          </div>

          {/* Current Location */}
          {trackingData.baggage.lastLocation && (
            <div className="mb-6 p-4 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-primary" />
                <span className="font-medium">
                  {t("baggage.currentLocation")}:
                </span>
              </div>
              <p className="text-lg font-semibold mt-1">
                {trackingData.baggage.lastLocation}
              </p>
            </div>
          )}

          {/* Tracking Timeline */}
          {!compact && trackingData.tracking.length > 0 && (
            <div>
              <h4 className="font-medium mb-4 flex items-center gap-2">
                <Clock className="h-4 w-4" />
                {t("baggage.trackingHistory")}
              </h4>
              <div className="relative">
                {/* Timeline line */}
                <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-muted" />

                {/* Timeline items */}
                <div className="space-y-4">
                  {trackingData.tracking.map((record, index) => (
                    <div key={record.id} className="flex gap-4 relative">
                      {/* Timeline dot */}
                      <div
                        className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center ${
                          index === 0
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted border-2 border-background"
                        }`}
                      >
                        {getStatusIcon(record.status)}
                      </div>

                      {/* Content */}
                      <div className="flex-1 pb-4">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={getStatusColor(record.status)}
                          >
                            {t(`baggage.status.${record.status}`)}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(record.scannedAt), "PPp", {
                              locale: currentLocale,
                            })}
                          </span>
                        </div>
                        <p className="text-sm mt-1 flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {record.location}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Refresh button */}
          <div className="mt-4 pt-4 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="w-full"
            >
              <ArrowRight className="h-4 w-4 me-2 rotate-180" />
              {t("baggage.refreshStatus")}
            </Button>
          </div>
        </Card>
      )}

      {/* Empty State */}
      {!searchTag && !isLoading && showSearch && (
        <Card className="p-6 text-center">
          <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="font-medium mb-2">{t("baggage.trackYourBaggage")}</h3>
          <p className="text-sm text-muted-foreground">
            {t("baggage.trackYourBaggageDesc")}
          </p>
        </Card>
      )}
    </div>
  );
}
