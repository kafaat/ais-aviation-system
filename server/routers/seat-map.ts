/**
 * Seat Map & Check-in Router
 *
 * Comprehensive tRPC router for aircraft seat map configuration,
 * per-flight seat inventory, seat selection, passenger check-in,
 * boarding pass generation, and seat pricing.
 *
 * Organized into sections:
 *   1. Seat Map Configuration (Admin)
 *   2. Seat Selection (Protected)
 *   3. Admin Seat Management
 *   4. Check-in
 *   5. Pricing
 */

import { z } from "zod";
import {
  router,
  publicProcedure,
  protectedProcedure,
  adminProcedure,
} from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import * as seatMapService from "../services/seat-map.service";
import { getDb } from "../db";
import { bookings, seatInventory } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";

// ============================================================================
// Shared Zod Schemas
// ============================================================================

const cabinClassEnum = z.enum([
  "first",
  "business",
  "premium_economy",
  "economy",
]);

const seatTypeEnum = z.enum([
  "window",
  "middle",
  "aisle",
  "bulkhead_window",
  "bulkhead_middle",
  "bulkhead_aisle",
  "exit_row_window",
  "exit_row_middle",
  "exit_row_aisle",
]);

const priceTierEnum = z.enum([
  "free",
  "standard",
  "preferred",
  "premium",
  "extra_legroom",
]);

const seatDefinitionSchema = z.object({
  column: z.string().min(1).max(2),
  seatType: seatTypeEnum,
  hasExtraLegroom: z.boolean().optional(),
  hasPowerOutlet: z.boolean().optional(),
  isReclinable: z.boolean().optional(),
  nearLavatory: z.boolean().optional(),
  nearGalley: z.boolean().optional(),
  priceTier: priceTierEnum.optional(),
  seatPrice: z.number().nonnegative().optional(),
  blocked: z.boolean().optional(),
});

const cabinRowSchema = z.object({
  row: z.number().positive(),
  cabinClass: cabinClassEnum,
  seats: z.array(seatDefinitionSchema).min(1),
});

const cabinLayoutSchema = z.object({
  rows: z.array(cabinRowSchema).min(1),
});

// ============================================================================
// Helper: verify booking ownership
// ============================================================================

