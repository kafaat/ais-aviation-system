/**
 * Dynamic Pricing Engine Service
 *
 * Implements revenue management algorithms for flight pricing:
 * - Demand-based pricing
 * - Time-based pricing (advance purchase)
 * - Occupancy-based pricing
 * - Seasonal pricing
 * - Competitor pricing (future)
 *
 * @module services/pricing/dynamic-pricing.service
 */

import { getDb } from "../../db";
import {
  flights,
  bookings,
  pricingRules,
  pricingHistory,
  seasonalPricing,
} from "../../../drizzle/schema";
import {
  eq,
  and,
  gte,
  lte,
  sql,
  between,
  count,
  desc,
  or,
  isNull,
} from "drizzle-orm";
import { cacheService } from "../cache.service";
import * as schema from "../../../drizzle/schema";

// Cache TTL for pricing rules (5 minutes)
const RULES_CACHE_TTL = 5 * 60;

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface PricingContext {
  flightId: number;
  cabinClass: "economy" | "business";
  requestedSeats: number;
  userId?: number;
  promoCode?: string;
}

export interface PricingResult {
  basePrice: number;
  finalPrice: number;
  currency: string;
  breakdown: PriceBreakdown;
  validUntil: Date;
  priceId: string;
}

export interface PriceBreakdown {
  basePrice: number;
  demandMultiplier: number;
  timeMultiplier: number;
  occupancyMultiplier: number;
  seasonalMultiplier: number;
  promoDiscount: number;
  taxes: number;
  fees: number;
  total: number;
}

export interface PricingRule {
  id: number;
  name: string;
  type: "demand" | "time" | "occupancy" | "seasonal" | "route";
  conditions: RuleConditions;
  multiplier: number;
  priority: number;
  isActive: boolean;
}

export interface RuleConditions {
  minOccupancy?: number;
  maxOccupancy?: number;
  daysBeforeDeparture?: { min?: number; max?: number };
  dayOfWeek?: number[];
  seasonStart?: string;
  seasonEnd?: string;
  routes?: { origin: number; destination: number }[];
  timeOfDay?: { start: string; end: string };
}

export interface DemandMetrics {
  searchCount: number;
  bookingCount: number;
  conversionRate: number;
  averageLeadTime: number;
}

// ============================================================================
// Constants
// ============================================================================

const PRICE_VALIDITY_MINUTES = 15;
const MIN_MULTIPLIER = 0.7; // Maximum 30% discount
const MAX_MULTIPLIER = 2.5; // Maximum 150% increase
const TAX_RATE = 0.15; // 15% VAT
const BOOKING_FEE = 50; // 50 SAR booking fee

// Default multipliers when no rules match
const DEFAULT_MULTIPLIERS = {
  demand: 1.0,
  time: 1.0,
  occupancy: 1.0,
  seasonal: 1.0,
};

// ============================================================================
// Main Pricing Service
// ============================================================================

/**
 * Calculate dynamic price for a flight
 */
