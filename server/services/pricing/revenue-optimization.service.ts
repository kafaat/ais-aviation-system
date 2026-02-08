/**
 * Revenue Optimization Service
 *
 * AI-driven revenue management that optimizes pricing to maximize:
 * - Total revenue per flight
 * - Load factor (seat utilization)
 * - Yield (revenue per passenger-kilometer)
 * - Balance between revenue and demand
 *
 * @module services/pricing/revenue-optimization.service
 */

import { getDb } from "../../db";
import {
  flights,
  bookings,
  revenueOptimizationLogs,
  priceElasticityData,
  pricingHistory,
} from "../../../drizzle/schema";
import { eq, and, gte, lte, sql, count, desc } from "drizzle-orm";
import { cacheService } from "../cache.service";
import { DemandForecastingService } from "./demand-forecasting.service";

// ============================================================================
// Types
// ============================================================================

export interface OptimizationResult {
  flightId: number;
  cabinClass: "economy" | "business";
  currentPrice: number;
  optimizedPrice: number;
  multiplier: number;
  expectedRevenueChange: number;
  expectedLoadFactorChange: number;
  confidence: number;
  factors: OptimizationFactors;
  recommendation: "increase" | "decrease" | "hold";
  optimizationGoal: string;
}

export interface OptimizationFactors {
  demandForecast: number;
  priceElasticity: number;
  competitorIndex: number;
  occupancyRate: number;
  daysUntilDeparture: number;
  historicalYield: number;
  seasonalFactor: number;
  segmentMix: Record<string, number>;
}

export interface RevenueMetrics {
  totalRevenue: number;
  avgYield: number;
  loadFactor: number;
  revenuePerSeat: number;
  revenuePerFlight: number;
  optimizationImpact: number;
  periodStart: Date;
  periodEnd: Date;
}

export interface ElasticityEstimate {
  originId: number;
  destinationId: number;
  cabinClass: "economy" | "business";
  elasticity: number;
  optimalPrice: number;
  sampleSize: number;
  confidence: number;
}

type OptGoal =
  | "maximize_revenue"
  | "maximize_load_factor"
  | "maximize_yield"
  | "balance";

// ============================================================================
// Constants
// ============================================================================

const OPTIMIZATION_CACHE_TTL = 15 * 60; // 15 minutes
const MIN_ELASTICITY_SAMPLES = 10;
const DEFAULT_ELASTICITY = -1.2; // Typical airline demand elasticity
const MAX_PRICE_CHANGE_PCT = 0.3; // Max 30% change per optimization
const MIN_MULTIPLIER = 0.7;
const MAX_MULTIPLIER = 2.5;

// ============================================================================
// Main Optimization
// ============================================================================

/**
 * Optimize price for a specific flight and cabin class
 */