async function verifyBookingOwnership(
  bookingId: number,
  userId: number
): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const [booking] = await db
    .select({ userId: bookings.userId })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .limit(1);

  if (!booking) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Booking ${bookingId} not found`,
    });
  }

  if (booking.userId !== userId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You do not own this booking",
    });
  }
}

async function verifySeatOwnership(
  flightId: number,
  seatNumber: string,
  userId: number
): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  }

  const [seat] = await db
    .select({ bookingId: seatInventory.bookingId })
    .from(seatInventory)
    .where(
      and(
        eq(seatInventory.flightId, flightId),
        eq(seatInventory.seatNumber, seatNumber)
      )
    )
    .limit(1);

  if (!seat) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Seat ${seatNumber} not found on flight ${flightId}`,
    });
  }

  if (!seat.bookingId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Seat ${seatNumber} is not assigned to any booking`,
    });
  }

  await verifyBookingOwnership(seat.bookingId, userId);
}

// ============================================================================
// Router
// ============================================================================

export const seatMapRouter = router({
  // ==========================================================================
  // 1. Seat Map Configuration (Admin)
  // ==========================================================================

  /**
   * Create a new aircraft seat map configuration.
   * Defines the cabin layout, seat counts, features, and pricing tiers.
   */
  createSeatMap: adminProcedure
    .input(
      z.object({
        aircraftType: z.string().min(1).max(50),
        airlineId: z.number().positive(),
        configName: z.string().min(1).max(100),
        cabinLayout: cabinLayoutSchema,
        totalSeats: z.number().positive(),
        firstClassSeats: z.number().nonnegative().default(0),
        businessSeats: z.number().nonnegative().default(0),
        premiumEconomySeats: z.number().nonnegative().default(0),
        economySeats: z.number().nonnegative().default(0),
        seatPitch: z.record(z.string(), z.number().positive()).optional(),
        seatWidth: z.record(z.string(), z.number().positive()).optional(),
        hasWifi: z.boolean().default(false),
        hasPowerOutlets: z.boolean().default(false),
        hasIFE: z.boolean().default(false),
      })
    )
    .mutation(async ({ input }) => {
      return await seatMapService.createSeatMap({
        aircraftType: input.aircraftType,
        airlineId: input.airlineId,
        configName: input.configName,
        cabinLayout: input.cabinLayout,
        totalSeats: input.totalSeats,
        firstClassSeats: input.firstClassSeats,
        businessSeats: input.businessSeats,
        premiumEconomySeats: input.premiumEconomySeats,
        economySeats: input.economySeats,
        seatPitch: input.seatPitch,
        seatWidth: input.seatWidth,
        hasWifi: input.hasWifi,
        hasPowerOutlets: input.hasPowerOutlets,
        hasIFE: input.hasIFE,
      });
    }),

  /**
   * Update an existing seat map configuration.
   * All fields are optional; only provided fields are updated.
   */
  updateSeatMap: adminProcedure
    .input(
      z.object({
        id: z.number().positive(),
        aircraftType: z.string().min(1).max(50).optional(),
        configName: z.string().min(1).max(100).optional(),
        cabinLayout: cabinLayoutSchema.optional(),
        totalSeats: z.number().positive().optional(),
        firstClassSeats: z.number().nonnegative().optional(),
        businessSeats: z.number().nonnegative().optional(),
        premiumEconomySeats: z.number().nonnegative().optional(),
        economySeats: z.number().nonnegative().optional(),
        seatPitch: z.record(z.string(), z.number().positive()).optional(),
        seatWidth: z.record(z.string(), z.number().positive()).optional(),
        hasWifi: z.boolean().optional(),
        hasPowerOutlets: z.boolean().optional(),
        hasIFE: z.boolean().optional(),
        active: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { id, ...updateData } = input;
      return await seatMapService.updateSeatMap(id, updateData);
    }),

  /**
   * Get a seat map configuration by ID.
   * Returns the full configuration with parsed JSON fields.
   */
  getSeatMap: publicProcedure
    .input(z.object({ id: z.number().positive() }))
    .query(async ({ input }) => {
      return await seatMapService.getSeatMap(input.id);
    }),

  /**
   * List seat map configurations, optionally filtered by airline and/or aircraft type.
   * Only returns active seat maps.
   */
  listSeatMaps: adminProcedure
    .input(
      z
        .object({
          airlineId: z.number().positive().optional(),
          aircraftType: z.string().min(1).max(50).optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      return await seatMapService.listSeatMaps(
        input?.airlineId,
        input?.aircraftType
      );
    }),

  /**
   * Initialize seat inventory for a flight from a seat map template.
   * Creates individual seat records for every seat defined in the layout.
   * Idempotent: throws CONFLICT if seats already exist for the flight.
   */
  initializeFlightSeats: adminProcedure
    .input(
      z.object({
        flightId: z.number().positive(),
        seatMapId: z.number().positive(),
      })
    )
    .mutation(async ({ input }) => {
      return await seatMapService.initializeFlightSeats(
        input.flightId,
        input.seatMapId
      );
    }),

  // ==========================================================================
  // 2. Seat Selection (Protected)
  // ==========================================================================

  /**
   * Get the full seat map for a flight with real-time seat availability.
   * Returns seats organized by cabin class and row for UI rendering.
   * Public endpoint so guests can view seat availability before booking.
   */
  getFlightSeatMap: publicProcedure
    .input(z.object({ flightId: z.number().positive() }))
    .query(async ({ input }) => {
      return await seatMapService.getFlightSeatMap(input.flightId);
    }),

  /**
   * Select/assign a seat to a passenger.
   * If the passenger already has a seat on this flight, the old seat is released first.
   * Verifies booking ownership, passenger-booking relationship, and seat availability.
   */
  selectSeat: protectedProcedure
    .input(
      z.object({
        flightId: z.number().positive(),
        seatNumber: z.string().min(2).max(5),
        bookingId: z.number().positive(),
        passengerId: z.number().positive(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Verify the authenticated user owns this booking
      await verifyBookingOwnership(input.bookingId, ctx.user.id);

      return await seatMapService.selectSeat(
        input.flightId,
        input.seatNumber,
        input.bookingId,
        input.passengerId
      );
    }),

  /**
   * Release a previously assigned seat, making it available again.
   * Verifies that the authenticated user owns the booking for the seat.
   * Cannot release a seat for a checked-in passenger (undo check-in first).
   */
  releaseSeat: protectedProcedure
    .input(
      z.object({
        flightId: z.number().positive(),
        seatNumber: z.string().min(2).max(5),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Verify ownership of the seat's booking
      await verifySeatOwnership(input.flightId, input.seatNumber, ctx.user.id);

      return await seatMapService.releaseSeat(input.flightId, input.seatNumber);
    }),

  /**
   * Change a passenger's seat assignment from one seat to another.
   * Releases the old seat and assigns the new one atomically.
   * Preserves checked-in status if the passenger was already checked in.
   */
  changeSeat: protectedProcedure
    .input(
      z.object({
        flightId: z.number().positive(),
        oldSeatNumber: z.string().min(2).max(5),
        newSeatNumber: z.string().min(2).max(5),
        bookingId: z.number().positive(),
        passengerId: z.number().positive(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Verify the authenticated user owns this booking
      await verifyBookingOwnership(input.bookingId, ctx.user.id);

      return await seatMapService.changeSeat(
        input.flightId,
        input.oldSeatNumber,
        input.newSeatNumber,
        input.bookingId,
        input.passengerId
      );
    }),

  /**
   * Get the seat assignment for a specific passenger in a booking.
   * Returns null if no seat has been assigned yet.
   */
  getPassengerSeat: protectedProcedure
    .input(
      z.object({
        bookingId: z.number().positive(),
        passengerId: z.number().positive(),
      })
    )
    .query(async ({ input, ctx }) => {
      // Verify the authenticated user owns this booking
      await verifyBookingOwnership(input.bookingId, ctx.user.id);

      return await seatMapService.getPassengerSeat(
        input.bookingId,
        input.passengerId
      );
    }),

  // ==========================================================================
  // 3. Admin Seat Management
  // ==========================================================================

  /**
   * Block a seat (admin operation).
   * Used for crew seats, equipment placement, or maintenance.
   * Cannot block occupied or checked-in seats.
   */
  blockSeat: adminProcedure
    .input(
      z.object({
        flightId: z.number().positive(),
        seatNumber: z.string().min(2).max(5),
        reason: z.string().max(255).optional(),
      })
    )
    .mutation(async ({ input }) => {
      return await seatMapService.blockSeat(
        input.flightId,
        input.seatNumber,
        input.reason
      );
    }),

  /**
   * Unblock a previously blocked seat, making it available again.
   * Only works on seats with 'blocked' or 'restricted' status.
   */
  unblockSeat: adminProcedure
    .input(
      z.object({
        flightId: z.number().positive(),
        seatNumber: z.string().min(2).max(5),
      })
    )
    .mutation(async ({ input }) => {
      return await seatMapService.unblockSeat(input.flightId, input.seatNumber);
    }),

  // ==========================================================================
  // 4. Check-in
  // ==========================================================================

  /**
   * Check in a passenger for a flight.
   * If a specific seat number is provided, assigns that seat.
   * If no seat is specified and the passenger already has one, uses the existing assignment.
   * If no seat is specified and none is assigned, auto-assigns the best available seat.
   * Generates a boarding group and sequence number.
   */
  checkIn: protectedProcedure
    .input(
      z.object({
        flightId: z.number().positive(),
        bookingId: z.number().positive(),
        passengerId: z.number().positive(),
        seatNumber: z.string().min(2).max(5).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Verify the authenticated user owns this booking
      await verifyBookingOwnership(input.bookingId, ctx.user.id);

      return await seatMapService.checkIn(
        input.flightId,
        input.bookingId,
        input.passengerId,
        input.seatNumber
      );
    }),

  /**
   * Undo a passenger's check-in (admin only).
   * Reverts the seat status from 'checked_in' to 'occupied'.
   * Clears boarding group, sequence, and boarding pass issued flag.
   */
  undoCheckIn: adminProcedure
    .input(
      z.object({
        flightId: z.number().positive(),
        bookingId: z.number().positive(),
        passengerId: z.number().positive(),
      })
    )
    .mutation(async ({ input }) => {
      return await seatMapService.undoCheckIn(
        input.flightId,
        input.bookingId,
        input.passengerId
      );
    }),

  /**
   * Get boarding pass data for a checked-in passenger.
   * Includes flight details, airline info, origin/destination, seat assignment,
   * gate info (if available), and an IATA-format barcode data string.
   */
  getBoardingPass: protectedProcedure
    .input(
      z.object({
        flightId: z.number().positive(),
        passengerId: z.number().positive(),
      })
    )
    .query(async ({ input, ctx }) => {
      // Verify ownership: look up the seat to find the booking, then verify
      const db = await getDb();
      if (!db) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Database not available",
        });
      }

      const [seat] = await db
        .select({ bookingId: seatInventory.bookingId })
        .from(seatInventory)
        .where(
          and(
            eq(seatInventory.flightId, input.flightId),
            eq(seatInventory.passengerId, input.passengerId),
            eq(seatInventory.status, "checked_in")
          )
        )
        .limit(1);

      if (!seat || !seat.bookingId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Passenger is not checked in for this flight",
        });
      }

      await verifyBookingOwnership(seat.bookingId, ctx.user.id);

      return await seatMapService.generateBoardingPass(
        input.flightId,
        input.passengerId
      );
    }),

  /**
   * Get check-in statistics for a flight (admin only).
   * Returns total passengers, checked-in count, boarding passes issued,
   * and a breakdown by cabin class.
   */
  getCheckInStatus: adminProcedure
    .input(z.object({ flightId: z.number().positive() }))
    .query(async ({ input }) => {
      return await seatMapService.getCheckInStatus(input.flightId);
    }),

  // ==========================================================================
  // 5. Pricing
  // ==========================================================================

  /**
   * Get seat pricing information for a flight.
   * Returns available seats grouped by price tier and cabin class.
   * Optionally filtered by cabin class.
   */
  getSeatPricing: publicProcedure
    .input(
      z.object({
        flightId: z.number().positive(),
        cabinClass: cabinClassEnum.optional(),
      })
    )
    .query(async ({ input }) => {
      return await seatMapService.getSeatPricing(
        input.flightId,
        input.cabinClass
      );
    }),

  /**
   * Calculate the price difference for upgrading/changing from one seat to another.
   * Returns both seat details and the price difference in SAR cents.
   * Positive priceDifference means additional charge; negative means credit.
   */
  calculateUpgradePrice: protectedProcedure
    .input(
      z.object({
        flightId: z.number().positive(),
        currentSeat: z.string().min(2).max(5),
        newSeat: z.string().min(2).max(5),
      })
    )
    .query(async ({ input }) => {
      return await seatMapService.calculateSeatUpgradePrice(
        input.flightId,
        input.currentSeat,
        input.newSeat
      );
    }),
});
