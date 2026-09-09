import { TRPCError } from "@trpc/server";
import { and, eq, gt } from "drizzle-orm";
import * as db from "../db";
import { getDb } from "../db";
import {
  bookings,
  flights,
  passengers,
  inventoryLocks,
  bookingAncillaries,
  ancillaryServices,
} from "../../drizzle/schema";
import { calculateFlightPrice } from "./flights.service";
import { createInventoryLock } from "./inventory-lock.service";
import { trackBookingStarted, trackBookingCancelled } from "./metrics.service";
import { releaseBookingSeats } from "./booking-settlement.service";
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
    if (input.tenantId != null) {
      const database = await getDb();
      if (!database) throw new Error("Database not available");
      const [flightTenant] = await database
        .select({ tenantId: flights.tenantId })
        .from(flights)
        .where(eq(flights.id, input.flightId))
        .limit(1);

      if (!flightTenant || flightTenant.tenantId !== input.tenantId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
      }
    }

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

    const flight = flightForValidation;
    if (!flight)
      throw new TRPCError({ code: "NOT_FOUND", message: "Flight not found" });
    if (!input.passengers.length)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Passengers are required",
      });
    const pricingResult = await calculateFlightPrice(
      flight,
      input.cabinClass,
      input.passengers.length,
      input.passengers,
      input.userId,
      input.sessionId
    );
    const baseAmount = pricingResult.price;

    if (pricingResult.pricing) {
      console.info(
        `[Booking] Dynamic pricing applied: ${pricingResult.pricing.adjustmentPercentage}% adjustment (Occupancy: ${pricingResult.pricing.occupancyRate}%, Days until departure: ${pricingResult.pricing.daysUntilDeparture})`
      );
    }

    const bookingReference = db.generateBookingReference();
    const pnr = db.generateBookingReference();

    const database = await getDb();
    if (!database) throw new Error("Database unavailable");
    const { bookingId, totalAmount } = await database.transaction(async tx => {
      const [currentFlight] = await tx
        .select()
        .from(flights)
        .where(eq(flights.id, input.flightId))
        .limit(1)
        .for("update");
      if (
        !currentFlight ||
        !["scheduled", "delayed"].includes(currentFlight.status) ||
        (input.tenantId != null && currentFlight.tenantId !== input.tenantId)
      )
        throw new Error("Flight unavailable");
      let lockId = input.lockId;
      if (lockId) {
        const [hold] = await tx
          .select()
          .from(inventoryLocks)
          .where(
            and(
              eq(inventoryLocks.id, lockId),
              eq(inventoryLocks.sessionId, input.sessionId),
              eq(inventoryLocks.userId, input.userId),
              eq(inventoryLocks.flightId, input.flightId),
              eq(inventoryLocks.cabinClass, input.cabinClass),
              eq(inventoryLocks.numberOfSeats, input.passengers.length),
              eq(inventoryLocks.status, "active"),
              gt(inventoryLocks.expiresAt, new Date())
            )
          )
          .limit(1)
          .for("update");
        if (!hold)
          throw new Error(
            "Inventory hold expired or does not match this booking"
          );
      } else {
        lockId = (
          await createInventoryLock(
            input.flightId,
            input.passengers.length,
            input.cabinClass,
            input.sessionId,
            input.userId,
            tx
          )
        ).lockId;
      }
      const selected = [];
      for (const item of input.ancillaries || []) {
        if (
          !Number.isSafeInteger(item.quantity) ||
          item.quantity <= 0 ||
          item.quantity > 20 ||
          item.passengerId != null
        )
          throw new Error("Invalid ancillary selection");
        const [service] = await tx
          .select()
          .from(ancillaryServices)
          .where(
            and(
              eq(ancillaryServices.id, item.ancillaryServiceId),
              eq(ancillaryServices.available, true)
            )
          )
          .limit(1);
        if (!service || service.currency !== "SAR")
          throw new Error("Ancillary unavailable");
        if (
          service.applicableCabinClasses &&
          !JSON.parse(service.applicableCabinClasses).includes(input.cabinClass)
        )
          throw new Error("Ancillary not available in this cabin");
        if (
          service.applicableAirlines &&
          !JSON.parse(service.applicableAirlines).includes(
            currentFlight.airlineId
          )
        )
          throw new Error("Ancillary not available for this airline");
        selected.push({
          ancillaryServiceId: service.id,
          quantity: item.quantity,
          unitPrice: service.price,
          totalPrice: service.price * item.quantity,
        });
      }
      const totalAmount =
        baseAmount + selected.reduce((sum, item) => sum + item.totalPrice, 0);
      const [created] = await tx.insert(bookings).values({
        tenantId: currentFlight.tenantId,
        userId: input.userId,
        flightId: input.flightId,
        inventoryLockId: lockId,
        bookingReference,
        pnr,
        status: "pending",
        totalAmount,
        cabinClass: input.cabinClass,
        numberOfPassengers: input.passengers.length,
      });
      const bookingId = created.insertId;
      await tx.insert(passengers).values(
        input.passengers.map(p => ({
          tenantId: currentFlight.tenantId,
          bookingId,
          type: p.type,
          title: p.title,
          firstName: p.firstName,
          lastName: p.lastName,
          dateOfBirth: p.dateOfBirth,
          passportNumber: p.passportNumber,
          nationality: p.nationality,
        }))
      );
      if (selected.length)
        await tx
          .insert(bookingAncillaries)
          .values(selected.map(item => ({ bookingId, ...item })));
      // The linked hold remains active until verified payment or expiry.
      return { bookingId, totalAmount };
    });

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

export async function getUserBookings(
  userId: number,
  tenantId?: number | null
) {
  try {
    return await db.getBookingsByUserId(userId, tenantId);
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
      const [current] = await tx
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.id, bookingId),
            eq(bookings.userId, userId),
            tenantId == null ? undefined : eq(bookings.tenantId, tenantId)
          )
        )
        .limit(1)
        .for("update");
      if (!current || current.status === "completed")
        throw new Error("Booking cannot be cancelled");
      if (current.status === "cancelled") return;
      await releaseBookingSeats(tx, current);
      await tx
        .update(bookings)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(bookings.id, bookingId));
      if (current.inventoryLockId)
        await tx
          .update(inventoryLocks)
          .set({ status: "released", releasedAt: new Date() })
          .where(
            and(
              eq(inventoryLocks.id, current.inventoryLockId),
              eq(inventoryLocks.status, "active")
            )
          );
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
