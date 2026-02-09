/**
 * Flight Tracking Service
 *
 * Provides real-time flight tracking:
 * - Position and telemetry data
 * - Flight phase detection
 * - Progress calculation
 * - Latest position queries
 *
 * @module services/flight-tracking.service
 */

import { getDb } from "../db";
import { flightTracking, flights, airports } from "../../drizzle/schema";
import { eq, and, desc, gte, sql } from "drizzle-orm";

// ============================================================================
// Types
// ============================================================================

export type FlightPhase =
  | "boarding"
  | "taxiing"
  | "takeoff"
  | "climbing"
  | "cruising"
  | "descending"
  | "approach"
  | "landing"
  | "arrived";

export interface FlightPosition {
  latitude: number;
  longitude: number;
  altitude: number;
  heading: number;
  groundSpeed: number;
  phase: FlightPhase;
  estimatedArrival: Date | null;
  temperature: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  turbulence: "none" | "light" | "moderate" | "severe" | null;
  distanceCovered: number | null;
  distanceRemaining: number | null;
  progressPercent: number | null;
  recordedAt: Date;
}

export interface FlightTrackingData {
  flight: {
    id: number;
    flightNumber: string;
    status: string;
    departureTime: Date;
    arrivalTime: Date;
    aircraftType: string;
    origin: {
      code: string;
      city: string;
      name: string;
    };
    destination: {
      code: string;
      city: string;
      name: string;
    };
  };
  currentPosition: FlightPosition | null;
  trail: FlightPosition[];
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Get flight tracking data by flight number
 */
export async function getFlightTrackingByNumber(
  flightNumber: string
): Promise<FlightTrackingData | null> {
  const database = await getDb();
  if (!database) {
    throw new Error("Database not available");
  }

  // Find the flight
  const flightResult = await database
    .select({
      id: flights.id,
      flightNumber: flights.flightNumber,
      status: flights.status,
      departureTime: flights.departureTime,
      arrivalTime: flights.arrivalTime,
      aircraftType: flights.aircraftType,
      originId: flights.originId,
      destinationId: flights.destinationId,
    })
    .from(flights)
    .where(eq(flights.flightNumber, flightNumber))
    .orderBy(desc(flights.departureTime))
    .limit(1);

  if (flightResult.length === 0) {
    return null;
  }

  const flight = flightResult[0];

  // Get airport details
  const [origin] = await database
    .select({
      code: airports.code,
      city: airports.city,
      name: airports.name,
    })
    .from(airports)
    .where(eq(airports.id, flight.originId))
    .limit(1);

  const [destination] = await database
    .select({
      code: airports.code,
      city: airports.city,
      name: airports.name,
    })
    .from(airports)
    .where(eq(airports.id, flight.destinationId))
    .limit(1);

  // Get latest tracking position
  const latestPosition = await database
    .select()
    .from(flightTracking)
    .where(eq(flightTracking.flightId, flight.id))
    .orderBy(desc(flightTracking.recordedAt))
    .limit(1);

  // Get trail (last 50 positions)
  const trail = await database
    .select()
    .from(flightTracking)
    .where(eq(flightTracking.flightId, flight.id))
    .orderBy(desc(flightTracking.recordedAt))
    .limit(50);

  const mapPosition = (pos: (typeof latestPosition)[0]): FlightPosition => ({
    latitude: Number(pos.latitude),
    longitude: Number(pos.longitude),
    altitude: pos.altitude,
    heading: pos.heading,
    groundSpeed: pos.groundSpeed,
    phase: pos.phase as FlightPhase,
    estimatedArrival: pos.estimatedArrival,
    temperature: pos.temperature,
    windSpeed: pos.windSpeed,
    windDirection: pos.windDirection,
    turbulence: pos.turbulence as FlightPosition["turbulence"],
    distanceCovered: pos.distanceCovered,
    distanceRemaining: pos.distanceRemaining,
    progressPercent: pos.progressPercent ? Number(pos.progressPercent) : null,
    recordedAt: pos.recordedAt,
  });

  return {
    flight: {
      id: flight.id,
      flightNumber: flight.flightNumber,
      status: flight.status,
      departureTime: flight.departureTime,
      arrivalTime: flight.arrivalTime,
      aircraftType: flight.aircraftType ?? "Unknown",
      origin: origin ?? { code: "???", city: "Unknown", name: "Unknown" },
      destination: destination ?? {
        code: "???",
        city: "Unknown",
        name: "Unknown",
      },
    },
    currentPosition:
      latestPosition.length > 0 ? mapPosition(latestPosition[0]) : null,
    trail: trail.reverse().map(mapPosition),
  };
}

/**
 * Get flight tracking data by flight ID
 */
export async function getFlightTrackingById(
  flightId: number
): Promise<FlightTrackingData | null> {
  const database = await getDb();
  if (!database) {
    throw new Error("Database not available");
  }

  const flightResult = await database
    .select({
      flightNumber: flights.flightNumber,
    })
    .from(flights)
    .where(eq(flights.id, flightId))
    .limit(1);

  if (flightResult.length === 0) {
    return null;
  }

  return getFlightTrackingByNumber(flightResult[0].flightNumber);
}

/**
 * Record a new tracking position for a flight
 */
export async function recordFlightPosition(data: {
  flightId: number;
  latitude: string;
  longitude: string;
  altitude: number;
  heading: number;
  groundSpeed: number;
  phase: FlightPhase;
  estimatedArrival?: Date;
  temperature?: number;
  windSpeed?: number;
  windDirection?: number;
  turbulence?: "none" | "light" | "moderate" | "severe";
  distanceCovered?: number;
  distanceRemaining?: number;
  progressPercent?: string;
}): Promise<{ id: number }> {
  const database = await getDb();
  if (!database) {
    throw new Error("Database not available");
  }

  const result = await database.insert(flightTracking).values({
    flightId: data.flightId,
    latitude: data.latitude,
    longitude: data.longitude,
    altitude: data.altitude,
    heading: data.heading,
    groundSpeed: data.groundSpeed,
    phase: data.phase,
    estimatedArrival: data.estimatedArrival ?? null,
    temperature: data.temperature ?? null,
    windSpeed: data.windSpeed ?? null,
    windDirection: data.windDirection ?? null,
    turbulence: data.turbulence ?? null,
    distanceCovered: data.distanceCovered ?? null,
    distanceRemaining: data.distanceRemaining ?? null,
    progressPercent: data.progressPercent ?? null,
  });

  return { id: Number(result[0].insertId) };
}

/**
 * Get all currently active flights (for map view)
 */
export async function getActiveFlights(): Promise<
  Array<{
    flightId: number;
    flightNumber: string;
    origin: string;
    destination: string;
    position: FlightPosition;
  }>
> {
  const database = await getDb();
  if (!database) {
    throw new Error("Database not available");
  }

  // Get flights that are not completed or cancelled and have recent tracking data
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

  const activeTracking = await database
    .select({
      flightId: flightTracking.flightId,
      flightNumber: flights.flightNumber,
      originCode: sql<string>`origin.code`,
      destinationCode: sql<string>`dest.code`,
      latitude: flightTracking.latitude,
      longitude: flightTracking.longitude,
      altitude: flightTracking.altitude,
      heading: flightTracking.heading,
      groundSpeed: flightTracking.groundSpeed,
      phase: flightTracking.phase,
      estimatedArrival: flightTracking.estimatedArrival,
      temperature: flightTracking.temperature,
      windSpeed: flightTracking.windSpeed,
      windDirection: flightTracking.windDirection,
      turbulence: flightTracking.turbulence,
      distanceCovered: flightTracking.distanceCovered,
      distanceRemaining: flightTracking.distanceRemaining,
      progressPercent: flightTracking.progressPercent,
      recordedAt: flightTracking.recordedAt,
    })
    .from(flightTracking)
    .innerJoin(flights, eq(flightTracking.flightId, flights.id))
    .innerJoin(sql`airports as origin`, sql`${flights.originId} = origin.id`)
    .innerJoin(sql`airports as dest`, sql`${flights.destinationId} = dest.id`)
    .where(
      and(
        gte(flightTracking.recordedAt, tenMinutesAgo),
        eq(flights.status, "scheduled")
      )
    )
    .orderBy(desc(flightTracking.recordedAt));

  // Deduplicate by flightId (keep latest only)
  const seen = new Set<number>();
  const results: Array<{
    flightId: number;
    flightNumber: string;
    origin: string;
    destination: string;
    position: FlightPosition;
  }> = [];

  for (const row of activeTracking) {
    if (seen.has(row.flightId)) continue;
    seen.add(row.flightId);

    results.push({
      flightId: row.flightId,
      flightNumber: row.flightNumber,
      origin: row.originCode,
      destination: row.destinationCode,
      position: {
        latitude: Number(row.latitude),
        longitude: Number(row.longitude),
        altitude: row.altitude,
        heading: row.heading,
        groundSpeed: row.groundSpeed,
        phase: row.phase as FlightPhase,
        estimatedArrival: row.estimatedArrival,
        temperature: row.temperature,
        windSpeed: row.windSpeed,
        windDirection: row.windDirection,
        turbulence: row.turbulence as FlightPosition["turbulence"],
        distanceCovered: row.distanceCovered,
        distanceRemaining: row.distanceRemaining,
        progressPercent: row.progressPercent
          ? Number(row.progressPercent)
          : null,
        recordedAt: row.recordedAt,
      },
    });
  }

  return results;
}