export async function calculateDynamicPrice(
  context: PricingContext
): Promise<PricingResult> {
  const { flightId, cabinClass, requestedSeats, promoCode } = context;

  // 1. Get flight details
  const database = await getDb();
  if (!database) {
    throw new Error("Database connection not available");
  }

  const flight = await database.query.flights.findFirst({
    where: eq(flights.id, flightId),
  });

  if (!flight) {
    throw new Error(`Flight ${flightId} not found`);
  }

  // 2. Get base price
  const basePrice =
    cabinClass === "economy" ? flight.economyPrice : flight.businessPrice;

  // 3. Calculate multipliers
  const demandMultiplier = await calculateDemandMultiplier(flightId);
  const timeMultiplier = calculateTimeMultiplier(flight.departureTime);
  const occupancyMultiplier = calculateOccupancyMultiplier(
    flight,
    cabinClass,
    requestedSeats
  );
  const seasonalMultiplier = await calculateSeasonalMultiplier(
    flight.departureTime,
    flight.originId,
    flight.destinationId
  );

  // 4. Apply custom pricing rules
  const rulesMultiplier = await applyPricingRules(flight, cabinClass);

  // 5. Calculate combined multiplier (capped)
  const combinedMultiplier = Math.min(
    MAX_MULTIPLIER,
    Math.max(
      MIN_MULTIPLIER,
      demandMultiplier *
        timeMultiplier *
        occupancyMultiplier *
        seasonalMultiplier *
        rulesMultiplier
    )
  );

  // 6. Calculate adjusted price
  const adjustedPrice = Math.round(basePrice * combinedMultiplier);

  // 7. Apply promo discount
  const promoDiscount = promoCode
    ? await calculatePromoDiscount(promoCode, adjustedPrice)
    : 0;

  // 8. Calculate taxes and fees
  const priceAfterDiscount = adjustedPrice - promoDiscount;
  const taxes = Math.round(priceAfterDiscount * TAX_RATE);
  const fees = BOOKING_FEE * requestedSeats;
  const totalPrice = (priceAfterDiscount + taxes + fees) * requestedSeats;

  // 9. Generate price ID and validity
  const priceId = generatePriceId(flightId, cabinClass, totalPrice);
  const validUntil = new Date(Date.now() + PRICE_VALIDITY_MINUTES * 60 * 1000);

  // 10. Record price history
  await recordPriceHistory({
    flightId,
    cabinClass,
    basePrice,
    finalPrice: totalPrice,
    multipliers: {
      demand: demandMultiplier,
      time: timeMultiplier,
      occupancy: occupancyMultiplier,
      seasonal: seasonalMultiplier,
      rules: rulesMultiplier,
    },
    priceId,
  });

  // 11. Build result
  const breakdown: PriceBreakdown = {
    basePrice,
    demandMultiplier,
    timeMultiplier,
    occupancyMultiplier,
    seasonalMultiplier,
    promoDiscount,
    taxes,
    fees,
    total: totalPrice,
  };

  return {
    basePrice,
    finalPrice: totalPrice,
    currency: "SAR",
    breakdown,
    validUntil,
    priceId,
  };
}

// ============================================================================
// Multiplier Calculations
// ============================================================================

/**
 * Calculate demand-based multiplier
 * Based on search volume and booking velocity
 */
async function calculateDemandMultiplier(flightId: number): Promise<number> {
  const now = new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // Get recent bookings count
  const database = await getDb();
  if (!database) {
    return DEFAULT_MULTIPLIERS.demand;
  }

  const recentBookings = await database
    .select({ count: count() })
    .from(bookings)
    .where(
      and(eq(bookings.flightId, flightId), gte(bookings.createdAt, hourAgo))
    );

  const bookingsLastHour = recentBookings[0]?.count || 0;

  // Get daily bookings for comparison
  const dailyBookings = await database
    .select({ count: count() })
    .from(bookings)
    .where(
      and(eq(bookings.flightId, flightId), gte(bookings.createdAt, dayAgo))
    );

  const bookingsLastDay = dailyBookings[0]?.count || 0;
  const avgHourlyBookings = bookingsLastDay / 24;

  // Calculate demand ratio
  if (avgHourlyBookings === 0) {
    return DEFAULT_MULTIPLIERS.demand;
  }

  const demandRatio = bookingsLastHour / avgHourlyBookings;

  // Map demand ratio to multiplier
  // High demand (>2x average) = up to 1.5x price
  // Low demand (<0.5x average) = down to 0.85x price
  if (demandRatio > 2) {
    return 1.5;
  } else if (demandRatio > 1.5) {
    return 1.3;
  } else if (demandRatio > 1) {
    return 1.15;
  } else if (demandRatio < 0.5) {
    return 0.85;
  } else if (demandRatio < 0.75) {
    return 0.95;
  }

  return DEFAULT_MULTIPLIERS.demand;
}

/**
 * Calculate time-based multiplier (advance purchase)
 * Earlier booking = better price
 */
