/**
 * Multi-Region Service
 *
 * Manages multi-region deployment configuration, health monitoring,
 * data replication, request routing, and failover for the AIS Aviation System.
 *
 * Schema types are defined inline within this service. In a production
 * environment, the regions/syncStatus/failoverEvents would be backed
 * by database tables. This service provides an in-memory simulation
 * layer that can be swapped for persistent storage.
 *
 * @version 1.0.0
 */

import { TRPCError } from "@trpc/server";
import { createServiceLogger } from "../_core/logger";
import {
  DEFAULT_MULTI_REGION_CONFIG,
  DEFAULT_REGIONS,
  findNearestRegion,
  estimateLatencyMs,
  getCurrentRegionId,
  type RegionConfig,
  type MultiRegionConfig,
} from "../../config/multi-region";

const log = createServiceLogger("multi-region");

// ============================================================================
// Schema Types (inline)
// ============================================================================

export interface Region {
  id: string;
  name: string;
  code: string;
  provider: string;
  endpoint: string;
  isPrimary: boolean;
  isActive: boolean;
  latitude: number;
  longitude: number;
  maxCapacity: number;
  currentLoad: number;
  healthStatus: "healthy" | "degraded" | "down";
  lastHealthCheck: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RegionSyncStatus {
  id: number;
  sourceRegion: string;
  targetRegion: string;
  dataType: "users" | "bookings" | "flights" | "all";
  lastSyncAt: string | null;
  recordsSynced: number;
  status: "synced" | "syncing" | "error" | "stale";
  lagSeconds: number;
  createdAt: string;
  updatedAt: string;
}

export interface FailoverEvent {
  id: number;
  fromRegion: string;
  toRegion: string;
  reason: string;
  triggeredBy: "auto" | "manual";
  startedAt: string;
  completedAt: string | null;
  status: "initiated" | "in_progress" | "completed" | "rolled_back" | "failed";
  affectedUsers: number;
  createdAt: string;
}

// ============================================================================
// In-Memory State
// ============================================================================

const regions: Region[] = DEFAULT_REGIONS.map(r => ({
  ...r,
  currentLoad: 0,
  healthStatus: "healthy" as const,
  lastHealthCheck: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}));

const syncStatuses: RegionSyncStatus[] = [];
const failoverEvents: FailoverEvent[] = [];
let syncIdCounter = 1;
let failoverIdCounter = 1;

/**
 * Initialize default sync statuses between regions.
 * Creates entries for each pair of active regions.
 */
function initSyncStatuses(): void {
  if (syncStatuses.length > 0) return;

  const activeRegions = regions.filter(r => r.isActive);
  const primaryRegion = regions.find(r => r.isPrimary);
  if (!primaryRegion) return;

  for (const region of activeRegions) {
    if (region.id === primaryRegion.id) continue;

    const now = new Date().toISOString();
    syncStatuses.push({
      id: syncIdCounter++,
      sourceRegion: primaryRegion.id,
      targetRegion: region.id,
      dataType: "all",
      lastSyncAt: now,
      recordsSynced: 0,
      status: "synced",
      lagSeconds: 0,
      createdAt: now,
      updatedAt: now,
    });
  }
}

// Initialize on load
initSyncStatuses();

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Get the current region configuration including runtime settings.
 */
export function getRegionConfig(): {
  currentRegionId: string;
  config: MultiRegionConfig;
  currentRegion: Region | undefined;
} {
  const currentRegionId = getCurrentRegionId();
  const currentRegion = regions.find(r => r.id === currentRegionId);

  log.info({ currentRegionId }, "Retrieved region configuration");

  return {
    currentRegionId,
    config: DEFAULT_MULTI_REGION_CONFIG,
    currentRegion,
  };
}

/**
 * List all configured regions with their current status.
 */
export function getRegions(): Region[] {
  log.info({ count: regions.length }, "Listed all regions");
  return regions;
}

/**
 * Perform a health check on a specific region.
 * In production, this would make an HTTP request to the region endpoint.
 * Here we simulate the check and update the region state.
 */
export async function getRegionHealth(regionId: string): Promise<{
  regionId: string;
  status: "healthy" | "degraded" | "down";
  latencyMs: number;
  checks: {
    api: { status: "pass" | "fail"; responseTime: number };
    database: { status: "pass" | "fail"; responseTime: number };
    cache: { status: "pass" | "fail"; responseTime: number };
  };
  lastChecked: string;
}> {
  const region = regions.find(r => r.id === regionId);
  if (!region) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Region not found: ${regionId}`,
    });
  }

  const startTime = Date.now();

  // Simulate async health check (in production: HTTP call to region endpoint /health)
  await Promise.resolve();
  const currentRegionId = getCurrentRegionId();
  const currentRegion = regions.find(r => r.id === currentRegionId);

  // Estimate latency based on geographic distance
  let estimatedLatency = 1;
  if (currentRegion && currentRegion.id !== region.id) {
    estimatedLatency = estimateLatencyMs(
      currentRegion as RegionConfig,
      region as RegionConfig
    );
  }

  const now = new Date().toISOString();

  // Simulate individual service checks
  const apiResponseTime = Math.max(
    1,
    estimatedLatency + Math.round(Math.random() * 10)
  );
  const dbResponseTime = Math.max(
    1,
    estimatedLatency + Math.round(Math.random() * 20)
  );
  const cacheResponseTime = Math.max(
    1,
    estimatedLatency + Math.round(Math.random() * 5)
  );

  const checks = {
    api: {
      status: region.isActive ? ("pass" as const) : ("fail" as const),
      responseTime: apiResponseTime,
    },
    database: {
      status: region.isActive ? ("pass" as const) : ("fail" as const),
      responseTime: dbResponseTime,
    },
    cache: {
      status: region.isActive ? ("pass" as const) : ("fail" as const),
      responseTime: cacheResponseTime,
    },
  };

  // Determine overall health
  const allPass = Object.values(checks).every(c => c.status === "pass");
  const anyFail = Object.values(checks).some(c => c.status === "fail");
  const healthStatus = allPass ? "healthy" : anyFail ? "down" : "degraded";

  // Update region state
  region.healthStatus = healthStatus;
  region.lastHealthCheck = now;
  region.updatedAt = now;

  const totalLatency = Date.now() - startTime + estimatedLatency;

  log.info(
    { regionId, healthStatus, latencyMs: totalLatency },
    "Region health check completed"
  );

  return {
    regionId,
    status: healthStatus,
    latencyMs: totalLatency,
    checks,
    lastChecked: now,
  };
}

/**
 * Get latency estimates between all region pairs.
 * Returns a matrix of estimated round-trip times.
 */
export function getRegionLatency(): {
  matrix: Array<{
    from: string;
    to: string;
    estimatedLatencyMs: number;
  }>;
  measuredAt: string;
} {
  const activeRegions = regions.filter(r => r.isActive);
  const matrix: Array<{
    from: string;
    to: string;
    estimatedLatencyMs: number;
  }> = [];

  for (const from of activeRegions) {
    for (const to of activeRegions) {
      matrix.push({
        from: from.id,
        to: to.id,
        estimatedLatencyMs: estimateLatencyMs(
          from as RegionConfig,
          to as RegionConfig
        ),
      });
    }
  }

  log.info({ pairs: matrix.length }, "Generated region latency matrix");

  return {
    matrix,
    measuredAt: new Date().toISOString(),
  };
}

/**
 * Determine the optimal region for a given user based on their location.
 * In production this would use GeoIP or user preferences.
 *
 * @param userId - The user ID to route
 * @param latitude - Optional latitude for geo-based routing
 * @param longitude - Optional longitude for geo-based routing
 */
export function routeRequest(
  userId: number,
  latitude?: number,
  longitude?: number
): {
  recommendedRegion: string;
  reason: string;
  alternatives: Array<{ regionId: string; estimatedLatencyMs: number }>;
} {
  const activeRegions = regions.filter(
    r => r.isActive && r.healthStatus !== "down"
  );

  if (activeRegions.length === 0) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "No healthy regions available for routing",
    });
  }

  // If coordinates are provided, use geo-based routing
  if (latitude !== undefined && longitude !== undefined) {
    const nearest = findNearestRegion(
      latitude,
      longitude,
      activeRegions as RegionConfig[]
    );

    // Check if the nearest region has capacity
    if (nearest.maxCapacity > 0) {
      const regionState = regions.find(r => r.id === nearest.id);
      if (regionState && regionState.currentLoad >= nearest.maxCapacity) {
        // Nearest is at capacity, find next best
        const sortedByDistance = activeRegions
          .filter(r => r.id !== nearest.id)
          .map(r => ({
            region: r,
            latency: estimateLatencyMs(
              nearest as RegionConfig,
              r as RegionConfig
            ),
          }))
          .sort((a, b) => a.latency - b.latency);

        if (sortedByDistance.length > 0) {
          const fallback = sortedByDistance[0].region;
          log.info(
            { userId, regionId: fallback.id, reason: "capacity_overflow" },
            "Routed user to fallback region"
          );
          return {
            recommendedRegion: fallback.id,
            reason: `Nearest region ${nearest.id} at capacity, routed to ${fallback.id}`,
            alternatives: sortedByDistance.map(s => ({
              regionId: s.region.id,
              estimatedLatencyMs: s.latency,
            })),
          };
        }
      }
    }

    const alternatives = activeRegions
      .filter(r => r.id !== nearest.id)
      .map(r => ({
        regionId: r.id,
        estimatedLatencyMs: estimateLatencyMs(
          nearest as RegionConfig,
          r as RegionConfig
        ),
      }))
      .sort((a, b) => a.estimatedLatencyMs - b.estimatedLatencyMs);

    log.info(
      { userId, regionId: nearest.id, reason: "geo_proximity" },
      "Routed user to nearest region"
    );

    return {
      recommendedRegion: nearest.id,
      reason: "Routed to geographically nearest healthy region",
      alternatives,
    };
  }

  // Without coordinates, use primary region or least-loaded region
  const primary = activeRegions.find(
    r => r.isPrimary && r.healthStatus === "healthy"
  );
  if (primary) {
    const alternatives = activeRegions
      .filter(r => r.id !== primary.id)
      .map(r => ({
        regionId: r.id,
        estimatedLatencyMs: estimateLatencyMs(
          primary as RegionConfig,
          r as RegionConfig
        ),
      }));

    log.info(
      { userId, regionId: primary.id, reason: "primary_default" },
      "Routed user to primary region"
    );

    return {
      recommendedRegion: primary.id,
      reason: "Routed to primary region (no location data)",
      alternatives,
    };
  }

  // Primary is down, pick the healthiest region with lowest load
  const sorted = [...activeRegions].sort((a, b) => {
    if (a.healthStatus !== b.healthStatus) {
      const healthOrder = { healthy: 0, degraded: 1, down: 2 };
      return healthOrder[a.healthStatus] - healthOrder[b.healthStatus];
    }
    return a.currentLoad - b.currentLoad;
  });

  const best = sorted[0];
  const alternatives = sorted.slice(1).map(r => ({
    regionId: r.id,
    estimatedLatencyMs: estimateLatencyMs(
      best as RegionConfig,
      r as RegionConfig
    ),
  }));

  log.info(
    { userId, regionId: best.id, reason: "least_loaded_fallback" },
    "Routed user to least loaded region"
  );

  return {
    recommendedRegion: best.id,
    reason: "Primary unavailable, routed to healthiest region with lowest load",
    alternatives,
  };
}

/**
 * Trigger data synchronization between two regions.
 * In production, this would initiate database replication or an ETL job.
 */
export async function syncData(
  sourceRegion: string,
  targetRegion: string,
  dataType: "users" | "bookings" | "flights" | "all"
): Promise<RegionSyncStatus> {
  const source = regions.find(r => r.id === sourceRegion);
  const target = regions.find(r => r.id === targetRegion);

  if (!source) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Source region not found: ${sourceRegion}`,
    });
  }
  if (!target) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Target region not found: ${targetRegion}`,
    });
  }
  if (!source.isActive) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Source region is not active: ${sourceRegion}`,
    });
  }
  if (!target.isActive) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Target region is not active: ${targetRegion}`,
    });
  }

  // Simulate async operation (in production: triggers replication job via BullMQ)
  await Promise.resolve();

  // Find existing sync status or create new
  let syncStatus = syncStatuses.find(
    s =>
      s.sourceRegion === sourceRegion &&
      s.targetRegion === targetRegion &&
      s.dataType === dataType
  );

  const now = new Date().toISOString();

  if (!syncStatus) {
    syncStatus = {
      id: syncIdCounter++,
      sourceRegion,
      targetRegion,
      dataType,
      lastSyncAt: null,
      recordsSynced: 0,
      status: "syncing",
      lagSeconds: 0,
      createdAt: now,
      updatedAt: now,
    };
    syncStatuses.push(syncStatus);
  } else {
    syncStatus.status = "syncing";
    syncStatus.updatedAt = now;
  }

  log.info(
    { sourceRegion, targetRegion, dataType, syncId: syncStatus.id },
    "Data sync initiated"
  );

  // Simulate async sync completion
  // In production this would be a background job via BullMQ
  const simulatedRecords = Math.floor(Math.random() * 1000) + 100;
  const simulatedLag = Math.floor(Math.random() * 5);

  syncStatus.status = "synced";
  syncStatus.lastSyncAt = new Date().toISOString();
  syncStatus.recordsSynced += simulatedRecords;
  syncStatus.lagSeconds = simulatedLag;
  syncStatus.updatedAt = new Date().toISOString();

  log.info(
    {
      syncId: syncStatus.id,
      recordsSynced: simulatedRecords,
      lagSeconds: simulatedLag,
    },
    "Data sync completed"
  );

  return syncStatus;
}

/**
 * Get the current replication status across all region pairs.
 */
export function getReplicationStatus(): {
  statuses: RegionSyncStatus[];
  overallHealth: "healthy" | "degraded" | "critical";
  summary: {
    totalPairs: number;
    synced: number;
    syncing: number;
    error: number;
    stale: number;
    maxLagSeconds: number;
  };
} {
  const summary = {
    totalPairs: syncStatuses.length,
    synced: syncStatuses.filter(s => s.status === "synced").length,
    syncing: syncStatuses.filter(s => s.status === "syncing").length,
    error: syncStatuses.filter(s => s.status === "error").length,
    stale: syncStatuses.filter(s => s.status === "stale").length,
    maxLagSeconds: Math.max(0, ...syncStatuses.map(s => s.lagSeconds)),
  };

  let overallHealth: "healthy" | "degraded" | "critical";
  if (summary.error > 0) {
    overallHealth = "critical";
  } else if (
    summary.stale > 0 ||
    summary.maxLagSeconds >
      DEFAULT_MULTI_REGION_CONFIG.replication.maxLagSeconds
  ) {
    overallHealth = "degraded";
  } else {
    overallHealth = "healthy";
  }

  log.info(
    { overallHealth, totalPairs: summary.totalPairs },
    "Retrieved replication status"
  );

  return {
    statuses: syncStatuses,
    overallHealth,
    summary,
  };
}

/**
 * Initiate a failover from the current primary region to a specified backup region.
 * This is a critical operation that redirects all traffic to the target region.
 */
export async function failoverToRegion(
  regionId: string,
  reason: string = "Manual failover",
  triggeredBy: "auto" | "manual" = "manual"
): Promise<FailoverEvent> {
  const targetRegion = regions.find(r => r.id === regionId);
  if (!targetRegion) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Target region not found: ${regionId}`,
    });
  }
  if (!targetRegion.isActive) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Target region is not active: ${regionId}`,
    });
  }
  if (targetRegion.healthStatus === "down") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Cannot failover to a region that is down: ${regionId}`,
    });
  }

  // Simulate async failover coordination (in production: distributed lock + DNS update)
  await Promise.resolve();

  const currentPrimary = regions.find(r => r.isPrimary);
  if (!currentPrimary) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "No current primary region found",
    });
  }
  if (currentPrimary.id === regionId) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Target region is already the primary region",
    });
  }

  // Check failover cooldown
  const recentFailover = failoverEvents.find(
    e =>
      e.status === "completed" &&
      e.completedAt !== null &&
      Date.now() - new Date(e.completedAt).getTime() <
        DEFAULT_MULTI_REGION_CONFIG.failover.cooldownSeconds * 1000
  );

  if (recentFailover && triggeredBy === "auto") {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Failover cooldown active. Last failover completed at ${recentFailover.completedAt}`,
    });
  }

  const now = new Date().toISOString();
  const event: FailoverEvent = {
    id: failoverIdCounter++,
    fromRegion: currentPrimary.id,
    toRegion: regionId,
    reason,
    triggeredBy,
    startedAt: now,
    completedAt: null,
    status: "initiated",
    affectedUsers: currentPrimary.currentLoad,
    createdAt: now,
  };

  failoverEvents.push(event);

  log.warn(
    {
      failoverId: event.id,
      fromRegion: currentPrimary.id,
      toRegion: regionId,
      reason,
      triggeredBy,
    },
    "Failover initiated"
  );

  // Step 1: Mark as in progress
  event.status = "in_progress";

  try {
    // Step 2: Demote current primary
    currentPrimary.isPrimary = false;
    currentPrimary.updatedAt = new Date().toISOString();

    // Step 3: Promote target region
    targetRegion.isPrimary = true;
    targetRegion.updatedAt = new Date().toISOString();

    // Step 4: Mark failover complete
    event.status = "completed";
    event.completedAt = new Date().toISOString();

    log.info(
      {
        failoverId: event.id,
        newPrimary: regionId,
        affectedUsers: event.affectedUsers,
      },
      "Failover completed successfully"
    );
  } catch (error) {
    // Rollback: restore original primary
    currentPrimary.isPrimary = true;
    currentPrimary.updatedAt = new Date().toISOString();
    targetRegion.isPrimary = false;
    targetRegion.updatedAt = new Date().toISOString();

    event.status = "failed";
    event.completedAt = new Date().toISOString();

    log.error(
      {
        failoverId: event.id,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      "Failover failed, rolled back"
    );

    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Failover failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    });
  }

  return event;
}

/**
 * Get the history of all failover events, most recent first.
 */
export function getFailoverHistory(): FailoverEvent[] {
  log.info({ count: failoverEvents.length }, "Retrieved failover history");
  return [...failoverEvents].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/**
 * Update a region's configuration (e.g., activate/deactivate, change capacity).
 */
export function updateRegion(
  regionId: string,
  updates: Partial<
    Pick<Region, "isActive" | "maxCapacity" | "name" | "endpoint">
  >
): Region {
  const region = regions.find(r => r.id === regionId);
  if (!region) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Region not found: ${regionId}`,
    });
  }

  // Prevent deactivating the primary region
  if (updates.isActive === false && region.isPrimary) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Cannot deactivate the primary region. Failover first.",
    });
  }

  if (updates.isActive !== undefined) {
    region.isActive = updates.isActive;
  }
  if (updates.maxCapacity !== undefined) {
    region.maxCapacity = updates.maxCapacity;
  }
  if (updates.name !== undefined) {
    region.name = updates.name;
  }
  if (updates.endpoint !== undefined) {
    region.endpoint = updates.endpoint;
  }

  region.updatedAt = new Date().toISOString();

  log.info({ regionId, updates }, "Region updated");

  return region;
}
