/**
 * Web Vitals Tracking Module
 *
 * Tracks Core Web Vitals and other performance metrics for the AIS Aviation System.
 * Provides performance monitoring, budget warnings, and analytics integration.
 *
 * Metrics tracked:
 * - LCP (Largest Contentful Paint) - Loading performance
 * - FID (First Input Delay) - Interactivity (deprecated, replaced by INP)
 * - INP (Interaction to Next Paint) - Interactivity
 * - CLS (Cumulative Layout Shift) - Visual stability
 * - TTFB (Time to First Byte) - Server responsiveness
 * - FCP (First Contentful Paint) - Initial render speed
 */

import type { Metric } from "web-vitals";

// Environment detection
const isDevelopment = import.meta.env.MODE === "development";
const analyticsEndpoint = import.meta.env.VITE_ANALYTICS_ENDPOINT || "/api/analytics/vitals";

/**
 * Performance budgets based on Google's recommendations
 * Values are in milliseconds (except CLS which is unitless)
 *
 * @see https://web.dev/vitals/
 */
export const PERFORMANCE_BUDGETS = {
  // Largest Contentful Paint
  LCP: {
    good: 2500, // Good: <= 2.5s
    needsImprovement: 4000, // Needs Improvement: <= 4s
    poor: 4000, // Poor: > 4s
  },
  // First Input Delay (legacy)
  FID: {
    good: 100, // Good: <= 100ms
    needsImprovement: 300, // Needs Improvement: <= 300ms
    poor: 300, // Poor: > 300ms
  },
  // Interaction to Next Paint
  INP: {
    good: 200, // Good: <= 200ms
    needsImprovement: 500, // Needs Improvement: <= 500ms
    poor: 500, // Poor: > 500ms
  },
  // Cumulative Layout Shift (unitless)
  CLS: {
    good: 0.1, // Good: <= 0.1
    needsImprovement: 0.25, // Needs Improvement: <= 0.25
    poor: 0.25, // Poor: > 0.25
  },
  // Time to First Byte
  TTFB: {
    good: 800, // Good: <= 800ms
    needsImprovement: 1800, // Needs Improvement: <= 1800ms
    poor: 1800, // Poor: > 1800ms
  },
  // First Contentful Paint
  FCP: {
    good: 1800, // Good: <= 1.8s
    needsImprovement: 3000, // Needs Improvement: <= 3s
    poor: 3000, // Poor: > 3s
  },
} as const;

/**
 * Rating for performance metrics
 */
export type PerformanceRating = "good" | "needs-improvement" | "poor";

/**
 * Extended metric with additional metadata
 */
export interface WebVitalMetric extends Metric {
  rating: PerformanceRating;
  budgetExceeded: boolean;
  budgetDelta?: number;
}

/**
 * Callback type for metric reporting
 */
export type MetricCallback = (metric: WebVitalMetric) => void;

/**
 * Configuration options for Web Vitals tracking
 */
export interface WebVitalsConfig {
  /** Send metrics to analytics endpoint */
  enableAnalytics?: boolean;
  /** Log metrics to console in development */
  enableConsoleLogging?: boolean;
  /** Show budget warnings in console */
  enableBudgetWarnings?: boolean;
  /** Custom analytics endpoint URL */
  analyticsEndpoint?: string;
  /** Custom callback for all metrics */
  onMetric?: MetricCallback;
  /** Batch metrics before sending to reduce requests */
  batchMetrics?: boolean;
  /** Batch interval in milliseconds */
  batchInterval?: number;
}

const defaultConfig: Required<WebVitalsConfig> = {
  enableAnalytics: !isDevelopment,
  enableConsoleLogging: isDevelopment,
  enableBudgetWarnings: true,
  analyticsEndpoint,
  onMetric: () => {},
  batchMetrics: true,
  batchInterval: 5000,
};

// Metric buffer for batching
let metricBuffer: WebVitalMetric[] = [];
let batchTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Get the rating for a metric value based on performance budgets
 */
export function getRating(name: string, value: number): PerformanceRating {
  const budget = PERFORMANCE_BUDGETS[name as keyof typeof PERFORMANCE_BUDGETS];
  if (!budget) return "good";

  if (value <= budget.good) return "good";
  if (value <= budget.needsImprovement) return "needs-improvement";
  return "poor";
}

/**
 * Check if a metric exceeds its performance budget
 */
export function exceedsBudget(name: string, value: number): boolean {
  const budget = PERFORMANCE_BUDGETS[name as keyof typeof PERFORMANCE_BUDGETS];
  if (!budget) return false;
  return value > budget.good;
}

/**
 * Calculate the delta from the budget threshold
 */
export function getBudgetDelta(name: string, value: number): number | undefined {
  const budget = PERFORMANCE_BUDGETS[name as keyof typeof PERFORMANCE_BUDGETS];
  if (!budget) return undefined;
  return value - budget.good;
}

/**
 * Format metric value for display
 */