export async function optimizeFlightPrice(
  flightId: number,
  cabinClass: "economy" | "business",
  goal: OptGoal = "balance"
): Promise<OptimizationResult> {
  const cacheKey = `optimize:${flightId}:${cabinClass}:${goal}`;
  const cached = await cacheService.get<OptimizationResult>(cacheKey);
  if (cached) return cached;

  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const flight = await db.query.flights.findFirst({
    where: eq(flights.id, flightId),
  });
  if (!flight) throw new Error(`Flight ${flightId} not found`);

  const currentPrice =
    cabinClass === "economy" ? flight.economyPrice : flight.businessPrice;

  // 1. Get demand forecast
  const forecasts = await DemandForecastingService.forecastFlightDemand(
    flightId,
    cabinClass,
    7
  );
  const nearTermForecast = forecasts[0];
  const demandForecast = nearTermForecast?.predictedDemand || 0;

  // 2. Estimate price elasticity for this route
  const elasticity = await estimateRouteElasticity(
    flight.originId,
    flight.destinationId,
    cabinClass
  );

  // 3. Calculate occupancy
  const totalSeats =
    cabinClass === "economy" ? flight.economySeats : flight.businessSeats;
  const available =
    cabinClass === "economy"
      ? flight.economyAvailable
      : flight.businessAvailable;
  const occupancyRate = totalSeats > 0 ? 1 - available / totalSeats : 0;

  // 4. Days until departure
  const daysUntilDep = Math.floor(
    (flight.departureTime.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );

  // 5. Historical yield for the route
  const historicalYield = await getHistoricalYield(
    flight.originId,
    flight.destinationId,
    cabinClass
  );

  // 6. Seasonal factor
  const month = flight.departureTime.getMonth() + 1;
  const seasonalFactor = getSeasonalFactor(month);

  // 7. Build factors
  const factors: OptimizationFactors = {
    demandForecast,
    priceElasticity: elasticity.elasticity,
    competitorIndex: 1.0, // Future: external competitor data
    occupancyRate,
    daysUntilDeparture: daysUntilDep,
    historicalYield,
    seasonalFactor,
    segmentMix: {},
  };

  // 8. Calculate optimal price based on goal
  const optimizedPrice = calculateOptimalPrice(
    currentPrice,
    factors,
    goal,
    elasticity
  );

  const multiplier = currentPrice > 0 ? optimizedPrice / currentPrice : 1;
  const priceChange = optimizedPrice - currentPrice;

  // 9. Estimate revenue impact
  const expectedDemandChange =
    elasticity.elasticity * ((optimizedPrice - currentPrice) / currentPrice);
  const currentRevenue =
    currentPrice * (available > 0 ? totalSeats - available : 0);
  const expectedNewDemand = demandForecast * (1 + expectedDemandChange);
  const expectedRevenueChange =
    optimizedPrice * Math.min(expectedNewDemand, available) -
    currentPrice * Math.min(demandForecast, available);

  const recommendation: "increase" | "decrease" | "hold" =
    priceChange > currentPrice * 0.02
      ? "increase"
      : priceChange < -currentPrice * 0.02
        ? "decrease"
        : "hold";

  const result: OptimizationResult = {
    flightId,
    cabinClass,
    currentPrice,
    optimizedPrice,
    multiplier: Math.round(multiplier * 10000) / 10000,
    expectedRevenueChange: Math.round(expectedRevenueChange),
    expectedLoadFactorChange: Math.round(expectedDemandChange * 10000) / 10000,
    confidence: elasticity.confidence,
    factors,
    recommendation,
    optimizationGoal: goal,
  };

  await cacheService.set(cacheKey, result, OPTIMIZATION_CACHE_TTL);

  // Log the optimization
  await logOptimization(result);

  return result;
}

/**
 * Batch optimize all upcoming flights
 */
export async function optimizeUpcomingFlights(
  goal: OptGoal = "balance",
  daysAhead: number = 30
): Promise<OptimizationResult[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + daysAhead);

  const upcomingFlights = await db.query.flights.findMany({
    where: and(
      gte(flights.departureTime, new Date()),
      lte(flights.departureTime, cutoff),
      eq(flights.status, "scheduled")
    ),
  });

  const results: OptimizationResult[] = [];
  for (const flight of upcomingFlights) {
    for (const cabin of ["economy", "business"] as const) {
      try {
        const result = await optimizeFlightPrice(flight.id, cabin, goal);
        if (result.recommendation !== "hold") {
          results.push(result);
        }
      } catch {
        // Skip flights that can't be optimized
      }
    }
  }

  return results.sort(
    (a, b) =>
      Math.abs(b.expectedRevenueChange) - Math.abs(a.expectedRevenueChange)
  );
}

/**
 * Get revenue metrics for a period
 */
