/**
 * Application Performance Monitoring (APM) Service
 * Provides Prometheus-compatible metrics for monitoring system performance
 */

import { Request, Response, NextFunction } from "express";

// ============ Metric Types ============

interface HistogramBucket {
  le: number;
  count: number;
}

interface Histogram {
  name: string;
  help: string;
  labels: string[];
  buckets: number[];
  values: Map<string, { sum: number; count: number; buckets: HistogramBucket[] }>;
}

interface Counter {
  name: string;
  help: string;
  labels: string[];
  values: Map<string, number>;
}

interface Gauge {
  name: string;
  help: string;
  labels: string[];
  values: Map<string, number>;
}

interface Summary {
  name: string;
  help: string;
  labels: string[];
  values: Map<string, { sum: number; count: number; observations: number[] }>;
  maxAge: number;
}

// ============ Default Histogram Buckets ============

const DEFAULT_HTTP_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const DEFAULT_DB_BUCKETS = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5];
const DEFAULT_EXTERNAL_API_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];

// ============ Metrics Registry ============

class MetricsRegistry {
  private histograms: Map<string, Histogram> = new Map();
  private counters: Map<string, Counter> = new Map();
  private gauges: Map<string, Gauge> = new Map();
  private summaries: Map<string, Summary> = new Map();

  // Create a histogram metric
  createHistogram(
    name: string,
    help: string,
    labels: string[] = [],
    buckets: number[] = DEFAULT_HTTP_BUCKETS
  ): Histogram {
    const histogram: Histogram = {
      name,
      help,
      labels,
      buckets: [...buckets].sort((a, b) => a - b),
      values: new Map(),
    };
    this.histograms.set(name, histogram);
    return histogram;
  }

  // Create a counter metric
  createCounter(name: string, help: string, labels: string[] = []): Counter {
    const counter: Counter = {
      name,
      help,
      labels,
      values: new Map(),
    };
    this.counters.set(name, counter);
    return counter;
  }

  // Create a gauge metric
  createGauge(name: string, help: string, labels: string[] = []): Gauge {
    const gauge: Gauge = {
      name,
      help,
      labels,
      values: new Map(),
    };
    this.gauges.set(name, gauge);
    return gauge;
  }

  // Create a summary metric
  createSummary(
    name: string,
    help: string,
    labels: string[] = [],
    maxAge: number = 600000
  ): Summary {
    const summary: Summary = {
      name,
      help,
      labels,
      values: new Map(),
      maxAge,
    };
    this.summaries.set(name, summary);
    return summary;
  }

  // Observe a histogram value
  observeHistogram(histogram: Histogram, value: number, labelValues: Record<string, string> = {}): void {
    const key = this.getLabelKey(labelValues);
    let data = histogram.values.get(key);

    if (!data) {
      data = {
        sum: 0,
        count: 0,
        buckets: histogram.buckets.map(le => ({ le, count: 0 })),
      };
      histogram.values.set(key, data);
    }

    data.sum += value;
    data.count++;

    for (const bucket of data.buckets) {
      if (value <= bucket.le) {
        bucket.count++;
      }
    }
  }

  // Increment a counter
  incrementCounter(counter: Counter, value: number = 1, labelValues: Record<string, string> = {}): void {
    const key = this.getLabelKey(labelValues);
    const current = counter.values.get(key) || 0;
    counter.values.set(key, current + value);
  }

  // Set a gauge value
  setGauge(gauge: Gauge, value: number, labelValues: Record<string, string> = {}): void {
    const key = this.getLabelKey(labelValues);
    gauge.values.set(key, value);
  }

  // Increment a gauge
  incrementGauge(gauge: Gauge, value: number = 1, labelValues: Record<string, string> = {}): void {
    const key = this.getLabelKey(labelValues);
    const current = gauge.values.get(key) || 0;
    gauge.values.set(key, current + value);
  }

  // Decrement a gauge
  decrementGauge(gauge: Gauge, value: number = 1, labelValues: Record<string, string> = {}): void {
    const key = this.getLabelKey(labelValues);
    const current = gauge.values.get(key) || 0;
    gauge.values.set(key, current - value);
  }

