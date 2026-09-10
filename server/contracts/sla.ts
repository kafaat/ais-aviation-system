// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  getSystemHealth: z.object({
    overallStatus: z.enum(["unknown", "healthy", "unhealthy", "degraded"]),
    timestamp: z.string(),
    services: z.array(
      z.object({
        serviceName: z.string(),
        status: z.enum(["unknown", "healthy", "unhealthy", "degraded"]),
        uptime: z.union([z.null(), outputNumber]),
        responseTime: z.object({
          avg: outputNumber,
          p95: outputNumber,
          p99: outputNumber,
          min: outputNumber,
          max: outputNumber,
          count: outputNumber,
        }),
        errorRate: outputNumber,
        lastChecked: z.union([z.null(), z.string()]),
        observationScope: z.literal("process"),
        activeAlerts: outputNumber,
        slaCompliant: z.boolean(),
      })
    ),
    activeAlerts: outputNumber,
    slaCompliance: z.union([z.null(), outputNumber]),
    uptimeAverage: z.union([z.null(), outputNumber]),
  }),
  getServiceStatus: z.object({
    serviceName: z.string(),
    status: z.enum(["unknown", "healthy", "unhealthy", "degraded"]),
    uptime: z.union([z.null(), outputNumber]),
    responseTime: z.object({
      avg: outputNumber,
      p95: outputNumber,
      p99: outputNumber,
      min: outputNumber,
      max: outputNumber,
      count: outputNumber,
    }),
    errorRate: outputNumber,
    lastChecked: z.union([z.null(), z.string()]),
    observationScope: z.literal("process"),
    activeAlerts: outputNumber,
    slaCompliant: z.boolean(),
  }),
  getSLADashboard: z.object({
    systemHealth: z.object({
      overallStatus: z.enum(["unknown", "healthy", "unhealthy", "degraded"]),
      timestamp: z.string(),
      services: z.array(
        z.object({
          serviceName: z.string(),
          status: z.enum(["unknown", "healthy", "unhealthy", "degraded"]),
          uptime: z.union([z.null(), outputNumber]),
          responseTime: z.object({
            avg: outputNumber,
            p95: outputNumber,
            p99: outputNumber,
            min: outputNumber,
            max: outputNumber,
            count: outputNumber,
          }),
          errorRate: outputNumber,
          lastChecked: z.union([z.null(), z.string()]),
          observationScope: z.literal("process"),
          activeAlerts: outputNumber,
          slaCompliant: z.boolean(),
        })
      ),
      activeAlerts: outputNumber,
      slaCompliance: z.union([z.null(), outputNumber]),
      uptimeAverage: z.union([z.null(), outputNumber]),
    }),
    recentAlerts: z.array(
      z.object({
        id: outputNumber,
        serviceName: z.string(),
        metricType: z.enum([
          "uptime",
          "response_time",
          "error_rate",
          "throughput",
        ]),
        severity: z.enum(["critical", "resolved", "warning"]),
        currentValue: outputNumber,
        targetValue: outputNumber,
        message: z.string(),
        status: z.enum(["active", "resolved", "acknowledged"]),
        acknowledgedBy: z.union([z.null(), outputNumber]),
        acknowledgedAt: z.union([z.null(), z.date()]),
        resolvedAt: z.union([z.null(), z.date()]),
        createdAt: z.date(),
      })
    ),
    complianceHistory: z.array(
      z.object({
        date: z.string(),
        compliance: outputNumber,
        breaches: outputNumber,
      })
    ),
    serviceBreakdown: z.array(
      z.object({
        serviceName: z.string(),
        status: z.enum(["unknown", "healthy", "unhealthy", "degraded"]),
        uptime: z.union([z.null(), outputNumber]),
        responseTime: z.object({
          avg: outputNumber,
          p95: outputNumber,
          p99: outputNumber,
          min: outputNumber,
          max: outputNumber,
          count: outputNumber,
        }),
        errorRate: outputNumber,
        lastChecked: z.union([z.null(), z.string()]),
        observationScope: z.literal("process"),
        activeAlerts: outputNumber,
        slaCompliant: z.boolean(),
      })
    ),
    targets: z.array(
      z.object({
        id: outputNumber,
        serviceName: z.string(),
        metricType: z.enum([
          "uptime",
          "response_time",
          "error_rate",
          "throughput",
        ]),
        targetValue: outputNumber,
        warningThreshold: outputNumber,
        criticalThreshold: outputNumber,
        unit: z.enum(["percent", "ms", "per_minute"]),
        isActive: z.boolean(),
        createdAt: z.date(),
        updatedAt: z.date(),
      })
    ),
  }),
  getAlerts: z.array(
    z.object({
      id: outputNumber,
      serviceName: z.string(),
      metricType: z.enum([
        "uptime",
        "response_time",
        "error_rate",
        "throughput",
      ]),
      severity: z.enum(["critical", "resolved", "warning"]),
      currentValue: outputNumber,
      targetValue: outputNumber,
      message: z.string(),
      status: z.enum(["active", "resolved", "acknowledged"]),
      acknowledgedBy: z.union([z.null(), outputNumber]),
      acknowledgedAt: z.union([z.null(), z.date()]),
      resolvedAt: z.union([z.null(), z.date()]),
      createdAt: z.date(),
    })
  ),
  acknowledgeAlert: z.union([
    z.object({
      success: z.boolean(),
      message: z.string(),
      alert: z.undefined().optional(),
    }),
    z.object({
      success: z.boolean(),
      alert: z.object({
        id: outputNumber,
        serviceName: z.string(),
        metricType: z.enum([
          "uptime",
          "response_time",
          "error_rate",
          "throughput",
        ]),
        severity: z.enum(["critical", "resolved", "warning"]),
        currentValue: outputNumber,
        targetValue: outputNumber,
        message: z.string(),
        status: z.enum(["active", "resolved", "acknowledged"]),
        acknowledgedBy: z.union([z.null(), outputNumber]),
        acknowledgedAt: z.union([z.null(), z.date()]),
        resolvedAt: z.union([z.null(), z.date()]),
        createdAt: z.date(),
      }),
      message: z.undefined().optional(),
    }),
  ]),
  getTargets: z.array(
    z.object({
      id: outputNumber,
      serviceName: z.string(),
      metricType: z.enum([
        "uptime",
        "response_time",
        "error_rate",
        "throughput",
      ]),
      targetValue: outputNumber,
      warningThreshold: outputNumber,
      criticalThreshold: outputNumber,
      unit: z.enum(["percent", "ms", "per_minute"]),
      isActive: z.boolean(),
      createdAt: z.date(),
      updatedAt: z.date(),
    })
  ),
  updateTarget: z.union([
    z.object({
      success: z.boolean(),
      message: z.string(),
      target: z.undefined().optional(),
    }),
    z.object({
      success: z.boolean(),
      target: z.object({
        id: outputNumber,
        serviceName: z.string(),
        metricType: z.enum([
          "uptime",
          "response_time",
          "error_rate",
          "throughput",
        ]),
        targetValue: outputNumber,
        warningThreshold: outputNumber,
        criticalThreshold: outputNumber,
        unit: z.enum(["percent", "ms", "per_minute"]),
        isActive: z.boolean(),
        createdAt: z.date(),
        updatedAt: z.date(),
      }),
      message: z.undefined().optional(),
    }),
  ]),
  generateReport: z.object({
    success: z.boolean(),
    report: z.object({
      id: outputNumber,
      reportPeriodStart: z.date(),
      reportPeriodEnd: z.date(),
      overallUptime: z.union([z.null(), outputNumber]),
      avgResponseTime: outputNumber,
      p95ResponseTime: outputNumber,
      p99ResponseTime: outputNumber,
      errorRate: outputNumber,
      totalRequests: outputNumber,
      failedRequests: outputNumber,
      slaBreaches: outputNumber,
      status: z.enum(["draft", "published"]),
      generatedAt: z.date(),
      createdAt: z.date(),
    }),
  }),
  getReports: z.array(
    z.object({
      id: outputNumber,
      reportPeriodStart: z.date(),
      reportPeriodEnd: z.date(),
      overallUptime: z.union([z.null(), outputNumber]),
      avgResponseTime: outputNumber,
      p95ResponseTime: outputNumber,
      p99ResponseTime: outputNumber,
      errorRate: outputNumber,
      totalRequests: outputNumber,
      failedRequests: outputNumber,
      slaBreaches: outputNumber,
      status: z.enum(["draft", "published"]),
      generatedAt: z.date(),
      createdAt: z.date(),
    })
  ),
  getMetricHistory: z.array(
    z.object({
      id: outputNumber,
      serviceName: z.string(),
      metricType: z.enum([
        "uptime",
        "response_time",
        "error_rate",
        "throughput",
      ]),
      value: outputNumber,
      timestamp: z.date(),
      createdAt: z.date(),
    })
  ),
};