export async function getRevenueMetrics(
  startDate: Date,
  endDate: Date,
  airlineId?: number
): Promise<RevenueMetrics> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const conditions = [
    gte(flights.departureTime, startDate),
    lte(flights.departureTime, endDate),
  ];

  if (airlineId) {
    conditions.push(eq(flights.airlineId, airlineId));
  }

  // Total revenue from confirmed bookings in period
  const revenueData = await db
    .select({
      totalRevenue: sql<number>`COALESCE(SUM(${bookings.totalAmount}), 0)`.as(
        "totalRevenue"
      ),
      bookingCount: count(bookings.id).as("bookingCount"),
      passengerCount:
        sql<number>`COALESCE(SUM(${bookings.numberOfPassengers}), 0)`.as(
          "passengerCount"
        ),
    })
    .from(bookings)
    .innerJoin(flights, eq(flights.id, bookings.flightId))
    .where(and(...conditions, eq(bookings.status, "confirmed")));

  // Flight counts and capacity
  const flightData = await db
    .select({
      flightCount: count(flights.id).as("flightCount"),
      totalSeats:
        sql<number>`COALESCE(SUM(${flights.economySeats} + ${flights.businessSeats}), 0)`.as(
          "totalSeats"
        ),
      totalAvailable:
        sql<number>`COALESCE(SUM(${flights.economyAvailable} + ${flights.businessAvailable}), 0)`.as(
          "totalAvailable"
        ),
    })
    .from(flights)
    .where(and(...conditions));

  // Optimization impact
  const optData = await db
    .select({
      totalImpact:
        sql<number>`COALESCE(SUM(CAST(${revenueOptimizationLogs.actualRevenueImpact} AS DECIMAL(12,2))), 0)`.as(
          "totalImpact"
        ),
    })
    .from(revenueOptimizationLogs)
    .where(
      and(
        gte(revenueOptimizationLogs.createdAt, startDate),
        lte(revenueOptimizationLogs.createdAt, endDate),
        eq(revenueOptimizationLogs.status, "applied")
      )
    );

  const rev = revenueData[0];
  const flt = flightData[0];

  const totalRevenue = Number(rev?.totalRevenue) || 0;
  const bookingCount = Number(rev?.bookingCount) || 0;
  const passengerCount = Number(rev?.passengerCount) || 0;
  const flightCount = Number(flt?.flightCount) || 1;
  const totalSeats = Number(flt?.totalSeats) || 1;
  const totalAvailable = Number(flt?.totalAvailable) || 0;
  const filledSeats = totalSeats - totalAvailable;

  return {
    totalRevenue,
    avgYield: passengerCount > 0 ? totalRevenue / passengerCount : 0,
    loadFactor: totalSeats > 0 ? filledSeats / totalSeats : 0,
    revenuePerSeat: filledSeats > 0 ? totalRevenue / filledSeats : 0,
    revenuePerFlight: flightCount > 0 ? totalRevenue / flightCount : 0,
    optimizationImpact: Number(optData[0]?.totalImpact) || 0,
    periodStart: startDate,
    periodEnd: endDate,
  };
}

/**
 * Apply an optimization recommendation (update flight price)
 */
export async function applyOptimization(
  logId: number,
  approvedBy: number
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const log = await db.query.revenueOptimizationLogs?.findFirst({
    where: eq(revenueOptimizationLogs.id, logId),
  });

  if (!log || log.status !== "suggested") {
    throw new Error("Optimization not found or not in suggested status");
  }

  // Update flight price
  const updateData =
    log.cabinClass === "economy"
      ? { economyPrice: log.optimizedPrice }
      : { businessPrice: log.optimizedPrice };

  await db.update(flights).set(updateData).where(eq(flights.id, log.flightId));

  // Mark as applied
  await db
    .update(revenueOptimizationLogs)
    .set({
      status: "applied",
      approvedBy,
      approvedAt: new Date(),
    })
    .where(eq(revenueOptimizationLogs.id, logId));

  // Invalidate caches
  await cacheService.del(`optimize:${log.flightId}:${log.cabinClass}:*`);

  return true;
}

// ============================================================================
// Price Elasticity Estimation
// ============================================================================

