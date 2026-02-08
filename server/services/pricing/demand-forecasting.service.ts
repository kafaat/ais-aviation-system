/**
 * AI Demand Forecasting Service
 *
 * Uses statistical and ML techniques to predict flight demand:
 * - Time-series analysis with exponential smoothing
 * - Feature-based regression (day-of-week, seasonality, events)
 * - Historical booking velocity patterns
 * - Confidence intervals for predictions
 *
 * @module services/pricing/demand-forecasting.service
 */

import { getDb } from "../../db";
import {
  bookings,
  flights,
  demandPredictions,
  aiPricingModels,
  pricingHistory,
} from "../../../drizzle/schema";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { cacheService } from "../cache.service";

// ============================================================================
// Types
// ============================================================================

export interface DemandFeatures {
  dayOfWeek: number; // 0-6
  monthOfYear: number; // 1-12
  daysUntilDeparture: number;
  isWeekend: boolean;
  isHoliday: boolean;
  historicalAvgDemand: number;
  recentBookingVelocity: number;
  occupancyRate: number;
  priceLevel: number; // normalized 0-1
  routePopularity: number; // normalized 0-1
  seasonalIndex: number;
}

export interface DemandForecast {
  flightId: number;
  date: Date;
  cabinClass: "economy" | "business";
  predictedDemand: number;
  confidenceLower: number;
  confidenceUpper: number;
  confidenceLevel: number;
  recommendedPrice: number;
  recommendedMultiplier: number;
  featureImportances: Record<string, number>;
  modelVersion: string;
}

export interface ForecastAccuracy {
  mae: number; // Mean Absolute Error
  rmse: number; // Root Mean Square Error
  mape: number; // Mean Absolute Percentage Error
  r2: number; // R-squared
  sampleCount: number;
}

interface HistoricalDataPoint {
  date: Date;
  demand: number;
  price: number;
  occupancy: number;
}

// ============================================================================
// Constants
// ============================================================================

const FORECAST_CACHE_TTL = 10 * 60; // 10 minutes
const SMOOTHING_ALPHA = 0.3; // Exponential smoothing parameter
const TREND_BETA = 0.1; // Trend smoothing parameter
const SEASONAL_GAMMA = 0.2; // Seasonal smoothing parameter
const SEASONAL_PERIOD = 7; // Weekly seasonality
const CONFIDENCE_Z = 1.96; // 95% confidence interval

// Feature weights for demand prediction
const FEATURE_WEIGHTS: Record<string, number> = {
  historicalAvgDemand: 0.25,
  recentBookingVelocity: 0.2,
  dayOfWeek: 0.1,
  seasonalIndex: 0.15,
  daysUntilDeparture: 0.1,
  occupancyRate: 0.08,
  priceLevel: 0.07,
  routePopularity: 0.05,
};

// ============================================================================
// Main Forecasting Service
// ============================================================================

/**
 * Generate demand forecast for a specific flight
 */
export async function forecastFlightDemand(
  flightId: number,
  cabinClass: "economy" | "business",
  horizonDays: number = 14
): Promise<DemandForecast[]> {
  const cacheKey = `demand_forecast:${flightId}:${cabinClass}:${horizonDays}`;
  const cached = await cacheService.get<DemandForecast[]>(cacheKey);
  if (cached) return cached;

  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const flight = await db.query.flights.findFirst({
    where: eq(flights.id, flightId),
  });
  if (!flight) throw new Error(`Flight ${flightId} not found`);

  // 1. Gather historical data for the route
  const historicalData = await getRouteHistoricalData(
    flight.originId,
    flight.destinationId,
    cabinClass,
    90 // 90 days of history
  );

  // 2. Extract features for each forecast day
  const forecasts: DemandForecast[] = [];
  const now = new Date();

  for (let d = 0; d < horizonDays; d++) {
    const forecastDate = new Date(now);
    forecastDate.setDate(forecastDate.getDate() + d);

    const daysUntilDep = Math.floor(
      (flight.departureTime.getTime() - forecastDate.getTime()) /
        (1000 * 60 * 60 * 24)
    );

    if (daysUntilDep < 0) continue;

    const features = extractFeatures(
      flight,
      forecastDate,
      cabinClass,
      historicalData
    );

    const prediction = predictDemand(features, historicalData);

    const basePrice =
      cabinClass === "economy" ? flight.economyPrice : flight.businessPrice;

    const recommendedMultiplier = calculateOptimalMultiplier(
      prediction.predicted,
      features
    );
    const recommendedPrice = Math.round(basePrice * recommendedMultiplier);

    forecasts.push({
      flightId,
      date: forecastDate,
      cabinClass,
      predictedDemand: prediction.predicted,
      confidenceLower: prediction.lower,
      confidenceUpper: prediction.upper,
      confidenceLevel: 0.95,
      recommendedPrice,
      recommendedMultiplier,
      featureImportances: prediction.importances,
      modelVersion: "v1.0-holt-winters",
    });
  }

  await cacheService.set(cacheKey, forecasts, FORECAST_CACHE_TTL);

  // Store predictions in DB
  await storePredictions(forecasts);

  return forecasts;
}