  // Observe a summary value
  observeSummary(summary: Summary, value: number, labelValues: Record<string, string> = {}): void {
    const key = this.getLabelKey(labelValues);
    let data = summary.values.get(key);

    if (!data) {
      data = { sum: 0, count: 0, observations: [] };
      summary.values.set(key, data);
    }

    data.sum += value;
    data.count++;
    data.observations.push(value);

    // Keep observations array bounded
    if (data.observations.length > 1000) {
      data.observations = data.observations.slice(-1000);
    }
  }

  // Generate Prometheus-format metrics output
  getMetrics(): string {
    const lines: string[] = [];

    // Output histograms
    for (const histogram of this.histograms.values()) {
      lines.push(`# HELP ${histogram.name} ${histogram.help}`);
      lines.push(`# TYPE ${histogram.name} histogram`);

      for (const [key, data] of histogram.values) {
        const labels = this.parseLabels(key);
        const labelStr = this.formatLabels(labels);

        for (const bucket of data.buckets) {
          const bucketLabels = { ...labels, le: String(bucket.le) };
          lines.push(`${histogram.name}_bucket{${this.formatLabels(bucketLabels)}} ${bucket.count}`);
        }

        // +Inf bucket
        const infLabels = { ...labels, le: "+Inf" };
        lines.push(`${histogram.name}_bucket{${this.formatLabels(infLabels)}} ${data.count}`);
        lines.push(`${histogram.name}_sum{${labelStr}} ${data.sum}`);
        lines.push(`${histogram.name}_count{${labelStr}} ${data.count}`);
      }
    }

    // Output counters
    for (const counter of this.counters.values()) {
      lines.push(`# HELP ${counter.name} ${counter.help}`);
      lines.push(`# TYPE ${counter.name} counter`);

      for (const [key, value] of counter.values) {
        const labels = this.parseLabels(key);
        const labelStr = this.formatLabels(labels);
        lines.push(`${counter.name}${labelStr ? `{${labelStr}}` : ""} ${value}`);
      }
    }

    // Output gauges
    for (const gauge of this.gauges.values()) {
      lines.push(`# HELP ${gauge.name} ${gauge.help}`);
      lines.push(`# TYPE ${gauge.name} gauge`);

      for (const [key, value] of gauge.values) {
        const labels = this.parseLabels(key);
        const labelStr = this.formatLabels(labels);
        lines.push(`${gauge.name}${labelStr ? `{${labelStr}}` : ""} ${value}`);
      }
    }

    // Output summaries
    for (const summary of this.summaries.values()) {
      lines.push(`# HELP ${summary.name} ${summary.help}`);
      lines.push(`# TYPE ${summary.name} summary`);

      for (const [key, data] of summary.values) {
        const labels = this.parseLabels(key);
        const labelStr = this.formatLabels(labels);

        // Calculate quantiles
        if (data.observations.length > 0) {
          const sorted = [...data.observations].sort((a, b) => a - b);
          const quantiles = [0.5, 0.9, 0.95, 0.99];

          for (const q of quantiles) {
            const idx = Math.ceil(q * sorted.length) - 1;
            const quantileLabels = { ...labels, quantile: String(q) };
            lines.push(`${summary.name}{${this.formatLabels(quantileLabels)}} ${sorted[Math.max(0, idx)]}`);
          }
        }

        lines.push(`${summary.name}_sum{${labelStr}} ${data.sum}`);
        lines.push(`${summary.name}_count{${labelStr}} ${data.count}`);
      }
    }

    return lines.join("\n");
  }

  private getLabelKey(labels: Record<string, string>): string {
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(",");
  }

  private parseLabels(key: string): Record<string, string> {
    if (!key) return {};
    const labels: Record<string, string> = {};
    const matches = key.matchAll(/(\w+)="([^"]*)"/g);
    for (const match of matches) {
      labels[match[1]] = match[2];
    }
    return labels;
  }

  private formatLabels(labels: Record<string, string>): string {
    return Object.entries(labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(",");
  }

  // Reset all metrics (useful for testing)
  reset(): void {
    for (const histogram of this.histograms.values()) {
      histogram.values.clear();
    }
    for (const counter of this.counters.values()) {
      counter.values.clear();
    }
    for (const gauge of this.gauges.values()) {
      gauge.values.clear();
    }
    for (const summary of this.summaries.values()) {
      summary.values.clear();
    }
  }
}

