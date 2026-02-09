/**
 * Disaster Recovery / Business Continuity (DR/BCP) Router
 *
 * Admin-only endpoints for DR operations:
 * - Backup status and management
 * - RPO/RTO monitoring
 * - Failover testing
 * - Incident tracking
 * - Runbook management
 */

import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import * as drService from "../services/disaster-recovery.service";

export const disasterRecoveryRouter = router({
  // ========================================================================
  // Dashboard
  // ========================================================================

  /**
   * Get the overall DR health dashboard
   * Returns health score, backup summary, test results, active incidents
   */
  getDashboard: adminProcedure.query(async () => {
    return await drService.getDRDashboard();
  }),

  // ========================================================================
  // Backup Operations
  // ========================================================================

  /**
   * Get current backup status for all system components
   */
  getBackupStatus: adminProcedure.query(async () => {
    return await drService.getBackupStatus();
  }),

  /**
   * Trigger a manual backup for a specific component
   */
  triggerBackup: adminProcedure
    .input(
      z.object({
        backupType: z.enum(["full", "incremental", "differential"]),
        component: z.enum(["database", "files", "config", "redis"]),
      })
    )
    .mutation(async ({ input }) => {
      return await drService.triggerBackup(input.backupType, input.component);
    }),

  /**
   * Get backup schedule configuration
   */
  getBackupSchedule: adminProcedure.query(() => {
    return drService.getBackupSchedule();
  }),

  // ========================================================================
  // Recovery Planning
  // ========================================================================

  /**
   * Get the current disaster recovery plan
   */
  getRecoveryPlan: adminProcedure.query(() => {
    return drService.getRecoveryPlan();
  }),

  // ========================================================================
  // Failover Testing
  // ========================================================================

  /**
   * Run a failover test for a specific component
   */
  testFailover: adminProcedure
    .input(
      z.object({
        testType: z.enum([
          "failover",
          "backup_restore",
          "network_partition",
          "data_recovery",
        ]),
        component: z.string().min(1).max(100),
      })
    )
    .mutation(async ({ input, ctx }) => {
      return await drService.testFailover(
        input.testType,
        input.component,
        ctx.user.email ?? `user-${ctx.user.id}`
      );
    }),

  /**
   * Get the history of all failover tests
   */
  getTestHistory: adminProcedure.query(() => {
    return drService.getFailoverTestHistory();
  }),

  // ========================================================================
  // RPO / RTO
  // ========================================================================

  /**
   * Calculate current Recovery Point Objective
   */
  getRPO: adminProcedure.query(() => {
    return drService.calculateRPO();
  }),

  /**
   * Calculate estimated Recovery Time Objective
   */
  getRTO: adminProcedure.query(async () => {
    return await drService.calculateRTO();
  }),

  // ========================================================================
  // Incident Management
  // ========================================================================

  /**
   * Create a new DR incident
   */
  createIncident: adminProcedure
    .input(
      z.object({
        incidentType: z.enum([
          "outage",
          "data_loss",
          "performance",
          "security",
        ]),
        severity: z.enum(["low", "medium", "high", "critical"]),
        description: z.string().min(1).max(2000),
        impactAssessment: z.string().max(2000).optional(),
      })
    )
    .mutation(({ input }) => {
      return drService.createIncident(
        input.incidentType,
        input.severity,
        input.description,
        input.impactAssessment
      );
    }),

  /**
   * Resolve a DR incident
   */
  resolveIncident: adminProcedure
    .input(
      z.object({
        incidentId: z.number().positive(),
        resolution: z.string().min(1).max(2000),
        postmortemUrl: z.string().url().optional(),
      })
    )
    .mutation(({ input }) => {
      return drService.resolveIncident(
        input.incidentId,
        input.resolution,
        input.postmortemUrl
      );
    }),

  /**
   * Get all incidents with optional status filter
   */
  getIncidents: adminProcedure
    .input(
      z
        .object({
          status: z
            .enum([
              "open",
              "investigating",
              "mitigating",
              "resolved",
              "postmortem",
            ])
            .optional(),
        })
        .optional()
    )
    .query(({ input }) => {
      return drService.getIncidents(input?.status);
    }),

  // ========================================================================
  // Runbook Management
  // ========================================================================

  /**
   * Get a DR runbook for a specific scenario
   */
  getRunbook: adminProcedure
    .input(
      z.object({
        scenarioType: z.enum([
          "db_failure",
          "region_outage",
          "network_failure",
          "security_breach",
          "data_corruption",
        ]),
      })
    )
    .query(({ input }) => {
      return drService.getRunbook(input.scenarioType);
    }),

  /**
   * Get all active runbooks
   */
  getAllRunbooks: adminProcedure.query(() => {
    return drService.getAllRunbooks();
  }),

  /**
   * Update a runbook's content or mark it as reviewed
   */
  updateRunbook: adminProcedure
    .input(
      z.object({
        id: z.number().positive(),
        title: z.string().min(1).max(200).optional(),
        steps: z
          .array(
            z.object({
              order: z.number(),
              title: z.string(),
              description: z.string(),
              estimatedMinutes: z.number(),
              responsible: z.string(),
              automated: z.boolean(),
            })
          )
          .optional(),
        estimatedRTO: z.number().positive().optional(),
        reviewedBy: z.string().optional(),
      })
    )
    .mutation(({ input }) => {
      const { id, ...updates } = input;
      return drService.updateRunbook(id, updates);
    }),
});
