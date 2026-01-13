import { useEffect, useState } from "react";
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
} from "lucide-react";

interface BookingAncillariesDisplayProps {
  bookingId: number;
}

const categoryIcons: Record<string, any> = {
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
  const { data: ancillaries, isLoading } =
    trpc.ancillary.getBookingAncillaries.useQuery({ bookingId });

  if (isLoading) {
    return <Skeleton className="h-20 w-full" />;
  }

  if (!ancillaries || ancillaries.length === 0) {
    return null;
  }

  const totalCost = ancillaries.reduce((sum, a) => sum + a.totalPrice, 0);

  return (
    <Card className="p-4 bg-blue-50 border-blue-200">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-blue-900">
          الخدمات الإضافية
        </h4>
        <Badge variant="secondary" className="bg-blue-100 text-blue-900">
          {ancillaries.length} خدمة
        </Badge>
      </div>

      <div className="space-y-2">
        {ancillaries.map(ancillary => {
          if (!ancillary.service) return null;
          const Icon = categoryIcons[ancillary.service.category] || Package;
          return (
            <div
              key={ancillary.id}
              className="flex items-center justify-between text-sm"
            >
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-blue-600" />
                <span className="text-gray-700">
                  {ancillary.service.name}
                  {ancillary.quantity > 1 && (
                    <span className="text-muted-foreground">
                      {" "}
                      × {ancillary.quantity}
                    </span>
                  )}
                </span>
              </div>
              <span className="font-medium text-gray-900">
                {(ancillary.totalPrice / 100).toFixed(2)} ر.س
              </span>
            </div>
          );
        })}

        <div className="flex items-center justify-between text-sm font-semibold pt-2 border-t border-blue-200">
          <span className="text-blue-900">المجموع</span>
          <span className="text-blue-900">
            {(totalCost / 100).toFixed(2)} ر.س
          </span>
        </div>
      </div>
    </Card>
  );
}