// ============ Global Registry Instance ============

export const registry = new MetricsRegistry();

// ============ Pre-defined Metrics ============

// HTTP Request Metrics
export const httpRequestDuration = registry.createHistogram(
  "http_request_duration_seconds",
  "HTTP request duration in seconds",
  ["method", "route", "status_code"],
  DEFAULT_HTTP_BUCKETS
);

export const httpRequestsTotal = registry.createCounter(
  "http_requests_total",
  "Total number of HTTP requests",
  ["method", "route", "status_code"]
);

export const httpRequestsInProgress = registry.createGauge(
  "http_requests_in_progress",
  "Number of HTTP requests currently being processed",
  ["method"]
);

// Database Metrics
export const dbQueryDuration = registry.createHistogram(
  "db_query_duration_seconds",
  "Database query duration in seconds",
  ["operation", "table"],
  DEFAULT_DB_BUCKETS
);

export const dbQueriesTotal = registry.createCounter(
  "db_queries_total",
  "Total number of database queries",
  ["operation", "table", "status"]
);

export const dbConnectionsActive = registry.createGauge(
  "db_connections_active",
  "Number of active database connections"
);

export const dbConnectionPoolSize = registry.createGauge(
  "db_connection_pool_size",
  "Size of the database connection pool"
);

// External API Metrics
export const externalApiDuration = registry.createHistogram(
  "external_api_duration_seconds",
  "External API call duration in seconds",
  ["service", "endpoint", "method"],
  DEFAULT_EXTERNAL_API_BUCKETS
);

export const externalApiRequestsTotal = registry.createCounter(
  "external_api_requests_total",
  "Total number of external API requests",
  ["service", "endpoint", "method", "status"]
);

// tRPC Metrics
export const trpcRequestDuration = registry.createHistogram(
  "trpc_request_duration_seconds",
  "tRPC request duration in seconds",
  ["procedure", "type"],
  DEFAULT_HTTP_BUCKETS
);

export const trpcRequestsTotal = registry.createCounter(
  "trpc_requests_total",
  "Total number of tRPC requests",
  ["procedure", "type", "status"]
);

// Application Metrics
export const activeConnections = registry.createGauge(
  "app_active_connections",
  "Number of active connections"
);

export const memoryUsageBytes = registry.createGauge(
  "app_memory_usage_bytes",
  "Memory usage in bytes",
  ["type"]
);

export const cpuUsagePercent = registry.createGauge(
  "app_cpu_usage_percent",
  "CPU usage percentage"
);

export const eventLoopLag = registry.createGauge(
  "app_event_loop_lag_seconds",
  "Event loop lag in seconds"
);

// Business Metrics
export const bookingsTotal = registry.createCounter(
  "business_bookings_total",
  "Total number of bookings created",
  ["status", "cabin_class"]
);

export const paymentsTotal = registry.createCounter(
  "business_payments_total",
  "Total number of payments processed",
  ["status", "provider"]
);

export const paymentAmountTotal = registry.createCounter(
  "business_payment_amount_total",
  "Total amount of payments processed",
  ["currency"]
);

// ============ Timer Utilities ============

export interface Timer {
  end: () => number;
}

/**
 * Start a timer and return a function to end it
 */
export function startTimer(): Timer {
  const start = process.hrtime.bigint();
  return {
    end: () => {
      const end = process.hrtime.bigint();
      return Number(end - start) / 1e9; // Convert to seconds
    },
  };
}

// ============ Database Query Timing ============

/**
 * Wrap a database operation with timing
 */
export async function timeDbQuery<T>(
  operation: string,
  table: string,
  queryFn: () => Promise<T>
): Promise<T> {
  const timer = startTimer();
  let status = "success";

  try {
    const result = await queryFn();
    return result;
  } catch (error) {
    status = "error";
    throw error;
  } finally {
    const duration = timer.end();
    registry.observeHistogram(dbQueryDuration, duration, { operation, table });
    registry.incrementCounter(dbQueriesTotal, 1, { operation, table, status });
  }
}

