/**
 * Economics Agent
 *
 * Autonomous agent that analyzes route profitability, calculates CASK/RASK metrics,
 * forecasts costs, and generates actionable economic recommendations.
 *
 * Capabilities:
 * - Route-level profitability analysis (RASK, CASK, yield, load factor)
 * - Break-even load factor calculation
 * - Cost structure decomposition
 * - Profitability trend detection
 * - Revenue leakage identification
 * - Route optimization recommendations
 *
 * @module services/intelligence/economics.agent
 */

import { getDb } from "../../db";
import {
  flights,
  bookings,
  airports,
  bookingSegments,
} from "../../../drizzle/schema";
import { eq, and, gte, lte, inArray, or } from "drizzle-orm";
import { createServiceLogger } from "../../_core/logger";
import type {
  AgentResult,
  AgentRecommendation,
  IntelligenceContext,
  RouteEconomics,
  CostBreakdown,
  ProfitabilityAnalysis,
} from "./types";

const log = createServiceLogger("intelligence:economics");

// ============================================================================
// Constants
// ============================================================================

/** Average distance for Saudi domestic routes (km) */
const AVG_DOMESTIC_DISTANCE_KM = 850;

/** Average distance for international routes (km) */
const _AVG_INTERNATIONAL_DISTANCE_KM = 3200;

/** Standard cost breakdown percentages for airline operations */
const COST_STRUCTURE = {
  fuel: 0.3,
  crew: 0.18,
  maintenance: 0.12,
  airport: 0.15,
  navigation: 0.06,
  insurance: 0.04,
  overhead: 0.15,
} as const;

/** Aggregate capacities independently from booking multiplicity and retain unknown allocations. */
export function summarizeRouteActivity(
  flightRows: Array<{
    id: number;
    originId: number;
    destinationId: number;
    economySeats: number;
    businessSeats: number;
  }>,
  bookingRows: Array<{
    id: number;
    flightId: number;
    numberOfPassengers: number;
    totalAmount: number;
  }>,
  segments: Array<{
    bookingId: number;
    flightId: number;
    segmentAmount: number | null;
  }>
) {
  const routes = new Map<
    string,
    {
      originId: number;
      destinationId: number;
      flightCount: number;
      totalSeats: number;
      bookedSeats: number;
      revenue: number | null;
    }
  >();
  for (const flight of flightRows) {
    const key = `${flight.originId}-${flight.destinationId}`;
    const route = routes.get(key) ?? {
      originId: flight.originId,
      destinationId: flight.destinationId,
      flightCount: 0,
      totalSeats: 0,
      bookedSeats: 0,
      revenue: 0,
    };
    route.flightCount++;
    route.totalSeats += flight.economySeats + flight.businessSeats;
    for (const booking of bookingRows) {
      const itinerary = segments.filter(s => s.bookingId === booking.id);
      const leg = itinerary.find(s => s.flightId === flight.id);
      if (itinerary.length ? !leg : booking.flightId !== flight.id) continue;
      route.bookedSeats += booking.numberOfPassengers;
      const amount = itinerary.length
        ? leg!.segmentAmount
        : booking.totalAmount;
      route.revenue =
        route.revenue == null || amount == null ? null : route.revenue + amount;
    }
    routes.set(key, route);
  }
  return [...routes.values()];
}

// ============================================================================
// Economics Agent
// ============================================================================

export class EconomicsAgent {
  private readonly agentId = "economics-agent-v1";
  private readonly agentName = "Economics Agent";

