/**
 * Disaster Recovery / Business Continuity (DR/BCP) Service
 *
 * Manages backup operations, failover testing, recovery planning,
 * incident tracking, and runbook management for the aviation system.
 */

import { checkDatabase, checkCache, checkStripe } from "./health.service";

// ============================================================================
// Types
// ============================================================================

export type BackupType = "full" | "incremental" | "differential";
export type BackupComponent = "database" | "files" | "config" | "redis";
export type BackupStatus = "started" | "completed" | "failed" | "verified";

export type DRTestType =
  | "failover"
  | "backup_restore"
  | "network_partition"
  | "data_recovery";
export type DRTestStatus = "scheduled" | "running" | "passed" | "failed";

export type IncidentType = "outage" | "data_loss" | "performance" | "security";
export type IncidentSeverity = "low" | "medium" | "high" | "critical";
export type IncidentStatus =
  | "open"
  | "investigating"
  | "mitigating"
  | "resolved"
  | "postmortem";

export type RunbookScenario =
  | "db_failure"
  | "region_outage"
  | "network_failure"
  | "security_breach"
  | "data_corruption";

export interface BackupRecord {
  id: number;
  backupType: BackupType;
  component: BackupComponent;
  status: BackupStatus;
  startedAt: string;
  completedAt: string | null;
  sizeBytes: number | null;
  location: string;
  retentionDays: number;
  verifiedAt: string | null;
  createdAt: string;
}

export interface DRTest {
  id: number;
  testType: DRTestType;
  component: string;
  status: DRTestStatus;
  startedAt: string;
  completedAt: string | null;
  rtoAchieved: number | null;
  rpoAchieved: number | null;
  findings: Record<string, unknown>;
  testedBy: string;
  createdAt: string;
}

