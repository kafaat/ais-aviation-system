/**
 * Self-Service Kiosk Router
 *
 * Public endpoints for kiosk passenger interactions:
 * - Passenger authentication (booking ref + last name)
 * - Check-in data retrieval
 * - Check-in processing
 * - Seat selection
 * - Boarding pass printing
 * - Bag tag printing
 * - Ancillary service purchase
 *
 * Admin endpoints for kiosk device management:
 * - Device listing and registration
 * - Device status monitoring
 * - Usage analytics
 */

import { z } from "zod";
import { publicProcedure, adminProcedure, router } from "../_core/trpc";
import * as kioskService from "../services/kiosk.service";

export const kioskRouter = router({
  // ========================================================================
  // Public Kiosk Endpoints (passenger-facing)
  // ========================================================================

  /**
   * Authenticate passenger at kiosk using booking reference and last name.
   * Returns session info, booking details, and passenger list.
   */
  authenticate: publicProcedure
    .input(
      z.object({
        bookingRef: z
          .string()
          .min(1, "Booking reference is required")
          .max(6, "Booking reference must be at most 6 characters"),
        lastName: z
          .string()
          .min(1, "Last name is required")
          .max(100, "Last name is too long"),
      })
    )
    .mutation(async ({ input }) => {
      return await kioskService.authenticatePassenger(
        input.bookingRef,
        input.lastName
      );
    }),

  /**
   * Get all check-in data for kiosk display (flight, passengers, seats, ancillaries).
   */
  getCheckInData: publicProcedure
    .input(
      z.object({
        bookingId: z.number().positive(),
      })
    )
    .query(async ({ input }) => {
      return await kioskService.getCheckInData(input.bookingId);
    }),

  /**
   * Process kiosk check-in for a specific passenger.
   */
  checkIn: publicProcedure
    .input(
      z.object({
        bookingId: z.number().positive(),
        passengerId: z.number().positive(),
        seatNumber: z.string().max(5).optional(),
        baggageCount: z.number().nonnegative().optional(),
      })
    )
    .mutation(async ({ input }) => {
      return await kioskService.performCheckIn(
        input.bookingId,
        input.passengerId,
        {
          seatNumber: input.seatNumber,
          baggageCount: input.baggageCount,
        }
      );
    }),

  /**
   * Select or change seat at kiosk for a passenger.
   */
  selectSeat: publicProcedure
    .input(
      z.object({
        bookingId: z.number().positive(),
        passengerId: z.number().positive(),
        seatNumber: z.string().min(1).max(5),
      })
    )
    .mutation(async ({ input }) => {
      return await kioskService.selectSeat(
        input.bookingId,
        input.passengerId,
        input.seatNumber
      );
    }),

  /**
   * Generate boarding pass data for kiosk printing.
   */
  printBoardingPass: publicProcedure
    .input(
      z.object({
        bookingId: z.number().positive(),
        passengerId: z.number().positive(),
      })
    )
    .mutation(async ({ input }) => {
      return await kioskService.printBoardingPass(
        input.bookingId,
        input.passengerId
      );
    }),

  /**
   * Generate bag tag data for kiosk printing.
   */
  printBagTag: publicProcedure
    .input(
      z.object({
        bookingId: z.number().positive(),
        passengerId: z.number().positive(),
        bagCount: z.number().min(1).max(10),
      })
    )
    .mutation(async ({ input }) => {
      return await kioskService.printBagTag(
        input.bookingId,
        input.passengerId,
        input.bagCount
      );
    }),

  /**
   * Add an ancillary service at the kiosk (extra baggage, meal, lounge, etc.).
   */
  addAncillary: publicProcedure
    .input(
      z.object({
        bookingId: z.number().positive(),
        serviceType: z.string().min(1).max(50),
        passengerId: z.number().positive(),
      })
    )
    .mutation(async ({ input }) => {
      return await kioskService.addAncillary(
        input.bookingId,
        input.serviceType,
        input.passengerId
      );
    }),

  // ========================================================================
  // Admin Kiosk Management Endpoints
  // ========================================================================

  /**
   * Get all kiosk devices, optionally filtered by airport or status.
   */
  getDevices: adminProcedure
    .input(
      z
        .object({
          airportId: z.number().optional(),
          status: z.enum(["online", "offline", "maintenance"]).optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      return await kioskService.getKioskDevices(input ?? undefined);
    }),

  /**
   * Register a new kiosk device at an airport.
   */
  registerDevice: adminProcedure
    .input(
      z.object({
        airportId: z.number().positive(),
        terminal: z.string().min(1).max(50),
        location: z.string().min(1).max(255),
        hardwareType: z.string().max(100).optional(),
        hasPrinter: z.boolean().optional(),
        hasScanner: z.boolean().optional(),
        hasPayment: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      return await kioskService.registerKiosk(
        input.airportId,
        input.terminal,
        input.location,
        {
          hardwareType: input.hardwareType,
          hasPrinter: input.hasPrinter,
          hasScanner: input.hasScanner,
          hasPayment: input.hasPayment,
        }
      );
    }),

  /**
   * Get kiosk usage analytics for an airport within a date range.
   */
  getAnalytics: adminProcedure
    .input(
      z.object({
        airportId: z.number().positive(),
        from: z.date(),
        to: z.date(),
      })
    )
    .query(async ({ input }) => {
      return await kioskService.getKioskAnalytics(input.airportId, {
        from: input.from,
        to: input.to,
      });
    }),

  /**
   * Get health and status for a specific kiosk device.
   */
  getDeviceStatus: adminProcedure
    .input(
      z.object({
        kioskId: z.number().positive(),
      })
    )
    .query(async ({ input }) => {
      return await kioskService.getKioskStatus(input.kioskId);
    }),
});
