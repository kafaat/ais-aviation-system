import {
  readFlightCosts,
  costTotal,
} from "../flight-economics-evidence.service";
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
  ProfitabilityAnalysis,
} from "./types";

const log = createServiceLogger("intelligence:economics");

// ============================================================================
// Constants
// ============================================================================

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
      const facts = await readFlightCosts(flown.map(f => f.id));
      const allCosts = flown.length > 0 && flown.every(f => facts.has(f.id));
      const allRevenue =
        allCosts &&
        flown.every(
          f => facts.get(f.id)!.payload.recognizedRevenueMinor !== null
        );
      const totalCost = allCosts
        ? flown.reduce(
            (sum, f) => sum + costTotal(facts.get(f.id)!.payload),
            0
          ) / 100
        : null;
      const totalRevenue = allRevenue
        ? flown.reduce(
            (sum, f) => sum + facts.get(f.id)!.payload.recognizedRevenueMinor!,
            0
          ) / 100
        : null;
      const routes: RouteEconomics[] = activity.map(route => {
        const fs = flown.filter(
          f =>
            f.originId === route.originId &&
            f.destinationId === route.destinationId
        );
        const complete = fs.every(f => facts.has(f.id));
        const cost = complete
          ? fs.reduce(
              (sum, f) => sum + costTotal(facts.get(f.id)!.payload),
              0
            ) / 100
          : null;
        const revenue =
          complete &&
          fs.every(
            f => facts.get(f.id)!.payload.recognizedRevenueMinor !== null
          )
            ? fs.reduce(
                (sum, f) =>
                  sum + facts.get(f.id)!.payload.recognizedRevenueMinor!,
                0
              ) / 100
            : null;
        const ask = complete
          ? fs.reduce(
              (sum, f) =>
                sum +
                (f.economySeats + f.businessSeats) *
                  facts.get(f.id)!.payload.routeDistanceKm,
              0
            )
          : null;
        return {
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
            rask: ask && revenue !== null ? revenue / ask : null,
            cask: ask && cost !== null ? cost / ask : null,
            yield: null,
            breakEvenLoadFactor: null,
            profitMargin:
              revenue && cost !== null
                ? ((revenue - cost) / revenue) * 100
                : null,
            contributionMargin: null,
          },
          trend: "unknown",
          forecast: { nextMonth: null, nextQuarter: null, confidence: 0 },
        };
      });
      reasoning.push(
        `Measured ${flown.length} completed flights and ${paid.length} paid bookings; capacity counted once per flight and passengers per segment.`
      );
      reasoning.push(
        `Closed cost evidence covers ${facts.size}/${flown.length} flights. Only complete source snapshots populate cost and recognized-revenue metrics. Forecasts remain unavailable.`
      );
      const result: ProfitabilityAnalysis = {
        totalRevenue,
        totalCost,
        operatingProfit:
          totalCost !== null && totalRevenue !== null
            ? totalRevenue - totalCost
            : null,
        netMargin:
          totalRevenue && totalCost !== null
            ? ((totalRevenue - totalCost) / totalRevenue) * 100
            : null,
        roi: null,
        routes,
        unprofitableRoutes: [],
        topPerformers: [],
        recommendations,
        dataQuality: {
          missing: [
            ...(!allCosts ? ["closed_flight_cost_and_distance"] : []),
            ...(!allRevenue ? ["recognized_revenue"] : []),
            "validated_forecast",
            ...(activity.some(r => r.revenue == null)
              ? ["historical_segment_revenue_allocation"]
              : []),
          ],
          revenueAllocation: `Measured booking revenue uses stored invoice allocations. Profitability uses closed source accounting snapshots: ${[...facts.values()].map(f => f.evidenceId).join(",") || "none"}.`,
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
        totalRevenue: null,
        totalCost: null,
        operatingProfit: null,
        netMargin: null,
        roi: null,
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
