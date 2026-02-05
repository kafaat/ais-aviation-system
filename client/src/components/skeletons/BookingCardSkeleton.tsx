/**
 * BookingCardSkeleton Component
 *
 * A loading skeleton that matches the booking card layout in MyBookings
 * Displays placeholder UI while booking data is loading
 */

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface BookingCardSkeletonProps {
  className?: string;
}

export function BookingCardSkeleton({ className }: BookingCardSkeletonProps) {
  return (
    <Card
      className={`overflow-hidden border-0 shadow-md bg-white dark:bg-slate-900 animate-in fade-in duration-300 ${className || ""}`}
    >
      {/* Status gradient bar */}
      <Skeleton className="h-1 w-full" />

      <div className="p-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Booking Info */}
          <div className="lg:col-span-8">
            {/* Header with badges */}
            <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  <Skeleton className="h-6 w-24" />
                  <Skeleton className="h-6 w-20 rounded-full" />
                  <Skeleton className="h-6 w-20 rounded-full" />
                  <Skeleton className="h-6 w-16 rounded-full" />
                </div>
                <div className="flex items-center gap-3">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-24" />
                </div>
              </div>
            </div>

            {/* Flight route and details */}
            <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-slate-800/50 dark:to-slate-800/30 rounded-xl p-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* From */}
                <div className="flex items-center gap-3">
                  <Skeleton className="w-10 h-10 rounded-xl" />
                  <div className="space-y-1">
                    <Skeleton className="h-3 w-12" />
                    <Skeleton className="h-5 w-24" />
                  </div>
                </div>

                {/* To */}
                <div className="flex items-center gap-3">
                  <Skeleton className="w-10 h-10 rounded-xl" />
                  <div className="space-y-1">
                    <Skeleton className="h-3 w-12" />
                    <Skeleton className="h-5 w-24" />
                  </div>
                </div>

                {/* Date */}
                <div className="flex items-center gap-3">
                  <Skeleton className="w-10 h-10 rounded-xl" />
                  <div className="space-y-1">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-5 w-32" />
                  </div>
                </div>

                {/* Passengers */}
                <div className="flex items-center gap-3">
                  <Skeleton className="w-10 h-10 rounded-xl" />
                  <div className="space-y-1">
                    <Skeleton className="h-3 w-16" />
                    <Skeleton className="h-5 w-20" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="lg:col-span-4 flex flex-col justify-between">
            {/* Price */}
            <div className="text-center lg:text-right mb-4 p-4 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 rounded-xl">
              <Skeleton className="h-3 w-20 mx-auto lg:ml-auto lg:mr-0 mb-2" />
              <Skeleton className="h-8 w-32 mx-auto lg:ml-auto lg:mr-0" />
            </div>

            {/* Action buttons */}
            <div className="flex flex-col gap-2">
              <Skeleton className="h-10 w-full rounded-xl" />
              <div className="flex gap-2">
                <Skeleton className="h-10 flex-1 rounded-xl" />
                <Skeleton className="h-10 flex-1 rounded-xl" />
              </div>
              <Skeleton className="h-10 w-full rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

export default BookingCardSkeleton;
