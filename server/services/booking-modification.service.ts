import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import * as db from "../db";
import { bookings, bookingModifications, flights } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";

/**
 * Booking Modification Service
 * Handles booking modification requests
 */

export interface ChangeFlightDateInput {
  bookingId: number;
  userId: number;
  newFlightId: number;
  reason?: string;
}

export interface UpgradeCabinInput {
  bookingId: number;
  userId: number;
  newCabinClass: "business";
  reason?: string;
}

/**
 * Calculate modification fee based on time until departure
 * Similar to cancellation fees but lower percentages
 */
function calculateModificationFee(
  originalAmount: number,
  departureTime: Date
): number {
  const now = new Date();
  const hoursUntilDeparture =
    (departureTime.getTime() - now.getTime()) / (1000 * 60 * 60);

  let feePercentage: number;

  if (hoursUntilDeparture < 0) {
    // After departure - not allowed
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cannot modify booking after departure",
    });
  } else if (hoursUntilDeparture < 24) {
    // Less than 24 hours - 15% fee
    feePercentage = 15;
  } else if (hoursUntilDeparture < 72) {
    // 1-3 days - 10% fee
    feePercentage = 10;
  } else if (hoursUntilDeparture < 168) {
    // 3-7 days - 5% fee
    feePercentage = 5;
  } else {
    // More than 7 days - no fee
    feePercentage = 0;
  }

  return Math.round((originalAmount * feePercentage) / 100);
}

/**
 * Request to change flight date
 */
export async function requestChangeFlightDate(input: ChangeFlightDateInput) {
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    // Get booking details
    const [booking] = await database
      .select()
      .from(bookings)
      .where(
        and(eq(bookings.id, input.bookingId), eq(bookings.userId, input.userId))
      )
      .limit(1);

    if (!booking) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Booking not found",
      });
    }

    // Check if booking is confirmed
    if (booking.status !== "confirmed") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Can only modify confirmed bookings",
      });
    }

    // Get original flight details
    const [originalFlight] = await database
      .select()
      .from(flights)
      .where(eq(flights.id, booking.flightId))
      .limit(1);

    if (!originalFlight) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Original flight not found",
      });
    }

    // Get new flight details with full info
    const newFlight = await db.getFlightById(input.newFlightId);

    if (!newFlight) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "New flight not found",
      });
    }

    // Validate same route
    if (
      originalFlight.originId !== newFlight.origin.id ||
      originalFlight.destinationId !== newFlight.destination.id
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "New flight must be on the same route",
      });
    }

    // Calculate new price
    const pricePerSeat =
      booking.cabinClass === "economy"
        ? newFlight.economyPrice
        : newFlight.businessPrice;
    const newAmount = pricePerSeat * booking.numberOfPassengers;

    // Calculate price difference
    const priceDifference = newAmount - booking.totalAmount;

    // Calculate modification fee
    const modificationFee = calculateModificationFee(
      booking.totalAmount,
      originalFlight.departureTime
    );

    // Total cost (can be negative if new flight is cheaper)
    const totalCost = priceDifference + modificationFee;

    // Create modification request
    const [result] = await database.insert(bookingModifications).values({
      bookingId: input.bookingId,
      userId: input.userId,
      modificationType: "change_date",
      originalFlightId: booking.flightId,
      originalCabinClass: booking.cabinClass,
      originalAmount: booking.totalAmount,
      newFlightId: input.newFlightId,
      newCabinClass: booking.cabinClass,
      newAmount,
      priceDifference,
      modificationFee,
      totalCost,
      status: "pending",
      reason: input.reason,
    });

    return {
      modificationId: (result as any).insertId,
      originalAmount: booking.totalAmount,
      newAmount,
      priceDifference,
      modificationFee,
      totalCost,
      requiresPayment: totalCost > 0,
    };
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }
    console.error("Error requesting flight date change:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to request flight date change",
    });
  }
}

/**
 * Request to upgrade cabin class
 */
export async function requestUpgradeCabin(input: UpgradeCabinInput) {
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    // Get booking details
    const [booking] = await database
      .select()
      .from(bookings)
      .where(
        and(eq(bookings.id, input.bookingId), eq(bookings.userId, input.userId))
      )
      .limit(1);

    if (!booking) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Booking not found",
      });
    }

    // Check if already business class
    if (booking.cabinClass === "business") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Already in business class",
      });
    }

    // Check if booking is confirmed
    if (booking.status !== "confirmed") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Can only modify confirmed bookings",
      });
    }

    // Get flight details with full info
    const flight = await db.getFlightById(booking.flightId);

    if (!flight) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Flight not found",
      });
    }

    // Calculate new price for business class
    const newAmount = flight.businessPrice * booking.numberOfPassengers;

    // Calculate price difference
    const priceDifference = newAmount - booking.totalAmount;

    // Calculate modification fee
    const modificationFee = calculateModificationFee(
      booking.totalAmount,
      flight.departureTime
    );

    // Total cost
    const totalCost = priceDifference + modificationFee;

    // Create modification request
    const [result] = await database.insert(bookingModifications).values({
      bookingId: input.bookingId,
      userId: input.userId,
      modificationType: "upgrade_cabin",
      originalFlightId: booking.flightId,
      originalCabinClass: booking.cabinClass,
      originalAmount: booking.totalAmount,
      newFlightId: booking.flightId,
      newCabinClass: input.newCabinClass,
      newAmount,
      priceDifference,
      modificationFee,
      totalCost,
      status: "pending",
      reason: input.reason,
    });

    return {
      modificationId: (result as any).insertId,
      originalAmount: booking.totalAmount,
      newAmount,
      priceDifference,
      modificationFee,
      totalCost,
      requiresPayment: true, // Always requires payment for upgrades
    };
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }
    console.error("Error requesting cabin upgrade:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to request cabin upgrade",
    });
  }
}

/**
 * Get modification details
 */
export async function getModificationDetails(modificationId: number) {
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    const [modification] = await database
      .select()
      .from(bookingModifications)
      .where(eq(bookingModifications.id, modificationId))
      .limit(1);

    if (!modification) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Modification request not found",
      });
    }

    return modification;
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }
    console.error("Error getting modification details:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get modification details",
    });
  }
}

/**
 * Get user's modification requests
 */
export async function getUserModifications(userId: number) {
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");

    const modifications = await database
      .select()
      .from(bookingModifications)
      .where(eq(bookingModifications.userId, userId))
      .orderBy(bookingModifications.createdAt);

    return modifications;
  } catch (error) {
    console.error("Error getting user modifications:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get user modifications",
    });
  }
}
