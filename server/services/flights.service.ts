import { TRPCError } from "@trpc/server";
import * as db from "../db";

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

/**
 * Search for flights based on origin, destination, and date
 */
export async function searchFlights(input: SearchFlightsInput) {
  try {
    return await db.searchFlights(input);
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
 */
export async function getFlightById(input: GetFlightInput) {
  try {
    const flight = await db.getFlightById(input.id);
    
    if (!flight) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Flight not found",
      });
    }
    
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
): Promise<{ available: boolean; flight: Awaited<ReturnType<typeof db.getFlightById>> }> {
  const flight = await db.getFlightById(flightId);
  
  if (!flight) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Flight not found",
    });
  }
  
  const availableSeats = cabinClass === "economy" 
    ? flight.economyAvailable 
    : flight.businessAvailable;
  
  return {
    available: availableSeats >= requiredSeats,
    flight,
  };
}

/**
 * Calculate flight price
 */
export function calculateFlightPrice(
  flight: NonNullable<Awaited<ReturnType<typeof db.getFlightById>>>,
  cabinClass: "economy" | "business",
  passengerCount: number
): number {
  const pricePerSeat = cabinClass === "economy" 
    ? flight.economyPrice 
    : flight.businessPrice;
  
  return pricePerSeat * passengerCount;
}
