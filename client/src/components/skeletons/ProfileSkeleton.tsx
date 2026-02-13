/**
 * ProfileSkeleton Component
 *
 * A loading skeleton for the Profile page
 * Includes header with avatar, tabs, and form fields
 */

import { Skeleton } from "@/components/ui/skeleton";

interface ProfileSkeletonProps {
  className?: string;
}

export function ProfileSkeleton({ className }: ProfileSkeletonProps) {
  return (
    <div
      className={`min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 animate-in fade-in duration-500 ${className || ""}`}
    >
      {/* Header Skeleton */}
      <header className="bg-gradient-to-r from-primary/90 to-primary shadow-lg">
        <div className="container py-8">
          <div className="flex items-center gap-6">
            <Skeleton className="h-24 w-24 rounded-full bg-white/20" />
            <div className="space-y-2">
              <Skeleton className="h-8 w-48 bg-white/20" />
              <Skeleton className="h-4 w-64 bg-white/20" />
              <Skeleton className="h-4 w-32 bg-white/20" />
            </div>
          </div>
        </div>
      </header>

      {/* Content Skeleton */}
      <div className="container py-8 -mt-4">
        {/* Tabs Skeleton */}
        <div className="bg-white/80 backdrop-blur-sm shadow-md rounded-xl p-1.5 mb-6">
          <div className="grid grid-cols-3 gap-2">
            <Skeleton className="h-12 rounded-lg" />
            <Skeleton className="h-12 rounded-lg" />
            <Skeleton className="h-12 rounded-lg" />
          </div>
        </div>

        {/* Card Content Skeleton */}
        <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-xl overflow-hidden animate-in fade-in slide-in-from-bottom-4">
          {/* Card Header */}
          <div className="bg-gradient-to-r from-primary/5 to-primary/10 border-b p-6">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-lg" />
              <div className="space-y-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-4 w-64" />
              </div>
            </div>
          </div>

          {/* Card Body */}
          <div className="p-6 space-y-6">
            {/* Form Fields */}
            {[1, 2, 3].map(i => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-10 w-full rounded-md" />
              </div>
            ))}

            {/* Special Services Section */}
            <div className="space-y-4 pt-4 border-t">
              <Skeleton className="h-5 w-40" />
              <div className="space-y-3">
                {[1, 2].map(i => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-10 w-10 rounded-lg" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                    <Skeleton className="h-6 w-11 rounded-full" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Save Button Skeleton */}
        <div className="flex justify-end mt-6">
          <Skeleton className="h-12 w-32 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export default ProfileSkeleton;
