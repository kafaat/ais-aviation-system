import { TRPCError } from "@trpc/server";
import * as db from "../db";
import {
  calculateDynamicPrice,
  calculateOccupancyRate,
  getDaysUntilDeparture,
} from "./dynamic-pricing.service";
import {
  redisCacheService,
  CacheTTL,
} from "./redis-cache.service";

/**
 * Flights Service
 * Business logic for flight-related operations
 */

export interface SearchFlightsInput {
  originId: number;
  destinationId: number;
  departureDate: Date;
}

export interface GetFlightInput {
  id: number;
}

// Type for flight search results
export type FlightSearchResult = Awaited<ReturnType<typeof import("../db").searchFlights>>;

/**
 * Search for flights based on origin, destination, and date
 * Results are cached for 2 minutes to improve performance
 */
export async function searchFlights(input: SearchFlightsInput): Promise<FlightSearchResult> {
  try {
    // Create cache key params
    const cacheParams = {
      originId: input.originId,
      destinationId: input.destinationId,
      departureDate: input.departureDate.toISOString().split("T")[0],
    };

    // Try to get from cache
    const cached = await redisCacheService.getCachedFlightSearch(cacheParams);
    if (cached) {
      return cached as FlightSearchResult;
    }

    // Fetch from database
    const results = await db.searchFlights(input);

    // Cache the results
    await redisCacheService.cacheFlightSearch(
      cacheParams,
      results,
      CacheTTL.FLIGHT_SEARCH
    );

    return results;
  } catch (error) {
    console.error("Error searching flights:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to search flights",
    });
  }
}

/**
 * Get flight details by ID
 * Results are cached for 5 minutes to improve performance
 */
export async function getFlightById(input: GetFlightInput) {
  try {
    // Try to get from cache
    const cached = await redisCacheService.getCachedFlightDetails(input.id);
    if (cached) {
      return cached as Awaited<ReturnType<typeof db.getFlightById>>;
    }

    // Fetch from database
    const flight = await db.getFlightById(input.id);

    if (!flight) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Flight not found",
      });
    }

    // Cache the result
    await redisCacheService.cacheFlightDetails(
      input.id,
      flight,
      CacheTTL.FLIGHT_DETAILS
    );

    return flight;
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }
    console.error("Error getting flight:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get flight details",
    });
  }
}

/**
 * Check flight availability
 */
export async function checkFlightAvailability(
  flightId: number,
  cabinClass: "economy" | "business",
  requiredSeats: number
): Promise<{
  available: boolean;
  flight: Awaited<ReturnType<typeof db.getFlightById>>;
}> {
  const flight = await db.getFlightById(flightId);

  if (!flight) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Flight not found",
    });
  }

  const availableSeats =
    cabinClass === "economy"
      ? flight.economyAvailable
      : flight.businessAvailable;

  return {
    available: availableSeats >= requiredSeats,
    flight,
  };
}

/**
 * Calculate flight price with dynamic pricing
 */
export async function calculateFlightPrice(
  flight: NonNullable<Awaited<ReturnType<typeof db.getFlightById>>>,
  cabinClass: "economy" | "business",
  passengerCount: number
): Promise<{ price: number; pricing?: any }> {
  const basePrice =
    cabinClass === "economy" ? flight.economyPrice : flight.businessPrice;

  try {
    // Calculate occupancy rate
    const totalSeats =
      cabinClass === "economy" ? flight.economySeats : flight.businessSeats;
    const occupancyRate = await calculateOccupancyRate(flight.id, totalSeats);

    // Calculate days until departure
    const daysUntilDeparture = getDaysUntilDeparture(flight.departureTime);

    // Get dynamic price for single seat
    const pricingResult = calculateDynamicPrice({
      basePrice,
      occupancyRate,
      daysUntilDeparture,
      cabinClass,
    });

    // Multiply by passenger count
    const totalPrice = pricingResult.finalPrice * passengerCount;

    return {
      price: totalPrice,
      pricing: {
        ...pricingResult,
        finalPrice: totalPrice,
        perPassenger: pricingResult.finalPrice,
        occupancyRate,
        daysUntilDeparture,
      },
    };
  } catch (error) {
    console.error("Error calculating dynamic price:", error);
    // Fallback to base price if dynamic pricing fails
    return {
      price: basePrice * passengerCount,
    };
  }
}
