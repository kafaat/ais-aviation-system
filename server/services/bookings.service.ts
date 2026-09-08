import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import * as db from "../db";
import { getDb } from "../db";
import { bookings, flights } from "../../drizzle/schema";
import {
  checkFlightAvailability,
  calculateFlightPrice,
} from "./flights.service";
import {
  createInventoryLock,
  convertLockToBooking,
  verifyLock,
} from "./inventory-lock.service";
import { trackBookingStarted, trackBookingCancelled } from "./metrics.service";
import { createNotification } from "./notification.service";

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
  passportExpiry?: Date;
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
  tenantId?: number | null;
  flightId: number;
  cabinClass: "economy" | "business";
  passengers: Passenger[];
  sessionId: string;
  lockId?: number;
  ancillaries?: SelectedAncillary[];
}

function assertTenantMatch(
  rowTenantId: number | null,
  tenantId: number | null | undefined
) {
  if (tenantId != null && rowTenantId !== tenantId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
  }
}

/**
 * Create a new booking
 */
export async function createBooking(input: CreateBookingInput) {
  try {
    const database = await getDb();
    if (!database) throw new Error("Database not available");
    const [flightTenant] = await database
      .select({ tenantId: flights.tenantId })
      .from(flights)
      .where(eq(flights.id, input.flightId))
      .limit(1);

    if (!flightTenant || flightTenant.tenantId == null) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
    }
    if (input.tenantId != null && flightTenant.tenantId !== input.tenantId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
    }
    const effectiveTenantId = flightTenant.tenantId;

    const flightForValidation = await db.getFlightById(input.flightId);
    if (flightForValidation) {
      const minExpiry = new Date(flightForValidation.departureTime);
      minExpiry.setMonth(minExpiry.getMonth() + 6);

      for (const passenger of input.passengers) {
        if (passenger.passportExpiry) {
          const expiry = new Date(passenger.passportExpiry);
          if (expiry < minExpiry) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Passport for ${passenger.firstName} ${passenger.lastName} expires before the required 6-month validity period after travel date`,
            });
          }
        }
      }
    }

    let lockId = input.lockId;
    if (lockId) {
      const lockValid = await verifyLock(lockId, input.sessionId);
      if (!lockValid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Inventory lock has expired. Please search again and retry.",
        });
      }
    } else {
      const lock = await createInventoryLock(
        input.flightId,
        input.passengers.length,
        input.cabinClass,
        input.sessionId,
        input.userId
      );
      lockId = lock.lockId;
    }

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

    if (!flight) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
    }

    const pricingResult = await calculateFlightPrice(
      flight,
      input.cabinClass,
      input.passengers.length,
      input.passengers,
      input.userId,
      input.sessionId
    );
    const totalAmount = pricingResult.price;

    if (pricingResult.pricing) {
      console.info(
        `[Booking] Dynamic pricing applied: ${pricingResult.pricing.adjustmentPercentage}% adjustment (Occupancy: ${pricingResult.pricing.occupancyRate}%, Days until departure: ${pricingResult.pricing.daysUntilDeparture})`
      );
    }

    const bookingReference = db.generateBookingReference();
    const pnr = db.generateBookingReference();

    const bookingResult = await db.createBooking({
      tenantId: effectiveTenantId,
      userId: input.userId,
      flightId: input.flightId,
      bookingReference,
      pnr,
      status: "pending",
      totalAmount,
      cabinClass: input.cabinClass,
      numberOfPassengers: input.passengers.length,
    });

    const bookingId =
      (bookingResult as any).insertId || bookingResult[0]?.insertId;

    if (!bookingId) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to get booking ID",
      });
    }

    const passengersData = input.passengers.map(p => ({
      tenantId: effectiveTenantId,
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

    if (input.ancillaries && input.ancillaries.length > 0) {
      const { addAncillaryToBooking } =
        await import("./ancillary-services.service");
      for (const ancillary of input.ancillaries) {
        await addAncillaryToBooking({
          bookingId,
          ancillaryServiceId: ancillary.ancillaryServiceId,
          quantity: ancillary.quantity,
          passengerId: ancillary.passengerId,
        });
      }
    }

    trackBookingStarted({
      userId: input.userId,
      sessionId: input.sessionId,
      bookingId,
      flightId: input.flightId,
      cabinClass: input.cabinClass,
      passengerCount: input.passengers.length,
      totalAmount,
    });

    try {
      await createNotification(
        input.userId,
        "booking",
        "Booking Created",
        `Your booking ${bookingReference} has been created and is awaiting payment. Please complete your payment to confirm your reservation.`,
        {
          bookingId,
          bookingReference,
          flightId: input.flightId,
          link: `/my-bookings`,
        }
      );
    } catch (notifError) {
      console.error(
        "[Booking] Error sending booking creation notification:",
        notifError
      );
    }

    if (lockId) {
      try {
        await convertLockToBooking(lockId);
      } catch (lockError) {
        console.error("[Booking] Failed to convert inventory lock:", lockError);
      }
    }

    return { bookingId, bookingReference, pnr, totalAmount };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("Error creating booking:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create booking",
    });
  }
}

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

export async function getBookingById(
  bookingId: number,
  userId: number,
  tenantId?: number | null
) {
  try {
    const booking = await db.getBookingByIdWithDetails(bookingId);

    if (!booking) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Booking not found" });
    }

    assertTenantMatch(booking.tenantId, tenantId);

    if (booking.userId !== userId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
    }

    return booking;
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("Error getting booking:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to get booking details",
    });
  }
}

export async function cancelBooking(
  bookingId: number,
  userId: number,
  tenantId?: number | null
) {
  try {
    const booking = await getBookingById(bookingId, userId, tenantId);

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

    const database = await getDb();
    if (!database) throw new Error("Database not available");

    await database.transaction(async tx => {
      const bookingWhere =
        tenantId == null
          ? eq(bookings.id, bookingId)
          : and(eq(bookings.id, bookingId), eq(bookings.tenantId, tenantId));

      await tx
        .update(bookings)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(bookingWhere);

      if (booking.status === "confirmed" && booking.paymentStatus === "paid") {
        const flightWhere =
          tenantId == null
            ? eq(flights.id, booking.flightId)
            : and(
                eq(flights.id, booking.flightId),
                eq(flights.tenantId, tenantId)
              );

        if (booking.cabinClass === "business") {
          await tx
            .update(flights)
            .set({
              businessAvailable: sql`${flights.businessAvailable} + ${booking.numberOfPassengers}`,
            })
            .where(flightWhere);
        } else {
          await tx
            .update(flights)
            .set({
              economyAvailable: sql`${flights.economyAvailable} + ${booking.numberOfPassengers}`,
            })
            .where(flightWhere);
        }
      }
    });

    trackBookingCancelled({
      userId,
      bookingId,
      flightId: booking.flightId,
      cabinClass: booking.cabinClass as "economy" | "business",
      passengerCount: booking.numberOfPassengers,
      totalAmount: booking.totalAmount,
    });

    return { success: true };
  } catch (error) {
    if (error instanceof TRPCError) throw error;
    console.error("Error cancelling booking:", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to cancel booking",
    });
  }
}