// ============ External API Call Timing ============

/**
 * Wrap an external API call with timing
 */
export async function timeExternalApi<T>(
  service: string,
  endpoint: string,
  method: string,
  apiFn: () => Promise<T>
): Promise<T> {
  const timer = startTimer();
  let status = "success";

  try {
    const result = await apiFn();
    return result;
  } catch (error) {
    status = "error";
    throw error;
  } finally {
    const duration = timer.end();
    registry.observeHistogram(externalApiDuration, duration, { service, endpoint, method });
    registry.incrementCounter(externalApiRequestsTotal, 1, { service, endpoint, method, status });
  }
}

// ============ Custom Metric Recording ============

/**
 * Record a custom counter metric
 */
export function recordCounter(
  name: string,
  value: number = 1,
  labels: Record<string, string> = {}
): void {
  let counter = registry["counters"].get(name);
  if (!counter) {
    counter = registry.createCounter(name, `Custom counter: ${name}`, Object.keys(labels));
  }
  registry.incrementCounter(counter, value, labels);
}

/**
 * Record a custom gauge metric
 */
export function recordGauge(
  name: string,
  value: number,
  labels: Record<string, string> = {}
): void {
  let gauge = registry["gauges"].get(name);
  if (!gauge) {
    gauge = registry.createGauge(name, `Custom gauge: ${name}`, Object.keys(labels));
  }
  registry.setGauge(gauge, value, labels);
}

/**
 * Record a custom histogram observation
 */
export function recordHistogram(
  name: string,
  value: number,
  labels: Record<string, string> = {},
  buckets: number[] = DEFAULT_HTTP_BUCKETS
): void {
  let histogram = registry["histograms"].get(name);
  if (!histogram) {
    histogram = registry.createHistogram(name, `Custom histogram: ${name}`, Object.keys(labels), buckets);
  }
  registry.observeHistogram(histogram, value, labels);
}

// ============ System Metrics Collection ============

let lastCpuUsage = process.cpuUsage();
let lastCpuTime = Date.now();

/**
 * Collect system metrics (memory, CPU, event loop lag)
 */
export function collectSystemMetrics(): void {
  // Memory metrics
  const memUsage = process.memoryUsage();
  registry.setGauge(memoryUsageBytes, memUsage.heapUsed, { type: "heap_used" });
  registry.setGauge(memoryUsageBytes, memUsage.heapTotal, { type: "heap_total" });
  registry.setGauge(memoryUsageBytes, memUsage.rss, { type: "rss" });
  registry.setGauge(memoryUsageBytes, memUsage.external, { type: "external" });

  if (memUsage.arrayBuffers !== undefined) {
    registry.setGauge(memoryUsageBytes, memUsage.arrayBuffers, { type: "array_buffers" });
  }

  // CPU metrics
  const currentCpuUsage = process.cpuUsage(lastCpuUsage);
  const currentTime = Date.now();
  const elapsedMs = currentTime - lastCpuTime;

  if (elapsedMs > 0) {
    const cpuPercent = ((currentCpuUsage.user + currentCpuUsage.system) / 1000) / elapsedMs * 100;
    registry.setGauge(cpuUsagePercent, Math.min(cpuPercent, 100));
  }

  lastCpuUsage = process.cpuUsage();
  lastCpuTime = currentTime;

  // Event loop lag
  const start = process.hrtime.bigint();
  setImmediate(() => {
    const lag = Number(process.hrtime.bigint() - start) / 1e9;
    registry.setGauge(eventLoopLag, lag);
  });
}

// Start collecting system metrics every 15 seconds
let systemMetricsInterval: NodeJS.Timeout | null = null;

export function startSystemMetricsCollection(intervalMs: number = 15000): void {
  if (systemMetricsInterval) {
    clearInterval(systemMetricsInterval);
  }
  collectSystemMetrics(); // Collect immediately
  systemMetricsInterval = setInterval(collectSystemMetrics, intervalMs);
}