  /**
   * Run full profitability analysis
   */
  async analyze(
    context: IntelligenceContext
  ): Promise<AgentResult<ProfitabilityAnalysis>> {
    const startTime = Date.now();
    const reasoning: string[] = [];
    const recommendations: AgentRecommendation[] = [];

    try {
      const db = await getDb();
      if (!db) {
        return this.errorResult("Database not available", startTime);
      }

      // Determine date range
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const startDate = context.scope.dateRange?.start || thirtyDaysAgo;
      const endDate = context.scope.dateRange?.end || now;

      reasoning.push(
        `Analyzing period: ${startDate.toISOString().split("T")[0]} to ${endDate.toISOString().split("T")[0]}`
      );

      // Read each flight once; never SUM capacity across a one-to-many booking join.
      const flown = await db
        .select()
        .from(flights)
        .where(
          and(
            gte(flights.departureTime, startDate),
            lte(flights.departureTime, endDate),
            eq(flights.status, "completed"),
            context.scope.flightIds?.length
              ? inArray(flights.id, context.scope.flightIds)
              : undefined,
            context.scope.airlineIds?.length
              ? inArray(flights.airlineId, context.scope.airlineIds)
              : undefined
          )
        );
      const flightIds = flown.map(f => f.id);
      const matchingSegments = flightIds.length
        ? await db
            .select()
            .from(bookingSegments)
            .where(inArray(bookingSegments.flightId, flightIds))
        : [];
      const segmentBookingIds = [
        ...new Set(matchingSegments.map(s => s.bookingId)),
      ];
      const paid = flightIds.length
        ? await db
            .select()
            .from(bookings)
            .where(
              and(
                eq(bookings.paymentStatus, "paid"),
                inArray(bookings.status, ["confirmed", "completed"]),
                or(
                  inArray(bookings.flightId, flightIds),
                  segmentBookingIds.length
                    ? inArray(bookings.id, segmentBookingIds)
                    : undefined
                )
              )
            )
        : [];
      const segments = paid.length
        ? await db
            .select()
            .from(bookingSegments)
            .where(
              inArray(
                bookingSegments.bookingId,
                paid.map(b => b.id)
              )
            )
        : [];
      const airportList = await db
        .select({ id: airports.id, code: airports.code })
        .from(airports);
      const airportMap = new Map(airportList.map(a => [a.id, a.code]));
      const activity = summarizeRouteActivity(flown, paid, segments);
      const routes: RouteEconomics[] = activity.map(route => ({
        routeId: `${route.originId}-${route.destinationId}`,
        origin: airportMap.get(route.originId) ?? `APT-${route.originId}`,
        destination:
          airportMap.get(route.destinationId) ?? `APT-${route.destinationId}`,
        measured: {
          flights: route.flightCount,
          availableSeats: route.totalSeats,
          bookedSeats: route.bookedSeats,
          revenue: route.revenue == null ? null : route.revenue / 100,
        },
        metrics: {
          loadFactor: route.totalSeats
            ? Math.round((route.bookedSeats / route.totalSeats) * 1000) / 10
            : 0,
          rask: null,
          cask: null,
          yield: null,
          breakEvenLoadFactor: null,
          profitMargin: null,
          contributionMargin: null,
        },
        trend: "unknown",
        forecast: { nextMonth: null, nextQuarter: null, confidence: 0 },
      }));
      reasoning.push(
        `Measured ${flown.length} completed flights and ${paid.length} paid bookings; capacity counted once per flight and passengers per segment.`
      );
      reasoning.push(
        "Distance, operating costs and a validated forecasting model are absent. Profitability, RASK/CASK and forecasts are unavailable; no route closure or automatic price action is inferred."
      );
      const result: ProfitabilityAnalysis = {
        totalRevenue: activity.some(r => r.revenue == null)
          ? null
          : activity.reduce((sum, r) => sum + (r.revenue ?? 0), 0) / 100,
        totalCost: null,
        operatingProfit: null,
        netMargin: null,
        roi: null,
        routes,
        unprofitableRoutes: [],
        topPerformers: [],
        recommendations,
        dataQuality: {
          missing: [
            "route_distance",
            "operating_cost_ledger",
            "validated_forecast",
            ...(activity.some(r => r.revenue == null)
              ? ["historical_segment_revenue_allocation"]
              : []),
          ],
          revenueAllocation:
            "Stored itinerary quote allocation; historical missing allocations remain unknown",
        },
      };
      const confidence = 0; // No evidence supporting a profitability prediction.
      log.info(
        {
          event: "economics_analysis_complete",
          routeCount: routes.length,
          unprofitableCount: result.unprofitableRoutes.length,
          recommendationCount: recommendations.length,
          executionTimeMs: Date.now() - startTime,
        },
        "Economics analysis completed"
      );

      return {
        agentId: this.agentId,
        agentName: this.agentName,
        timestamp: new Date(),
        executionTimeMs: Date.now() - startTime,
        status: "completed",
        confidence,
        confidenceLevel:
          confidence > 0.8 ? "high" : confidence > 0.6 ? "medium" : "low",
        data: result,
        reasoning,
        recommendations,
      };
    } catch (error) {
      log.error(
        { error, event: "economics_analysis_failed" },
        "Economics analysis failed"
      );
      return this.errorResult(
        error instanceof Error ? error.message : "Unknown error",
        startTime
      );
    }
  }

  /**
   * Get cost breakdown for a specific route
   */
  estimateRouteCost(totalRevenue: number, loadFactor: number): CostBreakdown {
    const estimatedTotal = totalRevenue * 0.78; // ~22% average airline margin

    return {
      fuel: estimatedTotal * COST_STRUCTURE.fuel,
      crew: estimatedTotal * COST_STRUCTURE.crew,
      maintenance: estimatedTotal * COST_STRUCTURE.maintenance,
      airport: estimatedTotal * COST_STRUCTURE.airport,
      navigation: estimatedTotal * COST_STRUCTURE.navigation,
      insurance: estimatedTotal * COST_STRUCTURE.insurance,
      overhead: estimatedTotal * COST_STRUCTURE.overhead,
      total: estimatedTotal,
      perSeat: loadFactor > 0 ? estimatedTotal / (loadFactor * 180) : 0, // Assume A320 with 180 seats
      perKm: estimatedTotal / AVG_DOMESTIC_DISTANCE_KM,
    };
  }

  private errorResult(
    message: string,
    startTime: number
  ): AgentResult<ProfitabilityAnalysis> {
    return {
      agentId: this.agentId,
      agentName: this.agentName,
      timestamp: new Date(),
      executionTimeMs: Date.now() - startTime,
      status: "failed",
      confidence: 0,
      confidenceLevel: "low",
      data: {
        totalRevenue: 0,
        totalCost: 0,
        operatingProfit: 0,
        netMargin: 0,
        roi: 0,
        routes: [],
        unprofitableRoutes: [],
        topPerformers: [],
        recommendations: [],
      },
      reasoning: [],
      recommendations: [],
      errors: [message],
    };
  }
}

export const economicsAgent = new EconomicsAgent();
