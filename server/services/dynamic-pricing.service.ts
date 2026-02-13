/**
 * Dynamic Pricing Service
 * Adjusts flight prices based on occupancy rate and time to departure
 */

export interface PricingFactors {
  basePrice: number;
  occupancyRate: number; // 0-100
  daysUntilDeparture: number;
  cabinClass: string;
}

export interface PricingResult {
  basePrice: number;
  occupancyMultiplier: number;
  timeMultiplier: number;
  finalPrice: number;
  adjustmentPercentage: number;
  breakdown: {
    occupancyAdjustment: number;
    timeAdjustment: number;
  };
}

/**
 * Calculate occupancy-based price multiplier
 * - 0-50%: No adjustment (1.0x)
 * - 50-80%: +10% (1.1x)
 * - 80-95%: +25% (1.25x)
 * - 95-100%: +40% (1.4x)
 */
function getOccupancyMultiplier(occupancyRate: number): number {
  if (occupancyRate >= 95) return 1.4;
  if (occupancyRate >= 80) return 1.25;
  if (occupancyRate >= 50) return 1.1;
  return 1.0;
}

/**
 * Calculate time-based price multiplier
 * - > 30 days: -5% (0.95x) - Early bird discount
 * - 14-30 days: No adjustment (1.0x)
 * - 7-14 days: +10% (1.1x)
 * - 3-7 days: +20% (1.2x)
 * - < 3 days: +35% (1.35x)
 */
function getTimeMultiplier(daysUntilDeparture: number): number {
  if (daysUntilDeparture < 3) return 1.35;
  if (daysUntilDeparture < 7) return 1.2;
  if (daysUntilDeparture < 14) return 1.1;
  if (daysUntilDeparture > 30) return 0.95;
  return 1.0;
}

/**
 * Calculate dynamic price for a flight
 */
export function calculateDynamicPrice(factors: PricingFactors): PricingResult {
  const occupancyMultiplier = getOccupancyMultiplier(factors.occupancyRate);
  const timeMultiplier = getTimeMultiplier(factors.daysUntilDeparture);

  // Apply both multipliers
  const finalPrice = Math.round(factors.basePrice * occupancyMultiplier * timeMultiplier);
  
  // Calculate individual adjustments for breakdown
  const occupancyAdjustment = Math.round(factors.basePrice * (occupancyMultiplier - 1));
  const timeAdjustment = Math.round(factors.basePrice * (timeMultiplier - 1));
  
  // Total adjustment percentage
  const adjustmentPercentage = Math.round(((finalPrice - factors.basePrice) / factors.basePrice) * 100);

  return {
    basePrice: factors.basePrice,
    occupancyMultiplier,
    timeMultiplier,
    finalPrice,
    adjustmentPercentage,
    breakdown: {
      occupancyAdjustment,
      timeAdjustment,
    },
  };
}

/**
 * Calculate occupancy rate for a flight
 */
export async function calculateOccupancyRate(
  flightId: number,
  totalSeats: number
): Promise<number> {
  const { getDb } = await import("../db");
  const { bookings } = await import("../../drizzle/schema");
  const { eq, and, sql } = await import("drizzle-orm");

  const database = await getDb();
  if (!database) return 0;

  // Count total passengers (not cancelled bookings)
  const [result] = await database
    .select({
      totalPassengers: sql<number>`SUM(${bookings.numberOfPassengers})`,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.flightId, flightId),
        sql`${bookings.status} != 'cancelled'`
      )
    );

  const bookedSeats = result?.totalPassengers || 0;
  const occupancyRate = Math.round((bookedSeats / totalSeats) * 100);

  return Math.min(occupancyRate, 100); // Cap at 100%
}

/**
 * Get days until departure
 */
export function getDaysUntilDeparture(departureTime: Date): number {
  const now = new Date();
  const departure = new Date(departureTime);
  const diffTime = departure.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(diffDays, 0); // Never negative
}