function formatMetricValue(name: string, value: number): string {
  if (name === "CLS") {
    return value.toFixed(3);
  }
  return `${Math.round(value)}ms`;
}

/**
 * Get console styling based on rating
 */
function getConsoleStyle(rating: PerformanceRating): string {
  switch (rating) {
    case "good":
      return "color: #0cce6b; font-weight: bold";
    case "needs-improvement":
      return "color: #ffa400; font-weight: bold";
    case "poor":
      return "color: #ff4e42; font-weight: bold";
  }
}

/**
 * Log metric to console with styling
 */
function logMetricToConsole(metric: WebVitalMetric): void {
  const style = getConsoleStyle(metric.rating);
  const value = formatMetricValue(metric.name, metric.value);

  console.info(
    `%c[Web Vitals] ${metric.name}: ${value} (${metric.rating})`,
    style,
    {
      id: metric.id,
      delta: metric.delta,
      entries: metric.entries,
      navigationType: metric.navigationType,
    }
  );
}

/**
 * Log budget warning to console
 */
function logBudgetWarning(metric: WebVitalMetric): void {
  if (!metric.budgetExceeded || metric.budgetDelta === undefined) return;

  const budget = PERFORMANCE_BUDGETS[metric.name as keyof typeof PERFORMANCE_BUDGETS];
  if (!budget) return;

  const deltaFormatted =
    metric.name === "CLS"
      ? metric.budgetDelta.toFixed(3)
      : `${Math.round(metric.budgetDelta)}ms`;

  console.warn(
    `%c[Performance Budget Exceeded] ${metric.name} exceeded budget by ${deltaFormatted}`,
    "color: #ff4e42; font-weight: bold",
    {
      actual: formatMetricValue(metric.name, metric.value),
      budget: formatMetricValue(metric.name, budget.good),
      exceedBy: deltaFormatted,
      recommendation: getMetricRecommendation(metric.name),
    }
  );
}

/**
 * Get recommendation for improving a metric
 */
function getMetricRecommendation(name: string): string {
  switch (name) {
    case "LCP":
      return "Optimize images, use CDN, preload critical resources, reduce server response time";
    case "FID":
    case "INP":
      return "Break up long tasks, optimize JavaScript execution, use web workers for heavy computations";
    case "CLS":
      return "Set explicit dimensions for images/videos, avoid inserting content above existing content, use CSS transforms for animations";
    case "TTFB":
      return "Optimize server-side code, use caching, implement CDN, reduce redirect chains";
    case "FCP":
      return "Eliminate render-blocking resources, minify CSS, defer non-critical CSS, preconnect to required origins";
    default:
      return "Review performance best practices";
  }
}

/**
 * Send metrics to analytics endpoint
 */
async function sendToAnalytics(
  metrics: WebVitalMetric[],
  endpoint: string
): Promise<void> {
  if (metrics.length === 0) return;

  const payload = {
    timestamp: Date.now(),
    url: window.location.href,
    userAgent: navigator.userAgent,
    connection: getConnectionInfo(),
    deviceMemory: getDeviceMemory(),
    metrics: metrics.map((m) => ({
      name: m.name,
      value: m.value,
      delta: m.delta,
      id: m.id,
      rating: m.rating,
      budgetExceeded: m.budgetExceeded,
      navigationType: m.navigationType,
    })),
  };

  try {
    // Use sendBeacon if available for reliable delivery on page unload
    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(payload)], {
        type: "application/json",
      });
      navigator.sendBeacon(endpoint, blob);
    } else {
      // Fallback to fetch
      await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        keepalive: true,
      });
    }

    if (isDevelopment) {
      console.info("[Web Vitals] Metrics sent to analytics", payload);
    }
  } catch (error) {
    console.error("[Web Vitals] Failed to send metrics to analytics:", error);
  }
}

/**
 * Get connection information if available
 */
function getConnectionInfo(): Record<string, unknown> | undefined {
  const nav = navigator as Navigator & {
    connection?: {
      effectiveType?: string;
      rtt?: number;
      downlink?: number;
      saveData?: boolean;
    };
  };

  if (nav.connection) {
    return {
      effectiveType: nav.connection.effectiveType,
      rtt: nav.connection.rtt,
      downlink: nav.connection.downlink,
      saveData: nav.connection.saveData,
    };
  }

  return undefined;
}

/**
 * Get device memory if available
 */
function getDeviceMemory(): number | undefined {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return nav.deviceMemory;
}

/**
 * Flush batched metrics
 */
function flushMetricBuffer(endpoint: string): void {
  if (metricBuffer.length > 0) {
    sendToAnalytics([...metricBuffer], endpoint);
    metricBuffer = [];
  }

  if (batchTimeout) {
    clearTimeout(batchTimeout);
    batchTimeout = null;
  }
}

/**
 * Process a Web Vital metric
 */
