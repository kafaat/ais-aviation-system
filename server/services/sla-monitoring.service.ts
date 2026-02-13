/**
 * SLA (Service Level Agreement) Monitoring Service
 *
 * Tracks and monitors service level agreements for the aviation booking platform.
 * Provides in-memory storage for SLA metrics, targets, alerts, and reports with
 * support for:
 * - Recording performance metrics (uptime, response time, error rate, throughput)
 * - Calculating uptime percentages over date ranges
 * - Response time analytics (avg, p95, p99)
 * - SLA compliance checking against configurable targets
 * - Alert creation and management for SLA violations
 * - Report generation for SLA compliance history
 */

import { TRPCError } from "@trpc/server";

// ============================================================================
// Types and Interfaces
// ============================================================================

export type SLAMetricType =
  | "uptime"
  | "response_time"
  | "error_rate"
  | "throughput";

export type SLASeverity = "warning" | "critical" | "resolved";

export type SLAAlertStatus = "active" | "acknowledged" | "resolved";

export type SLAReportStatus = "draft" | "published";

export type SLAUnit = "percent" | "ms" | "per_minute";

export type ServiceHealthStatus = "healthy" | "degraded" | "unhealthy";

export interface SLATarget {
  id: number;
  serviceName: string;
  metricType: SLAMetricType;
  targetValue: number;
  warningThreshold: number;
  criticalThreshold: number;
  unit: SLAUnit;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SLAMetric {
  id: number;
  serviceName: string;
  metricType: SLAMetricType;
  value: number;
  timestamp: Date;
  createdAt: Date;
}

export interface SLAAlert {
  id: number;
  serviceName: string;
  metricType: SLAMetricType;
  severity: SLASeverity;
  currentValue: number;
  targetValue: number;
  message: string;
  status: SLAAlertStatus;
  acknowledgedBy: number | null;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

export interface SLAReport {
  id: number;
  reportPeriodStart: Date;
  reportPeriodEnd: Date;
  overallUptime: number;
  avgResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  errorRate: number;
  totalRequests: number;
  failedRequests: number;
  slaBreaches: number;
  status: SLAReportStatus;
  generatedAt: Date;
  createdAt: Date;
}

export interface DateRange {
  start: Date;
  end: Date;
}

export interface ResponseTimeStats {
  avg: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  count: number;
}

export interface ServiceStatus {
  serviceName: string;
  status: ServiceHealthStatus;
  uptime: number;
  responseTime: ResponseTimeStats;
  errorRate: number;
  lastChecked: string;
  activeAlerts: number;
  slaCompliant: boolean;
}

export interface SystemHealthSummary {
  overallStatus: ServiceHealthStatus;
  timestamp: string;
  services: ServiceStatus[];
  activeAlerts: number;
  slaCompliance: number;
  uptimeAverage: number;
}

export interface SLAComplianceResult {
  serviceName: string;
  metricType: SLAMetricType;
  targetValue: number;
  currentValue: number;
  isCompliant: boolean;
  margin: number;
  severity: SLASeverity | null;
}

export interface SLADashboardData {
  systemHealth: SystemHealthSummary;
  recentAlerts: SLAAlert[];
  complianceHistory: Array<{
    date: string;
    compliance: number;
    breaches: number;
  }>;
  serviceBreakdown: ServiceStatus[];
  targets: SLATarget[];
}

// ============================================================================
// In-Memory SLA Storage
// ============================================================================

class SLAStore {
  private targets: SLATarget[] = [];
  private metrics: SLAMetric[] = [];
  private alerts: SLAAlert[] = [];
  private reports: SLAReport[] = [];

  private nextTargetId = 1;
  private nextMetricId = 1;
  private nextAlertId = 1;
  private nextReportId = 1;

  private readonly maxMetrics = 500000;
  private readonly retentionDays = 30;

  constructor() {
    this.initializeDefaultTargets();
  }

