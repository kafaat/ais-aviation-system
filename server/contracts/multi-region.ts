// Explicit response field allowlists. Review contract changes with producers and consumers.
import { z } from "zod";
import { outputNumber } from "./primitives";
export const responseContracts = {
  getRegions: z.object({
    regions: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        code: z.string(),
        provider: z.string(),
        endpoint: z.string(),
        isPrimary: z.boolean(),
        isActive: z.boolean(),
        latitude: outputNumber,
        longitude: outputNumber,
        maxCapacity: outputNumber,
        currentLoad: outputNumber,
        healthStatus: z.enum(["healthy", "degraded", "down"]),
        lastHealthCheck: z.union([z.null(), z.string()]),
        createdAt: z.string(),
        updatedAt: z.string(),
      })
    ),
    currentRegionId: z.string(),
  }),
  getRegionHealth: z.object({
    regionId: z.string(),
    status: z.enum(["healthy", "degraded", "down"]),
    latencyMs: outputNumber,
    checks: z.object({
      api: z.object({
        status: z.enum(["pass", "fail"]),
        responseTime: outputNumber,
      }),
      database: z.object({
        status: z.enum(["pass", "fail"]),
        responseTime: outputNumber,
      }),
      cache: z.object({
        status: z.enum(["pass", "fail"]),
        responseTime: outputNumber,
      }),
    }),
    lastChecked: z.string(),
  }),
  getReplicationStatus: z.object({
    statuses: z.array(
      z.object({
        id: outputNumber,
        sourceRegion: z.string(),
        targetRegion: z.string(),
        dataType: z.enum(["flights", "bookings", "users", "all"]),
        lastSyncAt: z.union([z.null(), z.string()]),
        recordsSynced: outputNumber,
        status: z.enum(["error", "synced", "syncing", "stale"]),
        lagSeconds: outputNumber,
        createdAt: z.string(),
        updatedAt: z.string(),
      })
    ),
    overallHealth: z.enum(["critical", "healthy", "degraded"]),
    summary: z.object({
      totalPairs: outputNumber,
      synced: outputNumber,
      syncing: outputNumber,
      error: outputNumber,
      stale: outputNumber,
      maxLagSeconds: outputNumber,
    }),
  }),
  getLatencyMap: z.object({
    matrix: z.array(
      z.object({
        from: z.string(),
        to: z.string(),
        estimatedLatencyMs: outputNumber,
      })
    ),
    measuredAt: z.string(),
  }),
  getFailoverHistory: z.array(
    z.object({
      id: outputNumber,
      fromRegion: z.string(),
      toRegion: z.string(),
      reason: z.string(),
      triggeredBy: z.enum(["auto", "manual"]),
      startedAt: z.string(),
      completedAt: z.union([z.null(), z.string()]),
      status: z.enum([
        "completed",
        "failed",
        "in_progress",
        "initiated",
        "rolled_back",
      ]),
      affectedUsers: outputNumber,
      createdAt: z.string(),
    })
  ),
  triggerSync: z.object({
    id: outputNumber,
    sourceRegion: z.string(),
    targetRegion: z.string(),
    dataType: z.enum(["flights", "bookings", "users", "all"]),
    lastSyncAt: z.union([z.null(), z.string()]),
    recordsSynced: outputNumber,
    status: z.enum(["error", "synced", "syncing", "stale"]),
    lagSeconds: outputNumber,
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  initiateFailover: z.object({
    id: outputNumber,
    fromRegion: z.string(),
    toRegion: z.string(),
    reason: z.string(),
    triggeredBy: z.enum(["auto", "manual"]),
    startedAt: z.string(),
    completedAt: z.union([z.null(), z.string()]),
    status: z.enum([
      "completed",
      "failed",
      "in_progress",
      "initiated",
      "rolled_back",
    ]),
    affectedUsers: outputNumber,
    createdAt: z.string(),
  }),
  updateRegion: z.object({
    id: z.string(),
    name: z.string(),
    code: z.string(),
    provider: z.string(),
    endpoint: z.string(),
    isPrimary: z.boolean(),
    isActive: z.boolean(),
    latitude: outputNumber,
    longitude: outputNumber,
    maxCapacity: outputNumber,
    currentLoad: outputNumber,
    healthStatus: z.enum(["healthy", "degraded", "down"]),
    lastHealthCheck: z.union([z.null(), z.string()]),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
};
