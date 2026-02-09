/**
 * Multi-Region Configuration
 *
 * Defines region interfaces, default region configurations,
 * routing logic, and health check settings for the multi-region
 * deployment of the AIS Aviation System.
 *
 * @version 1.0.0
 */

// ============================================================================
// Interfaces
// ============================================================================

export interface RegionConfig {
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
}

export interface RegionHealthConfig {
  /** Interval in milliseconds between health checks */
  checkIntervalMs: number;
  /** Timeout in milliseconds for each health check request */
  timeoutMs: number;
  /** Number of consecutive failures before marking region as degraded */
  degradedThreshold: number;
  /** Number of consecutive failures before marking region as down */
  downThreshold: number;
  /** Number of consecutive successes before marking degraded region as healthy */
  recoveryThreshold: number;
}

export interface RegionRoutingConfig {
  /** Strategy for routing users to regions */
  strategy: "latency" | "geo" | "weighted" | "failover";
  /** Maximum latency in ms before falling back to another region */
  maxAcceptableLatencyMs: number;
  /** Whether to enable sticky sessions (route returning users to same region) */
  stickySessions: boolean;
  /** TTL in seconds for sticky session bindings */
  stickySessionTtlSeconds: number;
}

export interface ReplicationConfig {
  /** Maximum acceptable replication lag in seconds */
  maxLagSeconds: number;
  /** Data types to replicate */
  replicatedDataTypes: Array<"users" | "bookings" | "flights" | "all">;
  /** Sync interval in seconds */
  syncIntervalSeconds: number;
  /** Whether to use async or sync replication */
  mode: "async" | "sync";
}

export interface FailoverConfig {
  /** Whether automatic failover is enabled */
  autoFailoverEnabled: boolean;
  /** Minimum time in seconds between automatic failovers */
  cooldownSeconds: number;
  /** Number of consecutive health check failures to trigger auto-failover */
  triggerThreshold: number;
  /** Maximum time in seconds allowed for a failover operation */
  maxFailoverDurationSeconds: number;
}

export interface MultiRegionConfig {
  regions: RegionConfig[];
  health: RegionHealthConfig;
  routing: RegionRoutingConfig;
  replication: ReplicationConfig;
  failover: FailoverConfig;
}

// ============================================================================
// Default Region Configurations
// ============================================================================

export const DEFAULT_REGIONS: RegionConfig[] = [
  {
    id: "me-central-1",
    name: "Middle East (Riyadh)",
    code: "ME",
    provider: "aws",
    endpoint: "https://api-me.ais-aviation.com",
    isPrimary: true,
    isActive: true,
    latitude: 24.7136,
    longitude: 46.6753,
    maxCapacity: 10000,
  },
  {
    id: "eu-west-1",
    name: "Europe (Frankfurt)",
    code: "EU",
    provider: "aws",
    endpoint: "https://api-eu.ais-aviation.com",
    isPrimary: false,
    isActive: true,
    latitude: 50.1109,
    longitude: 8.6821,
    maxCapacity: 8000,
  },
  {
    id: "ap-southeast-1",
    name: "Asia (Singapore)",
    code: "AP",
    provider: "aws",
    endpoint: "https://api-ap.ais-aviation.com",
    isPrimary: false,
    isActive: true,
    latitude: 1.3521,
    longitude: 103.8198,
    maxCapacity: 6000,
  },
];

export const DEFAULT_HEALTH_CONFIG: RegionHealthConfig = {
  checkIntervalMs: 30_000,
  timeoutMs: 5_000,
  degradedThreshold: 3,
  downThreshold: 5,
  recoveryThreshold: 3,
};

export const DEFAULT_ROUTING_CONFIG: RegionRoutingConfig = {
  strategy: "latency",
  maxAcceptableLatencyMs: 200,
  stickySessions: true,
  stickySessionTtlSeconds: 3600,
};

export const DEFAULT_REPLICATION_CONFIG: ReplicationConfig = {
  maxLagSeconds: 30,
  replicatedDataTypes: ["all"],
  syncIntervalSeconds: 60,
  mode: "async",
};

export const DEFAULT_FAILOVER_CONFIG: FailoverConfig = {
  autoFailoverEnabled: true,
  cooldownSeconds: 300,
  triggerThreshold: 5,
  maxFailoverDurationSeconds: 120,
};

export const DEFAULT_MULTI_REGION_CONFIG: MultiRegionConfig = {
  regions: DEFAULT_REGIONS,
  health: DEFAULT_HEALTH_CONFIG,
  routing: DEFAULT_ROUTING_CONFIG,
  replication: DEFAULT_REPLICATION_CONFIG,
  failover: DEFAULT_FAILOVER_CONFIG,
};

// ============================================================================
// Region Routing Logic
// ============================================================================

/**
 * Calculate the great-circle distance between two points using the Haversine formula.
 * Returns distance in kilometers.
 */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Find the nearest active region to given coordinates.
 * Falls back to the primary region if no active regions are found.
 */
export function findNearestRegion(
  latitude: number,
  longitude: number,
  regions: RegionConfig[] = DEFAULT_REGIONS
): RegionConfig {
  const activeRegions = regions.filter(r => r.isActive);
  if (activeRegions.length === 0) {
    const primary = regions.find(r => r.isPrimary);
    if (!primary) {
      throw new Error("No regions configured");
    }
    return primary;
  }

  let nearest = activeRegions[0];
  let minDistance = haversineDistance(
    latitude,
    longitude,
    nearest.latitude,
    nearest.longitude
  );

  for (let i = 1; i < activeRegions.length; i++) {
    const region = activeRegions[i];
    const distance = haversineDistance(
      latitude,
      longitude,
      region.latitude,
      region.longitude
    );
    if (distance < minDistance) {
      minDistance = distance;
      nearest = region;
    }
  }

  return nearest;
}

/**
 * Get the primary region from the configured regions.
 */
export function getPrimaryRegion(
  regions: RegionConfig[] = DEFAULT_REGIONS
): RegionConfig {
  const primary = regions.find(r => r.isPrimary);
  if (!primary) {
    throw new Error("No primary region configured");
  }
  return primary;
}

/**
 * Get the current region based on environment variables.
 * Falls back to the primary region if REGION_ID is not set.
 */
export function getCurrentRegionId(): string {
  return process.env.REGION_ID || getPrimaryRegion().id;
}

/**
 * Estimate latency between two regions based on geographic distance.
 * Uses a rough approximation: ~0.01ms per km (speed of light in fiber).
 */
export function estimateLatencyMs(
  regionA: RegionConfig,
  regionB: RegionConfig
): number {
  if (regionA.id === regionB.id) {
    return 0;
  }
  const distance = haversineDistance(
    regionA.latitude,
    regionA.longitude,
    regionB.latitude,
    regionB.longitude
  );
  // Approximate round-trip time: distance * 2 (round trip) * 0.01 ms/km
  // with a base overhead of 5ms for processing
  return Math.round(distance * 0.02 + 5);
}
