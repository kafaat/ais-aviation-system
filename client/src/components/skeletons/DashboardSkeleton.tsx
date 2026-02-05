/**
 * DashboardSkeleton Component
 *
 * A loading skeleton for dashboard pages like LoyaltyDashboard
 * Includes header, stats cards, charts, and transaction tables
 */

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface DashboardSkeletonProps {
  className?: string;
}

export function DashboardSkeleton({ className }: DashboardSkeletonProps) {
  return (
    <div
      className={`min-h-screen bg-gradient-to-br from-gray-50 via-blue-50 to-purple-50 animate-in fade-in duration-500 ${className || ""}`}
    >
      {/* Header Skeleton */}
      <header className="bg-white/80 backdrop-blur-sm border-b sticky top-0 z-50">
        <div className="container py-6">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
        </div>
      </header>

      <div className="container py-8 space-y-6">
        {/* Stats Cards Skeleton */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map(i => (
            <Card key={i} className="animate-in fade-in slide-in-from-bottom-4">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-8 w-20" />
                  </div>
                  <Skeleton className="h-12 w-12 rounded-full" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Progress Card Skeleton */}
        <Card className="animate-in fade-in slide-in-from-bottom-4">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="space-y-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-64" />
              </div>
              <Skeleton className="h-8 w-24 rounded-full" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex justify-between">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-24" />
              </div>
              <Skeleton className="h-4 w-full rounded-full" />
              <div className="flex justify-between">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Main Grid */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left Column - Charts and History */}
          <div className="lg:col-span-2 space-y-6">
            {/* Chart Card */}
            <Card className="animate-in fade-in slide-in-from-bottom-4">
              <CardHeader>
                <div className="space-y-2">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-24" />
                </div>
              </CardHeader>
              <CardContent>
                <Skeleton className="h-64 w-full rounded-lg" />
              </CardContent>
            </Card>

            {/* Transaction History Card */}
            <Card className="animate-in fade-in slide-in-from-bottom-4">
              <CardHeader>
                <div className="space-y-2">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-4 w-56" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {[1, 2, 3, 4, 5].map(i => (
                    <div key={i} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Skeleton className="h-8 w-8 rounded-full" />
                        <div className="space-y-1">
                          <Skeleton className="h-4 w-24" />
                          <Skeleton className="h-3 w-16" />
                        </div>
                      </div>
                      <div className="text-right space-y-1">
                        <Skeleton className="h-4 w-16 ml-auto" />
                        <Skeleton className="h-3 w-12 ml-auto" />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Column */}
          <div className="space-y-6">
            {/* Action Card */}
            <Card className="animate-in fade-in slide-in-from-bottom-4">
              <Skeleton className="h-2 w-full" />
              <CardHeader>
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-48" />
              </CardHeader>
              <CardContent className="space-y-4">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-3 w-full" />
              </CardContent>
            </Card>

            {/* Info Card */}
            <Card className="animate-in fade-in slide-in-from-bottom-4">
              <CardHeader>
                <Skeleton className="h-5 w-32" />
              </CardHeader>
              <CardContent className="space-y-4">
                {[1, 2, 3].map(i => (
                  <div key={i} className="flex gap-3 p-3">
                    <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-full" />
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DashboardSkeleton;