/**
 * Forecast demand for a route (aggregated across flights)
 */
export async function forecastRouteDemand(
  originId: number,
  destinationId: number,
  cabinClass: "economy" | "business",
  startDate: Date,
  endDate: Date
): Promise<DemandForecast[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const routeFlights = await db.query.flights.findMany({
    where: and(
      eq(flights.originId, originId),
      eq(flights.destinationId, destinationId),
      gte(flights.departureTime, startDate),
      lte(flights.departureTime, endDate),
      eq(flights.status, "scheduled")
    ),
  });

  const allForecasts: DemandForecast[] = [];
  for (const flight of routeFlights) {
    const daysHorizon = Math.ceil(
      (flight.departureTime.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );
    if (daysHorizon <= 0) continue;

    try {
      const forecasts = await forecastFlightDemand(
        flight.id,
        cabinClass,
        Math.min(daysHorizon, 30)
      );
      allForecasts.push(...forecasts);
    } catch {
      // Skip flights that can't be forecast
    }
  }

  return allForecasts;
}

// ============================================================================
// Feature Extraction
// ============================================================================

function extractFeatures(
  flight: typeof flights.$inferSelect,
  date: Date,
  cabinClass: "economy" | "business",
  historicalData: HistoricalDataPoint[]
): DemandFeatures {
  const dayOfWeek = date.getDay();
  const monthOfYear = date.getMonth() + 1;
  const isWeekend = dayOfWeek === 4 || dayOfWeek === 5; // Thu-Fri (Saudi)
  const daysUntilDeparture = Math.floor(
    (flight.departureTime.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Historical average demand for this day-of-week
  const sameDayData = historicalData.filter(d => d.date.getDay() === dayOfWeek);
  const historicalAvgDemand =
    sameDayData.length > 0
      ? sameDayData.reduce((sum, d) => sum + d.demand, 0) / sameDayData.length
      : 0;

  // Recent booking velocity (last 7 data points)
  const recent = historicalData.slice(-7);
  const recentBookingVelocity =
    recent.length > 0
      ? recent.reduce((sum, d) => sum + d.demand, 0) / recent.length
      : 0;

  // Occupancy rate
  const totalSeats =
    cabinClass === "economy" ? flight.economySeats : flight.businessSeats;
  const available =
    cabinClass === "economy"
      ? flight.economyAvailable
      : flight.businessAvailable;
  const occupancyRate = totalSeats > 0 ? 1 - available / totalSeats : 0;

  // Price level (normalized)
  const basePrice =
    cabinClass === "economy" ? flight.economyPrice : flight.businessPrice;
  const avgPrice =
    historicalData.length > 0
      ? historicalData.reduce((sum, d) => sum + d.price, 0) /
        historicalData.length
      : basePrice;
  const priceLevel = avgPrice > 0 ? basePrice / avgPrice : 1;

  // Route popularity (normalized demand vs average)
  const overallAvg =
    historicalData.length > 0
      ? historicalData.reduce((sum, d) => sum + d.demand, 0) /
        historicalData.length
      : 1;
  const routePopularity = Math.min(overallAvg / 10, 1); // Normalize to 0-1

  // Seasonal index
  const seasonalIndex = calculateSeasonalIndex(monthOfYear, dayOfWeek);

  // Holiday detection (Saudi holidays approximate)
  const isHoliday = checkIsHoliday(date);

  return {
    dayOfWeek,
    monthOfYear,
    daysUntilDeparture,
    isWeekend,
    isHoliday,
    historicalAvgDemand,
    recentBookingVelocity,
    occupancyRate,
    priceLevel,
    routePopularity,
    seasonalIndex,
  };
}

// ============================================================================
// Prediction Algorithm (Holt-Winters + Feature Regression)
// ============================================================================

function predictDemand(
  features: DemandFeatures,
  historicalData: HistoricalDataPoint[]
): {
  predicted: number;
  lower: number;
  upper: number;
  importances: Record<string, number>;
} {
  // 1. Holt-Winters exponential smoothing for time-series component
  const hwPrediction = holtWintersPredict(historicalData.map(d => d.demand));

  // 2. Feature-based regression component
  const featureScore = calculateFeatureScore(features);

  // 3. Combine: weighted average of time-series and feature-based
  const timeSeriesWeight = Math.min(historicalData.length / 30, 0.6); // More history = more trust in time-series
  const featureWeight = 1 - timeSeriesWeight;

  const predicted = Math.max(
    0,
    hwPrediction.level * timeSeriesWeight + featureScore * featureWeight
  );

  // 4. Confidence interval based on historical variance
  const residuals = historicalData.map(d => d.demand - predicted);
  const variance =
    residuals.length > 1
      ? residuals.reduce((sum, r) => sum + r * r, 0) / (residuals.length - 1)
      : predicted * 0.2;
  const stdError = Math.sqrt(variance);

  const lower = Math.max(0, predicted - CONFIDENCE_Z * stdError);
  const upper = predicted + CONFIDENCE_Z * stdError;

  // 5. Feature importances
  const importances = calculateFeatureImportances(features);

  return {
    predicted: Math.round(predicted * 100) / 100,
    lower,
    upper,
    importances,
  };
}

/**
 * Holt-Winters triple exponential smoothing
 */
function holtWintersPredict(data: number[]): {
  level: number;
  trend: number;
  seasonal: number[];
} {
  if (data.length === 0) {
    return { level: 0, trend: 0, seasonal: new Array(SEASONAL_PERIOD).fill(1) };
  }

  if (data.length < SEASONAL_PERIOD * 2) {
    // Not enough data for seasonal decomposition, use simple exponential smoothing
    let level = data[0];
    let trend = 0;

    for (let i = 1; i < data.length; i++) {
      const prevLevel = level;
      level =
        SMOOTHING_ALPHA * data[i] + (1 - SMOOTHING_ALPHA) * (level + trend);
      trend = TREND_BETA * (level - prevLevel) + (1 - TREND_BETA) * trend;
    }

    return {
      level: level + trend,
      trend,
      seasonal: new Array(SEASONAL_PERIOD).fill(1),
    };
  }

  // Initialize seasonal indices
  const seasonal = new Array(SEASONAL_PERIOD).fill(0);
  const nSeasons = Math.floor(data.length / SEASONAL_PERIOD);

  for (let i = 0; i < SEASONAL_PERIOD; i++) {
    let sum = 0;
    for (let j = 0; j < nSeasons; j++) {
      sum += data[i + j * SEASONAL_PERIOD];
    }
    seasonal[i] = sum / nSeasons;
  }

  // Normalize seasonal to average 1
  const seasonalAvg = seasonal.reduce((a, b) => a + b, 0) / SEASONAL_PERIOD;
  for (let i = 0; i < SEASONAL_PERIOD; i++) {
    seasonal[i] = seasonalAvg > 0 ? seasonal[i] / seasonalAvg : 1;
  }

  // Holt-Winters iteration
  let level = data[0];
  let trend = (data[SEASONAL_PERIOD] - data[0]) / SEASONAL_PERIOD;

  for (let i = 1; i < data.length; i++) {
    const si = i % SEASONAL_PERIOD;
    const prevLevel = level;

    level =
      SMOOTHING_ALPHA * (data[i] / (seasonal[si] || 1)) +
      (1 - SMOOTHING_ALPHA) * (level + trend);

    trend = TREND_BETA * (level - prevLevel) + (1 - TREND_BETA) * trend;

    seasonal[si] =
      SEASONAL_GAMMA * (data[i] / (level || 1)) +
      (1 - SEASONAL_GAMMA) * seasonal[si];
  }

  // Forecast
  const nextSeason = data.length % SEASONAL_PERIOD;
  const forecastLevel = (level + trend) * (seasonal[nextSeason] || 1);

  return { level: forecastLevel, trend, seasonal };
}

/**
 * Calculate feature-based demand score
 */
function calculateFeatureScore(features: DemandFeatures): number {
  let score = 0;

  // Historical average is the base
  score += features.historicalAvgDemand * FEATURE_WEIGHTS.historicalAvgDemand;

  // Recent velocity shows trend
  score +=
    features.recentBookingVelocity * FEATURE_WEIGHTS.recentBookingVelocity;

  // Day of week pattern (normalize to 0-1 range then scale)
  const dowFactor = features.isWeekend ? 1.2 : 1.0;
  score += features.historicalAvgDemand * dowFactor * FEATURE_WEIGHTS.dayOfWeek;

  // Seasonal index
  score +=
    features.historicalAvgDemand *
    features.seasonalIndex *
    FEATURE_WEIGHTS.seasonalIndex;

  // Time to departure (closer = more urgent demand)
  const timeFactor =
    features.daysUntilDeparture > 30
      ? 0.7
      : features.daysUntilDeparture > 14
        ? 0.9
        : features.daysUntilDeparture > 7
          ? 1.1
          : 1.3;
  score +=
    features.historicalAvgDemand *
    timeFactor *
    FEATURE_WEIGHTS.daysUntilDeparture;

  // Occupancy drives scarcity-based demand
  score +=
    features.historicalAvgDemand *
    (1 + features.occupancyRate) *
    FEATURE_WEIGHTS.occupancyRate;

  // Price sensitivity (higher price = lower demand)
  const priceFactor =
    features.priceLevel > 1.2 ? 0.8 : features.priceLevel < 0.8 ? 1.2 : 1.0;
  score +=
    features.historicalAvgDemand * priceFactor * FEATURE_WEIGHTS.priceLevel;

  // Route popularity
  score +=
    features.historicalAvgDemand *
    features.routePopularity *
    FEATURE_WEIGHTS.routePopularity;

  // Holiday boost
  if (features.isHoliday) {
    score *= 1.3;
  }

  return Math.max(0, score);
}

function calculateFeatureImportances(
  features: DemandFeatures
): Record<string, number> {
  const total = Object.values(FEATURE_WEIGHTS).reduce((a, b) => a + b, 0);
  const importances: Record<string, number> = {};

  for (const [key, weight] of Object.entries(FEATURE_WEIGHTS)) {
    importances[key] = Math.round((weight / total) * 10000) / 10000;
  }

  // Adjust based on feature values
  if (features.isHoliday) {
    importances["holiday_boost"] = 0.15;
  }
  if (features.daysUntilDeparture < 7) {
    importances["urgency_factor"] = 0.12;
  }

  return importances;
}

// ============================================================================
// Optimal Price Calculation
// ============================================================================

function calculateOptimalMultiplier(
  predictedDemand: number,
  features: DemandFeatures
): number {
  // Revenue = Price * Demand (where demand is inversely related to price)
  // Optimal price maximizes Price * f(Price)
  // Using simple demand-price relationship with elasticity

  let multiplier = 1.0;

  // High demand => raise price
  if (predictedDemand > features.historicalAvgDemand * 1.5) {
    multiplier *= 1.3;
  } else if (predictedDemand > features.historicalAvgDemand * 1.2) {
    multiplier *= 1.15;
  } else if (predictedDemand < features.historicalAvgDemand * 0.5) {
    multiplier *= 0.8;
  } else if (predictedDemand < features.historicalAvgDemand * 0.8) {
    multiplier *= 0.9;
  }

  // Time urgency adjustment
  if (features.daysUntilDeparture < 3) {
    multiplier *= 1.4;
  } else if (features.daysUntilDeparture < 7) {
    multiplier *= 1.2;
  } else if (features.daysUntilDeparture > 60) {
    multiplier *= 0.85;
  }

  // Occupancy scarcity
  if (features.occupancyRate > 0.9) {
    multiplier *= 1.5;
  } else if (features.occupancyRate > 0.75) {
    multiplier *= 1.2;
  } else if (features.occupancyRate < 0.2) {
    multiplier *= 0.85;
  }

  // Cap multiplier
  return Math.min(2.5, Math.max(0.7, multiplier));
}

// ============================================================================
// Historical Data & Helpers
// ============================================================================

async function getRouteHistoricalData(
  originId: number,
  destinationId: number,
  cabinClass: "economy" | "business",
  days: number
): Promise<HistoricalDataPoint[]> {
  const cacheKey = `route_history:${originId}:${destinationId}:${cabinClass}:${days}`;
  const cached = await cacheService.get<HistoricalDataPoint[]>(cacheKey);
  if (cached) return cached;

  const db = await getDb();
  if (!db) return [];

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  try {
    const results = await db
      .select({
        date: sql<Date>`DATE(${flights.departureTime})`.as("date"),
        demand: sql<number>`COUNT(DISTINCT ${bookings.id})`.as("demand"),
        avgPrice:
          cabinClass === "economy"
            ? sql<number>`AVG(${flights.economyPrice})`.as("avgPrice")
            : sql<number>`AVG(${flights.businessPrice})`.as("avgPrice"),
        avgOccupancy:
          cabinClass === "economy"
            ? sql<number>`AVG(1 - ${flights.economyAvailable} / NULLIF(${flights.economySeats}, 0))`.as(
                "avgOccupancy"
              )
            : sql<number>`AVG(1 - ${flights.businessAvailable} / NULLIF(${flights.businessSeats}, 0))`.as(
                "avgOccupancy"
              ),
      })
      .from(flights)
      .leftJoin(bookings, eq(bookings.flightId, flights.id))
      .where(
        and(
          eq(flights.originId, originId),
          eq(flights.destinationId, destinationId),
          gte(flights.departureTime, startDate),
          lte(flights.departureTime, new Date())
        )
      )
      .groupBy(sql`DATE(${flights.departureTime})`)
      .orderBy(sql`DATE(${flights.departureTime})`);

    const data: HistoricalDataPoint[] = results.map(r => ({
      date: new Date(r.date),
      demand: Number(r.demand) || 0,
      price: Number(r.avgPrice) || 0,
      occupancy: Number(r.avgOccupancy) || 0,
    }));

    await cacheService.set(cacheKey, data, FORECAST_CACHE_TTL);
    return data;
  } catch {
    return [];
  }
}

function calculateSeasonalIndex(month: number, dayOfWeek: number): number {
  // Saudi-context seasonal indices
  const monthIndices: Record<number, number> = {
    1: 1.2, // Winter holiday
    2: 0.9,
    3: 0.9,
    4: 1.0,
    5: 1.0,
    6: 1.2, // Start of summer / Hajj season
    7: 1.4, // Peak summer
    8: 1.4, // Peak summer
    9: 1.1, // Shoulder
    10: 1.0,
    11: 0.9,
    12: 1.3, // Winter holiday
  };

  const dowIndices: Record<number, number> = {
    0: 1.0, // Sunday
    1: 0.9, // Monday
    2: 0.9, // Tuesday
    3: 1.0, // Wednesday
    4: 1.15, // Thursday (weekend)
    5: 1.15, // Friday (weekend)
    6: 1.05, // Saturday
  };

  return (monthIndices[month] || 1.0) * (dowIndices[dayOfWeek] || 1.0);
}

function checkIsHoliday(date: Date): boolean {
  // Major Saudi holidays (approximate Gregorian dates)
  const month = date.getMonth() + 1;
  const day = date.getDate();

  // Saudi National Day (Sep 23)
  if (month === 9 && day >= 22 && day <= 24) return true;

  // Founding Day (Feb 22)
  if (month === 2 && day >= 21 && day <= 23) return true;

  // Approximate Eid periods (varies by Hijri calendar)
  // Eid al-Fitr (approx late March/April)
  if (month === 3 && day >= 28) return true;
  if (month === 4 && day <= 5) return true;

  // Eid al-Adha (approx June)
  if (month === 6 && day >= 15 && day <= 22) return true;

  return false;
}

// ============================================================================
// Prediction Storage
// ============================================================================

async function storePredictions(forecasts: DemandForecast[]): Promise<void> {
  const db = await getDb();
  if (!db || forecasts.length === 0) return;

  try {
    // Get or create model reference
    const model = await db.query.aiPricingModels?.findFirst({
      where: and(
        eq(aiPricingModels.modelType, "demand_forecast"),
        eq(aiPricingModels.status, "active")
      ),
    });

    let modelId: number;
    if (!model) {
      const [inserted] = await db.insert(aiPricingModels).values({
        name: "Holt-Winters Demand Forecast",
        version: "v1.0",
        modelType: "demand_forecast",
        config: JSON.stringify({
          alpha: SMOOTHING_ALPHA,
          beta: TREND_BETA,
          gamma: SEASONAL_GAMMA,
          period: SEASONAL_PERIOD,
          featureWeights: FEATURE_WEIGHTS,
        }),
        status: "active",
      });
      modelId = inserted.insertId;
    } else {
      modelId = model.id;
    }

    // Batch insert predictions
    const values = forecasts.map(f => ({
      modelId,
      flightId: f.flightId,
      predictionDate: f.date,
      cabinClass: f.cabinClass as "economy" | "business",
      predictedDemand: f.predictedDemand.toString(),
      confidenceLower: f.confidenceLower.toString(),
      confidenceUpper: f.confidenceUpper.toString(),
      confidenceLevel: f.confidenceLevel.toString(),
      recommendedPrice: f.recommendedPrice,
      recommendedMultiplier: f.recommendedMultiplier.toString(),
      featureImportances: JSON.stringify(f.featureImportances),
    }));

    await db.insert(demandPredictions).values(values);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "store_predictions_error",
        error: error instanceof Error ? error.message : "Unknown",
      })
    );
  }
}

