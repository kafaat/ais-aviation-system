/**
 * SLA Monitoring Router
 * Provides admin endpoints for monitoring service level agreements,
 * viewing system health, managing alerts, and generating compliance reports.
 */

import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import {
  getSystemHealth,
  getServiceStatus,
  getSLADashboard,
  getAlerts,
  acknowledgeAlert,
  getTargets,
  updateTarget,
  getSLAReport,
  getReports,
  getMetricHistory,
} from "../services/sla-monitoring.service";
import type {
  SLASeverity,
  SLAMetricType,
} from "../services/sla-monitoring.service";

export const slaRouter = router({
  /**
   * Get overall system health summary
   * Returns health status for all monitored services with uptime and alert counts
   */
  getSystemHealth: adminProcedure.query(async () => {
    return getSystemHealth();
  }),

  /**
   * Get individual service health status
   * Returns detailed health information for a specific service
   */
  getServiceStatus: adminProcedure
    .input(
      z.object({
        service: z.string().min(1),
      })
    )
    .query(async ({ input }) => {
      return getServiceStatus(input.service);
    }),

  /**
   * Get full SLA dashboard data
   * Returns system health, recent alerts, compliance history, and service breakdown
   */
  getSLADashboard: adminProcedure.query(async () => {
    return getSLADashboard();
  }),

  /**
   * Get SLA alerts with optional filtering
   * Supports filtering by date range and severity level
   */
  getAlerts: adminProcedure
    .input(
      z
        .object({
          startDate: z.string().datetime().optional(),
          endDate: z.string().datetime().optional(),
          severity: z.enum(["warning", "critical", "resolved"]).optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const dateRange =
        input?.startDate && input?.endDate
          ? {
              start: new Date(input.startDate),
              end: new Date(input.endDate),
            }
          : undefined;

      const severity = input?.severity as SLASeverity | undefined;
      return getAlerts(dateRange, severity);
    }),

  /**
   * Acknowledge an active SLA alert
   * Marks the alert as acknowledged by the current admin user
   */
  acknowledgeAlert: adminProcedure
    .input(
      z.object({
        alertId: z.number().int().positive(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const result = acknowledgeAlert(input.alertId, ctx.user.id);
      if (!result) {
        return { success: false, message: "Alert not found" };
      }
      return { success: true, alert: result };
    }),

  /**
   * Get SLA targets (all active targets by default)
   * Returns configurable thresholds for each service and metric type
   */
  getTargets: adminProcedure
    .input(
      z
        .object({
          activeOnly: z.boolean().optional().default(true),
        })
        .optional()
    )
    .query(async ({ input }) => {
      return getTargets(input?.activeOnly ?? true);
    }),

  /**
   * Update an SLA target's thresholds or active status
   * Allows admins to adjust warning/critical thresholds and enable/disable targets
   */
  updateTarget: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        targetValue: z.number().optional(),
        warningThreshold: z.number().optional(),
        criticalThreshold: z.number().optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...updates } = input;
      const result = updateTarget(id, updates);
      if (!result) {
        return { success: false, message: "Target not found" };
      }
      return { success: true, target: result };
    }),

  /**
   * Generate an SLA compliance report for a date range
   * Creates a comprehensive report with uptime, response times, error rates, and breaches
   */
  generateReport: adminProcedure
    .input(
      z.object({
        startDate: z.string().datetime(),
        endDate: z.string().datetime(),
      })
    )
    .mutation(async ({ input }) => {
      const report = getSLAReport({
        start: new Date(input.startDate),
        end: new Date(input.endDate),
      });
      return { success: true, report };
    }),

  /**
   * Get all previously generated SLA reports
   * Returns reports sorted by generation date (most recent first)
   */
  getReports: adminProcedure.query(async () => {
    return getReports();
  }),

  /**
   * Get metric history for a specific service and metric type
   * Returns time-series data for charting and analysis
   */
  getMetricHistory: adminProcedure
    .input(
      z.object({
        service: z.string().min(1),
        metricType: z.enum([
          "uptime",
          "response_time",
          "error_rate",
          "throughput",
        ]),
        startDate: z.string().datetime(),
        endDate: z.string().datetime(),
      })
    )
    .query(async ({ input }) => {
      const metrics = getMetricHistory(
        input.service,
        input.metricType as SLAMetricType,
        {
          start: new Date(input.startDate),
          end: new Date(input.endDate),
        }
      );
      return metrics;
    }),
});
