/**
 * Lazy-loaded Heavy Components
 *
 * This module provides lazy-loaded versions of heavy/complex components
 * to improve initial bundle size and loading performance.
 *
 * Usage:
 * Instead of: import { SeatMap } from "@/components/SeatMap"
 * Use: import { LazySeatMap } from "@/components/lazy"
 */

import { lazy, Suspense, ComponentProps } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

// Lazy load heavy components
const SeatMapComponent = lazy(() =>
  import("@/components/SeatMap").then(mod => ({ default: mod.SeatMap }))
);
const FlightComparisonComponent = lazy(() =>
  import("@/components/FlightComparison").then(mod => ({
    default: mod.FlightComparison,
  }))
);
const PriceCalendarComponent = lazy(() => import("@/components/PriceCalendar"));
const AIChatBookingComponent = lazy(() => import("@/components/AIChatBooking"));

/**
 * Loading skeleton for SeatMap component
 */
function SeatMapSkeleton() {
  return (
    <Card className="p-6">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-48" />
      </div>

      {/* Legend skeleton */}
      <div className="flex gap-6 mb-6 flex-wrap">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <Skeleton className="w-8 h-8 rounded" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>

      {/* Seat grid skeleton */}
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, row) => (
          <div key={row} className="flex gap-2 justify-center">
            <Skeleton className="w-8 h-10" />
            {Array.from({ length: 3 }).map((_, col) => (
              <Skeleton key={col} className="w-10 h-10 rounded" />
            ))}
            <div className="w-12" />
            {Array.from({ length: 3 }).map((_, col) => (
              <Skeleton key={col + 3} className="w-10 h-10 rounded" />
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

/**
 * Loading skeleton for FlightComparison component
 */
function FlightComparisonSkeleton() {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-background border-t shadow-lg z-50 p-4">
      <div className="container">
        <div className="flex items-center justify-between mb-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-8 w-24" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-4" />
                  <Skeleton className="h-5 w-24" />
                </div>
                <Skeleton className="h-4 w-32" />
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <Skeleton className="h-10 w-16" />
                  <Skeleton className="h-6 w-12" />
                  <Skeleton className="h-10 w-16" />
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                  <div className="flex justify-between">
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                </div>
                <Skeleton className="h-10 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Loading skeleton for PriceCalendar component
 */
function PriceCalendarSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-5" />
            <Skeleton className="h-6 w-32" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-9 rounded-md" />
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-9 w-9 rounded-md" />
          </div>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-40" />
        </div>
      </CardHeader>
      <CardContent>
        {/* Day headers */}
        <div className="grid grid-cols-7 gap-1 mb-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
        {/* Calendar grid */}
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 35 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
        {/* Legend */}
        <div className="flex items-center justify-center gap-4 mt-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-1">
              <Skeleton className="w-3 h-3 rounded" />
              <Skeleton className="h-3 w-12" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Loading skeleton for AIChatBooking component (chat button only)
 */
function AIChatBookingSkeleton() {
  return (
    <div className="fixed bottom-6 right-6 z-50">
      <div className="rounded-full w-14 h-14 bg-primary/20 animate-pulse flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    </div>
  );
}

/**
 * Lazy-loaded SeatMap with loading skeleton
 */
export function LazySeatMap(props: ComponentProps<typeof SeatMapComponent>) {
  return (
    <Suspense fallback={<SeatMapSkeleton />}>
      <SeatMapComponent {...props} />
    </Suspense>
  );
}

/**
 * Lazy-loaded FlightComparison with loading skeleton
 */
export function LazyFlightComparison(
  props: ComponentProps<typeof FlightComparisonComponent>
) {
  return (
    <Suspense fallback={<FlightComparisonSkeleton />}>
      <FlightComparisonComponent {...props} />
    </Suspense>
  );
}

/**
 * Lazy-loaded PriceCalendar with loading skeleton
 */
export function LazyPriceCalendar(
  props: ComponentProps<typeof PriceCalendarComponent>
) {
  return (
    <Suspense fallback={<PriceCalendarSkeleton />}>
      <PriceCalendarComponent {...props} />
    </Suspense>
  );
}

/**
 * Lazy-loaded AIChatBooking with loading skeleton
 */
export function LazyAIChatBooking(
  props: ComponentProps<typeof AIChatBookingComponent>
) {
  return (
    <Suspense fallback={<AIChatBookingSkeleton />}>
      <AIChatBookingComponent {...props} />
    </Suspense>
  );
}

// Re-export skeleton components for custom usage
export {
  SeatMapSkeleton,
  FlightComparisonSkeleton,
  PriceCalendarSkeleton,
  AIChatBookingSkeleton,
};