export function stopSystemMetricsCollection(): void {
  if (systemMetricsInterval) {
    clearInterval(systemMetricsInterval);
    systemMetricsInterval = null;
  }
}

// ============ Express Request Middleware ============

declare global {
  namespace Express {
    interface Request {
      apmStartTime?: bigint;
    }
  }
}

/**
 * Express middleware to track request timing
 * Adds X-Response-Time header and records metrics
 */
export function apmRequestMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Record start time
  req.apmStartTime = process.hrtime.bigint();

  // Increment in-progress gauge
  registry.incrementGauge(httpRequestsInProgress, 1, { method: req.method });
  registry.incrementGauge(activeConnections, 1);

  // Override res.end to capture timing
  const originalEnd = res.end.bind(res);

  res.end = function(this: Response, ...args: Parameters<Response["end"]>): Response {
    // Calculate duration
    const duration = req.apmStartTime
      ? Number(process.hrtime.bigint() - req.apmStartTime) / 1e9
      : 0;

    // Set X-Response-Time header
    if (!res.headersSent) {
      res.setHeader("X-Response-Time", `${(duration * 1000).toFixed(3)}ms`);
    }

    // Get normalized route path
    const route = normalizeRoute(req);
    const statusCode = String(res.statusCode);

    // Record metrics
    registry.observeHistogram(httpRequestDuration, duration, {
      method: req.method,
      route,
      status_code: statusCode,
    });

    registry.incrementCounter(httpRequestsTotal, 1, {
      method: req.method,
      route,
      status_code: statusCode,
    });

    // Decrement in-progress gauge
    registry.decrementGauge(httpRequestsInProgress, 1, { method: req.method });
    registry.decrementGauge(activeConnections, 1);

    // Call original end
    return originalEnd(...args);
  } as Response["end"];

  next();
}

/**
 * Normalize request route for metrics labels
 * Replaces dynamic segments (IDs, UUIDs) with placeholders
 */
function normalizeRoute(req: Request): string {
  // Use Express route if available
  if (req.route?.path) {
    return req.baseUrl + req.route.path;
  }

  let path = req.path || req.url.split("?")[0];

  // Replace common dynamic segments
  path = path
    // Replace numeric IDs
    .replace(/\/\d+/g, "/:id")
    // Replace UUIDs
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:uuid")
    // Replace common ID patterns
    .replace(/\/[A-Z0-9]{6,}/g, "/:ref");

  return path;
}

// ============ tRPC Middleware for Timing ============

/**
 * Record tRPC procedure timing
 */
export function recordTrpcTiming(
  procedure: string,
  type: "query" | "mutation" | "subscription",
  duration: number,
  success: boolean
): void {
  registry.observeHistogram(trpcRequestDuration, duration, { procedure, type });
  registry.incrementCounter(trpcRequestsTotal, 1, {
    procedure,
    type,
    status: success ? "success" : "error",
  });
}

// ============ Business Metrics Helpers ============

/**
 * Record a new booking
 */
export function recordBooking(status: string, cabinClass: string): void {
  registry.incrementCounter(bookingsTotal, 1, { status, cabin_class: cabinClass });
}

/**
 * Record a payment
 */
export function recordPayment(status: string, provider: string, amount: number, currency: string): void {
  registry.incrementCounter(paymentsTotal, 1, { status, provider });
  registry.incrementCounter(paymentAmountTotal, amount, { currency });
}

// ============ Metrics Output ============

/**
 * Get all metrics in Prometheus format
 */
export function getPrometheusMetrics(): string {
  // Collect system metrics before outputting
  collectSystemMetrics();
  return registry.getMetrics();
}

/**
 * Get metrics as JSON (for debugging/custom dashboards)
 */
export function getMetricsJson(): Record<string, unknown> {
  return {
    timestamp: new Date().toISOString(),
    system: {
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      uptime: process.uptime(),
    },
    http: {
      requestsInProgress: httpRequestsInProgress.values.size,
    },
  };
}

// ============ Export Registry for Testing ============

export { MetricsRegistry };
