import { useTranslation } from "react-i18next";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Package,
  UtensilsCrossed,
  Armchair,
  Shield,
  Coffee,
  Zap,
  type LucideIcon,
} from "lucide-react";

interface BookingAncillariesDisplayProps {
  bookingId: number;
}

const categoryIcons: Record<string, LucideIcon> = {
  baggage: Package,
  meal: UtensilsCrossed,
  seat: Armchair,
  insurance: Shield,
  lounge: Coffee,
  priority_boarding: Zap,
};

export function BookingAncillariesDisplay({
  bookingId,
}: BookingAncillariesDisplayProps) {
  const { t, i18n } = useTranslation();
  const ar = i18n.language.startsWith("ar");
  const {
    data: ancillaries,
    isLoading,
    isError,
    refetch,
  } = trpc.ancillary.getBookingAncillaries.useQuery({ bookingId });

  if (isLoading) {
    return <Skeleton className="h-20 w-full" />;
  }

  if (isError)
    return (
      <p role="alert">
        {ar ? "تعذر تحميل الخدمات الإضافية" : "Extras could not be loaded"}{" "}
        <button type="button" onClick={() => void refetch()}>
          {ar ? "إعادة المحاولة" : "Retry"}
        </button>
      </p>
    );

  if (!ancillaries || ancillaries.length === 0) {
    return null;
  }

  const activeTotal = ancillaries
    .filter(item => item.status === "active")
    .reduce((sum, item) => sum + item.totalPrice, 0);

  return (
    <Card className="p-4 bg-blue-50 border-blue-200">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-blue-900">
          {t("bookingAncillaries.title")}
        </h4>
        <Badge variant="secondary" className="bg-blue-100 text-blue-900">
          {t("bookingAncillaries.serviceCount", { count: ancillaries.length })}
        </Badge>
      </div>

      <div className="space-y-2">
        {ancillaries.map(ancillary => {
          const category = ancillary.service?.category;
          const Icon = (category && categoryIcons[category]) || Package;
          return (
            <div
              key={ancillary.id}
              data-testid="booked-extra"
              className="flex items-center justify-between text-sm"
            >
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-blue-600" />
                <span className="text-gray-700">
                  {ancillary.service?.name ??
                    (ar ? "خدمة غير محددة" : "Unidentified service")}
                  {ancillary.quantity > 1 && (
                    <span className="text-muted-foreground">
                      {" "}
                      × {ancillary.quantity}
                    </span>
                  )}
                  {(category === "meal" || category === "baggage") && (
                    <small className="block">
                      {[
                        ancillary.passengerFirstName,
                        ancillary.passengerLastName,
                      ]
                        .filter(Boolean)
                        .join(" ") ||
                        (ar ? "الراكب غير محدد" : "Passenger not assigned")}
                      {" · "}
                      {ancillary.scopeState === "all_segments"
                        ? ar
                          ? "كل المقاطع"
                          : "All sectors"
                        : ancillary.scopeState === "specific_segment" &&
                            ancillary.segmentOrder != null
                          ? `${ar ? "المقطع" : "Sector"} ${ancillary.segmentOrder}${ancillary.flightNumber ? " · " + ancillary.flightNumber : ""}`
                          : ar
                            ? "المقطع غير محدد"
                            : "Sector not assigned"}
                    </small>
                  )}
                  {ancillary.status !== "active" && (
                    <small className="block font-semibold">
                      {ancillary.status === "refunded"
                        ? ar
                          ? "مستردة"
                          : "Refunded"
                        : ar
                          ? "ملغاة"
                          : "Cancelled"}
                    </small>
                  )}
                </span>
              </div>
              <span className="font-medium text-gray-900">
                {(ancillary.totalPrice / 100).toFixed(2)} {t("common.sar")}
              </span>
            </div>
          );
        })}

        <div className="flex items-center justify-between text-sm font-semibold pt-2 border-t border-blue-200">
          <span className="text-blue-900">
            {ar ? "إجمالي الخدمات النشطة" : "Active services total"}
          </span>
          <span className="text-blue-900">
            {(activeTotal / 100).toFixed(2)} {t("common.sar")}
          </span>
        </div>
      </div>
    </Card>
  );
}
