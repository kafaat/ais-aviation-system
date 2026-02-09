import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import * as multiRegionService from "../services/multi-region.service";

/**
 * Multi-Region Router
 * Admin-only endpoints for managing multi-region deployment,
 * health monitoring, data replication, and failover operations.
 */
export const multiRegionRouter = router({
  // ============================================================================
  // Query Procedures
  // ============================================================================

  /**
   * List all configured regions with their current status
   */
  getRegions: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/multi-region/regions",
        tags: ["Multi-Region", "Admin"],
        summary: "List all regions",
        description:
          "Retrieve all configured regions with their current status, health, and load information.",
        protect: true,
      },
    })
    .query(() => {
      const regions = multiRegionService.getRegions();
      const config = multiRegionService.getRegionConfig();
      return {
        regions,
        currentRegionId: config.currentRegionId,
      };
    }),

  /**
   * Health check for a specific region
   */
  getRegionHealth: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/multi-region/health/{regionId}",
        tags: ["Multi-Region", "Admin"],
        summary: "Check region health",
        description:
          "Perform a health check on a specific region, including API, database, and cache checks.",
        protect: true,
      },
    })
    .input(
      z.object({
        regionId: z.string().min(1).describe("Region identifier"),
      })
    )
    .query(async ({ input }) => {
      return await multiRegionService.getRegionHealth(input.regionId);
    }),

  /**
   * Get database replication status across all region pairs
   */
  getReplicationStatus: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/multi-region/replication",
        tags: ["Multi-Region", "Admin"],
        summary: "Get replication status",
        description:
          "Retrieve the current database replication status across all region pairs, including sync state, lag, and record counts.",
        protect: true,
      },
    })
    .query(() => {
      return multiRegionService.getReplicationStatus();
    }),

  /**
   * Get latency estimates between all region pairs
   */
  getLatencyMap: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/multi-region/latency",
        tags: ["Multi-Region", "Admin"],
        summary: "Get inter-region latency map",
        description:
          "Retrieve estimated round-trip latencies between all active region pairs based on geographic distance.",
        protect: true,
      },
    })
    .query(() => {
      return multiRegionService.getRegionLatency();
    }),

  /**
   * Get history of failover events
   */
  getFailoverHistory: adminProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/multi-region/failover/history",
        tags: ["Multi-Region", "Admin"],
        summary: "Get failover history",
        description:
          "Retrieve the history of all failover events, including status, affected users, and timing details.",
        protect: true,
      },
    })
    .query(() => {
      return multiRegionService.getFailoverHistory();
    }),

  // ============================================================================
  // Mutation Procedures
  // ============================================================================

  /**
   * Trigger data synchronization between two regions
   */
  triggerSync: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/multi-region/sync",
        tags: ["Multi-Region", "Admin"],
        summary: "Trigger data sync",
        description:
          "Initiate data synchronization from a source region to a target region for a specific data type.",
        protect: true,
      },
    })
    .input(
      z.object({
        sourceRegion: z.string().min(1).describe("Source region identifier"),
        targetRegion: z.string().min(1).describe("Target region identifier"),
        dataType: z
          .enum(["users", "bookings", "flights", "all"])
          .describe("Type of data to synchronize"),
      })
    )
    .mutation(async ({ input }) => {
      return await multiRegionService.syncData(
        input.sourceRegion,
        input.targetRegion,
        input.dataType
      );
    }),

  /**
   * Initiate failover to a backup region
   */
  initiateFailover: adminProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/multi-region/failover",
        tags: ["Multi-Region", "Admin"],
        summary: "Initiate region failover",
        description:
          "Initiate a failover from the current primary region to a specified backup region. This is a critical operation that redirects all traffic.",
        protect: true,
      },
    })
    .input(
      z.object({
        regionId: z.string().min(1).describe("Target region to failover to"),
        reason: z.string().min(1).max(500).describe("Reason for the failover"),
      })
    )
    .mutation(async ({ input }) => {
      return await multiRegionService.failoverToRegion(
        input.regionId,
        input.reason,
        "manual"
      );
    }),

  /**
   * Update a region's configuration
   */
  updateRegion: adminProcedure
    .meta({
      openapi: {
        method: "PATCH",
        path: "/multi-region/regions/{regionId}",
        tags: ["Multi-Region", "Admin"],
        summary: "Update region configuration",
        description:
          "Update a region's settings such as active status, capacity, name, or endpoint. Cannot deactivate the primary region.",
        protect: true,
      },
    })
    .input(
      z.object({
        regionId: z.string().min(1).describe("Region identifier"),
        isActive: z
          .boolean()
          .optional()
          .describe("Whether the region is active"),
        maxCapacity: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Maximum request capacity"),
        name: z
          .string()
          .min(1)
          .max(100)
          .optional()
          .describe("Human-readable region name"),
        endpoint: z
          .string()
          .url()
          .optional()
          .describe("Region API endpoint URL"),
      })
    )
    .mutation(({ input }) => {
      const { regionId, ...updates } = input;
      return multiRegionService.updateRegion(regionId, updates);
    }),
});
