/**
 * Page Loading Fallback Component
 *
 * A visually appealing loading skeleton displayed while lazy-loaded pages are being fetched.
 * Features animated skeleton elements with a gradient background that matches the app style.
 */

import { Skeleton } from "./ui/skeleton";
import { cn } from "@/lib/utils";

interface PageLoadingFallbackProps {
  /** Additional CSS classes */
  className?: string;
  /** Variant for different page types */
  variant?: "default" | "dashboard" | "search" | "form";
}

export function PageLoadingFallback({
  className,
  variant = "default",
}: PageLoadingFallbackProps) {
  return (
    <div
      className={cn(
        "min-h-screen w-full",
        "bg-gradient-to-br from-blue-50 via-white to-indigo-50",
        "dark:from-slate-900 dark:via-slate-800 dark:to-slate-900",
        className
      )}
    >
      {/* Animated background overlay */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary/5 rounded-full blur-3xl animate-pulse" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-indigo-500/5 rounded-full blur-3xl animate-pulse delay-700" />
      </div>

      <div className="relative z-10">
        {/* Header Skeleton */}
        <header className="border-b border-border/40 bg-background/80 backdrop-blur-sm">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              {/* Logo */}
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-lg" />
                <Skeleton className="h-5 w-32 hidden sm:block" />
              </div>

              {/* Navigation */}
              <div className="hidden md:flex items-center gap-6">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-20" />
              </div>

              {/* User area */}
              <div className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded-full" />
                <Skeleton className="h-4 w-20 hidden sm:block" />
              </div>
            </div>
          </div>
        </header>

        {/* Content Skeleton - varies by variant */}
        <main className="container mx-auto px-4 py-8">
          {variant === "default" && <DefaultSkeleton />}
          {variant === "dashboard" && <DashboardSkeleton />}
          {variant === "search" && <SearchSkeleton />}
          {variant === "form" && <FormSkeleton />}
        </main>
      </div>
    </div>
  );
}

function DefaultSkeleton() {
  return (
    <div className="space-y-8 animate-in fade-in-0 duration-500">
      {/* Hero section */}
      <div className="text-center space-y-4 py-8">
        <Skeleton className="h-10 w-64 mx-auto" />
        <Skeleton className="h-5 w-96 max-w-full mx-auto" />
      </div>

      {/* Content cards */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm p-6 space-y-4"
            style={{ animationDelay: `${i * 100}ms` }}
          >
            <div className="flex items-center gap-4">
              <Skeleton className="h-12 w-12 rounded-lg" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
            <Skeleton className="h-20 w-full rounded-lg" />
            <div className="flex gap-2">
              <Skeleton className="h-8 w-20 rounded-md" />
              <Skeleton className="h-8 w-20 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-in fade-in-0 duration-500">
      {/* Page title */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-10 w-32 rounded-lg" />
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm p-6"
          >
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-8 rounded-lg" />
            </div>
            <Skeleton className="h-8 w-20 mt-4" />
            <Skeleton className="h-3 w-32 mt-2" />
          </div>
        ))}
      </div>

      {/* Chart area */}
      <div className="grid gap-6 lg:grid-cols-7">
        <div className="lg:col-span-4 rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm p-6">
          <Skeleton className="h-6 w-32 mb-6" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
        <div className="lg:col-span-3 rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm p-6">
          <Skeleton className="h-6 w-32 mb-6" />
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-6 w-16" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm p-6">
        <Skeleton className="h-6 w-40 mb-6" />
        <div className="space-y-3">
          <div className="flex gap-4 pb-3 border-b border-border/30">
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-4 w-1/4" />
          </div>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-4 py-3">
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-4 w-1/4" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SearchSkeleton() {
  return (
    <div className="space-y-6 animate-in fade-in-0 duration-500">
      {/* Search form */}
      <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm p-6">
        <div className="flex flex-wrap gap-4">
          <Skeleton className="h-12 flex-1 min-w-[200px] rounded-lg" />
          <Skeleton className="h-12 flex-1 min-w-[200px] rounded-lg" />
          <Skeleton className="h-12 w-40 rounded-lg" />
          <Skeleton className="h-12 w-32 rounded-lg" />
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-24 rounded-full" />
        ))}
      </div>

      {/* Results count */}
      <Skeleton className="h-5 w-48" />

      {/* Search results */}
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm p-6"
          >
            <div className="flex flex-col md:flex-row md:items-center gap-6">
              {/* Flight info */}
              <div className="flex items-center gap-6 flex-1">
                <Skeleton className="h-12 w-12 rounded-lg" />
                <div className="flex items-center gap-8 flex-1">
                  <div className="text-center space-y-1">
                    <Skeleton className="h-6 w-16 mx-auto" />
                    <Skeleton className="h-4 w-12 mx-auto" />
                  </div>
                  <div className="flex-1 flex items-center gap-2">
                    <div className="flex-1 h-px bg-border" />
                    <Skeleton className="h-6 w-6 rounded-full" />
                    <div className="flex-1 h-px bg-border" />
                  </div>
                  <div className="text-center space-y-1">
                    <Skeleton className="h-6 w-16 mx-auto" />
                    <Skeleton className="h-4 w-12 mx-auto" />
                  </div>
                </div>
              </div>

              {/* Price and action */}
              <div className="flex items-center justify-between md:flex-col md:items-end gap-4">
                <Skeleton className="h-8 w-24" />
                <Skeleton className="h-10 w-28 rounded-lg" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FormSkeleton() {
  return (
    <div className="max-w-2xl mx-auto animate-in fade-in-0 duration-500">
      <div className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm p-8 space-y-6">
        {/* Form title */}
        <div className="text-center space-y-2">
          <Skeleton className="h-8 w-48 mx-auto" />
          <Skeleton className="h-4 w-72 mx-auto" />
        </div>

        {/* Form fields */}
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-10 w-full rounded-lg" />
            </div>
          </div>

          <div className="space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>

          <div className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>

          <div className="flex gap-2 items-center">
            <Skeleton className="h-5 w-5 rounded" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>

        {/* Submit button */}
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    </div>
  );
}

export default PageLoadingFallback;
