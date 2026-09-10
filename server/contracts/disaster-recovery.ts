// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber, structuredValue } from "./primitives";
export const responseContracts = {
  getDashboard: z.object({
    healthScore: outputNumber,
    overallStatus: z.enum(["critical", "healthy", "warning"]),
    rpo: z.object({
      minutes: outputNumber,
      status: z.enum(["within_target", "approaching_limit", "exceeded"]),
      targetMinutes: outputNumber,
      lastBackupTime: z.union([z.null(), z.string()]),
    }),
    rto: z.object({
      estimatedMinutes: outputNumber,
      status: z.enum(["within_target", "approaching_limit", "exceeded"]),
      targetMinutes: outputNumber,
      components: z.array(
        z.object({ component: z.string(), estimatedMinutes: outputNumber })
      ),
    }),
    backupSummary: z.object({
      total: outputNumber,
      completed: outputNumber,
      failed: outputNumber,
      lastSuccessful: z.union([z.null(), z.string()]),
    }),
    testSummary: z.object({
      total: outputNumber,
      passed: outputNumber,
      failed: outputNumber,
      lastTest: z.union([z.null(), z.string()]),
    }),
    activeIncidents: outputNumber,
    criticalIncidents: outputNumber,
    componentHealth: z.array(
      z.object({
        component: z.string(),
        status: z.enum(["healthy", "degraded", "down"]),
        lastBackup: z.union([z.null(), z.string()]),
        lastTest: z.union([z.null(), z.string()]),
        rpoMinutes: z.union([z.null(), outputNumber]),
      })
    ),
    recentBackups: z.array(
      z.object({
        id: outputNumber,
        backupType: z.enum(["full", "incremental", "differential"]),
        component: z.enum(["config", "database", "files", "redis"]),
        status: z.enum(["completed", "failed", "started", "verified"]),
        startedAt: z.string(),
        completedAt: z.union([z.null(), z.string()]),
        sizeBytes: z.union([z.null(), outputNumber]),
        location: z.string(),
        retentionDays: outputNumber,
        verifiedAt: z.union([z.null(), z.string()]),
        createdAt: z.string(),
      })
    ),
    recentTests: z.array(
      z.object({
        id: outputNumber,
        testType: z.enum([
          "failover",
          "backup_restore",
          "network_partition",
          "data_recovery",
        ]),
        component: z.string(),
        status: z.enum(["scheduled", "failed", "running", "passed"]),
        startedAt: z.string(),
        completedAt: z.union([z.null(), z.string()]),
        rtoAchieved: z.union([z.null(), outputNumber]),
        rpoAchieved: z.union([z.null(), outputNumber]),
        findings: z.record(z.string(), structuredValue),
        testedBy: z.string(),
        createdAt: z.string(),
      })
    ),
    recentIncidents: z.array(
      z.object({
        id: outputNumber,
        incidentType: z.enum([
          "outage",
          "data_loss",
          "performance",
          "security",
        ]),
        severity: z.enum(["high", "medium", "low", "critical"]),
        description: z.string(),
        impactAssessment: z.union([z.null(), z.string()]),
        status: z.enum([
          "resolved",
          "open",
          "investigating",
          "mitigating",
          "postmortem",
        ]),
        resolvedAt: z.union([z.null(), z.string()]),
        resolution: z.union([z.null(), z.string()]),
        postmortemUrl: z.union([z.null(), z.string()]),
        createdAt: z.string(),
        updatedAt: z.string(),
      })
    ),
  }),
  getBackupStatus: z.object({
    components: z.array(
      z.object({
        component: z.enum(["config", "database", "files", "redis"]),
        lastBackup: z.union([
          z.null(),
          z.object({
            id: outputNumber,
            backupType: z.enum(["full", "incremental", "differential"]),
            component: z.enum(["config", "database", "files", "redis"]),
            status: z.enum(["completed", "failed", "started", "verified"]),
            startedAt: z.string(),
            completedAt: z.union([z.null(), z.string()]),
            sizeBytes: z.union([z.null(), outputNumber]),
            location: z.string(),
            retentionDays: outputNumber,
            verifiedAt: z.union([z.null(), z.string()]),
            createdAt: z.string(),
          }),
        ]),
        status: z.enum(["critical", "healthy", "warning"]),
        backupsLast24h: outputNumber,
        totalSize: outputNumber,
      })
    ),
    overall: z.enum(["critical", "healthy", "warning"]),
  }),
  triggerBackup: z.object({
    id: outputNumber,
    backupType: z.enum(["full", "incremental", "differential"]),
    component: z.enum(["config", "database", "files", "redis"]),
    status: z.enum(["completed", "failed", "started", "verified"]),
    startedAt: z.string(),
    completedAt: z.union([z.null(), z.string()]),
    sizeBytes: z.union([z.null(), outputNumber]),
    location: z.string(),
    retentionDays: outputNumber,
    verifiedAt: z.union([z.null(), z.string()]),
    createdAt: z.string(),
  }),
  getBackupSchedule: z.array(
    z.object({
      component: z.enum(["config", "database", "files", "redis"]),
      backupType: z.enum(["full", "incremental", "differential"]),
      cronExpression: z.string(),
      retentionDays: outputNumber,
      enabled: z.boolean(),
      lastRun: z.union([z.null(), z.string()]),
      nextRun: z.string(),
    })
  ),
  getRecoveryPlan: z.object({
    version: z.string(),
    lastUpdated: z.string(),
    rpoTarget: outputNumber,
    rtoTarget: outputNumber,
    priorityOrder: z.array(z.string()),
    components: z.array(
      z.object({
        name: z.string(),
        priority: outputNumber,
        recoveryStrategy: z.string(),
        backupLocation: z.string(),
        estimatedRecoveryTime: outputNumber,
        dependencies: z.array(z.string()),
        contactPerson: z.string(),
      })
    ),
    communicationPlan: z.array(
      z.object({
        order: outputNumber,
        audience: z.string(),
        channel: z.string(),
        template: z.string(),
        withinMinutes: outputNumber,
      })
    ),
    escalationMatrix: z.array(
      z.object({
        level: outputNumber,
        role: z.string(),
        contactMethod: z.string(),
        triggerAfterMinutes: outputNumber,
      })
    ),
  }),
  testFailover: z.object({
    id: outputNumber,
    testType: z.enum([
      "failover",
      "backup_restore",
      "network_partition",
      "data_recovery",
    ]),
    component: z.string(),
    status: z.enum(["scheduled", "failed", "running", "passed"]),
    startedAt: z.string(),
    completedAt: z.union([z.null(), z.string()]),
    rtoAchieved: z.union([z.null(), outputNumber]),
    rpoAchieved: z.union([z.null(), outputNumber]),
    findings: z.record(z.string(), structuredValue),
    testedBy: z.string(),
    createdAt: z.string(),
  }),
  getTestHistory: z.array(
    z.object({
      id: outputNumber,
      testType: z.enum([
        "failover",
        "backup_restore",
        "network_partition",
        "data_recovery",
      ]),
      component: z.string(),
      status: z.enum(["scheduled", "failed", "running", "passed"]),
      startedAt: z.string(),
      completedAt: z.union([z.null(), z.string()]),
      rtoAchieved: z.union([z.null(), outputNumber]),
      rpoAchieved: z.union([z.null(), outputNumber]),
      findings: z.record(z.string(), structuredValue),
      testedBy: z.string(),
      createdAt: z.string(),
    })
  ),
  getRPO: z.object({
    minutes: outputNumber,
    status: z.enum(["within_target", "approaching_limit", "exceeded"]),
    targetMinutes: outputNumber,
    lastBackupTime: z.union([z.null(), z.string()]),
  }),
  getRTO: z.object({
    estimatedMinutes: outputNumber,
    status: z.enum(["within_target", "approaching_limit", "exceeded"]),
    targetMinutes: outputNumber,
    components: z.array(
      z.object({ component: z.string(), estimatedMinutes: outputNumber })
    ),
  }),
  createIncident: z.object({
    id: outputNumber,
    incidentType: z.enum(["outage", "data_loss", "performance", "security"]),
    severity: z.enum(["high", "medium", "low", "critical"]),
    description: z.string(),
    impactAssessment: z.union([z.null(), z.string()]),
    status: z.enum([
      "resolved",
      "open",
      "investigating",
      "mitigating",
      "postmortem",
    ]),
    resolvedAt: z.union([z.null(), z.string()]),
    resolution: z.union([z.null(), z.string()]),
    postmortemUrl: z.union([z.null(), z.string()]),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  resolveIncident: z.object({
    id: outputNumber,
    incidentType: z.enum(["outage", "data_loss", "performance", "security"]),
    severity: z.enum(["high", "medium", "low", "critical"]),
    description: z.string(),
    impactAssessment: z.union([z.null(), z.string()]),
    status: z.enum([
      "resolved",
      "open",
      "investigating",
      "mitigating",
      "postmortem",
    ]),
    resolvedAt: z.union([z.null(), z.string()]),
    resolution: z.union([z.null(), z.string()]),
    postmortemUrl: z.union([z.null(), z.string()]),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  getIncidents: z.array(
    z.object({
      id: outputNumber,
      incidentType: z.enum(["outage", "data_loss", "performance", "security"]),
      severity: z.enum(["high", "medium", "low", "critical"]),
      description: z.string(),
      impactAssessment: z.union([z.null(), z.string()]),
      status: z.enum([
        "resolved",
        "open",
        "investigating",
        "mitigating",
        "postmortem",
      ]),
      resolvedAt: z.union([z.null(), z.string()]),
      resolution: z.union([z.null(), z.string()]),
      postmortemUrl: z.union([z.null(), z.string()]),
      createdAt: z.string(),
      updatedAt: z.string(),
    })
  ),
  getRunbook: z.union([
    z.null(),
    z.object({
      id: outputNumber,
      scenarioType: z.enum([
        "db_failure",
        "region_outage",
        "network_failure",
        "security_breach",
        "data_corruption",
      ]),
      title: z.string(),
      steps: z.array(
        z.object({
          order: outputNumber,
          title: z.string(),
          description: z.string(),
          estimatedMinutes: outputNumber,
          responsible: z.string(),
          automated: z.boolean(),
        })
      ),
      estimatedRTO: outputNumber,
      lastReviewed: z.union([z.null(), z.string()]),
      reviewedBy: z.union([z.null(), z.string()]),
      version: outputNumber,
      isActive: z.boolean(),
      createdAt: z.string(),
      updatedAt: z.string(),
    }),
  ]),
  getAllRunbooks: z.array(
    z.object({
      id: outputNumber,
      scenarioType: z.enum([
        "db_failure",
        "region_outage",
        "network_failure",
        "security_breach",
        "data_corruption",
      ]),
      title: z.string(),
      steps: z.array(
        z.object({
          order: outputNumber,
          title: z.string(),
          description: z.string(),
          estimatedMinutes: outputNumber,
          responsible: z.string(),
          automated: z.boolean(),
        })
      ),
      estimatedRTO: outputNumber,
      lastReviewed: z.union([z.null(), z.string()]),
      reviewedBy: z.union([z.null(), z.string()]),
      version: outputNumber,
      isActive: z.boolean(),
      createdAt: z.string(),
      updatedAt: z.string(),
    })
  ),
  updateRunbook: z.object({
    id: outputNumber,
    scenarioType: z.enum([
      "db_failure",
      "region_outage",
      "network_failure",
      "security_breach",
      "data_corruption",
    ]),
    title: z.string(),
    steps: z.array(
      z.object({
        order: outputNumber,
        title: z.string(),
        description: z.string(),
        estimatedMinutes: outputNumber,
        responsible: z.string(),
        automated: z.boolean(),
      })
    ),
    estimatedRTO: outputNumber,
    lastReviewed: z.union([z.null(), z.string()]),
    reviewedBy: z.union([z.null(), z.string()]),
    version: outputNumber,
    isActive: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
};
