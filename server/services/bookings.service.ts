import { TRPCError } from "@trpc/server";
import * as db from "../db";
import { checkFlightAvailability, calculateFlightPrice } from "./flights.service";
import { createInventoryLock, releaseInventoryLock, convertLockToBooking, verifyLock } from "./inventory-lock.service";

/**
 * Bookings Service
 * Business logic for booking-related operations
 */

export interface Passenger {
  type: "adult" | "child" | "infant";
  title?: string;
  firstName: string;
  lastName: string;
  dateOfBirth?: Date;
  passportNumber?: string;
  nationality?: string;
}

export interface SelectedAncillary {
  ancillaryServiceId: number;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  passengerId?: number;
}

export interface CreateBookingInput {
  userId: number;
  flightId: number;
  cabinClass: "economy" | "business";
  passengers: Passenger[];
  sessionId: string; // For inventory locking
  lockId?: number; // If lock already exists
  ancillaries?: SelectedAncillary[];
}

/**
 * Create a new booking
 */
export async function createBooking(input: CreateBookingInput) {
  try {
    // Check flight availability
    const { available, flight } = await checkFlightAvailability(
      input.flightId,
      input.cabinClass,
      input.passengers.length
    );
    
    if (!available) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Not enough seats available",
      });
    }
    
    // Calculate total amount with dynamic pricing
    const pricingResult = await calculateFlightPrice(
      flight!,
      input.cabinClass,
      input.passengers.length
    );
    const totalAmount = pricingResult.price;
    
    if (pricingResult.pricing) {
      console.log(`[Booking] Dynamic pricing applied: ${pricingResult.pricing.adjustmentPercentage}% adjustment (Occupancy: ${pricingResult.pricing.occupancyRate}%, Days until departure: ${pricingResult.pricing.daysUntilDeparture})`);
    }
    
    // Generate booking reference and PNR
    const bookingReference = db.generateBookingReference();
    const pnr = db.generateBookingReference();
    
    // Create booking
    const bookingResult = await db.createBooking({
      userId: input.userId,
      flightId: input.flightId,
      bookingReference,
      pnr,
      status: "pending",
      totalAmount,
      cabinClass: input.cabinClass,
      numberOfPassengers: input.passengers.length,
    });
    
    // Get the inserted booking ID from the result
    const bookingId = (bookingResult as any).insertId || bookingResult[0]?.insertId;
    
    if (!bookingId) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to get booking ID",
      });
    }
    
    // Create passengers
    const passengersData = input.passengers.map((p) => ({
      bookingId,
      type: p.type,
      title: p.title,
      firstName: p.firstName,
      lastName: p.lastName,
      dateOfBirth: p.dateOfBirth,
      passportNumber: p.passportNumber,
      nationality: p.nationality,
    }));
    
    await db.createPassengers(passengersData);
    
    // Add ancillary services if provided
    if (input.ancillaries && input.ancillaries.length > 0) {
      const { addAncillaryToBooking } = await import("./ancillary-services.service");
      for (const ancillary of input.ancillaries) {
        await addAncillaryToBooking({
          bookingId,
          ancillaryServiceId: ancillary.ancillaryServiceId,
          quantity: ancillary.quantity,
          passengerId: ancillary.passengerId,
        });
      }
    }
    
    return {
      bookingId,
      bookingReference,
      pnr,
      totalAmount,
    };
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }
    console.error("Error creating booking:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create booking",
    });
  }
}

/**
 * Get user bookings
 */
export async function getUserBookings(userId: number) {
  try {
    return await db.getBookingsByUserId(userId);
  } catch (error) {
    console.error("Error getting user bookings:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get bookings",
    });
  }
}

/**
 * Get booking by ID
 */
export async function getBookingById(bookingId: number, userId: number) {
  try {
    const booking = await db.getBookingByIdWithDetails(bookingId);
    
    if (!booking) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Booking not found",
      });
    }
    
    // Verify ownership
    if (booking.userId !== userId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Access denied",
      });
    }
    
    return booking;
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }
    console.error("Error getting booking:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get booking details",
    });
  }
}

/**
 * Cancel booking
 */
export async function cancelBooking(bookingId: number, userId: number) {
  try {
    const booking = await getBookingById(bookingId, userId);
    
    if (booking.status === "cancelled") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Booking is already cancelled",
      });
    }
    
    if (booking.status === "completed") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot cancel completed booking",
      });
    }
    
    await db.updateBookingStatus(bookingId, "cancelled");
    
    return { success: true };
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }
    console.error("Error cancelling booking:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to cancel booking",
    });
  }
}
