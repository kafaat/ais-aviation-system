/**
 * Metrics Router
 * Provides Prometheus-compatible metrics endpoint for monitoring
 */

import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import {
  getPrometheusMetrics,
  getMetricsJson,
  registry,
  httpRequestDuration,
  httpRequestsTotal,
  dbQueryDuration,
  dbQueriesTotal,
  trpcRequestDuration,
  trpcRequestsTotal,
  memoryUsageBytes,
  cpuUsagePercent,
  eventLoopLag,
  activeConnections,
  collectSystemMetrics,
} from "../services/apm.service";

/**
 * Metrics Router
 * Endpoints for Prometheus scraping and metrics inspection
 */
export const metricsRouter = router({
  /**
   * Prometheus metrics endpoint
   * Returns metrics in Prometheus text format
   *
   * NOTE: For production Prometheus scraping, use the Express endpoint
   * at /api/metrics which returns proper content-type
   */
  prometheus: publicProcedure.query(async () => {
    return getPrometheusMetrics();
  }),

  /**
   * JSON metrics endpoint
   * Returns system metrics in JSON format for debugging
   */
  json: publicProcedure.query(async () => {
    collectSystemMetrics();
    return getMetricsJson();
  }),

  /**
   * Summary of key metrics
   * Returns a high-level overview of system health
   */
  summary: publicProcedure.query(async () => {
    collectSystemMetrics();
    const memUsage = process.memoryUsage();
    const uptime = process.uptime();

    // Calculate request stats
    let totalRequests = 0;
    let errorRequests = 0;
    for (const [key, value] of httpRequestsTotal.values) {
      totalRequests += value;
      if (key.includes('status_code="5') || key.includes('status_code="4')) {
        errorRequests += value;
      }
    }

    // Calculate average response time
    let totalDuration = 0;
    let totalCount = 0;
    for (const data of httpRequestDuration.values.values()) {
      totalDuration += data.sum;
      totalCount += data.count;
    }
    const avgResponseTime = totalCount > 0 ? totalDuration / totalCount : 0;

    // Calculate DB stats
    let totalDbQueries = 0;
    let dbErrors = 0;
    for (const [key, value] of dbQueriesTotal.values) {
      totalDbQueries += value;
      if (key.includes('status="error"')) {
        dbErrors += value;
      }
    }

    return {
      timestamp: new Date().toISOString(),
      uptime: {
        seconds: uptime,
        formatted: formatUptime(uptime),
      },
      http: {
        totalRequests,
        errorRequests,
        errorRate:
          totalRequests > 0 ? (errorRequests / totalRequests) * 100 : 0,
        avgResponseTimeMs: avgResponseTime * 1000,
      },
      database: {
        totalQueries: totalDbQueries,
        errors: dbErrors,
        errorRate: totalDbQueries > 0 ? (dbErrors / totalDbQueries) * 100 : 0,
      },
      memory: {
        heapUsedMb: Math.round((memUsage.heapUsed / 1024 / 1024) * 100) / 100,
        heapTotalMb: Math.round((memUsage.heapTotal / 1024 / 1024) * 100) / 100,
        rssMb: Math.round((memUsage.rss / 1024 / 1024) * 100) / 100,
        heapUsagePercent:
          Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100 * 100) /
          100,
      },
      activeConnections: getGaugeValue(activeConnections, {}),
    };
  }),

  /**
   * Reset all metrics
   * WARNING: This clears all collected metrics data
   */
  reset: publicProcedure.mutation(async () => {
    registry.reset();
    return { success: true, message: "All metrics have been reset" };
  }),

  /**
   * Get metrics for a specific category
   */
  category: publicProcedure
    .input(
      z.object({
        category: z.enum(["http", "database", "trpc", "system", "business"]),
      })
    )
    .query(async ({ input }) => {
      collectSystemMetrics();

      switch (input.category) {
        case "http":
          return {
            category: "http",
            metrics: {
              requestDuration: getHistogramStats(httpRequestDuration),
              requestsTotal: getCounterStats(httpRequestsTotal),
            },
          };
        case "database":
          return {
            category: "database",
            metrics: {
              queryDuration: getHistogramStats(dbQueryDuration),
              queriesTotal: getCounterStats(dbQueriesTotal),
            },
          };
        case "trpc":
          return {
            category: "trpc",
            metrics: {
              requestDuration: getHistogramStats(trpcRequestDuration),
              requestsTotal: getCounterStats(trpcRequestsTotal),
            },
          };
        case "system":
          const memUsage = process.memoryUsage();
          return {
            category: "system",
            metrics: {
              memory: {
                heapUsed: memUsage.heapUsed,
                heapTotal: memUsage.heapTotal,
                rss: memUsage.rss,
                external: memUsage.external,
              },
              cpu: process.cpuUsage(),
              uptime: process.uptime(),
              eventLoopLag: getGaugeValue(eventLoopLag, {}),
            },
          };
        case "business":
          return {
            category: "business",
            metrics: {
              // Business metrics would be aggregated here
              note: "Business metrics are recorded via APM service functions",
            },
          };
      }
    }),
});

// Helper functions

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);

  return parts.join(" ");
}

function getHistogramStats(histogram: typeof httpRequestDuration) {
  const stats: Record<string, { sum: number; count: number; avg: number }> = {};
  for (const [key, data] of histogram.values) {
    stats[key || "default"] = {
      sum: data.sum,
      count: data.count,
      avg: data.count > 0 ? data.sum / data.count : 0,
    };
  }
  return stats;
}

function getCounterStats(counter: typeof httpRequestsTotal) {
  const stats: Record<string, number> = {};
  for (const [key, value] of counter.values) {
    stats[key || "default"] = value;
  }
  return stats;
}

function getGaugeValue(
  gauge: typeof activeConnections,
  labels: Record<string, string>
): number {
  const key = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`)
    .join(",");
  return gauge.values.get(key) || 0;
}