function processMetric(
  metric: Metric,
  config: Required<WebVitalsConfig>
): void {
  const rating = getRating(metric.name, metric.value);
  const budgetExceeded = exceedsBudget(metric.name, metric.value);
  const budgetDelta = getBudgetDelta(metric.name, metric.value);

  const enhancedMetric: WebVitalMetric = {
    ...metric,
    rating,
    budgetExceeded,
    budgetDelta,
  };

  // Console logging
  if (config.enableConsoleLogging) {
    logMetricToConsole(enhancedMetric);
  }

  // Budget warnings
  if (config.enableBudgetWarnings && budgetExceeded) {
    logBudgetWarning(enhancedMetric);
  }

  // Custom callback
  config.onMetric(enhancedMetric);

  // Analytics
  if (config.enableAnalytics) {
    if (config.batchMetrics) {
      metricBuffer.push(enhancedMetric);

      // Set up batch timeout if not already running
      if (!batchTimeout) {
        batchTimeout = setTimeout(() => {
          flushMetricBuffer(config.analyticsEndpoint);
        }, config.batchInterval);
      }
    } else {
      sendToAnalytics([enhancedMetric], config.analyticsEndpoint);
    }
  }
}

/**
 * Initialize Web Vitals tracking
 *
 * @param options - Configuration options
 *
 * @example
 * // Basic initialization
 * initWebVitals();
 *
 * @example
 * // With custom options
 * initWebVitals({
 *   enableAnalytics: true,
 *   enableConsoleLogging: true,
 *   onMetric: (metric) => {
 *     myAnalytics.track('web_vital', metric);
 *   }
 * });
 */
export async function initWebVitals(
  options: WebVitalsConfig = {}
): Promise<void> {
  const config: Required<WebVitalsConfig> = {
    ...defaultConfig,
    ...options,
  };

  try {
    // Dynamic import for code splitting
    const webVitals = await import("web-vitals");

    // Track all Core Web Vitals
    webVitals.onLCP((metric) => processMetric(metric, config));
    webVitals.onINP((metric) => processMetric(metric, config));
    webVitals.onCLS((metric) => processMetric(metric, config));
    webVitals.onTTFB((metric) => processMetric(metric, config));
    webVitals.onFCP((metric) => processMetric(metric, config));

    // Flush metrics on page unload
    if (typeof window !== "undefined") {
      window.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden" && config.enableAnalytics) {
          flushMetricBuffer(config.analyticsEndpoint);
        }
      });

      // Also handle pagehide for Safari
      window.addEventListener("pagehide", () => {
        if (config.enableAnalytics) {
          flushMetricBuffer(config.analyticsEndpoint);
        }
      });
    }

    console.info(
      "[Web Vitals] Initialized",
      isDevelopment ? "(development mode)" : ""
    );
  } catch (error) {
    console.error("[Web Vitals] Failed to initialize:", error);
  }
}

/**
 * Get performance summary for current session
 * Returns latest values for all tracked metrics
 */
export function getPerformanceSummary(): {
  metrics: Record<string, WebVitalMetric | undefined>;
  overallRating: PerformanceRating;
  budgetViolations: string[];
} {
  const latestMetrics: Record<string, WebVitalMetric | undefined> = {};
  const budgetViolations: string[] = [];

  // Get latest values from buffer
  for (const metric of metricBuffer) {
    latestMetrics[metric.name] = metric;
    if (metric.budgetExceeded) {
      budgetViolations.push(metric.name);
    }
  }

  // Calculate overall rating
  let overallRating: PerformanceRating = "good";
  for (const metric of Object.values(latestMetrics)) {
    if (metric?.rating === "poor") {
      overallRating = "poor";
      break;
    }
    if (metric?.rating === "needs-improvement") {
      overallRating = "needs-improvement";
    }
  }

  return {
    metrics: latestMetrics,
    overallRating,
    budgetViolations,
  };
}

/**
 * Custom hook-friendly function to track a specific user interaction
 */
export function trackInteraction(
  interactionName: string,
  startTime: number
): void {
  const duration = performance.now() - startTime;

  if (isDevelopment) {
    console.info(`[Web Vitals] Interaction "${interactionName}": ${Math.round(duration)}ms`);
  }

  // Check against INP budget for custom interactions
  const rating = getRating("INP", duration);
  if (rating === "poor") {
    console.warn(
      `[Web Vitals] Slow interaction detected: "${interactionName}" took ${Math.round(duration)}ms`
    );
  }
}

/**
 * Utility to mark performance entries for custom tracking
 */
export function markPerformance(markName: string): void {
  if (typeof performance !== "undefined" && performance.mark) {
    performance.mark(markName);
  }
}

/**
 * Measure between two marks
 */
export function measurePerformance(
  measureName: string,
  startMark: string,
  endMark?: string
): PerformanceMeasure | undefined {
  if (typeof performance !== "undefined" && performance.measure) {
    try {
      return performance.measure(measureName, startMark, endMark);
    } catch {
      // Marks may not exist
      return undefined;
    }
  }
  return undefined;
}

// Export utility types
export type { Metric } from "web-vitals";