// ============================================================================
// Model Evaluation
// ============================================================================

/**
 * Evaluate forecast accuracy against actual data
 */
export async function evaluateForecastAccuracy(
  modelId: number,
  periodDays: number = 30
): Promise<ForecastAccuracy> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - periodDays);

  const predictions = await db.query.demandPredictions?.findMany({
    where: and(
      eq(demandPredictions.modelId, modelId),
      gte(demandPredictions.createdAt, startDate),
      sql`${demandPredictions.actualDemand} IS NOT NULL`
    ),
  });

  if (!predictions || predictions.length === 0) {
    return { mae: 0, rmse: 0, mape: 0, r2: 0, sampleCount: 0 };
  }

  let sumAbsError = 0;
  let sumSqError = 0;
  let sumAbsPercentError = 0;
  let sumActual = 0;
  let sumSqDiffFromMean = 0;

  const meanActual =
    predictions.reduce((sum, p) => sum + parseFloat(p.actualDemand || "0"), 0) /
    predictions.length;

  for (const p of predictions) {
    const predicted = parseFloat(p.predictedDemand);
    const actual = parseFloat(p.actualDemand || "0");
    const error = actual - predicted;

    sumAbsError += Math.abs(error);
    sumSqError += error * error;
    sumAbsPercentError += actual > 0 ? Math.abs(error / actual) : 0;
    sumActual += actual;
    sumSqDiffFromMean += (actual - meanActual) * (actual - meanActual);
  }

  const n = predictions.length;
  const mae = sumAbsError / n;
  const rmse = Math.sqrt(sumSqError / n);
  const mape = (sumAbsPercentError / n) * 100;
  const r2 = sumSqDiffFromMean > 0 ? 1 - sumSqError / sumSqDiffFromMean : 0;

  return { mae, rmse, mape, r2, sampleCount: n };
}

// ============================================================================
// Exports
// ============================================================================

export const DemandForecastingService = {
  forecastFlightDemand,
  forecastRouteDemand,
  evaluateForecastAccuracy,
};

export default DemandForecastingService;