async function estimateRouteElasticity(
  originId: number,
  destinationId: number,
  cabinClass: "economy" | "business"
): Promise<ElasticityEstimate> {
  const cacheKey = `elasticity:${originId}:${destinationId}:${cabinClass}`;
  const cached = await cacheService.get<ElasticityEstimate>(cacheKey);
  if (cached) return cached;

  const db = await getDb();
  if (!db) {
    return {
      originId,
      destinationId,
      cabinClass,
      elasticity: DEFAULT_ELASTICITY,
      optimalPrice: 0,
      sampleSize: 0,
      confidence: 0.5,
    };
  }

  // Check for stored elasticity data
  const stored = await db.query.priceElasticityData?.findFirst({
    where: and(
      eq(priceElasticityData.originId, originId),
      eq(priceElasticityData.destinationId, destinationId),
      eq(priceElasticityData.cabinClass, cabinClass)
    ),
    orderBy: [desc(priceElasticityData.createdAt)],
  });

  if (stored && stored.sampleSize >= MIN_ELASTICITY_SAMPLES) {
    const result: ElasticityEstimate = {
      originId,
      destinationId,
      cabinClass,
      elasticity: parseFloat(stored.elasticity),
      optimalPrice: stored.optimalPrice || 0,
      sampleSize: stored.sampleSize,
      confidence: parseFloat(stored.rSquared || "0.5"),
    };
    await cacheService.set(cacheKey, result, OPTIMIZATION_CACHE_TTL);
    return result;
  }

  // Estimate from historical pricing data
  const elasticity = await computeElasticityFromHistory(
    originId,
    destinationId,
    cabinClass
  );

  await cacheService.set(cacheKey, elasticity, OPTIMIZATION_CACHE_TTL);
  return elasticity;
}

