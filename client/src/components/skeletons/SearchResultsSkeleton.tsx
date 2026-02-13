/**
 * SearchResultsSkeleton Component
 *
 * A full page loading skeleton for the SearchResults page
 * Includes header, filters, and flight cards
 */

import { Skeleton } from "@/components/ui/skeleton";
import { FlightCardSkeleton } from "./FlightCardSkeleton";

interface SearchResultsSkeletonProps {
  cardCount?: number;
}

export function SearchResultsSkeleton({
  cardCount = 3,
}: SearchResultsSkeletonProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 animate-in fade-in duration-500">
      {/* Header Skeleton */}
      <header className="bg-white/80 backdrop-blur-md border-b sticky top-0 z-50 shadow-sm">
        <div className="container py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-4 w-48" />
              </div>
            </div>
            <Skeleton className="h-8 w-32 rounded-full hidden md:block" />
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="container py-8">
        {/* Filters Skeleton */}
        <div className="bg-white/80 backdrop-blur-sm rounded-xl p-4 mb-6 shadow-sm">
          <div className="flex flex-wrap items-center gap-4">
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-10 w-40" />
            <Skeleton className="h-10 w-36" />
            <div className="flex-1" />
            <Skeleton className="h-10 w-28" />
          </div>
        </div>

        {/* Results Count Skeleton */}
        <div className="flex items-center justify-between mb-6">
          <Skeleton className="h-6 w-48" />
        </div>

        {/* Flight Cards Skeleton */}
        <div className="space-y-4">
          {Array.from({ length: cardCount }).map((_, index) => (
            <FlightCardSkeleton
              key={index}
              className="animate-in fade-in slide-in-from-bottom-4"
              style={
                {
                  animationDelay: `${index * 100}ms`,
                  animationFillMode: "backwards",
                } as React.CSSProperties
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export default SearchResultsSkeleton;
