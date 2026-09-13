import { selectSeat } from "./seat-map.service";
import { assertTenantOperational } from "./tenant.service";
import { TRPCError } from "@trpc/server";
import { and, eq, gt, sql } from "drizzle-orm";
import * as db from "../db";
import { getDb } from "../db";
import {
  bookings,
  flights,
  passengers,
  inventoryLocks,
  bookingAncillaries,
  ancillaryServices,
  priceLocks,
  seatInventory,
  waitlist,
  groupBookings,
} from "../../drizzle/schema";
import {
  createRetailOffer,
  lockRetailOffer,
  consumeRetailOffer,
} from "./retail-offer.service";
import { createInventoryLock } from "./inventory-lock.service";
import { trackBookingStarted, trackBookingCancelled } from "./metrics.service";
import {
  cancelBookingResources,
  type SettlementTx,
} from "./booking-settlement.service";
import {
  findCompletedCommand,
  withTransactionalIdempotency,
} from "./idempotency-v2.service";
import { recordEvent } from "./outbox.service";

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
  seatNumber?: string;
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
  waitlistId?: number;
  groupBookingId?: number;
  priceLockId?: number;
  offerId?: string;
  idempotencyKey?: string;
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
export async function createBooking(
  input: CreateBookingInput,
  transaction?: SettlementTx
) {
  const command = {
    scope: "booking.create.atomic",
    key: input.idempotencyKey ?? input.sessionId,
    userId: input.userId,
    request: input,
  };
  type Result = {
    bookingId: number;
    bookingReference: string;
    pnr: string;
    totalAmount: number;
  };
  try {
    const replay = await findCompletedCommand<Result>(command, transaction);
    if (replay) return replay.response;
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

      for (const passenger of input.passengers) {
        if (passenger.passportExpiry) {
          const expiry = new Date(passenger.passportExpiry);
          if (!Number.isFinite(expiry.getTime()) || expiry < minExpiry) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Passport for ${passenger.firstName} ${passenger.lastName} is not valid on the travel date; destination-specific requirements require current document review`,
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
    if (input.groupBookingId && (input.priceLockId || input.offerId))
      throw new Error("Group allocation uses its approved price");
    if (input.waitlistId && input.groupBookingId)
      throw new Error("Choose one allocation");
    if (input.offerId && input.priceLockId)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Choose an offer or a purchased price lock",
      });
    const offerId =
      input.priceLockId || input.groupBookingId
        ? undefined
        : (input.offerId ??
          (
            await createRetailOffer(
              {
                flightId: flight.id,
                cabinClass: input.cabinClass,
                passengerTypes: input.passengers.map(p => p.type),
                userId: input.userId,
                sessionId: input.sessionId,
                channel: "direct",
              },
              transaction
            )
          ).id);

    const bookingReference = db.generateBookingReference();
    const pnr = db.generateBookingReference();

    const database = await getDb();
    if (!database) throw new Error("Database unavailable");
    const result = await withTransactionalIdempotency(
      {
        scope: "booking.create.atomic",
        key: input.idempotencyKey ?? input.sessionId,
        userId: input.userId,
        request: input,
        run: async tx => {
          const [group] = input.groupBookingId
            ? await tx
                .select()
                .from(groupBookings)
                .where(eq(groupBookings.id, input.groupBookingId))
                .for("update")
            : [];
          if (
            input.groupBookingId &&
            (!group ||
              group.organizerUserId !== input.userId ||
              group.flightId !== input.flightId ||
              group.cabinClass !== input.cabinClass ||
              group.groupSize !== input.passengers.length ||
              group.status !== "confirmed" ||
              group.bookingId ||
              !group.inventoryLockId ||
              !group.totalPrice ||
              !group.allocationExpiresAt ||
              group.allocationExpiresAt <= new Date())
          )
            throw new Error(
              "Group allocation is unavailable for this customer"
            );
          const [currentFlight] = await tx
            .select()
            .from(flights)
            .where(eq(flights.id, input.flightId))
            .limit(1)
            .for("update");
          if (
            !currentFlight ||
            !["scheduled", "delayed"].includes(currentFlight.status) ||
            (input.tenantId != null &&
              currentFlight.tenantId !== input.tenantId)
          )
            throw new Error("Flight unavailable");
          await assertTenantOperational(tx, currentFlight.tenantId);
          const selectedOffer = offerId
            ? await lockRetailOffer(tx, offerId, {
                flightId: currentFlight.id,
                tenantId: currentFlight.tenantId,
                userId: input.userId,
                channel: "direct",
                cabinClass: input.cabinClass,
                passengerTypes: input.passengers.map(p => p.type),
              })
            : undefined;
          const [waiting] = input.waitlistId
            ? await tx
                .select()
                .from(waitlist)
                .where(eq(waitlist.id, input.waitlistId))
                .for("update")
            : [];
          if (
            input.waitlistId &&
            (!waiting ||
              waiting.userId !== input.userId ||
              waiting.flightId !== input.flightId ||
              waiting.cabinClass !== input.cabinClass ||
              waiting.seats !== input.passengers.length ||
              waiting.status !== "confirmed" ||
              waiting.bookingId ||
              !waiting.inventoryLockId)
          )
            throw new Error(
              "Waitlist allocation is unavailable for this booking"
            );
          let lockId =
            waiting?.inventoryLockId ?? group?.inventoryLockId ?? input.lockId;
          if (lockId) {
            const [hold] = await tx
              .select()
              .from(inventoryLocks)
              .where(
                and(
                  eq(inventoryLocks.id, lockId),
                  waiting || group
                    ? undefined
                    : eq(inventoryLocks.sessionId, input.sessionId),
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
            const [linked] = await tx
              .select({ id: bookings.id })
              .from(bookings)
              .where(
                and(
                  eq(bookings.inventoryLockId, lockId),
                  sql`${bookings.status} <> 'cancelled'`
                )
              )
              .limit(1);
            if (linked)
              throw new Error("Inventory hold already belongs to a booking");
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
              !JSON.parse(service.applicableCabinClasses).includes(
                input.cabinClass
              )
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
          let fareAmount = group?.totalPrice ?? selectedOffer?.totalAmount ?? 0;
          if (input.priceLockId) {
            const [priceLock] = await tx
              .select()
              .from(priceLocks)
              .where(
                and(
                  eq(priceLocks.id, input.priceLockId),
                  eq(priceLocks.userId, input.userId),
                  eq(priceLocks.flightId, input.flightId),
                  eq(priceLocks.cabinClass, input.cabinClass),
                  eq(priceLocks.status, "active"),
                  gt(priceLocks.expiresAt, new Date())
                )
              )
              .limit(1)
              .for("update");
            if (!priceLock)
              throw new TRPCError({
                code: "CONFLICT",
                message:
                  "Price lock is unavailable or does not belong to this booking",
              });
            fareAmount =
              priceLock.lockedPrice * input.passengers.length +
              priceLock.lockFee;
          }
          const requestedSeats = input.passengers.flatMap(p =>
            p.seatNumber ? [p.seatNumber] : []
          );
          if (new Set(requestedSeats).size !== requestedSeats.length)
            throw new Error("Duplicate requested seats");
          for (const seatNumber of requestedSeats) {
            const [seat] = await tx
              .select()
              .from(seatInventory)
              .where(
                and(
                  eq(seatInventory.flightId, input.flightId),
                  eq(seatInventory.seatNumber, seatNumber),
                  eq(seatInventory.cabinClass, input.cabinClass),
                  eq(seatInventory.status, "available")
                )
              )
              .for("update");
            if (!seat || seat.seatPrice !== 0)
              throw new Error("Requested seat is unavailable");
          }
          const totalAmount =
            fareAmount +
            selected.reduce((sum, item) => sum + item.totalPrice, 0);
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
          if (waiting)
            await tx
              .update(waitlist)
              .set({ bookingId })
              .where(eq(waitlist.id, waiting.id));
          if (group)
            await tx
              .update(groupBookings)
              .set({ bookingId })
              .where(eq(groupBookings.id, group.id));
          if (selectedOffer)
            await consumeRetailOffer(tx, selectedOffer, bookingId);
          for (const p of input.passengers) {
            const [row] = await tx.insert(passengers).values({
              tenantId: currentFlight.tenantId,
              bookingId,
              type: p.type,
              title: p.title,
              firstName: p.firstName,
              lastName: p.lastName,
              dateOfBirth: p.dateOfBirth,
              passportNumber: p.passportNumber,
              passportExpiry: p.passportExpiry,
              nationality: p.nationality,
            });
            if (p.seatNumber)
              await selectSeat(
                input.flightId,
                p.seatNumber,
                bookingId,
                row.insertId,
                tx
              );
          }
          if (selected.length)
            await tx
              .insert(bookingAncillaries)
              .values(selected.map(item => ({ bookingId, ...item })));
          if (input.priceLockId)
            await tx
              .update(priceLocks)
              .set({ status: "used", bookingId })
              .where(
                and(
                  eq(priceLocks.id, input.priceLockId),
                  eq(priceLocks.status, "active")
                )
              );
          await recordEvent(tx, {
            aggregateType: "booking",
            aggregateId: bookingId,
            tenantId: currentFlight.tenantId,
            eventType: "booking.created",
            payload: {
              bookingId,
              userId: input.userId,
              channel: "direct",
              flightId: input.flightId,
            },
          });
          return { bookingId, bookingReference, pnr, totalAmount };
        },
      },
      transaction
    );
    if (transaction) return result;
    const { bookingId, totalAmount } = result;

    trackBookingStarted({
      userId: input.userId,
      sessionId: input.sessionId,
      bookingId,
      flightId: input.flightId,
      cabinClass: input.cabinClass,
      passengerCount: input.passengers.length,
      totalAmount,
    });

    // Notification delivery is driven by the durable booking.created event.

    return result;
  } catch (error) {
    // Another request may have committed while a mutable preflight check ran.
    const replay = await findCompletedCommand<Result>(command, transaction);
    if (replay) return replay.response;
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
      await cancelBookingResources(tx, current, "Owner cancellation", userId);
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