async function computeElasticityFromHistory(
  originId: number,
  destinationId: number,
  cabinClass: "economy" | "business"
): Promise<ElasticityEstimate> {
  const db = await getDb();
  if (!db) {
    return {
      originId,
      destinationId,
      cabinClass,
      elasticity: DEFAULT_ELASTICITY,
      optimalPrice: 0,
      sampleSize: 0,
      confidence: 0.3,
    };
  }

  const days180Ago = new Date();
  days180Ago.setDate(days180Ago.getDate() - 180);

  // Get price-demand pairs from pricing history
  const priceData = await db
    .select({
      basePrice: pricingHistory.basePrice,
      finalPrice: pricingHistory.finalPrice,
      occupancyRate: pricingHistory.occupancyRate,
    })
    .from(pricingHistory)
    .innerJoin(flights, eq(flights.id, pricingHistory.flightId))
    .where(
      and(
        eq(flights.originId, originId),
        eq(flights.destinationId, destinationId),
        eq(pricingHistory.cabinClass, cabinClass),
        gte(pricingHistory.createdAt, days180Ago)
      )
    )
    .limit(500);

  if (priceData.length < MIN_ELASTICITY_SAMPLES) {
    return {
      originId,
      destinationId,
      cabinClass,
      elasticity: DEFAULT_ELASTICITY,
      optimalPrice: 0,
      sampleSize: priceData.length,
      confidence: 0.3,
    };
  }

  // Simple linear regression: ln(demand) = a + b * ln(price)
  // b is the price elasticity of demand
  const points = priceData
    .filter(d => d.finalPrice > 0 && d.occupancyRate)
    .map(d => ({
      lnPrice: Math.log(d.finalPrice),
      lnDemand: Math.log(Math.max(0.01, parseFloat(d.occupancyRate!))),
    }));

  if (points.length < MIN_ELASTICITY_SAMPLES) {
    return {
      originId,
      destinationId,
      cabinClass,
      elasticity: DEFAULT_ELASTICITY,
      optimalPrice: 0,
      sampleSize: points.length,
      confidence: 0.3,
    };
  }

  // Compute regression
  const n = points.length;
  const sumX = points.reduce((s, p) => s + p.lnPrice, 0);
  const sumY = points.reduce((s, p) => s + p.lnDemand, 0);
  const sumXY = points.reduce((s, p) => s + p.lnPrice * p.lnDemand, 0);
  const sumX2 = points.reduce((s, p) => s + p.lnPrice * p.lnPrice, 0);
  const sumY2 = points.reduce((s, p) => s + p.lnDemand * p.lnDemand, 0);

  const denominator = n * sumX2 - sumX * sumX;
  const elasticity =
    denominator !== 0
      ? (n * sumXY - sumX * sumY) / denominator
      : DEFAULT_ELASTICITY;

  // R-squared
  const ssTotal = sumY2 - (sumY * sumY) / n;
  const ssResidual =
    sumY2 -
    ((n * sumXY - sumX * sumY) * (n * sumXY - sumX * sumY)) /
      (n * (n * sumX2 - sumX * sumX));
  const rSquared = ssTotal > 0 ? Math.max(0, 1 - ssResidual / ssTotal) : 0;

  // Optimal price: where marginal revenue = 0
  // For constant elasticity: P* = MC * e / (e + 1) where e is elasticity
  // Since we don't know MC, approximate as basePrice
  const avgBasePrice =
    priceData.reduce((s, d) => s + d.basePrice, 0) / priceData.length;
  const optimalPrice =
    elasticity < -1
      ? Math.round(avgBasePrice * (elasticity / (elasticity + 1)))
      : avgBasePrice;

  // Store for future use
  try {
    await db.insert(priceElasticityData).values({
      originId,
      destinationId,
      cabinClass,
      elasticity: elasticity.toString(),
      sampleSize: n,
      rSquared: rSquared.toString(),
      minPrice: Math.min(...priceData.map(d => d.finalPrice)),
      maxPrice: Math.max(...priceData.map(d => d.finalPrice)),
      optimalPrice: Math.max(0, optimalPrice),
      periodStart: days180Ago,
      periodEnd: new Date(),
    });
  } catch {
    // Non-critical
  }

  return {
    originId,
    destinationId,
    cabinClass,
    elasticity: Math.max(-5, Math.min(-0.1, elasticity)), // Bound to reasonable range
    optimalPrice: Math.max(0, optimalPrice),
    sampleSize: n,
    confidence: rSquared,
  };
}

// ============================================================================
// Price Optimization Algorithm
// ============================================================================