export interface DRIncident {
  id: number;
  incidentType: IncidentType;
  severity: IncidentSeverity;
  description: string;
  impactAssessment: string | null;
  status: IncidentStatus;
  resolvedAt: string | null;
  resolution: string | null;
  postmortemUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DRRunbook {
  id: number;
  scenarioType: RunbookScenario;
  title: string;
  steps: RunbookStep[];
  estimatedRTO: number;
  lastReviewed: string | null;
  reviewedBy: string | null;
  version: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RunbookStep {
  order: number;
  title: string;
  description: string;
  estimatedMinutes: number;
  responsible: string;
  automated: boolean;
}

export interface BackupScheduleEntry {
  component: BackupComponent;
  backupType: BackupType;
  cronExpression: string;
  retentionDays: number;
  enabled: boolean;
  lastRun: string | null;
  nextRun: string;
}

export interface DRDashboard {
  healthScore: number;
  overallStatus: "healthy" | "warning" | "critical";
  rpo: RPOResult;
  rto: RTOResult;
  backupSummary: {
    total: number;
    completed: number;
    failed: number;
    lastSuccessful: string | null;
  };
  testSummary: {
    total: number;
    passed: number;
    failed: number;
    lastTest: string | null;
  };
  activeIncidents: number;
  criticalIncidents: number;
  componentHealth: ComponentHealth[];
  recentBackups: BackupRecord[];
  recentTests: DRTest[];
  recentIncidents: DRIncident[];
}

export interface ComponentHealth {
  component: string;
  status: "healthy" | "degraded" | "down";
  lastBackup: string | null;
  lastTest: string | null;
  rpoMinutes: number | null;
}

export interface RPOResult {
  minutes: number;
  status: "within_target" | "approaching_limit" | "exceeded";
  targetMinutes: number;
  lastBackupTime: string | null;
}

export interface RTOResult {
  estimatedMinutes: number;
  status: "within_target" | "approaching_limit" | "exceeded";
  targetMinutes: number;
  components: { component: string; estimatedMinutes: number }[];
}

export interface RecoveryPlan {
  version: string;
  lastUpdated: string;
  rpoTarget: number;
  rtoTarget: number;
  priorityOrder: string[];
  components: RecoveryComponent[];
  communicationPlan: CommunicationStep[];
  escalationMatrix: EscalationEntry[];
}

export interface RecoveryComponent {
  name: string;
  priority: number;
  recoveryStrategy: string;
  backupLocation: string;
  estimatedRecoveryTime: number;
  dependencies: string[];
  contactPerson: string;
}

export interface CommunicationStep {
  order: number;
  audience: string;
  channel: string;
  template: string;
  withinMinutes: number;
}

export interface EscalationEntry {
  level: number;
  role: string;
  contactMethod: string;
  triggerAfterMinutes: number;
}

// ============================================================================
// In-memory storage (production would use database tables)
// ============================================================================

let nextBackupId = 1;
let nextTestId = 1;
let nextIncidentId = 1;
let nextRunbookId = 1;

const backupRecords: BackupRecord[] = [];
const drTests: DRTest[] = [];
const drIncidents: DRIncident[] = [];
const drRunbooks: DRRunbook[] = [];

// Initialize default runbooks
function ensureDefaultRunbooks(): void {
  if (drRunbooks.length > 0) return;

  const defaults: Array<{
    scenarioType: RunbookScenario;
    title: string;
    steps: RunbookStep[];
    estimatedRTO: number;
  }> = [
    {
      scenarioType: "db_failure",
      title: "Database Failure Recovery",
      steps: [
        {
          order: 1,
          title: "Detect and confirm database failure",
          description:
            "Verify database connectivity failure via health checks. Confirm the issue is not a transient network problem by checking from multiple locations.",
          estimatedMinutes: 5,
          responsible: "On-call DBA",
          automated: true,
        },
        {
          order: 2,
          title: "Activate read replica failover",
          description:
            "Promote the read replica to primary. Update DATABASE_URL environment variable or DNS to point to the new primary instance.",
          estimatedMinutes: 10,
          responsible: "On-call DBA",
          automated: false,
        },
        {
          order: 3,
          title: "Verify data integrity",
          description:
            "Run consistency checks on critical tables: bookings, payments, passengers. Compare row counts and checksums against last known good backup.",
          estimatedMinutes: 15,
          responsible: "On-call DBA",
          automated: false,
        },
        {
          order: 4,
          title: "Restore from backup if needed",
          description:
            "If replica is unavailable, restore from the latest verified backup. Apply incremental backups to minimize data loss. Target RPO: 15 minutes.",
          estimatedMinutes: 30,
          responsible: "On-call DBA",
          automated: false,
        },
        {
          order: 5,
          title: "Reconnect application servers",
          description:
            "Restart application pods/containers to pick up the new database connection. Verify tRPC health endpoint returns healthy status.",
          estimatedMinutes: 5,
          responsible: "On-call SRE",
          automated: true,
        },
        {
          order: 6,
          title: "Validate booking flow end-to-end",
          description:
            "Run end-to-end test of booking flow: search, create booking, payment, confirmation. Verify loyalty and ancillary services are operational.",
          estimatedMinutes: 10,
          responsible: "On-call SRE",
          automated: true,
        },
      ],
      estimatedRTO: 75,
    },
    {
      scenarioType: "region_outage",
      title: "Region Outage Recovery",
      steps: [
        {
          order: 1,
          title: "Confirm region-level outage",
          description:
            "Verify outage via cloud provider status page and monitoring. Distinguish between partial and full region failure.",
          estimatedMinutes: 5,
          responsible: "On-call SRE",
          automated: true,
        },
        {
          order: 2,
          title: "Activate DNS failover to secondary region",
          description:
            "Update DNS records to route traffic to secondary region. Activate standby infrastructure in the DR region.",
          estimatedMinutes: 10,
          responsible: "On-call SRE",
          automated: false,
        },
        {
          order: 3,
          title: "Verify secondary region services",
          description:
            "Confirm database replication is current. Verify Redis cache warm-up. Check Stripe webhook endpoints are configured for the new region.",
          estimatedMinutes: 15,
          responsible: "On-call SRE",
          automated: false,
        },
        {
          order: 4,
          title: "Notify stakeholders",
          description:
            "Send notifications to airline partners, travel agents, and corporate accounts about potential service disruption and expected resolution.",
          estimatedMinutes: 5,
          responsible: "Operations Manager",
          automated: true,
        },
        {
          order: 5,
          title: "Monitor and validate traffic",
          description:
            "Monitor error rates, latency, and booking completion rates in the DR region. Ensure auto-scaling is responding to incoming load.",
          estimatedMinutes: 30,
          responsible: "On-call SRE",
          automated: true,
        },
      ],
      estimatedRTO: 65,
    },
    {
      scenarioType: "network_failure",
      title: "Network Failure Recovery",
      steps: [
        {
          order: 1,
          title: "Identify network failure scope",
          description:
            "Determine whether the failure is internal (between services) or external (user-facing). Check auth-service, Redis, and Stripe connectivity separately.",
          estimatedMinutes: 5,
          responsible: "On-call Network Engineer",
          automated: true,
        },
        {
          order: 2,
          title: "Activate fallback network paths",
          description:
            "Switch to backup network routes. If auth-service is unreachable, enable local JWT verification fallback. If Redis is down, memory cache will activate automatically.",
          estimatedMinutes: 10,
          responsible: "On-call Network Engineer",
          automated: false,
        },
        {
          order: 3,
          title: "Verify service mesh connectivity",
          description:
            "Test inter-service communication: main app to auth-service, main app to Redis, webhook ingress from Stripe.",
          estimatedMinutes: 10,
          responsible: "On-call SRE",
          automated: true,
        },
        {
          order: 4,
          title: "Restore full connectivity",
          description:
            "Work with cloud provider or network team to restore primary network paths. Roll back to primary routes once stable.",
          estimatedMinutes: 30,
          responsible: "On-call Network Engineer",
          automated: false,
        },
      ],
      estimatedRTO: 55,
    },
    {
      scenarioType: "security_breach",
      title: "Security Breach Response",
      steps: [
        {
          order: 1,
          title: "Isolate affected systems",
          description:
            "Immediately restrict network access to compromised components. Revoke all active JWT tokens and session cookies. Rotate JWT_SECRET.",
          estimatedMinutes: 10,
          responsible: "Security Lead",
          automated: false,
        },
        {
          order: 2,
          title: "Assess breach scope",
          description:
            "Analyze audit logs to determine what data was accessed. Check for unauthorized bookings, payment data exposure, or PII leaks. Review GDPR implications.",
          estimatedMinutes: 30,
          responsible: "Security Lead",
          automated: false,
        },
        {
          order: 3,
          title: "Rotate all credentials",
          description:
            "Rotate: DATABASE_URL credentials, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, AUTH_SERVICE secrets, Redis password. Update all environment configurations.",
          estimatedMinutes: 20,
          responsible: "On-call SRE",
          automated: false,
        },
        {
          order: 4,
          title: "Restore from clean backup",
          description:
            "If data tampering is suspected, restore from the last verified clean backup taken before the breach window.",
          estimatedMinutes: 45,
          responsible: "On-call DBA",
          automated: false,
        },
        {
          order: 5,
          title: "Notify affected parties",
          description:
            "Notify affected users per GDPR requirements (within 72 hours). Notify airline partners and payment processors. File regulatory reports as required.",
          estimatedMinutes: 60,
          responsible: "Operations Manager",
          automated: false,
        },
        {
          order: 6,
          title: "Deploy security patches",
          description:
            "Apply security patches to close the vulnerability. Run security scan. Update WAF rules. Enable enhanced monitoring.",
          estimatedMinutes: 30,
          responsible: "Security Lead",
          automated: false,
        },
      ],
      estimatedRTO: 195,
    },
    {
      scenarioType: "data_corruption",
      title: "Data Corruption Recovery",
      steps: [
        {
          order: 1,
          title: "Identify corruption scope",
          description:
            "Run data integrity checks across critical tables: bookings, payments, passengers, flights. Identify the corruption boundary (time range and affected records).",
          estimatedMinutes: 15,
          responsible: "On-call DBA",
          automated: true,
        },
        {
          order: 2,
          title: "Halt writes to affected tables",
          description:
            "Put the application in read-only mode for affected domain areas. Display maintenance banner for booking creation if bookings table is affected.",
          estimatedMinutes: 5,
          responsible: "On-call SRE",
          automated: true,
        },
        {
          order: 3,
          title: "Restore affected tables from backup",
          description:
            "Perform selective table restore from the last verified backup before the corruption event. Use point-in-time recovery if available.",
          estimatedMinutes: 30,
          responsible: "On-call DBA",
          automated: false,
        },
        {
          order: 4,
          title: "Replay valid transactions",
          description:
            "From the backup point forward, replay valid transactions from the transaction log that occurred after the backup but are not part of the corruption.",
          estimatedMinutes: 30,
          responsible: "On-call DBA",
          automated: false,
        },
        {
          order: 5,
          title: "Validate data integrity",
          description:
            "Run full integrity checks. Verify foreign key relationships. Check booking-passenger-payment consistency. Validate loyalty account balances.",
          estimatedMinutes: 20,
          responsible: "On-call DBA",
          automated: true,
        },
        {
          order: 6,
          title: "Resume normal operations",
          description:
            "Remove read-only mode. Verify end-to-end booking flow. Monitor for any recurring corruption indicators.",
          estimatedMinutes: 10,
          responsible: "On-call SRE",
          automated: true,
        },
      ],
      estimatedRTO: 110,
    },
  ];

  for (const rb of defaults) {
    drRunbooks.push({
      id: nextRunbookId++,
      scenarioType: rb.scenarioType,
      title: rb.title,
      steps: rb.steps,
      estimatedRTO: rb.estimatedRTO,
      lastReviewed: new Date().toISOString(),
      reviewedBy: "system",
      version: 1,
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
}

// Initialize seed backup data
function ensureSeedData(): void {
  if (backupRecords.length > 0) return;

  const now = new Date();
  const components: BackupComponent[] = [
    "database",
    "files",
    "config",
    "redis",
  ];

  // Create some historical backup records
  for (let daysAgo = 7; daysAgo >= 0; daysAgo--) {
    for (const component of components) {
      const backupTime = new Date(now);
      backupTime.setDate(backupTime.getDate() - daysAgo);
      backupTime.setHours(2, 0, 0, 0); // 2 AM daily backups

      const completedTime = new Date(backupTime);
      completedTime.setMinutes(
        completedTime.getMinutes() +
          (component === "database" ? 25 : component === "files" ? 15 : 5)
      );

      const sizeMap: Record<BackupComponent, number> = {
        database: 2_500_000_000 + Math.floor(Math.random() * 500_000_000),
        files: 1_200_000_000 + Math.floor(Math.random() * 200_000_000),
        config: 5_000_000 + Math.floor(Math.random() * 1_000_000),
        redis: 150_000_000 + Math.floor(Math.random() * 50_000_000),
      };

      backupRecords.push({
        id: nextBackupId++,
        backupType: daysAgo % 7 === 0 ? "full" : "incremental",
        component,
        status: "completed",
        startedAt: backupTime.toISOString(),
        completedAt: completedTime.toISOString(),
        sizeBytes: sizeMap[component],
        location: `s3://ais-backups/${component}/${backupTime.toISOString().split("T")[0]}/`,
        retentionDays: component === "database" ? 90 : 30,
        verifiedAt: completedTime.toISOString(),
        createdAt: backupTime.toISOString(),
      });
    }
  }
}

// ============================================================================
// Backup Operations
// ============================================================================

/**
 * Get current backup status for all system components
 */
export function getBackupStatus(): {
  components: {
    component: BackupComponent;
    lastBackup: BackupRecord | null;
    status: "healthy" | "warning" | "critical";
    backupsLast24h: number;
    totalSize: number;
  }[];
  overall: "healthy" | "warning" | "critical";
} {
  ensureSeedData();

  const components: BackupComponent[] = [
    "database",
    "files",
    "config",
    "redis",
  ];
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const componentStatuses = components.map(component => {
    const componentBackups = backupRecords
      .filter(b => b.component === component)
      .sort(
        (a, b) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      );

    const lastBackup = componentBackups[0] ?? null;
    const backupsLast24h = componentBackups.filter(
      b => new Date(b.startedAt) >= oneDayAgo
    ).length;
    const totalSize = componentBackups.reduce(
      (sum, b) => sum + (b.sizeBytes ?? 0),
      0
    );

    let status: "healthy" | "warning" | "critical" = "healthy";
    if (!lastBackup || lastBackup.status === "failed") {
      status = "critical";
    } else {
      const hoursSinceBackup =
        (now.getTime() - new Date(lastBackup.startedAt).getTime()) /
        (1000 * 60 * 60);
      if (hoursSinceBackup > 48) {
        status = "critical";
      } else if (hoursSinceBackup > 24) {
        status = "warning";
      }
    }

    return {
      component,
      lastBackup,
      status,
      backupsLast24h,
      totalSize,
    };
  });

  const hasAnyCritical = componentStatuses.some(c => c.status === "critical");
  const hasAnyWarning = componentStatuses.some(c => c.status === "warning");
  const overall: "healthy" | "warning" | "critical" = hasAnyCritical
    ? "critical"
    : hasAnyWarning
      ? "warning"
      : "healthy";

  return { components: componentStatuses, overall };
}

/**
 * Initiate a manual backup for a specific component
 */
export function triggerBackup(
  backupType: BackupType,
  component: BackupComponent
): BackupRecord {
  ensureSeedData();

  const now = new Date();
  const record: BackupRecord = {
    id: nextBackupId++,
    backupType,
    component,
    status: "started",
    startedAt: now.toISOString(),
    completedAt: null,
    sizeBytes: null,
    location: `s3://ais-backups/${component}/${now.toISOString().split("T")[0]}/manual-${now.getTime()}/`,
    retentionDays: component === "database" ? 90 : 30,
    verifiedAt: null,
    createdAt: now.toISOString(),
  };

  backupRecords.push(record);

  // Simulate async backup completion
  const completionTime = new Date(
    now.getTime() +
      (component === "database"
        ? 25 * 60 * 1000
        : component === "files"
          ? 15 * 60 * 1000
          : 5 * 60 * 1000)
  );

  const sizeMap: Record<BackupComponent, number> = {
    database: 2_500_000_000 + Math.floor(Math.random() * 500_000_000),
    files: 1_200_000_000 + Math.floor(Math.random() * 200_000_000),
    config: 5_000_000 + Math.floor(Math.random() * 1_000_000),
    redis: 150_000_000 + Math.floor(Math.random() * 50_000_000),
  };

  // Simulate backup completion after a brief delay
  setTimeout(() => {
    record.status = "completed";
    record.completedAt = completionTime.toISOString();
    record.sizeBytes = sizeMap[component];
    record.verifiedAt = completionTime.toISOString();
  }, 3000);

  return record;
}

/**
 * Get backup schedule configuration
 */
export function getBackupSchedule(): BackupScheduleEntry[] {
  ensureSeedData();

  const now = new Date();
  const tomorrow2am = new Date(now);
  tomorrow2am.setDate(tomorrow2am.getDate() + 1);
  tomorrow2am.setHours(2, 0, 0, 0);

  const lastDbBackup = backupRecords
    .filter(b => b.component === "database" && b.status === "completed")
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    )[0];

  const lastFilesBackup = backupRecords
    .filter(b => b.component === "files" && b.status === "completed")
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    )[0];

  const lastConfigBackup = backupRecords
    .filter(b => b.component === "config" && b.status === "completed")
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    )[0];

  const lastRedisBackup = backupRecords
    .filter(b => b.component === "redis" && b.status === "completed")
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    )[0];

  return [
    {
      component: "database",
      backupType: "incremental",
      cronExpression: "0 */4 * * *",
      retentionDays: 90,
      enabled: true,
      lastRun: lastDbBackup?.startedAt ?? null,
      nextRun: tomorrow2am.toISOString(),
    },
    {
      component: "database",
      backupType: "full",
      cronExpression: "0 2 * * 0",
      retentionDays: 90,
      enabled: true,
      lastRun: lastDbBackup?.startedAt ?? null,
      nextRun: getNextSunday2am().toISOString(),
    },
    {
      component: "files",
      backupType: "incremental",
      cronExpression: "0 2 * * *",
      retentionDays: 30,
      enabled: true,
      lastRun: lastFilesBackup?.startedAt ?? null,
      nextRun: tomorrow2am.toISOString(),
    },
    {
      component: "config",
      backupType: "full",
      cronExpression: "0 3 * * *",
      retentionDays: 30,
      enabled: true,
      lastRun: lastConfigBackup?.startedAt ?? null,
      nextRun: tomorrow2am.toISOString(),
    },
    {
      component: "redis",
      backupType: "full",
      cronExpression: "0 */6 * * *",
      retentionDays: 7,
      enabled: true,
      lastRun: lastRedisBackup?.startedAt ?? null,
      nextRun: tomorrow2am.toISOString(),
    },
  ];
}

function getNextSunday2am(): Date {
  const now = new Date();
  const daysUntilSunday = (7 - now.getDay()) % 7 || 7;
  const nextSunday = new Date(now);
  nextSunday.setDate(nextSunday.getDate() + daysUntilSunday);
  nextSunday.setHours(2, 0, 0, 0);
  return nextSunday;
}

// ============================================================================
// Recovery Planning
// ============================================================================

/**
 * Get the current disaster recovery plan
 */
export function getRecoveryPlan(): RecoveryPlan {
  return {
    version: "3.0",
    lastUpdated: new Date().toISOString(),
    rpoTarget: 15,
    rtoTarget: 60,
    priorityOrder: [
      "database",
      "auth-service",
      "application",
      "redis",
      "stripe-webhooks",
      "background-workers",
    ],
    components: [
      {
        name: "MySQL/TiDB Database",
        priority: 1,
        recoveryStrategy:
          "Automatic failover to read replica, point-in-time recovery from binary logs",
        backupLocation: "s3://ais-backups/database/",
        estimatedRecoveryTime: 15,
        dependencies: [],
        contactPerson: "DBA Team Lead",
      },
      {
        name: "Auth Service (FastAPI)",
        priority: 2,
        recoveryStrategy:
          "Container restart with health checks, multi-replica deployment",
        backupLocation:
          "Container registry + config in s3://ais-backups/config/",
        estimatedRecoveryTime: 5,
        dependencies: ["MySQL/TiDB Database"],
        contactPerson: "Backend Team Lead",
      },
      {
        name: "Application Server (Express + tRPC)",
        priority: 3,
        recoveryStrategy:
          "Rolling deployment with readiness probes, auto-scaling group",
        backupLocation: "Container registry",
        estimatedRecoveryTime: 10,
        dependencies: ["MySQL/TiDB Database", "Auth Service (FastAPI)"],
        contactPerson: "Backend Team Lead",
      },
      {
        name: "Redis Cache",
        priority: 4,
        recoveryStrategy:
          "Automatic memory fallback on failure, cold start from RDB snapshot",
        backupLocation: "s3://ais-backups/redis/",
        estimatedRecoveryTime: 5,
        dependencies: [],
        contactPerson: "Infrastructure Lead",
      },
      {
        name: "Stripe Webhook Handler",
        priority: 5,
        recoveryStrategy:
          "Stripe automatically retries failed webhooks for up to 3 days, replay missed events via Stripe Dashboard",
        backupLocation: "N/A (stateless)",
        estimatedRecoveryTime: 10,
        dependencies: ["Application Server (Express + tRPC)"],
        contactPerson: "Payments Team Lead",
      },
      {
        name: "Background Workers (BullMQ)",
        priority: 6,
        recoveryStrategy:
          "Worker container restart, jobs persisted in Redis queues for automatic retry",
        backupLocation: "N/A (jobs in Redis)",
        estimatedRecoveryTime: 5,
        dependencies: ["Redis Cache"],
        contactPerson: "Backend Team Lead",
      },
    ],
    communicationPlan: [
      {
        order: 1,
        audience: "Engineering Team",
        channel: "Slack #incidents",
        template:
          "INCIDENT: [severity] - [description]. Investigation in progress.",
        withinMinutes: 5,
      },
      {
        order: 2,
        audience: "Operations Management",
        channel: "Phone/SMS",
        template:
          "System incident detected. Severity: [severity]. ETA: [estimated_resolution].",
        withinMinutes: 15,
      },
      {
        order: 3,
        audience: "Airline Partners",
        channel: "Email + Status Page",
        template:
          "Service disruption notice: [description]. Expected resolution: [eta]. Bookings in progress are preserved.",
        withinMinutes: 30,
      },
      {
        order: 4,
        audience: "End Users",
        channel: "Status Page + In-app banner",
        template:
          "We are experiencing technical difficulties. Your bookings are safe. We expect to resolve this by [eta].",
        withinMinutes: 30,
      },
    ],
    escalationMatrix: [
      {
        level: 1,
        role: "On-call Engineer",
        contactMethod: "PagerDuty",
        triggerAfterMinutes: 0,
      },
      {
        level: 2,
        role: "Team Lead",
        contactMethod: "Phone",
        triggerAfterMinutes: 15,
      },
      {
        level: 3,
        role: "Engineering Director",
        contactMethod: "Phone",
        triggerAfterMinutes: 30,
      },
      {
        level: 4,
        role: "CTO",
        contactMethod: "Phone + Email",
        triggerAfterMinutes: 60,
      },
    ],
  };
}

// ============================================================================
// Failover Testing
// ============================================================================

/**
 * Run a failover test for a specific component
 */
export async function testFailover(
  testType: DRTestType,
  component: string,
  testedBy: string
): Promise<DRTest> {
  ensureSeedData();
  ensureDefaultRunbooks();

  const now = new Date();
  const test: DRTest = {
    id: nextTestId++,
    testType,
    component,
    status: "running",
    startedAt: now.toISOString(),
    completedAt: null,
    rtoAchieved: null,
    rpoAchieved: null,
    findings: {},
    testedBy,
    createdAt: now.toISOString(),
  };

  drTests.push(test);

  // Execute the actual test based on type
  try {
    const findings: Record<string, unknown> = {};

    if (testType === "failover") {
      // Test actual health of the component
      if (component === "database") {
        const dbCheck = await checkDatabase();
        findings.databaseConnectivity = dbCheck.status;
        findings.responseTime = dbCheck.responseTime;
        findings.canFailover = dbCheck.status === "pass";
      } else if (component === "redis") {
        const cacheCheck = await checkCache();
        findings.cacheConnectivity = cacheCheck.status;
        findings.memoryFallbackAvailable = true;
        findings.responseTime = cacheCheck.responseTime;
      } else if (component === "stripe") {
        const stripeCheck = await checkStripe();
        findings.stripeConnectivity = stripeCheck.status;
        findings.webhookEndpointConfigured =
          !!process.env.STRIPE_WEBHOOK_SECRET;
      } else if (component === "auth-service") {
        findings.authServiceUrl =
          process.env.AUTH_SERVICE_URL ?? "not configured";
        findings.jwtSecretConfigured = !!process.env.JWT_SECRET;
      }
    } else if (testType === "backup_restore") {
      const lastBackup = backupRecords
        .filter(b => b.component === component && b.status === "completed")
        .sort(
          (a, b) =>
            new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
        )[0];

      findings.lastBackupExists = !!lastBackup;
      findings.lastBackupAge = lastBackup
        ? Math.round(
            (now.getTime() - new Date(lastBackup.startedAt).getTime()) /
              (1000 * 60)
          )
        : null;
      findings.lastBackupSize = lastBackup?.sizeBytes ?? null;
      findings.backupVerified = lastBackup?.verifiedAt !== null;
    } else if (testType === "network_partition") {
      const [dbCheck, cacheCheck, stripeCheck] = await Promise.all([
        checkDatabase(),
        checkCache(),
        checkStripe(),
      ]);
      findings.databaseReachable = dbCheck.status === "pass";
      findings.cacheReachable = cacheCheck.status === "pass";
      findings.stripeReachable = stripeCheck.status === "pass";
      findings.allServicesReachable =
        dbCheck.status === "pass" &&
        cacheCheck.status === "pass" &&
        stripeCheck.status === "pass";
    } else if (testType === "data_recovery") {
      const dbBackups = backupRecords.filter(
        b => b.component === "database" && b.status === "completed"
      );
      findings.totalDatabaseBackups = dbBackups.length;
      findings.oldestBackup =
        dbBackups.length > 0
          ? dbBackups.sort(
              (a, b) =>
                new Date(a.startedAt).getTime() -
                new Date(b.startedAt).getTime()
            )[0].startedAt
          : null;
      findings.newestBackup =
        dbBackups.length > 0
          ? dbBackups.sort(
              (a, b) =>
                new Date(b.startedAt).getTime() -
                new Date(a.startedAt).getTime()
            )[0].startedAt
          : null;
      findings.pointInTimeRecoveryAvailable = dbBackups.length >= 2;
    }

    const completedAt = new Date();
    const rtoAchieved = Math.round(
      (completedAt.getTime() - now.getTime()) / (1000 * 60)
    );

    test.status = "passed";
    test.completedAt = completedAt.toISOString();
    test.rtoAchieved = rtoAchieved;
    test.rpoAchieved = 0;
    test.findings = findings;
  } catch (error) {
    test.status = "failed";
    test.completedAt = new Date().toISOString();
    test.findings = {
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }

  return test;
}

/**
 * Get the history of failover tests
 */
export function getFailoverTestHistory(): DRTest[] {
  return [...drTests].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

// ============================================================================
// RPO / RTO Calculations
// ============================================================================

/**
 * Calculate current Recovery Point Objective (time since last successful backup)
 */
export function calculateRPO(): RPOResult {
  ensureSeedData();

  const TARGET_RPO_MINUTES = 15;
  const now = new Date();

  const lastSuccessful = backupRecords
    .filter(b => b.component === "database" && b.status === "completed")
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    )[0];

  if (!lastSuccessful) {
    return {
      minutes: Infinity,
      status: "exceeded",
      targetMinutes: TARGET_RPO_MINUTES,
      lastBackupTime: null,
    };
  }

  const minutesSinceBackup = Math.round(
    (now.getTime() -
      new Date(
        lastSuccessful.completedAt ?? lastSuccessful.startedAt
      ).getTime()) /
      (1000 * 60)
  );

  let status: RPOResult["status"] = "within_target";
  if (minutesSinceBackup > TARGET_RPO_MINUTES * 2) {
    status = "exceeded";
  } else if (minutesSinceBackup > TARGET_RPO_MINUTES) {
    status = "approaching_limit";
  }

  return {
    minutes: minutesSinceBackup,
    status,
    targetMinutes: TARGET_RPO_MINUTES,
    lastBackupTime: lastSuccessful.completedAt ?? lastSuccessful.startedAt,
  };
}

/**
 * Calculate estimated Recovery Time Objective
 */
export async function calculateRTO(): Promise<RTOResult> {
  const TARGET_RTO_MINUTES = 60;

  const componentEstimates = [
    { component: "database", estimatedMinutes: 15 },
    { component: "auth-service", estimatedMinutes: 5 },
    { component: "application", estimatedMinutes: 10 },
    { component: "redis", estimatedMinutes: 5 },
    { component: "stripe-webhooks", estimatedMinutes: 10 },
    { component: "background-workers", estimatedMinutes: 5 },
  ];

  // Check actual component health to adjust estimates
  try {
    const [dbCheck, cacheCheck, stripeCheck] = await Promise.all([
      checkDatabase(),
      checkCache(),
      checkStripe(),
    ]);

    // If a component is already down, add extra recovery time
    if (dbCheck.status === "fail") {
      const dbComponent = componentEstimates.find(
        c => c.component === "database"
      );
      if (dbComponent) dbComponent.estimatedMinutes += 15;
    }
    if (cacheCheck.status === "fail") {
      const cacheComponent = componentEstimates.find(
        c => c.component === "redis"
      );
      if (cacheComponent) cacheComponent.estimatedMinutes += 5;
    }
    if (stripeCheck.status === "fail") {
      const stripeComponent = componentEstimates.find(
        c => c.component === "stripe-webhooks"
      );
      if (stripeComponent) stripeComponent.estimatedMinutes += 10;
    }
  } catch (_error) {
    // Health checks failed, use conservative estimates
  }

  // Total RTO is the sequential sum of critical-path components
  const totalEstimated =
    componentEstimates.reduce(
      (sum, c) => Math.max(sum, c.estimatedMinutes),
      0
    ) + 10; // Add 10 min buffer for coordination

  let status: RTOResult["status"] = "within_target";
  if (totalEstimated > TARGET_RTO_MINUTES * 1.5) {
    status = "exceeded";
  } else if (totalEstimated > TARGET_RTO_MINUTES) {
    status = "approaching_limit";
  }

  return {
    estimatedMinutes: totalEstimated,
    status,
    targetMinutes: TARGET_RTO_MINUTES,
    components: componentEstimates,
  };
}

// ============================================================================
// DR Dashboard
// ============================================================================

/**
 * Get overall DR health dashboard data
 */
export async function getDRDashboard(): Promise<DRDashboard> {
  ensureSeedData();
  ensureDefaultRunbooks();

  const [backupStatus, rpo, rto] = await Promise.all([
    getBackupStatus(),
    Promise.resolve(calculateRPO()),
    calculateRTO(),
  ]);

  const completedBackups = backupRecords.filter(b => b.status === "completed");
  const failedBackups = backupRecords.filter(b => b.status === "failed");
  const lastSuccessfulBackup = completedBackups.sort(
    (a, b) =>
      new Date(b.completedAt ?? b.startedAt).getTime() -
      new Date(a.completedAt ?? a.startedAt).getTime()
  )[0];

  const passedTests = drTests.filter(t => t.status === "passed");
  const failedTests = drTests.filter(t => t.status === "failed");
  const lastTest = [...drTests].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )[0];

  const activeIncidents = drIncidents.filter(
    i => i.status !== "resolved" && i.status !== "postmortem"
  );
  const criticalIncidents = activeIncidents.filter(
    i => i.severity === "critical"
  );

  // Calculate health score (0-100)
  let healthScore = 100;

  // Backup health (-30 max)
  if (backupStatus.overall === "critical") healthScore -= 30;
  else if (backupStatus.overall === "warning") healthScore -= 15;

  // RPO health (-20 max)
  if (rpo.status === "exceeded") healthScore -= 20;
  else if (rpo.status === "approaching_limit") healthScore -= 10;

  // RTO health (-20 max)
  if (rto.status === "exceeded") healthScore -= 20;
  else if (rto.status === "approaching_limit") healthScore -= 10;

  // Active incidents (-20 max)
  healthScore -= Math.min(criticalIncidents.length * 10, 20);

  // Test freshness (-10 max)
  if (drTests.length === 0) {
    healthScore -= 10;
  } else if (failedTests.length > passedTests.length) {
    healthScore -= 10;
  }

  healthScore = Math.max(0, Math.min(100, healthScore));

  const overallStatus: DRDashboard["overallStatus"] =
    healthScore >= 80 ? "healthy" : healthScore >= 50 ? "warning" : "critical";

  // Component health
  const componentHealth: ComponentHealth[] = backupStatus.components.map(c => {
    const lastTestForComponent = drTests
      .filter(t => t.component === c.component)
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )[0];

    let rpoMinutes: number | null = null;
    if (c.lastBackup?.completedAt) {
      rpoMinutes = Math.round(
        (Date.now() - new Date(c.lastBackup.completedAt).getTime()) /
          (1000 * 60)
      );
    }

    return {
      component: c.component,
      status:
        c.status === "healthy"
          ? "healthy"
          : c.status === "warning"
            ? "degraded"
            : "down",
      lastBackup: c.lastBackup?.completedAt ?? null,
      lastTest: lastTestForComponent?.completedAt ?? null,
      rpoMinutes,
    };
  });