function calculateTimeMultiplier(departureTime: Date): number {
  const now = new Date();
  const daysUntilDeparture = Math.floor(
    (departureTime.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Pricing tiers based on days before departure
  if (daysUntilDeparture > 60) {
    return 0.8; // 20% discount for very early booking
  } else if (daysUntilDeparture > 30) {
    return 0.9; // 10% discount for early booking
  } else if (daysUntilDeparture > 14) {
    return 1.0; // Standard price
  } else if (daysUntilDeparture > 7) {
    return 1.15; // 15% increase for late booking
  } else if (daysUntilDeparture > 3) {
    return 1.3; // 30% increase for very late booking
  } else if (daysUntilDeparture > 1) {
    return 1.5; // 50% increase for last minute
  } else {
    return 1.8; // 80% increase for same day
  }
}

/**
 * Calculate occupancy-based multiplier
 * Higher occupancy = higher price
 */
function calculateOccupancyMultiplier(
  flight: typeof flights.$inferSelect,
  cabinClass: "economy" | "business",
  requestedSeats: number
): number {
  const totalSeats =
    cabinClass === "economy" ? flight.economySeats : flight.businessSeats;
  const availableSeats =
    cabinClass === "economy"
      ? flight.economyAvailable
      : flight.businessAvailable;

  // Check if enough seats available
  if (availableSeats < requestedSeats) {
    throw new Error(`Not enough ${cabinClass} seats available`);
  }

  const occupancyRate = 1 - availableSeats / totalSeats;

  // Pricing tiers based on occupancy
  if (occupancyRate > 0.95) {
    return 1.8; // Almost full - premium pricing
  } else if (occupancyRate > 0.85) {
    return 1.5; // Very high occupancy
  } else if (occupancyRate > 0.7) {
    return 1.25; // High occupancy
  } else if (occupancyRate > 0.5) {
    return 1.1; // Medium occupancy
  } else if (occupancyRate > 0.3) {
    return 1.0; // Standard
  } else if (occupancyRate > 0.15) {
    return 0.9; // Low occupancy - discount
  } else {
    return 0.8; // Very low - bigger discount
  }
}

/**
 * Calculate seasonal multiplier
 * Peak seasons = higher prices
 */
async function calculateSeasonalMultiplier(
  departureTime: Date,
  originId: number,
  destinationId: number
): Promise<number> {
  const month = departureTime.getMonth() + 1; // 1-12
  const dayOfWeek = departureTime.getDay(); // 0-6 (Sunday-Saturday)

  // Weekend premium (Thursday-Friday in Saudi Arabia)
  const isWeekend = dayOfWeek === 4 || dayOfWeek === 5;
  const weekendMultiplier = isWeekend ? 1.1 : 1.0;

  // Seasonal multipliers (Saudi Arabia context)
  let seasonMultiplier = 1.0;

  // Ramadan period (approximate - should use Hijri calendar)
  // Eid periods
  // Summer holidays (June-August)
  // Winter holidays (December-January)

  if (month === 7 || month === 8) {
    // Peak summer
    seasonMultiplier = 1.4;
  } else if (month === 12 || month === 1) {
    // Winter holidays
    seasonMultiplier = 1.3;
  } else if (month === 6 || month === 9) {
    // Shoulder season
    seasonMultiplier = 1.15;
  } else if (month === 2 || month === 3 || month === 11) {
    // Low season
    seasonMultiplier = 0.9;
  }

  // Check for specific route rules (e.g., Hajj routes)
  const routeMultiplier = await getRouteSeasonalMultiplier(
    originId,
    destinationId,
    departureTime
  );

  return seasonMultiplier * weekendMultiplier * routeMultiplier;
}

/**
 * Get route-specific seasonal multiplier
 */
async function getRouteSeasonalMultiplier(
  originId: number,
  destinationId: number,
  departureTime: Date
): Promise<number> {
  // Check for Hajj/Umrah routes to Jeddah/Madinah
  // This would be enhanced with actual route data
  const hajjRoutes = [
    { origin: "JED", destination: "any" },
    { origin: "MED", destination: "any" },
  ];

  // Hajj season (approximate - should use Hijri calendar)
  const month = departureTime.getMonth() + 1;
  const isHajjSeason = month === 6 || month === 7;

  // For now, return default
  return 1.0;
}

/**
 * Apply custom pricing rules from database
 */
async function applyPricingRules(
  flight: typeof flights.$inferSelect,
  cabinClass: "economy" | "business"
): Promise<number> {
  // Get active pricing rules
  // This would query the pricingRules table
  // For now, return default
  return 1.0;
}

/**
 * Calculate promo code discount
 */
async function calculatePromoDiscount(
  promoCode: string,
  price: number
): Promise<number> {
  // Query promo codes table
  // Validate code is active and not expired
  // Check usage limits
  // For now, return 0
  return 0;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate unique price ID for validation
 */
function generatePriceId(
  flightId: number,
  cabinClass: string,
  price: number
): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `PRC-${flightId}-${cabinClass}-${price}-${timestamp}-${random}`;
}

/**
 * Record price in history for analytics
 */
async function recordPriceHistory(data: {
  flightId: number;
  cabinClass: string;
  basePrice: number;
  finalPrice: number;
  multipliers: Record<string, number>;
  priceId: string;
}): Promise<void> {
  // Insert into price_history table
  // This helps with analytics and auditing
  console.log(
    JSON.stringify({
      event: "price_calculated",
      ...data,
      timestamp: new Date().toISOString(),
    })
  );
}

/**
 * Validate a previously calculated price
 */
export async function validatePrice(
  priceId: string,
  expectedPrice: number
): Promise<{ valid: boolean; reason?: string }> {
  // Parse price ID
  const parts = priceId.split("-");
  if (parts.length < 6) {
    return { valid: false, reason: "Invalid price ID format" };
  }

  const timestamp = parseInt(parts[4]);
  const now = Date.now();
  const ageMinutes = (now - timestamp) / (1000 * 60);

  // Check if price has expired
  if (ageMinutes > PRICE_VALIDITY_MINUTES) {
    return { valid: false, reason: "Price has expired" };
  }

  // Verify price matches
  const storedPrice = parseInt(parts[3]);
  if (storedPrice !== expectedPrice) {
    return { valid: false, reason: "Price mismatch" };
  }

  return { valid: true };
}

/**
 * Get price forecast for a flight
 */
export async function getPriceForecast(
  flightId: number,
  cabinClass: "economy" | "business",
  days: number = 7
): Promise<{ date: Date; predictedPrice: number }[]> {
  const database = await getDb();
  if (!database) {
    throw new Error("Database connection not available");
  }

  const flight = await database.query.flights.findFirst({
    where: eq(flights.id, flightId),
  });

  if (!flight) {
    throw new Error(`Flight ${flightId} not found`);
  }

  const forecast: { date: Date; predictedPrice: number }[] = [];
  const basePrice =
    cabinClass === "economy" ? flight.economyPrice : flight.businessPrice;

  for (let i = 0; i < days; i++) {
    const date = new Date();
    date.setDate(date.getDate() + i);

    // Simulate price prediction based on time multiplier
    const daysUntilDeparture = Math.floor(
      (flight.departureTime.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
    );

    let multiplier = 1.0;
    if (daysUntilDeparture > 30) multiplier = 0.9;
    else if (daysUntilDeparture > 14) multiplier = 1.0;
    else if (daysUntilDeparture > 7) multiplier = 1.15;
    else multiplier = 1.3;

    forecast.push({
      date,
      predictedPrice: Math.round(basePrice * multiplier),
    });
  }

  return forecast;
}

// ============================================================================
// Exports
// ============================================================================

// ============================================================================
// Enhanced Pricing Functions
// ============================================================================

/**
 * Get applicable pricing rules from database with caching
 */
async function getApplicablePricingRules(
  airlineId: number,
  originId: number,
  destinationId: number
): Promise<any[]> {
  const cacheKey = `pricing_rules:${airlineId}:${originId}:${destinationId}`;
  const cached = await cacheService.get<any[]>(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const database = await getDb();
    if (!database) {
      return [];
    }

    const rules =
      (await database.query.pricingRules?.findMany({
        where: and(
          eq(pricingRules.isActive, true),
          or(
            isNull(pricingRules.airlineId),
            eq(pricingRules.airlineId, airlineId)
          ),
          or(
            isNull(pricingRules.originId),
            eq(pricingRules.originId, originId)
          ),
          or(
            isNull(pricingRules.destinationId),
            eq(pricingRules.destinationId, destinationId)
          ),
          or(
            isNull(pricingRules.validFrom),
            lte(pricingRules.validFrom, new Date())
          ),
          or(
            isNull(pricingRules.validTo),
            gte(pricingRules.validTo, new Date())
          )
        ),
        orderBy: [desc(pricingRules.priority)],
      })) || [];

    await cacheService.set(cacheKey, rules, RULES_CACHE_TTL);
    return rules;
  } catch (error) {
    console.log(
      JSON.stringify({
        event: "pricing_rules_fetch_error",
        error: error instanceof Error ? error.message : "Unknown error",
      })
    );
    return [];
  }
}

/**
 * Get active seasonal pricing
 */
async function getActiveSeasonalPricing(
  departureTime: Date,
  airlineId: number,
  originId: number,
  destinationId: number
): Promise<{ name: string; multiplier: number } | null> {
  try {
    const database = await getDb();
    if (!database) {
      return null;
    }

    const seasonal = await database.query.seasonalPricing?.findFirst({
      where: and(
        eq(seasonalPricing.isActive, true),
        lte(seasonalPricing.startDate, departureTime),
        gte(seasonalPricing.endDate, departureTime),
        or(
          isNull(seasonalPricing.airlineId),
          eq(seasonalPricing.airlineId, airlineId)
        ),
        or(
          isNull(seasonalPricing.originId),
          eq(seasonalPricing.originId, originId)
        ),
        or(
          isNull(seasonalPricing.destinationId),
          eq(seasonalPricing.destinationId, destinationId)
        )
      ),
    });

    if (seasonal) {
      return {
        name: seasonal.name,
        multiplier: parseFloat(seasonal.multiplier),
      };
    }
  } catch (error) {
    console.log(
      JSON.stringify({
        event: "seasonal_pricing_fetch_error",
        error: error instanceof Error ? error.message : "Unknown error",
      })
    );
  }

  return null;
}

/**
 * Calculate bulk prices for multiple flights
 */
export async function calculateBulkPrices(
  flightIds: number[],
  cabinClass: "economy" | "business"
): Promise<Map<number, PricingResult>> {
  const results = new Map<number, PricingResult>();

  for (const flightId of flightIds) {
    try {
      const result = await calculateDynamicPrice({
        flightId,
        cabinClass,
        requestedSeats: 1,
      });
      results.set(flightId, result);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "bulk_pricing_error",
          flightId,
          error: error instanceof Error ? error.message : "Unknown error",
        })
      );
    }
  }

  return results;
}