function calculateOptimalPrice(
  currentPrice: number,
  factors: OptimizationFactors,
  goal: OptGoal,
  elasticity: ElasticityEstimate
): number {
  let priceAdjustment = 0;

  switch (goal) {
    case "maximize_revenue": {
      // Revenue = Price × Demand(Price)
      // With constant elasticity: optimal when |elasticity| = 1
      // If |e| > 1 (elastic), lower price to increase revenue
      // If |e| < 1 (inelastic), raise price
      const e = Math.abs(elasticity.elasticity);
      if (e > 1.5) {
        priceAdjustment = -0.1; // Lower price
      } else if (e < 0.8) {
        priceAdjustment = 0.15; // Raise price
      } else {
        priceAdjustment = 0; // Near optimal
      }
      break;
    }

    case "maximize_load_factor": {
      // Focus on filling seats
      if (factors.occupancyRate < 0.5) {
        priceAdjustment = -0.2; // Significant discount
      } else if (factors.occupancyRate < 0.7) {
        priceAdjustment = -0.1;
      } else if (factors.occupancyRate > 0.9) {
        priceAdjustment = 0.1; // Near full, can increase
      }
      break;
    }

    case "maximize_yield": {
      // Revenue per passenger — maximize individual ticket value
      if (factors.occupancyRate > 0.7 && factors.daysUntilDeparture < 14) {
        priceAdjustment = 0.2; // High demand, close to departure
      } else if (factors.demandForecast > 0) {
        priceAdjustment = 0.1;
      }
      break;
    }

    case "balance":
    default: {
      // Balance between revenue and load factor
      const loadWeight = factors.occupancyRate < 0.5 ? 0.6 : 0.3;
      const revenueWeight = 1 - loadWeight;

      // Load factor component
      const loadAdjustment =
        factors.occupancyRate < 0.3
          ? -0.15
          : factors.occupancyRate < 0.5
            ? -0.08
            : factors.occupancyRate > 0.85
              ? 0.15
              : 0;

      // Revenue component
      const e = Math.abs(elasticity.elasticity);
      const revenueAdjustment = e > 1.5 ? -0.08 : e < 0.8 ? 0.1 : 0;

      priceAdjustment =
        loadAdjustment * loadWeight + revenueAdjustment * revenueWeight;
      break;
    }
  }

  // Apply time-urgency modifier
  if (factors.daysUntilDeparture < 3) {
    priceAdjustment += 0.15; // Last minute premium
  } else if (factors.daysUntilDeparture > 60) {
    priceAdjustment -= 0.05; // Early booking incentive
  }

  // Apply seasonal modifier
  priceAdjustment += (factors.seasonalFactor - 1) * 0.5;

  // Cap the change
  priceAdjustment = Math.max(
    -MAX_PRICE_CHANGE_PCT,
    Math.min(MAX_PRICE_CHANGE_PCT, priceAdjustment)
  );

  const optimizedPrice = Math.round(currentPrice * (1 + priceAdjustment));

  // Ensure within global bounds
  return Math.round(
    Math.max(
      currentPrice * MIN_MULTIPLIER,
      Math.min(currentPrice * MAX_MULTIPLIER, optimizedPrice)
    )
  );
}

function getSeasonalFactor(month: number): number {
  const factors: Record<number, number> = {
    1: 1.2,
    2: 0.9,
    3: 0.9,
    4: 1.0,
    5: 1.0,
    6: 1.2,
    7: 1.4,
    8: 1.4,
    9: 1.1,
    10: 1.0,
    11: 0.9,
    12: 1.3,
  };
  return factors[month] || 1.0;
}

async function getHistoricalYield(
  originId: number,
  destinationId: number,
  cabinClass: "economy" | "business"
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const days90Ago = new Date();
  days90Ago.setDate(days90Ago.getDate() - 90);

  try {
    const [result] = await db
      .select({
        avgYield:
          sql<number>`AVG(${bookings.totalAmount} / NULLIF(${bookings.numberOfPassengers}, 0))`.as(
            "avgYield"
          ),
      })
      .from(bookings)
      .innerJoin(flights, eq(flights.id, bookings.flightId))
      .where(
        and(
          eq(flights.originId, originId),
          eq(flights.destinationId, destinationId),
          eq(bookings.cabinClass, cabinClass),
          eq(bookings.status, "confirmed"),
          gte(bookings.createdAt, days90Ago)
        )
      );

    return Number(result?.avgYield) || 0;
  } catch {
    return 0;
  }
}

// ============================================================================
// Logging
// ============================================================================

async function logOptimization(result: OptimizationResult): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    await db.insert(revenueOptimizationLogs).values({
      flightId: result.flightId,
      cabinClass: result.cabinClass,
      previousPrice: result.currentPrice,
      optimizedPrice: result.optimizedPrice,
      priceChange: (
        ((result.optimizedPrice - result.currentPrice) / result.currentPrice) *
        100
      ).toString(),
      factors: JSON.stringify(result.factors),
      optimizationGoal: result.optimizationGoal as OptGoal,
      expectedRevenueImpact: result.expectedRevenueChange.toString(),
      status: "suggested",
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "optimization_log_error",
        error: error instanceof Error ? error.message : "Unknown",
      })
    );
  }
}

// ============================================================================
// Exports
// ============================================================================

export const RevenueOptimizationService = {
  optimizeFlightPrice,
  optimizeUpcomingFlights,
  getRevenueMetrics,
  applyOptimization,
};

export default RevenueOptimizationService;