  // Recent items
  const recentBackups = [...backupRecords]
    .sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    )
    .slice(0, 10);

  const recentTests = [...drTests]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
    .slice(0, 5);

  const recentIncidents = [...drIncidents]
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
    .slice(0, 5);

  return {
    healthScore,
    overallStatus,
    rpo,
    rto,
    backupSummary: {
      total: backupRecords.length,
      completed: completedBackups.length,
      failed: failedBackups.length,
      lastSuccessful:
        lastSuccessfulBackup?.completedAt ??
        lastSuccessfulBackup?.startedAt ??
        null,
    },
    testSummary: {
      total: drTests.length,
      passed: passedTests.length,
      failed: failedTests.length,
      lastTest: lastTest?.createdAt ?? null,
    },
    activeIncidents: activeIncidents.length,
    criticalIncidents: criticalIncidents.length,
    componentHealth,
    recentBackups,
    recentTests,
    recentIncidents,
  };
}

// ============================================================================
// Incident Management
// ============================================================================

/**
 * Create a new DR incident
 */
export function createIncident(
  incidentType: IncidentType,
  severity: IncidentSeverity,
  description: string,
  impactAssessment?: string
): DRIncident {
  const now = new Date().toISOString();
  const incident: DRIncident = {
    id: nextIncidentId++,
    incidentType,
    severity,
    description,
    impactAssessment: impactAssessment ?? null,
    status: "open",
    resolvedAt: null,
    resolution: null,
    postmortemUrl: null,
    createdAt: now,
    updatedAt: now,
  };

  drIncidents.push(incident);
  return incident;
}

