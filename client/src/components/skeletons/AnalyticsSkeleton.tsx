/**
 * AnalyticsSkeleton Component
 *
 * A loading skeleton for the Analytics Dashboard page
 * Includes KPI cards, charts, and data tables
 */

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface AnalyticsSkeletonProps {
  className?: string;
}

export function AnalyticsSkeleton({ className }: AnalyticsSkeletonProps) {
  return (
    <div
      className={`container py-8 animate-in fade-in duration-500 ${className || ""}`}
    >
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-10 w-32" />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5 mb-8">
        {[1, 2, 3, 4, 5].map(i => (
          <Card
            key={i}
            className="animate-in fade-in slide-in-from-bottom-4"
            style={
              {
                animationDelay: `${i * 50}ms`,
                animationFillMode: "backwards",
              } as React.CSSProperties
            }
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-4" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-20 mb-1" />
              <Skeleton className="h-3 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts Row 1 */}
      <div className="grid gap-4 md:grid-cols-2 mb-8">
        {/* Revenue Chart */}
        <Card className="animate-in fade-in slide-in-from-bottom-4">
          <CardHeader>
            <Skeleton className="h-5 w-32 mb-1" />
            <Skeleton className="h-4 w-24" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[300px] w-full rounded-lg" />
          </CardContent>
        </Card>

        {/* Booking Trends Chart */}
        <Card className="animate-in fade-in slide-in-from-bottom-4">
          <CardHeader>
            <Skeleton className="h-5 w-32 mb-1" />
            <Skeleton className="h-4 w-24" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[300px] w-full rounded-lg" />
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2 */}
      <div className="grid gap-4 md:grid-cols-2 mb-8">
        {/* Popular Destinations - Pie Chart */}
        <Card className="animate-in fade-in slide-in-from-bottom-4">
          <CardHeader>
            <Skeleton className="h-5 w-40 mb-1" />
            <Skeleton className="h-4 w-24" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-center h-[300px]">
              <Skeleton className="h-40 w-40 rounded-full" />
            </div>
          </CardContent>
        </Card>

        {/* Flight Occupancy Table */}
        <Card className="animate-in fade-in slide-in-from-bottom-4">
          <CardHeader>
            <Skeleton className="h-5 w-36 mb-1" />
            <Skeleton className="h-4 w-24" />
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {/* Table Header */}
              <div className="flex gap-4 pb-2 border-b">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-20" />
              </div>
              {/* Table Rows */}
              {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
                <div key={i} className="flex gap-4 py-2 border-b">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default AnalyticsSkeleton;