/**
 * Get price range for a route over a date range
 */
export async function getPriceRange(
  originId: number,
  destinationId: number,
  cabinClass: "economy" | "business",
  startDate: Date,
  endDate: Date
): Promise<{ min: number; max: number; average: number }> {
  const database = await getDb();
  if (!database) {
    return { min: 0, max: 0, average: 0 };
  }

  const flightsInRange = await database.query.flights.findMany({
    where: and(
      eq(flights.originId, originId),
      eq(flights.destinationId, destinationId),
      gte(flights.departureTime, startDate),
      lte(flights.departureTime, endDate),
      eq(flights.status, "scheduled")
    ),
  });

  if (flightsInRange.length === 0) {
    return { min: 0, max: 0, average: 0 };
  }

  const prices: number[] = [];
  for (const flight of flightsInRange) {
    try {
      const result = await calculateDynamicPrice({
        flightId: flight.id,
        cabinClass,
        requestedSeats: 1,
      });
      prices.push(result.finalPrice);
    } catch (error) {
      // Skip flights that fail pricing
    }
  }

  if (prices.length === 0) {
    return { min: 0, max: 0, average: 0 };
  }

  return {
    min: Math.min(...prices),
    max: Math.max(...prices),
    average: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
  };
}

// ============================================================================
// Exports
// ============================================================================

export const DynamicPricingService = {
  calculateDynamicPrice,
  validatePrice,
  getPriceForecast,
  calculateBulkPrices,
  getPriceRange,
};

export default DynamicPricingService;
