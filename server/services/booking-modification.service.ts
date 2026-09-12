import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import {
  bookings,
  bookingModifications,
  passengers,
} from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { createRetailOffer } from "./retail-offer.service";
import { quotePaidOrderService } from "./order-servicing.service";
import {
  withTransactionalIdempotency,
  calculateRequestHash,
} from "./idempotency-v2.service";
export interface ChangeFlightDateInput {
  bookingId: number;
  userId: number;
  newFlightId: number;
  reason?: string;
  idempotencyKey?: string;
}
export interface UpgradeCabinInput {
  bookingId: number;
  userId: number;
  newCabinClass: "business";
  reason?: string;
  idempotencyKey?: string;
}
async function requestService(
  input: ChangeFlightDateInput | UpgradeCabinInput
) {
  const key = input.idempotencyKey ?? randomUUID();
  return withTransactionalIdempotency({
    scope: "booking.modification.quote",
    key,
    userId: input.userId,
    request: input,
    run: async tx => {
      const [booking] = await tx
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.id, input.bookingId),
            eq(bookings.userId, input.userId)
          )
        )
        .for("update");
      if (!booking)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Booking not found",
        });
      if ("newCabinClass" in input && booking.cabinClass === "business")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Already in business class",
        });
      const pax = await tx
        .select()
        .from(passengers)
        .where(eq(passengers.bookingId, booking.id));
      const offer = await createRetailOffer(
        {
          flightId:
            "newFlightId" in input ? input.newFlightId : booking.flightId,
          cabinClass:
            "newCabinClass" in input ? input.newCabinClass : booking.cabinClass,
          passengerTypes: pax.map(p => p.type),
          userId: input.userId,
          channel: "direct",
        },
        tx
      );
      const quote = await quotePaidOrderService(
        {
          bookingId: booking.id,
          offerIds: [offer.id],
          idempotencyKey: calculateRequestHash({ key }),
        },
        input.userId,
        booking.tenantId,
        tx
      );
      if (input.reason)
        await tx
          .update(bookingModifications)
          .set({ reason: input.reason })
          .where(eq(bookingModifications.id, quote.modificationId));
      return quote;
    },
  });
}
export const requestChangeFlightDate = (input: ChangeFlightDateInput) =>
  requestService(input);
export const requestUpgradeCabin = (input: UpgradeCabinInput) =>
  requestService(input);

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
