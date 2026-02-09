import { z } from "zod";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import {
  findNearbyHotels,
  bookHotelRoom,
  cancelHotelBooking,
  getHotelBookingsByFlight,
  getHotelBookingsByPassenger,
  calculateHotelEntitlement,
  getHotelCosts,
  assignTransportation,
  getAllHotels,
  addHotel,
  updateHotel,
} from "../services/emergency-hotel.service";
import { TRPCError } from "@trpc/server";

/**
 * Emergency Hotel Router
 * Manages emergency hotel bookings for disrupted passengers
 */
export const emergencyHotelRouter = router({
  /**
   * Find available hotels near an airport
   */
  findHotels: protectedProcedure
    .input(
      z.object({
        airportId: z.number(),
        checkIn: z.date(),
        checkOut: z.date(),
        guests: z.number().min(1).max(50).default(1),
      })
    )
    .query(async ({ input }) => {
      try {
        return await findNearbyHotels(
          input.airportId,
          input.checkIn,
          input.checkOut,
          input.guests
        );
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to find nearby hotels",
        });
      }
    }),

  /**
   * Book an emergency hotel room (admin only)
   */
  bookRoom: adminProcedure
    .input(
      z.object({
        hotelId: z.number(),
        bookingId: z.number(),
        flightId: z.number(),
        passengerId: z.number(),
        roomType: z.enum(["standard", "suite"]),
        checkIn: z.date(),
        checkOut: z.date(),
        mealIncluded: z.boolean().optional(),
        transportIncluded: z.boolean().optional(),
        notes: z.string().max(1000).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return await bookHotelRoom(input);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Failed to book hotel room",
        });
      }
    }),

  /**
   * Get the current user's hotel bookings (via their passenger records)
   */
  getMyHotelBookings: protectedProcedure
    .input(
      z.object({
        passengerId: z.number(),
      })
    )
    .query(async ({ input }) => {
      try {
        return await getHotelBookingsByPassenger(input.passengerId);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to fetch hotel bookings",
        });
      }
    }),

  /**
   * Get all hotel bookings for a disrupted flight (admin)
   */
  getFlightHotelBookings: adminProcedure
    .input(
      z.object({
        flightId: z.number(),
      })
    )
    .query(async ({ input }) => {
      try {
        return await getHotelBookingsByFlight(input.flightId);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to fetch flight hotel bookings",
        });
      }
    }),

  /**
   * Cancel an emergency hotel booking (admin)
   */
  cancelBooking: adminProcedure
    .input(
      z.object({
        hotelBookingId: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return await cancelHotelBooking(input.hotelBookingId);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Failed to cancel hotel booking",
        });
      }
    }),

  /**
   * Check if a passenger is entitled to hotel accommodation
   */
  checkEntitlement: protectedProcedure
    .input(
      z.object({
        disruptionType: z.enum(["delay", "cancellation", "diversion"]),
        delayHours: z.number().min(0),
      })
    )
    .query(async ({ input }) => {
      return await calculateHotelEntitlement(
        input.disruptionType,
        input.delayHours
      );
    }),

  /**
   * Get total hotel costs for a date range (admin)
   */
  getCosts: adminProcedure
    .input(
      z.object({
        from: z.date(),
        to: z.date(),
      })
    )
    .query(async ({ input }) => {
      try {
        return await getHotelCosts(input);
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Failed to fetch hotel costs",
        });
      }
    }),

  /**
   * Get all emergency hotels (admin management)
   */
  getHotels: adminProcedure.query(async () => {
    try {
      return await getAllHotels();
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Failed to fetch hotels",
      });
    }
  }),

  /**
   * Add a new emergency hotel (admin)
   */
  addHotel: adminProcedure
    .input(
      z.object({
        name: z.string().min(2).max(255),
        airportId: z.number(),
        address: z.string().min(5).max(500),
        phone: z.string().min(5).max(50),
        email: z.string().email().max(255),
        starRating: z.number().min(1).max(5),
        standardRate: z.number().min(0),
        distanceKm: z.number().min(0),
        hasTransport: z.boolean(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return await addHotel(input);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Failed to add hotel",
        });
      }
    }),

  /**
   * Update an existing emergency hotel (admin)
   */
  updateHotel: adminProcedure
    .input(
      z.object({
        hotelId: z.number(),
        name: z.string().min(2).max(255).optional(),
        address: z.string().min(5).max(500).optional(),
        phone: z.string().min(5).max(50).optional(),
        email: z.string().email().max(255).optional(),
        starRating: z.number().min(1).max(5).optional(),
        standardRate: z.number().min(0).optional(),
        distanceKm: z.number().min(0).optional(),
        hasTransport: z.boolean().optional(),
        isActive: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { hotelId, ...updates } = input;
      try {
        return await updateHotel(hotelId, updates);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error ? error.message : "Failed to update hotel",
        });
      }
    }),

  /**
   * Assign transportation for a hotel booking (admin)
   */
  assignTransport: adminProcedure
    .input(
      z.object({
        hotelBookingId: z.number(),
        type: z.enum(["shuttle", "taxi", "private_car"]),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return await assignTransportation(input.hotelBookingId, input.type);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            error instanceof Error
              ? error.message
              : "Failed to assign transportation",
        });
      }
    }),
});
