/**
 * FlightCardSkeleton Component
 *
 * A loading skeleton that matches the FlightCard layout
 * Displays placeholder UI while flight data is loading
 */

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface FlightCardSkeletonProps {
  className?: string;
  style?: React.CSSProperties;
}

export function FlightCardSkeleton({
  className,
  style,
}: FlightCardSkeletonProps) {
  return (
    <Card
      className={`p-6 border-0 bg-white/80 backdrop-blur-sm animate-in fade-in duration-300 ${className || ""}`}
      style={style}
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
        {/* Airline Info Skeleton */}
        <div className="lg:col-span-2">
          <div className="flex items-center gap-3">
            <Skeleton className="h-12 w-12 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          </div>
        </div>

        {/* Flight Details Skeleton */}
        <div className="lg:col-span-5">
          <div className="flex items-center justify-between">
            {/* Departure */}
            <div className="text-center space-y-2">
              <Skeleton className="h-8 w-16 mx-auto" />
              <Skeleton className="h-4 w-24" />
            </div>

            {/* Duration */}
            <div className="flex-1 px-4">
              <div className="relative">
                <div className="border-t-2 border-dashed border-gray-200"></div>
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white px-2">
                  <Skeleton className="h-6 w-16 rounded-full" />
                </div>
              </div>
              <div className="flex justify-center mt-2">
                <Skeleton className="h-4 w-20 rounded-full" />
              </div>
            </div>

            {/* Arrival */}
            <div className="text-center space-y-2">
              <Skeleton className="h-8 w-16 mx-auto" />
              <Skeleton className="h-4 w-24" />
            </div>
          </div>
        </div>

        {/* Actions Skeleton */}
        <div className="lg:col-span-1 flex lg:flex-col items-center justify-center gap-2">
          <Skeleton className="h-10 w-10 rounded-full" />
          <Skeleton className="h-10 w-10 rounded-full" />
        </div>

        {/* Pricing Skeleton */}
        <div className="lg:col-span-4">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Economy */}
            <div className="flex-1">
              <div className="text-center p-4 border-2 rounded-xl">
                <Skeleton className="h-3 w-16 mx-auto mb-2" />
                <Skeleton className="h-7 w-24 mx-auto mb-1" />
                <Skeleton className="h-3 w-20 mx-auto mb-3" />
                <Skeleton className="h-8 w-full rounded-md" />
              </div>
            </div>

            {/* Business */}
            <div className="flex-1">
              <div className="text-center p-4 border-2 rounded-xl bg-gradient-to-br from-amber-50/50 to-orange-50/50">
                <Skeleton className="h-3 w-16 mx-auto mb-2" />
                <Skeleton className="h-7 w-24 mx-auto mb-1" />
                <Skeleton className="h-3 w-20 mx-auto mb-3" />
                <Skeleton className="h-8 w-full rounded-md" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

export default FlightCardSkeleton;