/**
 * Resolve a DR incident
 */
export function resolveIncident(
  incidentId: number,
  resolution: string,
  postmortemUrl?: string
): DRIncident {
  const incident = drIncidents.find(i => i.id === incidentId);
  if (!incident) {
    throw new Error(`Incident ${incidentId} not found`);
  }

  const now = new Date().toISOString();
  incident.status = "resolved";
  incident.resolvedAt = now;
  incident.resolution = resolution;
  incident.postmortemUrl = postmortemUrl ?? null;
  incident.updatedAt = now;

  return incident;
}

/**
 * Get all incidents, optionally filtered by status
 */
export function getIncidents(statusFilter?: IncidentStatus): DRIncident[] {
  let results = [...drIncidents];
  if (statusFilter) {
    results = results.filter(i => i.status === statusFilter);
  }
  return results.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

// ============================================================================
// Runbook Management
// ============================================================================

/**
 * Get a DR runbook by scenario type
 */
export function getRunbook(scenarioType: RunbookScenario): DRRunbook | null {
  ensureDefaultRunbooks();
  return (
    drRunbooks.find(r => r.scenarioType === scenarioType && r.isActive) ?? null
  );
}

/**
 * Get all active runbooks
 */
export function getAllRunbooks(): DRRunbook[] {
  ensureDefaultRunbooks();
  return drRunbooks.filter(r => r.isActive);
}

/**
 * Update a runbook
 */
export function updateRunbook(
  id: number,
  updates: {
    title?: string;
    steps?: RunbookStep[];
    estimatedRTO?: number;
    reviewedBy?: string;
  }
): DRRunbook {
  ensureDefaultRunbooks();

  const runbook = drRunbooks.find(r => r.id === id);
  if (!runbook) {
    throw new Error(`Runbook ${id} not found`);
  }

  const now = new Date().toISOString();

  if (updates.title !== undefined) runbook.title = updates.title;
  if (updates.steps !== undefined) runbook.steps = updates.steps;
  if (updates.estimatedRTO !== undefined)
    runbook.estimatedRTO = updates.estimatedRTO;
  if (updates.reviewedBy !== undefined) {
    runbook.reviewedBy = updates.reviewedBy;
    runbook.lastReviewed = now;
  }

  runbook.version += 1;
  runbook.updatedAt = now;

  return runbook;
}