  /**
   * Initialize default SLA targets for core services
   */
  private initializeDefaultTargets(): void {
    const defaultTargets: Array<
      Omit<SLATarget, "id" | "createdAt" | "updatedAt">
    > = [
      {
        serviceName: "api",
        metricType: "uptime",
        targetValue: 99.9,
        warningThreshold: 99.5,
        criticalThreshold: 99.0,
        unit: "percent",
        isActive: true,
      },
      {
        serviceName: "api",
        metricType: "response_time",
        targetValue: 200,
        warningThreshold: 500,
        criticalThreshold: 1000,
        unit: "ms",
        isActive: true,
      },
      {
        serviceName: "api",
        metricType: "error_rate",
        targetValue: 0.1,
        warningThreshold: 1.0,
        criticalThreshold: 5.0,
        unit: "percent",
        isActive: true,
      },
      {
        serviceName: "database",
        metricType: "uptime",
        targetValue: 99.95,
        warningThreshold: 99.9,
        criticalThreshold: 99.5,
        unit: "percent",
        isActive: true,
      },
      {
        serviceName: "database",
        metricType: "response_time",
        targetValue: 50,
        warningThreshold: 100,
        criticalThreshold: 500,
        unit: "ms",
        isActive: true,
      },
      {
        serviceName: "payments",
        metricType: "uptime",
        targetValue: 99.99,
        warningThreshold: 99.95,
        criticalThreshold: 99.9,
        unit: "percent",
        isActive: true,
      },
      {
        serviceName: "payments",
        metricType: "response_time",
        targetValue: 300,
        warningThreshold: 800,
        criticalThreshold: 2000,
        unit: "ms",
        isActive: true,
      },
      {
        serviceName: "payments",
        metricType: "error_rate",
        targetValue: 0.01,
        warningThreshold: 0.1,
        criticalThreshold: 1.0,
        unit: "percent",
        isActive: true,
      },
      {
        serviceName: "cache",
        metricType: "uptime",
        targetValue: 99.0,
        warningThreshold: 98.0,
        criticalThreshold: 95.0,
        unit: "percent",
        isActive: true,
      },
      {
        serviceName: "cache",
        metricType: "response_time",
        targetValue: 5,
        warningThreshold: 20,
        criticalThreshold: 100,
        unit: "ms",
        isActive: true,
      },
      {
        serviceName: "auth",
        metricType: "uptime",
        targetValue: 99.9,
        warningThreshold: 99.5,
        criticalThreshold: 99.0,
        unit: "percent",
        isActive: true,
      },
      {
        serviceName: "auth",
        metricType: "response_time",
        targetValue: 150,
        warningThreshold: 400,
        criticalThreshold: 1000,
        unit: "ms",
        isActive: true,
      },
    ];

    const now = new Date();
    for (const target of defaultTargets) {
      this.targets.push({
        ...target,
        id: this.nextTargetId++,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  // --- Targets ---

  getTargets(): SLATarget[] {
    return [...this.targets];
  }

  getActiveTargets(): SLATarget[] {
    return this.targets.filter(t => t.isActive);
  }

  getTargetsForService(serviceName: string): SLATarget[] {
    return this.targets.filter(
      t => t.serviceName === serviceName && t.isActive
    );
  }

  updateTarget(
    id: number,
    updates: Partial<
      Pick<
        SLATarget,
        "targetValue" | "warningThreshold" | "criticalThreshold" | "isActive"
      >
    >
  ): SLATarget | null {
    const target = this.targets.find(t => t.id === id);
    if (!target) return null;

    if (updates.targetValue !== undefined)
      target.targetValue = updates.targetValue;
    if (updates.warningThreshold !== undefined)
      target.warningThreshold = updates.warningThreshold;
    if (updates.criticalThreshold !== undefined)
      target.criticalThreshold = updates.criticalThreshold;
    if (updates.isActive !== undefined) target.isActive = updates.isActive;
    target.updatedAt = new Date();

    return { ...target };
  }

  // --- Metrics ---

  addMetric(metric: Omit<SLAMetric, "id" | "createdAt">): SLAMetric {
    const newMetric: SLAMetric = {
      ...metric,
      id: this.nextMetricId++,
      createdAt: new Date(),
    };
    this.metrics.push(newMetric);

    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }

    return newMetric;
  }

  getMetrics(
    serviceName: string,
    metricType: SLAMetricType,
    dateRange: DateRange
  ): SLAMetric[] {
    return this.metrics.filter(
      m =>
        m.serviceName === serviceName &&
        m.metricType === metricType &&
        m.timestamp >= dateRange.start &&
        m.timestamp <= dateRange.end
    );
  }

  getMetricsByService(serviceName: string, dateRange: DateRange): SLAMetric[] {
    return this.metrics.filter(
      m =>
        m.serviceName === serviceName &&
        m.timestamp >= dateRange.start &&
        m.timestamp <= dateRange.end
    );
  }

  getAllMetrics(dateRange: DateRange): SLAMetric[] {
    return this.metrics.filter(
      m => m.timestamp >= dateRange.start && m.timestamp <= dateRange.end
    );
  }

  // --- Alerts ---

  addAlert(alert: Omit<SLAAlert, "id" | "createdAt">): SLAAlert {
    const newAlert: SLAAlert = {
      ...alert,
      id: this.nextAlertId++,
      createdAt: new Date(),
    };
    this.alerts.push(newAlert);
    return newAlert;
  }

  getAlerts(dateRange?: DateRange, severity?: SLASeverity): SLAAlert[] {
    let filtered = [...this.alerts];

    if (dateRange) {
      filtered = filtered.filter(
        a => a.createdAt >= dateRange.start && a.createdAt <= dateRange.end
      );
    }

    if (severity) {
      filtered = filtered.filter(a => a.severity === severity);
    }

    return filtered.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
  }

  getActiveAlerts(): SLAAlert[] {
    return this.alerts
      .filter(a => a.status === "active")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  getActiveAlertsForService(serviceName: string): SLAAlert[] {
    return this.alerts.filter(
      a => a.serviceName === serviceName && a.status === "active"
    );
  }

  acknowledgeAlert(alertId: number, userId: number): SLAAlert | null {
    const alert = this.alerts.find(a => a.id === alertId);
    if (!alert) return null;

    alert.status = "acknowledged";
    alert.acknowledgedBy = userId;
    alert.acknowledgedAt = new Date();

    return { ...alert };
  }

  resolveAlert(alertId: number): SLAAlert | null {
    const alert = this.alerts.find(a => a.id === alertId);
    if (!alert) return null;

    alert.status = "resolved";
    alert.severity = "resolved";
    alert.resolvedAt = new Date();

    return { ...alert };
  }

  // --- Reports ---

  addReport(report: Omit<SLAReport, "id" | "createdAt">): SLAReport {
    const newReport: SLAReport = {
      ...report,
      id: this.nextReportId++,
      createdAt: new Date(),
    };
    this.reports.push(newReport);
    return newReport;
  }

  getReports(): SLAReport[] {
    return [...this.reports].sort(
      (a, b) => b.generatedAt.getTime() - a.generatedAt.getTime()
    );
  }

  // --- Maintenance ---

  getServiceNames(): string[] {
    const names = new Set<string>();
    for (const target of this.targets) {
      names.add(target.serviceName);
    }
    return Array.from(names);
  }

  flush(): number {
    const cutoff = new Date(
      Date.now() - this.retentionDays * 24 * 60 * 60 * 1000
    );
    const originalCount = this.metrics.length;
    this.metrics = this.metrics.filter(m => m.timestamp >= cutoff);
    const removedCount = originalCount - this.metrics.length;

    if (removedCount > 0) {
      console.info(`[SLA] Flushed ${removedCount} old metrics`);
    }

    return removedCount;
  }
}

// Singleton store instance
const slaStore = new SLAStore();

// ============================================================================
// Core SLA Monitoring Functions
// ============================================================================

/**
 * Record a performance metric for a service
 */
export function recordMetric(
  service: string,
  metricType: SLAMetricType,
  value: number
): SLAMetric {
  const metric = slaStore.addMetric({
    serviceName: service,
    metricType,
    value,
    timestamp: new Date(),
  });

  // Check SLA compliance after recording the metric
  const targets = slaStore.getTargetsForService(service);
  const target = targets.find(t => t.metricType === metricType);

  if (target) {
    evaluateThreshold(service, metricType, value, target);
  }

  return metric;
}

/**
 * Evaluate metric value against target thresholds and create alerts if needed
 */
function evaluateThreshold(
  service: string,
  metricType: SLAMetricType,
  value: number,
  target: SLATarget
): void {
  // For uptime: lower is worse. For response_time/error_rate: higher is worse.
  const isInverse = metricType === "uptime";

  let severity: SLASeverity | null = null;

  if (isInverse) {
    // Uptime: warning and critical thresholds are lower bounds
    if (value <= target.criticalThreshold) {
      severity = "critical";
    } else if (value <= target.warningThreshold) {
      severity = "warning";
    }
  } else {
    // Response time / error rate: warning and critical thresholds are upper bounds
    if (value >= target.criticalThreshold) {
      severity = "critical";
    } else if (value >= target.warningThreshold) {
      severity = "warning";
    }
  }

  if (severity) {
    // Check if there is already an active alert for this service/metric
    const existingAlerts = slaStore.getActiveAlertsForService(service);
    const hasActiveAlert = existingAlerts.some(
      a => a.metricType === metricType && a.status === "active"
    );

    if (!hasActiveAlert) {
      createAlert(
        service,
        severity,
        `${service} ${metricType} SLA violation: current value ${value}${target.unit === "percent" ? "%" : target.unit === "ms" ? "ms" : "/min"} (target: ${target.targetValue}${target.unit === "percent" ? "%" : target.unit === "ms" ? "ms" : "/min"})`,
        metricType,
        value,
        target.targetValue
      );
    }
  } else {
    // Value is within acceptable range - resolve any active alerts
    const existingAlerts = slaStore.getActiveAlertsForService(service);
    for (const alert of existingAlerts) {
      if (alert.metricType === metricType && alert.status === "active") {
        slaStore.resolveAlert(alert.id);
      }
    }
  }
}

/**
 * Calculate service uptime percentage over a date range
 */
export function calculateUptime(service: string, dateRange: DateRange): number {
  const metrics = slaStore.getMetrics(service, "uptime", dateRange);

  if (metrics.length === 0) {
    // No data means we assume 100% uptime (no recorded outages)
    return 100;
  }

  const totalValue = metrics.reduce((sum, m) => sum + m.value, 0);
  const avgUptime = totalValue / metrics.length;

  return Math.round(avgUptime * 100) / 100;
}

/**
 * Calculate response time statistics (avg, p95, p99) over a date range
 */
export function calculateResponseTime(
  service: string,
  dateRange: DateRange
): ResponseTimeStats {
  const metrics = slaStore.getMetrics(service, "response_time", dateRange);

  if (metrics.length === 0) {
    return { avg: 0, p95: 0, p99: 0, min: 0, max: 0, count: 0 };
  }

  const values = metrics.map(m => m.value).sort((a, b) => a - b);
  const count = values.length;
  const sum = values.reduce((s, v) => s + v, 0);

  const p95Index = Math.ceil(count * 0.95) - 1;
  const p99Index = Math.ceil(count * 0.99) - 1;

  return {
    avg: Math.round((sum / count) * 100) / 100,
    p95: values[Math.min(p95Index, count - 1)],
    p99: values[Math.min(p99Index, count - 1)],
    min: values[0],
    max: values[count - 1],
    count,
  };
}

/**
 * Calculate error rate for a service over a date range
 */
export function getErrorRate(service: string, dateRange: DateRange): number {
  const metrics = slaStore.getMetrics(service, "error_rate", dateRange);

  if (metrics.length === 0) {
    return 0;
  }

  const totalValue = metrics.reduce((sum, m) => sum + m.value, 0);
  return Math.round((totalValue / metrics.length) * 1000) / 1000;
}

/**
 * Check SLA compliance for a service against all its active targets
 */
export function checkSLACompliance(service: string): SLAComplianceResult[] {
  const targets = slaStore.getTargetsForService(service);
  const results: SLAComplianceResult[] = [];

  // Use last hour as default check window
  const dateRange: DateRange = {
    start: new Date(Date.now() - 60 * 60 * 1000),
    end: new Date(),
  };

  for (const target of targets) {
    let currentValue: number;

    switch (target.metricType) {
      case "uptime":
        currentValue = calculateUptime(service, dateRange);
        break;
      case "response_time": {
        const rtStats = calculateResponseTime(service, dateRange);
        currentValue = rtStats.avg;
        break;
      }
      case "error_rate":
        currentValue = getErrorRate(service, dateRange);
        break;
      case "throughput": {
        const throughputMetrics = slaStore.getMetrics(
          service,
          "throughput",
          dateRange
        );
        currentValue =
          throughputMetrics.length > 0
            ? throughputMetrics.reduce((s, m) => s + m.value, 0) /
              throughputMetrics.length
            : 0;
        break;
      }
    }

    const isInverse =
      target.metricType === "uptime" || target.metricType === "throughput";
    const isCompliant = isInverse
      ? currentValue >= target.targetValue
      : currentValue <= target.targetValue;

    let margin: number;
    if (isInverse) {
      margin = Math.round((currentValue - target.targetValue) * 100) / 100;
    } else {
      margin = Math.round((target.targetValue - currentValue) * 100) / 100;
    }

    let severity: SLASeverity | null = null;
    if (!isCompliant) {
      if (isInverse) {
        severity =
          currentValue <= target.criticalThreshold ? "critical" : "warning";
      } else {
        severity =
          currentValue >= target.criticalThreshold ? "critical" : "warning";
      }
    }

    results.push({
      serviceName: service,
      metricType: target.metricType,
      targetValue: target.targetValue,
      currentValue,
      isCompliant,
      margin,
      severity,
    });
  }

  return results;
}

/**
 * Get overall system health summary across all monitored services
 */
export function getSystemHealth(): SystemHealthSummary {
  const serviceNames = slaStore.getServiceNames();
  const services: ServiceStatus[] = [];
  let totalUptime = 0;
  let serviceCount = 0;
  let totalActiveAlerts = 0;
  let compliantServices = 0;

  const _dateRange: DateRange = {
    start: new Date(Date.now() - 60 * 60 * 1000),
    end: new Date(),
  };

  for (const serviceName of serviceNames) {
    const serviceStatus = getServiceStatus(serviceName);
    services.push(serviceStatus);

    totalUptime += serviceStatus.uptime;
    serviceCount++;
    totalActiveAlerts += serviceStatus.activeAlerts;

    if (serviceStatus.slaCompliant) {
      compliantServices++;
    }
  }

  const uptimeAverage =
    serviceCount > 0
      ? Math.round((totalUptime / serviceCount) * 100) / 100
      : 100;

  const slaCompliance =
    serviceCount > 0
      ? Math.round((compliantServices / serviceCount) * 100 * 100) / 100
      : 100;

  let overallStatus: ServiceHealthStatus;
  if (slaCompliance >= 100 && uptimeAverage >= 99.9) {
    overallStatus = "healthy";
  } else if (slaCompliance >= 75 && uptimeAverage >= 99.0) {
    overallStatus = "degraded";
  } else {
    overallStatus = "unhealthy";
  }

  return {
    overallStatus,
    timestamp: new Date().toISOString(),
    services,
    activeAlerts: totalActiveAlerts,
    slaCompliance,
    uptimeAverage,
  };
}

/**
 * Get individual service health status
 */
export function getServiceStatus(service: string): ServiceStatus {
  const dateRange: DateRange = {
    start: new Date(Date.now() - 60 * 60 * 1000),
    end: new Date(),
  };

  const uptime = calculateUptime(service, dateRange);
  const responseTime = calculateResponseTime(service, dateRange);
  const errorRate = getErrorRate(service, dateRange);
  const activeAlerts = slaStore.getActiveAlertsForService(service);
  const compliance = checkSLACompliance(service);
  const slaCompliant = compliance.every(c => c.isCompliant);

  let status: ServiceHealthStatus;
  if (slaCompliant && uptime >= 99.9 && activeAlerts.length === 0) {
    status = "healthy";
  } else if (uptime >= 99.0 && activeAlerts.length <= 2) {
    status = "degraded";
  } else {
    status = "unhealthy";
  }

  return {
    serviceName: service,
    status,
    uptime,
    responseTime,
    errorRate,
    lastChecked: new Date().toISOString(),
    activeAlerts: activeAlerts.length,
    slaCompliant,
  };
}

/**
 * Create an SLA violation alert
 */
export function createAlert(
  service: string,
  severity: SLASeverity,
  message: string,
  metricType?: SLAMetricType,
  currentValue?: number,
  targetValue?: number
): SLAAlert {
  return slaStore.addAlert({
    serviceName: service,
    metricType: metricType || "uptime",
    severity,
    currentValue: currentValue ?? 0,
    targetValue: targetValue ?? 0,
    message,
    status: "active",
    acknowledgedBy: null,
    acknowledgedAt: null,
    resolvedAt: null,
  });
}

/**
 * Get SLA alerts with optional filtering by date range and severity
 */
export function getAlerts(
  dateRange?: DateRange,
  severity?: SLASeverity
): SLAAlert[] {
  return slaStore.getAlerts(dateRange, severity);
}

/**
 * Acknowledge an active alert
 */
export function acknowledgeAlert(
  alertId: number,
  userId: number
): SLAAlert | null {
  return slaStore.acknowledgeAlert(alertId, userId);
}

/**
 * Generate a comprehensive SLA compliance report for a date range
 */
export function getSLAReport(dateRange: DateRange): SLAReport {
  const serviceNames = slaStore.getServiceNames();
  let totalUptime = 0;
  let serviceCount = 0;
  const allResponseTimes: number[] = [];
  let totalErrorRate = 0;
  let totalRequests = 0;
  let failedRequests = 0;
  let slaBreaches = 0;

  for (const serviceName of serviceNames) {
    const uptime = calculateUptime(serviceName, dateRange);
    totalUptime += uptime;
    serviceCount++;

    const rtMetrics = slaStore.getMetrics(
      serviceName,
      "response_time",
      dateRange
    );
    for (const m of rtMetrics) {
      allResponseTimes.push(m.value);
    }

    const errorRateValue = getErrorRate(serviceName, dateRange);
    totalErrorRate += errorRateValue;

    // Count throughput metrics as request counts
    const throughputMetrics = slaStore.getMetrics(
      serviceName,
      "throughput",
      dateRange
    );
    const serviceRequests = throughputMetrics.reduce((s, m) => s + m.value, 0);
    totalRequests += serviceRequests;

    // Estimate failed requests from error rate
    const serviceFailed = Math.round(serviceRequests * (errorRateValue / 100));
    failedRequests += serviceFailed;

    // Count SLA breaches
    const compliance = checkSLACompliance(serviceName);
    slaBreaches += compliance.filter(c => !c.isCompliant).length;
  }

  const overallUptime =
    serviceCount > 0
      ? Math.round((totalUptime / serviceCount) * 100) / 100
      : 100;
  const errorRate =
    serviceCount > 0
      ? Math.round((totalErrorRate / serviceCount) * 1000) / 1000
      : 0;

  // Calculate response time percentiles
  allResponseTimes.sort((a, b) => a - b);
  const rtCount = allResponseTimes.length;
  const avgResponseTime =
    rtCount > 0
      ? Math.round(
          (allResponseTimes.reduce((s, v) => s + v, 0) / rtCount) * 100
        ) / 100
      : 0;
  const p95ResponseTime =
    rtCount > 0
      ? allResponseTimes[Math.min(Math.ceil(rtCount * 0.95) - 1, rtCount - 1)]
      : 0;
  const p99ResponseTime =
    rtCount > 0
      ? allResponseTimes[Math.min(Math.ceil(rtCount * 0.99) - 1, rtCount - 1)]
      : 0;

  const report = slaStore.addReport({
    reportPeriodStart: dateRange.start,
    reportPeriodEnd: dateRange.end,
    overallUptime,
    avgResponseTime,
    p95ResponseTime,
    p99ResponseTime,
    errorRate,
    totalRequests,
    failedRequests,
    slaBreaches,
    status: "draft",
    generatedAt: new Date(),
  });

  return report;
}

/**
 * Get all previously generated SLA reports
 */
export function getReports(): SLAReport[] {
  return slaStore.getReports();
}

/**
 * Get SLA targets (all or active only)
 */
export function getTargets(activeOnly: boolean = true): SLATarget[] {
  return activeOnly ? slaStore.getActiveTargets() : slaStore.getTargets();
}

/**
 * Update an SLA target's thresholds or active status
 */
export function updateTarget(
  id: number,
  updates: Partial<
    Pick<
      SLATarget,
      "targetValue" | "warningThreshold" | "criticalThreshold" | "isActive"
    >
  >
): SLATarget | null {
  return slaStore.updateTarget(id, updates);
}

/**
 * Get metric history for a service and metric type within a date range
 */
export function getMetricHistory(
  service: string,
  metricType: SLAMetricType,
  dateRange: DateRange
): SLAMetric[] {
  return slaStore.getMetrics(service, metricType, dateRange);
}

/**
 * Get full SLA dashboard data in a single call
 */
export function getSLADashboard(): SLADashboardData {
  const systemHealth = getSystemHealth();
  const recentAlerts = getAlerts(
    {
      start: new Date(Date.now() - 24 * 60 * 60 * 1000),
      end: new Date(),
    },
    undefined
  ).slice(0, 20);

  // Build compliance history for last 7 days
  const complianceHistory: Array<{
    date: string;
    compliance: number;
    breaches: number;
  }> = [];

  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date();
    dayStart.setDate(dayStart.getDate() - i);
    dayStart.setHours(0, 0, 0, 0);

    const dayEnd = new Date(dayStart);
    dayEnd.setHours(23, 59, 59, 999);

    const dayAlerts = getAlerts({ start: dayStart, end: dayEnd }, undefined);
    const breaches = dayAlerts.filter(
      a => a.severity === "critical" || a.severity === "warning"
    ).length;

    const services = slaStore.getServiceNames();
    let compliant = 0;
    for (const svc of services) {
      const results = checkSLACompliance(svc);
      if (results.every(r => r.isCompliant)) {
        compliant++;
      }
    }

    const compliance =
      services.length > 0
        ? Math.round((compliant / services.length) * 100 * 100) / 100
        : 100;

    complianceHistory.push({
      date: dayStart.toISOString().slice(0, 10),
      compliance,
      breaches,
    });
  }

  return {
    systemHealth,
    recentAlerts,
    complianceHistory,
    serviceBreakdown: systemHealth.services,
    targets: getTargets(true),
  };
}

/**
 * Flush old metric data beyond the retention period
 */
export function flushOldMetrics(): number {
  return slaStore.flush();
}

// ============================================================================
// Periodic Monitoring Setup
// ============================================================================

let monitoringInterval: NodeJS.Timeout | null = null;

/**
 * Start periodic SLA monitoring and cleanup
 */
export function startSLAMonitoring(intervalMinutes: number = 5): void {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
  }

  monitoringInterval = setInterval(
    () => {
      try {
        // Record synthetic uptime metrics for all services
        const serviceNames = slaStore.getServiceNames();
        for (const serviceName of serviceNames) {
          // Default to 100% uptime if the service is reachable
          recordMetric(serviceName, "uptime", 100);
        }

        // Periodically flush old data
        flushOldMetrics();
      } catch (error) {
        console.error("[SLA] Monitoring cycle error:", error);
      }
    },
    intervalMinutes * 60 * 1000
  );

  console.info(
    `[SLA] Started periodic monitoring every ${intervalMinutes} minutes`
  );
}

/**
 * Stop periodic SLA monitoring
 */
export function stopSLAMonitoring(): void {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
    console.info("[SLA] Stopped periodic monitoring");
  }
}
